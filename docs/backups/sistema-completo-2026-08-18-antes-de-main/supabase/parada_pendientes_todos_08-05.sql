-- ============================================================================
-- Marcar como PARADA las máquinas PENDIENTES del 08-05 de TODOS los inspectores
-- ----------------------------------------------------------------------------
-- Para cada asignación (machine_inspectors, activa) de un inspector REAL, si la
-- máquina NO trabajó en SU turno el 08-05 y NO tiene parada/avería pendiente, se
-- registra una PARADA (maintenance_requests · 'MÁQUINA PARADA' · 'pendiente'),
-- atribuida al inspector y fechada en su turno (día 10:00am / noche 8:00pm
-- Caracas del 08-05, para que paradaShiftOf caiga en el turno correcto).
--
-- Solo máquinas ACTIVAS del catálogo (las inactivas/retiradas no cuentan, igual
-- que en la app). Excluye el cajón "MAQUINAS FALTANTES" y asignaciones sin
-- inspector. Idempotente: no duplica si la máquina ya tiene una parada/avería
-- pendiente. Impacto estimado: ~20 paradas en 7 inspectores.
--
-- Nota: las paradas se ARRASTRAN a hoy hasta que la máquina trabaje o se marque
-- operativa — es el comportamiento normal del sistema.
-- ============================================================================
insert into public.maintenance_requests (machinery_id, material, notes, status, requested_by, created_at)
select mi.machinery_id, 'MÁQUINA PARADA', 'NO TRABAJÓ', 'pendiente', mi.inspector_id,
       (case when mi.shift = 'night' then timestamptz '2026-08-05 20:00:00-04'
                                     else timestamptz '2026-08-05 10:00:00-04' end)
from public.machine_inspectors mi
join public.machinery m on m.id = mi.machinery_id
where mi.active = true
  and mi.inspector_id is not null
  and coalesce(mi.inspector_name, '') !~* 'faltant'
  and coalesce(m.active, true) = true
  and coalesce(m.operational, true) = true
  -- NO trabajó en SU turno el 08-05 (sin horas de ese turno ni jornada abierta de ese turno)
  and not exists (
    select 1 from public.machine_rounds r
    where r.machinery_id = mi.machinery_id
      and r.round_date = date '2026-08-05'
      and case when mi.shift = 'night'
               then coalesce(r.night_hours, 0) > 0 or (r.jornada_start_at is not null and r.jornada_shift = 'night')
               else coalesce(r.day_hours, 0) > 0   or (r.jornada_start_at is not null and r.jornada_shift = 'day')
          end
  )
  -- Sin parada/avería pendiente ya (no duplicar)
  and not exists (
    select 1 from public.maintenance_requests mr
    where mr.machinery_id = mi.machinery_id and mr.status = 'pendiente'
  );

-- Verificación (cuántas quedaron, por inspector):
-- select p.requested_by, pr.full_name, count(*)
--   from public.maintenance_requests p
--   join public.profiles pr on pr.id = p.requested_by
--  where p.notes = 'NO TRABAJÓ' and p.material = 'MÁQUINA PARADA'
--    and p.created_at::date = '2026-08-05'
--  group by 1,2 order by 3 desc;

-- ── DESHACER (si te arrepientes) ────────────────────────────────────────────
-- delete from public.maintenance_requests
--  where notes = 'NO TRABAJÓ' and material = 'MÁQUINA PARADA'
--    and created_at in (timestamptz '2026-08-05 20:00:00-04', timestamptz '2026-08-05 10:00:00-04');
