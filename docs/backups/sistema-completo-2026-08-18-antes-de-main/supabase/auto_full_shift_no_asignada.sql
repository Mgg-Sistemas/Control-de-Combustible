-- ============================================================================
-- AUTO-JORNADA COMPLETA (18h) para maquinaria "NO ASIGNADA" — pg_cron 00:15 Caracas
-- ----------------------------------------------------------------------------
-- ⚠️  ATENCIÓN — ESTO GENERA HORAS AUTOMÁTICAS QUE IMPACTAN:
--     • el horómetro / horas trabajadas de la máquina,
--     • las alertas de mantenimiento (horómetro_alertas.sql se basa en horas acumuladas),
--     • posiblemente el CÁLCULO DE PAGO / nómina (price_per_hour × horas trabajadas).
--
--   "NO ASIGNADA" se define aquí como: una máquina OPERATIVA (machinery.active=true,
--   machinery.operational=true, machinery.en_espera=false) que NO tiene NINGUNA fila
--   activa (active=true) en public.machine_inspectors, ni de turno día ni de noche.
--   Esta definición asume que "sin inspector asignado" = "no asignada". REVISA que
--   esta definición sea la correcta para tu negocio ANTES de activar el cron en
--   producción — si "no asignada" significa otra cosa (por ejemplo sin operador,
--   sin obra, etc.), este script generará horas para máquinas que no corresponden.
--
--   NUNCA se sobreescribe un round_date que YA tenga datos: el insert en
--   machine_rounds usa `on conflict (machinery_id, round_date, round_no) do nothing`.
--   Si ya existe una fila para esa máquina+día+round_no=1 (por cualquier motivo:
--   jornada real registrada, ajuste manual, otro proceso), NO se toca ni se pisa,
--   y por lo tanto tampoco se insertan los segmentos espejo de trazabilidad.
--
--   RECOMENDACIÓN: antes de dejar el cron activo, pruébalo corriendo la función
--   manualmente una vez y revisando los resultados:
--       select public.auto_full_shift_no_asignada();
--       -- luego revisa:
--       select * from public.machine_rounds where round_date = current_date - 1;
--       select * from public.machine_work_segments where source = 'auto_full_shift';
--
-- Corre una sola vez en Supabase → SQL Editor para instalar. Idempotente.
-- ============================================================================
create extension if not exists pg_cron;

-- 1) Permitir el nuevo source 'auto_full_shift' en machine_work_segments (no borra
--    ni modifica los valores existentes del CHECK, solo agrega uno nuevo).
alter table public.machine_work_segments
  drop constraint if exists machine_work_segments_source_check;
alter table public.machine_work_segments
  add constraint machine_work_segments_source_check
  check (source in ('manual_finish','parada_averia','parada_no_trabajo','auto_close','ajuste_manual','auto_full_shift'));

-- 2) Función: genera la jornada completa (12h día + 6h noche) del día de AYER
--    (hora Caracas) para cada máquina operativa sin ningún inspector asignado.
create or replace function public.auto_full_shift_no_asignada() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  ayer date;
  day_start timestamptz;
  day_end   timestamptz;
  night_start timestamptz;
  night_end   timestamptz;
  ins_ok boolean;
begin
  -- "Ayer" en hora Caracas: el cron corre a las 00:15 Caracas, así que el día que
  -- ya cerró por completo es el actual (hora Caracas) menos 1.
  ayer := ((now() at time zone 'America/Caracas')::date) - 1;

  for r in
    select mch.id as machinery_id
    from public.machinery mch
    where mch.active = true
      and mch.operational = true
      and mch.en_espera = false
      and not exists (
        select 1 from public.machine_inspectors mi
        where mi.machinery_id = mch.id and mi.active = true
      )
  loop
    -- Bloque de día: 07:00–19:00 hora Caracas del día "ayer".
    day_start := (ayer + time '07:00') at time zone 'America/Caracas';
    day_end   := (ayer + time '19:00') at time zone 'America/Caracas';
    -- Bloque de noche: 19:00 "ayer" → 01:00 del día siguiente hora Caracas (6h),
    -- empieza justo donde termina el bloque de día.
    night_start := day_end;
    night_end   := night_start + interval '6 hours';

    ins_ok := false;
    insert into public.machine_rounds (machinery_id, round_date, round_no, day_hours, night_hours)
      values (r.machinery_id, ayer, 1, 12, 6)
      on conflict (machinery_id, round_date, round_no) do nothing;
    get diagnostics ins_ok = row_count;

    -- Solo si el insert realmente ocurrió (no hubo conflicto con datos existentes)
    -- se registran los segmentos espejo de trazabilidad.
    if ins_ok then
      insert into public.machine_work_segments
        (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
        values (r.machinery_id, ayer, 'day', day_start, day_end, 12, 'auto_full_shift',
                'Generado automáticamente: máquina sin inspector asignado (día/noche)');
      insert into public.machine_work_segments
        (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
        values (r.machinery_id, ayer, 'night', night_start, night_end, 6, 'auto_full_shift',
                'Generado automáticamente: máquina sin inspector asignado (día/noche)');
    end if;
  end loop;
end $$;

-- 3) Programa (o reprograma) el cron para que corra a las 00:15 hora Caracas
--    (UTC-4 todo el año → 04:15 UTC).
do $$ begin perform cron.unschedule('auto-full-shift-no-asignada'); exception when others then null; end $$;
select cron.schedule('auto-full-shift-no-asignada', '15 4 * * *', $$select public.auto_full_shift_no_asignada();$$);
