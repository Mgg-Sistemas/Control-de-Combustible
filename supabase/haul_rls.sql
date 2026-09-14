-- ============================================================================
-- Acarreo (haul_*) — habilitar Row Level Security en PRODUCCIÓN
-- ----------------------------------------------------------------------------
-- Motivo: el advisor de Supabase marcó "Table publicly accessible
-- (rls_disabled_in_public)": una o varias tablas del módulo de Acarreo quedaron
-- SIN RLS en la base de producción. En schema.sql estas políticas ya existen,
-- pero dentro de un bloque `do $$ ... $$` dinámico que en un despliegue parcial
-- pudo NO haberse ejecutado, así que las tablas quedaron abiertas.
--
-- Esto lo corrige: activa RLS y (re)crea las políticas. Es IDÉNTICO a schema.sql
-- y es IDEMPOTENTE — se puede correr las veces que haga falta sin romper nada.
--   · Lectura  : cualquier usuario AUTENTICADO puede leer (select).
--   · Escritura: solo quien tenga permiso de ESCRITURA en el módulo 'acarreo'
--                (public.can_write_module('acarreo')).
--
-- Ninguna pantalla anónima (carnets/QR de aliados, empleados, comida o máquina)
-- lee tablas haul_*, así que activar RLS aquí no afecta esos flujos.
-- Correr en: Supabase → SQL Editor (proyecto Control de Combustible).
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'haul_clients','haul_locations','haul_trucks','haul_trailers','haul_drivers',
    'haul_documents','haul_orders','haul_order_items','haul_status_events',
    'haul_checks','haul_photos','haul_incidents','haul_expenses','haul_tariffs'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (true);', t, t);
    execute format('drop policy if exists %I_write on public.%I;', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.can_write_module(''acarreo'')) with check (public.can_write_module(''acarreo''));', t, t);
  end loop;
end $$;

-- ── Verificación: NO debe devolver ninguna fila. Si devuelve alguna, esa tabla
--    del esquema public sigue SIN RLS y hay que revisarla aparte.
select n.nspname as schema, c.relname as tabla_sin_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'          -- solo tablas ordinarias
  and c.relrowsecurity = false -- RLS apagado
order by c.relname;
