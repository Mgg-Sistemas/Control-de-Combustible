-- ============================================================================
-- «OTROS» NACE CON HIELO Y AGUA (23-sep-2026)
--
-- 👉 CÓMO SE CORRE: copiar ESTE ARCHIVO COMPLETO, pegarlo en Supabase → SQL
--    Editor y darle RUN una sola vez. Es idempotente: correrlo dos veces no
--    duplica nada ni pisa nada.
--
-- ⚠️ REQUIERE `supabase/comida_otros_costo.sql` CORRIDO ANTES (es el que creó
--    `food_extra_items`, la lista de opciones de «Otros»).
--
-- PEDIDO DEL CLIENTE, TEXTUAL
-- ---------------------------------------------------------------------------
--   «el segmento que se llama OTROS, sea HIELO, AGUA, y coloca un + para agregar
--    otras opciones. Esto llevará un costo que colocará el usuario, en la factura
--    se debe reflejar como AGUA, Hielo»
--
-- QUÉ HACE ESTE ARCHIVO, Y QUÉ NO
-- ---------------------------------------------------------------------------
--   ✅ Deja HIELO y AGUA en la lista, para que la cocina las vea de una sin tener
--      que escribirlas. El «+» de la pantalla sirve para agregar las que sigan.
--   🚫 NO les pone precio. El costo lo pone el usuario: al registrar la entrega
--      (costo por plato) o, mejor, en «💲 Precios y cuentas → 🧾 Platos», que es
--      el que manda y queda con su historial. Mientras no tengan precio salen en
--      amarillo en esa pestaña, que es justo el recordatorio que hace falta.
--   🚫 NO toca ninguna entrega ya registrada. Las de «Otros» viejas siguen como
--      están; lo único que cambió es cómo se ESCRIBEN en el papel (por su opción
--      y no como «Otros»), y eso es de la app, no de la base.
--
-- POR QUÉ MAYÚSCULAS. Así las pidió el cliente y así salen en la factura. El
-- índice único de la lista es sobre `lower(name)`, así que «HIELO» y «Hielo» son
-- la misma opción: si alguien ya había escrito «hielo» al registrar, este script
-- NO crea otra ni le cambia el nombre (se respeta lo que ya se estaba usando, que
-- es lo que tienen escrito las entregas viejas).
-- ============================================================================


-- ── 1) HIELO Y AGUA EN LA LISTA ─────────────────────────────────────────────
-- `on conflict do nothing` contra el índice único de `lower(name)`: si la opción
-- ya existe con cualquier combinación de mayúsculas, no pasa nada.
insert into public.food_extra_items (name)
select v.name
from (values ('HIELO'), ('AGUA')) as v(name)
where not exists (
  select 1 from public.food_extra_items f where lower(f.name) = lower(v.name)
);


-- ── 2) SI ESTABAN QUITADAS DE LA LISTA, VUELVEN ─────────────────────────────
-- Una opción no se borra nunca: se quita de la lista (`active = false`) para que
-- sus entregas viejas se sigan cobrando. Si alguien había quitado hielo o agua,
-- este script las devuelve: el cliente acaba de pedir que estén.
update public.food_extra_items
   set active = true
 where lower(name) in ('hielo', 'agua')
   and active = false;


-- ── 3) VERIFICACIÓN (las dos primeras filas tienen que decir ✅) ────────────
select chequeo, valor, case when ok then '✅' else '❌ REVISAR' end as estado
from (
  select 1 as n, 'HIELO en la lista' as chequeo,
         coalesce((select name from public.food_extra_items
                    where lower(name) = 'hielo' and active), 'no está') as valor,
         exists (select 1 from public.food_extra_items
                  where lower(name) = 'hielo' and active) as ok
  union all
  select 2, 'AGUA en la lista',
         coalesce((select name from public.food_extra_items
                    where lower(name) = 'agua' and active), 'no está'),
         exists (select 1 from public.food_extra_items where lower(name) = 'agua' and active)
  union all
  -- INFORMATIVO: cuántas opciones hay en total. Las que el cliente agregue con el
  -- «+» de la pantalla se suman acá, no hace falta volver a correr nada.
  select 3, 'Opciones de «Otros» en la lista',
         (select count(*)::text from public.food_extra_items where active),
         true
  union all
  -- CONTROL: este script NO toca ni una entrega ya registrada.
  select 4, 'Entregas de «Otros» ya registradas (este script NO las toca)',
         (select count(*)::text from public.food_company_meals where meal_type = 'otros'),
         true
) t
order by n;


-- ============================================================================
-- DESPUÉS DE CORRER ESTO
-- ---------------------------------------------------------------------------
--   1. Ctrl+Shift+R en la app.
--   2. Ponerles el costo en «💲 Precios y cuentas → 🧾 Platos» (botón «💲 Precio»).
--      Mientras no lo tengan se cobran con el costo que escriba la cocina al
--      registrar, y si tampoco hay, no suman y el papel lo dice.
--
-- DESHACER (solo si hay que revertir):
--   update public.food_extra_items set active = false
--    where lower(name) in ('hielo', 'agua');
--   -- (No se borran: sus entregas tienen que poder seguir cobrándose.)
-- ============================================================================
