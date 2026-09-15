-- ============================================================================
-- SERVICIOS (submódulo de Compras) — 2026-09-15
--
-- Igual espíritu que las COMPRAS DIRECTAS, pero para SERVICIOS: recarga de
-- bombonas, mantenimiento de aires, cambio de aceite, etc. Cada servicio lleva
-- categoría (reusable), tipo (reusable), equipo opcional (del catálogo), cantidad
-- y precio; y OPCIONALMENTE consume un repuesto del inventario (se descuenta del
-- stock). Si es un mantenimiento que NO usa material (ej. limpieza de A/C) no toca
-- el inventario.
--
-- Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================================

-- ── 1) Catálogos reusables (categoría y tipo de servicio) ───────────────────
-- Se llenan solos: la primera vez el usuario escribe el nombre y queda guardado
-- para elegirlo de la lista la próxima vez.
create table if not exists public.service_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists service_categories_name_key on public.service_categories(lower(name));

create table if not exists public.service_kinds (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists service_kinds_name_key on public.service_kinds(lower(name));

-- Semilla con las opciones típicas (no pisa lo que ya exista).
insert into public.service_categories (name) values
  ('ALIMENTACION'), ('CARNETS DE IDENTIFICACION'), ('INSTALACIONES ELECTRICAS'),
  ('MANTENIMIENTO DE ELECTRODOMESTICOS'), ('MANTENIMIENTO DE MAQUINARIA'),
  ('MANTENIMIENTO DE MOTOS'), ('MANTENIMIENTO DE VEHICULOS'),
  ('MANTENIMIENTO DE AIRE ACONDICIONADO'), ('RECARGA DE AGUA'), ('RECARGA DE BOMBONAS')
on conflict (lower(name)) do nothing;
insert into public.service_kinds (name) values
  ('RECARGA'), ('CAMBIO DE ACEITE'), ('MANTENIMIENTO DE LIMPIEZA'), ('CAMBIO DE PIEZA'),
  ('CAUCHO'), ('ACEITE'), ('PINTURA'), ('SOLDADURA'), ('REPARACION')
on conflict (lower(name)) do nothing;

-- ── 2) Tabla de servicios (encabezado + renglones JSONB) ────────────────────
-- items: [{categoria, tipo, machinery_id, machine_label, qty, price,
--          usa_inventario, item_id, item_name, detalle}]
create table if not exists public.servicios (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,                        -- SRV-#### (trigger)
  company_id   uuid references public.companies(id),
  supplier_id  uuid references public.suppliers(id) on delete set null, -- quién prestó el servicio
  service_date date not null default current_date,
  items        jsonb not null default '[]'::jsonb,
  total        numeric(14,2) not null default 0,
  factura_url  text,
  factura_type text,                                 -- 'image' | 'pdf'
  factura_name text,
  note         text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);
create unique index if not exists servicios_code_key on public.servicios(code);
create index if not exists idx_servicios_company on public.servicios(company_id);
create index if not exists idx_servicios_date    on public.servicios(service_date);

-- ── 3) Enlace de ORIGEN en inventario (para descontar repuestos) ────────────
-- ON DELETE CASCADE: al borrar un servicio se borran sus salidas → el stock se
-- restituye solo (el nivel = entradas − salidas).
alter table public.inventory_movements
  add column if not exists servicio_id uuid references public.servicios(id) on delete cascade;
create index if not exists idx_inv_mov_servicio on public.inventory_movements(servicio_id);

-- ── 4) Correlativo SRV-#### (BEFORE INSERT) ─────────────────────────────────
create or replace function public.assign_servicio_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare nextn int;
begin
  perform pg_advisory_xact_lock(hashtext('servicios_code'));
  select coalesce(max((regexp_replace(code, '\D', '', 'g'))::int), 0) + 1
    into nextn from public.servicios where code ~ '^SRV-\d+$';
  if new.code is null or new.code = '' then
    new.code := 'SRV-' || lpad(nextn::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_assign_servicio_code on public.servicios;
create trigger trg_assign_servicio_code
  before insert on public.servicios
  for each row execute function public.assign_servicio_code();

-- ── 5) Inventario: descuenta el repuesto de cada renglón que lo use ──────────
-- Recorre items; por cada renglón con usa_inventario y un repuesto resoluble
-- (item_id, o item_name existente) inserta una SALIDA por su cantidad.
create or replace function public.servicio_apply_inv()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  e       jsonb;
  v_item  uuid;
  v_name  text;
  v_qty   numeric;
begin
  for e in select * from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) loop
    if coalesce((e->>'usa_inventario')::boolean, false) is not true then continue; end if;
    v_qty := coalesce(nullif(e->>'qty', '')::numeric, 0);
    if v_qty <= 0 then continue; end if;
    v_item := nullif(e->>'item_id', '')::uuid;
    if v_item is null then
      v_name := upper(trim(coalesce(e->>'item_name', '')));
      if v_name = '' then continue; end if;
      select id into v_item from public.inventory_items where lower(name) = lower(v_name) limit 1;
    end if;
    if v_item is null then continue; end if;  -- repuesto no encontrado: no inventa
    insert into public.inventory_movements
      (item_id, kind, qty, unit_cost, servicio_id, company_id, reason, created_by)
    values
      (v_item, 'salida', v_qty, 0, new.id, new.company_id,
       'SERVICIO ' || coalesce(new.code, ''), new.created_by);
  end loop;
  return new;
end $$;

create or replace function public.servicio_reapply_inv()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.items is distinct from old.items) or (new.company_id is distinct from old.company_id) then
    delete from public.inventory_movements where servicio_id = new.id;
    -- Reutiliza el mismo camino del INSERT.
    perform public.servicio_apply_inv_row(new);
  end if;
  return new;
end $$;

-- Helper para reusar el apply desde el reapply (misma lógica, otra fila).
create or replace function public.servicio_apply_inv_row(new public.servicios)
returns void language plpgsql security definer set search_path = public as $$
declare
  e       jsonb;
  v_item  uuid;
  v_name  text;
  v_qty   numeric;
begin
  for e in select * from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) loop
    if coalesce((e->>'usa_inventario')::boolean, false) is not true then continue; end if;
    v_qty := coalesce(nullif(e->>'qty', '')::numeric, 0);
    if v_qty <= 0 then continue; end if;
    v_item := nullif(e->>'item_id', '')::uuid;
    if v_item is null then
      v_name := upper(trim(coalesce(e->>'item_name', '')));
      if v_name = '' then continue; end if;
      select id into v_item from public.inventory_items where lower(name) = lower(v_name) limit 1;
    end if;
    if v_item is null then continue; end if;
    insert into public.inventory_movements
      (item_id, kind, qty, unit_cost, servicio_id, company_id, reason, created_by)
    values
      (v_item, 'salida', v_qty, 0, new.id, new.company_id,
       'SERVICIO ' || coalesce(new.code, '') || ' (editado)', new.created_by);
  end loop;
end $$;

drop trigger if exists trg_servicio_apply_inv on public.servicios;
create trigger trg_servicio_apply_inv
  after insert on public.servicios
  for each row execute function public.servicio_apply_inv();

drop trigger if exists trg_servicio_reapply_inv on public.servicios;
create trigger trg_servicio_reapply_inv
  after update on public.servicios
  for each row execute function public.servicio_reapply_inv();

-- ── 6) RLS ──────────────────────────────────────────────────────────────────
alter table public.servicios enable row level security;
drop policy if exists servicios_select on public.servicios;
create policy servicios_select on public.servicios for select to authenticated using (true);
drop policy if exists servicios_write on public.servicios;
create policy servicios_write on public.servicios for all to authenticated
  using (public.can_write_module('compras')) with check (public.can_write_module('compras'));

alter table public.service_categories enable row level security;
drop policy if exists service_categories_select on public.service_categories;
create policy service_categories_select on public.service_categories for select to authenticated using (true);
drop policy if exists service_categories_write on public.service_categories;
create policy service_categories_write on public.service_categories for all to authenticated
  using (not public.is_anon()) with check (not public.is_anon());

alter table public.service_kinds enable row level security;
drop policy if exists service_kinds_select on public.service_kinds;
create policy service_kinds_select on public.service_kinds for select to authenticated using (true);
drop policy if exists service_kinds_write on public.service_kinds;
create policy service_kinds_write on public.service_kinds for all to authenticated
  using (not public.is_anon()) with check (not public.is_anon());

-- ── 7) Realtime ─────────────────────────────────────────────────────────────
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.servicios';
  exception when duplicate_object then null; when others then null; end;
end $$;

-- ── 8) VERIFICACIÓN (correr después) ────────────────────────────────────────
select 'servicios' as obj, exists (select 1 from information_schema.tables
        where table_schema='public' and table_name='servicios') as ok
union all
select 'inventory_movements.servicio_id', exists (select 1 from information_schema.columns
        where table_schema='public' and table_name='inventory_movements' and column_name='servicio_id');
