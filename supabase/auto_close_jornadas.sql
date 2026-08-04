-- ============================================================================
-- AUTO-CIERRE de jornadas (hora Caracas, UTC-4) — ACTUALIZADO 2026-08-04:
--   • CAMIÓN (volteo/toronto/volqueta) → cierra a la 1:00am.
--       - turno DÍA  → 12h día + 6h noche = 18h.
--       - turno NOCHE → 6h noche.
--   • DÍA   (no camión) → cierra a las 7:00pm (horas reales).
--   • NOCHE (no camión) → cierra a las 7:00am del día siguiente (horas reales).
--   Candado: SOLO cierra si la hora de fin es 1, 7 o 19 (Caracas) → nunca medianoche.
--   Guarda de recencia: no auto-cierra jornadas cuyo fin fue hace +2 días (debris → manual).
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
    --   • CAMIÓN (volteo/toronto/volqueta), día o noche → 1:00am. El de DÍA trabaja
    --     12h día + 6h noche (hasta la 1am) = 18h; el de NOCHE, 6h.
    --   • NOCHE (no camión) → 7:00am del día siguiente.
    --   • DÍA   (no camión) → 7:00pm del round_date.
    if es_camion then
      end_ts := ((r.round_date + 1) + time '01:00') at time zone 'America/Caracas';   -- camión → 1am
    elsif r.jornada_shift = 'night' then
      end_ts := ((r.round_date + 1) + time '07:00') at time zone 'America/Caracas';    -- noche → 7am
    else
      end_ts := (r.round_date + time '19:00') at time zone 'America/Caracas';           -- día → 7pm
    end if;
    -- BLINDAJE: solo se cierra en las horas de fin de turno VÁLIDAS (Caracas):
    -- 01:00 (camión), 07:00 (noche) o 19:00 (día). Aunque alguien edite mal `end_ts`,
    -- si su hora no es 1, 7 ni 19 se salta → JAMÁS a medianoche/12 ni al mediodía.
    if extract(hour from (end_ts at time zone 'America/Caracas')) not in (1, 7, 19) then
      continue;
    end if;
    -- No RESUCITAR jornadas viejas: si su fin fue hace más de 2 días, quedó abierta por
    -- error ("debris") → se deja para cierre manual; NO se auto-cierra con horas fijas
    -- retroactivas (evita inflar días pasados de camiones ya cerrados/facturados).
    if now() - end_ts > interval '2 days' then
      continue;
    end if;
    -- Cierra SOLO si el fin del turno YA pasó Y el inicio es ANTERIOR al fin (evita
    -- sumar 0/negativo y cerrar la jornada sin acreditar sus horas).
    if now() >= end_ts and r.jornada_start_at < end_ts then
      hrs := round((extract(epoch from (end_ts - r.jornada_start_at)) / 3600.0)::numeric, 2);
      if es_camion then
        -- CAMIÓN: horas FIJAS. Día = 12h día + 6h noche (18h). Noche = 6h.
        if r.jornada_shift = 'night' then
          update public.machine_rounds
            set night_hours = 6, jornada_start_at = null, status = 'operativa'
            where id = r.id;
        else
          update public.machine_rounds
            set day_hours = 12, night_hours = 6, jornada_start_at = null, status = 'operativa'
            where id = r.id;
        end if;
      elsif r.jornada_shift = 'night' then
        -- NOCHE (no camión): horas reales hasta las 7am (se SUMAN, nunca se pisan).
        update public.machine_rounds
          set night_hours = coalesce(night_hours, 0) + hrs, jornada_start_at = null, status = 'operativa'
          where id = r.id;
      else
        -- DÍA (no camión): horas reales hasta las 7pm.
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
