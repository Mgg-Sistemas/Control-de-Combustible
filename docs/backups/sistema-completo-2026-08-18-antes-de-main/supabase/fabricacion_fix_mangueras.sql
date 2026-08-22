-- ============================================================================
-- FIX Fabricación (Taller) — Mangueras hidráulicas: candado REAL de pago +
-- validaciones de datos mínimas.
--
-- Contexto / problema (crítico): supabase/hose_services.sql (YA EN PRODUCCIÓN,
-- por eso este es un archivo NUEVO y no se toca aquel) define:
--     create policy hose_services_update on public.hose_services
--       for update to authenticated using (true) with check (true);
-- Es decir, a nivel de base de datos CUALQUIER usuario autenticado puede marcar
-- una manguera como pagada (payment_status = 'pagado') llamando directo a la API
-- de Supabase, sin importar su nivel de permiso en el módulo 'mangueras'. El
-- candado de "solo Chelia (nivel FULL) aprueba el pago" solo vivía en la UI
-- (src/screens/ManguerasScreen.tsx, variable `canApprove`), y la UI se puede
-- saltar. Este archivo agrega el candado real en la BD, más dos validaciones de
-- datos que faltaban. Idempotente: seguro de correr más de una vez.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Candado de pago (el fix crítico).
--
-- Función de apoyo `has_full_module`, MISMO patrón/estilo que
-- public.can_write_module() (supabase/schema.sql): admin siempre puede;
-- si el usuario tiene una fila en module_permissions, se usa ese nivel.
-- A diferencia de can_write_module() (donde "sin fila" = escritura por
-- defecto), aquí "sin fila" = NO full: el nivel full nunca se asume, tiene
-- que estar asignado explícitamente por un admin (matriz de permisos).
-- ----------------------------------------------------------------------------
create or replace function public.has_full_module(mod text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare lvl text;
begin
  if public.is_anon() then return false; end if; -- anónimos nunca tienen full
  if public.is_admin() then return true; end if; -- admin siempre puede
  select mp.level into lvl from public.module_permissions mp
    where mp.user_id = auth.uid() and mp.module = mod limit 1;
  return coalesce(lvl = 'full', false); -- sin fila = NO full (a diferencia de can_write_module)
end;
$$;

-- Reemplaza hose_services_update (mismo nombre, drop + create, igual que hace
-- supabase/inspections_rls_fix.sql para no dejar dos políticas activas).
-- Se conserva el criterio general de escritura (can_write_module: escritura o
-- full en 'mangueras', igual que antes en la práctica ya que sin fila de
-- permiso se asume escritura) para editar código/descripción/costo/proveedor/
-- estado de instalación, "📤 Enviar a autorización", etc. Solo la transición a
-- 'pagado' (el botón "✅ Aprobar y marcar pagado", ya restringido en la UI a
-- `canApprove`/nivel full) exige nivel FULL explícito también en la base de
-- datos — así el candado real coincide con la regla de negocio ya documentada
-- (cualquiera con escritura registra/envía a autorización, solo Full aprueba
-- el pago), en vez de bloquear también "enviar a autorización".
drop policy if exists hose_services_update on public.hose_services;
create policy hose_services_update on public.hose_services for update to authenticated
  using (public.can_write_module('mangueras'))
  with check (
    public.can_write_module('mangueras')
    and (
      payment_status is distinct from 'pagado'
      or public.has_full_module('mangueras')
    )
  );

-- ----------------------------------------------------------------------------
-- 2) Validación: el costo de una manguera no puede ser negativo.
--    Bloque defensivo (DO + EXCEPTION) para poder re-ejecutar este archivo sin
--    error si el constraint ya existe.
-- ----------------------------------------------------------------------------
do $$
begin
  alter table public.hose_services
    add constraint hose_services_cost_usd_check check (cost_usd >= 0);
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- 3) Validación: el código físico grabado en la manguera no se puede repetir.
--
--    AVISO: si en producción ya existen códigos duplicados en hose_services,
--    este ALTER TABLE fallará al aplicarse (error de unicidad). Es ESPERADO —
--    hay que revisar y limpiar manualmente esos duplicados primero (renombrar
--    o corregir el `code` repetido) y recién después volver a correr este
--    bloque para que la restricción quede activa.
-- ----------------------------------------------------------------------------
do $$
begin
  alter table public.hose_services
    add constraint hose_services_code_unique unique (code);
exception
  when duplicate_object then null;
end $$;

select 'Listo: candado de pago + validaciones aplicadas' as resultado;
