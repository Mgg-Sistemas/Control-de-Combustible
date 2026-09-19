// LEER UN NÚMERO ESCRITO A MANO, CON PUNTO O CON COMA (19-sep-2026).
// Sin imports: se prueba sola (scripts/test-numeros-compras.mjs).
//
// Pedido del cliente: «que en compras y en servicios deje colocar o reconozca el
// punto (.) o reconozca la coma (,)».
//
// Había CUATRO copias de `parseNum` en Compras y dos de ellas BOTABAN la coma
// (`replace(/[^0-9.\-]/g, '')`): en Requerimiento y en Cuentas, escribir «12,50»
// guardaba 1250 — cien veces más — sin avisar. Las otras dos (Compras directas /
// Órdenes y Servicios) leían bien, pero cada una con su copia. Ahora las cuatro
// pantallas leen con ESTA función.
//
// LA REGLA (la misma que ya usaba Compras directas, para no cambiarle nada a nadie):
//   · Punto o coma valen igual como decimal: 12,50 = 12.50 = 12,5.
//   · Si vienen los dos, el ÚLTIMO es el decimal y el otro separa miles:
//     1.234,56 = 1,234.56 = 1234,56.
//   · Si un mismo signo se repite, separa miles: 1.234.567 = 1234567.
//   · Tolera lo que queda a medio escribir: «12,» y «12.» valen 12.
//   · Lo que no se entiende vale 0 (nunca NaN: un NaN en un total lo contagia todo).
//
// ⚠️ Un solo signo, una sola vez, es DECIMAL: «1.500» es uno y medio, no mil
//    quinientos. Es ambiguo por naturaleza; las pantallas muestran el total del
//    renglón mientras se escribe, que es donde se ve si se leyó lo que se quiso.

export function leerNumero(t: unknown): number {
  let s = String(t ?? '').replace(/[^0-9.,\-]/g, '');
  const negativo = s.startsWith('-');
  s = s.replace(/-/g, '');
  const comas = (s.match(/,/g) || []).length;
  const puntos = (s.match(/\./g) || []).length;
  if (comas && puntos) {
    // El último signo es el decimal; el otro, miles.
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (comas > 1) {
    s = s.replace(/,/g, '');
  } else if (puntos > 1) {
    s = s.replace(/\./g, '');
  } else if (comas === 1) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  if (!isFinite(n)) return 0;
  return negativo ? -n : n;
}

/**
 * EL TEXTO DE UN CAMPO NUMÉRICO MIENTRAS SE ESCRIBE.
 *
 * Un campo que guarda el NÚMERO y se pinta con `String(numero)` no deja escribir
 * decimales: al teclear «12,» el número es 12, el campo se repinta «12» y la coma
 * desaparece (así estaba Servicios). La pantalla guarda aparte el texto crudo y lo
 * muestra mientras exista; el número va por su lado.
 */
export function textoDeCampo(crudo: string | undefined, numero: unknown): string {
  if (crudo !== undefined) return crudo;
  const n = Number(numero);
  return isFinite(n) ? String(n) : '';
}
