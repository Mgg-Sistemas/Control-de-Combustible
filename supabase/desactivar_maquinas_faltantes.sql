-- ============================================================================
-- DESACTIVA el mecanismo "inspector maquinas faltantes" (07/08/2026, a pedido
-- del cliente: "que ya no exista eso, que las máquinas sin asignar salgan sin
-- asignar y ya"). Esto REVIERTE la automatización confirmada el 04/08/2026 en
-- supabase/maquinas_faltantes.sql + supabase/auto_start_dia_maquinas_faltantes.sql
-- + supabase/cap_truck_hours.sql.
--
-- Qué hace:
--   1) Respalda (no borra) las asignaciones actuales del usuario virtual antes
--      de tocarlas.
--   2) Quita esas asignaciones — a partir de aquí esas máquinas aparecen como
--      "Sin inspector (por asignar)" en todas las pantallas, exactamente igual
--      que cuando a una máquina nunca se le asignó nadie (es el camino que ya
--      maneja toda la UI hoy).
--   3) Apaga los 3 cron jobs relacionados, para que NO se vuelvan a
--      auto-asignar ni a cargarles horas automáticas de ahora en adelante.
--
-- Qué NO hace (a propósito, por integridad de datos):
--   - NO borra ni modifica machine_rounds ni machine_work_segments ya
--     generados históricamente por este mecanismo (horas ya usadas en
--     nómina/reportes de días pasados quedan intactas).
--   - NO borra las funciones SQL (assign_missing_to_placeholder,
--     auto_full_shift_placeholder, auto_start_placeholder_day,
--     cap_truck_hours) — solo se desprograman los cron jobs. Quedan inertes
--     (sin cron que las llame, y sin filas de machine_inspectors con el id
--     del virtual para que cap_truck_hours tenga algo que topar). Si algún
--     día se quiere reactivar, solo hay que volver a programar los crons.
--
-- Corre una sola vez en Supabase → SQL Editor.
-- ============================================================================

-- 1) Respaldo de las asignaciones actuales del usuario virtual (antes de tocarlas).
create table if not exists public.backup_machine_inspectors_20260807_maquinas_faltantes as
select * from public.machine_inspectors
where inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';

-- 2) Quita esas asignaciones — las máquinas quedan "Sin inspector (por asignar)"
--    de inmediato en toda la app (mismo camino que una máquina nunca asignada).
delete from public.machine_inspectors
where inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';

-- 3) Apaga los 3 cron jobs (no se borran las funciones, solo se desprograman).
do $$ begin perform cron.unschedule('assign-missing-to-placeholder'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('auto-full-shift-placeholder'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('auto-start-placeholder-day'); exception when others then null; end $$;

-- 4) Verificación (opcional, corre después para confirmar):
-- select count(*) from public.machine_inspectors where inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'; -- debe dar 0
-- select jobname, schedule, active from cron.job where jobname in ('assign-missing-to-placeholder','auto-full-shift-placeholder','auto-start-placeholder-day'); -- debe dar 0 filas (o active=false si el proveedor las conserva desactivadas)
