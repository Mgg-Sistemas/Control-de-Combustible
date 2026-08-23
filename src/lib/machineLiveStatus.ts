import { supabase } from './supabase';
import { caracasParts } from './jornada';
import { listInspectorAssignments, inspectorSiempreActivo } from './machineInspectors';
import { paradaShiftOf } from './inspectorDaySets';

/**
 * Datos crudos de estatus EN VIVO de una máquina (jornada/avería/inspector por
 * turno), extraídos de `EquiposScreen.tsx` (`loadJornadaCat`/`loadAveriaCat`/
 * `loadInspByShift`) para que cualquier pantalla los reutilice sin duplicar el
 * dedupe/orden/ventanas de fecha de esas queries. La CLASIFICACIÓN en sí
 * (avería/parada/trabajando, reactivación, por-turno) vive en cada pantalla
 * (`EquiposScreen.liveStatusOf`, `DashboardScreen.loadCounts` vía `buildDaySets`)
 * porque cada una tiene requisitos distintos — ver el "MAPA DE CLASIFICADORES"
 * en `inspectorDaySets.ts` antes de intentar unificarlas.
 */

export type JornadaEntry = {
  dayH: number; nightH: number;
  openStartDay: number | null; openStartNight: number | null;
  // Hora REAL en que se tocó "iniciar" (jornada_marked_at ?? jornada_start_at), SOLO
  // para la reactivación: si la jornada se re-inició a las 9:30 pero `jornada_start_at`
  // quedó anclado a las 7am, la reactivación debe compararse contra las 9:30, no las 7am.
  reactStartDay: number | null; reactStartNight: number | null;
};
export type AveriaEntry = { tipo: 'averia' | 'parada'; motivo: string | null; createdMs: number };
export type InspByShiftEntry = { day: string | null; night: string | null };
export type MachineEstado = 'averiada' | 'parada' | 'trabajando' | 'trabajo_hoy' | 'ninguno';
export type LiveStatus = { estado: MachineEstado; total: number; enCurso: number; trabajadas: number; motivo: string | null; desdeMs: number | null };

// ── Fetchers: mismas queries que EquiposScreen (loadAveriaCat/loadJornadaCat/
// loadInspByShift), extraídas para que cualquier pantalla lea EXACTAMENTE los
// mismos datos crudos, sin reimplementar el dedupe/orden/ventanas de fecha. ──

/** Avería/parada PENDIENTE más reciente por máquina (avería real tiene prioridad
 *  sobre el marcador genérico "MÁQUINA PARADA"). Copia exacta de `loadAveriaCat`. */
export async function fetchAveriaCat(): Promise<Record<string, AveriaEntry>> {
  const [averias, paradas] = await Promise.all([
    supabase.from('maintenance_requests').select('machinery_id, material, notes, created_at').neq('material', 'MÁQUINA PARADA').eq('status', 'pendiente').order('created_at', { ascending: false }),
    supabase.from('maintenance_requests').select('machinery_id, notes, created_at').eq('material', 'MÁQUINA PARADA').eq('status', 'pendiente').order('created_at', { ascending: false }),
  ]);
  const m: Record<string, AveriaEntry> = {};
  const ms = (iso: any) => (iso ? new Date(iso).getTime() : 0);
  (paradas.data ?? []).forEach((r: any) => { if (m[r.machinery_id]) return; m[r.machinery_id] = { tipo: 'parada', motivo: r.notes, createdMs: ms(r.created_at) }; });
  const averiaSeen = new Set<string>();
  (averias.data ?? []).forEach((r: any) => {
    if (averiaSeen.has(r.machinery_id)) return;
    averiaSeen.add(r.machinery_id);
    m[r.machinery_id] = { tipo: 'averia', motivo: r.notes || r.material, createdMs: ms(r.created_at) };
  });
  return m;
}

/** Horas trabajadas hoy (día/noche) + instante de inicio de la jornada abierta de
 *  cada turno, con arrastre de la jornada de NOCHE de anoche si sigue abierta.
 *  Copia exacta de `loadJornadaCat`. */
export async function fetchJornadaCat(now: Date = new Date()): Promise<Record<string, JornadaEntry>> {
  const today = caracasParts(now).iso;
  const yesterday = caracasParts(new Date(now.getTime() - 86400000)).iso;
  const [todayRes, nightRes] = await Promise.all([
    supabase.from('machine_rounds').select('machinery_id, day_hours, night_hours, jornada_start_at, jornada_marked_at, jornada_shift').eq('round_date', today),
    supabase.from('machine_rounds').select('machinery_id, night_hours, jornada_start_at, jornada_marked_at, jornada_shift').eq('round_date', yesterday).eq('jornada_shift', 'night').not('jornada_start_at', 'is', null),
  ]);
  const m: Record<string, JornadaEntry> = {};
  const ensure = (id: string) => (m[id] ??= { dayH: 0, nightH: 0, openStartDay: null, openStartNight: null, reactStartDay: null, reactStartNight: null });
  // Turno del inicio: el declarado; si falta, se infiere por la hora Caracas (07–18:59 = día).
  const inferShift = (iso: string, shift: 'day' | 'night' | null): 'day' | 'night' => {
    if (shift) return shift;
    const h = caracasParts(new Date(iso)).hour;
    return h >= 7 && h < 19 ? 'day' : 'night';
  };
  (todayRes.data ?? []).forEach((r: any) => {
    const e = ensure(r.machinery_id);
    e.dayH = Math.max(e.dayH, Number(r.day_hours) || 0);
    e.nightH = Math.max(e.nightH, Number(r.night_hours) || 0);
    if (r.jornada_start_at) {
      const t = new Date(r.jornada_start_at).getTime();
      const rt = new Date(r.jornada_marked_at || r.jornada_start_at).getTime(); // hora real (para reactivación)
      if (inferShift(r.jornada_start_at, r.jornada_shift) === 'day') {
        e.openStartDay = e.openStartDay == null ? t : Math.min(e.openStartDay, t);
        e.reactStartDay = e.reactStartDay == null ? rt : Math.max(e.reactStartDay, rt);
      } else {
        e.openStartNight = e.openStartNight == null ? t : Math.min(e.openStartNight, t);
        e.reactStartNight = e.reactStartNight == null ? rt : Math.max(e.reactStartNight, rt);
      }
    }
  });
  // Jornada de NOCHE de anoche aún abierta → cuenta como noche de hoy.
  (nightRes.data ?? []).forEach((r: any) => {
    const e = ensure(r.machinery_id);
    e.nightH = Math.max(e.nightH, Number(r.night_hours) || 0);
    if (r.jornada_start_at) {
      const t = new Date(r.jornada_start_at).getTime();
      const rt = new Date(r.jornada_marked_at || r.jornada_start_at).getTime();
      e.openStartNight = e.openStartNight == null ? t : Math.min(e.openStartNight, t);
      e.reactStartNight = e.reactStartNight == null ? rt : Math.max(e.reactStartNight, rt);
    }
  });
  return m;
}

/** Inspector ASIGNADO (CHECK MÁQUINA) por turno, día y noche por separado.
 *  Copia exacta de `loadInspByShift`. */
export async function fetchInspByShift(): Promise<Record<string, InspByShiftEntry>> {
  const { rows } = await listInspectorAssignments();
  const m: Record<string, InspByShiftEntry> = {};
  rows.forEach((r) => {
    const e = m[r.machinery_id] ?? { day: null, night: null };
    if (r.shift === 'night') e.night = r.inspector_name; else e.day = r.inspector_name;
    m[r.machinery_id] = e;
  });
  return m;
}

/**
 * Estatus EN VIVO de una máquina (avería/parada/trabajando + horas), copia EXACTA
 * de `liveStatusOf` en `EquiposScreen.tsx` (Catálogo) — extraída acá para que
 * cualquier pantalla que necesite el mismo widget "4 cubos" (Operativas/Averiadas/
 * Retiradas/Esperando) del Catálogo la use TAL CUAL, en vez de reimplementarla.
 * Antes `DashboardScreen.loadCounts` tenía su PROPIA reconstrucción de esta lógica
 * sobre `buildDaySets` (pensada para el panel de Inspecciones, no para este widget) +
 * un parche manual de reactivación cruzada — se desincronizaba del Catálogo en casos
 * reales (ej.: avería arrastrada + la máquina ya trabajó en el OTRO turno hoy: el
 * Catálogo la excluye por horas totales del día, `buildDaySets` es por-turno y no lo
 * veía) — queja del cliente 11-ago-2026 (Catálogo 203/23 vs Inicio 200/26).
 */
export function makeLiveStatusOf(params: {
  jornadaCat: Record<string, JornadaEntry>;
  averiaCat: Record<string, AveriaEntry>;
  inspByShift: Record<string, InspByShiftEntry>;
  retiredIds: Set<string>;
  nowTick: number;
}): (id: string) => LiveStatus {
  const { jornadaCat, averiaCat, inspByShift, retiredIds, nowTick } = params;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return (id: string) => {
    if (retiredIds.has(id)) return { estado: 'ninguno' as const, total: 0, enCurso: 0, trabajadas: 0, motivo: null as string | null, desdeMs: null as number | null };
    const j = jornadaCat[id];
    const a = averiaCat[id];
    const dayH = j?.dayH ?? 0;
    const nightH = j?.nightH ?? 0;
    const openStartDay = j?.openStartDay ?? null;
    const openStartNight = j?.openStartNight ?? null;
    // ANCLA del "en vivo": el DÍA cuenta desde su inicio NOMINAL 7am (igual que hours.ts →
    // Control / Reporte por empresa / Pagos y el reporte por firma; regla cliente "cuenta el
    // turno completo aunque marque a las 9am"). Antes contaba desde el inicio real y daba
    // menos horas que esas vistas para una máquina marcada tarde (unificación 17-ago-2026).
    // La NOCHE se deja en el inicio REAL porque cruza medianoche.
    const nominalDiaStart = new Date(`${caracasParts(new Date(nowTick)).iso}T07:00:00-04:00`).getTime();
    const elapsedDia = openStartDay ? Math.min(12, Math.max(0, (nowTick - nominalDiaStart) / 3600000)) : 0;
    const elapsedNoche = openStartNight ? Math.min(12, Math.max(0, (nowTick - openStartNight) / 3600000)) : 0;
    const workedDia = Math.min(12, dayH + elapsedDia);
    const workedNoche = Math.min(12, nightH + elapsedNoche);
    const total = workedDia + workedNoche;
    const enCurso = elapsedDia + elapsedNoche;
    const trabajadas = Math.max(0, total - enCurso);
    const hasOpen = openStartDay != null || openStartNight != null;
    // Para la REACTIVACIÓN se usa la hora REAL de arranque (jornada_marked_at), no el
    // inicio anclado al nominal 7am: una jornada re-iniciada a las 9:30 (anclada a 7am)
    // debe reactivarse contra las 9:30 — si no, una parada de la mañana la deja averiada/
    // parada con la jornada abierta (bug 23-ago-2026). Las horas de arriba NO cambian.
    const openStart = Math.max(j?.reactStartDay ?? 0, j?.reactStartNight ?? 0);
    const insp = inspByShift[id];
    const siempreActivo = inspectorSiempreActivo(insp?.day) || inspectorSiempreActivo(insp?.night);
    const todayStartMs = new Date(`${caracasParts(new Date(nowTick)).iso}T00:00:00-04:00`).getTime();
    const esHoy = !!a && a.createdMs >= todayStartMs;
    const reactivada = !!a && hasOpen && openStart >= a.createdMs;
    const nowShift = paradaShiftOf(new Date(nowTick).toISOString());
    const mismoTurno = !!a && paradaShiftOf(new Date(a.createdMs).toISOString()) === nowShift;
    const averiaVigente = !siempreActivo && !!a && mismoTurno && !reactivada && (esHoy || (!hasOpen && total <= 0));
    let estado: MachineEstado;
    if (averiaVigente && a!.tipo === 'averia') estado = 'averiada';
    else if (averiaVigente && a!.tipo === 'parada') estado = 'parada';
    else if (hasOpen) estado = 'trabajando';
    else if (total > 0) estado = 'trabajo_hoy';
    else estado = 'ninguno';
    // desdeMs = instante en que se marcó la avería/parada vigente (para el rótulo
    // "trabajó X h · averiada/parada desde HH:MM" en el Catálogo cuando trabajó y luego cayó).
    return { estado, total: round2(total), enCurso: round2(enCurso), trabajadas: round2(trabajadas), motivo: a?.motivo ?? null, desdeMs: (estado === 'averiada' || estado === 'parada') ? (a?.createdMs ?? null) : null };
  };
}

/** Máquina mínima que necesita el conteo de 4 cubos. */
export type MachineForStatus = { id: string; operational?: boolean | null; en_espera?: boolean | null };

/**
 * Conteo de maquinaria por estado (4 cubos EXCLUYENTES que suman el total),
 * copia exacta de las líneas 531-534 de EquiposScreen.tsx:
 *  · OPERATIVAS: operativas, SIN avería (en vivo, con reactivación) y SIN estar esperando instrucciones.
 *  · AVERIADAS: operativas con avería vigente (liveStatusOf, respeta reactivación por jornada nueva).
 *  · RETIRADAS: operational=false (sacadas de servicio).
 *  · ESPERANDO INSTRUCCIONES: en_espera=true.
 */
export function bucketMachineStatus<M extends MachineForStatus>(machines: M[], statusOf: (id: string) => LiveStatus) {
  const averiadaMachines = machines.filter((m) => m.operational !== false && !m.en_espera && statusOf(m.id).estado === 'averiada');
  const activeMachines = machines.filter((m) => m.operational && !m.en_espera && statusOf(m.id).estado !== 'averiada');
  const retiradaMachines = machines.filter((m) => !m.operational);
  const esperaMachines = machines.filter((m) => m.operational && m.en_espera);
  return { averiadaMachines, activeMachines, retiradaMachines, esperaMachines };
}
