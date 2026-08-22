-- ============================================================================
-- REQUERIMIENTOS — correlativo (REQ-000N) generado en la BASE, a prueba de fallos.
--
-- El código se asigna con un TRIGGER en la base, no en el teléfono. Así:
--   • Nunca se reinicia a 0001 (siempre continúa desde el máximo real).
--   • No depende de lo que el cliente vea (RLS / lecturas parciales) ni de la red.
--   • Un pg_advisory_xact_lock serializa inserciones simultáneas → sin choques.
--   • SECURITY DEFINER: la función ve TODAS las filas para calcular el máximo real.
-- El índice único `inventory_requirements_code_key` sigue como red de seguridad.
-- Idempotente.
-- ============================================================================
create or replace function public.assign_requirement_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare nextn int;
begin
  -- Serializa las inserciones concurrentes para que no calculen el mismo máximo.
  perform pg_advisory_xact_lock(hashtext('inventory_requirements_code'));
  select coalesce(max((regexp_replace(code, '\D', '', 'g'))::int), 0) + 1
    into nextn
    from public.inventory_requirements
    where code ~ '^REQ-\d+$';
  new.code := 'REQ-' || lpad(nextn::text, 4, '0');
  return new;
end $$;

drop trigger if exists trg_assign_requirement_code on public.inventory_requirements;
create trigger trg_assign_requirement_code
  before insert on public.inventory_requirements
  for each row execute function public.assign_requirement_code();
