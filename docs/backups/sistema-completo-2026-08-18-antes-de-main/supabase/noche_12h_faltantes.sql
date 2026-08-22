-- ============================================================================
-- NOCHE 12h (7pm→7am) para las MÁQUINAS FALTANTES — 2026-08-14
-- ----------------------------------------------------------------------------
-- El cargador automático de las máquinas sin inspector humano (usuario virtual
-- "inspector maquinas faltantes") le daba a la maquinaria genérica solo 6h de
-- noche (7pm→1am) — por eso "se paraban a la 1am" (caso 53Y03222 y otras). La
-- volqueta/toronto ya cargaba 12h. Regla del cliente (14-ago-2026): la NOCHE es
-- de 12h (7pm→7am) para TODAS, igual que el auto-cierre del servidor. Este
-- script redefine la función con 12h de noche para todas y (opcional, PARTE B)
-- sube a 12h las noches ya cargadas en 6h.
--
-- Correr una vez en Supabase (SQL Editor). El cron ya existente
-- ('auto-full-shift-placeholder', 00:15 Caracas) usará esta nueva definición.
-- ============================================================================

-- PARTE A — Redefine la función: NOCHE = 12h para TODAS las faltantes.
create or replace function public.auto_full_shift_placeholder() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  ayer date;
  ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
  day_owned boolean;
  night_owned boolean;
  v_day numeric;
  v_night numeric;
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

    -- DÍA = 12h · NOCHE = 12h (7pm→7am) para TODAS (regla 14-ago-2026).
    v_day   := case when day_owned   then 12 else 0 end;
    v_night := case when night_owned then 12 else 0 end;

    day_start   := (ayer + time '07:00') at time zone 'America/Caracas';
    day_end     := (ayer + time '19:00') at time zone 'America/Caracas';
    night_start := day_end;
    night_end   := night_start + interval '12 hours';   -- 7pm → 7am del día siguiente

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
                'Generado automáticamente: máquina sin inspector humano (turno día → inspector maquinas faltantes)');
    end if;
    if night_owned and not had_night then
      insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
        values (r.machinery_id, ayer, 'night', night_start, night_end, 12, 'auto_full_shift',
                'Generado automáticamente: máquina sin inspector humano (turno noche → inspector maquinas faltantes)');
    end if;
  end loop;
end $$;

-- Re-asegura el cron (por si se desprogramó al restaurar la BD).
do $$ begin perform cron.unschedule('auto-full-shift-placeholder'); exception when others then null; end $$;
select cron.schedule('auto-full-shift-placeholder', '15 4 * * *', $$select public.auto_full_shift_placeholder();$$);

-- ============================================================================
-- PARTE B (OPCIONAL) — subir a 12h las NOCHES ya cargadas en 6h por el cargador
--   viejo. Solo toca segmentos marca 'auto_full_shift' de 6h (nunca datos de un
--   inspector humano) y sus rondas. ⚠️ Esto SUBE el facturado de esas noches de
--   6h→12h desde la fecha piso. Ajusta la fecha si quieres otro piso, o borra
--   este bloque si solo quieres el arreglo de aquí en adelante.
-- ============================================================================
update public.machine_rounds mr
  set night_hours = 12
  where mr.night_hours = 6
    and mr.jornada_start_at is null
    and mr.round_date >= date '2026-08-01'
    and exists (
      select 1 from public.machine_work_segments s
      where s.machinery_id = mr.machinery_id and s.round_date = mr.round_date
        and s.shift = 'night' and s.source = 'auto_full_shift'
    );

update public.machine_work_segments s
  set ended_at = s.started_at + interval '12 hours', hours = 12
  where s.source = 'auto_full_shift'
    and s.shift = 'night'
    and s.hours = 6
    and s.round_date >= date '2026-08-01';

-- Verificación (opcional):
-- select round_date, count(*) filter (where night_hours = 12) as noches_12h,
--        count(*) filter (where night_hours = 6) as noches_6h
--   from public.machine_rounds where round_date >= date '2026-08-01'
--   group by round_date order by round_date;
