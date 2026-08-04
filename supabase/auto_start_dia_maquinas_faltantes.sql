-- ============================================================================
-- TURNO DÍA de MAQUINAS FALTANTES: que se vea "iniciado a las 7am" (04/08/2026)
-- ----------------------------------------------------------------------------
-- Hasta ahora, auto_full_shift_placeholder() cargaba las 12h del turno día en
-- silencio, una vez al día a las 00:15 Caracas, para el día que YA TERMINÓ. La
-- máquina nunca se veía como "🟢 en curso" durante el día — solo aparecían las
-- horas ya hechas, al día siguiente. El cliente pidió que el turno DÍA se vea
-- arrancado desde las 7:00am (como si un inspector real hubiera tocado
-- "Iniciar jornada"), no que las horas aparezcan de la nada horas después.
--
-- Cómo funciona (una función nueva + se ajusta la existente):
--   1) auto_start_placeholder_day() — corre 1 vez al día a las 7:05am Caracas
--      (más una corrida manual de arranque, ver abajo): a cada máquina cuyo
--      turno DÍA siga en manos de MAQUINAS FALTANTES le pone
--      jornada_start_at = hoy 7:00am. A partir de ahí la máquina se ve "🟢 en
--      curso" en el CHECK/Inspecciones, IGUAL que si la hubiera iniciado un
--      inspector real. El cron YA EXISTENTE auto_close_jornadas() (cada 10
--      min) la cierra solo a las 7:00pm con las horas reales transcurridas
--      (7am→7pm = 12h exactas, mismo valor de siempre) y genera su propio
--      registro de trazabilidad (source='auto_close'), como cualquier jornada
--      real. NO toca máquinas donde ya hay una jornada abierta o ya hay horas
--      registradas ese día (ni de un inspector real ni de este mismo cron).
--   2) auto_full_shift_placeholder() (supabase/maquinas_faltantes.sql) sigue
--      cargando la NOCHE igual que siempre (6h genérico / 12h camión, fijo,
--      sin "vivirse" en tiempo real — el cliente solo pidió esto para la
--      mañana). Se ajusta para que YA NO intente tocar el DÍA si el turno día
--      ya fue manejado por auto_start_placeholder_day() + auto_close_jornadas
--      (evita duplicar/chocar en la misma fila): ahora solo rellena
--      day_hours/night_hours si esa columna sigue en 0 — si el día ya se
--      cerró solo, lo respeta tal cual y solo completa lo que falte.
--
-- ⚠️ IMPACTA horómetro, alertas de mantenimiento y NÓMINA. Respaldo previo del
-- día de hoy antes de aplicar.
-- ============================================================================

-- 1) Respaldo de las jornadas de HOY antes de tocar nada (probablemente vacío
--    para la mayoría, pero por si alguna máquina ya tenía algo registrado).
create table if not exists public.backup_machine_rounds_20260804_hoy as
select * from public.machine_rounds
where round_date = ((now() at time zone 'America/Caracas')::date);

-- 2) Nueva función: "arranca" el turno DÍA de las máquinas de MAQUINAS
--    FALTANTES a las 7:00am — solo si esa máquina no tiene YA una jornada
--    abierta ni horas registradas hoy (no pisa nada de un inspector real).
create or replace function public.auto_start_placeholder_day() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  hoy date;
  ph_id uuid := '00000000-0000-0000-0000-00000000fa1a';
  day_start timestamptz;
begin
  hoy := (now() at time zone 'America/Caracas')::date;
  day_start := (hoy + time '07:00') at time zone 'America/Caracas';

  for r in
    select distinct mch.id as machinery_id
    from public.machinery mch
    join public.machine_inspectors mi
      on mi.machinery_id = mch.id and mi.shift = 'day' and mi.inspector_id = ph_id
    where mch.active = true and mch.operational = true and mch.en_espera = false
  loop
    insert into public.machine_rounds (machinery_id, round_date, round_no, jornada_start_at, jornada_shift)
      values (r.machinery_id, hoy, 1, day_start, 'day')
    on conflict (machinery_id, round_date, round_no) do update
      set jornada_start_at = excluded.jornada_start_at,
          jornada_shift = excluded.jornada_shift
      where public.machine_rounds.jornada_start_at is null
        and coalesce(public.machine_rounds.day_hours, 0) = 0;
  end loop;
end $$;

-- 3) Ajusta auto_full_shift_placeholder(): ya NO asume que la fila no existe —
--    ahora rellena day_hours/night_hours SOLO si esa columna concreta sigue en
--    0 (deja intacto lo que ya haya, sea de un inspector real o del arranque
--    a las 7am de este mismo sistema). El segmento espejo de trazabilidad solo
--    se inserta para lo que realmente se rellenó en esta corrida.
create or replace function public.auto_full_shift_placeholder() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  ayer date;
  ph_id uuid := '00000000-0000-0000-0000-00000000fa1a';
  day_owned boolean;
  night_owned boolean;
  es_camion boolean;
  v_day numeric;
  v_night numeric;
  night_len interval;
  day_start timestamptz; day_end timestamptz; night_start timestamptz; night_end timestamptz;
  had_day boolean;
  had_night boolean;
begin
  ayer := ((now() at time zone 'America/Caracas')::date) - 1;

  for r in
    select distinct mch.id as machinery_id, mch.code
    from public.machinery mch
    join public.machine_inspectors mi on mi.machinery_id = mch.id and mi.inspector_id = ph_id
    where mch.active = true and mch.operational = true and mch.en_espera = false
  loop
    select exists(select 1 from public.machine_inspectors mi where mi.machinery_id = r.machinery_id and mi.shift = 'day'   and mi.inspector_id = ph_id) into day_owned;
    select exists(select 1 from public.machine_inspectors mi where mi.machinery_id = r.machinery_id and mi.shift = 'night' and mi.inspector_id = ph_id) into night_owned;
    if not day_owned and not night_owned then
      continue;
    end if;

    es_camion := lower(coalesce(r.code, '')) ~ 'volqueta|toronto';
    night_len := case when es_camion then interval '12 hours' else interval '6 hours' end;
    v_day   := case when day_owned then 12 else 0 end;
    v_night := case when night_owned then (case when es_camion then 12 else 6 end) else 0 end;

    day_start   := (ayer + time '07:00') at time zone 'America/Caracas';
    day_end     := (ayer + time '19:00') at time zone 'America/Caracas';
    night_start := day_end;
    night_end   := night_start + night_len;

    -- ¿Ya había algo cargado ese día (por auto_close_jornadas del arranque a
    -- las 7am, por un inspector real, o por una corrida anterior de esta
    -- misma función)? Si sí, NO se toca esa columna.
    select coalesce(day_hours, 0) > 0, coalesce(night_hours, 0) > 0
      into had_day, had_night
      from public.machine_rounds
      where machinery_id = r.machinery_id and round_date = ayer and round_no = 1;
    had_day := coalesce(had_day, false);
    had_night := coalesce(had_night, false);

    insert into public.machine_rounds (machinery_id, round_date, round_no, day_hours, night_hours)
      values (r.machinery_id, ayer, 1, v_day, v_night)
    on conflict (machinery_id, round_date, round_no) do update set
      day_hours   = case when coalesce(public.machine_rounds.day_hours, 0)   = 0 and public.machine_rounds.jornada_start_at is null then excluded.day_hours   else public.machine_rounds.day_hours   end,
      night_hours = case when coalesce(public.machine_rounds.night_hours, 0) = 0 and public.machine_rounds.jornada_start_at is null then excluded.night_hours else public.machine_rounds.night_hours end;

    if day_owned and not had_day then
      insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
        values (r.machinery_id, ayer, 'day', day_start, day_end, 12, 'auto_full_shift',
                'Generado automáticamente: máquina sin inspector humano (turno día → MAQUINAS FALTANTES)');
    end if;
    if night_owned and not had_night then
      insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
        values (r.machinery_id, ayer, 'night', night_start, night_end, v_night, 'auto_full_shift',
                'Generado automáticamente: máquina sin inspector humano (turno noche → MAQUINAS FALTANTES)');
    end if;
  end loop;
end $$;

-- 4) Programa el nuevo cron: 1 vez al día a las 7:05am Caracas (11:05 UTC,
--    Caracas no tiene horario de verano).
do $$ begin perform cron.unschedule('auto-start-placeholder-day'); exception when others then null; end $$;
select cron.schedule('auto-start-placeholder-day', '5 11 * * *', $$select public.auto_start_placeholder_day();$$);

-- 5) Corrida INMEDIATA para HOY (no esperar a mañana 7am): arranca ya mismo,
--    con hora de inicio 7:00am de hoy, el turno día de las máquinas que ahora
--    mismo están en manos de MAQUINAS FALTANTES. Esta noche, cuando pasen las
--    7:00pm, auto_close_jornadas() (ya activo, corre cada 10 min) las cierra
--    solas con las 12h reales transcurridas.
select public.auto_start_placeholder_day();

-- 6) Verificación (opcional):
-- select machinery_id, jornada_start_at, jornada_shift, day_hours, night_hours
--   from public.machine_rounds
--   where round_date = ((now() at time zone 'America/Caracas')::date) and jornada_start_at is not null
--   order by jornada_start_at;
