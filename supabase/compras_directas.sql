-- ============================================================================
-- COMPRAS DIRECTAS (reemplaza el submódulo "Solicitudes de pedido")
--
-- Pedido del cliente (23-ago-2026): "que Solicitudes se llame COMPRAS DIRECTAS.
-- Nueva compra directa, con su código incremental, cargan el producto, el precio
-- Y LA FACTURA, y al crearlas pasan DIRECTO al inventario. Al verlas se podrá ver
-- la factura cargada."
--
-- ACTUALIZADO 26-ago-2026: las compras directas YA NO generan cuenta por pagar
-- (ver compras_directas_sin_cuenta.sql). Solo cargan la factura y pasan al inventario.
--
-- Flujo: se crea UNA compra directa (varios renglones con precio + proveedor +
-- factura adjunta). Al insertarla, la BASE (trigger, atómico):
--   1) carga cada renglón al INVENTARIO como ENTRADA (recalcula el PMP solo).
-- El código correlativo (CD-####) también lo asigna la base.
--
-- Patrón calcado de requerimientos_correlativo.sql + requerimiento_a_compras.sql
-- + el recibo de órdenes de ComprasScreen. Idempotente: seguro de correr más de
-- una vez. Requiere inventory_items, inventory_movements, cuentas, suppliers,
-- companies. Correr en Supabase → SQL Editor.
-- ============================================================================


-- ── 1) Tabla ────────────────────────────────────────────────────────────────
create table if not exists public.direct_purchases (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,                         -- CD-#### (trigger)
  company_id   uuid references public.companies(id),
  supplier_id  uuid references public.suppliers(id) on delete set null,  -- a quién se le paga
  category     text,
  items        jsonb not null default '[]'::jsonb,    -- [{description, qty, unit, price, item_id?}]
  total        numeric(14,2) not null default 0,
  factura_url  text,                                  -- factura adjunta (bucket 'machinery', carpeta compras-directas/<id>/)
  factura_type text,                                  -- 'image' | 'pdf'
  factura_name text,                                  -- nombre original del archivo
  note         text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index if not exists direct_purchases_code_key on public.direct_purchases(code);
create index if not exists idx_direct_purchases_company  on public.direct_purchases(company_id);
create index if not exists idx_direct_purchases_supplier on public.direct_purchases(supplier_id);
create index if not exists idx_direct_purchases_created  on public.direct_purchases(created_at);


-- ── 2) Enlace de ORIGEN en inventario ───────────────────────────────────────
alter table public.inventory_movements
  add column if not exists direct_purchase_id uuid references public.direct_purchases(id) on delete set null;
create index if not exists idx_inv_mov_direct on public.inventory_movements(direct_purchase_id);
-- (Ya no se enlaza a `cuentas`: las compras directas no generan cuenta por pagar.)


-- ── 3) Correlativo CD-#### (BEFORE INSERT) ──────────────────────────────────
create or replace function public.assign_direct_purchase_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare nextn int;
begin
  -- Serializa inserciones concurrentes para que no calculen el mismo máximo.
  perform pg_advisory_xact_lock(hashtext('direct_purchases_code'));
  select coalesce(max((regexp_replace(code, '\D', '', 'g'))::int), 0) + 1
    into nextn
    from public.direct_purchases
    where code ~ '^CD-\d+$';
  if new.code is null or new.code = '' then
    new.code := 'CD-' || lpad(nextn::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_direct_purchase_code on public.direct_purchases;
create trigger trg_assign_direct_purchase_code
  before insert on public.direct_purchases
  for each row execute function public.assign_direct_purchase_code();


-- ── 4) AFTER INSERT: cargar INVENTARIO ──────────────────────────────────────
-- SECURITY DEFINER: el reflejo (stock) se genera aunque el usuario no tenga
-- permiso directo de 'inventario'. SOLO en INSERT: una compra directa es un hecho
-- consumado (ya entró al inventario), no se reprocesa en UPDATE — así no se
-- duplican entradas ni recursiona el trigger. (No genera cuenta por pagar.)
create or replace function public.direct_purchase_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  e        jsonb;
  v_item   uuid;
  v_name   text;
  v_qty    numeric;
  v_price  numeric;
  v_unit   text;
begin
  for e in select * from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) loop
    v_name  := upper(trim(coalesce(e->>'description', '')));
    v_qty   := coalesce(nullif(e->>'qty', '')::numeric, 0);
    v_price := coalesce(nullif(e->>'price', '')::numeric, 0);
    v_unit  := nullif(e->>'unit', '');
    if v_name = '' or v_qty <= 0 then continue; end if;

    -- Resolver el producto: item_id del renglón → por nombre → crear uno nuevo.
    v_item := nullif(e->>'item_id', '')::uuid;
    if v_item is null then
      select id into v_item from public.inventory_items
       where lower(name) = lower(v_name) limit 1;
    end if;
    if v_item is null then
      insert into public.inventory_items (name, category, unit, company_id)
      values (v_name, new.category, v_unit, new.company_id)
      returning id into v_item;
    end if;

    -- ENTRADA al inventario (el PMP se recalcula solo con su propio trigger).
    insert into public.inventory_movements
      (item_id, kind, qty, unit_cost, direct_purchase_id, company_id, reason, created_by)
    values
      (v_item, 'entrada', v_qty, v_price, new.id, new.company_id,
       'COMPRA DIRECTA ' || coalesce(new.code, ''), new.created_by);
  end loop;

  -- (Sin cuenta por pagar: una compra directa solo entra al inventario.)
  return new;
end $$;

drop trigger if exists trg_direct_purchase_apply on public.direct_purchases;
create trigger trg_direct_purchase_apply
  after insert on public.direct_purchases
  for each row execute function public.direct_purchase_apply();


-- ── 5) RLS ──────────────────────────────────────────────────────────────────
-- Igual criterio que compras/inventario: lectura abierta a autenticados; la
-- escritura la controla el permiso de módulo 'compras' en la app. El insert lo
-- puede hacer quien administre compras; el trigger (definer) hace el resto.
alter table public.direct_purchases enable row level security;
drop policy if exists direct_purchases_select on public.direct_purchases;
create policy direct_purchases_select on public.direct_purchases
  for select to authenticated using (true);
drop policy if exists direct_purchases_write on public.direct_purchases;
create policy direct_purchases_write on public.direct_purchases
  for all to authenticated
  using (public.can_write_module('compras'))
  with check (public.can_write_module('compras'));


-- ── 6) Realtime ─────────────────────────────────────────────────────────────
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.direct_purchases';
  exception when duplicate_object then null; when others then null;
  end;
end $$;


-- ── 7) VERIFICACIÓN (correr después) ────────────────────────────────────────
-- 7.1 · Tabla y columnas de enlace.
select 'direct_purchases' as obj,
       exists (select 1 from information_schema.tables
               where table_schema='public' and table_name='direct_purchases') as ok
union all
select 'inventory_movements.direct_purchase_id',
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='inventory_movements' and column_name='direct_purchase_id');

-- 7.2 · Triggers creados (deben aparecer los dos).
select tgname from pg_trigger
where tgrelid = 'public.direct_purchases'::regclass and not tgisinternal
order by tgname;

-- 7.3 · Compras directas con su stock generado (tras crear alguna).
select d.code, s.name as proveedor, d.total,
       (select count(*) from public.inventory_movements m where m.direct_purchase_id = d.id) as entradas
from public.direct_purchases d
left join public.suppliers s on s.id = d.supplier_id
order by d.created_at desc;
