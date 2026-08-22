-- ─────────────────────────────────────────────────────────────────────────────
-- MARCA y MODELO separados en el catálogo (machinery)
-- APLICADO 2026-08-11 vía apply_migration (MCP). Idempotente.
--
-- La columna histórica `tipo` guardaba marca+modelo combinados ("CAT 320", "KODIAK").
-- Se agregan columnas dedicadas `marca` y `modelo`; se copia TODO el valor actual de
-- `tipo` a `marca` (decisión del usuario: MODELO queda vacío para separarlo a mano).
-- `tipo` SE MANTIENE: el catálogo la sincroniza = marca+modelo al guardar (beforeSave en
-- RecordForm) para no romper los ~100 lugares que ya leen machinery.tipo (reportes, PDFs,
-- tarjetas, acarreo…). Los reportes NO cambian: siguen leyendo `tipo`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.machinery add column if not exists marca  text;
alter table public.machinery add column if not exists modelo text;

update public.machinery
   set marca = tipo
 where marca is null and tipo is not null and btrim(tipo) <> '';
