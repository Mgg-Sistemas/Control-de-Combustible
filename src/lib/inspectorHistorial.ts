/**
 * Resolución HISTÓRICA pura (sin red y sin imports circulares) de asignaciones
 * inspector ↔ máquina por día de negocio y turno (Caracas UTC-4 fijo:
 * Día 07:00–19:00, Noche 19:00–07:00+1).
 *
 * Fuente de verdad compartida entre `listInspectorAssignments(date)` /
 * `listInspectorAssignmentsForRange(from, to)` y las pruebas unitarias sin red
 * (`scripts/test-inspector-historial-turnos.mjs`).
 *
 * Reglas (consenso 25-nov-2026 + auditoría 8 agentes):
 *  1. Ventana semiabierta por turno `[startMs, endMs)` (NO día calendario):
 *     - DÍA:   [selDay 07:00-04:00, selDay 19:00-04:00)
 *     - NOCHE: [selDay 19:00-04:00, (selDay+1) 07:00-04:00)
 *     Un tramo que arranca exactamente a las 19:00:00 (0 ms de solape) NO entra al turno DÍA.
 *  2. Exactamente 1 inspector ganador por `(machinery_id, shift)` para no
 *     duplicar máquinas ni horas si hubo reasignación a mitad de turno.
 *  3. Prioridad en empate / cambio de turno (solo entre tramos con `overlapMs > 0`):
 *     (a) Inspector humano sobre el placeholder `MAQUINAS FALTANTES`.
 *     (b) Mayor duración cubierta dentro de la ventana del turno.
 *     (c) En empate exacto, el tramo más reciente (`valid_from`, luego `valid_to`, luego `id`).
 *  4. Re-guardar el mismo inspector ya activo NO debe pisar `assigned_at`.
 */

export type Shift = 'day' | 'night';
const PLACEHOLDER_INSPECTOR_ID = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
const SHIFT_DURATION_MS = 12 * 60 * 60 * 1000;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type AssignmentSpan = {
  id?: string;
  machinery_id: string;
  inspector_id: string | null;
  inspector_name: string | null;
  shift: Shift;
  valid_from: string;
  valid_to: string | null;
};

/** Ventana de trabajo del turno en milisegundos UTC (Caracas UTC-4 fijo, sin DST):
 *  - DÍA:   [selDay 07:00-04:00, selDay 19:00-04:00)
 *  - NOCHE: [selDay 19:00-04:00, (selDay+1) 07:00-04:00)
 *  Devuelve `{ startMs: NaN, endMs: NaN }` si `selDay` no es `YYYY-MM-DD` válido. */
export function shiftWindowMs(selDay: string, shift: Shift): { startMs: number; endMs: number } {
  if (!selDay || !ISO_DAY_RE.test(selDay)) return { startMs: NaN, endMs: NaN };
  const startMs = new Date(`${selDay}T${shift === 'night' ? '19' : '07'}:00:00-04:00`).getTime();
  if (isNaN(startMs)) return { startMs: NaN, endMs: NaN };
  return { startMs, endMs: startMs + SHIFT_DURATION_MS };
}

/** ¿Ya cerró la ventana de trabajo de ese turno? */
export function isShiftClosed(selDay: string, shift: Shift, nowMs: number = Date.now()): boolean {
  const { endMs } = shiftWindowMs(selDay, shift);
  return !isNaN(endMs) && nowMs >= endMs;
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
  return s.inspector_id === PLACEHOLDER_INSPECTOR_ID || !s.inspector_name || /faltant/i.test(s.inspector_name);
}

type ParsedSpan<T extends AssignmentSpan> = {
  span: T;
  fromMs: number;
  toMs: number | null;
  isHuman: boolean;
};

function parseSpans<T extends AssignmentSpan>(spans: T[]): ParsedSpan<T>[] {
  const out: ParsedSpan<T>[] = [];
  for (const s of spans) {
    const fromMs = new Date(s.valid_from).getTime();
    if (isNaN(fromMs)) continue;
    const toMs = s.valid_to != null ? new Date(s.valid_to).getTime() : null;
    // Rechazar tramos con `valid_to` corrupto o invertido (`valid_to <= valid_from`)
    if (toMs !== null && (isNaN(toMs) || toMs <= fromMs)) continue;
    out.push({ span: s, fromMs, toMs, isHuman: !esPlaceholderSpan(s) });
  }
  return out;
}

function resolveParsedForWindow<T extends AssignmentSpan>(
  parsed: ParsedSpan<T>[],
  shift: Shift,
  startMs: number,
  endMs: number,
  excludePlaceholder: boolean,
): T[] {
  if (isNaN(startMs) || isNaN(endMs)) return [];

  type Candidate = { span: T; isHuman: boolean; overlapMs: number; fromMs: number; toRank: number };
  const bestByMachine = new Map<string, Candidate>();

  for (const p of parsed) {
    if (p.span.shift !== shift) continue;
    if (p.fromMs >= endMs) continue;
    if (p.toMs !== null && p.toMs <= startMs) continue;
    if (excludePlaceholder && !p.isHuman) continue;

    const effStart = Math.max(p.fromMs, startMs);
    const effEnd = p.toMs !== null ? Math.min(p.toMs, endMs) : endMs;
    const overlapMs = effEnd - effStart;
    if (overlapMs <= 0) continue;

    const toRank = p.toMs ?? Number.POSITIVE_INFINITY;
    const prev = bestByMachine.get(p.span.machinery_id);
    if (!prev) {
      bestByMachine.set(p.span.machinery_id, { span: p.span, isHuman: p.isHuman, overlapMs, fromMs: p.fromMs, toRank });
      continue;
    }
    const beats =
      (p.isHuman !== prev.isHuman ? p.isHuman : false) ||
      (p.isHuman === prev.isHuman && overlapMs > prev.overlapMs) ||
      (p.isHuman === prev.isHuman && overlapMs === prev.overlapMs && p.fromMs > prev.fromMs) ||
      (p.isHuman === prev.isHuman && overlapMs === prev.overlapMs && p.fromMs === prev.fromMs && (
        toRank > prev.toRank || (toRank === prev.toRank && (p.span.id ?? '') > (prev.span.id ?? ''))
      ));
    if (beats) {
      bestByMachine.set(p.span.machinery_id, { span: p.span, isHuman: p.isHuman, overlapMs, fromMs: p.fromMs, toRank });
    }
  }

  return Array.from(bestByMachine.values()).map((c) => c.span);
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
  return resolveParsedForWindow(parseSpans(spans), shift, startMs, endMs, excludePlaceholder);
}

/** Resuelve ambos turnos ('day' y 'night') de forma independiente para `selDay`. */
export function resolveAssignmentsForDate<T extends AssignmentSpan>(
  spans: T[],
  selDay: string,
  excludePlaceholder = false,
): T[] {
  const parsed = parseSpans(spans);
  const dWin = shiftWindowMs(selDay, 'day');
  const nWin = shiftWindowMs(selDay, 'night');
  return [
    ...resolveParsedForWindow(parsed, 'day', dWin.startMs, dWin.endMs, excludePlaceholder),
    ...resolveParsedForWindow(parsed, 'night', nWin.startMs, nWin.endMs, excludePlaceholder),
  ];
}

/** Índice en memoria para reportes de rango de fechas (`HistoricoJornadasScreen`):
 *  clave `${machinery_id}|${date}|${shift}` → nombre del inspector en ese día y turno.
 *  Pre-parsea fechas una sola vez (rápido incluso en rangos de 90 días en móvil). */
export function buildRangeInspectorMap(
  spans: AssignmentSpan[],
  dates: string[],
): Map<string, string> {
  const out = new Map<string, string>();
  const uniqueDates = Array.from(
    new Set(dates.map((d) => (d || '').trim()).filter((d) => ISO_DAY_RE.test(d))),
  );
  if (uniqueDates.length === 0 || spans.length === 0) return out;

  const parsed = parseSpans(spans);
  const daySpans = parsed.filter((p) => p.span.shift === 'day');
  const nightSpans = parsed.filter((p) => p.span.shift === 'night');

  for (const d of uniqueDates) {
    const dWin = shiftWindowMs(d, 'day');
    for (const s of resolveParsedForWindow(daySpans, 'day', dWin.startMs, dWin.endMs, false)) {
      out.set(`${s.machinery_id}|${d}|day`, s.inspector_name || '');
    }
    const nWin = shiftWindowMs(d, 'night');
    for (const s of resolveParsedForWindow(nightSpans, 'night', nWin.startMs, nWin.endMs, false)) {
      out.set(`${s.machinery_id}|${d}|night`, s.inspector_name || '');
    }
  }
  return out;
}
