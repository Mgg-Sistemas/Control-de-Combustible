-- ============================================================================
-- SOS LA GUAIRA — MISMAS máquinas TODOS los días (pedido cliente 07/08/2026,
-- 11:17pm): las horas ya quedaron bien (script anterior), pero la CANTIDAD de
-- máquinas que aparece bajo "INSPECTOR SOS LA GUAIRA" cambia día a día
-- (73 el 07/08-día, 70 el 06/08-día, etc.) — debería ser SIEMPRE el mismo
-- conjunto desde el lunes 03/08/2026, todas iniciadas y cerradas a su hora.
--
-- ⚠️ POR QUÉ PASA (diagnóstico, sin acceso a la BD en vivo — inferido del
-- código de InspectionsSummary.tsx): el total "N asignada(s)" cuenta TODAS
-- las máquinas asignadas HOY a SOS, pero solo muestra una máquina que HOY
-- está inactiva/en mantenimiento/en espera en los días donde SÍ tiene un
-- registro de jornada (machine_rounds) — si un día no tiene registro para
-- esa máquina, desaparece del conteo de ESE día. El backfill anterior
-- (sos_la_guaira_full_backfill_y_noche_viva.sql, PASO 2) solo filtraba por
-- "máquina activa" al momento de correrlo — cualquier máquina de SOS que en
-- ese momento estuviera en mantenimiento/en espera, o que se le haya asignado
-- a SOS DESPUÉS de esa corrida, se quedó sin registro en algunos días.
--
-- QUÉ HACE ESTE ARCHIVO: para CADA máquina que HOY está asignada a SOS LA
-- GUAIRA (día y/o noche — sin importar si ahora mismo está activa, en
-- mantenimiento o en espera), completa el registro completo (horas + detalle
-- 7am-7pm / 7pm-1am) para TODOS los días 03/08/2026 → ayer (noche) / hoy
-- (día, ya cerrado). Así el conteo "N asignada(s)" y el detalle de horario
-- quedan IDÉNTICOS todos los días. NO toca una jornada que esté REALMENTE
-- abierta ese día (jornada_start_at not null) — se salta y no la pisa.
--
-- Idempotente — se puede correr las veces que haga falta.
-- ============================================================================

-- ── PASO 0: RESPALDO (por si acaso) ─────────────────────────────────────────
create table if not exists public.backup_machine_rounds_20260807_norm as
select mr.*
from public.machine_rounds mr
join public.machine_inspectors mi on mi.machinery_id = mr.machinery_id
where mi.inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'
  and mr.round_date between '2026-08-03' and (now() at time zone 'America/Caracas')::date;

create table if not exists public.backup_machine_work_segments_20260807_norm as
select mws.*
from public.machine_work_segments mws
join public.machine_inspectors mi on mi.machinery_id = mws.machinery_id
where mi.inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'
  and mws.round_date between '2026-08-03' and (now() at time zone 'America/Caracas')::date;

-- ── PASO 1: normaliza TODOS los días para TODAS las máquinas de SOS ─────────
do $$
declare
  ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
  hoy date := (now() at time zone 'America/Caracas')::date;
  d date;
  r record;
  es_camion boolean;
  night_len interval;
  v_night_h numeric;
  day_start timestamptz; day_end timestamptz; night_start timestamptz; night_end timestamptz;
  cur_start timestamptz;
begin
  d := date '2026-08-03';
  while d <= hoy loop
    -- TODAS las máquinas de SOS hoy (día o noche), sin filtrar por activa/operativa/
    -- en_espera — el histórico no depende del estado ACTUAL del catálogo.
    for r in
      select distinct mch.id as machinery_id, mch.code,
        exists(select 1 from public.machine_inspectors mi where mi.machinery_id = mch.id and mi.shift = 'day'   and mi.inspector_id = ph_id) as day_owned,
        exists(select 1 from public.machine_inspectors mi where mi.machinery_id = mch.id and mi.shift = 'night' and mi.inspector_id = ph_id) as night_owned
      from public.machinery mch
      join public.machine_inspectors mi on mi.machinery_id = mch.id and mi.inspector_id = ph_id
    loop
      es_camion := lower(coalesce(r.code, '')) ~ 'volqueta|toronto';
      night_len := case when es_camion then interval '12 hours' else interval '6 hours' end;
      v_night_h := extract(epoch from night_len) / 3600.0;
      day_start   := (d + time '07:00') at time zone 'America/Caracas';
      day_end     := (d + time '19:00') at time zone 'America/Caracas';
      night_start := day_end;
      night_end   := night_start + night_len;

      select jornada_start_at into cur_start
        from public.machine_rounds where machinery_id = r.machinery_id and round_date = d and round_no = 1;

      if cur_start is not null then
        continue; -- jornada realmente abierta ese día → no se toca (se deja para el flujo vivo)
      end if;

      -- DÍA: todos los días 03/08 → HOY (hoy ya cerró su turno día a las 7pm).
      if r.day_owned then
        insert into public.machine_rounds (machinery_id, round_date, round_no, day_hours)
          values (r.machinery_id, d, 1, 12)
        on conflict (machinery_id, round_date, round_no) do update set
          day_hours = greatest(coalesce(public.machine_rounds.day_hours, 0), 12);
        delete from public.machine_work_segments
          where machinery_id = r.machinery_id and round_date = d and shift = 'day';
        insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
          values (r.machinery_id, d, 'day', day_start, day_end, 12, 'auto_full_shift', 'Horario fijo SOS LA GUAIRA 7am-7pm (normalización 07/08/2026).');
      end if;

      -- NOCHE: solo días YA CERRADOS (03/08 → AYER; hoy la maneja el flujo vivo).
      if d < hoy and r.night_owned then
        insert into public.machine_rounds (machinery_id, round_date, round_no, night_hours)
          values (r.machinery_id, d, 1, v_night_h)
        on conflict (machinery_id, round_date, round_no) do update set
          night_hours = greatest(coalesce(public.machine_rounds.night_hours, 0), v_night_h);
        delete from public.machine_work_segments
          where machinery_id = r.machinery_id and round_date = d and shift = 'night';
        insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
          values (r.machinery_id, d, 'night', night_start, night_end, v_night_h, 'auto_full_shift', 'Horario fijo SOS LA GUAIRA 7pm-1am (normalización 07/08/2026).');
      end if;
    end loop;
    d := d + 1;
  end loop;
end $$;

-- ── VERIFICACIÓN: cuántas máquinas de SOS tienen registro por día (debe salir
--    el MISMO número todos los días, tanto para "day" como para "night") ────
-- select round_date,
--   count(*) filter (where day_hours   > 0) as con_dia,
--   count(*) filter (where night_hours > 0) as con_noche
-- from public.machine_rounds mr
-- join public.machine_inspectors mi on mi.machinery_id = mr.machinery_id and mi.inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'
-- where mr.round_date between '2026-08-03' and (now() at time zone 'America/Caracas')::date
-- group by 1 order by 1;
