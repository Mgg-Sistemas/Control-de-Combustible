-- ============================================================================
-- RECUPERAR JORNADAS QUE QUEDARON SIN CERRAR  (17-ago-2026)
--
-- CASO: CESAR FLAMES, jornada de DÍA del 16/08/2026. Su teléfono dio 137.38 h y
-- el Histórico 35.38 h. Diferencia: 102.00 h. Causa: ~8-10 máquinas quedaron con
-- `jornada_start_at` puesto y NUNCA cerraron, así que `day_hours` siguió en 0 —
-- las horas no se guardaron. El reporte del teléfono las contaba en vivo (topadas
-- en 12 h) y el Histórico, que solo lee lo bancado, las contaba en 0.
--
-- QUÉ HACE ESTE SCRIPT: cierra esas jornadas bancando las horas EXACTAMENTE como
-- lo habría hecho el cierre automático (`auto_close_jornadas.sql`):
--     horas = jornada_start_at → fin del turno,  topado con least(12, ...)
--     y se suma a lo que ya hubiera bancado:  least(12, coalesce(actual,0) + hrs)
--     además: jornada_start_at = null, status = 'operativa'
--     y deja su tramo en machine_work_segments con source 'auto_close'
-- NO inventa 12 h fijas: banca lo que realmente corresponde por reloj.
--
-- ⚠️ EXCLUYE AL INSPECTOR SOS LA GUAIRA. Sus máquinas inician y se apagan solas
--    por su propia automatización (`sos-reassert-shift-start`) — instrucción
--    expresa del cliente: esa automatización NO se toca.
--
-- ⚠️ AFECTA PAGOS. Correr BLOQUE POR BLOQUE, en orden, leyendo cada resultado.
--    El editor de Supabase solo muestra el resultado de la última consulta.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🛑 ESTADO AL 17-ago-2026, 15:00 — ESTE SCRIPT YA NO HACE FALTA
--
-- Se revisó la base: el cron `auto-close-jornadas` SÍ está vivo y cerró solo
-- todos los días. No queda NINGUNA jornada sin cerrar de días pasados:
--     16/08 → 173 filas, 2517.86 h bancadas, 0 sin cerrar
--     15/08 → 208 filas, 3155.42 h bancadas, 0 sin cerrar
--     14/08 → 205 filas, 3112.01 h bancadas, 0 sin cerrar
--     13/08 → 197 filas, 2092.51 h bancadas, 0 sin cerrar
-- Las horas de César Flames del 16/08 ya están bancadas. No hay nada que
-- recuperar. Se deja el script como herramienta por si vuelve a pasar.
--
-- ⛔ NO LO CORRAS "por si acaso". Las ÚNICAS jornadas abiertas son las de HOY,
--    que están EN CURSO. El bloque 4 las cerraría antes de tiempo bancando
--    horas hasta las 7pm que todavía nadie trabajó → inflaría los pagos.
--    Por eso los bloques 3 y 4 ahora llevan `round_date < current_date`.
-- ════════════════════════════════════════════════════════════════════════════
-- ============================================================================
set time zone 'America/Caracas';

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · DIAGNÓSTICO — TODOS los inspectores, no solo César  (solo lectura)
-- ════════════════════════════════════════════════════════════════════════════
-- Quién tiene jornadas sin cerrar, de qué día y cuántas horas se le deben.
select
  coalesce(mi.inspector_name, '(sin inspector asignado)') as inspector,
  r.round_date,
  coalesce(r.jornada_shift, '(sin turno)')                as turno,
  count(*)                                                as maquinas_sin_cerrar,
  count(*) filter (where coalesce(r.day_hours,0) = 0
                     and coalesce(r.night_hours,0) = 0)   as en_cero_horas,
  round(sum(
    least(12, greatest(0, extract(epoch from (
      case when coalesce(r.jornada_shift,'day') = 'night'
           then (r.round_date + 1) + time '07:00'
           else  r.round_date      + time '19:00'
      end - r.jornada_start_at)) / 3600.0)))::numeric, 2)  as horas_a_recuperar
from public.machine_rounds r
left join public.machine_inspectors mi
       on mi.machinery_id = r.machinery_id
      and mi.shift = coalesce(r.jornada_shift, 'day')
      and mi.active = true
where r.jornada_start_at is not null
  and lower(coalesce(mi.inspector_name, '')) not like '%sos la guaira%'
group by 1, 2, 3
order by r.round_date desc, 1;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · DETALLE máquina por máquina  (solo lectura)
-- ════════════════════════════════════════════════════════════════════════════
-- Cambia la fecha si quieres mirar otro día. Revisa esta lista ANTES de aplicar.
select
  coalesce(mi.inspector_name, '(sin inspector)') as inspector,
  m.code                                          as maquina,
  r.round_date,
  coalesce(r.jornada_shift,'day')                 as turno,
  r.jornada_start_at                              as inicio,
  coalesce(r.day_hours,0)                         as dia_actual,
  coalesce(r.night_hours,0)                       as noche_actual,
  round(least(12, greatest(0, extract(epoch from (
    case when coalesce(r.jornada_shift,'day') = 'night'
         then (r.round_date + 1) + time '07:00'
         else  r.round_date      + time '19:00'
    end - r.jornada_start_at)) / 3600.0))::numeric, 2) as horas_que_se_bancarian
from public.machine_rounds r
join public.machinery m on m.id = r.machinery_id
left join public.machine_inspectors mi
       on mi.machinery_id = r.machinery_id
      and mi.shift = coalesce(r.jornada_shift, 'day')
      and mi.active = true
where r.jornada_start_at is not null
  and r.round_date = date '2026-08-16'          -- ← la fecha a revisar
  and lower(coalesce(mi.inspector_name, '')) not like '%sos la guaira%'
order by 1, 2;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · RESPALDO — obligatorio antes de tocar nada
-- ════════════════════════════════════════════════════════════════════════════
-- Guarda una copia COMPLETA de las filas que se van a modificar. Si algo sale
-- mal, el BLOQUE 6 las devuelve a como estaban.
create table if not exists public.backup_jornadas_sin_cerrar_20260817 as
select r.*, now() as respaldado_en
from public.machine_rounds r
left join public.machine_inspectors mi
       on mi.machinery_id = r.machinery_id
      and mi.shift = coalesce(r.jornada_shift, 'day')
      and mi.active = true
where r.jornada_start_at is not null
  and r.round_date < current_date   -- ← nunca las de HOY: están en curso
  and lower(coalesce(mi.inspector_name, '')) not like '%sos la guaira%';

-- Verifica que el respaldo tenga filas ANTES de seguir:
select count(*) as filas_respaldadas from public.backup_jornadas_sin_cerrar_20260817;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 · APLICAR  ⚠️ ESTO SÍ CAMBIA DATOS Y AFECTA PAGOS
-- ════════════════════════════════════════════════════════════════════════════
-- Solo después de haber leído los bloques 1 y 2 y de que el respaldo tenga filas.
do $$
declare
  r          record;
  end_ts     timestamptz;
  hrs        numeric;
  n          integer := 0;
begin
  for r in
    select mr.id, mr.round_date, mr.jornada_start_at,
           coalesce(mr.jornada_shift, 'day') as sh, mr.machinery_id
    from public.machine_rounds mr
    left join public.machine_inspectors mi
           on mi.machinery_id = mr.machinery_id
          and mi.shift = coalesce(mr.jornada_shift, 'day')
          and mi.active = true
    where mr.jornada_start_at is not null
      and mr.round_date < current_date   -- ← nunca las de HOY: están en curso y
                                         --    cerrarlas ahora regalaría horas
      and lower(coalesce(mi.inspector_name, '')) not like '%sos la guaira%'
    order by mr.round_date, mr.machinery_id
  loop
    -- Fin del turno: DÍA cierra 7pm del mismo día; NOCHE cierra 7am del siguiente.
    end_ts := case when r.sh = 'night'
                   then ((r.round_date + 1) + time '07:00') at time zone 'America/Caracas'
                   else ( r.round_date      + time '19:00') at time zone 'America/Caracas'
              end;

    -- Jornada abierta DESPUÉS de su propio fin de turno (dato raro): se cierra
    -- sin bancar nada, para no regalar horas que no ocurrieron.
    if r.jornada_start_at >= end_ts then
      update public.machine_rounds
         set jornada_start_at = null, status = 'operativa'
       where id = r.id;
      n := n + 1;
      continue;
    end if;

    hrs := round((extract(epoch from (end_ts - r.jornada_start_at)) / 3600.0)::numeric, 2);

    if r.sh = 'night' then
      update public.machine_rounds
         set night_hours = least(12, coalesce(night_hours, 0) + hrs),
             jornada_start_at = null, status = 'operativa'
       where id = r.id;
    else
      update public.machine_rounds
         set day_hours = least(12, coalesce(day_hours, 0) + hrs),
             jornada_start_at = null, status = 'operativa'
       where id = r.id;
    end if;

    -- Traza auditable del tramo, igual que hace el cierre automático.
    insert into public.machine_work_segments
      (machinery_id, round_date, shift, started_at, ended_at, hours, source)
    select r.machinery_id, r.round_date, r.sh, r.jornada_start_at, end_ts, hrs, 'auto_close'
    where not exists (
      select 1 from public.machine_work_segments s
      where s.machinery_id = r.machinery_id
        and s.round_date  = r.round_date
        and s.shift       = r.sh
        and s.source      = 'auto_close'
    );

    n := n + 1;
  end loop;
  raise notice 'Jornadas cerradas: %', n;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 5 · VERIFICACIÓN  (solo lectura)
-- ════════════════════════════════════════════════════════════════════════════
-- (a) No debe quedar ninguna abierta salvo las de SOS y las de HOY en curso:
select coalesce(mi.inspector_name,'(sin inspector)') as inspector,
       r.round_date, count(*) as siguen_abiertas
from public.machine_rounds r
left join public.machine_inspectors mi
       on mi.machinery_id = r.machinery_id
      and mi.shift = coalesce(r.jornada_shift,'day') and mi.active = true
where r.jornada_start_at is not null
group by 1, 2 order by 2 desc, 1;

-- (b) Horas del 16/08 por inspector — compáralas con el Histórico de Jornadas:
select coalesce(mi.inspector_name,'(sin inspector)') as inspector,
       round(sum(coalesce(r.day_hours,0))::numeric, 2)   as horas_dia,
       round(sum(coalesce(r.night_hours,0))::numeric, 2) as horas_noche
from public.machine_rounds r
left join public.machine_inspectors mi
       on mi.machinery_id = r.machinery_id
      and mi.shift = coalesce(r.jornada_shift,'day') and mi.active = true
where r.round_date = date '2026-08-16'
group by 1 order by 1;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 6 · DESHACER  (solo si algo salió mal)
-- ════════════════════════════════════════════════════════════════════════════
-- update public.machine_rounds r
--    set day_hours = b.day_hours, night_hours = b.night_hours,
--        jornada_start_at = b.jornada_start_at, status = b.status
--   from public.backup_jornadas_sin_cerrar_20260817 b
--  where b.id = r.id;
--
-- delete from public.machine_work_segments
--  where source = 'auto_close' and created_at::date = current_date;
