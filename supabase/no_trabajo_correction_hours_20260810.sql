-- 10-ago-2026: cuando un inspector marca "🟡 PARADA · NO TRABAJÓ LA MÁQUINA" sobre una
-- jornada que YA estaba cerrada (por "Finalizar jornada" o por el cierre automático), el
-- código ahora corrige las horas de ese turno a 0 y deja un tramo NEGATIVO auditable en
-- machine_work_segments con source='no_trabajo_correction' (ver SupervisorScreen.tsx,
-- marcarParadaNoTrabajo). Antes solo se creaba el ticket de aviso, sin corregir nada.
--
-- Este archivo agrega ese valor al CHECK constraint de la columna `source` (antes solo
-- permitía 'manual_finish','parada_averia','parada_no_trabajo','auto_close',
-- 'ajuste_manual','auto_full_shift').

alter table machine_work_segments drop constraint machine_work_segments_source_check;
alter table machine_work_segments add constraint machine_work_segments_source_check
  check (source = ANY (ARRAY[
    'manual_finish'::text, 'parada_averia'::text, 'parada_no_trabajo'::text,
    'auto_close'::text, 'ajuste_manual'::text, 'auto_full_shift'::text,
    'no_trabajo_correction'::text
  ]));

-- Corrección retroactiva puntual (10-ago-2026): 10 máquinas de varias empresas tenían
-- horas acreditadas el 09-ago-2026 por un "Finalizar jornada" manual, pero el inspector
-- confirmó al día siguiente que la máquina no trabajó ese turno (ticket "NO TRABAJÓ LA
-- MÁQUINA" en maintenance_requests). Se puso en 0 SOLO el turno reportado (no ambos, ej.
-- el chuto de Angelo Vazquez conservó su turno de día que sí trabajó) y se dejó el tramo
-- negativo auditable correspondiente. Backup previo en la tabla
-- `_backup_rounds_no_trabajo_20260810` (se puede borrar tras confirmar que todo cuadra).
--
-- Quedaron 2 máquinas SIN corregir por tener horas en AMBOS turnos el mismo día (no está
-- claro cuál de los dos no trabajó, hay que confirmar con su inspector antes de tocarlas):
--   - LUMINARIA PEC00235898 (Golden Touch) — día 7.99h / noche 10.06h
--   - PAYLOADER JCB4AAAYCK2245020 (Ferreconstrucciones 3-G) — día 4.76h / noche 4.11h
