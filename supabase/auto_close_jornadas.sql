-- ============================================================================
-- AUTO-CIERRE de jornadas (hora Caracas, UTC-4) — ACTUALIZADO 2026-10-19:
--   HORAS REALES PARA TODOS. Se quitó la rama de "12h FIJAS si el inspector de
--   día es el SOS La Guaira": regla del cliente del 19-oct-2026 — NINGUNA
--   máquina recibe horas automáticas; las horas salen de lo que carga el
--   inspector (inicio de jornada / horómetro). Este cron solo CIERRA lo que una
--   persona (o la automatización del SOS, si está encendida) inició, bancando
--   las horas reales transcurridas (inicio → fin de turno), tope 12h.
--   La definición anterior quedó respaldada en la base
--   (backup_20261019_funciones_cierre) y en el historial de git.
--
-- Regla vigente:
--   • turno DÍA   -> cierra a las 7:00pm del round_date, horas REALES.
--   • turno NOCHE -> cierra a las 7:00am del día siguiente, horas REALES.
--   Candado: SOLO cierra si la hora de fin es 7 o 19 (Caracas) → nunca medianoche.
--   Guarda de recencia: no auto-cierra jornadas cuyo fin fue hace +2 días (debris → manual).
--   "En espera" congelada: no se le suman horas.
--   EXCEPCIÓN 24H: el COMPRESOR CON MARTILLO ('79669') NUNCA se auto-cierra.
--   Corre CADA 10 MIN con pg_cron.
--
-- Historial: 14-ago (noche 12h hasta 7am para todas), 11-ago (12h fijas solo
-- SOS; resto horas reales), 04-ago (fuera el cierre 1am de camiones) — ver git.
-- NOTA: suma con coalesce (no pisa lo guardado). Idempotente: al cerrar pone
--   jornada_start_at=null, así no re-procesa la fila.
-- Correr una vez en Supabase. pg_cron debe estar habilitado.
-- ============================================================================
create extension if not exists pg_cron;

create or replace function public.auto_close_jornadas() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record; end_ts timestamptz; hrs numeric;
begin
  for r in
    select mr.id, mr.round_date, mr.jornada_start_at, mr.jornada_shift, mr.machinery_id
    from public.machine_rounds mr
    join public.machinery mch on mch.id = mr.machinery_id
    -- "Esperando instrucciones" = congelada: este cron no le suma horas.
    where mr.jornada_start_at is not null
      and coalesce(mch.en_espera, false) = false
      -- EXCEPCIÓN 24H: el compresor con martillo ('79669') nunca se auto-cierra.
      and trim(coalesce(mch.serial, '')) <> '79669'
      and trim(coalesce(mch.plate, '')) <> '79669'
  loop
    if r.jornada_shift = 'night' then
      end_ts := ((r.round_date + 1) + time '07:00') at time zone 'America/Caracas';
    else
      end_ts := (r.round_date + time '19:00') at time zone 'America/Caracas';
    end if;
    -- BLINDAJE: solo cierra a las 07:00 o 19:00 Caracas.
    if extract(hour from (end_ts at time zone 'America/Caracas')) not in (7, 19) then
      continue;
    end if;
    -- No resucitar jornadas viejas (+2 días): cierre manual.
    if now() - end_ts > interval '2 days' then
      continue;
    end if;
    if now() >= end_ts then
      -- 19-oct-2026: HORAS REALES PARA TODOS (se quitó la rama de 12h fijas del
      -- inspector SOS — ninguna máquina recibe horas automáticas). Requiere
      -- inicio ANTES del fin; si no, se deja para cierre manual.
      if r.jornada_start_at < end_ts then
        hrs := round((extract(epoch from (end_ts - r.jornada_start_at)) / 3600.0)::numeric, 2);
        if r.jornada_shift = 'night' then
          update public.machine_rounds
            set night_hours = least(12, coalesce(night_hours, 0) + hrs), jornada_start_at = null, status = 'operativa'
            where id = r.id;
          insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source)
            values (r.machinery_id, r.round_date, 'night', r.jornada_start_at, end_ts, hrs, 'auto_close');
        else
          update public.machine_rounds
            set day_hours = least(12, coalesce(day_hours, 0) + hrs), jornada_start_at = null, status = 'operativa'
            where id = r.id;
          insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source)
            values (r.machinery_id, r.round_date, 'day', r.jornada_start_at, end_ts, hrs, 'auto_close');
        end if;
      end if;
    end if;
  end loop;
end $$;

-- Programa (o reprograma) el auto-cierre para que corra cada 10 minutos.
do $$ begin perform cron.unschedule('auto-close-jornadas'); exception when others then null; end $$;
select cron.schedule('auto-close-jornadas', '*/10 * * * *', $$select public.auto_close_jornadas();$$);
