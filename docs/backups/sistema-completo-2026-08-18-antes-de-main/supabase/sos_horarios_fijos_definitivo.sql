-- ============================================================================
-- SOS LA GUAIRA — horarios FIJOS definitivos (pedido cliente 07/08/2026, noche):
--
--   "Desde el 03/08/2026, las máquinas de SOS LA GUAIRA trabajaron turno DÍA
--    de 7am a 7pm y turno NOCHE de 7pm a 1am. Además, de hoy en adelante eso
--    debe ser 100% automático: día arranca 7am/cierra 7pm, noche arranca
--    7pm(±1min)/cierra 1am, SIN IMPORTAR que alguien toque manualmente el
--    botón 'Iniciar' de esas máquinas en el panel."
--
-- ⚠️ POR QUÉ PASÓ ESTO (diagnóstico, sin acceso a la BD en vivo — inferido del
-- código): el turno NOCHE de hoy 07/08 aparece "INICIO 09:57 P.M." / "10:05
-- P.M." en vez de 7:00pm porque el cron auto_start_placeholder_night() SOLO
-- pone la hora si la fila está vacía (jornada_start_at IS NULL). Si alguien
-- usó el botón "Iniciar ahora" del panel de Inspecciones sobre esas máquinas
-- después de las 7:05pm (probando el arreglo de botones de hoy), esa acción
-- puso la hora REAL del clic y el cron ya no la corrige (por diseño, para no
-- pisar a un inspector real). Además, el backfill retroactivo del 03-06/08
-- solo tocó machine_rounds (day_hours/night_hours) pero NUNCA creó el
-- registro espejo en machine_work_segments — por eso esos días no muestran
-- "7am→7pm / 7pm→1am" en el detalle: falta el registro de horario, aunque las
-- horas totales sí estén bien.
--
-- QUÉ HACE ESTE ARCHIVO:
--   PASO 0: respaldo de todo lo que se toca.
--   PASO 1: corrige el DETALLE (machine_work_segments) del 03/08 → HOY (día) y
--           03/08 → AYER (noche, días ya cerrados) a 7am-7pm / 7pm-1am fijo.
--   PASO 2: crea sos_reassert_shift_start() — se puede correr cada 10 min: NO
--           IMPORTA qué haya tocado el botón manual, mientras la jornada de
--           HOY siga abierta (0 horas acumuladas) la vuelve a poner en 7am
--           (día) o 7pm (noche). En cuanto el cron de cierre le pone las
--           horas ya no la vuelve a tocar (deja de estar en 0).
--   PASO 3: corre sos_reassert_shift_start() YA MISMO — corrige el 09:57pm/
--           10:05pm de hoy a 7:00pm en el acto.
--
-- Solo toca máquinas donde el turno (día o noche) está HOY en manos de SOS LA
-- GUAIRA (id fijo 3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b). Un inspector real
-- nunca se ve afectado por este archivo.
-- Idempotente: se puede correr las veces que haga falta.
-- ============================================================================

-- ── PASO 0: RESPALDO ─────────────────────────────────────────────────────────
create table if not exists public.backup_machine_rounds_20260807_sos as
select mr.*
from public.machine_rounds mr
join public.machine_inspectors mi on mi.machinery_id = mr.machinery_id
where mi.inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'
  and mr.round_date between '2026-08-03' and (now() at time zone 'America/Caracas')::date;

create table if not exists public.backup_machine_work_segments_20260807_sos as
select mws.*
from public.machine_work_segments mws
join public.machine_inspectors mi on mi.machinery_id = mws.machinery_id
where mi.inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'
  and mws.round_date between '2026-08-03' and (now() at time zone 'America/Caracas')::date;

-- ── PASO 1: DETALLE fijo 7am-7pm / 7pm-1am para 03/08 → hoy/ayer ───────────
do $$
declare
  ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
  hoy date := (now() at time zone 'America/Caracas')::date;
  d date;
  r record;
  es_camion boolean;
  night_len interval;
  day_start timestamptz; day_end timestamptz; night_start timestamptz; night_end timestamptz;
begin
  d := date '2026-08-03';
  while d <= hoy loop
    for r in
      select distinct mch.id as machinery_id, mch.code
      from public.machinery mch
      join public.machine_inspectors mi on mi.machinery_id = mch.id and mi.inspector_id = ph_id
      where mch.active = true
    loop
      es_camion := lower(coalesce(r.code, '')) ~ 'volqueta|toronto';
      night_len := case when es_camion then interval '12 hours' else interval '6 hours' end;
      day_start   := (d + time '07:00') at time zone 'America/Caracas';
      day_end     := (d + time '19:00') at time zone 'America/Caracas';
      night_start := day_end;
      night_end   := night_start + night_len;

      -- Turno DÍA: solo si esa máquina tenía el turno día en manos de SOS ese
      -- día, y solo días ya cerrados (12h) o HOY si ya cerró (no toca un día
      -- que hoy siga en curso de verdad).
      if exists (
        select 1 from public.machine_inspectors mi
        where mi.machinery_id = r.machinery_id and mi.shift = 'day' and mi.inspector_id = ph_id
      ) and exists (
        select 1 from public.machine_rounds mr
        where mr.machinery_id = r.machinery_id and mr.round_date = d and mr.round_no = 1
          and coalesce(mr.day_hours, 0) >= 12
      ) then
        delete from public.machine_work_segments
          where machinery_id = r.machinery_id and round_date = d and shift = 'day';
        insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
          values (r.machinery_id, d, 'day', day_start, day_end, 12, 'auto_full_shift', 'Horario fijo SOS LA GUAIRA 7am-7pm (corrección 07/08/2026).');
      end if;

      -- Turno NOCHE: solo días YA CERRADOS (nunca hoy — hoy se maneja vivo en
      -- el PASO 3) y solo si ese turno estaba en manos de SOS ese día.
      if d < hoy and exists (
        select 1 from public.machine_inspectors mi
        where mi.machinery_id = r.machinery_id and mi.shift = 'night' and mi.inspector_id = ph_id
      ) and exists (
        select 1 from public.machine_rounds mr
        where mr.machinery_id = r.machinery_id and mr.round_date = d and mr.round_no = 1
          and coalesce(mr.night_hours, 0) >= (case when es_camion then 12 else 6 end)
      ) then
        delete from public.machine_work_segments
          where machinery_id = r.machinery_id and round_date = d and shift = 'night';
        insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
          values (r.machinery_id, d, 'night', night_start, night_end, extract(epoch from night_len) / 3600.0, 'auto_full_shift', 'Horario fijo SOS LA GUAIRA 7pm-1am (corrección 07/08/2026).');
      end if;
    end loop;
    d := d + 1;
  end loop;
end $$;

-- ── PASO 2: reafirmación automática (self-healing) cada 10 min ─────────────
-- Mientras la jornada de HOY de una máquina de SOS siga ABIERTA (0h
-- acumuladas), esta función la vuelve a poner en su hora fija (7am día /
-- 7pm noche) sin importar qué la haya movido (un clic manual, una prueba,
-- etc.). En cuanto el cierre automático le carga las horas, deja de tocarla.
create or replace function public.sos_reassert_shift_start() returns void
language plpgsql security definer set search_path = public as $$
declare
  ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
  hoy date := (now() at time zone 'America/Caracas')::date;
  ahora_caracas time := (now() at time zone 'America/Caracas')::time;
  day_start timestamptz := (hoy + time '07:00') at time zone 'America/Caracas';
  night_start timestamptz := (hoy + time '19:00') at time zone 'America/Caracas';
  r record;
begin
  -- DÍA: solo entre 7am y 7pm (fuera de esa ventana no tiene sentido forzar
  -- un inicio de "hoy" — evita marcar arranques a futuro de madrugada).
  if ahora_caracas >= time '07:00' and ahora_caracas < time '19:00' then
    for r in
      select distinct mch.id as machinery_id
      from public.machinery mch
      join public.machine_inspectors mi on mi.machinery_id = mch.id and mi.shift = 'day' and mi.inspector_id = ph_id
      where mch.active = true and mch.operational = true and mch.en_espera = false
    loop
      insert into public.machine_rounds (machinery_id, round_date, round_no, jornada_start_at, jornada_shift, status)
        values (r.machinery_id, hoy, 1, day_start, 'day', 'operativa')
      on conflict (machinery_id, round_date, round_no) do update
        set jornada_start_at = excluded.jornada_start_at,
            jornada_shift = excluded.jornada_shift,
            status = excluded.status
        where coalesce(public.machine_rounds.day_hours, 0) = 0;
    end loop;
  end if;

  -- NOCHE: solo desde las 7pm (camión queda fuera — sigue su patrón 12x12
  -- fijo vía backfill diario, no se "vive" en pantalla, igual que hasta ahora).
  if ahora_caracas >= time '19:00' then
    for r in
      select distinct mch.id as machinery_id
      from public.machinery mch
      join public.machine_inspectors mi on mi.machinery_id = mch.id and mi.shift = 'night' and mi.inspector_id = ph_id
      where mch.active = true and mch.operational = true and mch.en_espera = false
        and lower(coalesce(mch.code, '')) !~ 'volqueta|toronto'
    loop
      insert into public.machine_rounds (machinery_id, round_date, round_no, jornada_start_at, jornada_shift, status)
        values (r.machinery_id, hoy, 1, night_start, 'night', 'operativa')
      on conflict (machinery_id, round_date, round_no) do update
        set jornada_start_at = excluded.jornada_start_at,
            jornada_shift = excluded.jornada_shift,
            status = excluded.status
        where coalesce(public.machine_rounds.night_hours, 0) = 0;
    end loop;
  end if;
end $$;

do $$ begin perform cron.unschedule('sos-reassert-shift-start'); exception when others then null; end $$;
select cron.schedule('sos-reassert-shift-start', '*/10 * * * *', $$select public.sos_reassert_shift_start();$$);

-- ── PASO 3: corrida inmediata — corrige AHORA MISMO el 09:57pm/10:05pm de hoy ─
select public.sos_reassert_shift_start();

-- ── VERIFICACIÓN (correr después) ───────────────────────────────────────────
-- select machinery_id, round_date, jornada_start_at, jornada_shift, day_hours, night_hours
--   from public.machine_rounds mr
--   join public.machine_inspectors mi on mi.machinery_id = mr.machinery_id and mi.inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'
--   where mr.round_date = (now() at time zone 'America/Caracas')::date
--   order by 1;
-- select machinery_id, round_date, shift, started_at, ended_at, hours
--   from public.machine_work_segments
--   where round_date between '2026-08-03' and (now() at time zone 'America/Caracas')::date
--   order by machinery_id, round_date, shift;
