-- ════════════════════════════════════════════════════════════════════════════
-- ⚖️ TARIFAS DE VIAJE POR TONELADA — 07-oct-2026.
--
-- Pedido del cliente: «permite colocar una tarifa por TON — este 2$, este y
-- oeste 3$, oeste 2$ — y que se multiplique por las ton obtenidas; esto se
-- hará solo si seleccionan la opción».
--
-- Hasta hoy un tipo de viaje cobraba un precio FIJO POR VIAJE. Ahora cada tipo
-- dice en qué unidad cobra, y el viaje CONGELA esa unidad igual que congela el
-- nombre y el precio.
--
-- ⭐ NADA DE LO QUE YA EXISTE CAMBIA DE PRECIO. La columna nace en 'viaje' y
--    los viajes viejos la tienen en NULL (que el código lee como 'viaje'). Las
--    tarifas por tonelada entran como tipos NUEVOS, al lado de los de siempre:
--    así «solo si seleccionan la opción» es literal, y volver atrás es apagar
--    un tipo, no deshacer una migración.
--
-- Idempotente: se puede correr dos veces sin romper nada.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) En qué unidad cobra cada tipo ───────────────────────────────────────
alter table public.viaje_tipos
  add column if not exists tarifa_unidad text not null default 'viaje';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'viaje_tipos_tarifa_unidad_check'
  ) then
    alter table public.viaje_tipos
      add constraint viaje_tipos_tarifa_unidad_check
      check (tarifa_unidad in ('viaje', 'ton'));
  end if;
end $$;

comment on column public.viaje_tipos.tarifa_unidad is
  'viaje = precio fijo por viaje (por defecto). ton = precio POR TONELADA, se multiplica por el peso a pagar del viaje.';

-- ── 2) La unidad CONGELADA en cada viaje ───────────────────────────────────
-- ⚠️ Sin esto, cambiarle la unidad a un tipo reescribiría en silencio lo ya
--    cobrado. Nullable a propósito: NULL es un viaje de antes de hoy, y el
--    código lo lee como 'viaje'. Rellenarlos con un UPDATE masivo sería tocar
--    ~miles de filas para decir lo que el default ya dice.
alter table public.camion_viajes
  add column if not exists tipo_viaje_unidad text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'camion_viajes_tipo_viaje_unidad_check'
  ) then
    alter table public.camion_viajes
      add constraint camion_viajes_tipo_viaje_unidad_check
      check (tipo_viaje_unidad is null or tipo_viaje_unidad in ('viaje', 'ton'));
  end if;
end $$;

comment on column public.camion_viajes.tipo_viaje_unidad is
  'Unidad de la tarifa CONGELADA al registrar el viaje. NULL = por viaje (viajes anteriores al 07-oct-2026).';

-- ── 3) Las tres tarifas por tonelada que pidió el cliente ──────────────────
-- Se crean AL LADO de las de siempre (este $30, Este → Oeste $100, oeste $50),
-- que no se tocan. El nombre dice la unidad porque el listero elige por el
-- nombre y dos pastillas iguales con precios distintos se marcan mal.
insert into public.viaje_tipos (nombre, tarifa_usd, tarifa_unidad, activo, updated_by_nombre)
select v.nombre, v.tarifa, 'ton', true, 'Carga inicial 07-oct-2026'
from (values
  ('Este · por tonelada',          2::numeric),
  ('Este → Oeste · por tonelada',  3::numeric),
  ('Oeste · por tonelada',         2::numeric)
) as v(nombre, tarifa)
where not exists (
  select 1 from public.viaje_tipos t where lower(btrim(t.nombre)) = lower(btrim(v.nombre))
);

-- ── 4) Qué quedó ───────────────────────────────────────────────────────────
select nombre, tarifa_usd, tarifa_unidad, activo
from public.viaje_tipos
order by tarifa_unidad, nombre;
