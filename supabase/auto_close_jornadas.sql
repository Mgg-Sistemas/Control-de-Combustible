-- ============================================================================
-- AUTO-CIERRE de jornadas (hora Caracas, UTC-4) — ACTUALIZADO 2026-08-04:
--   Se quitó el trato especial que forzaba a TODO camión (volteo/toronto/
--   volqueta) a cerrar a la 1:00am con horas fijas (12h día + 6h noche), sin
--   importar quién lo maneja. Confirmado por el cliente: eso solo debe pasar
--   con las bolqueta/toronto que están en manos del usuario virtual "MAQUINAS
--   FALTANTES" (sin inspector humano) — y esas NUNCA pasan por esta función,
--   porque el virtual nunca presiona "Iniciar jornada" (sus horas las carga
--   directo supabase/maquinas_faltantes.sql, ya en patrón 12x12 = 24h).
--
--   Cuando un supervisor/inspector REAL inicia jornada en un camión, ahora
--   sigue el flujo NORMAL, igual que cualquier otra máquina:
--     • turno DÍA   -> cierra a las 7:00pm del round_date con 12h FIJAS (regla del
--                      cliente: máquinas de permanencia; el arranque marcado no es el
--                      inicio real). Actualizado 05-ago-2026.
--     • turno NOCHE -> cierra a las 7:00am del día siguiente, horas REALES.
--   Candado: SOLO cierra si la hora de fin es 7 o 19 (Caracas) → nunca medianoche.
--   Guarda de recencia: no auto-cierra jornadas cuyo fin fue hace +2 días (debris → manual).
--   Corre CADA 10 MIN con pg_cron.
--
-- NOTA: NOCHE suma con coalesce (no pisa lo ya guardado); DÍA fija day_hours=12.
--   Idempotente: al cerrar pone jornada_start_at=null, así que no re-procesa la fila.
-- Correr una vez en Supabase. pg_cron debe estar habilitado (Database → Extensions).
-- ============================================================================
create extension if not exists pg_cron;

create or replace function public.auto_close_jornadas() returns void
language plpgsql security definer set search_path = public as $$
declare r record; end_ts timestamptz; hrs numeric;
begin
  for r in
    select mr.id, mr.round_date, mr.jornada_start_at, mr.jornada_shift, mr.machinery_id
    from public.machine_rounds mr
    where mr.jornada_start_at is not null
  loop
    -- Fin del turno (hora Caracas): NOCHE -> 7:00am del día siguiente; DÍA -> 7:00pm.
    if r.jornada_shift = 'night' then
      end_ts := ((r.round_date + 1) + time '07:00') at time zone 'America/Caracas';
    else
      end_ts := (r.round_date + time '19:00') at time zone 'America/Caracas';
    end if;
    -- BLINDAJE: solo se cierra en las horas de fin de turno VÁLIDAS (Caracas):
    -- 07:00 (noche) o 19:00 (día). Aunque alguien edite mal `end_ts`, si su hora
    -- no es 7 ni 19 se salta → JAMÁS a medianoche/12 ni al mediodía.
    if extract(hour from (end_ts at time zone 'America/Caracas')) not in (7, 19) then
      continue;
    end if;
    -- No RESUCITAR jornadas viejas: si su fin fue hace más de 2 días, quedó abierta por
    -- error ("debris") → se deja para cierre manual; NO se auto-cierra con horas
    -- retroactivas (evita inflar días pasados ya cerrados/facturados).
    if now() - end_ts > interval '2 days' then
      continue;
    end if;
    -- Cierra si el fin del turno YA pasó.
    if now() >= end_ts then
      if r.jornada_shift = 'night' then
        -- NOCHE: horas REALES (inicio → 7am del día siguiente). Requiere inicio ANTES
        -- del fin (si no, sumaría 0/negativo) — se salta y se deja para cierre manual.
        if r.jornada_start_at < end_ts then
          hrs := round((extract(epoch from (end_ts - r.jornada_start_at)) / 3600.0)::numeric, 2);
          update public.machine_rounds
            set night_hours = coalesce(night_hours, 0) + hrs, jornada_start_at = null, status = 'operativa'
            where id = r.id;
          insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source)
            values (r.machinery_id, r.round_date, 'night', r.jornada_start_at, end_ts, hrs, 'auto_close');
        end if;
      else
        -- DÍA: 12h FIJAS (regla del cliente; máquinas de permanencia). NO importa la
        -- hora de arranque — incluso si el inspector marcó DESPUÉS de las 7pm, la
        -- jornada de día cierra igual con 12h (antes el candado `start < fin` la dejaba
        -- abierta para siempre). La traza se guarda como 7am → 7pm (12h).
        update public.machine_rounds
          set day_hours = 12, jornada_start_at = null, status = 'operativa'
          where id = r.id;
        insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source)
          values (r.machinery_id, r.round_date, 'day',
                  (r.round_date + time '07:00') at time zone 'America/Caracas', end_ts, 12, 'auto_close');
      end if;
    end if;
  end loop;
end $$;

-- Programa (o reprograma) el auto-cierre para que corra cada 10 minutos.
do $$ begin perform cron.unschedule('auto-close-jornadas'); exception when others then null; end $$;
select cron.schedule('auto-close-jornadas', '*/10 * * * *', $$select public.auto_close_jornadas();$$);
