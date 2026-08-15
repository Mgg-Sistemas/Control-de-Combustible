-- ============================================================================
-- BLINDAJE "declaró jornada" POR TURNO (14-ago-2026).
--
-- Problema: `machine_rounds.jornada_shift` es UNA sola columna por (máquina,
-- round_date). El turno DÍA y el turno NOCHE del MISMO día comparten ese round
-- (la noche pertenece al día en que arrancó → mismo round_date). Cuando una
-- máquina hace DÍA y luego NOCHE el mismo día, al INICIAR la noche se sobrescribe
-- `jornada_shift = 'night'` y se BORRA la señal "declaró DÍA". Si ese día quedó
-- con 0 h de día (p. ej. no lo cubrió el cron de 12h porque ya tenía night_hours),
-- el clasificador lo veía ⏳ PENDIENTE de día por error (debía ser CERRADA/parada).
--
-- Solución: dos columnas DURABLES por turno, `declared_day` / `declared_night`,
-- que NUNCA se pisan entre turnos. Se derivan dentro del RPC `upsert_machine_round`
-- (único choke point de escritura): al ABRIR jornada de un turno (jornada_start_at
-- + jornada_shift) o al BANCARLE horas a ese turno, se marca su flag en true, con
-- OR-in (una vez true, se queda). El clasificador usa estos flags en vez de la
-- frágil `jornada_shift === turno`.
--
-- Correr una vez en Supabase → SQL Editor. Idempotente.
-- ============================================================================

-- 1) Columnas durables por turno.
alter table public.machine_rounds
  add column if not exists declared_day   boolean not null default false,
  add column if not exists declared_night boolean not null default false;

comment on column public.machine_rounds.declared_day is
  'Se declaró/inició (o se le bancaron horas a) la jornada de DÍA en este round. Durable: no se pisa al iniciar la noche (a diferencia de jornada_shift, columna única).';
comment on column public.machine_rounds.declared_night is
  'Idem para la jornada de NOCHE. Ver declared_day.';

-- 2) RPC atómico que DERIVA los flags declared_* (además de la lista blanca de
--    columnas). Basado en la versión con jornada_marked_by; agrega la derivación.
create or replace function public.upsert_machine_round(
  p_machinery_id uuid, p_round_date date, p_patch jsonb, p_recorded_by uuid default null
) returns public.machine_rounds
language plpgsql set search_path to 'public' as $function$
declare
  j jsonb := coalesce(p_patch, '{}'::jsonb);
  row_out public.machine_rounds;
  ins_day numeric := coalesce((j->>'day_hours')::numeric, 0);
  ins_night numeric := coalesce((j->>'night_hours')::numeric, 0);
  v_shift text := j->>'jornada_shift';
  -- ¿este patch ABRE una jornada? (jornada_start_at presente y no nulo)
  v_open boolean := (j ? 'jornada_start_at') and nullif(j->>'jornada_start_at', '') is not null;
  -- ¿este patch DECLARA día/noche? = abre jornada de ese turno, o le banca horas.
  ins_decl_day   boolean := (ins_day   > 0) or (v_open and v_shift = 'day');
  ins_decl_night boolean := (ins_night > 0) or (v_open and v_shift = 'night');
begin
  insert into public.machine_rounds as mr (
    machinery_id, round_date, round_no, day_hours, night_hours, hours_stopped, overtime_hours,
    day_operator, day_operator_ci, night_operator, night_operator_ci,
    horometro_inicial, horometro_final, horometro_photo, jornada_start_at, jornada_shift,
    jornada_marked_at, jornada_marked_by, declared_day, declared_night, recorded_by, status
  ) values (
    p_machinery_id, p_round_date, 1, ins_day, ins_night,
    coalesce((j->>'hours_stopped')::numeric, 0), coalesce((j->>'overtime_hours')::numeric, 0),
    j->>'day_operator', j->>'day_operator_ci', j->>'night_operator', j->>'night_operator_ci',
    (j->>'horometro_inicial')::numeric, (j->>'horometro_final')::numeric, j->>'horometro_photo',
    (j->>'jornada_start_at')::timestamptz, j->>'jornada_shift', (j->>'jornada_marked_at')::timestamptz,
    (j->>'jornada_marked_by')::uuid, ins_decl_day, ins_decl_night, p_recorded_by,
    case when ins_day + ins_night > 0 then 'operativa' else 'parada' end
  )
  on conflict (machinery_id, round_date, round_no) do update set
    day_hours      = case when j ? 'day_hours'      then coalesce((j->>'day_hours')::numeric,0)      else mr.day_hours end,
    night_hours    = case when j ? 'night_hours'    then coalesce((j->>'night_hours')::numeric,0)    else mr.night_hours end,
    hours_stopped  = case when j ? 'hours_stopped'  then coalesce((j->>'hours_stopped')::numeric,0)  else mr.hours_stopped end,
    overtime_hours = case when j ? 'overtime_hours' then coalesce((j->>'overtime_hours')::numeric,0) else mr.overtime_hours end,
    day_operator      = case when j ? 'day_operator'      then j->>'day_operator'      else mr.day_operator end,
    day_operator_ci   = case when j ? 'day_operator_ci'   then j->>'day_operator_ci'   else mr.day_operator_ci end,
    night_operator    = case when j ? 'night_operator'    then j->>'night_operator'    else mr.night_operator end,
    night_operator_ci = case when j ? 'night_operator_ci' then j->>'night_operator_ci' else mr.night_operator_ci end,
    horometro_inicial = case when j ? 'horometro_inicial' then (j->>'horometro_inicial')::numeric else mr.horometro_inicial end,
    horometro_final   = case when j ? 'horometro_final'   then (j->>'horometro_final')::numeric   else mr.horometro_final end,
    horometro_photo   = case when j ? 'horometro_photo'   then j->>'horometro_photo'   else mr.horometro_photo end,
    jornada_start_at  = case when j ? 'jornada_start_at'  then (j->>'jornada_start_at')::timestamptz else mr.jornada_start_at end,
    jornada_shift     = case when j ? 'jornada_shift'     then j->>'jornada_shift'     else mr.jornada_shift end,
    jornada_marked_at = case when j ? 'jornada_marked_at' then (j->>'jornada_marked_at')::timestamptz else mr.jornada_marked_at end,
    jornada_marked_by = case when j ? 'jornada_marked_by' then (j->>'jornada_marked_by')::uuid else mr.jornada_marked_by end,
    -- DECLARADO por-turno DURABLE (OR-in): true si ya lo era, o si este patch
    -- abre/banca ese turno, o si el turno queda con horas > 0 tras el merge.
    declared_day = mr.declared_day or ins_decl_day
      or (case when j ? 'day_hours'   then coalesce((j->>'day_hours')::numeric,0)   else mr.day_hours   end) > 0,
    declared_night = mr.declared_night or ins_decl_night
      or (case when j ? 'night_hours' then coalesce((j->>'night_hours')::numeric,0) else mr.night_hours end) > 0,
    status = case when (
        (case when j ? 'day_hours'   then coalesce((j->>'day_hours')::numeric,0)   else mr.day_hours end)
      + (case when j ? 'night_hours' then coalesce((j->>'night_hours')::numeric,0) else mr.night_hours end)
      ) > 0 then 'operativa' else 'parada' end
  returning * into row_out;
  return row_out;
end $function$;
grant execute on function public.upsert_machine_round(uuid, date, jsonb, uuid) to authenticated;

-- 3) BACKFILL de lo ya existente: deriva declared_* de las señales durables que
--    SÍ sobrevivieron (horas del turno, jornada_shift actual, y los segmentos de
--    trabajo, que son por-turno). Así el histórico queda coherente.
update public.machine_rounds mr set
  declared_day = mr.declared_day
    or mr.jornada_shift = 'day'
    or coalesce(mr.day_hours, 0) > 0
    or exists (select 1 from public.machine_work_segments s
               where s.machinery_id = mr.machinery_id and s.round_date = mr.round_date and s.shift = 'day'),
  declared_night = mr.declared_night
    or mr.jornada_shift = 'night'
    or coalesce(mr.night_hours, 0) > 0
    or exists (select 1 from public.machine_work_segments s
               where s.machinery_id = mr.machinery_id and s.round_date = mr.round_date and s.shift = 'night')
where mr.declared_day = false or mr.declared_night = false;

-- 4) Verificación (opcional):
-- select round_date,
--        count(*) filter (where declared_day)   as declararon_dia,
--        count(*) filter (where declared_night) as declararon_noche
--   from public.machine_rounds
--   where round_date >= (now() at time zone 'America/Caracas')::date - 3
--   group by round_date order by round_date;
