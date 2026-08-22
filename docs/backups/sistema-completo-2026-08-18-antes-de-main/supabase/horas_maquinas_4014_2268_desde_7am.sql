-- ============================================================================
-- Máquinas que TERMINAN EN 4014 y 2268: trabajando desde las 7:00am (hoy).
-- Pedido del cliente (13-ago-2026): "están trabajando desde las 7am, colócale
-- las horas". Se abre su jornada de DÍA con inicio 7:00am (hora Caracas) para que:
--   • el TELÉFONO del inspector la muestre en curso (horas en vivo, tope 12h),
--   • el REPORTE de inspectores y CONTROL de maquinaria sumen esas horas
--     automáticamente (leen day_hours + elapsed de la jornada abierta),
--   • el cron auto_close_jornadas banque 12h reales a las 7:00pm.
--
-- Además RESUELVE cualquier avería/parada PENDIENTE de esas máquinas: si quedara
-- pendiente, se arrastraría y la máquina reaparecería 🔴 AVERIADA al día siguiente
-- (mismo bug que se corrigió en la app: averiada → Volver operativa → Iniciar jornada).
--
-- Identifica por SUFIJO en serial, placa o código (…4014 / …2268).
-- Correr UNA vez en el SQL Editor de Supabase.
-- ============================================================================

with targets as (
  select id, code, serial, plate
  from public.machinery
  where trim(coalesce(serial, '')) ilike '%4014'
     or trim(coalesce(plate,  '')) ilike '%4014'
     or trim(coalesce(code,   '')) ilike '%4014'
     or trim(coalesce(serial, '')) ilike '%2268'
     or trim(coalesce(plate,  '')) ilike '%2268'
     or trim(coalesce(code,   '')) ilike '%2268'
),
-- 1) Cierra averías/paradas pendientes (para que NO se arrastren a mañana).
resueltas as (
  update public.maintenance_requests
     set status = 'realizado', resolved_at = now()
   where machinery_id in (select id from targets)
     and status = 'pendiente'
  returning machinery_id
),
-- 2) Abre la jornada de DÍA desde las 7:00am de HOY (hora Caracas).
upserted as (
  insert into public.machine_rounds
    (machinery_id, round_date, round_no, jornada_shift, jornada_start_at, jornada_marked_at, day_hours, status)
  select t.id,
         (now() at time zone 'America/Caracas')::date,
         1,
         'day',
         (((now() at time zone 'America/Caracas')::date) + time '07:00') at time zone 'America/Caracas',
         now(),
         0,
         'operativa'
  from targets t
  on conflict (machinery_id, round_date, round_no) do update
     set jornada_shift     = 'day',
         jornada_start_at  = (((excluded.round_date) + time '07:00') at time zone 'America/Caracas'),
         jornada_marked_at = now(),
         day_hours         = 0,
         status            = 'operativa'
  returning machinery_id
)
select
  (select count(*) from targets)   as maquinas_encontradas,
  (select count(*) from resueltas) as averias_cerradas,
  (select count(*) from upserted)  as jornadas_abiertas;

-- Verificación: cómo quedaron las jornadas de esas máquinas hoy.
select m.code, m.serial, m.plate,
       r.round_date, r.jornada_shift, r.jornada_start_at, r.day_hours, r.night_hours, r.status
from public.machinery m
join public.machine_rounds r
  on r.machinery_id = m.id
 and r.round_date = (now() at time zone 'America/Caracas')::date
 and r.round_no = 1
where trim(coalesce(m.serial, '')) ilike '%4014' or trim(coalesce(m.plate, '')) ilike '%4014' or trim(coalesce(m.code, '')) ilike '%4014'
   or trim(coalesce(m.serial, '')) ilike '%2268' or trim(coalesce(m.plate, '')) ilike '%2268' or trim(coalesce(m.code, '')) ilike '%2268'
order by m.code;
