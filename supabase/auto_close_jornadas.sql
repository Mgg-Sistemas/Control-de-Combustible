-- ============================================================================
-- AUTO-CIERRE de jornadas (hora Caracas, UTC-4) — ACTUALIZADO 2026-08-12:
--   NOCHE cierra a la 1:00am (antes 7:00am): una máquina con jornada de noche
--   abierta que se pase de la 1:00am se cierra automáticamente (permanencia de
--   noche = 6h exactas desde las 7pm). DÍA sigue cerrando a las 7:00pm.
--   EXCEPCIÓN 24H: el COMPRESOR CON MARTILLO (serial/placa '79669') trabaja
--   24 horas continuas → NUNCA se auto-cierra (ni noche 1:30am ni día 7pm). Es
--   el ÚNICO equipo con este trato; su jornada se cierra a mano. (Cliente 12-ago-2026.)
--
-- ACTUALIZADO 2026-08-13:
--   LUMINARIA (torres/equipos de iluminación, detectadas por code ilike '%luminaria%'):
--   su turno de NOCHE trabaja 12h (7pm→7am) y cierra a las 7:00am, no a la 1:00am.
--   Pueden cerrarse a mano antes. El resto de máquinas sigue cerrando la noche a la 1am.
--
-- ACTUALIZADO 2026-08-11:
--   Se acotó el alcance de "12h fijas" para el turno DÍA (regla del
--   05-ago-2026, ver historial abajo): antes aplicaba a CUALQUIER máquina con
--   jornada abierta sin cerrar, sin importar el inspector — eso le acreditaba
--   12h completas a máquinas que arrancaron tarde por una avería REAL (caso
--   José Romero 10/08/2026, PAYLOADER arrancó 12:16pm por avería y el reporte
--   le dio 12h en vez de ~6.7h, inflando horas reportadas/facturadas).
--   Pedido explícito del cliente (11-ago-2026): la regla automática de "12h
--   fijas sin importar el arranque" debe ser EXCLUSIVA del inspector "inspector
--   sos la guaira" (la MISMA regla de negocio "SIEMPRE ACTIVO" ya definida en
--   src/lib/machineInspectors.ts, INSPECTORES_SIEMPRE_ACTIVOS) — para
--   cualquier otro inspector real, el cierre automático de DÍA ahora banca
--   HORAS REALES (jornada_start_at → 7pm), igual criterio que ya usa NOCHE.
--
--   ACTUALIZADO 2026-08-04 (histórico): se quitó el trato especial que forzaba
--   a TODO camión (volteo/toronto/volqueta) a cerrar a la 1:00am con horas
--   fijas (12h día + 6h noche), sin importar quién lo maneja. Confirmado por
--   el cliente: eso solo debe pasar con las volqueta/toronto que están en
--   manos del usuario virtual "MAQUINAS FALTANTES" (sin inspector humano) — y
--   esas NUNCA pasan por esta función, porque el virtual nunca presiona
--   "Iniciar jornada" (sus horas las carga directo supabase/maquinas_faltantes.sql).
--
--   Regla vigente:
--     • turno DÍA   -> cierra a las 7:00pm del round_date. 12h FIJAS solo si el
--                      inspector asignado a esa máquina/turno es "inspector sos
--                      la guaira"; para cualquier otro, horas REALES (inicio → 7pm).
--     • turno NOCHE -> cierra a las 7:00am del día siguiente, horas REALES (sin cambios).
--   Candado: SOLO cierra si la hora de fin es 7 o 19 (Caracas) → nunca medianoche.
--   Guarda de recencia: no auto-cierra jornadas cuyo fin fue hace +2 días (debris → manual).
--   Corre CADA 10 MIN con pg_cron.
--
-- NOTA: NOCHE y DÍA (caso no-SOS) suman con coalesce (no pisan lo ya guardado);
--   DÍA (caso SOS) fija day_hours=12. Idempotente: al cerrar pone
--   jornada_start_at=null, así que no re-procesa la fila.
-- Correr una vez en Supabase. pg_cron debe estar habilitado (Database → Extensions).
-- ============================================================================
create extension if not exists pg_cron;

create or replace function public.auto_close_jornadas() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record; end_ts timestamptz; hrs numeric;
  es_sos_siempre_activo boolean;
begin
  for r in
    select mr.id, mr.round_date, mr.jornada_start_at, mr.jornada_shift, mr.machinery_id,
           -- LUMINARIA: su turno de NOCHE trabaja 12h (7pm→7am) y cierra a las 7:00am,
           -- no a la 1:00am (regla cliente 13-ago-2026). Se detecta por el código.
           (coalesce(mch.code, '') ilike '%luminaria%') as es_luminaria
    from public.machine_rounds mr
    join public.machinery mch on mch.id = mr.machinery_id
    -- "Esperando instrucciones" = congelada (pedido del cliente 11-ago-2026): defensa
    -- adicional — en la práctica ya no debería haber ninguna con jornada_start_at
    -- puesto, porque el toggle a en_espera=true la cierra al instante (ver
    -- freezeOpenJornadaNow en src/lib/machineRounds.ts), pero por si se coló por otro
    -- camino (edición directa en SQL, etc.) este cron NO debe seguir sumándole horas.
    where mr.jornada_start_at is not null
      and coalesce(mch.en_espera, false) = false
      -- EXCEPCIÓN 24H: el compresor con martillo (serial/placa '79669') trabaja
      -- 24h continuas → NUNCA se auto-cierra (se cierra a mano). Único equipo así.
      and trim(coalesce(mch.serial, '')) <> '79669'
      and trim(coalesce(mch.plate, '')) <> '79669'
  loop
    -- Fin del turno (hora Caracas): NOCHE -> 1:00am del día siguiente (LUMINARIA ->
    -- 7:00am, 12h); DÍA -> 7:00pm.
    if r.jornada_shift = 'night' then
      if r.es_luminaria then
        end_ts := ((r.round_date + 1) + time '07:00') at time zone 'America/Caracas';
      else
        end_ts := ((r.round_date + 1) + time '01:00') at time zone 'America/Caracas';
      end if;
    else
      end_ts := (r.round_date + time '19:00') at time zone 'America/Caracas';
    end if;
    -- BLINDAJE: solo se cierra en las horas de fin de turno VÁLIDAS (Caracas):
    -- 01:00 (noche), 07:00 (noche LUMINARIA) o 19:00 (día). Aunque alguien edite mal
    -- `end_ts`, si su hora no es 1, 7 ni 19 se salta → JAMÁS a otra hora inesperada.
    if extract(hour from (end_ts at time zone 'America/Caracas')) not in (1, 7, 19) then
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
        -- NOCHE: horas REALES (inicio → 1:00am = 6h desde las 7pm; LUMINARIA → 7:00am
        -- = 12h). Requiere inicio ANTES del fin (si no, sumaría 0/negativo) — se deja manual.
        if r.jornada_start_at < end_ts then
          hrs := round((extract(epoch from (end_ts - r.jornada_start_at)) / 3600.0)::numeric, 2);
          -- TOPE 12h por turno (igual que el cliente y los reportes): night+day nunca >24.
          update public.machine_rounds
            set night_hours = least(12, coalesce(night_hours, 0) + hrs), jornada_start_at = null, status = 'operativa'
            where id = r.id;
          insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source)
            values (r.machinery_id, r.round_date, 'night', r.jornada_start_at, end_ts, hrs, 'auto_close');
        end if;
      else
        -- DÍA: 12h fijas SOLO si el inspector asignado a esta máquina/turno es
        -- "inspector sos la guaira" (regla SIEMPRE ACTIVO, ya definida en la
        -- app) — el resto banca horas reales, igual que NOCHE.
        select exists(
          select 1 from public.machine_inspectors mi
          where mi.machinery_id = r.machinery_id
            and mi.shift = 'day'
            and mi.active = true
            and lower(trim(mi.inspector_name)) = 'inspector sos la guaira'
        ) into es_sos_siempre_activo;

        if es_sos_siempre_activo then
          update public.machine_rounds
            set day_hours = 12, jornada_start_at = null, status = 'operativa'
            where id = r.id;
          insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source)
            values (r.machinery_id, r.round_date, 'day',
                    (r.round_date + time '07:00') at time zone 'America/Caracas', end_ts, 12, 'auto_close');
        elsif r.jornada_start_at < end_ts then
          hrs := round((extract(epoch from (end_ts - r.jornada_start_at)) / 3600.0)::numeric, 2);
          -- TOPE 12h por turno (igual que el cliente y los reportes): night+day nunca >24.
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
