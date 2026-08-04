-- ============================================================================
-- ASIGNAR LAS MÁQUINAS SIN INSPECTOR AL CAJÓN "MAQUINAS FALTANTES"
-- (día Y noche) — corrida MANUAL de una sola vez desde Supabase → SQL Editor.
-- ----------------------------------------------------------------------------
-- QUÉ HACE: por cada máquina ACTIVA y cada turno (día/noche) que HOY no tenga
-- NINGUNA fila en machine_inspectors, crea la asignación al usuario virtual de
-- sistema "MAQUINAS FALTANTES". Así cada máquina huérfana queda cubierta en
-- AMBOS turnos, SALVO el turno donde ya exista un inspector (real o el propio
-- cajón): ese turno NO se toca.
--
-- ⚠️ NOMBRE/ID DEL CAJÓN — VERIFICADOS CONTRA LOS DATOS REALES (machine_inspectors):
-- las 143 filas actuales del cajón usan inspector_name = 'inspector maquinas
-- faltantes' (en minúsculas; la app lo muestra en mayúsculas) e inspector_id =
-- '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'. Se usan ESOS valores EXACTOS para que
-- las nuevas asignaciones caigan en el MISMO cajón que ya ve la app (dashboard /
-- pestaña "Resumen"), y NO en uno duplicado. (Nota: los .sql antiguos
-- maquinas_faltantes.sql mencionan otro usuario 00000000-…-fa1a que NO es el que
-- está en uso; por eso NO se usa aquí.)
--
-- Es EXACTAMENTE lo mismo que hace el cron public.assign_missing_to_placeholder()
-- cada 15 min (ver supabase/maquinas_faltantes.sql). Este archivo lo ejecuta a
-- mano YA, sin esperar al cron, y con RESPALDO + PREVIEW antes del INSERT.
--
-- DEFINICIONES USADAS (confirmadas en el repo):
--   • Máquina "activa"  = machinery.active=true AND operational=true AND
--                         en_espera=false   (mismo filtro que el cron real).
--   • "Sin inspector"   = NO existe fila en machine_inspectors para ese
--                         (machinery_id, shift). Es el caso estricto "sin nadie"
--                         (ni humano ni el cajón). unassignInspector() BORRA la
--                         fila (no la desactiva), por eso basta con "no existe".
--   • Antiduplicados    = índice único mi_machine_shift_key (machinery_id, shift).
--                         Se usa `not exists` + `on conflict (machinery_id, shift)
--                         do nothing`: nunca pisa ni duplica una asignación.
--
-- ⚠️ IMPACTA horómetro, alertas de mantenimiento y NÓMINA: una vez asignada al
-- cajón, esa máquina empieza a acumular horas automáticas (12h día / 6h noche;
-- volqueta/toronto 12h/12h) vía el cron auto_full_shift_placeholder().
--
-- ORDEN PARA CORRER (recomendado): primero el bloque 1 (RESPALDO) y el bloque 2
-- (PREVIEW, no cambia nada) para ver qué y cuántas se van a asignar. Si estás
-- conforme, corre el bloque 3 (INSERT) y luego el bloque 4 (VERIFICACIÓN).
-- Todo el archivo es idempotente: volver a correrlo no duplica nada.
-- ============================================================================

-- Nombre y UUID EXACTOS del cajón (verificados contra machine_inspectors). NO CAMBIAR:
--   inspector_id   = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'
--   inspector_name = 'inspector maquinas faltantes'

-- ----------------------------------------------------------------------------
-- 1) RESPALDO de la tabla completa (es chica) antes de tocar nada.
-- ----------------------------------------------------------------------------
create table if not exists public.backup_asignar_faltantes_20260804 as
select * from public.machine_inspectors;

-- ----------------------------------------------------------------------------
-- 2) PREVIEW (NO cambia nada): lista las máquinas ACTIVAS que quedarían
--    asignadas al cajón, con turno faltante, code/placa/empresa. Revisa el
--    total antes de correr el INSERT.
-- ----------------------------------------------------------------------------
select
  mch.code                                as maquina,
  mch.plate                               as placa,
  mch.serial                              as serial,
  coalesce(co.name, 'Sin empresa')        as empresa,
  shifts.sh                               as turno_a_asignar
from public.machinery mch
cross join (values ('day'), ('night')) as shifts(sh)
left join public.companies co on co.id = mch.company_id
where mch.active = true
  and mch.operational = true
  and mch.en_espera = false
  and not exists (
    select 1 from public.machine_inspectors mi
    where mi.machinery_id = mch.id and mi.shift = shifts.sh
  )
order by mch.code, shifts.sh;

-- Conteo rápido de cuántas asignaciones creará el INSERT (por turno):
select shifts.sh as turno, count(*) as maquinas_a_asignar
from public.machinery mch
cross join (values ('day'), ('night')) as shifts(sh)
where mch.active = true and mch.operational = true and mch.en_espera = false
  and not exists (
    select 1 from public.machine_inspectors mi
    where mi.machinery_id = mch.id and mi.shift = shifts.sh
  )
group by shifts.sh
order by shifts.sh;

-- ----------------------------------------------------------------------------
-- 3) INSERT (EJECUTABLE): asigna al cajón "MAQUINAS FALTANTES" cada turno
--    (día y noche) que esté sin ninguna fila. El `not exists` respeta las
--    asignaciones ya existentes (reales o del propio cajón); el `on conflict`
--    sobre (machinery_id, shift) es el segundo candado antiduplicados.
-- ----------------------------------------------------------------------------
insert into public.machine_inspectors (machinery_id, inspector_id, inspector_name, shift, active, assigned_at)
select mch.id,
       '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'::uuid,
       'inspector maquinas faltantes',
       shifts.sh,
       true,
       now()
from public.machinery mch
cross join (values ('day'), ('night')) as shifts(sh)
where mch.active = true
  and mch.operational = true
  and mch.en_espera = false
  and not exists (
    select 1 from public.machine_inspectors mi
    where mi.machinery_id = mch.id and mi.shift = shifts.sh
  )
on conflict (machinery_id, shift) do nothing;

-- ----------------------------------------------------------------------------
-- 4) VERIFICACIÓN: cuántas máquinas activas quedan SIN inspector por turno.
--    Debe dar 0 filas (o 0 en la columna) si todo quedó cubierto.
-- ----------------------------------------------------------------------------
select shifts.sh as turno, count(*) as maquinas_sin_inspector
from public.machinery mch
cross join (values ('day'), ('night')) as shifts(sh)
where mch.active = true and mch.operational = true and mch.en_espera = false
  and not exists (
    select 1 from public.machine_inspectors mi
    where mi.machinery_id = mch.id and mi.shift = shifts.sh
  )
group by shifts.sh
order by shifts.sh;

-- Cuántas asignaciones tiene ahora el cajón "inspector maquinas faltantes" (control):
select shift, count(*) as asignaciones_del_cajon
from public.machine_inspectors
where inspector_id = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b'
group by shift
order by shift;
