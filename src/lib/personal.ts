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
const DEP_SISTEMAS = 'SISTEMAS';
const DEP_DIR = 'DIRECCIÓN Y COORDINACIÓN';
const DEP_SIN = 'SIN DEPARTAMENTO';

/**
 * Reglas de UNIFICACIÓN por nombre de departamento (se evalúan en orden).
 *
 * ⭐ VAN ANCLADAS AL PRINCIPIO (`^`) A PROPÓSITO. Antes buscaban la palabra en
 * CUALQUIER PARTE del nombre, y así se tragaban departamentos que existen de
 * verdad: "SOPORTE Y SERVICIO" caía en SERVICIOS GENERALES por contener
 * "servicio" (19 fichas y 11 cargos del tabulador), y "MANTENIMIENTO
 * PREVENTIVO DE MAQUINARIA" caía en OPERACIONES DE MAQUINARIA por contener
 * "maquinaria". Al usuario le desaparecía el departamento del filtro y su
 * gente salía contada en la sección de otro.
 *
 * El criterio que los separa: lo que va DESPUÉS del nombre solo lo precisa
 * —"ALMACEN GENERAL" es ALMACÉN, "MANTENIMIENTO PREVENTIVO" es MANTENIMIENTO—,
 * pero una palabra DELANTE lo convierte en otro departamento. Por eso el nombre
 * tiene que EMPEZAR por el departamento para que se unifique con él.
 *
 * ⚠️ AL AGREGAR UNA REGLA, ANCLARLA TAMBIÉN: una sin `^` revive el mismo bug, y
 *    el estropicio no se ve hasta que alguien revisa la nómina impresa.
 */
const DEPT_RULES: { re: RegExp; dep: string }[] = [
  { re: /^administ|^adminit/, dep: DEP_ADMIN },
  { re: /^operac|^maquina/, dep: DEP_OPER },
  { re: /^cocin|^aliment|^comedor/, dep: DEP_COCINA },
  { re: /^almacen|^deposito|^inventario/, dep: DEP_ALMACEN },
  { re: /^inspec|^patio|^listero|^trafico|^controlador/, dep: DEP_INSPEC },
  // Sin `soldad|electric|lubric`: son oficios, y de departamento valen por sí
  // mismos (ELECTRICIDAD es un departamento del tabulador, no "mantenimiento").
  // Siguen abajo, en la inferencia por CARGO, que es donde hacen falta.
  { re: /^manten|^mecanic|^taller/, dep: DEP_MANT },
  { re: /^servicios? +general|^servicios?$|^aseo|^limpie|^seguridad|^vigilan/, dep: DEP_SERV },
  { re: /^sistema|^informatic|^tecnolog/, dep: DEP_SISTEMAS },
  { re: /^direcc|^directiv|^coordinac|^gerenc/, dep: DEP_DIR },
];

/**
 * Muletillas con que a veces se escribe el nombre ("DPTO. DE COCINA"). Se
 * quitan ANTES de comparar para que el ancla `^` no se pierda por culpa de
 * ellas. Exige separador después, para que "DEPOSITO" no pase por "depto".
 */
const MULETILLA = /^(?:departamento|depto|dpto|dep|area|unidad|seccion)\b\.?\s+(?:de\s+la\s+|del\s+|de\s+)?/;

/** El nombre listo para comparar: minúscula, sin tildes, sin muletilla ni espacios de sobra. */
const paraComparar = (v?: string | null) => norm(v).trim().replace(/\s+/g, ' ').replace(MULETILLA, '');

/** El nombre TAL COMO SE ESCRIBIÓ: en MAYÚSCULA y sin espacios de sobra. */
const comoSeEscribio = (v?: string | null) => String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * CLAVE DE UN CARGO: con qué texto se decide que dos cargos son EL MISMO.
 *
 * ⭐ IGNORA LOS ERRORES DE DEDO, no solo mayúsculas y tildes: también los signos
 * (un punto al final, comas, paréntesis) y los espacios dobles. "MECANICO." y
 * "MECANICO" son el mismo cargo, escrito por dos personas distintas.
 *
 * ⚠️ POR QUÉ IMPORTA, Y CUÁNTO: el cargo es lo que enlaza a una persona con su
 * 🏷️ Tabulador. Si la clave no coincide, esa persona queda FUERA de "🔄
 * Sincronizar": no recibe el sueldo del tabulador y tampoco hereda su
 * departamento — y no avisa, simplemente no aparece en la cuenta del botón.
 * Con "MECANICO." pasaba exactamente eso con 3 fichas.
 *
 * La misma clave la usan el tabulador (para contar y sincronizar), la nómina
 * (para saber el departamento) y el filtro por cargo. Una sola, a propósito: con
 * dos criterios distintos, el número que muestra un botón deja de ser el número
 * de gente a la que le hace efecto.
 */
export const claveCargo = (v?: string | null): string =>
  norm(v).replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Reglas de INFERENCIA por CARGO cuando no hay departamento (orden: dominio antes
// que liderazgo, para que "coordinador de cocina" caiga en COCINA y no en dirección).
const CARGO_RULES: { re: RegExp; dep: string }[] = [
  { re: /cocin|lavaplato|aliment|comedor|chef/, dep: DEP_COCINA },
  { re: /almacen|deposito/, dep: DEP_ALMACEN },
  { re: /inspec|patio|listero|trafico|controlador/, dep: DEP_INSPEC },
  { re: /mecanic|manten|soldad|electric|lubric/, dep: DEP_MANT },
  { re: /operador|maquinist|maquinaria|excavad|retro|payloader|cisterna|pitman|volqueta|camion|chofer|conductor/, dep: DEP_OPER },
  { re: /sistema|informatic|programad|soporte tecnic|desarrollad/, dep: DEP_SISTEMAS },
  { re: /todero|obrero|caletero|plomer|gasfiter|aseo|limpie|motorizad|seguridad|vigilan|servicio/, dep: DEP_SERV },
  { re: /analista|contab|nomina|rrhh|recursos humanos|oficina|secretari|cajero|cobranza|administ|adminit/, dep: DEP_ADMIN },
  { re: /director|gerent|jefe|coordinador|supervisor/, dep: DEP_DIR },
];

/** Devuelve el departamento unificado; si viene vacío, lo infiere del cargo. */
export function normalizeDept(dept?: string | null, cargo?: string | null): string {
  const d = paraComparar(dept);
  if (d) {
    const hit = DEPT_RULES.find((r) => r.re.test(d));
    // Lo que no es variante de ninguno se CONSERVA como lo escribieron: es un
    // departamento propio, y renombrarlo sería reasignarle la gente a otro.
    return hit ? hit.dep : comoSeEscribio(dept);
  }
  const c = norm(cargo);
  if (c) {
    const hit = CARGO_RULES.find((r) => r.re.test(c));
    if (hit) return hit.dep;
  }
  return DEP_SIN;
}
