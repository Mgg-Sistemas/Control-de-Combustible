-- ============================================================================
-- FIX RLS de INSPECCIONES DE MAQUINARIA.
-- Problema: la política de escritura exigía public.is_staff() (rol
-- admin/supervisor/operador). Con los roles personalizados FIJOS, un usuario
-- con "full control" sobre el módulo Inspecciones — pero cuyo rol base NO es
-- staff — veía el botón, llenaba el formulario y la BD RECHAZABA el insert
-- (la inspección "no se guardaba"). Mismo patrón que el pago de Agatha.
--
-- Solución: alinear el RLS con el permiso por módulo de la UI, igual que hace
-- can_write_module() en el resto del sistema. Se permite escribir a staff O a
-- quien tenga escritura/full en el módulo 'inspecciones_maq'. Idempotente.
-- ============================================================================
drop policy if exists mi_write on public.machine_inspections;
create policy mi_write on public.machine_inspections for all to authenticated
  using (public.is_staff() or public.can_write_module('inspecciones_maq'))
  with check (public.is_staff() or public.can_write_module('inspecciones_maq'));
