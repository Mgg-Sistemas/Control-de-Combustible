-- ============================================================================
-- EXPIRAR paradas "NO TRABAJÓ" al cerrar su turno (regla cliente 13-ago-2026).
--
-- Regla: cuando una máquina se marca PARADA "NO TRABAJÓ" (ticket material =
-- 'MÁQUINA PARADA'), esa parada vale SOLO para su turno. Al cerrar el turno, el
-- ticket se resuelve → la máquina deja de salir 🟡 Parada y al día siguiente
-- aparece ⏳ "pendiente por iniciar" (no arrastra). Aplica a DÍA y NOCHE.
--
-- Así SOLO quedan 🔴 AVERIADAS las que de verdad necesitan "Volver operativa e
-- iniciar jornada": la "parada POR AVERÍA" crea DOS tickets (el marcador
-- 'MÁQUINA PARADA' + la avería real con otro material). Este cron resuelve SOLO
-- el marcador 'MÁQUINA PARADA'; la AVERÍA REAL (material distinto) NO se toca y
-- mantiene la máquina averiada hasta que se resuelva de verdad.
--
-- Turno de la marca (hora Caracas): DÍA 07:00–18:59 (cierra 19:00 del mismo día);
-- NOCHE el resto (marca ≥19:00 cierra 07:00 del día siguiente; marca <07:00 cierra
-- 07:00 del mismo día). Solo resuelve las cuyo cierre de turno YA pasó.
-- Corre cada 10 min con pg_cron. Idempotente (al resolverlas no re-procesa).
-- Correr una vez en Supabase → SQL Editor.
-- ============================================================================
create extension if not exists pg_cron;

create or replace function public.expire_paradas_no_trabajo() returns void
language sql security definer set search_path = public as $$
  update public.maintenance_requests mr
     set status = 'realizado', resolved_at = now()
   where mr.material = 'MÁQUINA PARADA'
     and mr.status = 'pendiente'
     and (
       -- Fin del TURNO de la marca (hora Caracas) ya pasó:
       case
         -- DÍA (07:00–18:59) → cierra a las 19:00 del MISMO día
         when extract(hour from (mr.created_at at time zone 'America/Caracas')) between 7 and 18
           then ((mr.created_at at time zone 'America/Caracas')::date + time '19:00') at time zone 'America/Caracas'
         -- NOCHE (19:00–23:59) → cierra 07:00 del día SIGUIENTE
         when extract(hour from (mr.created_at at time zone 'America/Caracas')) >= 19
           then (((mr.created_at at time zone 'America/Caracas')::date + 1) + time '07:00') at time zone 'America/Caracas'
         -- NOCHE (00:00–06:59) → cierra 07:00 del MISMO día
         else ((mr.created_at at time zone 'America/Caracas')::date + time '07:00') at time zone 'America/Caracas'
       end
     ) <= now();
$$;

-- Programa (o reprograma) el cron cada 10 minutos.
do $$ begin perform cron.unschedule('expire-paradas-no-trabajo'); exception when others then null; end $$;
select cron.schedule('expire-paradas-no-trabajo', '*/10 * * * *', $$select public.expire_paradas_no_trabajo();$$);

-- Corre una vez YA para limpiar lo pendiente de turnos ya cerrados.
select public.expire_paradas_no_trabajo();
