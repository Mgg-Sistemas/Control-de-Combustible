// LOS DATOS DEL REPORTE DE COMIDAS (18-sep-2026).
//
// Pedido del cliente: «poder imprimir los pdf, para empresa, para personas, para
// cualquier día que filtre, para un tipo de comida, o poder seleccionar varias
// opciones para poder imprimir».
//
// Acá vive el FILTRO (qué entregas entran) y el agrupado. Lo que se OCULTA del
// papel vive aparte, en `comidaReporteOpciones.ts`. Son dos cosas distintas a
// propósito:
//
//   · el FILTRO cambia los totales  → sale escrito en el cuadro de alcance
//   · la PASTILLA oculta columnas   → los totales no cambian
//
// Si se mezclaran, un total sin su cuadro de alcance sería un número imposible
// de auditar después: nadie sabría si faltan empresas o si solo se escondió una
// columna. Por eso `alcanceEnPalabras` NO es decorativo — es la única forma de
// leer el papel seis meses más tarde.
//
// Solo importa `cobroComidas` (que no importa nada), para que el precio del
// reporte sea EL MISMO que muestra la tarjeta de cobro en pantalla. Dos maneras
// de calcular la misma plata es como se termina discutiendo una factura.
//
// Prueba: scripts/test-comida-reporte.mjs

import { precioDeEntrega, PrecioComida } from './cobroComidas';

/** Una entrega por QR de empresa (food_company_meals). */
export type EntregaEmpresa = {
  id?: string;
  company_id?: string | null;
  company_name?: string | null;
  meal_type?: string | null;
  meal_date: string;
  delivered?: number | string | null;
  unit_cost?: number | string | null;
  item_label?: string | null;
  note?: string | null;
  delivered_at?: string | null;
  created_by_name?: string | null;
};

/** Una entrega por carnet (food_distributions). */
export type EntregaPersona = {
  id?: string;
  employee_id?: string | null;
  employee_name?: string | null;
  cedula?: string | null;
  meal_type?: string | null;
  distribution_date: string;
  meals?: number | string | null;
  note?: string | null;
  delivered_at?: string | null;
  created_by_name?: string | null;
};

/**
 * Qué entra en el papel. Una lista VACÍA quiere decir «todas»: es lo que espera
 * quien abre el reporte y no toca nada, y evita el papel en blanco por haber
 * abierto el filtro sin elegir.
 */
export type FiltroComida = {
  desde: string;
  hasta: string;
  /** Claves de empresa (company_id, o el nombre si la entrega no guardó id). */
  empresas: string[];
  /** Claves de persona (employee_id, o cédula, o el nombre). */
  personas: string[];
  /** Tiempos de comida: desayuno, almuerzo, lunch, cena, otros. */
  comidas: string[];
  /** ¿Entran las entregas por QR de empresa? */
  conEmpresas: boolean;
  /** ¿Entran las entregas por carnet? */
  conPersonas: boolean;
};

export const FILTRO_COMIDA_TODO: FiltroComida = {
  desde: '', hasta: '', empresas: [], personas: [], comidas: [], conEmpresas: true, conPersonas: true,
};

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const dia = (v: unknown) => String(v ?? '').slice(0, 10);
const redondear = (n: number) => Math.round(n * 100) / 100;

/** Clave con la que se agrupa una empresa. El id manda; si la entrega vieja no
 *  lo guardó, el nombre hace de clave (es lo que ya hace la pantalla). */
export const claveEmpresa = (r: EntregaEmpresa): string => limpio(r.company_id) || limpio(r.company_name);

/** Clave con la que se agrupa una persona: ficha, cédula o nombre, en ese orden. */
export const clavePersona = (r: EntregaPersona): string =>
  limpio(r.employee_id) || limpio(r.cedula) || limpio(r.employee_name);

const entreFechas = (f: string, desde: string, hasta: string): boolean => {
  if (!f) return false;
  const [a, b] = desde && hasta && desde > hasta ? [hasta, desde] : [desde, hasta];
  if (a && f < a) return false;
  if (b && f > b) return false;
  return true;
};

/** Una lista vacía NO filtra: significa «todas». */
const pasa = (lista: string[] | null | undefined, clave: string): boolean =>
  !lista || lista.length === 0 || lista.includes(clave);

/**
 * EL FILTRO, ACOTADO A LO QUE DE VERDAD SE CARGÓ.
 *
 * ⚠️ El papel solo puede hablar de lo que la pantalla trajo. Dos formas de que
 *    dijera otra cosa, las dos encontradas al revisar (18-sep-2026):
 *
 *    · FECHAS: en la PC el campo de fecha deja ESCRIBIR una fuera del rango (el
 *      navegador marca `min`/`max` como inválido pero no corrige el valor). El
 *      papel decía «del 1 al 18» con un solo día adentro. Por eso las fechas se
 *      recortan ACÁ, no en el calendario: una fecha vacía (el «Borrar» del
 *      selector de Android, o a medio escribir) vale como el borde cargado.
 *
 *    · SELECCIONES: una empresa marcada que ya no está en lo cargado seguía
 *      filtrando, sin verse y sin poder desmarcarse. Se descarta lo que no está.
 */
export function acotarFiltro(
  f: FiltroComida,
  cargado: { desde: string; hasta: string; empresas: string[]; personas: string[] },
): FiltroComida {
  const d = dia(f.desde);
  const h = dia(f.hasta);
  let desde = d && d >= cargado.desde && d <= cargado.hasta ? d : cargado.desde;
  let hasta = h && h <= cargado.hasta && h >= cargado.desde ? h : cargado.hasta;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const empresasOk = new Set(cargado.empresas);
  const personasOk = new Set(cargado.personas);
  return {
    ...f,
    desde,
    hasta,
    empresas: f.empresas.filter((k) => empresasOk.has(k)),
    personas: f.personas.filter((k) => personasOk.has(k)),
  };
}

/** Las entregas que entran en el papel, ya filtradas por todo. */
export function filtrarComidas(
  entregas: { empresas?: EntregaEmpresa[] | null; personas?: EntregaPersona[] | null },
  f: FiltroComida,
): { empresas: EntregaEmpresa[]; personas: EntregaPersona[] } {
  const empresas = !f.conEmpresas ? [] : (entregas.empresas ?? []).filter(
    (r) => entreFechas(dia(r.meal_date), f.desde, f.hasta)
      && pasa(f.empresas, claveEmpresa(r))
      && pasa(f.comidas, limpio(r.meal_type)),
  );
  const personas = !f.conPersonas ? [] : (entregas.personas ?? []).filter(
    (r) => entreFechas(dia(r.distribution_date), f.desde, f.hasta)
      && pasa(f.personas, clavePersona(r))
      && pasa(f.comidas, limpio(r.meal_type)),
  );
  return { empresas, personas };
}

// ── LA PLATA ────────────────────────────────────────────────────────────────
//
// ⭐ LA MISMA REGLA QUE LA TARJETA DE COBRO, AL PIE DE LA LETRA
//    (`calcularCobroComidas` en cobroComidas.ts): los dos llaman a
//    `precioDeEntrega`, REDONDEADO a centavos ANTES de multiplicar, por la
//    cantidad ENTERA. Dos maneras de calcular la misma plata es como se termina
//    discutiendo una factura: el papel y la tarjeta tienen que dar lo mismo.
//
// ⭐ EL COSTO ESCRITO AL REGISTRAR (`unit_cost`) SOLO CUENTA EN «OTROS», y solo
//    mientras el plato no tenga precio propio en la tabla (18-sep-2026, decisión del
//    cliente). En las cuatro comidas fijas manda la tabla de precios, y un precio
//    anulado o un día antes del primer precio sigue siendo «sin precio» aunque la
//    cocina haya escrito un costo. La regla vive en UN solo sitio
//    (`precioDeEntrega`) y la prueba compara los dos cálculos. `platoAPrecio` es
//    el mismo que recibe la tarjeta (`resolverPlatos` en comidaPlatos.ts).
//
// ⚠️ Una entrega sin precio NO suma cero en silencio: suma «sin precio», y el
//    papel lo dice. Un monto que se come las comidas sin precio es una factura
//    corta, y la corrige el cliente, no el sistema.
//
// ⚠️ Esto es el VALOR de lo entregado, no lo que se COBRA: la tarjeta además
//    separa el consumo interno (nómina propia que no se cobra). Lo cobrable, por
//    cuenta, sale en «📄 PDF del cobro». Por eso la columna dice «Valor».

export type MontoEntrega = { monto: number; conPrecio: boolean; precioUnitario: number };

/** Del nombre del plato de «Otros» a su categoría de precio. */
export type PlatoAPrecio = ((nombre: unknown) => string | null) | null | undefined;

function montoCon(
  cantidad: unknown, categoria: unknown, fecha: unknown, precios: PrecioComida[] | null | undefined,
  costoEscrito?: unknown, categoriaPlato?: string | null,
): MontoEntrega {
  const cant = Math.floor(num(cantidad));
  const cat = limpio(categoria);
  const p = cat ? precioDeEntrega(precios, cat, dia(fecha), costoEscrito, categoriaPlato) : null;
  if (!p) return { monto: 0, conPrecio: false, precioUnitario: 0 };
  return { monto: redondear(cant * p.precio), conPrecio: true, precioUnitario: p.precio };
}

export function montoDeEmpresa(r: EntregaEmpresa, precios: PrecioComida[] | null | undefined, platoAPrecio?: PlatoAPrecio): MontoEntrega {
  const catPlato = limpio(r.meal_type) === 'otros' && platoAPrecio ? platoAPrecio(r.item_label) : null;
  return montoCon(r.delivered, r.meal_type, r.meal_date, precios, r.unit_cost, catPlato);
}

export function montoDePersona(r: EntregaPersona, precios: PrecioComida[] | null | undefined): MontoEntrega {
  return montoCon(r.meals, r.meal_type, r.distribution_date, precios);
}

// ── LOS AGRUPADOS ───────────────────────────────────────────────────────────

export type GrupoComida = {
  clave: string;
  nombre: string;
  /** Cantidad por tiempo de comida. */
  porComida: Record<string, number>;
  total: number;
  monto: number;
  sinPrecio: number;
  /** Días distintos con al menos una entrega. */
  dias: number;
};

const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });

function armarGrupos<T>(
  filas: T[],
  clave: (r: T) => string,
  nombre: (r: T) => string,
  comida: (r: T) => string,
  cantidad: (r: T) => number,
  fecha: (r: T) => string,
  monto: (r: T) => MontoEntrega,
): GrupoComida[] {
  const map = new Map<string, GrupoComida & { _dias: Set<string> }>();
  filas.forEach((r) => {
    const k = clave(r) || '—';
    let g = map.get(k);
    if (!g) {
      g = { clave: k, nombre: nombre(r) || '—', porComida: {}, total: 0, monto: 0, sinPrecio: 0, dias: 0, _dias: new Set() };
      map.set(k, g);
    }
    const c = cantidad(r);
    const cat = comida(r) || 'sin_comida';
    g.porComida[cat] = (g.porComida[cat] || 0) + c;
    g.total += c;
    const m = monto(r);
    if (m.conPrecio) g.monto = redondear(g.monto + m.monto);
    else g.sinPrecio += c;
    g._dias.add(fecha(r));
  });
  return Array.from(map.values())
    .map((g) => { g.dias = g._dias.size; return g; })
    .sort((a, b) => cmp(a.nombre, b.nombre));
}

export function agruparEmpresas(filas: EntregaEmpresa[], precios: PrecioComida[] | null | undefined, platoAPrecio?: PlatoAPrecio): GrupoComida[] {
  return armarGrupos(
    filas, claveEmpresa, (r) => limpio(r.company_name), (r) => limpio(r.meal_type),
    (r) => num(r.delivered), (r) => dia(r.meal_date), (r) => montoDeEmpresa(r, precios, platoAPrecio),
  );
}

export function agruparPersonas(filas: EntregaPersona[], precios: PrecioComida[] | null | undefined): GrupoComida[] {
  return armarGrupos(
    filas, clavePersona, (r) => limpio(r.employee_name), (r) => limpio(r.meal_type),
    (r) => num(r.meals), (r) => dia(r.distribution_date), (r) => montoDePersona(r, precios),
  );
}

/** La cédula de cada persona, para la columna (la clave no siempre es la cédula). */
export function cedulasPorClave(filas: EntregaPersona[]): Map<string, string> {
  const m = new Map<string, string>();
  filas.forEach((r) => {
    const k = clavePersona(r);
    if (k && !m.get(k)) m.set(k, limpio(r.cedula));
  });
  return m;
}

export type TotalesComida = {
  porComida: Record<string, number>;
  total: number;
  monto: number;
  sinPrecio: number;
  empresas: number;
  personas: number;
};

export function totalesDeGrupos(empresas: GrupoComida[], personas: GrupoComida[]): TotalesComida {
  const t: TotalesComida = { porComida: {}, total: 0, monto: 0, sinPrecio: 0, empresas: empresas.length, personas: personas.length };
  [...empresas, ...personas].forEach((g) => {
    Object.entries(g.porComida).forEach(([k, v]) => { t.porComida[k] = (t.porComida[k] || 0) + v; });
    t.total += g.total;
    t.monto = redondear(t.monto + g.monto);
    t.sinPrecio += g.sinPrecio;
  });
  return t;
}

// ── EL LISTADO ENTREGA POR ENTREGA ──────────────────────────────────────────

export type LineaDetalle = {
  fecha: string;
  hora: string;
  quienRecibe: string;
  via: 'empresa' | 'persona';
  comida: string;
  /** Nombre del plato, para OTROS. */
  plato: string;
  cantidad: number;
  monto: number;
  conPrecio: boolean;
  quien: string;
  nota: string;
};

/** La hora de Caracas, escrita. Nunca la del teléfono: un historial en UTC dice
 *  que se entregó a mediodía lo que se entregó a las 8 de la mañana. */
export function horaCaracas(iso: unknown): string {
  const s = String(iso ?? '');
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
}

export function lineasDetalle(
  entregas: { empresas: EntregaEmpresa[]; personas: EntregaPersona[] },
  precios: PrecioComida[] | null | undefined,
  platoAPrecio?: PlatoAPrecio,
): LineaDetalle[] {
  const filas: LineaDetalle[] = [];
  entregas.empresas.forEach((r) => {
    const m = montoDeEmpresa(r, precios, platoAPrecio);
    filas.push({
      fecha: dia(r.meal_date), hora: horaCaracas(r.delivered_at), quienRecibe: limpio(r.company_name) || '—',
      via: 'empresa', comida: limpio(r.meal_type), plato: limpio(r.item_label), cantidad: num(r.delivered),
      monto: m.monto, conPrecio: m.conPrecio, quien: limpio(r.created_by_name), nota: limpio(r.note),
    });
  });
  entregas.personas.forEach((r) => {
    const m = montoDePersona(r, precios);
    filas.push({
      fecha: dia(r.distribution_date), hora: horaCaracas(r.delivered_at), quienRecibe: limpio(r.employee_name) || '—',
      via: 'persona', comida: limpio(r.meal_type), plato: '', cantidad: num(r.meals),
      monto: m.monto, conPrecio: m.conPrecio, quien: limpio(r.created_by_name), nota: limpio(r.note),
    });
  });
  // Por día y, dentro del día, por hora: así se lee como el parte del día.
  return filas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : cmp(a.quienRecibe, b.quienRecibe)));
}

// ── EL CUADRO DE ALCANCE ────────────────────────────────────────────────────

/**
 * QUÉ SE PIDIÓ, en criollo. Va en el papel y en la pantalla ANTES de generar.
 *
 * ⚠️ Esto es lo que hace auditable un total filtrado. Si dice «Todas las
 *    empresas» y el total es 300, es 300 de todo; si dice «Solo: COSTA BRAVA»,
 *    nadie va a pensar que faltan comidas.
 */
export function alcanceEnPalabras(
  f: FiltroComida,
  nombres: { empresas?: Map<string, string>; personas?: Map<string, string>; comidas?: Map<string, string> } = {},
): string[] {
  const l: string[] = [];
  const nombrar = (claves: string[], m: Map<string, string> | undefined) =>
    claves.map((k) => m?.get(k) || k).join(', ');

  if (!f.conEmpresas && !f.conPersonas) l.push('⚠️ No se pidió ni lo de empresas ni lo de personas: el papel sale vacío.');
  if (f.conEmpresas && f.conPersonas) l.push('Entra lo entregado por QR de empresa y por carnet.');
  else if (f.conEmpresas) l.push('Entra SOLO lo entregado por QR de empresa.');
  else if (f.conPersonas) l.push('Entra SOLO lo entregado por carnet (personas).');

  l.push(f.empresas.length ? `Empresas: solo ${nombrar(f.empresas, nombres.empresas)}.` : 'Empresas: todas.');
  l.push(f.personas.length ? `Personas: solo ${nombrar(f.personas, nombres.personas)}.` : 'Personas: todas.');
  l.push(f.comidas.length ? `Comidas: solo ${nombrar(f.comidas, nombres.comidas)}.` : 'Comidas: todas.');
  return l;
}

/** ¿El filtro dejó el papel sin una sola entrega? Para avisarlo antes de generar. */
export function filtroSinEntregas(e: { empresas: EntregaEmpresa[]; personas: EntregaPersona[] }): boolean {
  return e.empresas.length === 0 && e.personas.length === 0;
}
