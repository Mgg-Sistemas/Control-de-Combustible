-- ============================================================================
-- CHOFER DE COMBUSTIBLE (panel del teléfono para surtir combustible).
-- 1) Guarda el MONTO por litro y el MONTO TOTAL del surtido, y FOTOS del surtido.
-- 2) Permite VARIOS surtidos por máquina el mismo día (los choferes recargan
--    varias veces al día) → se quita el trigger de "1 carga por día".
-- Idempotente. Correr una sola vez en Supabase.
-- ============================================================================

-- Monto por litro, monto total y fotos del surtido (URLs del bucket 'machinery').
alter table public.dispatches add column if not exists price_per_liter numeric(14,2);
alter table public.dispatches add column if not exists total_amount    numeric(16,2);
alter table public.dispatches add column if not exists photos          text[] not null default '{}';

-- Permitir VARIAS cargas por máquina el mismo día (el chofer de combustible surte
-- varias veces al día). Antes un segundo surtido se bloqueaba con un trigger.
drop trigger if exists trg_one_fuel_per_day on public.dispatches;

-- NOTA: el bucket público de Storage 'machinery' ya se usa para fotos de máquinas;
-- las fotos del surtido se guardan ahí también (carpeta dispatches/).
