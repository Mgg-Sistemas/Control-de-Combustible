// Fecha/turno "de negocio" en hora Caracas (UTC-4 fijo, sin horario de verano),
// compartido entre las pantallas que muestran/gestionan jornadas (InspectionsSummary,
// SupervisionScreen, PatioScreen). Antes cada pantalla tenía su propia copia de
// `caracasToday()` — funcionalmente igual, pero solo InspectionsSummary sabía que el
// turno NOCHE cruza la medianoche y sigue perteneciendo al día en que arrancó (7pm)
// hasta que amanece (7am). Centralizado acá para que las 3 pantallas usen SIEMPRE el
// mismo criterio (confirmado por el cliente 08/08/2026).
const CARACAS_TZ = 'America/Caracas';

/** Fecha ISO (AAAA-MM-DD) de HOY en Caracas (calendario puro). */
export function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hora actual (0–23) en Caracas. */
export function caracasNowHour(): number { let h = new Date().getUTCHours() - 4; if (h < 0) h += 24; return h; }

/** Turno ACTUAL según la hora de Caracas: día 7am–7pm, resto noche. */
export function caracasNowShift(): 'day' | 'night' { const h = caracasNowHour(); return h >= 7 && h < 19 ? 'day' : 'night'; }

/**
 * "HOY" de NEGOCIO (no de calendario): el turno noche cruza la medianoche y sigue
 * perteneciendo al día en que arrancó (7pm) hasta que amanece (7am) — antes de las
 * 7am, el día de negocio TODAVÍA es AYER. Sin esto, cualquier pantalla que use la
 * fecha de calendario de HOY como default de madrugada muestra el turno noche vacío
 * (la jornada real sigue con round_date = ayer) hasta que alguien navega a mano.
 */
export function caracasBusinessToday(): string {
  const today = caracasToday();
  if (caracasNowHour() >= 7) return today;
  const d = new Date(today + 'T12:00:00-04:00'); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Fecha ISO de AYER relativa a una fecha ISO dada (independiente de la hora actual). */
export function isoYesterday(iso: string): string {
  const d = new Date(iso + 'T12:00:00-04:00'); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * VENTANA DE GRACIA DE LA NOCHE (regla cliente 09-ago-2026): una jornada de NOCHE
 * (7pm–7am) ya FINALIZADA debe seguir viéndose CERRADA/finalizada hasta las 8am del día
 * siguiente; a las 8am pasa a "pendiente por iniciar". Entre 7am y 8am el día de negocio
 * ya avanzó a HOY, así que la noche recién cerrada (round_date = ayer) hay que
 * conservarla explícitamente. Esta es la ÚNICA fuente de verdad de la regla: la usan
 * TANTO el fetch de estados (qué ronda traer) COMO el clasificador (segmentoDe) del
 * teléfono — así no se pueden desincronizar. Si se cambia la hora tope, se cambia AQUÍ.
 */
export function inNightGraceWindow(): boolean {
  const h = caracasNowHour();
  return h >= 7 && h < 8;
}

/**
 * Fecha ISO de la NOCHE que debe conservarse como finalizada durante la gracia (ayer de
 * calendario), o null si no estamos en la ventana 7–8am. Su presencia es la señal para
 * traer SOLO las horas de noche de ese día (nunca las de día, para no tocar el turno diurno).
 */
export function nightGraceRoundDate(): string | null {
  return inNightGraceWindow() ? isoYesterday(caracasToday()) : null;
}

/**
 * Horas TRANSCURRIDAS del turno (día 07:00–19:00 · noche 19:00–07:00+1), tope 12h.
 * Corrección 08-ago-2026 (pedido cliente): la "eficiencia" ponderada por horas reales
 * dividía SIEMPRE entre 12h fijas aunque el turno recién hubiera empezado — a los 38
 * min de turno noche, ninguna máquina puede pasar de ~0.6h trabajadas, así que dividir
 * entre 12h completas mostraba ~0% toda la noche, "dañado", en vez de reflejar el
 * avance real. Con esta función, el DENOMINADOR también usa las horas ya transcurridas
 * del turno (mismo criterio que el NUMERADOR, que ya es en vivo) — así el % es
 * significativo desde el minuto 1 y converge a la fórmula final al cerrar el turno.
 * - Turno de un día YA CERRADO (no es el turno de negocio actual): 12h (turno completo).
 * - Turno de HOY, en curso: horas reales transcurridas desde que arrancó, tope 12h.
 */
export function shiftElapsedHours(dateISO: string, shift: 'day' | 'night'): number {
  const isCurrentBusinessDay = dateISO === caracasBusinessToday();
  if (!isCurrentBusinessDay) return 12;
  const startIso = shift === 'day' ? `${dateISO}T07:00:00-04:00` : `${dateISO}T19:00:00-04:00`;
  const start = new Date(startIso).getTime();
  if (Date.now() < start) return 0; // turno de hoy que todavía no arranca (p. ej. noche antes de las 19:00)
  const elapsedH = (Date.now() - start) / 3600000;
  return Math.min(12, Math.max(0, elapsedH));
}
