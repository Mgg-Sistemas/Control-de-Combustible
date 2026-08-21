-- ============================================================================
-- VEHÍCULOS CON FICHA COMPLETA (como maquinaria) + FOTO
-- ----------------------------------------------------------------------------
-- El formulario de vehículo pasa a verse igual que el de maquinaria: marca,
-- modelo, clasificación, empresa supervisora, encargado, grupo, serial,
-- identificador y FOTO. Los vehículos SIGUEN en su propia tabla `vehicles`
-- (NO entran a Control/Inspecciones/pagos) — solo se enriquece su ficha.
--
-- Estas columnas son nuevas; la app las escribe/lee sin problema (RecordForm
-- inserta/actualiza solo las columnas que existen). Correr una vez en el SQL
-- Editor de Supabase.
-- ============================================================================

alter table public.vehicles
  add column if not exists clasificacion    text,
  add column if not exists identifier       text,
  add column if not exists serial           text,
  add column if not exists grupo            text,
  add column if not exists company_id       uuid references public.companies(id) on delete set null,
  add column if not exists photo_url        text,   -- foto del vehículo
  add column if not exists photo_serial_url text;   -- foto del serial / placa

comment on column public.vehicles.company_id is 'Empresa supervisora del vehículo (igual que machinery.company_id).';
comment on column public.vehicles.photo_url is 'Foto del vehículo (bucket Storage machinery, igual que las máquinas).';
