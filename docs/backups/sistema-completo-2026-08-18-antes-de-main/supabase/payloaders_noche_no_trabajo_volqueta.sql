-- ============================================================================
-- CLIENTE 14-ago-2026 (madrugada) — payloaders …1166 / app26 / …5020:
-- se les quitaron las horas de NOCHE del 13/08 (no hay volqueta). Para que NO
-- queden como "⏳ pendiente por iniciar" en la vista de inspectores del teléfono,
-- se marca su NOCHE como 🟡 "no trabajó" con motivo NO HAY VOLQUETA (ticket
-- maintenance_requests material='MÁQUINA PARADA'). created_at = ahora (madrugada
-- → turno NOCHE por hora Caracas). El cron `expire_paradas_no_trabajo` la cierra
-- sola al terminar la noche (07:00) → mañana pasan a ⏳ pendiente por iniciar.
-- El turno de DÍA (9–11 h ya trabajadas) NO se toca. Correr UNA vez.
-- ============================================================================
insert into public.maintenance_requests (machinery_id, material, notes, status, requested_by)
select m.id, 'MÁQUINA PARADA', 'NO HAY VOLQUETA', 'pendiente', null
  from public.machinery m
 where ( lower(coalesce(m.code,''))   like '%1166'  or lower(coalesce(m.serial,'')) like '%1166'  or lower(coalesce(m.plate,'')) like '%1166'
      or lower(coalesce(m.code,''))   like '%app26' or lower(coalesce(m.serial,'')) like '%app26' or lower(coalesce(m.plate,'')) like '%app26'
      or lower(coalesce(m.code,''))   like '%5020'  or lower(coalesce(m.serial,'')) like '%5020'  or lower(coalesce(m.plate,'')) like '%5020' )
   -- guarda anti-duplicado: no crear otra si ya hay una parada pendiente reciente
   and not exists (
     select 1 from public.maintenance_requests q
      where q.machinery_id = m.id
        and q.material = 'MÁQUINA PARADA'
        and q.status = 'pendiente'
        and q.created_at >= (now() - interval '18 hours')
   );

-- VERIFICACIÓN: deben aparecer las 3 con su ticket pendiente de esta noche.
select m.code, m.serial, r.material, r.notes, r.status, r.created_at
  from public.maintenance_requests r
  join public.machinery m on m.id = r.machinery_id
 where r.material = 'MÁQUINA PARADA' and r.status = 'pendiente'
   and r.created_at >= (now() - interval '18 hours')
   and ( lower(coalesce(m.code,'')) like '%1166' or lower(coalesce(m.serial,'')) like '%1166'
      or lower(coalesce(m.code,'')) like '%app26' or lower(coalesce(m.serial,'')) like '%app26'
      or lower(coalesce(m.code,'')) like '%5020' or lower(coalesce(m.serial,'')) like '%5020' )
 order by m.code;
