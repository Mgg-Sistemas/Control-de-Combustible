-- ============================================================================
-- VIAJES DE CAMIONES: bitácora de viajes (regreso/entrada = un viaje) registrada
-- por listeros en campo. Un camión = una fila de `machinery` (los "Camion Volteo
-- Toronto"/"Chuto con Volqueta"). El chofer/responsable NO se duplica aquí: se
-- lee de `machine_operators` (la asignación por turno que ya administra el
-- Coordinador de Operadores) y se copia como snapshot al momento del viaje.
-- Pedido del cliente 12-ago-2026.
-- ============================================================================

-- 1) Bitácora de viajes.
create table if not exists public.camion_viajes (
  id uuid primary key default gen_random_uuid(),
  machinery_id uuid not null references public.machinery(id) on delete cascade,
  machine_code text not null,
  listero_id uuid not null references public.profiles(id) on delete cascade,
  listero_name text not null,
  chofer_name text,
  shift text check (shift in ('day','night')),
  estado_maquina text,
  note text,
  -- Hora REAL del toque, capturada en el teléfono (no `now()` del servidor):
  -- necesario para que un viaje registrado sin señal conserve su hora exacta
  -- cuando se sincroniza más tarde.
  registered_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Idempotencia de la cola offline: si un reintento repite un insert ya
  -- aplicado (respuesta perdida tras el commit), el índice único de abajo lo
  -- detecta como éxito en vez de duplicar el viaje.
  client_action_id text
);
create unique index if not exists uq_camion_viajes_client_action
  on public.camion_viajes(client_action_id) where client_action_id is not null;
create index if not exists idx_cv_machinery on public.camion_viajes(machinery_id);
create index if not exists idx_cv_listero on public.camion_viajes(listero_id);
create index if not exists idx_cv_registered_at on public.camion_viajes(registered_at desc);

alter table public.camion_viajes enable row level security;
drop policy if exists cv_select on public.camion_viajes;
create policy cv_select on public.camion_viajes for select to authenticated using (true);
drop policy if exists cv_insert on public.camion_viajes;
create policy cv_insert on public.camion_viajes for insert to authenticated with check (true);
drop policy if exists cv_update on public.camion_viajes;
create policy cv_update on public.camion_viajes for update to authenticated using (true) with check (true);
drop policy if exists cv_delete on public.camion_viajes;
create policy cv_delete on public.camion_viajes for delete to authenticated using (true);
-- Reglas de negocio (listero solo corrige lo suyo dentro de su jornada; borrar
-- es solo de la jefa) se validan en la app, igual criterio que el resto del
-- sistema (ver machine_operators/coordinator_*_scope: RLS abierta + control por
-- módulo/rol en la UI, no restricción de fila en la base).

alter publication supabase_realtime add table public.camion_viajes;

-- Auditoría automática (quién insertó/editó/borró, antes/después) — mismo
-- trigger genérico ya usado en 30+ tablas, incluida machine_operators.
drop trigger if exists trg_audit on public.camion_viajes;
create trigger trg_audit after insert or update or delete on public.camion_viajes
  for each row execute function public.audit_row();

-- 2) Meta de viajes diarios por camión (editable por admin y por la jefa desde
--    la propia pantalla de Viajes). NULL = sin meta definida para ese camión.
alter table public.machinery add column if not exists meta_viajes_diarios integer;

-- 3) Umbral configurable de alerta "camión sin viajes hace X horas" (un único
--    valor global, no hardcodeado — la jefa/admin lo pueden ajustar). Patrón
--    singleton: exactamente una fila (id siempre = true).
create table if not exists public.camion_viajes_config (
  id boolean primary key default true check (id),
  alerta_horas_sin_viaje numeric not null default 6,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.camion_viajes_config (id) values (true) on conflict (id) do nothing;
alter table public.camion_viajes_config enable row level security;
drop policy if exists cvc_select on public.camion_viajes_config;
create policy cvc_select on public.camion_viajes_config for select to authenticated using (true);
drop policy if exists cvc_write on public.camion_viajes_config;
create policy cvc_write on public.camion_viajes_config for update to authenticated using (true) with check (true);
