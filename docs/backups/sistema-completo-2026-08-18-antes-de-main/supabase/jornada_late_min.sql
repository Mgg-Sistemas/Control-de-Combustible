-- Columna para el DESFASE de declaración de jornada (minutos que pasó de la hora
-- límite 9:30). La escribe la app al INICIAR jornada; Inspecciones la muestra como
-- "⏰ inició X tarde (desfasado)". Idempotente. Sin correrla, la app no falla (la
-- escritura y la lectura del desfase son best-effort), solo no se muestra el aviso.
alter table public.machine_rounds add column if not exists jornada_late_min integer;
