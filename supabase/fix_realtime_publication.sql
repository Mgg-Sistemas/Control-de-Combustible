-- ============================================================================
-- FIX: sincronización en tiempo real de Supervisión de Inspectores.
-- ----------------------------------------------------------------------------
-- src/screens/SupervisionScreen.tsx y src/screens/SupervisorScreen.tsx se
-- suscriben (useRealtimeRefresh) a los cambios de:
--   · public.machine_inspectors  (asignación inspector ↔ máquina, "CHECK MÁQUINA")
--   · public.truck_yard_logs     (entrada/salida de camiones al patio)
--
-- Pero la publicación `supabase_realtime` que gestiona schema.sql (bloque
-- "TIEMPO REAL", ~línea 1847) NO incluye estas dos tablas. Sin estar en la
-- publicación, Postgres no envía los cambios por el canal de Realtime: el
-- cliente queda suscrito pero nunca recibe el evento, así que la pantalla NO
-- se actualiza sola (hay que refrescar a mano) aunque el trigger de negocio
-- sí corrió correctamente.
--
-- Nota: public.machine_inspectors YA intenta agregarse a la publicación desde
-- supabase/inspector_asignacion.sql (al final del archivo). Si ese script ya
-- se corrió en producción, el ALTER de abajo para machine_inspectors es un
-- no-op (ignorado por el bloque EXCEPTION). Se repite aquí para dejar en un
-- solo lugar el fix completo de las dos tablas reportadas y porque
-- inspector_asignacion.sql pudo no haberse ejecutado en todos los entornos.
--
-- `add table` lanza error si la tabla ya está en la publicación; por eso cada
-- ALTER va envuelto en su propio bloque con EXCEPTION (igual que el patrón ya
-- usado en schema.sql y en inspector_asignacion.sql).
--
-- EJECUTAR MANUALMENTE en Supabase → SQL Editor (producción). Es idempotente:
-- se puede correr las veces que haga falta sin efectos secundarios.
-- ============================================================================
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.machine_inspectors';
  exception when duplicate_object then null; when others then null;
  end;
  begin
    execute 'alter publication supabase_realtime add table public.truck_yard_logs';
  exception when duplicate_object then null; when others then null;
  end;
end $$;

-- Verificación opcional (correr aparte para confirmar que quedaron incluidas):
-- select schemaname, tablename from pg_publication_tables
-- where pubname = 'supabase_realtime'
--   and tablename in ('machine_inspectors', 'truck_yard_logs');
