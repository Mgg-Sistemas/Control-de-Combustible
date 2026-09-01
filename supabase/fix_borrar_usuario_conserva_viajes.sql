-- ============================================================================
-- ARREGLO: no se podía ELIMINAR ciertos usuarios (listeros, supervisores OP…) — 2026-09-01
--
-- Síntoma: en Usuarios, "🗑️ Eliminar" fallaba con un error vacío ("NOMBRE: {}").
-- Causa raíz: varias FK que apuntan a `profiles` estaban en RESTRICT / NO ACTION,
-- así que si el usuario tenía filas hijas (p. ej. un LISTERO con viajes en
-- `camion_viajes`), la BD bloqueaba el borrado. `auth.admin.deleteUser` devolvía un
-- error sin `.message`, que JSON.stringify convertía en "{}".
--
-- Arreglo: esas FK pasan a ON DELETE SET NULL. Al borrar el usuario, sus filas
-- hijas SE CONSERVAN (los viajes NO se borran, pedido explícito del cliente) y solo
-- se suelta la referencia. El nombre del listero se preserva porque `camion_viajes`
-- ya guarda `listero_name` (una FOTO del nombre), independiente del id.
--
-- `camion_viajes.listero_id` era NOT NULL: se vuelve NULLABLE para poder soltarlo.
-- Las demás columnas ya eran nullable. Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================================

-- ── 1) camion_viajes.listero_id: NOT NULL → NULLABLE + SET NULL ──────────────
alter table public.camion_viajes drop constraint if exists camion_viajes_listero_id_fkey;
alter table public.camion_viajes alter column listero_id drop not null;
alter table public.camion_viajes
  add constraint camion_viajes_listero_id_fkey
  foreign key (listero_id) references public.profiles(id) on delete set null;

-- ── 2) Demás FK que bloqueaban (NO ACTION → SET NULL). Columnas ya nullable. ──
alter table public.dias_libres_cargo drop constraint if exists dias_libres_cargo_created_by_fkey;
alter table public.dias_libres_cargo
  add constraint dias_libres_cargo_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.lm_washes drop constraint if exists lm_washes_washed_by_fkey;
alter table public.lm_washes
  add constraint lm_washes_washed_by_fkey
  foreign key (washed_by) references public.profiles(id) on delete set null;

alter table public.op_daily_reports drop constraint if exists op_daily_reports_recorded_by_fkey;
alter table public.op_daily_reports
  add constraint op_daily_reports_recorded_by_fkey
  foreign key (recorded_by) references public.profiles(id) on delete set null;

alter table public.op_daily_reports drop constraint if exists op_daily_reports_supervisor_id_fkey;
alter table public.op_daily_reports
  add constraint op_daily_reports_supervisor_id_fkey
  foreign key (supervisor_id) references public.profiles(id) on delete set null;

alter table public.op_machine_rounds drop constraint if exists op_machine_rounds_recorded_by_fkey;
alter table public.op_machine_rounds
  add constraint op_machine_rounds_recorded_by_fkey
  foreign key (recorded_by) references public.profiles(id) on delete set null;

alter table public.op_machine_supervisors drop constraint if exists op_machine_supervisors_assigned_by_fkey;
alter table public.op_machine_supervisors
  add constraint op_machine_supervisors_assigned_by_fkey
  foreign key (assigned_by) references public.profiles(id) on delete set null;

alter table public.op_maintenance drop constraint if exists op_maintenance_requested_by_fkey;
alter table public.op_maintenance
  add constraint op_maintenance_requested_by_fkey
  foreign key (requested_by) references public.profiles(id) on delete set null;

alter table public.op_maintenance drop constraint if exists op_maintenance_resolved_by_fkey;
alter table public.op_maintenance
  add constraint op_maintenance_resolved_by_fkey
  foreign key (resolved_by) references public.profiles(id) on delete set null;

alter table public.op_report_settings drop constraint if exists op_report_settings_updated_by_fkey;
alter table public.op_report_settings
  add constraint op_report_settings_updated_by_fkey
  foreign key (updated_by) references public.profiles(id) on delete set null;

alter table public.op_supervisor_visits drop constraint if exists op_supervisor_visits_supervisor_id_fkey;
alter table public.op_supervisor_visits
  add constraint op_supervisor_visits_supervisor_id_fkey
  foreign key (supervisor_id) references public.profiles(id) on delete set null;

-- ── 3) VERIFICACIÓN: ninguna FK a profiles debe quedar en RESTRICT/NO ACTION ──
-- (confdeltype: a=no action, r=restrict, c=cascade, n=set null, d=set default)
select src.relname as tabla, con.conname, con.confdeltype
from pg_constraint con
join pg_class src on src.oid = con.conrelid
join pg_class tgt on tgt.oid = con.confrelid
join pg_namespace tgtns on tgtns.oid = tgt.relnamespace
where con.contype='f' and tgt.relname='profiles' and tgtns.nspname='public'
  and con.confdeltype in ('a','r')   -- debe volver 0 filas
order by tabla;
