import { norm } from './text';

/**
 * Catálogo OFICIAL de edificios/puntos donde se ubican las máquinas. Es la lista
 * del desplegable que llena el coordinador/inspector en Supervisión (check-in) y
 * la base para COTEJAR/normalizar las referencias viejas escritas a mano.
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
