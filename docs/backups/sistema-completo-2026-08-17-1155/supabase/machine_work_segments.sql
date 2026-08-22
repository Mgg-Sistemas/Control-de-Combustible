-- ============================================================================
-- machine_work_segments: historial AUDITABLE de cada tramo de trabajo de una
-- máquina (hora de inicio / hora de parada), en PARALELO a day_hours/night_hours
-- de public.machine_rounds (que NO se toca — nómina y reportes siguen
-- dependiendo de esas columnas acumuladas). Esta tabla solo agrega trazabilidad
-- fila-por-tramo; no reemplaza ni modifica el flujo existente.
-- Aditivo, idempotente. Correr una vez en Supabase.
-- ============================================================================
create table if not exists public.machine_work_segments (
  id            uuid primary key default gen_random_uuid(),
  machinery_id  uuid not null references public.machinery(id) on delete cascade,
  round_date    date not null,
  shift         text not null check (shift in ('day','night')),
  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  hours         numeric(6,2) not null,
  source        text not null check (source in ('manual_finish','parada_averia','parada_no_trabajo','auto_close','ajuste_manual')),
  recorded_by   uuid references auth.users(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_mws_machinery_date on public.machine_work_segments(machinery_id, round_date);
create index if not exists idx_mws_round_date on public.machine_work_segments(round_date);

alter table public.machine_work_segments enable row level security;
drop policy if exists mws_select on public.machine_work_segments;
create policy mws_select on public.machine_work_segments for select to authenticated using (true);
drop policy if exists mws_write on public.machine_work_segments;
create policy mws_write on public.machine_work_segments for all to authenticated using (true) with check (true);

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.machine_work_segments';
  exception when duplicate_object then null; when others then null;
  end;
end $$;
