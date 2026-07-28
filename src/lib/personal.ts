import { norm } from './text';

/**
 * Normalización y UNIFICACIÓN del DEPARTAMENTO de la nómina.
 *
 * Un solo criterio alimenta el reporte de personal, el reporte de ubicaciones
 * tácticas "con personal" y (vía SQL: supabase/nomina_departamentos.sql) la nómina
 * en la base de datos, para que en todos lados los departamentos se vean iguales.
 *
 * Reglas:
 *  1) Unifica variantes de un mismo departamento escrito distinto
 *     (p. ej. "administrativo"/"adminitrativo", "OPERACIONES DE MAQUINAS"/"…MAQUINARIAS").
 *  2) Si el empleado NO tiene departamento, lo INFIERE de su cargo
 *     (p. ej. un encargado de cocina sin departamento → COCINA).
 *  3) Departamentos desconocidos se conservan tal cual (en MAYÚSCULAS).
 */

// Departamentos canónicos (así se muestran, con acentos correctos).
const DEP_ADMIN = 'ADMINISTRATIVO';
const DEP_OPER = 'OPERACIONES DE MAQUINARIA';
const DEP_COCINA = 'COCINA';
const DEP_ALMACEN = 'ALMACÉN';
const DEP_INSPEC = 'INSPECCIÓN Y PATIO';
const DEP_MANT = 'MANTENIMIENTO';
const DEP_SERV = 'SERVICIOS GENERALES';
const DEP_DIR = 'DIRECCIÓN Y COORDINACIÓN';
const DEP_SIN = 'SIN DEPARTAMENTO';

// Reglas de UNIFICACIÓN por nombre de departamento (se evalúan en orden).
const DEPT_RULES: { re: RegExp; dep: string }[] = [
  { re: /administ|adminit/, dep: DEP_ADMIN },
  { re: /maquin|operac/, dep: DEP_OPER },
  { re: /cocin|aliment|comedor/, dep: DEP_COCINA },
  { re: /almacen|deposito|inventario/, dep: DEP_ALMACEN },
  { re: /inspec|patio|listero|trafico|controlador/, dep: DEP_INSPEC },
  { re: /manten|mecanic|soldad|electric|lubric/, dep: DEP_MANT },
  { re: /servicio|general|aseo|limpie|seguridad|vigilan/, dep: DEP_SERV },
  { re: /direcc|coordinac|gerenc/, dep: DEP_DIR },
];

// Reglas de INFERENCIA por CARGO cuando no hay departamento (orden: dominio antes
// que liderazgo, para que "coordinador de cocina" caiga en COCINA y no en dirección).
const CARGO_RULES: { re: RegExp; dep: string }[] = [
  { re: /cocin|lavaplato|aliment|comedor|chef/, dep: DEP_COCINA },
  { re: /almacen|deposito/, dep: DEP_ALMACEN },
  { re: /inspec|patio|listero|trafico|controlador/, dep: DEP_INSPEC },
  { re: /mecanic|manten|soldad|electric|lubric/, dep: DEP_MANT },
  { re: /operador|maquinist|maquinaria|excavad|retro|payloader|cisterna|pitman|volqueta|camion|chofer|conductor/, dep: DEP_OPER },
  { re: /todero|obrero|caletero|aseo|limpie|motorizad|seguridad|vigilan|servicio/, dep: DEP_SERV },
  { re: /analista|contab|nomina|rrhh|recursos humanos|oficina|secretari|cajero|cobranza|administ|adminit/, dep: DEP_ADMIN },
  { re: /director|gerent|jefe|coordinador|supervisor/, dep: DEP_DIR },
];

/** Devuelve el departamento unificado; si viene vacío, lo infiere del cargo. */
export function normalizeDept(dept?: string | null, cargo?: string | null): string {
  const d = norm(dept); // minúsculas, sin acentos, sin espacios sobrantes
  if (d) {
    const hit = DEPT_RULES.find((r) => r.re.test(d));
    return hit ? hit.dep : String(dept).trim().toUpperCase();
  }
  const c = norm(cargo);
  if (c) {
    const hit = CARGO_RULES.find((r) => r.re.test(c));
    if (hit) return hit.dep;
  }
  return DEP_SIN;
}
