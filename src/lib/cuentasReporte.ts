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
  prioridad?: 'alta' | 'media' | 'baja' | null;
  traza?: {
    reqCode?: string | null;
    solicitadoPor?: string | null;
    aprobadoGerenciaPor?: string | null;
    fechaEnvioSoloDia?: string | null;
    fechaSolicitudSoloDia?: string | null;
  } | null;
  infoPago?: {
    metodosActivos?: string[];
  } | null;
  desgloseProveedores?: {
    proveedor: string;
    totalUsd: number;
    totalBs?: number;
    pago?: string | null;
  }[] | null;
};

export type AlcanceCuentas = 'marcadas' | 'todas';
export type AgruparCuentas = 'ninguno' | 'contraparte' | 'empresa' | 'estado' | 'vencimiento' | 'mes';
export type ModoReporteCuentas = 'detallado' | 'resumen';

export type ColumnaCuenta =
  | 'contraparte' | 'empresa' | 'concepto' | 'documento' | 'condiciones' | 'nota' | 'emision' | 'vence'
  | 'estado' | 'monto' | 'abonado' | 'saldo' | 'bs';

export type OpcionesReporteCuentas = {
  modo?: ModoReporteCuentas;
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
  modo: 'detallado',
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
  if (op.modo === 'resumen') partes.push('resumen');
  if (op.alcance === 'marcadas') partes.push('marcadas');
  else if (filtrado) partes.push('filtrado');
  const ag = AGRUPAR_ARCHIVO[op.agrupar]?.(tipo);
  if (ag) partes.push(ag);
  if (op.modo !== 'resumen') {
    for (const [k, label] of columnasCuentas(tipo)) {
      if (k === 'bs') continue;
      if (op.columnas[k] === false) partes.push(`sin ${label.replace(/ \(US\$\)$/, '').toLowerCase()}`);
    }
    if (op.columnas.bs !== false && !conBs(op, tasa)) partes.push('sin Bs (sin tasa)');
    else if (op.columnas.bs === false) partes.push('sin Bs');
  } else if (tasa == null || !(Number(tasa) > 0)) {
    partes.push('sin Bs (sin tasa)');
  }
  const fecha = a && m && d ? ` ${d}-${m}-${a}` : '';
  const baseTitulo = op.modo === 'resumen' && !limpio(op.titulo)
    ? (tipo === 'por_pagar' ? 'Pendientes por pagar' : 'Pendientes por cobrar')
    : tituloReporteCuentas(tipo, op);
  return `${baseTitulo}${fecha}${partes.length ? ` (${partes.join(', ')})` : ''}`;
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
  .sos-sec-tit{font-size:11px;font-weight:900;color:#16324F;letter-spacing:.4px;border-bottom:2px solid #0284C7;padding-bottom:4px;margin:4px 0 10px;text-transform:uppercase}
  .sos-met-box{border:1px solid #D7E3F4;border-left:5px solid #0284C7;border-radius:6px;background:#F0F6FC;padding:10px 14px;margin-bottom:12px}
  .sos-met-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
  .sos-met-title{font-size:12.5px;font-weight:900;color:#16324F}
  .sos-met-sub{font-size:10px;color:#475569;margin-top:2px}
  .sos-met-tot-usd{font-size:13.5px;font-weight:900;color:#047857;text-align:right}
  .sos-met-tot-bs{font-size:10.5px;font-weight:700;color:#0284C7;text-align:right;margin-top:1px}
  .sos-met-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-top:1px dashed #CBD5E1;font-size:10.5px;color:#1E293B}
  .sos-met-row b{color:#16324F}
  .sos-cons{display:flex;justify-content:space-between;align-items:center;border:1px solid #D7E3F4;border-left:5px solid #16324F;border-radius:6px;background:#FFFFFF;padding:12px 14px;margin-bottom:14px}
  .sos-cons-lbl{font-size:9.5px;font-weight:800;color:#475569;letter-spacing:.3px;text-transform:uppercase}
  .sos-cons-usd{font-size:22px;font-weight:900;color:#047857;line-height:1.15;margin-top:2px}
  .sos-cons-bs{font-size:12px;font-weight:800;color:#0284C7;margin-top:2px}
  .sos-cons-ord{font-size:10px;color:#64748B;margin-top:2px}
  .sos-cons-pill{border:1px solid #D7E3F4;background:#F8FAFC;border-radius:6px;padding:8px 12px;text-align:center}
  .sos-cons-pill .p1{font-size:10.5px;font-weight:800;color:#16324F}
  .sos-cons-pill .p2{font-size:9.5px;color:#64748B;margin-top:2px}
  .sos-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .sos-card{border:1px solid #D7E3F4;border-left:4px solid #0284C7;border-radius:6px;background:#FFFFFF;padding:10px 12px;break-inside:avoid}
  .sos-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px}
  .sos-card-eyebrow{font-size:8.5px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:.3px}
  .sos-card-name{font-size:11.5px;font-weight:900;color:#16324F;margin-top:1px}
  .sos-card-cat{font-size:9.5px;color:#64748B;margin-top:1px}
  .sos-pct{background:#16324F;color:#FFFFFF;font-size:9.5px;font-weight:800;padding:3px 9px;border-radius:999px;white-space:nowrap}
  .sos-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding-bottom:8px;border-bottom:1px solid #E2E8F0}
  .sos-m-lbl{font-size:8px;font-weight:800;color:#64748B;text-transform:uppercase}
  .sos-m-usd{font-size:11.5px;font-weight:900;color:#047857;margin-top:1px}
  .sos-m-bs{font-size:9px;font-weight:700;color:#0284C7;margin-top:1px}
  .sos-m-val{font-size:11.5px;font-weight:900;color:#16324F;margin-top:1px}
  .sos-m-sub{font-size:8.5px;color:#94A3B8}
  .sos-card-foot{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding-top:7px}
  .sos-f-lbl{font-size:8px;font-weight:800;color:#64748B;text-transform:uppercase}
  .sos-f-val{font-size:9.5px;font-weight:800;color:#0284C7;margin-top:1px;word-break:break-word}
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
  desde?: string | null;
  hasta?: string | null;
  empresaTexto?: string | null;
  /** 02-nov-2026: saldo en Bs ya fijado (Bs escritos en el requerimiento); null = US$ × tasa. */
  saldoBsDe?: (c: CuentaParaReporte, saldoUsd: number) => number | null;
}): ReporteCuentasArmado {
  const { tipo, cuentas, op, hoyISO, filtrado } = args;
  const tasaActiva = args.tasaBcv != null && isFinite(Number(args.tasaBcv)) && Number(args.tasaBcv) > 0
    ? Number(args.tasaBcv)
    : null;
  const tasa = op.modo === 'resumen' ? tasaActiva : (conBs(op, args.tasaBcv) ? Number(args.tasaBcv) : null);
  const ver = (k: ColumnaCuenta) => (k === 'bs' ? tasa != null : op.columnas[k] !== false);

  const cols = columnasCuentas(tipo).filter(([k]) => ver(k));
  const colsTexto = cols.filter(([k]) => !COLS_DINERO.includes(k));
  const colsDinero = cols.filter(([k]) => COLS_DINERO.includes(k));
  const nCols = 1 + cols.length; // + N°
  const antesDelDinero = 1 + colsTexto.length;

  const ejeEfectivo: AgruparCuentas = op.modo === 'resumen' && op.agrupar === 'ninguno' ? 'contraparte' : op.agrupar;
  const grupos = agruparCuentas(cuentas, ejeEfectivo, tipo);
  const total = totalesDe(cuentas);

  // Saldo en Bs de una cuenta: el fijado del requerimiento si lo hay; si no, US$ × tasa de hoy.
  const bsSaldo = (c: CuentaParaReporte, saldoUsd: number) => {
    const fijo = args.saldoBsDe ? args.saldoBsDe(c, saldoUsd) : null;
    return fijo != null ? fijo : saldoUsd * (tasa as number);
  };
  const sumaBs = (lista: CuentaParaReporte[]) =>
    Math.round(lista.reduce((s, c) => s + (c.situacion === 'anulada' ? 0 : bsSaldo(c, aporteDe(c).saldo)), 0) * 100) / 100;

  if (op.modo === 'resumen') {
    const activas = cuentas.filter((c) => c.situacion !== 'anulada');
    const totalUsd = total.saldo;
    const totalBs = tasa != null ? sumaBs(activas) : null;
    const nOrdenes = activas.length;

    const metMap = new Map<string, { etiqueta: string; usd: number; bs: number; ops: number }>();
    for (const c of activas) {
      const m = clasificarMetodoCuenta(c);
      const sUsd = aporteDe(c).saldo;
      const sBs = tasa != null ? bsSaldo(c, sUsd) : 0;
      const prev = metMap.get(m.clave) ?? { etiqueta: m.etiqueta, usd: 0, bs: 0, ops: 0 };
      prev.usd += sUsd;
      prev.bs += sBs;
      prev.ops += 1;
      metMap.set(m.clave, prev);
    }
    const metodosOrdenados = Array.from(metMap.values()).sort((a, b) => b.usd - a.usd);

    const etiquetaEjeMap: Record<AgruparCuentas, string> = {
      ninguno: tipo === 'por_pagar' ? 'Proveedor' : 'Cliente',
      contraparte: tipo === 'por_pagar' ? 'Proveedor / Contraparte' : 'Cliente / Contraparte',
      empresa: 'Empresa',
      estado: 'Estado',
      vencimiento: 'Vencimiento',
      mes: 'Mes',
    };
    const eyebrowGrupo = (ejeEfectivo === 'contraparte' ? (tipo === 'por_pagar' ? 'PROVEEDOR' : 'CLIENTE') : ejeEfectivo.toUpperCase());

    const tarjetasHtml = [...grupos]
      .filter((g) => g.cuentas.some((c) => c.situacion !== 'anulada'))
      .sort((a, b) => b.totales.saldo - a.totales.saldo)
      .map((g) => {
        const gActivas = g.cuentas.filter((c) => c.situacion !== 'anulada');
        const gUsd = g.totales.saldo;
        const gBs = tasa != null ? sumaBs(gActivas) : null;
        const pct = totalUsd > 0 ? ((gUsd / totalUsd) * 100).toFixed(1) : '0.0';
        const metodosGrupo = Array.from(new Set(gActivas.map((c) => clasificarMetodoCuenta(c).etiqueta)));
        const empresasGrupo = Array.from(new Set(gActivas.map((c) => limpio(c.empresaNombre)).filter((x) => x && x !== '—')));
        const reqs = Array.from(new Set(gActivas.map((c) => limpio(c.traza?.reqCode) || limpio(c.documento)).filter(Boolean)));
        const subCat = reqs.length > 0
          ? `Órdenes: ${reqs.slice(0, 3).join(', ')}${reqs.length > 3 ? ` (+${reqs.length - 3})` : ''}`
          : (limpio(gActivas[0]?.concepto) || (tipo === 'por_pagar' ? 'Orden de compra' : 'Cuenta por cobrar'));

        return `
          <div class="sos-card">
            <div class="sos-card-top">
              <div style="min-width:0;flex:1">
                <div class="sos-card-eyebrow">${esc(eyebrowGrupo)}</div>
                <div class="sos-card-name">${esc(g.etiqueta)}</div>
                <div class="sos-card-cat">${esc(subCat)}</div>
              </div>
              <div class="sos-pct">${esc(pct)}%</div>
            </div>
            <div class="sos-metrics">
              <div>
                <div class="sos-m-lbl">MONTO ($ USD)</div>
                <div class="sos-m-usd">${esc(usdTexto(gUsd))}</div>
                ${gBs != null ? `<div class="sos-m-bs">≈ ${esc(bsTexto(gBs))}</div>` : ''}
              </div>
              <div>
                <div class="sos-m-lbl">ÓRDENES</div>
                <div class="sos-m-val">${gActivas.length}</div>
                <div class="sos-m-sub">${gActivas.length === 1 ? 'registro' : 'registros'}</div>
              </div>
              <div>
                <div class="sos-m-lbl">% DEL TOTAL</div>
                <div class="sos-m-val">${esc(pct)}%</div>
                <div class="sos-m-sub">del período</div>
              </div>
            </div>
            <div class="sos-card-foot">
              <div>
                <div class="sos-f-lbl">${esc(ejeEfectivo === 'empresa' ? 'PROVEEDOR(ES)' : 'EMPRESA / BENEFICIARIO')}</div>
                <div class="sos-f-val">${esc(ejeEfectivo === 'empresa'
                  ? (Array.from(new Set(gActivas.map((c) => limpio(c.contraparte)).filter(Boolean))).slice(0, 2).join(', ') || g.etiqueta)
                  : (empresasGrupo.length ? empresasGrupo.join(', ') : g.etiqueta))}</div>
              </div>
              <div>
                <div class="sos-f-lbl">MÉTODO / CATEGORÍA</div>
                <div class="sos-f-val">${esc(metodosGrupo.join(' · ') || 'Orden de compra')}</div>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    const tituloResumen = limpio(op.titulo)
      ? limpio(op.titulo)
      : (tipo === 'por_pagar' ? 'Pendientes por pagar' : 'Pendientes por cobrar');
    const empHeader = resolverEmpresaHeaderWhatsapp(activas.length ? activas : cuentas, args.empresaTexto);
    const periodoTxt = resolverPeriodoWhatsapp(activas.length ? activas : cuentas, hoyISO, args.desde, args.hasta);
    const partesSub = [
      empHeader,
      `Período: ${periodoTxt}`,
      `Agrupado por: ${etiquetaEjeMap[ejeEfectivo]}`,
      tasa != null ? `Tasa BCV: ${tasaTexto(tasa)} Bs/$` : null,
      `${nOrdenes} ${nOrdenes === 1 ? 'orden' : 'órdenes'}`,
      filtrado ? 'FILTRADO' : null,
    ].filter(Boolean);

    const notaAnuladas = total.anuladas > 0
      ? `<div class="cx-nota">${total.anuladas} cuenta(s) anulada(s) no se suman en este resumen.</div>`
      : '';

    const cuerpoResumen = `
      <div class="sos-sec-tit">RESUMEN DE PAGOS — POR MÉTODO (EXPRESADO EN $ USD Y BS)</div>
      <div class="sos-met-box">
        <div class="sos-met-head">
          <div>
            <div class="sos-met-title">${esc(tipo === 'por_pagar' ? 'PENDIENTES POR PAGAR ($ USD · ref. BCV)' : 'CUENTAS POR COBRAR ($ USD · ref. BCV)')}</div>
            <div class="sos-met-sub">${nOrdenes} ${nOrdenes === 1 ? 'orden' : 'órdenes'}</div>
          </div>
          <div>
            <div class="sos-met-tot-usd">${esc(usdTexto(totalUsd))}</div>
            ${totalBs != null ? `<div class="sos-met-tot-bs">≈ ${esc(bsTexto(totalBs))}</div>` : ''}
          </div>
        </div>
        ${metodosOrdenados.map((m) => `
          <div class="sos-met-row">
            <span>• ${esc(m.etiqueta)}</span>
            <span><b>${esc(usdTexto(m.usd))}</b>${tasa != null ? ` · ≈ ${esc(bsTexto(m.bs))}` : ''} · ${m.ops} ord.</span>
          </div>
        `).join('')}
      </div>

      <div class="sos-cons">
        <div>
          <div class="sos-cons-lbl">TOTAL CONSOLIDADO (DÓLARES - $ USD)</div>
          <div class="sos-cons-usd">${esc(usdTexto(totalUsd))}</div>
          ${totalBs != null ? `<div class="sos-cons-bs">≈ ${esc(bsTexto(totalBs))}</div>` : ''}
          <div class="sos-cons-ord">${nOrdenes} ${nOrdenes === 1 ? 'orden' : 'órdenes'}</div>
        </div>
        <div class="sos-cons-pill">
          <div class="p1">${nOrdenes} ${nOrdenes === 1 ? 'orden' : 'órdenes'} · ${grupos.length} ${grupos.length === 1 ? 'grupo' : 'grupos'}</div>
          <div class="p2">${tasa != null ? `Tasa BCV ref: Bs ${esc(tasaTexto(tasa))}/$` : 'Sin tasa BCV cargada'}</div>
        </div>
      </div>

      ${activas.length === 0 ? '<div class="cx-nota">No hay órdenes vigentes en este reporte.</div>' : `<div class="sos-grid">${tarjetasHtml}</div>`}
      ${notaAnuladas}
    `;

    return {
      titulo: esc(tituloResumen),
      subtitulo: esc(partesSub.join(' · ')),
      cuerpo: cuerpoResumen,
      css: CSS_REPORTE_CUENTAS,
      nombreArchivo: nombreArchivoCuentas(tipo, op, hoyISO, filtrado, args.tasaBcv),
      totales: total,
      grupos,
    };
  }
  const celdasDinero = (t: { monto: number; abonado: number; saldo: number }, lista: CuentaParaReporte[]) => colsDinero.map(([k]) => {
    if (k === 'bs') return `<td class="r">${esc(bsTexto(sumaBs(lista)))}</td>`;
    return `<td class="r">${esc(usdTexto(t[k as 'monto' | 'abonado' | 'saldo']))}</td>`;
  }).join('');

  const celda = (k: ColumnaCuenta, c: CuentaParaReporte): string => {
    const a = aporteDe(c);
    switch (k) {
      case 'contraparte': {
        const desglose = (c.desgloseProveedores || []).filter((d) => d && limpio(d.proveedor));
        if (desglose.length > 1) {
          const itemsHtml = desglose.map((d, di) => {
            const bsD = tasa != null ? (d.totalBs && d.totalBs > 0 ? d.totalBs : (Number(d.totalUsd) || 0) * tasa) : 0;
            const bsSpan = tasa != null && bsD > 0 ? ` <span style="color:#047857">(${esc(bsTexto(bsD))})</span>` : '';
            const pagoSpan = limpio(d.pago) ? `<br/><span style="color:#475569;font-size:8px">💳 ${esc(limpio(d.pago))}</span>` : '';
            return `<div style="margin-top:2px;padding-top:2px;border-top:1px dashed #CBD5E1"><b>${di + 1}. ${esc(limpio(d.proveedor))}:</b> ${esc(usdTexto(Number(d.totalUsd) || 0))}${bsSpan}${pagoSpan}</div>`;
          }).join('');
          return `<td><div><b>${esc(limpio(c.contraparte) || `${desglose.length} PROVEEDORES`)}</b></div><div style="font-size:8.5px;color:#1E293B;margin-top:2px">${itemsHtml}</div></td>`;
        }
        return `<td>${esc(limpio(c.contraparte) || '—')}</td>`;
      }
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
      case 'bs': return `<td class="r">${esc(bsTexto(bsSaldo(c, c.situacion === 'anulada' ? Number(c.saldo) || 0 : a.saldo)))}</td>`;
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
      ? `<tr class="cx-sub"><td colspan="${antesDelDinero}" class="r">Subtotal ${esc(g.etiqueta)}</td>${celdasDinero(g.totales, g.cuentas)}</tr>`
      : '';
    return cab + cuerpoG + sub;
  }).join('');

  const vacio = cuentas.length === 0 ? `<tr><td colspan="${nCols}" class="n">No hay cuentas en este reporte.</td></tr>` : '';
  const pie = cuentas.length > 0
    ? `<tfoot><tr><td colspan="${antesDelDinero}" class="r">Total general · ${total.cantidad} cuenta(s)</td>${celdasDinero(total, cuentas)}</tr></tfoot>`
    : '';

  // Resumen de arriba: la cantidad siempre; cada total solo si su columna sale.
  const kpi = (v: string, t: string, bs?: number) =>
    `<div class="cx-kpi"><div class="v">${esc(v)}</div>${tasa != null && bs != null ? `<div class="b">≈ ${esc(bsTexto(bs * tasa))}</div>` : ''}<div class="t">${esc(t)}</div></div>`;
  const kpis = [
    kpi(String(total.cantidad), total.cantidad === 1 ? 'CUENTA' : 'CUENTAS'),
    ver('monto') ? kpi(usdTexto(total.monto), 'TOTAL MONTO', total.monto) : '',
    ver('abonado') ? kpi(usdTexto(total.abonado), 'TOTAL ABONADO', total.abonado) : '',
    ver('saldo') ? (tasa != null
      ? `<div class="cx-kpi"><div class="v">${esc(usdTexto(total.saldo))}</div><div class="b">≈ ${esc(bsTexto(sumaBs(cuentas)))}</div><div class="t">TOTAL SALDO</div></div>`
      : kpi(usdTexto(total.saldo), 'TOTAL SALDO')) : '',
    // Saldo en US$ apagado pero Bs prendido: solo el saldo en Bs (la columna que sí sale).
    !ver('saldo') && tasa != null ? kpi(bsTexto(sumaBs(cuentas)), 'TOTAL SALDO ≈ BS') : '',
  ].join('');

  const hayBsFijos = !!args.saldoBsDe && cuentas.some((c) => args.saldoBsDe!(c, aporteDe(c).saldo) != null);
  const lineaTasa = tasa != null
    ? `<div class="cx-tasa">Equivalente en bolívares calculado con la tasa BCV de hoy: ${esc(`Bs ${tasaTexto(tasa)}`)} por US$ 1${hayBsFijos ? ', salvo las cuentas de requerimientos cargados en Bs, que llevan sus propios Bs' : ''}. Los montos de las cuentas están en US$.</div>`
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

// ── 💬 Resumen Ejecutivo de Tesorería para WhatsApp (05-nov-2026) ────────────
//
// Formato ejecutivo de 1 línea por cuenta (idéntico al de Mineral Group Guayana
// y Golden Touch), con interruptores opcionales para enriquecer cada renglón
// (código REQ/documento, concepto, condiciones/método, estado, Bs y resumen
// «Por preparar» por método de pago). Sin U+FE0F en los emojis para evitar
// cuadros vacíos en WhatsApp Web / móvil.

export type OpcionesWhatsappReporte = {
  /** Mostrar el código de requerimiento o documento antes del proveedor/cliente */
  incluirCodigo?: boolean;
  /** Mostrar el concepto o detalle debajo de cada cuenta */
  incluirConcepto?: boolean;
  /** Mostrar las condiciones o método de pago de cada cuenta */
  incluirCondiciones?: boolean;
  /** Mostrar el estado y vencimiento de cada cuenta */
  incluirEstado?: boolean;
  /** Mostrar el equivalente en Bs en el total (y por renglón si aplica) */
  incluirBs?: boolean;
  /** Si el reporte está agrupado, separar los renglones por grupo con su subtotal */
  respetarAgrupacion?: boolean;
  /** Añadir al final el resumen «💳 Por preparar (según método de pago)» */
  incluirPorPreparar?: boolean;
  /** Fecha desde (AAAA-MM-DD) opcional para el encabezado */
  desde?: string | null;
  /** Fecha hasta (AAAA-MM-DD) opcional para el encabezado */
  hasta?: string | null;
  /** Nombre de empresa o encabezado institucional opcional */
  empresaTexto?: string | null;
};

export const OPCIONES_WHATSAPP_REPORTE_DEFECTO: Required<Omit<OpcionesWhatsappReporte, 'desde' | 'hasta' | 'empresaTexto'>> = {
  incluirCodigo: false,
  incluirConcepto: false,
  incluirCondiciones: false,
  incluirEstado: false,
  incluirBs: false,
  respetarAgrupacion: true,
  incluirPorPreparar: false,
};

function clasificarMetodoCuenta(c: CuentaParaReporte): { clave: string; etiqueta: string; icono: string } {
  const metodos = c.infoPago?.metodosActivos ?? [];
  const cond = `${metodos.join(' ')} ${limpio(c.condicionesPago)} ${limpio(extraerCondicionesDeNotaInterna(c.nota))}`.toUpperCase();
  if (/PAGO\s*M[OÓ]VIL/.test(cond)) return { clave: 'pago_movil', etiqueta: 'Pago móvil', icono: '📲' };
  if (/BINANCE|USDT/.test(cond)) return { clave: 'binance', etiqueta: 'Binance / USDT', icono: '🪙' };
  if (/ZELLE/.test(cond)) return { clave: 'zelle', etiqueta: 'Zelle', icono: '💸' };
  if (/EFECTIVO|DIVISA/.test(cond)) return { clave: 'efectivo', etiqueta: 'Efectivo / Divisas', icono: '💵' };
  if (/TRANSFERENCIA|BANCO|CUENTA/.test(cond)) return { clave: 'transferencia', etiqueta: 'Transferencia bancaria', icono: '💳' };
  if (limpio(c.condicionesPago)) return { clave: `cond:${limpio(c.condicionesPago).toLowerCase()}`, etiqueta: limpio(c.condicionesPago), icono: '🤝' };
  return { clave: 'por_definir', etiqueta: 'Método por confirmar', icono: '📌' };
}

function resolverPeriodoWhatsapp(
  cuentas: CuentaParaReporte[],
  hoyISO: string,
  desde?: string | null,
  hasta?: string | null,
): string {
  const d = limpio(desde);
  const h = limpio(hasta);
  const esIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (esIso(d) && esIso(h)) {
    return d === h ? fechaTexto(d) : `${fechaTexto(d)} al ${fechaTexto(h)}`;
  }
  if (esIso(d)) return `Desde ${fechaTexto(d)}`;
  if (esIso(h)) return `Hasta ${fechaTexto(h)}`;

  const fechas: string[] = [];
  for (const c of cuentas) {
    const f = limpio(c.traza?.fechaEnvioSoloDia) || limpio(c.traza?.fechaSolicitudSoloDia) || limpio(c.fecha_emision);
    if (esIso(f)) fechas.push(f);
  }
  if (fechas.length > 0) {
    fechas.sort();
    const minF = fechas[0];
    const maxF = fechas[fechas.length - 1];
    return minF === maxF ? fechaTexto(minF) : `${fechaTexto(minF)} al ${fechaTexto(maxF)}`;
  }
  return fechaTexto(hoyISO);
}

function resolverEmpresaHeaderWhatsapp(cuentas: CuentaParaReporte[], empresaTexto?: string | null): string {
  if (limpio(empresaTexto)) return limpio(empresaTexto).toUpperCase();
  const emps = Array.from(
    new Set(
      cuentas
        .map((c) => limpio(c.empresaNombre))
        .filter((n) => n && n !== '—' && n.toLowerCase() !== 'sin empresa'),
    ),
  );
  if (emps.length === 1) return emps[0].toUpperCase();
  if (emps.length === 2) return `${emps[0].toUpperCase()} / ${emps[1].toUpperCase()}`;
  if (emps.length > 2) return `SOS LA GUAIRA · ${emps.length} EMPRESAS`;
  return 'SOS LA GUAIRA';
}

export function textoWhatsappReporteCuentas(args: {
  tipo: TipoCuentaReporte;
  cuentas: CuentaParaReporte[];
  op?: Partial<OpcionesReporteCuentas>;
  wop?: OpcionesWhatsappReporte;
  tasaBcv?: number | null;
  hoyISO: string;
  saldoBsDe?: (c: CuentaParaReporte, saldoUsd: number) => number | null;
}): string {
  const { tipo, hoyISO } = args;
  const op: OpcionesReporteCuentas = {
    ...OPCIONES_CUENTAS_POR_DEFECTO,
    ...(args.op ?? {}),
    columnas: { ...COLUMNAS_POR_DEFECTO, ...(args.op?.columnas ?? {}) },
  };
  const wop = { ...OPCIONES_WHATSAPP_REPORTE_DEFECTO, ...(args.wop ?? {}) };
  const activas = (args.cuentas || []).filter((c) => c.situacion !== 'anulada');

  const tituloPersonal = limpio(op.titulo);
  const cabecera = tipo === 'por_pagar'
    ? `🧾 *${tituloPersonal || 'Reporte de Tesorería — Pendientes por pagar'}*`
    : `🤝 *${tituloPersonal || 'Reporte de Tesorería — Cuentas por cobrar'}*`;

  const empresaHeader = resolverEmpresaHeaderWhatsapp(activas.length > 0 ? activas : args.cuentas, wop.empresaTexto);
  const periodoHeader = resolverPeriodoWhatsapp(activas.length > 0 ? activas : args.cuentas, hoyISO, wop.desde, wop.hasta);
  const subtitulo = `_${empresaHeader} · ${periodoHeader}_`;

  if (activas.length === 0) {
    return [cabecera, subtitulo, '', '_Sin cuentas pendientes en este corte._'].join('\n');
  }

  const iconoFila = tipo === 'por_pagar' ? '🔻' : '🔺';
  const tasa = args.tasaBcv && Number(args.tasaBcv) > 0 ? Number(args.tasaBcv) : null;
  const mostrarBs = Boolean(wop.incluirBs && tasa != null);

  const bsDeCuenta = (c: CuentaParaReporte, montoUsd: number): number => {
    const fijo = args.saldoBsDe ? args.saldoBsDe(c, montoUsd) : null;
    return fijo != null ? fijo : (tasa ? montoUsd * tasa : 0);
  };

  const montoFilaUsd = (c: CuentaParaReporte): number => {
    if (c.situacion === 'pagada') return Number(c.monto) || 0;
    return aporteDe(c).saldo;
  };

  const formatearRenglon = (c: CuentaParaReporte, idx: number): string[] => {
    const desglose = (c.desgloseProveedores || []).filter((d) => d && limpio(d.proveedor));
    const rawContraparte = limpio(c.contraparte);
    const esGenerico = !rawContraparte || rawContraparte.toUpperCase() === 'PROVEEDOR';
    const contraparte = esGenerico && desglose.length === 1
      ? limpio(desglose[0].proveedor)
      : esGenerico && desglose.length > 1
      ? `${desglose.length} PROVEEDORES`
      : rawContraparte || contraparteLabel(tipo);
    const codigo = limpio(c.traza?.reqCode) || limpio(c.documento);
    const prefijoCodigo = wop.incluirCodigo && codigo ? `*${codigo}* · ` : '';
    const mUsd = montoFilaUsd(c);
    const sufijoPagada = c.situacion === 'pagada' ? ' _(✅ Pagada)_' : '';
    const sufijoPrioridad = c.prioridad === 'alta' && c.situacion !== 'pagada' ? ' 🔴' : '';
    const lineas: string[] = [
      `${idx}. ${iconoFila} ${prefijoCodigo}${contraparte} — *USD ${miles(mUsd)}*${sufijoPrioridad}${sufijoPagada}`,
    ];

    if (desglose.length > 1) {
      desglose.forEach((dp, pi) => {
        const dpUsd = Number(dp.totalUsd) || 0;
        const dpBs = dp.totalBs && dp.totalBs > 0 ? dp.totalBs : (tasa ? dpUsd * tasa : 0);
        const bsTxt = mostrarBs && dpBs > 0 ? ` _(≈ ${bsTexto(dpBs)})_` : '';
        lineas.push(`   ${idx}.${pi + 1} 🏭 *${limpio(dp.proveedor)}* — *USD ${miles(dpUsd)}*${bsTxt}`);
        const pagoTxt = limpio(dp.pago);
        if (pagoTxt) {
          lineas.push(`      💳 _Método de pago:_ ${pagoTxt}`);
        } else {
          lineas.push(`      💳 _Método de pago:_ ⚠️ Por confirmar con el proveedor`);
        }
      });
    } else if (desglose.length === 1 && limpio(desglose[0].pago)) {
      lineas.push(`   💳 _Método de pago:_ ${limpio(desglose[0].pago)}`);
    }

    if (wop.incluirConcepto && limpio(c.concepto)) {
      lineas.push(`   📝 _${limpio(c.concepto)}_`);
    }
    if (wop.incluirCondiciones) {
      const cond = limpio(c.condicionesPago) || limpio(extraerCondicionesDeNotaInterna(c.nota)) || (c.infoPago?.metodosActivos ?? []).join(' · ');
      if (cond) lineas.push(`   🤝 Condiciones: ${cond}`);
    }
    if (wop.incluirEstado) {
      const estIcono =
        c.situacion === 'vencida' ? '🔴 Vencida'
        : c.situacion === 'por_vencer' ? '🟡 Por vencer'
        : c.situacion === 'pagada' ? '✅ Pagada'
        : '⏳ Pendiente';
      const venceTxt = c.fecha_vencimiento && c.situacion !== 'pagada' ? ` · Vence: ${fechaTexto(c.fecha_vencimiento)}` : '';
      lineas.push(`   📌 Estado: ${estIcono}${venceTxt}`);
    }
    if (mostrarBs && mUsd > 0) {
      const mBs = bsDeCuenta(c, mUsd);
      if (mBs > 0) lineas.push(`   💱 Equivalente: ${bsTexto(mBs)}`);
    }
    return lineas;
  };

  const lineasCuerpo: string[] = [];
  const usarGrupos = op.agrupar !== 'ninguno' && wop.respetarAgrupacion !== false;

  if (usarGrupos) {
    const grupos = agruparCuentas(activas, op.agrupar, tipo);
    let contador = 0;
    grupos.forEach((g, gi) => {
      if (gi > 0) lineasCuerpo.push('');
      lineasCuerpo.push(`📂 *${g.etiqueta.toUpperCase()} (${g.cuentas.length}):*`);
      g.cuentas.forEach((c) => {
        contador += 1;
        lineasCuerpo.push(...formatearRenglon(c, contador));
      });
      const subUsd = g.cuentas.reduce((s, c) => s + montoFilaUsd(c), 0);
      lineasCuerpo.push(`   💵 *Subtotal ${g.etiqueta}:* $ ${miles(subUsd)}`);
    });
  } else {
    activas.forEach((c, i) => {
      lineasCuerpo.push(...formatearRenglon(c, i + 1));
    });
  }

  const totalUsd = activas.reduce((s, c) => s + montoFilaUsd(c), 0);
  const lineasPie: string[] = [
    `💰 *Total (${activas.length}):* $ ${miles(totalUsd)}`,
  ];

  if (mostrarBs && totalUsd > 0) {
    const totalBs = Math.round(activas.reduce((s, c) => s + bsDeCuenta(c, montoFilaUsd(c)), 0) * 100) / 100;
    lineasPie.push(`💱 *Total en Bs:* ${bsTexto(totalBs)} _(Tasa BCV: ${tasaTexto(tasa!)})_`);
  }

  if (wop.incluirPorPreparar && tipo === 'por_pagar') {
    const pendientes = activas.filter((c) => c.situacion !== 'pagada');
    if (pendientes.length > 0) {
      const mapaMetodos = new Map<string, { etiqueta: string; icono: string; count: number; usd: number }>();
      for (const c of pendientes) {
        const m = clasificarMetodoCuenta(c);
        const prev = mapaMetodos.get(m.clave) ?? { etiqueta: m.etiqueta, icono: m.icono, count: 0, usd: 0 };
        prev.count += 1;
        prev.usd += montoFilaUsd(c);
        mapaMetodos.set(m.clave, prev);
      }
      lineasPie.push('');
      lineasPie.push('💳 *Por preparar (según método de pago):*');
      Array.from(mapaMetodos.values())
        .sort((a, b) => b.usd - a.usd)
        .forEach((m) => {
          lineasPie.push(`• ${m.icono} ${m.etiqueta} (${m.count}): *$ ${miles(m.usd)}*`);
        });
    }
  }

  return [cabecera, subtitulo, '', ...lineasCuerpo, '', ...lineasPie].join('\n');
}

export function urlWhatsappReporteCuentas(texto: string): string {
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
}
