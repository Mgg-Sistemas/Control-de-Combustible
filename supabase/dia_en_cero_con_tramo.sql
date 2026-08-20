-- ============================================================================
-- JORNADAS DE DÍA QUE SALEN "⏳ PENDIENTE" AUNQUE TRABAJARON
--
-- Síntoma (19-ago-2026): en el panel salen máquinas ⏳ PENDIENTE para el turno de
-- la mañana, y en la misma tarjeta dice «CERRÓ 07:00 P.M. · CIERRE AUTOMÁTICO».
-- Contradicción a la vista: cerró a las 7pm pero marca «DÍA 0 H».
--
-- POR QUÉ PASA. Son DOS datos distintos y quedaron desalineados:
--   · `machine_work_segments` — la LÍNEA DE TIEMPO. Ahí SÍ está el tramo
--     "07:00am → 07:00pm · 12h". De ahí sale el «CERRÓ 07:00 P.M.».
--   · `machine_rounds.day_hours` — LAS HORAS QUE CUENTAN. Quedó en 0.
-- El estado del turno se calcula con `day_hours` y `declared_day`, NO con los
-- tramos: 0 horas + turno no declarado + sin parada/avería vigente = PENDIENTE.
-- Por eso la tarjeta muestra el horario completo y a la vez «0 H».
--
-- QUÉ TIENEN EN COMÚN las afectadas (verificado el 19-ago-2026 por REST):
-- TODAS traen `machine_rounds.status = 'parada'` y casi todas `closed = true`.
-- Es decir: la máquina pasó por parada/avería o por un cierre de Control, y en ese
-- camino las horas del turno se quedaron en 0 aunque el tramo sí se escribió.
--
-- CUÁNTAS SON (19-ago-2026, contadas con la anon key):
--   19/08 → 3 máquinas (~34 h)      17/08 → 7 máquinas (~54 h)
--   18/08 → 2 máquinas (~8 h)       16/08 → 2 máquinas (~7 h)
-- Son pocas por día; el resto de las máquinas cierran bien.
--
-- ⚠️ ORDEN DE USO: BLOQUE 1 (lee) → confirmar la lista → BLOQUE 2 (respaldo) →
--    BLOQUE 3 (arregla) → BLOQUE 4 (verifica). El BLOQUE 5 deshace.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · QUÉ MÁQUINAS SON   ✅ SOLO LEE
-- ════════════════════════════════════════════════════════════════════════════
-- Cámbiale el rango de fechas si quieres mirar más atrás. Compara esta lista con
-- lo que ves en pantalla ANTES de tocar nada: por nombre no alcanza (hay seis
-- "CAMION VOLTEO TORONTO"), por eso va la placa y el serial.
with tramos as (
  select s.machinery_id, s.round_date,
         max(s.hours)                          as horas_tramo,
         string_agg(distinct s.source, ', ')    as fuentes
    from public.machine_work_segments s
   where s.shift = 'day'
     and s.round_date between '2026-08-16' and (now() at time zone 'America/Caracas')::date
   group by 1, 2
)
select r.round_date,
       m.code                     as maquina,
       coalesce(m.plate, '—')     as placa,
       coalesce(m.serial, '—')    as serial,
       c.name                     as empresa,
       r.day_hours                as horas_que_cuentan,   -- 0 = el problema
       t.horas_tramo              as horas_del_tramo,     -- lo que sí quedó registrado
       t.fuentes,
       r.declared_day, r.status, r.closed
  from public.machine_rounds r
  join tramos t   on t.machinery_id = r.machinery_id and t.round_date = r.round_date
  join public.machinery m on m.id = r.machinery_id
  left join public.companies c on c.id = m.company_id
 where coalesce(r.day_hours, 0) = 0
   and t.horas_tramo > 0
 order by r.round_date desc, m.code;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · RESPALDO   ⚠️ ESCRIBE (crea una tabla de respaldo, no toca datos)
-- ════════════════════════════════════════════════════════════════════════════
-- Guarda las filas TAL COMO ESTÁN hoy. Sin esto no corras el bloque 3.
create table if not exists public.bkp_dia_en_cero_20260819 as
with tramos as (
  select s.machinery_id, s.round_date, max(s.hours) as horas_tramo
    from public.machine_work_segments s
   where s.shift = 'day'
     and s.round_date between '2026-08-16' and (now() at time zone 'America/Caracas')::date
   group by 1, 2
)
select r.id, r.machinery_id, r.round_date, r.day_hours, r.night_hours,
       r.declared_day, r.status, r.closed, t.horas_tramo, now() as respaldado_el
  from public.machine_rounds r
  join tramos t on t.machinery_id = r.machinery_id and t.round_date = r.round_date
 where coalesce(r.day_hours, 0) = 0 and t.horas_tramo > 0;

select count(*) as filas_respaldadas from public.bkp_dia_en_cero_20260819;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · EL ARREGLO   ⚠️ ESTO SÍ CAMBIA LAS HORAS
-- ════════════════════════════════════════════════════════════════════════════
-- Le pone a `day_hours` las horas QUE YA ESTÁN en el tramo. No inventa nada: usa
-- lo que el propio sistema registró.
--
-- OJO CON ESTO: no todas son 12 h. Las que se pararon o se averiaron a media
-- jornada traen sus horas REALES (10,3 h · 8,7 h · 2,8 h…), que es lo correcto —
-- esa máquina no trabajó 12. Si de todas formas quieres forzar 12 h a todas, usa
-- la variante comentada al final del bloque, pero mira antes el bloque 1: le
-- estarías pagando horas que la máquina no trabajó.
--
-- `declared_day = true` va junto: deja el turno como DECLARADO, para que quede
-- ✅ Finalizada y no vuelva a caer en "pendiente" con el reinicio diario.
update public.machine_rounds r
   set day_hours     = b.horas_tramo,
       declared_day  = true
  from public.bkp_dia_en_cero_20260819 b
 where r.id = b.id
   and coalesce(r.day_hours, 0) = 0;      -- no pisa nada que ya tenga horas

-- Deja constancia del ajuste en la línea de tiempo (igual que un ajuste hecho a
-- mano desde Control), para que no parezca que las horas aparecieron solas.
insert into public.machine_work_segments
  (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
select b.machinery_id, b.round_date, 'day', now(), now(), b.horas_tramo,
       'ajuste_manual',
       'Corrección SQL 19-ago-2026: el turno tenía tramo de ' || b.horas_tramo ||
       'h pero day_hours estaba en 0 (salía PENDIENTE).'
  from public.bkp_dia_en_cero_20260819 b;

-- ── VARIANTE "12 h a todas" (NO recomendada, léase la nota de arriba) ────────
-- update public.machine_rounds r
--    set day_hours = 12, declared_day = true
--   from public.bkp_dia_en_cero_20260819 b
--  where r.id = b.id;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 · VERIFICACIÓN   ✅ SOLO LEE
-- ════════════════════════════════════════════════════════════════════════════
-- `pendientes_restantes` tiene que dar 0.
select
  (select count(*) from public.bkp_dia_en_cero_20260819)                as se_iban_a_corregir,
  (select count(*) from public.machine_rounds r
     join public.bkp_dia_en_cero_20260819 b on b.id = r.id
    where coalesce(r.day_hours,0) = 0)                                  as pendientes_restantes,
  (select round(sum(r.day_hours), 2) from public.machine_rounds r
     join public.bkp_dia_en_cero_20260819 b on b.id = r.id)             as horas_repuestas;

-- Y el detalle, para mirarlo con nombre y placa:
select r.round_date, m.code as maquina, coalesce(m.plate, m.serial, '—') as placa_o_serial,
       b.day_hours as antes, r.day_hours as ahora, r.declared_day
  from public.machine_rounds r
  join public.bkp_dia_en_cero_20260819 b on b.id = r.id
  join public.machinery m on m.id = r.machinery_id
 order by r.round_date desc, m.code;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 5 · DESHACER   (deja todo como estaba)
-- ════════════════════════════════════════════════════════════════════════════
-- update public.machine_rounds r
--    set day_hours = b.day_hours, declared_day = b.declared_day
--   from public.bkp_dia_en_cero_20260819 b
--  where r.id = b.id;
-- delete from public.machine_work_segments
--  where source = 'ajuste_manual' and notes like 'Corrección SQL 19-ago-2026%';
