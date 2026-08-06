-- ============================================================================
-- CIERRE de DEBRIS: jornadas que quedaron ABIERTAS de hace +2 días y que el
-- auto-cierre NO toca (guarda de recencia). Suele aparecer tras restaurar la BD.
-- Acredita horas SOLO hasta el fin de turno de SU día (día→7pm, noche→7am sig.),
-- NUNCA hasta "ahora". Correr por bloques en Supabase → SQL Editor.
--
-- ⚠️ REGLA CLAVE (no inflar): la restauración deja filas que YA traen horas
--    cargadas (p.ej. day_hours=12) pero con jornada_start_at seteado. Por eso:
--      • si las horas del turno están en 0  → se acreditan (inicio → fin) + traza.
--      • si YA tienen horas (>0)            → SOLO se limpia jornada_start_at
--                                             (no se suma nada, no se inserta traza).
--    source de la traza = 'ajuste_manual' (valor válido del CHECK).
-- ============================================================================

-- ── BLOQUE 1 · PREVIEW (no cambia nada) ─────────────────────────────────────
select
  mr.id, mr.machinery_id, mr.round_date, mr.jornada_shift, mr.jornada_start_at,
  coalesce(mr.day_hours, 0)   as day_h_actual,
  coalesce(mr.night_hours, 0) as night_h_actual,
  case when mr.jornada_shift = 'night'
       then ((mr.round_date + 1) + time '07:00') at time zone 'America/Caracas'
       else (mr.round_date + time '19:00')       at time zone 'America/Caracas' end as end_ts,
  case
    when mr.jornada_shift = 'day'   and coalesce(mr.day_hours,0)   = 0 then 'ACREDITA (día vacío)'
    when mr.jornada_shift = 'night' and coalesce(mr.night_hours,0) = 0 then 'ACREDITA (noche vacío)'
    else 'SOLO limpia jornada_start_at (ya tenía horas)'
  end as accion
from public.machine_rounds mr
where mr.jornada_start_at is not null
  and now() - (case when mr.jornada_shift = 'night'
       then ((mr.round_date + 1) + time '07:00') at time zone 'America/Caracas'
       else (mr.round_date + time '19:00')       at time zone 'America/Caracas' end) > interval '2 days'
order by mr.round_date, mr.jornada_shift;


-- ── BLOQUE 2 · CIERRE (correr SOLO si el PREVIEW se ve bien) ─────────────────
-- REGLA DEL CLIENTE: las jornadas de DÍA que se cierran = 12h FIJAS (máquinas de
--   permanencia; el arranque tarde es cuando el inspector marcó, no la hora real).
--   • DÍA con day_hours=0  → se pone day_hours=12 + traza 7am→7pm (12h).
--   • DÍA que ya tenía 12h → se deja en 12; solo se limpia jornada_start_at.
--   • NOCHE                → NO se acredita aquí (queda como estaba: 0 ó lo que tuviera);
--                            solo se limpia el jornada_start_at basura. (Ver bloque
--                            extra abajo si esas noches sí se trabajaron.)
with deb as (
  select
    mr.id, mr.machinery_id, mr.round_date, mr.jornada_shift,
    coalesce(mr.day_hours, 0) as day_h,
    (mr.round_date + time '07:00') at time zone 'America/Caracas' as ini7am,
    (mr.round_date + time '19:00') at time zone 'America/Caracas' as fin7pm
  from public.machine_rounds mr
  where mr.jornada_start_at is not null
    and now() - (case when mr.jornada_shift = 'night'
         then ((mr.round_date + 1) + time '07:00') at time zone 'America/Caracas'
         else (mr.round_date + time '19:00')       at time zone 'America/Caracas' end) > interval '2 days'
),
-- DÍA vacío → 12h fijas + traza (7am→7pm).
dia_vacio as (
  select * from deb where jornada_shift = 'day' and day_h = 0
),
traza as (
  insert into public.machine_work_segments
    (machinery_id, round_date, shift, started_at, ended_at, hours, source)
  select machinery_id, round_date, 'day', ini7am, fin7pm, 12, 'ajuste_manual'
  from dia_vacio
  returning 1
)
update public.machine_rounds mr set
  day_hours = case when d.jornada_shift = 'day' and d.day_h = 0 then 12 else mr.day_hours end,
  jornada_start_at = null,
  status = 'operativa'
from deb d
where mr.id = d.id;


-- ── BLOQUE 3 · VERIFICAR (debe devolver 0) ──────────────────────────────────
select count(*) as debris_restante
from public.machine_rounds mr
where mr.jornada_start_at is not null
  and now() - (case when mr.jornada_shift = 'night'
       then ((mr.round_date + 1) + time '07:00') at time zone 'America/Caracas'
       else (mr.round_date + time '19:00')       at time zone 'America/Caracas' end) > interval '2 days';
