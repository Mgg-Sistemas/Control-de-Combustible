-- ============================================================================
-- FORZAR: CAMION VOLTEO TORONTO (serial WL50ZLJHFC39) TRABAJÓ HOY 12 h de DÍA
-- (7am–7pm) y el INSPECTOR DE DÍA CERRÓ su jornada.
--
-- Pedido del cliente (18-ago-2026): esta unidad sale 🟡 PARADA ("NO TRABAJÓ · NO
-- ESTÁ EN PATIO"); debe verse TRABAJÓ 12 h (7am–7pm) en TODOS los reportes, en
-- Control y en Inspecciones, con la jornada de día CERRADA por su inspector.
-- Aunque todavía no son las 7pm, se banca la jornada completa igual (regla cliente).
--
-- Qué hace (idempotente, seguro de re-correr):
--   1. Resuelve el/los ticket(s) de PARADA pendientes de ESTA máquina (deja de salir parada).
--   2. Deja la ronda de HOY en 12 h de día, DECLARADA, CERRADA (jornada_start_at=null),
--      status 'operativa', atribuida al inspector de día. Si no existe, la crea.
--   3. Escribe el tramo trabajado 7am→7pm (12 h) con source 'manual_finish' (= el
--      inspector cerró), si no hay ya un tramo de día hoy.
--
-- NO toca otras máquinas. Afecta el PAGO del día de esta unidad (12 h).
-- Correr en Supabase → SQL Editor.
-- ============================================================================
set time zone 'America/Caracas';

-- ── 0) PREVIEW — confirma la máquina y el inspector de día ANTES de aplicar ──
select m.id as machinery_id, m.code, m.serial, m.plate,
       (select p.full_name from public.profiles p
         where translate(upper(p.full_name),'ÁÉÍÓÚ','AEIOU') like '%ANGELO%VAZQUEZ%'
         limit 1) as inspector_dia_detectado
from public.machinery m
where lower(trim(m.serial)) = lower('WL50ZLJHFC39');

-- ── 1) Resolver la(s) parada(s)/avería-marcador pendientes de esta máquina ──
--     (el marcador "MÁQUINA PARADA / NO TRABAJÓ" es lo que la pinta 🟡 PARADA).
update public.maintenance_requests mr
   set status = 'realizado', resolved_at = now()
 where mr.machinery_id = (select id from public.machinery
                          where lower(trim(serial)) = lower('WL50ZLJHFC39'))
   and mr.status = 'pendiente'
   and mr.material = 'MÁQUINA PARADA';

-- ── 2a) Actualizar la ronda de HOY si ya existe: 12 h día, declarada, CERRADA ──
update public.machine_rounds r
   set day_hours       = 12,
       night_hours     = coalesce(r.night_hours, 0),
       hours_stopped   = 0,
       jornada_shift   = 'day',
       declared_day    = true,
       jornada_start_at = null,                 -- CERRADA (bancada), no en curso
       status          = 'operativa',
       jornada_marked_by = coalesce(r.jornada_marked_by,
                            (select p.id from public.profiles p
                              where translate(upper(p.full_name),'ÁÉÍÓÚ','AEIOU') like '%ANGELO%VAZQUEZ%' limit 1)),
       recorded_by     = coalesce(r.recorded_by,
                            (select p.id from public.profiles p
                              where translate(upper(p.full_name),'ÁÉÍÓÚ','AEIOU') like '%ANGELO%VAZQUEZ%' limit 1))
 where r.machinery_id = (select id from public.machinery
                         where lower(trim(serial)) = lower('WL50ZLJHFC39'))
   and r.round_date = (now() at time zone 'America/Caracas')::date;

-- ── 2b) Crear la ronda de HOY si NO existía ninguna ──
insert into public.machine_rounds
  (machinery_id, round_date, round_no, status, day_hours, night_hours, hours_stopped,
   overtime_hours, jornada_shift, declared_day, jornada_start_at, recorded_by, jornada_marked_by)
select mm.id, (now() at time zone 'America/Caracas')::date, 1, 'operativa', 12, 0, 0,
       0, 'day', true, null, insp.id, insp.id
from public.machinery mm
left join lateral (select p.id from public.profiles p
                    where translate(upper(p.full_name),'ÁÉÍÓÚ','AEIOU') like '%ANGELO%VAZQUEZ%' limit 1) insp on true
where lower(trim(mm.serial)) = lower('WL50ZLJHFC39')
  and not exists (select 1 from public.machine_rounds r
                  where r.machinery_id = mm.id
                    and r.round_date = (now() at time zone 'America/Caracas')::date);

-- ── 3) Tramo trabajado 7am→7pm (12 h), como cierre manual del inspector ──
insert into public.machine_work_segments
  (machinery_id, round_date, shift, started_at, ended_at, hours, source, recorded_by)
select r.machinery_id, r.round_date, 'day',
       (r.round_date + time '07:00') at time zone 'America/Caracas',
       (r.round_date + time '19:00') at time zone 'America/Caracas',
       12, 'manual_finish', r.recorded_by
from public.machine_rounds r
where r.machinery_id = (select id from public.machinery
                        where lower(trim(serial)) = lower('WL50ZLJHFC39'))
  and r.round_date = (now() at time zone 'America/Caracas')::date
  and r.day_hours = 12
  and not exists (select 1 from public.machine_work_segments s
                  where s.machinery_id = r.machinery_id
                    and s.round_date = r.round_date and s.shift = 'day');

-- ── 4) VERIFICACIÓN — debe salir day_hours=12, jornada_start_at NULL, sin parada ──
select m.code, m.serial,
       r.round_date, r.day_hours, r.night_hours, r.jornada_shift,
       r.declared_day, r.jornada_start_at, r.status,
       (select count(*) from public.maintenance_requests mr
         where mr.machinery_id = m.id and mr.status = 'pendiente'
           and mr.material = 'MÁQUINA PARADA') as paradas_pendientes,
       (select count(*) from public.machine_work_segments s
         where s.machinery_id = m.id and s.round_date = r.round_date and s.shift = 'day') as tramos_dia
from public.machinery m
join public.machine_rounds r on r.machinery_id = m.id
 and r.round_date = (now() at time zone 'America/Caracas')::date
where lower(trim(m.serial)) = lower('WL50ZLJHFC39');
