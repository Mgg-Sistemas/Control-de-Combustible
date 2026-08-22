-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: machine_total_hours()
-- Devuelve las HORAS TOTALES (histórico completo) por máquina, agregadas en el
-- SERVIDOR. Antes el cliente descargaba TODA la tabla machine_rounds (crece sin
-- límite) solo para sumar day_hours + night_hours por máquina; con esto baja una
-- fila por máquina en vez de una fila por máquina-día.
--
-- Fórmula IDÉNTICA a la del cliente (InspectionsSummary):
--   total = Σ (day_hours + night_hours)   [nulos = 0]
--
-- Correr en Supabase → SQL Editor. Idempotente (CREATE OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.machine_total_hours()
returns table (machinery_id uuid, total_hours numeric)
language sql
stable
security invoker
as $$
  select
    machinery_id,
    sum(coalesce(day_hours, 0) + coalesce(night_hours, 0))::numeric as total_hours
  from machine_rounds
  group by machinery_id;
$$;

grant execute on function public.machine_total_hours() to anon, authenticated;
