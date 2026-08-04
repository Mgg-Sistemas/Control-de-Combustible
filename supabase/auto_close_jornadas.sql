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
    select mr.id, mr.round_date, mr.jornada_start_at, mr.jornada_shift, mch.code
    from public.machine_rounds mr
    join public.machinery mch on mch.id = mr.machinery_id
    where mr.jornada_start_at is not null
  loop
    es_camion := lower(coalesce(r.code, '')) ~ 'volteo|toronto|volqueta';
    -- Fin del turno (hora Caracas): día = 7pm del round_date; noche = 7am del día siguiente.
    if r.jornada_shift = 'night' then
      -- NOCHE: se cierran TODAS las máquinas a las 7am (incluidos camiones).
      end_ts := ((r.round_date + 1) + time '07:00') at time zone 'America/Caracas';
    else
      -- DÍA: los camiones NO se autocierran aquí (usan el flujo de patio de camiones).
      if es_camion then continue; end if;
      end_ts := (r.round_date + time '19:00') at time zone 'America/Caracas';
    end if;
    -- BLINDAJE: NUNCA cerrar fuera de las 07:00 (noche) o 19:00 (día) hora Caracas.
    -- Aunque alguien edite mal `end_ts`, si su hora local no es 7 ni 19 se salta esta
    -- jornada (jamás cierra a medianoche/12 ni al mediodía). El cierre manual va por otro lado.
    if extract(hour from (end_ts at time zone 'America/Caracas')) not in (7, 19) then
      continue;
    end if;
    -- Cierra SOLO si el fin del turno YA pasó Y el inicio es ANTERIOR al fin (evita
    -- sumar 0/negativo y cerrar la jornada sin acreditar sus horas).
    if now() >= end_ts and r.jornada_start_at < end_ts then
      hrs := round((extract(epoch from (end_ts - r.jornada_start_at)) / 3600.0)::numeric, 2);
      if r.jornada_shift = 'night' then
        update public.machine_rounds
          set night_hours = coalesce(night_hours, 0) + hrs, jornada_start_at = null, status = 'operativa'
          where id = r.id;
      else
        update public.machine_rounds
          set day_hours = coalesce(day_hours, 0) + hrs, jornada_start_at = null, status = 'operativa'
          where id = r.id;
      end if;
    end if;
  end loop;
end $$;

-- Programa (o reprograma) el auto-cierre para que corra cada 10 minutos.
do $$ begin perform cron.unschedule('auto-close-jornadas'); exception when others then null; end $$;
select cron.schedule('auto-close-jornadas', '*/10 * * * *', $$select public.auto_close_jornadas();$$);
