-- ============================================================================
-- JORNADA POR TIEMPO (INICIAR / FINALIZAR) en la vista de inspección.
-- El inspector toca "INICIAR JORNADA" (se guarda la hora) y luego "FINALIZAR
-- JORNADA": las horas trabajadas = (fin − inicio) se suman a Control de
-- maquinaria (day_hours / night_hours según el turno). Se guarda la hora de
-- inicio en machine_rounds para que sobreviva aunque se cierre la pantalla.
-- ============================================================================
alter table public.machine_rounds
  add column if not exists jornada_start_at timestamptz, -- inicio de la jornada abierta (null = cerrada)
  add column if not exists jornada_shift text;           -- 'day' | 'night' del inicio
