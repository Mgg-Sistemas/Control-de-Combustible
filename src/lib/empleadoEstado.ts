// 🚫 EL ESTADO DEL EMPLEADO MANDA EN LA COCINA — 26-sep-2026.
//
// Pedido del cliente, textual: «cuando se marque en nomina un empleado como
// deshabilitado o inactivo, no permitas que desde comidas o distribucion pueda
// recibir comidas. Que al escanear el carnet salga un msj que diga EMPLEADO
// INACTIVO».
//
// ⭐ QUÉ ESTADOS TRANCAN, Y CUÁL NO
// ---------------------------------------------------------------------------
// Nómina ofrece CUATRO estados: Activo, Inactivo, Suspendido y Otro.
//   · «Inactivo» y «Suspendido» son las dos maneras de decir «deshabilitado»:
//     esas TRANCAN. Es lo que se pidió.
//   · «Otro» NO tranca. En Nómina es un grupo APARTE —tiene su propia pastilla y
//     su propio conteo, no se cuenta como inactivo— y el pedido nombró
//     «deshabilitado o inactivo», no «todo lo que no sea activo». Trancar a
//     «Otro» sería dejar sin comer a gente que la empresa no marcó como salida.
//
// ⚠️ ESTO NO BORRA NADA DE LO YA ENTREGADO. Lo que se sirvió ayer se sirvió: los
//    reportes y los cobros siguen mostrándolo igual. Lo único que cambia es que
//    de acá en adelante no se registra una comida nueva.
//
// Regla pura, sin React ni Supabase. Prueba: scripts/test-empleado-inactivo.mjs

/** Lo que Nómina puede tener guardado. Es texto libre en la base, no un enum. */
export type EstadoEmpleado = 'activo' | 'inactivo' | 'suspendido' | 'otro' | string;

export const normalizarEstado = (v: unknown): string =>
  String(v ?? '').trim().toLowerCase();

/**
 * Los estados que NO pueden recibir comida.
 *
 * ⚠️ Es una lista corta y explícita A PROPÓSITO. La alternativa —«todo lo que no
 *    sea activo»— trancaría también a «Otro» y a cualquier estado que Nómina
 *    invente mañana, dejando sin comer a gente por un cambio que nadie relacionó
 *    con la cocina.
 */
export const ESTADOS_SIN_COMIDA = ['inactivo', 'suspendido'] as const;

/** ¿Este empleado puede recibir comida hoy? */
export function puedeRecibirComida(status?: unknown): boolean {
  return !(ESTADOS_SIN_COMIDA as readonly string[]).includes(normalizarEstado(status));
}

/** El cartel que ve el cocinero al escanear. null si la persona sí puede comer. */
export function etiquetaBloqueo(status?: unknown): string | null {
  const e = normalizarEstado(status);
  if (e === 'inactivo') return 'EMPLEADO INACTIVO';
  if (e === 'suspendido') return 'EMPLEADO SUSPENDIDO';
  return null;
}

/**
 * El aviso completo para la pantalla de cocina.
 *
 * ⚠️ Dice QUIÉN y DÓNDE se arregla. Un «no se puede» pelado deja al cocinero
 *    discutiendo con la persona en el mostrador sin saber a quién mandarla.
 */
export function mensajeBloqueo(nombre?: unknown, status?: unknown): string | null {
  const etiqueta = etiquetaBloqueo(status);
  if (!etiqueta) return null;
  const quien = String(nombre ?? '').trim();
  return `🚫 ${etiqueta}${quien ? ` · ${quien}` : ''} — no puede recibir comida. Así está marcado en Nómina; si es un error, se corrige allá.`;
}

/**
 * Lo que la base responde cuando el trigger tranca la entrega.
 * Tiene que calzar con `supabase/comida_empleado_inactivo.sql`.
 */
export const MARCA_ERROR_INACTIVO = 'EMPLEADO INACTIVO';

/** ¿Este error de la base es el trigger del empleado deshabilitado? */
export function esErrorEmpleadoInactivo(msg?: unknown): boolean {
  return /EMPLEADO\s+(INACTIVO|SUSPENDIDO)/i.test(String(msg ?? ''));
}

/**
 * Deja el error de la base en algo que se pueda leer en el mostrador.
 *
 * ⚠️ El mensaje crudo de Postgres viene con el nombre de la función y el SQLSTATE
 *    pegados; acá se saca SOLO la parte que le sirve a quien reparte.
 */
export function mensajeDeErrorInactivo(msg?: unknown): string | null {
  const texto = String(msg ?? '');
  if (!esErrorEmpleadoInactivo(texto)) return null;
  const m = /EMPLEADO\s+(INACTIVO|SUSPENDIDO)[^\n]*/i.exec(texto);
  return `🚫 ${(m?.[0] ?? MARCA_ERROR_INACTIVO).trim()}`;
}
