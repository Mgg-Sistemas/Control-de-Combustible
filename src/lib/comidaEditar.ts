// CORREGIR COMIDAS YA REGISTRADAS (18-sep-2026).
//
// Pedido del cliente: «necesito poder agregar comidas en cualquier día, edición
// de comidas por si faltó una cantidad para un día o en realidad dieron más de
// las que debían, poder modificar el histórico de comidas para cualquier
// empresa, persona o cualquiera que se haya registrado, desde la vista de
// teléfono».
//
// Hasta hoy el módulo solo sabía INSERTAR y BORRAR, y siempre con la fecha de
// HOY fija (`caracasToday()` en Cocina y en el QR de empresa). Corregir una
// cantidad de anteayer era imposible: no existía ni un `.update()` en todo el
// módulo.
//
// ⭐ LO QUE FUE, FUE. Corregir NO reescribe la historia a escondidas: cada
//    cambio y cada borrado quedan en la bitácora con quién y cuándo, y con la
//    fila completa de antes (trigger `trg_audit` → `audit_log.changes`). Por eso
//    acá no se inventan columnas `updated_by`: el rastro ya existe y es el mismo
//    que usa el resto del sistema. Ver `comidaMovimientos.ts`.
//
// ⚠️ NO SE PUEDE CAMBIAR NI LA FECHA NI DE QUIÉN ES LA ENTREGA. Mover una
//    entrega de empresa o de día es borrarla y hacerla de nuevo: así queda un
//    borrado y un alta en la bitácora, en vez de una fila que cambió de dueño
//    sin que se note. Se corrige la CANTIDAD, el COSTO, el NOMBRE DEL PLATO y la
//    NOTA, que es lo que el cliente pidió.
//
// Sin React ni Supabase: se prueba sola (scripts/test-comida-editar.mjs).

/** Lo que se puede corregir de una entrega por EMPRESA. */
export type CambioEmpresa = {
  /** Platos entregados. Entero ≥ 1: si fueron cero, se borra la entrega. */
  cantidad?: number;
  /** Costo por plato en $. Cero = sin costo escrito. */
  costo?: number;
  /** Nombre del plato (solo tiene sentido en OTROS). */
  plato?: string | null;
  nota?: string | null;
};

/** Lo que se puede corregir de una entrega por PERSONA. */
export type CambioPersona = {
  cantidad?: number;
  nota?: string | null;
};

/** El resultado de validar: o hay un parche listo, o hay un motivo en criollo. */
export type Validacion<T> = { ok: true; patch: T } | { ok: false; error: string };

const limpio = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * NÚMERO ESCRITO A LA VENEZOLANA: la coma es el decimal.
 *
 * Quien escribe «1,50» quiere un dólar cincuenta, no ciento cincuenta. Es la
 * misma lectura que ya hace la pantalla del QR de empresa (`parseDec`) y la de
 * tarifas de viajes; si acá se leyera distinto, el mismo número escrito en dos
 * pantallas guardaría dos cosas.
 */
export function leerDecimal(texto: unknown): number | null {
  const t = limpio(texto).replace(/\s/g, '');
  if (!t) return null;
  if (!/^-?[0-9]*[.,]?[0-9]*$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Cantidad de platos: entero, sin coma, ≥ 1. */
export function leerCantidad(texto: unknown): number | null {
  const t = limpio(texto);
  if (!/^[0-9]+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export const MAX_CANTIDAD = 9999;

/**
 * VALIDA UNA CORRECCIÓN POR EMPRESA.
 *
 * Devuelve SOLO los campos que de verdad cambiaron: un UPDATE que reescribe
 * columnas con su mismo valor ensucia la bitácora con «cambió la nota: (vacía) →
 * (vacía)», y entonces nadie la lee.
 */
export function validarCambioEmpresa(
  actual: { delivered?: unknown; unit_cost?: unknown; item_label?: unknown; note?: unknown },
  escrito: { cantidad?: unknown; costo?: unknown; plato?: unknown; nota?: unknown },
): Validacion<CambioEmpresa> {
  const patch: CambioEmpresa = {};

  if (escrito.cantidad !== undefined) {
    const c = leerCantidad(escrito.cantidad);
    if (c === null) return { ok: false, error: 'La cantidad va en platos enteros, desde 1. Si fueron cero, borra la entrega.' };
    if (c > MAX_CANTIDAD) return { ok: false, error: `Esa cantidad es demasiado grande (el tope es ${MAX_CANTIDAD}). Revisa el número.` };
    if (c !== Number(actual.delivered)) patch.cantidad = c;
  }

  if (escrito.costo !== undefined) {
    const txt = limpio(escrito.costo);
    const v = txt === '' ? 0 : leerDecimal(txt);
    if (v === null) return { ok: false, error: 'El costo por plato no se entiende. Escribe solo números, con coma para los centavos (por ejemplo 4,50).' };
    if (v < 0) return { ok: false, error: 'El costo por plato no puede ser negativo.' };
    const redondo = Math.round(v * 100) / 100;
    if (redondo !== Math.round(Number(actual.unit_cost || 0) * 100) / 100) patch.costo = redondo;
  }

  if (escrito.plato !== undefined) {
    const p = limpio(escrito.plato) || null;
    if ((p ?? '') !== (limpio(actual.item_label) || '')) patch.plato = p;
  }

  if (escrito.nota !== undefined) {
    const n = limpio(escrito.nota) || null;
    if ((n ?? '') !== (limpio(actual.note) || '')) patch.nota = n;
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: 'No cambiaste nada.' };
  return { ok: true, patch };
}

/** Valida una corrección por PERSONA. Por carnet no hay costo ni plato. */
export function validarCambioPersona(
  actual: { meals?: unknown; note?: unknown },
  escrito: { cantidad?: unknown; nota?: unknown },
): Validacion<CambioPersona> {
  const patch: CambioPersona = {};

  if (escrito.cantidad !== undefined) {
    const c = leerCantidad(escrito.cantidad);
    if (c === null) return { ok: false, error: 'La cantidad va en comidas enteras, desde 1. Si fue cero, borra la entrega.' };
    if (c > MAX_CANTIDAD) return { ok: false, error: `Esa cantidad es demasiado grande (el tope es ${MAX_CANTIDAD}). Revisa el número.` };
    if (c !== Number(actual.meals)) patch.cantidad = c;
  }

  if (escrito.nota !== undefined) {
    const n = limpio(escrito.nota) || null;
    if ((n ?? '') !== (limpio(actual.note) || '')) patch.nota = n;
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: 'No cambiaste nada.' };
  return { ok: true, patch };
}

// ── AGREGAR EN UN DÍA CUALQUIERA ────────────────────────────────────────────

export type AltaEmpresa = {
  companyId: string;
  companyName: string;
  mealType: string;
  mealDate: string;
  cantidad: number;
  costo: number;
  plato: string | null;
  nota: string | null;
};

/**
 * VALIDA UN ALTA POR EMPRESA en el día que se esté viendo.
 *
 * ⚠️ `hoy` se pasa desde afuera a propósito: la fecha del sistema del teléfono
 *    puede estar corrida, y un reporte con una comida del futuro no se explica.
 *    El tope duro es «no más adelante que hoy»; hacia atrás no hay límite,
 *    porque corregir el histórico es justo lo que se pidió.
 */
export function validarAltaEmpresa(
  escrito: { companyId?: unknown; companyName?: unknown; mealType?: unknown; mealDate?: unknown; cantidad?: unknown; costo?: unknown; plato?: unknown; nota?: unknown },
  hoy: string,
): Validacion<AltaEmpresa> {
  const companyId = limpio(escrito.companyId);
  const companyName = limpio(escrito.companyName);
  if (!companyId || !companyName) return { ok: false, error: 'Elige la empresa.' };

  const mealType = limpio(escrito.mealType);
  if (!mealType) return { ok: false, error: 'Elige cuál comida es (desayuno, almuerzo, lunch, cena u otros).' };

  const mealDate = limpio(escrito.mealDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mealDate)) return { ok: false, error: 'La fecha no se entiende.' };
  if (mealDate > limpio(hoy).slice(0, 10)) return { ok: false, error: 'No se pueden registrar comidas de un día que todavía no llega.' };

  const cantidad = leerCantidad(escrito.cantidad);
  if (cantidad === null) return { ok: false, error: 'Escribe cuántos platos, en número entero desde 1.' };
  if (cantidad > MAX_CANTIDAD) return { ok: false, error: `Esa cantidad es demasiado grande (el tope es ${MAX_CANTIDAD}). Revisa el número.` };

  const txtCosto = limpio(escrito.costo);
  const costo = txtCosto === '' ? 0 : leerDecimal(txtCosto);
  if (costo === null || costo < 0) return { ok: false, error: 'El costo por plato no se entiende. Escribe solo números, con coma para los centavos (por ejemplo 4,50).' };

  // ⚠️ El nombre del plato SOLO va en «Otros». El formulario comparte el campo
  //    entre las comidas y solo lo esconde: quien escribía «Hielo», se arrepentía
  //    y elegía Almuerzo guardaba un «Almuerzo (Hielo)» que después no se podía
  //    limpiar (encontrado al revisar, 18-sep-2026).
  const plato = mealType === 'otros' ? limpio(escrito.plato) || null : null;
  // El nombre del plato es lo ÚNICO que distingue un «Otros» de otro en el
  // papel: sin él, tres renglones de «Otros» a precios distintos no se explican.
  if (mealType === 'otros' && !plato) return { ok: false, error: 'Para «Otros» escribe qué fue (postre, hielo, refresco…).' };

  return {
    ok: true,
    patch: {
      companyId, companyName, mealType, mealDate, cantidad,
      costo: Math.round(costo * 100) / 100, plato, nota: limpio(escrito.nota) || null,
    },
  };
}

export type AltaPersona = {
  employeeId: string;
  employeeName: string;
  cedula: string | null;
  mealType: string;
  distributionDate: string;
  cantidad: number;
  nota: string | null;
};

/**
 * VALIDA UN ALTA POR PERSONA.
 *
 * ⚠️ La base tiene un único parcial `(employee_id, meal_type, distribution_date)`:
 *    una persona no puede tener DOS desayunos el mismo día. No se valida acá
 *    porque haría falta consultar; lo que sí se hace es traducir el rechazo de
 *    la base a algo que se entienda (`mensajeDeError`), y decirle a quien
 *    corrige que lo suyo es EDITAR la entrega que ya está, no crear otra.
 */
export function validarAltaPersona(
  escrito: { employeeId?: unknown; employeeName?: unknown; cedula?: unknown; mealType?: unknown; distributionDate?: unknown; cantidad?: unknown; nota?: unknown },
  hoy: string,
): Validacion<AltaPersona> {
  const employeeId = limpio(escrito.employeeId);
  const employeeName = limpio(escrito.employeeName);
  if (!employeeId || !employeeName) return { ok: false, error: 'Elige a la persona.' };

  const mealType = limpio(escrito.mealType);
  if (!mealType) return { ok: false, error: 'Elige cuál comida es (desayuno, almuerzo, lunch o cena).' };
  // «Otros» es un plato que se le carga a una EMPRESA, con su costo. Por carnet
  // no existe: la pantalla de cocina solo ofrece las cuatro.
  if (mealType === 'otros') return { ok: false, error: '«Otros» se registra a una empresa, no a una persona.' };

  const distributionDate = limpio(escrito.distributionDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(distributionDate)) return { ok: false, error: 'La fecha no se entiende.' };
  if (distributionDate > limpio(hoy).slice(0, 10)) return { ok: false, error: 'No se pueden registrar comidas de un día que todavía no llega.' };

  const cantidad = leerCantidad(escrito.cantidad);
  if (cantidad === null) return { ok: false, error: 'Escribe cuántas comidas, en número entero desde 1.' };
  if (cantidad > MAX_CANTIDAD) return { ok: false, error: `Esa cantidad es demasiado grande (el tope es ${MAX_CANTIDAD}). Revisa el número.` };

  return {
    ok: true,
    patch: {
      employeeId, employeeName, cedula: limpio(escrito.cedula) || null,
      mealType, distributionDate, cantidad, nota: limpio(escrito.nota) || null,
    },
  };
}

// ── LOS RECHAZOS DE LA BASE, EN CRIOLLO ─────────────────────────────────────

/**
 * ⚠️ UN RECHAZO POR PERMISOS VUELVE SIN ERROR Y CON CERO FILAS. Es el mismo
 *    tropiezo que ya se documentó al borrar (`deleteFoodDistribution`): la
 *    pantalla creía haber guardado y quedaba desincronizada con la base. Por eso
 *    todas las escrituras piden `.select('id')` y pasan por acá.
 */
export function mensajeDeError(error: { code?: unknown; message?: unknown } | null | undefined, filas: number, que: 'guardar' | 'borrar'): string | null {
  if (error) {
    const code = limpio(error.code);
    const msg = limpio(error.message);
    if (code === '23505' || /duplicate|unique/i.test(msg)) {
      return 'Esa persona ya tiene esa comida ese día. Corrige la entrega que ya está en vez de agregar otra.';
    }
    if (code === '42501' || /permission|policy|row-level/i.test(msg)) {
      return 'No tienes permiso para eso. Hace falta permiso COMPLETO en el módulo de Comida.';
    }
    if (code === '23514' || /check constraint/i.test(msg)) {
      return 'La base no acepta ese valor. Revisa la comida y la cantidad.';
    }
    return msg || 'No se pudo completar.';
  }
  if (filas === 0) {
    return que === 'borrar'
      ? 'No se borró: no tienes permiso o esa entrega ya no existe.'
      : 'No se guardó: no tienes permiso o esa entrega ya no existe. Hace falta permiso COMPLETO en el módulo de Comida.';
  }
  return null;
}

/** Lo que se le dice a la gente después de corregir, para que quede claro qué pasó. */
export function resumenCambioEmpresa(antes: { delivered?: unknown; unit_cost?: unknown }, patch: CambioEmpresa): string {
  const partes: string[] = [];
  if (patch.cantidad !== undefined) partes.push(`${Number(antes.delivered) || 0} → ${patch.cantidad} plato(s)`);
  if (patch.costo !== undefined) partes.push(`costo $${Number(antes.unit_cost) || 0} → $${patch.costo}`);
  if (patch.plato !== undefined) partes.push('nombre del plato');
  if (patch.nota !== undefined) partes.push('nota');
  return partes.length ? `✅ Corregido: ${partes.join(' · ')}.` : '✅ Corregido.';
}

export function resumenCambioPersona(antes: { meals?: unknown }, patch: CambioPersona): string {
  const partes: string[] = [];
  if (patch.cantidad !== undefined) partes.push(`${Number(antes.meals) || 0} → ${patch.cantidad} comida(s)`);
  if (patch.nota !== undefined) partes.push('nota');
  return partes.length ? `✅ Corregido: ${partes.join(' · ')}.` : '✅ Corregido.';
}
