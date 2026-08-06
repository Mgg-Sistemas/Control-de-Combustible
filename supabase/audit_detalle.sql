-- ============================================================================
-- AUDITORÍA — más información: nombre legible del registro + qué cambió.
-- Antes el trigger solo guardaba quién/acción/tabla/fila. Ahora agrega:
--   row_label → nombre/código legible del registro afectado (resuelve la
--               máquina por machinery_id cuando la fila no trae code/nombre).
--   changes   → UPDATE: solo los campos que cambiaron {campo:{de,a}};
--               INSERT: la fila creada; DELETE: la fila borrada.
-- Con esto el detalle muestra el "de → a" y la BÚSQUEDA encuentra por máquina
-- aunque la acción sea de otra fecha. Idempotente: se puede correr varias veces.
-- ============================================================================

alter table public.audit_log add column if not exists row_label text;
alter table public.audit_log add column if not exists changes   jsonb;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uname text;
  rid   text;
  newj  jsonb := case when TG_OP <> 'DELETE' then to_jsonb(NEW) else null end;
  oldj  jsonb := case when TG_OP <> 'INSERT' then to_jsonb(OLD) else null end;
  lbl   text;
  mid   text;
  chg   jsonb;
begin
  select full_name into uname from public.profiles where id = auth.uid();
  rid := coalesce(newj->>'id', oldj->>'id');

  -- Nombre legible del registro (lo primero que exista).
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
    newj->>'sku', oldj->>'sku'
  );
  -- Si la fila no trae nombre pero apunta a una máquina, usar su código.
  if lbl is null then
    mid := coalesce(newj->>'machinery_id', oldj->>'machinery_id');
    if mid is not null then
      begin
        select code into lbl from public.machinery where id = mid::uuid;
      exception when others then lbl := null;
      end;
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

-- Los triggers ya existen (creados en audit.sql) y llaman a esta función; al
-- reemplazar el cuerpo, quedan usando la versión enriquecida automáticamente.
