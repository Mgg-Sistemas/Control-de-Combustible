-- ============================================================================
-- PONER 12 HORAS DE DÍA a las máquinas que salen ⏳ PENDIENTE teniendo tramo
--
-- Decisión del cliente (19-ago-2026): a esas máquinas se les pone la jornada de
-- DÍA completa, 12 h. (Aviso dado y aceptado: las que se pararon o averiaron a
-- media jornada tenían menos horas reales; igual se les pone 12.)
--
-- Toca SOLO las que están en 0 h de día PERO tienen un tramo de día registrado
-- en `machine_work_segments` — o sea, las que sí trabajaron y quedaron mal.
-- Nunca pisa una máquina que ya tenga horas.
--
-- CORRE LOS BLOQUES EN ORDEN. El 1 solo mira; el 2 respalda; el 3 arregla.
-- ============================================================================

-- 👉 EL DÍA QUE VAS A ARREGLAR. Cámbialo si quieres otro, o usa un rango
--    reemplazando `= '2026-08-19'` por `between '2026-08-16' and '2026-08-19'`
--    en los TRES bloques (1, 2 y 3). Tal como está, arregla solo el 19/08.


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · A CUÁLES LES VA A PEGAR   ✅ SOLO LEE
-- ════════════════════════════════════════════════════════════════════════════
select r.round_date,
       m.code                        as maquina,
       coalesce(m.plate, '—')        as placa,
       coalesce(m.serial, '—')       as serial,
       c.name                        as empresa,
       r.day_hours                   as horas_ahora,
       max(s.hours)                  as horas_del_tramo,
       12                            as horas_que_quedaran
  from public.machine_rounds r
  join public.machine_work_segments s
    on s.machinery_id = r.machinery_id and s.round_date = r.round_date and s.shift = 'day'
  join public.machinery m on m.id = r.machinery_id
  left join public.companies c on c.id = m.company_id
 where r.round_date = '2026-08-19'
   and coalesce(r.day_hours, 0) = 0
 group by r.round_date, m.code, m.plate, m.serial, c.name, r.day_hours
 order by m.code;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · RESPALDO   ⚠️ crea una tabla de respaldo (no toca datos)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.bkp_dia_12h_20260819 as
select r.id, r.machinery_id, r.round_date, r.day_hours, r.declared_day,
       r.status, r.closed, now() as respaldado_el
  from public.machine_rounds r
 where r.round_date = '2026-08-19'
   and coalesce(r.day_hours, 0) = 0
   and exists (select 1 from public.machine_work_segments s
                where s.machinery_id = r.machinery_id
                  and s.round_date = r.round_date and s.shift = 'day');

select count(*) as filas_respaldadas from public.bkp_dia_12h_20260819;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · PONERLES 12 H   ⚠️ ESTO SÍ CAMBIA LAS HORAS
-- ════════════════════════════════════════════════════════════════════════════
-- `declared_day = true` va junto: deja el turno DECLARADO para que quede
-- ✅ Finalizada y no vuelva a caer en "pendiente" con el reinicio diario.
update public.machine_rounds r
   set day_hours    = 12,
       declared_day = true
  from public.bkp_dia_12h_20260819 b
 where r.id = b.id
   and coalesce(r.day_hours, 0) = 0;      -- no pisa nada que ya tenga horas

-- Constancia en la línea de tiempo, para que no parezca que las horas
-- aparecieron solas (se ve en el visor de tramos de Control).
insert into public.machine_work_segments
  (machinery_id, round_date, shift, started_at, ended_at, hours, source, notes)
select b.machinery_id, b.round_date, 'day', now(), now(), 12,
       'ajuste_manual',
       'Corrección 19-ago-2026: el turno tenía tramo de día pero day_hours estaba en 0 (salía PENDIENTE). Se fija la jornada completa de 12 h.'
  from public.bkp_dia_12h_20260819 b;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 · VERIFICACIÓN   ✅ SOLO LEE   → `en_cero_restantes` debe dar 0
-- ════════════════════════════════════════════════════════════════════════════
select
  (select count(*) from public.bkp_dia_12h_20260819)                    as se_iban_a_corregir,
  (select count(*) from public.machine_rounds r
     join public.bkp_dia_12h_20260819 b on b.id = r.id
    where coalesce(r.day_hours,0) = 0)                                  as en_cero_restantes,
  (select sum(r.day_hours) from public.machine_rounds r
     join public.bkp_dia_12h_20260819 b on b.id = r.id)                 as horas_totales_ahora;

select m.code as maquina, coalesce(m.plate, m.serial, '—') as placa_o_serial,
       b.day_hours as antes, r.day_hours as ahora, r.declared_day
  from public.machine_rounds r
  join public.bkp_dia_12h_20260819 b on b.id = r.id
  join public.machinery m on m.id = r.machinery_id
 order by m.code;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 5 · DESHACER   (solo si hiciera falta volver atrás)
-- ════════════════════════════════════════════════════════════════════════════
-- update public.machine_rounds r
--    set day_hours = b.day_hours, declared_day = b.declared_day
--   from public.bkp_dia_12h_20260819 b
--  where r.id = b.id;
-- delete from public.machine_work_segments
--  where source = 'ajuste_manual' and notes like 'Corrección 19-ago-2026%';
