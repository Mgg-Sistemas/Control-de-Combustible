-- ============================================================================
-- CHECK DEFINITIVO de `machine_work_segments.source`.
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL Editor
--    y darle RUN. Un solo bloque. Termina mostrando una tabla de verificación.
--
-- POR QUÉ EXISTE
-- ---------------------------------------------------------------------------
-- `machine_segments_source_finish_early.sql` re-creó este CHECK para admitir
-- 'manual_finish_early' y, al hacerlo, DEJÓ FUERA 'no_trabajo_correction' (que
-- `no_trabajo_correction_hours_20260810.sql` había agregado nueve días antes).
-- Desde ese momento, cuando un inspector marca «🟡 PARADA · NO TRABAJÓ» sobre un
-- turno ya cerrado, la app anula las horas PERO el tramo negativo auditable lo
-- rechaza el constraint — y como ese insert va envuelto en `.then(() => {}, () => {})`
-- (best-effort, ver `SupervisorScreen.marcarParadaNoTrabajo`), el error se traga
-- en silencio. Resultado: se borran horas SIN dejar una sola fila de rastro.
--
-- ESTE ARCHIVO ES LA LISTA COMPLETA Y ÚNICA. Si mañana hace falta un `source`
-- nuevo, AGRÉGALO ACÁ y vuelve a correr este archivo — NO crees otra migración que
-- re-arme el CHECK desde cero, que es exactamente como se perdió un valor.
-- `scripts/test-parada-no-trabajo.mjs` verifica que todo `source` que la app
-- escribe esté en esta lista.
--
-- POR QUÉ NO PUEDE TRANCAR NADA
-- ---------------------------------------------------------------------------
--  · NOT VALID — no escanea las filas viejas. Sin esto, con un solo valor legado
--    fuera de la lista el ALTER fallaría con 23514 y no se aplicaría nada. El
--    constraint queda activo igual para todo insert/update de aquí en adelante.
--  · lock_timeout de 5 s — el ALTER pide un lock exclusivo un instante. Si en ese
--    momento hay una consulta larga sobre la tabla, en vez de quedarse esperando
--    (y encolar detrás a toda la app) FALLA rápido y no pasa nada: se vuelve a
--    correr y ya. Es el seguro contra «me trancó el sistema».
--  · Todo va dentro de UN bloque, o sea UNA transacción: el momento sin constraint
--    entre el DROP y el ADD no existe. O queda todo, o no queda nada.
--  · NO toca ni una fila de datos. Solo cambia una regla de validación.
--
-- Idempotente: se puede correr las veces que haga falta.
-- ============================================================================

do $$
declare
  c text;
begin
  -- Si la tabla está ocupada, rendirse rápido en vez de trancar la app detrás.
  set local lock_timeout = '5s';

  -- Quita CUALQUIER CHECK previo sobre `source`, se llame como se llame.
  for c in
    select conname from pg_constraint
     where conrelid = 'public.machine_work_segments'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.machine_work_segments drop constraint %I', c);
    raise notice 'CHECK viejo eliminado: %', c;
  end loop;

  -- Y pone LA lista completa. En la MISMA transacción que el drop.
  execute $ddl$
    alter table public.machine_work_segments
      add constraint machine_work_segments_source_check
      check (source in (
        -- cierres del inspector (teléfono, patio, QR, camiones)
        'manual_finish',            -- finalizó a la hora de fin del turno
        'manual_finish_early',      -- finalizó antes (lleva motivo obligatorio)
        -- paradas / averías
        'parada_averia',            -- horas bancadas al marcar avería
        'parada_no_trabajo',        -- horas bancadas al marcar parada "no trabajó"
        'no_trabajo_correction',    -- tramo NEGATIVO: anula horas ya acreditadas
        -- automáticos (crons de la BD)
        'auto_close',               -- cierre 7am/7pm
        'auto_full_shift',          -- turno completo generado
        -- ediciones a mano
        'ajuste_manual'             -- Control de Maquinaria, Inspecciones y correcciones
      )) not valid
  $ddl$;
  raise notice 'CHECK nuevo aplicado con los 8 valores.';
end $$;


-- ── VERIFICACIÓN ────────────────────────────────────────────────────────────
-- Última instrucción del archivo: es el resultado que queda en pantalla.
-- Los 4 primeros renglones tienen que decir ✅.
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'El CHECK existe' as chequeo,
         (select count(*) from pg_constraint
           where conrelid = 'public.machine_work_segments'::regclass
             and conname = 'machine_work_segments_source_check')::text as valor,
         (select count(*) from pg_constraint
           where conrelid = 'public.machine_work_segments'::regclass
             and conname = 'machine_work_segments_source_check') = 1 as ok
  union all
  -- EL QUE IMPORTA: sin esto se siguen borrando horas sin dejar rastro.
  select 2, '⭐ Admite no_trabajo_correction (el que faltaba)',
         case when (select pg_get_constraintdef(oid) from pg_constraint
                     where conrelid = 'public.machine_work_segments'::regclass
                       and conname = 'machine_work_segments_source_check')
                   ilike '%no_trabajo_correction%' then 'sí' else 'NO' end,
         (select pg_get_constraintdef(oid) from pg_constraint
           where conrelid = 'public.machine_work_segments'::regclass
             and conname = 'machine_work_segments_source_check')
           ilike '%no_trabajo_correction%'
  union all
  select 3, 'Hay UN solo CHECK sobre `source` (no quedaron duplicados)',
         (select count(*) from pg_constraint
           where conrelid = 'public.machine_work_segments'::regclass
             and contype = 'c' and pg_get_constraintdef(oid) ilike '%source%')::text,
         (select count(*) from pg_constraint
           where conrelid = 'public.machine_work_segments'::regclass
             and contype = 'c' and pg_get_constraintdef(oid) ilike '%source%') = 1
  union all
  -- CONTROL: este script NO toca datos. Anota el número antes y compáralo después.
  select 4, 'Tramos en la base (este script NO los toca)',
         (select count(*) from public.machine_work_segments)::text, true
  union all
  -- INFORMATIVO (puede ser > 0 sin problema): filas viejas con un `source` que ya
  -- no está en la lista. NOT VALID las tolera; solo se listan para saber que existen.
  select 5, 'ℹ️ Tramos VIEJOS con un source fuera de la lista (informativo)',
         (select count(*) from public.machine_work_segments
           where source is not null and source not in (
             'manual_finish','manual_finish_early','parada_averia','parada_no_trabajo',
             'no_trabajo_correction','auto_close','auto_full_shift','ajuste_manual'))::text,
         true
) t order by n;
