import { supabase } from './supabase';
import { caracasParts } from './jornada';
import { inspectorSiempreActivo, listInspectorAssignments } from './machineInspectors';

/**
 * ESTATUS EN VIVO de una máquina — ÚNICA fuente de verdad.
 *
 * Extraído BYTE A BYTE de `liveStatusOf`/`loadJornadaCat`/`loadAveriaCat`/
 * `loadInspByShift` en `EquiposScreen.tsx` (el Catálogo, pantalla canónica ya
 * depurada varias veces). Antes el Dashboard tenía su PROPIA aproximación de esta
 * misma regla (via `buildDaySets` + parches manuales de "reactivación cruzada" y
 * "arrastrada") y se desincronizaba del Catálogo cada vez que se ajustaba una
 * regla en un solo lado (queja del cliente 11-ago-2026, dos veces el mismo día).
 *
 * REGLA: cualquier cambio a la clasificación avería/parada/trabajando de una
 * máquina se hace ACÁ. Ninguna pantalla debe reimplementar esta lógica en
 * paralelo — solo reunir los datos crudos (jornada, avería, inspector por turno)
 * y llamar a `makeLiveStatusOf` / `bucketMachineStatus`.
 */

export type JornadaEntry = { dayH: number; nightH: number; openStartDay: number | null; openStartNight: number | null };
export type AveriaEntry = { tipo: 'averia' | 'parada'; motivo: string | null; createdMs: number };
export type InspByShiftEntry = { day: string | null; night: string | null };
export type MachineEstado = 'averiada' | 'parada' | 'trabajando' | 'trabajo_hoy' | 'ninguno';
export type LiveStatus = { estado: MachineEstado; total: number; enCurso: number; trabajadas: number; motivo: string | null };

const round2 = (n: number) => Math.round(n * 100) / 100;

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

/**
 * Crea `liveStatusOf(id)` — estatus EN VIVO de una máquina, combinando jornada
 * (machine_rounds) y avería/parada (maintenance_requests). Todo derivado; NO toca
 * `operational`. Copia exacta de `liveStatusOf` en EquiposScreen.tsx:
 *  - elapsedDia/Noche: horas transcurridas de la jornada abierta de cada turno (cap 12).
 *  - workedDia/Noche: horas ya trabajadas + en curso de cada turno (cap 12).
 *  - total: acumulado del día = día + noche (regla del cliente: de noche muestra el acumulado del día).
 *  - enCurso: lo que corre ahora mismo; trabajadas = total − enCurso (banqueado).
 *  - reactivación: si la jornada abierta arrancó en el mismo instante o DESPUÉS de la
 *    marca de avería/parada (comparando `Math.max(openStartDay, openStartNight)` — CUALQUIER
 *    turno, no solo el de la marca), esa marca ya NO cuenta (la máquina volvió a trabajar).
 *  - HOY vs ARRASTRADA: una marca de HOY gana siempre (salvo reactivación); una marca
 *    ARRASTRADA (de días anteriores) solo cuenta si la máquina sigue totalmente pendiente
 *    hoy — si ya está trabajando (jornada abierta) o ya trabajó y cerró (total > 0), la
 *    marca arrastrada deja de contar.
 *  - "SIEMPRE ACTIVO" (SOS LA GUAIRA): sus máquinas nunca salen averiada/parada.
 */
export function makeLiveStatusOf(opts: {
  retiredIds: Set<string>;
  jornadaCat: Record<string, JornadaEntry>;
  averiaCat: Record<string, AveriaEntry>;
  inspByShift: Record<string, InspByShiftEntry>;
  nowMs: number;
}): (id: string) => LiveStatus {
  const { retiredIds, jornadaCat, averiaCat, inspByShift, nowMs } = opts;
  return (id: string): LiveStatus => {
    // Máquinas RETIRADAS (operational=false): fuera de servicio → estatus EN VIVO
    // "ninguno" aunque tengan una jornada abierta vieja.
    if (retiredIds.has(id)) return { estado: 'ninguno', total: 0, enCurso: 0, trabajadas: 0, motivo: null };
    const j = jornadaCat[id];
    const a = averiaCat[id];
    const dayH = j?.dayH ?? 0;
    const nightH = j?.nightH ?? 0;
    const openStartDay = j?.openStartDay ?? null;
    const openStartNight = j?.openStartNight ?? null;
    const elapsedDia = openStartDay ? Math.min(12, Math.max(0, (nowMs - openStartDay) / 3600000)) : 0;
    const elapsedNoche = openStartNight ? Math.min(12, Math.max(0, (nowMs - openStartNight) / 3600000)) : 0;
    const workedDia = Math.min(12, dayH + elapsedDia);
    const workedNoche = Math.min(12, nightH + elapsedNoche);
    const total = workedDia + workedNoche;
    const enCurso = elapsedDia + elapsedNoche;
    const trabajadas = Math.max(0, total - enCurso);
    const hasOpen = openStartDay != null || openStartNight != null;
    const openStart = Math.max(openStartDay ?? 0, openStartNight ?? 0);
    // REGLA "SIEMPRE ACTIVO" (SOS LA GUAIRA): sus máquinas nunca salen averiada/parada.
    const insp = inspByShift[id];
    const siempreActivo = inspectorSiempreActivo(insp?.day) || inspectorSiempreActivo(insp?.night);
    // HOY vs ARRASTRADA (mismo criterio que segmentoDe/segmentoConTurno en SupervisorScreen):
    // una marca de HOY gana siempre (salvo reactivación por jornada abierta después de la
    // marca); una marca ARRASTRADA (de días anteriores) solo cuenta si la máquina sigue
    // totalmente pendiente hoy — si ya está trabajando (jornada abierta) o ya trabajó y
    // cerró (total > 0), la jornada de hoy tiene prioridad y la arrastrada deja de mostrarse.
    const todayStartMs = new Date(`${caracasParts(new Date(nowMs)).iso}T00:00:00-04:00`).getTime();
    const esHoy = !!a && a.createdMs >= todayStartMs;
    const reactivada = !!a && hasOpen && openStart >= a.createdMs;
    const averiaVigente = !siempreActivo && !!a && !reactivada && (esHoy || (!hasOpen && total <= 0));
    let estado: MachineEstado;
    if (averiaVigente && a!.tipo === 'averia') estado = 'averiada';
    else if (averiaVigente && a!.tipo === 'parada') estado = 'parada';
    else if (hasOpen) estado = 'trabajando';
    else if (total > 0) estado = 'trabajo_hoy';
    else estado = 'ninguno';
    return { estado, total: round2(total), enCurso: round2(enCurso), trabajadas: round2(trabajadas), motivo: a?.motivo ?? null };
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
