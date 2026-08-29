import { norm } from './text';
import { canonicalCargo } from './cargos';

/**
 * GRUPOS APARTADOS de la nómina (pedido del cliente 29-ago-2026).
 *
 * CARBOZULIA y SEGURIDAD dejan de mezclarse con el resto de la plantilla: cada
 * uno tiene su propia pestaña en el filtro de ESTADO y NO se cuentan ni salen
 * en «Todos», «Activos», «Inactivos» ni «Otro». Se apartan por lo que YA está
 * registrado en la ficha, sin columna nueva ni migración:
 *
 * - CARBOZULIA → por la EMPRESA FILTRO NÓMINA (`payroll_company_id` →
 *   `payroll_companies.name`). Al 29-ago-2026 son 40 personas, todas `activo`.
 * - SEGURIDAD  → por el CARGO. Al 29-ago-2026 son 16 personas, todas `activo`
 *   y todas de SOS LA GUAIRA.
 *
 * Hoy los dos grupos NO se solapan (ningún empleado de Carbozulia tiene cargo
 * SEGURIDAD). Si algún día pasara, manda CARBOZULIA: la empresa que paga pesa
 * más que el cargo, y así una persona nunca sale contada en dos pestañas.
 */
export type GrupoApartado = 'carbozulia' | 'seguridad';

/**
 * ¿La empresa de filtro de nómina es Carbozulia? Se compara por SUBCADENA
 * normalizada (sin tildes, sin mayúsculas) y no por id: así sigue funcionando
 * si la empresa se renombra a "CARBOZULIA C.A.", "Carbozulia SA" o similar.
 */
export function esCarbozulia(empresaNomina?: string | null): boolean {
  return norm(empresaNomina).includes('carbozul');
}

/**
 * ¿El cargo es SEGURIDAD? Pasa por `canonicalCargo` para tomar las variantes
 * de escritura igual que el resto de la pantalla (chips, reporte por cargo).
 */
export function esSeguridad(cargo?: string | null): boolean {
  return canonicalCargo(cargo) === 'SEGURIDAD';
}

/**
 * Grupo apartado de un empleado, o `null` si va en las pestañas normales.
 * CARBOZULIA tiene prioridad sobre SEGURIDAD (ver comentario de arriba).
 */
export function grupoApartado(empresaNomina?: string | null, cargo?: string | null): GrupoApartado | null {
  if (esCarbozulia(empresaNomina)) return 'carbozulia';
  if (esSeguridad(cargo)) return 'seguridad';
  return null;
}

/** Pestañas del filtro de ESTADO, en el orden en que se muestran. */
export type FiltroEstado = 'todos' | 'activo' | 'inactivo' | 'otro' | GrupoApartado;

/**
 * ¿Este empleado se ve con la pestaña `filtro` puesta? Es LA regla completa:
 *
 * - Las pestañas de grupo (CARBOZULIA / SEGURIDAD) muestran SOLO a los suyos.
 * - Las pestañas normales (Todos / Activos / Inactivos / Otro) EXCLUYEN a los
 *   apartados — ese es el punto del pedido: que no aparezcan en «Todos» ni en
 *   «Activos».
 * - «Inactivos» sigue siendo "ni activo ni otro" (inactivo/suspendido), igual
 *   que antes.
 *
 * Como cada empleado tiene un solo `grupoApartado`, las pestañas son disjuntas:
 * nadie se cuenta dos veces y nadie se pierde.
 */
export function pasaFiltroEstado(filtro: FiltroEstado, grupo: GrupoApartado | null, estado?: string | null): boolean {
  if (filtro === 'carbozulia' || filtro === 'seguridad') return grupo === filtro;
  if (grupo) return false;
  const e = String(estado ?? '').toLowerCase();
  if (filtro === 'todos') return true;
  if (filtro === 'activo') return e === 'activo';
  if (filtro === 'otro') return e === 'otro';
  return e !== 'activo' && e !== 'otro';
}
