-- ============================================================================
-- Separar inspectores por turno: AYENDER, EDIONIS y JULIO son de NOCHE, pero
-- tenían 1–2 máquinas sueltas en el turno DÍA (por eso salían en día). Se les
-- quitan esas asignaciones de DÍA para que solo aparezcan en NOCHE.
--
-- NO se toca:
--   • ARTURO YAGUE  -> cubre día y noche a propósito (4/4).
--   • SOS LA GUAIRA  y  MAQUINAS FALTANTES -> cajones del sistema (ambos turnos).
--
-- Las máquinas de DÍA que queden sin inspector las recoge el cron de faltantes
-- (o el SQL de SOS si son de manejo de carga/soporte/servicio).
-- ============================================================================

-- 1) ANTES: qué filas de DÍA se van a borrar (revisión).
select inspector_name, shift, count(*) as maquinas
from public.machine_inspectors
where shift = 'day'
  and (inspector_name ilike 'ayender%' or inspector_name ilike 'edionis%' or inspector_name ilike 'julio guillen%')
group by inspector_name, shift
order by inspector_name;

-- 2) BORRAR las asignaciones de DÍA de esos tres inspectores de noche.
delete from public.machine_inspectors
where shift = 'day'
  and (inspector_name ilike 'ayender%' or inspector_name ilike 'edionis%' or inspector_name ilike 'julio guillen%');

-- 3) VERIFICACIÓN: ya no deben tener máquinas de día (solo de noche).
select
  coalesce(nullif(inspector_name, ''), '—')            as inspector,
  count(*) filter (where shift = 'day')                as maquinas_dia,
  count(*) filter (where shift = 'night')              as maquinas_noche
from public.machine_inspectors
where active = true
  and (inspector_name ilike 'ayender%' or inspector_name ilike 'edionis%' or inspector_name ilike 'julio guillen%')
group by 1
order by inspector;
