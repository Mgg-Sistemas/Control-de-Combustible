-- ============================================================================
-- Datos de demostración para "Control de Combustible".
-- Ejecutar DESPUÉS de schema.sql, en Supabase Studio > SQL Editor.
-- Los movimientos de stock se generan solos vía triggers.
-- ============================================================================
do $$
declare
  t_diesel  uuid;
  t_gas     uuid;
  t_movil   uuid;
  v1        uuid;
  m1        uuid;
begin
  -- Tanques
  insert into public.tanks (name, location, fuel, capacity_l)
    values ('Tanque Principal Diésel', 'Patio central', 'diesel', 20000) returning id into t_diesel;
  insert into public.tanks (name, location, fuel, capacity_l)
    values ('Tanque Gasolina', 'Patio central', 'gasolina', 8000) returning id into t_gas;
  insert into public.tanks (name, location, fuel, capacity_l, is_mobile)
    values ('Cisterna Móvil Diésel', 'Camión cisterna', 'diesel', 5000, true) returning id into t_movil;

  -- Vehículo y maquinaria
  insert into public.vehicles (plate, brand, model, vehicle_type, tank_capacity_l, expected_kml)
    values ('ABC-123', 'Toyota', 'Hilux', 'Camioneta', 80, 9.5) returning id into v1;
  insert into public.machinery (code, description, machinery_type, expected_lph)
    values ('EXC-01', 'Excavadora CAT 320', 'Excavadora', 18) returning id into m1;

  -- Ingresos (suman stock)
  insert into public.fuel_intakes (supplier, fuel, liters, unit_cost, total_cost, tank_id, invoice_no)
    values ('PDVSA', 'diesel', 15000, 0.50, 7500, t_diesel, 'F-0001'),
           ('PDVSA', 'gasolina', 6000, 0.55, 3300, t_gas, 'F-0002');

  -- Consumos (restan stock)
  insert into public.dispatches (asset_kind, vehicle_id, liters, odometer_km, driver_operator, tank_id)
    values ('vehiculo', v1, 60, 124500, 'Juan Pérez', t_diesel);
  insert into public.dispatches (asset_kind, machinery_id, liters, hourmeter_h, driver_operator, tank_id)
    values ('maquinaria', m1, 200, 3450, 'Luis Gómez', t_diesel);

  -- Traslado entre tanques (diésel principal -> cisterna móvil)
  insert into public.transfers (from_tank_id, to_tank_id, liters, notes)
    values (t_diesel, t_movil, 2000, 'Carga inicial de cisterna');
end $$;
