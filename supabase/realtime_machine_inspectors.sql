-- ============================================================================
-- Realtime para machine_inspectors (asignaciones CHECK)
-- ----------------------------------------------------------------------------
-- La PC (Resumen de Inspecciones) se suscribe a 'machine_inspectors', pero la
-- tabla NO estaba en la publicación `supabase_realtime`, así que al asignar o
-- reasignar un inspector en un dispositivo la PC no se actualizaba sola (había
-- que refrescar a mano). Esto la agrega. Idempotente: si ya está, no hace nada.
-- ============================================================================
do $$
begin
  begin
    alter publication supabase_realtime add table public.machine_inspectors;
  exception
    when duplicate_object then null;  -- ya estaba publicada
    when others then null;
  end;
end $$;

-- Verificación (debe listar machine_inspectors):
-- select tablename from pg_publication_tables
--  where pubname = 'supabase_realtime' and tablename = 'machine_inspectors';
