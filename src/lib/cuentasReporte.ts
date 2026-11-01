// 📄 REPORTE DE CUENTAS POR PAGAR / POR COBRAR (28-oct-2026).
//
// Pedido del cliente, textual: «necesito poder sacar un reporte de los que yo
// selecciono o de todos, o lo que yo agrupe».
//
// ⭐ ESTE ARCHIVO NO TOCA LA BASE NI LA PANTALLA: elige las cuentas (marcadas o
//    todas las de la lista), las agrupa, saca subtotales y total, y arma el
//    cuerpo HTML y el nombre del archivo. El membrete (logos) lo pone
//    `pdfDocument` en la pantalla. Probado en `scripts/test-cuentas-reporte.mjs`.
//
// ── REGLAS DE LA CASA QUE APLICA ──────────────────────────────────────────────
// ⚠️ LAS OPCIONES NO SE ANUNCIAN EN EL PAPEL: agrupación, columnas apagadas y
//    alcance van al NOMBRE del archivo. Lo apagado no deja rastro (ni columna,
//    ni tarjeta del resumen, ni celda de total).
// ⭐ EXCEPCIÓN: si el papel es un SUBCONJUNTO (marcadas, o la lista con filtros
//    de empresa/búsqueda), el subtítulo dice «FILTRADO»: son papeles de pago y
//    el filtro mueve plata.
// ⭐ MONTOS EN US$: `cuentas.monto` es US$. El Bs es un EQUIVALENTE con la tasa
//    BCV de hoy, y el papel dice qué tasa se usó. Sin tasa no sale ningún Bs.
// ⭐ QUÉ SUMA: una cuenta ANULADA se lista pero no suma en nada (en la pantalla
//    «deja de sumar en los totales»). Una PAGADA suma su monto y sus abonos, y
//    su saldo cuenta como 0 aunque la hayan marcado pagada sin abonos: ya no se
//    debe. Así subtotales y total general cuadran siempre entre sí.

function extraerCondicionesDeNotaInterna(nota?: string | null): string {
  if (!nota) return '';
  const m = String(nota).match(/\[CONDICIONES_PAGO:\s*([^\]]*)\]/i);
  return m && m[1] ? m[1].trim() : '';
}

function limpiarNotaInterna(nota?: string | null): string {
  if (!nota) return '';
  return String(nota)
    .replace(/\[RECIBO_PAGO:[^\]]+\]/gi, '')
    .replace(/\[FACTURA_CUENTA:[^\]]+\]/gi, '')
    .replace(/\[APROBADO_CXP:[^\]]*\]/gi, '')
    .replace(/\[ENVIADO_CXP:[^\]]*\]/gi, '')
    .replace(/\[\[HISTORIAL_COMPRA:[\s\S]*?:FIN_HISTORIAL\]\]/gi, '')
    .replace(/\[\[FORMATOS_ADJUNTOS:[\s\S]*?:FIN_FORMATOS\]\]/gi, '')
    .replace(/\[\[COTIZACIONES_COMPLETAS:[\s\S]*?:FIN_COTIZACIONES\]\]/gi, '')
    .replace(/\[PRESUPUESTO_CUENTA:[^\]]*\]/gi, '')
    .replace(/\[IVA_CUENTA:[^\]]*\]/gi, '')
    .replace(/\[COMPROBANTE_ABONO:[^\]]+\]/gi, '')
    .replace(/\[EMPRESA:[^\]]+\]/gi, '')
    .replace(/\[CONDICIONES_PAGO:[^\]]*\]/gi, '')
    .replace(/Generada automáticamente desde Requerimiento REQ-\d+\. El monto se sincroniza con los ítems aprobados\.?/gi, '')
    .trim();
}

export type TipoCuentaReporte = 'por_pagar' | 'por_cobrar';
export type SituacionCuentaReporte = 'pagada' | 'anulada' | 'vencida' | 'por_vencer' | 'pendiente';

/** Lo que el reporte necesita de cada cuenta. Los nombres son los de
 *  `CuentaCalc` en CuentasScreen, así la pantalla la pasa tal cual. */
export type CuentaParaReporte = {
  id: string;
  contraparte: string;
  empresaNombre: string;
  concepto: string;
  documento: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  monto: number;
  abonado: number;
  saldo: number;
  situacion: SituacionCuentaReporte;
  condicionesPago?: string | null;
  notaLimpia?: string | null;
  nota?: string | null;
};

export type AlcanceCuentas = 'marcadas' | 'todas';
export type AgruparCuentas = 'ninguno' | 'contraparte' | 'empresa' | 'estado' | 'vencimiento' | 'mes';

export type ColumnaCuenta =
  | 'contraparte' | 'empresa' | 'concepto' | 'documento' | 'condiciones' | 'nota' | 'emision' | 'vence'
  | 'estado' | 'monto' | 'abonado' | 'saldo' | 'bs';

export type OpcionesReporteCuentas = {
  alcance: AlcanceCuentas;
  agrupar: AgruparCuentas;
  columnas: Record<ColumnaCuenta, boolean>;
  /** ✏️ Título propio. Vacío = «Cuentas por pagar» / «Cuentas por cobrar». */
  titulo: string;
  /** 📝 Marca institucional de texto del membrete (como en los otros reportes). */
  verMarcaTexto: boolean;
  /** 📅 Línea «Emitida: …» del membrete. */
  verFechaEmision: boolean;
};

export const COLUMNAS_POR_DEFECTO: Record<ColumnaCuenta, boolean> = {
  contraparte: true, empresa: true, concepto: true, documento: true, condiciones: true, nota: true, emision: true, vence: true,
  estado: true, monto: true, abonado: true, saldo: true, bs: true,
};

export const OPCIONES_CUENTAS_POR_DEFECTO: OpcionesReporteCuentas = {
  alcance: 'todas',
  agrupar: 'ninguno',
  columnas: { ...COLUMNAS_POR_DEFECTO },
  titulo: '',
  verMarcaTexto: false,
  verFechaEmision: true,
};

/** Columnas de dinero: van juntas al final de la tabla, para que las filas de
 *  subtotal/total pongan su etiqueta en una sola celda a la izquierda. */
const COLS_DINERO: ColumnaCuenta[] = ['monto', 'abonado', 'saldo', 'bs'];

/** Etiqueta de la contraparte según el lado del dinero. */
export const contraparteLabel = (tipo: TipoCuentaReporte) => (tipo === 'por_pagar' ? 'Proveedor' : 'Cliente');

/** Las columnas en el orden del papel, con su etiqueta (la pantalla las usa para los interruptores). */
export function columnasCuentas(tipo: TipoCuentaReporte): [ColumnaCuenta, string][] {
  return [
    ['contraparte', contraparteLabel(tipo)],
    ['empresa', 'Empresa'],
    ['concepto', 'Concepto'],
    ['documento', 'Documento'],
    ['condiciones', 'Condiciones de pago'],
    ['nota', 'Nota'],
    ['emision', 'Emisión'],
    ['vence', 'Vence'],
    ['estado', 'Estado'],
    ['monto', 'Monto (US$)'],
    ['abonado', 'Abonado (US$)'],
    ['saldo', 'Saldo (US$)'],
    ['bs', 'Saldo ≈ Bs'],
  ];
}

export function agrupacionesCuentas(tipo: TipoCuentaReporte): [AgruparCuentas, string][] {
  return [
    ['ninguno', 'Sin agrupar'],
    ['contraparte', contraparteLabel(tipo)],
    ['empresa', 'Empresa'],
    ['estado', 'Estado'],
    ['vencimiento', 'Vencimiento'],
    ['mes', 'Mes de emisión'],
  ];
}

// ── Elegir las cuentas ────────────────────────────────────────────────────────

/**
 * «Las que marqué» o «Todas las de la lista».
 * - `lista`: lo que se ve ahora (respeta empresa(s), búsqueda y pagadas visibles).
 * - `todas`: TODAS las cuentas de la pestaña, ya ordenadas. Las marcadas salen de
 *   aquí porque la marca SOBREVIVE a filtrar: una marcada que el filtro de ahora
 *   esconde sigue entrando.
 */
export function elegirCuentas<T extends { id: string }>(
  lista: T[], todas: T[], marcadas: ReadonlySet<string>, alcance: AlcanceCuentas,
): T[] {
  if (alcance === 'todas') return lista.slice();
  return todas.filter((c) => marcadas.has(c.id));
}

/** ¿El papel es un SUBCONJUNTO del universo (la lista sin filtros de empresa ni
 *  búsqueda)? Entonces lleva «FILTRADO». Si elige justo todo, no lo es. */
export function reporteEsFiltrado(elegidas: { id: string }[], universo: { id: string }[]): boolean {
  const u = new Set(universo.map((c) => c.id));
  const e = new Set(elegidas.map((c) => c.id));
  if (u.size !== e.size) return true;
  for (const id of e) if (!u.has(id)) return true;
  return false;
}

// ── Sumas ─────────────────────────────────────────────────────────────────────

export type TotalesCuentas = { cantidad: number; anuladas: number; monto: number; abonado: number; saldo: number };

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Lo que una cuenta aporta a los totales (ver «QUÉ SUMA» arriba). */
export function aporteDe(c: CuentaParaReporte): { monto: number; abonado: number; saldo: number } {
  if (c.situacion === 'anulada') return { monto: 0, abonado: 0, saldo: 0 };
  return {
    monto: Number(c.monto) || 0,
    abonado: Number(c.abonado) || 0,
    saldo: c.situacion === 'pagada' ? 0 : Number(c.saldo) || 0,
  };
}

export function totalesDe(cuentas: CuentaParaReporte[]): TotalesCuentas {
  const t = { cantidad: cuentas.length, anuladas: 0, monto: 0, abonado: 0, saldo: 0 };
  for (const c of cuentas) {
    if (c.situacion === 'anulada') t.anuladas += 1;
    const a = aporteDe(c);
    t.monto += a.monto; t.abonado += a.abonado; t.saldo += a.saldo;
  }
  return { ...t, monto: r2(t.monto), abonado: r2(t.abonado), saldo: r2(t.saldo) };
}

// ── Agrupar ───────────────────────────────────────────────────────────────────

export type GrupoCuentas = { clave: string; etiqueta: string; cuentas: CuentaParaReporte[]; totales: TotalesCuentas };

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const ESTADO_TEXTO: Record<SituacionCuentaReporte, string> = {
  vencida: 'Vencida', por_vencer: 'Por vencer', pendiente: 'Pendiente', pagada: 'Pagada', anulada: 'Anulada',
};
const ESTADO_GRUPO: Record<SituacionCuentaReporte, [number, string]> = {
  vencida: [0, 'Vencidas'], por_vencer: [1, 'Por vencer (próximos 7 días)'], pendiente: [2, 'Pendientes'],
  pagada: [3, 'Pagadas'], anulada: [4, 'Anuladas'],
};

export type TramoVencimiento = 'vencidas' | 'por_vencer' | 'al_dia' | 'sin_fecha' | 'cerradas';
const TRAMO: Record<TramoVencimiento, [number, string]> = {
  vencidas: [0, 'Vencidas'],
  por_vencer: [1, 'Por vencer (próximos 7 días)'],
  al_dia: [2, 'Al día'],
  sin_fecha: [3, 'Sin fecha de vencimiento'],
  cerradas: [4, 'Pagadas o anuladas'],
};

/** Tramo de vencimiento. La situación ya viene calculada contra HOY en la
 *  pantalla (misma ventana de 7 días); una pagada/anulada ya no vence. */
export function tramoVencimiento(c: CuentaParaReporte): TramoVencimiento {
  if (c.situacion === 'pagada' || c.situacion === 'anulada') return 'cerradas';
  if (c.situacion === 'vencida') return 'vencidas';
  if (c.situacion === 'por_vencer') return 'por_vencer';
  return c.fecha_vencimiento ? 'al_dia' : 'sin_fecha';
}

const cmpTexto = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
const limpio = (s: string | null | undefined) => String(s ?? '').trim();

/** Clave, etiqueta y orden de la cuenta en la agrupación pedida. `orden` numérico
 *  manda; si empata, el texto de la etiqueta. */
function grupoDe(c: CuentaParaReporte, agrupar: AgruparCuentas, tipo: TipoCuentaReporte): { clave: string; etiqueta: string; orden: number } {
  switch (agrupar) {
    case 'contraparte': {
      const n = limpio(c.contraparte);
      const vacio = !n || n === '—';
      return vacio
        ? { clave: '~sin', etiqueta: `Sin ${contraparteLabel(tipo).toLowerCase()}`, orden: 1 }
        : { clave: n.toLocaleLowerCase('es'), etiqueta: n, orden: 0 };
    }
    case 'empresa': {
      const n = limpio(c.empresaNombre);
      return n ? { clave: n.toLocaleLowerCase('es'), etiqueta: n, orden: 0 } : { clave: '~sin', etiqueta: 'Sin empresa', orden: 1 };
    }
    case 'estado': {
      const [orden, etiqueta] = ESTADO_GRUPO[c.situacion];
      return { clave: c.situacion, etiqueta, orden };
    }
    case 'vencimiento': {
      const t = tramoVencimiento(c);
      const [orden, etiqueta] = TRAMO[t];
      return { clave: t, etiqueta, orden };
    }
    case 'mes': {
      const f = limpio(c.fecha_emision);
      const m = /^(\d{4})-(\d{2})/.exec(f);
      if (!m) return { clave: '~sin', etiqueta: 'Sin fecha de emisión', orden: 999999 };
      const mes = Number(m[2]);
      // Del más viejo al más nuevo: AAAA·12 + MM.
      return { clave: `${m[1]}-${m[2]}`, etiqueta: `${MESES[mes - 1] ?? m[2]} ${m[1]}`, orden: Number(m[1]) * 12 + mes };
    }
    default:
      return { clave: '', etiqueta: '', orden: 0 };
  }
}

/**
 * Parte las cuentas en grupos con su subtotal. Dentro de cada grupo se
 * conserva el orden en que llegaron (el de la pantalla: lo más urgente arriba).
 * «Sin agrupar» = un único grupo sin etiqueta.
 */
export function agruparCuentas(cuentas: CuentaParaReporte[], agrupar: AgruparCuentas, tipo: TipoCuentaReporte): GrupoCuentas[] {
  if (agrupar === 'ninguno') return [{ clave: '', etiqueta: '', cuentas: cuentas.slice(), totales: totalesDe(cuentas) }];
  const m = new Map<string, { clave: string; etiqueta: string; orden: number; cuentas: CuentaParaReporte[] }>();
  for (const c of cuentas) {
    const g = grupoDe(c, agrupar, tipo);
    const e = m.get(g.clave);
    if (e) e.cuentas.push(c);
    else m.set(g.clave, { ...g, cuentas: [c] });
  }
  return Array.from(m.values())
    .sort((a, b) => a.orden - b.orden || cmpTexto(a.etiqueta, b.etiqueta))
    .map((g) => ({ clave: g.clave, etiqueta: g.etiqueta, cuentas: g.cuentas, totales: totalesDe(g.cuentas) }));
}

// ── Formatos del papel (fijos, sin depender del idioma del navegador) ────────

function miles(n: number, dec = 2): string {
  const v = Math.round(Math.abs(Number(n) || 0) * 10 ** dec) / 10 ** dec;
  const [ent, d] = v.toFixed(dec).split('.');
  const conPuntos = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${(Number(n) || 0) < 0 && v !== 0 ? '-' : ''}${conPuntos}${d ? `,${d}` : ''}`;
}
/** «$1.234,56» */
export const usdTexto = (n: number) => `$${miles(n)}`;
/** «Bs 1.234,56» */
export const bsTexto = (n: number) => `Bs ${miles(n)}`;
/** La tasa con sus decimales reales (hasta 4), nunca menos de 2: «36,50», «219,8723». */
export function tasaTexto(t: number): string {
  const s = miles(t, 4);
  return s.replace(/(,\d\d\d?)0+$/, '$1').replace(/(,\d\d)0$/, '$1');
}
/** 'AAAA-MM-DD' → 'DD/MM/AAAA' */
export function fechaTexto(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(limpio(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

export function esc(t: unknown): string {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ── Título, subtítulo y nombre de archivo ────────────────────────────────────

export const tituloPorDefecto = (tipo: TipoCuentaReporte) => (tipo === 'por_pagar' ? 'Cuentas por pagar' : 'Cuentas por cobrar');

/** Título en texto plano (sin escapar): el propio, o el de siempre. */
export function tituloReporteCuentas(tipo: TipoCuentaReporte, op: Pick<OpcionesReporteCuentas, 'titulo'>): string {
  return limpio(op.titulo) || tituloPorDefecto(tipo);
}

/** ¿Sale la columna de Bs? Solo si está prendida Y hay tasa. */
export const conBs = (op: OpcionesReporteCuentas, tasa: number | null | undefined) => op.columnas.bs !== false && !!tasa && tasa > 0;

const AGRUPAR_ARCHIVO: Record<AgruparCuentas, (tipo: TipoCuentaReporte) => string> = {
  ninguno: () => '',
  contraparte: (tipo) => (tipo === 'por_pagar' ? 'por proveedor' : 'por cliente'),
  empresa: () => 'por empresa',
  estado: () => 'por estado',
  vencimiento: () => 'por vencimiento',
  mes: () => 'por mes',
};

/**
 * Nombre del archivo: título + fecha + lo cambiado respecto al papel de
 * siempre. AQUÍ (y no en el papel) se dice el alcance, la agrupación y las
 * columnas apagadas.
 */
export function nombreArchivoCuentas(
  tipo: TipoCuentaReporte, op: OpcionesReporteCuentas, hoyISO: string, filtrado: boolean, tasa: number | null | undefined,
): string {
  const [a, m, d] = limpio(hoyISO).split('-');
  const partes: string[] = [];
  if (op.alcance === 'marcadas') partes.push('marcadas');
  else if (filtrado) partes.push('filtrado');
  const ag = AGRUPAR_ARCHIVO[op.agrupar]?.(tipo);
  if (ag) partes.push(ag);
  for (const [k, label] of columnasCuentas(tipo)) {
    if (k === 'bs') continue;
    if (op.columnas[k] === false) partes.push(`sin ${label.replace(/ \(US\$\)$/, '').toLowerCase()}`);
  }
  if (op.columnas.bs !== false && !conBs(op, tasa)) partes.push('sin Bs (sin tasa)');
  else if (op.columnas.bs === false) partes.push('sin Bs');
  const fecha = a && m && d ? ` ${d}-${m}-${a}` : '';
  return `${tituloReporteCuentas(tipo, op)}${fecha}${partes.length ? ` (${partes.join(', ')})` : ''}`;
}

// ── Cuerpo HTML ───────────────────────────────────────────────────────────────

export const CSS_REPORTE_CUENTAS = `
  .cx-kpis{display:flex;gap:10px;margin:4px 0 10px}
  .cx-kpi{flex:1;border:1px solid #D4DCE5;border-top:3px solid #1E3A5F;border-radius:4px;padding:9px 6px;text-align:center;background:#FAFBFD}
  .cx-kpi .v{font-size:17px;font-weight:800;color:#1E3A5F;line-height:1.1}
  .cx-kpi .b{font-size:9.5px;color:#4B5563;margin-top:3px}
  .cx-kpi .t{margin-top:5px;font-size:8.5px;font-weight:700;color:#68757F;letter-spacing:.3px}
  .cx-tasa{font-size:9.5px;color:#4B5563;margin:0 0 10px;text-transform:none}
  table.cx{width:100%;border-collapse:collapse;font-size:9.5px}
  table.cx th{background:#1E3A5F;color:#fff;text-align:left;padding:6px 6px;font-size:8.5px;letter-spacing:.3px}
  table.cx td{padding:4px 6px;border:1px solid #DDE4EC;vertical-align:top}
  table.cx td.n,table.cx th.n{text-align:center}
  table.cx td.r,table.cx th.r{text-align:right;white-space:nowrap}
  table.cx tr.cx-g td{background:#E8EEF5;color:#1E3A5F;font-weight:800;font-size:10px;border-top:2px solid #1E3A5F}
  table.cx tr.cx-sub td{background:#F3F6FA;font-weight:800;color:#1E3A5F}
  table.cx tr.cx-anulada td{color:#9CA3AF;text-decoration:line-through}
  table.cx td.venc{color:#B91C1C;font-weight:700}
  table.cx tfoot td{background:#EDF2F7;font-weight:800;color:#1E3A5F;border-top:2px solid #1E3A5F;font-size:10.5px}
  .cx-nota{margin-top:10px;font-size:9.5px;color:#6B7280;text-transform:none}
`;

export type ReporteCuentasArmado = {
  /** Ya escapados: van directo a `pdfDocument`, que NO escapa. */
  titulo: string;
  subtitulo: string;
  cuerpo: string;
  css: string;
  nombreArchivo: string;
  totales: TotalesCuentas;
  grupos: GrupoCuentas[];
};

/**
 * Arma el reporte completo (menos el membrete).
 * - `cuentas`: las ya elegidas (marcadas o la lista), en el orden de la pantalla.
 * - `filtrado`: el papel es un subconjunto → el subtítulo dice «FILTRADO».
 * - `tasaBcv`: tasa de hoy; null = sin Bs en ninguna parte.
 */
export function armarReporteCuentas(args: {
  tipo: TipoCuentaReporte;
  cuentas: CuentaParaReporte[];
  op: OpcionesReporteCuentas;
  tasaBcv: number | null | undefined;
  hoyISO: string;
  filtrado: boolean;
}): ReporteCuentasArmado {
  const { tipo, cuentas, op, hoyISO, filtrado } = args;
  const tasa = conBs(op, args.tasaBcv) ? Number(args.tasaBcv) : null;
  const ver = (k: ColumnaCuenta) => (k === 'bs' ? tasa != null : op.columnas[k] !== false);

  const cols = columnasCuentas(tipo).filter(([k]) => ver(k));
  const colsTexto = cols.filter(([k]) => !COLS_DINERO.includes(k));
  const colsDinero = cols.filter(([k]) => COLS_DINERO.includes(k));
  const nCols = 1 + cols.length; // + N°
  const antesDelDinero = 1 + colsTexto.length;

  const grupos = agruparCuentas(cuentas, op.agrupar, tipo);
  const total = totalesDe(cuentas);

  const celdasDinero = (t: { monto: number; abonado: number; saldo: number }) => colsDinero.map(([k]) => {
    if (k === 'bs') return `<td class="r">${esc(bsTexto((t.saldo || 0) * (tasa as number)))}</td>`;
    return `<td class="r">${esc(usdTexto(t[k as 'monto' | 'abonado' | 'saldo']))}</td>`;
  }).join('');

  const celda = (k: ColumnaCuenta, c: CuentaParaReporte): string => {
    const a = aporteDe(c);
    switch (k) {
      case 'contraparte': return `<td>${esc(limpio(c.contraparte) || '—')}</td>`;
      case 'empresa': return `<td>${esc(limpio(c.empresaNombre) || '—')}</td>`;
      case 'concepto': return `<td>${esc(limpio(c.concepto) || '—')}</td>`;
      case 'documento': return `<td>${esc(limpio(c.documento) || '—')}</td>`;
      case 'condiciones': {
        const val = limpio(c.condicionesPago) || limpio(extraerCondicionesDeNotaInterna(c.nota));
        return `<td>${esc(val || '—')}</td>`;
      }
      case 'nota': {
        const val = limpio(c.notaLimpia) || limpio(limpiarNotaInterna(c.nota));
        return `<td>${esc(val || '—')}</td>`;
      }
      case 'emision': return `<td class="n">${esc(fechaTexto(c.fecha_emision))}</td>`;
      case 'vence': return `<td class="n${c.situacion === 'vencida' ? ' venc' : ''}">${esc(fechaTexto(c.fecha_vencimiento))}</td>`;
      case 'estado': return `<td${c.situacion === 'vencida' ? ' class="venc"' : ''}>${esc(ESTADO_TEXTO[c.situacion] ?? c.situacion)}</td>`;
      // La fila muestra lo suyo (también la anulada, tachada); lo que SUMA es `aporteDe`.
      case 'monto': return `<td class="r">${esc(usdTexto(Number(c.monto) || 0))}</td>`;
      case 'abonado': return `<td class="r">${esc(usdTexto(Number(c.abonado) || 0))}</td>`;
      case 'saldo': return `<td class="r">${esc(usdTexto(c.situacion === 'anulada' ? Number(c.saldo) || 0 : a.saldo))}</td>`;
      case 'bs': return `<td class="r">${esc(bsTexto((c.situacion === 'anulada' ? Number(c.saldo) || 0 : a.saldo) * (tasa as number)))}</td>`;
      default: return '';
    }
  };

  let n = 0;
  const agrupado = op.agrupar !== 'ninguno';
  const filas = grupos.map((g) => {
    const cab = agrupado
      ? `<tr class="cx-g"><td colspan="${nCols}">${esc(g.etiqueta)} · ${g.totales.cantidad} cuenta(s)</td></tr>`
      : '';
    const cuerpoG = g.cuentas.map((c) => {
      n += 1;
      return `<tr${c.situacion === 'anulada' ? ' class="cx-anulada"' : ''}><td class="n">${n}</td>${cols.map(([k]) => celda(k, c)).join('')}</tr>`;
    }).join('');
    const sub = agrupado
      ? `<tr class="cx-sub"><td colspan="${antesDelDinero}" class="r">Subtotal ${esc(g.etiqueta)}</td>${celdasDinero(g.totales)}</tr>`
      : '';
    return cab + cuerpoG + sub;
  }).join('');

  const vacio = cuentas.length === 0 ? `<tr><td colspan="${nCols}" class="n">No hay cuentas en este reporte.</td></tr>` : '';
  const pie = cuentas.length > 0
    ? `<tfoot><tr><td colspan="${antesDelDinero}" class="r">Total general · ${total.cantidad} cuenta(s)</td>${celdasDinero(total)}</tr></tfoot>`
    : '';

  // Resumen de arriba: la cantidad siempre; cada total solo si su columna sale.
  const kpi = (v: string, t: string, bs?: number) =>
    `<div class="cx-kpi"><div class="v">${esc(v)}</div>${tasa != null && bs != null ? `<div class="b">≈ ${esc(bsTexto(bs * tasa))}</div>` : ''}<div class="t">${esc(t)}</div></div>`;
  const kpis = [
    kpi(String(total.cantidad), total.cantidad === 1 ? 'CUENTA' : 'CUENTAS'),
    ver('monto') ? kpi(usdTexto(total.monto), 'TOTAL MONTO', total.monto) : '',
    ver('abonado') ? kpi(usdTexto(total.abonado), 'TOTAL ABONADO', total.abonado) : '',
    ver('saldo') ? kpi(usdTexto(total.saldo), 'TOTAL SALDO', total.saldo) : '',
    // Saldo en US$ apagado pero Bs prendido: solo el saldo en Bs (la columna que sí sale).
    !ver('saldo') && tasa != null ? kpi(bsTexto(total.saldo * tasa), 'TOTAL SALDO ≈ BS') : '',
  ].join('');

  const lineaTasa = tasa != null
    ? `<div class="cx-tasa">Equivalente en bolívares calculado con la tasa BCV de hoy: ${esc(`Bs ${tasaTexto(tasa)}`)} por US$ 1. Los montos de las cuentas están en US$.</div>`
    : '';
  const notaAnuladas = total.anuladas > 0
    ? `<div class="cx-nota">Las cuentas anuladas (tachadas) se listan pero no suman en los subtotales ni en el total.</div>`
    : '';

  const cab = `<th class="n">N°</th>${cols.map(([k, label]) => `<th${COLS_DINERO.includes(k) ? ' class="r"' : (k === 'emision' || k === 'vence') ? ' class="n"' : ''}>${esc(label)}</th>`).join('')}`;

  const cuerpo = `
    <div class="cx-kpis">${kpis}</div>
    ${lineaTasa}
    <table class="cx"><thead><tr>${cab}</tr></thead><tbody>${filas}${vacio}</tbody>${pie}</table>
    ${notaAnuladas}
  `;

  return {
    titulo: esc(tituloReporteCuentas(tipo, op)),
    subtitulo: esc(`Situación al ${fechaTexto(hoyISO)}${filtrado ? ' · FILTRADO' : ''}`),
    cuerpo,
    css: CSS_REPORTE_CUENTAS,
    nombreArchivo: nombreArchivoCuentas(tipo, op, hoyISO, filtrado, args.tasaBcv),
    totales: total,
    grupos,
  };
}
