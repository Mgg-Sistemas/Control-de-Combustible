-- ============================================================================
-- ASISTENCIA DE CAMIONES (volteos/volquetas). La asistencia se toma AUTOMÁTICA al
-- iniciar la jornada del camión (se deriva de machine_rounds); esta tabla guarda
-- SOLO los ajustes MANUALES (marcar Presente/Ausente a mano) por fecha.
-- Idempotente: se puede correr las veces que haga falta.
-- ============================================================================

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

-- Lectura y escritura para cualquier autenticado (staff/inspector/coordinador).
drop policy if exists truck_att_select on public.truck_attendance;
create policy truck_att_select on public.truck_attendance for select to authenticated using (true);
drop policy if exists truck_att_write on public.truck_attendance;
create policy truck_att_write on public.truck_attendance for all to authenticated using (true) with check (true);

-- GRANTS (imprescindible al crear tablas desde el SQL Editor: sin esto los SELECT
-- devuelven vacío aunque la RLS lo permita).
grant select, insert, update, delete on public.truck_attendance to anon, authenticated;

-- Realtime: que la lista se actualice sola entre dispositivos.
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.truck_attendance';
  exception when duplicate_object then null; when others then null;
  end;
end $$;
