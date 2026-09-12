// EDITAR UN PERÍODO DE NÓMINA · las reglas (12-sep-2026).
//
// Pedido del cliente: «después de que creo un período no lo puedo editar, es
// decir cambiarle las fechas; que los que tengan permiso full o admin sí puedan».
//
// ⭐ NO IMPORTA NADA y no habla con la base: son reglas de fechas y de texto, y
//    por eso se prueban solas (scripts/test-periodo-nomina.mjs).
//
// ⚠️ LO QUE HACE PELIGROSO ESTE CAMBIO no es mover las fechas: es que al moverlas
//    las CANTIDADES YA CALCULADAS quedan viejas. Un período que iba hasta el 12 y
//    ahora va hasta el 13 tiene los días, las horas y las semanas del rango
//    anterior, y el total que se ve es de un rango que ya no existe. Por eso
//    `cambiaElRango` está acá: es lo que decide si hay que avisar y recalcular.

export type RangoPeriodo = { name: string; date_from: string; date_to: string };

/** `YYYY-MM-DD`, que es como guarda la base y como compara bien un `<`. */
const ES_ISO = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_NOMBRE_PERIODO = 80;

export const limpioNombre = (v: unknown): string => String(v ?? '').trim().replace(/\s+/g, ' ');

/**
 * ¿Se puede guardar este cambio? Devuelve el motivo si no.
 *
 * ⚠️ EL ORDEN DE LOS MOTIVOS IMPORTA. Se dice PRIMERO lo que falta y después lo
 *    que está mal: a alguien que dejó la fecha vacía no se le puede contestar
 *    «la fecha de inicio es posterior a la final», porque no entiende qué hizo.
 */
export function validarPeriodo(p: RangoPeriodo): string | null {
  const name = limpioNombre(p.name);
  if (!name) return 'Escribe el nombre del período.';
  if (name.length > MAX_NOMBRE_PERIODO) return `El nombre no puede pasar de ${MAX_NOMBRE_PERIODO} caracteres.`;
  if (!ES_ISO.test(String(p.date_from ?? ''))) return 'Falta la fecha de inicio.';
  if (!ES_ISO.test(String(p.date_to ?? ''))) return 'Falta la fecha final.';
  // Comparar textos ISO funciona: '2026-09-13' > '2026-09-12'. Con Date() se
  // metería la zona horaria en una decisión que no la necesita.
  if (p.date_from > p.date_to) return 'La fecha de inicio no puede ser posterior a la final.';
  return null;
}

/**
 * ¿Cambió el RANGO, y no solo el nombre?
 *
 * Es la pregunta que decide si hay que recalcular. Corregirle una tilde al
 * nombre no toca ni un número; correr la fecha final un día sí, y callarlo
 * dejaría el total describiendo un rango que ya no existe.
 */
export function cambiaElRango(antes: RangoPeriodo, ahora: RangoPeriodo): boolean {
  return antes.date_from !== ahora.date_from || antes.date_to !== ahora.date_to;
}

/** ¿Hay algo distinto que guardar? Sirve para apagar el botón. */
export function hayCambios(antes: RangoPeriodo, ahora: RangoPeriodo): boolean {
  return limpioNombre(antes.name) !== limpioNombre(ahora.name) || cambiaElRango(antes, ahora);
}

/** Cuántos días cubre el rango, contando los dos extremos. 0 si no es válido. */
export function diasDelRango(p: { date_from: string; date_to: string }): number {
  if (!ES_ISO.test(String(p.date_from ?? '')) || !ES_ISO.test(String(p.date_to ?? ''))) return 0;
  if (p.date_from > p.date_to) return 0;
  const a = Date.UTC(+p.date_from.slice(0, 4), +p.date_from.slice(5, 7) - 1, +p.date_from.slice(8, 10));
  const b = Date.UTC(+p.date_to.slice(0, 4), +p.date_to.slice(5, 7) - 1, +p.date_to.slice(8, 10));
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * El texto del aviso cuando el rango se movió.
 *
 * Se escribe acá y no en la pantalla para que la prueba pueda leerlo: es la
 * única señal que va a tener quien mueva una fecha de que los montos que está
 * viendo son del rango viejo.
 */
export function avisoRecalcular(antes: RangoPeriodo, ahora: RangoPeriodo): string {
  const d1 = diasDelRango(antes);
  const d2 = diasDelRango(ahora);
  const dif = d2 - d1;
  const cuanto = dif === 0 ? 'sigue con los mismos días'
    : dif > 0 ? `pasa de ${d1} a ${d2} día(s)`
    : `baja de ${d1} a ${d2} día(s)`;
  return `El rango ${cuanto}. Las cantidades de cada persona son todavía las del rango anterior. `
    + '¿Recalcular ahora las jornadas automáticas?';
}
