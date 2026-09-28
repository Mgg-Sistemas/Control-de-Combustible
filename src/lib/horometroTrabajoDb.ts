// HORÓMETRO DE TRABAJO — la capa que toca la red (23-sep-2026). El «qué» vive en
// horometroTrabajo.ts (puro, probado solo); acá solo va el «cómo» se lee y se guarda.
//
// ⭐ TABLA PROPIA (`lecturas_horometro_trabajo`) Y RPC PROPIA (`guardar_lectura_horometro`).
//    No se toca `machine_rounds` ni su RPC: el horómetro de trabajo se construye AL LADO
//    de la jornada, para que lo que hoy paga siga igual mientras conviven.
//    ÚNICA EXCEPCIÓN (28-sep-2026, pedido del cliente): `propagarCorreccionHorometro`
//    espeja el FINAL corregido desde Control en `machine_rounds.horometro_final` y en
//    `machinery.last_horometro` — números informativos de mantenimiento/ficha; las
//    horas pagadas de la jornada siguen intocables.
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

/**
 * PROPAGA una corrección hecha desde Control (28-sep-2026, pedido del cliente:
 * «el horómetro no es solo mantenimiento, es el horómetro de trabajo de la
 * máquina» — la auditoría del 27-sep encontró que la corrección se quedaba solo
 * en las lecturas y las alertas/ficha seguían con el número viejo).
 *
 * Después de que la RPC guardó la lectura corregida:
 *  1) ESPEJO EN LA RONDA: `machine_rounds.horometro_final` de ESA jornada toma
 *     el final corregido — SOLO UPDATE de una fila que ya exista. NUNCA se crea
 *     una ronda: una fila nueva con horas vacías se colaría en Asistencia.
 *  2) HORÓMETRO VIVO: `machinery.last_horometro` = final corregido, SOLO si no
 *     hay una lectura ni una ronda MÁS NUEVA con final — corregir una semana
 *     vieja no puede pisar el número de hoy. (Con reinicio marcado el número
 *     puede bajar, y está bien: el aparato es nuevo.)
 *
 * ⚠️ LO QUE NUNCA TOCA: las horas pagadas de la jornada. El pago sigue en sombra.
 * ⚠️ Borrar el final (null) NO borra los espejos: quitar un número inventado de
 *    la lectura no dice cuál era el bueno — mejor conservador.
 *
 * Best-effort y nunca lanza: la corrección YA quedó guardada; esto es el espejo.
 * El rastro queda solo: machinery y machine_rounds tienen sus triggers de
 * auditoría, y la lectura guarda corregido_por + motivo.
 */
export async function propagarCorreccionHorometro(
  machineryId: string, roundDate: string, shift: Turno, final: number | null
): Promise<{ ronda: boolean; vivo: boolean }> {
  const out = { ronda: false, vivo: false };
  if (final == null) return out;
  try {
    const { data: fila } = await supabase
      .from('machine_rounds').select('machinery_id')
      .eq('machinery_id', machineryId).eq('round_date', roundDate).maybeSingle();
    if (fila) {
      const { error } = await supabase
        .from('machine_rounds').update({ horometro_final: final })
        .eq('machinery_id', machineryId).eq('round_date', roundDate);
      out.ronda = !error;
    }
  } catch { /* espejo best-effort */ }
  try {
    // ¿Existe algo MÁS NUEVO con final? (mismo día: la noche va después del día)
    const masNuevaLectura = supabase
      .from('lecturas_horometro_trabajo').select('round_date')
      .eq('machinery_id', machineryId).not('final', 'is', null)
      .or(shift === 'day'
        ? `round_date.gt.${roundDate},and(round_date.eq.${roundDate},shift.eq.night)`
        : `round_date.gt.${roundDate}`)
      .limit(1);
    const masNuevaRonda = supabase
      .from('machine_rounds').select('round_date')
      .eq('machinery_id', machineryId).not('horometro_final', 'is', null)
      .gt('round_date', roundDate).limit(1);
    const [lect, rond] = await Promise.all([masNuevaLectura, masNuevaRonda]);
    if (!lect.data?.length && !rond.data?.length) {
      const { error } = await supabase
        .from('machinery').update({ last_horometro: final }).eq('id', machineryId);
      out.vivo = !error;
    }
  } catch { /* espejo best-effort */ }
  return out;
}
