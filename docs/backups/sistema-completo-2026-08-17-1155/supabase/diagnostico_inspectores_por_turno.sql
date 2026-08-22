-- ============================================================================
-- DIAGNÓSTICO: inspectores con asignaciones en AMBOS turnos (día y noche).
-- Un inspector "de noche" que aparezca en el día (y viceversa) es porque tiene
-- filas en machine_inspectors del turno que no le toca. Esta consulta muestra,
-- por inspector, cuántas máquinas tiene en cada turno; los que tengan número en
-- las DOS columnas son los que se ven en ambos lados.
-- (No modifica nada; solo lee.)
-- ============================================================================
select
  coalesce(nullif(mi.inspector_name, ''), '—')                     as inspector,
  count(*) filter (where mi.shift = 'day')                          as maquinas_dia,
  count(*) filter (where mi.shift = 'night')                        as maquinas_noche
from public.machine_inspectors mi
where mi.active = true
group by 1
having count(*) filter (where mi.shift = 'day')  > 0
   and count(*) filter (where mi.shift = 'night') > 0
order by inspector;
