// 🔎 BUSCAR EN AUDITORÍA POR UN NOMBRE QUE YA NO EXISTE (24-oct-2026).
//
// Pedido del cliente: «si yo busco APP26 en auditoría me debería salir la última vez
// que tenía ese nombre o el día que le cambiaron el nombre».
//
// El buscador de Auditoría reconoce una máquina por su ficha de HOY (código, placa,
// serial…): resuelve el texto a su id y trae lo que le pasó. Pero si a la máquina le
// cambiaron el serial, el viejo ya no está en ninguna ficha — vive solamente dentro
// del antes/después de ese cambio (`changes.serial.de`), y ahí no se buscaba. Por eso
// «APP26» no encontraba nada aunque el cambio estuviera en la bitácora.
//
// Esta regla arma el filtro que mira el valor de ANTES y el de DESPUÉS de los mismos
// campos con los que el buscador reconoce una máquina hoy. Es barato: la pantalla lo
// acota a máquinas/vehículos y a acciones de tabla (índice por `table_name`; medido el
// 24-oct-2026 sobre ~34 mil filas de toda la historia: 27 ms).
//
// Sin imports, a propósito: se prueba sola (scripts/test-auditoria-nombres-anteriores.mjs).

/** Los campos de la ficha con los que el buscador ya reconoce una máquina hoy
 *  (los mismos del `.or()` sobre `machinery` en AuditScreen). */
export const CAMPOS_DE_IDENTIDAD = ['code', 'plate', 'serial', 'identifier', 'encargado', 'tipo', 'clasificacion', 'referencia'] as const;

/**
 * El `.or()` de PostgREST que encuentra los cambios donde el texto fue el valor de
 * ANTES («de») o el de DESPUÉS («a») de alguno de esos campos. El texto llega ya
 * saneado por la pantalla (sin coma, paréntesis ni %). Vacío → '' (no hay filtro).
 */
export function filtroNombresAnteriores(texto: string): string {
  const t = String(texto ?? '').trim();
  if (!t) return '';
  return CAMPOS_DE_IDENTIDAD
    .flatMap((c) => [`changes->${c}->>de.ilike.%${t}%`, `changes->${c}->>a.ilike.%${t}%`])
    .join(',');
}

/** Junta dos listas de la bitácora sin repetir filas (por `id`), de la más nueva a la
 *  más vieja, y corta en `limite`. */
export function mezclarPorFecha<T extends { id: string | number; at: string }>(a: T[], b: T[], limite: number): T[] {
  const vistas = new Set<string | number>();
  const todas: T[] = [];
  for (const r of [...a, ...b]) {
    if (vistas.has(r.id)) continue;
    vistas.add(r.id);
    todas.push(r);
  }
  return todas.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)).slice(0, limite);
}
