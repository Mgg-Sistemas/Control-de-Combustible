-- PARROQUIA y SECTOR (texto) por máquina. Complementan la "referencia/ubicación"
-- (edificio) y el sector geográfico calculado por GPS (Este/Oeste), que se mantiene
-- para el mapa. Estos dos son EDITABLES a mano y se muestran en Catálogo, en el
-- check-in del inspector y en los reportes.
alter table public.machinery add column if not exists parroquia text;
alter table public.machinery add column if not exists sector text;
