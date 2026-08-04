-- ============================================================================
-- RELLENO RETROACTIVO de horas para las máquinas del usuario virtual MAQUINAS
-- FALTANTES, desde el 01/08/2026 hasta AYER (hora Caracas).
-- ----------------------------------------------------------------------------
-- Motivo: `auto_full_shift_placeholder()` (supabase/maquinas_faltantes.sql) solo
-- genera horas para "ayer", una vez al día — así que las máquinas que llevaban
-- días sin inspector humano ANTES de que este cron se activara (04/08/2026) se
-- quedaron sin horas para esos días. Pedido del cliente (04/08/2026): que
-- cuenten 12h día / 6h noche desde el 1 de agosto, con el mismo criterio de
-- hoy — bolqueta/toronto en 12x12 (12h+12h), el resto de la maquinaria en 12/6.
--
-- Alcance: SOLO las máquinas que HOY siguen en manos de MAQUINAS FALTANTES (día
-- y/o noche). Si una máquina tuvo un inspector real en algún momento de agosto y
-- YA tiene datos ese día, este script NO los toca (mismo blindaje de siempre:
-- `on conflict (machinery_id, round_date, round_no) do nothing` — nunca pisa un
-- día que ya tenga registro). El día de HOY no se incluye — lo cubre esta noche
-- el cron normal (00:15 Caracas).
--
-- ⚠️ IMPACTA horómetro, alertas de mantenimiento y NÓMINA de agosto. Por eso
-- primero se respalda machine_rounds/machine_work_segments del rango afectado.
--
-- ⚠️ CORREGIDO 2026-08-04: usa el UUID REAL "inspector maquinas faltantes"
-- (3b996dc0…) en vez del inventado — ver nota en supabase/maquinas_faltantes.sql.
--
-- Orden para correr en Supabase → SQL Editor:
--   1) Este archivo completo (crea el respaldo, define la función y la EJECUTA
--      una vez — ya queda hecho el relleno, no hace falta nada más).
--   2) Verifica con las consultas comentadas al final.
-- Idempotente: se puede volver a correr sin duplicar nada (los días que ya
-- quedaron rellenados no se tocan otra vez).
-- ============================================================================

-- 1) RESPALDO previo (por si hay que comparar/revertir) — cubre el rango que
--    este script puede llegar a escribir, para TODA la maquinaria (no solo
--    camiones; ese respaldo de hoy temprano fue solo para volqueta/toronto).
create table if not exists public.backup_machine_rounds_20260804_backfill as
select * from public.machine_rounds
where round_date >= date '2026-08-01';

create table if not exists public.backup_machine_work_segments_20260804_backfill as
select * from public.machine_work_segments
where round_date >= date '2026-08-01';

-- 2) Función de relleno: mismo patrón que auto_full_shift_placeholder(), pero
--    recorre un RANGO de fechas en vez de solo "ayer".
create or replace function public.backfill_full_shift_placeholder(desde date, hasta date) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  d date;
  ph_id uuid := '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
  day_owned boolean;
  night_owned boolean;
  es_camion boolean;
  v_day numeric;
  v_night numeric;
  night_len interval;
  day_start timestamptz; day_end timestamptz; night_start timestamptz; night_end timestamptz;
  ins_ok boolean;
begin
  for r in
    select distinct mch.id as machinery_id, mch.code
    from public.machinery mch
    join public.machine_inspectors mi on mi.machinery_id = mch.id and mi.inspector_id = ph_id
    where mch.active = true and mch.operational = true and mch.en_espera = false
  loop
    select exists(select 1 from public.machine_inspectors mi where mi.machinery_id = r.machinery_id and mi.shift = 'day'   and mi.inspector_id = ph_id) into day_owned;
    select exists(select 1 from public.machine_inspectors mi where mi.machinery_id = r.machinery_id and mi.shift = 'night' and mi.inspector_id = ph_id) into night_owned;
    if not day_owned and not night_owned then
      continue; -- ya no le pertenece a ninguno de los dos turnos
    end if;

    es_camion := lower(coalesce(r.code, '')) ~ 'volqueta|toronto';
    night_len := case when es_camion then interval '12 hours' else interval '6 hours' end;
    v_day   := case when day_owned then 12 else 0 end;
    v_night := case when night_owned then (case when es_camion then 12 else 6 end) else 0 end;

    for d in select generate_series(desde, hasta, interval '1 day')::date loop
      day_start   := (d + time '07:00') at time zone 'America/Caracas';
      day_end     := (d + time '19:00') at time zone 'America/Caracas';
      night_start := day_end;
      night_end   := night_start + night_len;

      ins_ok := false;
      insert into public.machine_rounds (machinery_id, round_date, round_no, day_hours, night_hours)
        values (r.machinery_id, d, 1, v_day, v_night)
        on conflict (machinery_id, round_date, round_no) do nothing;
      get diagnostics ins_ok = row_count;

      -- Solo si el insert realmente ocurrió (no había datos ya ese día) se
      -- registra el segmento espejo de trazabilidad.
      if ins_ok then
        if day_owned then
          insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
            values (r.machinery_id, d, 'day', day_start, day_end, 12, 'auto_full_shift',
                    'Relleno retroactivo (agosto): máquina sin inspector humano (turno día → inspector maquinas faltantes)');
        end if;
        if night_owned then
          insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
            values (r.machinery_id, d, 'night', night_start, night_end, v_night, 'auto_full_shift',
                    'Relleno retroactivo (agosto): máquina sin inspector humano (turno noche → inspector maquinas faltantes)');
        end if;
      end if;
    end loop;
  end loop;
end $$;

-- 3) EJECUTA el relleno: desde el 01/08/2026 hasta AYER (hora Caracas) — HOY lo
--    cubre esta noche el cron normal auto_full_shift_placeholder().
select public.backfill_full_shift_placeholder(
  date '2026-08-01',
  ((now() at time zone 'America/Caracas')::date) - 1
);

-- 4) Verificación (opcional, corre estas consultas para revisar el resultado):
-- select round_date, count(*) as maquinas, sum(day_hours) as horas_dia, sum(night_hours) as horas_noche
--   from public.machine_rounds
--   where round_date >= date '2026-08-01'
--   group by round_date order by round_date;
-- select round_date, shift, count(*) from public.machine_work_segments
--   where source = 'auto_full_shift' and round_date >= date '2026-08-01'
--   group by round_date, shift order by round_date, shift;
