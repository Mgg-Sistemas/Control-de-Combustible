-- Borra la jornada de PRUEBA de la máquina JUMBO 320 (turno NOCHE ~0.04 h).
-- Correr en Supabase → SQL Editor. Ajusta la fecha si no es la de hoy.

-- 1) VER primero qué se va a tocar (no cambia nada):
select mr.id, mr.round_date, mr.round_no, m.code, m.plate, m.serial, c.name as empresa,
       mr.day_hours, mr.night_hours, mr.jornada_start_at, mr.jornada_shift
from public.machine_rounds mr
join public.machinery m on m.id = mr.machinery_id
left join public.companies c on c.id = m.company_id
where upper(btrim(m.code)) = 'JUMBO 320'
  and mr.round_date = current_date;     -- o pon la fecha: '2026-07-31'

-- 2) LIMPIAR SOLO la jornada de NOCHE de prueba (deja intacta la de día si la hubiera):
update public.machine_rounds mr
set night_hours = 0,
    night_operator = null,
    jornada_start_at = case when mr.jornada_shift = 'night' then null else mr.jornada_start_at end,
    jornada_shift    = case when mr.jornada_shift = 'night' then null else mr.jornada_shift end
from public.machinery m
where m.id = mr.machinery_id
  and upper(btrim(m.code)) = 'JUMBO 320'
  and mr.round_date = current_date       -- o la fecha exacta: '2026-07-31'
  and (mr.night_hours > 0 or mr.jornada_shift = 'night');

-- 3) (Opcional) Si esa fila quedó totalmente en cero, elimínala:
-- delete from public.machine_rounds mr
-- using public.machinery m
-- where m.id = mr.machinery_id
--   and upper(btrim(m.code)) = 'JUMBO 320'
--   and mr.round_date = current_date
--   and coalesce(mr.day_hours,0) = 0 and coalesce(mr.night_hours,0) = 0
--   and mr.jornada_start_at is null;
