-- ============================================================================
-- MÓDULO DE VENTAS (2026-09-22)
--
-- Se vende MATERIAL (sale del inventario, con su precio referencial editable) y
-- SERVICIOS (catálogo que se va llenando solo). Cada venta se documenta como
-- FACTURA o NOTA DE ENTREGA (las dos llevan precio; lo elige el usuario con un
-- check) y puede ser de CONTADO (con su método de pago) o a CRÉDITO (genera una
-- cuenta por cobrar en el módulo de Cuentas que ya existe).
--
-- Los montos se guardan en $; se guarda además la TASA BCV del momento y el
-- equivalente en Bs, para que el papel impreso no cambie si mañana cambia la tasa.
--
-- Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================================

-- ── 1) CATÁLOGO DE CLIENTES (amarrado a CÉDULA o RIF, sin duplicados) ────────
-- El documento se guarda partido: la LETRA (V/E/J/G/P) y los DÍGITOS. Así
-- "V-12.345.678", "V12345678" y "v 12345678" son LA MISMA persona y la base lo
-- impide por índice único, no por buena voluntad de quien carga.
create table if not exists public.sales_clients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  doc_letter   text not null check (doc_letter in ('V','E','J','G','P')),
  doc_number   text not null,
  phone        text,
  email        text,
  address      text,
  es_proveedor boolean not null default false,  -- además de cliente, se le compra
  note         text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null
);
-- Una CÉDULA no entra dos veces; un RIF tampoco (se compara solo por los dígitos).
create unique index if not exists sales_clients_doc_key
  on public.sales_clients (doc_letter, (regexp_replace(doc_number, '[^0-9]', '', 'g')));
create index if not exists sales_clients_name_idx on public.sales_clients (lower(name));

-- ── 2) CATÁLOGO DE SERVICIOS QUE SE VENDEN ───────────────────────────────────
-- La primera vez el usuario escribe el tipo de servicio y queda guardado; luego
-- se elige de una lista buscable.
create table if not exists public.sales_services (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  price       numeric(14,2) not null default 0,   -- precio referencial (editable en la venta)
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists sales_services_name_key on public.sales_services (lower(name));

-- ── 3) VENTAS ────────────────────────────────────────────────────────────────
-- items: [{kind:'material'|'servicio', item_id, service_id, name, unit, qty,
--          price, total}]
create table if not exists public.sales (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,                       -- VTA-#### (trigger)
  doc_kind       text not null default 'nota_entrega'
                 check (doc_kind in ('factura','nota_entrega')),
  doc_number     text,                                -- FAC-#### / NE-#### (trigger)
  client_id      uuid references public.sales_clients(id) on delete restrict,
  client_name    text not null,
  client_doc     text,                                -- "V-12345678" como quedó impreso
  sale_date      date not null default current_date,
  items          jsonb not null default '[]'::jsonb,
  subtotal       numeric(14,2) not null default 0,
  con_iva        boolean not null default false,      -- el IVA es OPCIONAL por venta
  iva_pct        numeric(6,2) not null default 0,
  iva_monto      numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,    -- en $
  condicion      text not null default 'contado' check (condicion in ('contado','credito')),
  payment_method text check (payment_method in ('bs','transferencia','pago_movil','zelle','usdt','efectivo_usd')),
  rate_bs        numeric(14,4) not null default 0,    -- tasa BCV usada al vender
  total_bs       numeric(16,2) not null default 0,    -- equivalente en Bs congelado
  cuenta_id      uuid references public.cuentas(id) on delete set null, -- si fue a crédito
  note           text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);
create unique index if not exists sales_code_key on public.sales (code);
create index if not exists sales_client_idx on public.sales (client_id);
create index if not exists sales_date_idx   on public.sales (sale_date);

-- A crédito SIEMPRE hay que decir a quién se le cobra; de contado, cómo pagó.
alter table public.sales drop constraint if exists sales_condicion_coherente;
alter table public.sales add constraint sales_condicion_coherente check (
  (condicion = 'credito' and client_id is not null)
  or
  (condicion = 'contado' and payment_method is not null)
);

-- ── 4) CORRELATIVOS: VTA-#### y el número del papel (FAC-#### / NE-####) ─────
create or replace function public.assign_sale_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int; pfx text;
begin
  perform pg_advisory_xact_lock(hashtext('sales_code'));
  if new.code is null or new.code = '' then
    select coalesce(max((regexp_replace(code, '[^0-9]', '', 'g'))::int), 0) + 1
      into n from public.sales where code ~ '^VTA-[0-9]+$';
    new.code := 'VTA-' || lpad(n::text, 4, '0');
  end if;
  if new.doc_number is null or new.doc_number = '' then
    pfx := case when new.doc_kind = 'factura' then 'FAC' else 'NE' end;
    select coalesce(max((regexp_replace(doc_number, '[^0-9]', '', 'g'))::int), 0) + 1
      into n from public.sales
      where doc_kind = new.doc_kind and doc_number ~ ('^' || pfx || '-[0-9]+$');
    new.doc_number := pfx || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_assign_sale_code on public.sales;
create trigger trg_assign_sale_code
  before insert on public.sales
  for each row execute function public.assign_sale_code();

-- ── 5) INVENTARIO: el MATERIAL vendido SALE del almacén ──────────────────────
alter table public.inventory_movements
  add column if not exists sale_id uuid references public.sales(id) on delete cascade;
create index if not exists idx_inv_mov_sale on public.inventory_movements(sale_id);

-- Recorre los renglones y descuenta una SALIDA por cada material con item_id.
create or replace function public.sale_apply_inv_row(s public.sales)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_item uuid; v_qty numeric;
begin
  for e in select * from jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) loop
    if coalesce(e->>'kind', '') <> 'material' then continue; end if;
    v_item := nullif(e->>'item_id', '')::uuid;
    if v_item is null then continue; end if;             -- servicio o texto libre: no toca stock
    v_qty := coalesce(nullif(e->>'qty', '')::numeric, 0);
    if v_qty <= 0 then continue; end if;
    insert into public.inventory_movements
      (item_id, kind, qty, unit_cost, sale_id, reason, created_by)
    values
      (v_item, 'salida', v_qty, coalesce(nullif(e->>'price','')::numeric, 0), s.id,
       'VENTA ' || coalesce(s.code, '') || ' · ' || coalesce(s.client_name, ''), s.created_by);
  end loop;
end $$;

create or replace function public.sale_apply_inv()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sale_apply_inv_row(new);
  return new;
end $$;

-- Al EDITAR una venta se rehace la salida (se borra y se vuelve a aplicar), igual
-- que hacen las compras directas: así el stock nunca queda a medias.
create or replace function public.sale_reapply_inv()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.items is distinct from old.items then
    delete from public.inventory_movements where sale_id = new.id;
    perform public.sale_apply_inv_row(new);
  end if;
  return new;
end $$;

drop trigger if exists trg_sale_apply_inv on public.sales;
create trigger trg_sale_apply_inv
  after insert on public.sales
  for each row execute function public.sale_apply_inv();

drop trigger if exists trg_sale_reapply_inv on public.sales;
create trigger trg_sale_reapply_inv
  after update on public.sales
  for each row execute function public.sale_reapply_inv();

-- ── 6) CUENTAS POR COBRAR: que puedan apuntar a un CLIENTE de Ventas ─────────
-- Hasta ahora una cuenta por cobrar solo podía ser de una EMPRESA del catálogo.
-- Las ventas a crédito son a un CLIENTE (cédula/RIF), así que se agrega esa
-- contraparte y se relaja el check para admitir empresa O cliente (nunca ambos).
alter table public.cuentas
  add column if not exists client_id uuid references public.sales_clients(id) on delete restrict,
  add column if not exists sale_id   uuid references public.sales(id) on delete set null;
create index if not exists cuentas_client_idx on public.cuentas (client_id);

alter table public.cuentas drop constraint if exists cuentas_contraparte_segun_tipo;
alter table public.cuentas add constraint cuentas_contraparte_segun_tipo check (
  (tipo = 'por_pagar'
     and supplier_id is not null and company_id is null and client_id is null)
  or
  (tipo = 'por_cobrar' and supplier_id is null
     and ( (company_id is not null and client_id is null)
        or (client_id  is not null and company_id is null) ))
);

-- ── 6b) La venta a CRÉDITO genera su cuenta por cobrar, sola ─────────────────
-- Va por TRIGGER (security definer) y no desde la app a propósito: escribir en
-- `cuentas` exige permiso del módulo Cuentas, y quien vende no tiene por qué
-- tenerlo. Si se hiciera desde la pantalla, la venta quedaría grabada y la deuda
-- NO — que es la peor de las dos mitades.
create or replace function public.sale_apply_cuenta()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  if new.condicion = 'credito' then
    insert into public.cuentas
      (tipo, client_id, concepto, documento, monto, moneda, fecha_emision, estado, sale_id, created_by)
    values
      ('por_cobrar', new.client_id,
       'Venta ' || coalesce(new.code, '') || ' · ' || coalesce(new.client_name, ''),
       new.doc_number, new.total, 'USD', new.sale_date, 'pendiente', new.id, new.created_by)
    returning id into v_cuenta;
    update public.sales set cuenta_id = v_cuenta where id = new.id;
  end if;
  return new;
end $$;

-- Al EDITAR: si sigue a crédito se ajusta el monto; si pasó a contado, la deuda
-- se ANULA (no se borra: se conserva la fila por auditoría, como manda Cuentas).
create or replace function public.sale_reapply_cuenta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cuenta_id is not null then
    if new.condicion = 'credito' then
      update public.cuentas
         set monto = new.total,
             documento = new.doc_number,
             concepto = 'Venta ' || coalesce(new.code, '') || ' · ' || coalesce(new.client_name, ''),
             updated_at = now()
       where id = new.cuenta_id and estado <> 'anulada';
    else
      update public.cuentas set estado = 'anulada', updated_at = now() where id = new.cuenta_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_sale_apply_cuenta on public.sales;
create trigger trg_sale_apply_cuenta
  after insert on public.sales
  for each row execute function public.sale_apply_cuenta();

drop trigger if exists trg_sale_reapply_cuenta on public.sales;
create trigger trg_sale_reapply_cuenta
  after update on public.sales
  for each row execute function public.sale_reapply_cuenta();

-- ── 7) RLS ───────────────────────────────────────────────────────────────────
alter table public.sales_clients enable row level security;
drop policy if exists sales_clients_select on public.sales_clients;
create policy sales_clients_select on public.sales_clients for select to authenticated using (true);
drop policy if exists sales_clients_write on public.sales_clients;
create policy sales_clients_write on public.sales_clients for all to authenticated
  using (public.can_write_module('ventas')) with check (public.can_write_module('ventas'));

alter table public.sales_services enable row level security;
drop policy if exists sales_services_select on public.sales_services;
create policy sales_services_select on public.sales_services for select to authenticated using (true);
drop policy if exists sales_services_write on public.sales_services;
create policy sales_services_write on public.sales_services for all to authenticated
  using (public.can_write_module('ventas')) with check (public.can_write_module('ventas'));

alter table public.sales enable row level security;
drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales for select to authenticated using (true);
drop policy if exists sales_write on public.sales;
create policy sales_write on public.sales for all to authenticated
  using (public.can_write_module('ventas')) with check (public.can_write_module('ventas'));

-- ── 8) Realtime ──────────────────────────────────────────────────────────────
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.sales';
  exception when duplicate_object then null; when others then null; end;
end $$;

-- ── 9) VERIFICACIÓN (debe dar todo true / 3) ─────────────────────────────────
select
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name in ('sales','sales_clients','sales_services')) as tablas,      -- 3
  (select exists (select 1 from information_schema.columns
     where table_schema='public' and table_name='inventory_movements' and column_name='sale_id')) as inv_ok,   -- true
  (select exists (select 1 from information_schema.columns
     where table_schema='public' and table_name='cuentas' and column_name='client_id')) as cuentas_ok;         -- true
