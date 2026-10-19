-- ============================================================================
-- RETIRADO 19-oct-2026 — LAS 12h AUTOMÁTICAS DE DÍA YA NO VAN.
--
-- Decisión del cliente (19-oct-2026): NINGUNA máquina recibe horas automáticas.
-- Las horas salen SOLO de lo que carga el inspector: el inicio de jornada
-- (escaneo/botón) y el horómetro. El cierre automático de las 7pm/7am
-- (auto_close_jornadas) SÍ queda: cierra con horas REALES lo que una persona
-- inició, no inventa nada.
--
-- POR QUÉ SE RETIRÓ: esta función corría a las 19:05 Caracas y le acreditaba
-- 12h fijas y jornada FINALIZADA a TODA máquina con inspector de día activo,
-- aunque nadie la hubiera tocado. El candado del Inspector SOS (21-sep) solo
-- excluía a las máquinas del placeholder SOS, así que los camiones con
-- inspector real (p. ej. VOLTEO TORONTO 49DDAR con Julio Guillen) salían con
-- 12h "trabajadas" sin que nadie los escaneara — 357 segmentos inventados
-- solo entre el 12 y el 18-oct-2026.
--
-- HISTORIA: nació el 14-ago-2026 para el caso GLENDER (56 máquinas iniciadas
-- que quedaron en 0h al desprogramarse los crons tras un restore). La versión
-- completa anterior está en el historial de git de este archivo.
--
-- Este script es el RETIRO: deja la función como NO-OP (por si algún proceso
-- viejo la llama) y desprograma el cron. Correr UNA vez en Supabase → SQL
-- Editor. Reversible: recuperar la versión anterior del historial de git.
-- ============================================================================

create or replace function public.auto_iniciar_dia_12h() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- RETIRADA 19-oct-2026: no se reparten horas automáticas a ninguna máquina.
  -- Las horas las carga el inspector (inicio de jornada / horómetro).
  return;
end $$;

-- Quita el cron de las 19:05. Si no existe, no pasa nada.
do $$ begin perform cron.unschedule('auto-iniciar-dia-12h'); exception when others then null; end $$;

-- Verificación: no debe salir ninguna fila.
select jobname, schedule from cron.job where jobname = 'auto-iniciar-dia-12h';
