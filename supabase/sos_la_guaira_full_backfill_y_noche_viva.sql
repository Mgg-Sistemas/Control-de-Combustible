-- ============================================================================
-- SOS LA GUAIRA / "inspector maquinas faltantes" (id fijo
-- 3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b) — pedido del cliente (07/08/2026):
--
--   1) Cerrar/activar sus 2 máquinas averiadas.
--   2) Que sus máquinas TRABAJEN FULL: turno DÍA = 12h, turno NOCHE = 6h
--      (12h si es volqueta/toronto) — no horas parciales.
--   3) Que el turno NOCHE se vea "en curso" EN VIVO desde las 7:00pm y cierre
--      solo a la 1:00am con sus horas completas (como ya hace el turno DÍA
--      desde las 7am).
--   4) Que todo esto quede reflejado retroactivamente desde el 03/08/2026.
--
-- ⚠️ IMPORTANTE — LEE ANTES DE CORRER:
--   Esto reescribe day_hours/night_hours de machine_rounds para TODAS las
--   máquinas hoy en manos de SOS (día y/o noche), para CADA día entre el
--   03/08/2026 y HOY. Esas horas alimentan: reportes por empresa, reporte de
--   inspectores, horómetro/alertas de mantenimiento, y CUALQUIER cálculo de
--   nómina que use price_per_hour × horas de esas máquinas. Si ya imprimiste/
--   entregaste el "Reporte del día por empresa" de alguno de esos días, sus
--   totales van a CAMBIAR después de correr esto.
--   Por eso el PASO 0 hace un respaldo completo de todo lo que se va a tocar
--   ANTES de cambiar nada (tablas backup_*_20260807). Si algo sale distinto a
--   lo esperado, se puede reconstruir el estado anterior desde esas tablas.
--
-- Corre TODO este archivo de una sola vez en Supabase → SQL Editor.
-- Idempotente: se puede volver a correr sin duplicar ni empeorar nada (usa
-- GREATEST para las horas — nunca resta, solo completa hasta el tope).
-- ============================================================================

-- ── PASO 0: RESPALDO (antes de tocar nada) ──────────────────────────────────
create table if not exists public.backup_machine_rounds_20260807_sos as
select mr.*
from public.machine_rounds mr
join public.machine_inspectors mi on mi.machinery_id = mr.machinery_id
where mi.inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'
  and mr.round_date between '2026-08-03' and (now() at time zone 'America/Caracas')::date;

create table if not exists public.backup_maintenance_requests_20260807_sos as
select mreq.*
from public.maintenance_requests mreq
join public.machine_inspectors mi on mi.machinery_id = mreq.machinery_id
where mi.inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'
  and mreq.status = 'pendiente';

-- ── PASO 1: cerrar averías/paradas pendientes de las máquinas de SOS ────────
update public.maintenance_requests mreq
set status = 'realizado', resolved_at = now()
from public.machine_inspectors mi
where mi.machinery_id = mreq.machinery_id
  and mi.inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'
  and mreq.status = 'pendiente';

-- ── PASO 2: backfill FULL retroactivo 03/08/2026 → AYER (días ya cerrados) ──
-- Completa día_hours=12 / night_hours=6(ó 12 volqueta·toronto) para cada día
-- del rango, en cada máquina que ese día tenía el turno en manos de SOS. No
-- toca una jornada que esté ABIERTA ahora mismo (la deja para el flujo vivo).
do $$
declare
  ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
  d date;
  hoy date := (now() at time zone 'America/Caracas')::date;
  r record;
  es_camion boolean;
  v_day numeric; v_night numeric;
  cur_start timestamptz;
begin
  d := date '2026-08-03';
  while d < hoy loop  -- días ya cerrados; HOY se maneja aparte (paso 3/4, en vivo)
    for r in
      select distinct mch.id as machinery_id, mch.code
      from public.machinery mch
      join public.machine_inspectors mi on mi.machinery_id = mch.id and mi.inspector_id = ph_id
      where mch.active = true
    loop
      es_camion := lower(coalesce(r.code, '')) ~ 'volqueta|toronto';
      v_day := 12;
      v_night := case when es_camion then 12 else 6 end;

      select jornada_start_at into cur_start
        from public.machine_rounds
        where machinery_id = r.machinery_id and round_date = d and round_no = 1;
      if cur_start is not null then
        continue; -- jornada abierta ese día (no debería pasar en días pasados) → no se toca
      end if;

      insert into public.machine_rounds (machinery_id, round_date, round_no, day_hours, night_hours)
        values (r.machinery_id, d, 1, v_day, v_night)
      on conflict (machinery_id, round_date, round_no) do update set
        day_hours   = greatest(coalesce(public.machine_rounds.day_hours, 0), excluded.day_hours),
        night_hours = greatest(coalesce(public.machine_rounds.night_hours, 0), excluded.night_hours);
    end loop;
    d := d + 1;
  end loop;
end $$;

-- ── PASO 3: HOY — turno DÍA completo (12h, cerrado; ya pasó) ────────────────
do $$
declare
  ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
  hoy date := (now() at time zone 'America/Caracas')::date;
  r record;
  cur_start timestamptz;
begin
  for r in
    select distinct mch.id as machinery_id
    from public.machinery mch
    join public.machine_inspectors mi on mi.machinery_id = mch.id and mi.inspector_id = ph_id and mi.shift = 'day'
    where mch.active = true
  loop
    select jornada_start_at into cur_start
      from public.machine_rounds where machinery_id = r.machinery_id and round_date = hoy and round_no = 1;
    if cur_start is not null then continue; end if; -- turno día no debería seguir abierto a esta hora
    insert into public.machine_rounds (machinery_id, round_date, round_no, day_hours)
      values (r.machinery_id, hoy, 1, 12)
    on conflict (machinery_id, round_date, round_no) do update set
      day_hours = greatest(coalesce(public.machine_rounds.day_hours, 0), 12);
  end loop;
end $$;

-- ── PASO 4: HOY — turno NOCHE en vivo (arranca 7pm, EN CURSO hasta la 1am) ──
do $$
declare
  ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
  hoy date := (now() at time zone 'America/Caracas')::date;
  night_start timestamptz := (hoy + time '19:00') at time zone 'America/Caracas';
begin
  insert into public.machine_rounds (machinery_id, round_date, round_no, jornada_start_at, jornada_shift, status)
  select mch.id, hoy, 1, night_start, 'night', 'operativa'
  from public.machinery mch
  join public.machine_inspectors mi on mi.machinery_id = mch.id and mi.inspector_id = ph_id and mi.shift = 'night'
  where mch.active = true
  on conflict (machinery_id, round_date, round_no) do update set
    jornada_start_at = case when coalesce(public.machine_rounds.night_hours, 0) = 0 and public.machine_rounds.jornada_start_at is null then excluded.jornada_start_at else public.machine_rounds.jornada_start_at end,
    jornada_shift     = case when coalesce(public.machine_rounds.night_hours, 0) = 0 and public.machine_rounds.jornada_start_at is null then excluded.jornada_shift     else public.machine_rounds.jornada_shift     end,
    status            = case when coalesce(public.machine_rounds.night_hours, 0) = 0 and public.machine_rounds.jornada_start_at is null then excluded.status            else public.machine_rounds.status            end;
end $$;

-- ── PASO 5: automatización PERMANENTE para que esto se repita SOLO cada día ─
-- 5a) Redefine auto_full_shift_placeholder(): completa hasta el tope (no solo
--     si está en 0) — mismo cambio ya explicado en
--     supabase/completar_jornadas_full_maquinas_faltantes.sql. Si YA corriste
--     ese archivo, este bloque es un no-op (misma definición).
create or replace function public.auto_full_shift_placeholder() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record; ayer date; ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
  day_owned boolean; night_owned boolean; es_camion boolean;
  v_day numeric; v_night numeric; night_len interval;
  day_start timestamptz; day_end timestamptz; night_start timestamptz; night_end timestamptz;
  had_day boolean; had_night boolean; cur_day numeric; cur_night numeric; cur_start timestamptz;
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
    if not day_owned and not night_owned then continue; end if;
    es_camion := lower(coalesce(r.code, '')) ~ 'volqueta|toronto';
    night_len := case when es_camion then interval '12 hours' else interval '6 hours' end;
    v_day   := case when day_owned then 12 else 0 end;
    v_night := case when night_owned then (case when es_camion then 12 else 6 end) else 0 end;
    day_start   := (ayer + time '07:00') at time zone 'America/Caracas';
    day_end     := (ayer + time '19:00') at time zone 'America/Caracas';
    night_start := day_end;
    night_end   := night_start + night_len;
    select day_hours, night_hours, jornada_start_at into cur_day, cur_night, cur_start
      from public.machine_rounds where machinery_id = r.machinery_id and round_date = ayer and round_no = 1;
    cur_day := coalesce(cur_day, 0); cur_night := coalesce(cur_night, 0);
    had_day := cur_day > 0; had_night := cur_night > 0;
    if cur_start is not null then continue; end if;
    insert into public.machine_rounds (machinery_id, round_date, round_no, day_hours, night_hours)
      values (r.machinery_id, ayer, 1, v_day, v_night)
    on conflict (machinery_id, round_date, round_no) do update set
      day_hours   = case when day_owned   then greatest(coalesce(public.machine_rounds.day_hours, 0), excluded.day_hours)     else public.machine_rounds.day_hours   end,
      night_hours = case when night_owned then greatest(coalesce(public.machine_rounds.night_hours, 0), excluded.night_hours) else public.machine_rounds.night_hours end;
    if day_owned and not had_day then
      insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
        values (r.machinery_id, ayer, 'day', day_start, day_end, 12, 'auto_full_shift', 'Generado automáticamente (turno día → inspector maquinas faltantes)');
    end if;
    if night_owned and not had_night then
      insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
        values (r.machinery_id, ayer, 'night', night_start, night_end, v_night, 'auto_full_shift', 'Generado automáticamente (turno noche → inspector maquinas faltantes)');
    end if;
  end loop;
end $$;

-- 5b) NUEVO: arranca en VIVO el turno noche (solo máquinas NO camión — las
--     volqueta/toronto siguen su patrón 12x12 vía el backfill diario, sin
--     "vivirse" en pantalla) a las 7:00pm Caracas todos los días.
create or replace function public.auto_start_placeholder_night() returns void
language plpgsql security definer set search_path = public as $$
declare
  ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
  hoy date := (now() at time zone 'America/Caracas')::date;
  night_start timestamptz := (hoy + time '19:00') at time zone 'America/Caracas';
begin
  insert into public.machine_rounds (machinery_id, round_date, round_no, jornada_start_at, jornada_shift, status)
  select mch.id, hoy, 1, night_start, 'night', 'operativa'
  from public.machinery mch
  join public.machine_inspectors mi on mi.machinery_id = mch.id and mi.inspector_id = ph_id and mi.shift = 'night'
  where mch.active = true and mch.operational = true and mch.en_espera = false
    and lower(coalesce(mch.code,'')) !~ 'volqueta|toronto'
  on conflict (machinery_id, round_date, round_no) do update set
    jornada_start_at = case when coalesce(public.machine_rounds.night_hours,0) = 0 and public.machine_rounds.jornada_start_at is null then excluded.jornada_start_at else public.machine_rounds.jornada_start_at end,
    jornada_shift     = case when coalesce(public.machine_rounds.night_hours,0) = 0 and public.machine_rounds.jornada_start_at is null then excluded.jornada_shift     else public.machine_rounds.jornada_shift     end,
    status            = case when coalesce(public.machine_rounds.night_hours,0) = 0 and public.machine_rounds.jornada_start_at is null then excluded.status            else public.machine_rounds.status            end;
end $$;

do $$ begin perform cron.unschedule('auto-start-placeholder-night'); exception when others then null; end $$;
select cron.schedule('auto-start-placeholder-night', '5 23 * * *', $$select public.auto_start_placeholder_night();$$); -- 19:05 Caracas

-- 5c) NUEVO: cierra el turno noche EN VIVO a la 1:00am con 6h fijas (solo NO
--     camión — el auto-cierre genérico de supabase/auto_close_jornadas.sql ya
--     ignora estas máquinas del sistema por diseño, así que hace falta este
--     cierre propio; corre cada 10 min).
create or replace function public.auto_close_placeholder_night() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record; end_ts timestamptz; ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
begin
  for r in
    select mr.id, mr.machinery_id, mr.round_date, mr.jornada_start_at
    from public.machine_rounds mr
    join public.machinery mch on mch.id = mr.machinery_id
    join public.machine_inspectors mi on mi.machinery_id = mr.machinery_id and mi.shift = 'night' and mi.inspector_id = ph_id
    where mr.jornada_shift = 'night' and mr.jornada_start_at is not null
      and lower(coalesce(mch.code,'')) !~ 'volqueta|toronto'
      -- Defensa adicional (11-ago-2026): "esperando instrucciones" = congelada, ver
      -- el mismo comentario en auto_close_jornadas.sql.
      and coalesce(mch.en_espera, false) = false
  loop
    end_ts := ((r.round_date + 1) + time '01:00') at time zone 'America/Caracas';
    if now() >= end_ts then
      update public.machine_rounds set night_hours = greatest(coalesce(night_hours,0), 6), jornada_start_at = null, status = 'operativa' where id = r.id;
      insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
        values (r.machinery_id, r.round_date, 'night', r.jornada_start_at, end_ts, 6, 'auto_full_shift', 'Cerrada automáticamente a la 1am (turno noche, inspector maquinas faltantes).');
    end if;
  end loop;
end $$;

do $$ begin perform cron.unschedule('auto-close-placeholder-night'); exception when others then null; end $$;
select cron.schedule('auto-close-placeholder-night', '*/10 * * * *', $$select public.auto_close_placeholder_night();$$);

-- Corrida inmediata del backfill diario (por si "ayer" quedó parcial también).
select public.auto_full_shift_placeholder();

-- ── VERIFICACIÓN (corre después para confirmar) ─────────────────────────────
-- select count(*) from public.maintenance_requests mreq join public.machine_inspectors mi on mi.machinery_id=mreq.machinery_id where mi.inspector_id='3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b' and mreq.status='pendiente'; -- debe dar 0
-- select round_date, count(*), sum(day_hours) tot_dia, sum(night_hours) tot_noche from public.machine_rounds mr join public.machine_inspectors mi on mi.machinery_id=mr.machinery_id where mi.inspector_id='3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b' and mr.round_date between '2026-08-03' and (now() at time zone 'America/Caracas')::date group by 1 order by 1;
