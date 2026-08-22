-- ============================================================================
-- ACARREO por VEHÍCULO en Obras Públicas (14-ago-2026).
-- El m³ acarreado se DESGLOSA por tipo de vehículo y se CALCULA de los viajes:
--   · Camión Volteo Toronto = 18 m³/viaje
--   · Chuto con Volqueta     = 25 m³/viaje
-- Ej.: 4 viajes Toronto = 72 m³.  m3_acarreados = toronto*18 + volqueta*25.
--       viajes (total)   = viajes_toronto + viajes_volqueta.
--
-- Se agregan dos columnas a op_edificio_removidos. Las ya existentes
-- (m3_acarreados, viajes) se siguen usando como TOTALES DERIVADOS (el cliente los
-- recalcula al guardar). Correr UNA vez en Supabase. Idempotente.
-- ============================================================================
alter table public.op_edificio_removidos
  add column if not exists viajes_toronto  integer not null default 0,
  add column if not exists viajes_volqueta integer not null default 0;

comment on column public.op_edificio_removidos.viajes_toronto  is 'Viajes con Camión Volteo Toronto (18 m³ c/u).';
comment on column public.op_edificio_removidos.viajes_volqueta is 'Viajes con Chuto con Volqueta (25 m³ c/u).';

-- Backfill: si había viajes viejos sueltos (sin desglose) déjalos como Toronto por
-- defecto SOLO si m3_acarreados cuadra con 18/viaje; si no, no se toca (datos previos
-- eran de prueba y el módulo se vació el 13/08, así que normalmente no hay nada).
-- (Sin backfill agresivo a propósito: el recálculo real ocurre al re-guardar el frente.)
