-- ============================================================================
-- CLIENTE 13-ago-2026 — quitar las horas del TURNO DE NOCHE (solo 13/08/2026) a
-- las máquinas cuyo code/serial/placa TERMINA en 1166, app26 o 5020.
-- Fuente única de horas (machine_rounds + machine_work_segments): esto las deja
-- correctas en TODOS los módulos y reportes. NO toca el turno de DÍA.
-- Correr UNA vez en Supabase (SQL Editor).
-- ============================================================================

-- Filtro reutilizable: máquinas que terminan en 1166 / app26 / 5020.
-- (match por code, serial o placa; case-insensitive)

-- 1) Pone night_hours = 0; si la jornada abierta es de NOCHE la cierra
--    (jornada_start_at = null); recalcula el estado por las horas de DÍA.
update public.machine_rounds r
   set night_hours = 0,
       jornada_start_at = case when r.jornada_shift = 'night' then null else r.jornada_start_at end,
       status = case when coalesce(r.day_hours, 0) > 0 then 'operativa' else 'parada' end
 where r.round_date = date '2026-08-13'
   and r.machinery_id in (
     select m.id from public.machinery m
      where lower(coalesce(m.code,''))   like '%1166'
         or lower(coalesce(m.serial,'')) like '%1166'
         or lower(coalesce(m.plate,''))  like '%1166'
         or lower(coalesce(m.code,''))   like '%app26'
         or lower(coalesce(m.serial,'')) like '%app26'
         or lower(coalesce(m.plate,''))  like '%app26'
         or lower(coalesce(m.code,''))   like '%5020'
         or lower(coalesce(m.serial,'')) like '%5020'
         or lower(coalesce(m.plate,''))  like '%5020'
   );

-- 2) Borra los tramos de NOCHE del 13/08 de esas máquinas (para que los reportes
--    de horario/tiempo no muestren un turno de noche que no existió).
delete from public.machine_work_segments s
 where s.round_date = date '2026-08-13' and s.shift = 'night'
   and s.machinery_id in (
     select m.id from public.machinery m
      where lower(coalesce(m.code,''))   like '%1166'
         or lower(coalesce(m.serial,'')) like '%1166'
         or lower(coalesce(m.plate,''))  like '%1166'
         or lower(coalesce(m.code,''))   like '%app26'
         or lower(coalesce(m.serial,'')) like '%app26'
         or lower(coalesce(m.plate,''))  like '%app26'
         or lower(coalesce(m.code,''))   like '%5020'
         or lower(coalesce(m.serial,'')) like '%5020'
         or lower(coalesce(m.plate,''))  like '%5020'
   );

-- ── VERIFICACIÓN: las 3 máquinas deben quedar con night_hours = 0 el 13/08 ──
select m.code, m.serial, m.plate, r.day_hours, r.night_hours, r.jornada_shift, r.jornada_start_at
  from public.machine_rounds r
  join public.machinery m on m.id = r.machinery_id
 where r.round_date = date '2026-08-13'
   and ( lower(coalesce(m.code,''))   like '%1166' or lower(coalesce(m.serial,'')) like '%1166' or lower(coalesce(m.plate,'')) like '%1166'
      or lower(coalesce(m.code,''))   like '%app26' or lower(coalesce(m.serial,'')) like '%app26' or lower(coalesce(m.plate,'')) like '%app26'
      or lower(coalesce(m.code,''))   like '%5020' or lower(coalesce(m.serial,'')) like '%5020' or lower(coalesce(m.plate,'')) like '%5020' )
 order by m.code;
