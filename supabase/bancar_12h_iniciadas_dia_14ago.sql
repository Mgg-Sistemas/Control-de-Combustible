-- ============================================================================
-- BANCAR 12h a las jornadas de DÍA que se INICIARON pero quedaron en 0h
-- (14-ago-2026). Caso: GLENDER inició 56 máquinas de transporte (volteo/toronto/
-- volqueta) — están EXCLUIDAS del auto-cierre y el auto_iniciar_dia_12h no corrió
-- hoy, así que quedaron declaradas (jornada_shift='day') con day_hours=0 → salían
-- 🟡 PARADA / ⏳ pendiente con 0 H.
--
-- Regla del cliente: "todas las máquinas que inició deben tener sus 12h de día".
-- Esto las pone en 12h → pasan a FINALIZADA/CERRADA y suman en total/sector/empresa.
--
-- NO toca: averiadas/paradas con TICKET pendiente (mantienen su estado, sin pago),
-- jornadas de NOCHE, ni jornadas todavía ABIERTAS. Idempotente. Afecta PAGO del día.
-- Correr en Supabase → SQL Editor.
-- ============================================================================
set time zone 'America/Caracas';

-- 0) PREVIA — cuántas se van a bancar (revisa el número antes de seguir):
select count(*) as se_bancaran_12h
from public.machine_rounds r
join public.machinery m on m.id = r.machinery_id
where r.round_date = (now() at time zone 'America/Caracas')::date
  and coalesce(r.jornada_shift,'day') = 'day'
  and r.jornada_start_at is null                 -- ya cerrada (no abierta)
  and coalesce(r.day_hours,0) < 12
  and m.active = true and m.operational = true
  -- Solo bloquean el DÍA: una AVERÍA real (cualquier turno) o una PARADA de DÍA.
  -- Una parada de NOCHE ("no trabajó esta noche") NO bloquea las 12h del día.
  and not exists (select 1 from public.maintenance_requests mr
                  where mr.machinery_id = r.machinery_id and mr.status = 'pendiente'
                    and (mr.material is distinct from 'MÁQUINA PARADA'
                         or extract(hour from (mr.created_at at time zone 'America/Caracas')) between 7 and 18));

-- 1) BANCAR 12h de día:
update public.machine_rounds r
set day_hours = 12, jornada_shift = 'day', status = 'operativa'
from public.machinery m
where m.id = r.machinery_id
  and r.round_date = (now() at time zone 'America/Caracas')::date
  and coalesce(r.jornada_shift,'day') = 'day'
  and r.jornada_start_at is null
  and coalesce(r.day_hours,0) < 12
  and m.active = true and m.operational = true
  -- Solo bloquean el DÍA: una AVERÍA real (cualquier turno) o una PARADA de DÍA.
  -- Una parada de NOCHE ("no trabajó esta noche") NO bloquea las 12h del día.
  and not exists (select 1 from public.maintenance_requests mr
                  where mr.machinery_id = r.machinery_id and mr.status = 'pendiente'
                    and (mr.material is distinct from 'MÁQUINA PARADA'
                         or extract(hour from (mr.created_at at time zone 'America/Caracas')) between 7 and 18));

-- 2) Traza (7am→7pm, 12h) para las que quedaron en 12h sin segmento de día hoy:
insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source)
select r.machinery_id, r.round_date, 'day',
       (r.round_date + time '07:00') at time zone 'America/Caracas',
       (r.round_date + time '19:00') at time zone 'America/Caracas', 12, 'auto_full_shift'
from public.machine_rounds r
where r.round_date = (now() at time zone 'America/Caracas')::date and r.day_hours = 12
  and not exists (select 1 from public.machine_work_segments s
                  where s.machinery_id = r.machinery_id and s.round_date = r.round_date and s.shift = 'day');

-- 3) VERIFICACIÓN — total de horas de día de hoy (debe cuadrar con el reporte):
select count(*) as maquinas_dia_12h, sum(day_hours) as total_horas_dia
from public.machine_rounds r
where r.round_date = (now() at time zone 'America/Caracas')::date and r.day_hours = 12;
