import { norm } from './text';

/**
 * Unifica los cargos escritos de distintas formas (plurales, typos, género) en
 * una sola etiqueta CANÓNICA, siempre en MAYÚSCULA. Así los chips/filtros/reportes
 * dejan de mostrar el mismo cargo repetido (p. ej. INSPECTOR DE EQUIPO /
 * INSPECTOR DE EQUIPOS, LAVAPLATO / LAVAPLATOS, AYUDANNTE DE COCINA…).
 *
 * La CLAVE del mapa es el texto normalizado (minúsculas, sin tildes, espacios
 * colapsados) y el VALOR es la etiqueta canónica que se muestra (en mayúscula).
 * Agregar aquí cualquier variante nueva que aparezca.
 */
const CANON: Record<string, string> = {
  'ayudante de cocina': 'AYUDANTE DE COCINA',
  'ayudannte de cocina': 'AYUDANTE DE COCINA',
  'lavaplatos': 'LAVAPLATOS',
  'lavaplato': 'LAVAPLATOS',
  'chofer': 'CHOFER',
  'choferes': 'CHOFER',
  'ayudante de camion de servicio': 'AYUDANTE DE CAMION DE SERVICIO',
  'ayudante de camion de servicios': 'AYUDANTE DE CAMION DE SERVICIO',
  'analista administrativo': 'ANALISTA ADMINISTRATIVO',
  'analista administrativos': 'ANALISTA ADMINISTRATIVO',
  'cocinero': 'COCINERO',
  'cocinera': 'COCINERO',
  'inspector de equipo': 'INSPECTOR DE EQUIPOS',
  'inspector de equipos': 'INSPECTOR DE EQUIPOS',
  'jefe alimentacion': 'JEFE DE ALIMENTACION',
  'jefe de alimentacion': 'JEFE DE ALIMENTACION',
  'obrero': 'OBRERO (CALETERO)',
  'obrero (caletero)': 'OBRERO (CALETERO)',
  'encargado de cocina': 'COORDINADOR DE COCINA',
  'coordinador de cocina': 'COORDINADOR DE COCINA',
  'operadores de maquinaria': 'OPERADORES DE MAQUINARIA',
  'operador de maquinaria': 'OPERADORES DE MAQUINARIA',
  'coordinador de operadores': 'COORDINADOR DE OPERADORES',
  'coordinador de operador': 'COORDINADOR DE OPERADORES',
  'coordinador de inspector': 'COORDINADOR DE INSPECTOR',
  'coordinador de inspectores': 'COORDINADOR DE INSPECTOR',
};

/** Devuelve el cargo unificado y en MAYÚSCULA. Vacío → "SIN CARGO". */
export function canonicalCargo(raw?: string | null): string {
  const t = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return 'SIN CARGO';
  const key = norm(t).replace(/\s+/g, ' ').trim();
  return CANON[key] ?? t.toUpperCase();
}
