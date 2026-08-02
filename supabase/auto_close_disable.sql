-- ============================================================================
-- DESACTIVAR el auto-cierre de jornadas (pg_cron).
-- Motivo (2026-08-02): el auto-cierre estaba cerrando jornadas antes de tiempo y
-- los inspectores reportaron que "se reiniciaban / perdían horas" a las 12 h
-- (día 7am→7pm) y 24 h (corrido). Se REVIERTE: se quita el job del cron para que
-- NADA automático vuelva a tocar las jornadas. El cierre vuelve a ser MANUAL
-- (el inspector toca FINALIZAR). La función public.auto_close_jornadas() se deja
-- creada por si más adelante se quiere reactivar con la lógica corregida.
-- Correr UNA VEZ en el SQL Editor de Supabase.
-- ============================================================================

select cron.unschedule('auto-close-jornadas');

-- Verificar que ya no queda el job (debe devolver 0 filas):
select jobid, jobname, schedule, active from cron.job where jobname = 'auto-close-jornadas';
