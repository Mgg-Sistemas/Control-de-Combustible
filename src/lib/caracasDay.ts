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
