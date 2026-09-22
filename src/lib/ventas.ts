// VENTAS — la cuenta, el documento y los filtros del historial, en un solo lugar.
//
// Vive aparte de la pantalla (sin React ni Supabase) para poder probarlo de
// verdad: la plata de una venta no puede depender de que alguien lea bien un
// `useMemo` de 300 líneas. Ver `scripts/test-ventas.mjs`.
//
// REGLAS QUE BLINDA:
//  · El total de un renglón es cantidad × precio, redondeado a 2 decimales UNA
//    sola vez. Si se redondea al final, 3 renglones de 0.005 desaparecen.
//  · El IVA es OPCIONAL por venta (pedido del cliente): apagado = el precio es
//    el total. No se calcula "por si acaso".
//  · El equivalente en Bs se congela con la tasa del día de la venta. Si mañana
//    cambia la tasa, el papel impreso ayer NO cambia.
//  · Una CÉDULA (o un RIF) no puede entrar dos veces: se comparan solo los
//    DÍGITOS, así "V-12.345.678" y "V12345678" son la misma persona.
import { norm } from './text';

// ── Tipos ────────────────────────────────────────────────────────────────────
export type VentaDocKind = 'factura' | 'nota_entrega';
export type VentaCondicion = 'contado' | 'credito';
export type MetodoPago = 'bs' | 'transferencia' | 'pago_movil' | 'zelle' | 'usdt' | 'efectivo_usd';

/** Los métodos de pago, con su rótulo para la pantalla y el papel. */
export const METODOS_PAGO: { key: MetodoPago; label: string; icon: string }[] = [
  { key: 'bs', label: 'Bolívares (efectivo)', icon: '💵' },
  { key: 'transferencia', label: 'Transferencia', icon: '🏦' },
  { key: 'pago_movil', label: 'Pago móvil', icon: '📱' },
  { key: 'zelle', label: 'Zelle', icon: '💳' },
  { key: 'usdt', label: 'USDT', icon: '🪙' },
  { key: 'efectivo_usd', label: 'Dólares (efectivo)', icon: '💲' },
];
export const metodoLabel = (k?: MetodoPago | null): string =>
  METODOS_PAGO.find((m) => m.key === k)?.label ?? '—';

export const DOC_KINDS: { key: VentaDocKind; label: string; icon: string }[] = [
  { key: 'factura', label: 'Factura', icon: '🧾' },
  { key: 'nota_entrega', label: 'Nota de entrega', icon: '📄' },
];
export const docKindLabel = (k?: VentaDocKind | null): string =>
  DOC_KINDS.find((d) => d.key === k)?.label ?? '—';

/** Un renglón de la venta: material del inventario o servicio del catálogo. */
export type VentaItem = {
  kind: 'material' | 'servicio';
  item_id?: string | null;     // inventory_items.id (solo material: es lo que descuenta stock)
  service_id?: string | null;  // sales_services.id
  name: string;
  unit?: string | null;
  qty: number;
  price: number;               // $ por unidad (referencial, el usuario lo puede cambiar)
};

export type VentaRow = {
  id?: string;
  code?: string | null;
  doc_kind: VentaDocKind;
  doc_number?: string | null;
  client_id?: string | null;
  client_name: string;
  client_doc?: string | null;
  sale_date: string;
  items?: VentaItem[] | null;
  subtotal?: number;
  con_iva?: boolean;
  iva_pct?: number;
  iva_monto?: number;
  total?: number;
  condicion: VentaCondicion;
  payment_method?: MetodoPago | null;
  rate_bs?: number;
  total_bs?: number;
  note?: string | null;
  created_by_name?: string | null;
};

// ── Dinero ───────────────────────────────────────────────────────────────────
/** IVA de Venezuela. Es el valor por defecto; la venta guarda el que se usó. */
export const IVA_PCT = 16;

const n = (v: any): number => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
/** Redondeo a 2 decimales "de dinero" (evita 17.169999999999998). */
export const money = (v: any): number => Math.round((n(v) + Number.EPSILON) * 100) / 100;

/** Total de UN renglón: cantidad × precio, redondeado ya. */
export const lineaTotal = (it: Pick<VentaItem, 'qty' | 'price'>): number => money(n(it?.qty) * n(it?.price));

/** Suma de los renglones (cada uno ya redondeado). */
export const subtotalDe = (items?: VentaItem[] | null): number =>
  money((items ?? []).reduce((a, it) => a + lineaTotal(it), 0));

/** IVA del subtotal. Si la venta va SIN IVA, es 0 (no se calcula "por si acaso"). */
export const ivaDe = (subtotal: number, conIva: boolean, pct: number = IVA_PCT): number =>
  conIva ? money(n(subtotal) * n(pct) / 100) : 0;

/** La cuenta completa de una venta, en $. */
export function cuentaDe(items?: VentaItem[] | null, conIva = false, pct: number = IVA_PCT) {
  const subtotal = subtotalDe(items);
  const iva = ivaDe(subtotal, conIva, pct);
  return { subtotal, iva, total: money(subtotal + iva) };
}

/** $ → Bs con la tasa dada (la del BCV del día de la venta). */
export const bsDeUsd = (usd: any, tasa: any): number => money(n(usd) * n(tasa));
/** Bs → $ (0 si no hay tasa: dividir entre 0 no es "gratis"). */
export const usdDeBs = (bs: any, tasa: any): number => (n(tasa) > 0 ? money(n(bs) / n(tasa)) : 0);

// ── Cédula / RIF ─────────────────────────────────────────────────────────────
export const DOC_LETRAS = ['V', 'E', 'J', 'G', 'P'] as const;
export type DocLetra = (typeof DOC_LETRAS)[number];

/** V/E/P identifican PERSONA (cédula); J/G identifican EMPRESA (RIF). */
export const esRif = (letra?: string | null): boolean => letra === 'J' || letra === 'G';
export const docTipoLabel = (letra?: string | null): string => (esRif(letra) ? 'RIF' : 'Cédula');

/** Solo los dígitos: así "V-12.345.678" y "V12345678" comparan igual. */
export const docDigitos = (v: any): string => String(v ?? '').replace(/[^0-9]/g, '');

/** Como se imprime y se guarda: "V-12345678". */
export const docCanonico = (letra?: string | null, numero?: any): string => {
  const d = docDigitos(numero);
  const l = String(letra ?? '').toUpperCase();
  return d ? `${l}-${d}` : '';
};

/** Un documento sirve si tiene letra válida y al menos 6 dígitos. */
export const docValido = (letra?: string | null, numero?: any): boolean =>
  (DOC_LETRAS as readonly string[]).includes(String(letra ?? '').toUpperCase()) && docDigitos(numero).length >= 6;

export type ClienteRow = {
  id: string;
  name: string;
  doc_letter: string;
  doc_number: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  es_proveedor?: boolean | null;
  note?: string | null;
  active?: boolean | null;
};

/**
 * ¿Ya existe ese documento en la lista? Compara letra + DÍGITOS, e ignora al
 * propio registro cuando se está editando (`exceptoId`).
 *
 * La base también lo impide por índice único; esto es para avisar ANTES y con
 * un mensaje que se entienda, no para reemplazarlo.
 */
export function docDuplicado<T extends ClienteRow>(
  lista: T[] | null | undefined,
  letra?: string | null,
  numero?: any,
  exceptoId?: string | null,
): T | null {
  const l = String(letra ?? '').toUpperCase();
  const d = docDigitos(numero);
  if (!l || !d) return null;
  return (lista ?? []).find(
    (c) => c.id !== exceptoId && String(c.doc_letter ?? '').toUpperCase() === l && docDigitos(c.doc_number) === d,
  ) ?? null;
}

/** Todo lo buscable de un cliente, junto: nombre, documento, teléfono, correo, dirección. */
export const clienteHaystack = (c: ClienteRow): string =>
  norm([c.name, docCanonico(c.doc_letter, c.doc_number), c.doc_number, c.phone, c.email, c.address, c.note]
    .filter(Boolean).join(' '));

/** Busca clientes por CUALQUIER característica. Sin texto, devuelve todos. */
export function buscarClientes<T extends ClienteRow>(lista: T[] | null | undefined, texto?: string | null): T[] {
  const q = norm(texto ?? '');
  const rows = lista ?? [];
  if (!q) return [...rows];
  return rows.filter((c) => clienteHaystack(c).includes(q));
}

// ── Servicios del catálogo ───────────────────────────────────────────────────
export type ServicioRow = { id: string; name: string; description?: string | null; price?: number | null; active?: boolean | null };

export const servicioHaystack = (s: ServicioRow): string =>
  norm([s.name, s.description, s.price].filter(Boolean).join(' '));

/** Busca servicios por cualquier característica (nombre, descripción, precio). */
export function buscarServicios<T extends ServicioRow>(lista: T[] | null | undefined, texto?: string | null): T[] {
  const q = norm(texto ?? '');
  const rows = lista ?? [];
  if (!q) return [...rows];
  return rows.filter((s) => servicioHaystack(s).includes(q));
}

// ── Historial ────────────────────────────────────────────────────────────────
export type VentaFiltro = {
  desde?: string | null;          // ISO 'YYYY-MM-DD'
  hasta?: string | null;
  texto?: string | null;          // busca por TODAS las características
  docKind?: VentaDocKind | 'todas' | null;
  condicion?: VentaCondicion | 'todas' | null;
  metodo?: MetodoPago | 'todos' | null;
  clientId?: string | null;
};

/** Todo lo buscable de una venta: código, documento, cliente, método y renglones. */
export const ventaHaystack = (v: VentaRow): string =>
  norm([
    v.code, v.doc_number, docKindLabel(v.doc_kind), v.client_name, v.client_doc,
    v.condicion === 'credito' ? 'credito' : 'contado',
    metodoLabel(v.payment_method), v.note, v.created_by_name,
    (v.items ?? []).map((it) => `${it.name} ${it.unit ?? ''}`).join(' '),
  ].filter(Boolean).join(' '));

/**
 * Filtra el historial. El rango de fechas es INCLUSIVO en los dos extremos y
 * tolera que vengan al revés (desde > hasta): se ordenan solos, porque quien
 * escribe las fechas no tiene por qué acordarse de cuál va primero.
 */
export function filtrarVentas<T extends VentaRow>(rows: T[] | null | undefined, f: VentaFiltro = {}): T[] {
  let desde = f.desde || '';
  let hasta = f.hasta || '';
  if (desde && hasta && desde > hasta) { const t = desde; desde = hasta; hasta = t; }
  const q = norm(f.texto ?? '');
  return (rows ?? []).filter((v) => {
    const d = String(v.sale_date ?? '').slice(0, 10);
    if (desde && d < desde) return false;
    if (hasta && d > hasta) return false;
    if (f.docKind && f.docKind !== 'todas' && v.doc_kind !== f.docKind) return false;
    if (f.condicion && f.condicion !== 'todas' && v.condicion !== f.condicion) return false;
    if (f.metodo && f.metodo !== 'todos' && v.payment_method !== f.metodo) return false;
    if (f.clientId && v.client_id !== f.clientId) return false;
    if (q && !ventaHaystack(v).includes(q)) return false;
    return true;
  });
}

/** Totales de un conjunto de ventas (para las tarjetas del historial). */
export function totalesVentas(rows: VentaRow[] | null | undefined) {
  const list = rows ?? [];
  let usd = 0, bs = 0, credito = 0, contado = 0;
  list.forEach((v) => {
    usd += n(v.total);
    bs += n(v.total_bs);
    if (v.condicion === 'credito') credito += n(v.total); else contado += n(v.total);
  });
  return { ventas: list.length, usd: money(usd), bs: money(bs), credito: money(credito), contado: money(contado) };
}

/** Agrupa el historial POR CLIENTE (lo que se le ha vendido a cada quien). */
export function porCliente<T extends VentaRow>(rows: T[] | null | undefined) {
  const map = new Map<string, { key: string; name: string; doc: string; ventas: T[]; usd: number; credito: number }>();
  (rows ?? []).forEach((v) => {
    const key = v.client_id ?? `sin:${norm(v.client_name)}`;
    if (!map.has(key)) map.set(key, { key, name: v.client_name, doc: v.client_doc ?? '', ventas: [], usd: 0, credito: 0 });
    const g = map.get(key)!;
    g.ventas.push(v);
    g.usd = money(g.usd + n(v.total));
    if (v.condicion === 'credito') g.credito = money(g.credito + n(v.total));
  });
  return [...map.values()].sort((a, b) => b.usd - a.usd);
}
