-- ============================================================================
-- BLINDAJE del REINICIO diario (18-ago-2026).
--
-- Problema: las máquinas de transporte (volqueta/toronto) arrastraban la
-- declaración de jornada del día anterior a la ronda de HOY. Así una máquina que
-- NO trabajó hoy salía "CERRADA / FINALIZADA · 0 H" (por la regla "declaró + 0h =
-- finalizada") en vez de PENDIENTE POR INICIAR, y no se reiniciaba sola cada día.
--
-- Regla del blindaje: una ronda de HOY con la declaración puesta (declared_day/
-- night = true) pero con CERO evidencia de trabajo real — 0 horas en ese turno,
-- jornada NO abierta (jornada_start_at is null) y SIN ningún tramo en
-- machine_work_segments para ese turno — es una declaración ARRASTRADA/fantasma:
-- se limpia el flag → la máquina queda PENDIENTE POR INICIAR.
--
-- Una finalizada-0h REAL (el inspector declaró y cerró hoy con su tramo de cierre
-- manual/auto) SÍ tiene tramo → NO se toca. Solo cae la fantasma.
--
-- Idempotente. Corre en cron cada 30 min → se auto-limpia, sin tocar a mano.
-- Correr una vez en Supabase → SQL Editor (pg_cron habilitado).
-- ============================================================================
create extension if not exists pg_cron;

create or replace function public.clear_stale_declarations() returns void
language plpgsql security definer set search_path = public as $$
declare hoy date := (now() at time zone 'America/Caracas')::date;
begin
  -- DÍA: declaró día, 0h día, jornada cerrada y SIN tramo de día hoy → fantasma.
  update public.machine_rounds r
     set declared_day = false
   where r.round_date = hoy
     and r.declared_day = true
     and coalesce(r.day_hours, 0) = 0
     and r.jornada_start_at is null
     and not exists (select 1 from public.machine_work_segments s
                     where s.machinery_id = r.machinery_id
                       and s.round_date = r.round_date and s.shift = 'day');

  -- NOCHE: mismo criterio para el turno de noche.
  update public.machine_rounds r
     set declared_night = false
   where r.round_date = hoy
     and r.declared_night = true
     and coalesce(r.night_hours, 0) = 0
     and r.jornada_start_at is null
     and not exists (select 1 from public.machine_work_segments s
                     where s.machinery_id = r.machinery_id
                       and s.round_date = r.round_date and s.shift = 'night');
end $$;

-- Programa el cron cada 30 min (se auto-limpia solo).
do $$ begin perform cron.unschedule('clear-stale-declarations'); exception when others then null; end $$;
select cron.schedule('clear-stale-declarations', '*/30 * * * *', $$select public.clear_stale_declarations();$$);

-- Corrida INMEDIATA (arregla cualquier declaración ya arrastrada).
select public.clear_stale_declarations();
