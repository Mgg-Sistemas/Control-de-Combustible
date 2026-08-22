-- ============================================================================
-- Módulo de Fabricación (MRP) — Fase 2: Maestros (Centros de trabajo, Recetas
-- / BoM y Rutas de producción).
--
-- Este archivo es 100% ADITIVO:
--   - No modifica, ni borra, ni renombra ninguna tabla/columna existente.
--   - La única alteración a una tabla existente es sumar la columna nullable-
--     con-default `item_kind` a `inventory_items` (paso 1), con DEFAULT
--     'general' para que todas las filas actuales queden exactamente igual
--     que antes (no se toca ni un dato).
--   - Todo lo demás son tablas NUEVAS (work_centers, bom_versions,
--     production_routes) que no existían.
-- Idempotente: usa `create table if not exists`, `add column if not exists`
-- y `create or replace` en funciones/vistas, así que es seguro correrlo más
-- de una vez y seguro de correr en producción.
--
-- Fuera de alcance de esta fase (a propósito, NO se crean aquí):
--   manufacturing_orders / work_orders — quedan para una fase posterior.
--
-- Convención de RLS: se siguió el patrón real de `compras`/`inventario` en
-- supabase/schema.sql, que usa la función `public.can_write_module(mod text)`
-- (definida en schema.sql ~línea 76) para gatear INSERT/UPDATE/DELETE por
-- permiso de módulo, con SELECT abierto a cualquier autenticado. Esa función
-- SÍ existe en este proyecto, así que no aplica el fallback al patrón plano
-- de hose_services.sql. Se usa el permiso de módulo 'mangueras' (el mismo
-- que ya gobierna el resto del módulo de Fabricación, incluida la pantalla
-- ManguerasScreen), tal como pidió la especificación de esta fase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) inventory_items.item_kind — distingue materia prima / componente /
--    producto terminado del stock "general" ya existente (repuestos, etc.).
--    DEFAULT 'general' preserva sin cambios todas las filas actuales.
-- ----------------------------------------------------------------------------
alter table public.inventory_items
  add column if not exists item_kind text not null default 'general'
    check (item_kind in ('general', 'materia_prima', 'componente', 'producto_terminado'));

-- ============================================================================
-- 2) CENTROS DE TRABAJO (work_centers): máquina, área o cuadrilla donde se
--    ejecutan las operaciones de una ruta de producción. `machinery_id` es un
--    enlace OPCIONAL a una máquina ya controlada en `machinery` (ej. una
--    prensa de mangueras que también aparece en Maquinaria).
-- ============================================================================
create table if not exists public.work_centers (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null,
  name                   text not null,
  type                   text not null default 'maquina'
    check (type in ('maquina', 'area', 'cuadrilla')),
  machinery_id           uuid references public.machinery(id) on delete set null,
  capacity_units_per_hour numeric(12,2),
  hourly_cost_labor      numeric(12,2) not null default 0,
  hourly_cost_machine    numeric(12,2) not null default 0,
  setup_minutes          numeric(8,2) not null default 0,
  cleanup_minutes        numeric(8,2) not null default 0,
  shifts                 jsonb not null default '[]'::jsonb, -- [{label, start, end}]
  active                 boolean not null default true,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now()
);

create index if not exists idx_work_centers_machinery on public.work_centers(machinery_id);
create index if not exists idx_work_centers_active on public.work_centers(active);

alter table public.work_centers enable row level security;

drop policy if exists work_centers_select on public.work_centers;
create policy work_centers_select on public.work_centers for select to authenticated using (true);
drop policy if exists work_centers_write on public.work_centers;
create policy work_centers_write on public.work_centers for all to authenticated
  using (public.can_write_module('mangueras')) with check (public.can_write_module('mangueras'));

-- ============================================================================
-- 3) RECETAS / BILL OF MATERIALS (bom_versions): versiones de receta de un
--    producto terminado (inventory_items). Solo puede haber UNA versión
--    'activa' por producto a la vez — lo garantiza el índice único parcial
--    de abajo, no el código de la app.
-- ============================================================================
create table if not exists public.bom_versions (
  id               uuid primary key default gen_random_uuid(),
  product_item_id  uuid not null references public.inventory_items(id) on delete cascade,
  version_no       integer not null,
  status           text not null default 'borrador'
    check (status in ('borrador', 'activa', 'obsoleta')),
  output_qty       numeric(12,4) not null default 1,
  output_unit      text,
  -- [{component_item_id, name, qty_per_output, unit, waste_pct, substitutes:[{item_id,name}], notes}]
  components       jsonb not null default '[]'::jsonb,
  notes            text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  activated_by     uuid references public.profiles(id) on delete set null,
  activated_at     timestamptz
);

create unique index if not exists idx_bom_versions_product_version
  on public.bom_versions(product_item_id, version_no);

-- Solo una receta ACTIVA por producto: la BD lo garantiza, no la app.
create unique index if not exists idx_bom_versions_one_active_per_product
  on public.bom_versions(product_item_id) where (status = 'activa');

create index if not exists idx_bom_versions_product on public.bom_versions(product_item_id);
create index if not exists idx_bom_versions_status on public.bom_versions(status);

alter table public.bom_versions enable row level security;

drop policy if exists bom_versions_select on public.bom_versions;
create policy bom_versions_select on public.bom_versions for select to authenticated using (true);
drop policy if exists bom_versions_write on public.bom_versions;
create policy bom_versions_write on public.bom_versions for all to authenticated
  using (public.can_write_module('mangueras')) with check (public.can_write_module('mangueras'));

-- ============================================================================
-- 4) RUTAS DE PRODUCCIÓN (production_routes): secuencia de operaciones (por
--    centro de trabajo) para fabricar un producto, opcionalmente casada con
--    una versión de receta puntual. Igual que en bom_versions, solo UNA ruta
--    'activa' por producto — garantizado por índice único parcial.
-- ============================================================================
create table if not exists public.production_routes (
  id              uuid primary key default gen_random_uuid(),
  product_item_id uuid not null references public.inventory_items(id) on delete cascade,
  bom_version_id  uuid references public.bom_versions(id) on delete set null,
  name            text not null,
  status          text not null default 'borrador'
    check (status in ('borrador', 'activa', 'obsoleta')),
  -- [{step_no, work_center_id, name, description, standard_minutes,
  --   is_quality_checkpoint, checkpoint_type, checkpoint_spec}]
  steps           jsonb not null default '[]'::jsonb,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Solo una ruta ACTIVA por producto: la BD lo garantiza, no la app.
create unique index if not exists idx_production_routes_one_active_per_product
  on public.production_routes(product_item_id) where (status = 'activa');

create index if not exists idx_production_routes_product on public.production_routes(product_item_id);
create index if not exists idx_production_routes_bom_version on public.production_routes(bom_version_id);
create index if not exists idx_production_routes_status on public.production_routes(status);

alter table public.production_routes enable row level security;

drop policy if exists production_routes_select on public.production_routes;
create policy production_routes_select on public.production_routes for select to authenticated using (true);
drop policy if exists production_routes_write on public.production_routes;
create policy production_routes_write on public.production_routes for all to authenticated
  using (public.can_write_module('mangueras')) with check (public.can_write_module('mangueras'));

-- ============================================================================
-- 5) TIEMPO REAL: igual que hose_services (supabase/hose_services.sql), para
--    que el alta/edición de centros de trabajo, recetas y rutas se refresque
--    solo en pantalla sin recargar a mano. `add table` falla si la tabla ya
--    está publicada; por eso se ignora el error.
-- ============================================================================
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.work_centers';
  exception when duplicate_object then null; when others then null;
  end;
end $$;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.bom_versions';
  exception when duplicate_object then null; when others then null;
  end;
end $$;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.production_routes';
  exception when duplicate_object then null; when others then null;
  end;
end $$;
