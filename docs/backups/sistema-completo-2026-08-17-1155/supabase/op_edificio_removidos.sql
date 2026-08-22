-- ============================================================================
-- M³ REMOVIDOS POR EDIFICIO (Obras Públicas) — 13-ago-2026.
-- El segmento "m³ removidos hoy" deja de capturarse POR MÁQUINA y pasa a un
-- módulo INDEPENDIENTE POR EDIFICIO: cada día el supervisor registra los
-- edificios tratados con sus m³ removidos del día, agrupados por SUB-SECTOR
-- (El Palmar / Los Corales…).
--
-- Modelo (regla del cliente):
--   • "m³ removidos hoy"  → MANUAL cada día, por edificio.
--   • "m³ acumulados"     → MANUAL la PRIMERA vez (base histórica), luego el
--                           sistema lo va incrementando con los removidos de los
--                           días POSTERIORES a la fecha base:
--                             acumulado(edif) = base_m3 + Σ removidos(fecha > base_date)
--                           (mismo patrón que el reporte global op_report_settings).
--
-- Correr una vez en Supabase → SQL Editor.
-- ============================================================================

-- 1) SUB-SECTOR en el catálogo de edificios (El Palmar / Los Corales…). Nullable:
--    los edificios sin sub-sector caen en un grupo "SIN SUB-SECTOR".
alter table public.edificios
  add column if not exists sub_sector text;

-- 2) Removidos del DÍA por edificio (uno por edificio + fecha).
create table if not exists public.op_edificio_removidos (
  id             uuid primary key default gen_random_uuid(),
  edificio       text not null,
  report_date    date not null,
  m3             numeric not null default 0,
  supervisor_id  uuid,
  supervisor_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (edificio, report_date)
);
create index if not exists op_edificio_removidos_fecha_idx on public.op_edificio_removidos (report_date);
create index if not exists op_edificio_removidos_edif_idx  on public.op_edificio_removidos (edificio);

-- 3) BASE acumulada por edificio (el acumulado que se teclea la 1ª vez).
create table if not exists public.op_edificio_base (
  edificio    text primary key,
  base_m3     numeric not null default 0,
  base_date   date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- RLS: acceso a usuarios autenticados (mismo criterio que el resto de op_*).
alter table public.op_edificio_removidos enable row level security;
alter table public.op_edificio_base      enable row level security;
do $$ begin
  create policy op_edificio_removidos_all on public.op_edificio_removidos for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy op_edificio_base_all on public.op_edificio_base for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Realtime: para que el teléfono y el panel de Obras Públicas se sincronicen en vivo.
do $$
declare t text;
begin
  foreach t in array array['op_edificio_removidos', 'op_edificio_base'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- ya estaba en la publicación
      when undefined_object then null;   -- la publicación no existe (entorno sin realtime)
    end;
  end loop;
end $$;
