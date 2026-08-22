-- ============================================================================
-- AUDITORÍA — más casos de "a qué se lo hizo" (row_label). Antes, si la fila
-- afectada no tenía code/full_name/name/plate/serial/... y tampoco un
-- machinery_id, el registro afectado quedaba SIN nombre legible y la pantalla/
-- PDF terminaban mostrando solo un ID corto (ej. "ID 3f9a21bc…") — justo el
-- hueco que el cliente pidió tapar para "que no quede duda" de a qué se le
-- hizo la acción. Afecta sobre todo tablas de DINERO y traslados:
--   - company_payments (pago de empresa)  → ya tiene company_name en la fila.
--   - fuel_intakes (ingreso de combustible) → tiene "supplier" (proveedor).
--   - dispatches (surtido)                 → tiene "driver_operator".
--   - transfers / authorizations / dispatches con vehicle_id o *_tank_id →
--     antes solo se resolvía machinery_id; ahora también vehicle_id (placa)
--     y tank_id/to_tank_id/from_tank_id (nombre del tanque).
--   - purchase_orders con supplier_id → nombre del proveedor.
-- Idempotente: reemplaza el cuerpo de audit_row(); los triggers ya existentes
-- (creados en audit.sql) quedan usando esta versión automáticamente.
-- ============================================================================

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uname text;
  rid   text;
  newj  jsonb := case when TG_OP <> 'DELETE' then to_jsonb(NEW) else null end;
  oldj  jsonb := case when TG_OP <> 'INSERT' then to_jsonb(OLD) else null end;
  lbl   text;
  fkid  text;
  chg   jsonb;
begin
  select full_name into uname from public.profiles where id = auth.uid();
  rid := coalesce(newj->>'id', oldj->>'id');

  -- Nombre legible del registro (lo primero que exista, directo en la fila).
  lbl := coalesce(
    newj->>'code', oldj->>'code',
    newj->>'full_name', oldj->>'full_name',
    nullif(btrim(coalesce(newj->>'first_name','') || ' ' || coalesce(newj->>'last_name','')), ''),
    nullif(btrim(coalesce(oldj->>'first_name','') || ' ' || coalesce(oldj->>'last_name','')), ''),
    newj->>'name', oldj->>'name',
    newj->>'plate', oldj->>'plate',
    newj->>'serial', oldj->>'serial',
    newj->>'title', oldj->>'title',
    newj->>'descripcion', oldj->>'descripcion',
    newj->>'sku', oldj->>'sku',
    newj->>'company_name', oldj->>'company_name',   -- company_payments (dinero)
    newj->>'supplier', oldj->>'supplier',            -- fuel_intakes (ingreso combustible)
    newj->>'driver_operator', oldj->>'driver_operator' -- dispatches (surtido)
  );

  -- Si la fila no trae nombre propio, resolverlo por la relación (máquina,
  -- vehículo o tanque) que sí tenga un catálogo con nombre. Prueba en orden:
  -- máquina → vehículo → tanque (tank_id / to_tank_id / from_tank_id).
  if lbl is null then
    fkid := coalesce(newj->>'machinery_id', oldj->>'machinery_id');
    if fkid is not null then
      begin select code into lbl from public.machinery where id = fkid::uuid;
      exception when others then lbl := null; end;
    end if;
  end if;
  if lbl is null then
    fkid := coalesce(newj->>'vehicle_id', oldj->>'vehicle_id');
    if fkid is not null then
      begin select plate into lbl from public.vehicles where id = fkid::uuid;
      exception when others then lbl := null; end;
    end if;
  end if;
  if lbl is null then
    fkid := coalesce(newj->>'tank_id', oldj->>'tank_id', newj->>'to_tank_id', oldj->>'to_tank_id', newj->>'from_tank_id', oldj->>'from_tank_id');
    if fkid is not null then
      begin select name into lbl from public.tanks where id = fkid::uuid;
      exception when others then lbl := null; end;
    end if;
  end if;
  if lbl is null then
    fkid := coalesce(newj->>'supplier_id', oldj->>'supplier_id');
    if fkid is not null then
      begin select name into lbl from public.suppliers where id = fkid::uuid;
      exception when others then lbl := null; end;
    end if;
  end if;

  -- Qué cambió.
  if TG_OP = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_object('de', oldj->k, 'a', newj->k))
      into chg
    from jsonb_object_keys(newj) as k
    where (newj->k) is distinct from (oldj->k)
      and k not in ('updated_at');
  elsif TG_OP = 'INSERT' then
    chg := newj;
  else -- DELETE
    chg := oldj;
  end if;

  insert into public.audit_log(user_id, user_name, action, table_name, row_id, row_label, changes)
  values (auth.uid(), uname, TG_OP, TG_TABLE_NAME, rid, lbl, chg);

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;
