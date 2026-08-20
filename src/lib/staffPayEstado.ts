// CONTROL DE PAGO A PERSONAL — filtro «Activos / Todos / Inactivos-Desincorporados»
// del detalle de un período.
//
// Vive aparte (sin imports) para poder probarlo: la regla es corta pero ya falló una
// vez y toca dinero. Ver `scripts/test-staff-pay-estado.mjs`.
//
// EL BUG (20-ago-2026): la versión anterior hacía `if (!st) return true`, o sea que un
// renglón SIN estado resuelto pasaba TODOS los filtros — salía a la vez en "Activos" y
// en "Inactivos/Desincorporados". Un renglón se queda sin estado cuando no tiene
// `employee_id` (persona cargada suelta) o cuando su empleado ya no está en el registro.
// Resultado: el filtro de desincorporados mostraba gente que no lo era, y por eso "no
// los reconocía".
//
// LA REGLA: sin estado ≠ desincorporado. Si está cobrando en el período, cuenta como
// ACTIVO; desincorporado es SOLO quien está explícitamente 'inactivo' o 'suspendido'.

export type EstadoFiltro = 'activos' | 'todos' | 'inactivos';

/** Estados del empleado que cuentan como DESINCORPORADO. */
export const ESTADOS_DESINCORPORADO = ['inactivo', 'suspendido'] as const;

export function esDesincorporado(status?: string | null): boolean {
  return status === 'inactivo' || status === 'suspendido';
}

/**
 * ¿Este renglón del período pasa el filtro de estado elegido?
 *
 * @param employeeId   `employee_id` del renglón (null si la persona no está vinculada
 *                     al registro de empleados).
 * @param estado       filtro elegido en pantalla.
 * @param statusById   estado ACTUAL de cada empleado (no el que tenía al incluirlo).
 * @param statusLoaded false mientras `statusById` todavía no llega: no se excluye a
 *                     nadie, si no la lista parpadea vacía al abrir el período.
 */
export function pasaFiltroEstado(
  employeeId: string | null | undefined,
  estado: EstadoFiltro,
  statusById: Map<string, string>,
  statusLoaded: boolean
): boolean {
  if (estado === 'todos') return true;
  if (!statusLoaded) return true;
  const st = employeeId ? statusById.get(employeeId) : undefined;
  // Sin estado = está cobrando pero no se pudo resolver su ficha → cuenta como ACTIVO,
  // nunca como desincorporado.
  if (estado === 'activos') return st === 'activo' || !st;
  return esDesincorporado(st);
}
