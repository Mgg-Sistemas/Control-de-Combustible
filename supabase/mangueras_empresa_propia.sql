-- ============================================================================
-- MANGUERAS: EMPRESA A COBRAR con LISTA PROPIA (no toca el catálogo `companies`).
--
-- Pedido del cliente (19-ago-2026): "Desde la creación de mangueras, permitir
-- agregar nuevas EMPRESAS sin que se registren en el catálogo — que queden solo
-- en el módulo de mangueras. El ENCARGADO igual: lista propia, agregar sin tocar
-- el catálogo." (El encargado ya usa la tabla `encargados`, separada del catálogo.)
--
-- Solución: tabla `hose_empresas` (empresas SOLO de mangueras). La cuenta POR
-- COBRAR guarda el NOMBRE de la empresa en `cuentas.contraparte` (company_id NULL),
-- y se relaja el CHECK de `cuentas` para permitir por_cobrar identificada por
-- nombre libre (no solo por company_id del catálogo). CuentasScreen muestra ese
-- nombre. Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================================

-- ── 1) CATÁLOGO PROPIO DE EMPRESAS DE MANGUERAS ─────────────────────────────
create table if not exists public.hose_empresas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  active     boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists hose_empresas_name_uniq
  on public.hose_empresas (lower(trim(name)));

alter table public.hose_empresas enable row level security;
drop policy if exists hose_empresas_select on public.hose_empresas;
create policy hose_empresas_select on public.hose_empresas for select to authenticated using (true);
drop policy if exists hose_empresas_write on public.hose_empresas;
create policy hose_empresas_write on public.hose_empresas for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.hose_empresas to authenticated;

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.hose_empresas'; exception when others then null; end;
end $$;


-- ── 2) hose_services apunta a la empresa PROPIA (no a companies) ────────────
alter table public.hose_services
  add column if not exists hose_empresa_id uuid references public.hose_empresas(id) on delete set null;
create index if not exists idx_hose_services_hose_empresa on public.hose_services(hose_empresa_id);


-- ── 3) cuentas: permitir POR COBRAR identificada por NOMBRE libre ───────────
-- Asegura la columna `contraparte` (nombre de la contraparte cuando no es del
-- catálogo) y relaja el CHECK: una por_cobrar vale si tiene company_id (catálogo)
-- O contraparte (nombre libre, caso mangueras). por_pagar sin cambios.
alter table public.cuentas add column if not exists contraparte text;

alter table public.cuentas drop constraint if exists cuentas_contraparte_segun_tipo;
alter table public.cuentas add constraint cuentas_contraparte_segun_tipo check (
  (tipo = 'por_pagar'  and supplier_id is not null and company_id is null)
  or
  (tipo = 'por_cobrar' and supplier_id is null and (company_id is not null or contraparte is not null))
);


-- ── 4) trigger POR COBRAR: usa hose_empresa_id (nombre en contraparte) ──────
-- Reemplaza la versión que usaba company_id. Ahora la empresa es de la lista
-- propia (hose_empresas): la cuenta guarda company_id=NULL y el NOMBRE en
-- `contraparte`. Sin empresa/encargado, encargado CHELI (cobrar=false) o costo 0
-- → no hay cuenta (se anula la existente). El monto = costo × (1 + margen/100).
create or replace function public.hose_sync_cuenta_cobrar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cobrar   boolean;
  v_empresa  text;
  v_monto    numeric(14,2);
  v_concepto text;
begin
  select e.cobrar into v_cobrar from public.encargados e where e.id = new.encargado_id;
  select he.name into v_empresa from public.hose_empresas he where he.id = new.hose_empresa_id;

  if new.hose_empresa_id is null
     or new.encargado_id is null
     or coalesce(v_cobrar, false) = false
     or coalesce(new.cost_usd, 0) <= 0
     or coalesce(trim(v_empresa), '') = '' then
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
    tipo, supplier_id, company_id, contraparte, concepto, documento, monto, moneda,
    fecha_emision, estado, nota, created_by, hose_service_id
  ) values (
    'por_cobrar', null, null, v_empresa, v_concepto, new.code, v_monto, 'USD',
    new.service_date, 'pendiente',
    'Generada automáticamente desde Fabricación (manguera ' || coalesce(new.code, '') ||
      '). Empresa de mangueras "' || v_empresa || '". Monto = costo + margen.',
    new.created_by, new.id
  )
  on conflict (hose_service_id, tipo) where hose_service_id is not null
  do update set
    company_id    = null,
    contraparte   = excluded.contraparte,
    concepto      = excluded.concepto,
    documento     = excluded.documento,
    monto         = excluded.monto,
    fecha_emision = excluded.fecha_emision,
    estado = case when cuentas.estado = 'pagada' then 'pagada' else 'pendiente' end,
    updated_at = now();

  return new;
end $$;


-- ── 5) VERIFICACIÓN ─────────────────────────────────────────────────────────
select 'hose_empresas (tabla)'          as chk, exists (select 1 from information_schema.tables  where table_schema='public' and table_name='hose_empresas') as ok
union all select 'hose_services.hose_empresa_id', exists (select 1 from information_schema.columns where table_schema='public' and table_name='hose_services' and column_name='hose_empresa_id')
union all select 'cuentas.contraparte',           exists (select 1 from information_schema.columns where table_schema='public' and table_name='cuentas' and column_name='contraparte');
