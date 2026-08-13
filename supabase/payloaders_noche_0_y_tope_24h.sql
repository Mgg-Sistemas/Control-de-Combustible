-- ============================================================================
-- CLIENTE 13-ago-2026 — correcciones sobre machine_rounds / machine_work_segments
-- (fuente ÚNICA de horas: de aquí leen TODOS los módulos y reportes):
--
--   1) NOCHE del 12/08/2026 — de los PAYLOADER, SOLO trabajaron dos:
--        • el que termina en '1166'   → 6h de noche
--        • el 'app26'                  → 6h de noche
--      TODOS los demás payloader NO trabajaron → 0. Al ser la fuente, esto los
--      deja correctos "en todos lados" (módulos y reportes).
--
--   2) TOPE DIARIO 24H: NINGUNA máquina puede acumular más de 24h en un round.
--      - día  ≤ 12h  (el turno de día dura 12h)
--      - noche ≤ 12h (salvo el COMPRESOR CON MARTILLO serial/placa '79669', que
--        trabaja 24h continuas y es el ÚNICO con trato especial)
--      - total (día+noche) ≤ 24h SIEMPRE → jamás 24,5h ni 25h.
--
-- PAYLOADER se detecta igual que src/lib/tariffs.ts: code|tipo|machinery_type
-- contiene 'payload' | 'paylo' | 'cargador'.
-- Correr UNA vez en Supabase (SQL Editor). MCP caído.
-- ============================================================================

-- ── 1a) Los DOS payloader que SÍ trabajaron (…1166 y app26) → 6h de noche ────
-- actualiza el round de esa noche si ya existe
update public.machine_rounds r
   set night_hours = 6,
       status = 'operativa',
       jornada_start_at = case when r.jornada_shift = 'night' then null else r.jornada_start_at end
 where r.round_date = date '2026-08-12'
   and r.machinery_id in (
     select m.id from public.machinery m
     where ( lower(coalesce(m.code,''))           like '%payload%'
          or lower(coalesce(m.code,''))           like '%paylo%'
          or lower(coalesce(m.code,''))           like '%cargador%'
          or lower(coalesce(m.tipo,''))           like '%payload%'
          or lower(coalesce(m.tipo,''))           like '%cargador%'
          or lower(coalesce(m.machinery_type,'')) like '%payload%'
          or lower(coalesce(m.machinery_type,'')) like '%cargador%' )
       and ( lower(coalesce(m.code,''))   like '%1166'
          or lower(coalesce(m.serial,'')) like '%1166'
          or lower(coalesce(m.plate,''))  like '%1166'
          or lower(coalesce(m.code,''))   like '%app26%'
          or lower(coalesce(m.serial,'')) like '%app26%'
          or lower(coalesce(m.plate,''))  like '%app26%' )
   );

-- si no tenían round para esa noche, se crea con las 6h
insert into public.machine_rounds (machinery_id, round_date, jornada_shift, night_hours, status)
select m.id, date '2026-08-12', 'night', 6, 'operativa'
  from public.machinery m
 where ( lower(coalesce(m.code,''))           like '%payload%'
      or lower(coalesce(m.code,''))           like '%paylo%'
      or lower(coalesce(m.code,''))           like '%cargador%'
      or lower(coalesce(m.tipo,''))           like '%payload%'
      or lower(coalesce(m.tipo,''))           like '%cargador%'
      or lower(coalesce(m.machinery_type,'')) like '%payload%'
      or lower(coalesce(m.machinery_type,'')) like '%cargador%' )
   and ( lower(coalesce(m.code,''))   like '%1166'
      or lower(coalesce(m.serial,'')) like '%1166'
      or lower(coalesce(m.plate,''))  like '%1166'
      or lower(coalesce(m.code,''))   like '%app26%'
      or lower(coalesce(m.serial,'')) like '%app26%'
      or lower(coalesce(m.plate,''))  like '%app26%' )
   and not exists (
     select 1 from public.machine_rounds r
      where r.machinery_id = m.id and r.round_date = date '2026-08-12'
   );

-- segmento de 6h (19:00→01:00 Caracas) para esos dos, coherente con los reportes
delete from public.machine_work_segments s
 where s.round_date = date '2026-08-12' and s.shift = 'night'
   and s.machinery_id in (
     select m.id from public.machinery m
     where ( lower(coalesce(m.code,''))   like '%1166'
          or lower(coalesce(m.serial,'')) like '%1166'
          or lower(coalesce(m.plate,''))  like '%1166'
          or lower(coalesce(m.code,''))   like '%app26%'
          or lower(coalesce(m.serial,'')) like '%app26%'
          or lower(coalesce(m.plate,''))  like '%app26%' )
   );

insert into public.machine_work_segments (machinery_id, round_date, shift, started_at, ended_at, hours, source)
select m.id, date '2026-08-12', 'night',
       (date '2026-08-12' + time '19:00') at time zone 'America/Caracas',
       (date '2026-08-13' + time '01:00') at time zone 'America/Caracas',
       6, 'ajuste_manual'
  from public.machinery m
 where ( lower(coalesce(m.code,''))           like '%payload%'
      or lower(coalesce(m.code,''))           like '%paylo%'
      or lower(coalesce(m.code,''))           like '%cargador%'
      or lower(coalesce(m.tipo,''))           like '%payload%'
      or lower(coalesce(m.tipo,''))           like '%cargador%'
      or lower(coalesce(m.machinery_type,'')) like '%payload%'
      or lower(coalesce(m.machinery_type,'')) like '%cargador%' )
   and ( lower(coalesce(m.code,''))   like '%1166'
      or lower(coalesce(m.serial,'')) like '%1166'
      or lower(coalesce(m.plate,''))  like '%1166'
      or lower(coalesce(m.code,''))   like '%app26%'
      or lower(coalesce(m.serial,'')) like '%app26%'
      or lower(coalesce(m.plate,''))  like '%app26%' );

-- ── 1b) El RESTO de payloader (no …1166 ni app26) → NOCHE 12/08 en 0 ─────────
update public.machine_rounds r
   set night_hours = 0,
       jornada_start_at = case when r.jornada_shift = 'night' then null else r.jornada_start_at end,
       status = 'operativa'
 where r.round_date = date '2026-08-12'
   and r.machinery_id in (
     select m.id from public.machinery m
     where ( lower(coalesce(m.code,''))           like '%payload%'
          or lower(coalesce(m.code,''))           like '%paylo%'
          or lower(coalesce(m.code,''))           like '%cargador%'
          or lower(coalesce(m.tipo,''))           like '%payload%'
          or lower(coalesce(m.tipo,''))           like '%cargador%'
          or lower(coalesce(m.machinery_type,'')) like '%payload%'
          or lower(coalesce(m.machinery_type,'')) like '%cargador%' )
       and not ( lower(coalesce(m.code,''))   like '%1166'
              or lower(coalesce(m.serial,'')) like '%1166'
              or lower(coalesce(m.plate,''))  like '%1166'
              or lower(coalesce(m.code,''))   like '%app26%'
              or lower(coalesce(m.serial,'')) like '%app26%'
              or lower(coalesce(m.plate,''))  like '%app26%' )
   );

delete from public.machine_work_segments s
 where s.round_date = date '2026-08-12' and s.shift = 'night'
   and s.machinery_id in (
     select m.id from public.machinery m
     where ( lower(coalesce(m.code,''))           like '%payload%'
          or lower(coalesce(m.code,''))           like '%paylo%'
          or lower(coalesce(m.code,''))           like '%cargador%'
          or lower(coalesce(m.tipo,''))           like '%payload%'
          or lower(coalesce(m.tipo,''))           like '%cargador%'
          or lower(coalesce(m.machinery_type,'')) like '%payload%'
          or lower(coalesce(m.machinery_type,'')) like '%cargador%' )
       and not ( lower(coalesce(m.code,''))   like '%1166'
              or lower(coalesce(m.serial,'')) like '%1166'
              or lower(coalesce(m.plate,''))  like '%1166'
              or lower(coalesce(m.code,''))   like '%app26%'
              or lower(coalesce(m.serial,'')) like '%app26%'
              or lower(coalesce(m.plate,''))  like '%app26%' )
   );

-- ── 2) TOPE DIARIO 24H (backfill sobre TODO el histórico) ───────────────────
-- 2a) día ≤ 12h
update public.machine_rounds
   set day_hours = 12
 where coalesce(day_hours, 0) > 12;

-- 2b) noche ≤ 12h — EXCEPTO el compresor 79669 (24h continuas)
update public.machine_rounds r
   set night_hours = 12
  from public.machinery m
 where m.id = r.machinery_id
   and coalesce(r.night_hours, 0) > 12
   and trim(coalesce(m.serial, '')) <> '79669'
   and trim(coalesce(m.plate,  '')) <> '79669';

-- 2c) total (día+noche) ≤ 24h — recorta la noche; cubre también al 79669 si se pasara
update public.machine_rounds
   set night_hours = greatest(0, 24 - least(coalesce(day_hours, 0), 24))
 where coalesce(day_hours, 0) + coalesce(night_hours, 0) > 24;

-- ── VERIFICACIÓN ────────────────────────────────────────────────────────────
-- a) ninguna máquina con más de 24h en un día (debe volver VACÍO):
select m.code, r.round_date, r.day_hours, r.night_hours,
       coalesce(r.day_hours,0) + coalesce(r.night_hours,0) as total
  from public.machine_rounds r
  join public.machinery m on m.id = r.machinery_id
 where coalesce(r.day_hours,0) + coalesce(r.night_hours,0) > 24
 order by total desc;

-- b) payloaders del 12/08: solo …1166 y app26 con 6h, el resto en 0:
select m.code, m.serial, m.plate, r.night_hours
  from public.machine_rounds r
  join public.machinery m on m.id = r.machinery_id
 where r.round_date = date '2026-08-12'
   and ( lower(coalesce(m.code,''))           like '%payload%'
      or lower(coalesce(m.code,''))           like '%paylo%'
      or lower(coalesce(m.code,''))           like '%cargador%'
      or lower(coalesce(m.tipo,''))           like '%payload%'
      or lower(coalesce(m.tipo,''))           like '%cargador%'
      or lower(coalesce(m.machinery_type,'')) like '%payload%'
      or lower(coalesce(m.machinery_type,'')) like '%cargador%' )
 order by r.night_hours desc, m.code;
