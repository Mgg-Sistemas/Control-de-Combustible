-- ============================================================================
-- VACIAR el módulo de Obras Públicas (borrón total) — 13-ago-2026.
-- Todo lo cargado eran PRUEBAS. Borra TODAS las tablas op_*:
--   datos (removidos, bases, reportes, horas, visitas, mantenimiento, externas)
--   + configuración (asignaciones máquina↔supervisor y settings/acumulado base).
-- Queda como recién instalado.
--
-- NO toca public.edificios (catálogo COMPARTIDO con inspectores) ni ninguna otra
-- tabla del sistema. Correr UNA vez en el SQL Editor de Supabase.
-- ============================================================================

truncate table
  public.op_daily_reports,
  public.op_report_settings,
  public.op_external_machines,
  public.op_edificio_removidos,
  public.op_edificio_base,
  public.op_machine_supervisors,
  public.op_machine_rounds,
  public.op_maintenance,
  public.op_supervisor_visits
restart identity;

-- Verificación: todo debe quedar en 0.
select 'op_daily_reports'      as tabla, count(*) as filas from public.op_daily_reports
union all select 'op_report_settings',     count(*) from public.op_report_settings
union all select 'op_external_machines',    count(*) from public.op_external_machines
union all select 'op_edificio_removidos',   count(*) from public.op_edificio_removidos
union all select 'op_edificio_base',        count(*) from public.op_edificio_base
union all select 'op_machine_supervisors',  count(*) from public.op_machine_supervisors
union all select 'op_machine_rounds',       count(*) from public.op_machine_rounds
union all select 'op_maintenance',          count(*) from public.op_maintenance
union all select 'op_supervisor_visits',    count(*) from public.op_supervisor_visits
order by tabla;
