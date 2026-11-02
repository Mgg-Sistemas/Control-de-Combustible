// ⏱️ Horómetro para los reportes de Combustible (02-nov-2026).
//
// FUENTE: lo que cargan los inspectores en machine_rounds (horometro_inicial /
// horometro_final por máquina y jornada). Combustible SOLO lo lee: nunca escribe
// en machine_rounds.
//
// CORRECCIÓN: quien tiene 'full' en Consumos puede corregir el horómetro que sale
// en los papeles de combustible. La corrección vive aparte, en
// combustible_horometro_ajustes (máquina + fecha), y gana sobre lo del inspector
// SOLO en estos reportes. Esa tabla todavía no existe: queda detrás del
// interruptor HOROMETRO_AJUSTES_ACTIVOS hasta que se cree en la base.
//
// FECHA: la jornada va de 7am a 7am. Un surtido a las 3am del día D pertenece a
// la jornada D-1 (ver jornadaDeDespacho).
import { selectAllRows, supabase } from './supabase';
import { caracasParts } from './jornada';

/** Enciende la lectura/escritura de combustible_horometro_ajustes. */
export const HOROMETRO_AJUSTES_ACTIVOS = false;

export type FuenteHorometro = 'inspector' | 'ajuste' | 'ninguno';

export type HorometroDia = {
  machinery_id: string;
  fecha: string; // YYYY-MM-DD (jornada)
  inicial: number | null;
  final: number | null;
  /** De dónde salió lo que se muestra. */
  fuente: FuenteHorometro;
  /** Lo del inspector, siempre a la vista aunque haya corrección. */
  inspInicial: number | null;
  inspFinal: number | null;
  nota?: string | null;
};

export type FilaRonda = {
  machinery_id: string | null;
  round_date: string | null;
  horometro_inicial: number | string | null;
  horometro_final: number | string | null;
};

export type FilaAjusteHorometro = {
  machinery_id: string;
  fecha: string;
  horometro_inicial: number | string | null;
  horometro_final: number | string | null;
  nota?: string | null;
};

export const claveHorometro = (machineryId: string, fecha: string) => `${machineryId}|${String(fecha).slice(0, 10)}`;

const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : null;
};

/** Por máquina y jornada: el inicial más bajo y el final más alto de sus rondas. */
export function agruparRondas(rows: FilaRonda[]): Map<string, HorometroDia> {
  const out = new Map<string, HorometroDia>();
  for (const r of rows || []) {
    if (!r?.machinery_id || !r?.round_date) continue;
    const k = claveHorometro(r.machinery_id, r.round_date);
    const ini = num(r.horometro_inicial);
    const fin = num(r.horometro_final);
    const prev = out.get(k);
    const inspInicial = prev?.inspInicial == null ? ini : ini == null ? prev.inspInicial : Math.min(prev.inspInicial, ini);
    const inspFinal = prev?.inspFinal == null ? fin : fin == null ? prev.inspFinal : Math.max(prev.inspFinal, fin);
    out.set(k, {
      machinery_id: r.machinery_id,
      fecha: String(r.round_date).slice(0, 10),
      inicial: inspInicial,
      final: inspFinal,
      fuente: inspInicial != null || inspFinal != null ? 'inspector' : 'ninguno',
      inspInicial,
      inspFinal,
    });
  }
  return out;
}

/** La corrección de Combustible gana campo por campo; lo vacío deja lo del inspector. */
export function aplicarAjustes(mapa: Map<string, HorometroDia>, ajustes: FilaAjusteHorometro[]): Map<string, HorometroDia> {
  const out = new Map(mapa);
  for (const a of ajustes || []) {
    if (!a?.machinery_id || !a?.fecha) continue;
    const k = claveHorometro(a.machinery_id, a.fecha);
    const base: HorometroDia = out.get(k) ?? {
      machinery_id: a.machinery_id, fecha: String(a.fecha).slice(0, 10),
      inicial: null, final: null, fuente: 'ninguno', inspInicial: null, inspFinal: null,
    };
    const ini = num(a.horometro_inicial);
    const fin = num(a.horometro_final);
    if (ini == null && fin == null && !a.nota) continue;
    out.set(k, {
      ...base,
      inicial: ini ?? base.inicial,
      final: fin ?? base.final,
      fuente: ini != null || fin != null ? 'ajuste' : base.fuente,
      nota: a.nota ?? null,
    });
  }
  return out;
}

/** Horas entre inicial y final (null si falta alguno o da negativo). */
export function horasHorometro(h: HorometroDia | null | undefined): number | null {
  if (!h || h.inicial == null || h.final == null) return null;
  const d = Math.round((h.final - h.inicial) * 10) / 10;
  return d >= 0 ? d : null;
}

/** Jornada (7am a 7am, hora de Caracas) a la que pertenece un surtido. */
export function jornadaDeDespacho(d: { dispatch_date?: string | null; created_at?: string | null }): string {
  const fecha = String(d?.dispatch_date ?? '').slice(0, 10);
  if (!d?.created_at) return fecha;
  const p = caracasParts(new Date(d.created_at));
  if (p.iso === fecha && p.hour < 7) {
    const dt = new Date(`${fecha}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() - 1);
    return dt.toISOString().slice(0, 10);
  }
  return fecha;
}

/**
 * Carga el horómetro de las máquinas en el rango [desde, hasta] (fechas de
 * jornada, inclusive). Si falla la lectura devuelve un mapa vacío: el reporte
 * sale igual, con el horómetro en blanco, nunca se cae.
 */
export async function cargarHorometros(machineryIds: string[], desde: string, hasta: string): Promise<Map<string, HorometroDia>> {
  const ids = Array.from(new Set((machineryIds || []).filter(Boolean)));
  if (ids.length === 0) return new Map();
  let rondas: FilaRonda[] = [];
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const lote = ids.slice(i, i + 100);
      const filas = await selectAllRows(
        'machine_rounds',
        'id, machinery_id, round_date, horometro_inicial, horometro_final',
        (q) => q.in('machinery_id', lote).gte('round_date', desde).lte('round_date', hasta),
      );
      rondas = rondas.concat(filas as FilaRonda[]);
    }
  } catch (e) {
    console.warn('No se pudo leer el horómetro de los inspectores:', e);
    return new Map();
  }
  let mapa = agruparRondas(rondas);
  if (HOROMETRO_AJUSTES_ACTIVOS) {
    try {
      const { data } = await supabase
        .from('combustible_horometro_ajustes')
        .select('machinery_id, fecha, horometro_inicial, horometro_final, nota')
        .in('machinery_id', ids)
        .gte('fecha', desde)
        .lte('fecha', hasta);
      mapa = aplicarAjustes(mapa, (data ?? []) as FilaAjusteHorometro[]);
    } catch (e) {
      console.warn('No se pudieron leer las correcciones de horómetro:', e);
    }
  }
  return mapa;
}

/**
 * Guarda la corrección de una máquina/fecha (solo 'full' en Consumos; la base lo
 * vuelve a comprobar). Devuelve ok=false con mensaje si la RLS dejó 0 filas.
 */
export async function guardarAjusteHorometro(p: {
  machineryId: string; fecha: string; inicial: number | null; final: number | null; nota?: string | null; autor?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!HOROMETRO_AJUSTES_ACTIVOS) return { ok: false, error: 'La corrección de horómetro todavía no está activada en la base.' };
  const { data, error } = await supabase
    .from('combustible_horometro_ajustes')
    .upsert({
      machinery_id: p.machineryId,
      fecha: String(p.fecha).slice(0, 10),
      horometro_inicial: p.inicial,
      horometro_final: p.final,
      nota: (p.nota ?? '').trim() || null,
      updated_by_name: p.autor ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'machinery_id,fecha' })
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'No se guardó: hace falta permiso full en Consumos.' };
  return { ok: true };
}
