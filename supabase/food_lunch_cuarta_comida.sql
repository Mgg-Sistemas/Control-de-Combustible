-- ============================================================================
-- COMIDAS: 4ª comida "LUNCH" (merienda de la tarde) — 2026-08-30
--
-- Pedido del cliente: "ahora serán 4 comidas diarias tanto para personas como
-- por empresa. Agregar una nueva que sea lunch."
-- Orden de las comidas: DESAYUNO → ALMUERZO → LUNCH → CENA.
--
-- Cambios:
--   1) food_company_meals: ampliar el CHECK de meal_type para aceptar 'lunch'.
--   2) food_distributions: su meal_type es texto LIBRE (sin CHECK), no requiere
--      cambio de constraint; 'lunch' entra tal cual. El índice único parcial
--      food_dist_person_meal_day ya contempla cualquier meal_type (1 por
--      persona/comida/día), así que 'lunch' convive sin colisión.
--
-- Ambas tablas ya están en la publicación supabase_realtime (las tarjetas de
-- conteo en vivo funcionan sin cambios de realtime). Idempotente.
-- Correr en Supabase → SQL Editor.
-- ============================================================================

-- ── 1) Ampliar el CHECK de food_company_meals ───────────────────────────────
alter table public.food_company_meals
  drop constraint if exists food_company_meals_meal_type_check;
alter table public.food_company_meals
  add constraint food_company_meals_meal_type_check
  check (meal_type in ('desayuno','almuerzo','lunch','cena'));

-- ── 2) VERIFICACIÓN ─────────────────────────────────────────────────────────
-- 2.1 · El CHECK ahora incluye 'lunch'.
select pg_get_constraintdef(oid) as check_def
from pg_constraint
where conname = 'food_company_meals_meal_type_check';

-- 2.2 · Prueba rápida (rollback): un insert con 'lunch' NO debe fallar el CHECK.
do $$
begin
  begin
    insert into public.food_company_meals (company_name, meal_type, meal_date, delivered)
    values ('__prueba_lunch__', 'lunch', current_date, 1);
    raise notice 'OK: lunch aceptado por el CHECK.';
    -- limpiar la fila de prueba
    delete from public.food_company_meals where company_name = '__prueba_lunch__' and meal_type = 'lunch';
  exception when check_violation then
    raise exception 'FALLO: el CHECK aún no acepta lunch.';
  end;
end $$;
