-- ============================================================================
-- PAGO A PERSONAL — "POR PERSONA" (ledger de movimientos) + tarifas quincena/mes
-- Correr UNA VEZ en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

-- 1) Tarifas nuevas por CARGO (tabulador) y por EMPLEADO: quincena y mes.
alter table public.staff_cargo_tariffs add column if not exists precio_quincena numeric(14,2) not null default 0;
alter table public.staff_cargo_tariffs add column if not exists precio_mes      numeric(14,2) not null default 0;

alter table public.employees add column if not exists precio_quincena numeric;
alter table public.employees add column if not exists precio_mes      numeric;

-- 2) Movimientos de pago POR PERSONA (independientes de los períodos de nómina).
create table if not exists public.staff_payments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  cedula text,
  person_name text not null,
  cargo text,
  fecha date not null default current_date,
  frecuencia text not null default 'diario',  -- 'diario' | 'semanal' | 'quincenal' | 'mensual'
  jornada text,                               -- 'dia' | 'noche' | null (solo diario)
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

-- 3) "Diario" con día Y noche juntos en un mismo pago.
alter table public.staff_payments add column if not exists cantidad_dia   numeric(8,2)  not null default 0;
alter table public.staff_payments add column if not exists cantidad_noche numeric(8,2)  not null default 0;
alter table public.staff_payments add column if not exists precio_dia     numeric(14,2) not null default 0;
alter table public.staff_payments add column if not exists precio_noche   numeric(14,2) not null default 0;
