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

-- ── security#4: el bloqueo por 3 intentos fallidos era PERMANENTE (solo admin
--    desbloqueaba) y register_failed_login era invocable pre-login con CUALQUIER
--    cédula/usuario → se podía bloquear la cuenta de otro a propósito (DoS dirigido),
--    y peor: locked_at se re-escribía a now() en cada intento con attempts>=3, así que
--    un atacante que siguiera llamando mantenía el bloqueo indefinido.
--    FIX (decisión del cliente 11-ago-2026): AUTO-DESBLOQUEO a los 15 min.
--      · locked_at se fija UNA sola vez (al cruzar a bloqueado), no se refresca.
--      · register es NO-OP si ya está bloqueado dentro del enfriamiento (no extiende).
--      · enfriamiento vencido → ciclo nuevo (attempts=1), no sigue sumando.
--      · login_status_* limpia el bloqueo vencido (auto-desbloqueo perezoso) al iniciar login.
--      · el admin sigue desbloqueando al instante (reset_failed_login / panel Usuarios).
--    Las 4 funciones (cédula + usuario) conservan su firma → el cliente NO cambia.
create or replace function public.register_failed_login(p_cedula text)
returns table(attempts integer, locked boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare r public.profiles%rowtype; v_att int; v_lock boolean; v_at timestamptz;
begin
  select * into r from public.profiles where btrim(cedula) = btrim(p_cedula) limit 1 for update;
  if not found then return query select 0, false; return; end if;
  v_att := coalesce(r.failed_attempts, 0); v_lock := coalesce(r.locked, false); v_at := r.locked_at;
  if v_lock and v_at is not null and v_at <= now() - interval '15 minutes' then
    v_att := 0; v_lock := false; v_at := null;
  end if;
  if v_lock then return query select v_att, true; return; end if;
  v_att := v_att + 1;
  if v_att >= 3 then v_lock := true; v_at := now(); end if;
  update public.profiles set failed_attempts = v_att, locked = v_lock, locked_at = v_at where id = r.id;
  return query select v_att, v_lock;
end $function$;

create or replace function public.register_failed_login_username(p_username text)
returns table(attempts integer, locked boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare r public.profiles%rowtype; v_att int; v_lock boolean; v_at timestamptz;
begin
  select * into r from public.profiles where lower(btrim(username)) = lower(btrim(p_username)) limit 1 for update;
  if not found then return query select 0, false; return; end if;
  v_att := coalesce(r.failed_attempts, 0); v_lock := coalesce(r.locked, false); v_at := r.locked_at;
  if v_lock and v_at is not null and v_at <= now() - interval '15 minutes' then
    v_att := 0; v_lock := false; v_at := null;
  end if;
  if v_lock then return query select v_att, true; return; end if;
  v_att := v_att + 1;
  if v_att >= 3 then v_lock := true; v_at := now(); end if;
  update public.profiles set failed_attempts = v_att, locked = v_lock, locked_at = v_at where id = r.id;
  return query select v_att, v_lock;
end $function$;

create or replace function public.login_status_for_cedula(p_cedula text)
returns table(email text, locked boolean)
language plpgsql security definer set search_path to 'public', 'auth' as $function$
begin
  update public.profiles p set failed_attempts = 0, locked = false, locked_at = null
   where btrim(p.cedula) = btrim(p_cedula) and p.locked = true
     and p.locked_at is not null and p.locked_at <= now() - interval '15 minutes';
  return query
    select au.email::text, coalesce(pr.locked, false)
    from auth.users au join public.profiles pr on pr.id = au.id
    where pr.cedula = btrim(p_cedula) and coalesce(au.is_anonymous, false) = false
    limit 1;
end $function$;

create or replace function public.login_status_for_username(p_username text)
returns table(email text, locked boolean)
language plpgsql security definer set search_path to 'public', 'auth' as $function$
begin
  update public.profiles p set failed_attempts = 0, locked = false, locked_at = null
   where lower(btrim(p.username)) = lower(btrim(p_username)) and p.locked = true
     and p.locked_at is not null and p.locked_at <= now() - interval '15 minutes';
  return query
    select au.email::text, coalesce(pr.locked, false)
    from auth.users au join public.profiles pr on pr.id = au.id
    where lower(btrim(pr.username)) = lower(btrim(p_username)) and coalesce(au.is_anonymous, false) = false
    limit 1;
end $function$;

-- ── sync#4 (TOCTOU): el máximo de 2 operadores por (máquina, fecha, turno) se validaba
--    SOLO en el cliente (startJornada lee el conteo y luego inserta) → dos operadores
--    escaneando a la vez podían quedar 3 en el turno. Se cierra con un trigger que toma
--    advisory lock por (máquina, fecha, turno) —igual patrón que one_fuel (sync#1)— y
--    cuenta atómicamente. SECURITY DEFINER para no subcontar por RLS del rol anónimo (QR).
--    (La otra regla, "1 máquina por operador por día", YA es atómica: constraint única
--     uq_operator_day sobre (cedula, work_date).)
create or replace function public.enforce_max_operators_per_shift()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_ci text; v_others int;
begin
  if new.shift is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.machinery_id = old.machinery_id
     and new.work_date = old.work_date
     and new.shift is not distinct from old.shift
     and regexp_replace(coalesce(new.cedula,''),'\D','','g') = regexp_replace(coalesce(old.cedula,''),'\D','','g')
  then
    return new;
  end if;
  v_ci := regexp_replace(coalesce(new.cedula,''),'\D','','g');
  perform pg_advisory_xact_lock(hashtext(new.machinery_id::text || ':' || new.work_date::text || ':' || new.shift));
  select count(distinct regexp_replace(coalesce(cedula,''),'\D','','g'))
    into v_others
  from public.operator_assignments
  where machinery_id = new.machinery_id and work_date = new.work_date and shift = new.shift
    and id <> new.id
    and regexp_replace(coalesce(cedula,''),'\D','','g') <> v_ci;
  if v_others >= 2 then
    raise exception 'El turno de % de esta máquina ya tiene 2 operadores (máximo por turno).',
      case when new.shift = 'day' then 'DÍA' else 'NOCHE' end
      using errcode = 'check_violation';
  end if;
  return new;
end $function$;

drop trigger if exists trg_max_ops_per_shift on public.operator_assignments;
create trigger trg_max_ops_per_shift
before insert or update on public.operator_assignments
for each row execute function public.enforce_max_operators_per_shift();
