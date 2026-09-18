// COBRO DE COMIDAS (15-sep-2026). Regla pura, sin imports: la prueba la carga sola.
//
// Vive SOLO en Distribución de comida (pestaña Reportes). No cambia cómo registra la
// cocina ni los conteos: toma lo ya entregado y le pone precio. Cinco reglas:
//
//   1) PRECIO por categoría (desayuno, almuerzo, lunch, cena… y las que vengan), igual que
//      las tarifas de viajes: uno general desde una fecha, o uno BLINDADO a un rango que
//      manda en esas fechas. Nunca se borran: se anulan. Lo pasado conserva su precio.
//   2) CUENTA: lo entregado por QR va a la empresa GUARDADA en la entrega. Lo entregado por
//      carnet va a la empresa de la ficha de la persona; sin empresa en la ficha es nómina
//      propia (por departamento); si la ficha no existe o no se pudo leer, queda aparte.
//   3) Lo que no tiene precio ese día NO suma, pero se cuenta como «sin precio».
//      ⭐ Los platos de «OTROS» (hielo, refresco, postre…) no tienen precio en la tabla:
//      se cobran con el COSTO POR PLATO que escribió la cocina al registrarlos (ver
//      `precioDeEntrega`). Sin costo escrito, «sin precio» como cualquier otra.
//   4) SE COBRA o CONSUMO INTERNO, por cuenta y desde una fecha (comida_cuentas_config). Sin
//      configurar: una empresa se cobra y la nómina propia no. Lo interno se valora aparte y
//      NO suma al total a cobrar.
//   5) ENCARGADO de cada cuenta, desde una fecha (catálogo `encargados`). El cobro se puede
//      ver por cuenta o por encargado: el total es el mismo, solo cambia cómo se reparte.
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
  /** Costo por plato escrito al registrar. Solo se usa en los platos de «Otros». */
  unit_cost?: number | string | null;
  /** Nombre del plato de «Otros» (bolsa de hielo, refresco…). */
  item_label?: string | null;
};

/** Entrega por carnet (food_distributions). */
export type ComidaPersonaCobro = {
  employee_id: string | null;
  meal_type: string | null;
  distribution_date: string;
  meals: number | string | null;
};

/** Ficha de cada persona: companyId null = nómina propia (con su departamento). */
export type EmpresaDePersona = { companyId: string | null; companyName: string | null; departamento?: string | null };

/** Empresa (clave = company_id, o el nombre si la entrega no guardó id) o departamento de la nómina propia. */
export type TipoCuenta = 'empresa' | 'departamento';

/** Una fila del historial de configuración de una cuenta. La última con `desde <= fecha` manda. */
export type ConfigCuenta = {
  id?: string;
  tipo: string;
  clave: string;
  desde: string;
  encargado_id?: string | null;
  se_cobra: boolean;
  nota?: string | null;
  created_at?: string | null;
  created_by_nombre?: string | null;
};

/** Cómo se reparte el cobro: por cuenta (empresa / nómina) o por encargado. */
export type EjeCobro = 'cuenta' | 'encargado';

export const CUENTA_NOMINA = 'nomina';
export const CUENTA_SIN_FICHA = 'sin_ficha';
export const SIN_CATEGORIA = 'sin_categoria';
/** Los platos extra de la distribución por empresa. Ver `precioDeEntrega`. */
export const CATEGORIA_OTROS = 'otros';
export const SIN_ENCARGADO = 'sin_encargado';
export const DEPTO_SIN_NOMBRE = 'SIN DEPARTAMENTO';

/** De dónde salió el precio: la tabla de «Precios y cuentas» o el costo por plato de la cocina. */
export type FuentePrecio = 'tabla' | 'cocina';

export type ItemCobro = {
  categoria: string;
  /** Nombre del plato, solo en «Otros». */
  plato: string | null;
  precio: number | null;
  fuente: FuentePrecio | null;
  cantidad: number;
  monto: number;
  seCobra: boolean;
};

export type CuentaComida = {
  /** company_id (o nombre), CUENTA_NOMINA, CUENTA_SIN_FICHA; o el id del encargado / SIN_ENCARGADO. */
  clave: string;
  nombre: string;
  comidas: number;
  /** Comidas con precio que SE COBRAN. */
  cobradas: number;
  sinPrecio: number;
  /** Lo que se cobra. */
  monto: number;
  /** Valor del consumo interno (con precio, marcado «no se cobra»): se muestra, no se cobra. */
  montoInterno: number;
  comidasInternas: number;
  porQr: number;
  porCarnet: number;
  /** De dónde salen sus comidas: empresas o departamentos, en orden. */
  detalle: string[];
  /** Agrupado por categoría, precio y si se cobra. */
  items: ItemCobro[];
};

const dia = (v: unknown) => String(v ?? '').slice(0, 10);
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const redondear = (n: number) => Math.round(n * 100) / 100;
const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Nombre de departamento listo para comparar: sin espacios de más y en mayúsculas. */
export function normalizarDepartamento(v: unknown): string {
  return limpio(v).toUpperCase() || DEPTO_SIN_NOMBRE;
}

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

/**
 * PRECIO DE UNA ENTREGA (18-sep-2026): la regla ÚNICA que usan la tarjeta de cobro y el
 * reporte PDF con opciones (`montoCon` en comidaReporte.ts). Dos maneras de calcular
 * la misma plata es como se termina discutiendo una factura.
 *
 *   · Desayuno, almuerzo, lunch y cena: el precio de «Precios y cuentas» en su fecha. El
 *     costo que escribe la cocina en estas NO manda: el precio lo pone quien cobra.
 *   · «Otros»: el COSTO POR PLATO que escribió la cocina. Cada plato vale distinto (una
 *     bolsa de hielo no cuesta lo que un refresco) y la tabla no tiene dónde ponerles
 *     precio. El reporte por empresa de la cocina ya los sumaba así; hasta hoy la tarjeta
 *     de cobro decía «sin precio» y los dos papeles no daban lo mismo.
 *
 * Un costo en 0 (la cocina lo dejó en blanco) es «sin precio»: no suma y se avisa.
 * Redondeado a centavos ANTES de multiplicar, igual que el de la tabla.
 */
export function precioDeEntrega(
  precios: PrecioComida[] | null | undefined,
  categoria: unknown,
  fecha: string,
  costoEscrito?: unknown,
): { precio: number; fuente: FuentePrecio; desde: string } | null {
  const c = String(categoria ?? '');
  if (c === CATEGORIA_OTROS) {
    const u = redondear(num(costoEscrito));
    return u > 0 ? { precio: u, fuente: 'cocina', desde: '' } : null;
  }
  const p = precioComidaEn(precios, c, fecha);
  return p ? { precio: redondear(num(p.precio)), fuente: 'tabla', desde: dia(p.desde) } : null;
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

/** Historial de configuración por cuenta, del más viejo al más nuevo. */
export type IndiceConfig = Map<string, ConfigCuenta[]>;

const claveDeConfig = (tipo: string, clave: unknown) =>
  `${tipo}|${tipo === 'departamento' ? normalizarDepartamento(clave) : limpio(clave)}`;

export function indexarConfigCuentas(filas: ConfigCuenta[] | null | undefined): IndiceConfig {
  const idx: IndiceConfig = new Map();
  (filas ?? []).forEach((f) => {
    if (!f || (f.tipo !== 'empresa' && f.tipo !== 'departamento') || !limpio(f.clave) || !dia(f.desde) || typeof f.se_cobra !== 'boolean') return;
    const k = claveDeConfig(f.tipo, f.clave);
    const lista = idx.get(k) ?? [];
    lista.push(f);
    idx.set(k, lista);
  });
  idx.forEach((lista) =>
    lista.sort((a, b) => dia(a.desde).localeCompare(dia(b.desde)) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))),
  );
  return idx;
}

/** La configuración que rige para esa cuenta en esa fecha, o null. */
export function configCuentaEn(idx: IndiceConfig | null | undefined, tipo: TipoCuenta, clave: unknown, fecha: string): ConfigCuenta | null {
  if (!idx) return null;
  const f = dia(fecha);
  let vigente: ConfigCuenta | null = null;
  for (const c of idx.get(claveDeConfig(tipo, clave)) ?? []) if (dia(c.desde) <= f) vigente = c;
  return vigente;
}

/** Sin configurar: una empresa se cobra; la nómina propia (por departamento) es consumo interno. */
export function seCobraPorDefecto(tipo: TipoCuenta | null): boolean {
  return tipo !== 'departamento';
}

/**
 * Cuentas de cobro del rango. Con `eje: 'cuenta'` (por defecto) una por empresa, más nómina
 * propia y sin ficha al final. Con `eje: 'encargado'`, una por encargado, y «Sin encargado»
 * al final. El total a cobrar es el mismo en los dos ejes.
 */
export function calcularCobroComidas(opts: {
  empresas: ComidaEmpresaCobro[] | null | undefined;
  personas: ComidaPersonaCobro[] | null | undefined;
  empresaDePersona: Map<string, EmpresaDePersona>;
  precios: PrecioComida[] | null | undefined;
  config?: IndiceConfig | null;
  /** id → nombre del encargado. */
  encargados?: Map<string, string> | null;
  eje?: EjeCobro;
}): CuentaComida[] {
  const eje: EjeCobro = opts.eje === 'encargado' ? 'encargado' : 'cuenta';
  type Acum = CuentaComida & { _orden: number; _items: Map<string, ItemCobro & { _desde: string }>; _detalle: Set<string> };
  const cuentas = new Map<string, Acum>();

  const sumar = (m: {
    clave: string; nombre: string; orden: number; tipo: TipoCuenta | null; claveConfig: string; detalle: string;
    categoria: string | null; fecha: string; cantidad: number; via: 'qr' | 'carnet';
    /** Solo las entregas por QR: costo por plato y nombre del plato de «Otros». */
    costo?: unknown; plato?: unknown;
  }) => {
    if (!(m.cantidad > 0)) return;
    const cfg = m.tipo ? configCuentaEn(opts.config, m.tipo, m.claveConfig, m.fecha) : null;
    const seCobra = cfg ? cfg.se_cobra : seCobraPorDefecto(m.tipo);
    let { clave, nombre, orden } = m;
    if (eje === 'encargado') {
      const id = limpio(cfg?.encargado_id);
      clave = id || SIN_ENCARGADO;
      nombre = id ? opts.encargados?.get(id) || 'Encargado sin nombre' : 'Sin encargado asignado';
      orden = id ? 0 : 1;
    }
    let c = cuentas.get(clave);
    if (!c) {
      c = {
        clave, nombre, comidas: 0, cobradas: 0, sinPrecio: 0, monto: 0, montoInterno: 0, comidasInternas: 0,
        porQr: 0, porCarnet: 0, detalle: [], items: [], _orden: orden, _items: new Map(), _detalle: new Set(),
      };
      cuentas.set(clave, c);
    }
    const cat = m.categoria || SIN_CATEGORIA;
    const pe = m.categoria ? precioDeEntrega(opts.precios, m.categoria, m.fecha, m.costo) : null;
    const precio = pe ? pe.precio : null;
    const plato = cat === CATEGORIA_OTROS ? limpio(m.plato) || null : null;
    c.comidas += m.cantidad;
    if (m.via === 'qr') c.porQr += m.cantidad; else c.porCarnet += m.cantidad;
    c._detalle.add(m.detalle);
    if (precio === null) c.sinPrecio += m.cantidad;
    if (!seCobra) c.comidasInternas += m.cantidad;
    if (precio !== null && seCobra) { c.cobradas += m.cantidad; c.monto = redondear(c.monto + m.cantidad * precio); }
    if (precio !== null && !seCobra) c.montoInterno = redondear(c.montoInterno + m.cantidad * precio);
    // Los platos de «Otros» van uno por nombre (y por costo): «4 bolsas de hielo» dice
    // qué se cobra; «4 otros» no.
    const k = `${cat}|${(plato ?? '').toLowerCase()}|${precio ?? '-'}|${seCobra ? 1 : 0}`;
    const it = c._items.get(k) ?? {
      categoria: cat, plato, precio, fuente: pe ? pe.fuente : null, cantidad: 0, monto: 0, seCobra, _desde: pe ? pe.desde : '',
    };
    it.cantidad += m.cantidad;
    it.monto = precio === null ? 0 : redondear(it.cantidad * precio);
    c._items.set(k, it);
  };

  for (const e of opts.empresas ?? []) {
    if (!e) continue;
    const nombre = limpio(e.company_name) || 'Empresa sin nombre';
    const clave = e.company_id || nombre;
    sumar({
      clave, nombre, orden: 0, tipo: 'empresa', claveConfig: clave, detalle: nombre,
      categoria: e.meal_type, fecha: dia(e.meal_date), cantidad: Math.floor(num(e.delivered)), via: 'qr',
      costo: e.unit_cost, plato: e.item_label,
    });
  }

  for (const r of opts.personas ?? []) {
    if (!r) continue;
    const ficha = r.employee_id ? opts.empresaDePersona.get(r.employee_id) : undefined;
    const base = { categoria: r.meal_type, fecha: dia(r.distribution_date), cantidad: Math.floor(num(r.meals)), via: 'carnet' as const };
    if (ficha && ficha.companyId) {
      const nombre = limpio(ficha.companyName) || 'Empresa';
      sumar({ ...base, clave: ficha.companyId, nombre, orden: 0, tipo: 'empresa', claveConfig: ficha.companyId, detalle: nombre });
    } else if (ficha) {
      const depto = normalizarDepartamento(ficha.departamento);
      sumar({ ...base, clave: CUENTA_NOMINA, nombre: 'Nómina propia (por carnet)', orden: 1, tipo: 'departamento', claveConfig: depto, detalle: depto });
    } else {
      sumar({ ...base, clave: CUENTA_SIN_FICHA, nombre: 'Por carnet · sin ficha de nómina', orden: 2, tipo: null, claveConfig: '', detalle: 'Sin ficha' });
    }
  }

  return Array.from(cuentas.values())
    .map(({ _items, _detalle, ...c }) => ({
      ...c,
      detalle: Array.from(_detalle).sort((a, b) => a.localeCompare(b, 'es')),
      items: Array.from(_items.values())
        .sort((a, b) => a.categoria.localeCompare(b.categoria) || (a.plato ?? '').localeCompare(b.plato ?? '', 'es')
          || Number(b.seCobra) - Number(a.seCobra) || a._desde.localeCompare(b._desde))
        .map(({ _desde, ...it }) => it),
    }))
    .sort((a, b) => a._orden - b._orden || a.nombre.localeCompare(b.nombre, 'es'))
    .map(({ _orden, ...c }) => c);
}

export type TotalCobroComidas = { comidas: number; cobradas: number; sinPrecio: number; monto: number; montoInterno: number; comidasInternas: number };

/** Suma de todas las cuentas. `monto` es lo que se cobra; `montoInterno`, el consumo interno. */
export function totalCobroComidas(cuentas: CuentaComida[]): TotalCobroComidas {
  return cuentas.reduce(
    (a, c) => ({
      comidas: a.comidas + c.comidas,
      cobradas: a.cobradas + c.cobradas,
      sinPrecio: a.sinPrecio + c.sinPrecio,
      monto: redondear(a.monto + c.monto),
      montoInterno: redondear(a.montoInterno + c.montoInterno),
      comidasInternas: a.comidasInternas + c.comidasInternas,
    }),
    { comidas: 0, cobradas: 0, sinPrecio: 0, monto: 0, montoInterno: 0, comidasInternas: 0 },
  );
}
