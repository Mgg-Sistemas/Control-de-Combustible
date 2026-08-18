-- ============================================================================
-- AUDITORÍA DE JORNADAS — registrar SOLO lo que hace una persona (18-ago-2026)
--
-- PROBLEMA: `trg_audit` sobre `machine_rounds` está APAGADO (tgenabled='D') desde el
-- 09-ago-2026. Se apagó por una razón buena: los crons escriben esa tabla cada 10
-- minutos por cada una de las ~173 máquinas, y cada escritura generaba una fila de
-- bitácora — entre 15 y 20 mil al día. En un compute Nano/Micro eso tumbó el sistema
-- (ver la cabecera de `audit_perf_indexes.sql`, del mismo día).
--
-- CONSECUENCIA VIVA: desde entonces NINGÚN cambio de horas de jornada deja rastro. La
-- última jornada registrada en `audit_log` es del 09-ago-2026 14:50. Cuando alguien
-- reclama un pago, no hay a quién señalar. Fue también lo que impidió saber quién creó
-- las 20 rondas con fecha futura del 17-ago-2026.
--
-- LA SALIDA: no volver a encender `trg_audit`, sino poner un trigger HERMANO que solo
-- dispare cuando hay una PERSONA detrás — `auth.uid() is not null`. Los crons corren
-- por pg_cron sin sesión, así que `auth.uid()` les da NULL y no escriben ni una fila.
-- Se conserva exactamente lo que importa (quién tocó las horas a mano) y se descarta
-- el 95% del volumen, que es justo el que causó la caída.
--
-- ⚠️ NO TOCA NI UN SOLO REGISTRO EXISTENTE. No modifica horas, jornadas ni pagos: solo
--    agrega un vigilante para lo que pase DE AQUÍ EN ADELANTE. Es reversible con una
--    línea (ver el final).
--
-- Correr los bloques EN ORDEN, uno por uno.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 1 · CÓMO ESTÁ AHORA  (solo lectura, no cambia nada)
-- ════════════════════════════════════════════════════════════════════════════
-- Debe mostrar trg_audit = 'D' (apagado) y la última jornada registrada en agosto.
select
  (select tgenabled from pg_trigger
    where tgrelid = 'public.machine_rounds'::regclass and tgname = 'trg_audit')      as trg_audit_viejo,
  (select count(*) from public.audit_log where table_name = 'machine_rounds')        as jornadas_en_bitacora,
  ((select max(at) from public.audit_log where table_name = 'machine_rounds')
     at time zone 'America/Caracas')                                                 as ultima_jornada_registrada,
  (select count(*) from public.audit_log)                                            as bitacora_total;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 2 · EL VIGILANTE SELECTIVO   ⚠️ ESTO SÍ ESCRIBE (crea un trigger)
-- ════════════════════════════════════════════════════════════════════════════
-- `when (auth.uid() is not null)` es la clave: pg_cron no tiene sesión, así que sus
-- escrituras no pasan el filtro y no generan bitácora. Idempotente: se puede correr
-- más de una vez sin duplicar nada.
--
-- Se deja `trg_audit` APAGADO a propósito (no se toca): si algún día se enciende por
-- error, este hermano seguirá funcionando igual y no habrá filas duplicadas, porque
-- son dos triggers distintos con nombres distintos — pero conviene no encenderlo.
drop trigger if exists trg_audit_humano on public.machine_rounds;
create trigger trg_audit_humano
  after insert or update or delete on public.machine_rounds
  for each row
  when (auth.uid() is not null)
  execute function public.audit_row();


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 3 · COMPROBAR QUE QUEDÓ PUESTO  (solo lectura)
-- ════════════════════════════════════════════════════════════════════════════
-- Debe devolver una fila: trg_audit_humano con tgenabled = 'O' (activo).
select tgname, tgenabled
  from pg_trigger
 where tgrelid = 'public.machine_rounds'::regclass
   and not tgisinternal
 order by tgname;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 4 · COMPROBAR QUE FUNCIONA Y QUE NO INUNDA  (solo lectura)
-- ════════════════════════════════════════════════════════════════════════════
-- Correr MAÑANA, después de un día normal de uso. Lo que se espera:
--   · `jornadas_hoy` con un número BAJO (decenas, no miles) → el filtro funciona.
--   · `sin_persona` en 0 → si sale >0, algún cron sí tiene sesión y habría que revisar.
-- Si `jornadas_hoy` se dispara a miles, apagarlo con el bloque 5 y avisar.
select
  count(*)                                                    as jornadas_hoy,
  count(*) filter (where user_id is null)                     as sin_persona,
  count(distinct user_name)                                   as personas_distintas,
  min(at) at time zone 'America/Caracas'                      as primera,
  max(at) at time zone 'America/Caracas'                      as ultima
  from public.audit_log
 where table_name = 'machine_rounds'
   and at >= current_date;


-- ════════════════════════════════════════════════════════════════════════════
-- BLOQUE 5 · DESHACER  (solo si hace falta)
-- ════════════════════════════════════════════════════════════════════════════
-- Quita el vigilante y deja todo exactamente como estaba. No borra la bitácora ya
-- escrita ni toca ningún registro de jornadas.
--
-- drop trigger if exists trg_audit_humano on public.machine_rounds;
