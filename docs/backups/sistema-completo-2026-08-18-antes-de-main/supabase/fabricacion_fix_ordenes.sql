-- ============================================================================
-- Módulo de Fabricación (MRP) — Fase 3 (parche): candados de base de datos
-- para Órdenes de Fabricación (MO), complementando supabase/fabricacion_ordenes.sql
-- (YA EJECUTADO en producción — por eso este es un archivo NUEVO y no una
-- edición de aquel).
--
-- Este archivo es 100% ADITIVO:
--   - No modifica, ni borra, ni renombra ninguna tabla/columna existente.
--   - Todo lo que sigue son 2 funciones + 2 triggers NUEVOS sobre tablas ya
--     existentes (manufacturing_orders, inventory_movements): ningún dato
--     existente se toca, ninguna fila cambia por correr esto.
-- Idempotente: usa `create or replace` en las funciones y `drop trigger if
-- exists` antes de recrear los triggers. Seguro de correr más de una vez y
-- seguro de correr en producción.
--
-- Convenciones seguidas (mismo estilo que supabase/fabricacion_calidad_oee.sql
-- y el candado de stock ya existente para combustible en supabase/schema.sql,
-- funciones mv_dispatch()/mv_transfer(): `raise exception` con mensaje claro
-- en español, `security definer`, `set search_path = public`).
-- ============================================================================

-- ============================================================================
-- 1) CANDADO REAL contra doble "Cerrar orden" (ManufacturingOrdersScreen.tsx,
--    cerrarOrden()). Hoy el único freno era la UI (deshabilitar el botón
--    mientras `busyAction === 'cerrar'`), que no protege contra dos pestañas/
--    usuarios distintos disparando el cierre casi al mismo tiempo: ambos
--    UPDATE podían colar antes de que el primero terminara, duplicando el
--    movimiento de inventario (doble consumo, doble entrada del producto
--    terminado). Este trigger rechaza cualquier UPDATE que intente dejar
--    `status = 'cerrada'` en una fila que YA estaba en `'cerrada'`: la
--    segunda transacción, aunque llegue a leer la fila "vieja" antes del
--    commit de la primera, siempre corre DESPUÉS a nivel de fila (Postgres
--    serializa los UPDATE concurrentes sobre la misma fila con su locking
--    normal de MVCC), así que ve el estado ya actualizado y el trigger la
--    frena. Mismo patrón de "candado real" que
--    check_wo_quality_gate()/trg_check_wo_quality_gate en
--    supabase/fabricacion_calidad_oee.sql.
-- ============================================================================
create or replace function public.check_mo_no_double_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'cerrada' and OLD.status = 'cerrada' then
    raise exception 'Esta orden ya está cerrada: no se puede cerrar dos veces.';
  end if;
  return NEW;
end $$;

drop trigger if exists trg_check_mo_no_double_close on public.manufacturing_orders;
create trigger trg_check_mo_no_double_close
  before update on public.manufacturing_orders
  for each row
  when (NEW.status = 'cerrada')
  execute function public.check_mo_no_double_close();

-- ============================================================================
-- 2) GUARDA DE STOCK NEGATIVO en inventory_movements. Se revisó supabase/
--    schema.sql: SÍ existe este patrón para combustible (mv_dispatch() y
--    mv_transfer() comparan contra `tank_levels.current_l` antes de insertar
--    y hacen `raise exception 'Stock insuficiente...'` si no alcanza — ver
--    AGENTS.md: "No se puede despachar/trasladar más litros que el stock
--    disponible"), pero NO existe ningún trigger equivalente sobre
--    `inventory_movements` (el ledger de Inventario/Almacén, distinto del de
--    combustible): hoy se puede insertar una salida/consumo por más de lo
--    que hay en existencia y el stock derivado (`inventory_levels.stock`,
--    misma fórmula usada aquí) queda en negativo sin que nada lo impida. Se
--    replica EXACTAMENTE el mismo patrón para `inventory_movements`, aplicado
--    a los movimientos que RESTAN stock ('salida' y 'consumo' — igual que la
--    fórmula de `inventory_levels` en schema.sql). 'entrada' y 'ajuste' no se
--    tocan: 'ajuste' puede ser negativo a propósito (correcciones de
--    inventario), tal como ya documenta su columna en schema.sql.
--
--    Esto también cubre, sin necesidad de un trigger aparte, el cierre de
--    una MO con semáforo 🔴/🟡: `cerrarOrden()` en ManufacturingOrdersScreen.tsx
--    inserta movimientos 'consumo' por `qty_required` de cada componente del
--    snapshot, así que si el stock real no alcanza, este mismo trigger frena
--    el insert completo (todo el `insert(movRows)` de la pantalla es un único
--    statement, así que también frena el 'entrada' del producto terminado:
--    no queda un cierre a medias).
-- ============================================================================
create or replace function public.check_inventory_stock_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare available numeric;
begin
  if NEW.kind in ('salida', 'consumo') then
    select coalesce(sum(
             case when kind = 'entrada' then qty
                  when kind in ('salida', 'consumo') then -qty
                  when kind = 'ajuste' then qty
                  else 0 end
           ), 0)
      into available
      from public.inventory_movements
     where item_id = NEW.item_id;

    if coalesce(available, 0) < coalesce(NEW.qty, 0) then
      raise exception 'Stock insuficiente en el producto (disponible %, solicitado %)', coalesce(available, 0), NEW.qty;
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_check_inventory_stock_guard on public.inventory_movements;
create trigger trg_check_inventory_stock_guard
  before insert on public.inventory_movements
  for each row execute function public.check_inventory_stock_guard();
