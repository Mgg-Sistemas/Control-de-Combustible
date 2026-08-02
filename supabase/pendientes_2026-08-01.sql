-- ============================================================================
-- PENDIENTES ESTRUCTURALES (consolidado) — correr UNA VEZ en el SQL Editor.
-- TODO es idempotente (if not exists / create or replace / drop policy if exists),
-- así que es SEGURO aunque parte ya esté aplicada: lo ya hecho queda igual.
-- ============================================================================

-- 1) ASISTENCIA DE CAMIONES (marcar Presente/Ausente a mano; la auto se deriva de la jornada)
create table if not exists public.truck_attendance (
  machinery_id uuid not null references public.machinery(id) on delete cascade,
  work_date    date not null,
  status       text not null check (status in ('presente', 'ausente')),
  marked_by    uuid references auth.users(id) on delete set null,
  marked_by_name text,
  note         text,
  marked_at    timestamptz not null default now(),
  primary key (machinery_id, work_date)
);
create index if not exists idx_truck_att_date on public.truck_attendance(work_date);
alter table public.truck_attendance enable row level security;
drop policy if exists truck_att_select on public.truck_attendance;
create policy truck_att_select on public.truck_attendance for select to authenticated using (true);
drop policy if exists truck_att_write on public.truck_attendance;
create policy truck_att_write on public.truck_attendance for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.truck_attendance to anon, authenticated;
do $$ begin begin execute 'alter publication supabase_realtime add table public.truck_attendance';
  exception when duplicate_object then null; when others then null; end; end $$;

-- 2) PARROQUIA y SECTOR por máquina (editables en Catálogo; se ven en check-in/reportes)
alter table public.machinery add column if not exists parroquia text;
alter table public.machinery add column if not exists sector text;

-- 3) FIX RLS de INSPECCIONES DE MAQUINARIA (permite guardar a quien tenga el módulo, no solo staff)
drop policy if exists mi_write on public.machine_inspections;
create policy mi_write on public.machine_inspections for all to authenticated
  using (public.is_staff() or public.can_write_module('inspecciones_maq'))
  with check (public.is_staff() or public.can_write_module('inspecciones_maq'));

-- 4) TABULADOR POR CARGO (staff_cargo_tariffs) + precios quincena/mes
create table if not exists public.staff_cargo_tariffs (
  id uuid primary key default gen_random_uuid(),
  cargo text not null,
  departamento text,
  precio_hora numeric(14,2) not null default 0,
  precio_dia numeric(14,2) not null default 0,
  precio_noche numeric(14,2) not null default 0,
  precio_semana numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (cargo)
);
alter table public.staff_cargo_tariffs enable row level security;
drop policy if exists sct_all on public.staff_cargo_tariffs;
create policy sct_all on public.staff_cargo_tariffs for all to authenticated using (true) with check (true);
alter table public.staff_cargo_tariffs add column if not exists precio_quincena numeric(14,2) not null default 0;
alter table public.staff_cargo_tariffs add column if not exists precio_mes numeric(14,2) not null default 0;

-- 5) PRECIO NOCHE en pago por período (día/noche por jornada)
alter table public.employees add column if not exists precio_hora numeric;
alter table public.employees add column if not exists precio_dia numeric;
alter table public.employees add column if not exists precio_noche numeric;
alter table public.employees add column if not exists precio_semana numeric;
alter table public.staff_pay_items add column if not exists precio_dia numeric(14,2) not null default 0;
alter table public.staff_pay_items add column if not exists precio_noche numeric(14,2) not null default 0;
alter table public.staff_pay_items add column if not exists dias_noche numeric(8,2) not null default 0;

-- 6) PAGO A PERSONAL "POR PERSONA" (ledger staff_payments)
alter table public.employees add column if not exists precio_quincena numeric;
alter table public.employees add column if not exists precio_mes      numeric;
create table if not exists public.staff_payments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  cedula text,
  person_name text not null,
  cargo text,
  fecha date not null default current_date,
  frecuencia text not null default 'diario',
  jornada text,
  cantidad numeric(8,2) not null default 1,
  precio_unit numeric(14,2) not null default 0,
  monto numeric(14,2) not null default 0,
  metodo text,
  banco text,
  cuenta text,
  concepto text,
  nota text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sp_employee on public.staff_payments(employee_id);
create index if not exists idx_sp_cedula   on public.staff_payments(cedula);
create index if not exists idx_sp_fecha    on public.staff_payments(fecha);
alter table public.staff_payments enable row level security;
drop policy if exists sp_all on public.staff_payments;
create policy sp_all on public.staff_payments for all to authenticated using (true) with check (true);
alter table public.staff_payments add column if not exists cantidad_dia   numeric(8,2)  not null default 0;
alter table public.staff_payments add column if not exists cantidad_noche numeric(8,2)  not null default 0;
alter table public.staff_payments add column if not exists precio_dia     numeric(14,2) not null default 0;
alter table public.staff_payments add column if not exists precio_noche   numeric(14,2) not null default 0;
alter table public.staff_payments add column if not exists fecha_hasta date;
