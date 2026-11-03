// 🧾💵 FACTURAS Y PAGOS DE COMIDA (03-nov-2026, a pedido: «una forma de pago de
// cocina o colocar que ya pagaron una factura, para que no se me pierda el
// registro de quién pagó o quién no… que quede claro y sin excusas que se pagó
// algo, cuánto fue, en qué período fue, a quién fue»).
//
// ⭐ LA FACTURA SE CONGELA AL EMITIRSE. El cobro de la tarjeta se calcula en vivo
//    (precios del día, entregas que se agregan o corrigen después); la factura no:
//    guarda a quién, del cuándo al cuándo, cuántas comidas, el detalle y el monto
//    DE ESE MOMENTO. Si después cambian las entregas, la factura sigue igual y la
//    pantalla avisa la diferencia.
// ⭐ NADA SE BORRA: factura y pago se ANULAN con motivo y quedan a la vista.
// ⭐ El estado sale de sumar los pagos vigentes contra el monto congelado.
//
// PURA: sin Supabase ni React.

export type DetalleFactura = { categoria: string; plato: string | null; cantidad: number; precio: number | null; monto: number; etiqueta?: string };

export type FacturaComida = {
  id: string;
  numero: number;
  cuenta_clave: string;
  cuenta_nombre: string;
  cuenta_clase: 'empresa' | 'contacto' | 'otro';
  company_id: string | null;
  contacto_id: string | null;
  desde: string;
  hasta: string;
  comidas: number;
  monto_usd: number;
  detalle: DetalleFactura[] | null;
  nota: string | null;
  created_at: string;
  created_by_nombre: string | null;
  anulada_at: string | null;
  anulada_por_nombre: string | null;
  anulada_motivo: string | null;
};

export type MetodoPagoComida = 'efectivo_usd' | 'efectivo_bs' | 'transferencia' | 'pago_movil' | 'zelle' | 'usdt' | 'punto' | 'otro';

export type PagoComida = {
  id: string;
  factura_id: string;
  monto_usd: number;
  metodo: MetodoPagoComida;
  monto_bs: number | null;
  tasa: number | null;
  referencia: string | null;
  nota: string | null;
  comprobante_url: string | null;
  fecha_pago: string;
  created_at: string;
  created_by_nombre: string | null;
  anulado_at: string | null;
  anulado_por_nombre: string | null;
  anulado_motivo: string | null;
};

/** Las formas de pago, con palabras de la cocina. `bs` = se paga en bolívares. `ref` = pide referencia. */
export const METODOS_PAGO_COMIDA: { key: MetodoPagoComida; icon: string; label: string; bs: boolean; ref: boolean }[] = [
  { key: 'efectivo_usd', icon: '💵', label: 'Efectivo en dólares', bs: false, ref: false },
  { key: 'efectivo_bs', icon: '💴', label: 'Efectivo en bolívares', bs: true, ref: false },
  { key: 'pago_movil', icon: '📱', label: 'Pago móvil', bs: true, ref: true },
  { key: 'transferencia', icon: '🏦', label: 'Transferencia', bs: true, ref: true },
  { key: 'punto', icon: '💳', label: 'Punto de venta', bs: true, ref: false },
  { key: 'zelle', icon: '🇺🇸', label: 'Zelle', bs: false, ref: true },
  { key: 'usdt', icon: '🪙', label: 'USDT (Binance)', bs: false, ref: true },
  { key: 'otro', icon: '✍️', label: 'Otra forma', bs: false, ref: false },
];
export const metodoDe = (k: unknown) => METODOS_PAGO_COMIDA.find((m) => m.key === k) ?? METODOS_PAGO_COMIDA[METODOS_PAGO_COMIDA.length - 1];

export type EstadoFactura = 'pagada' | 'parcial' | 'pendiente' | 'anulada';
export const ESTADO_FACTURA: Record<EstadoFactura, { icon: string; texto: string; color: string }> = {
  pagada: { icon: '✅', texto: 'PAGADA', color: '#15803D' },
  parcial: { icon: '🟡', texto: 'PAGADA EN PARTE', color: '#B45309' },
  pendiente: { icon: '⏳', texto: 'FALTA POR PAGAR', color: '#B91C1C' },
  anulada: { icon: '🚫', texto: 'ANULADA', color: '#6B7280' },
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const dia = (v: unknown) => String(v ?? '').slice(0, 10);

export const numeroFactura = (n: unknown) => `COM-${String(Number(n) || 0).padStart(4, '0')}`;
export const dmy = (iso: unknown) => {
  const [y, m, d] = dia(iso).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso ?? '');
};
export const usd = (n: unknown) => `$${r2(Number(n)).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const bs = (n: unknown) => `Bs ${r2(Number(n)).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const periodoTexto = (desde: unknown, hasta: unknown) =>
  dia(desde) === dia(hasta) ? `el ${dmy(desde)}` : `del ${dmy(desde)} al ${dmy(hasta)}`;

/** Pagos vigentes (no anulados) de una factura, del más viejo al más nuevo. */
export function pagosDe(facturaId: string, pagos: readonly PagoComida[] | null | undefined, incluirAnulados = false): PagoComida[] {
  return (pagos ?? [])
    .filter((p) => p.factura_id === facturaId && (incluirAnulados || !p.anulado_at))
    .slice()
    .sort((a, b) => dia(a.fecha_pago).localeCompare(dia(b.fecha_pago)) || String(a.created_at).localeCompare(String(b.created_at)));
}

export function estadoFactura(f: FacturaComida, pagos: readonly PagoComida[] | null | undefined): { estado: EstadoFactura; pagado: number; falta: number; pagos: PagoComida[] } {
  const vig = pagosDe(f.id, pagos);
  const pagado = r2(vig.reduce((s, p) => s + Number(p.monto_usd || 0), 0));
  const total = r2(Number(f.monto_usd || 0));
  const falta = r2(Math.max(0, total - pagado));
  if (f.anulada_at) return { estado: 'anulada', pagado, falta: 0, pagos: vig };
  if (falta <= 0.009) return { estado: 'pagada', pagado, falta: 0, pagos: vig };
  return { estado: pagado > 0 ? 'parcial' : 'pendiente', pagado, falta, pagos: vig };
}

/** ¿Dos rangos de días se tocan? (los dos extremos cuentan). */
export const seCruzan = (a1: string, a2: string, b1: string, b2: string) => dia(a1) <= dia(b2) && dia(b1) <= dia(a2);

/** Las facturas VIGENTES de una cuenta que tocan el rango, la más nueva primero. */
export function facturasQueTocan(facturas: readonly FacturaComida[] | null | undefined, clave: string, desde: string, hasta: string): FacturaComida[] {
  return (facturas ?? [])
    .filter((f) => !f.anulada_at && f.cuenta_clave === clave && seCruzan(f.desde, f.hasta, desde, hasta))
    .slice()
    .sort((a, b) => b.numero - a.numero);
}

/** Cuentas que NO se facturan: la nómina propia (consumo interno) y lo que no tiene ficha. */
export const CLAVES_NO_FACTURABLES = new Set(['nomina', 'sin_ficha']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una cuenta de la tarjeta de cobro, lo justo para facturarla. */
export type ItemParaFacturar = { categoria: string; plato: string | null; cantidad: number; precio: number | null; monto: number; seCobra: boolean };
export type CuentaParaFacturar<I extends ItemParaFacturar = ItemParaFacturar> = {
  clave: string;
  nombre: string;
  comidas: number;
  cobradas: number;
  monto: number;
  sinPrecio: number;
  clase?: 'contacto';
  items: I[];
};

export function sePuedeFacturar(c: CuentaParaFacturar | null | undefined): boolean {
  return !!c && !CLAVES_NO_FACTURABLES.has(c.clave) && Number(c.monto) > 0;
}

/**
 * La fila a insertar. El detalle lleva SOLO lo que se cobra (lo interno no va a la
 * factura) y la etiqueta ya escrita, para que el papel diga lo mismo dentro de un año.
 */
export function filaNuevaFactura<I extends ItemParaFacturar>(
  c: CuentaParaFacturar<I>,
  desde: string,
  hasta: string,
  etiqueta: (it: I) => string,
  nota?: string | null,
) {
  const items = c.items.filter((it) => it.seCobra && it.precio !== null);
  const esContacto = c.clase === 'contacto' || c.clave.startsWith('contacto:');
  const contactoId = esContacto ? c.clave.slice('contacto:'.length) : '';
  return {
    cuenta_clave: c.clave,
    cuenta_nombre: c.nombre.trim(),
    cuenta_clase: esContacto ? 'contacto' : UUID.test(c.clave) ? 'empresa' : 'otro',
    company_id: !esContacto && UUID.test(c.clave) ? c.clave : null,
    contacto_id: esContacto && UUID.test(contactoId) ? contactoId : null,
    desde: dia(desde),
    hasta: dia(hasta),
    comidas: items.reduce((s, it) => s + (Number(it.cantidad) || 0), 0),
    monto_usd: r2(Number(c.monto)),
    detalle: items.map((it) => ({ categoria: it.categoria, plato: it.plato, cantidad: it.cantidad, precio: it.precio, monto: r2(it.monto), etiqueta: etiqueta(it) })),
    nota: (nota ?? '').trim() || null,
  };
}

/** Lo que el monto en vivo se movió desde que se facturó (solo si la factura es del MISMO rango). */
export function diferenciaDesdeFactura(f: FacturaComida | null | undefined, desde: string, hasta: string, montoVivo: number): number {
  if (!f || f.anulada_at || dia(f.desde) !== dia(desde) || dia(f.hasta) !== dia(hasta)) return 0;
  const d = r2(Number(montoVivo) - Number(f.monto_usd));
  return Math.abs(d) < 0.01 ? 0 : d;
}

export type DatosPago = {
  montoUsd: number;
  metodo: MetodoPagoComida | null;
  tasa?: number | null;
  referencia?: string | null;
  fecha?: string | null;
};

/** Qué le falta al pago para poder guardarse; null = está listo. Mensajes para la cocina. */
export function validarPago(d: DatosPago, falta: number, hoy: string): string | null {
  if (!d.metodo) return 'Elige cómo pagó (efectivo, pago móvil, transferencia…).';
  if (!(Number(d.montoUsd) > 0)) return 'Escribe cuánto pagó (en dólares).';
  if (r2(d.montoUsd) > r2(falta) + 0.01) return `Pagó más de lo que debe: solo faltan ${usd(falta)}.`;
  const m = metodoDe(d.metodo);
  if (m.bs && !(Number(d.tasa) > 0)) return 'Falta la tasa del día para pasar a bolívares.';
  if (m.ref && !String(d.referencia ?? '').trim()) return `Escribe el número de referencia del ${m.label.toLowerCase()}.`;
  if (d.fecha && dia(d.fecha) > dia(hoy)) return 'La fecha del pago no puede ser de mañana.';
  return null;
}

/** La fila de un pago a insertar (los Bs solo si el método es en bolívares). */
export function filaNuevoPago(facturaId: string, d: DatosPago & { nota?: string | null; comprobanteUrl?: string | null }, hoy: string) {
  const m = metodoDe(d.metodo);
  const tasa = m.bs && Number(d.tasa) > 0 ? Number(d.tasa) : null;
  return {
    factura_id: facturaId,
    monto_usd: r2(d.montoUsd),
    metodo: m.key,
    tasa,
    monto_bs: tasa ? r2(d.montoUsd * tasa) : null,
    referencia: String(d.referencia ?? '').trim() || null,
    nota: String(d.nota ?? '').trim() || null,
    comprobante_url: d.comprobanteUrl || null,
    fecha_pago: dia(d.fecha || hoy),
  };
}

/**
 * La foto del comprobante solo se abre o se enlaza si es una foto NUESTRA (https, del
 * almacenamiento de Supabase, carpeta comida-pagos). Cualquier otra cosa escrita a mano
 * por fuera de la app (p. ej. `javascript:`) se ignora.
 */
export function urlComprobanteSegura(u: unknown): string | null {
  const s = String(u ?? '').trim();
  if (!s) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== 'https:') return null;
    if (!/\.supabase\.co$/i.test(url.hostname)) return null;
    if (!url.pathname.startsWith('/storage/v1/object/public/machinery/comida-pagos/')) return null;
    return url.toString();
  } catch { return null; }
}

/** Un pago en una línea que cualquiera entiende. */
export function textoPago(p: PagoComida): string {
  const m = metodoDe(p.metodo);
  const enBs = p.monto_bs ? ` (${bs(p.monto_bs)} a ${Number(p.tasa).toLocaleString('es-VE', { maximumFractionDigits: 4 })} Bs/$)` : '';
  return `${usd(p.monto_usd)} · ${m.icon} ${m.label}${enBs}${p.referencia ? ` · ref. ${p.referencia}` : ''} · ${dmy(p.fecha_pago)}`;
}

/** La frase grande de confirmación antes de guardar un pago. */
export function fraseConfirmarPago(f: FacturaComida, d: DatosPago, falta: number): string {
  const m = metodoDe(d.metodo);
  const queda = r2(falta - d.montoUsd);
  return `${f.cuenta_nombre} pagó ${usd(d.montoUsd)} con ${m.label.toLowerCase()} — factura ${numeroFactura(f.numero)}, comidas ${periodoTexto(f.desde, f.hasta)}. `
    + (queda <= 0.009 ? 'Con esto la factura queda PAGADA COMPLETA.' : `Después de esto todavía faltan ${usd(queda)}.`);
}

export type FiltroFacturas = 'por_cobrar' | 'pagadas' | 'todas' | 'anuladas';

const normal = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Filtra y ordena: lo que falta por cobrar primero (lo más viejo arriba), lo pagado después. */
export function filtrarFacturas(facturas: readonly FacturaComida[] | null | undefined, pagos: readonly PagoComida[] | null | undefined, filtro: FiltroFacturas, q = '') {
  const t = normal(q);
  return (facturas ?? [])
    .map((f) => ({ f, ...estadoFactura(f, pagos) }))
    .filter((x) => {
      if (filtro === 'por_cobrar' && !(x.estado === 'pendiente' || x.estado === 'parcial')) return false;
      if (filtro === 'pagadas' && x.estado !== 'pagada') return false;
      if (filtro === 'anuladas' && x.estado !== 'anulada') return false;
      if (filtro === 'todas' && x.estado === 'anulada') return false;
      if (!t) return true;
      return normal(`${x.f.cuenta_nombre} ${numeroFactura(x.f.numero)} ${x.f.numero}`).includes(t);
    })
    .sort((a, b) => {
      const pa = a.estado === 'pagada' ? 1 : 0;
      const pb = b.estado === 'pagada' ? 1 : 0;
      if (filtro === 'por_cobrar') return dia(a.f.desde).localeCompare(dia(b.f.desde)) || a.f.numero - b.f.numero;
      return pa - pb || b.f.numero - a.f.numero;
    });
}

/** Los totales de arriba del panel (sin anuladas). */
export function resumenFacturas(facturas: readonly FacturaComida[] | null | undefined, pagos: readonly PagoComida[] | null | undefined) {
  let facturado = 0, cobrado = 0, porCobrar = 0, nPend = 0, nPag = 0;
  for (const f of facturas ?? []) {
    const e = estadoFactura(f, pagos);
    if (e.estado === 'anulada') continue;
    facturado += Number(f.monto_usd || 0);
    cobrado += e.pagado;
    porCobrar += e.falta;
    if (e.estado === 'pagada') nPag += 1; else nPend += 1;
  }
  return { facturado: r2(facturado), cobrado: r2(cobrado), porCobrar: r2(porCobrar), pendientes: nPend, pagadas: nPag };
}
