-- ============================================================================
-- Limpieza de AVERÍAS REALES viejas que quedaron "pendiente" para siempre.
--
-- Causa (ver commit de hoy en SupervisorScreen.tsx): el botón "🟢 Volver a
-- OPERATIVA" solo resolvía el ticket 'MÁQUINA PARADA' — una avería REAL
-- (material distinto, ej. "VÁLVULA") nunca se cerraba aunque la máquina ya
-- estuviera arreglada y trabajando con normalidad. Como una avería pendiente
-- ahora se ARRASTRA sin decaer (a propósito, ver fix de hoy), esas máquinas
-- quedaron marcadas 🔴 AVERIADA de forma permanente en "POR INSPECTOR" y en
-- el propio teléfono, aunque llevaran semanas operando bien. Ya arreglado
-- hacia adelante (Volver a OPERATIVA ahora cierra las dos); este script es
-- SOLO para limpiar lo que quedó atascado de ANTES del fix.
--
-- Criterio: una avería real pendiente se considera "vieja/obsoleta" si esa
-- MISMA máquina tiene CUALQUIER OTRO registro de mantenimiento (parada o
-- avería, resuelto o no) creado DESPUÉS de ella — señal clara de que algo
-- más reciente ya pasó con esa máquina y esta quedó atrás sin cerrarse.
-- Si NO hay nada más reciente, se deja intacta (puede seguir genuinamente
-- averiada, ej. "Jumbo 320" en el reporte de Remberto).
--
-- CÓMO USAR (dos pasos, en Supabase → SQL Editor):
--   1) Corre el PASO 1 (SELECT, no cambia nada) y revisa la lista: máquina,
--      material, motivo, fecha, y cuántos eventos más recientes tiene.
--   2) Si la lista se ve razonable, corre el PASO 2 (UPDATE) para cerrarlas.
--      Es aditivo/reversible en el sentido de que solo cambia `status` y dos
--      columnas de auditoría — el registro de la avería vieja NO se borra,
--      queda en el historial marcado 'realizado'.
-- ============================================================================

-- ── PASO 1: PREVISUALIZAR (solo lectura) ────────────────────────────────────
select
  mr.id,
  m.code as maquina,
  mr.material,
  mr.notes as motivo,
  mr.created_at as fecha_avería,
  (
    select count(*) from public.maintenance_requests mr2
    where mr2.machinery_id = mr.machinery_id and mr2.created_at > mr.created_at
  ) as eventos_mas_recientes
from public.maintenance_requests mr
join public.machinery m on m.id = mr.machinery_id
where mr.material <> 'MÁQUINA PARADA'
  and mr.status = 'pendiente'
  and exists (
    select 1 from public.maintenance_requests mr2
    where mr2.machinery_id = mr.machinery_id and mr2.created_at > mr.created_at
  )
order by m.code, mr.created_at;

-- ── PASO 2: CERRAR las de la lista de arriba (correr solo tras revisar) ────
-- update public.maintenance_requests mr
-- set status = 'realizado', resolved_at = now()
-- where mr.material <> 'MÁQUINA PARADA'
--   and mr.status = 'pendiente'
--   and exists (
--     select 1 from public.maintenance_requests mr2
--     where mr2.machinery_id = mr.machinery_id and mr2.created_at > mr.created_at
--   );
