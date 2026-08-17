-- ============================================================================
-- Compras → Proveedores: ETIQUETAS de rubro (VÍVERES, REPUESTOS, FERRETERÍA…)
-- para poder filtrar los proveedores por lo que venden. Es un arreglo de texto.
-- Correr en Supabase (SQL Editor). Idempotente.
-- ============================================================================
alter table public.suppliers
  add column if not exists tags text[];

-- Índice GIN para filtrar rápido por etiqueta (tags @> ARRAY['VÍVERES']).
create index if not exists suppliers_tags_idx on public.suppliers using gin (tags);
