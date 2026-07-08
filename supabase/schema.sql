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
-- Manejan INSERT/UPDATE/DELETE: al editar o borrar un movimiento se
-- recalculan los stock_movements para mantener el stock sincronizado.
create or replace function public.mv_intake() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (TG_OP in ('UPDATE','DELETE')) then
    delete from stock_movements where source_table='fuel_intakes' and source_id = OLD.id;
  end if;
  if (TG_OP in ('INSERT','UPDATE')) then
    insert into stock_movements(tank_id, movement, liters, source_table, source_id)
    values (NEW.tank_id, 'ingreso', NEW.liters, 'fuel_intakes', NEW.id);
  end if;
  if (TG_OP = 'DELETE') then return OLD; end if;
  return NEW;
end $$;
drop trigger if exists trg_mv_intake on public.fuel_intakes;
create trigger trg_mv_intake after insert or update or delete on public.fuel_intakes
  for each row execute function public.mv_intake();

create or replace function public.mv_dispatch() returns trigger
language plpgsql security definer set search_path = public as $$
declare available numeric;
begin
  if (TG_OP in ('UPDATE','DELETE')) then
    delete from stock_movements where source_table='dispatches' and source_id = OLD.id;
  end if;
  if (TG_OP in ('INSERT','UPDATE')) then
    select current_l into available from tank_levels where id = NEW.tank_id;
    if coalesce(available,0) < NEW.liters then
      raise exception 'Stock insuficiente en el tanque (disponible %, solicitado %)', available, NEW.liters;
    end if;
    insert into stock_movements(tank_id, movement, liters, source_table, source_id)
    values (NEW.tank_id, 'consumo', -NEW.liters, 'dispatches', NEW.id);
  end if;
  if (TG_OP = 'DELETE') then return OLD; end if;
  return NEW;
end $$;
drop trigger if exists trg_mv_dispatch on public.dispatches;
create trigger trg_mv_dispatch after insert or update or delete on public.dispatches
  for each row execute function public.mv_dispatch();

create or replace function public.mv_transfer() returns trigger
language plpgsql security definer set search_path = public as $$
declare available numeric;
begin
  if (TG_OP in ('UPDATE','DELETE')) then
    delete from stock_movements where source_table='transfers' and source_id = OLD.id;
  end if;
  if (TG_OP in ('INSERT','UPDATE')) then
    select current_l into available from tank_levels where id = NEW.from_tank_id;
    if coalesce(available,0) < NEW.liters then
      raise exception 'Stock insuficiente en el tanque origen (disponible %, solicitado %)', available, NEW.liters;
    end if;
    insert into stock_movements(tank_id, movement, liters, source_table, source_id)
    values (NEW.from_tank_id, 'traslado_salida', -NEW.liters, 'transfers', NEW.id),
           (NEW.to_tank_id,   'traslado_entrada', NEW.liters, 'transfers', NEW.id);
  end if;
  if (TG_OP = 'DELETE') then return OLD; end if;
  return NEW;
end $$;
drop trigger if exists trg_mv_transfer on public.transfers;
create trigger trg_mv_transfer after insert or update or delete on public.transfers
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
-- Nº DE FACTURA INCREMENTAL E INMUTABLE (fuel_intakes.invoice_no)
-- ============================================================================
create sequence if not exists public.fuel_invoice_seq;

create or replace function public.set_invoice_no() returns trigger
language plpgsql as $$
begin
  if new.invoice_no is null or btrim(new.invoice_no) = '' then
    new.invoice_no := 'F-' || lpad(nextval('public.fuel_invoice_seq')::text, 5, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_invoice_no on public.fuel_intakes;
create trigger trg_invoice_no before insert on public.fuel_intakes
  for each row execute function public.set_invoice_no();

create or replace function public.lock_invoice_no() returns trigger
language plpgsql as $$
begin
  if new.invoice_no is distinct from old.invoice_no then
    raise exception 'El número de factura no se puede modificar';
  end if;
  return new;
end $$;
drop trigger if exists trg_lock_invoice on public.fuel_intakes;
create trigger trg_lock_invoice before update on public.fuel_intakes
  for each row execute function public.lock_invoice_no();

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
-- MAQUINARIA AVANZADA: empresas supervisoras, foto/placa/serial, estado
-- operativo, ubicación/ruta (historial) y regla de 1 carga por día.
-- ============================================================================
create table if not exists public.companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.machinery add column if not exists plate       text;
alter table public.machinery add column if not exists serial      text;
alter table public.machinery add column if not exists photo_url   text;
alter table public.machinery add column if not exists company_id  uuid references public.companies(id);
alter table public.machinery add column if not exists operational boolean not null default true;
alter table public.machinery add column if not exists latitude    numeric(9,6);
alter table public.machinery add column if not exists longitude   numeric(9,6);
alter table public.machinery add column if not exists location_at timestamptz;

create table if not exists public.machinery_locations (
  id uuid primary key default uuid_generate_v4(),
  machinery_id uuid not null references public.machinery(id) on delete cascade,
  latitude    numeric(9,6),
  longitude   numeric(9,6),
  note        text,
  recorded_at timestamptz not null default now()
);
create index if not exists idx_ml_machinery on public.machinery_locations(machinery_id, recorded_at);
-- Trazabilidad: coordenadas opcionales y nota (p. ej. "Ubicación eliminada manualmente").
alter table public.machinery_locations alter column latitude drop not null;
alter table public.machinery_locations alter column longitude drop not null;
alter table public.machinery_locations add column if not exists note text;

alter table public.companies           enable row level security;
alter table public.machinery_locations enable row level security;
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated using (true);
drop policy if exists companies_write on public.companies;
create policy companies_write on public.companies for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists ml_select on public.machinery_locations;
create policy ml_select on public.machinery_locations for select to authenticated using (true);
drop policy if exists ml_write on public.machinery_locations;
create policy ml_write on public.machinery_locations for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Una carga de combustible por máquina por día (aunque sea de otra cisterna).
create or replace function public.one_fuel_per_machine_per_day() returns trigger
language plpgsql as $$
declare prev numeric;
begin
  if NEW.asset_kind = 'maquinaria' and NEW.machinery_id is not null then
    select coalesce(sum(liters),0) into prev from public.dispatches
      where machinery_id = NEW.machinery_id and dispatch_date = NEW.dispatch_date;
    if prev > 0 then
      raise exception 'Esta máquina ya cargó % L hoy y no puede cargar de nuevo (aunque sea de otra cisterna).', prev;
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_one_fuel_per_day on public.dispatches;
create trigger trg_one_fuel_per_day before insert on public.dispatches
  for each row execute function public.one_fuel_per_machine_per_day();

-- Nota: crear un bucket público de Storage llamado 'machinery' para las fotos.

-- ============================================================================
-- CONTROL DE MAQUINARIA POR RONDAS (turnos)
-- 1ª 07:00 · 2ª 11:00 · 3ª 15:00 · 4ª 19:00 · + horas de parada
-- ============================================================================
create table if not exists public.machine_rounds (
  id            uuid primary key default gen_random_uuid(),
  machinery_id  uuid not null references public.machinery(id) on delete cascade,
  round_date    date not null,
  round_no      smallint not null check (round_no between 1 and 4),
  status        text not null default 'operativa' check (status in ('operativa', 'parada')),
  hours_stopped numeric(6,2) not null default 0 check (hours_stopped >= 0),
  overtime_hours numeric(6,2) default 0 check (overtime_hours >= 0),
  notes         text,
  recorded_by   uuid references auth.users(id),
  created_at    timestamptz default now(),
  unique (machinery_id, round_date, round_no)
);
create index if not exists idx_mr_date on public.machine_rounds(round_date, machinery_id);

alter table public.machine_rounds enable row level security;
drop policy if exists mr_select on public.machine_rounds;
create policy mr_select on public.machine_rounds for select to authenticated using (true);
drop policy if exists mr_write on public.machine_rounds;
create policy mr_write on public.machine_rounds for all to authenticated using (true) with check (true);

-- ============================================================================
-- Columnas extra de maquinaria: identificador, ubicación (texto), entrada/salida
-- + serial único (case-insensitive) para no duplicar máquinas.
-- ============================================================================
alter table public.machinery add column if not exists identifier text;
alter table public.machinery add column if not exists location text;
alter table public.machinery add column if not exists entry_date date;
alter table public.machinery add column if not exists exit_date date;
create unique index if not exists uq_machinery_serial
  on public.machinery (lower(trim(serial))) where serial is not null and trim(serial) <> '';

-- ============================================================================
-- MATRIZ DE PERMISOS POR USUARIO Y MÓDULO
-- Niveles: none · lectura · escritura · full. Solo un admin puede editarla.
-- ============================================================================
create table if not exists public.module_permissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  module  text not null,
  level   text not null default 'none' check (level in ('none','lectura','escritura','full')),
  primary key (user_id, module)
);
alter table public.module_permissions enable row level security;
drop policy if exists mp_select on public.module_permissions;
create policy mp_select on public.module_permissions for select to authenticated using (true);
drop policy if exists mp_write on public.module_permissions;
create policy mp_write on public.module_permissions for all to authenticated
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

-- ============================================================================
-- CONTROL DE PAGOS: precio por hora de la maquinaria + histórico de pagos
-- El total por empresa/semana = Σ (horas trabajadas × precio_por_hora).
-- ============================================================================
alter table public.machinery add column if not exists price_per_hour numeric(12,2);

-- Grupo y encargado de la maquinaria (se muestran en el catálogo).
alter table public.machinery add column if not exists grupo text;
alter table public.machinery add column if not exists encargado text;

-- Horas extras por máquina/día (se suman a las horas trabajadas y al total a pagar).
alter table public.machine_rounds add column if not exists overtime_hours numeric(6,2) default 0;

create table if not exists public.company_payments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies(id) on delete set null,
  company_name text not null,
  period_start date not null,
  period_end   date not null,
  amount       numeric(14,2) not null default 0,
  currency     text not null default 'USD',
  detail       jsonb,                    -- snapshot: máquinas, horas, precio, total
  paid_at      timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  created_at   timestamptz default now()
);
create index if not exists idx_cp_company on public.company_payments(company_name, period_start);
alter table public.company_payments enable row level security;
drop policy if exists cp_select on public.company_payments;
create policy cp_select on public.company_payments for select to authenticated using (true);
drop policy if exists cp_write on public.company_payments;
create policy cp_write on public.company_payments for all to authenticated using (true) with check (true);

-- ============================================================================
-- OPERADOR por máquina y día + CIERRES DE CONTROL (histórico de maquinaria)
-- ============================================================================
create table if not exists public.machine_day_operators (
  machinery_id uuid not null references public.machinery(id) on delete cascade,
  round_date   date not null,
  first_name   text,
  last_name    text,
  cedula       text,
  updated_at   timestamptz default now(),
  primary key (machinery_id, round_date)
);
alter table public.machine_day_operators enable row level security;
drop policy if exists mdo_select on public.machine_day_operators;
create policy mdo_select on public.machine_day_operators for select to authenticated using (true);
drop policy if exists mdo_write on public.machine_day_operators;
create policy mdo_write on public.machine_day_operators for all to authenticated using (true) with check (true);

create table if not exists public.control_closures (
  id           uuid primary key default gen_random_uuid(),
  closure_date date not null,
  closed_by    uuid references auth.users(id),
  detail       jsonb,                 -- snapshot del día: máquinas, rondas, operador, horas
  created_at   timestamptz default now()
);
create index if not exists idx_cc_date on public.control_closures(closure_date desc);
alter table public.control_closures enable row level security;
drop policy if exists cc_select on public.control_closures;
create policy cc_select on public.control_closures for select to authenticated using (true);
drop policy if exists cc_write on public.control_closures;
create policy cc_write on public.control_closures for all to authenticated using (true) with check (true);

-- ============================================================================
-- FIN DEL ESQUEMA
-- ============================================================================
