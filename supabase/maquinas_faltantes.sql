-- ============================================================================
-- MÁQUINAS SIN INSPECTOR → auto-asignación al usuario virtual "MAQUINAS FALTANTES"
-- + jornada automática MIENTRAS siga sin inspector humano.
-- ----------------------------------------------------------------------------
-- SUSTITUYE a supabase/auto_full_shift_no_asignada.sql (ese archivo quedó SIN
-- ACTIVAR porque la definición de negocio de "no asignada" estaba pendiente de
-- confirmación). Confirmado 04/08/2026 por el cliente:
--   "Todas las máquinas que no tengan un inspector humano asignado (buses, otros
--    equipos) deben asignarse por defecto al usuario virtual MAQUINAS FALTANTES.
--    Deben acumular automáticamente 18 horas de trabajo diarias (12h día / 6h
--    noche) A MENOS QUE un inspector o supervisor cambie manualmente su estado
--    a otro diferente."
--
-- ACTUALIZADO 2026-08-04: la bolqueta/toronto (camión) sin inspector ya NO
-- acumula 18h (12/6) sino **12x12 = 24h** (12h día + 12h noche). El resto de
-- la maquinaria (buses, otros equipos) sin inspector sigue en 12h día / 6h
-- noche como antes. El tope correspondiente vive en cap_truck_hours.sql
-- (ahora topa night_hours en 12, no en 6, SOLO mientras el turno sea del
-- virtual). Las bolqueta/toronto asignadas a un supervisor REAL no se tocan
-- aquí — siguen su flujo normal (ver auto_close_jornadas.sql).
--
-- ACTUALIZADO 2026-08-04 (2): el turno DÍA ya no se carga "en silencio" horas
-- después — supabase/auto_start_dia_maquinas_faltantes.sql lo arranca a las
-- 7am (se ve "🟢 en curso" como un inspector real) y auto_close_jornadas() lo
-- cierra solo a las 7pm. Corre ESE archivo DESPUÉS de este.
--
-- Cómo funciona (dos funciones + dos cron jobs):
--   1) assign_missing_to_placeholder() — cada 15 min, por CADA turno (día/noche)
--      de cada máquina operativa: si ese turno no tiene NINGÚN inspector (la fila
--      no existe — unassignInspector() borra la fila, no la desactiva), se lo
--      asigna al usuario virtual MAQUINAS FALTANTES. Así aparece igual que
--      cualquier inspector en "Resumen"/"Jornadas de máquina", y el coordinador
--      puede reasignarlo a una persona real desde la UI normal en cualquier
--      momento — en cuanto lo hace, ese turno deja de pertenecerle al virtual y
--      este cron ya NO vuelve a tocarlo (deja de cumplir el "not exists").
--   2) auto_full_shift_placeholder() — 1 vez al día (00:15 Caracas), genera para
--      "ayer" las horas fijas del turno(s) que sigan en manos del virtual:
--      bolqueta/toronto -> 12h día y/o 12h noche (24h si le tocan los dos);
--      cualquier otra máquina -> 12h día y/o 6h noche (18h si le tocan los dos);
--      en machine_rounds + su segmento espejo en machine_work_segments
--      (source='auto_full_shift'), igual patrón que el auto-cierre de jornadas
--      ya activo (auto_close_jornadas.sql).
--
-- ⚠️ IMPACTA horómetro, alertas de mantenimiento (horometroAlertas) y NÓMINA
-- (price_per_hour × horas). Nunca pisa un round_date que YA tenga datos (mismo
-- blindaje que el script original: `on conflict (machinery_id, round_date,
-- round_no) do nothing`). Antes de confiar del todo en producción, corre una
-- vez a mano y revisa (respalda antes con supabase/backup_antes_12x12_camiones.sql):
--     select public.assign_missing_to_placeholder();
--     select public.auto_full_shift_placeholder();
--     select * from public.machine_rounds where round_date = current_date - 1;
--     select * from public.machine_work_segments where source = 'auto_full_shift';
--
-- Corre una sola vez en Supabase → SQL Editor. Idempotente.
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pgcrypto;

-- 1) Usuario virtual "MAQUINAS FALTANTES" — cuenta de SISTEMA, jamás inicia
--    sesión (password aleatoria que nadie conoce). UUID fijo para poder
--    referenciarlo desde las funciones sin tener que buscarlo por nombre.
--    NO BORRAR este usuario ni su perfil: lo usan los crons de abajo.
do $$
begin
  if not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-00000000fa1a') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-00000000fa1a',
      'authenticated', 'authenticated',
      'maquinas.faltantes@sistema.local',
      crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"MAQUINAS FALTANTES"}'
    );
  end if;
end $$;

-- Asegura el perfil aunque el trigger on_auth_user_created no llegue a correr
-- igual desde el SQL Editor (por si acaso; es idempotente y no pisa el nombre
-- si ya estaba puesto distinto a propósito).
insert into public.profiles (id, full_name, role, active)
values ('00000000-0000-0000-0000-00000000fa1a', 'MAQUINAS FALTANTES', 'conductor', true)
on conflict (id) do update set full_name = 'MAQUINAS FALTANTES', active = true;

-- 2) Permitir el source 'auto_full_shift' en machine_work_segments (ya lo
--    agregaba el script original; se repite aquí por si este se corre solo).
alter table public.machine_work_segments
  drop constraint if exists machine_work_segments_source_check;
alter table public.machine_work_segments
  add constraint machine_work_segments_source_check
  check (source in ('manual_finish','parada_averia','parada_no_trabajo','auto_close','ajuste_manual','auto_full_shift'));

-- 3) Función: por cada máquina operativa y cada turno (día/noche) SIN ninguna
--    fila en machine_inspectors, se la asigna al usuario virtual.
create or replace function public.assign_missing_to_placeholder() returns void
language plpgsql security definer set search_path = public as $$
declare
  ph_id uuid := '00000000-0000-0000-0000-00000000fa1a';
begin
  insert into public.machine_inspectors (machinery_id, inspector_id, inspector_name, shift, active, assigned_at)
  select mch.id, ph_id, 'MAQUINAS FALTANTES', shifts.sh, true, now()
  from public.machinery mch
  cross join (values ('day'), ('night')) as shifts(sh)
  where mch.active = true
    and mch.operational = true
    and mch.en_espera = false
    and not exists (
      select 1 from public.machine_inspectors mi
      where mi.machinery_id = mch.id and mi.shift = shifts.sh
    )
  on conflict (machinery_id, shift) do nothing;
end $$;

-- 4) Función: genera la jornada de "ayer" (hora Caracas) para cada máquina que
--    tenga uno o ambos turnos en manos del virtual. Bolqueta/toronto (camión):
--    12h si es el turno día, 12h si es el turno noche (ambos → 24h, 12x12).
--    Cualquier otra máquina: 12h día / 6h noche (ambos → 18h), como antes.
--    ACTUALIZADO 2026-08-04 (ver supabase/auto_start_dia_maquinas_faltantes.sql):
--    el turno DÍA ahora normalmente ya lo maneja auto_start_placeholder_day()
--    (arranca jornada_start_at a las 7am, la cierra solo auto_close_jornadas()
--    a las 7pm con horas reales) — esta función deja de asumir que la fila no
--    existe: solo rellena day_hours/night_hours si esa columna concreta sigue
--    en 0, como red de respaldo si algo no arrancó a tiempo.
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
      continue; -- por si acaso: ya no le pertenece a ninguno de los dos turnos
    end if;

    es_camion := lower(coalesce(r.code, '')) ~ 'volqueta|toronto';
    night_len := case when es_camion then interval '12 hours' else interval '6 hours' end;
    v_day   := case when day_owned then 12 else 0 end;
    v_night := case when night_owned then (case when es_camion then 12 else 6 end) else 0 end;

    day_start   := (ayer + time '07:00') at time zone 'America/Caracas';
    day_end     := (ayer + time '19:00') at time zone 'America/Caracas';
    night_start := day_end;
    night_end   := night_start + night_len;

    -- ¿Ya había algo cargado ese día (por el arranque a las 7am + cierre real,
    -- por un inspector humano, o por una corrida anterior)? Si sí, no se toca.
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

    -- Solo se registra el segmento espejo de trazabilidad de lo que realmente
    -- se rellenó en ESTA corrida (evita duplicar el de auto_close_jornadas()).
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

-- 5) Desactiva el cron del script viejo (auto_full_shift_no_asignada.sql), que
--    quedó superado por este archivo — no pasa nada si nunca se llegó a activar.
do $$ begin perform cron.unschedule('auto-full-shift-no-asignada'); exception when others then null; end $$;

-- 6) Programa los dos cron jobs:
--    • Asignación al virtual: cada 15 min (mantiene "quién es el dueño" al día).
--    • Generación de horas: 1 vez al día a las 00:15 Caracas (04:15 UTC).
do $$ begin perform cron.unschedule('assign-missing-to-placeholder'); exception when others then null; end $$;
select cron.schedule('assign-missing-to-placeholder', '*/15 * * * *', $$select public.assign_missing_to_placeholder();$$);

do $$ begin perform cron.unschedule('auto-full-shift-placeholder'); exception when others then null; end $$;
select cron.schedule('auto-full-shift-placeholder', '15 4 * * *', $$select public.auto_full_shift_placeholder();$$);

-- 7) Corrida inmediata: asigna YA (sin esperar el próximo tick del cron de 15
--    min) cualquier máquina que hoy no tenga inspector en algún turno.
select public.assign_missing_to_placeholder();
