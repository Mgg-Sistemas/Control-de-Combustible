-- Borra la jornada de PRUEBA: JUMBO 320 · FERRECONSTRUCCIONES 3-G, C.A
-- (serial CATO320CP5BN01795) · 2026-07-31 · turno NOCHE 0.04 h.
-- Fila ya identificada por id. Correr en Supabase → SQL Editor.

-- 1) VER la fila antes de borrar (no cambia nada):
select id, round_date, round_no, day_hours, night_hours, jornada_shift, recorded_by
from public.machine_rounds
where id = '27c7be91-f22e-4c5e-aa40-59b7bea69cb8';

-- 2) BORRARLA (con salvaguardas: día en 0 y noche pequeña, por si acaso):
delete from public.machine_rounds
where id = '27c7be91-f22e-4c5e-aa40-59b7bea69cb8'
  and day_hours = 0
  and night_hours <= 0.5;
