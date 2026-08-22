-- ============================================================================
-- DIAGNÓSTICO — SOLO LECTURA. No cambia absolutamente nada.
--
-- Responde dos preguntas:
--   1) ¿Están programados y corriendo los 10 crons que sostienen las jornadas?
--   2) ¿Cuántas jornadas quedaron ABIERTAS sin cerrar (y desde cuándo)?
--
-- Motivo (17-ago-2026): el reporte de CESAR FLAMES del 16/08 dio 137.38 h en el
-- teléfono y 35.38 h en el Histórico. La causa es que ~8-10 jornadas nunca
-- cerraron, así que `day_hours` siguió en 0. Si el auto-cierre no está corriendo,
-- esto se repite cada noche.
--
-- Correr en Supabase → SQL Editor. Copiar el resultado de los 5 bloques.
-- ============================================================================
set time zone 'America/Caracas';

-- ── 1) ¿Qué crons existen y están activos? ──────────────────────────────────
-- Se esperan EXACTAMENTE estos 10. Si falta alguno, ese es el problema.
select
  jobname,
  schedule,
  active,
  case jobname
    when 'auto-close-jornadas'          then 'CIERRA las jornadas — el crítico'
    when 'assign-missing-to-placeholder' then 'adopta maquinaria sin inspector'
    when 'auto-close-placeholder-night' then 'cierre nocturno del cajón'
    when 'auto-full-shift-no-asignada'  then 'jornada completa sin inspector'
    when 'auto-full-shift-placeholder'  then 'jornada completa del cajón'
    when 'auto-iniciar-dia-12h'         then 'banca las 12h del día'
    when 'auto-start-placeholder-day'   then 'arranque día del cajón'
    when 'auto-start-placeholder-night' then 'arranque noche del cajón'
    when 'expire-paradas-no-trabajo'    then 'expira paradas al cerrar turno'
    when 'sos-reassert-shift-start'     then 'SOS La Guaira — NO TOCAR'
    else '(no esperado)'
  end as para_que_sirve
from cron.job
order by jobname;

-- ── 2) ¿Cuáles de los 10 esperados FALTAN? ──────────────────────────────────
-- Si esta consulta devuelve filas, esos crons se desprogramaron (pasa al
-- restaurar la base) y hay que volver a programarlos.
select esperado as cron_que_falta
from unnest(array[
  'assign-missing-to-placeholder','auto-close-jornadas','auto-close-placeholder-night',
  'auto-full-shift-no-asignada','auto-full-shift-placeholder','auto-iniciar-dia-12h',
  'auto-start-placeholder-day','auto-start-placeholder-night','expire-paradas-no-trabajo',
  'sos-reassert-shift-start'
]) as esperado
where not exists (select 1 from cron.job j where j.jobname = esperado);

-- ── 3) ¿Cuándo corrió cada uno por última vez, y cómo le fue? ───────────────
-- Si 'auto-close-jornadas' no aparece o su última corrida es vieja/failed,
-- ahí está la causa. (Si da error de permisos, saltar este bloque.)
select
  j.jobname,
  max(d.end_time)                                          as ultima_corrida,
  count(*) filter (where d.status = 'failed')              as fallidas,
  count(*) filter (where d.status = 'succeeded')           as exitosas,
  (array_agg(d.return_message order by d.end_time desc))[1] as ultimo_mensaje
from cron.job j
left join cron.job_run_details d on d.jobid = j.jobid
  and d.end_time > now() - interval '3 days'
group by j.jobname
order by ultima_corrida nulls first;

-- ── 4) Jornadas ABIERTAS ahora mismo, agrupadas por día ─────────────────────
-- Todo lo que NO sea el día de hoy es una jornada que se quedó trabada: sus
-- horas no están bancadas y no aparecen en el Histórico ni en Control.
select
  r.round_date,
  coalesce(r.jornada_shift, '(sin turno)') as turno,
  count(*)                                  as jornadas_abiertas,
  count(*) filter (where coalesce(r.day_hours,0) = 0
                     and coalesce(r.night_hours,0) = 0) as en_cero_horas,
  min(r.jornada_start_at)                   as la_mas_vieja
from public.machine_rounds r
where r.jornada_start_at is not null
group by r.round_date, r.jornada_shift
order by r.round_date desc, turno;

-- ── 5) Detalle del 16/08/2026 (el día que reportó el cliente) ───────────────
-- Marca cuáles son del inspector SOS LA GUAIRA: esas se manejan solas y NO se
-- deben tocar en ninguna reparación posterior.
select
  m.code                                   as maquina,
  co.name                                  as empresa,
  r.jornada_shift                          as turno,
  r.jornada_start_at                       as inicio,
  coalesce(r.day_hours, 0)                 as horas_dia_bancadas,
  coalesce(r.night_hours, 0)               as horas_noche_bancadas,
  mi_day.inspector_name                    as inspector_dia,
  case when lower(coalesce(mi_day.inspector_name, '')) = 'inspector sos la guaira'
       then 'SÍ — NO TOCAR' else 'no' end  as es_sos
from public.machine_rounds r
join public.machinery m  on m.id = r.machinery_id
left join public.companies co on co.id = m.company_id
left join public.machine_inspectors mi_day
       on mi_day.machinery_id = r.machinery_id and mi_day.shift = 'day'
where r.round_date = date '2026-08-16'
  and r.jornada_start_at is not null
order by es_sos desc, m.code;
