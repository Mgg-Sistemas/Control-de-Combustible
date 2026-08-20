-- ============================================================================
-- RECUPERAR las horas de DÍA que borró el botón «🟡 PARADA · NO TRABAJÓ»
--
-- EL BUG (arreglado el 19-ago-2026 en SupervisorScreen.marcarParadaNoTrabajo): el
-- inspector de NOCHE marcaba "no trabajó" a partir de las 7pm y la app anulaba las
-- horas del turno de DÍA de su compañero, porque el turno se tomaba de
-- `machine_rounds.jornada_shift` (que después de las 7pm todavía decía 'day') en vez
-- de la hora real.
--
-- DE DÓNDE SE RECUPERA CADA TRAMO DE FECHAS:
--   · 18-ago en adelante → de `audit_log.changes`, que guarda el "de → a" exacto.
--     (El trigger `trg_audit_humano` está activo desde el 18-ago-2026.)
--   · 10, 11 y 12-ago     → de los tramos `no_trabajo_correction`, que guardan las
--     horas anuladas en negativo.
--   · ⚠️ 13 al 17-ago     → NO SE PUEDE recuperar automáticamente. En ese tramo el
--     CHECK de `machine_work_segments.source` ya rechazaba 'no_trabajo_correction'
--     (ver supabase/machine_segments_source_check.sql) y el trigger de auditoría
--     todavía no estaba encendido: el borrado no dejó rastro por ningún lado.
--     Si hace falta, se reconstruye a mano comparando con el reporte por empresa.
--
-- SOLO toca rondas que HOY siguen en 0 h de día: si ya se corrigieron (a mano o con
-- otro script), no las pisa.
--
-- ⚠️ ESTO SUBE HORAS → sube facturación. BLOQUE 1 (lee) → revisar → BLOQUE 2
--    (respalda) → BLOQUE 3 (aplica) → BLOQUE 4 (verifica). El BLOQUE 5 deshace.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · QUÉ SE VA A RECUPERAR   ✅ SOLO LEE
-- ════════════════════════════════════════════════════════════════════════════
-- `origen` dice de dónde sale el número: 'auditoría' (exacto) o 'tramo negativo'.
-- Se filtra a borrados hechos en HORAS DE NOCHE (19:00–06:59 Caracas), que es
-- justamente el caso del turno equivocado. Un "no trabajó" marcado de día (7am–7pm)
-- sobre el turno de día es LEGÍTIMO y NO se toca.
with desde_auditoria as (
  select distinct on (a.row_id)
         a.row_id::uuid                              as round_id,
         (a.changes -> 'day_hours' ->> 'de')::numeric as horas_de,
         a.user_name, a.at, 'auditoría'::text         as origen
    from public.audit_log a
   where a.table_name = 'machine_rounds'
     and a.changes ? 'day_hours'
     and (a.changes -> 'day_hours' ->> 'a')::numeric  = 0
     and (a.changes -> 'day_hours' ->> 'de')::numeric > 0
     and extract(hour from (a.at at time zone 'America/Caracas')) not between 7 and 18
   order by a.row_id, a.at desc
),
desde_tramos as (
  select r.id                       as round_id,
         abs(s.hours)::numeric      as horas_de,
         null::text                 as user_name,
         s.created_at               as at,
         'tramo negativo'::text     as origen
    from public.machine_work_segments s
    join public.machine_rounds r
      on r.machinery_id = s.machinery_id and r.round_date = s.round_date and r.round_no = 1
   where s.source = 'no_trabajo_correction'
     and s.shift  = 'day'
     and s.hours  < 0
     and extract(hour from (s.created_at at time zone 'America/Caracas')) not between 7 and 18
),
todo as (
  select * from desde_auditoria
  union all
  select t.* from desde_tramos t
   where not exists (select 1 from desde_auditoria d where d.round_id = t.round_id)
)
select m.code                              as maquina,
       coalesce(m.plate, m.serial, '—')    as placa_o_serial,
       c.name                              as empresa,
       r.round_date,
       r.day_hours                         as dia_ahora,
       t.horas_de                          as dia_a_devolver,
       t.origen,
       coalesce(t.user_name, '—')          as quien_lo_borro,
       (t.at at time zone 'America/Caracas') as cuando
  from todo t
  join public.machine_rounds r on r.id = t.round_id
  join public.machinery m on m.id = r.machinery_id
  left join public.companies c on c.id = m.company_id
 where coalesce(r.day_hours, 0) = 0        -- solo las que SIGUEN en cero
 order by r.round_date desc, m.code;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · RESPALDO   ⚠️ ESCRIBE (crea la tabla de trabajo; no toca datos)
-- ════════════════════════════════════════════════════════════════════════════
-- Guarda las filas a corregir Y las horas a devolver, para que el bloque 3 no
-- tenga que recalcular nada y el bloque 5 pueda revertir exactamente.
create table if not exists public.bkp_recuperar_dia_no_trabajo as
with desde_auditoria as (
  select distinct on (a.row_id)
         a.row_id::uuid                              as round_id,
         (a.changes -> 'day_hours' ->> 'de')::numeric as horas_de,
         a.user_name, a.at, 'auditoría'::text         as origen
    from public.audit_log a
   where a.table_name = 'machine_rounds'
     and a.changes ? 'day_hours'
     and (a.changes -> 'day_hours' ->> 'a')::numeric  = 0
     and (a.changes -> 'day_hours' ->> 'de')::numeric > 0
     and extract(hour from (a.at at time zone 'America/Caracas')) not between 7 and 18
   order by a.row_id, a.at desc
),
desde_tramos as (
  select r.id, abs(s.hours)::numeric, null::text, s.created_at, 'tramo negativo'::text
    from public.machine_work_segments s
    join public.machine_rounds r
      on r.machinery_id = s.machinery_id and r.round_date = s.round_date and r.round_no = 1
   where s.source = 'no_trabajo_correction' and s.shift = 'day' and s.hours < 0
     and extract(hour from (s.created_at at time zone 'America/Caracas')) not between 7 and 18
),
todo as (
  select * from desde_auditoria
  union all
  select t.* from desde_tramos t
   where not exists (select 1 from desde_auditoria d where d.round_id = t.id)
)
select r.id, r.machinery_id, r.round_date,
       r.day_hours as day_hours_antes, r.declared_day as declared_day_antes, r.status as status_antes,
       t.horas_de  as day_hours_a_devolver, t.origen, t.user_name as borrado_por, t.at as borrado_el,
       now() as respaldado_el
  from todo t
  join public.machine_rounds r on r.id = t.round_id
 where coalesce(r.day_hours, 0) = 0;

select count(*) as rondas_a_recuperar,
       round(sum(day_hours_a_devolver), 2) as horas_a_devolver,
       min(round_date) as desde, max(round_date) as hasta
  from public.bkp_recuperar_dia_no_trabajo;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · DEVOLVER LAS HORAS   ⚠️ ESTO SÍ CAMBIA LAS HORAS
-- ════════════════════════════════════════════════════════════════════════════
update public.machine_rounds r
   set day_hours    = b.day_hours_a_devolver,
       declared_day = true,
       status       = 'operativa'
  from public.bkp_recuperar_dia_no_trabajo b
 where r.id = b.id
   and coalesce(r.day_hours, 0) = 0;        -- no pisa nada que ya tenga horas

-- Rastro del rescate en la línea de tiempo.
insert into public.machine_work_segments
  (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
select b.machinery_id, b.round_date, 'day', now(), now(), b.day_hours_a_devolver,
       'ajuste_manual',
       'Recuperación 19-ago-2026: ' || b.day_hours_a_devolver ||
       'h de día que borró "NO TRABAJÓ" marcado en horas de noche (turno equivocado)' ||
       coalesce(' · borradas por ' || b.borrado_por, '') || ' · origen: ' || b.origen
  from public.bkp_recuperar_dia_no_trabajo b;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 · VERIFICACIÓN   ✅ SOLO LEE   → `siguen_en_cero` debe dar 0
-- ════════════════════════════════════════════════════════════════════════════
select count(*)                                                        as se_iban_a_recuperar,
       count(*) filter (where coalesce(r.day_hours,0) = 0)             as siguen_en_cero,
       round(sum(r.day_hours), 2)                                      as total_dia_ahora
  from public.machine_rounds r
  join public.bkp_recuperar_dia_no_trabajo b on b.id = r.id;

select m.code as maquina, coalesce(m.plate, m.serial, '—') as placa_o_serial,
       r.round_date, b.day_hours_antes as antes, r.day_hours as ahora, b.borrado_por
  from public.machine_rounds r
  join public.bkp_recuperar_dia_no_trabajo b on b.id = r.id
  join public.machinery m on m.id = r.machinery_id
 order by r.round_date desc, m.code;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 5 · DESHACER
-- ════════════════════════════════════════════════════════════════════════════
-- update public.machine_rounds r
--    set day_hours = b.day_hours_antes, declared_day = b.declared_day_antes, status = b.status_antes
--   from public.bkp_recuperar_dia_no_trabajo b
--  where r.id = b.id;
-- delete from public.machine_work_segments
--  where source = 'ajuste_manual' and notes like 'Recuperación 19-ago-2026:%';
