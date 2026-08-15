-- ============================================================================
-- AUTOMATIZAR las 12h de DÍA (pg_cron) — 14-ago-2026.
--
-- Problema: el reparto de 12h de día (auto_iniciar_dia_12h) se corría A MANO y el
-- pg_cron se desprograma al restaurar la BD → un día las jornadas iniciadas quedan
-- en 0h y salen 🟡 PARADA / ⏳ pendiente con 0 H (caso GLENDER, 56 máquinas).
--
-- Solución: una función + un cron DIARIO que la ejecuta a las 19:05 hora Caracas
-- (23:05 UTC), justo DESPUÉS del auto-cierre de las 7pm. Así:
--   · las que trabajaron con jornada cronometrada CONSERVAN sus horas reales
--     (solo se topan las que quedaron en 0h — la regla solo toca day_hours=0);
--   · las de día iniciadas/permanencia que quedaron en 0h → 12h (FINALIZADA);
--   · las averiadas/paradas con TICKET pendiente quedan EXCLUIDAS (no cobran);
--   · NO toca la NOCHE ni las jornadas todavía ABIERTAS.
-- Idempotente. Correr UNA vez en Supabase → SQL Editor (crea la función y el cron).
-- ============================================================================
create extension if not exists pg_cron;

create or replace function public.auto_iniciar_dia_12h() returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'America/Caracas')::date;
begin
  -- 1) Máquinas de día SIN ronda hoy → jornada de día 12h.
  insert into public.machine_rounds (machinery_id, round_date, round_no, day_hours, jornada_shift, jornada_start_at, status)
  select distinct m.id, d, 1, 12, 'day', null::timestamptz, 'operativa'
  from public.machinery m
  join public.machine_inspectors mi on mi.machinery_id = m.id and mi.shift = 'day' and mi.active = true
  where m.active = true and m.operational = true
    and not exists (select 1 from public.maintenance_requests mr where mr.machinery_id = m.id and mr.status = 'pendiente'
                    and (mr.material is distinct from 'MÁQUINA PARADA'
                         or extract(hour from (mr.created_at at time zone 'America/Caracas')) between 7 and 18))
    and not exists (select 1 from public.machine_rounds r where r.machinery_id = m.id and r.round_date = d)
  on conflict (machinery_id, round_date, round_no) do nothing;

  -- 2) Rondas de día VACÍAS (0h, no abiertas, no de noche) → 12h.
  update public.machine_rounds r
  set day_hours = 12, jornada_shift = 'day', jornada_start_at = null, status = 'operativa'
  where r.round_date = d
    and coalesce(r.day_hours,0) = 0 and coalesce(r.night_hours,0) = 0
    and r.jornada_start_at is null and coalesce(r.jornada_shift,'day') <> 'night'
    and exists (
      select 1 from public.machinery m
      join public.machine_inspectors mi on mi.machinery_id = m.id and mi.shift = 'day' and mi.active = true
      where m.id = r.machinery_id and m.active = true and m.operational = true
        and not exists (select 1 from public.maintenance_requests mr where mr.machinery_id = m.id and mr.status = 'pendiente'
                    and (mr.material is distinct from 'MÁQUINA PARADA'
                         or extract(hour from (mr.created_at at time zone 'America/Caracas')) between 7 and 18)));

  -- 3) Traza (7am→7pm, 12h) para las de día 12h sin segmento hoy.
  insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source)
  select r.machinery_id, r.round_date, 'day',
         (r.round_date + time '07:00') at time zone 'America/Caracas',
         (r.round_date + time '19:00') at time zone 'America/Caracas', 12, 'auto_inicio_dia'
  from public.machine_rounds r
  where r.round_date = d and r.day_hours = 12
    and exists (select 1 from public.machine_inspectors mi where mi.machinery_id = r.machinery_id and mi.shift = 'day' and mi.active = true)
    and not exists (select 1 from public.machine_work_segments s where s.machinery_id = r.machinery_id and s.round_date = r.round_date and s.shift = 'day');
end $$;

-- Programa (o reprograma) el cron: todos los días 23:05 UTC = 19:05 Caracas.
do $$ begin perform cron.unschedule('auto-iniciar-dia-12h'); exception when others then null; end $$;
select cron.schedule('auto-iniciar-dia-12h', '5 23 * * *', $$select public.auto_iniciar_dia_12h();$$);

-- Corre UNA vez YA para arreglar HOY (las que nunca arrancaron → 12h, 0 pendientes).
select public.auto_iniciar_dia_12h();

-- Verificación: el cron quedó programado.
select jobid, schedule, jobname, active from cron.job where jobname = 'auto-iniciar-dia-12h';

-- Verificación: pendientes de día de hoy (debería quedar en 0 tras la corrida).
select count(*) as maquinas_dia_12h, sum(day_hours) as total_horas_dia
from public.machine_rounds r
where r.round_date = (now() at time zone 'America/Caracas')::date and r.day_hours = 12;
