-- ============================================================================
-- REPORTE DE MANTENIMIENTO (gasto por equipo) — vincula la SALIDA de inventario
-- con el EQUIPO al que se le entregó el material, para poder calcular cuánto
-- dinero genera cada máquina en averías (materiales que salieron del almacén
-- para ella × su costo).
-- Antes el equipo destino solo quedaba en el texto (reason) de la salida; ahora
-- se guarda estructurado en machinery_id para sumarlo con precisión.
-- Idempotente. Sin correrla, el reporte igual atribuye el gasto de las salidas
-- VIEJAS leyendo el nombre del equipo del texto, pero las NUEVAS quedan exactas.
-- ============================================================================
alter table public.inventory_movements
  add column if not exists machinery_id uuid references public.machinery(id) on delete set null;
create index if not exists idx_inv_mov_machine on public.inventory_movements(machinery_id);
