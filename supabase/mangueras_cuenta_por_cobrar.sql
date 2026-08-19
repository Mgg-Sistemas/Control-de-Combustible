-- ============================================================================
-- MANGUERAS (Fabricación) → CUENTA POR COBRAR automática.
--
-- Pedido del cliente (19-ago-2026):
--   "Todo lo que se cree en mangueras hidráulicas me genera una cuenta POR
--    COBRAR, elegida por EMPRESA y por ENCARGADO a quien se le cobrará. Que se
--    refleje en Compras → Cuentas por cobrar, con su recibo de cobro/factura.
--    Cuando el encargado sea CHELI, NO genera cuenta por cobrar."
--
-- Decisiones confirmadas:
--   1) MONTO a cobrar = costo × (1 + margen%). El margen es por manguera
--      (`sale_margin_pct`, default 30 %).
--   2) ENCARGADO = catálogo nuevo `encargados` con bandera `cobrar`. CHELI se
--      siembra con `cobrar=false`: sus mangueras NO generan cuenta por cobrar.
--      Se puede marcar a cualquier otro encargado como "no cobrar" sin tocar
--      código.
--   3) EMPRESA a cobrar = `companies` (la misma contraparte que exige una cuenta
--      'por_cobrar'). Aplica también a mangueras EXTERNAS (piden empresa+encargado).
--   4) La cuenta CONVIVE con la cuenta POR PAGAR de la misma manguera (proveedor).
--      Una manguera puede originar HASTA DOS cuentas: una por_pagar (proveedor) y
--      una por_cobrar (empresa/encargado). Por eso el índice único de enlace pasa
--      de (hose_service_id) a (hose_service_id, tipo).
--
-- Idempotente. Requiere `supabase/cuentas_por_pagar_y_cobrar.sql`,
-- `supabase/hose_services.sql` y `supabase/fabricacion_mangueras_cuenta_por_pagar.sql`.
-- CORRER A MANO en Supabase → SQL Editor. Al final está el bloque de verificación.
-- ============================================================================


-- ── 1) CATÁLOGO DE ENCARGADOS ───────────────────────────────────────────────
-- Un encargado = la persona a la que se le cobra la manguera. `cobrar=false`
-- significa "no se le genera cuenta por cobrar" (caso CHELI). Catálogo simple,
-- editable desde la app (desplegable + agregar), igual criterio operativo que
-- hose_services: la RLS deja leer/escribir a autenticados; el módulo lo gobierna
-- la app.
create table if not exists public.encargados (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  cobrar     boolean not null default true,   -- false = NO se le genera cuenta por cobrar (CHELI)
  active     boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Identidad única case-insensitive: no dos "CHELI".
create unique index if not exists encargados_name_uniq
  on public.encargados (lower(trim(name)));

alter table public.encargados enable row level security;
drop policy if exists encargados_select on public.encargados;
create policy encargados_select on public.encargados for select to authenticated using (true);
drop policy if exists encargados_write on public.encargados;
create policy encargados_write on public.encargados for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.encargados to authenticated;

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.encargados'; exception when others then null; end;
end $$;

-- Siembra CHELI = NO cobrar (regla del cliente). No duplica si ya existe.
insert into public.encargados (name, cobrar)
select 'CHELI', false
where not exists (select 1 from public.encargados where lower(trim(name)) = 'cheli');


-- ── 2) hose_services: empresa a cobrar + encargado + margen ─────────────────
-- company_id / encargado_id: ON DELETE SET NULL para que borrar una empresa o un
-- encargado NO borre la manguera (la cuenta por cobrar ya bloquea con RESTRICT el
-- borrado de una empresa con deudas vivas). sale_margin_pct default 30 %.
alter table public.hose_services
  add column if not exists company_id      uuid references public.companies(id)  on delete set null,
  add column if not exists encargado_id    uuid references public.encargados(id) on delete set null,
  add column if not exists sale_margin_pct numeric(6,2) not null default 30;
create index if not exists idx_hose_services_company   on public.hose_services(company_id);
create index if not exists idx_hose_services_encargado on public.hose_services(encargado_id);


-- ── 2b) RECONCILIACIÓN: `cuentas.contraparte` suelta en producción ──────────
-- En algún momento se agregó a mano en producción una columna `contraparte`
-- NOT NULL a `cuentas`. NI la app NI los triggers la llenan (el nombre de la
-- contraparte se resuelve SIEMPRE por JOIN contra suppliers/companies). Con
-- NOT NULL, toda inserción a `cuentas` falla ("null value in column contraparte").
-- Se deja NULL-able. Guardado en un DO para que sea inocuo donde la columna no exista.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='cuentas' and column_name='contraparte') then
    execute 'alter table public.cuentas alter column contraparte drop not null';
  end if;
end $$;


-- ── 3) cuentas: permitir por_pagar Y por_cobrar de la MISMA manguera ────────
-- El índice único original era por (hose_service_id) → una sola cuenta por
-- manguera. Ahora se necesita una por_pagar (proveedor) y una por_cobrar
-- (empresa). Se cambia a único por (hose_service_id, tipo).
drop index if exists public.cuentas_hose_service_uniq;
create unique index if not exists cuentas_hose_service_tipo_uniq
  on public.cuentas(hose_service_id, tipo) where hose_service_id is not null;

-- El trigger POR PAGAR existente hacía `on conflict (hose_service_id)`. Con el
-- índice nuevo ese target ya no existe → se re-crea la función con el conflict
-- target (hose_service_id, tipo). El CUERPO es idéntico al de
-- fabricacion_mangueras_cuenta_por_pagar.sql; SOLO cambia el ON CONFLICT.
create or replace function public.hose_sync_cuenta()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_concepto text;
begin
  if new.supplier_id is null or coalesce(new.cost_usd, 0) <= 0 then
    return new;
  end if;

  v_concepto := 'Fabricación de manguera ' || coalesce(new.code, '') ||
                case when coalesce(new.description, '') <> '' then ' · ' || new.description else '' end;

  insert into public.cuentas (
    tipo, supplier_id, company_id, concepto, documento, monto, moneda,
    fecha_emision, estado, nota, created_by, hose_service_id, settled_by, settled_at
  ) values (
    'por_pagar', new.supplier_id, null, v_concepto, new.code, new.cost_usd, 'USD',
    new.service_date,
    case when new.payment_status = 'pagado' then 'pagada' else 'pendiente' end,
    'Generada automáticamente desde Fabricación (manguera ' || coalesce(new.code, '') ||
      '). El monto se sincroniza con la manguera.',
    new.created_by, new.id,
    case when new.payment_status = 'pagado' then new.approved_by else null end,
    case when new.payment_status = 'pagado' then new.approved_at  else null end
  )
  on conflict (hose_service_id, tipo) where hose_service_id is not null
  do update set
    supplier_id   = excluded.supplier_id,
    concepto      = excluded.concepto,
    documento     = excluded.documento,
    monto         = excluded.monto,
    fecha_emision = excluded.fecha_emision,
    estado = case
               when new.payment_status = 'pagado' then 'pagada'
               when cuentas.estado = 'anulada'    then 'anulada'
               else cuentas.estado
             end,
    settled_by = case when new.payment_status = 'pagado' then new.approved_by else cuentas.settled_by end,
    settled_at = case when new.payment_status = 'pagado' then new.approved_at  else cuentas.settled_at end,
    updated_at = now();

  return new;
end $$;


-- ── 4) AFTER: crear / sincronizar / anular la CUENTA POR COBRAR ─────────────
-- Una cuenta 'por_cobrar' por manguera, a la EMPRESA (company_id), por
-- cost_usd × (1 + margen/100). NO se genera si:
--   · falta empresa o encargado (no hay a quién cobrarle), o
--   · el encargado tiene cobrar=false (CHELI), o
--   · el costo es 0.
-- Si una manguera que ANTES generaba cuenta pasa a CHELI / se le quita empresa,
-- la cuenta por_cobrar existente se ANULA (no se borra: rastro).
-- SECURITY DEFINER: el reflejo contable se hace aunque el usuario no tenga
-- permiso del módulo 'cuentas'.
create or replace function public.hose_sync_cuenta_cobrar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cobrar   boolean;
  v_monto    numeric(14,2);
  v_concepto text;
begin
  -- ¿El encargado cobra? (null si no hay encargado)
  select e.cobrar into v_cobrar from public.encargados e where e.id = new.encargado_id;

  -- Sin empresa, sin encargado, encargado que NO cobra, o costo 0 → no hay cuenta
  -- por cobrar. Si existía una, se ANULA.
  if new.company_id is null
     or new.encargado_id is null
     or coalesce(v_cobrar, false) = false
     or coalesce(new.cost_usd, 0) <= 0 then
    update public.cuentas
       set estado = 'anulada', updated_at = now()
     where hose_service_id = new.id and tipo = 'por_cobrar' and estado <> 'anulada';
    return new;
  end if;

  v_monto := round(new.cost_usd * (1 + coalesce(new.sale_margin_pct, 0) / 100.0), 2);

  v_concepto := 'Cobro de manguera ' || coalesce(new.code, '') ||
                case when coalesce(new.description, '') <> '' then ' · ' || new.description else '' end ||
                ' (costo ' || to_char(new.cost_usd, 'FM999999990.00') ||
                ' + ' || to_char(coalesce(new.sale_margin_pct, 0), 'FM990.00') || '% margen)';

  insert into public.cuentas (
    tipo, supplier_id, company_id, concepto, documento, monto, moneda,
    fecha_emision, estado, nota, created_by, hose_service_id
  ) values (
    'por_cobrar', null, new.company_id, v_concepto, new.code, v_monto, 'USD',
    new.service_date, 'pendiente',
    'Generada automáticamente desde Fabricación (manguera ' || coalesce(new.code, '') ||
      '). El monto = costo + margen y se sincroniza con la manguera.',
    new.created_by, new.id
  )
  on conflict (hose_service_id, tipo) where hose_service_id is not null
  do update set
    company_id    = excluded.company_id,
    concepto      = excluded.concepto,
    documento     = excluded.documento,
    monto         = excluded.monto,
    fecha_emision = excluded.fecha_emision,
    -- Reabre si estaba anulada (volvió a ser cobrable); conserva 'pagada'.
    estado = case when cuentas.estado = 'pagada' then 'pagada' else 'pendiente' end,
    updated_at = now();

  return new;
end $$;

drop trigger if exists trg_hose_sync_cuenta_cobrar on public.hose_services;
create trigger trg_hose_sync_cuenta_cobrar
  after insert or update on public.hose_services
  for each row execute function public.hose_sync_cuenta_cobrar();


-- ── 5) VERIFICACIÓN (correr después) ────────────────────────────────────────
-- 5.1 · Columnas nuevas.
select 'hose_services.company_id'      as col, exists (select 1 from information_schema.columns where table_schema='public' and table_name='hose_services' and column_name='company_id') as ok
union all select 'hose_services.encargado_id',    exists (select 1 from information_schema.columns where table_schema='public' and table_name='hose_services' and column_name='encargado_id')
union all select 'hose_services.sale_margin_pct', exists (select 1 from information_schema.columns where table_schema='public' and table_name='hose_services' and column_name='sale_margin_pct')
union all select 'encargados (tabla)',            exists (select 1 from information_schema.tables  where table_schema='public' and table_name='encargados');

-- 5.2 · CHELI sembrado con cobrar=false (debe devolver 1 fila, cobrar=false).
select name, cobrar from public.encargados where lower(trim(name)) = 'cheli';

-- 5.3 · Los dos triggers de cuenta existen en hose_services.
select tgname from pg_trigger
where tgrelid = 'public.hose_services'::regclass and not tgisinternal
order by tgname;

-- 5.4 · Índice único compuesto (hose_service_id, tipo) presente y el viejo NO.
select indexname from pg_indexes
where schemaname='public' and tablename='cuentas' and indexname like 'cuentas_hose_service%'
order by indexname;

-- 5.5 · Cuentas por cobrar generadas desde mangueras (tras registrar alguna).
select c.documento as manguera, e.name as empresa, c.monto, c.estado, c.created_at
from public.cuentas c
join public.companies e on e.id = c.company_id
where c.hose_service_id is not null and c.tipo = 'por_cobrar'
order by c.created_at desc;
