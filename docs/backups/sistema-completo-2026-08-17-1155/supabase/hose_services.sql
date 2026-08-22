-- Módulo de Fabricación (MRP) — Fase 1: Control y confección de mangueras
-- hidráulicas (Taller). Registro de cada manguera confeccionada/reparada,
-- asociada a la maquinaria, con su estatus de instalación y de pago.
-- Idempotente: seguro de correr más de una vez.

create table if not exists public.hose_services (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,                    -- código/numeración grabada en la manguera (ej. "87-AC")
  machinery_id   uuid references public.machinery(id) on delete set null,
  description    text,                              -- descripción del trabajo/confección
  service_date   date not null default current_date,
  cost_usd       numeric(12,2) not null default 0,
  provider       text,                              -- proveedor / operador del taller
  install_status text not null default 'en_proceso' check (install_status in ('en_proceso', 'instalada')),
  payment_status text not null default 'pendiente' check (payment_status in ('pendiente', 'en_proceso_autorizacion', 'pagado')),
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  approved_by    uuid references public.profiles(id) on delete set null,
  approved_at    timestamptz
);

create index if not exists idx_hose_services_machinery on public.hose_services(machinery_id);
create index if not exists idx_hose_services_payment_status on public.hose_services(payment_status);
create index if not exists idx_hose_services_install_status on public.hose_services(install_status);
create index if not exists idx_hose_services_service_date on public.hose_services(service_date);

alter table public.hose_services enable row level security;

-- Mismo criterio que compras/mantenimiento: cualquier usuario AUTENTICADO puede
-- leer/escribir a nivel de base de datos; el control real de quién ve/edita el
-- módulo (y quién puede aprobar el pago) es el permiso de módulo 'mangueras'
-- en la app (src/lib/permissions.ts), no la RLS. Sin política de DELETE a
-- propósito: no se borran registros, se conserva el historial completo.
drop policy if exists hose_services_select on public.hose_services;
create policy hose_services_select on public.hose_services for select to authenticated using (true);
drop policy if exists hose_services_insert on public.hose_services;
create policy hose_services_insert on public.hose_services for insert to authenticated with check (true);
drop policy if exists hose_services_update on public.hose_services;
create policy hose_services_update on public.hose_services for update to authenticated using (true) with check (true);

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.hose_services';
  exception when duplicate_object then null; when others then null;
  end;
end $$;
