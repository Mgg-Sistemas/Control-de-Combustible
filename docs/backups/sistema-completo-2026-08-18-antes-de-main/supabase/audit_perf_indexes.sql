-- ============================================================================
-- AUDITORÍA: índices de rendimiento + RLS más eficiente (09-ago-2026).
--
-- audit_log ya pasó los 60 mil registros: una búsqueda de texto libre (ILIKE)
-- sobre sus columnas obligaba a Postgres a revisar la tabla ENTERA fila por
-- fila (8-20s por búsqueda, confirmado con EXPLAIN ANALYZE) — llegó a saturar
-- el servidor con varias personas buscando a la vez. Ver el cambio de
-- src/screens/AuditScreen.tsx (búsqueda en dos niveles: resuelve a id primero,
-- con índice; el ILIKE de texto libre queda como respaldo acotado a la fecha
-- visible). Este archivo son los índices que ese cambio necesita, aplicados ya
-- directo en la BD — se deja acá para que el repo quede sincronizado.
-- ============================================================================

create extension if not exists pg_trgm;

create index if not exists audit_log_user_name_trgm_idx on public.audit_log using gin (user_name gin_trgm_ops);
create index if not exists audit_log_row_label_trgm_idx on public.audit_log using gin (row_label gin_trgm_ops);
-- audit_log_detail_trgm_idx: se creó acá pero el código NUNCA llegó a buscar por
-- `detail` (se descartó por costo antes de desplegar) — quedó con idx_scan=0,
-- solo pagando mantenimiento en CADA insert de audit_log (la tabla de más
-- volumen de toda la app, ~15-20 mil filas/día). Eliminado el 09-ago-2026 al
-- diagnosticar por qué el sistema empezó a caerse: 3 índices GIN en una tabla
-- con ese volumen de escritura, en un compute Nano/Micro ya casi al tope de
-- CPU, es carga real — y este ni se estaba usando.
drop index if exists public.audit_log_detail_trgm_idx;

-- row_id: usado por "todo lo que le pasó a esta máquina/persona/empleado" (IN de
-- varios ids resueltos); table_name: usado al filtrar por módulo.
create index if not exists audit_log_row_id_idx on public.audit_log using btree (row_id);
create index if not exists audit_log_table_name_idx on public.audit_log using btree (table_name);

-- RLS: auth.uid() se re-evaluaba en CADA FILA en vez de una sola vez por
-- consulta (hallazgo del advisor de rendimiento de Supabase). Mismo resultado,
-- más rápido — el (select ...) hace que Postgres lo calcule una sola vez.
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and (p.can_audit or p.role = 'admin'::user_role)
    )
  );
