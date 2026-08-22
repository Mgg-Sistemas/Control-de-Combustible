-- ============================================================================
-- INSPECCIONES DE MAQUINARIA (control por equipo): cada inspección guarda el
-- inventario de equipos/herramientas del equipo, su estado, observaciones y las
-- firmas. Se conserva HISTORIAL por máquina. Idempotente.
-- ============================================================================
create table if not exists public.machine_inspections (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  machinery_id      uuid references public.machinery(id) on delete set null,
  machine_code      text,
  machine_type      text,                 -- "Tipo de Unidad" (ej. Camión Taller Soldadura)
  machine_plate     text,
  machine_serial    text,
  inspected_at      timestamptz not null default now(),   -- fecha + hora de la inspección
  inspector_name    text,
  operator_name     text,                 -- chofer / operador responsable
  condicion_general text,
  observaciones     jsonb not null default '[]'::jsonb,   -- [{label, text}]
  items             jsonb not null default '[]'::jsonb,   -- [{descripcion, cantidad, unidad, serial, estado, nivel}]
  created_by        uuid references auth.users(id) on delete set null
);
create index if not exists machine_inspections_mach_idx on public.machine_inspections (machinery_id, inspected_at desc);
create index if not exists machine_inspections_at_idx   on public.machine_inspections (inspected_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.machine_inspections enable row level security;
-- Cualquier usuario autenticado (no anónimo) lee; el personal (staff) crea/edita/borra.
drop policy if exists mi_select on public.machine_inspections;
create policy mi_select on public.machine_inspections for select to authenticated using (not public.is_anon());
drop policy if exists mi_write on public.machine_inspections;
create policy mi_write on public.machine_inspections for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ── Realtime: que el historial se refresque solo ────────────────────────────
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.machine_inspections';
  exception when duplicate_object then null; when others then null;
  end;
end $$;

-- ── Auditoría (si ya se corrió audit.sql, deja constancia de quién inspecciona) ──
do $$
begin
  if to_regclass('public.audit_log') is not null and exists (
    select 1 from pg_proc where proname = 'audit_row' and pronamespace = 'public'::regnamespace
  ) then
    execute 'drop trigger if exists trg_audit on public.machine_inspections';
    execute 'create trigger trg_audit after insert or update or delete on public.machine_inspections for each row execute function public.audit_row()';
  end if;
end $$;
