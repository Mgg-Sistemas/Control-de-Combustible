-- ============================================================================
-- CONTROL DE PAGOS (empresas) — permiso de BORRADO de abonos.
-- Si "eliminar abono" no borra nada (y no da error), es porque la política RLS
-- desplegada no autoriza el DELETE (un borrado no autorizado quita 0 filas SIN
-- error). Esto RE-APLICA la política correcta: cualquier usuario autenticado y
-- NO anónimo puede leer, insertar, actualizar y BORRAR abonos.
-- Idempotente.
-- ============================================================================
alter table public.company_payments enable row level security;

drop policy if exists cp_select on public.company_payments;
create policy cp_select on public.company_payments
  for select to authenticated using (true);

drop policy if exists cp_write on public.company_payments;
create policy cp_write on public.company_payments
  for all to authenticated
  using (not public.is_anon())
  with check (not public.is_anon());
