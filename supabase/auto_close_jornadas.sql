-- ============================================================================
-- AUTO-CIERRE de jornadas de inspección (hora Caracas, UTC-4):
--   • Jornada de DÍA cierra a las 7:00pm.
--   • Jornada de NOCHE cierra a las 7:00am (del día siguiente).
-- Excepto VOLTEO / TORONTO / VOLQUETAS (usan el flujo de patio de camiones).
-- Corre CADA HORA con pg_cron y cierra cualquier jornada abierta cuyo fin de turno
-- ya pasó: suma las horas trabajadas (inicio → fin del turno) al turno y limpia
-- jornada_start_at. Idempotente. Correr una vez en Supabase.
--
-- NOTA: pg_cron debe estar habilitado (Supabase → Database → Extensions → pg_cron).
-- ============================================================================
create extension if not exists pg_cron;

create or replace function public.auto_close_jornadas() returns void
language plpgsql security definer set search_path = public as $$
declare r record; end_ts timestamptz; hrs numeric;
begin
  for r in
    select mr.id, mr.round_date, mr.jornada_start_at, mr.jornada_shift, mch.code
    from public.machine_rounds mr
    join public.machinery mch on mch.id = mr.machinery_id
    where mr.jornada_start_at is not null
      and lower(coalesce(mch.code, '')) !~ 'volteo|toronto|volqueta'
  loop
    -- Fin del turno (hora Caracas): día = 7pm del round_date; noche = 7am del día siguiente.
    if r.jornada_shift = 'night' then
      end_ts := ((r.round_date + 1) + time '07:00') at time zone 'America/Caracas';
    else
      end_ts := (r.round_date + time '19:00') at time zone 'America/Caracas';
    end if;
    -- Solo cerrar si el fin del turno YA pasó.
    if now() >= end_ts then
      hrs := round(greatest(0, extract(epoch from (end_ts - r.jornada_start_at)) / 3600.0)::numeric, 2);
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

-- Programa (o reprograma) el auto-cierre para que corra cada hora al minuto :05.
do $$ begin perform cron.unschedule('auto-close-jornadas'); exception when others then null; end $$;
select cron.schedule('auto-close-jornadas', '5 * * * *', $$select public.auto_close_jornadas();$$);
