-- ============================================================================
-- Submódulo NÓMINA → DISTRIBUCIÓN DE DÍAS LIBRES (por TIPO DE CARGO).
-- Igual idea que "Distribución de guardias" (Inspecciones) pero la unidad es el
-- CARGO, no la persona: cada cargo tiene una SEMANA LIBRE dentro del ciclo,
-- autogenerada (rotación) y editable. Toda la gente de ese cargo descansa esa
-- semana. Los cargos salen EN VIVO del personal activo (employees.status='activo'),
-- así que acá SOLO se guardan los rangos de descanso por cargo.
-- Correr en Supabase (SQL Editor). Idempotente.
-- ============================================================================

create table if not exists public.dias_libres_cargo (
  id         uuid primary key default gen_random_uuid(),
  cargo      text not null,                 -- nombre del cargo (employees.cargo)
  from_date  date not null,                 -- inicio de la semana libre
  to_date    date not null,                 -- fin de la semana libre
  grupo      text,                          -- letra de semana (A/B/C…) para color/orden
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists dias_libres_cargo_cargo_idx on public.dias_libres_cargo (cargo);
create index if not exists dias_libres_cargo_fecha_idx on public.dias_libres_cargo (from_date, to_date);

-- RLS: lectura/escritura autenticada (igual que guard_shifts y el resto de módulos).
alter table public.dias_libres_cargo enable row level security;
drop policy if exists dias_libres_cargo_rw on public.dias_libres_cargo;
create policy dias_libres_cargo_rw on public.dias_libres_cargo for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.dias_libres_cargo to authenticated;

-- Realtime (para que la distribución se refresque en vivo entre dispositivos).
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.dias_libres_cargo'; exception when others then null; end;
end $$;
