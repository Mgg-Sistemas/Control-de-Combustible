import { PLACEHOLDER_INSPECTOR_ID, sinInspectorReal, type Shift } from './machineInspectors';

/**
 * Resolución HISTÓRICA pura (sin red) de asignaciones inspector ↔ máquina por
 * día de negocio y turno (Caracas UTC-4 fijo: Día 07:00–19:00, Noche 19:00–07:00+1).
 *
 * Fuente de verdad compartida entre `listInspectorAssignments(date)` /
 * `listInspectorAssignmentsForRange(from, to)` y las pruebas unitarias sin red
 * (`scripts/test-inspector-historial-turnos.mjs`).
 *
 * Reglas (consenso 25-nov-2026):
 *  1. Ventana por turno (NO día calendario): cada turno se evalúa de forma
 *     independiente. Si a las 19:37 se reasigna una máquina en "Día + Noche",
 *     el turno DÍA (07:00–19:00) sigue perteneciendo al inspector que estuvo
 *     en esa ventana, mientras el turno NOCHE (19:00–07:00+1) pasa al nuevo.
 *  2. Exactamente 1 inspector ganador por `(machinery_id, shift)` para no
 *     duplicar máquinas ni horas si hubo reasignación a mitad de turno.
 *  3. Prioridad en empate / cambio de turno:
 *     (a) Inspector humano sobre el placeholder `MAQUINAS FALTANTES`.
 *     (b) Mayor duración cubierta dentro de la ventana del turno.
 *     (c) En empate exacto, el tramo más reciente (`valid_from` mayor).
 *  4. Re-guardar el mismo inspector ya activo NO debe pisar `assigned_at`.
 */

export type AssignmentSpan = {
  id?: string;
  machinery_id: string;
  inspector_id: string | null;
  inspector_name: string | null;
  shift: Shift;
  valid_from: string;
  valid_to: string | null;
};

/** Ventana de trabajo del turno en milisegundos UTC (Caracas UTC-4 fijo):
 *  - DÍA:   [selDay 07:00-04:00, selDay 19:00-04:00]
 *  - NOCHE: [selDay 19:00-04:00, (selDay+1) 07:00-04:00] */
export function shiftWindowMs(selDay: string, shift: Shift): { startMs: number; endMs: number } {
  if (shift === 'night') {
    const d = new Date(`${selDay}T12:00:00-04:00`);
    d.setUTCDate(d.getUTCDate() + 1);
    const nextDay = d.toISOString().slice(0, 10);
    return {
      startMs: new Date(`${selDay}T19:00:00-04:00`).getTime(),
      endMs: new Date(`${nextDay}T07:00:00-04:00`).getTime(),
    };
  }
  return {
    startMs: new Date(`${selDay}T07:00:00-04:00`).getTime(),
    endMs: new Date(`${selDay}T19:00:00-04:00`).getTime(),
  };
}

/** ¿Ya cerró la ventana de trabajo de ese turno? */
export function isShiftClosed(selDay: string, shift: Shift, nowMs: number = Date.now()): boolean {
  return nowMs >= shiftWindowMs(selDay, shift).endMs;
}

/** ¿Conservar el `assigned_at` existente? true cuando se re-guarda al MISMO
 *  inspector que ya estaba activo en ese `(machinery_id, shift)` — evita pisar
 *  `assigned_at = now()` y hacer desaparecer el turno recién cerrado. */
export function shouldKeepAssignedAt(
  prev: { inspector_id: string | null; active?: boolean | null } | null | undefined,
  nextInspectorId: string,
): boolean {
  if (!prev || prev.active === false) return false;
  return !!prev.inspector_id && prev.inspector_id === nextInspectorId;
}

function esPlaceholderSpan(s: Pick<AssignmentSpan, 'inspector_id' | 'inspector_name'>): boolean {
  return s.inspector_id === PLACEHOLDER_INSPECTOR_ID || sinInspectorReal(s.inspector_name);
}

/** Resuelve el inspector ganador por máquina para UN turno de UN día de negocio.
 *  Devuelve a lo sumo 1 tramo por `machinery_id`. */
export function resolveAssignmentsForShift<T extends AssignmentSpan>(params: {
  spans: T[];
  selDay: string;
  shift: Shift;
  excludePlaceholder?: boolean;
}): T[] {
  const { spans, selDay, shift, excludePlaceholder = false } = params;
  const { startMs, endMs } = shiftWindowMs(selDay, shift);
  if (isNaN(startMs) || isNaN(endMs)) return [];

  type Candidate = { span: T; isHuman: boolean; overlapMs: number; fromMs: number };
  const bestByMachine = new Map<string, Candidate>();

  for (const s of spans) {
    if (s.shift !== shift) continue;
    const fromMs = new Date(s.valid_from).getTime();
    if (isNaN(fromMs) || fromMs > endMs) continue;
    const toMs = s.valid_to ? new Date(s.valid_to).getTime() : null;
    if (toMs !== null && !isNaN(toMs) && toMs <= startMs) continue;

    const isHuman = !esPlaceholderSpan(s);
    if (excludePlaceholder && !isHuman) continue;

    const effStart = Math.max(fromMs, startMs);
    const effEnd = toMs !== null && !isNaN(toMs) ? Math.min(toMs, endMs) : endMs;
    const overlapMs = Math.max(0, effEnd - effStart);

    const prev = bestByMachine.get(s.machinery_id);
    if (!prev) {
      bestByMachine.set(s.machinery_id, { span: s, isHuman, overlapMs, fromMs });
      continue;
    }
    const beats =
      (isHuman !== prev.isHuman ? isHuman : false) ||
      (isHuman === prev.isHuman && overlapMs > prev.overlapMs) ||
      (isHuman === prev.isHuman && overlapMs === prev.overlapMs && fromMs > prev.fromMs);
    if (beats) {
      bestByMachine.set(s.machinery_id, { span: s, isHuman, overlapMs, fromMs });
    }
  }

  return Array.from(bestByMachine.values()).map((c) => c.span);
}

/** Resuelve ambos turnos ('day' y 'night') de forma independiente para `selDay`. */
export function resolveAssignmentsForDate<T extends AssignmentSpan>(
  spans: T[],
  selDay: string,
  excludePlaceholder = false,
): T[] {
  return [
    ...resolveAssignmentsForShift({ spans, selDay, shift: 'day', excludePlaceholder }),
    ...resolveAssignmentsForShift({ spans, selDay, shift: 'night', excludePlaceholder }),
  ];
}

/** Índice en memoria para reportes de rango de fechas (`HistoricoJornadasScreen`):
 *  clave `${machinery_id}|${date}|${shift}` → nombre del inspector en ese día y turno.
 *  Cero llamadas N+1: procesa en memoria los tramos traídos en 1 sola consulta. */
export function buildRangeInspectorMap(
  spans: AssignmentSpan[],
  dates: string[],
): Map<string, string> {
  const out = new Map<string, string>();
  const uniqueDates = Array.from(new Set(dates.filter(Boolean)));
  for (const d of uniqueDates) {
    const resolved = resolveAssignmentsForDate(spans, d, false);
    for (const s of resolved) {
      out.set(`${s.machinery_id}|${d}|${s.shift}`, s.inspector_name || '');
    }
  }
  return out;
}
