-- ============================================================================
-- CERRAR paradas "no trabajó / MÁQUINA PARADA" VIEJAS (13-ago-2026).
-- Los equipos que "no trabajan de noche" se marcan PARADA cada noche y esas
-- paradas quedan PENDIENTES para siempre → se ARRASTRAN a los reportes de días
-- siguientes (columna Noche con descripciones viejas). Este script las cierra en
-- bloque para que dejen de arrastrarse.
--
-- ALCANCE (seguro):
--   · SOLO material = 'MÁQUINA PARADA' (el marcador "parada / no trabajó").
--   · SOLO status = 'pendiente'.
--   · SOLO creadas ANTES de HOY (Caracas) — no toca las de hoy.
--   · NO toca averías REALES (caucho, aceite, filtro, repuesto, otro): esas
--     siguen pendientes hasta que Mantenimiento las resuelva.
-- Correr en Supabase → SQL Editor.
-- ============================================================================

-- 1) PREVIEW: cuántas se cerrarían (corre esto primero para ver el número).
select count(*) as paradas_viejas_a_cerrar
from public.maintenance_requests
where material = 'MÁQUINA PARADA'
  and status = 'pendiente'
  and created_at < (((now() at time zone 'America/Caracas')::date) at time zone 'America/Caracas');

-- 2) CIERRE en bloque (corre esto para aplicar).
update public.maintenance_requests
   set status = 'realizado', resolved_at = now()
 where material = 'MÁQUINA PARADA'
   and status = 'pendiente'
   and created_at < (((now() at time zone 'America/Caracas')::date) at time zone 'America/Caracas');
