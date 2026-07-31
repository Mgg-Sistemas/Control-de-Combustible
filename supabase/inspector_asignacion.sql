-- ============================================================================
-- ASIGNACIÓN INSPECTOR ↔ MÁQUINA  ("CHECK MÁQUINA" desde el teléfono)
-- ----------------------------------------------------------------------------
-- Cada inspector, desde su sesión, ve SOLO las máquinas que tiene asignadas.
-- La asignación se crea/quita con el botón "✅ CHECK MÁQUINA" (casa la persona
-- logueada con la máquina). Es INDEPENDIENTE de la custodia militar
-- (machine_guards) y de las visitas de inspección (supervisor_visits): no
-- ensucia esas vistas ni sus reportes.
--
-- Correr una sola vez en Supabase → SQL Editor. Es idempotente.
-- ============================================================================
create table if not exists public.machine_inspectors (
  id            uuid primary key default gen_random_uuid(),
  machinery_id  uuid not null references public.machinery(id) on delete cascade,
  inspector_id  uuid references public.profiles(id) on delete cascade,
  inspector_name text not null,
  shift         text not null default 'day',   -- 'day' (☀️) | 'night' (🌙)
  assigned_at   timestamptz not null default now(),
  active        boolean not null default true
);
-- Un inspector por máquina+turno (día/noche). Cada máquina → 2 inspectores.
create unique index if not exists mi_machine_shift_key on public.machine_inspectors(machinery_id, shift);

alter table public.machine_inspectors enable row level security;

-- App interna: lectura/escritura para usuarios autenticados (mismo criterio que machine_guards).
drop policy if exists mi_read   on public.machine_inspectors;
drop policy if exists mi_insert on public.machine_inspectors;
drop policy if exists mi_update on public.machine_inspectors;
drop policy if exists mi_delete on public.machine_inspectors;
create policy mi_read   on public.machine_inspectors for select to authenticated using (true);
create policy mi_insert on public.machine_inspectors for insert to authenticated with check (true);
create policy mi_update on public.machine_inspectors for update to authenticated using (true) with check (true);
create policy mi_delete on public.machine_inspectors for delete to authenticated using (true);

create index if not exists idx_mi_inspector on public.machine_inspectors(inspector_id);
create index if not exists idx_mi_machine   on public.machine_inspectors(machinery_id);

-- Realtime (para que la lista del inspector se refresque al instante). Opcional.
do $$ begin
  begin
    execute 'alter publication supabase_realtime add table public.machine_inspectors';
  exception when others then null;
  end;
end $$;
