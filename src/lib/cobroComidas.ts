// COBRO DE COMIDAS (15-sep-2026). Regla pura, sin imports: la prueba la carga sola.
//
// Vive SOLO en Distribución de comida (pestaña Reportes). No cambia cómo registra la
// cocina ni los conteos: toma lo ya entregado y le pone precio. Tres reglas:
//
//   1) PRECIO por categoría (desayuno, almuerzo, lunch, cena… y las que vengan), igual que
//      las tarifas de viajes: uno general desde una fecha, o uno BLINDADO a un rango que
//      manda en esas fechas. Nunca se borran: se anulan. Lo pasado conserva su precio.
//   2) CUENTA: lo entregado por QR va a la empresa GUARDADA en la entrega. Lo entregado por
//      carnet va a la empresa de la ficha de la persona; sin empresa en la ficha es nómina
//      propia; si la ficha no existe o no se pudo leer, queda aparte, a la vista.
//   3) Lo que no tiene precio ese día NO suma, pero se cuenta como «sin precio» para que
//      nadie lo pierda de vista.
//
// El día es el de la entrega (fecha de Caracas), el mismo que usan los reportes de comida.

export type PrecioComida = {
  id: string;
  categoria: string;
  precio: number | string;
  desde: string;
  hasta?: string | null;
  nota?: string | null;
  created_at?: string | null;
  created_by_nombre?: string | null;
  anulada_at?: string | null;
  anulada_motivo?: string | null;
};

/** Entrega por QR de empresa (food_company_meals). */
export type ComidaEmpresaCobro = {
  company_id: string | null;
  company_name: string | null;
  meal_type: string | null;
  meal_date: string;
  delivered: number | string | null;
};

/** Entrega por carnet (food_distributions). */
export type ComidaPersonaCobro = {
  employee_id: string | null;
  meal_type: string | null;
  distribution_date: string;
  meals: number | string | null;
};

/** Empresa de la ficha de cada persona: companyId null = nómina propia. */
export type EmpresaDePersona = { companyId: string | null; companyName: string | null };

export const CUENTA_NOMINA = 'nomina';
export const CUENTA_SIN_FICHA = 'sin_ficha';
export const SIN_CATEGORIA = 'sin_categoria';

export type ItemCobro = { categoria: string; precio: number | null; cantidad: number; monto: number };

export type CuentaComida = {
  /** company_id, o el nombre si la entrega no guardó id; o CUENTA_NOMINA / CUENTA_SIN_FICHA. */
  clave: string;
  nombre: string;
  comidas: number;
  cobradas: number;
  sinPrecio: number;
  monto: number;
  porQr: number;
  porCarnet: number;
  /** Agrupado por categoría y precio, ordenado por categoría y fecha de precio. */
  items: ItemCobro[];
};

const dia = (v: unknown) => String(v ?? '').slice(0, 10);
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const redondear = (n: number) => Math.round(n * 100) / 100;

/** Precio de una categoría en una fecha: el blindado que la cubre gana; si no, el general de «desde» más reciente. */
export function precioComidaEn(precios: PrecioComida[] | null | undefined, categoria: unknown, fecha: string): PrecioComida | null {
  const c = String(categoria ?? '');
  const f = dia(fecha);
  if (!c || !f) return null;
  let blindado: PrecioComida | null = null;
  let general: PrecioComida | null = null;
  const at = (p: PrecioComida) => String(p.created_at ?? '');
  for (const p of precios ?? []) {
    if (!p || p.anulada_at || p.categoria !== c || !(num(p.precio) > 0)) continue;
    const desde = dia(p.desde);
    if (!desde || desde > f) continue;
    const hasta = p.hasta ? dia(p.hasta) : '';
    if (hasta) {
      if (f > hasta) continue;
      if (!blindado || at(p) > at(blindado)) blindado = p;
    } else if (!general || desde > dia(general.desde) || (desde === dia(general.desde) && at(p) > at(general))) {
      general = p;
    }
  }
  return blindado ?? general;
}

/** Revisa un precio antes de guardarlo. Devuelve el motivo del rechazo o null. */
export function validarPrecioComida(
  p: { categoria: unknown; precio: unknown; desde: unknown; hasta?: unknown },
  categoriasValidas: string[],
): string | null {
  if (!categoriasValidas.includes(String(p.categoria ?? ''))) return 'Elige la comida.';
  const v = Number(String(p.precio ?? '').replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return 'Escribe un precio mayor que 0.';
  const desde = dia(p.desde);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return 'Elige la fecha desde la que rige.';
  const hasta = p.hasta ? dia(p.hasta) : '';
  if (hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return 'La fecha «hasta» no es válida.';
  if (hasta && hasta < desde) return 'La fecha «hasta» no puede ser anterior a «desde».';
  return null;
}

/** Cuentas de cobro del rango, una por empresa (más nómina propia y sin ficha). Nómina y sin ficha van al final. */
export function calcularCobroComidas(opts: {
  empresas: ComidaEmpresaCobro[] | null | undefined;
  personas: ComidaPersonaCobro[] | null | undefined;
  empresaDePersona: Map<string, EmpresaDePersona>;
  precios: PrecioComida[] | null | undefined;
}): CuentaComida[] {
  const cuentas = new Map<string, CuentaComida & { _items: Map<string, ItemCobro & { _desde: string }> }>();

  const sumar = (clave: string, nombre: string, categoria: string | null, fecha: string, cantidad: number, via: 'qr' | 'carnet') => {
    if (!(cantidad > 0)) return;
    let c = cuentas.get(clave);
    if (!c) {
      c = { clave, nombre, comidas: 0, cobradas: 0, sinPrecio: 0, monto: 0, porQr: 0, porCarnet: 0, items: [], _items: new Map() };
      cuentas.set(clave, c);
    }
    const cat = categoria || SIN_CATEGORIA;
    const p = categoria ? precioComidaEn(opts.precios, categoria, fecha) : null;
    const precio = p ? redondear(num(p.precio)) : null;
    c.comidas += cantidad;
    if (via === 'qr') c.porQr += cantidad; else c.porCarnet += cantidad;
    if (precio === null) c.sinPrecio += cantidad;
    else { c.cobradas += cantidad; c.monto = redondear(c.monto + cantidad * precio); }
    const k = `${cat}|${precio ?? '-'}`;
    const it = c._items.get(k) ?? { categoria: cat, precio, cantidad: 0, monto: 0, _desde: p ? dia(p.desde) : '' };
    it.cantidad += cantidad;
    it.monto = precio === null ? 0 : redondear(it.cantidad * precio);
    c._items.set(k, it);
  };

  for (const e of opts.empresas ?? []) {
    if (!e) continue;
    const nombre = String(e.company_name ?? '').trim() || 'Empresa sin nombre';
    sumar(e.company_id || nombre, nombre, e.meal_type, dia(e.meal_date), Math.floor(num(e.delivered)), 'qr');
  }

  for (const r of opts.personas ?? []) {
    if (!r) continue;
    const ficha = r.employee_id ? opts.empresaDePersona.get(r.employee_id) : undefined;
    let clave = CUENTA_SIN_FICHA;
    let nombre = 'Por carnet · sin ficha de nómina';
    if (ficha && ficha.companyId) { clave = ficha.companyId; nombre = ficha.companyName || 'Empresa'; }
    else if (ficha) { clave = CUENTA_NOMINA; nombre = 'Nómina propia (por carnet)'; }
    sumar(clave, nombre, r.meal_type, dia(r.distribution_date), Math.floor(num(r.meals)), 'carnet');
  }

  const orden = (c: CuentaComida) => (c.clave === CUENTA_NOMINA ? 1 : c.clave === CUENTA_SIN_FICHA ? 2 : 0);
  return Array.from(cuentas.values())
    .map(({ _items, ...c }) => ({
      ...c,
      items: Array.from(_items.values())
        .sort((a, b) => a.categoria.localeCompare(b.categoria) || a._desde.localeCompare(b._desde))
        .map(({ _desde, ...it }) => it),
    }))
    .sort((a, b) => orden(a) - orden(b) || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Suma de todas las cuentas. */
export function totalCobroComidas(cuentas: CuentaComida[]): { comidas: number; cobradas: number; sinPrecio: number; monto: number } {
  return cuentas.reduce(
    (a, c) => ({ comidas: a.comidas + c.comidas, cobradas: a.cobradas + c.cobradas, sinPrecio: a.sinPrecio + c.sinPrecio, monto: redondear(a.monto + c.monto) }),
    { comidas: 0, cobradas: 0, sinPrecio: 0, monto: 0 },
  );
}
