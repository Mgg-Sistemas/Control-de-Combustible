-- ============================================================================
-- AUTO-CIERRE: NO BANCAR HORAS A MÁQUINAS PARADAS  (raíz del banco fantasma)
--
-- Problema (19-ago-2026): `auto_close_jornadas()` recorre las rondas con
-- `jornada_start_at is not null` SIN mirar `status`. Una máquina que INICIÓ
-- jornada (anclada 7am) y luego fue marcada "no trabajó / PARADA" queda con la
-- jornada ABIERTA; al llegar las 7pm el cron le banca ~12h fantasma (day_hours=12,
-- hours_stopped=0). Eso infló facturación a escala de flota los días 17 y 18
-- (≈19 y 12 máquinas, ya corregidas a mano). El fix de raíz: el auto-cierre
-- IGNORA las rondas con `status='parada'` → nunca les banca horas.
--
-- Una parada = no trabajó ese turno → sus horas deben quedar en 0 (regla del
-- cliente "0 horas = parada"). Si la máquina trabajó y LUEGO paró, sus horas
-- reales ya quedaron bancadas (manual_finish_early / parada_averia) ANTES de que
-- el status pasara a 'parada', así que no se pierde nada.
--
-- Es el MISMO cuerpo de `supabase/auto_close_jornadas.sql`; el ÚNICO cambio es la
-- línea `and mr.status <> 'parada'` en el WHERE del loop. Idempotente
-- (CREATE OR REPLACE). Correr en Supabase → SQL Editor.
-- ============================================================================
create or replace function public.auto_close_jornadas() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record; end_ts timestamptz; hrs numeric;
  es_sos_siempre_activo boolean;
begin
  for r in
    select mr.id, mr.round_date, mr.jornada_start_at, mr.jornada_shift, mr.machinery_id
    from public.machine_rounds mr
    join public.machinery mch on mch.id = mr.machinery_id
    where mr.jornada_start_at is not null
      and coalesce(mch.en_espera, false) = false
      -- RAÍZ DEL BANCO FANTASMA: una ronda marcada PARADA no trabajó ese turno →
      -- el auto-cierre NO le banca horas (antes le bancaba 12h por tener la jornada
      -- abierta). Sus horas quedan como estén (0 si no trabajó; lo real ya bancado
      -- si trabajó y luego paró).
      and mr.status <> 'parada'
      -- EXCEPCIÓN 24H: el compresor con martillo (serial/placa '79669') trabaja
      -- 24h continuas → NUNCA se auto-cierra (se cierra a mano). Único equipo así.
      and trim(coalesce(mch.serial, '')) <> '79669'
      and trim(coalesce(mch.plate, '')) <> '79669'
  loop
    if r.jornada_shift = 'night' then
      end_ts := ((r.round_date + 1) + time '07:00') at time zone 'America/Caracas';
    else
      end_ts := (r.round_date + time '19:00') at time zone 'America/Caracas';
    end if;
    -- BLINDAJE: solo cierra en horas de fin de turno válidas (7 noche / 19 día).
    if extract(hour from (end_ts at time zone 'America/Caracas')) not in (7, 19) then
      continue;
    end if;
    -- No RESUCITAR jornadas viejas (>2 días → debris, cierre manual).
    if now() - end_ts > interval '2 days' then
      continue;
    end if;
    if now() >= end_ts then
      if r.jornada_shift = 'night' then
        if r.jornada_start_at < end_ts then
          hrs := round((extract(epoch from (end_ts - r.jornada_start_at)) / 3600.0)::numeric, 2);
          update public.machine_rounds
            set night_hours = least(12, coalesce(night_hours, 0) + hrs), jornada_start_at = null, status = 'operativa'
            where id = r.id;
          insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source)
            values (r.machinery_id, r.round_date, 'night', r.jornada_start_at, end_ts, hrs, 'auto_close');
        end if;
      else
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

-- Verificación: el cuerpo instalado ahora incluye el guard de parada.
select position('status <> ''parada''' in pg_get_functiondef('public.auto_close_jornadas()'::regprocedure)) > 0
       as guard_parada_instalado;
