-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: machine_worked_flags()
-- Devuelve el CONJUNTO de máquinas que tienen ALGUNA hora trabajada (histórico
-- completo), agregado en el SERVIDOR. Antes el reporte "Conteo de equipos"
-- (ReportsScreen.generateConteo) descargaba TODA la tabla machine_rounds (crece sin
-- límite) solo para calcular un BOOLEANO "tiene horas / no tiene horas" por máquina;
-- con esto baja ~una fila por máquina con horas en vez de una por máquina-día.
--
-- Fórmula IDÉNTICA a workedFromShifts (src/lib/hours.ts):
--   worked = max(0, max(0,day) + max(0,night) - stopped) + max(0, overtime)
-- Dedup por (máquina, día) tomando el MÁXIMO worked (determinista; equivalente en el
-- booleano al "último gana" del cliente ya que worked >= 0). Solo máquinas con Σ > 0.
-- Verificado contra el escaneo del cliente: mismos 269 ids, 0 diferencias.
--
-- Correr en Supabase → SQL Editor. Idempotente (CREATE OR REPLACE). El cliente cae al
-- escaneo completo si el RPC no existe (mismo patrón que machine_total_hours()).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.machine_worked_flags()
returns table (machinery_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select machinery_id
  from (
    select machinery_id, round_date,
           max(
             greatest(0,
               greatest(0, coalesce(day_hours, 0)::numeric)
               + greatest(0, coalesce(night_hours, 0)::numeric)
               - coalesce(hours_stopped, 0)::numeric
             )
             + greatest(0, coalesce(overtime_hours, 0)::numeric)
           ) as worked
    from public.machine_rounds
    group by machinery_id, round_date
  ) t
  group by machinery_id
  having sum(worked) > 0;
$$;

grant execute on function public.machine_worked_flags() to anon, authenticated;
