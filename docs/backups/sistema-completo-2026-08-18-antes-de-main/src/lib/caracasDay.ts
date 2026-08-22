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

/** Fecha ISO (AAAA-MM-DD) y hora (0–23) de un instante ARBITRARIO en Caracas
 *  (mismo cálculo que `caracasToday()`/`caracasNowHour()`, pero para un `Date`
 *  dado en vez de "ahora"). */
function caracasPartsOf(d: Date): { iso: string; hour: number } {
  const p: any = new Intl.DateTimeFormat('en-CA', {
    timeZone: CARACAS_TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  }).formatToParts(d).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return { iso: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

/**
 * `round_date` de NEGOCIO de un instante `d` para un turno dado — misma regla que
 * `caracasBusinessToday()` (turno noche cruza la medianoche y sigue perteneciendo
 * al día en que arrancó hasta las 7am) pero aplicable a CUALQUIER timestamp, no
 * solo "ahora". Hace falta porque `machine_rounds`/`machine_work_segments` bucketean
 * por la fecha en que arrancó la jornada, y una jornada de NOCHE que se INICIA (o se
 * reanuda tras una parada) ya pasada la medianoche —ej. 00:13am— tiene un timestamp
 * cuya fecha de calendario es HOY, pero de negocio pertenece a la noche de AYER.
 * Turno DÍA nunca se ajusta (siempre su fecha de calendario tal cual, sin regla de
 * cruce de medianoche).
 */
export function businessRoundDateOf(d: Date, shift: 'day' | 'night'): string {
  const { iso, hour } = caracasPartsOf(d);
  if (shift === 'night' && hour < 7) return isoYesterday(iso);
  return iso;
}

/**
 * VENTANA DE GRACIA DE LA NOCHE (regla cliente 09-ago-2026; tope movido a 9am el
 * 13-ago-2026): una jornada de NOCHE ya FINALIZADA debe seguir viéndose
 * CERRADA/finalizada hasta las 9am del día siguiente; a las 9am se REINICIA el turno de
 * la noche y las finalizadas/cerradas pasan a "pendiente por iniciar". Entre 7am (cuando
 * el día de negocio ya avanzó a HOY) y 9am, la noche recién cerrada (round_date = ayer)
 * hay que conservarla explícitamente. Esta es la ÚNICA fuente de verdad de la regla: la
 * usan TANTO el fetch de estados (qué ronda traer) COMO el clasificador (segmentoDe) del
 * teléfono — así no se pueden desincronizar. Si se cambia la hora tope, se cambia AQUÍ.
 */
export function inNightGraceWindow(): boolean {
  const h = caracasNowHour();
  return h >= 7 && h < 9;
}

/**
 * Fecha ISO de la NOCHE que debe conservarse como finalizada durante la gracia (ayer de
 * calendario), o null si no estamos en la ventana 7–9am. Su presencia es la señal para
 * traer SOLO las horas de noche de ese día (nunca las de día, para no tocar el turno diurno).
 */
export function nightGraceRoundDate(): string | null {
  return inNightGraceWindow() ? isoYesterday(caracasToday()) : null;
}

/**
 * Instante (ms epoch) de FIN del turno de negocio: DÍA → 7:00pm del `round_date`;
 * NOCHE → 7:00am del día siguiente (12h para TODAS las máquinas, regla 14-ago-2026).
 * Caracas es UTC-4 fijo (sin horario de verano): 7pm=23:00 UTC, 7am=11:00 UTC. Mismo
 * criterio que el auto-cierre del servidor (supabase/auto_close_jornadas.sql).
 */
export function shiftEndMs(roundDate: string, shift: 'day' | 'night'): number {
  const [y, m, d] = roundDate.split('-').map(Number);
  return shift === 'night'
    ? Date.UTC(y, m - 1, d + 1, 11, 0, 0)
    : Date.UTC(y, m - 1, d, 23, 0, 0);
}

/**
 * ¿Se está FINALIZANDO la jornada ANTES de la hora de fin del turno? (cierre
 * anticipado). Regla cliente 15-ago-2026: TODO cierre manual anticipado —sin importar
 * la pantalla ni si el inspector es "siempre activo"— debe registrar el MOTIVO del
 * cierre. Las pantallas que finalizan jornada usan esto para exigir el motivo y marcar
 * el tramo como `manual_finish_early` con su `close_reason`.
 */
export function isCierreAnticipado(roundDate: string, shift: 'day' | 'night'): boolean {
  return Date.now() < shiftEndMs(roundDate, shift);
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
