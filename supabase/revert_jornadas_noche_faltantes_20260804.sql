-- ============================================================================
-- Reversión de 2 jornadas de NOCHE iniciadas por error el 2026-08-04
-- ----------------------------------------------------------------------------
-- Contexto: dos máquinas del cajón "INSPECTOR MAQUINAS FALTANTES" quedaron con
-- una jornada de NOCHE iniciada (jornada_start_at = 2026-08-04 22:00 UTC = 6pm
-- Caracas) con 0 horas, por lo que aparecían como "iniciadas de noche" en el
-- dashboard de Inspecciones. Fue un error y hay que revertirlas.
--
-- Máquinas afectadas (confirmadas con el preview):
--   AUTOBUS                    17964fab-e879-4418-a1a9-a9cf5be4d4f9  (placa 08AA6FR)
--   CAMION BRAZO PITMAN 9 TON  29d5748a-416a-4cce-8abe-656fdabfec93
--
-- SEGURIDAD:
--   * Todo apunta SOLO a esos 2 machinery_id, round_date = 2026-08-04, turno night
--     y con 0 horas (day_hours = 0 y night_hours = 0). No toca jornadas con horas.
--   * Se hace un RESPALDO previo por si hay que comparar/restaurar.
--   * Elige UNA sola variante de reversión (A, B o C) y ejecútala. Corre primero
--     el bloque 0 (respaldo) y el 1 (preview) para confirmar.
-- Ejecutar en el SQL Editor de Supabase.
-- ============================================================================

-- 0) RESPALDO de las filas afectadas (para restaurar si hiciera falta).
create table if not exists public.backup_revert_noche_20260804 as
select *
from public.machine_rounds
where round_date = '2026-08-04'
  and jornada_shift = 'night'
  and coalesce(day_hours, 0) = 0
  and coalesce(night_hours, 0) = 0
  and machinery_id in (
    '17964fab-e879-4418-a1a9-a9cf5be4d4f9',  -- AUTOBUS
    '29d5748a-416a-4cce-8abe-656fdabfec93'   -- CAMION BRAZO PITMAN 9 TON
  );

-- 1) PREVIEW (no cambia nada): confirma que son exactamente esas 2 filas.
select r.machinery_id, m.code, m.plate, r.day_hours, r.night_hours,
       r.jornada_shift, r.jornada_start_at, r.round_date
from public.machine_rounds r
join public.machinery m on m.id = r.machinery_id
where r.round_date = '2026-08-04'
  and r.jornada_shift = 'night'
  and coalesce(r.day_hours, 0) = 0
  and coalesce(r.night_hours, 0) = 0
  and r.machinery_id in (
    '17964fab-e879-4418-a1a9-a9cf5be4d4f9',
    '29d5748a-416a-4cce-8abe-656fdabfec93'
  );

-- ============================================================================
-- ELIGE UNA VARIANTE (descoméntala y ejecútala). RECOMENDADA: A.
-- ============================================================================

-- --- VARIANTE A · BORRAR las 2 jornadas erróneas (recomendada) --------------
-- La jornada se creó por error y no tiene horas: se elimina la fila completa.
--
-- delete from public.machine_rounds
-- where round_date = '2026-08-04'
--   and jornada_shift = 'night'
--   and coalesce(day_hours, 0) = 0
--   and coalesce(night_hours, 0) = 0
--   and machinery_id in (
--     '17964fab-e879-4418-a1a9-a9cf5be4d4f9',
--     '29d5748a-416a-4cce-8abe-656fdabfec93'
--   );

-- --- VARIANTE B · DES-INICIAR la jornada (conserva la fila) ------------------
-- Deja la ronda pero la quita de "iniciadas": limpia el inicio y el turno.
--
-- update public.machine_rounds
-- set jornada_start_at = null,
--     jornada_shift = null
-- where round_date = '2026-08-04'
--   and jornada_shift = 'night'
--   and coalesce(day_hours, 0) = 0
--   and coalesce(night_hours, 0) = 0
--   and machinery_id in (
--     '17964fab-e879-4418-a1a9-a9cf5be4d4f9',
--     '29d5748a-416a-4cce-8abe-656fdabfec93'
--   );

-- --- VARIANTE C · CAMBIAR el turno a DÍA (si el error fue solo el turno) ------
-- Úsala solo si la jornada era válida pero se marcó como noche por error.
--
-- update public.machine_rounds
-- set jornada_shift = 'day'
-- where round_date = '2026-08-04'
--   and jornada_shift = 'night'
--   and coalesce(day_hours, 0) = 0
--   and coalesce(night_hours, 0) = 0
--   and machinery_id in (
--     '17964fab-e879-4418-a1a9-a9cf5be4d4f9',
--     '29d5748a-416a-4cce-8abe-656fdabfec93'
--   );

-- 2) VERIFICACIÓN posterior (debe volver 0 filas tras A o B):
-- select count(*) from public.machine_rounds
-- where round_date = '2026-08-04' and jornada_shift = 'night'
--   and machinery_id in ('17964fab-e879-4418-a1a9-a9cf5be4d4f9','29d5748a-416a-4cce-8abe-656fdabfec93');
