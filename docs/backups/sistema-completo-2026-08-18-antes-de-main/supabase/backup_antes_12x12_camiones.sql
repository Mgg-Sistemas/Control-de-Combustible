-- ============================================================================
-- BACKUP — correr ANTES de aplicar el cambio "bolqueta/toronto sin asignar
-- trabajan 12x12" (ver supabase/cap_truck_hours.sql, supabase/auto_close_jornadas.sql
-- y supabase/maquinas_faltantes.sql, actualizados el 04/08/2026).
--
-- Guarda una foto de las jornadas y segmentos de camiones (volqueta/toronto)
-- TAL COMO ESTÁN antes del cambio, por si hay que comparar o revertir horas.
-- No borra ni modifica nada — solo crea 2 tablas nuevas con una copia.
-- Idempotente (create table if not exists): si ya corriste esto hoy, no repite el backup.
-- Corre esto UNA SOLA VEZ en Supabase → SQL Editor, antes de los otros 3 scripts.
-- ============================================================================

create table if not exists public.backup_machine_rounds_20260804 as
select mr.*
from public.machine_rounds mr
join public.machinery mch on mch.id = mr.machinery_id
where lower(coalesce(mch.code, '')) ~ 'volqueta|toronto';

create table if not exists public.backup_machine_work_segments_20260804 as
select mws.*
from public.machine_work_segments mws
join public.machinery mch on mch.id = mws.machinery_id
where lower(coalesce(mch.code, '')) ~ 'volqueta|toronto';

-- Verifica cuántas filas quedaron respaldadas:
-- select count(*) from public.backup_machine_rounds_20260804;
-- select count(*) from public.backup_machine_work_segments_20260804;

-- Para revertir manualmente una fila puntual si algo sale mal, por ejemplo:
-- update public.machine_rounds mr set day_hours = b.day_hours, night_hours = b.night_hours
--   from public.backup_machine_rounds_20260804 b where b.id = mr.id and mr.id = '<uuid de la fila>';
