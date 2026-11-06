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
// Si la cuenta tiene PLAN DE PAGO (base en $, IVA en Bs, USDT…), el bloque único
// de «En Bs» se cambia por «Forma de pago» con cada parte, y de los datos bancarios
// salen solo los de los métodos que el plan usa.
import { pdfDocument } from './pdf';
import { PartePlan, EstadoParte, lineaParte, bloquesBancoDelPlan } from './planPago';

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

export type DesgloseProveedorMensaje = {
  proveedor: string;
  renglones?: number;
  subtotalUsd?: number;
  exentoUsd?: number;
  ivaUsd?: number;
  totalUsd: number;
  totalBs?: number;
  totalBsEseDia?: number;
  pago?: string | null;
  banco?: DatosBancariosMensaje | null;
  items?: { name: string; qty: number; unit: string; uUsd: number; lineUsd: number; exento?: boolean }[];
};

export type DatosMensajeCuenta = {
  id?: string;
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
  /** Datos para alternar en vivo entre la tasa del día de hoy y la tasa de ese día (del requerimiento). */
  tieneTasaEseDia?: boolean;
  totalBsEseDia?: number | null;
  saldoBsEseDia?: number | null;
  tasaBsEseDia?: number | null;
  totalBsHoy?: number | null;
  saldoBsHoy?: number | null;
  tasaBsHoy?: number | null;
  banco?: DatosBancariosMensaje | null;
  /** 💳 Desglose por proveedor cuando la cuenta viene de un requerimiento (1 o varios proveedores). */
  desgloseProveedores?: DesgloseProveedorMensaje[] | null;
  empresa?: string | null;
  /** Plan de pago (si lo hay): reemplaza el bloque «En Bs». */
  plan?: { partes: PartePlan[]; alicuotaIva?: number | null; estados?: EstadoParte[] | null } | null;
  /** Fecha (AAAA-MM-DD) de emisión o envío a Por Pagar para el rango del reporte */
  fecha?: string | null;
  /** Nota activa de espera («por qué no se ha pagado») de cuenta_notas_espera */
  notaEspera?: string | null;
  /** Estado de aprobación en Por Pagar */
  aprobacionEstado?: 'esperando_aprobacion' | 'esperando_pago' | 'pagada' | 'no_aplica' | null;
};

export type ModoMensajeCuenta = 'ficha' | 'tesoreria' | 'decision';

export type MotivoDecisionPago = 'si' | 'sin_fondos' | 'esperando_jefe' | 'otro';

export type DecisionCuentaPago = {
  motivo: MotivoDecisionPago;
  motivoOtro?: string;
};

export const ETIQUETA_MOTIVO_DECISION: Record<MotivoDecisionPago, string> = {
  si: '✅ Sí, se pagará',
  sin_fondos: '⏸ Sin fondos en estos momentos',
  esperando_jefe: '⏳ Esperando respuestas por el jefe',
  otro: '✏️ Otro motivo',
};

export type OpcionesListaTesoreria = {
  incluirOrden: boolean;
  incluirDetalle: boolean;
  incluirPersonas: boolean;
  incluirCondiciones: boolean;
  incluirBs: boolean;
  incluirPorPreparar: boolean;
  incluirDesgloseProveedores?: boolean;
  incluirMetodosPago?: boolean;
  desde?: string | null;
  hasta?: string | null;
  empresaTexto?: string | null;
};

export const OPCIONES_TESORERIA_DEFECTO: OpcionesListaTesoreria = {
  incluirOrden: false,
  incluirDetalle: false,
  incluirPersonas: false,
  incluirCondiciones: false,
  incluirBs: false,
  incluirPorPreparar: false,
  incluirDesgloseProveedores: true,
  incluirMetodosPago: false,
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

/** Líneas de datos bancarios (solo las que existen; con plan, solo las de sus métodos). */
export function lineasBanco(b: DatosBancariosMensaje | null | undefined, plan?: { partes: PartePlan[] } | null): { titulo: string; lineas: string[] }[] {
  if (!b) return [];
  const usa = plan && plan.partes.length > 0 ? bloquesBancoDelPlan(plan.partes) : { transferencia: true, pagoMovil: true, binance: true };
  const bloques: { titulo: string; lineas: string[] }[] = [];
  const transf = [
    txt(b.titular) && `Titular: ${txt(b.titular)}`,
    txt(b.rifTitular) && `CI/RIF: ${txt(b.rifTitular)}`,
    txt(b.banco) && `Banco: ${txt(b.banco)}`,
    txt(b.numeroCuenta) && `Cuenta${txt(b.tipoCuenta) ? ` (${txt(b.tipoCuenta)})` : ''}: ${txt(b.numeroCuenta)}`,
  ].filter(Boolean) as string[];
  if (usa.transferencia && (txt(b.numeroCuenta) || txt(b.banco))) bloques.push({ titulo: '💳 Transferencia', lineas: transf });
  const pm = [
    txt(b.pagoMovilBanco) && `Banco: ${txt(b.pagoMovilBanco)}`,
    txt(b.pagoMovilTelefono) && `Teléfono: ${txt(b.pagoMovilTelefono)}`,
    txt(b.pagoMovilCedulaRif) && `CI/RIF: ${txt(b.pagoMovilCedulaRif)}`,
  ].filter(Boolean) as string[];
  if (usa.pagoMovil && txt(b.pagoMovilTelefono)) bloques.push({ titulo: '📲 Pago móvil', lineas: pm });
  if (usa.binance && txt(b.binanceId)) bloques.push({ titulo: '🪙 Binance / USDT', lineas: [`ID: ${txt(b.binanceId)}`] });
  if (txt(b.instruccionesPago)) bloques.push({ titulo: '📝 Instrucciones de pago', lineas: [txt(b.instruccionesPago)] });
  return bloques;
}

/** Resumen compacto en 1 línea de las coordenadas bancarias / método de pago de un proveedor. */
export function resumenBancoEnLinea(
  b?: DatosBancariosMensaje | null,
  pagoTexto?: string | null,
  condiciones?: string | null,
): string {
  const p = txt(pagoTexto);
  if (p) {
    const c = txt(condiciones);
    return c && !p.toLowerCase().includes(c.toLowerCase()) ? `${p} · 🤝 ${c}` : p;
  }
  const partes: string[] = [];
  if (b) {
    if (txt(b.banco) || txt(b.numeroCuenta)) {
      const tit = [txt(b.titular), txt(b.rifTitular)].filter(Boolean).join(' ');
      partes.push(
        `🏦 ${[txt(b.banco), txt(b.numeroCuenta) ? `Cta: ${txt(b.numeroCuenta)}` : '', tit ? `(${tit})` : '']
          .filter(Boolean)
          .join(' ')}`,
      );
    }
    if (txt(b.pagoMovilTelefono)) {
      partes.push(
        `📱 PM: ${[txt(b.pagoMovilBanco), txt(b.pagoMovilTelefono), txt(b.pagoMovilCedulaRif) ? `(${txt(b.pagoMovilCedulaRif)})` : '']
          .filter(Boolean)
          .join(' ')}`,
      );
    }
    if (txt(b.binanceId)) {
      partes.push(`🟡 Binance: ${txt(b.binanceId)}`);
    }
    if (txt(b.instruccionesPago)) {
      partes.push(`📝 ${txt(b.instruccionesPago)}`);
    }
  }
  if (txt(condiciones)) {
    const c = txt(condiciones);
    const unido = partes.join(' · ');
    if (!unido.toLowerCase().includes(c.toLowerCase())) {
      partes.push(`🤝 ${c}`);
    }
  }
  return partes.join(' · ');
}

function esProveedorGenerico(nombre?: string | null): boolean {
  const n = txt(nombre).toLowerCase();
  return !n || n === 'proveedor' || n === '—' || n === '-' || n === 'sin proveedor asignado';
}

function nombreProveedorResuelto(d: DatosMensajeCuenta): string {
  const des = d.desgloseProveedores ?? [];
  if (des.length > 1) {
    return `${des.length} proveedores (${des.map((g) => txt(g.proveedor)).join(' · ')})`;
  }
  if (des.length === 1 && esProveedorGenerico(d.proveedor)) {
    return txt(des[0].proveedor) || 'Proveedor';
  }
  return txt(d.proveedor) || (des[0] ? txt(des[0].proveedor) : '') || 'Proveedor';
}

/** Texto de UNA cuenta (sin pie de empresa: lo pone quien arma el mensaje). */
function cuerpoCuenta(d: DatosMensajeCuenta, op: OpcionesMensajeCuenta): string[] {
  const L: string[] = [];
  const pr = prioridadTexto(d.prioridad);
  const des = (d.desgloseProveedores ?? []).filter(Boolean);
  const multiProv = des.length > 1;
  L.push(`🔹 *ORDEN:* ${txt(d.orden)}`);
  L.push(`${pr.icono} *Prioridad:* ${pr.texto}`);
  if (multiProv) {
    L.push(`🏭 *Proveedores (${des.length}):* ${des.map((g) => txt(g.proveedor)).join(' · ')}`);
  } else {
    L.push(`🏭 *Proveedor:* ${nombreProveedorResuelto(d)}`);
  }
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
  const factorSaldo = parcial && total > 0 ? saldo / total : 1;
  L.push(`💵 *Total:* $${montoEs(total)}`);
  if (parcial) L.push(`⏳ *Falta por pagar:* $${montoEs(saldo)}`);
  if (d.plan && d.plan.partes.length > 0) {
    L.push('💳 *Forma de pago:*');
    d.plan.partes.forEach((p, i) => {
      const est = d.plan?.estados?.find((e) => e.parte.id === p.id) ?? null;
      L.push(`${i + 1}) ${lineaParte(p, d.plan?.alicuotaIva, est)}`);
    });
  } else if (op.bs) {
    const bs = parcial ? Number(d.saldoBs) || 0 : Number(d.totalBs) || 0;
    if (bs > 0) {
      const tasa = Number(d.tasaBs) || 0;
      const como = d.bsFijos ? (tasa > 0 ? ` (tasa ${montoEs(tasa)})` : '') : (tasa > 0 ? ` (tasa BCV de hoy ${montoEs(tasa)})` : '');
      L.push(`💱 *${parcial ? 'Falta en Bs' : 'En Bs'}:* Bs ${montoEs(bs)}${como}`);
    }
  }

  // 💳 Desglose detallado por proveedor (cuánto pagarle a cada uno, sus productos y sus métodos de pago)
  if (des.length > 0) {
    if (multiProv) {
      L.push('');
      L.push(`💳 *Desglose por proveedor (${des.length} proveedores — cuánto pagarle a cada uno):*`);
      des.forEach((g, idx) => {
        const gUsd = Math.round((Number(g.totalUsd) || 0) * factorSaldo * 100) / 100;
        const tasaCuenta = Number(d.tasaBs) || 0;
        const gBsBase = Number(g.totalBs) > 0 ? Number(g.totalBs) : tasaCuenta > 0 ? (Number(g.totalUsd) || 0) * tasaCuenta : 0;
        const gBs = Math.round(gBsBase * factorSaldo * 100) / 100;
        const bsTxt = op.bs && gBs > 0 ? ` · Bs ${montoEs(gBs)}` : '';
        L.push(`${idx + 1}) 🏭 *${txt(g.proveedor)}* — *A pagar: $${montoEs(gUsd)}*${bsTxt}`);
        if (Array.isArray(g.items) && g.items.length > 0) {
          g.items.forEach((it) => {
            L.push(`   📦 ${txt(it.name)} (${montoEs(it.qty)} ${txt(it.unit) || 'und'} × $${montoEs(it.uUsd)} = $${montoEs(it.lineUsd)})`);
          });
        }
        if (op.banco) {
          const bLineas = lineasBanco(g.banco, null);
          if (bLineas.length > 0) {
            for (const b of bLineas) {
              L.push(`   ${b.titulo}: ${b.lineas.join(' · ')}`);
            }
          } else {
            const resMetodo = resumenBancoEnLinea(g.banco, g.pago, d.condiciones);
            L.push(`   💳 Método de pago: ${resMetodo || 'Sin datos bancarios registrados en la ficha del proveedor'}`);
          }
        }
      });
    } else {
      const unico = des[0];
      if (Array.isArray(unico.items) && unico.items.length > 0) {
        L.push(`📦 *Productos (${unico.items.length}):*`);
        unico.items.forEach((it) => {
          L.push(`• ${txt(it.name)} (${montoEs(it.qty)} ${txt(it.unit) || 'und'} × $${montoEs(it.uUsd)} = $${montoEs(it.lineUsd)})`);
        });
      }
      if (op.banco) {
        const bancoEfectivo = d.banco || unico.banco;
        const bLineas = lineasBanco(bancoEfectivo, d.plan);
        if (bLineas.length > 0) {
          for (const b of bLineas) {
            L.push(`${b.titulo}:`);
            for (const x of b.lineas) L.push(`• ${x}`);
          }
        } else if (txt(unico.pago)) {
          L.push(`💳 *Método de pago:* ${txt(unico.pago)}`);
        }
      }
    }
  } else if (op.banco) {
    for (const b of lineasBanco(d.banco, d.plan)) {
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
    const factorSaldo = parcial && total > 0 ? saldo / total : 1;
    const des = (d.desgloseProveedores ?? []).filter(Boolean);
    const multiProv = des.length > 1;
    const filas: string[] = [];
    filas.push(fila('Prioridad', pr.texto));
    filas.push(fila(multiProv ? `Proveedores (${des.length})` : 'Proveedor', nombreProveedorResuelto(d)));
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
    if (d.plan && d.plan.partes.length > 0) {
      d.plan.partes.forEach((p, i) => {
        const est = d.plan?.estados?.find((e) => e.parte.id === p.id) ?? null;
        filas.push(fila(i === 0 ? 'Forma de pago' : '', `${i + 1}) ${lineaParte(p, d.plan?.alicuotaIva, est)}`));
      });
    } else if (op.bs) {
      const bs = parcial ? Number(d.saldoBs) || 0 : Number(d.totalBs) || 0;
      const tasa = Number(d.tasaBs) || 0;
      if (bs > 0) filas.push(fila(parcial ? 'Falta en Bs' : 'En Bs', `Bs ${montoEs(bs)}${tasa > 0 ? ` (tasa ${d.bsFijos ? '' : 'BCV de hoy '}${montoEs(tasa)})` : ''}`));
    }
    if (op.empresa && txt(d.empresa)) filas.push(fila('Empresa', txt(d.empresa)));

    let desgloseHtml = '';
    if (des.length > 0) {
      const rowsProv = des.map((g, idx) => {
        const gUsd = Math.round((Number(g.totalUsd) || 0) * factorSaldo * 100) / 100;
        const tasaCuenta = Number(d.tasaBs) || 0;
        const gBsBase = Number(g.totalBs) > 0 ? Number(g.totalBs) : tasaCuenta > 0 ? (Number(g.totalUsd) || 0) * tasaCuenta : 0;
        const gBs = Math.round(gBsBase * factorSaldo * 100) / 100;
        const itemsHtml = Array.isArray(g.items) && g.items.length > 0
          ? `<div style="font-size:10px;color:#475569;margin-top:2px">${g.items.map((it) => `• ${esc(txt(it.name))} (${esc(montoEs(it.qty))} ${esc(txt(it.unit) || 'und')} × $${esc(montoEs(it.uUsd))} = $${esc(montoEs(it.lineUsd))})`).join('<br/>')}</div>`
          : '';
        const metHtml = op.banco
          ? `<div style="font-size:10px;color:#0F766E;font-weight:700;margin-top:3px">💳 ${esc(resumenBancoEnLinea(g.banco, g.pago, d.condiciones) || 'Sin método de pago registrado en su ficha')}</div>`
          : '';
        return `<tr>
          <td style="text-align:center;width:26px">${idx + 1}</td>
          <td><b>🏭 ${esc(txt(g.proveedor))}</b>${itemsHtml}${metHtml}</td>
          <td style="text-align:right;white-space:nowrap;font-weight:800">$${esc(montoEs(gUsd))}</td>
          ${op.bs ? `<td style="text-align:right;white-space:nowrap">${gBs > 0 ? `Bs ${esc(montoEs(gBs))}` : '—'}</td>` : ''}
        </tr>`;
      }).join('');
      desgloseHtml = `<div style="margin-top:8px">
        <div style="font-size:11px;font-weight:800;color:#16324F;margin-bottom:4px">💳 Desglose de pago por proveedor (${des.length}) y métodos de pago:</div>
        <table class="t" style="border:1px solid #cbd5e1">
          <thead><tr style="background:#16324F;color:#fff"><th style="padding:4px 6px;text-align:center">#</th><th style="padding:4px 6px;text-align:left">Proveedor / Productos / Método de pago</th><th style="padding:4px 6px;text-align:right">A pagar (USD)</th>${op.bs ? '<th style="padding:4px 6px;text-align:right">En Bs</th>' : ''}</tr></thead>
          <tbody>${rowsProv}</tbody>
        </table>
      </div>`;
    }

    const banco = op.banco && !multiProv
      ? lineasBanco(d.banco || des[0]?.banco, d.plan).map((b) => `<div class="bq"><b>${esc(b.titulo)}</b>${b.lineas.map((x) => `<div>${esc(x)}</div>`).join('')}</div>`).join('')
      : '';
    return `<div class="cm"><div class="ord">${esc(pr.icono)} ORDEN ${esc(txt(d.orden))}</div><table class="t">${filas.join('')}</table>${desgloseHtml}${banco ? `<div class="bancos">${banco}</div>` : ''}</div>`;
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

// ── 2) 🧾 LISTA EJECUTIVA DE TESORERÍA (1 LÍNEA POR CUENTA) ──────────────────

function fmtFechaIso(iso?: string | null): string {
  const s = txt(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function resolverRangoTesoreria(
  cuentas: DatosMensajeCuenta[],
  desde?: string | null,
  hasta?: string | null,
): string {
  const fd = fmtFechaIso(desde);
  const fh = fmtFechaIso(hasta);
  if (fd && fh) return fd === fh ? fd : `${fd} al ${fh}`;
  if (fd) return `Desde ${fd}`;
  if (fh) return `Hasta ${fh}`;

  const fechas = cuentas
    .map((c) => txt(c.fecha))
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
    .sort();
  if (fechas.length > 0) {
    const fMin = fmtFechaIso(fechas[0]);
    const fMax = fmtFechaIso(fechas[fechas.length - 1]);
    return fMin === fMax ? fMin : `${fMin} al ${fMax}`;
  }
  const ahora = new Date();
  const dd = String(ahora.getDate()).padStart(2, '0');
  const mm = String(ahora.getMonth() + 1).padStart(2, '0');
  const yyyy = ahora.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function resolverEmpresaTesoreria(cuentas: DatosMensajeCuenta[], empresaTexto?: string | null): string {
  if (txt(empresaTexto)) return txt(empresaTexto).toUpperCase();
  const empresas = Array.from(new Set(cuentas.map((d) => txt(d.empresa)).filter(Boolean)));
  if (empresas.length === 1) return empresas[0].toUpperCase();
  if (empresas.length === 2) return `${empresas[0].toUpperCase()} / ${empresas[1].toUpperCase()}`;
  if (empresas.length > 2) return `SOS LA GUAIRA · ${empresas.length} EMPRESAS`;
  return 'SOS LA GUAIRA';
}

function montoAPagarDe(d: DatosMensajeCuenta): number {
  return d.saldoUsd != null ? Number(d.saldoUsd) || 0 : Number(d.totalUsd) || 0;
}

function montoBsAPagarDe(d: DatosMensajeCuenta): number {
  const total = Number(d.totalUsd) || 0;
  const saldo = montoAPagarDe(d);
  const parcial = saldo > 0 && saldo < total - 0.005;
  return parcial ? Number(d.saldoBs) || 0 : Number(d.totalBs) || 0;
}

function clasificarMetodoMensaje(d: DatosMensajeCuenta): { clave: string; etiqueta: string; icono: string } {
  const c = txt(d.condiciones).toUpperCase();
  if (/PAGO\s*M[OÓ]VIL/.test(c)) return { clave: 'pm', etiqueta: 'Pago móvil', icono: '📲' };
  if (/BINANCE|USDT/.test(c)) return { clave: 'binance', etiqueta: 'Binance / USDT', icono: '🪙' };
  if (/ZELLE/.test(c)) return { clave: 'zelle', etiqueta: 'Zelle', icono: '💸' };
  if (/EFECTIVO|DIVISA/.test(c)) return { clave: 'efectivo', etiqueta: 'Efectivo / Divisas', icono: '💵' };
  if (/TRANSFERENCIA|BANCO|CUENTA/.test(c)) return { clave: 'transf', etiqueta: 'Transferencia bancaria', icono: '💳' };
  if (d.banco?.pagoMovilTelefono && !d.banco?.numeroCuenta) return { clave: 'pm', etiqueta: 'Pago móvil', icono: '📲' };
  if (d.banco?.binanceId && !d.banco?.numeroCuenta && !d.banco?.pagoMovilTelefono) return { clave: 'binance', etiqueta: 'Binance / USDT', icono: '🪙' };
  if (d.banco?.numeroCuenta || d.banco?.banco) return { clave: 'transf', etiqueta: 'Transferencia bancaria', icono: '💳' };
  if (txt(d.condiciones)) return { clave: `c:${txt(d.condiciones).toLowerCase()}`, etiqueta: txt(d.condiciones), icono: '🤝' };
  return { clave: 'por_definir', etiqueta: 'Método por definir', icono: '📌' };
}

/**
 * Construye el reporte ejecutivo compacto de Tesorería (1 línea por cuenta),
 * idéntico al de Mineral Group Guayana y Golden Touch, con opciones para enriquecerlo.
 */
export function construirListaTesoreriaCuentas(
  lista: DatosMensajeCuenta[],
  op?: Partial<OpcionesListaTesoreria>,
): string {
  const cuentas = (lista || []).filter(Boolean);
  const cfg: OpcionesListaTesoreria = { ...OPCIONES_TESORERIA_DEFECTO, ...(op ?? {}) };
  const empHeader = resolverEmpresaTesoreria(cuentas, cfg.empresaTexto);
  const rangoHeader = resolverRangoTesoreria(cuentas, cfg.desde, cfg.hasta);

  const L: string[] = [
    '🧾 *Reporte de Tesorería — Pendientes por pagar*',
    `_${empHeader} · ${rangoHeader}_`,
    '',
  ];

  if (cuentas.length === 0) {
    L.push('_Sin cuentas seleccionadas._');
    return L.join('\n');
  }

  cuentas.forEach((d, idx) => {
    const des = (d.desgloseProveedores ?? []).filter(Boolean);
    const multiProv = des.length > 1;
    const prov = multiProv && esProveedorGenerico(d.proveedor)
      ? `${txt(d.orden) || 'REQUERIMIENTO'} (${des.length} proveedores)`
      : (nombreProveedorResuelto(d) || 'PROVEEDOR');
    const ordenPref = cfg.incluirOrden && txt(d.orden) && !prov.startsWith(txt(d.orden)) ? `*${txt(d.orden)}* · ` : '';
    const mUsd = montoAPagarDe(d);
    const total = Number(d.totalUsd) || 0;
    const factorSaldo = total > 0 && mUsd < total - 0.005 ? mUsd / total : 1;
    const urgente = d.prioridad === 'alta' ? ' 🔴' : '';
    L.push(`${idx + 1}. 🔻 ${ordenPref}${prov} — *USD ${montoEs(mUsd)}*${urgente}`);

    if (cfg.incluirDetalle && txt(d.detalle)) {
      L.push(`   📝 _${txt(d.detalle)}_`);
    }
    if (cfg.incluirPersonas) {
      const partesPers = [
        txt(d.solicita) ? `🙋 Solicita: ${txt(d.solicita)}` : '',
        txt(d.analista) ? `🛒 Analista: ${txt(d.analista)}` : '',
        txt(d.autorizo) ? `👔 Autorizó: ${txt(d.autorizo)}` : '',
      ].filter(Boolean);
      if (partesPers.length > 0) L.push(`   ${partesPers.join(' · ')}`);
    }
    if (cfg.incluirCondiciones && txt(d.condiciones)) {
      L.push(`   🤝 Condiciones: ${txt(d.condiciones)}`);
    }
    if (cfg.incluirBs) {
      const bs = montoBsAPagarDe(d);
      if (bs > 0) L.push(`   💱 En Bs: Bs ${montoEs(bs)}`);
    }

    // 💳 Desglose de lo que se debe pagar a cada proveedor y el método de pago de cada uno
    if (cfg.incluirDesgloseProveedores !== false && multiProv) {
      const tasaCuenta = Number(d.tasaBs) || 0;
      L.push(`   💳 *Desglose por proveedor (${des.length}):*`);
      des.forEach((g, gi) => {
        const gUsd = Math.round((Number(g.totalUsd) || 0) * factorSaldo * 100) / 100;
        const gBsBase = Number(g.totalBs) > 0 ? Number(g.totalBs) : tasaCuenta > 0 ? (Number(g.totalUsd) || 0) * tasaCuenta : 0;
        const gBs = Math.round(gBsBase * factorSaldo * 100) / 100;
        const bsSub = (cfg.incluirBs || gBs > 0) ? ` (Bs ${montoEs(gBs)})` : '';
        L.push(`   • ${idx + 1}.${gi + 1} 🏭 *${txt(g.proveedor)}* — *USD ${montoEs(gUsd)}*${bsSub}`);
        if (cfg.incluirMetodosPago !== false) {
          const met = resumenBancoEnLinea(g.banco, g.pago, d.condiciones);
          L.push(`     💳 Método de pago: ${met || 'Sin método de pago registrado en su ficha'}`);
        }
      });
    } else if (cfg.incluirMetodosPago || (des.length === 1 && cfg.incluirDesgloseProveedores !== false && (txt(des[0].pago) || des[0].banco || d.banco))) {
      const unico = des[0];
      const met = resumenBancoEnLinea(d.banco || unico?.banco, unico?.pago, d.condiciones);
      if (met) {
        L.push(`   💳 Método de pago: ${met}`);
      }
    }
  });

  const totalUsd = cuentas.reduce((s, d) => s + montoAPagarDe(d), 0);
  L.push('');
  L.push(`💰 *Total (${cuentas.length}):* $ ${montoEs(totalUsd)}`);

  if (cfg.incluirBs) {
    const totalBs = cuentas.reduce((s, d) => s + montoBsAPagarDe(d), 0);
    if (totalBs > 0) {
      const tasaRef = Number(cuentas.find((c) => Number(c.tasaBs) > 0)?.tasaBs) || 0;
      L.push(`💱 *Equivalente en Bs:* Bs ${montoEs(totalBs)}${tasaRef > 0 ? ` _(Tasa: ${montoEs(tasaRef)})_` : ''}`);
    }
  }

  if (cfg.incluirPorPreparar && cuentas.length > 0) {
    const grupos = new Map<string, { etiqueta: string; icono: string; count: number; usd: number }>();
    for (const d of cuentas) {
      const m = clasificarMetodoMensaje(d);
      const prev = grupos.get(m.clave) ?? { etiqueta: m.etiqueta, icono: m.icono, count: 0, usd: 0 };
      prev.count += 1;
      prev.usd += montoAPagarDe(d);
      grupos.set(m.clave, prev);
    }
    L.push('');
    L.push('💳 *Por preparar (según método de pago):*');
    Array.from(grupos.values())
      .sort((a, b) => b.usd - a.usd)
      .forEach((g) => {
        L.push(`• ${g.icono} ${g.etiqueta} (${g.count}): *$ ${montoEs(g.usd)}*`);
      });
  }

  return L.join('\n');
}

export function listaTesoreriaCuentasHtml(
  lista: DatosMensajeCuenta[],
  op: Partial<OpcionesListaTesoreria> & Partial<OpcionesMensajeCuenta>,
): string {
  const cuentas = (lista || []).filter(Boolean);
  const cfg: OpcionesListaTesoreria = { ...OPCIONES_TESORERIA_DEFECTO, ...op };
  const empHeader = resolverEmpresaTesoreria(cuentas, cfg.empresaTexto);
  const rangoHeader = resolverRangoTesoreria(cuentas, cfg.desde, cfg.hasta);
  const totalUsd = cuentas.reduce((s, d) => s + montoAPagarDe(d), 0);
  const totalBs = cuentas.reduce((s, d) => s + montoBsAPagarDe(d), 0);

  const filas = cuentas.map((d, i) => {
    const mUsd = montoAPagarDe(d);
    const mBs = montoBsAPagarDe(d);
    const total = Number(d.totalUsd) || 0;
    const factorSaldo = total > 0 && mUsd < total - 0.005 ? mUsd / total : 1;
    const des = (d.desgloseProveedores ?? []).filter(Boolean);
    const multiProv = des.length > 1;
    const tasaCuenta = Number(d.tasaBs) || 0;
    const desgloseSubHtml = multiProv && cfg.incluirDesgloseProveedores !== false
      ? `<div style="margin-top:4px;padding-top:4px;border-top:1px dashed #cbd5e1;font-size:9.5px">${des.map((g, gi) => {
          const gUsd = Math.round((Number(g.totalUsd) || 0) * factorSaldo * 100) / 100;
          const gBsBase = Number(g.totalBs) > 0 ? Number(g.totalBs) : tasaCuenta > 0 ? (Number(g.totalUsd) || 0) * tasaCuenta : 0;
          const gBs = Math.round(gBsBase * factorSaldo * 100) / 100;
          const met = resumenBancoEnLinea(g.banco, g.pago, d.condiciones) || 'Sin método de pago registrado';
          return `<div style="margin-bottom:3px"><b>${i + 1}.${gi + 1} 🏭 ${esc(txt(g.proveedor))}</b> — <b>USD ${esc(montoEs(gUsd))}</b>${gBs > 0 ? ` (Bs ${esc(montoEs(gBs))})` : ''}<br/><span style="color:#0F766E">💳 ${esc(met)}</span></div>`;
        }).join('')}</div>`
      : (() => {
          const unico = des[0];
          const met = resumenBancoEnLinea(d.banco || unico?.banco, unico?.pago, d.condiciones);
          return met ? `<div style="margin-top:2px;font-size:9.5px;color:#0F766E">💳 ${esc(met)}</div>` : '';
        })();
    return `<tr>
      <td style="text-align:center">${i + 1}</td>
      ${cfg.incluirOrden ? `<td><b>${esc(txt(d.orden))}</b></td>` : ''}
      <td><b>${esc(nombreProveedorResuelto(d))}</b>${desgloseSubHtml}</td>
      ${cfg.incluirDetalle ? `<td>${esc(txt(d.detalle) || '—')}</td>` : ''}
      ${cfg.incluirCondiciones ? `<td>${esc(txt(d.condiciones) || '—')}</td>` : ''}
      <td style="text-align:right;white-space:nowrap"><b>USD ${esc(montoEs(mUsd))}</b></td>
      ${cfg.incluirBs ? `<td style="text-align:right;white-space:nowrap">${mBs > 0 ? `Bs ${esc(montoEs(mBs))}` : '—'}</td>` : ''}
    </tr>`;
  }).join('');

  const nColsAntes = 2 + (cfg.incluirOrden ? 1 : 0) + (cfg.incluirDetalle ? 1 : 0) + (cfg.incluirCondiciones ? 1 : 0);

  const css = `
    .tes-res{display:flex;gap:10px;margin:0 0 12px}
    .tes-kpi{flex:1;border:1px solid #D4DCE5;border-top:3px solid #1E3A5F;border-radius:6px;padding:8px;text-align:center;background:#FAFBFD}
    .tes-kpi .v{font-size:16px;font-weight:900;color:#1E3A5F}
    .tes-kpi .l{font-size:9px;font-weight:700;color:#68757F;margin-top:3px}
    table.tes{width:100%;border-collapse:collapse;font-size:10.5px}
    table.tes th{background:#1E3A5F;color:#fff;padding:6px;text-align:left;font-size:9.5px}
    table.tes td{border:1px solid #DDE4EC;padding:5px 6px;vertical-align:top}
    table.tes tfoot td{background:#EDF2F7;font-weight:900;color:#1E3A5F;border-top:2px solid #1E3A5F}
  `;

  const body = `
    <div class="tes-res">
      <div class="tes-kpi"><div class="v">${cuentas.length}</div><div class="l">CUENTAS POR PAGAR</div></div>
      <div class="tes-kpi"><div class="v">$ ${esc(montoEs(totalUsd))}</div><div class="l">TOTAL PENDIENTE (USD)</div></div>
      ${cfg.incluirBs && totalBs > 0 ? `<div class="tes-kpi"><div class="v">Bs ${esc(montoEs(totalBs))}</div><div class="l">EQUIVALENTE EN BS</div></div>` : ''}
    </div>
    <table class="tes">
      <thead>
        <tr>
          <th style="text-align:center;width:32px">#</th>
          ${cfg.incluirOrden ? '<th>Orden / Doc</th>' : ''}
          <th>Proveedor / Beneficiario</th>
          ${cfg.incluirDetalle ? '<th>Concepto / Detalle</th>' : ''}
          ${cfg.incluirCondiciones ? '<th>Condiciones</th>' : ''}
          <th style="text-align:right">Monto (USD)</th>
          ${cfg.incluirBs ? '<th style="text-align:right">Monto (Bs)</th>' : ''}
        </tr>
      </thead>
      <tbody>${filas}</tbody>
      <tfoot>
        <tr>
          <td colspan="${nColsAntes}" style="text-align:right">Total (${cuentas.length}):</td>
          <td style="text-align:right">$ ${esc(montoEs(totalUsd))}</td>
          ${cfg.incluirBs ? `<td style="text-align:right">${totalBs > 0 ? `Bs ${esc(montoEs(totalBs))}` : '—'}</td>` : ''}
        </tr>
      </tfoot>
    </table>
  `;

  return pdfDocument({
    title: 'REPORTE DE TESORERÍA — PENDIENTES POR PAGAR',
    subtitle: `${esc(empHeader)} · ${esc(rangoHeader)}`,
    extraCss: css,
    body,
    logos: {
      bcv: op.logoBcv ?? true,
      sos: op.logoSos ?? true,
      golden: op.logoGolden ?? false,
      renace: op.logoRenace ?? false,
      jhenzaen: op.logoJhenzaen ?? false,
    },
    marcaTexto: op.marcaTexto ?? true,
  });
}

// ── 3) ⚖️ RESUMEN DE ÓRDENES POR PAGAR CON DECISIÓN / MOTIVO ──────────────────

export function claveCuentaDecision(d: DatosMensajeCuenta, idx = 0): string {
  return txt(d.id) || txt(d.orden) || `${txt(d.proveedor)}-${idx}`;
}

export function textoMotivoDecision(dec?: DecisionCuentaPago | null): string {
  if (!dec || dec.motivo === 'si') return '✅ *Se pagará*';
  if (dec.motivo === 'sin_fondos') return '⏸ *No se pagará* · Sin fondos en estos momentos';
  if (dec.motivo === 'esperando_jefe') return '⏸ *No se pagará* · Esperando respuestas por el jefe';
  const otro = txt(dec.motivoOtro) || 'En espera de confirmación';
  return `⏸ *No se pagará* · ${otro}`;
}

export function textoMotivoDecisionPlano(dec?: DecisionCuentaPago | null): string {
  return textoMotivoDecision(dec).replace(/\*/g, '');
}

/**
 * Construye el Resumen de Cuentas por Pagar con decisión y motivo por cada cuenta
 * («✅ Se pagará» vs «⏸ No se pagará · <motivo>»), totalizando cuánto se pagará
 * y cuánto queda en espera (como en Mineral Group Guayana y Golden Touch).
 */
export function construirResumenDecisionCuentas(
  lista: DatosMensajeCuenta[],
  decisiones: Record<string, DecisionCuentaPago>,
  op?: {
    incluirDetalle?: boolean;
    incluirPersonas?: boolean;
    incluirCondiciones?: boolean;
    incluirBs?: boolean;
    incluirEmpresa?: boolean;
    fechaHoraTexto?: string;
  },
): string {
  const cuentas = (lista || []).filter(Boolean);
  const incDetalle = op?.incluirDetalle !== false;
  const incPersonas = Boolean(op?.incluirPersonas);
  const incCondiciones = Boolean(op?.incluirCondiciones);
  const incBs = Boolean(op?.incluirBs);
  const incEmpresa = op?.incluirEmpresa !== false;

  const ahora = new Date();
  const dd = String(ahora.getDate()).padStart(2, '0');
  const mm = String(ahora.getMonth() + 1).padStart(2, '0');
  const yyyy = ahora.getFullYear();
  const fechaGen = txt(op?.fechaHoraTexto) || `${dd}/${mm}/${yyyy}`;

  const empresas = Array.from(new Set(cuentas.map((d) => txt(d.empresa)).filter(Boolean)));
  const L: string[] = [
    '🧾 *RESUMEN · CUENTAS POR PAGAR*',
    `📅 *Fecha:* ${fechaGen}`,
  ];
  if (incEmpresa && empresas.length > 0) {
    L.push(`🏢 *${empresas.length === 1 ? empresas[0].toUpperCase() : empresas.join(' / ').toUpperCase()}*`);
  }
  L.push('');

  if (cuentas.length === 0) {
    L.push('_Sin cuentas seleccionadas._');
    return L.join('\n');
  }

  let totalUsd = 0;
  let sePaganCount = 0;
  let sePaganUsd = 0;
  let sePaganBs = 0;
  let noPaganCount = 0;
  let noPaganUsd = 0;
  let noPaganBs = 0;

  cuentas.forEach((d, idx) => {
    const k = claveCuentaDecision(d, idx);
    const dec = decisiones[k] ?? { motivo: 'si' as const };
    const mUsd = montoAPagarDe(d);
    const mBs = montoBsAPagarDe(d);
    totalUsd += mUsd;

    if (dec.motivo === 'si') {
      sePaganCount += 1;
      sePaganUsd += mUsd;
      sePaganBs += mBs;
    } else {
      noPaganCount += 1;
      noPaganUsd += mUsd;
      noPaganBs += mBs;
    }

    const ord = txt(d.orden);
    const des = (d.desgloseProveedores ?? []).filter(Boolean);
    const multiProv = des.length > 1;
    const prov = nombreProveedorResuelto(d) || 'PROVEEDOR';
    const urgente = d.prioridad === 'alta' ? ' 🔴' : '';
    const total = Number(d.totalUsd) || 0;
    const factorSaldo = total > 0 && mUsd < total - 0.005 ? mUsd / total : 1;
    L.push(`${idx + 1}. 🔹 ${ord ? `*${ord}* · ` : ''}${prov}${urgente}`);
    if (incDetalle && txt(d.detalle)) {
      L.push(`   📝 _${txt(d.detalle)}_`);
    }
    if (incPersonas) {
      const pPers = [
        txt(d.solicita) ? `🙋 Solicita: ${txt(d.solicita)}` : '',
        txt(d.autorizo) ? `👔 Autorizó: ${txt(d.autorizo)}` : '',
      ].filter(Boolean);
      if (pPers.length > 0) L.push(`   ${pPers.join(' · ')}`);
    }
    if (incCondiciones && txt(d.condiciones)) {
      L.push(`   🤝 Condiciones: ${txt(d.condiciones)}`);
    }
    const bsInline = incBs && mBs > 0 ? ` _(≈ Bs ${montoEs(mBs)})_` : '';
    L.push(`   💵 *A pagar:* $${montoEs(mUsd)}${bsInline} · ${textoMotivoDecision(dec)}`);
    if (multiProv) {
      const tasaCuenta = Number(d.tasaBs) || 0;
      L.push(`   💳 *Desglose por proveedor (${des.length}):*`);
      des.forEach((g, gi) => {
        const gUsd = Math.round((Number(g.totalUsd) || 0) * factorSaldo * 100) / 100;
        const gBsBase = Number(g.totalBs) > 0 ? Number(g.totalBs) : tasaCuenta > 0 ? (Number(g.totalUsd) || 0) * tasaCuenta : 0;
        const gBs = Math.round(gBsBase * factorSaldo * 100) / 100;
        const met = resumenBancoEnLinea(g.banco, g.pago, d.condiciones) || 'Sin método de pago registrado';
        L.push(`   • ${idx + 1}.${gi + 1} 🏭 *${txt(g.proveedor)}*: *$${montoEs(gUsd)}*${gBs > 0 ? ` (Bs ${montoEs(gBs)})` : ''} · 💳 ${met}`);
      });
    } else if (des.length === 1 || d.banco) {
      const unico = des[0];
      const met = resumenBancoEnLinea(d.banco || unico?.banco, unico?.pago, d.condiciones);
      if (met) {
        L.push(`   💳 *Método de pago:* ${met}`);
      }
    }
  });

  L.push('');
  L.push('━━━━━━━━━━━━━━━━━━━━');
  L.push(`💰 *Total evaluado (${cuentas.length} cuenta${cuentas.length === 1 ? '' : 's'}):* *$${montoEs(totalUsd)}*`);
  L.push(
    `✅ *Se pagarán (${sePaganCount}):* *$${montoEs(sePaganUsd)}*${incBs && sePaganBs > 0 ? ` _(≈ Bs ${montoEs(sePaganBs)})_` : ''}`,
  );
  L.push(
    `⏸ *No se pagarán (${noPaganCount}):* *$${montoEs(noPaganUsd)}*${incBs && noPaganBs > 0 ? ` _(≈ Bs ${montoEs(noPaganBs)})_` : ''}`,
  );

  return L.join('\n');
}

export function resumenDecisionCuentasHtml(
  lista: DatosMensajeCuenta[],
  decisiones: Record<string, DecisionCuentaPago>,
  op: Partial<OpcionesMensajeCuenta>,
): string {
  const cuentas = (lista || []).filter(Boolean);
  let totalUsd = 0;
  let sePaganCount = 0;
  let sePaganUsd = 0;
  let noPaganCount = 0;
  let noPaganUsd = 0;

  const filas = cuentas.map((d, idx) => {
    const k = claveCuentaDecision(d, idx);
    const dec = decisiones[k] ?? { motivo: 'si' as const };
    const mUsd = montoAPagarDe(d);
    totalUsd += mUsd;
    const esSi = dec.motivo === 'si';
    if (esSi) {
      sePaganCount += 1;
      sePaganUsd += mUsd;
    } else {
      noPaganCount += 1;
      noPaganUsd += mUsd;
    }
    const colorEstado = esSi ? '#15803D' : '#B45309';
    const bgEstado = esSi ? '#DCFCE7' : '#FEF3C7';
    const des = (d.desgloseProveedores ?? []).filter(Boolean);
    const multiProv = des.length > 1;
    const total = Number(d.totalUsd) || 0;
    const factorSaldo = total > 0 && mUsd < total - 0.005 ? mUsd / total : 1;
    const tasaCuenta = Number(d.tasaBs) || 0;
    const subProvHtml = multiProv
      ? `<div style="margin-top:4px;padding-top:4px;border-top:1px dashed #cbd5e1;font-size:9px">${des.map((g, gi) => {
          const gUsd = Math.round((Number(g.totalUsd) || 0) * factorSaldo * 100) / 100;
          const gBsBase = Number(g.totalBs) > 0 ? Number(g.totalBs) : tasaCuenta > 0 ? (Number(g.totalUsd) || 0) * tasaCuenta : 0;
          const gBs = Math.round(gBsBase * factorSaldo * 100) / 100;
          const met = resumenBancoEnLinea(g.banco, g.pago, d.condiciones) || 'Sin método de pago registrado';
          return `<div style="margin-bottom:2px"><b>${idx + 1}.${gi + 1} 🏭 ${esc(txt(g.proveedor))}:</b> $${esc(montoEs(gUsd))}${gBs > 0 ? ` (Bs ${esc(montoEs(gBs))})` : ''} · <span style="color:#0F766E">💳 ${esc(met)}</span></div>`;
        }).join('')}</div>`
      : (() => {
          const unico = des[0];
          const met = resumenBancoEnLinea(d.banco || unico?.banco, unico?.pago, d.condiciones);
          return met ? `<div style="margin-top:2px;font-size:9px;color:#0F766E">💳 ${esc(met)}</div>` : '';
        })();
    return `<tr>
      <td style="text-align:center">${idx + 1}</td>
      <td><b>${esc(txt(d.orden))}</b></td>
      <td><b>${esc(nombreProveedorResuelto(d))}</b>${subProvHtml}</td>
      <td>${esc(txt(d.detalle) || '—')}</td>
      <td style="text-align:right;white-space:nowrap"><b>$${esc(montoEs(mUsd))}</b></td>
      <td><span style="display:inline-block;padding:2px 6px;border-radius:4px;background:${bgEstado};color:${colorEstado};font-weight:800;font-size:9.5px">${esc(textoMotivoDecisionPlano(dec))}</span></td>
    </tr>`;
  }).join('');

  const css = `
    .dec-kpis{display:flex;gap:10px;margin:0 0 12px}
    .dec-kpi{flex:1;border:1px solid #D4DCE5;border-top:3px solid #1E3A5F;border-radius:6px;padding:8px;text-align:center;background:#FAFBFD}
    .dec-kpi.ok{border-top-color:#15803D}
    .dec-kpi.wait{border-top-color:#B45309}
    .dec-kpi .v{font-size:16px;font-weight:900;color:#1E3A5F}
    .dec-kpi.ok .v{color:#15803D}
    .dec-kpi.wait .v{color:#B45309}
    .dec-kpi .l{font-size:9px;font-weight:700;color:#68757F;margin-top:3px}
    table.dec{width:100%;border-collapse:collapse;font-size:10px}
    table.dec th{background:#1E3A5F;color:#fff;padding:6px;text-align:left;font-size:9px}
    table.dec td{border:1px solid #DDE4EC;padding:5px 6px;vertical-align:top}
  `;

  const body = `
    <div class="dec-kpis">
      <div class="dec-kpi"><div class="v">$${esc(montoEs(totalUsd))}</div><div class="l">TOTAL EVALUADO (${cuentas.length})</div></div>
      <div class="dec-kpi ok"><div class="v">$${esc(montoEs(sePaganUsd))}</div><div class="l">✅ SE PAGARÁN (${sePaganCount})</div></div>
      <div class="dec-kpi wait"><div class="v">$${esc(montoEs(noPaganUsd))}</div><div class="l">⏸ NO SE PAGARÁN (${noPaganCount})</div></div>
    </div>
    <table class="dec">
      <thead>
        <tr>
          <th style="text-align:center;width:28px">#</th>
          <th>Orden</th>
          <th>Proveedor</th>
          <th>Concepto / Detalle</th>
          <th style="text-align:right">A pagar</th>
          <th>Decisión / Motivo</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  `;

  return pdfDocument({
    title: 'RESUMEN · CUENTAS POR PAGAR (DECISIÓN DE PAGO)',
    subtitle: `Se pagarán: ${sePaganCount} ($${montoEs(sePaganUsd)}) · En espera: ${noPaganCount} ($${montoEs(noPaganUsd)})`,
    extraCss: css,
    body,
    logos: {
      bcv: op.logoBcv ?? true,
      sos: op.logoSos ?? true,
      golden: op.logoGolden ?? false,
      renace: op.logoRenace ?? false,
      jhenzaen: op.logoJhenzaen ?? false,
    },
    marcaTexto: op.marcaTexto ?? true,
  });
}
