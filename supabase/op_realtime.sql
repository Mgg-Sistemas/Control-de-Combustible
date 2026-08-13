-- ============================================================================
-- REALTIME de OBRAS PÚBLICAS (13-ago-2026).
-- El módulo (teléfono del supervisor + panel de PC) ya se suscribe a las tablas
-- op_* con useRealtimeRefresh, PERO una tabla NO emite eventos si no está en la
-- publicación `supabase_realtime`. Esto AGREGA todas las tablas op_* a la
-- publicación para que los cambios (jornadas, averías/paradas, visitas, m³ por
-- edificio, asignaciones, máquinas externas…) se sincronicen EN VIVO entre el
-- teléfono y el panel. Idempotente (ignora las que ya estén publicadas).
-- Correr en Supabase → SQL Editor.
-- ============================================================================
do $$
declare
  t text;
  tablas text[] := array[
    'op_machine_supervisors', 'op_machine_rounds', 'op_maintenance',
    'op_supervisor_visits', 'op_daily_reports', 'op_report_settings',
    'op_edificio_removidos', 'op_edificio_base', 'op_external_machines'
  ];
begin
  foreach t in array tablas loop
    -- solo si la tabla existe y no está ya en la publicación
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t)
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       )
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
