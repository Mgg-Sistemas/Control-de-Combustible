-- Fechas de inactivación/reactivación de maquinaria (toggle admin "Operativa/No operativa"
-- del catálogo, EquiposScreen). Documenta columnas que ya existen en producción (agregadas
-- a mano en su momento) para que `schema.sql`/este repo reflejen la BD real.
--   inactivated_at → se marca cuando el admin pasa la máquina a "⛔ Inactiva" (operational=false).
--   reactivated_at → se marca cuando vuelve a "● Operativa" (operational=true).
-- Uso: EquiposScreen.tsx → EstadoFechaLine ("🔴 Inactivada el .../🟢 Reactivada el ...").
-- Idempotente: se puede correr varias veces sin romper nada ni tocar filas existentes.

alter table public.machinery
  add column if not exists inactivated_at timestamptz,
  add column if not exists reactivated_at timestamptz;

-- Verificación rápida (debe listar ambas columnas):
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'machinery'
--    and column_name in ('inactivated_at', 'reactivated_at');
