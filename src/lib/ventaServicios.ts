// 🧰 VENTAS DE SERVICIO — la venta atada a UNA MÁQUINA, y su histórico.
//
// Pedido del cliente, textual: «vuelve esto como ventas, pero sera ventas de
// servicios, con todo el formato pero servicio, atado a una maquina, con su
// historico, con todo».
//
// ⭐ POR QUÉ NO HAY UNA TABLA NUEVA. Una venta de servicio se guarda en `sales`,
//    la MISMA de siempre. Una segunda tabla de ventas significaría un segundo
//    correlativo de facturas (dos FAC-0001 el mismo mes), una segunda cuenta por
//    cobrar del mismo cliente y dos totales que nunca cuadran entre sí. Lo que
//    cambia es la PANTALLA: acá solo se venden servicios y cada renglón lleva su
//    máquina, y el histórico se lee por máquina en vez de por venta.
//
// ⭐ QUÉ ES «UNA VENTA DE SERVICIO». La que tiene renglones de servicio y NINGÚN
//    material. Una venta mixta (cemento + traslado) es una venta normal y se mira
//    en 💰 Ventas: partirla en dos pantallas sería contar su plata dos veces.
//
// Regla pura, sin React ni Supabase. Prueba: scripts/test-venta-servicios.mjs
import { norm, cmpText } from './text';
import { VentaRow, VentaItem, VentaCondicion, lineaTotal, money } from './ventas';

// ── Qué es un servicio y qué es una venta de servicio ───────────────────────
export const esRenglonDeServicio = (it: VentaItem | null | undefined): boolean =>
  !!it && it.kind === 'servicio';

/** Los renglones de servicio de una venta (los de material se quedan afuera). */
export const renglonesDeServicio = (v: VentaRow | null | undefined): VentaItem[] =>
  (v?.items ?? []).filter(esRenglonDeServicio);

/**
 * ¿Esta venta es una VENTA DE SERVICIO? Tiene servicios y NINGÚN material.
 *
 * ⚠️ Una venta mixta NO entra: su plata ya se cuenta en 💰 Ventas y contarla otra
 *    vez acá sería facturado inflado en un tablero y no en el otro.
 */
export function esVentaDeServicio(v: VentaRow | null | undefined): boolean {
  const items = v?.items ?? [];
  if (!items.length) return false;
  return items.every(esRenglonDeServicio);
}

export function ventasDeServicio<T extends VentaRow>(rows: T[] | null | undefined): T[] {
  return (rows ?? []).filter(esVentaDeServicio);
}

// ── La máquina de un renglón ────────────────────────────────────────────────
/**
 * Con qué se agrupa un renglón por máquina.
 *
 * ⚠️ Se prefiere el `maquina_id`, pero si no está se usa el NOMBRE: los renglones
 *    viejos —y los de una máquina que se cargó a mano— solo tienen el nombre
 *    congelado, y dejarlos fuera del histórico sería perder ventas ya hechas.
 */
export const claveMaquina = (it: VentaItem | null | undefined): string =>
  String(it?.maquina_id ?? '') || norm(it?.maquina ?? '') || '';

export const etiquetaDeMaquina = (it: VentaItem | null | undefined): string =>
  String(it?.maquina ?? '').trim() || 'Sin máquina';

/** Todo lo buscable de una venta de servicio: incluye la MÁQUINA, serial y placa. */
export const servicioHaystack = (v: VentaRow): string =>
  norm([
    v.code, v.doc_number, v.client_name, v.client_doc, v.note, v.created_by_name,
    v.condicion === 'credito' ? 'credito' : 'contado',
    ...renglonesDeServicio(v).map((it) =>
      [it.name, it.maquina, it.maquina_serial, it.maquina_placa].filter(Boolean).join(' ')),
  ].filter(Boolean).join(' '));

// ── Un renglón nuevo ────────────────────────────────────────────────────────
/** El renglón que se agrega al vender: el servicio del catálogo, sin máquina aún. */
export function renglonServicio(
  s: { id?: string | null; name?: string | null; price?: number | string | null } | null | undefined,
): VentaItem {
  const p = Number(s?.price);
  return {
    kind: 'servicio',
    item_id: null,
    service_id: s?.id ?? null,
    name: String(s?.name ?? '').trim(),
    unit: 'SERV',
    qty: 1,
    price: Number.isFinite(p) ? p : 0,
    maquina_id: null,
    maquina: null,
    maquina_serial: null,
    maquina_placa: null,
  };
}

/**
 * Revisa una venta de servicio ANTES de guardarla. Devuelve el motivo o null.
 *
 * ⭐ LA MÁQUINA ES OBLIGATORIA ACÁ. Es lo que se pidió («atado a una máquina») y es
 *    lo que hace que el histórico sirva: un renglón sin máquina no aparece en el
 *    histórico de ninguna, y un servicio de maquinaria que no dice a cuál fue es lo
 *    que después no se puede cobrar ni reclamar. Un servicio que de verdad no va
 *    contra una máquina se factura en 💰 Ventas, que no la exige.
 */
export function validarVentaServicio(datos: {
  clientId?: string | null;
  items?: VentaItem[] | null;
  condicion?: VentaCondicion | null;
}): string | null {
  const items = datos.items ?? [];
  if (!datos.clientId) return 'Elige a quién se le factura (cliente o proveedor).';
  if (!items.length) return 'Agrega al menos un servicio.';
  if (items.some((it) => !esRenglonDeServicio(it))) return 'Acá solo se venden servicios. El material se vende en 💰 Ventas.';
  const sinNombre = items.findIndex((it) => !String(it.name ?? '').trim());
  if (sinNombre >= 0) return `El renglón ${sinNombre + 1} no tiene servicio.`;
  const sinMaquina = items.findIndex((it) => !claveMaquina(it));
  if (sinMaquina >= 0) return `Falta la máquina del renglón ${sinMaquina + 1}: cada servicio va atado a una máquina.`;
  const cantidadMala = items.findIndex((it) => !(Number(it.qty) > 0));
  if (cantidadMala >= 0) return `La cantidad del renglón ${cantidadMala + 1} tiene que ser mayor que cero.`;
  const precioMalo = items.findIndex((it) => !(Number(it.price) >= 0));
  if (precioMalo >= 0) return `El precio del renglón ${precioMalo + 1} no sirve.`;
  return null;
}

// ── El histórico ────────────────────────────────────────────────────────────
export type FiltroServicio = {
  desde?: string | null;
  hasta?: string | null;
  texto?: string | null;
  /** La clave de `claveMaquina`, para ver el histórico de UNA máquina. */
  maquina?: string | null;
  clientId?: string | null;
  condicion?: VentaCondicion | 'todas' | null;
};

/**
 * Filtra el histórico de ventas de servicio. El rango es INCLUSIVO en los dos
 * extremos y tolera que vengan al revés: quien escribe las fechas no tiene por qué
 * acordarse de cuál va primero.
 */
export function filtrarVentasServicio<T extends VentaRow>(
  rows: T[] | null | undefined, f: FiltroServicio = {},
): T[] {
  let desde = f.desde || '';
  let hasta = f.hasta || '';
  if (desde && hasta && desde > hasta) { const t = desde; desde = hasta; hasta = t; }
  const q = norm(f.texto ?? '');
  return ventasDeServicio(rows).filter((v) => {
    const d = String(v.sale_date ?? '').slice(0, 10);
    if (desde && d < desde) return false;
    if (hasta && d > hasta) return false;
    if (f.clientId && v.client_id !== f.clientId) return false;
    if (f.condicion && f.condicion !== 'todas' && v.condicion !== f.condicion) return false;
    if (f.maquina && !renglonesDeServicio(v).some((it) => claveMaquina(it) === f.maquina)) return false;
    if (q && !servicioHaystack(v).includes(q)) return false;
    return true;
  });
}

/** Un renglón de servicio con la venta de la que salió (para listarlo suelto). */
export type LineaServicio = {
  venta: VentaRow;
  item: VentaItem;
  total: number;
  fecha: string;
};

export function lineasDeServicio<T extends VentaRow>(rows: T[] | null | undefined): LineaServicio[] {
  const out: LineaServicio[] = [];
  ventasDeServicio(rows).forEach((venta) => {
    renglonesDeServicio(venta).forEach((item) => {
      out.push({ venta, item, total: lineaTotal(item), fecha: String(venta.sale_date ?? '').slice(0, 10) });
    });
  });
  // Lo último arriba: el histórico se lee empezando por lo que acaba de pasar.
  return out.sort((a, b) => (b.fecha < a.fecha ? -1 : b.fecha > a.fecha ? 1 : 0));
}

/** El histórico agrupado POR MÁQUINA. */
export type GrupoMaquina = {
  clave: string;
  maquina: string;
  serial: string | null;
  placa: string | null;
  /** Cuántos renglones de servicio se le hicieron. */
  renglones: number;
  usd: number;
  /** La fecha del último servicio, 'YYYY-MM-DD'. */
  ultima: string;
  ventas: number;
};

/**
 * Cuánto se le ha facturado a cada máquina. A→Z por el nombre de la máquina, que
 * es como se busca una en una lista.
 */
export function porMaquina<T extends VentaRow>(rows: T[] | null | undefined): GrupoMaquina[] {
  const map = new Map<string, GrupoMaquina & { docs: Set<string> }>();
  lineasDeServicio(rows).forEach(({ venta, item, total, fecha }) => {
    const clave = claveMaquina(item);
    if (!map.has(clave)) {
      map.set(clave, {
        clave, maquina: etiquetaDeMaquina(item),
        serial: item.maquina_serial ?? null, placa: item.maquina_placa ?? null,
        renglones: 0, usd: 0, ultima: '', ventas: 0, docs: new Set<string>(),
      });
    }
    const g = map.get(clave)!;
    g.renglones += 1;
    g.usd = money(g.usd + total);
    if (fecha > g.ultima) g.ultima = fecha;
    // El serial y la placa pueden faltar en un renglón viejo: se toma el primero
    // que los tenga, para no dejar la ficha vacía por culpa de un renglón.
    if (!g.serial && item.maquina_serial) g.serial = item.maquina_serial;
    if (!g.placa && item.maquina_placa) g.placa = item.maquina_placa;
    if (venta.id) g.docs.add(venta.id);
  });
  return [...map.values()]
    .map(({ docs, ...g }) => ({ ...g, ventas: docs.size }))
    .sort((a, b) => cmpText(a.maquina, b.maquina));
}

/** Cuánto se ha facturado de cada TIPO de servicio. De mayor a menor. */
export type GrupoServicio = { nombre: string; renglones: number; usd: number; ultima: string };

export function porTipoDeServicio<T extends VentaRow>(rows: T[] | null | undefined): GrupoServicio[] {
  const map = new Map<string, GrupoServicio>();
  lineasDeServicio(rows).forEach(({ item, total, fecha }) => {
    const nombre = String(item.name ?? '').trim() || 'Sin nombre';
    const k = norm(nombre);
    if (!map.has(k)) map.set(k, { nombre, renglones: 0, usd: 0, ultima: '' });
    const g = map.get(k)!;
    g.renglones += 1;
    g.usd = money(g.usd + total);
    if (fecha > g.ultima) g.ultima = fecha;
  });
  // Acá sí manda la plata: la pregunta es «¿qué servicio deja más?».
  return [...map.values()].sort((a, b) => (b.usd - a.usd) || cmpText(a.nombre, b.nombre));
}

/** Los totales del histórico, para las tarjetas de arriba. */
export function totalesServicio<T extends VentaRow>(rows: T[] | null | undefined) {
  const list = ventasDeServicio(rows);
  let usd = 0, bs = 0, credito = 0, contado = 0, renglones = 0;
  const maquinas = new Set<string>();
  list.forEach((v) => {
    usd += Number(v.total) || 0;
    bs += Number(v.total_bs) || 0;
    if (v.condicion === 'credito') credito += Number(v.total) || 0;
    else contado += Number(v.total) || 0;
    renglonesDeServicio(v).forEach((it) => {
      renglones += 1;
      const k = claveMaquina(it);
      if (k) maquinas.add(k);
    });
  });
  return {
    ventas: list.length,
    renglones,
    maquinas: maquinas.size,
    usd: money(usd),
    bs: money(bs),
    credito: money(credito),
    contado: money(contado),
  };
}
