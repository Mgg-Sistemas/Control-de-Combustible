-- ============================================================================
-- AUTO-CIERRE de jornadas (hora Caracas, UTC-4) — VERSIÓN CORREGIDA (2026-08-02):
--   • Jornada de DÍA  cierra a las 7:00pm — EXCEPTO VOLTEO/TORONTO/VOLQUETAS
--     (esos usan el flujo de patio de camiones de día).
--   • Jornada de NOCHE cierra a las 7:00am (del día siguiente) — TODAS las máquinas,
--     incluidos VOLTEO/TORONTO/VOLQUETAS (petición: cerrar TODO lo de noche a las 7am).
-- Corre CADA 10 MIN con pg_cron.
--
-- FIX vs la versión anterior (que "perdía horas"): ahora SOLO cierra la jornada si
-- su INICIO es ANTERIOR al fin del turno (`jornada_start_at < end_ts`). Antes, una
-- jornada iniciada fuera de su ventana daba horas = max(0, negativo) = 0 y se
-- cerraba EN BLANCO (perdiendo el segmento). Las horas ya guardadas nunca se pisan
-- (siempre se SUMA con coalesce). Idempotente. Correr una vez en Supabase.
--
-- NOTA: pg_cron debe estar habilitado (Database → Extensions → pg_cron).
-- ============================================================================
create extension if not exists pg_cron;

create or replace function public.auto_close_jornadas() returns void
language plpgsql security definer set search_path = public as $$
declare r record; end_ts timestamptz; hrs numeric; es_camion boolean;
begin
  for r in
    select mr.id, mr.round_date, mr.jornada_start_at, mr.jornada_shift, mch.code, mr.machinery_id
    from public.machine_rounds mr
    join public.machinery mch on mch.id = mr.machinery_id
    where mr.jornada_start_at is not null
  loop
    es_camion := lower(coalesce(r.code, '')) ~ 'volteo|toronto|volqueta';
    -- Fin del turno (hora Caracas):
    --   • DÍA (no camión) → 7pm del round_date.
    --   • NOCHE camión (volteo/toronto/volqueta) → 1:00am (trabajan 6h de noche: 7pm+6h).
    --   • NOCHE resto → 7:00am del día siguiente.
    if r.jornada_shift = 'night' then
      if es_camion then
        end_ts := ((r.round_date + 1) + time '01:00') at time zone 'America/Caracas';  -- camión noche → 1am (6h)
      else
        end_ts := ((r.round_date + 1) + time '07:00') at time zone 'America/Caracas';  -- noche → 7am
      end if;
    else
      -- DÍA: los camiones NO se autocierran aquí (usan el flujo de patio de camiones).
      if es_camion then continue; end if;
      end_ts := (r.round_date + time '19:00') at time zone 'America/Caracas';
    end if;
    -- BLINDAJE: solo se cierra en las horas de fin de turno VÁLIDAS (Caracas):
    -- 01:00 (camión de noche, 6h), 07:00 (noche) o 19:00 (día). Aunque alguien edite mal
    -- `end_ts`, si su hora no es 1, 7 ni 19 se salta la jornada → JAMÁS a medianoche/12 ni al mediodía.
    if extract(hour from (end_ts at time zone 'America/Caracas')) not in (1, 7, 19) then
      continue;
    end if;
    -- Cierra SOLO si el fin del turno YA pasó Y el inicio es ANTERIOR al fin (evita
    -- sumar 0/negativo y cerrar la jornada sin acreditar sus horas).
    if now() >= end_ts and r.jornada_start_at < end_ts then
      hrs := round((extract(epoch from (end_ts - r.jornada_start_at)) / 3600.0)::numeric, 2);
      if r.jornada_shift = 'night' then
        -- Camión de noche: 6h FIJAS (trabaja 6h). Resto: horas reales hasta las 7am.
        update public.machine_rounds
          set night_hours = case when es_camion then 6 else coalesce(night_hours, 0) + hrs end,
              jornada_start_at = null, status = 'operativa'
          where id = r.id;
      else
        update public.machine_rounds
          set day_hours = coalesce(day_hours, 0) + hrs, jornada_start_at = null, status = 'operativa'
          where id = r.id;
      end if;
      insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source)
        values (r.machinery_id, r.round_date, r.jornada_shift, r.jornada_start_at, end_ts, hrs, 'auto_close');
    end if;
  end loop;
end $$;

-- Programa (o reprograma) el auto-cierre para que corra cada 10 minutos.
do $$ begin perform cron.unschedule('auto-close-jornadas'); exception when others then null; end $$;
select cron.schedule('auto-close-jornadas', '*/10 * * * *', $$select public.auto_close_jornadas();$$);
