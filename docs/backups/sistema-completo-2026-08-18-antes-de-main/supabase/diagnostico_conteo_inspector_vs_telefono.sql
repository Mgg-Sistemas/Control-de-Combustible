-- ============================================================================
-- Reconciliación POR INSPECTOR: lo que ve en su TELÉFONO vs lo que cuenta el sistema.
--   • maquinas_visibles  = lo que ve en el teléfono: máquinas DISTINTAS activas+operativas
--                          (el teléfono oculta inactivas/averiadas). Debe cuadrar con su pantalla.
--   • maquinas_distintas = todas sus máquinas DISTINTAS (incluye inactivas/averiadas).
--   • filas_dia_noche    = filas de asignación (una máquina asignada en DÍA y NOCHE cuenta 2).
--   • dia / noche        = filas por turno.
-- Si "maquinas_visibles" = lo que dice el inspector (ej. Frank 43) y otra columna = 59,
-- esa columna es la que está inflando el conteo en el sistema.
-- (Solo lee; no modifica nada.)
-- ============================================================================
select
  mi.inspector_name,
  count(distinct mi.machinery_id) filter (where mch.active and mch.operational) as maquinas_visibles,
  count(distinct mi.machinery_id)                                               as maquinas_distintas,
  count(*)                                                                      as filas_dia_noche,
  count(*) filter (where mi.shift = 'day')                                      as dia,
  count(*) filter (where mi.shift = 'night')                                    as noche,
  count(distinct mi.machinery_id) filter (where not (mch.active and mch.operational)) as ocultas_inactivas
from public.machine_inspectors mi
join public.machinery mch on mch.id = mi.machinery_id
where mi.active = true
group by mi.inspector_name
order by mi.inspector_name;
