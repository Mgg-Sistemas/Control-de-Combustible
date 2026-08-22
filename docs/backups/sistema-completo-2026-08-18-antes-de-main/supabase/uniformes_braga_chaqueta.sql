-- ============================================================================
-- DOTACIÓN DE UNIFORME — agrega BRAGA (overol) y CHAQUETA como prendas nuevas.
-- (aplicada 10-ago-2026 vía MCP). Tallas por empleado + cantidades entregadas,
-- igual que camisa/pantalón/zapatos. Idempotente (add column if not exists).
-- ============================================================================
alter table public.employees add column if not exists talla_braga text;
alter table public.employees add column if not exists talla_chaqueta text;
alter table public.uniform_deliveries add column if not exists bragas integer not null default 0;
alter table public.uniform_deliveries add column if not exists chaquetas integer not null default 0;
