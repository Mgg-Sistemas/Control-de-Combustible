-- ─────────────────────────────────────────────────────────────────────────────
-- RESPONSABLE del tanque de combustible.
-- Agrega la columna `tanks.responsable` (nombre de la persona a cargo del tanque)
-- y la EXPONE en la vista derivada `tank_levels` para que la pantalla de Tanques la
-- muestre. Idempotente. Correr en Supabase → SQL Editor.
-- REGLA: el nivel del tanque sigue siendo DERIVADO de stock_movements (no editable).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.tanks add column if not exists responsable text;

-- Recrear la vista incluyendo `responsable` (y `location`, útil para el detalle). El
-- nivel actual/porcentaje se mantiene igual (derivado del ledger). `group by t.id`
-- basta porque id es PK (las demás columnas de `t` son dependientes funcionales).
create or replace view public.tank_levels as
select
  t.id,
  t.name,
  t.fuel,
  t.capacity_l,
  t.responsable,
  t.location,
  coalesce(sum(m.liters), 0)::numeric(12,2)                          as current_l,
  round(coalesce(sum(m.liters),0) / nullif(t.capacity_l,0) * 100, 1) as pct
from public.tanks t
left join public.stock_movements m on m.tank_id = t.id
group by t.id;

grant select on public.tank_levels to anon, authenticated;
