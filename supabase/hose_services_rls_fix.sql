-- ============================================================================
-- FIX RLS de hose_services (mangueras) — 2026-08-23
--
-- Síntoma: al APROBAR el pago de una manguera (o editarla) desde un usuario que
-- NO es admin (p. ej. DIANA DE LA RANS, rol conductor, con permiso de módulo
-- 'mangueras'), Supabase devuelve:
--   "new row violates row-level security policy for table hose_services"
--
-- Causa: la política de UPDATE de `hose_services` en PRODUCCIÓN quedó más
-- estricta que el diseño del repo. Por diseño (ver supabase/hose_services.sql)
-- esta tabla es PERMISIVA a nivel de base — cualquier usuario AUTENTICADO puede
-- leer/escribir — y el control real de quién ve/edita/aprueba lo hace el permiso
-- de módulo 'mangueras' en la app (canWrite / canApprove). Este script re-asienta
-- esas políticas permisivas. Idempotente.
-- ============================================================================

alter table public.hose_services enable row level security;

drop policy if exists hose_services_select on public.hose_services;
create policy hose_services_select on public.hose_services
  for select to authenticated using (true);

drop policy if exists hose_services_insert on public.hose_services;
create policy hose_services_insert on public.hose_services
  for insert to authenticated with check (true);

drop policy if exists hose_services_update on public.hose_services;
create policy hose_services_update on public.hose_services
  for update to authenticated using (true) with check (true);

-- (No hay policy de DELETE a propósito: no se borran registros de mangueras.)

-- ── VERIFICACIÓN (correr después) ───────────────────────────────────────────
-- Deben salir hose_services_select / _insert / _update con qual/with_check = true.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'hose_services'
order by policyname;
