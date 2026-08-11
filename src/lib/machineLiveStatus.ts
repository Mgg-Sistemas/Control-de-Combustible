import { supabase } from './supabase';
import { caracasParts } from './jornada';
import { listInspectorAssignments } from './machineInspectors';

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

export type JornadaEntry = { dayH: number; nightH: number; openStartDay: number | null; openStartNight: number | null };
export type AveriaEntry = { tipo: 'averia' | 'parada'; motivo: string | null; createdMs: number };
export type InspByShiftEntry = { day: string | null; night: string | null };
export type MachineEstado = 'averiada' | 'parada' | 'trabajando' | 'trabajo_hoy' | 'ninguno';
export type LiveStatus = { estado: MachineEstado; total: number; enCurso: number; trabajadas: number; motivo: string | null };

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
    supabase.from('machine_rounds').select('machinery_id, day_hours, night_hours, jornada_start_at, jornada_shift').eq('round_date', today),
    supabase.from('machine_rounds').select('machinery_id, night_hours, jornada_start_at, jornada_shift').eq('round_date', yesterday).eq('jornada_shift', 'night').not('jornada_start_at', 'is', null),
  ]);
  const m: Record<string, JornadaEntry> = {};
  const ensure = (id: string) => (m[id] ??= { dayH: 0, nightH: 0, openStartDay: null, openStartNight: null });
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
      if (inferShift(r.jornada_start_at, r.jornada_shift) === 'day') e.openStartDay = e.openStartDay == null ? t : Math.min(e.openStartDay, t);
      else e.openStartNight = e.openStartNight == null ? t : Math.min(e.openStartNight, t);
    }
  });
  // Jornada de NOCHE de anoche aún abierta → cuenta como noche de hoy.
  (nightRes.data ?? []).forEach((r: any) => {
    const e = ensure(r.machinery_id);
    e.nightH = Math.max(e.nightH, Number(r.night_hours) || 0);
    if (r.jornada_start_at) {
      const t = new Date(r.jornada_start_at).getTime();
      e.openStartNight = e.openStartNight == null ? t : Math.min(e.openStartNight, t);
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
