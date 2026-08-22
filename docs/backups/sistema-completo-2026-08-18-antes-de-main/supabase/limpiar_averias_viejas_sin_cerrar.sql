-- ============================================================================
-- Limpieza de AVERÍAS REALES viejas que quedaron "pendiente" para siempre.
--
-- Causa (ver commit de hoy en SupervisorScreen.tsx): el botón "🟢 Volver a
-- OPERATIVA" solo resolvía el ticket 'MÁQUINA PARADA' — una avería REAL
-- (material distinto, ej. "MANGUERA MALA", "VÁLVULA") nunca se cerraba aunque
-- la máquina ya estuviera arreglada y trabajando con normalidad. Como una
-- avería pendiente ahora se ARRASTRA sin decaer (a propósito), esas máquinas
-- quedaron marcadas 🔴 AVERIADA de forma permanente en "POR INSPECTOR" — y
-- además, en ese panel, una avería "tapa" la categoría PARADA de esa misma
-- máquina (una máquina no puede aparecer en las dos a la vez), por eso
-- Remberto tenía 9 "averiadas" en la PC cuando en el teléfono eran solo
-- 1 avería real + 6 paradas: las 6 paradas tenían, además, una avería vieja
-- sin cerrar de antes, y esa avería vieja ganaba la clasificación.
-- Ya arreglado hacia adelante (Volver a OPERATIVA ahora cierra las dos). Este
-- script es SOLO para limpiar lo que quedó atascado de ANTES del fix.
--
-- Criterio: una avería real pendiente se considera "vieja/obsoleta" si esa
-- MISMA máquina tiene CUALQUIER OTRO registro de mantenimiento (parada o
-- avería, resuelto o no) creado DESPUÉS de ella — señal clara de que algo
-- más reciente ya pasó con esa máquina y esta quedó atrás sin cerrarse.
-- Si NO hay nada más reciente, se deja intacta (puede seguir genuinamente
-- averiada, ej. "Jumbo 320" en el reporte de Remberto, que no se toca).
--
-- CÓMO USAR: pega esto completo en Supabase → SQL Editor y dale RUN una sola
-- vez. Cierra las averías viejas Y de una vez te devuelve, en la misma
-- corrida, la tabla de TODO lo que cerró (máquina, motivo, fecha) para que
-- quede como respaldo/auditoría de lo que se tocó. No borra nada: la avería
-- vieja queda en el historial marcada 'realizado', nunca se elimina la fila.
-- ============================================================================

with cerradas as (
  update public.maintenance_requests mr
  set status = 'realizado', resolved_at = now()
  where mr.material <> 'MÁQUINA PARADA'
    and mr.status = 'pendiente'
    and exists (
      select 1 from public.maintenance_requests mr2
      where mr2.machinery_id = mr.machinery_id and mr2.created_at > mr.created_at
    )
  returning mr.id, mr.machinery_id, mr.material, mr.notes, mr.created_at
)
select
  c.id,
  m.code as maquina,
  c.material,
  c.notes as motivo,
  c.created_at as fecha_averia_cerrada
from cerradas c
join public.machinery m on m.id = c.machinery_id
order by m.code, c.created_at;
