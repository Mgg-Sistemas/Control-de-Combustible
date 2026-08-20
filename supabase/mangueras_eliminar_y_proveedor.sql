-- ============================================================================
-- MANGUERAS (19-ago-2026): 2 arreglos
--
-- #1 "No deja eliminar" (desde Mangueras y desde Compras): la tabla hose_services
--    tenía policies de SELECT/INSERT/UPDATE pero NINGUNA de DELETE (se había dejado
--    a propósito "no se borran registros"). RLS entonces bloqueaba el borrado en
--    SILENCIO. Regla del cliente: SÍ se puede eliminar una manguera mientras NO haya
--    sido aprobada/pagada. Se agrega una policy de DELETE gateada a
--    payment_status <> 'pagado' (una pagada queda como registro contable) + un
--    trigger BEFORE DELETE que borra la cuenta por pagar NO pagada ligada (el FK es
--    on delete set null → sin esto quedaría una cuenta huérfana). El trigger es
--    SECURITY DEFINER, así que limpia la cuenta aunque el usuario no tenga permiso
--    de Cuentas.
--
-- #2 El comprobante PDF de autorización no mostraba el proveedor: el PDF lee
--    hose_services.provider (texto "espejo"), pero el proveedor real se guarda en
--    supplier_id (catálogo suppliers) y el espejo nunca se llenaba → salía "—". Se
--    agrega un trigger que mantiene provider = nombre del proveedor cada vez que se
--    setea/cambia supplier_id, + backfill de las mangueras existentes.
--
-- Idempotente.
-- ============================================================================

-- ── #1a · Policy de DELETE (solo mangueras NO pagadas) ──────────────────────
drop policy if exists hose_services_delete on public.hose_services;
create policy hose_services_delete on public.hose_services
  for delete to authenticated
  using (payment_status <> 'pagado');

-- ── #1b · Al borrar la manguera, borrar su cuenta por pagar NO pagada ───────
create or replace function public.hose_delete_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.cuentas
   where hose_service_id = old.id and estado <> 'pagada';
  return old;
end $$;

drop trigger if exists trg_hose_delete_cleanup on public.hose_services;
create trigger trg_hose_delete_cleanup
  before delete on public.hose_services
  for each row execute function public.hose_delete_cleanup();

-- ── #2 · Mantener provider (texto) = nombre del proveedor (supplier_id) ─────
create or replace function public.hose_provider_mirror() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.supplier_id is not null then
    select name into new.provider from public.suppliers where id = new.supplier_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_hose_provider_mirror on public.hose_services;
create trigger trg_hose_provider_mirror
  before insert or update of supplier_id on public.hose_services
  for each row execute function public.hose_provider_mirror();

-- Backfill: llena provider en las mangueras que ya tienen supplier_id (para que el
-- comprobante y la lista muestren el proveedor sin re-guardar cada una).
update public.hose_services h
set provider = s.name
from public.suppliers s
where s.id = h.supplier_id
  and h.provider is distinct from s.name;

-- ── VERIFICACIÓN (correr después) ───────────────────────────────────────────
-- Debe dar 0: ninguna manguera con supplier_id debería quedar sin provider.
-- select count(*) from public.hose_services
-- where supplier_id is not null and (provider is null or provider = '');
