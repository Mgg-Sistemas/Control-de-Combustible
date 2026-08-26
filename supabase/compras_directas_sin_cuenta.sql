-- ============================================================================
-- COMPRAS DIRECTAS · YA NO GENERAN CUENTA POR PAGAR — 2026-08-26
--
-- Pedido del cliente: "las compras directas NO generan cuentas por pagar. NO
-- vincules eso, y lo que está vinculado bórralo. Las compras directas solo se
-- carga la factura y se pasa al inventario."
--
-- Esta migración:
--   1) REDEFINE direct_purchase_apply()  (INSERT) → solo carga al INVENTARIO.
--   2) REDEFINE direct_purchase_reapply() (UPDATE) → solo re-sincroniza el
--      INVENTARIO. Se elimina TODO el manejo de la cuenta por pagar.
--   3) BORRA las cuentas por pagar que se habían generado desde compras directas
--      (cuenta_abonos cae en cascada por su FK on delete cascade).
--   4) DESVINCULA: elimina el índice único y la columna cuentas.direct_purchase_id.
--
-- Idempotente. Requiere compras_directas.sql + compras_directas_editar.sql ya
-- corridos. Correr en Supabase → SQL Editor.
-- ============================================================================


-- ── 1) INSERT: solo inventario (sin cuenta por pagar) ───────────────────────
create or replace function public.direct_purchase_apply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  e        jsonb;
  v_item   uuid;
  v_name   text;
  v_qty    numeric;
  v_price  numeric;
  v_unit   text;
begin
  for e in select * from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) loop
    v_name  := upper(trim(coalesce(e->>'description', '')));
    v_qty   := coalesce(nullif(e->>'qty', '')::numeric, 0);
    v_price := coalesce(nullif(e->>'price', '')::numeric, 0);
    v_unit  := nullif(e->>'unit', '');
    if v_name = '' or v_qty <= 0 then continue; end if;

    -- Resolver el producto: item_id del renglón → por nombre → crear uno nuevo.
    v_item := nullif(e->>'item_id', '')::uuid;
    if v_item is null then
      select id into v_item from public.inventory_items
       where lower(name) = lower(v_name) limit 1;
    end if;
    if v_item is null then
      insert into public.inventory_items (name, category, unit, company_id)
      values (v_name, new.category, v_unit, new.company_id)
      returning id into v_item;
    end if;

    -- ENTRADA al inventario (el PMP se recalcula solo con su propio trigger).
    insert into public.inventory_movements
      (item_id, kind, qty, unit_cost, direct_purchase_id, company_id, reason, created_by)
    values
      (v_item, 'entrada', v_qty, v_price, new.id, new.company_id,
       'COMPRA DIRECTA ' || coalesce(new.code, ''), new.created_by);
  end loop;

  -- (Sin cuenta por pagar: una compra directa solo entra al inventario.)
  return new;
end $$;


-- ── 2) UPDATE: solo inventario (sin cuenta por pagar) ───────────────────────
create or replace function public.direct_purchase_reapply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  e       jsonb;
  v_item  uuid;
  v_name  text;
  v_qty   numeric;
  v_price numeric;
  v_unit  text;
begin
  -- ¿Cambió algo que afecte al inventario? (renglones, total, empresa o categoría)
  if (new.items      is distinct from old.items)
  or (new.total      is distinct from old.total)
  or (new.company_id is distinct from old.company_id)
  or (new.category   is distinct from old.category) then

    -- 1) revertir las entradas anteriores de esta compra
    delete from public.inventory_movements where direct_purchase_id = new.id;

    -- 2) recargar cada renglón como ENTRADA con su precio/cantidad nuevos
    for e in select * from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) loop
      v_name  := upper(trim(coalesce(e->>'description', '')));
      v_qty   := coalesce(nullif(e->>'qty', '')::numeric, 0);
      v_price := coalesce(nullif(e->>'price', '')::numeric, 0);
      v_unit  := nullif(e->>'unit', '');
      if v_name = '' or v_qty <= 0 then continue; end if;

      v_item := nullif(e->>'item_id', '')::uuid;
      if v_item is null then
        select id into v_item from public.inventory_items where lower(name) = lower(v_name) limit 1;
      end if;
      if v_item is null then
        insert into public.inventory_items (name, category, unit, company_id)
        values (v_name, new.category, v_unit, new.company_id)
        returning id into v_item;
      end if;

      insert into public.inventory_movements
        (item_id, kind, qty, unit_cost, direct_purchase_id, company_id, reason, created_by)
      values
        (v_item, 'entrada', v_qty, v_price, new.id, new.company_id,
         'COMPRA DIRECTA ' || coalesce(new.code, '') || ' (editada)', new.created_by);
    end loop;
  end if;

  -- (Sin cuenta por pagar: editar una compra directa solo re-sincroniza inventario.)
  return new;
end $$;


-- ── 3) BORRAR las cuentas por pagar ya generadas por compras directas ───────
-- cuenta_abonos tiene FK on delete cascade → sus abonos se borran solos.
delete from public.cuentas where direct_purchase_id is not null;


-- ── 4) DESVINCULAR: quitar índice único y columna de enlace ─────────────────
drop index if exists public.cuentas_direct_purchase_uniq;
alter table public.cuentas drop column if exists direct_purchase_id;


-- ── 5) VERIFICACIÓN (correr después) ────────────────────────────────────────
-- 5.1 · La columna de enlace ya NO existe (debe dar 0 filas).
select column_name from information_schema.columns
where table_schema='public' and table_name='cuentas' and column_name='direct_purchase_id';

-- 5.2 · No quedan cuentas cuyo concepto sea de compra directa (revisión suave).
select count(*) as cuentas_de_compra_directa_restantes
from public.cuentas
where concepto ilike 'compra directa%';

-- 5.3 · Las compras directas siguen cargando inventario (entradas) y ya sin cuenta.
select d.code, d.total,
       (select count(*) from public.inventory_movements m where m.direct_purchase_id = d.id) as entradas
from public.direct_purchases d
order by d.created_at desc
limit 20;
