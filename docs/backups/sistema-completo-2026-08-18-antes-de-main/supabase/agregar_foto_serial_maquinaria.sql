-- Segunda foto de la maquinaria: la del SERIAL / PLACA.
-- El catálogo (EquiposScreen) permite subir DOS fotos por máquina:
--   photo_url        → foto de la MAQUINARIA (ya existía)
--   photo_serial_url → foto del SERIAL / PLACA (esta columna, nueva)
-- Idempotente: se puede correr varias veces sin romper nada.

alter table public.machinery
  add column if not exists photo_serial_url text;

-- Verificación rápida (debe listar ambas columnas):
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'machinery'
--    and column_name in ('photo_url', 'photo_serial_url');
