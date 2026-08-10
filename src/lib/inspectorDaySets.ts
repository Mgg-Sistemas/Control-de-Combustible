import { inspectorSiempreActivo } from './machineInspectors';

/**
 * Clasificación por DÍA/TURNO de las máquinas de cada inspector (avería / parada /
 * iniciada / cerrada / pendiente) + su % de eficiencia.
 *
 * Extraído de `buildDaySets`/`perInspector` en `InspectionsSummary.tsx` (pantalla
 * en vivo) para que el PDF "REPORTE RESUMEN POR INSPECTOR"
 * (`inspectorSummaryReport.ts`) use EXACTAMENTE el mismo cálculo. Antes cada uno
 * tenía su propia copia de esta lógica y, con cada ajuste de reglas de negocio,
 * se desincronizaban en silencio: el cliente reportó (09-ago-2026) que para el
 * mismo día/turno la pantalla y el PDF mostraban % de eficiencia y conteos de
 * "máquinas asignadas" DISTINTOS para el mismo inspector.
 *
 * REGLA: cualquier cambio a estas reglas de negocio se hace ACÁ. Quien las use
 * (pantalla o PDF) solo pasa sus propios datos crudos — nunca reimplementa la
 * clasificación en paralelo.
 */

/** Turno de una PARADA/AVERÍA por la hora (Caracas, UTC-4 fijo, sin horario de
 *  verano) en que se marcó: día 7am–7pm, resto noche. */
export const paradaShiftOf = (iso: string): 'day' | 'night' => {
  const d = new Date(iso);
  let h = d.getUTCHours() - 4;
  if (h < 0) h += 24;
  return h >= 7 && h < 19 ? 'day' : 'night';
};

export type DaySetRound = {
  machinery_id: string;
  round_date: string;
  day_hours: number | null;
  night_hours: number | null;
  jornada_shift: string | null;
  jornada_start_at: string | null;
};
export type DaySetMaint = { machinery_id: string; material: string | null; created_at: string };
export type DaySetAssign = { machinery_id: string; inspector_name: string | null; shift: 'day' | 'night' };
export type MachineFlags = { id: string; active: boolean | null; operational: boolean | null; en_espera: boolean | null };

/**
 * Máquinas fuera del catálogo asignable, en dos niveles (igual que
 * `machInactiveSet`/`machHardInactiveSet` en InspectionsSummary.tsx):
 *  - "duras" (machHardInactiveSet): active=false u operational=false (botón
 *    "⛔ Inactiva" del Catálogo). NUNCA se muestran, ni con jornada abierta
 *    (regla confirmada por el cliente 08/08/2026).
 *  - "blandas" (machInactiveSet): active=false o en_espera=true. Se ocultan
 *    salvo que tengan una jornada abierta HOY (anyOpenSet) — mismo criterio
 *    que el teléfono (visibleParaInspector).
 */
export function computeMachineVisibilitySets(machList: MachineFlags[]): { machInactiveSet: Set<string>; machHardInactiveSet: Set<string> } {
  const machInactiveSet = new Set<string>();
  const machHardInactiveSet = new Set<string>();
  machList.forEach((m) => {
    if (m.active === false || m.en_espera === true) machInactiveSet.add(m.id);
    if (m.active === false || m.operational === false) machHardInactiveSet.add(m.id);
  });
  return { machInactiveSet, machHardInactiveSet };
}

export type DaySets = {
  startedSet: Set<string>;
  paradaSet: Set<string>;
  averSet: Set<string>;
  assignedShift: Set<string>;
  closedSet: Set<string>;
  pendSet: Set<string>;
  anyOpenSet: Set<string>;
  activeNowSet: Set<string>;
};

/**
 * Clasifica TODAS las máquinas relevantes de un turno dado (para un día) en
 * avería / parada / iniciada(activa u cerrada) / pendiente. Copia exacta de
 * `buildDaySets` en InspectionsSummary.tsx — ver ese archivo (historial de
 * comentarios) para el detalle de cada regla (reactivación tras avería/parada,
 * ventana del turno noche cruzando medianoche, "SIEMPRE ACTIVO", etc.).
 */
export function buildDaySets(params: {
  rounds: DaySetRound[];
  maint: DaySetMaint[];
  /** TODAS las asignaciones (ambos turnos) — `siempreActivoSet` no filtra por
   *  turno, así que la exención "SIEMPRE ACTIVO" aplica a la máquina sea cual
   *  sea el turno que se esté clasificando. */
  assignments: DaySetAssign[];
  selDay: string;
  shiftArg: 'day' | 'night';
  machInactiveSet: Set<string>;
  machHardInactiveSet: Set<string>;
}): DaySets {
  const { rounds, maint, assignments, selDay, shiftArg, machInactiveSet, machHardInactiveSet } = params;

  // Turno de una jornada ABIERTA (jornada_shift nulo → se infiere por la hora inicio).
  const openShiftOf = (r: DaySetRound): 'day' | 'night' =>
    r.jornada_shift === 'night' ? 'night'
      : r.jornada_shift === 'day' ? 'day'
      : paradaShiftOf(r.jornada_start_at as string);
  // Umbral mínimo defensivo (RED DE SEGURIDAD, no reemplaza la causa raíz): un
  // round con `round_date` mal calculado por cruce de medianoche del turno NOCHE
  // (BUG 10-ago-2026, ver `caracasBusinessToday()` en caracasDay.ts — a veces se
  // guardaba la fecha de HOY en vez de AYER) puede dejar un residuo mínimo de
  // horas (visto en datos reales: ~0.02h) pegado al round de HOY. Sin este
  // umbral, ese residuo hace que `workedInShift` cuente el turno de HOY como
  // "trabajado" aunque en realidad todavía no haya arrancado — y esas máquinas
  // salen "Cerradas" en InspectionsSummary/el PDF cuando en verdad están
  // pendientes. 0.05h (3 min) está muy por debajo de cualquier jornada real
  // (se miden en horas), así que no debería enmascarar jornadas cortas legítimas;
  // protege tanto los 3 casos ya contaminados en la BD (que no se van a corregir
  // retroactivamente) como cualquier otro flujo futuro no detectado que reproduzca
  // el mismo tipo de residuo.
  const MIN_WORKED_HOURS = 0.05;
  // ¿La ronda tuvo actividad en ESTE turno? Una máquina "corrido" (12h día + N noche)
  // cuenta en AMBOS turnos: en DÍA por sus day_hours, en NOCHE por sus night_hours.
  const workedInShift = (r: DaySetRound, sh: 'day' | 'night'): boolean => {
    if (sh === 'day' && (Number(r.day_hours) || 0) > MIN_WORKED_HOURS) return true;
    if (sh === 'night' && (Number(r.night_hours) || 0) > MIN_WORKED_HOURS) return true;
    return !!r.jornada_start_at && openShiftOf(r) === sh; // jornada abierta de ese turno
  };

  const workedSet = new Set<string>();  // trabajó/abrió (jornada de ESTE turno)
  const openSet = new Set<string>();    // jornada de ESTE turno aún abierta
  const anyOpenSet = new Set<string>(); // CUALQUIER jornada abierta (sigue trabajando)
  const openStartMs = new Map<string, number>(); // hora de inicio de la jornada ABIERTA de ESTE turno
  rounds.forEach((r) => {
    if (r.round_date !== selDay) return;
    if (workedInShift(r, shiftArg)) workedSet.add(r.machinery_id);
    if (r.jornada_start_at) {
      anyOpenSet.add(r.machinery_id);
      if (openShiftOf(r) === shiftArg) {
        openSet.add(r.machinery_id);
        const ms = new Date(r.jornada_start_at as string).getTime();
        if (!isNaN(ms)) openStartMs.set(r.machinery_id, Math.max(openStartMs.get(r.machinery_id) ?? 0, ms));
      }
    }
  });

  const dayStartMs = new Date(selDay + 'T00:00:00-04:00').getTime();
  // El turno NOCHE cruza la medianoche (19:00 → 07:00 del día siguiente): una
  // avería/parada marcada a las 2am, por ejemplo, sigue siendo del turno noche
  // de ESTE día — se extiende el corte hasta las 7am del día siguiente SOLO
  // para el turno noche.
  const nightNextDay = (() => { const d = new Date(selDay + 'T12:00:00-04:00'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
  const dayEndMs = shiftArg === 'night'
    ? new Date(`${nightNextDay}T07:00:00-04:00`).getTime()
    : new Date(selDay + 'T23:59:59.999-04:00').getTime();

  // REACTIVACIÓN: si la jornada de ESTE turno se (re)inició DESPUÉS de la
  // avería/parada, la máquina volvió a trabajar → no cuenta como averiada/parada
  // (evita el absurdo de "🔴 AVERIADA" y "EN CURSO" a la vez). Con jornada
  // abierta, la única comparación válida es la de tiempos (`js >= t`).
  // BUG (10-ago-2026): con la jornada YA CERRADA, esto caía a `workedSet.has(id)`
  // (trabajó el turno, sin importar CUÁNDO) — para una marca ARRASTRADA (de un día
  // anterior) es correcto (definitivamente es antes del trabajo de hoy), pero para
  // una marca de HOY (p. ej. el inspector cierra jornada y AL INSTANTE marca
  // "parada") también entraba por acá y la anulaba, aunque la parada fuera
  // POSTERIOR al trabajo — así una máquina recién marcada "parada" seguía
  // saliendo "Cerrada" en el panel/PDF (pero "Parada" en el teléfono del
  // coordinador, que no tiene este atajo). El caso ARRASTRADA+trabajó ya lo cubre
  // aparte el `arr ? !workedSet.has(...) : true` de abajo; acá solo debe importar
  // si había una jornada ABIERTA que arrancó después de la marca.
  const reactivadaTras = (id: string, t: number) => {
    const js = openStartMs.get(id);
    return js != null && js >= t;
  };

  // REGLA "SIEMPRE ACTIVO" (SOS LA GUAIRA): sus máquinas nunca entran a avería/
  // parada — caen a iniciada/cerrada/pendiente según su jornada (se ignora el ticket).
  const siempreActivoSet = new Set(
    assignments.filter((a) => inspectorSiempreActivo(a.inspector_name)).map((a) => a.machinery_id),
  );

  // Averías de ESTE turno. El estado avería/parada pertenece al turno de la HORA
  // en que se marcó (paradaShiftOf); arrastra dentro de SU mismo turno hasta
  // resolverla (si es de un día anterior, cuenta salvo que la máquina haya
  // trabajado ese turno).
  const averAll = new Set<string>();
  maint.forEach((m) => {
    if (m.material === 'MÁQUINA PARADA') return;
    if (siempreActivoSet.has(m.machinery_id)) return;
    const t = new Date(m.created_at).getTime();
    if (t > dayEndMs || paradaShiftOf(m.created_at) !== shiftArg) return;
    if (reactivadaTras(m.machinery_id, t)) return;
    const arr = t < dayStartMs;
    if (arr ? !workedSet.has(m.machinery_id) : true) averAll.add(m.machinery_id);
  });

  // Paradas de ESTE turno (misma regla por-turno que las averías).
  const paradaAll = new Set<string>();
  maint.forEach((m) => {
    if (m.material !== 'MÁQUINA PARADA') return;
    if (siempreActivoSet.has(m.machinery_id)) return;
    const t = new Date(m.created_at).getTime();
    if (t > dayEndMs || averAll.has(m.machinery_id) || paradaShiftOf(m.created_at) !== shiftArg) return;
    if (reactivadaTras(m.machinery_id, t)) return;
    const arr = t < dayStartMs;
    const applies = arr ? !workedSet.has(m.machinery_id) : true;
    if (applies) paradaAll.add(m.machinery_id);
  });

  const assignedShift = new Set(assignments.filter((a) => a.shift === shiftArg).map((a) => a.machinery_id));
  // MISMO criterio que el teléfono (visibleParaInspector): una máquina INACTIVA/
  // averiada solo cuenta si tiene una jornada ABIERTA ahora (anyOpenSet).
  const visibleOk = (id: string) => !machHardInactiveSet.has(id) && (!machInactiveSet.has(id) || anyOpenSet.has(id));
  // Universo del turno: asignadas al turno + las que trabajaron el turno, ambas
  // filtradas por el mismo criterio de visibilidad del teléfono.
  const universe = new Set<string>();
  assignedShift.forEach((id) => { if (visibleOk(id)) universe.add(id); });
  workedSet.forEach((id) => { if (visibleOk(id)) universe.add(id); });
  averAll.forEach((id) => { if ((assignedShift.has(id) || workedSet.has(id)) && visibleOk(id)) universe.add(id); });

  // Clasificación por prioridad (igual que el teléfono): avería > parada > iniciada > pendiente.
  const startedSet = new Set<string>();
  const paradaSet = new Set<string>();
  const averSet = new Set<string>();
  const closedSet = new Set<string>();
  const pendSet = new Set<string>();
  const activeNowSet = new Set<string>();
  universe.forEach((id) => {
    if (averAll.has(id)) { averSet.add(id); return; }
    if (paradaAll.has(id)) { paradaSet.add(id); return; }
    if (workedSet.has(id)) {
      startedSet.add(id);
      if (openSet.has(id)) activeNowSet.add(id);
      else closedSet.add(id);
      return;
    }
    pendSet.add(id);
  });

  return { startedSet, paradaSet, averSet, assignedShift, closedSet, pendSet, anyOpenSet, activeNowSet };
}

export type InspectorClassification = {
  visibleIds: string[];
  ini: string[];
  pend: string[];
  par: string[];
  ave: string[];
  eficiencia: number | null;
};

/**
 * Clasifica las máquinas de UN inspector (ya asignadas + filtradas por turno) en
 * avería/parada/iniciada/pendiente y calcula su % de eficiencia — misma fórmula
 * y mismo criterio de visibilidad que `perInspector` en InspectionsSummary.tsx:
 * eficiencia = % de asignadas SOBRE LAS QUE YA ACTUÓ (iniciada, cerrada, parada o
 * averiada cuentan como "hecha"; solo las pendientes sin tocar bajan el %).
 */
export function classifyInspectorMachines(params: {
  machineryIds: Iterable<string>; // máquinas asignadas a este inspector en este turno (pueden venir repetidas)
  daySets: Pick<DaySets, 'startedSet' | 'paradaSet' | 'averSet' | 'anyOpenSet'>;
  machInactiveSet: Set<string>;
  machHardInactiveSet: Set<string>;
  /** true = usuario de sistema (MAQUINAS FALTANTES / cajón sin inspector real):
   *  sin % de eficiencia (no tiene sentido premiar/penalizar al sistema). */
  isVirtual: boolean;
}): InspectorClassification {
  const { daySets, machInactiveSet, machHardInactiveSet, isVirtual } = params;
  const ini: string[] = [], pend: string[] = [], par: string[] = [], ave: string[] = [];
  const visibleIds = Array.from(new Set(params.machineryIds)).filter(
    (id) => !machHardInactiveSet.has(id) && (!machInactiveSet.has(id) || daySets.anyOpenSet.has(id)),
  );
  visibleIds.forEach((id) => {
    if (daySets.averSet.has(id)) ave.push(id);
    else if (daySets.paradaSet.has(id)) par.push(id);
    else if (daySets.startedSet.has(id)) ini.push(id);
    else pend.push(id);
  });
  const eficiencia = isVirtual || visibleIds.length === 0 ? null : Math.round(((visibleIds.length - pend.length) / visibleIds.length) * 100);
  return { visibleIds, ini, pend, par, ave, eficiencia };
}
