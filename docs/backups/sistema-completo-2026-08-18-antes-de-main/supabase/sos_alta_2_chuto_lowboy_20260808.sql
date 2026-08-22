-- ============================================================================
-- SOS LA GUAIRA — alta de 2 CHUTO CON LOWBOY nuevos (pedido cliente 08/08/2026):
-- placas A22CY4J y A22CYOJ. Deben quedar exactamente igual que el resto de la
-- flota de SOS: turno DÍA 7am-7pm y turno NOCHE 7pm-1am, TODOS los días desde
-- el lunes 03/08/2026 hasta hoy.
--
-- Identifica las máquinas por PLACA/SERIAL exacto (no por "código" — el código
-- "CHUTO CON LOWBOY" no es único, hay varias unidades con ese mismo nombre en
-- el catálogo; usar el código a secas ya causó una corrección accidental sobre
-- máquinas ajenas el 07/08/2026).
--
-- ⚠️ TAMBIÉN corrige un bug de fondo encontrado hoy: la función
-- assign_missing_to_placeholder() en PRODUCCIÓN todavía usaba el UUID
-- INVENTADO viejo ('00000000-…-fa1a' / "MAQUINAS FALTANTES") en vez del real
-- de SOS LA GUAIRA (la corrección de este archivo en el repo, del 04/08, nunca
-- se había aplicado en la BD). Por esto, estos 2 CHUTO CON LOWBOY (turno día) y
-- 2 RETROEXCAVADORA (día+noche, desde el 05-06/08) quedaron asignados al
-- usuario fantasma — invisibles en los reportes de SOS todo este tiempo. Este
-- script redefine la función con el UUID correcto y migra esas filas.
--
-- Los 2 RETROEXCAVADORA SOLO se migran de identidad (para que vuelvan a
-- contar como SOS) — NO se les rellenan horas retroactivas aquí, porque el
-- cliente no lo pidió para esas dos. Si también las quieres con horario fijo
-- desde que quedaron asignadas, avisa y se corre aparte.
--
-- Idempotente. Corre TODO de una sola vez en Supabase → SQL Editor.
-- ============================================================================

-- ── PASO 0: RESPALDO ─────────────────────────────────────────────────────────
create table if not exists public.backup_machine_inspectors_20260808_ghost as
select * from public.machine_inspectors where inspector_id = '00000000-0000-0000-0000-00000000fa1a';

create table if not exists public.backup_machine_rounds_20260808_altas as
select mr.* from public.machine_rounds mr
join public.machinery mch on mch.id = mr.machinery_id
where mch.serial in ('A22CY4J', 'A22CYOJ') or mch.plate in ('A22CY4J', 'A22CYOJ');

create table if not exists public.backup_machine_work_segments_20260808_altas as
select mws.* from public.machine_work_segments mws
join public.machinery mch on mch.id = mws.machinery_id
where mch.serial in ('A22CY4J', 'A22CYOJ') or mch.plate in ('A22CY4J', 'A22CYOJ');

-- ── PASO 1: corrige la función raíz (UUID real, no el inventado) ───────────
create or replace function public.assign_missing_to_placeholder() returns void
language plpgsql security definer set search_path = public as $$
declare
  ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
begin
  insert into public.machine_inspectors (machinery_id, inspector_id, inspector_name, shift, active, assigned_at)
  select mch.id, ph_id, 'inspector sos la guaira', shifts.sh, true, now()
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

-- ── PASO 2: migra las filas huérfanas del usuario fantasma al SOS real ─────
update public.machine_inspectors
set inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b', inspector_name = 'inspector sos la guaira'
where inspector_id = '00000000-0000-0000-0000-00000000fa1a';

-- ── PASO 3: asigna los 2 CHUTO CON LOWBOY nuevos a SOS (día Y noche) ───────
insert into public.machine_inspectors (machinery_id, inspector_id, inspector_name, shift, active, assigned_at)
select mch.id, '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b', 'inspector sos la guaira', sh.shift, true, now()
from public.machinery mch
cross join (values ('day'), ('night')) as sh(shift)
where (mch.serial in ('A22CY4J', 'A22CYOJ') or mch.plate in ('A22CY4J', 'A22CYOJ'))
on conflict (machinery_id, shift) do update set
  inspector_id = excluded.inspector_id,
  inspector_name = excluded.inspector_name,
  active = true;

-- ── PASO 4: horario fijo 7am-7pm / 7pm-1am, 03/08 → AYER (días cerrados) ───
-- HOY (08/08) se deja para el flujo vivo (PASO 5): el turno día de hoy ya está
-- en curso desde las 7am y se cierra solo a las 7pm; no tiene sentido bancarle
-- 12h fijas todavía.
do $$
declare
  ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
  hoy date := (now() at time zone 'America/Caracas')::date;
  d date;
  r record;
  day_start timestamptz; day_end timestamptz; night_start timestamptz; night_end timestamptz;
  cur_start timestamptz;
begin
  d := date '2026-08-03';
  while d < hoy loop
    for r in
      select distinct mch.id as machinery_id
      from public.machinery mch
      where mch.serial in ('A22CY4J', 'A22CYOJ') or mch.plate in ('A22CY4J', 'A22CYOJ')
    loop
      day_start   := (d + time '07:00') at time zone 'America/Caracas';
      day_end     := (d + time '19:00') at time zone 'America/Caracas';
      night_start := day_end;
      night_end   := night_start + interval '6 hours';

      select jornada_start_at into cur_start
        from public.machine_rounds where machinery_id = r.machinery_id and round_date = d and round_no = 1;
      if cur_start is not null then continue; end if;

      insert into public.machine_rounds (machinery_id, round_date, round_no, day_hours, night_hours)
        values (r.machinery_id, d, 1, 12, 6)
      on conflict (machinery_id, round_date, round_no) do update set
        day_hours   = greatest(coalesce(public.machine_rounds.day_hours, 0), 12),
        night_hours = greatest(coalesce(public.machine_rounds.night_hours, 0), 6);

      delete from public.machine_work_segments where machinery_id = r.machinery_id and round_date = d and shift = 'day';
      insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
        values (r.machinery_id, d, 'day', day_start, day_end, 12, 'auto_full_shift', 'Horario fijo SOS LA GUAIRA 7am-7pm (alta 08/08/2026).');

      delete from public.machine_work_segments where machinery_id = r.machinery_id and round_date = d and shift = 'night';
      insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
        values (r.machinery_id, d, 'night', night_start, night_end, 6, 'auto_full_shift', 'Horario fijo SOS LA GUAIRA 7pm-1am (alta 08/08/2026).');
    end loop;
    d := d + 1;
  end loop;
end $$;

-- ── PASO 5: arranca HOY en vivo (día si aún no pasaron las 7pm, o noche si ya
--    son las 7pm o más) — misma función que ya usan las otras 73 máquinas.
select public.sos_reassert_shift_start();

-- ── VERIFICACIÓN ─────────────────────────────────────────────────────────────
-- select mch.code, mch.serial, mr.round_date, mr.day_hours, mr.night_hours, mr.jornada_start_at, mr.jornada_shift
--   from public.machinery mch join public.machine_rounds mr on mr.machinery_id = mch.id
--   where mch.serial in ('A22CY4J','A22CYOJ') order by mch.code, mr.round_date;
-- select * from public.machine_inspectors where inspector_id = '00000000-0000-0000-0000-00000000fa1a'; -- debe dar 0 filas
