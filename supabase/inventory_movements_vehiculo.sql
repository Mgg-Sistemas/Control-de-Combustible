-- ============================================================================
-- VEHÍCULO DESTINO DE LA NOTA DE SALIDA (07-sep-2026)
-- La pestaña Salida de Inventario ahora deja elegir un VEHÍCULO (tabla vehicles,
-- la pestaña Vehículos del Catálogo de equipos) además de la máquina y los
-- empleados. Caso que lo motivó: darle salida a un Starlink que va en una camioneta.
-- Igual que machinery_id (mantenimiento_reporte.sql): el vehículo ya queda en el
-- texto (reason) y en el PDF; esta columna lo guarda ESTRUCTURADO para poder
-- consultarlo por vehículo más adelante.
-- Idempotente. Sin correrla la app registra la salida igual: reintenta sin la
-- columna y solo se pierde el vínculo interno (no el dato del PDF ni del texto).
-- ============================================================================
alter table public.inventory_movements
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
create index if not exists idx_inv_mov_vehicle on public.inventory_movements(vehicle_id);
comment on column public.inventory_movements.vehicle_id is
  'Vehículo (vehicles.id) al que se le entregó la salida de inventario. Nulo si fue a una máquina, a un empleado o a texto libre.';

-- ¿Quedó? Debe devolver 1 fila con vehicle_id.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'vehicle_id';
