import { selectAllRows } from './supabase';
import { HistorialPrecios, indexarHistorialPrecios } from './precioHistorial';

/**
 * Lee el historial de cambios de precio de todas las máquinas (tabla chica: una fila
 * por cambio). Si la lectura falla, LANZA: calcular montos sin historial volvería a
 * cobrar lo pasado con el precio de hoy, y eso es justo lo que se quiso evitar.
 */
export async function cargarHistorialPrecios(): Promise<HistorialPrecios> {
  const filas = await selectAllRows(
    'machinery_precio_historial',
    'id, machinery_id, precio_anterior, vigente_desde, cambiado_at',
  );
  return indexarHistorialPrecios(filas);
}
