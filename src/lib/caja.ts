// ============================================================================
// CAJA — saldo, arqueo y acta de cierre.
//
// LA REGLA QUE MANDA (textual del cliente): «todo lo que entra es por ventas».
// Acá NO existe una función para crear un ingreso: los ingresos los meten los
// triggers de la base (venta de contado y cobro de una venta a crédito). Lo
// único que una persona carga a mano es un EGRESO. Ver `supabase/caja.sql`.
//
// TODO ESTE ARCHIVO ES PURO: no toca Supabase ni React, para que
// `scripts/test-caja.mjs` pueda blindar las cuentas sin base de datos. Un
// arqueo que resta mal manda a buscar un faltante que no existe.
//
// ⚠️ CADA MÉTODO DE PAGO SE ARQUEA EN SU PROPIA MONEDA, y no es un detalle
//    cosmético. El efectivo en dólares se cuenta en dólares; los bolívares, el
//    pago móvil y las transferencias se cuadran en BOLÍVARES contra el banco.
//    Sumar todo en $ obligaría a convertir el conteo con la tasa del día y una
//    diferencia de dos bolívares aparecería como un faltante de centavos que
//    nadie puede rastrear.
// ============================================================================
import { MetodoPago, METODOS_PAGO, metodoLabel } from './ventas';

const n = (v: any): number => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return 0;
  const x = Number(s);
  return isFinite(x) ? x : 0;
};

/** Redondeo a céntimos. Sin esto, 0.1 + 0.2 sale impreso como 0.30000000000000004. */
export const money = (v: any): number => Math.round((n(v) + Number.EPSILON) * 100) / 100;

export const fmtUsd = (v: any): string =>
  `$${money(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtBs = (v: any): string =>
  `Bs ${money(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** AAAA-MM-DD → DD/MM/AAAA. Sin `new Date()`: una fecha suelta no tiene zona
 *  horaria y construir un Date la corre un día en Venezuela (UTC-4). */
export const dmy = (iso?: string | null): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '').trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};

// ── EL VOCABULARIO ──────────────────────────────────────────────────────────

export type TipoMov = 'ingreso' | 'egreso';
export type OrigenMov = 'venta' | 'cobranza' | 'manual';

export const ORIGEN_LABEL: Record<OrigenMov, string> = {
  venta: 'Venta de contado',
  cobranza: 'Cobro de venta a crédito',
  manual: 'Egreso',
};

/**
 * La moneda REAL de cada método de pago — la que se cuenta en el arqueo.
 *
 * El sistema guarda todo en $ (con su equivalente en Bs congelado), pero un
 * pago móvil no se cuenta en dólares: se cuadra en bolívares contra el banco.
 */
export const MONEDA_METODO: Record<MetodoPago, 'usd' | 'bs'> = {
  efectivo_usd: 'usd',
  zelle: 'usd',
  usdt: 'usd',
  bs: 'bs',
  transferencia: 'bs',
  pago_movil: 'bs',
};

/** ¿Este método está físicamente en la gaveta? Solo el efectivo se cuenta a
 *  mano; lo demás se concilia contra el banco o la cuenta. */
export const esEfectivo = (m?: MetodoPago | null): boolean =>
  m === 'efectivo_usd' || m === 'bs';

export type MovimientoRow = {
  id?: string;
  tipo: TipoMov;
  origen: OrigenMov;
  fecha?: string | null;
  concepto?: string | null;
  categoria?: string | null;
  metodo: MetodoPago;
  /** Siempre en $. */
  monto?: number | null;
  /** Equivalente en Bs, congelado con la tasa del momento. */
  monto_bs?: number | null;
  rate_bs?: number | null;
  sale_id?: string | null;
  abono_id?: string | null;
  nota?: string | null;
  sesion_id?: string | null;
  created_at?: string | null;
};

export type SesionRow = {
  id?: string;
  code?: string | null;
  opened_at?: string | null;
  opened_by_name?: string | null;
  apertura_usd?: number | null;
  apertura_bs?: number | null;
  closed_at?: string | null;
  closed_by_name?: string | null;
  conteo?: Partial<Record<MetodoPago, number>> | null;
  rate_bs?: number | null;
  estado?: 'abierta' | 'cerrada' | string | null;
  nota?: string | null;
};

// ── LAS CUENTAS ─────────────────────────────────────────────────────────────

/** El monto de un movimiento EN SU PROPIA MONEDA (la del método). */
export function montoNativo(m: MovimientoRow | null | undefined): number {
  if (!m) return 0;
  return MONEDA_METODO[m.metodo] === 'bs' ? money(m.monto_bs) : money(m.monto);
}

export type TotalMetodo = {
  metodo: MetodoPago;
  moneda: 'usd' | 'bs';
  ingresos: number;   // en la moneda del método
  egresos: number;
  neto: number;
  /** Los mismos números en $, para el gran total del acta. */
  ingresosUsd: number;
  egresosUsd: number;
};

/** Lo que entró y salió por cada método. Devuelve SIEMPRE los seis métodos, en
 *  el orden del catálogo: un método en cero también es información (dice que
 *  ese día no entró nada por ahí), y un acta con filas que aparecen y
 *  desaparecen es más difícil de comparar contra la del día anterior. */
export function totalesPorMetodo(movs?: MovimientoRow[] | null): TotalMetodo[] {
  return METODOS_PAGO.map(({ key }) => {
    const xs = (movs ?? []).filter((m) => m?.metodo === key);
    const suma = (t: TipoMov, f: (m: MovimientoRow) => number) =>
      money(xs.filter((m) => m.tipo === t).reduce((s, m) => s + f(m), 0));
    const ingresos = suma('ingreso', montoNativo);
    const egresos = suma('egreso', montoNativo);
    return {
      metodo: key,
      moneda: MONEDA_METODO[key],
      ingresos,
      egresos,
      neto: money(ingresos - egresos),
      ingresosUsd: suma('ingreso', (m) => money(m.monto)),
      egresosUsd: suma('egreso', (m) => money(m.monto)),
    };
  });
}

export type Esperado = TotalMetodo & {
  /** Fondo de caja con el que se abrió (solo efectivo). */
  apertura: number;
  /** apertura + ingresos − egresos, en la moneda del método. */
  esperado: number;
};

/**
 * Lo que DEBERÍA haber por cada método al cerrar.
 *
 * El fondo de apertura solo suma al EFECTIVO: una caja no se abre con un saldo
 * de Zelle ni de transferencias — eso vive en el banco, no en la gaveta.
 */
export function esperadoDe(sesion: SesionRow | null | undefined, movs?: MovimientoRow[] | null): Esperado[] {
  return totalesPorMetodo(movs).map((t) => {
    const apertura = t.metodo === 'efectivo_usd' ? money(sesion?.apertura_usd)
      : t.metodo === 'bs' ? money(sesion?.apertura_bs)
      : 0;
    return { ...t, apertura, esperado: money(apertura + t.ingresos - t.egresos) };
  });
}

export type LineaArqueo = Esperado & {
  contado: number;
  /** contado − esperado. Positivo = SOBRA, negativo = FALTA. */
  diferencia: number;
  /** ¿Se contó de verdad, o el campo quedó vacío? Un método sin contar no es
   *  un faltante: es un dato que falta, y se dice distinto. */
  seConto: boolean;
};

/**
 * El arqueo: lo esperado contra lo contado, método por método.
 *
 * ⚠️ UN MÉTODO SIN CONTAR NO ES UN FALTANTE. Si el campo se deja vacío,
 *    `seConto` es false y la diferencia se informa en cero — no se inventa un
 *    descuadre de todo lo que entró por ahí. Contar CERO sí es contar, y por
 *    eso el 0 explícito se distingue del vacío.
 */
export function arqueoDe(
  sesion: SesionRow | null | undefined,
  movs?: MovimientoRow[] | null,
  conteo?: Partial<Record<MetodoPago, number | string | null>> | null
): LineaArqueo[] {
  const c = conteo ?? {};
  return esperadoDe(sesion, movs).map((e) => {
    const crudo = (c as any)[e.metodo];
    const seConto = crudo !== undefined && crudo !== null && String(crudo).trim() !== '';
    const contado = seConto ? money(crudo) : 0;
    return { ...e, contado, seConto, diferencia: seConto ? money(contado - e.esperado) : 0 };
  });
}

export type ResumenCaja = {
  ingresos: number;      // en $
  egresos: number;       // en $
  saldo: number;         // ingresos − egresos, en $
  ingresosBs: number;
  egresosBs: number;
  saldoBs: number;
  movimientos: number;
  /** Cuántos entraron por venta de contado y cuántos por cobranza. */
  porVenta: number;
  porCobranza: number;
};

/** El resumen en $ y en Bs. El saldo NO incluye el fondo de apertura: es lo que
 *  se MOVIÓ, que es lo que se compara contra las ventas del día. El fondo sale
 *  aparte en el arqueo, donde sí hace falta. */
export function resumenCaja(movs?: MovimientoRow[] | null): ResumenCaja {
  const xs = movs ?? [];
  const suma = (t: TipoMov, f: (m: MovimientoRow) => number) =>
    money(xs.filter((m) => m?.tipo === t).reduce((s, m) => s + f(m), 0));
  const ingresos = suma('ingreso', (m) => money(m.monto));
  const egresos = suma('egreso', (m) => money(m.monto));
  const ingresosBs = suma('ingreso', (m) => money(m.monto_bs));
  const egresosBs = suma('egreso', (m) => money(m.monto_bs));
  return {
    ingresos, egresos, saldo: money(ingresos - egresos),
    ingresosBs, egresosBs, saldoBs: money(ingresosBs - egresosBs),
    movimientos: xs.length,
    porVenta: xs.filter((m) => m?.origen === 'venta').length,
    porCobranza: xs.filter((m) => m?.origen === 'cobranza').length,
  };
}

/** Lo gastado por categoría, de mayor a menor. Solo egresos: las categorías no
 *  aplican a los ingresos, que siempre vienen de una venta. */
export function porCategoria(movs?: MovimientoRow[] | null): { categoria: string; usd: number; veces: number }[] {
  const mapa = new Map<string, { categoria: string; usd: number; veces: number }>();
  (movs ?? []).filter((m) => m?.tipo === 'egreso').forEach((m) => {
    const k = String(m.categoria ?? '').trim() || 'Sin categoría';
    const g = mapa.get(k) ?? { categoria: k, usd: 0, veces: 0 };
    g.usd = money(g.usd + money(m.monto));
    g.veces += 1;
    mapa.set(k, g);
  });
  return Array.from(mapa.values()).sort((a, b) => b.usd - a.usd);
}

// ── FILTROS DEL HISTORIAL ───────────────────────────────────────────────────

export type FiltroCaja = {
  desde?: string | null;
  hasta?: string | null;
  tipo?: TipoMov | '' | null;
  metodo?: MetodoPago | '' | null;
  origen?: OrigenMov | '' | null;
  texto?: string | null;
};

export const movHaystack = (m: MovimientoRow): string =>
  [m.concepto, m.categoria, m.nota, metodoLabel(m.metodo), ORIGEN_LABEL[m.origen], m.fecha, dmy(m.fecha)]
    .filter(Boolean).join(' ').toLowerCase();

/** Filtra por fechas (ambos extremos INCLUIDOS, tolerante a un rango al revés)
 *  y por todas las características. */
export function filtrarMovs<T extends MovimientoRow>(rows?: T[] | null, f: FiltroCaja = {}): T[] {
  const d = String(f.desde ?? '').slice(0, 10);
  const h = String(f.hasta ?? '').slice(0, 10);
  const lo = d && h && d > h ? h : d;
  const hi = d && h && d > h ? d : h;
  const t = String(f.texto ?? '').trim().toLowerCase();
  return (rows ?? []).filter((m) => {
    if (!m) return false;
    const fecha = String(m.fecha ?? '').slice(0, 10);
    if (lo && (!fecha || fecha < lo)) return false;
    if (hi && (!fecha || fecha > hi)) return false;
    if (f.tipo && m.tipo !== f.tipo) return false;
    if (f.metodo && m.metodo !== f.metodo) return false;
    if (f.origen && m.origen !== f.origen) return false;
    if (t && !movHaystack(m).includes(t)) return false;
    return true;
  });
}

// ── VALIDACIÓN DEL EGRESO ───────────────────────────────────────────────────

export type EgresoInput = {
  concepto?: string | null;
  categoria?: string | null;
  metodo?: MetodoPago | null;
  monto?: number | string | null;
  fecha?: string | null;
  nota?: string | null;
};

/** Devuelve el problema en cristiano, o null si el egreso está bien. */
export function validarEgreso(e: EgresoInput | null | undefined): string | null {
  if (!String(e?.concepto ?? '').trim()) return 'Escribe en qué se gastó.';
  if (!e?.metodo || !METODOS_PAGO.some((m) => m.key === e.metodo)) return 'Elige con qué se pagó.';
  const monto = n(e?.monto);
  if (monto <= 0) return 'El monto tiene que ser mayor que cero.';
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(e?.fecha ?? ''))) return 'Selecciona la fecha.';
  return null;
}

/** La fila lista para `caja_movimientos`. PURA: no escribe nada.
 *
 *  ⚠️ `tipo` va FIJO en 'egreso' y `origen` en 'manual'. No es un parámetro y no
 *     debe serlo: es la regla del cliente («todo lo que entra es por ventas»)
 *     escrita también de este lado. La base la vuelve a exigir con un CHECK y
 *     con la política de RLS. */
export function filaEgreso(e: EgresoInput, tasa?: number | null, createdBy?: string | null): Record<string, any> {
  const monto = money(e.monto);
  const rate = money(tasa);
  return {
    tipo: 'egreso',
    origen: 'manual',
    fecha: String(e.fecha ?? '').slice(0, 10),
    concepto: String(e.concepto ?? '').trim(),
    categoria: String(e.categoria ?? '').trim() || null,
    metodo: e.metodo,
    monto,
    rate_bs: rate,
    monto_bs: money(monto * rate),
    nota: String(e.nota ?? '').trim() || null,
    created_by: createdBy ?? null,
  };
}

// ── EL ACTA DE CIERRE ───────────────────────────────────────────────────────

const esc = (v: any): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NAVY = '#16324F';

const fechaHora = (ts?: string | null): string => {
  const s = String(ts ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '—';
};

export type ActaData = {
  sesion: SesionRow;
  movimientos: MovimientoRow[];
  conteo?: Partial<Record<MetodoPago, number | string | null>> | null;
  empresa?: string | null;
  /** ¿Se imprime el detalle movimiento por movimiento? Con cientos de ventas el
   *  acta se vuelve un libro; el resumen por método es lo que se firma. */
  conDetalle?: boolean;
};

/** HTML imprimible del ACTA DE CIERRE DE CAJA, listo para `exportPdf`. */
export function actaCierreHtml(d: ActaData): string {
  const s = d.sesion ?? {};
  const lineas = arqueoDe(s, d.movimientos, d.conteo ?? s.conteo);
  const r = resumenCaja(d.movimientos);
  const cats = porCategoria(d.movimientos);

  const fmt = (moneda: 'usd' | 'bs', v: number) => (moneda === 'bs' ? fmtBs(v) : fmtUsd(v));

  const filasArqueo = lineas.map((l) => {
    const sinContar = !l.seConto;
    const signo = l.diferencia > 0 ? 'sobra' : l.diferencia < 0 ? 'falta' : '';
    const clase = sinContar ? 'mut' : l.diferencia === 0 ? 'ok' : l.diferencia > 0 ? 'sobra' : 'falta';
    return `<tr>
      <td>${esc(metodoLabel(l.metodo))}<div class="sub">${l.moneda === 'bs' ? 'se cuadra en bolívares' : 'se cuadra en dólares'}${esEfectivo(l.metodo) ? ' · efectivo' : ''}</div></td>
      <td class="r">${l.apertura ? fmt(l.moneda, l.apertura) : '—'}</td>
      <td class="r">${fmt(l.moneda, l.ingresos)}</td>
      <td class="r">${l.egresos ? `−${fmt(l.moneda, l.egresos)}` : '—'}</td>
      <td class="r b">${fmt(l.moneda, l.esperado)}</td>
      <td class="r">${sinContar ? '<span class="mut">sin contar</span>' : fmt(l.moneda, l.contado)}</td>
      <td class="r b ${clase}">${sinContar ? '—' : `${fmt(l.moneda, Math.abs(l.diferencia))}${signo ? ` <span class="sg">${signo}</span>` : ''}`}</td>
    </tr>`;
  }).join('');

  const detalle = !d.conDetalle ? '' : `
    <h2>Detalle de movimientos</h2>
    <table class="det"><thead><tr>
      <th style="width:58px">Fecha</th><th>Concepto</th><th style="width:104px">Método</th>
      <th class="r" style="width:80px">Entra</th><th class="r" style="width:80px">Sale</th>
    </tr></thead><tbody>
    ${(d.movimientos ?? []).map((m) => `<tr>
      <td class="nw">${esc(dmy(m.fecha))}</td>
      <td>${esc(m.concepto)}${m.categoria ? `<div class="sub">${esc(m.categoria)}</div>` : ''}</td>
      <td>${esc(metodoLabel(m.metodo))}</td>
      <td class="r">${m.tipo === 'ingreso' ? fmtUsd(m.monto) : '—'}</td>
      <td class="r">${m.tipo === 'egreso' ? fmtUsd(m.monto) : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="c mut">Sin movimientos.</td></tr>'}
    </tbody></table>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title></title><style>
  @page{size:letter;margin:13mm 12mm}
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#1a1c20;margin:0;font-size:11.5px;line-height:1.45}

  .hd{background:${NAVY};color:#fff;padding:13px 15px;border-radius:6px}
  .hd .co{font-size:10.5px;font-weight:800;letter-spacing:1.1px;color:#AFC4DB;text-transform:uppercase}
  .hd h1{margin:5px 0 0;font-size:19px;font-weight:900}
  .hd .cd{margin-top:5px;font-size:12px;font-weight:800;color:#DCE7F3}

  .meta{display:flex;flex-wrap:wrap;margin-top:11px;border:1px solid #E2E8F0;border-radius:6px;background:#F8FAFC;overflow:hidden}
  .meta div{width:50%;padding:6px 11px;font-size:11px;border-bottom:1px solid #EDF2F7}
  .meta b{color:${NAVY}}

  h2{font-size:12.5px;color:${NAVY};margin:16px 0 5px;border-bottom:2px solid ${NAVY};padding-bottom:4px;
    text-transform:uppercase;letter-spacing:.3px;page-break-after:avoid}

  table{border-collapse:collapse;width:100%}
  th{background:${NAVY};color:#fff;padding:6px 7px;text-align:left;font-size:10px;
    text-transform:uppercase;letter-spacing:.3px}
  td{border-bottom:1px solid #E2E8F0;padding:6px 7px;vertical-align:top;font-size:11px}
  tr:nth-child(even) td{background:#F8FAFC}
  .r{text-align:right;font-variant-numeric:tabular-nums}
  .c{text-align:center}.b{font-weight:800}.nw{white-space:nowrap}
  .mut{color:#94A3B8}
  .sub{font-size:9.5px;color:#64748B;margin-top:1px}
  .sg{font-size:9px;text-transform:uppercase;letter-spacing:.4px}
  .ok{color:#166534}.sobra{color:#B45309}.falta{color:#B91C1C}

  table.res{margin-top:4px}
  table.res td{font-size:12px;padding:7px 10px}
  table.res td.v{text-align:right;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
  table.res tr.grand td{background:#EAF1FB;color:${NAVY};font-weight:900;font-size:13.5px}

  table.det td{font-size:10.5px;padding:5px 7px}

  .nota{margin-top:9px;font-size:11px;color:#475569;border-left:3px solid #CBD5E1;padding-left:9px}
  .regla{margin-top:9px;font-size:10px;color:#64748B;font-style:italic}

  .firmas{display:flex;gap:46px;margin-top:40px;page-break-inside:avoid}
  .firma{flex:1;text-align:center}
  .firma .line{border-top:1px solid #334155;margin-bottom:5px}
  .firma .n{font-weight:800;font-size:11.5px;color:${NAVY}}
  .firma .c2{font-size:10.5px;color:#475569}
  </style></head><body>

  <div class="hd">
    <div class="co">${esc(d.empresa ?? '')}</div>
    <h1>Acta de cierre de caja</h1>
    <div class="cd">${esc(s.code ?? '')}</div>
  </div>

  <div class="meta">
    <div><b>Apertura:</b> ${esc(fechaHora(s.opened_at))}</div>
    <div><b>Abrió:</b> ${esc(s.opened_by_name || '—')}</div>
    <div><b>Cierre:</b> ${esc(fechaHora(s.closed_at))}</div>
    <div><b>Cerró:</b> ${esc(s.closed_by_name || '—')}</div>
    <div><b>Fondo de apertura:</b> ${esc(fmtUsd(s.apertura_usd))}${money(s.apertura_bs) ? ` · ${esc(fmtBs(s.apertura_bs))}` : ''}</div>
    <div><b>Tasa BCV del cierre:</b> ${money(s.rate_bs) > 0 ? esc(`${fmtBs(s.rate_bs)} / $`) : 'sin registrar'}</div>
  </div>

  <h2>Arqueo por método de pago</h2>
  <table><thead><tr>
    <th>Método</th>
    <th class="r" style="width:74px">Apertura</th>
    <th class="r" style="width:80px">Entró</th>
    <th class="r" style="width:74px">Salió</th>
    <th class="r" style="width:84px">Esperado</th>
    <th class="r" style="width:84px">Contado</th>
    <th class="r" style="width:96px">Diferencia</th>
  </tr></thead><tbody>${filasArqueo}</tbody></table>
  <div class="regla">Cada método se cuadra en su propia moneda: el efectivo en dólares se cuenta en dólares; bolívares, pago móvil y transferencias se cuadran en bolívares contra el banco.</div>

  <h2>Resumen del movimiento</h2>
  <table class="res"><tbody>
    <tr><td>Entró (${r.porVenta} ${r.porVenta === 1 ? 'venta de contado' : 'ventas de contado'} · ${r.porCobranza} ${r.porCobranza === 1 ? 'cobro' : 'cobros'})</td><td class="v">${esc(fmtUsd(r.ingresos))}</td></tr>
    <tr><td>Salió (egresos)</td><td class="v">${r.egresos ? `−${esc(fmtUsd(r.egresos))}` : '—'}</td></tr>
    <tr class="grand"><td>SALDO DEL MOVIMIENTO</td><td class="v">${esc(fmtUsd(r.saldo))}</td></tr>
    <tr><td>Equivalente en bolívares</td><td class="v">${esc(fmtBs(r.saldoBs))}</td></tr>
  </tbody></table>
  <div class="regla">Todo lo que entra a esta caja viene de Ventas: contado el día de la venta, y crédito el día que se cobra el abono. No se puede registrar un ingreso a mano.</div>

  ${cats.length ? `<h2>Egresos por categoría</h2>
    <table><thead><tr><th>Categoría</th><th class="r" style="width:70px">Veces</th><th class="r" style="width:96px">Monto</th></tr></thead>
    <tbody>${cats.map((c) => `<tr><td>${esc(c.categoria)}</td><td class="r">${c.veces}</td><td class="r b">${esc(fmtUsd(c.usd))}</td></tr>`).join('')}</tbody></table>` : ''}

  ${detalle}

  ${s.nota ? `<div class="nota">${esc(s.nota)}</div>` : ''}

  <div class="firmas">
    <div class="firma"><div class="line"></div><div class="n">${esc(s.closed_by_name || '')}</div><div class="c2">Cerró la caja</div></div>
    <div class="firma"><div class="line"></div><div class="n"></div><div class="c2">Recibido conforme (nombre, C.I. y firma)</div></div>
  </div>
  </body></html>`;
}
