-- ============================================================================
-- ENDURECIMIENTO DE SEGURIDAD Y CONCURRENCIA — 11-ago-2026
-- Aplicado a la BD en vivo (proyecto ddcwqmuqdqnsrtpticpx) tras la auditoría de
-- arquitectura y QA. Este archivo es la FUENTE DE VERDAD de estos cambios: córrelo
-- (además de schema.sql y los parches previos) al reconstruir un entorno desde cero.
-- Todo es idempotente (create or replace / drop policy if exists) y ADITIVO.
-- ============================================================================

-- ── security#1: un usuario podía autoconcederse Auditoría (can_audit) o vincularse
--    cualquier rol dinámico (app_role_id) editando su propio profile. La guardia solo
--    cubría `role`. Se amplía a can_audit y app_role_id.
create or replace function public.guard_role_change()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'No autorizado para cambiar el rol de usuario';
    end if;
    if new.can_audit is distinct from old.can_audit then
      raise exception 'No autorizado para cambiar el acceso a auditoría';
    end if;
    if new.app_role_id is distinct from old.app_role_id then
      raise exception 'No autorizado para cambiar el rol asignado';
    end if;
  end if;
  return new;
end $function$;

-- ── backend#1 / security#3: machine_rounds (horas → pagos), machine_day_operators y
--    el UPDATE de maintenance_requests estaban abiertos a CUALQUIER sesión (incl. QR
--    anónimo). Se cierra la ESCRITURA a sesiones no anónimas.
drop policy if exists mr_write on public.machine_rounds;
create policy mr_write on public.machine_rounds for all
  using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists mdo_write on public.machine_day_operators;
create policy mdo_write on public.machine_day_operators for all
  using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists mr_maint_update on public.maintenance_requests;
create policy mr_maint_update on public.maintenance_requests for update
  using (not public.is_anon()) with check (not public.is_anon());

-- ── backend#3: tablas sensibles con escritura abierta → not is_anon() (y las 4 de
--    nómina con el control ya diseñado en mejoras_seguridad_rendimiento.sql).
drop policy if exists attendance_write on public.attendance;
create policy attendance_write on public.attendance for all to authenticated
  using (public.can_write_module('asistencia')) with check (public.can_write_module('asistencia'));
drop policy if exists uniform_deliveries_write on public.uniform_deliveries;
create policy uniform_deliveries_write on public.uniform_deliveries for all to authenticated
  using (public.can_write_module('asistencia')) with check (public.can_write_module('asistencia'));
drop policy if exists sv_write on public.supervisor_visits;
create policy sv_write on public.supervisor_visits for all to authenticated
  using (public.current_role() in ('admin','supervisor')) with check (public.current_role() in ('admin','supervisor'));
drop policy if exists cc_write on public.control_closures;
create policy cc_write on public.control_closures for all using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists bcv_write on public.bcv_rates;
create policy bcv_write on public.bcv_rates for all using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists fletes_write on public.fletes;
create policy fletes_write on public.fletes for all using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists fcm_write on public.food_company_meals;
create policy fcm_write on public.food_company_meals for all using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists fd_write on public.food_distributions;
create policy fd_write on public.food_distributions for all using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists gim_write on public.guard_inspector_meta;
create policy gim_write on public.guard_inspector_meta for all using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists gs_write on public.guard_shifts;
create policy gs_write on public.guard_shifts for all using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists mws_write on public.machine_work_segments;
create policy mws_write on public.machine_work_segments for all using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists mo_write on public.machine_operators;
create policy mo_write on public.machine_operators for all using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists truck_att_write on public.truck_attendance;
create policy truck_att_write on public.truck_attendance for all using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists invtr_all on public.inventory_transfers;
create policy invtr_all on public.inventory_transfers for all using (not public.is_anon()) with check (not public.is_anon());
drop policy if exists aliados_write on public.aliados;
create policy aliados_write on public.aliados for all using (not public.is_anon()) with check (not public.is_anon());

-- ── backend#4: can_write_module() hacía fail-OPEN (sin fila ⇒ escritura). Se alinea
--    con defaultLevel() de la UI: los módulos restringidos devuelven false sin fila.
create or replace function public.can_write_module(mod text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare lvl text;
begin
  if public.is_anon() then return false; end if;
  if public.is_admin() then return true; end if;
  select mp.level into lvl from public.module_permissions mp
    where mp.user_id = auth.uid() and mp.module = mod limit 1;
  if lvl is null then
    return mod not in (
      'control_pagos','margen_ganancia','usuarios','empleados','aliados','nomina',
      'uniformes','compras','inventario','supervision','comida','asistencia',
      'asistencia_camiones','inspecciones_maq','coordinador_inspectores',
      'coordinacion_operadores','mangueras','fabricacion_planta','acarreo','geodesta');
  end if;
  return lvl in ('escritura','full');
end; $function$;

-- ── backend#5: EXECUTE explícito para update_machine_location (antes: PUBLIC implícito).
revoke all on function public.update_machine_location(uuid,numeric,numeric,text) from public;
grant execute on function public.update_machine_location(uuid,numeric,numeric,text) to anon, authenticated;

-- ── sync#1 (TOCTOU): mv_dispatch/mv_transfer/one_fuel_per_machine_per_day validaban
--    stock/cupo sin bloquear → sobregiro por concurrencia. Ver detalle y advertencia
--    de pruebas en supabase/fix_stock_race_condition.sql. Aplicado: `for update` sobre
--    la fila del tanque (dispatch/transfer) y advisory lock por (máquina, fecha) en
--    one_fuel_per_machine_per_day, + índice idx_stock_movements_source.
--    (El cuerpo completo de las 3 funciones se aplicó vía migración; ver ese archivo.)
create index if not exists idx_stock_movements_source on public.stock_movements(source_table, source_id);
