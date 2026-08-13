-- ============================================================================
-- Obras Públicas — REPORTE DIARIO DE ACTIVIDADES (por supervisora) + base acumulada
-- Aislado del módulo de inspectores (tablas op_*). Cada supervisora llena su reporte
-- del día; el dashboard suma todos los del día y calcula los acumulados = base + suma.
-- Correr en Supabase (SQL Editor) del proyecto ddcwqmuqdqnsrtpticpx.
-- ============================================================================

-- 1) Reporte diario por supervisora (uno por supervisor y fecha).
create table if not exists public.op_daily_reports (
  id                  uuid primary key default gen_random_uuid(),
  report_date         date not null,
  supervisor_id       uuid references public.profiles(id),
  supervisor_name     text,
  reporte_no          integer,                       -- N° de reporte (OPP es un sector, no el nombre del reporte)
  edificio            text,                          -- Edificio del reporte (catálogo compartido)
  m3_removidos_dia    numeric not null default 0,    -- M³ removidos (controlada) del día
  m3_acarreo_dia      numeric not null default 0,    -- M³ acarreo de vestigios del día
  cuerpos_dia         integer not null default 0,    -- Cuerpos siniestrados del día
  traslado_camion_dia integer not null default 0,    -- Traslado camión del día
  observacion         text,                          -- Observación del día
  recorded_by         uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (supervisor_id, report_date)
);
create index if not exists op_daily_reports_date_idx on public.op_daily_reports (report_date);
-- Si la tabla ya existía sin la columna edificio, agregarla:
alter table public.op_daily_reports add column if not exists edificio text;

-- 2) Base acumulada de arranque (una sola fila). Los reportes con
--    report_date > base_date se suman a la base para el "desde inicio".
create table if not exists public.op_report_settings (
  id           integer primary key default 1,
  base_m3      numeric not null default 0,   -- m³ acumulados hasta base_date (removidos + acarreo)
  base_cuerpos numeric not null default 0,   -- cuerpos siniestrados acumulados hasta base_date
  base_date    date,                         -- corte: se suman los reportes con fecha > base_date
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id),
  constraint op_report_settings_singleton check (id = 1)
);
insert into public.op_report_settings (id, base_m3, base_cuerpos, base_date)
values (1, 21848, 194, '2026-08-12')
on conflict (id) do nothing;

-- 3) RLS: igual que el resto de op_* → lectura autenticada, escritura no-anon.
alter table public.op_daily_reports  enable row level security;
alter table public.op_report_settings enable row level security;

drop policy if exists op_daily_reports_rw   on public.op_daily_reports;
drop policy if exists op_report_settings_rw on public.op_report_settings;
create policy op_daily_reports_rw   on public.op_daily_reports   for all to authenticated using (true) with check (true);
create policy op_report_settings_rw on public.op_report_settings for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.op_daily_reports  to authenticated;
grant select, insert, update          on public.op_report_settings to authenticated;
