-- Vincula las salidas de inventario (inventory_movements) con los empleados que
-- reciben la mercancía, para poder consultar el historial de dotación/herramientas
-- por empleado y mostrar cédula/cargo en los reportes de salida.
-- Antes, el empleado solo quedaba como texto suelto dentro de "reason" (no consultable).

alter table public.inventory_movements
  add column if not exists employee_ids uuid[] not null default '{}',
  add column if not exists employees_detail jsonb not null default '[]';

comment on column public.inventory_movements.employee_ids is
  'IDs de employees que reciben esta salida (multi, snapshot al momento del registro).';
comment on column public.inventory_movements.employees_detail is
  'Snapshot [{id,name,cedula,cargo}] de cada empleado al momento de la salida, para reportes históricos aunque luego cambien los datos del empleado.';

create index if not exists inventory_movements_employee_ids_idx
  on public.inventory_movements using gin (employee_ids);
