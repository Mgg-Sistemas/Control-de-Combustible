-- ============================================================================
-- FEATURE TOGGLES — interruptores configurables desde la app (tabla genérica)
-- ----------------------------------------------------------------------------
-- Contexto: el panel "🔧 Activar / desactivar máquinas por supervisor" de
-- Resumen de Inspecciones (src/screens/redesign/InspectionsSummary.tsx) hoy
-- solo lo pueden ver 2 cuentas fijas en el código (BULK_TOGGLE_USERNAMES /
-- BULK_TOGGLE_CEDULAS). El cliente pidió poder activarlo/desactivarlo y sumar
-- usuarios extra desde la pantalla de Ajustes, sin tocar código. Esta tabla es
-- el contrato genérico para ese tipo de interruptores (sirve para este panel y
-- para futuros "features" configurables sin migraciones nuevas).
--
-- Contrato (lo consume también la pantalla de Ajustes, en otro cambio):
--   key             text        clave del feature, ej. 'maquinas_bulk_toggle'
--   enabled         boolean     apagado general (oculta el feature a TODOS,
--                               incluida cualquier whitelist fija del código)
--   extra_user_ids  uuid[]      user_id (auth.users.id) con acceso adicional,
--                               más allá de la whitelist fija del código
--   updated_at      timestamptz última modificación (automática)
--   updated_by      uuid        quién la modificó (auth.users.id, opcional)
--
-- Semilla: 'maquinas_bulk_toggle' con enabled = true y extra_user_ids = '{}',
-- para no cambiar el comportamiento actual (whitelist fija) hasta que un admin
-- la edite desde Ajustes.
--
-- Ejecutar manualmente en el SQL Editor de Supabase (no se corre desde la app).
-- Fecha: 2026-08-04
-- ============================================================================

create table if not exists public.feature_toggles (
  key text primary key,
  enabled boolean not null default true,
  extra_user_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.feature_toggles enable row level security;

-- Lectura: cualquier usuario autenticado (la app necesita consultarla para
-- decidir si muestra el panel, sin importar el rol).
drop policy if exists ft_select on public.feature_toggles;
create policy ft_select on public.feature_toggles for select to authenticated using (true);

-- Escritura (insert/update/delete): solo administradores. Reutiliza
-- public.is_admin() (definida en schema.sql, ~línea 62); mismo patrón que
-- module_permissions (schema.sql, ~líneas 669-680).
drop policy if exists ft_write on public.feature_toggles;
create policy ft_write on public.feature_toggles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Semilla: el panel de activar/desactivar máquinas por supervisor arranca
-- ENCENDIDO (mismo comportamiento de hoy, solo whitelist fija) hasta que un
-- admin lo edite desde Ajustes.
insert into public.feature_toggles (key, enabled, extra_user_ids)
values ('maquinas_bulk_toggle', true, '{}')
on conflict (key) do nothing;
