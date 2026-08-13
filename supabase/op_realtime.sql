-- ============================================================================
-- Obras Públicas — REALTIME. Publica las tablas op_* para que el teléfono de las
-- supervisoras y el panel de admin se sincronicen EN VIVO (jornada/avería/parada/
-- m³/reporte del día). Sin esto, los cambios solo se ven al refrescar a mano.
-- Idempotente: ignora las tablas que ya estén en la publicación.
-- Correr en Supabase → SQL Editor (proyecto ddcwqmuqdqnsrtpticpx).
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'op_machine_rounds',
    'op_maintenance',
    'op_supervisor_visits',
    'op_daily_reports',
    'op_report_settings'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;  -- ya estaba publicada
      when undefined_table  then null;  -- por si alguna no existe aún
    end;
  end loop;
end $$;
