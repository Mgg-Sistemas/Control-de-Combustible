-- Pone la HORA DE INICIO de las jornadas YA INICIADAS (en curso) en:
--   · Día  → 7:00am  · Noche → 7:00pm
-- de su propia fecha (round_date). Caracas es UTC-4 fijo. Correr en Supabase → SQL Editor.

-- 1) VER las que se van a ajustar (no cambia nada):
select id, round_date, jornada_shift, jornada_start_at
from public.machine_rounds
where jornada_start_at is not null
order by round_date desc;

-- 2) Turno DÍA (o sin turno) → 7:00am:
update public.machine_rounds
set jornada_start_at = (round_date::text || ' 07:00:00-04')::timestamptz
where jornada_start_at is not null
  and coalesce(jornada_shift, 'day') <> 'night';

-- 3) Turno NOCHE → 7:00pm:
update public.machine_rounds
set jornada_start_at = (round_date::text || ' 19:00:00-04')::timestamptz
where jornada_start_at is not null
  and jornada_shift = 'night';
