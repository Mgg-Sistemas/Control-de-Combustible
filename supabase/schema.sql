-- ============================================================================
-- Control de Combustible — Esquema de base de datos (Supabase / PostgreSQL)
-- ----------------------------------------------------------------------------
-- Ejecutar en: Supabase Studio > SQL Editor (o `supabase db push`).
-- Incluye: enums, tablas de dominio, ledger de movimientos de stock,
-- vista de niveles de tanque, triggers de stock y políticas RLS por rol.
-- ============================================================================

-- ---------- Extensiones ----------
create extension if not exists "uuid-ossp";

-- ============================================================================
-- ENUMS
-- ============================================================================
do $$ begin
  create type user_role as enum ('admin', 'supervisor', 'operador', 'conductor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type fuel_type as enum ('gasolina', 'diesel');
exception when duplicate_object then null; end $$;

do $$ begin
  create type authorization_status as enum ('pendiente', 'aprobado', 'rechazado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type asset_kind as enum ('vehiculo', 'maquinaria');
exception when duplicate_object then null; end $$;

do $$ begin
  create type movement_type as enum ('ingreso', 'consumo', 'traslado_salida', 'traslado_entrada', 'ajuste');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- PERFILES Y ROLES  (1:1 con auth.users)
-- ============================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        user_role not null default 'conductor',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Helper: rol del usuario autenticado
create or replace function public.current_role()
returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() in ('admin','supervisor','operador'), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() = 'admin', false)
$$;

-- Crear perfil automáticamente al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- TANQUES
-- ============================================================================
create table if not exists public.tanks (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  location    text,
  fuel        fuel_type not null,
  capacity_l  numeric(12,2) not null check (capacity_l > 0),
  is_mobile   boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- VEHÍCULOS
-- ============================================================================
create table if not exists public.vehicles (
  id            uuid primary key default uuid_generate_v4(),
  plate         text not null unique,
  brand         text,
  model         text,
  vehicle_type  text,
  tank_capacity_l numeric(10,2),
  expected_kml  numeric(10,2),         -- rendimiento esperado km/L
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ============================================================================
-- MAQUINARIA
-- ============================================================================
create table if not exists public.machinery (
  id            uuid primary key default uuid_generate_v4(),
  code          text not null unique,
  description   text,
  machinery_type text,
  expected_lph  numeric(10,2),         -- rendimiento esperado L/h
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ============================================================================
-- AUTORIZACIONES
-- ============================================================================
create table if not exists public.authorizations (
  id             uuid primary key default uuid_generate_v4(),
  requested_by   uuid references public.profiles(id),
  asset_kind     asset_kind not null,
  vehicle_id     uuid references public.vehicles(id),
  machinery_id   uuid references public.machinery(id),
  tank_id        uuid references public.tanks(id),
  liters         numeric(12,2) not null check (liters > 0),
  reason         text,
  status         authorization_status not null default 'pendiente',
  approved_by    uuid references public.profiles(id),
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  check ( (asset_kind = 'vehiculo' and vehicle_id is not null)
       or (asset_kind = 'maquinaria' and machinery_id is not null) )
);

-- ============================================================================
-- INGRESOS DE COMBUSTIBLE (recepción / compra)
-- ============================================================================
create table if not exists public.fuel_intakes (
  id            uuid primary key default uuid_generate_v4(),
  intake_date   date not null default current_date,
  supplier      text,
  fuel          fuel_type not null,
  liters        numeric(12,2) not null check (liters > 0),
  unit_cost     numeric(12,4),
  total_cost    numeric(14,2),
  tank_id       uuid not null references public.tanks(id),
  invoice_no    text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

-- ============================================================================
-- CONSUMOS / DESPACHOS
-- ============================================================================
create table if not exists public.dispatches (
  id               uuid primary key default uuid_generate_v4(),
  dispatch_date    date not null default current_date,
  asset_kind       asset_kind not null,
  vehicle_id       uuid references public.vehicles(id),
  machinery_id     uuid references public.machinery(id),
  liters           numeric(12,2) not null check (liters > 0),
  odometer_km      numeric(12,2),
  hourmeter_h      numeric(12,2),
  driver_operator  text,
  tank_id          uuid not null references public.tanks(id),
  authorization_id uuid references public.authorizations(id),
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  check ( (asset_kind = 'vehiculo' and vehicle_id is not null)
       or (asset_kind = 'maquinaria' and machinery_id is not null) )
);

-- ============================================================================
-- TRASLADOS DE COMBUSTIBLE (tanque origen -> tanque destino)
-- ============================================================================
create table if not exists public.transfers (
  id              uuid primary key default uuid_generate_v4(),
  transfer_date   date not null default current_date,
  from_tank_id    uuid not null references public.tanks(id),
  to_tank_id      uuid not null references public.tanks(id),
  liters          numeric(12,2) not null check (liters > 0),
  notes           text,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  check (from_tank_id <> to_tank_id)
);

-- ============================================================================
-- LEDGER DE MOVIMIENTOS DE STOCK  (fuente de verdad del nivel de tanque)
-- ============================================================================
create table if not exists public.stock_movements (
  id             uuid primary key default uuid_generate_v4(),
  tank_id        uuid not null references public.tanks(id),
  movement       movement_type not null,
  liters         numeric(12,2) not null,   -- +entra / -sale
  source_table   text not null,
  source_id      uuid not null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_stock_movements_tank on public.stock_movements(tank_id);

-- Nivel actual por tanque (derivado)
create or replace view public.tank_levels as
select
  t.id,
  t.name,
  t.fuel,
  t.capacity_l,
  coalesce(sum(m.liters), 0)::numeric(12,2)                    as current_l,
  round(coalesce(sum(m.liters),0) / nullif(t.capacity_l,0) * 100, 1) as pct
from public.tanks t
left join public.stock_movements m on m.tank_id = t.id
group by t.id;

-- ---------- Triggers que alimentan el ledger ----------
create or replace function public.mv_intake() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into stock_movements(tank_id, movement, liters, source_table, source_id)
  values (new.tank_id, 'ingreso', new.liters, 'fuel_intakes', new.id);
  return new;
end $$;
drop trigger if exists trg_mv_intake on public.fuel_intakes;
create trigger trg_mv_intake after insert on public.fuel_intakes
  for each row execute function public.mv_intake();

create or replace function public.mv_dispatch() returns trigger
language plpgsql security definer set search_path = public as $$
declare available numeric;
begin
  select current_l into available from tank_levels where id = new.tank_id;
  if coalesce(available,0) < new.liters then
    raise exception 'Stock insuficiente en el tanque (disponible %, solicitado %)', available, new.liters;
  end if;
  insert into stock_movements(tank_id, movement, liters, source_table, source_id)
  values (new.tank_id, 'consumo', -new.liters, 'dispatches', new.id);
  return new;
end $$;
drop trigger if exists trg_mv_dispatch on public.dispatches;
create trigger trg_mv_dispatch after insert on public.dispatches
  for each row execute function public.mv_dispatch();

create or replace function public.mv_transfer() returns trigger
language plpgsql security definer set search_path = public as $$
declare available numeric;
begin
  select current_l into available from tank_levels where id = new.from_tank_id;
  if coalesce(available,0) < new.liters then
    raise exception 'Stock insuficiente en el tanque origen (disponible %, solicitado %)', available, new.liters;
  end if;
  insert into stock_movements(tank_id, movement, liters, source_table, source_id)
  values (new.from_tank_id, 'traslado_salida', -new.liters, 'transfers', new.id),
         (new.to_tank_id,   'traslado_entrada', new.liters, 'transfers', new.id);
  return new;
end $$;
drop trigger if exists trg_mv_transfer on public.transfers;
create trigger trg_mv_transfer after insert on public.transfers
  for each row execute function public.mv_transfer();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Lectura: cualquier usuario autenticado. Escritura: según rol.
--  - admin: todo
--  - supervisor/operador: operaciones diarias (ingresos, consumos, traslados, catálogos)
--  - conductor: solo lectura (y crear solicitudes de autorización)
-- ============================================================================
alter table public.profiles        enable row level security;
alter table public.tanks           enable row level security;
alter table public.vehicles        enable row level security;
alter table public.machinery       enable row level security;
alter table public.authorizations  enable row level security;
alter table public.fuel_intakes    enable row level security;
alter table public.dispatches      enable row level security;
alter table public.transfers       enable row level security;
alter table public.stock_movements enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Blindaje: un usuario puede editar su propio perfil (nombre) pero NO su rol.
-- Solo un admin autenticado puede cambiar roles. auth.uid() null = contexto de
-- servicio / Management API (permitido para administración interna).
create or replace function public.guard_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'No autorizado para cambiar el rol de usuario';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_role on public.profiles;
create trigger trg_guard_role before update on public.profiles
  for each row execute function public.guard_role_change();

-- Catálogos (tanks, vehicles, machinery): lectura todos; escritura staff
do $$
declare tbl text;
begin
  foreach tbl in array array['tanks','vehicles','machinery'] loop
    execute format('drop policy if exists %I_select on public.%I;', tbl, tbl);
    execute format('create policy %I_select on public.%I for select to authenticated using (true);', tbl, tbl);
    execute format('drop policy if exists %I_write on public.%I;', tbl, tbl);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff());', tbl, tbl);
  end loop;
end $$;

-- Operaciones (fuel_intakes, dispatches, transfers): lectura todos; escritura staff
do $$
declare tbl text;
begin
  foreach tbl in array array['fuel_intakes','dispatches','transfers'] loop
    execute format('drop policy if exists %I_select on public.%I;', tbl, tbl);
    execute format('create policy %I_select on public.%I for select to authenticated using (true);', tbl, tbl);
    execute format('drop policy if exists %I_write on public.%I;', tbl, tbl);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff());', tbl, tbl);
  end loop;
end $$;

-- authorizations: lectura todos; cualquier autenticado crea solicitud; supervisor/admin resuelven
drop policy if exists auth_select on public.authorizations;
create policy auth_select on public.authorizations for select to authenticated using (true);
drop policy if exists auth_insert on public.authorizations;
create policy auth_insert on public.authorizations for insert to authenticated with check (auth.uid() = requested_by);
drop policy if exists auth_resolve on public.authorizations;
create policy auth_resolve on public.authorizations for update to authenticated
  using (public.current_role() in ('admin','supervisor'))
  with check (public.current_role() in ('admin','supervisor'));

-- stock_movements: solo lectura desde el cliente (lo escriben los triggers)
drop policy if exists mov_select on public.stock_movements;
create policy mov_select on public.stock_movements for select to authenticated using (true);

-- ============================================================================
-- FLUJO DE AUTORIZACIONES (aprobar/rechazar) — solo admin/supervisor.
-- Aprobar crea el despacho (descuenta stock vía trigger) de forma atómica.
-- ============================================================================
create or replace function public.approve_authorization(p_auth_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.authorizations%rowtype;
begin
  if public.current_role() not in ('admin','supervisor') then
    raise exception 'Solo un administrador o supervisor puede autorizar';
  end if;
  select * into a from public.authorizations where id = p_auth_id for update;
  if not found then raise exception 'Autorización no encontrada'; end if;
  if a.status <> 'pendiente' then raise exception 'La autorización ya fue resuelta'; end if;
  if a.tank_id is null then raise exception 'La solicitud no tiene tanque de origen'; end if;

  insert into public.dispatches (asset_kind, vehicle_id, machinery_id, liters, tank_id, authorization_id, created_by)
  values (a.asset_kind, a.vehicle_id, a.machinery_id, a.liters, a.tank_id, a.id, auth.uid());

  update public.authorizations
    set status = 'aprobado', approved_by = auth.uid(), resolved_at = now()
    where id = a.id;
end $$;

create or replace function public.reject_authorization(p_auth_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role() not in ('admin','supervisor') then
    raise exception 'Solo un administrador o supervisor puede rechazar';
  end if;
  update public.authorizations
    set status = 'rechazado', approved_by = auth.uid(), resolved_at = now()
    where id = p_auth_id and status = 'pendiente';
end $$;

-- ============================================================================
-- FIN DEL ESQUEMA
-- ============================================================================
