-- ============================================================================
-- REQUERIMIENTO → COMPRAS  (migración de BD, 2026-08-18)
--
-- El submódulo Requerimiento (tabla `inventory_requirements`, correlativo
-- REQ-####) se lleva de INVENTARIO a COMPRAS y se conecta hacia adelante:
--
--   Requerimiento APROBADO ──► ORDEN DE COMPRA (borrador si NO hay proveedor)
--        │                        └─ al asignar PROVEEDOR ─► orden 'aprobada'
--        │                                                   └─ CUENTA POR PAGAR
--        └─ RECIBIDO ─► la recepción sigue cargando stock en INVENTARIO (no cambia)
--
-- Decisiones (confirmadas con el cliente):
--   · Proveedor OPCIONAL: la orden nace en BORRADOR; sin proveedor NO hay cuenta.
--   · Al asignar proveedor: orden 'aprobada' + cuenta 'por_pagar' por el monto.
--   · La recepción se queda en Inventario (el mismo usuario de almacén recibe;
--     necesita permiso 'compras' además de 'inventario').
--   · Se conserva la estructura de aprobación (pendiente→aprobado/rechazado→recibido).
--   · Se mantiene `inventory_requirements` como tabla canónica (NO se copia a
--     `purchase_requests`). "Migrar históricos" = re-homing, sin mover filas.
--
-- Patrón: calcado de `supabase/fabricacion_mangueras_cuenta_por_pagar.sql`
-- (índice único parcial de origen + trigger SECURITY DEFINER idempotente).
--
-- Idempotente: seguro de correr más de una vez. Requiere que ya existan
-- `inventory_requirements`, `suppliers`, `purchase_orders` y `cuentas`.
-- Correr en Supabase → SQL Editor (el anon key ya no escribe tablas operativas).
-- ============================================================================


-- ── 1) inventory_requirements: PROVEEDOR opcional del catálogo ──────────────
-- ON DELETE SET NULL: borrar un proveedor no borra el requerimiento (y `cuentas`
-- ya bloquea con RESTRICT borrar un proveedor con deudas vivas).
alter table public.inventory_requirements
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
create index if not exists idx_invreq_supplier on public.inventory_requirements(supplier_id);


-- ── 2) Enlaces de ORIGEN (1 orden y 1 cuenta por requerimiento) ─────────────
-- Índice único PARCIAL: garantiza una sola orden / una sola cuenta por
-- requerimiento (permite muchas filas con la columna NULL: las normales).
alter table public.purchase_orders
  add column if not exists inventory_requirement_id uuid
    references public.inventory_requirements(id) on delete set null;
create unique index if not exists purchase_orders_invreq_uniq
  on public.purchase_orders(inventory_requirement_id) where inventory_requirement_id is not null;

alter table public.cuentas
  add column if not exists inventory_requirement_id uuid
    references public.inventory_requirements(id) on delete set null;
create unique index if not exists cuentas_invreq_uniq
  on public.cuentas(inventory_requirement_id) where inventory_requirement_id is not null;


-- ── 3) AFTER: generar / sincronizar ORDEN DE COMPRA y CUENTA POR PAGAR ──────
-- SECURITY DEFINER: la orden y la cuenta se generan aunque el usuario que
-- aprueba el requerimiento no tenga permiso directo de 'compras' / 'cuentas'
-- (es un reflejo automático). No hay recursión: escribe en purchase_orders y
-- cuentas, no en inventory_requirements.
create or replace function public.req_sync_compra()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total        numeric(14,2);
  v_items_compra jsonb;
  v_estado_orden text;
  v_concepto     text;
  v_actor        uuid := coalesce(new.decided_by, new.requested_by);
begin
  -- ── RECHAZADO: anular el reflejo (orden no recibida + cuenta no pagada) ──
  if new.status = 'rechazado' then
    update public.purchase_orders o
       set status = 'anulada', note = coalesce(o.note,'') , received_at = o.received_at
     where o.inventory_requirement_id = new.id and o.status <> 'recibida';
    update public.cuentas c
       set estado = 'anulada', updated_at = now()
     where c.inventory_requirement_id = new.id and c.estado = 'pendiente';
    return new;
  end if;

  -- Solo generamos reflejo cuando el requerimiento ya fue aprobado/recibido.
  if new.status not in ('aprobado', 'recibido') then
    return new;
  end if;

  -- Monto total (Σ qty * est_price) e ítems mapeados al formato de compras
  -- ({description, qty, unit, price}). nullif evita que un '' rompa el cast.
  select
    coalesce(sum( coalesce(nullif(e->>'qty','')::numeric, 0)
                * coalesce(nullif(e->>'est_price','')::numeric, 0) ), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'description', coalesce(e->>'name',''),
      'qty',         coalesce(nullif(e->>'qty','')::numeric, 0),
      'unit',        coalesce(e->>'unit',''),
      'price',       coalesce(nullif(e->>'est_price','')::numeric, 0)
    )), '[]'::jsonb)
  into v_total, v_items_compra
  from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) e;

  -- Escalera de estado de la orden.
  v_estado_orden := case
    when new.supplier_id is null    then 'borrador'
    when new.status = 'recibido'    then 'recibida'
    else 'aprobada'
  end;

  -- ── Upsert ORDEN DE COMPRA (1 por requerimiento) ──
  insert into public.purchase_orders (
    inventory_requirement_id, supplier_id, company_id, category, note,
    items, total, status, approved_by, approved_at, received_at, created_by
  ) values (
    new.id, new.supplier_id, new.company_id, null,
    'Generada automáticamente desde Requerimiento ' || coalesce(new.code,''),
    v_items_compra, v_total, v_estado_orden,
    case when new.supplier_id is not null then new.decided_by else null end,
    case when new.supplier_id is not null then new.decided_at else null end,
    case when new.status = 'recibido' then new.received_at else null end,
    v_actor
  )
  on conflict (inventory_requirement_id) where inventory_requirement_id is not null
  do update set
    supplier_id = excluded.supplier_id,
    company_id  = excluded.company_id,
    items       = excluded.items,
    total       = excluded.total,
    -- No se reabre una orden anulada a mano; recibida se respeta.
    status      = case when public.purchase_orders.status in ('anulada','recibida')
                       then public.purchase_orders.status else excluded.status end,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    received_at = coalesce(excluded.received_at, public.purchase_orders.received_at);

  -- ── CUENTA POR PAGAR: solo si hay proveedor y monto (constraint 'por_pagar'
  --    exige supplier_id). Sin proveedor la orden queda en borrador y no hay deuda.
  if new.supplier_id is null or v_total <= 0 then
    -- Si antes tenía proveedor y se lo quitaron, anular la cuenta viva.
    update public.cuentas c
       set estado = 'anulada', updated_at = now()
     where c.inventory_requirement_id = new.id and c.estado = 'pendiente';
    return new;
  end if;

  v_concepto := 'Requerimiento ' || coalesce(new.code,'') ||
                case when coalesce(new.title,'') <> '' then ' · ' || new.title else '' end;

  insert into public.cuentas (
    tipo, supplier_id, company_id, order_id, inventory_requirement_id,
    concepto, documento, monto, moneda, fecha_emision, estado, nota, created_by
  ) values (
    'por_pagar', new.supplier_id, null,
    (select id from public.purchase_orders where inventory_requirement_id = new.id),
    new.id, v_concepto, new.code, v_total, 'USD', coalesce(new.decided_at::date, current_date),
    'pendiente',
    'Generada automáticamente desde Requerimiento ' || coalesce(new.code,'') ||
      '. El monto se sincroniza con los ítems aprobados.',
    v_actor
  )
  on conflict (inventory_requirement_id) where inventory_requirement_id is not null
  do update set
    supplier_id = excluded.supplier_id,
    order_id    = excluded.order_id,
    concepto    = excluded.concepto,
    documento   = excluded.documento,
    monto       = excluded.monto,
    -- No se toca una cuenta ya pagada o anulada a mano; si sigue pendiente, se
    -- mantiene pendiente (la recepción NO la salda: se paga aparte).
    estado      = case when public.cuentas.estado in ('pagada','anulada')
                       then public.cuentas.estado else 'pendiente' end,
    updated_at  = now();

  return new;
end $$;

drop trigger if exists trg_req_sync_compra on public.inventory_requirements;
create trigger trg_req_sync_compra
  after insert or update on public.inventory_requirements
  for each row execute function public.req_sync_compra();


-- ── 4) PERMISOS: la escritura del requerimiento pasa a 'compras' ────────────
-- Transición sin cortar acceso: se acepta 'compras' O 'inventario' mientras se
-- otorga 'compras' a quien hoy administra por Inventario. Cerrada la transición
-- se puede dejar solo can_write_module('compras').
drop policy if exists invreq_write on public.inventory_requirements;
create policy invreq_write on public.inventory_requirements for all to authenticated
  using (public.can_write_module('compras') or public.can_write_module('inventario'))
  with check (public.can_write_module('compras') or public.can_write_module('inventario'));

-- Otorgar 'compras' al usuario de almacén (que ya tiene 'inventario' para recibir).
-- Descomentar y poner la(s) cédula/uuid reales:
-- insert into public.module_permissions (user_id, module, level)
-- values ('<uuid-del-usuario-almacen>', 'compras', 'write')
-- on conflict (user_id, module) do update set level = 'write';


-- ── 5) BACKFILL opcional: conectar históricos que YA tienen proveedor ───────
-- Dispara el trigger sobre requerimientos aprobados/recibidos CON proveedor
-- (los sin proveedor no generan deuda). Seguro por los índices únicos parciales.
update public.inventory_requirements
   set note = note                        -- no-op que dispara el trigger (no hay updated_at)
 where status in ('aprobado','recibido') and supplier_id is not null;


-- ── 6) VERIFICACIÓN (correr después) ────────────────────────────────────────
-- 6.1 · Columnas nuevas existen.
select 'inventory_requirements.supplier_id' as col,
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='inventory_requirements' and column_name='supplier_id') as ok
union all
select 'purchase_orders.inventory_requirement_id',
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='purchase_orders' and column_name='inventory_requirement_id')
union all
select 'cuentas.inventory_requirement_id',
       exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='cuentas' and column_name='inventory_requirement_id');

-- 6.2 · Trigger creado.
select tgname from pg_trigger
where tgrelid = 'public.inventory_requirements'::regclass and not tgisinternal
order by tgname;

-- 6.3 · Órdenes / cuentas generadas desde requerimientos.
select r.code as requerimiento, r.status, s.name as proveedor,
       o.status as orden, o.total, c.estado as cuenta, c.monto
from public.inventory_requirements r
left join public.purchase_orders o on o.inventory_requirement_id = r.id
left join public.cuentas         c on c.inventory_requirement_id = r.id
left join public.suppliers       s on s.id = r.supplier_id
where r.status in ('aprobado','recibido')
order by r.created_at desc;
