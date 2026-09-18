// PLATOS DE «OTROS» CON PRECIO (18-sep-2026). Regla pura, sin imports: la prueba la
// carga sola (scripts/test-comida-platos.mjs).
//
// Pedido del cliente: «dame la opción de poder crear un plato, por si yo quiero otra
// cosa además de desayuno, almuerzo, cena, lunch, y que todos deben tener precio a
// juro», desde el módulo de Distribución de comida.
//
// ⭐ NO HIZO FALTA TOCAR LA BASE:
//    · El catálogo YA existía: `food_extra_items` (id, name, active), el de los platos
//      que la cocina escribe al registrar «🧾 Otros». Índice único sobre lower(name).
//    · El precio va en `comida_precios`, la MISMA tabla de las comidas fijas, con su
//      historial (desde, blindado, anular). Su columna `categoria` exige
//      ^[a-z0-9_]{2,30}$, así que un plato no puede ir con su nombre («Bolsa de hielo»):
//      va como `plato_` + 24 letras de su id. Ver `categoriaDePlato`.
//
// ⚠️ LA ENTREGA GUARDA EL NOMBRE, NO EL ID. `food_company_meals.item_label` es texto
//    libre (lo escribe la cocina). Para saber el precio de una entrega hay que ir del
//    nombre al plato: `resolverPlatos`, sin mayúsculas ni espacios de más. Por eso
//    cambiar el nombre de un plato corrige también el de sus entregas (ver
//    comidaPlatosDb.ts): si no, las viejas se quedan sin plato y sin precio.

/** Una fila del catálogo `food_extra_items`. */
export type PlatoCatalogo = { id: string; name: string; active?: boolean | null };

export const PREFIJO_PLATO = 'plato_';
export const MAX_NOMBRE_PLATO = 60;

/** El nombre tal como se guarda: sin espacios de más. */
export function limpiarNombrePlato(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/** El nombre para comparar: además, sin mayúsculas. «bolsa de  HIELO » = «Bolsa de hielo». */
export function normPlato(v: unknown): string {
  return limpiarNombrePlato(v).toLowerCase();
}

/**
 * La categoría de precio de un plato: `plato_` + las primeras 24 letras de su id
 * (sin guiones). 30 caracteres: justo lo que admite el CHECK de `comida_precios`.
 * Sale siempre igual para el mismo plato, así que su precio no se pierde aunque le
 * cambien el nombre. Un id que no sirve devuelve '' (nunca una categoría a medias).
 */
export function categoriaDePlato(id: unknown): string {
  const hex = String(id ?? '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 24);
  return hex.length === 24 ? PREFIJO_PLATO + hex : '';
}

export function esCategoriaDePlato(c: unknown): boolean {
  return String(c ?? '').startsWith(PREFIJO_PLATO);
}

/** Activo = sale en la lista de la cocina. Sin el dato, se toma como activo. */
export const platoActivo = (p: PlatoCatalogo) => p.active !== false;

/** El plato que ya tiene ese nombre (sin mayúsculas ni espacios de más), o null. */
export function platoConNombre(platos: readonly PlatoCatalogo[] | null | undefined, nombre: unknown): PlatoCatalogo | null {
  const n = normPlato(nombre);
  if (!n) return null;
  let inactivo: PlatoCatalogo | null = null;
  for (const p of platos ?? []) {
    if (!p || normPlato(p.name) !== n) continue;
    if (platoActivo(p)) return p;
    inactivo = inactivo ?? p;
  }
  return inactivo;
}

/**
 * Del nombre escrito en una entrega a la categoría de precio de su plato. Lo usan la
 * tarjeta de cobro y el reporte PDF (los dos por `calcularCobroComidas` y `montoCon`).
 * Un plato quitado de la lista SIGUE resolviendo: sus entregas viejas se siguen cobrando.
 */
export function resolverPlatos(platos: readonly PlatoCatalogo[] | null | undefined): (nombre: unknown) => string | null {
  const mapa = new Map<string, string>();
  // Primero los activos: si por un espacio de más hubiera dos con el mismo nombre,
  // manda el que la cocina está usando.
  const orden = [...(platos ?? [])].filter(Boolean).sort((a, b) => Number(platoActivo(b)) - Number(platoActivo(a)));
  for (const p of orden) {
    const n = normPlato(p.name);
    const c = categoriaDePlato(p.id);
    if (n && c && !mapa.has(n)) mapa.set(n, c);
  }
  return (nombre: unknown) => mapa.get(normPlato(nombre)) ?? null;
}

/** De la categoría `plato_…` al nombre del plato, para mostrarla. null si no es un plato conocido. */
export function nombreDeCategoria(platos: readonly PlatoCatalogo[] | null | undefined, categoria: unknown): string | null {
  const c = String(categoria ?? '');
  if (!esCategoriaDePlato(c)) return null;
  const p = (platos ?? []).find((x) => x && categoriaDePlato(x.id) === c);
  return p ? limpiarNombrePlato(p.name) : null;
}

/**
 * Revisa el nombre de un plato antes de crearlo o renombrarlo. Devuelve el motivo del
 * rechazo o null. `idPropio` es el plato que se está renombrando: puede quedarse con
 * su mismo nombre (por ejemplo, para corregir una mayúscula).
 */
export function validarNombrePlato(
  nombre: unknown,
  platos: readonly PlatoCatalogo[] | null | undefined,
  idPropio?: string | null,
): string | null {
  const n = limpiarNombrePlato(nombre);
  if (!n) return 'Escribe el nombre del plato.';
  if (n.length > MAX_NOMBRE_PLATO) return `El nombre es muy largo (máximo ${MAX_NOMBRE_PLATO} letras).`;
  if (['desayuno', 'almuerzo', 'lunch', 'cena', 'otros'].includes(normPlato(n))) {
    return `«${n}» ya es una comida del sistema: ponle otro nombre al plato.`;
  }
  const otro = platoConNombre(platos, n);
  if (otro && otro.id !== idPropio) {
    return platoActivo(otro)
      ? `Ya hay un plato «${limpiarNombrePlato(otro.name)}».`
      : `Ya hay un plato «${limpiarNombrePlato(otro.name)}» quitado de la lista: devuélvelo a la lista en vez de crear otro.`;
  }
  return null;
}

/**
 * Los platos de la lista (activos) que NO tienen precio hoy. «Todos deben tener
 * precio»: estos son los que faltan. `tienePrecio` recibe la categoría del plato.
 */
export function platosSinPrecio(
  platos: readonly PlatoCatalogo[] | null | undefined,
  tienePrecio: (categoria: string) => boolean,
): PlatoCatalogo[] {
  return (platos ?? [])
    .filter((p) => p && platoActivo(p) && !tienePrecio(categoriaDePlato(p.id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Los platos en el orden de la pantalla: primero los de la lista (A→Z), después los quitados. */
export function ordenarPlatos(platos: readonly PlatoCatalogo[] | null | undefined): PlatoCatalogo[] {
  return [...(platos ?? [])]
    .filter(Boolean)
    .sort((a, b) => Number(platoActivo(b)) - Number(platoActivo(a)) || a.name.localeCompare(b.name, 'es'));
}

/** Las entregas que llevan el nombre de un plato (las que hay que corregir al renombrarlo). */
export function entregasDelPlato<T extends { id: string; meal_type?: string | null; item_label?: string | null }>(
  entregas: readonly T[] | null | undefined,
  nombre: unknown,
): T[] {
  const n = normPlato(nombre);
  if (!n) return [];
  return (entregas ?? []).filter((e) => e && e.meal_type === 'otros' && normPlato(e.item_label) === n);
}
