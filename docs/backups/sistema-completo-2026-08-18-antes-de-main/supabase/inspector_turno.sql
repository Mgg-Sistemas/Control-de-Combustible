-- ============================================================================
-- TURNO en la asignación inspector ↔ máquina (CHECK).
-- Cada máquina tiene DOS inspectores: uno de turno DÍA (☀️) y otro de NOCHE (🌙).
-- Correr en Supabase → SQL Editor. Idempotente.
-- ============================================================================

-- Columna de turno ('day' | 'night').
alter table public.machine_inspectors add column if not exists shift text not null default 'day';

-- Antes era 1 inspector por máquina (unique machinery_id+inspector_id). Ahora es
-- 1 inspector por máquina+turno. Se quita la restricción vieja y se pone la nueva.
alter table public.machine_inspectors drop constraint if exists machine_inspectors_machinery_id_inspector_id_key;
drop index if exists machine_inspectors_machinery_id_inspector_id_key;
create unique index if not exists mi_machine_shift_key on public.machine_inspectors(machinery_id, shift);
