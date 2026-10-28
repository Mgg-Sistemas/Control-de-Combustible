// Lógica pura de HABILIDADES por empleado (Nómina → Empleados).
// Sin dependencias de red ni de React Native para poder probarse en Node.
import { norm } from './text';

export const MAX_HABILIDADES = 20;
export const PREFIX_CONFIG_HABILIDADES = '__nomina_habilidades__:';

export type MapaHabilidades = Record<string, string[]>;

/** Limpia espacios repetidos y pasa a MAYÚSCULAS una habilidad individual. */
export function normalizarHabilidad(s: unknown): string {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/**
 * Convierte cualquier entrada (arreglo de strings, JSON string o texto separado por comas)
 * en una lista limpia de habilidades únicas en MAYÚSCULAS, sin vacíos.
 */
export function limpiarHabilidades(raw: unknown): string[] {
  let base: unknown[] = [];
  if (Array.isArray(raw)) {
    base = raw;
  } else if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    if (t.startsWith('[')) {
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) base = parsed;
      } catch {
        base = t.split(/[,;\n]+/);
      }
    } else {
      base = t.split(/[,;\n]+/);
    }
  } else {
    return [];
  }

  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const item of base) {
    const limpio = normalizarHabilidad(item);
    if (!limpio) continue;
    const clave = norm(limpio);
    if (!clave || vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(limpio);
    if (salida.length >= MAX_HABILIDADES) break;
  }
  return salida;
}

/**
 * Extrae el mapa `{ [employeeId]: string[] }` desde las filas de `payroll_companies`
 * buscando la fila oculta con prefijo `__nomina_habilidades__:`.
 */
export function extraerMapaHabilidadesDeEmpresas(
  rows?: readonly { id?: string; name?: string | null }[] | null
): MapaHabilidades {
  const out: MapaHabilidades = {};
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const name = String(r?.name ?? '');
    if (!name.startsWith(PREFIX_CONFIG_HABILIDADES)) continue;
    const rawJson = name.slice(PREFIX_CONFIG_HABILIDADES.length);
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [empId, habs] of Object.entries(parsed)) {
          const limpias = limpiarHabilidades(habs);
          if (empId && limpias.length > 0) {
            out[empId] = limpias;
          }
        }
      }
    } catch {}
  }
  return out;
}

/**
 * Lee las habilidades de un empleado combinando:
 * 1) `emp.habilidades` / `emp.skills` (si viene en el registro o columna de BD),
 * 2) el mapa sincronizado `mapa[emp.id]` (almacenado en `payroll_companies` / `AsyncStorage`).
 */
export function leerHabilidadesEmpleado(
  emp: { id?: string | null; habilidades?: unknown; skills?: unknown } | null | undefined,
  mapa?: MapaHabilidades | null
): string[] {
  if (!emp) return [];
  const directas = limpiarHabilidades(emp.habilidades ?? emp.skills);
  const delMapa = emp.id && mapa?.[emp.id] ? limpiarHabilidades(mapa[emp.id]) : [];
  if (directas.length > 0 && delMapa.length > 0) {
    return limpiarHabilidades([...directas, ...delMapa]);
  }
  return directas.length > 0 ? directas : delMapa;
}

/** Formatea las habilidades para mostrar en tablas o reportes (`SOLDADOR · ELECTRICISTA` o `—`). */
export function formatearHabilidadesTexto(lista: readonly string[] | null | undefined, vacio = '—'): string {
  const limpias = limpiarHabilidades(lista ?? []);
  return limpias.length > 0 ? limpias.join(' · ') : vacio;
}

