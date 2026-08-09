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
 * HORAS REALES REDONDEADAS HACIA ARRIBA (pedido cliente 08/08/2026): cada jornada
 * (día o noche) usa sus horas REALES redondeadas al entero siguiente — ya NO se fuerza
 * al turno más cercano. Ej.: 7.6 h → 8 h · 9.2 h → 10 h · 6 h → 6 h (ya entero).
 */
export const turnoH = (h: number): number => {
  const v = Number(h) || 0;
  if (v <= 0) return 0;
  return Math.ceil(v);
};

/** Horas trabajadas del día = (turno día + turno noche, redondeados) − parada + extras (mín. 0 antes de extras). */
export const workedFromShifts = (dayH: number, nightH: number, stopped: number, overtime: number) =>
  Math.max(0, turnoH(dayH) + turnoH(nightH) - (Number(stopped) || 0)) + Math.max(0, Number(overtime) || 0);
