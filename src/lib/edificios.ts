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
  'RESIDENCIA CARIBE - CARABALLEDA',
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
  // "RESIDENCIA CARIBE" (Caraballeda). Cubre el typo viejo "residincia" y las variantes
  // sin sector / con coma que quedaron escritas a mano. Va ANTES de "caribe club".
  [/resid[ei]ncia\s+caribe/, 'RESIDENCIA CARIBE - CARABALLEDA'],
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

/** Fila del catálogo de edificios/ubicaciones (para el CRUD de UBICACIONES). */
export type EdificioRow = { id: string; name: string; active: boolean; sub_sector: string | null };

/** Lee el catálogo COMPLETO (con id) para gestionarlo (activos, A→Z). */
export async function fetchEdificioRows(): Promise<EdificioRow[]> {
  try {
    const { data, error } = await supabase.from('edificios').select('id, name, active, sub_sector').eq('active', true);
    if (error || !data) return [];
    return (data as any[])
      .map((r) => ({ id: String(r.id), name: String(r.name ?? '').trim(), active: r.active !== false, sub_sector: (r.sub_sector ?? null) as string | null }))
      .filter((r) => r.name)
      .sort((a, b) => cmpText(a.name, b.name));
  } catch {
    return [];
  }
}

/** Edificio con su sub-sector, para agrupar la lista (El Palmar / Los Corales…). */
export type EdificioConSector = { name: string; sub_sector: string | null };

/**
 * Lee edificios activos con su sub-sector, agrupados y ordenados A→Z. Si la tabla
 * no tiene aún la columna `sub_sector`, cae a la lista simple (todos sin sector).
 */
export async function fetchEdificiosConSector(): Promise<EdificioConSector[]> {
  try {
    const { data, error } = await supabase.from('edificios').select('name, sub_sector').eq('active', true);
    if (error || !data) return (await fetchEdificios()).map((name) => ({ name, sub_sector: null }));
    return (data as any[])
      .map((r) => ({ name: String(r.name ?? '').trim(), sub_sector: (r.sub_sector ?? null) as string | null }))
      .filter((r) => r.name)
      .sort((a, b) => cmpText(a.name, b.name));
  } catch {
    return (await fetchEdificios()).map((name) => ({ name, sub_sector: null }));
  }
}

/** Cambia el sub-sector de una ubicación (El Palmar / Los Corales…). '' o null lo limpia. */
export async function updateEdificioSector(id: string, subSector: string | null): Promise<{ ok: boolean; error?: string }> {
  const clean = (subSector ?? '').trim() || null;
  const { error } = await supabase.from('edificios').update({ sub_sector: clean }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Lista de sub-sectores YA usados (para autocompletar al asignar). A→Z, sin repetir. */
export async function fetchSubSectores(): Promise<string[]> {
  try {
    const { data } = await supabase.from('edificios').select('sub_sector').eq('active', true);
    const seen = new Set<string>();
    const out: string[] = [];
    (data ?? []).forEach((r: any) => {
      const s = String(r.sub_sector ?? '').trim();
      if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
    });
    return out.sort(cmpText);
  } catch { return []; }
}

/**
 * Renombra una ubicación del catálogo. CASCADA: actualiza también la `referencia`
 * (edificio) de las máquinas que tenían el nombre viejo, para que el cambio se
 * refleje en TODOS lados (inspector, catálogo, reportes), no solo en la lista.
 */
export async function updateEdificio(id: string, name: string, oldName?: string): Promise<{ ok: boolean; error?: string }> {
  const clean = (name ?? '').trim();
  if (!clean) return { ok: false, error: 'El nombre no puede estar vacío.' };
  // Evita chocar con otra ubicación que ya se llame igual.
  const { data: dup } = await supabase.from('edificios').select('id').ilike('name', clean).neq('id', id);
  if (dup && dup.length) return { ok: false, error: 'Ya existe otra ubicación con ese nombre.' };
  const { error } = await supabase.from('edificios').update({ name: clean }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  const prev = (oldName ?? '').trim();
  if (prev && prev !== clean) {
    // Best-effort: sincroniza las máquinas que usaban el nombre viejo.
    await supabase.from('machinery').update({ referencia: clean }).eq('referencia', prev);
  }
  return { ok: true };
}

/** Elimina una ubicación del catálogo (deja de aparecer en los desplegables). Las
 *  máquinas que ya tenían ese texto en su referencia lo conservan (no se borra su dato). */
export async function deleteEdificio(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('edificios').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Agrega un edificio nuevo al catálogo compartido (si no existe). Devuelve el nombre
 * guardado (sin duplicar por mayúsculas/espacios) o null si falló. Es idempotente:
 * si ya existe uno igual (ignorando may/min), devuelve el existente.
 */
export async function addEdificio(name: string, subSector?: string | null): Promise<string | null> {
  const clean = (name ?? '').trim();
  if (!clean) return null;
  const sector = (subSector ?? '').trim() || null;
  try {
    // ¿Ya existe (ignorando may/min)? — evita duplicados tipo "La Joya" / "la joya".
    const { data: existing } = await supabase
      .from('edificios')
      .select('id, name')
      .ilike('name', clean);
    if (existing && existing.length) {
      // Si viene con sub-sector y el existente no lo tiene, se lo completamos.
      if (sector) await supabase.from('edificios').update({ sub_sector: sector }).eq('id', (existing[0] as any).id).is('sub_sector', null);
      return String(existing[0].name);
    }
    const { error } = await supabase.from('edificios').insert(sector ? { name: clean, sub_sector: sector } : { name: clean });
    if (error) return null;
    return clean;
  } catch {
    return null;
  }
}
