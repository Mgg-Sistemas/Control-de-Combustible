-- Vincula los TANQUES (cisternas móviles) con la CISTERNA del catálogo (machinery)
-- y permite guardar el CHOFER de la cisterna desde el módulo Combustible → Tanques.
-- Idempotente. IMPORTANTE: correr esto ANTES de editar/crear tanques con estos campos,
-- si no, guardar el tanque fallará (columna inexistente).
alter table public.tanks add column if not exists chofer text;
alter table public.tanks add column if not exists machinery_id uuid references public.machinery(id) on delete set null;
