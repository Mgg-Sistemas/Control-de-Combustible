-- ============================================================================
-- INSPECTOR SOS LA GUAIRA · 18-ago-2026 → 12 h de DÍA y 6 h de NOCHE
--
-- Pedido del cliente (19-ago-2026): "todas las máquinas del inspector sos la
-- guaira que trabajaron el 18/8/2026 → 12 horas de día y 6 horas de noche,
-- SOLO ese día, sin afectar la automatización".
--
-- ESTADO REAL ANTES DE TOCAR NADA (medido el 19-ago-2026 por REST):
--   · 89 rondas del 18/08 tienen al inspector SOS estampado en la ronda.
--   · Las 89 YA tienen day_hours = 12  → el DÍA no cambia, el update es no-op.
--   · 55 ya están en night_hours = 6   → alguien las corrigió a mano (traen su
--     tramo `ajuste_manual: -6`).
--   · 34 siguen en night_hours = 12    → ESTAS son las que este script baja a 6.
--   Impacto real: 34 rondas · −204 h de noche. Nada más se mueve.
--
-- POR QUÉ QUEDARON EN 12: la noche de SOS es 7pm→1am (6 h). Pero el auto-cierre
-- genérico (supabase/auto_close_jornadas.sql, cambio del 14-ago-2026) cierra la
-- noche a las 7am con 12 h para TODAS las máquinas, y el backfill del placeholder
-- le mete un tramo `auto_full_shift: 12` a los camiones. Por eso hay rondas con
-- 12 h de noche que en realidad trabajaron 6.
--
-- ⚠️ ESTO BAJA HORAS (no las sube). Menos horas = menos facturación en esas 34.
--    Por eso el respaldo va DENTRO del bloque que aplica, como primer paso.
--
-- NO TOCA LA AUTOMATIZACIÓN. Este archivo no crea, borra ni reprograma ninguna
-- función ni ningún cron. Solo escribe datos del 18/08. Y no hay riesgo de que un
-- cron lo deshaga:
--   · auto_close_jornadas    → solo procesa rondas con jornada_start_at NO nulo;
--                              las 89 lo tienen en null (verificado). No las toca.
--   · auto_full_shift_*      → trabajan sobre "ayer" y solo SUBEN (greatest);
--                              esta noche procesan el 19/08, nunca el 18/08.
--   · clear_stale_declarations → solo actúa sobre rondas de HOY con 0 horas.
--
-- ⚠️ ORDEN: BLOQUE 1 (lee) → mirar la lista → BLOQUE 2 (respalda) →
--    BLOQUE 3 (aplica) → BLOQUE 4 (verifica). El BLOQUE 5 deshace.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · A CUÁLES LES VA A PEGAR   ✅ SOLO LEE
-- ════════════════════════════════════════════════════════════════════════════
-- `cambia_noche` marca las que de verdad se mueven. `es_camion` está aparte
-- porque la automatización del placeholder le da 12 h de noche a volqueta/toronto
-- por diseño: si aparece alguna acá, con este script baja a 6 igual (es lo que
-- pediste). Míralo antes de correr el bloque 3.
select m.code                                   as maquina,
       coalesce(m.plate, '—')                   as placa,
       coalesce(m.serial, '—')                  as serial,
       c.name                                   as empresa,
       r.day_hours                              as dia_ahora,
       r.night_hours                            as noche_ahora,
       12                                       as dia_quedara,
       6                                        as noche_quedara,
       (coalesce(r.night_hours, 0) <> 6)        as cambia_noche,
       (lower(coalesce(m.code, '')) ~ 'volqueta|toronto') as es_camion,
       r.inspector_day, r.inspector_night, r.status, r.closed
  from public.machine_rounds r
  join public.machinery m on m.id = r.machinery_id
  left join public.companies c on c.id = m.company_id
 where r.round_date = '2026-08-18'
   and (lower(trim(coalesce(r.inspector_day,   ''))) = 'inspector sos la guaira'
     or lower(trim(coalesce(r.inspector_night, ''))) = 'inspector sos la guaira')
 order by cambia_noche desc, m.code, placa;

-- Resumen de una línea (debe decir: 89 en total, 34 por cambiar).
select count(*)                                                as rondas_sos,
       count(*) filter (where coalesce(r.night_hours,0) <> 6)   as noche_por_cambiar,
       count(*) filter (where coalesce(r.day_hours,0)   <> 12)  as dia_por_cambiar,
       count(*) filter (where r.jornada_start_at is not null)    as con_jornada_abierta
  from public.machine_rounds r
 where r.round_date = '2026-08-18'
   and (lower(trim(coalesce(r.inspector_day,   ''))) = 'inspector sos la guaira'
     or lower(trim(coalesce(r.inspector_night, ''))) = 'inspector sos la guaira');


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · APLICADO EL 19-ago-2026 21:22 (Caracas) — AUTOCONTENIDO
--
-- ⚠️ La primera version de este archivo tenia los bloques 3/4/5 leyendo la tabla
--    de respaldo, asi que correr el 3 sin el 2 fallaba con 42P01 (paso: no cambio
--    nada). Esta version filtra SIEMPRE contra machine_rounds, asi el orden no
--    puede romperse, y escribe el rastro ANTES del update para poder leer el "de".
--
-- RESULTADO REAL: 89 rondas SOS quedaron en 12 h dia / 6 h noche. Solo se movieron
-- las 34 que seguian con 12 h de noche (-204 h). El dia ya estaba en 12 en las 89.
-- Las 113 rondas NO-SOS del 18/08 quedaron intactas. 0 con jornada abierta.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) RESPALDO (una sola vez, para poder volver atras).
create table if not exists public.bkp_sos_18ago_20260819 as
select r.id, r.machinery_id, r.round_date, r.day_hours, r.night_hours,
       r.declared_day, r.declared_night, r.status,
       r.inspector_day, r.inspector_night, now() as respaldado_el
  from public.machine_rounds r
 where r.round_date = '2026-08-18'
   and (lower(trim(coalesce(r.inspector_day,   ''))) = 'inspector sos la guaira'
     or lower(trim(coalesce(r.inspector_night, ''))) = 'inspector sos la guaira');

-- 2) RASTRO en la linea de tiempo. Va ANTES del update: necesita el valor viejo.
--    Los tramos NO afectan el pago (las horas que cuentan son las de machine_rounds).
insert into public.machine_work_segments
  (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
select r.machinery_id, r.round_date, 'night', now(), now(), (6 - r.night_hours),
       'ajuste_manual',
       'Ajuste manual: ' || r.night_hours || 'h -> 6h · jornada SOS La Guaira 7pm-1am (18-ago-2026)'
  from public.machine_rounds r
 where r.round_date = '2026-08-18'
   and (lower(trim(coalesce(r.inspector_day,   ''))) = 'inspector sos la guaira'
     or lower(trim(coalesce(r.inspector_night, ''))) = 'inspector sos la guaira')
   and coalesce(r.night_hours, 0) <> 6;

insert into public.machine_work_segments
  (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
select r.machinery_id, r.round_date, 'day', now(), now(), (12 - r.day_hours),
       'ajuste_manual',
       'Ajuste manual: ' || r.day_hours || 'h -> 12h · jornada SOS La Guaira 7am-7pm (18-ago-2026)'
  from public.machine_rounds r
 where r.round_date = '2026-08-18'
   and (lower(trim(coalesce(r.inspector_day,   ''))) = 'inspector sos la guaira'
     or lower(trim(coalesce(r.inspector_night, ''))) = 'inspector sos la guaira')
   and coalesce(r.day_hours, 0) <> 12;

-- 3) APLICAR 12 h de DIA y 6 h de NOCHE.
--    `declared_*` y `status` van junto para que queden Finalizadas y no caigan en
--    "pendiente" con el reinicio diario. NO se toca `jornada_start_at` (sigue null)
--    -> el auto-cierre las ignora por completo.
update public.machine_rounds r
   set day_hours      = 12,
       night_hours    = 6,
       declared_day   = true,
       declared_night = true,
       status         = 'operativa'
 where r.round_date = '2026-08-18'
   and (lower(trim(coalesce(r.inspector_day,   ''))) = 'inspector sos la guaira'
     or lower(trim(coalesce(r.inspector_night, ''))) = 'inspector sos la guaira');


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · VERIFICACION   ✅ SOLO LEE   -> `fuera_de_regla` debe dar 0
-- ════════════════════════════════════════════════════════════════════════════
-- Corrido el 19-ago-2026: 89 · 89 · 0 · 1068.00 · 534.00
select count(*)                                                       as rondas_sos,
       count(*) filter (where r.day_hours = 12 and r.night_hours = 6) as en_12_y_6,
       count(*) filter (where r.day_hours <> 12 or r.night_hours <> 6) as fuera_de_regla,
       sum(r.day_hours)   as total_dia,
       sum(r.night_hours) as total_noche
  from public.machine_rounds r
 where r.round_date = '2026-08-18'
   and (lower(trim(coalesce(r.inspector_day,   ''))) = 'inspector sos la guaira'
     or lower(trim(coalesce(r.inspector_night, ''))) = 'inspector sos la guaira');


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 · DESHACER   (deja todo exactamente como estaba)
-- ════════════════════════════════════════════════════════════════════════════
-- update public.machine_rounds r
--    set day_hours = b.day_hours, night_hours = b.night_hours,
--        declared_day = b.declared_day, declared_night = b.declared_night,
--        status = b.status
--   from public.bkp_sos_18ago_20260819 b
--  where r.id = b.id;
-- delete from public.machine_work_segments
--  where source = 'ajuste_manual' and round_date = '2026-08-18'
--    and notes like '%jornada SOS La Guaira%(18-ago-2026)';
