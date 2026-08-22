-- ─────────────────────────────────────────────────────────────────────────────
-- RESPONSABLE del tanque de combustible.
-- Agrega la columna `tanks.responsable` (nombre de la persona a cargo del tanque)
-- y la EXPONE en la vista derivada `tank_levels` para que la pantalla de Tanques la
-- muestre. Idempotente. Correr en Supabase → SQL Editor.
-- REGLA: el nivel del tanque sigue siendo DERIVADO de stock_movements (no editable).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.tanks add column if not exists responsable text;

-- Recrear la vista incluyendo `responsable` (y `location`). IMPORTANTE: `create or
-- replace view` NO permite reordenar ni renombrar columnas — solo AÑADIR columnas al
-- FINAL. Por eso se mantiene el orden original (id, name, fuel, capacity_l, current_l,
-- pct) y se agregan `responsable` y `location` al final. El nivel actual/porcentaje
-- sigue derivado del ledger. `group by t.id` basta porque id es PK.
create or replace view public.tank_levels as
select
  t.id,
  t.name,
  t.fuel,
  t.capacity_l,
  coalesce(sum(m.liters), 0)::numeric(12,2)                          as current_l,
  round(coalesce(sum(m.liters),0) / nullif(t.capacity_l,0) * 100, 1) as pct,
  t.responsable,
  t.location
from public.tanks t
left join public.stock_movements m on m.tank_id = t.id
group by t.id;

grant select on public.tank_levels to anon, authenticated;
