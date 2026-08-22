-- ============================================================================
-- Módulo LAVADO DE MAQUINARIA — tablas aisladas (lm_*).
-- El "lavador" registra el lavado de máquinas del catálogo (machinery). Cada
-- lavado guarda tipo, observación y foto. El panel de PC cuenta cuántas veces al
-- mes se lavó cada máquina. Aislado del resto (solo referencia machinery + profiles).
-- Correr en Supabase (SQL Editor). Idempotente.
-- ============================================================================

-- 1) Tipos de lavado (editables: exterior / motor / completo + agregar).
create table if not exists public.lm_wash_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  active     boolean not null default true,
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  unique (name)
);
insert into public.lm_wash_types (name, sort) values
  ('Exterior', 1), ('Motor', 2), ('Completo', 3)
on conflict (name) do nothing;

-- 2) Lavados: UN registro por lavado de una máquina.
create table if not exists public.lm_washes (
  id             uuid primary key default gen_random_uuid(),
  machinery_id   uuid not null references public.machinery(id) on delete cascade,
  washed_by      uuid references public.profiles(id),
  washed_by_name text,                        -- denormalizado (para reportes sin join)
  washed_at      timestamptz not null default now(),
  tipo           text,                        -- nombre del tipo (lm_wash_types.name)
  observaciones  text,
  photo          text,                        -- foto en base64 (mismo patrón que horometro_photo)
  created_at     timestamptz not null default now()
);
create index if not exists lm_washes_machine_idx on public.lm_washes (machinery_id, washed_at);
create index if not exists lm_washes_date_idx    on public.lm_washes (washed_at);

-- 3) RLS: igual que el resto de módulos → lectura/escritura autenticada.
alter table public.lm_wash_types enable row level security;
alter table public.lm_washes     enable row level security;

drop policy if exists lm_wash_types_rw on public.lm_wash_types;
drop policy if exists lm_washes_rw     on public.lm_washes;
create policy lm_wash_types_rw on public.lm_wash_types for all to authenticated using (true) with check (true);
create policy lm_washes_rw     on public.lm_washes     for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.lm_wash_types to authenticated;
grant select, insert, update, delete on public.lm_washes     to authenticated;

-- 4) Realtime (para que las vistas se refresquen en vivo).
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.lm_wash_types'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.lm_washes';     exception when others then null; end;
end $$;
