import { norm, cmpText } from './text';
import { supabase } from './supabase';

/**
 * Catálogo SEMILLA de edificios/puntos donde se ubican las máquinas. Desde ago-2026
 * el catálogo REAL vive en la tabla `public.edificios` (editable, compartida entre
 * todos los teléfonos): `fetchEdificios()` la lee y `addEdificio()` agrega uno nuevo.
 * Esta constante queda solo como RESPALDO si la tabla no responde, y como base de la
 * normalización `edificioCanonico()` para cotejar referencias viejas escritas a mano.
 * Un solo lugar canónico → todo el sistema usa los mismos nombres.
 */
export const EDIFICIOS: string[] = [
  'Colinas de Catia la Mar',
  'Hospital de Catia la Mar',
  'Santa Eduviges',
  'Residencias Militares',
  'Punta Piedra',
  'Litoral Palace',
  'Las Palmas',
  'Rita Mar',
  'Arichuna',
  'Mar de Leva',
  'Coral Garden',
  'Coral Park',
  'Club Caribe',
  'Roca Park',
  'Residencia Tachiti',
  'La Dolla',
  'OPP 26',
  'OPP 27',
  'OPP 33',
  'OPP 25',
  'Escuela Naval',
  // Quedaron del catálogo anterior — el cliente no los mencionó en la lista real
  // del 07-ago-2026, se mantienen activos por si algún registro viejo los usa.
  'La Iguana',
  'Puente Caraballeda (Debajo)',
  'Opp 22',
  'Hotel Albatro',
  'Playa escondida Tanaguarena',
];

// Reglas para mapear una referencia escrita a mano → nombre canónico del catálogo.
// El orden importa (más específico primero). Se evalúan sobre el texto normalizado
// (minúsculas, sin acentos). Actualizado 07-ago-2026 con la lista REAL del cliente
// (nombres/ortografía corregidos: Santa Eduviges, Litoral Palace, Las Palmas, Rita
// Mar, Club Caribe, Residencia Tachiti, OPP en mayúsculas) — las reglas siguen
// aceptando también la escritura VIEJA (ej. "Santa Eduvigis", "Hotel Litoral
// Palace") para que texto histórico ya escrito por los inspectores se siga
// normalizando bien al nombre canónico nuevo.
const REGLAS: [RegExp, string][] = [
  [/colinas/, 'Colinas de Catia la Mar'],
  [/hospital/, 'Hospital de Catia la Mar'],
  [/eduvig/, 'Santa Eduviges'],
  [/militar/, 'Residencias Militares'],
  [/punta piedra/, 'Punta Piedra'],
  [/litoral|palace/, 'Litoral Palace'],
  [/albatro/, 'Hotel Albatro'],
  [/tahiti|tachiti/, 'Residencia Tachiti'],
  [/club caribe/, 'Club Caribe'],
  [/jolla|joya/, 'Residencia La Joya'],
  [/palmas/, 'Las Palmas'],
  [/rita/, 'Rita Mar'],
  [/arichu|arichur/, 'Arichuna'],
  [/mar de leva/, 'Mar de Leva'],
  [/coral garden/, 'Coral Garden'],
  [/coral park/, 'Coral Park'],
  [/roca park/, 'Roca Park'],
  [/dolla/, 'La Dolla'],
  [/escuela naval/, 'Escuela Naval'],
  [/puente carab/, 'Puente Caraballeda (Debajo)'],
  [/playa escondida|escondida/, 'Playa escondida Tanaguarena'],
  [/iguan|igual/, 'La Iguana'],
  [/0?pp\s*26/, 'OPP 26'],
  [/0?pp\s*27/, 'OPP 27'],
  [/0?pp\s*22/, 'Opp 22'],
  [/0?pp\s*33/, 'OPP 33'],
  [/0?pp\s*25/, 'OPP 25'],
];

/** Devuelve el nombre canónico del catálogo para una referencia libre, o null si no coincide. */
export function edificioCanonico(ref: string | null | undefined): string | null {
  const n = norm(ref);
  if (!n) return null;
  for (const [re, name] of REGLAS) if (re.test(n)) return name;
  return null;
}

/**
 * EDIFICIO unificado para MOSTRAR: el nombre canónico del catálogo si la referencia
 * coincide, o el texto crudo tal cual si no (sin perder info); '—' si está vacío.
 * Es la ÚNICA forma de presentar la ubicación en reportes y listas (ya no hay dos
 * columnas Referencia + Edificio).
 */
export function edificioLabel(ref: string | null | undefined): string {
  const raw = (ref ?? '').trim();
  if (!raw) return '—';
  return edificioCanonico(raw) || raw;
}

/**
 * Lee el catálogo de edificios desde la tabla `public.edificios` (activos, A→Z).
 * Si la tabla no responde, cae al respaldo estático `EDIFICIOS`.
 */
export async function fetchEdificios(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('edificios')
      .select('name')
      .eq('active', true);
    if (error || !data) return [...EDIFICIOS].sort(cmpText);
    const names = data.map((r: any) => String(r.name).trim()).filter(Boolean);
    return names.sort(cmpText);
  } catch {
    return [...EDIFICIOS].sort(cmpText);
  }
}

/**
 * Agrega un edificio nuevo al catálogo compartido (si no existe). Devuelve el nombre
 * guardado (sin duplicar por mayúsculas/espacios) o null si falló. Es idempotente:
 * si ya existe uno igual (ignorando may/min), devuelve el existente.
 */
export async function addEdificio(name: string): Promise<string | null> {
  const clean = (name ?? '').trim();
  if (!clean) return null;
  try {
    // ¿Ya existe (ignorando may/min)? — evita duplicados tipo "La Joya" / "la joya".
    const { data: existing } = await supabase
      .from('edificios')
      .select('name')
      .ilike('name', clean);
    if (existing && existing.length) return String(existing[0].name);
    const { error } = await supabase.from('edificios').insert({ name: clean });
    if (error) return null;
    return clean;
  } catch {
    return null;
  }
}
