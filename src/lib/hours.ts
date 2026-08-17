/**
 * FÓRMULA CANÓNICA DE HORAS TRABAJADAS — un solo lugar para todo el sistema.
 *
 * Vive en `src/lib/` (sin dependencias de React Native) para que la puedan usar tanto
 * las pantallas (Control, Pagos, Informe por jornada) como las librerías de reportes
 * (reporte del día por empresa). Antes estaba definida dentro de ControlMaquinariaScreen
 * y el reporte por empresa la reimplementaba a mano → los dos reportes NO cuadraban.
 * Centralizarla aquí garantiza que TODOS calculen igual (pedido del cliente: el reporte
 * por empresa de inspecciones y el informe por jornada deben COINCIDIR).
 */

/**
 * HORAS REALES SIN REDONDEAR (pedido cliente 09/08/2026): cada turno usa sus horas
 * REALES tal cual (ya NO se redondean hacia arriba). Antes se hacía `Math.ceil`; el
 * cliente pidió dejarlas como aparecen en TODO el sistema (Control, Inspecciones,
 * Informe, Pagos — todos llaman esta función, así que quedan consistentes). Lo único
 * que se sigue aplicando es el ANCLAJE de inicio de turno (día 7am / noche 7pm) en los
 * cálculos EN VIVO de los reportes, no aquí.
 */
export const turnoH = (h: number): number => Math.max(0, Number(h) || 0);

/** Horas trabajadas del día = (turno día + turno noche, redondeados) − parada + extras (mín. 0 antes de extras). */
export const workedFromShifts = (dayH: number, nightH: number, stopped: number, overtime: number) =>
  Math.max(0, turnoH(dayH) + turnoH(nightH) - (Number(stopped) || 0)) + Math.max(0, Number(overtime) || 0);

/**
 * Umbral mínimo defensivo: un round con `round_date` mal calculado por cruce de
 * medianoche del turno NOCHE (BUG 10-ago-2026, ya corregido en el guardado — ver
 * `businessRoundDateOf` en caracasDay.ts) puede dejar un residuo de ~0.02 h pegado
 * al round de HOY. 0.05 h (3 min) está muy por debajo de cualquier jornada real.
 */
export const MIN_WORKED_HOURS = 0.05;

/** Lo que hace falta de una fila de `machine_rounds` para calcular sus horas. */
export type RondaHoras = {
  day_hours?: number | null;
  night_hours?: number | null;
  hours_stopped?: number | null;
  overtime_hours?: number | null;
  jornada_start_at?: string | null;
  jornada_shift?: string | null;
};

/**
 * HORAS DE UN DÍA PARA UNA MÁQUINA — fuente ÚNICA compartida.
 *
 * Extraída del Reporte por Empresa (`porEmpresaReport.ts`), que es el documento que
 * el cliente toma como bueno. El módulo de CONTROL la reimplementaba a medias —
 * leía solo `day_hours`/`night_hours` crudos y ni siquiera consultaba
 * `jornada_start_at` — así que durante el turno Control mostraba 0 h para una
 * máquina que el reporte por empresa ya daba trabajando. Esa era la
 * desincronización que reportó el cliente (16-ago-2026).
 *
 * Reglas (las del reporte por empresa, sin cambiar ninguna):
 *  1. Residuos por debajo de `MIN_WORKED_HOURS` se descartan.
 *  2. EN VIVO: si el día pedido es HOY y la jornada de ese turno sigue ABIERTA y
 *     arrancó DENTRO del día, el turno cuenta desde el INICIO NOMINAL (7am día /
 *     7pm noche), NO desde que la marcaron — "aunque la marquen a las 9am, cuenta
 *     el turno completo". Tope de 12 h y se toma el MAYOR contra lo ya bancado
 *     (no la suma: al reabrir una jornada el inicio se re-ancla y sumar contaría
 *     dos veces el tramo bancado).
 *  3. Trabajadas = `workedFromShifts` (resta paradas, suma extras).
 *
 * En un día PASADO el paso 2 nunca aplica → devuelve exactamente lo bancado, así
 * que los cierres y pagos de días cerrados no cambian.
 *
 * Blindada por `scripts/test-horas-control.mjs` (`npm run test:horas`).
 *
 * @param date día ISO "AAAA-MM-DD" al que pertenece la fila
 * @param nowMs instante de referencia (inyectable para poder probarlo)
 */
export function horasTurnoDelDia(
  r: RondaHoras | null | undefined,
  date: string,
  nowMs: number = Date.now(),
): { dia: number; noche: number; trabajadas: number } {
  let dd = Number(r?.day_hours) || 0;
  let nn = Number(r?.night_hours) || 0;
  if (dd <= MIN_WORKED_HOURS) dd = 0;
  if (nn <= MIN_WORKED_HOURS) nn = 0;
  const sRaw = Number(r?.hours_stopped) || 0;
  const oRaw = Number(r?.overtime_hours) || 0;

  const dayBoundStart = new Date(`${date}T00:00:00-04:00`).getTime();
  const dayBoundEnd = new Date(`${date}T23:59:59.999-04:00`).getTime();
  const caracasHoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(nowMs));
  const isToday = date === caracasHoy;
  const jStart = r?.jornada_start_at ? new Date(r.jornada_start_at).getTime() : null;
  const jShift = r?.jornada_shift === 'night' ? 'night' : r?.jornada_shift === 'day' ? 'day' : null;
  // Solo suma en vivo si la jornada arrancó DENTRO de este día (una máquina averiada
  // arrastrada de otro día no debe inflar el día que se está mirando).
  const jStartHoy = jStart != null && jStart >= dayBoundStart && jStart <= dayBoundEnd;
  if (isToday && jStart && jShift && jStartHoy) {
    const shiftStart = jShift === 'night'
      ? new Date(`${date}T19:00:00-04:00`).getTime()
      : new Date(`${date}T07:00:00-04:00`).getTime();
    const elapsed = Math.min(12, Math.max(0, (nowMs - shiftStart) / 3600000));
    if (jShift === 'night') nn = Math.max(nn, elapsed); else dd = Math.max(dd, elapsed);
  }
  return { dia: dd, noche: nn, trabajadas: workedFromShifts(dd, nn, sRaw, oRaw) };
}
