-- Nombre del VEHÍCULO (como el "Código / Nombre" de la maquinaria).
-- La app lo muestra en el formulario solo si esta columna ya existe (probe `vehNombre`),
-- así publicar el campo antes de correr este SQL no rompe el alta de vehículos.
alter table public.vehicles add column if not exists name text;
