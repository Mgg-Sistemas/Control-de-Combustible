-- ============================================================================
-- EXPIRAR paradas "NO TRABAJÓ" — al INICIO DEL PRÓXIMO TURNO, no al cierre del
-- suyo (regla cliente 13-ago-2026, corregida 15-ago-2026).
--
-- Regla: cuando una máquina se marca PARADA "NO TRABAJÓ" (ticket material =
-- 'MÁQUINA PARADA'), esa parada vale para TODO su turno. Debe QUEDARSE como
-- 🟡 Parada durante todo ese turno —sin bajar la eficiencia del inspector, sin
-- afectar los reportes— y recién volverse ⏳ "pendiente por iniciar" al INICIO
-- del PRÓXIMO turno del mismo tipo. Aplica a DÍA y NOCHE.
--
-- CORRECCIÓN 15-ago-2026: antes el ticket se resolvía al CERRAR su propio turno
-- (día 19:00, noche 07:00). Eso la sacaba de 🟡 Parada DENTRO de su mismo turno
-- (el panel/PDF del día 15 la mostraba ⏳ pendiente después de las 7pm) y bajaba
-- el % del inspector aunque ya había hecho su trabajo (marcarla parada). Ahora
-- expira al INICIO del próximo turno del mismo tipo:
--   · DÍA (marca 07:00–18:59)  → reabre 07:00 del día SIGUIENTE.
--   · NOCHE (marca 19:00–23:59) → reabre 19:00 del día SIGUIENTE.
--   · NOCHE (marca 00:00–06:59, pertenece a la noche que arrancó AYER 19:00)
--                              → reabre 19:00 de HOY.
--
-- La "parada POR AVERÍA" crea DOS tickets (marcador 'MÁQUINA PARADA' + avería
-- real con otro material). Este cron resuelve SOLO el marcador; la AVERÍA REAL
-- (material distinto) NO se toca y mantiene la máquina averiada hasta resolverla.
--
-- Corre cada 10 min con pg_cron. Idempotente. Correr una vez en Supabase.
-- ============================================================================
create extension if not exists pg_cron;

-- Instante (Caracas) en que la parada debe REABRIR = inicio del próximo turno de
-- su mismo tipo. Encapsulado para usarlo tanto al expirar como al reabrir hoy.
create or replace function public.parada_no_trabajo_reabre_at(p_created timestamptz)
returns timestamptz language sql immutable set search_path = public as $$
  select case
    -- DÍA (07:00–18:59) → 07:00 del día SIGUIENTE
    when extract(hour from (p_created at time zone 'America/Caracas')) between 7 and 18
      then (((p_created at time zone 'America/Caracas')::date + 1) + time '07:00') at time zone 'America/Caracas'
    -- NOCHE tardía (19:00–23:59) → 19:00 del día SIGUIENTE
    when extract(hour from (p_created at time zone 'America/Caracas')) >= 19
      then (((p_created at time zone 'America/Caracas')::date + 1) + time '19:00') at time zone 'America/Caracas'
    -- NOCHE madrugada (00:00–06:59): pertenece a la noche de AYER → 19:00 de HOY
    else ((p_created at time zone 'America/Caracas')::date + time '19:00') at time zone 'America/Caracas'
  end;
$$;

-- El cron hace DOS cosas (blindaje 18-ago-2026): EXPIRA la parada cuando su
-- próximo turno del mismo tipo ya arrancó, y RE-ABRE cualquier parada resuelta
-- ANTES de tiempo. Antes el "re-abrir" era un UPDATE de una sola corrida (no
-- entraba al cron), así que si la app / una edición / otro proceso resolvía una
-- parada a mitad de su turno, NADA la volvía a abrir y la máquina caía a ⏳
-- pendiente dentro de su propio turno (caso LUMINARIA 18-ago: parada de día de
-- las 8:27am resuelta a las 7:20pm → salía pendiente en vez de 🟡 parada). Ahora
-- el re-abrir vive DENTRO del cron: una parada dura TODO su turno, pase lo que pase.
create or replace function public.expire_paradas_no_trabajo() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- EXPIRAR: su próximo turno del mismo tipo YA arrancó → vuelve a pendiente por iniciar.
  update public.maintenance_requests mr
     set status = 'realizado', resolved_at = now()
   where mr.material = 'MÁQUINA PARADA'
     and mr.status = 'pendiente'
     and public.parada_no_trabajo_reabre_at(mr.created_at) <= now();

  -- RE-ABRIR: resuelta ANTES de tiempo (su próximo turno TODAVÍA no arranca) →
  -- vuelve a 🟡 Parada por el resto de su turno. Las que ya trabajaron/reiniciaron
  -- jornada las excluye el clasificador por reactivación, así que no molesta.
  update public.maintenance_requests mr
     set status = 'pendiente', resolved_at = null
   where mr.material = 'MÁQUINA PARADA'
     and mr.status = 'realizado'
     and mr.resolved_at is not null
     and public.parada_no_trabajo_reabre_at(mr.created_at) > now();
end $$;

-- Programa (o reprograma) el cron cada 10 minutos.
do $$ begin perform cron.unschedule('expire-paradas-no-trabajo'); exception when others then null; end $$;
select cron.schedule('expire-paradas-no-trabajo', '*/10 * * * *', $$select public.expire_paradas_no_trabajo();$$);

-- Corre una vez YA (expira las de turnos realmente cerrados según la nueva regla).
select public.expire_paradas_no_trabajo();
