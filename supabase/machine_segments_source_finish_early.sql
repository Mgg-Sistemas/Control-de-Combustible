-- ============================================================================
-- FIX (13-ago-2026): el cierre MANUAL ANTICIPADO de una jornada inserta un tramo
-- en machine_work_segments con source='manual_finish_early' y el motivo en
-- close_reason. Pero el CHECK original de `source` NO incluía 'manual_finish_early'
-- (solo se agregó la columna close_reason, ver machine_segments_close_reason.sql),
-- así que ese INSERT VIOLABA el CHECK y, al ser best-effort en la app, se
-- descartaba en silencio → el MOTIVO DE CIERRE nunca se guardaba (solo quedaba en
-- la bitácora de auditoría). Este script re-crea el CHECK incluyendo el nuevo
-- valor para que el motivo sí se persista y pueda reportarse.
--
-- Borra dinámicamente CUALQUIER check constraint de la columna `source` (sin
-- depender del nombre autogenerado) y lo vuelve a crear con el catálogo completo.
-- Aditivo, idempotente. Correr una vez en Supabase → SQL Editor.
-- ============================================================================
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.machine_work_segments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.machine_work_segments drop constraint %I', c);
  end loop;
  -- NOT VALID: valida solo INSERT/UPDATE nuevos, NO escanea las filas existentes. Así
  -- no choca con valores legados de `source` que ya estén en la tabla (el error 23514
  -- que salía al re-crear el CHECK), y a la vez permite 'manual_finish_early' de ahora
  -- en adelante. La restricción queda activa para todo lo nuevo.
  alter table public.machine_work_segments
    add constraint machine_work_segments_source_check
    check (source in (
      'manual_finish', 'manual_finish_early',
      'parada_averia', 'parada_no_trabajo',
      'auto_close', 'ajuste_manual', 'auto_full_shift'
    )) not valid;
end $$;
