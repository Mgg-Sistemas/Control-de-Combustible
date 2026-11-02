// 📲 Mensaje y PDF de pago de una cuenta por pagar (02-nov-2026).
//
// Arma, con los datos que el sistema YA tiene (requerimiento, proveedor, quién
// solicitó / cargó / autorizó, montos y datos bancarios), el texto para WhatsApp
// que se manda a quien paga, y el mismo contenido en PDF. Sirve para una cuenta o
// para varias marcadas (un solo mensaje / un solo PDF).
//
// Reglas de la casa: lo que se apaga en las opciones NO sale ni deja rastro; las
// líneas vacías se omiten (nada de «—»). Los Bs son los escritos en el
// requerimiento cuando existen (montosBsCuenta), si no el equivalente con la tasa
// de hoy, y se dice cuál tasa se usó.
//
// Fase 2 (pendiente): el «plan de pago» (base en $, IVA en Bs, USDT…) reemplazará
// el bloque único de total / Bs por el desglose de cada parte.
import { pdfDocument } from './pdf';

export type PrioridadCuenta = 'alta' | 'media' | 'baja' | null | undefined;

export type DatosBancariosMensaje = {
  titular?: string | null;
  rifTitular?: string | null;
  banco?: string | null;
  numeroCuenta?: string | null;
  tipoCuenta?: string | null;
  pagoMovilBanco?: string | null;
  pagoMovilTelefono?: string | null;
  pagoMovilCedulaRif?: string | null;
  binanceId?: string | null;
  instruccionesPago?: string | null;
};

export type DatosMensajeCuenta = {
  orden: string;
  prioridad?: PrioridadCuenta;
  proveedor: string;
  detalle?: string | null;
  nota?: string | null;
  solicita?: string | null;
  analista?: string | null;
  autorizo?: string | null;
  condiciones?: string | null;
  totalUsd: number;
  /** Lo que falta por pagar (si ya hubo abonos). */
  saldoUsd?: number | null;
  totalBs?: number | null;
  saldoBs?: number | null;
  /** Tasa usada para mostrar los Bs (la del requerimiento o la de hoy). */
  tasaBs?: number | null;
  /** true = Bs escritos en el requerimiento; false = equivalente con la tasa de hoy. */
  bsFijos?: boolean;
  banco?: DatosBancariosMensaje | null;
  empresa?: string | null;
};

export type OpcionesMensajeCuenta = {
  nota: boolean;
  personas: boolean; // Solicita / Analista / Autorizó
  condiciones: boolean;
  bs: boolean;
  banco: boolean;
  empresa: boolean;
  // Solo PDF
  logoBcv: boolean;
  logoSos: boolean;
  logoGolden: boolean;
  logoRenace: boolean;
  logoJhenzaen: boolean;
  marcaTexto: boolean;
};

export const OPCIONES_MENSAJE_DEFECTO: OpcionesMensajeCuenta = {
  nota: true,
  personas: true,
  condiciones: true,
  bs: true,
  banco: true,
  empresa: true,
  logoBcv: true,
  logoSos: true,
  logoGolden: false,
  logoRenace: false,
  logoJhenzaen: false,
  marcaTexto: true,
};

/** Lo guardado puede venir viejo o roto: se completa con lo de fábrica. */
export function normalizarOpcionesMensaje(raw: any): OpcionesMensajeCuenta {
  const out: OpcionesMensajeCuenta = { ...OPCIONES_MENSAJE_DEFECTO };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(out) as (keyof OpcionesMensajeCuenta)[]) {
      if (typeof raw[k] === 'boolean') out[k] = raw[k];
    }
  }
  return out;
}

const txt = (v: any) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** 1234.5 → «1.234,50» */
export function montoEs(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const [ent, dec] = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '-' : ''}${ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

export function prioridadTexto(p: PrioridadCuenta): { icono: string; texto: string } {
  if (p === 'alta') return { icono: '🔴', texto: 'Alta (urgente)' };
  if (p === 'media') return { icono: '🟡', texto: 'Media' };
  if (p === 'baja') return { icono: '🟢', texto: 'Baja' };
  return { icono: '🟢', texto: 'Normal' };
}

/** Líneas de datos bancarios (solo las que existen). */
export function lineasBanco(b: DatosBancariosMensaje | null | undefined): { titulo: string; lineas: string[] }[] {
  if (!b) return [];
  const bloques: { titulo: string; lineas: string[] }[] = [];
  const transf = [
    txt(b.titular) && `Titular: ${txt(b.titular)}`,
    txt(b.rifTitular) && `CI/RIF: ${txt(b.rifTitular)}`,
    txt(b.banco) && `Banco: ${txt(b.banco)}`,
    txt(b.numeroCuenta) && `Cuenta${txt(b.tipoCuenta) ? ` (${txt(b.tipoCuenta)})` : ''}: ${txt(b.numeroCuenta)}`,
  ].filter(Boolean) as string[];
  if (txt(b.numeroCuenta) || txt(b.banco)) bloques.push({ titulo: '💳 Transferencia', lineas: transf });
  const pm = [
    txt(b.pagoMovilBanco) && `Banco: ${txt(b.pagoMovilBanco)}`,
    txt(b.pagoMovilTelefono) && `Teléfono: ${txt(b.pagoMovilTelefono)}`,
    txt(b.pagoMovilCedulaRif) && `CI/RIF: ${txt(b.pagoMovilCedulaRif)}`,
  ].filter(Boolean) as string[];
  if (txt(b.pagoMovilTelefono)) bloques.push({ titulo: '📲 Pago móvil', lineas: pm });
  if (txt(b.binanceId)) bloques.push({ titulo: '🪙 Binance / USDT', lineas: [`ID: ${txt(b.binanceId)}`] });
  if (txt(b.instruccionesPago)) bloques.push({ titulo: '📝 Instrucciones de pago', lineas: [txt(b.instruccionesPago)] });
  return bloques;
}

/** Texto de UNA cuenta (sin pie de empresa: lo pone quien arma el mensaje). */
function cuerpoCuenta(d: DatosMensajeCuenta, op: OpcionesMensajeCuenta): string[] {
  const L: string[] = [];
  const pr = prioridadTexto(d.prioridad);
  L.push(`🔹 *ORDEN:* ${txt(d.orden)}`);
  L.push(`${pr.icono} *Prioridad:* ${pr.texto}`);
  L.push(`🏭 *Proveedor:* ${txt(d.proveedor) || 'Proveedor'}`);
  if (txt(d.detalle)) L.push(`📝 *Detalle:* ${txt(d.detalle)}`);
  if (op.nota && txt(d.nota)) L.push(`📌 *Nota:* ${txt(d.nota)}`);
  if (op.personas) {
    if (txt(d.solicita)) L.push(`🙋 *Solicita:* ${txt(d.solicita)}`);
    if (txt(d.analista)) L.push(`🛒 *Analista de compras:* ${txt(d.analista)}`);
    if (txt(d.autorizo)) L.push(`👔 *Autorizó:* ${txt(d.autorizo)}`);
  }
  if (op.condiciones && txt(d.condiciones)) L.push(`🤝 *Condiciones:* ${txt(d.condiciones)}`);
  const total = Number(d.totalUsd) || 0;
  const saldo = d.saldoUsd != null ? Number(d.saldoUsd) || 0 : total;
  const parcial = saldo > 0 && saldo < total - 0.005;
  L.push(`💵 *Total:* $${montoEs(total)}`);
  if (parcial) L.push(`⏳ *Falta por pagar:* $${montoEs(saldo)}`);
  if (op.bs) {
    const bs = parcial ? Number(d.saldoBs) || 0 : Number(d.totalBs) || 0;
    if (bs > 0) {
      const tasa = Number(d.tasaBs) || 0;
      const como = d.bsFijos ? (tasa > 0 ? ` (tasa ${montoEs(tasa)})` : '') : (tasa > 0 ? ` (tasa BCV de hoy ${montoEs(tasa)})` : '');
      L.push(`💱 *${parcial ? 'Falta en Bs' : 'En Bs'}:* Bs ${montoEs(bs)}${como}`);
    }
  }
  if (op.banco) {
    for (const b of lineasBanco(d.banco)) {
      L.push(`${b.titulo}:`);
      for (const x of b.lineas) L.push(`• ${x}`);
    }
  }
  return L;
}

/** Mensaje de WhatsApp para una o varias cuentas. */
export function construirMensajeCuentas(lista: DatosMensajeCuenta[], op: OpcionesMensajeCuenta): string {
  const cuentas = (lista || []).filter(Boolean);
  if (cuentas.length === 0) return '';
  const empresas = Array.from(new Set(cuentas.map((d) => txt(d.empresa)).filter(Boolean)));
  if (cuentas.length === 1) {
    const L = cuerpoCuenta(cuentas[0], op);
    if (op.empresa && empresas[0]) L.push(`🏢 *${empresas[0]}*`);
    return L.join('\n');
  }
  const totalUsd = cuentas.reduce((s, d) => s + (d.saldoUsd != null ? Number(d.saldoUsd) || 0 : Number(d.totalUsd) || 0), 0);
  const L: string[] = [`🧾 *PAGOS PENDIENTES (${cuentas.length})* · Total por pagar: $${montoEs(totalUsd)}`, ''];
  cuentas.forEach((d, i) => {
    L.push(`*${i + 1}.*`);
    L.push(...cuerpoCuenta(d, op));
    if (op.empresa && empresas.length > 1 && txt(d.empresa)) L.push(`🏢 ${txt(d.empresa)}`);
    L.push('');
  });
  if (op.empresa && empresas.length === 1) L.push(`🏢 *${empresas[0]}*`);
  return L.join('\n').trim();
}

/** Enlace de WhatsApp (api.whatsapp.com: wa.me dañaba los emojis en la redirección). */
export function urlWhatsappMensaje(texto: string): string {
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
}

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** PDF con el mismo contenido del mensaje (una o varias cuentas). */
export function mensajeCuentasHtml(lista: DatosMensajeCuenta[], op: OpcionesMensajeCuenta): string {
  const cuentas = (lista || []).filter(Boolean);
  const fila = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`;
  const bloque = (d: DatosMensajeCuenta) => {
    const pr = prioridadTexto(d.prioridad);
    const total = Number(d.totalUsd) || 0;
    const saldo = d.saldoUsd != null ? Number(d.saldoUsd) || 0 : total;
    const parcial = saldo > 0 && saldo < total - 0.005;
    const filas: string[] = [];
    filas.push(fila('Prioridad', pr.texto));
    filas.push(fila('Proveedor', txt(d.proveedor) || 'Proveedor'));
    if (txt(d.detalle)) filas.push(fila('Detalle', txt(d.detalle)));
    if (op.nota && txt(d.nota)) filas.push(fila('Nota', txt(d.nota)));
    if (op.personas) {
      if (txt(d.solicita)) filas.push(fila('Solicita', txt(d.solicita)));
      if (txt(d.analista)) filas.push(fila('Analista de compras', txt(d.analista)));
      if (txt(d.autorizo)) filas.push(fila('Autorizó', txt(d.autorizo)));
    }
    if (op.condiciones && txt(d.condiciones)) filas.push(fila('Condiciones', txt(d.condiciones)));
    filas.push(fila('Total', `$${montoEs(total)}`));
    if (parcial) filas.push(fila('Falta por pagar', `$${montoEs(saldo)}`));
    if (op.bs) {
      const bs = parcial ? Number(d.saldoBs) || 0 : Number(d.totalBs) || 0;
      const tasa = Number(d.tasaBs) || 0;
      if (bs > 0) filas.push(fila(parcial ? 'Falta en Bs' : 'En Bs', `Bs ${montoEs(bs)}${tasa > 0 ? ` (tasa ${d.bsFijos ? '' : 'BCV de hoy '}${montoEs(tasa)})` : ''}`));
    }
    if (op.empresa && txt(d.empresa)) filas.push(fila('Empresa', txt(d.empresa)));
    const banco = op.banco
      ? lineasBanco(d.banco).map((b) => `<div class="bq"><b>${esc(b.titulo)}</b>${b.lineas.map((x) => `<div>${esc(x)}</div>`).join('')}</div>`).join('')
      : '';
    return `<div class="cm"><div class="ord">${esc(pr.icono)} ORDEN ${esc(txt(d.orden))}</div><table class="t">${filas.join('')}</table>${banco ? `<div class="bancos">${banco}</div>` : ''}</div>`;
  };
  const totalUsd = cuentas.reduce((s, d) => s + (d.saldoUsd != null ? Number(d.saldoUsd) || 0 : Number(d.totalUsd) || 0), 0);
  const resumen = cuentas.length > 1
    ? `<div class="res">${cuentas.length} cuentas · Total por pagar: <b>$${montoEs(totalUsd)}</b></div>`
    : '';
  const css = `
    .cm{border:1px solid #c9d2dc;border-radius:8px;padding:10px 12px;margin:0 0 12px;page-break-inside:avoid}
    .ord{font-weight:900;color:#16324F;font-size:14px;margin-bottom:6px}
    .t{width:100%;border-collapse:collapse;font-size:11.5px}
    .t td{padding:3px 6px;border-bottom:1px solid #eef1f5;vertical-align:top}
    .t td.k{width:160px;color:#4B5563;font-weight:700}
    .bancos{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
    .bq{flex:1 1 200px;background:#F8FAFC;border:1px solid #e2e8f0;border-radius:6px;padding:6px 8px;font-size:11px}
    .bq b{display:block;margin-bottom:2px;color:#16324F}
    .res{font-size:12.5px;margin:0 0 10px;color:#16324F}
  `;
  return pdfDocument({
    title: cuentas.length > 1 ? 'PAGOS PENDIENTES' : 'SOLICITUD DE PAGO',
    subtitle: cuentas.length === 1 ? `${esc(txt(cuentas[0].proveedor))} · ${esc(txt(cuentas[0].orden))}` : `${cuentas.length} cuentas por pagar`,
    extraCss: css,
    body: resumen + cuentas.map(bloque).join(''),
    logos: { bcv: op.logoBcv, sos: op.logoSos, golden: op.logoGolden, renace: op.logoRenace, jhenzaen: op.logoJhenzaen },
    marcaTexto: op.marcaTexto,
  });
}
