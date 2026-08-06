-- ============================================================================
-- CIERRE de jornadas de DÍA 2026-08-05 que NO cerraron a las 7:00pm
-- (síntoma recurrente: pg_cron dejó de correr el auto-cierre — se cae/queda
--  inactivo tras restaurar la BD). Correr por BLOQUES en Supabase → SQL Editor.
--  Idempotente: repetirlo no vuelve a sumar horas (usa el mismo end_ts fijo 7pm).
-- ============================================================================

-- ── BLOQUE 1 · DIAGNÓSTICO (no cambia nada) ─────────────────────────────────
-- 1a. ¿Qué hora es en Caracas? (si aún NO son las 7pm, es CORRECTO que sigan abiertas)
select now() at time zone 'America/Caracas' as ahora_caracas;

-- 1b. ¿Cuántas jornadas de DÍA del 05/08 siguen abiertas (jornada en curso)?
select count(*) as dia_abiertas_05_08
from public.machine_rounds
where round_date = date '2026-08-05'
  and jornada_shift = 'day'
  and jornada_start_at is not null;

-- 1c. ¿Existe y está activo el job de pg_cron? ¿Cuándo corrió por última vez?
select jobid, jobname, schedule, active from cron.job where jobname = 'auto-close-jornadas';
select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'auto-close-jornadas')
order by start_time desc limit 5;


-- ── BLOQUE 2 · CIERRE INMEDIATO (recomendado) ───────────────────────────────
-- Llama a la MISMA función de producción. Si ya pasaron las 7pm de Caracas,
-- cierra TODAS las jornadas de día/noche cuyo fin de turno ya pasó (dentro de la
-- ventana de 2 días), acreditando horas reales (inicio → 7pm) e insertando su
-- segmento de traza. Es lo que el cron debió hacer solo. NO infla horas.
select public.auto_close_jornadas();

-- Re-verifica que quedaron en 0:
select count(*) as dia_abiertas_despues
from public.machine_rounds
where round_date = date '2026-08-05'
  and jornada_shift = 'day'
  and jornada_start_at is not null;


-- ── BLOQUE 3 · CIERRE EXPLÍCITO (SOLO si el BLOQUE 2 no las cerró) ───────────
-- Úsalo únicamente si tras el BLOQUE 2 el conteo sigue > 0 aunque YA pasaron las
-- 7pm (p. ej. si la guarda de recencia de 2 días estorbara). Cierra SOLO el
-- DÍA del 05/08, al fin de turno fijo 7:00pm Caracas. PREVIEW primero:
with base as (
  select mr.id, mr.machinery_id, mr.round_date, mr.jornada_start_at,
         coalesce(mr.day_hours, 0) as day_hours_actuales,
         (mr.round_date + time '19:00') at time zone 'America/Caracas' as end_ts
  from public.machine_rounds mr
  where mr.round_date = date '2026-08-05'
    and mr.jornada_shift = 'day'
    and mr.jornada_start_at is not null
)
select id, round_date, jornada_start_at, end_ts, day_hours_actuales,
       round((extract(epoch from (end_ts - jornada_start_at)) / 3600.0)::numeric, 2) as horas_a_acreditar
from base
where now() >= end_ts and jornada_start_at < end_ts
order by end_ts;

-- Si el PREVIEW se ve bien, DESCOMENTA y corre el cierre:
-- with base as (
--   select mr.id, mr.machinery_id, mr.round_date, mr.jornada_start_at,
--          coalesce(mr.day_hours, 0) as day_hours_actuales,
--          (mr.round_date + time '19:00') at time zone 'America/Caracas' as end_ts
--   from public.machine_rounds mr
--   where mr.round_date = date '2026-08-05'
--     and mr.jornada_shift = 'day'
--     and mr.jornada_start_at is not null
-- ), cerrables as (
--   select * from base where now() >= end_ts and jornada_start_at < end_ts
-- ), traza as (
--   insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source)
--   select machinery_id, round_date, 'day', jornada_start_at, end_ts,
--          round((extract(epoch from (end_ts - jornada_start_at)) / 3600.0)::numeric, 2),
--          'ajuste_manual'
--   from cerrables
--   returning 1
-- )
-- update public.machine_rounds mr
--   set day_hours = coalesce(mr.day_hours, 0)
--                 + round((extract(epoch from (c.end_ts - c.jornada_start_at)) / 3600.0)::numeric, 2),
--       jornada_start_at = null,
--       status = 'operativa'
-- from cerrables c
-- where mr.id = c.id;


-- ── BLOQUE 4 · REPROGRAMAR el auto-cierre (para que no vuelva a pasar) ───────
-- Si el BLOQUE 1c mostró que el job NO existe o está inactivo, reprográmalo.
-- (Es lo mismo que trae supabase/auto_close_jornadas.sql, sin re-crear la función.)
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('auto-close-jornadas'); exception when others then null; end $$;
select cron.schedule('auto-close-jornadas', '*/10 * * * *', $$select public.auto_close_jornadas();$$);

-- Verifica que quedó activo:
select jobid, jobname, schedule, active from cron.job where jobname = 'auto-close-jornadas';
