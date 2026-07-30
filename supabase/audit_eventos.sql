-- ============================================================================
-- AUDITORÍA — EVENTOS DE LA APP (login, escaneo de QR, jornada) que NO escriben
-- en una tabla de negocio y por eso los triggers no los ven. La app los registra
-- llamando a audit_event(...). Se guarda el nombre y apellido de quien lo hizo
-- (profiles.full_name) y un "detalle" legible (p. ej. el código de la máquina).
-- ============================================================================

-- Detalle legible del evento (código de máquina, etc.) para verlo directo en la lista.
alter table public.audit_log add column if not exists detail text;

-- Registra un evento de la app en la bitácora. SECURITY DEFINER: el cliente no
-- puede insertar directo en audit_log (RLS), pero sí puede llamar a esta función.
create or replace function public.audit_event(
  p_action text, p_table_name text, p_row_id text, p_detail text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  select full_name into uname from public.profiles where id = auth.uid();
  insert into public.audit_log(user_id, user_name, action, table_name, row_id, detail)
  values (auth.uid(), uname, p_action, coalesce(p_table_name, '-'), p_row_id, p_detail);
end $$;

grant execute on function public.audit_event(text, text, text, text) to authenticated, anon;
