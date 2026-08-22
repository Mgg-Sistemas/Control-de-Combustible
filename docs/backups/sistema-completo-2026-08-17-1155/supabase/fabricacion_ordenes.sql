-- ============================================================================
-- Módulo de Fabricación (MRP) — Fase 3: Órdenes de Fabricación (MO) y Órdenes
-- de Trabajo (WO).
--
-- Este archivo es 100% ADITIVO:
--   - No modifica, ni borra, ni renombra ninguna tabla/columna existente.
--   - Todo lo que sigue son tablas NUEVAS (manufacturing_orders, work_orders,
--     wo_time_logs) que no existían, más 3 columnas nullable-sin-required en
--     tablas existentes (hose_services.manufacturing_order_id e
--     inventory_movements.mo_id / .wo_id), ninguna con backfill: las filas
--     actuales quedan exactamente igual que antes (todas quedan en NULL).
-- Idempotente: usa `create table if not exists`, `add column if not exists`
-- y `create or replace` en funciones, así que es seguro correrlo más de una
-- vez y seguro de correr en producción.
--
-- Fuera de alcance de esta fase (a propósito, NO se crea aquí): kiosco de
-- operador sin cuenta, exigencia real de checkpoints de calidad, OEE,
-- trazabilidad por lote/serie. Eso queda para fases posteriores.
--
-- Convenciones seguidas (ver supabase/fabricacion_maestros.sql y
-- supabase/hose_services.sql):
--   - RLS: SELECT abierto a cualquier autenticado; escritura gateada por
--     `public.can_write_module('mangueras')` (misma función y mismo módulo
--     que el resto de Fabricación — firma confirmada en schema.sql ~línea 76:
--     `can_write_module(mod text) returns boolean`).
--   - Correlativo "MO-####": se replica EXACTAMENTE el mecanismo real y
--     vigente de "REQ-####" en inventory_requirements, que NO es un simple
--     `max+1` armado en la app: es un TRIGGER en la base
--     (supabase/requerimientos_correlativo.sql →
--     `assign_requirement_code()` / `trg_assign_requirement_code`,
--     `before insert`) que toma `pg_advisory_xact_lock` para serializar
--     inserciones concurrentes, calcula `max(código) + 1` leyendo TODAS las
--     filas (SECURITY DEFINER) y arma el código con `lpad(...,4,'0')`. Un
--     índice único sobre `code` queda como red de seguridad adicional, igual
--     que `inventory_requirements_code_key`. Aquí se hace lo mismo para
--     "MO-####" con `assign_mo_code()` / `trg_assign_mo_code`.
-- ============================================================================

-- ============================================================================
-- 1) ÓRDENES DE FABRICACIÓN (manufacturing_orders): la orden madre que dispara
--    la producción de un producto terminado, a partir de una receta (BoM) y,
--    opcionalmente, una ruta de producción concretas.
-- ============================================================================
create table if not exists public.manufacturing_orders (
  id                 uuid primary key default gen_random_uuid(),
  code               text,                          -- MO-#### (correlativo, lo asigna el trigger de abajo)
  product_item_id    uuid not null references public.inventory_items(id),
  bom_version_id     uuid references public.bom_versions(id),
  route_id           uuid references public.production_routes(id),
  demand_trigger     text not null default 'manual'
    check (demand_trigger in ('manual', 'stock_minimo', 'pedido_venta')),
  qty_planned        numeric(14,4) not null check (qty_planned > 0),
  qty_produced       numeric(14,4) not null default 0,
  uom                text,
  status             text not null default 'planificada'
    check (status in ('planificada', 'reservada', 'en_proceso', 'pausada', 'completada', 'cerrada', 'cancelada')),
  -- Copia de components (de bom_versions) × qty_planned, tomada al CREAR la MO,
  -- para que la orden quede estable/auditable aunque la receta cambie después.
  -- Mismo shape que bom_versions.components:
  -- [{component_item_id, name, qty_per_output, unit, waste_pct, qty_required, substitutes, notes}]
  components_snapshot jsonb not null default '[]'::jsonb,
  planned_start      date,
  planned_end        date,
  started_at         timestamptz,
  finished_at        timestamptz,
  estimated_cost     numeric(14,2) default 0,
  real_cost          numeric(14,2) default 0,
  company_id         uuid references public.companies(id),
  note               text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  closed_by          uuid references public.profiles(id) on delete set null,
  closed_at          timestamptz
);

create index if not exists idx_mo_product on public.manufacturing_orders(product_item_id);
create index if not exists idx_mo_bom_version on public.manufacturing_orders(bom_version_id);
create index if not exists idx_mo_route on public.manufacturing_orders(route_id);
create index if not exists idx_mo_status on public.manufacturing_orders(status);
create index if not exists idx_mo_company on public.manufacturing_orders(company_id);
create index if not exists idx_mo_created on public.manufacturing_orders(created_at);
-- Red de seguridad igual que inventory_requirements_code_key: el trigger ya
-- serializa con advisory lock, pero el índice único evita duplicados a prueba
-- de fallos (ej. dos transacciones que ignoren el lock por algún motivo).
create unique index if not exists manufacturing_orders_code_key on public.manufacturing_orders(code);

alter table public.manufacturing_orders enable row level security;

drop policy if exists mo_select on public.manufacturing_orders;
create policy mo_select on public.manufacturing_orders for select to authenticated using (true);
drop policy if exists mo_write on public.manufacturing_orders;
create policy mo_write on public.manufacturing_orders for all to authenticated
  using (public.can_write_module('mangueras')) with check (public.can_write_module('mangueras'));

-- Correlativo MO-#### asignado por la BASE (no por la app), replicando el
-- mismo mecanismo a prueba de fallos de assign_requirement_code() en
-- supabase/requerimientos_correlativo.sql.
create or replace function public.assign_mo_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare nextn int;
begin
  if new.code is not null then
    return new; -- respeta un código explícito si alguna vez se pasa a mano
  end if;
  perform pg_advisory_xact_lock(hashtext('manufacturing_orders_code'));
  select coalesce(max((regexp_replace(code, '\D', '', 'g'))::int), 0) + 1
    into nextn
    from public.manufacturing_orders
    where code ~ '^MO-\d+$';
  new.code := 'MO-' || lpad(nextn::text, 4, '0');
  return new;
end $$;

drop trigger if exists trg_assign_mo_code on public.manufacturing_orders;
create trigger trg_assign_mo_code
  before insert on public.manufacturing_orders
  for each row execute function public.assign_mo_code();

-- ============================================================================
-- 2) Enlace SUAVE de hose_services hacia su MO de origen (si la manguera se
--    confeccionó dentro de una orden de fabricación). Nullable, nunca
--    obligatorio, sin backfill: las filas existentes de hose_services quedan
--    exactamente igual (en NULL).
-- ============================================================================
alter table public.hose_services
  add column if not exists manufacturing_order_id uuid references public.manufacturing_orders(id) on delete set null;

create index if not exists idx_hose_services_mo on public.hose_services(manufacturing_order_id);

-- ============================================================================
-- 3) ÓRDENES DE TRABAJO (work_orders): tareas individuales por centro de
--    trabajo dentro de una MO (equivalen a los pasos de production_routes,
--    ya instanciados/asignables para una orden concreta).
-- ============================================================================
create table if not exists public.work_orders (
  id                    uuid primary key default gen_random_uuid(),
  mo_id                 uuid not null references public.manufacturing_orders(id) on delete cascade,
  wo_no                 integer not null,             -- secuencial dentro de la MO
  work_center_id        uuid references public.work_centers(id),
  step_no               integer,                       -- paso de production_routes.steps que lo originó, si aplica
  name                  text not null,
  description           text,
  status                text not null default 'pendiente'
    check (status in ('pendiente', 'en_proceso', 'pausada', 'completada', 'cancelada')),
  qty_planned           numeric(14,4),
  qty_completed         numeric(14,4) not null default 0,
  qty_scrap             numeric(14,4) not null default 0,
  assigned_operator_id  uuid references public.profiles(id) on delete set null,
  operator_name         text,                          -- para operación desde kiosco sin cuenta individual (fase futura)
  operator_cedula       text,
  started_at            timestamptz,
  ended_at              timestamptz,
  paused_minutes        numeric(8,2) not null default 0,
  is_quality_checkpoint boolean not null default false,
  qc_result             text not null default 'pendiente'
    check (qc_result in ('pendiente', 'aprobado', 'rechazado')),
  qc_data               jsonb not null default '{}'::jsonb,
  stop_reason           text,
  notes                 text,
  created_at            timestamptz not null default now()
);

create unique index if not exists idx_work_orders_mo_wono on public.work_orders(mo_id, wo_no);
create index if not exists idx_work_orders_mo on public.work_orders(mo_id);
create index if not exists idx_work_orders_work_center on public.work_orders(work_center_id);
create index if not exists idx_work_orders_status on public.work_orders(status);
create index if not exists idx_work_orders_operator on public.work_orders(assigned_operator_id);

alter table public.work_orders enable row level security;

drop policy if exists work_orders_select on public.work_orders;
create policy work_orders_select on public.work_orders for select to authenticated using (true);
drop policy if exists work_orders_write on public.work_orders;
create policy work_orders_write on public.work_orders for all to authenticated
  using (public.can_write_module('mangueras')) with check (public.can_write_module('mangueras'));

-- ============================================================================
-- 4) wo_time_logs: bitácora AUDITABLE de tiempo/eventos por WO, en el mismo
--    espíritu que machine_work_segments (supabase/machine_work_segments.sql):
--    historial fila-por-evento en paralelo a los acumulados de work_orders
--    (paused_minutes, started_at/ended_at), sin reemplazarlos.
--    A diferencia de audit_log (supabase/audit.sql) —que es de solo lectura
--    para el cliente y la escribe únicamente un trigger SECURITY DEFINER—
--    esta bitácora la escribe la propia app (inicio/pausa/fin los dispara el
--    operador), así que lleva política de INSERT abierta a autenticados. Es
--    igualmente INMUTABLE desde el cliente: no hay política de UPDATE ni de
--    DELETE, por lo que una vez insertada una fila no se puede alterar ni
--    borrar salvo con permisos elevados (mismo criterio de "bitácora
--    inmutable" que audit_log).
-- ============================================================================
create table if not exists public.wo_time_logs (
  id              uuid primary key default gen_random_uuid(),
  wo_id           uuid not null references public.work_orders(id) on delete cascade,
  event           text not null check (event in ('inicio', 'pausa', 'reanudacion', 'fin', 'falla', 'cantidad', 'cancelada')),
  qty_delta       numeric(14,4),                     -- cantidad producida registrada en ese evento, si aplica
  note            text,
  created_by      uuid references auth.users(id) on delete set null,
  operator_name   text,
  operator_cedula text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_wo_time_logs_wo on public.wo_time_logs(wo_id);
create index if not exists idx_wo_time_logs_created on public.wo_time_logs(created_at);

alter table public.wo_time_logs enable row level security;

drop policy if exists wo_time_logs_select on public.wo_time_logs;
create policy wo_time_logs_select on public.wo_time_logs for select to authenticated using (true);
drop policy if exists wo_time_logs_insert on public.wo_time_logs;
create policy wo_time_logs_insert on public.wo_time_logs for insert to authenticated with check (true);
-- Sin política de UPDATE ni DELETE a propósito: bitácora inmutable.

-- ============================================================================
-- 5) Trazabilidad de consumo/producción: se REUTILIZA inventory_movements (el
--    ledger append-only ya existente en schema.sql) en vez de crear una tabla
--    nueva. mo_id/wo_id son nullable y sin backfill: los movimientos previos
--    a este módulo quedan exactamente igual, en NULL. `inventory_levels`
--    (vista) y `inv_recalc_avg` (trigger de PMP) siguen funcionando sin
--    cambios: no se toca su definición.
-- ============================================================================
alter table public.inventory_movements add column if not exists mo_id uuid references public.manufacturing_orders(id) on delete set null;
alter table public.inventory_movements add column if not exists wo_id uuid references public.work_orders(id) on delete set null;

create index if not exists idx_inv_mov_mo on public.inventory_movements(mo_id);
create index if not exists idx_inv_mov_wo on public.inventory_movements(wo_id);

-- ============================================================================
-- 6) TIEMPO REAL: igual que fabricacion_maestros.sql / hose_services.sql, para
--    que el alta/edición de MOs, WOs y su bitácora se refresque solo en
--    pantalla sin recargar a mano. `add table` falla si la tabla ya está
--    publicada; por eso se ignora el error.
-- ============================================================================
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.manufacturing_orders';
  exception when duplicate_object then null; when others then null;
  end;
end $$;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.work_orders';
  exception when duplicate_object then null; when others then null;
  end;
end $$;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.wo_time_logs';
  exception when duplicate_object then null; when others then null;
  end;
end $$;
