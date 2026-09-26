// HORÓMETRO DE TRABAJO — la capa que toca la red (23-sep-2026). El «qué» vive en
// horometroTrabajo.ts (puro, probado solo); acá solo va el «cómo» se lee y se guarda.
//
// ⭐ TABLA PROPIA (`lecturas_horometro_trabajo`) Y RPC PROPIA (`guardar_lectura_horometro`).
//    No se toca `machine_rounds` ni su RPC: el horómetro de trabajo se construye AL LADO
//    de la jornada, para que lo que hoy paga siga igual mientras conviven.
//
// ⭐ SI LA TABLA NO EXISTE (el SQL no se corrió), leer devuelve [] y guardar devuelve un
//    error legible: ninguna pantalla se cae por esto. El SQL es
//    Desktop\SQL-PENDIENTES\sql-horometro-trabajo-2026-09-23.sql (fuera del git).
import { supabase, selectAllRows } from './supabase';
import { LecturaTrabajo, OrigenLectura, Turno } from './horometroTrabajo';

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const numONull = (v: unknown): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

function aLectura(r: any): LecturaTrabajo {
  return {
    machineryId: String(r.machinery_id), roundDate: String(r.round_date).slice(0, 10), shift: (r.shift === 'night' ? 'night' : 'day') as Turno,
    inicial: numONull(r.inicial), final: numONull(r.final),
    valida: r.valida !== false, motivoInvalida: limpio(r.motivo_invalida) || null,
    reinicio: r.reinicio === true, origen: (limpio(r.origen) || 'inspector') as OrigenLectura,
    corregidoPor: r.corregido_por ?? null,
    fotoInicialUrl: limpio(r.foto_inicial_url) || null, fotoFinalUrl: limpio(r.foto_final_url) || null,
  };
}

const COLS = 'machinery_id, round_date, shift, inicial, final, valida, motivo_invalida, reinicio, origen, corregido_por, foto_inicial_url, foto_final_url';

/** Lecturas de un rango de jornadas (paginado: una semana de toda la flota pasa de 1.000). */
export async function cargarLecturasHorometro(desde: string, hasta: string): Promise<LecturaTrabajo[]> {
  try {
    const rows = await selectAllRows('lecturas_horometro_trabajo', COLS,
      (q: any) => q.gte('round_date', desde).lte('round_date', hasta));
    return (rows as any[]).map(aLectura);
  } catch {
    return []; // sin tabla, sin lecturas: las pantallas siguen como si no existiera el módulo
  }
}

/** Las lecturas (0, 1 o 2: dia/noche) de UNA maquina en UNA jornada. Nunca lanza:
 *  [] si falla o la tabla no existe, para que el telefono del inspector no se caiga. */
export async function cargarLecturasDeMaquinaDia(machineryId: string, roundDate: string): Promise<LecturaTrabajo[]> {
  try {
    const { data, error } = await supabase
      .from('lecturas_horometro_trabajo')
      .select(COLS)
      .eq('machinery_id', machineryId)
      .eq('round_date', roundDate);
    if (error || !data) return [];
    return (data as any[]).map(aLectura);
  } catch {
    return [];
  }
}

export type PatchLectura = {
  inicial?: number | null; final?: number | null;
  fotoInicialUrl?: string | null; fotoFinalUrl?: string | null;
  origen?: OrigenLectura; reinicio?: boolean; motivoCorreccion?: string;
};

/**
 * Guarda (o completa) la lectura de una máquina, día y turno, por la RPC de patch parcial.
 * Solo viajan las claves presentes. `valida` la calcula la base, nunca el cliente.
 * Nunca lanza: devuelve { ok:false, error } para que quien llama decida (el teléfono del
 * inspector, por ejemplo, NO debe fallar el cierre de jornada por esto).
 */
export async function guardarLecturaHorometro(machineryId: string, roundDate: string, shift: Turno, p: PatchLectura): Promise<{ ok: boolean; error?: string; lectura?: LecturaTrabajo }> {
  const patch: Record<string, unknown> = {};
  if ('inicial' in p) patch.inicial = p.inicial;
  if ('final' in p) patch.final = p.final;
  if ('fotoInicialUrl' in p) patch.foto_inicial_url = p.fotoInicialUrl;
  if ('fotoFinalUrl' in p) patch.foto_final_url = p.fotoFinalUrl;
  if (p.origen) patch.origen = p.origen;
  if ('reinicio' in p) patch.reinicio = !!p.reinicio;
  if (p.motivoCorreccion != null) patch.motivo_correccion = limpio(p.motivoCorreccion);
  try {
    const { data, error } = await supabase.rpc('guardar_lectura_horometro', { p_machinery_id: machineryId, p_round_date: roundDate, p_shift: shift, p_patch: patch });
    if (error) {
      const msg = String(error.message ?? error);
      if (/guardar_lectura_horometro|lecturas_horometro_trabajo|does not exist|not find/i.test(msg)) {
        return { ok: false, error: 'El horómetro de trabajo aún no está habilitado en la base (falta correr sql-horometro-trabajo-2026-09-23.sql).' };
      }
      return { ok: false, error: msg };
    }
    return { ok: true, lectura: data ? aLectura(data) : undefined };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
