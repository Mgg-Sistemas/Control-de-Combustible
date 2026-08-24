-- ============================================================================
-- COMPRAS DIRECTAS · EDITAR una compra ya cargada — 2026-08-24
--
-- Pedido del cliente: "permite editar la compra una vez cargada".
-- compras_directas.sql cargaba el inventario + la cuenta SOLO en INSERT. Aquí se
-- agrega el manejo de UPDATE: al editar renglones/precios/proveedor, la base:
--   1) REVIERTE las entradas anteriores de esa compra (borra sus inventory_movements;
--      el stock y el PMP se recalculan solos) y las vuelve a cargar con los datos nuevos;
--   2) RE-SINCRONIZA la cuenta por pagar (monto, proveedor, documento); si se quitó el
--      proveedor o el total quedó en 0, la anula.
--
-- SECURITY DEFINER (igual que direct_purchase_apply): el reflejo ocurre aunque el
-- usuario no tenga permiso directo de inventario/cuentas. No recursiona: sólo toca
-- inventory_movements y cuentas, no direct_purchases. Idempotente.
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

  -- 3) re-sincronizar la CUENTA POR PAGAR
  if new.supplier_id is not null and coalesce(new.total, 0) > 0 then
    insert into public.cuentas (
      tipo, supplier_id, company_id, direct_purchase_id,
      concepto, documento, monto, moneda, fecha_emision, estado, nota, created_by
    ) values (
      'por_pagar', new.supplier_id, null, new.id,
      'Compra directa ' || coalesce(new.code, ''),
      coalesce(nullif(new.factura_name, ''), new.code),
      new.total, 'USD', coalesce(new.created_at::date, current_date), 'pendiente',
      'Generada automáticamente desde Compra Directa ' || coalesce(new.code, '') || '.',
      new.created_by
    )
    on conflict (direct_purchase_id) where direct_purchase_id is not null
    do update set
      supplier_id = excluded.supplier_id,
      documento   = excluded.documento,
      concepto    = excluded.concepto,
      monto       = excluded.monto,
      estado      = case when cuentas.estado = 'pagada' then 'pagada' else 'pendiente' end,
      updated_at  = now();
  else
    -- sin proveedor o total 0 → anular la cuenta si existía
    update public.cuentas
       set estado = 'anulada', updated_at = now()
     where direct_purchase_id = new.id and estado <> 'anulada';
  end if;

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
