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
    corregidoPor: r.corregido_por ?? null, motivoCorreccion: limpio(r.motivo_correccion) || null,
    fotoInicialUrl: limpio(r.foto_inicial_url) || null, fotoFinalUrl: limpio(r.foto_final_url) || null,
    createdAt: r.created_at ?? null, updatedAt: r.updated_at ?? null,
    createdBy: r.created_by ?? null, updatedBy: r.updated_by ?? null,
  };
}

const COLS = 'machinery_id, round_date, shift, inicial, final, valida, motivo_invalida, reinicio, origen, corregido_por, motivo_correccion, foto_inicial_url, foto_final_url, created_at, updated_at, created_by, updated_by';

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

export type UltimaFotoHorometro = { url: string; roundDate: string; detalle: string };

/**
 * La ÚLTIMA foto del horómetro de una máquina (28-sep-2026, para la 📄 Ficha
 * técnica del Catálogo). Mira las TRES fuentes donde se suben fotos del tablero
 * y devuelve la más reciente por jornada:
 *  · la lectura del inspector (foto final, o inicial si no hay final),
 *  · las fotos ADICIONALES del histórico (`horometro_fotos`),
 *  · el cierre de jornada (`machine_rounds.horometro_photo`) — SOLO LECTURA,
 *    acá no se escribe nada de la jornada.
 * A igual jornada gana la de la lectura (es la canónica del turno).
 * Nunca lanza: sin tablas o sin fotos devuelve null y la ficha sale sin ella.
 */
export async function ultimaFotoHorometro(machineryId: string): Promise<UltimaFotoHorometro | null> {
  const candidatos: UltimaFotoHorometro[] = [];
  try {
    const { data } = await supabase
      .from('lecturas_horometro_trabajo')
      .select('round_date, shift, foto_inicial_url, foto_final_url')
      .eq('machinery_id', machineryId)
      .or('foto_final_url.not.is.null,foto_inicial_url.not.is.null')
      .order('round_date', { ascending: false })
      .limit(4);
    const filas = ((data ?? []) as any[]).slice().sort((a, b) => {
      const fa = String(a.round_date), fb = String(b.round_date);
      if (fa !== fb) return fa < fb ? 1 : -1;
      return (a.shift === 'night' ? 0 : 1) - (b.shift === 'night' ? 0 : 1); // la noche cierra el día
    });
    for (const r of filas) {
      const url = limpio(r.foto_final_url) || limpio(r.foto_inicial_url);
      if (!url) continue;
      candidatos.push({
        url,
        roundDate: String(r.round_date).slice(0, 10),
        detalle: `${r.foto_final_url ? 'final' : 'inicial'} del turno ${r.shift === 'night' ? 'noche' : 'día'}`,
      });
      break;
    }
  } catch { /* sin tabla o sin permiso: la ficha sale sin foto */ }
  try {
    const { data } = await supabase
      .from('horometro_fotos')
      .select('round_date, shift, url, created_at')
      .eq('machinery_id', machineryId)
      .order('round_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    const r: any = (data ?? [])[0];
    if (r && limpio(r.url)) {
      candidatos.push({
        url: limpio(r.url),
        roundDate: String(r.round_date).slice(0, 10),
        detalle: `foto adicional del turno ${r.shift === 'night' ? 'noche' : 'día'}`,
      });
    }
  } catch { /* idem */ }
  try {
    const { data } = await supabase
      .from('machine_rounds')
      .select('round_date, horometro_photo')
      .eq('machinery_id', machineryId)
      .not('horometro_photo', 'is', null)
      .order('round_date', { ascending: false })
      .limit(1);
    const r: any = (data ?? [])[0];
    if (r && limpio(r.horometro_photo)) {
      candidatos.push({
        url: limpio(r.horometro_photo),
        roundDate: String(r.round_date).slice(0, 10),
        detalle: 'del cierre de la jornada',
      });
    }
  } catch { /* idem */ }
  if (!candidatos.length) return null;
  // Orden estable: a igual jornada queda el primero que entró (la lectura).
  return candidatos.slice().sort((a, b) => (a.roundDate < b.roundDate ? 1 : a.roundDate > b.roundDate ? -1 : 0))[0];
}
