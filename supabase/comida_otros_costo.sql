-- ============================================================================
-- DISTRIBUCIÓN DE COMIDA POR EMPRESA — plato OTROS + costo por plato + acumular
-- (2026-09-17)
--
--  1) Se permite el tiempo de comida 'otros' (platos extra que carga el usuario).
--  2) Cada renglón lleva COSTO POR PLATO en $ (unit_cost) y, para OTROS, el
--     nombre del plato (item_label). El $ se muestra también en Bs a la tasa BCV.
--  3) Se QUITA el único (empresa, comida, día): ahora se pueden registrar VARIAS
--     entregas de la misma comida en el día y se SUMAN (cada escaneo/distribución
--     agrega platos). Antes solo dejaba 1 por día y topaba por nº de máquinas.
--
-- Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================================

-- 1) meal_type ahora admite 'otros'
alter table public.food_company_meals drop constraint if exists food_company_meals_meal_type_check;
alter table public.food_company_meals
  add constraint food_company_meals_meal_type_check
  check (meal_type in ('desayuno','almuerzo','lunch','cena','otros'));

-- 2) costo por plato ($) y etiqueta del plato (OTROS)
alter table public.food_company_meals add column if not exists unit_cost numeric(14,2) not null default 0;
alter table public.food_company_meals add column if not exists item_label text;

-- 3) quitar el único (empresa, comida, día) para poder acumular varias entregas.
--    Se busca por sus columnas por si el nombre del constraint difiere.
do $$
declare c text;
begin
  select con.conname into c
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public' and rel.relname = 'food_company_meals' and con.contype = 'u';
  if c is not null then execute format('alter table public.food_company_meals drop constraint %I', c); end if;
end $$;

-- 4) CATÁLOGO reusable de platos OTROS (bolsa de hielo, refresco, postre…).
--    El nombre se guarda una vez y luego se elige de la lista; solo cambia el costo.
create table if not exists public.food_extra_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists food_extra_items_name_key on public.food_extra_items(lower(name));
alter table public.food_extra_items enable row level security;
drop policy if exists fei_select on public.food_extra_items;
create policy fei_select on public.food_extra_items for select to authenticated using (true);
-- Mismo criterio que food_company_meals: la cocina registra por el QR (sesión
-- anónima), así que el alta del nombre también se permite a authenticated.
drop policy if exists fei_write on public.food_extra_items;
create policy fei_write on public.food_extra_items for all to authenticated using (true) with check (true);

-- ── Verificación ─────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='food_company_meals' and column_name in ('unit_cost','item_label')) as columnas_nuevas,  -- debe ser 2
  (select count(*) from pg_constraint con join pg_class rel on rel.oid=con.conrelid
     join pg_namespace ns on ns.oid=rel.relnamespace
     where ns.nspname='public' and rel.relname='food_company_meals' and con.contype='u') as uniques_restantes,  -- debe ser 0
  (select exists (select 1 from information_schema.tables
     where table_schema='public' and table_name='food_extra_items')) as catalogo_otros_ok;  -- debe ser true
