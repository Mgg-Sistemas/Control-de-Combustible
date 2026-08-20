-- ============================================================================
-- CHECK DEFINITIVO de `machine_work_segments.source` (19-ago-2026).
--
-- POR QUÉ EXISTE. `machine_segments_source_finish_early.sql` re-creó este CHECK para
-- admitir 'manual_finish_early' y, al hacerlo, DEJÓ FUERA 'no_trabajo_correction'
-- (que `no_trabajo_correction_hours_20260810.sql` había agregado nueve días antes).
-- Desde ese momento, cuando un inspector marcaba «🟡 PARADA · NO TRABAJÓ» sobre un
-- turno ya cerrado, la app anulaba las horas PERO el tramo negativo auditable era
-- rechazado por el constraint — y como ese insert va envuelto en
-- `.then(() => {}, () => {})` (best-effort, ver SupervisorScreen.marcarParadaNoTrabajo),
-- el error se tragaba en silencio.
--
-- Resultado: del 13-ago-2026 en adelante se borraron horas SIN dejar una sola fila de
-- rastro. Lo que sí quedó registrado, del 10 al 12-ago, fueron 101 tramos de turno DÍA
-- escritos en horas de noche: 1.046 h. Es lo que hizo imposible ver el bug antes.
--
-- ESTE ARCHIVO ES LA LISTA COMPLETA Y ÚNICA. Si mañana hace falta un `source` nuevo,
-- AGRÉGALO ACÁ y corre este archivo — no crees otra migración que re-arme el CHECK
-- desde cero, que es exactamente como se perdió un valor. `scripts/test-parada-no-trabajo.mjs`
-- verifica que todo `source` que la app escribe esté en esta lista.
--
-- NOT VALID a propósito: valida lo NUEVO sin escanear las filas viejas (hay valores
-- legados que harían fallar la creación con 23514). El constraint queda activo igual
-- para todo insert/update de aquí en adelante.
--
-- Idempotente. Correr una vez en Supabase → SQL Editor.
-- ============================================================================

-- Quita CUALQUIER CHECK previo sobre `source`, se llame como se llame.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.machine_work_segments'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.machine_work_segments drop constraint %I', c);
  end loop;
end $$;

alter table public.machine_work_segments
  add constraint machine_work_segments_source_check
  check (source in (
    -- cierres del inspector desde el teléfono
    'manual_finish',            -- finalizó a la hora de fin del turno
    'manual_finish_early',      -- finalizó antes (lleva motivo obligatorio)
    -- paradas / averías
    'parada_averia',            -- horas bancadas al marcar avería
    'parada_no_trabajo',        -- horas bancadas al marcar parada "no trabajó"
    'no_trabajo_correction',    -- tramo NEGATIVO: anula horas ya acreditadas
    -- automáticos
    'auto_close',               -- cron de cierre 7am/7pm
    'auto_full_shift',          -- turno completo generado (placeholder / 12h de día)
    -- ediciones a mano
    'ajuste_manual'             -- Control de Maquinaria y correcciones por SQL
  )) not valid;

-- Verificación: debe listar los 8 valores de arriba.
select pg_get_constraintdef(oid) as check_vigente
  from pg_constraint
 where conrelid = 'public.machine_work_segments'::regclass
   and conname = 'machine_work_segments_source_check';
