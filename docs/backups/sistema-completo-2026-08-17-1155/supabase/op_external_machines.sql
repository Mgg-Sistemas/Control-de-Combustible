-- ============================================================================
-- MÁQUINAS EXTERNAS de Obras Públicas (13-ago-2026).
-- Máquinas que el rol de Obras Públicas usa pero que NO están en el catálogo
-- (machinery) y NO deben reflejarse ahí. Se usan para marcar "maquinaria por
-- requerimiento" en el reporte por edificio, junto a las asignadas del catálogo.
-- supervisor_id: dueño (opcional); si es NULL, la máquina externa es GLOBAL (la
-- ven todos los supervisores). Correr en Supabase → SQL Editor.
-- ============================================================================
create table if not exists public.op_external_machines (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,                       -- nombre/código libre de la máquina externa
  supervisor_id uuid references public.profiles(id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- evita duplicados (mismo nombre para el mismo dueño / globales) entre las activas
create unique index if not exists op_external_machines_uk
  on public.op_external_machines (lower(code), coalesce(supervisor_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where active;

alter table public.op_external_machines enable row level security;
drop policy if exists oem_all on public.op_external_machines;
create policy oem_all on public.op_external_machines for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.op_external_machines to anon, authenticated;
