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
export interface GrupoApartadoConfig {
  id: string;
  label: string;
  color: string;
  tipo: 'empresa' | 'cargo' | 'departamento';
  valor: string;
  builtin?: boolean;
}

export const DEFAULT_GRUPOS_APARTADOS: GrupoApartadoConfig[] = [
  { id: 'carbozulia', label: 'Carbozulia', color: '#7C3AED', tipo: 'empresa', valor: 'carbozul', builtin: true },
  { id: 'seguridad', label: 'Seguridad', color: '#0891B2', tipo: 'cargo', valor: 'SEGURIDAD', builtin: true },
];

export type GrupoApartado = string;

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
 * Evalúa si un empleado cumple la condición de un grupo apartado.
 */
export function coincideGrupo(
  g: GrupoApartadoConfig,
  empresaNomina?: string | null,
  cargo?: string | null,
  departamento?: string | null
): boolean {
  if (g.tipo === 'empresa') {
    return norm(empresaNomina).includes(norm(g.valor));
  }
  if (g.tipo === 'cargo') {
    return canonicalCargo(cargo) === canonicalCargo(g.valor) || norm(cargo).includes(norm(g.valor));
  }
  if (g.tipo === 'departamento') {
    return norm(departamento).includes(norm(g.valor));
  }
  return false;
}

/**
 * Grupo apartado de un empleado, o `null` si va en las pestañas normales.
 * Se evalúan los grupos en orden de prioridad (por defecto Carbozulia y Seguridad).
 */
export function grupoApartado(
  empresaNomina?: string | null,
  cargo?: string | null,
  departamento?: string | null,
  gruposConfig: GrupoApartadoConfig[] = DEFAULT_GRUPOS_APARTADOS
): GrupoApartado | null {
  for (const g of gruposConfig) {
    if (coincideGrupo(g, empresaNomina, cargo, departamento)) {
      return g.id;
    }
  }
  return null;
}

/** Pestañas del filtro de ESTADO, en el orden en que se muestran. */
export type FiltroEstado = 'todos' | 'activo' | 'inactivo' | 'otro' | GrupoApartado;

/**
 * ¿Este empleado se ve con la pestaña `filtro` puesta? Es LA regla completa:
 *
 * - Las pestañas de grupo muestran SOLO a los suyos.
 * - Las pestañas normales (Todos / Activos / Inactivos / Otro) EXCLUYEN a los
 *   apartados — ese es el punto del pedido: que no aparezcan en «Todos» ni en
 *   «Activos».
 * - «Inactivos» sigue siendo "ni activo ni otro" (inactivo/suspendido), igual
 *   que antes.
 */
export function pasaFiltroEstado(filtro: string, grupo: string | null, estado?: string | null): boolean {
  if (filtro === 'todos') return !grupo;
  if (filtro === 'activo') return !grupo && String(estado ?? '').toLowerCase() === 'activo';
  if (filtro === 'otro') return !grupo && String(estado ?? '').toLowerCase() === 'otro';
  if (filtro === 'inactivo') return !grupo && String(estado ?? '').toLowerCase() !== 'activo' && String(estado ?? '').toLowerCase() !== 'otro';
  return grupo === filtro;
}
