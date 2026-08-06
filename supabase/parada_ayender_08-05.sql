-- ============================================================================
-- Marcar como PARADA las máquinas PENDIENTES de AYENDER AULAR del 08-05 (noche)
-- ----------------------------------------------------------------------------
-- Ayender (inspector de NOCHE, id 1e8b5dc9-7f44-457a-8cf6-e2eafe9779ce) tenía el
-- 08-05 seis máquinas de su turno que NO trabajaron y NO tenían parada/avería.
-- Este script las registra como PARADA (maintenance_requests · material
-- 'MÁQUINA PARADA' · status 'pendiente'), fechadas el 08-05 a las 8:00pm Caracas
-- (ventana de NOCHE → se atribuyen al turno de Ayender), y a nombre de Ayender.
--
-- Idempotente: no duplica si la máquina ya tiene una parada pendiente.
-- ============================================================================
insert into public.maintenance_requests (machinery_id, material, notes, status, requested_by, created_at)
select v.machinery_id, 'MÁQUINA PARADA', 'NO TRABAJÓ', 'pendiente',
       '1e8b5dc9-7f44-457a-8cf6-e2eafe9779ce'::uuid,
       '2026-08-05T20:00:00-04:00'::timestamptz
from (values
  ('af3cd93b-47ed-4030-ba43-fadd3d67968a'::uuid),  -- GRÚAS TELESCÓPICAS 30 TON (251619.0)
  ('c9e30b7a-30b9-4881-95cc-6fded3aa3172'::uuid),  -- JUMBO 330 (LL09-U1265)
  ('257b098d-7da8-489c-a3d4-f021b68e6e81'::uuid),  -- JUMBO 330 (ROBEX250LC-7)
  ('87cb7d7b-f7e1-4075-b747-d61ce75a4bc0'::uuid),  -- JUMBO 330 (SYO23CBGA2538)
  ('8c5a9fc0-7b8f-4aef-a705-01b9641eae01'::uuid),  -- PAYLOADER (HL760-7A)
  ('075f897b-d5f9-40cc-abcb-0805ecdfb243'::uuid)   -- PAYLOADER (XUG0050GNRVB61422)
) as v(machinery_id)
where not exists (
  select 1 from public.maintenance_requests m
  where m.machinery_id = v.machinery_id
    and m.material = 'MÁQUINA PARADA'
    and m.status = 'pendiente'
);

-- Verificación (debe listar las 6):
-- select machinery_id, material, status, created_at, notes
--   from public.maintenance_requests
--  where requested_by = '1e8b5dc9-7f44-457a-8cf6-e2eafe9779ce'
--    and created_at::date = '2026-08-05'
--    and material = 'MÁQUINA PARADA';

-- ── DESHACER (si te arrepientes) ────────────────────────────────────────────
-- delete from public.maintenance_requests
--  where requested_by = '1e8b5dc9-7f44-457a-8cf6-e2eafe9779ce'
--    and notes = 'NO TRABAJÓ'
--    and material = 'MÁQUINA PARADA'
--    and created_at = '2026-08-05T20:00:00-04:00'::timestamptz;
