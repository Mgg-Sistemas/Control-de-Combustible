-- ============================================================================
-- Auto-iniciar JORNADA DE DÍA (12h fijas, 7am-7pm) a toda máquina de DÍA activa
-- y operativa que HOY no tenga su jornada de día registrada, y que NO esté
-- parada/averiada. Deja el resumen del DÍA en: iniciadas = todas las de día
-- (no paradas/averiadas), pendientes = 0.
--
-- NO toca: máquinas paradas/averiadas (mantienen su categoría), jornadas de
-- NOCHE, ni jornadas abiertas. Idempotente (se puede correr de nuevo sin duplicar).
-- Afecta HORAS y PAGO del día (cada una suma 12h) — confirmado por el cliente.
-- ============================================================================

-- 0) PREVIA: cuántas máquinas de día se van a iniciar (revisa el número antes).
select count(*) as se_iniciaran
from public.machinery m
where m.active = true and m.operational = true
  and exists (select 1 from public.machine_inspectors mi where mi.machinery_id = m.id and mi.shift = 'day' and mi.active = true)
  and not exists (select 1 from public.maintenance_requests mr where mr.machinery_id = m.id and mr.status = 'pendiente'
                  and extract(hour from (mr.created_at at time zone 'America/Caracas')) between 7 and 18)
  and not exists (
    select 1 from public.machine_rounds r
    where r.machinery_id = m.id and r.round_date = (now() at time zone 'America/Caracas')::date
      and (coalesce(r.day_hours,0) > 0
           or (r.jornada_start_at is not null and coalesce(r.jornada_shift,'day') = 'day'))
  );

-- 1) INSERT: máquinas de día elegibles SIN ninguna ronda hoy → jornada de día 12h.
insert into public.machine_rounds (machinery_id, round_date, round_no, day_hours, jornada_shift, jornada_start_at, status)
select distinct m.id, (now() at time zone 'America/Caracas')::date, 1, 12, 'day', null::timestamptz, 'operativa'
from public.machinery m
join public.machine_inspectors mi on mi.machinery_id = m.id and mi.shift = 'day' and mi.active = true
where m.active = true and m.operational = true
  and not exists (select 1 from public.maintenance_requests mr where mr.machinery_id = m.id and mr.status = 'pendiente'
                  and extract(hour from (mr.created_at at time zone 'America/Caracas')) between 7 and 18)
  and not exists (select 1 from public.machine_rounds r where r.machinery_id = m.id and r.round_date = (now() at time zone 'America/Caracas')::date)
on conflict (machinery_id, round_date, round_no) do nothing;

-- 2) UPDATE: máquinas elegibles con ronda hoy VACÍA (sin horas, sin jornada abierta,
--    sin marca de noche) → ponerles 12h de día. No pisa noche ni jornadas abiertas.
update public.machine_rounds r
set day_hours = 12, jornada_shift = 'day', jornada_start_at = null, status = 'operativa'
where r.round_date = (now() at time zone 'America/Caracas')::date
  and coalesce(r.day_hours,0) = 0 and coalesce(r.night_hours,0) = 0
  and r.jornada_start_at is null and coalesce(r.jornada_shift,'day') <> 'night'
  and exists (
    select 1 from public.machinery m
    join public.machine_inspectors mi on mi.machinery_id = m.id and mi.shift = 'day' and mi.active = true
    where m.id = r.machinery_id and m.active = true and m.operational = true
      and not exists (select 1 from public.maintenance_requests mr where mr.machinery_id = m.id and mr.status = 'pendiente'
                  and extract(hour from (mr.created_at at time zone 'America/Caracas')) between 7 and 18)
  );

-- 3) Traza en machine_work_segments (7am → 7pm, 12h) para las de día 12h sin segmento hoy.
insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source)
select r.machinery_id, r.round_date, 'day',
       (r.round_date + time '07:00') at time zone 'America/Caracas',
       (r.round_date + time '19:00') at time zone 'America/Caracas', 12, 'auto_full_shift'
from public.machine_rounds r
where r.round_date = (now() at time zone 'America/Caracas')::date and r.day_hours = 12
  and exists (select 1 from public.machine_inspectors mi where mi.machinery_id = r.machinery_id and mi.shift = 'day' and mi.active = true)
  and not exists (select 1 from public.machine_work_segments s where s.machinery_id = r.machinery_id and s.round_date = r.round_date and s.shift = 'day');

-- 4) VERIFICACIÓN: máquinas de día con 12h hoy (debe cuadrar con "iniciadas de día").
select count(*) as maquinas_dia_12h_hoy
from public.machine_rounds r
where r.round_date = (now() at time zone 'America/Caracas')::date and r.day_hours = 12;
