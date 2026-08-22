-- ============================================================================
-- AUDITORÍA: quién lo hizo (arregla el fallback "Alguien") + antes/después para
-- reasignaciones de operador/inspector + quién inactivó/reactivó una máquina.
-- Aplicado directo en Supabase el 2026-08-10 vía mcp__supabase__apply_migration;
-- este archivo documenta el estado ya vigente en producción (mismo criterio que
-- operador_asignacion.sql / inspector_asignacion.sql). Es idempotente.
-- ============================================================================

-- 1) machinery: quién inactivó / reactivó (antes solo quedaba la FECHA, sin actor).
alter table public.machinery add column if not exists inactivated_by uuid references public.profiles(id) on delete set null;
alter table public.machinery add column if not exists reactivated_by uuid references public.profiles(id) on delete set null;
create index if not exists idx_machinery_inactivated_by on public.machinery(inactivated_by);
create index if not exists idx_machinery_reactivated_by on public.machinery(reactivated_by);

-- 2) audit_row(): antes, si el perfil no tenía full_name (o no había sesión),
--    user_name quedaba NULL y la pantalla mostraba "Alguien" a la fuerza. Ahora
--    cae a auth.users.email y, si tampoco hay sesión, a un texto explícito.
--    También se agregan operator_name/inspector_name al label legible (para que
--    machine_operators/machine_inspectors muestren un nombre, no un id). El resto
--    de la función queda IDÉNTICO a la versión anterior (ver audit_row_label_extra.sql).
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
  select coalesce(p.full_name, u.email) into uname
    from public.profiles p join auth.users u on u.id = p.id
    where p.id = auth.uid();
  uname := coalesce(uname, 'Sistema (sin sesión)');
  rid := coalesce(newj->>'id', oldj->>'id');

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
    newj->>'company_name', oldj->>'company_name',
    newj->>'supplier', oldj->>'supplier',
    newj->>'driver_operator', oldj->>'driver_operator',
    newj->>'operator_name', oldj->>'operator_name',
    newj->>'inspector_name', oldj->>'inspector_name'
  );

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

  if TG_OP = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_object('de', oldj->k, 'a', newj->k))
      into chg
    from jsonb_object_keys(newj) as k
    where (newj->k) is distinct from (oldj->k)
      and k not in ('updated_at');
  elsif TG_OP = 'INSERT' then
    chg := newj;
  else
    chg := oldj;
  end if;

  insert into public.audit_log(user_id, user_name, action, table_name, row_id, row_label, changes)
  values (auth.uid(), uname, TG_OP, TG_TABLE_NAME, rid, lbl, chg);

  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;

-- audit_row() es una función de TRIGGER, no una acción de la app: no debe poder
-- llamarse directo por RPC (/rest/v1/rpc/audit_row). Revocar EXECUTE no afecta a
-- los triggers (el motor los dispara sin pasar por el chequeo de EXECUTE de RPC) —
-- confirmado con una prueba en vivo (UPDATE + ROLLBACK) tras aplicar este cambio.
revoke execute on function public.audit_row() from public, anon, authenticated;

-- 3) audit_event(): mismo arreglo de fallback para eventos de app (login, jornada,
--    escaneo) que no pasan por un trigger de tabla. Firma idéntica — compatible con
--    las 23 llamadas existentes a logAudit() en la app (src/lib/audit.ts).
drop function if exists public.audit_event(text, text, text, text, text);
create or replace function public.audit_event(
  p_action text, p_table_name text, p_row_id text, p_detail text default null, p_device text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  select coalesce(p.full_name, u.email) into uname
    from public.profiles p join auth.users u on u.id = p.id
    where p.id = auth.uid();
  uname := coalesce(uname, 'Sistema (sin sesión)');
  insert into public.audit_log(user_id, user_name, action, table_name, row_id, detail, device)
  values (auth.uid(), uname, p_action, coalesce(p_table_name, '-'), p_row_id, p_detail, p_device);
end $$;

grant execute on function public.audit_event(text, text, text, text, text) to authenticated, anon;

-- 4) Conectar el trigger de auditoría (ya probado en 30+ tablas) a las 2 tablas de
--    asignación planeada — machine_operators y machine_inspectors NO lo tenían, así
--    que reasignar un operador/inspector no dejaba antes/después. Ambas son tablas
--    de MUY bajo volumen (una fila por máquina+turno, se sobrescribe con upsert).
do $$
declare t text;
begin
  foreach t in array array['machine_operators','machine_inspectors'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists trg_audit on public.%I;', t);
      execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row();', t);
    end if;
  end loop;
end $$;

-- 5) Hallazgo del auditor de seguridad (2026-08-10): machine_inspectors.mi_read no
--    tenía "to authenticated" (quedó en PUBLIC desde inspector_asignacion.sql, a
--    diferencia de mi_insert/update/delete que sí lo tenían) — con el grant de tabla
--    a anon (default de Supabase), permitía lectura anónima. Cerrado.
drop policy if exists mi_read on public.machine_inspectors;
create policy mi_read on public.machine_inspectors for select to authenticated using (true);

-- 6) Hallazgo del auditor de rendimiento: machine_operators.assigned_by (FK a
--    profiles) sin índice — se usa activamente para resolver "asignado por" en el
--    Coordinador de Operadores (src/lib/machineOperators.ts).
create index if not exists idx_mo_assigned_by on public.machine_operators(assigned_by);

-- ============================================================================
-- RESUELTO el 18-ago-2026: trg_audit en `machinery` YA ESTÁ ENCENDIDO.
--
-- Estuvo en tgenabled='D' desde antes del 10-ago-2026. Se detectó porque el
-- cliente reportó que la bitácora no mostraba quién RETIRABA una máquina ni
-- quién la ponía EN ESPERA — y en efecto no lo mostraba: `en_espera` se cambia
-- desde cinco pantallas (EquiposScreen, ControlMaquinariaScreen ×2,
-- CoordinadorQrPanel, MantenimientoMaquinariaScreen), todas con un update
-- directo, y sin el trigger no quedaba rastro en ninguna parte.
--
-- Encendido por el cliente con:
--   alter table public.machinery enable trigger trg_audit;
--
-- Es barato: `machinery` es un CATÁLOGO (~200 filas que se editan de vez en
-- cuando), nada que ver con el volumen que obligó a apagar el de jornadas.
-- Para volver atrás:  alter table public.machinery disable trigger trg_audit;
--
-- ⚠️ SIGUE APAGADO el de `machine_rounds` (tgenabled='D' desde el 09-ago-2026,
--    misma fecha que audit_perf_indexes.sql, cuando el sistema se caía por el
--    volumen: los crons la escriben cada 10 min por ~173 máquinas). Consecuencia
--    viva: NINGÚN cambio de jornada deja rastro desde entonces. Encenderlo tal
--    cual repetiría la caída; la salida es un trigger que solo registre cuando
--    hay una persona detrás (auth.uid() is not null), que deja pasar el ruido
--    de los crons. Pendiente de decisión del cliente.
-- ============================================================================
