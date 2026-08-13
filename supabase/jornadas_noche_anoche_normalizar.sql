-- ============================================================================
-- NORMALIZAR JORNADAS DE NOCHE DE ANOCHE (13-ago-2026).
-- Anoche muchas máquinas cerraron a las 9pm/10pm (2-3 h) por cierre anticipado
-- o parada; la permanencia de NOCHE debe ser 6 h (7pm→1am). Se normaliza el
-- turno NOCHE de la fecha de anoche:
--   • Todas con noche > 0  -> night_hours = 6
--   • EXCEPTO  VOLTEO / VOLQUETA y TORONTO  -> NO se tocan
--   • LUMINARIAS           -> night_hours = 12 (trabajan toda la noche)
--   • Compresor 79669 (4 martillos) -> 24 h (day 12 + night 12)
-- DÍA no se toca. Correr en Supabase → SQL Editor.
--
-- Nota fecha: la noche que empezó el 12 a las 7pm tiene round_date = 2026-08-12.
-- El PREVIEW muestra 12 y 13; corré los UPDATE con la fecha que corresponda.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 0) PREVIEW / COTEJO — mirá qué hay antes de tocar nada.
-- ─────────────────────────────────────────────────────────────────────────
select
  mr.round_date,
  mch.code,
  mch.machinery_type,
  mr.day_hours,
  mr.night_hours,
  case
    when lower(coalesce(mch.code,'')||' '||coalesce(mch.description,'')||' '||coalesce(mch.machinery_type,'')) like '%volteo%'
      or lower(coalesce(mch.code,'')||' '||coalesce(mch.description,'')||' '||coalesce(mch.machinery_type,'')) like '%volqueta%' then 'VOLTEO/VOLQUETA (no tocar)'
    when lower(coalesce(mch.code,'')||' '||coalesce(mch.description,'')||' '||coalesce(mch.machinery_type,'')) like '%toronto%' then 'TORONTO (no tocar)'
    when lower(coalesce(mch.code,'')||' '||coalesce(mch.description,'')||' '||coalesce(mch.machinery_type,'')) like '%luminaria%' then 'LUMINARIA -> 12h'
    when lower(trim(coalesce(mch.serial,''))) = '79669' or lower(trim(coalesce(mch.plate,''))) = '79669' then 'COMPRESOR 79669 -> 24h'
    else 'NORMAL -> 6h'
  end as accion
from public.machine_rounds mr
join public.machinery mch on mch.id = mr.machinery_id
where mr.round_date in ('2026-08-12', '2026-08-13')
  and coalesce(mr.night_hours, 0) > 0
order by mr.round_date, accion, mch.code;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) NORMAL -> 6 h de noche (todas menos volteo/volqueta, toronto, luminaria, 79669).
-- ─────────────────────────────────────────────────────────────────────────
update public.machine_rounds mr
set night_hours = 6
from public.machinery mch
where mch.id = mr.machinery_id
  and mr.round_date = '2026-08-12'
  and coalesce(mr.night_hours, 0) > 0
  and lower(coalesce(mch.code,'')||' '||coalesce(mch.description,'')||' '||coalesce(mch.machinery_type,'')) not like '%volteo%'
  and lower(coalesce(mch.code,'')||' '||coalesce(mch.description,'')||' '||coalesce(mch.machinery_type,'')) not like '%volqueta%'
  and lower(coalesce(mch.code,'')||' '||coalesce(mch.description,'')||' '||coalesce(mch.machinery_type,'')) not like '%toronto%'
  and lower(coalesce(mch.code,'')||' '||coalesce(mch.description,'')||' '||coalesce(mch.machinery_type,'')) not like '%luminaria%'
  and lower(trim(coalesce(mch.serial,''))) <> '79669'
  and lower(trim(coalesce(mch.plate,'')))  <> '79669';

-- ─────────────────────────────────────────────────────────────────────────
-- 2) LUMINARIAS -> 12 h de noche.
-- ─────────────────────────────────────────────────────────────────────────
update public.machine_rounds mr
set night_hours = 12
from public.machinery mch
where mch.id = mr.machinery_id
  and mr.round_date = '2026-08-12'
  and coalesce(mr.night_hours, 0) > 0
  and lower(coalesce(mch.code,'')||' '||coalesce(mch.description,'')||' '||coalesce(mch.machinery_type,'')) like '%luminaria%';

-- ─────────────────────────────────────────────────────────────────────────
-- 3) COMPRESOR 79669 (4 martillos) -> 24 h (día 12 + noche 12).
-- ─────────────────────────────────────────────────────────────────────────
update public.machine_rounds mr
set day_hours = 12, night_hours = 12
from public.machinery mch
where mch.id = mr.machinery_id
  and mr.round_date = '2026-08-12'
  and (lower(trim(coalesce(mch.serial,''))) = '79669' or lower(trim(coalesce(mch.plate,''))) = '79669');

-- ─────────────────────────────────────────────────────────────────────────
-- 4) VERIFICACIÓN — cómo quedó.
-- ─────────────────────────────────────────────────────────────────────────
select mr.round_date, mch.code, mch.machinery_type, mr.day_hours, mr.night_hours
from public.machine_rounds mr
join public.machinery mch on mch.id = mr.machinery_id
where mr.round_date = '2026-08-12'
  and coalesce(mr.night_hours, 0) > 0
order by mch.code;
