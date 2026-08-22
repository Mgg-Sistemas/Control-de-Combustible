-- ============================================================================
-- REPORTE DETALLADO POR EDIFICIO — Fase 2 (13-ago-2026).
-- Amplía `op_edificio_removidos` (un registro por edificio + fecha) con el resto
-- de campos del reporte diario que se manda por WhatsApp: maquinaria en uso /
-- inoperativa / requerimiento, m³ acarreados, viajes, % de avance, cuerpos
-- (supervivientes / fallecidos), actividades y si el frente fue entregado.
-- Todo NULL/0 por defecto → no rompe los registros de m³ ya existentes.
-- Correr en Supabase → SQL Editor (después de op_edificio_removidos.sql).
-- ============================================================================
alter table public.op_edificio_removidos
  add column if not exists m3_acarreados     numeric  not null default 0,
  add column if not exists viajes            integer  not null default 0,
  add column if not exists avance            integer,                       -- % de avance (0-100), opcional
  add column if not exists maq_en_uso        text,
  add column if not exists maq_inoperativo   text,
  add column if not exists maq_requerimiento text,
  add column if not exists supervivientes    integer  not null default 0,
  add column if not exists fallecidos        integer  not null default 0,
  add column if not exists actividades       text,
  add column if not exists entregado         boolean  not null default false;
