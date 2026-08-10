-- ============================================================================
-- ASIGNACIÓN PLANEADA OPERADOR ↔ MÁQUINA (Coordinador de Operadores)
-- ----------------------------------------------------------------------------
-- A diferencia de `operator_assignments` (se crea sola cuando el operador
-- escanea el QR y arranca su jornada — un registro de lo que YA pasó), esta
-- tabla guarda lo que el COORDINADOR planeó: quién debería estar en cada
-- máquina, por turno, antes de que el operador llegue. Mismo patrón que
-- `machine_inspectors` (ver inspector_asignacion.sql), un operador planeado
-- por máquina+turno.
--
-- Correr una sola vez en Supabase → SQL Editor. Es idempotente.
-- ============================================================================
create table if not exists public.machine_operators (
  id            uuid primary key default gen_random_uuid(),
  machinery_id  uuid not null references public.machinery(id) on delete cascade,
  employee_id   uuid references public.employees(id) on delete cascade,
  operator_name text not null,
  cedula        text,
  shift         text not null default 'day',   -- 'day' (☀️) | 'night' (🌙)
  assigned_by   uuid references public.profiles(id) on delete set null,
  assigned_at   timestamptz not null default now(),
  active        boolean not null default true
);
-- Un operador planeado por máquina+turno (día/noche). Reasignar reemplaza.
create unique index if not exists mo_machine_shift_key on public.machine_operators(machinery_id, shift);

alter table public.machine_operators enable row level security;

-- App interna: lectura/escritura para usuarios autenticados (mismo criterio que machine_inspectors).
drop policy if exists mo_select on public.machine_operators;
drop policy if exists mo_write  on public.machine_operators;
create policy mo_select on public.machine_operators for select to authenticated using (true);
create policy mo_write  on public.machine_operators for all    to authenticated using (true) with check (true);

create index if not exists idx_mo_employee on public.machine_operators(employee_id);
create index if not exists idx_mo_machine  on public.machine_operators(machinery_id);

-- Realtime (para que la vista del coordinador se refresque al instante). Opcional.
do $$ begin
  begin
    execute 'alter publication supabase_realtime add table public.machine_operators';
  exception when others then null;
  end;
end $$;
