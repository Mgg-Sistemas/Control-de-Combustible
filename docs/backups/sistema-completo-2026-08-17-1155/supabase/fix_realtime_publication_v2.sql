-- ============================================================================
-- FIX v2: completar la publicación `supabase_realtime` con las tablas
-- operativas que quedaron fuera del bloque "TIEMPO REAL" de schema.sql
-- (~línea 1847) y de supabase/fix_realtime_publication.sql (que ya agregó
-- machine_inspectors y truck_yard_logs).
-- ----------------------------------------------------------------------------
-- Sin estar en la publicación, Postgres no envía los cambios por el canal de
-- Realtime: el cliente (useTable / useRealtimeRefresh, ver src/hooks/useTable.ts
-- y src/hooks/useRealtime.ts) queda suscrito pero nunca recibe el evento, así
-- que la pantalla NO se actualiza sola (hay que refrescar a mano) aunque el
-- trigger de negocio sí corrió correctamente.
--
-- Tablas agregadas y de dónde sale cada una:
--
-- 1) Núcleo de combustible (pedidas explícitamente; no estaban en ningún
--    bloque de publicación):
--      · dispatches       — despachos/consumos de combustible.
--      · fuel_intakes     — ingresos de combustible.
--      · transfers        — traslados entre tanques.
--      · stock_movements  — movimiento de stock que alimenta la vista
--                            tank_levels (nivel de tanque derivado, ver
--                            AGENTS.md "Reglas de negocio").
--
-- 2) tanks — encontrada al investigar quién consume `stock_movements`:
--    src/screens/DashboardScreen.tsx:88
--      useTable<TankLevel>('tank_levels', { realtimeFrom: ['stock_movements', 'tanks'] })
--    El Dashboard pide explícitamente refresco al cambiar `tanks` (además de
--    `stock_movements`), así que si falta igual queda desactualizado el
--    nombre/capacidad del tanque en el panel en vivo.
--
-- 3) Compras (src/screens/ComprasScreen.tsx, confirmado con
--    grep ".from(" + grep "useTable"):
--      · purchase_requests — línea 199: useTable<PurchaseRequest>('purchase_requests', ...)
--      · purchase_orders   — línea 339: useTable<PurchaseOrder>('purchase_orders', ...)
--      · suppliers         — línea 341: useTable<Supplier>('suppliers', ...)
--    (companies e inventory_levels que también usa esta pantalla ya están
--    cubiertas: companies está en el bloque original de schema.sql;
--    inventory_levels es una VIEW derivada de inventory_movements/inventory_items,
--    que ya están publicadas — las vistas no se agregan a la publicación).
--
-- 4) Nómina (src/screens/NominaScreen.tsx):
--      · payroll_periods — línea 37: useTable<PayrollPeriod>('payroll_periods', ...)
--    (payroll_items se lee con consultas directas, no con useTable/
--    useRealtimeRefresh, así que no necesita estar en la publicación para que
--    esta pantalla funcione).
--
-- 5) Pago de personal (src/screens/PagoPersonalScreen.tsx):
--      · staff_pay_periods — línea 111: useTable<StaffPayPeriod>('staff_pay_periods', ...)
--    (staff_pay_items y staff_pay_payments también se leen con consultas
--    directas, no con useTable/useRealtimeRefresh).
--
-- Nota sobre src/screens/ControlPagosScreen.tsx: se revisó con el mismo grep
-- y NO usa useTable ni useRealtimeRefresh (son fetch directos con
-- Promise.all/supabase.from(...).select(...)); por eso company_payments,
-- control_closures, payrolls, price_tariffs y company_price_tariffs no se
-- agregan aquí. company_payments y control_closures ya estaban en el bloque
-- original de schema.sql de cualquier forma.
--
-- 6) attendance — SE REPITE aquí a propósito. Ya está en el array del bloque
--    "TIEMPO REAL" de schema.sql (~línea 1847-1866), pero en una instalación
--    NUEVA (schema.sql corrido de una sola vez, de arriba hacia abajo) ese
--    ALTER falla en silencio: la tabla `public.attendance` recién se crea más
--    abajo, en la línea 1918 (`create table if not exists public.attendance`),
--    es decir DESPUÉS del bloque que intenta publicarla. El `exception when
--    others then null` del bloque de schema.sql traga el error de "la tabla
--    no existe" sin avisar, así que en instalaciones limpias `attendance`
--    queda fuera de la publicación aunque el código de schema.sql "parezca"
--    incluirla. Este script (v2) se ejecuta DESPUÉS de que todo schema.sql ya
--    corrió, así que aquí la tabla sí existe y el ALTER sí tiene efecto.
--
--    NO se reordena schema.sql para no arriesgar romper otras referencias del
--    archivo (es un cambio quirúrgico de bajo riesgo dejarlo acá). Si en algún
--    momento se quiere corregir de raíz: mover el bloque `do $$ ... foreach t
--    in array [...] ... end $$` de la sección "TIEMPO REAL" (línea ~1847) al
--    FINAL de schema.sql (después de que todas las tablas, incluida
--    `attendance`, ya estén creadas).
--
-- `add table` lanza error si la tabla ya está en la publicación; por eso cada
-- ALTER va envuelto en su propio bloque con EXCEPTION (mismo patrón que
-- schema.sql y fix_realtime_publication.sql). Idempotente: se puede correr
-- las veces que haga falta sin efectos secundarios.
--
-- EJECUTAR MANUALMENTE en Supabase → SQL Editor (producción), después de
-- schema.sql y de fix_realtime_publication.sql.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    -- Núcleo de combustible.
    'dispatches', 'fuel_intakes', 'transfers', 'stock_movements', 'tanks',
    -- Compras.
    'purchase_requests', 'purchase_orders', 'suppliers',
    -- Nómina.
    'payroll_periods',
    -- Pago de personal.
    'staff_pay_periods',
    -- Re-intento de attendance (ver nota arriba sobre el orden en schema.sql).
    'attendance'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; when others then null;
    end;
  end loop;
end $$;

-- Verificación opcional (correr aparte para confirmar que quedaron incluidas):
-- select schemaname, tablename from pg_publication_tables
-- where pubname = 'supabase_realtime'
-- order by tablename;
