-- ============================================================================
-- FIX: supabase/schema.sql referencia public.staff_pay_config (ALTER TABLE ...
-- ENABLE ROW LEVEL SECURITY / CREATE POLICY, líneas ~1765-1770) pero la tabla
-- NUNCA se crea con un CREATE TABLE. Al instalar schema.sql en una base limpia,
-- el script aborta en esa línea ("relation public.staff_pay_config does not
-- exist"). Este archivo agrega el CREATE TABLE que falta.
--
-- *** ORDEN DE EJECUCIÓN: este archivo debe correrse ANTES de schema.sql (o
-- en su defecto, antes de llegar a la sección "CONTROL DE PAGO A PERSONAL"),
-- para que el ALTER TABLE ... ENABLE ROW LEVEL SECURITY de schema.sql
-- encuentre la tabla ya creada. El CREATE TABLE usa IF NOT EXISTS, así que
-- correrlo también DESPUÉS de schema.sql (o repetidas veces) es seguro. ***
--
-- ── INFERENCIA DE COLUMNAS ───────────────────────────────────────────────────
-- No se encontró NINGÚN uso de `staff_pay_config` en src/ (ni queries, ni
-- tipos en src/types/database.ts): el módulo "Control de pago a personal"
-- (PagoPersonalScreen.tsx, PagoPorPersona.tsx) hoy calcula todo con precios
-- POR TRABAJADOR (employees.precio_hora/precio_dia/..., staff_pay_items) y no
-- usa divisores globales. La única referencia con forma de columnas es el
-- documento de diseño original del módulo:
--   docs/superpowers/specs/2026-07-17-control-pago-personal-design.md,
--   sección "10.1 staff_pay_config (config global de divisores)":
--     - id (pk, single row / por empresa si aplica)
--     - dias_mes int default 30
--     - horas_mes int default 240
--     - updated_at
-- Se usa esa especificación tal cual (agregando company_id nullable para
-- soportar "por empresa si aplica", y created_at/updated_by por consistencia
-- con otras tablas de configuración del schema, ej. map_zone_offsets). Si el
-- módulo de pago a personal termina NO necesitando divisores globales, esta
-- tabla puede quedar sin uso (igual soluciona el aborte de instalación).
-- ============================================================================

create table if not exists public.staff_pay_config (
  id          uuid primary key default gen_random_uuid(),
  -- null = configuración global (aplica a las empresas sin fila propia).
  company_id  uuid references public.companies(id) on delete cascade,
  dias_mes    int not null default 30,
  horas_mes   int not null default 240,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_staff_pay_config_company on public.staff_pay_config(company_id);

-- RLS: sin uso anónimo (mismo criterio documentado para esta tabla en
-- supabase/fix_rls_anon_nomina.sql, sección "FUERA DE ALCANCE" — todas las
-- pantallas de Nómina/Pago a personal solo se montan con sesión real). Se usa
-- directamente el patrón seguro `not public.is_anon()` en vez de `using(true)`.
--
-- *** AMBIGÜEDAD: supabase/schema.sql (línea ~1769-1770) todavía crea la
-- policy `spc_all` con `using(true) with check(true)`. Si schema.sql se
-- vuelve a correr DESPUÉS de este archivo, esa policy más permisiva
-- sobrescribe la de abajo. Falta decidir si se corrige schema.sql también
-- (fuera del alcance de esta tarea) o si este archivo debe reaplicarse
-- siempre al final, igual que fix_rls_anon_nomina.sql. ***
alter table public.staff_pay_config enable row level security;
drop policy if exists spc_all on public.staff_pay_config;
create policy spc_all on public.staff_pay_config
  for all to authenticated
  using (not public.is_anon()) with check (not public.is_anon());
