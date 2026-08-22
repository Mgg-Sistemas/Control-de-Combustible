-- ============================================================================
-- 12 h DÍA / 6 h NOCHE a las máquinas ACTIVAS, del 03/08/2026 a hoy.
--
-- "ACTIVA" = machinery.operational = true, NO en espera, y SIN parada/avería
-- pendiente a esa fecha (maintenance_requests.status='pendiente' creada en/antes
-- del día). Las PARADAS/AVERIADAS y las NO operativas NO se tocan.
--
-- Escribe en machine_rounds (round_no = 1): day_hours = 12, night_hours = 6.
-- Como reportes y el módulo de Control leen machine_rounds, ambos quedan
-- sincronizados automáticamente.
--
-- ⚠️ FUERZA 12/6 también donde ya había horas distintas (es lo pedido: "que TODAS
-- las activas estén 12/6"). El BLOQUE 1 muestra cuántas filas cambiarían de valor
-- ANTES de aplicar. El pago es POR JORNADA (price_jornada), no por hora, así que
-- las horas no inflan el monto; son permanencia/turno.
--
-- Rango: 2026-08-03 .. 2026-08-06 (ajústalo si hace falta).
-- Correr por bloques: 1 (previsualizar) → revisar → 2 (aplicar) → 3 (verificar).
-- ============================================================================

-- ── BLOQUE 1 · PREVISUALIZAR (no cambia nada) ───────────────────────────────
with dias as (
  select generate_series('2026-08-03'::date, '2026-08-06'::date, interval '1 day')::date as d
),
activas as (
  select m.id, d.d
  from public.machinery m
  cross join dias d
  where m.operational is true
    and coalesce(m.en_espera, false) = false
    and not exists (
      select 1 from public.maintenance_requests mr
      where mr.machinery_id = m.id
        and mr.status = 'pendiente'
        and mr.created_at <= (d.d + interval '1 day' - interval '1 second')
    )
)
select
  (select count(*) from activas)                                   as filas_objetivo_activas,
  (select count(*) from activas a
     join public.machine_rounds r
       on r.machinery_id = a.id and r.round_date = a.d and r.round_no = 1
    where r.day_hours = 12 and r.night_hours = 6)                  as ya_estan_12_6,
  (select count(*) from activas a
     join public.machine_rounds r
       on r.machinery_id = a.id and r.round_date = a.d and r.round_no = 1
    where r.day_hours is distinct from 12 or r.night_hours is distinct from 6) as cambiarian_de_valor,
  (select count(*) from activas a
     where not exists (select 1 from public.machine_rounds r
       where r.machinery_id = a.id and r.round_date = a.d and r.round_no = 1)) as se_crearian_nuevas,
  (select count(*) from public.machinery m
     where m.operational is not true or coalesce(m.en_espera,false)=true
        or exists (select 1 from public.maintenance_requests mr
             where mr.machinery_id = m.id and mr.status='pendiente'))         as maquinas_excluidas_parada_averia_o_inactiva;


-- ── BLOQUE 2 · APLICAR (upsert 12/6 a las activas) ──────────────────────────
-- Descomenta y corre SOLO cuando el BLOQUE 1 se vea bien.
/*
with dias as (
  select generate_series('2026-08-03'::date, '2026-08-06'::date, interval '1 day')::date as d
),
activas as (
  select m.id, d.d
  from public.machinery m
  cross join dias d
  where m.operational is true
    and coalesce(m.en_espera, false) = false
    and not exists (
      select 1 from public.maintenance_requests mr
      where mr.machinery_id = m.id
        and mr.status = 'pendiente'
        and mr.created_at <= (d.d + interval '1 day' - interval '1 second')
    )
)
insert into public.machine_rounds (machinery_id, round_date, round_no, status, day_hours, night_hours)
select a.id, a.d, 1, 'operativa', 12, 6
from activas a
on conflict (machinery_id, round_date, round_no)
do update set day_hours = 12, night_hours = 6, status = 'operativa';
*/


-- ── BLOQUE 3 · VERIFICAR (tras aplicar) ─────────────────────────────────────
/*
select round_date,
       count(*)                                        as rondas,
       count(*) filter (where day_hours = 12)          as con_dia_12,
       count(*) filter (where night_hours = 6)         as con_noche_6
from public.machine_rounds
where round_date between '2026-08-03' and '2026-08-06'
  and round_no = 1
group by round_date
order by round_date;
*/
