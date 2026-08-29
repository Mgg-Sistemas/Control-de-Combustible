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

// GRUPOS APARTADOS (29-ago-2026): además de Activos/Todos/Inactivos, el período
// tiene dos pestañas más — CARBOZULIA y SEGURIDAD — para poder verlos y
// exportarlos aparte sin perderlos de vista en el resto.
//
// A DIFERENCIA de la pantalla de Empleados, acá los grupos NO se descuentan de
// «Todos» ni de «Activos»: son un ATAJO para filtrar, no una partición. El
// motivo es que TODOS los períodos mezclan a los tres (p. ej. "CARBOZULIA
// SEMANA 4 DE AGOSTO" son 22 de Carbozulia + 16 de Seguridad + 181 del resto) y
// el TOTAL DEL PERÍODO que se ve arriba los incluye a todos: si se escondieran,
// la lista dejaría de cuadrar con el monto y en una pantalla de dinero eso se
// lee como un error de pago.
//
// Quién es de cada grupo se decide con `grupoApartado` de `src/lib/nominaGrupos.ts`
// (la MISMA regla que usa Empleados, para que no se separen con el tiempo). Acá
// solo se recibe ya resuelto, en `grupoById`, para no traer imports a este archivo.
export type EstadoFiltro = 'activos' | 'todos' | 'inactivos' | 'carbozulia' | 'seguridad';

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
 * @param grupoById    employee_id → 'carbozulia' | 'seguridad' (ya resuelto con
 *                     `grupoApartado`). Solo hace falta para esas dos pestañas.
 */
export function pasaFiltroEstado(
  employeeId: string | null | undefined,
  estado: EstadoFiltro,
  statusById: Map<string, string>,
  statusLoaded: boolean,
  grupoById?: Map<string, 'carbozulia' | 'seguridad'>
): boolean {
  // Pestañas de GRUPO: muestran SOLO a los suyos. Mientras el detalle no haya
  // cargado no se puede decidir, y devolver `true` llenaría la pestaña con todo
  // el período por un instante — acá sí se prefiere vacío y que se llene.
  if (estado === 'carbozulia' || estado === 'seguridad') {
    if (!statusLoaded || !grupoById || !employeeId) return false;
    return grupoById.get(employeeId) === estado;
  }
  if (estado === 'todos') return true;
  if (!statusLoaded) return true;
  const st = employeeId ? statusById.get(employeeId) : undefined;
  // Sin estado = está cobrando pero no se pudo resolver su ficha → cuenta como ACTIVO,
  // nunca como desincorporado.
  if (estado === 'activos') return st === 'activo' || !st;
  return esDesincorporado(st);
}
