// 🧺 LA CESTA DE COMIDAS (05-oct-2026).
//
// Pedido del cliente: «solo se puede registrar una comida a la vez […] yo le
// registro el desayuno al GNB y no puedo registrar más nada ahí, tengo que
// volver a hacer un registro diferente; la idea es poder registrar varios o
// los que yo quiera o necesite».
//
// La cesta es UNA casilla de cantidad POR CADA comida (desayuno, almuerzo,
// lunch, cena y los platos de «otros»): se llenan las que sean y un solo botón
// las registra todas. La usan el registro por empresa del QR
// (FoodCompanyScreen) y la corrección del jefe (ComidaEditor).
//
// ⭐ CADA LÍNEA SIGUE SIENDO UNA ENTREGA EN LA BASE, igual que siempre: la
//    cesta no inventa un formato nuevo, solo ahorra los viajes. Por eso los
//    reportes, el cobro y las facturas no cambian ni un número.
// ⭐ SIN IMPORTS, a propósito: se prueba sola (scripts/test-comida-cesta.mjs).

/** Una casilla de la cesta. `cantidad` va tal como se teclea; vacía = no va. */
export type LineaCesta = {
  /** desayuno / almuerzo / lunch / cena / otros. */
  mealType: string;
  /** El plato, SOLO con 'otros' (HIELO, AGUA…): sin nombre no se puede cobrar. */
  itemLabel?: string | null;
  cantidad: string;
};

/** El tope por línea. El sistema tiene dos: 200 por entrega a contactos
 *  (MAX_COMIDAS_POR_ENTREGA) y 9999 en la corrección del jefe (MAX_CANTIDAD).
 *  La cesta usa el MÁS ESTRICTO: registrar de a montones es justo donde un
 *  dedo de más mete un cero de más. */
export const MAX_POR_LINEA_CESTA = 200;

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** La cantidad de una línea, o null si no se entiende. Vacía NO es error: es
 *  «esta comida no va» (por eso acá no se valida, se valida en la línea). */
export function cantidadDeLinea(l: { cantidad?: unknown } | null | undefined): number | null {
  const t = limpio(l?.cantidad).replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return n;
}

/** Las líneas que SÍ van: las que tienen algo escrito en la cantidad. */
export function lineasConCantidad(cesta: LineaCesta[] | null | undefined): LineaCesta[] {
  return (cesta ?? []).filter((l) => limpio(l?.cantidad) !== '');
}

/**
 * Revisa la cesta entera ANTES de guardar nada. Devuelve el motivo del rechazo
 * o null. ⭐ O PASA TODA O NO SE GUARDA NADA: validar línea por línea mientras
 * se guarda dejaría media cesta registrada y media no, y nadie sabría cuál.
 */
export function validarCesta(cesta: LineaCesta[] | null | undefined, labelDe: (l: LineaCesta) => string): string | null {
  const conAlgo = lineasConCantidad(cesta);
  if (conAlgo.length === 0) return 'Escribe la cantidad en al menos una comida.';
  for (const l of conAlgo) {
    const nombre = labelDe(l) || 'esa comida';
    const n = cantidadDeLinea(l);
    if (n === null) return `La cantidad de ${nombre} no se entiende: escribe un número entero desde 1.`;
    if (n > MAX_POR_LINEA_CESTA) return `${nombre}: son demasiadas de una vez (máximo ${MAX_POR_LINEA_CESTA}). Revisa el número.`;
    if (limpio(l.mealType) === 'otros' && !limpio(l.itemLabel)) return 'En «Otros» elige qué fue (hielo, agua…): sin nombre no se puede cobrar.';
  }
  return null;
}

/** Cuántos platos lleva la cesta en total (solo las líneas que van). */
export function totalCesta(cesta: LineaCesta[] | null | undefined): number {
  return lineasConCantidad(cesta).reduce((a, l) => a + (cantidadDeLinea(l) ?? 0), 0);
}

/** «15 Desayuno · 15 Almuerzo · 8 HIELO» — para la confirmación y el aviso. */
export function resumenCesta(cesta: LineaCesta[] | null | undefined, labelDe: (l: LineaCesta) => string): string {
  return lineasConCantidad(cesta)
    .map((l) => `${cantidadDeLinea(l) ?? '?'} ${labelDe(l) || l.mealType}`)
    .join(' · ');
}

/**
 * El saldo de un guardado por líneas: qué entró y qué no. Si algo falló a
 * mitad de camino, el aviso DICE qué quedó guardado — esconderlo dejaría a la
 * cocina repitiendo la cesta entera y duplicando lo que sí entró.
 */
export function avisoCesta(r: { ok: string[]; fallos: { nombre: string; error: string }[] }): string {
  if (r.fallos.length === 0) return `✅ Registrado: ${r.ok.join(' · ')}.`;
  const buenas = r.ok.length ? `Se registró: ${r.ok.join(' · ')}. ` : 'No se registró ninguna. ';
  return `⚠️ ${buenas}FALLÓ ${r.fallos.map((f) => `${f.nombre} (${f.error})`).join(' · ')}. Corrige y registra SOLO lo que falló.`;
}
