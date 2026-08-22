-- ============================================================================
-- SERVICIOS de máquina que NO son combustible: ACEITE y AIRE — registrados
-- desde la misma pantalla del chofer (Surtir combustible → ahora con selector
-- de tipo). Tabla APARTE de `dispatches` a propósito: `dispatches` tiene el
-- trigger `one_fuel_per_machine_per_day` (1 carga de combustible por máquina
-- por día) y descuenta stock de un tanque — ni aceite ni aire deben chocar con
-- esas reglas ni tocar el stock de combustible.
-- ============================================================================
create table if not exists public.machine_services (
  id uuid primary key default gen_random_uuid(),
  machinery_id uuid not null references public.machinery(id) on delete cascade,
  service_date date not null,
  kind text not null check (kind in ('aceite','aire')),
  liters numeric(12,2),           -- solo aplica a 'aceite'; null en 'aire'
  price_per_liter numeric(12,2),  -- solo aplica a 'aceite'
  total_amount numeric(12,2),
  operator text,
  notes text,
  photos text[],
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_machine_services_machinery on public.machine_services(machinery_id);
create index if not exists idx_machine_services_date on public.machine_services(service_date);

alter table public.machine_services enable row level security;
drop policy if exists machine_services_select on public.machine_services;
create policy machine_services_select on public.machine_services for select to authenticated using (true);
-- Mismo criterio que dispatches/tanks/vehicles/machinery: lectura todos, escritura staff.
drop policy if exists machine_services_write on public.machine_services;
create policy machine_services_write on public.machine_services for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Realtime (para que otras pantallas/dispositivos vean el registro en vivo).
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'machine_services'
  ) then
    alter publication supabase_realtime add table public.machine_services;
  end if;
end $$;
