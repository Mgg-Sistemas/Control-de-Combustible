-- ============================================================================
-- Tablas de respaldo (backup_*, bkp_*, _backup_*) — cerrar acceso público (RLS)
-- ----------------------------------------------------------------------------
-- Motivo: el advisor de Supabase (rls_disabled_in_public) sigue marcando varias
-- tablas de RESPALDO que se crearon a mano durante migraciones/arreglos pasados.
-- No están en schema.sql y la app NO las usa, pero contienen datos reales
-- copiados y quedaron públicamente accesibles.
--
-- Corrección NO destructiva: activar RLS en TODA tabla del esquema `public` que
-- todavía lo tenga apagado, SIN crear políticas. Resultado: quedan totalmente
-- bloqueadas al API público (anon/authenticated no ven ninguna fila); solo el
-- service_role/superusuario (panel de Supabase) las puede leer para recuperación.
-- No se borra ningún dato. Es IDEMPOTENTE.
--
-- En este momento las únicas tablas sin RLS son estos respaldos, así que este
-- bloque solo las toca a ellas. Si algún día hiciera falta que una tabla NUEVA
-- quede abierta, primero se le crean sus políticas en schema.sql.
-- Correr en: Supabase → SQL Editor (proyecto Control de Combustible).
-- ============================================================================

do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = false
  loop
    execute format('alter table public.%I enable row level security;', r.relname);
  end loop;
end $$;

-- ── Verificación: NO debe devolver ninguna fila.
select c.relname as tabla_sin_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity = false
order by c.relname;

-- ── (OPCIONAL) Si ya no necesitas estos respaldos, se pueden BORRAR en vez de
--    solo bloquearlos. Revisa la lista antes de descomentar — esto SÍ borra:
-- drop table if exists
--   public._backup_rounds_no_trabajo_20260810,
--   public.backup_assign_missing_to_placeholder_20260811,
--   public.backup_camion_viajes_20260912,
--   public.backup_edificios_20260809,
--   public.backup_fn_assign_missing_20260808,
--   public.backup_machine_inspectors_20260808_ghost,
--   public.backup_machine_inspectors_20260810_bulkbug,
--   public.backup_machine_inspectors_retiradas_20260811,
--   public.backup_machine_rounds_20260807_fix2,
--   public.backup_machine_rounds_20260808_2machines,
--   public.backup_machine_rounds_20260808_altas,
--   public.backup_machine_rounds_20260808_reactivar4,
--   public.backup_machine_rounds_20260811_jornada_null_fix,
--   public.backup_machine_work_segments_20260807_fix2,
--   public.backup_machine_work_segments_20260808_2machines,
--   public.backup_machine_work_segments_20260808_altas,
--   public.backup_machine_work_segments_20260808_reactivar4,
--   public.backup_machinery_20260808_reactivar4,
--   public.backup_machinery_ref_preunify_20260809,
--   public.backup_machinery_referencia_20260809,
--   public.backup_machinery_ubicacion_patio_20260808,
--   public.backup_maintenance_requests_20260808_parada3,
--   public.backup_maintenance_requests_20260808_pre_shift_col,
--   public.backup_maintenance_requests_20260810_luminaria,
--   public.backup_maintenance_requests_20260811_bulkbug_revert,
--   public.backup_staff_pay_periods_20260912,
--   public.bkp_averiadas_mal_retiradas_20260820;
