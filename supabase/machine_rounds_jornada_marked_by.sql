-- ============================================================================
-- QUIÉN INICIÓ la jornada (regla cliente 13-ago-2026): mostrar en la lista de
-- Cerradas/Finalizadas y en los reportes "Iniciada por / Finalizada por NOMBRE".
--
-- `machine_rounds.recorded_by` NO sirve para el iniciador: al FINALIZAR la
-- jornada ese campo se re-escribe con el usuario que cierra. Por eso se agrega
-- una columna DEDICADA `jornada_marked_by` que solo se setea al INICIAR y NUNCA
-- se pisa al finalizar → así una jornada cerrada puede mostrar AMBOS: quién la
-- inició y quién la finalizó.
--
-- Para "Finalizada por" NO hace falta columna nueva: el tramo de cierre en
-- `machine_work_segments` ya guarda `recorded_by` (el que cerró).
--
-- IMPORTANTE: el upsert de jornadas pasa por el RPC `upsert_machine_round`, que
-- solo escribe columnas de una LISTA BLANCA. Hay que recrearlo para que acepte
-- `jornada_marked_by` (si no, el valor se ignora silenciosamente).
--
-- Correr una vez en Supabase → SQL Editor. Idempotente.
-- ============================================================================
alter table public.machine_rounds
  add column if not exists jornada_marked_by uuid references auth.users(id) on delete set null;

comment on column public.machine_rounds.jornada_marked_by is
  'Usuario (supervisor/inspector) que INICIÓ la jornada vigente; no se sobrescribe al finalizar (a diferencia de recorded_by).';

-- Recrea el RPC atómico agregando `jornada_marked_by` a la lista blanca (INSERT + UPDATE).
create or replace function public.upsert_machine_round(
  p_machinery_id uuid, p_round_date date, p_patch jsonb, p_recorded_by uuid default null
) returns public.machine_rounds
language plpgsql set search_path to 'public' as $function$
declare
  j jsonb := coalesce(p_patch, '{}'::jsonb);
  row_out public.machine_rounds;
  ins_day numeric := coalesce((j->>'day_hours')::numeric, 0);
  ins_night numeric := coalesce((j->>'night_hours')::numeric, 0);
begin
  insert into public.machine_rounds as mr (
    machinery_id, round_date, round_no, day_hours, night_hours, hours_stopped, overtime_hours,
    day_operator, day_operator_ci, night_operator, night_operator_ci,
    horometro_inicial, horometro_final, horometro_photo, jornada_start_at, jornada_shift,
    jornada_marked_at, jornada_marked_by, recorded_by, status
  ) values (
    p_machinery_id, p_round_date, 1, ins_day, ins_night,
    coalesce((j->>'hours_stopped')::numeric, 0), coalesce((j->>'overtime_hours')::numeric, 0),
    j->>'day_operator', j->>'day_operator_ci', j->>'night_operator', j->>'night_operator_ci',
    (j->>'horometro_inicial')::numeric, (j->>'horometro_final')::numeric, j->>'horometro_photo',
    (j->>'jornada_start_at')::timestamptz, j->>'jornada_shift', (j->>'jornada_marked_at')::timestamptz,
    (j->>'jornada_marked_by')::uuid, p_recorded_by, case when ins_day + ins_night > 0 then 'operativa' else 'parada' end
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
    status = case when (
        (case when j ? 'day_hours'   then coalesce((j->>'day_hours')::numeric,0)   else mr.day_hours end)
      + (case when j ? 'night_hours' then coalesce((j->>'night_hours')::numeric,0) else mr.night_hours end)
      ) > 0 then 'operativa' else 'parada' end
  returning * into row_out;
  return row_out;
end $function$;
grant execute on function public.upsert_machine_round(uuid, date, jsonb, uuid) to authenticated;
