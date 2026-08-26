-- ============================================================================
-- COMPRAS DIRECTAS · EDITAR una compra ya cargada — 2026-08-24
--
-- Pedido del cliente: "permite editar la compra una vez cargada".
-- compras_directas.sql carga el inventario SOLO en INSERT. Aquí se agrega el manejo
-- de UPDATE: al editar renglones/precios, la base REVIERTE las entradas anteriores
-- de esa compra (borra sus inventory_movements; el stock y el PMP se recalculan
-- solos) y las vuelve a cargar con los datos nuevos.
--
-- ACTUALIZADO 26-ago-2026: las compras directas YA NO generan cuenta por pagar
-- (ver compras_directas_sin_cuenta.sql), así que la edición ya no toca `cuentas`.
--
-- SECURITY DEFINER (igual que direct_purchase_apply): el reflejo ocurre aunque el
-- usuario no tenga permiso directo de inventario. No recursiona: sólo toca
-- inventory_movements, no direct_purchases. Idempotente.
--
-- OJO: si una entrada ya fue consumida (hay salidas de ese producto), revertirla
-- puede dejar el stock corto; edita las compras antes de despachar su mercancía.
-- Requiere compras_directas.sql ya corrido. Correr en Supabase → SQL Editor.
-- ============================================================================

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

drop trigger if exists trg_direct_purchase_reapply on public.direct_purchases;
create trigger trg_direct_purchase_reapply
  after update on public.direct_purchases
  for each row execute function public.direct_purchase_reapply();

-- ── VERIFICACIÓN ────────────────────────────────────────────────────────────
select tgname from pg_trigger
where tgrelid = 'public.direct_purchases'::regclass and not tgisinternal
order by tgname;   -- deben salir: assign_code, apply (insert) y reapply (update)
