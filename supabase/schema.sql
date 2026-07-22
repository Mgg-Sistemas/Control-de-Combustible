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
  create type user_role as enum ('admin', 'supervisor', 'analista', 'operador', 'conductor');
exception when duplicate_object then null; end $$;
-- 'analista' y 'cocina' se agregaron después: por si el enum ya existía.
alter type user_role add value if not exists 'analista';
alter type user_role add value if not exists 'cocina';

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

-- ¿el usuario actual puede ESCRIBIR en el módulo dado? Alinea la seguridad de la
-- BD con los permisos por módulo de la UI: admin siempre; si el usuario tiene una
-- fila de permiso, su nivel debe ser 'escritura'/'full'; sin fila = permitido
-- (igual que la UI, cuyo nivel por defecto de los módulos operativos es 'escritura').
-- Así un usuario con FULL CONTROL puede operar aunque su rol no sea staff.
-- plpgsql (no sql) para que la referencia a module_permissions se resuelva en
-- tiempo de ejecución: así el esquema se instala desde cero aunque esa tabla se
-- cree más abajo.
create or replace function public.can_write_module(mod text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare lvl text;
begin
  if public.is_anon() then return false; end if; -- anónimos nunca escriben por módulos
  if public.is_admin() then return true; end if;
  select mp.level into lvl from public.module_permissions mp
    where mp.user_id = auth.uid() and mp.module = mod limit 1;
  if lvl is null then return true; end if; -- sin fila = por defecto escritura (usuarios logueados)
  return lvl in ('escritura','full');
end;
$$;

-- Crear perfil automáticamente al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No crear perfil para usuarios ANÓNIMOS (los que solo escanean el QR). El
  -- perfil del operador se crea al iniciar jornada (set_self_operator).
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
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
  code          text not null, -- el NOMBRE puede repetirse (varias "Volteos"); la unicidad va por serial/placa
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
  -- Tanque OPCIONAL: si es null, es carga DIRECTA de la bomba (solo litros, no descuenta stock).
  tank_id          uuid references public.tanks(id),
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
    -- Solo descuenta stock si el surtido viene de un TANQUE. Si tank_id es null, es
    -- carga DIRECTA de bomba: solo se registran los litros, no se toca ningún tanque.
    if NEW.tank_id is not null then
      select current_l into available from tank_levels where id = NEW.tank_id;
      if coalesce(available,0) < NEW.liters then
        raise exception 'Stock insuficiente en el tanque (disponible %, solicitado %)', available, NEW.liters;
      end if;
      insert into stock_movements(tank_id, movement, liters, source_table, source_id)
      values (NEW.tank_id, 'consumo', -NEW.liters, 'dispatches', NEW.id);
    end if;
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
-- Visibilidad de la empresa:
--   hidden:    inactiva en TODO el sistema (incluido comidas).
--   food_only: aparece SOLO en la distribución de comidas; se oculta del resto
--              del sistema (selectores, listas, leyendas, reportes).
alter table public.companies add column if not exists hidden boolean not null default false;
alter table public.companies add column if not exists food_only boolean not null default false;

-- Tabulador maestro de precios por jornada (clasificación + modelo).
-- Editable desde Control de pagos. "Sincronizar" lo aplica a
-- machinery.price_per_hour (precios ACTUALES). Los cierres viejos quedan
-- congelados; los cierres nuevos congelan estos precios al cerrar.
create table if not exists public.price_tariffs (
  id uuid primary key default gen_random_uuid(),
  clasificacion text not null,
  modelo text not null unique,
  price_jornada numeric not null default 0,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.price_tariffs enable row level security;
drop policy if exists price_tariffs_read on public.price_tariffs;
create policy price_tariffs_read on public.price_tariffs for select to authenticated using (not public.is_anon());
drop policy if exists price_tariffs_write on public.price_tariffs;
create policy price_tariffs_write on public.price_tariffs for all to authenticated using (not public.is_anon()) with check (not public.is_anon());

-- Tabulador POR EMPRESA: sobrescribe el precio general de un modelo para una
-- empresa puntual (no todas cobran igual). Al sincronizar, cada máquina usa el
-- precio de su empresa si existe; si no, cae al tabulador general (price_tariffs).
create table if not exists public.company_price_tariffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  modelo text not null,
  price_jornada numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique(company_id, modelo)
);
alter table public.company_price_tariffs enable row level security;
drop policy if exists cpt_read on public.company_price_tariffs;
create policy cpt_read on public.company_price_tariffs for select to authenticated using (not public.is_anon());
drop policy if exists cpt_write on public.company_price_tariffs;
create policy cpt_write on public.company_price_tariffs for all to authenticated using (not public.is_anon()) with check (not public.is_anon());

-- Fletes/viajes CON FECHA: cada flete pertenece a una empresa (y opcionalmente a una
-- máquina) y tiene su fecha, para que en los reportes aparezca SOLO en la semana en que
-- ocurrió (a diferencia de un campo fijo por máquina). Los reportes suman los fletes
-- cuyo flete_date cae dentro del rango, y los añaden al TOTAL POR PAGAR de la empresa.
create table if not exists public.fletes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  machinery_id uuid references public.machinery(id) on delete set null,
  code text,
  flete_date date not null,
  viajes int not null default 1,
  precio numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);
alter table public.fletes enable row level security;
drop policy if exists fletes_read on public.fletes;
create policy fletes_read on public.fletes for select using (true);
drop policy if exists fletes_write on public.fletes;
create policy fletes_write on public.fletes for all to authenticated using (true) with check (true);

alter table public.machinery add column if not exists plate       text;
alter table public.machinery add column if not exists serial      text;
alter table public.machinery add column if not exists photo_url   text;
alter table public.machinery add column if not exists company_id  uuid references public.companies(id);
alter table public.machinery add column if not exists operational boolean not null default true;
-- 3er estado de la máquina: "En espera por recepción" (aún no recibida en el control activo).
alter table public.machinery add column if not exists en_espera   boolean not null default false;
-- QR BLOQUEADO: al escanear el QR de esta máquina solo se muestra el logo (sin datos ni
-- acciones). Bloqueo manual e independiente del sello por serial (ver machineQrUrl).
alter table public.machinery add column if not exists qr_blocked  boolean not null default false;
alter table public.machinery add column if not exists latitude    numeric(9,6);
alter table public.machinery add column if not exists longitude   numeric(9,6);
alter table public.machinery add column if not exists location_at timestamptz;

-- No permitir dos máquinas con el mismo SERIAL o la misma PLACA (sin distinguir
-- mayúsculas ni espacios). Se ignoran los vacíos/nulos (varias máquinas pueden no
-- tener serial/placa). Índice ÚNICO parcial: es el candado real a nivel de BD.
-- OJO: si ya existen duplicados, la creación del índice FALLA hasta limpiarlos.
create unique index if not exists machinery_serial_uniq
  on public.machinery (lower(btrim(serial)))
  where serial is not null and btrim(serial) <> '';
create unique index if not exists machinery_plate_uniq
  on public.machinery (lower(btrim(plate)))
  where plate is not null and btrim(plate) <> '';

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

-- MONITOREO: quién colocó la ubicación. Un trigger rellena recorded_by con el
-- usuario que hace la inserción (auth.uid()), sirva vía RPC (SECURITY DEFINER),
-- inserción directa o el flujo anónimo del QR. Así el admin ve quién ubica.
alter table public.machinery_locations add column if not exists recorded_by uuid references auth.users(id);
create index if not exists idx_ml_recorded_by on public.machinery_locations(recorded_by);
create or replace function public.ml_set_recorded_by() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.recorded_by is null then NEW.recorded_by := auth.uid(); end if;
  return NEW;
end $$;
drop trigger if exists trg_ml_recorded_by on public.machinery_locations;
create trigger trg_ml_recorded_by before insert on public.machinery_locations
  for each row execute function public.ml_set_recorded_by();

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
-- La identidad ÚNICA de la máquina es el SERIAL o la PLACA (no el nombre/código):
-- puede haber varias máquinas llamadas "Volteos" con distinto serial/placa.
alter table public.machinery drop constraint if exists machinery_code_key;
create unique index if not exists uq_machinery_serial
  on public.machinery (lower(trim(serial))) where serial is not null and trim(serial) <> '';
create unique index if not exists uq_machinery_plate
  on public.machinery (lower(trim(plate))) where plate is not null and trim(plate) <> '';

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
-- ZONA / a disposición de (Gobernación, FANB, CVM, Zona Este…) — filtro del Conteo de equipos.
alter table public.machinery add column if not exists zona text;

-- MODELO de la máquina (marca/modelo: CAT 320, Komatsu PC200...) — agrupa reportes por modelo.
-- (La columna se llama `tipo` por historia; hoy representa el MODELO.)
alter table public.machinery add column if not exists tipo text;

-- CLASIFICACIÓN de la máquina (Manejo de cargas, Remoción y excavación...) — agrupa reportes por clasificación.
alter table public.machinery add column if not exists clasificacion text;

-- Referencia / UBICACIÓN de la máquina — se muestra en los reportes.
alter table public.machinery add column if not exists referencia text;

-- Horas extras por máquina/día (se suman a las horas trabajadas y al total a pagar).
alter table public.machine_rounds add column if not exists overtime_hours numeric(6,2) default 0;

-- Momento exacto (fecha + hora) de entrada/salida de la máquina: desde la entrada
-- se cuenta que empieza a trabajar.
alter table public.machinery add column if not exists entry_at timestamptz;
alter table public.machinery add column if not exists exit_at timestamptz;

-- "Cerrar control" archiva el día en el histórico y marca sus rondas/operadores como
-- cerrados (closed=true): dejan de verse en el control activo pero siguen contando
-- para pagos y reportes. Cambiar de fecha NO borra nada.
alter table public.machine_rounds add column if not exists closed boolean not null default false;
-- Precio por jornada CONGELADO al cerrar el corte. Los reportes usan este precio para las
-- rondas cerradas (así un corte cerrado suma con SUS precios aunque después cambien); las
-- rondas abiertas usan el precio actual de la máquina.
alter table public.machine_rounds add column if not exists frozen_price numeric;
alter table public.machine_day_operators add column if not exists closed boolean not null default false;

-- Control por TURNOS (en vez de 4 rondas): turno de día y de noche, cada uno medio
-- (6h) o completo (12h). Se guardan en el registro base (round_no=1). Trabajadas =
-- (día + noche) − parada + extras. medio=6h, completo=12h, 1½=18h, 2 turnos=24h.
alter table public.machine_rounds add column if not exists day_hours numeric(6,2) not null default 0;
alter table public.machine_rounds add column if not exists night_hours numeric(6,2) not null default 0;
-- Operador por turno (día/noche): cada jornada puede tener un operador distinto.
alter table public.machine_rounds add column if not exists day_operator text;
alter table public.machine_rounds add column if not exists day_operator_ci text;
alter table public.machine_rounds add column if not exists night_operator text;

-- EL PRECIO SE CONGELA SOLO AL CERRAR EL CORTE (ver "cerrar control"), NO al cargar
-- cada jornada. Regla:
--   • Semana ABIERTA  → los reportes usan el precio ACTUAL de la máquina (así, si
--     cambias el precio de la semana en curso, se refleja de inmediato).
--   • Semana CERRADA  → queda con su frozen_price (inmutable aunque cambie el precio).
-- Un trigger anterior congelaba en cada jornada (freeze_round_price); se ELIMINA porque
-- impedía sincronizar el precio de la semana en curso. Las rondas ABIERTAS se
-- descongelan para que vuelvan a tomar el precio actual.
drop trigger if exists trg_freeze_round_price on public.machine_rounds;
drop function if exists public.freeze_round_price();
update public.machine_rounds set frozen_price = null where closed is not true;
alter table public.machine_rounds add column if not exists night_operator_ci text;

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
create policy cp_write on public.company_payments for all to authenticated using (not public.is_anon()) with check (not public.is_anon());

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
-- MARGEN DE GANANCIA: costo inicial y valor útil de cada maquinaria.
-- % de ganancia = (valor_útil − costo_inicial) ÷ costo_inicial × 100.
-- ============================================================================
alter table public.machinery add column if not exists initial_cost numeric(14,2);
alter table public.machinery add column if not exists useful_value numeric(14,2);

-- ============================================================================
-- RECORRIDO / RUTA por surtido de maquinaria: km ida/vuelta y combustible
-- inicial/final para calcular el rendimiento de la ruta = km ÷ (inicial−final).
-- Límite de surtido: no se puede despachar más de 2× el consumo diario.
-- ============================================================================
alter table public.dispatches add column if not exists km_ida numeric(12,2);
alter table public.dispatches add column if not exists km_vuelta numeric(12,2);
alter table public.dispatches add column if not exists fuel_start numeric(12,2);
alter table public.dispatches add column if not exists fuel_end numeric(12,2);
alter table public.machinery add column if not exists daily_consumption_l numeric(12,2);

-- ============================================================================
-- VISTA DE OPERADOR: operador asignado por defecto a cada máquina.
-- El usuario con rol 'operador' entra a su propia pantalla y ve/gestiona la
-- máquina cuyo operator_id es su perfil (puede cambiar a otra si hace falta).
-- ============================================================================
alter table public.machinery add column if not exists operator_id uuid references public.profiles(id) on delete set null;
comment on column public.machinery.operator_id is 'Operador asignado por defecto (rol operador). El operador ve/gestiona esta máquina en su vista.';

-- ============================================================================
-- MANTENIMIENTO DE MAQUINARIA: el operador (al escanear el QR de la máquina)
-- solicita el cambio de un material (caucho, aceite, filtro, repuesto) con la
-- cantidad necesaria. El supervisor lo marca como realizado desde el sistema.
-- ============================================================================
create table if not exists public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  machinery_id uuid not null references public.machinery(id) on delete cascade,
  material text not null,               -- 'caucho' | 'aceite' | 'filtro' | 'repuesto'
  quantity numeric(12,2),               -- cantidad del material a cambiar
  notes text,
  status text not null default 'pendiente', -- 'pendiente' | 'realizado'
  requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz
);
-- Foto de referencia de la avería (opcional; se ve en el detalle de Mantenimiento).
alter table public.maintenance_requests add column if not exists photo_url text;
alter table public.maintenance_requests enable row level security;
create policy mr_maint_read on public.maintenance_requests for select to authenticated using (true);
create policy mr_maint_insert on public.maintenance_requests for insert to authenticated with check (true);
create policy mr_maint_update on public.maintenance_requests for update to authenticated using (true) with check (true);
create index if not exists idx_maint_machine on public.maintenance_requests(machinery_id);
create index if not exists idx_maint_status on public.maintenance_requests(status);

-- REPARACIONES de maquinaria: el coordinador de mantenimiento envía la máquina a
-- reparación (salida, tiempo estimado, qué se cambió) y registra su retorno operativo.
-- Al enviar se marca la máquina 'No operativa'; al volver, 'Operativa' (lo hace la app).
create table if not exists public.machinery_repairs (
  id uuid primary key default gen_random_uuid(),
  machinery_id uuid not null references public.machinery(id) on delete cascade,
  tipo text not null default 'correctivo',       -- 'preventivo' | 'correctivo'
  out_at date not null default current_date,      -- fecha de salida a reparación
  estimated_days numeric(6,1),                    -- por cuánto tiempo (días)
  estimated_note text,                            -- detalle del tiempo (texto libre)
  work_done text,                                 -- qué se le cambió / trabajo realizado
  back_at date,                                   -- cuándo volvió operativa (null = en reparación)
  status text not null default 'en_reparacion',   -- 'en_reparacion' | 'operativa'
  created_by uuid references public.profiles(id) on delete set null,
  closed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.machinery_repairs enable row level security;
create policy mrep_read on public.machinery_repairs for select to authenticated using (true);
create policy mrep_insert on public.machinery_repairs for insert to authenticated with check (not public.is_anon());
create policy mrep_update on public.machinery_repairs for update to authenticated using (not public.is_anon()) with check (not public.is_anon());
create index if not exists idx_mrep_machine on public.machinery_repairs(machinery_id);
create index if not exists idx_mrep_status on public.machinery_repairs(status);

-- ROLES DINÁMICOS: roles creados desde Usuarios. Cada rol define qué módulos ve
-- (mapa module_key → nivel). Un usuario con app_role_id ve SOLO esos módulos.
create table if not exists public.app_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  modules jsonb not null default '{}'::jsonb,      -- { "mantenimiento": "full", ... }
  created_at timestamptz not null default now()
);
-- Tipo de panel del rol: 'modulos' (lista de módulos) o 'coordinador_qr' (panel con
-- escáner QR: surtir gasoil, avería y marcar máquina lista).
alter table public.app_roles add column if not exists panel_type text not null default 'modulos';
alter table public.app_roles enable row level security;
create policy app_roles_read on public.app_roles for select to authenticated using (true);
create policy app_roles_write on public.app_roles for all to authenticated using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
alter table public.profiles add column if not exists app_role_id uuid references public.app_roles(id) on delete set null;

-- ============================================================================
-- NÓMINA por empresa: monto que se descuenta de la cuenta general de la empresa
-- en Control de Pagos (total neto = facturado − abonos − nómina).
-- ============================================================================
create table if not exists public.payrolls (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  amount numeric(14,2) not null,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.payrolls enable row level security;
create policy pr_read on public.payrolls for select to authenticated using (true);
create policy pr_insert on public.payrolls for insert to authenticated with check (not public.is_anon());
create policy pr_delete on public.payrolls for delete to authenticated using (not public.is_anon());
create index if not exists idx_payroll_company on public.payrolls(company_name);

-- ============================================================================
-- GUARDIA / MILITAR ENCARGADO por máquina (historial ACUMULABLE).
-- Se asigna desde las rondas (Control de maquinaria). Al cambiar de militar,
-- el registro activo se cierra (ended_at + active=false) y se abre uno nuevo,
-- así queda la traza de todos los que custodiaron la máquina.
-- ============================================================================
create table if not exists public.machine_guards (
  id uuid primary key default gen_random_uuid(),
  machinery_id uuid not null references public.machinery(id) on delete cascade,
  guard_name text not null,             -- nombre del militar/guardia
  rank text,                            -- grado / rango (opcional)
  note text,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,                 -- null = período de custodia actual
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.machine_guards enable row level security;
create policy mg_read on public.machine_guards for select to authenticated using (true);
create policy mg_insert on public.machine_guards for insert to authenticated with check (true);
create policy mg_update on public.machine_guards for update to authenticated using (true) with check (true);
create index if not exists idx_guard_machine on public.machine_guards(machinery_id);
create index if not exists idx_guard_active on public.machine_guards(active);

-- ============================================================================
-- HORÓMETRO por jornada: se captura al iniciar (inicial + foto) y al finalizar
-- (final). Horas de la jornada = HF − HI. El HF se arrastra como próximo HI
-- (machinery.last_horometro). Sirve para el consumo por horómetro (litros/horas).
-- ============================================================================
alter table public.machinery       add column if not exists last_horometro   numeric(12,2);
alter table public.machine_rounds  add column if not exists horometro_inicial numeric(12,2);
alter table public.machine_rounds  add column if not exists horometro_final   numeric(12,2);
alter table public.machine_rounds  add column if not exists horometro_photo   text;

-- ============================================================================
-- OPERADORES: asignación de una máquina a un operador en un día. Al iniciar
-- jornada (vista QR) se pide nombre/apellido/cédula (sin login). Regla: 1
-- máquina por operador por día (único cédula+fecha); en una semana sí puede
-- tener varias máquinas, pero no el mismo día. Guarda empresa y horómetro.
-- ============================================================================
create table if not exists public.operator_assignments (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  cedula text not null,
  machinery_id uuid not null references public.machinery(id) on delete cascade,
  company_name text,
  work_date date not null,
  shift text,                            -- 'day' | 'night'
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  worked_hours numeric(6,2),
  horometro_inicial numeric(12,2),
  horometro_final numeric(12,2),
  horometro_photo text,
  -- Ubicación GPS del operador al INICIAR y al FINALIZAR la jornada (traza en tiempo real).
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.operator_assignments add column if not exists start_lat double precision;
alter table public.operator_assignments add column if not exists start_lng double precision;
alter table public.operator_assignments add column if not exists end_lat   double precision;
alter table public.operator_assignments add column if not exists end_lng   double precision;
create unique index if not exists uq_operator_day on public.operator_assignments(cedula, work_date);
create index if not exists idx_opasg_machine on public.operator_assignments(machinery_id);
create index if not exists idx_opasg_date on public.operator_assignments(work_date);
alter table public.operator_assignments enable row level security;
create policy oa_read on public.operator_assignments for select to authenticated using (true);
create policy oa_insert on public.operator_assignments for insert to authenticated with check (true);
create policy oa_update on public.operator_assignments for update to authenticated using (true) with check (true);

-- ===================== F3 COMPRAS =====================
-- Proveedores, solicitudes de pedido y órdenes de compra. Escritura por permiso
-- de módulo 'compras' (can_write_module). Los renglones van en JSONB.
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rif text, phone text, email text, address text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.suppliers enable row level security;
drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated using (true);
drop policy if exists suppliers_write on public.suppliers;
create policy suppliers_write on public.suppliers for all to authenticated
  using (public.can_write_module('compras')) with check (public.can_write_module('compras'));

create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  requested_by uuid references auth.users(id),
  needed_for text,
  category text,                                 -- repuestos|oficina|limpieza|herramientas|servicios|otros
  note text,
  items jsonb not null default '[]'::jsonb,     -- [{description, qty, unit, price}]
  estimated_total numeric not null default 0,
  status text not null default 'solicitada',    -- solicitada|aprobada|rechazada|ordenada
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.purchase_requests enable row level security;
drop policy if exists preq_select on public.purchase_requests;
create policy preq_select on public.purchase_requests for select to authenticated using (true);
drop policy if exists preq_write on public.purchase_requests;
create policy preq_write on public.purchase_requests for all to authenticated
  using (public.can_write_module('compras')) with check (public.can_write_module('compras'));

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.purchase_requests(id) on delete set null,
  supplier_id uuid references public.suppliers(id),
  company_id uuid references public.companies(id),
  category text,                                 -- heredada de la solicitud
  note text,
  items jsonb not null default '[]'::jsonb,     -- [{description, qty, unit, price}]
  total numeric not null default 0,
  status text not null default 'borrador',       -- borrador|aprobada|recibida|anulada
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  received_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.purchase_orders enable row level security;
drop policy if exists pord_select on public.purchase_orders;
create policy pord_select on public.purchase_orders for select to authenticated using (true);
drop policy if exists pord_write on public.purchase_orders;
create policy pord_write on public.purchase_orders for all to authenticated
  using (public.can_write_module('compras')) with check (public.can_write_module('compras'));

create index if not exists idx_preq_status on public.purchase_requests(status);
create index if not exists idx_pord_status on public.purchase_orders(status);

-- ============================================================
-- F4 · Inventario / Almacén
-- Existencias DERIVADAS de inventory_movements (patrón igual a tank_levels).
-- ============================================================
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,                               -- misma taxonomía que compras
  unit text,                                   -- UND, LT, KG…
  sku text,
  min_stock numeric not null default 0,        -- alerta de stock mínimo
  avg_cost numeric not null default 0,          -- Precio Medio Ponderado (PMP), recalculado en cada entrada
  company_id uuid references public.companies(id),
  machinery_id uuid references public.machinery(id) on delete set null, -- equipo al que pertenece el material (el inventario se vincula por EQUIPO, no por empresa)
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.inventory_items add column if not exists machinery_id uuid references public.machinery(id) on delete set null;
alter table public.inventory_items enable row level security;
drop policy if exists inv_items_select on public.inventory_items;
create policy inv_items_select on public.inventory_items for select to authenticated using (true);
drop policy if exists inv_items_write on public.inventory_items;
create policy inv_items_write on public.inventory_items for all to authenticated
  using (public.can_write_module('inventario')) with check (public.can_write_module('inventario'));

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  kind text not null default 'entrada',        -- entrada|salida|consumo|ajuste
  qty numeric not null default 0,              -- entrada/salida/consumo: positivo · ajuste: puede ser negativo
  unit_cost numeric,                            -- costo unitario (valorización)
  reason text,                                  -- motivo/destino
  order_id uuid references public.purchase_orders(id) on delete set null,  -- trazabilidad con la compra
  company_id uuid references public.companies(id),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.inventory_movements enable row level security;
drop policy if exists inv_mov_select on public.inventory_movements;
create policy inv_mov_select on public.inventory_movements for select to authenticated using (true);
drop policy if exists inv_mov_write on public.inventory_movements;
create policy inv_mov_write on public.inventory_movements for all to authenticated
  using (public.can_write_module('inventario')) with check (public.can_write_module('inventario'));

create index if not exists idx_inv_mov_item on public.inventory_movements(item_id);
create index if not exists idx_inv_mov_order on public.inventory_movements(order_id);

-- Estado FÍSICO del material (Nuevo/Bueno/Regular/Dañado) — para el reporte de inventario.
alter table public.inventory_items add column if not exists estado text;
-- Tipo de producto (libre, con sugerencias): bombona, silla, mecate… — para FILTRAR.
alter table public.inventory_items add column if not exists tipo text;
-- CARGA de la bombona: vacía / en uso / llena — para tildar, filtrar y reportar.
alter table public.inventory_items add column if not exists carga text;

-- Existencias actuales por producto (stock derivado de los movimientos).
create or replace view public.inventory_levels as
select
  i.id, i.name, i.category, i.unit, i.sku, i.min_stock, i.avg_cost, i.company_id, i.active, i.created_at,
  coalesce(sum(case when m.kind='entrada' then m.qty when m.kind in ('salida','consumo') then -m.qty when m.kind='ajuste' then m.qty else 0 end), 0)::numeric(14,2) as stock,
  i.machinery_id, i.estado, i.tipo, i.carga
from public.inventory_items i
left join public.inventory_movements m on m.item_id = i.id
group by i.id;

-- PMP: al insertar una ENTRADA con costo, recalcula el precio medio ponderado del producto.
create or replace function public.inv_recalc_avg() returns trigger
language plpgsql security definer set search_path = public as $$
declare prev_stock numeric; prev_avg numeric;
begin
  if (NEW.kind = 'entrada' and NEW.unit_cost is not null and NEW.qty > 0) then
    select coalesce(sum(case when kind='entrada' then qty when kind in ('salida','consumo') then -qty when kind='ajuste' then qty else 0 end), 0)
      into prev_stock from public.inventory_movements where item_id = NEW.item_id and id <> NEW.id;
    select coalesce(avg_cost, 0) into prev_avg from public.inventory_items where id = NEW.item_id;
    if prev_stock <= 0 then
      update public.inventory_items set avg_cost = NEW.unit_cost where id = NEW.item_id;
    else
      update public.inventory_items
        set avg_cost = round((prev_stock * prev_avg + NEW.qty * NEW.unit_cost) / (prev_stock + NEW.qty), 4)
        where id = NEW.item_id;
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_inv_recalc_avg on public.inventory_movements;
create trigger trg_inv_recalc_avg after insert on public.inventory_movements
  for each row execute function public.inv_recalc_avg();

-- ============================================================================
-- NOTA DE TRASLADO DE INVENTARIO: traslada materiales de UNA máquina/empleado
-- (origen) a OTRA máquina/empleado (destino). Al confirmar, descuenta del stock
-- (registra 'salida' en inventory_movements) y guarda este encabezado con los
-- renglones (items) en JSONB, casado con la máquina y el empleado de cada lado.
-- ============================================================================
create table if not exists public.inventory_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  from_machinery_id uuid references public.machinery(id) on delete set null,
  from_machinery_label text,
  from_employee_id uuid references public.employees(id) on delete set null,
  from_employee_name text,
  to_machinery_id uuid references public.machinery(id) on delete set null,
  to_machinery_label text,
  to_employee_id uuid references public.employees(id) on delete set null,
  to_employee_name text,
  motivo text,
  items jsonb not null default '[]'::jsonb,   -- [{item_id, name, qty, unit}]
  descontado boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_invtr_from_mach on public.inventory_transfers(from_machinery_id);
create index if not exists idx_invtr_to_mach on public.inventory_transfers(to_machinery_id);
create index if not exists idx_invtr_created on public.inventory_transfers(created_at);
alter table public.inventory_transfers enable row level security;
drop policy if exists invtr_all on public.inventory_transfers;
create policy invtr_all on public.inventory_transfers for all to authenticated using (true) with check (true);

-- Traslado: lugar/estado del material y RETORNO al inventario.
alter table public.inventory_transfers add column if not exists lugar text;            -- lugar/obra a donde se hizo el traslado
alter table public.inventory_transfers add column if not exists estado text;           -- condición al trasladar: usado|lleno|dañado
alter table public.inventory_transfers add column if not exists returned boolean not null default false;
alter table public.inventory_transfers add column if not exists returned_at timestamptz;
alter table public.inventory_transfers add column if not exists return_note text;       -- resumen del retorno (estado + cantidades)

-- ============================================================================
-- TASA BCV (Bs/US$): una fila por día (compartida), con histórico. Se baja del
-- BCV automáticamente (o se fija a mano). Sirve para mostrar los precios del
-- inventario en $ y en Bs al cambio del día.
-- ============================================================================
create table if not exists public.bcv_rates (
  rate_date  date primary key,
  rate       numeric not null,               -- Bs por 1 US$
  source     text default 'BCV',             -- 'BCV' (automática) | 'manual'
  created_at timestamptz not null default now()
);
alter table public.bcv_rates enable row level security;
drop policy if exists bcv_select on public.bcv_rates;
create policy bcv_select on public.bcv_rates for select to authenticated using (true);
drop policy if exists bcv_write on public.bcv_rates;
create policy bcv_write on public.bcv_rates for all to authenticated using (true) with check (true);

-- ============================================================================
-- REQUERIMIENTOS DE COMPRA: lista de productos (del inventario o NUEVOS) que se
-- pasa al jefe para que APRUEBE o RECHACE la compra. Si se compra, se RECIBE en
-- el inventario (genera entradas con el precio real). Estados:
--   pendiente → aprobado | rechazado ; aprobado → recibido
-- Los ítems van en JSONB: [{product_id, name, unit, qty, est_price, currency, note, received}]
-- ============================================================================
create table if not exists public.inventory_requirements (
  id            uuid primary key default gen_random_uuid(),
  code          text,                          -- REQ-#### (correlativo, se arma en la app)
  title         text,
  note          text,
  status        text not null default 'pendiente', -- pendiente|aprobado|rechazado|recibido
  items         jsonb not null default '[]'::jsonb,
  requested_by  uuid references public.profiles(id) on delete set null,
  requested_by_name text,
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_by_name text,
  decided_at    timestamptz,
  decision_note text,
  received_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_invreq_status on public.inventory_requirements(status);
create index if not exists idx_invreq_created on public.inventory_requirements(created_at);
alter table public.inventory_requirements enable row level security;
-- Cualquiera con escritura en inventario puede crear/editar sus requerimientos;
-- la APROBACIÓN (solo admins) se controla en la app.
drop policy if exists invreq_select on public.inventory_requirements;
create policy invreq_select on public.inventory_requirements for select to authenticated using (true);
drop policy if exists invreq_write on public.inventory_requirements;
create policy invreq_write on public.inventory_requirements for all to authenticated
  using (public.can_write_module('inventario')) with check (public.can_write_module('inventario'));

-- Al escanear el QR se entra SIN login (sesión anónima). Los operadores NO tienen
-- usuario: solo quedan registrados aquí (operator_assignments). Se dan permisos
-- QUIRÚRGICOS a la sesión anónima para lo que hace el operador desde el QR.
-- (Requiere habilitar "Anonymous sign-ins" en Auth del proyecto.)
create or replace function public.is_anon()
returns boolean language sql stable set search_path = public as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

-- Operador anónimo: marcar jornada (entrada/salida/horómetro en machinery),
-- ubicación (machinery_locations) y combustible (dispatches).
drop policy if exists machinery_anon_update on public.machinery;
create policy machinery_anon_update on public.machinery for update to authenticated
  using (public.is_anon()) with check (public.is_anon());
-- El anónimo puede actualizar ubicación/estado, pero NO precio ni identidad de la
-- máquina (RLS es por fila, no por columna → este trigger bloquea esas columnas).
create or replace function public.machinery_guard_anon()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_anon() then
    if (new.price_per_hour is distinct from old.price_per_hour)
       or (new.code is distinct from old.code)
       or (new.serial is distinct from old.serial)
       or (new.clasificacion is distinct from old.clasificacion)
       or (new.company_id is distinct from old.company_id) then
      raise exception 'No autorizado: sesion anonima no puede modificar datos sensibles de la maquina';
    end if;
  end if;
  -- La ANALISTA puede cargar/editar/eliminar jornadas, pero NO modificar el PRECIO.
  if public.current_role() = 'analista'
     and (new.price_per_hour is distinct from old.price_per_hour) then
    raise exception 'No autorizado: el rol analista no puede modificar el precio de la maquina';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_machinery_guard_anon on public.machinery;
create trigger trg_machinery_guard_anon before update on public.machinery
  for each row execute function public.machinery_guard_anon();
drop policy if exists ml_anon_insert on public.machinery_locations;
create policy ml_anon_insert on public.machinery_locations for insert to authenticated
  with check (public.is_anon());
drop policy if exists dispatches_anon_insert on public.dispatches;
create policy dispatches_anon_insert on public.dispatches for insert to authenticated
  with check (public.is_anon());
-- machine_rounds, maintenance_requests y operator_assignments ya permiten a
-- cualquier autenticado (incluye la sesión anónima).

-- ============================================================================
-- EMPLEADOS / RRHH (Fase 1) — ficha del trabajador + carnet con QR
-- ============================================================================
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  ficha_number text,                       -- número de ficha (carnet)
  first_name text not null,
  last_name text not null,
  cedula text,                             -- número de cédula
  cargo text,
  department text,
  grupo text,
  photo_url text,
  birth_date date,                         -- la edad se deriva
  gender text,
  blood_type text,                         -- grupo sanguíneo
  nationality text default 'Venezolana',
  marital_status text,
  phone text,
  email text,
  address text,                            -- dónde vive
  city text,
  state text,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relation text,
  hire_date date,                          -- fecha de ingreso
  status text not null default 'activo',   -- activo | inactivo | suspendido
  base_salary numeric(14,2),
  salary_currency text default 'USD',
  bank_name text,                          -- banco (datos bancarios)
  bank_account text,                       -- número de cuenta
  bank_holder text,                        -- nombre y apellido del titular de la cuenta
  bank_cedula text,                        -- cédula del titular de la cuenta
  talla_camisa text,                       -- talla de camisa (uniforme)
  talla_pantalon text,                     -- talla de pantalón (uniforme)
  talla_zapatos text,                      -- talla de zapatos (uniforme)
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
-- Tallas de uniforme (para tablas ya creadas): Distribución de uniformes en Nómina.
alter table public.employees add column if not exists talla_camisa text;
alter table public.employees add column if not exists talla_pantalon text;
alter table public.employees add column if not exists talla_zapatos text;
-- Pago a personal: precios por trabajador (por hora / día / semana).
alter table public.employees add column if not exists precio_hora numeric;
alter table public.employees add column if not exists precio_dia numeric;
alter table public.employees add column if not exists precio_semana numeric;
-- Cédula y número de ficha únicos (cuando no están vacíos).
create unique index if not exists uq_employees_cedula on public.employees (lower(btrim(cedula))) where cedula is not null and btrim(cedula) <> '';
create unique index if not exists uq_employees_ficha  on public.employees (lower(btrim(ficha_number))) where ficha_number is not null and btrim(ficha_number) <> '';
alter table public.employees enable row level security;
-- Lectura pública (el QR de la ficha se abre con sesión anónima, igual que el de máquinas).
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select using (true);
drop policy if exists employees_write on public.employees;
create policy employees_write on public.employees for all to authenticated using (not public.is_anon()) with check (not public.is_anon());
-- N° de ficha AUTOMÁTICO: correlativo de 4 dígitos (0001, 0002, …) asignado al crear
-- cuando no se envía uno manual.
create sequence if not exists public.employees_ficha_seq;
create or replace function public.set_employee_ficha() returns trigger language plpgsql as $fn$
begin
  if new.ficha_number is null or btrim(new.ficha_number) = '' then
    new.ficha_number := lpad(nextval('public.employees_ficha_seq')::text, 4, '0');
  end if;
  return new;
end $fn$;
drop trigger if exists trg_employee_ficha on public.employees;
create trigger trg_employee_ficha before insert on public.employees
  for each row execute function public.set_employee_ficha();

-- ============================================================================
-- ALIADOS — colaboradores externos con ficha y carnet propios (QR con sus datos)
-- ============================================================================
create table if not exists public.aliados (
  id uuid primary key default gen_random_uuid(),
  ficha_number text,                       -- 4 dígitos ALEATORIO único (no repetible)
  first_name text not null,
  last_name text not null,
  cedula text,
  organizacion text,                       -- empresa/institución del aliado
  rol text,                                -- rol o cargo del aliado
  photo_url text,
  blood_type text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  status text not null default 'activo',
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_aliados_cedula on public.aliados (lower(btrim(cedula))) where cedula is not null and btrim(cedula) <> '';
create unique index if not exists uq_aliados_ficha  on public.aliados (lower(btrim(ficha_number))) where ficha_number is not null and btrim(ficha_number) <> '';
alter table public.aliados enable row level security;
-- Lectura pública (el QR de la ficha se abre con sesión anónima, igual que empleados).
drop policy if exists aliados_read on public.aliados;
create policy aliados_read on public.aliados for select using (true);
drop policy if exists aliados_write on public.aliados;
create policy aliados_write on public.aliados for all to authenticated using (true) with check (true);
-- N° de ficha ALEATORIO de 4 dígitos, ÚNICO (no repetible), asignado al crear.
create or replace function public.set_aliado_ficha() returns trigger language plpgsql as $fn$
declare cand text; tries int := 0;
begin
  if new.ficha_number is null or btrim(new.ficha_number) = '' then
    loop
      cand := lpad((floor(random()*10000))::int::text, 4, '0');
      exit when not exists (select 1 from public.aliados where ficha_number = cand);
      tries := tries + 1;
      if tries > 300 then
        select lpad(g::text,4,'0') into cand from generate_series(0,9999) g
          where not exists (select 1 from public.aliados a where a.ficha_number = lpad(g::text,4,'0'))
          order by g limit 1;
        exit;
      end if;
    end loop;
    new.ficha_number := cand;
  end if;
  return new;
end $fn$;
drop trigger if exists trg_aliado_ficha on public.aliados;
create trigger trg_aliado_ficha before insert on public.aliados
  for each row execute function public.set_aliado_ficha();

-- ============================================================================
-- NÓMINA (Fase 2) — períodos y renglones por empleado
-- Datos sensibles: lectura SOLO para usuarios autenticados (no anónimos).
-- ============================================================================
create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  name text not null,
  period_start date,
  period_end date,
  status text not null default 'borrador',   -- borrador | aprobada | pagada
  total_amount numeric(14,2) not null default 0,
  currency text default 'USD',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text,
  cargo text,
  ficha_number text,
  cedula text,
  hire_date date,                                 -- fecha de ingreso (copiada del empleado)
  base_amount numeric(14,2) not null default 0,
  additions jsonb not null default '[]'::jsonb,   -- [{label, amount}]
  deductions jsonb not null default '[]'::jsonb,
  net_amount numeric(14,2) not null default 0,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pi_period on public.payroll_items(period_id);
create index if not exists idx_pp_company on public.payroll_periods(company_id);
alter table public.payroll_periods enable row level security;
alter table public.payroll_items enable row level security;
drop policy if exists pp_read on public.payroll_periods;
create policy pp_read on public.payroll_periods for select to authenticated using (true);
drop policy if exists pp_write on public.payroll_periods;
create policy pp_write on public.payroll_periods for all to authenticated using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists pi_read on public.payroll_items;
create policy pi_read on public.payroll_items for select to authenticated using (true);
drop policy if exists pi_write on public.payroll_items;
create policy pi_write on public.payroll_items for all to authenticated using (not public.is_anon()) with check (not public.is_anon());

-- ============================================================================
-- ÍNDICES DE RENDIMIENTO (filtros/joins más frecuentes)
-- ============================================================================
create index if not exists idx_machinery_company    on public.machinery(company_id);
create index if not exists idx_mr_machinery          on public.machine_rounds(machinery_id);
-- Parcial: el control activo consulta round_date con closed = false.
create index if not exists idx_mr_open               on public.machine_rounds(round_date) where closed = false;
create index if not exists idx_dispatches_machinery  on public.dispatches(machinery_id);
create index if not exists idx_dispatches_date       on public.dispatches(dispatch_date);
create index if not exists idx_employees_company     on public.employees(company_id);

-- ============================================================================
-- SUPERVISIÓN: ronda de supervisores. Cada visita (check-in) a una máquina con
-- hora + GPS + estado (trabajando/parada/no está). VALIDA la jornada: si en un
-- día una máquina con horas registradas NO tiene visita de supervisor, esa
-- máquina-día queda "sin validar" (regla de negocio: el operador no cobra).
-- El supervisor entra con su usuario (rol supervisor) a su propia vista.
-- ============================================================================
create table if not exists public.supervisor_visits (
  id uuid primary key default gen_random_uuid(),
  machinery_id uuid not null references public.machinery(id) on delete cascade,
  supervisor_id uuid references public.profiles(id),
  supervisor_name text not null,
  visit_date date not null,                 -- día (ISO Caracas) de la visita
  visited_at timestamptz not null default now(),
  status text not null default 'trabajando' -- 'trabajando' | 'parada' | 'no_esta'
    check (status in ('trabajando','parada','no_esta')),
  lat double precision,
  lng double precision,
  distance_m numeric,                       -- metros hasta la ubicación conocida de la máquina
  near boolean,                             -- ¿dentro de la tolerancia? (más o menos cerca)
  note text,
  created_at timestamptz not null default now()
);
alter table public.supervisor_visits enable row level security;
drop policy if exists sv_select on public.supervisor_visits;
create policy sv_select on public.supervisor_visits for select to authenticated using (true);
drop policy if exists sv_write on public.supervisor_visits;
create policy sv_write on public.supervisor_visits for all to authenticated using (true) with check (true);
create index if not exists supervisor_visits_machine_date_idx on public.supervisor_visits(machinery_id, visit_date);
create index if not exists supervisor_visits_date_idx on public.supervisor_visits(visit_date);
create index if not exists supervisor_visits_sup_idx on public.supervisor_visits(supervisor_id, visit_date);

-- ============================================================================
-- DISTRIBUCIÓN DE COMIDA: cada entrega a una persona (identificada por su
-- carnet/QR) con la cantidad de comidas y la hora de entrega. La registra un
-- usuario con rol 'cocina' (con sesión iniciada). El módulo "Distribución de
-- comida" agrupa por persona y día.
-- ============================================================================
create table if not exists public.food_distributions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text not null,
  cedula text,
  meals integer not null default 1 check (meals > 0),
  delivered_at timestamptz not null default now(),   -- hora de entrega
  distribution_date date not null,                   -- día (ISO Caracas)
  note text,
  created_by uuid references public.profiles(id),    -- usuario Cocina que repartió
  created_by_name text,
  created_at timestamptz not null default now()
);
alter table public.food_distributions enable row level security;
drop policy if exists fd_select on public.food_distributions;
create policy fd_select on public.food_distributions for select to authenticated using (true);
drop policy if exists fd_write on public.food_distributions;
create policy fd_write on public.food_distributions for all to authenticated using (true) with check (true);
create index if not exists food_dist_date_idx on public.food_distributions(distribution_date);
create index if not exists food_dist_emp_idx on public.food_distributions(employee_id, distribution_date);
-- Tipo de comida por persona (desayuno/almuerzo/cena), 1 vez por día por persona.
alter table public.food_distributions add column if not exists meal_type text;
create unique index if not exists food_dist_person_meal_day
  on public.food_distributions (employee_id, meal_type, distribution_date)
  where meal_type is not null and employee_id is not null;

-- Distribución de comida POR EMPRESA: al escanear el QR de una empresa, la cocina
-- registra por comida (desayuno/almuerzo/cena) cuántas entregó ese día. Sugerido =
-- (máquinas de la empresa × 2) + 15. Una sola vez por (empresa, comida, día).
create table if not exists public.food_company_meals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  company_name text not null,
  meal_type text not null check (meal_type in ('desayuno','almuerzo','cena')),
  meal_date date not null,
  machines integer not null default 0,
  suggested integer not null default 0,
  delivered integer not null default 0 check (delivered >= 0),
  delivered_at timestamptz not null default now(),
  note text,
  created_by uuid references public.profiles(id),
  created_by_name text,
  created_by_cargo text,
  created_at timestamptz not null default now(),
  unique (company_id, meal_type, meal_date)
);
alter table public.food_company_meals enable row level security;
drop policy if exists fcm_select on public.food_company_meals;
create policy fcm_select on public.food_company_meals for select to authenticated using (true);
drop policy if exists fcm_write on public.food_company_meals;
create policy fcm_write on public.food_company_meals for all to authenticated using (true) with check (true);
create index if not exists fcm_date_idx on public.food_company_meals(meal_date);
create index if not exists fcm_company_idx on public.food_company_meals(company_id, meal_date);

-- ============================================================================
-- LOGIN BLINDADO POR CÉDULA
-- ============================================================================
-- El inicio de sesión es por CÉDULA + contraseña. Supabase Auth usa email, así que
-- esta función SEGURA (security definer) traduce la cédula al correo interno del
-- usuario. Devuelve NULL si la cédula no está registrada (o no tiene cédula), y en
-- ese caso el login muestra: "Pídele al administrador de sistemas que agregue la
-- CÉDULA para poder ingresar". No expone datos sensibles (el correo es sintético).
create or replace function public.login_email_for_cedula(p_cedula text)
  returns text
  language sql
  security definer
  set search_path = public, auth
as $fn$
  select au.email::text
  from auth.users au
  join public.profiles p on p.id = au.id
  where p.cedula = btrim(p_cedula)
    and coalesce(au.is_anonymous, false) = false
  limit 1
$fn$;
revoke all on function public.login_email_for_cedula(text) from public;
grant execute on function public.login_email_for_cedula(text) to anon, authenticated;

-- ── Blindaje del login: bloqueo por intentos fallidos ────────────────────────
-- Se cuenta cada contraseña incorrecta; al 3er intento el usuario queda BLOQUEADO
-- y solo un administrador puede desbloquearlo (desde la pantalla de Usuarios).
alter table public.profiles
  add column if not exists failed_attempts int not null default 0,
  add column if not exists locked boolean not null default false,
  add column if not exists locked_at timestamptz;

-- Estado de login por cédula: correo interno + si está bloqueado.
create or replace function public.login_status_for_cedula(p_cedula text)
  returns table(email text, locked boolean)
  language sql security definer set search_path = public, auth
as $fn$
  select au.email::text, coalesce(p.locked, false)
  from auth.users au
  join public.profiles p on p.id = au.id
  where p.cedula = btrim(p_cedula) and coalesce(au.is_anonymous, false) = false
  limit 1
$fn$;

-- Registra un intento fallido; bloquea al llegar a 3. Devuelve intentos + estado.
create or replace function public.register_failed_login(p_cedula text)
  returns table(attempts int, locked boolean)
  language sql security definer set search_path = public
as $fn$
  update public.profiles
  set failed_attempts = coalesce(failed_attempts, 0) + 1,
      locked = (coalesce(failed_attempts, 0) + 1) >= 3,
      locked_at = case when (coalesce(failed_attempts, 0) + 1) >= 3 then now() else locked_at end
  where btrim(cedula) = btrim(p_cedula)
  returning failed_attempts, locked
$fn$;

-- Limpia el contador al iniciar sesión correctamente.
create or replace function public.reset_failed_login(p_cedula text)
  returns void
  language sql security definer set search_path = public
as $fn$
  update public.profiles set failed_attempts = 0, locked = false, locked_at = null
  where btrim(cedula) = btrim(p_cedula)
$fn$;

revoke all on function public.login_status_for_cedula(text), public.register_failed_login(text), public.reset_failed_login(text) from public;
grant execute on function public.login_status_for_cedula(text), public.register_failed_login(text), public.reset_failed_login(text) to anon, authenticated;

-- ── LOGIN POR USUARIO ────────────────────────────────────────────────────────
-- Ahora el inicio de sesión es por USUARIO (máx. 10 caracteres) + contraseña. El
-- usuario es único (sin distinguir mayúsculas). Mismo blindaje de bloqueo por
-- intentos fallidos que la cédula (al 3er intento se bloquea; solo admin desbloquea).
alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_key on public.profiles (lower(username)) where username is not null;

-- Estado de login por usuario: correo interno + si está bloqueado.
create or replace function public.login_status_for_username(p_username text)
  returns table(email text, locked boolean)
  language sql security definer set search_path = public, auth
as $fn$
  select au.email::text, coalesce(p.locked, false)
  from auth.users au
  join public.profiles p on p.id = au.id
  where lower(btrim(p.username)) = lower(btrim(p_username)) and coalesce(au.is_anonymous, false) = false
  limit 1
$fn$;

-- Registra un intento fallido por usuario; bloquea al llegar a 3.
create or replace function public.register_failed_login_username(p_username text)
  returns table(attempts int, locked boolean)
  language sql security definer set search_path = public
as $fn$
  update public.profiles
  set failed_attempts = coalesce(failed_attempts, 0) + 1,
      locked = (coalesce(failed_attempts, 0) + 1) >= 3,
      locked_at = case when (coalesce(failed_attempts, 0) + 1) >= 3 then now() else locked_at end
  where lower(btrim(username)) = lower(btrim(p_username))
  returning failed_attempts, locked
$fn$;

-- Limpia el contador al iniciar sesión correctamente.
create or replace function public.reset_failed_login_username(p_username text)
  returns void
  language sql security definer set search_path = public
as $fn$
  update public.profiles set failed_attempts = 0, locked = false, locked_at = null
  where lower(btrim(username)) = lower(btrim(p_username))
$fn$;

revoke all on function public.login_status_for_username(text), public.register_failed_login_username(text), public.reset_failed_login_username(text) from public;
grant execute on function public.login_status_for_username(text), public.register_failed_login_username(text), public.reset_failed_login_username(text) to anon, authenticated;

-- ── DESFASE DE SECTORES EN EL MAPA (reubicación por admin) ───────────────────
-- Los sectores (polígonos KMZ) pueden quedar un poco desfasados sobre el satélite.
-- El admin los arrastra en el mapa y aquí se guarda el desfase (lat/lng) por sector.
-- Se aplica al dibujarlos para todos. Solo los administradores pueden escribir.
create table if not exists public.map_zone_offsets (
  zone_name text primary key,
  d_lat double precision not null default 0,
  d_lng double precision not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.map_zone_offsets enable row level security;
drop policy if exists "zone_off_read" on public.map_zone_offsets;
create policy "zone_off_read"  on public.map_zone_offsets for select using (auth.role() = 'authenticated');
drop policy if exists "zone_off_write" on public.map_zone_offsets;
create policy "zone_off_write" on public.map_zone_offsets for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- CONTROL DE PAGO A PERSONAL (dentro de Nómina)
-- Paga por PRECIO por hora / día / semana, definido POR TRABAJADOR (employees:
-- precio_hora/precio_dia/precio_semana). El período elige el modo (hora/dia/semana)
-- y el devengado = precio_del_modo × cantidad (horas / días / semanas trabajadas).
-- Los operadores se cargan AUTOMÁTICO desde operator_assignments (por cédula, dentro
-- del rango) y el resto del personal a mano. Con only_validated, una jornada solo
-- suma si tiene visita del supervisor (supervisor_visits, misma máquina y fecha,
-- status 'trabajando'). Bonos, deducciones y abonos con saldo (staff_pay_payments).
-- ============================================================================
create table if not exists public.staff_pay_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  name text not null,
  period_type text not null default 'semana' check (period_type in ('dia','semana','quincena')),
  date_from date not null,
  date_to date not null,
  mode text not null default 'dia' check (mode in ('hora','dia','semana')),
  only_validated boolean not null default true,
  status text not null default 'borrador' check (status in ('borrador','aprobada','pagada')),
  total_amount numeric(14,2) not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_spp_company on public.staff_pay_periods(company_id);
create index if not exists idx_spp_status on public.staff_pay_periods(status);

create table if not exists public.staff_pay_items (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.staff_pay_periods(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  cedula text,
  person_name text not null,
  cargo text,
  source text not null default 'manual' check (source in ('auto','manual')),
  precio_hora numeric(14,2) not null default 0,
  precio_dia numeric(14,2) not null default 0,
  precio_semana numeric(14,2) not null default 0,
  dias numeric(8,2) not null default 0,
  horas numeric(10,2) not null default 0,
  semanas numeric(8,2) not null default 0,
  jornadas_validadas int not null default 0,
  jornadas_pendientes int not null default 0,
  overridden boolean not null default false,
  devengado numeric(14,2) not null default 0,
  bonos jsonb not null default '[]'::jsonb,
  deducciones jsonb not null default '[]'::jsonb,
  total numeric(14,2) not null default 0,
  nota text,
  created_at timestamptz not null default now()
);
-- Migración de columnas para tablas ya creadas.
alter table public.staff_pay_items add column if not exists precio_hora numeric(14,2) not null default 0;
alter table public.staff_pay_items add column if not exists precio_dia numeric(14,2) not null default 0;
alter table public.staff_pay_items add column if not exists precio_semana numeric(14,2) not null default 0;
alter table public.staff_pay_items add column if not exists semanas numeric(8,2) not null default 0;
create index if not exists idx_spi_period on public.staff_pay_items(period_id);
create index if not exists idx_spi_cedula on public.staff_pay_items(cedula);

create table if not exists public.staff_pay_payments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.staff_pay_items(id) on delete cascade,
  monto numeric(14,2) not null,
  metodo text not null default 'efectivo',
  fecha date not null default (now() at time zone 'America/Caracas')::date,
  nota text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_spp2_item on public.staff_pay_payments(item_id);

alter table public.staff_pay_config   enable row level security;
alter table public.staff_pay_periods  enable row level security;
alter table public.staff_pay_items    enable row level security;
alter table public.staff_pay_payments enable row level security;
drop policy if exists spc_all on public.staff_pay_config;
create policy spc_all on public.staff_pay_config for all to authenticated using (true) with check (true);
drop policy if exists spp_all on public.staff_pay_periods;
create policy spp_all on public.staff_pay_periods for all to authenticated using (true) with check (true);
drop policy if exists spi_all on public.staff_pay_items;
create policy spi_all on public.staff_pay_items for all to authenticated using (true) with check (true);
drop policy if exists spp2_all on public.staff_pay_payments;
create policy spp2_all on public.staff_pay_payments for all to authenticated using (true) with check (true);

-- ============================================================================
-- TIEMPO REAL (Realtime): tablas cuyas pantallas se refrescan solas al cambiar.
-- Sin estar en la publicación `supabase_realtime`, el cliente se suscribe pero la
-- BD nunca envía los cambios (la pantalla no se actualiza hasta refrescar a mano).
-- `add table` falla si la tabla ya está publicada; por eso se ignora el error.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'employees', 'food_distributions', 'food_company_meals', 'supervisor_visits',
    'operator_assignments', 'inventory_movements', 'inventory_items',
    -- Control de maquinaria, reportes y pagos: para que el alta/edición de una
    -- máquina, jornada, flete, etc. se vea al instante sin refrescar a mano.
    'machinery', 'machine_rounds', 'fletes', 'companies', 'machine_guards',
    'company_payments', 'control_closures', 'maintenance_requests'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when others then null;
    end;
  end loop;
end $$;

-- ============================================================================
-- Poder ELIMINAR usuarios sin bloqueos por claves foráneas.
-- Varias tablas referenciaban public.profiles(id) con NO ACTION, lo que impedía
-- borrar a un usuario que tuviera cualquier registro relacionado (el borrado
-- fallaba con "Edge Function returned a non-2xx status code"). Se ajustan:
--  · supervisor_visits.supervisor_id → ON DELETE CASCADE (sus visitas se van con él).
--  · columnas de auditoría (created_by / requested_by / approved_by) → SET NULL
--    (se conserva el registro de negocio, solo se pierde quién lo creó).
-- Bloque idempotente: recrea cada FK con la regla correcta.
-- ============================================================================
do $$
begin
  alter table public.supervisor_visits drop constraint if exists supervisor_visits_supervisor_id_fkey;
  alter table public.supervisor_visits add constraint supervisor_visits_supervisor_id_fkey
    foreign key (supervisor_id) references public.profiles(id) on delete cascade;

  alter table public.authorizations drop constraint if exists authorizations_approved_by_fkey;
  alter table public.authorizations add constraint authorizations_approved_by_fkey
    foreign key (approved_by) references public.profiles(id) on delete set null;
  alter table public.authorizations drop constraint if exists authorizations_requested_by_fkey;
  alter table public.authorizations add constraint authorizations_requested_by_fkey
    foreign key (requested_by) references public.profiles(id) on delete set null;

  alter table public.dispatches drop constraint if exists dispatches_created_by_fkey;
  alter table public.dispatches add constraint dispatches_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

  alter table public.food_company_meals drop constraint if exists food_company_meals_created_by_fkey;
  alter table public.food_company_meals add constraint food_company_meals_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

  alter table public.food_distributions drop constraint if exists food_distributions_created_by_fkey;
  alter table public.food_distributions add constraint food_distributions_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

  alter table public.fuel_intakes drop constraint if exists fuel_intakes_created_by_fkey;
  alter table public.fuel_intakes add constraint fuel_intakes_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;

  alter table public.transfers drop constraint if exists transfers_created_by_fkey;
  alter table public.transfers add constraint transfers_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;
end $$;

-- ============================================================================
-- CONTROL DE ASISTENCIA (módulo Nómina): marcas de ENTRADA/SALIDA por carnet.
-- Un registro por marca (bitácora). El día (work_date) y la hora se calculan en
-- zona Caracas desde la app. Se permiten VARIOS pares por día (almuerzo, etc.).
-- Solo usuarios con el módulo 'asistencia' (p. ej. rol ALMACENISTA) pueden marcar.
-- ============================================================================
create table if not exists public.attendance (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  ts           timestamptz not null default now(),   -- momento exacto de la marca
  work_date    date not null,                         -- fecha (Caracas) para agrupar por día
  kind         text not null check (kind in ('entrada','salida')),
  recorded_by  uuid references public.profiles(id) on delete set null, -- quién marcó
  created_at   timestamptz not null default now()
);
create index if not exists idx_attendance_date on public.attendance(work_date, employee_id);
create index if not exists idx_attendance_emp  on public.attendance(employee_id, ts);
alter table public.attendance enable row level security;
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated using (true);
drop policy if exists attendance_write on public.attendance;
create policy attendance_write on public.attendance for all to authenticated using (true) with check (true);

-- ============================================================================
-- DISTRIBUCIÓN DE UNIFORMES: ENTREGAS (cuántas camisas/pantalones/zapatos se le
-- han entregado a cada trabajador, con fecha y hora). Una fila por entrega; se
-- acumulan varias por persona. Las TALLAS siguen en la ficha del empleado.
-- ============================================================================
create table if not exists public.uniform_deliveries (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  camisas      integer not null default 0 check (camisas >= 0),
  pantalones   integer not null default 0 check (pantalones >= 0),
  zapatos      integer not null default 0 check (zapatos >= 0),
  delivered_at timestamptz not null default now(),   -- momento exacto de la entrega
  work_date    date not null,                         -- fecha (Caracas) para agrupar
  note         text,
  recorded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_unifdel_emp  on public.uniform_deliveries(employee_id, delivered_at);
create index if not exists idx_unifdel_date on public.uniform_deliveries(work_date);
alter table public.uniform_deliveries enable row level security;
drop policy if exists unifdel_select on public.uniform_deliveries;
create policy unifdel_select on public.uniform_deliveries for select to authenticated using (true);
drop policy if exists unifdel_write on public.uniform_deliveries;
create policy unifdel_write on public.uniform_deliveries for all to authenticated using (true) with check (true);

-- ============================================================================
-- FIN DEL ESQUEMA
-- ============================================================================
