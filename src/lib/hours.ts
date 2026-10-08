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
import { businessRoundDateOf } from './caracasDay';

/**
 * HORAS REALES SIN REDONDEAR (pedido cliente 09/08/2026): cada turno usa sus horas
 * REALES tal cual (ya NO se redondean hacia arriba). Antes se hacía `Math.ceil`; el
 * cliente pidió dejarlas como aparecen en TODO el sistema (Control, Inspecciones,
 * Informe, Pagos — todos llaman esta función, así que quedan consistentes). Lo único
 * que se sigue aplicando es el ANCLAJE de inicio de turno (día 7am / noche 7pm) en los
 * cálculos EN VIVO de los reportes, no aquí.
 * (OJO 08-oct-2026: ese anclaje EN VIVO también murió — ver `horasVivasTurno`.)
 */
export const turnoH = (h: number): number => Math.max(0, Number(h) || 0);

/**
 * HORAS EN VIVO DE UN TURNO CON JORNADA ABIERTA — fuente ÚNICA (08-oct-2026).
 *
 * bancado + lo transcurrido desde el inicio REAL de la jornada abierta, con tope
 * físico del turno. Nació del reclamo «cuando paran una máquina y la reactivan,
 * no suma las horas de antes con las de después»:
 *
 * HISTORIA, porque esta regla ya se rompió una vez y puede volver a romperse:
 * hasta el 02-oct-2026, re-iniciar una jornada RE-ANCLABA `jornada_start_at` al
 * inicio nominal del turno (7am/7pm), así que «lo transcurrido desde el inicio»
 * YA incluía el tramo bancado antes de la parada — y lo correcto era tomar el
 * MAYOR entre bancado y transcurrido (sumar contaba doble). El 02-oct el cliente
 * pidió inicio = HORA REAL («si comienza a las 9am que comience a esa hora»), y
 * los OCHO sitios que calculaban el vivo con MAYOR (o anclado a las 7am) se
 * quedaron con la regla vieja: tras una reactivación mostraban solo el tramo más
 * largo (2 h bancadas + 1 h nueva = «2 h») o contaban la parada como trabajo.
 * Por eso esta función existe y TODOS deben llamarla, nadie reimplementa.
 *
 * - `startMs` null/0 ⇒ jornada cerrada: devuelve lo bancado (tope 12).
 * - TOPE FÍSICO: nunca más que lo que ha durado el turno (ahora − 7am/7pm del
 *   día de negocio del INICIO). Protege contra un re-inicio tecleado hacia atrás
 *   (ej.: reactivan a las 11 pero escriben 07:00 ⇒ bancado+tramo contaría doble).
 * - PISO: nunca menos que lo ya bancado (lo guardado no se "des-trabaja").
 * - La NOCHE cruza medianoche: el nominal 7pm sale de `businessRoundDateOf` del
 *   inicio real, no del día calendario de "ahora".
 */
export function horasVivasTurno(opts: {
  bancado: number;
  startMs: number | null | undefined;
  shift: 'day' | 'night';
  nowMs: number;
}): number {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const bancado = Math.min(12, Math.max(0, Number(opts.bancado) || 0));
  if (!opts.startMs) return r2(bancado);
  const rd = businessRoundDateOf(new Date(opts.startMs), opts.shift);
  const shiftStart = new Date(`${rd}T${opts.shift === 'night' ? '19' : '07'}:00:00-04:00`).getTime();
  const elapsed = Math.max(0, (opts.nowMs - opts.startMs) / 3600000);
  const topeFisico = Math.min(12, Math.max(0, (opts.nowMs - shiftStart) / 3600000));
  return r2(Math.max(bancado, Math.min(topeFisico, bancado + elapsed)));
}

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
 *     arrancó DENTRO del día, el turno = lo bancado + lo transcurrido desde el
 *     inicio REAL, con tope físico (`horasVivasTurno`). Hasta el 02-oct-2026 acá
 *     se tomaba el MAYOR contra lo transcurrido desde el nominal 7am/7pm, porque
 *     el re-inicio se re-anclaba; al pasar a inicio = hora real, el MAYOR dejaba
 *     fuera lo bancado antes de una parada (reclamo 08-oct-2026) y el nominal
 *     contaba la parada como trabajo.
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
    if (jShift === 'night') nn = horasVivasTurno({ bancado: nn, startMs: jStart, shift: 'night', nowMs });
    else dd = horasVivasTurno({ bancado: dd, startMs: jStart, shift: 'day', nowMs });
  }
  return { dia: dd, noche: nn, trabajadas: workedFromShifts(dd, nn, sRaw, oRaw) };
}
