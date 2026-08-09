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
