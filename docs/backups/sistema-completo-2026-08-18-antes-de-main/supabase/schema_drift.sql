-- ============================================================================
-- DERIVA DE ESQUEMA (drift): columnas que existen en la base de datos real de
-- producción pero NO están declaradas en supabase/schema.sql (probablemente
-- se agregaron a mano desde el SQL editor de Supabase en algún momento).
-- Este archivo las documenta con ALTER TABLE ... ADD COLUMN IF NOT EXISTS
-- para poder reconstruir el esquema en limpio sin perder estas columnas.
-- Seguro de correr varias veces y en cualquier orden respecto a schema.sql.
-- ============================================================================

-- ── profiles.cedula ──────────────────────────────────────────────────────────
-- Usada en src/types/database.ts (Profile.cedula, ya presente en el tipo) y
-- en src/screens/UsersScreen.tsx (líneas ~527, 548, 715): se guarda/edita al
-- crear o editar un usuario, y se valida duplicado a mano con un SELECT
-- (`.from('profiles').select('id').eq('cedula', ci)`) antes de guardar — es
-- decir, la unicidad se aplica en la app, NO hay UNIQUE constraint en la BD.
-- Se agrega sin UNIQUE aquí para no romper si ya existen duplicados en
-- producción; si se quiere forzar unicidad hay que limpiar duplicados primero.
alter table public.profiles add column if not exists cedula text;

-- ── machinery.viajes / machinery.precio_viaje ───────────────────────────────
-- Usadas en src/screens/EquiposScreen.tsx (VIAJES_FIELDS, líneas ~106-112):
-- "🚚 Viajes realizados" y "🚚 Precio por viaje ($)", editables para CUALQUIER
-- máquina vía RecordForm (campo genérico `type: 'number'`, que acepta
-- decimales — src/components/RecordForm.tsx usa `onlyDecimal`). Ya están
-- declaradas en src/types/database.ts (Machinery.viajes, Machinery.precio_viaje,
-- ambas `number | null`), pero faltan en schema.sql. Se usa numeric(12,2) para
-- ambas, igual que el resto de columnas de precio/rendimiento de `machinery`
-- (price_per_hour, expected_lph, daily_consumption_l), en vez de integer,
-- porque el campo de formulario no impide decimales.
-- Nota: no confundir con `public.fletes.viajes` (int not null default 1),
-- que es una tabla distinta (histórico de fletes CON FECHA por máquina/
-- empresa); estas dos columnas son el valor "vigente" que se ve en la ficha
-- de la máquina.
alter table public.machinery add column if not exists viajes numeric(12,2);
alter table public.machinery add column if not exists precio_viaje numeric(12,2);
