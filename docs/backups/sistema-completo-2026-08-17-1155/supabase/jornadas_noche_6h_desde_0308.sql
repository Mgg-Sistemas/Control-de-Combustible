-- ============================================================================
-- BACKFILL (12-ago-2026): desde el 03/08, las máquinas que quedaron en 24h
-- (12h día + 12h noche) se bajan a 6h de NOCHE (quedan 18h: 12 día + 6 noche).
-- ÚNICA excepción: el COMPRESOR CON MARTILLO (serial/placa '79669') se DEJA en
-- 24h (trabaja continuo). Los reportes (Jornada) y el módulo de Inspecciones
-- leen machine_rounds → al corregir el dato quedan sincronizados.
--
-- Criterio "tiene 24h": day_hours + night_hours >= 24 (day 12 + night 12).
-- Idempotente: tras correrlo el total baja a 18 (<24), así que re-correrlo NO
-- vuelve a tocar nada. Correr en Supabase → SQL Editor (proyecto ddcwqmuqdqnsrtpticpx).
-- ============================================================================

-- 1) VISTA PREVIA — cuántas y cuáles rondas se van a ajustar (correr primero).
select mr.round_date, mch.code, mch.serial, mch.plate,
       mr.day_hours, mr.night_hours, (mr.day_hours + mr.night_hours) as total
from public.machine_rounds mr
join public.machinery mch on mch.id = mr.machinery_id
where mr.round_date >= '2026-08-03'
  and coalesce(mr.day_hours, 0) + coalesce(mr.night_hours, 0) >= 24
  and trim(coalesce(mch.serial, '')) <> '79669'
  and trim(coalesce(mch.plate,  '')) <> '79669'
order by mr.round_date, mch.code;

-- 2) AJUSTE — baja la noche a 6h (deja 12 día + 6 noche = 18h). Excluye el 79669.
update public.machine_rounds mr
set night_hours = 6
from public.machinery mch
where mch.id = mr.machinery_id
  and mr.round_date >= '2026-08-03'
  and coalesce(mr.day_hours, 0) + coalesce(mr.night_hours, 0) >= 24
  and trim(coalesce(mch.serial, '')) <> '79669'
  and trim(coalesce(mch.plate,  '')) <> '79669';

-- 3) TOPE DE DÍA — el turno de día nunca puede pasar de 12h (7am–7pm). Rondas con
--    day_hours > 12 (dato imposible, jornadas "corridas" que no cerraron) se topan a 12.
--    Excluye el 79669 (24h). Confirmado por el cliente (12-ago-2026).
update public.machine_rounds mr
set day_hours = 12
from public.machinery mch
where mch.id = mr.machinery_id
  and mr.round_date >= '2026-08-03'
  and mr.day_hours > 12
  and trim(coalesce(mch.serial, '')) <> '79669'
  and trim(coalesce(mch.plate,  '')) <> '79669';
