-- Código de la fabricación (hose_services.code) AUTOMÁTICO: correlativo de 4 dígitos
-- (0001, 0002, …) asignado por la BASE (no por la app y NO editable por el usuario).
-- Replica el mecanismo a prueba de fallos de assign_mo_code()/assign_requirement_code():
-- advisory lock para serializar + max(numérico)+1 con lpad(...,4,'0').
--
-- Los códigos LEGACY alfanuméricos (ej. "87-AC") se ignoran para el cálculo del máximo
-- (regex '^\d+$') y NO chocan con el índice único (que es PARCIAL: solo sobre códigos
-- puramente numéricos). Así, la primera fabricación nueva arranca en 0001.

create or replace function public.assign_hose_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare nextn int;
begin
  -- Respeta un código explícito solo si viniera con algo (compat.); la app ya no lo manda.
  if new.code is not null and btrim(new.code) <> '' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('hose_services_code'));
  select coalesce(max(code::int), 0) + 1
    into nextn
    from public.hose_services
    where code ~ '^\d+$';
  new.code := lpad(nextn::text, 4, '0');
  return new;
end $$;

drop trigger if exists trg_assign_hose_code on public.hose_services;
create trigger trg_assign_hose_code
  before insert on public.hose_services
  for each row execute function public.assign_hose_code();

-- Red de seguridad: unicidad SOLO entre códigos numéricos (deja convivir los legacy
-- alfanuméricos sin exigirles unicidad y sin chocar con ellos).
create unique index if not exists hose_services_code_numeric_key
  on public.hose_services(code) where code ~ '^\d+$';
