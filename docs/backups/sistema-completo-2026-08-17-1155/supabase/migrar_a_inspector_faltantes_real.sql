-- ============================================================================
-- MIGRAR del usuario virtual INVENTADO (00000000-…-fa1a) al usuario REAL
-- "inspector maquinas faltantes" (3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b).
-- ----------------------------------------------------------------------------
-- CONTEXTO: la primera versión de supabase/maquinas_faltantes.sql (corrida hoy
-- 04/08/2026) creó un usuario de sistema NUEVO con un UUID inventado
-- ('00000000-0000-0000-0000-00000000fa1a') para cubrir máquinas sin inspector.
-- Se descubrió que YA EXISTÍA en producción un usuario real para esto mismo —
-- "inspector maquinas faltantes", id '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b',
-- con 143 asignaciones históricas — que es el que se ve en el Resumen/dashboard
-- de la app. Este script mueve cualquier fila que haya quedado asignada al
-- usuario inventado hacia el usuario real, para que TODO quede en un solo
-- "cajón" (no dos paralelos).
--
-- QUÉ HACE (solo si hay algo que mover — si nunca corriste la versión vieja,
-- este script no encuentra nada y no cambia nada):
--   1) Respalda machine_inspectors completo (es chica).
--   2) Muestra cuántas filas hay que mover (preview).
--   3) Mueve esas filas: cambia inspector_id/inspector_name al usuario real.
--      Es seguro porque hay un índice único (machinery_id, shift) — nunca puede
--      haber dos filas para la misma máquina+turno, así que mover no puede
--      duplicar ni pisar una asignación real que ya tuviera el usuario real.
--   4) Verificación: confirma que ya no queda nada bajo el usuario inventado.
--
-- NO borra el usuario inventado (auth.users/profiles) — queda ahí sin uso, no
-- hace daño dejarlo. No es necesario borrarlo para que todo funcione bien.
--
-- ORDEN: correr DESPUÉS de la versión ya corregida de maquinas_faltantes.sql /
-- cap_truck_hours.sql / auto_close_jornadas.sql / auto_start_dia_maquinas_faltantes.sql
-- / backfill_maquinas_faltantes_agosto.sql (todas ya actualizadas al UUID real).
-- Idempotente: correrlo de nuevo no hace nada si ya no queda nada por mover.
-- ============================================================================

-- 1) RESPALDO antes de tocar nada.
create table if not exists public.backup_machine_inspectors_20260804_migracion as
select * from public.machine_inspectors;

-- 2) PREVIEW: cuántas filas están bajo el usuario inventado (a mover).
select mi.shift, count(*) as filas_a_migrar
from public.machine_inspectors mi
where mi.inspector_id = '00000000-0000-0000-0000-00000000fa1a'::uuid
group by mi.shift
order by mi.shift;

-- 3) MIGRA: cambia esas filas al usuario real. El índice único
--    (machinery_id, shift) garantiza que no puede haber conflicto (si el
--    usuario real ya tuviera esa máquina+turno, el inventado nunca la habría
--    podido tomar en primer lugar — los crons chequean "not exists" antes).
update public.machine_inspectors
set inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'::uuid,
    inspector_name = 'inspector maquinas faltantes'
where inspector_id = '00000000-0000-0000-0000-00000000fa1a'::uuid;

-- 4) VERIFICACIÓN: debe dar 0 filas (nada quedó bajo el usuario inventado).
select count(*) as filas_restantes_usuario_inventado
from public.machine_inspectors
where inspector_id = '00000000-0000-0000-0000-00000000fa1a'::uuid;

-- Cuántas asignaciones tiene ahora el usuario real (control):
select shift, count(*) as asignaciones_del_cajon
from public.machine_inspectors
where inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'::uuid
group by shift
order by shift;
