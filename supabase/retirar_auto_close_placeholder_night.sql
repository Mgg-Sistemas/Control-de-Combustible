-- ============================================================================
-- RETIRADO 19-oct-2026 — EL CIERRE DE LA 1AM CON 6H FIJAS YA NO VA.
--
-- `auto_close_placeholder_night` cerraba las jornadas de NOCHE de las máquinas
-- del Inspector SOS La Guaira a la 1:00am con MÍNIMO 6 HORAS FIJAS
-- (greatest(night_hours, 6)) — horas inventadas, sin candado del interruptor:
-- así salieron los 19 segmentos del 17-oct cuando el switch estuvo encendido
-- 2 minutos, y 3.276 segmentos entre el 7-ago y el 20-sep.
--
-- Regla del cliente (19-oct-2026): NINGUNA máquina recibe horas automáticas.
-- La noche de TODAS las máquinas ya la cierra `auto_close_jornadas` a las
-- 7:00am con horas REALES, así que esta función además era redundante.
--
-- Este script es el RETIRO: función en NO-OP + cron desprogramado. La
-- definición anterior quedó en backup_20261019_funciones_cierre (en la base)
-- y en supabase/sos_la_guaira_full_backfill_y_noche_viva.sql (historial).
-- Correr UNA vez en Supabase → SQL Editor. (Corrido y verificado el 19-oct.)
-- ============================================================================

create or replace function public.auto_close_placeholder_night() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- RETIRADA 19-oct-2026: cerraba la noche del SOS a la 1am con 6h FIJAS.
  -- La noche de TODAS las máquinas la cierra auto_close_jornadas (7am, horas
  -- reales). Ninguna máquina recibe horas automáticas.
  return;
end $$;

do $$ begin perform cron.unschedule('auto-close-placeholder-night'); exception when others then null; end $$;

-- Verificación: no debe salir ninguna fila.
select jobname from cron.job where jobname = 'auto-close-placeholder-night';
