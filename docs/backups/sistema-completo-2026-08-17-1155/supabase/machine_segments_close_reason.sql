-- ============================================================================
-- MOTIVO DE CIERRE (12-ago-2026): columna para guardar el motivo cuando el
-- inspector FINALIZA la jornada de forma MANUAL y ANTICIPADA (antes de la hora de
-- fin: día <7pm / noche <1am). El teléfono lo exige obligatorio (excepto el
-- inspector "SOS LA GUAIRA"). Insert best-effort → sin la columna igual cierra la
-- jornada (el motivo queda además en el audit log), pero con la columna se puede
-- reportar/consultar. Correr en Supabase → SQL Editor.
-- ============================================================================
alter table public.machine_work_segments
  add column if not exists close_reason text;
