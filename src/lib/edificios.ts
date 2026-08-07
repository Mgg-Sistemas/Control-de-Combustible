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
  'Residencias Militares',
  'La Iguana',
  'Hotel Litoral Palace',
  'Residencias Las Palmas',
  'Residencias Rita Mar',
  'Arichuna',
  'Mar de Leva',
  'Puente Caraballeda (Debajo)',
  'Residencia Tahiti',
  'Residencia Club Caribe',
  'Residencia La Joya',
  'Opp 26',
  'Opp 27',
  'Opp 22',
  'Opp 33',
  'Opp 25',
  'Hotel Albatro',
  'Playa escondida Tanaguarena',
  'Santa Eduvigis',
];

// Reglas para mapear una referencia escrita a mano → nombre canónico del catálogo.
// El orden importa (más específico primero). Se evalúan sobre el texto normalizado
// (minúsculas, sin acentos).
const REGLAS: [RegExp, string][] = [
  [/militar/, 'Residencias Militares'],
  [/litoral|palace/, 'Hotel Litoral Palace'],
  [/albatro/, 'Hotel Albatro'],
  [/tahiti/, 'Residencia Tahiti'],
  [/club caribe/, 'Residencia Club Caribe'],
  [/jolla|joya/, 'Residencia La Joya'],
  [/palmas/, 'Residencias Las Palmas'],
  [/rita/, 'Residencias Rita Mar'],
  [/arichu|arichur/, 'Arichuna'],
  [/mar de leva/, 'Mar de Leva'],
  [/puente carab/, 'Puente Caraballeda (Debajo)'],
  [/playa escondida|escondida/, 'Playa escondida Tanaguarena'],
  [/eduvigis/, 'Santa Eduvigis'],
  [/iguan|igual/, 'La Iguana'],
  [/0?pp\s*26/, 'Opp 26'],
  [/0?pp\s*27/, 'Opp 27'],
  [/0?pp\s*22/, 'Opp 22'],
  [/0?pp\s*33/, 'Opp 33'],
  [/0?pp\s*25/, 'Opp 25'],
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
