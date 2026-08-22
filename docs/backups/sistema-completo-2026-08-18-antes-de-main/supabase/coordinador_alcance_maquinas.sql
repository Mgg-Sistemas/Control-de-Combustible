-- ============================================================================
-- ALCANCE DE MÁQUINAS DEL COORDINADOR DE OPERADORES
-- ============================================================================
-- Hoy un Coordinador de Operadores ve y puede asignar TODAS las máquinas
-- activas de la flota (CoordinadorOperadoresScreen.tsx no filtra por empresa
-- ni por usuario). Pedido del cliente (12-ago-2026): poder restringir, POR
-- COORDINADOR (no por rol — dos coordinadores pueden necesitar ver empresas
-- distintas), qué máquinas puede ver/asignar cada uno.
--
-- Sin ninguna fila en estas dos tablas = SIN restricción, ve todas (el
-- comportamiento actual) — así el despliegue no bloquea de golpe a los
-- coordinadores que ya existen; se va restringiendo uno por uno desde
-- Usuarios cuando el cliente lo decida.
--
-- El alcance final de un coordinador es la UNIÓN de las dos tablas:
--   · coordinator_company_scope: TODA la empresa, EN VIVO — una máquina nueva
--     que se agregue después a esa empresa entra sola, sin volver a configurar.
--   · coordinator_machine_scope: una máquina SUELTA puntual — para casos fuera
--     de la regla por empresa (un equipo prestado de otra empresa, etc.).
-- Mismo patrón de RLS que module_permissions (ver schema.sql): select abierto
-- a cualquier autenticado (el propio coordinador necesita leer SU alcance),
-- escritura solo admin (se configura desde Usuarios).
-- ============================================================================

create table if not exists public.coordinator_company_scope (
  user_id    uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);
alter table public.coordinator_company_scope enable row level security;
drop policy if exists ccs_select on public.coordinator_company_scope;
create policy ccs_select on public.coordinator_company_scope for select to authenticated using (true);
drop policy if exists ccs_write on public.coordinator_company_scope;
create policy ccs_write on public.coordinator_company_scope for all to authenticated
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
create index if not exists idx_ccs_user on public.coordinator_company_scope(user_id);

create table if not exists public.coordinator_machine_scope (
  user_id      uuid not null references auth.users(id) on delete cascade,
  machinery_id uuid not null references public.machinery(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, machinery_id)
);
alter table public.coordinator_machine_scope enable row level security;
drop policy if exists cms_select on public.coordinator_machine_scope;
create policy cms_select on public.coordinator_machine_scope for select to authenticated using (true);
drop policy if exists cms_write on public.coordinator_machine_scope;
create policy cms_write on public.coordinator_machine_scope for all to authenticated
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
create index if not exists idx_cms_user on public.coordinator_machine_scope(user_id);

-- Tiempo real: para que el editor de Usuarios y la pantalla del coordinador
-- (si la tiene abierta en otro dispositivo) se refresquen solos al cambiar el
-- alcance, igual que ya pasa con module_permissions/app_roles.
alter publication supabase_realtime add table public.coordinator_company_scope;
alter publication supabase_realtime add table public.coordinator_machine_scope;
