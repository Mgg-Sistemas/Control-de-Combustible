-- ============================================================================
-- MEJORAS ADITIVAS DE SEGURIDAD Y RENDIMIENTO (07/08/2026, auditoría integral).
-- TODO en este archivo es ADITIVO: ningún DELETE/DROP de datos, ninguna tabla
-- se vacía ni se resetea. Aun así, las secciones 2 y 3 ENDURECEN políticas RLS
-- (restringen quién puede escribir) — revisa el comentario de cada una antes
-- de correrlas: si algún rol legítimo hoy depende del acceso amplio actual,
-- podría quedar bloqueado. Recomendado: respaldo antes de correr (pg_dump o
-- snapshot de Supabase) y correr sección por sección, no todo de un golpe.
-- ============================================================================

-- ── 1) ÍNDICES (sin riesgo, solo aceleran consultas existentes) ─────────────

-- El ledger de combustible (stock_movements) borra por (source_table,
-- source_id) en cada edición/borrado de un ingreso/despacho/traslado
-- (mv_intake/mv_dispatch/mv_transfer) y hoy no tiene índice para eso — cada
-- edición hace un recorrido completo de la tabla, que solo crece con el
-- tiempo.
create index if not exists idx_stock_movements_source
  on public.stock_movements(source_table, source_id);

-- ── 2) RLS: exigir el mismo control de módulo que ya usa el resto del
--    sistema (suppliers_write, inv_items_write, invreq_write, etc.) ────────
-- Hoy cualquier usuario autenticado (sin importar su rol/módulo) puede
-- marcar asistencia de OTRO empleado o registrar entregas de uniforme. El
-- propio comentario del esquema ya decía "solo con el módulo 'asistencia'",
-- pero la política no lo aplicaba. Esto solo restringe ESCRITURA — la
-- LECTURA no cambia.
drop policy if exists attendance_write on public.attendance;
create policy attendance_write on public.attendance
  for all to authenticated
  using (public.can_write_module('asistencia'))
  with check (public.can_write_module('asistencia'));

drop policy if exists uniform_deliveries_write on public.uniform_deliveries;
create policy uniform_deliveries_write on public.uniform_deliveries
  for all to authenticated
  using (public.can_write_module('asistencia'))
  with check (public.can_write_module('asistencia'));

-- ── 3) RLS: tablas que afectan directamente el PAGO a personal, hoy
--    escribibles por cualquier autenticado (sin exigir admin/supervisor) ───
-- supervisor_visits valida las jornadas para el pago (staff_pay_items exige
-- un check-in 'trabajando' aquí) — cualquier cuenta logueada puede insertar
-- uno falso hoy. control_closures dispara el cierre/pago semanal y
-- notificaciones a admin. Se restringe a admin/supervisor, que es quien
-- realmente opera estas pantallas.
drop policy if exists sv_write on public.supervisor_visits;
create policy sv_write on public.supervisor_visits
  for all to authenticated
  using (public.current_role() in ('admin','supervisor'))
  with check (public.current_role() in ('admin','supervisor'));

drop policy if exists cc_write on public.control_closures;
create policy cc_write on public.control_closures
  for all to authenticated
  using (not public.is_anon())
  with check (not public.is_anon());

-- ── 4) Verificación opcional (correr DESPUÉS, no antes) ──────────────────
-- select cedula, count(*) from public.profiles group by 1 having count(*) > 1;
--   -- si esto devuelve filas, resuelve los duplicados ANTES de crear el
--   -- índice único de abajo (si no, el índice fallará al crearse — no rompe
--   -- nada, solo no se aplica).
-- create unique index if not exists uq_profiles_cedula
--   on public.profiles (lower(btrim(cedula))) where cedula is not null and btrim(cedula) <> '';
