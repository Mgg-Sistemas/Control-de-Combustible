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
  'RESIDENCIAS LA JOYA - CARABALLEDA',
  'OPP22 - TANAGUARENA',
  'OPP25 - CARABALLEDA, TANAGUARENA',
  'OPP26 - CARIBE DE CARABALLEDA',
  'OPP27 - CARABALLEDA',
  'OPP33 - CARIBE',
  'CORAL PARK - CARABALLEDA',
  'RESIDENCIAS ROCA PARK - CARIBE',
  'RESIDENCIAS RITAMAR PALACE - CARABALLEDA',
  'RESIDENCIAS VILLAMAR - CARABALLEDA',
  'RESIDENCIAS ALBATROS - CARIBE',
  'URBANIZACION PUNTA DE BRISAS - MACUTO',
  'SANTA EDUVIGIS - URIMARE, CATIA LA MAR',
  'RESIDENCIAS TAHITI - CARABALLEDA',
  'RESIDENCIAS LAS PALMAS - MACUTO',
  'PATIO - CAMURI CHICO',
  'CATIA LA MAR',
  'RESIDENCIAS MAR DE LEVA - CARABALLEDA',
  'RESIDENCIAS ARICHUNA - LOS CORALES',
  'URBANIZACION PALMAR ESTE - CARABALLEDA',
  'ESCUELA NAVAL DE VENEZUELA - CATIA LA MAR',
  'HOTEL LITORAL SUITES - CATIA LA MAR',
  'COLINAS DE CATIA LA MAR - CATIA LA MAR',
  'EDIFICIO PUNTA PIEDRA - MACUTO',
  'CARIBE CLUB - CARABALLEDA',
  'CORAL GARDEN - CARABALLEDA',
  'RESIDENCIAS MILITARES - MACUTO',
];

// Reglas para mapear una referencia escrita a mano (texto VIEJO/histórico) → nombre
// canónico del catálogo. El orden importa (más específico primero). Se evalúan sobre
// el texto normalizado (minúsculas, sin acentos). Actualizado 09-ago-2026 con la LISTA
// REAL DEFINITIVA de 27 edificios del cliente (misma que vive en `public.edificios`).
// Ya toda la columna `machinery.referencia` quedó unificada a estos nombres, así que
// estas reglas solo actúan como red de seguridad para texto histórico suelto; los
// nombres ya canónicos se resuelven antes por coincidencia exacta (ver edificioCanonico).
const REGLAS: [RegExp, string][] = [
  [/colinas/, 'COLINAS DE CATIA LA MAR - CATIA LA MAR'],
  [/eduvig/, 'SANTA EDUVIGIS - URIMARE, CATIA LA MAR'],
  [/militar/, 'RESIDENCIAS MILITARES - MACUTO'],
  [/punta piedra/, 'EDIFICIO PUNTA PIEDRA - MACUTO'],
  [/punta de brisas|brisas/, 'URBANIZACION PUNTA DE BRISAS - MACUTO'],
  [/litoral/, 'HOTEL LITORAL SUITES - CATIA LA MAR'],
  [/albatro/, 'RESIDENCIAS ALBATROS - CARIBE'],
  [/tahiti|tachiti/, 'RESIDENCIAS TAHITI - CARABALLEDA'],
  [/caribe club|club caribe/, 'CARIBE CLUB - CARABALLEDA'],
  [/jolla|joya/, 'RESIDENCIAS LA JOYA - CARABALLEDA'],
  [/palmar/, 'URBANIZACION PALMAR ESTE - CARABALLEDA'],
  [/palmas/, 'RESIDENCIAS LAS PALMAS - MACUTO'],
  [/ritamar|rita mar|\brita\b/, 'RESIDENCIAS RITAMAR PALACE - CARABALLEDA'],
  [/villamar|villa mar/, 'RESIDENCIAS VILLAMAR - CARABALLEDA'],
  [/arichu|arichur/, 'RESIDENCIAS ARICHUNA - LOS CORALES'],
  [/mar de leva/, 'RESIDENCIAS MAR DE LEVA - CARABALLEDA'],
  [/coral garden/, 'CORAL GARDEN - CARABALLEDA'],
  [/coral park/, 'CORAL PARK - CARABALLEDA'],
  [/roca park/, 'RESIDENCIAS ROCA PARK - CARIBE'],
  [/escuela naval/, 'ESCUELA NAVAL DE VENEZUELA - CATIA LA MAR'],
  [/camuri|patio/, 'PATIO - CAMURI CHICO'],
  [/0?pp\s*22/, 'OPP22 - TANAGUARENA'],
  [/0?pp\s*25/, 'OPP25 - CARABALLEDA, TANAGUARENA'],
  [/0?pp\s*26/, 'OPP26 - CARIBE DE CARABALLEDA'],
  [/0?pp\s*27/, 'OPP27 - CARABALLEDA'],
  [/0?pp\s*33/, 'OPP33 - CARIBE'],
  [/^catia la mar$/, 'CATIA LA MAR'],
];

/**
 * Devuelve el nombre canónico del catálogo para una referencia. Primero intenta
 * coincidencia EXACTA con la lista canónica (los 27 nombres reales) — así los valores
 * ya unificados se devuelven tal cual, sin que las REGLAS los deformen. Si no es
 * exacto, aplica las REGLAS sobre texto histórico. Null si no coincide con nada.
 */
export function edificioCanonico(ref: string | null | undefined): string | null {
  const n = norm(ref);
  if (!n) return null;
  const exacto = EDIFICIOS.find((e) => norm(e) === n);
  if (exacto) return exacto;
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
