-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime para el módulo COMBUSTIBLE (consumos / ingresos / traslados).
-- Un consumo recién hecho "no aparecía" en la pantalla ya abierta porque estas
-- tablas NO estaban en la publicación `supabase_realtime` → no emitían eventos
-- postgres_changes. Con esto, la lista se actualiza sola (como Inspecciones).
--
-- Idempotente: si la tabla ya está en la publicación, el ADD lanza error; por eso
-- se envuelve en un bloque que ignora el duplicado. Correr en Supabase → SQL Editor.
-- REGLA: una tabla NO emite realtime si no está en la publicación supabase_realtime.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  begin alter publication supabase_realtime add table public.dispatches;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.fuel_intakes;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.transfers;      exception when duplicate_object then null; end;
end $$;
