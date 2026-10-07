// ════════════════════════════════════════════════════════════════════════════
// ⚖️ TARIFA POR VIAJE O POR TONELADA — 07-oct-2026.
//
// Pedido del cliente, textual: «acá ahora permite colocar una tarifa por TON,
// este será 2$, este y oeste 3$, oeste 2$; permite ahora que sea así, y que se
// multiplique por las ton obtenidas; esto se hará solo si seleccionan la
// opción».
//
// Hasta hoy un TIPO DE VIAJE («este · $30») cobraba un precio fijo por viaje.
// Ahora cada tipo dice además EN QUÉ UNIDAD cobra:
//
//   · 'viaje' → el precio es el del viaje, pase el camión lo que pese (como
//               siempre; es el valor por defecto y lo que siguen haciendo los
//               tipos que ya existían).
//   · 'ton'   → el precio es POR TONELADA y el viaje paga precio × toneladas
//               del PESO A PAGAR (el neto de la romana: bruto − tara).
//
// ── POR QUÉ ESTE ARCHIVO EXISTE ────────────────────────────────────────────
// Es la única cuenta que convierte un peso en dinero del lado del cliente, así
// que vive sola, sin React ni Supabase, y se prueba sola
// (scripts/test-tarifa-por-tonelada.mjs). Quien la cambie ve en el acto qué
// papel de pago rompe.
//
// ── LAS TRES REGLAS QUE NO SE NEGOCIAN ─────────────────────────────────────
// ⭐ LA UNIDAD SE CONGELA EN EL VIAJE, igual que el nombre y la tarifa. Pasar
//    un tipo de 'viaje' a 'ton' mañana NO puede reescribir lo ya cobrado: un
//    papel de pago firmado la semana pasada tiene que volver a salir igual.
//
// ⚠️ UN VIAJE POR TONELADA SIN PESO NO SE PAGA, Y SE DICE. No cae a la tarifa
//    por viaje ni a la de zona ni se paga en cero callado: sale visible como
//    «tipo por tonelada sin peso» hasta que alguien le cargue la romana.
//    Adivinar el peso de un viaje es inventar plata.
//
// ⚠️ EL REDONDEO ES DEL PAPEL, NO DE LA CUENTA. La plata se calcula con las
//    toneladas exactas y se redondea AL FINAL, a céntimos. Redondear las
//    toneladas primero y multiplicar después da otro número, y el que cobra lo
//    nota.
// ════════════════════════════════════════════════════════════════════════════

/** En qué unidad cobra una tarifa con nombre. */
export type UnidadTarifaViaje = 'viaje' | 'ton';

/**
 * Lee la unidad venga como venga de la base.
 *
 * ⚠️ TODO LO QUE NO SEA 'ton' ES 'viaje'. Es a propósito: los miles de viajes
 *    que ya están guardados tienen la columna en NULL y son, todos, por viaje.
 *    Un `null` que se leyera como «por tonelada» pondría a pagar en cero medio
 *    año de viajes.
 */
export function unidadTarifa(v: unknown): UnidadTarifaViaje {
  return String(v ?? '').trim().toLowerCase() === 'ton' ? 'ton' : 'viaje';
}

/** Las toneladas de un peso en kilos. `null` cuando no hay peso cargado. */
export function toneladasDe(pesoNetoKg: unknown): number | null {
  const kg = Number(pesoNetoKg);
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return kg / 1000;
}

/** Redondeo a céntimos, que es hasta donde llega un pago. */
export const aCentimos = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export type CuentaDelTipo = {
  /** Lo que se paga por este viaje. 0 cuando falta algo. */
  monto: number;
  /** El precio del catálogo, tal cual (por viaje o por tonelada). */
  precio: number;
  /** Las toneladas que entraron en la cuenta. null si la tarifa no las usa. */
  toneladas: number | null;
  /** Qué falta para poder pagarlo. null = se puede pagar. */
  falta: 'tarifa' | 'peso' | null;
};

/**
 * LA CUENTA DE UN VIAJE CON TIPO.
 *
 * @param tarifa      el precio congelado en el viaje (por viaje o por tonelada)
 * @param unidad      la unidad congelada en el viaje
 * @param pesoNetoKg  el peso a pagar del viaje, en kilos (bruto − tara)
 */
export function cuentaDelTipo(tarifa: unknown, unidad: UnidadTarifaViaje, pesoNetoKg?: unknown): CuentaDelTipo {
  const precio = Number(tarifa);
  const valido = Number.isFinite(precio) && precio > 0;

  if (unidad !== 'ton') {
    // Por viaje: la cuenta de toda la vida. El peso no entra ni se mira.
    return { monto: valido ? aCentimos(precio) : 0, precio: valido ? precio : 0, toneladas: null, falta: valido ? null : 'tarifa' };
  }

  const ton = toneladasDe(pesoNetoKg);
  // ⚠️ El orden importa: primero la tarifa. Un tipo por tonelada sin precio Y
  //    sin peso le falta sobre todo el precio — que es lo que arregla la
  //    oficina en un minuto desde 🧾 Tipos de viaje.
  if (!valido) return { monto: 0, precio: 0, toneladas: ton, falta: 'tarifa' };
  if (ton == null) return { monto: 0, precio, toneladas: null, falta: 'peso' };
  return { monto: aCentimos(precio * ton), precio, toneladas: ton, falta: null };
}

/**
 * El precio escrito para la pantalla y el papel: «$30» o «$2 / Ton».
 *
 * ⭐ LA UNIDAD VA PEGADA AL PRECIO SIEMPRE. Un «$2» suelto al lado de un «$30»
 *    se lee como un tipo baratísimo, cuando es el precio de UNA tonelada de
 *    las veinte que lleva el camión.
 */
export function tarifaTexto(tarifa: unknown, unidad: UnidadTarifaViaje): string {
  const n = Number(tarifa);
  if (!Number.isFinite(n) || n <= 0) return 'sin tarifa';
  const plata = `$${n.toLocaleString('es-VE', { maximumFractionDigits: 2 })}`;
  return unidad === 'ton' ? `${plata} / Ton` : plata;
}

/** El rótulo corto de la unidad, para una pastilla o una columna. */
export function unidadTexto(unidad: UnidadTarifaViaje): string {
  return unidad === 'ton' ? 'por tonelada' : 'por viaje';
}
