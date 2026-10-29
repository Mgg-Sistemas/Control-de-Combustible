// 💳 Gestión de Recibos y Comprobantes de Pago para Cuentas por Pagar y Requerimientos
// Permite adjuntar y visualizar soportes de pago (transferencias bancarias, recibos de caja, capture)
// con total resiliencia y compatibilidad sin romper esquemas de base de datos.

import type { Cuenta, CuentaAbono } from '../types/database.ts';

export interface ReciboPagoInfo {
  url: string | null;
  tipo: 'image' | 'pdf';
  nombre?: string | null;
  fecha?: string | null;
  referencia?: string | null;
  monto?: number | null;
  subidoPor?: string | null;
  subidoAt?: string | null;
}

/**
 * Extrae el recibo o comprobante de pago guardado en una cuenta
 */
export function extraerReciboPagoCuenta(c?: Partial<Cuenta> | null): ReciboPagoInfo | null {
  if (!c) return null;

  // 1. Si la tabla en Supabase tiene columna comprobante_url (o alias futuro)
  const anyC = c as any;
  if (anyC.comprobante_url || anyC.recibo_pago_url) {
    return {
      url: anyC.comprobante_url || anyC.recibo_pago_url,
      tipo: anyC.comprobante_tipo === 'pdf' ? 'pdf' : 'image',
      nombre: anyC.comprobante_nombre || 'Recibo de pago',
      referencia: anyC.documento || null,
      fecha: anyC.settled_at?.slice(0, 10) || null,
    };
  }

  // 2. Extraer de tag en nota: [RECIBO_PAGO: Url: ... | Tipo: ... | Nombre: ... | Fecha: ... | Ref: ... | SubidoPor: ... | SubidoAt: ...]
  const nota = c.nota || '';
  const match = nota.match(/\[RECIBO_PAGO:\s*Url:\s*([^|]*)\|\s*Tipo:\s*([^|]*)\|\s*Nombre:\s*([^|]*)\|\s*Fecha:\s*([^|]*)\|\s*Ref:\s*([^|]*)\|\s*SubidoPor:\s*([^|]*)\|\s*SubidoAt:\s*([^\]]*)\]/i);
  if (match) {
    const url = match[1].trim();
    if (url) {
      return {
        url,
        tipo: (match[2].trim() as any) === 'pdf' ? 'pdf' : 'image',
        nombre: match[3].trim() || 'Recibo de pago',
        fecha: match[4].trim() || null,
        referencia: match[5].trim() || null,
        subidoPor: match[6].trim() || null,
        subidoAt: match[7].trim() || null,
      };
    }
  }

  return null;
}

/**
 * Empaqueta o actualiza la etiqueta de recibo de pago dentro de la nota de una cuenta
 */
export function inyectarReciboPagoEnNota(
  notaActual: string | null | undefined,
  recibo: ReciboPagoInfo | null
): string | null {
  let base = (notaActual || '').replace(/\[RECIBO_PAGO:[^\]]+\]/gi, '').trim();
  if (!recibo || !recibo.url) return base || null;

  const tag = `[RECIBO_PAGO: Url: ${recibo.url} | Tipo: ${recibo.tipo || 'image'} | Nombre: ${recibo.nombre || 'Recibo de pago'} | Fecha: ${recibo.fecha || ''} | Ref: ${recibo.referencia || ''} | SubidoPor: ${recibo.subidoPor || ''} | SubidoAt: ${recibo.subidoAt || new Date().toISOString()}]`;
  return base ? `${base}\n${tag}` : tag;
}

/**
 * Extrae el soporte de un abono individual
 */
export function extraerComprobanteAbono(a?: Partial<CuentaAbono> | null): ReciboPagoInfo | null {
  if (!a) return null;
  const anyA = a as any;
  if (anyA.comprobante_url) {
    return {
      url: anyA.comprobante_url,
      tipo: anyA.comprobante_tipo === 'pdf' ? 'pdf' : 'image',
      nombre: anyA.comprobante_nombre || 'Comprobante de abono',
      fecha: a.fecha || null,
      referencia: a.referencia || null,
    };
  }

  const nota = a.nota || '';
  const match = nota.match(/\[COMPROBANTE_ABONO:\s*Url:\s*([^|]*)\|\s*Tipo:\s*([^|]*)\|\s*Nombre:\s*([^\]]*)\]/i);
  if (match) {
    const url = match[1].trim();
    if (url) {
      return {
        url,
        tipo: (match[2].trim() as any) === 'pdf' ? 'pdf' : 'image',
        nombre: match[3].trim() || 'Comprobante de abono',
        fecha: a.fecha || null,
        referencia: a.referencia || null,
      };
    }
  }
  return null;
}

/**
 * Inyecta el soporte de un abono individual en su nota
 */
export function inyectarComprobanteEnAbonoNota(
  notaActual: string | null | undefined,
  comp: { url: string; tipo?: 'image' | 'pdf'; nombre?: string } | null
): string | null {
  let base = (notaActual || '').replace(/\[COMPROBANTE_ABONO:[^\]]+\]/gi, '').trim();
  if (!comp || !comp.url) return base || null;

  const tag = `[COMPROBANTE_ABONO: Url: ${comp.url} | Tipo: ${comp.tipo || 'image'} | Nombre: ${comp.nombre || 'Comprobante de abono'}]`;
  return base ? `${base}\n${tag}` : tag;
}

/**
 * Limpia la nota para vista del usuario quitando etiquetas técnicas de comprobantes
 */
export function limpiarNotaCuentasVisual(nota?: string | null): string {
  if (!nota) return '';
  return nota
    .replace(/\[RECIBO_PAGO:[^\]]+\]/gi, '')
    .replace(/\[COMPROBANTE_ABONO:[^\]]+\]/gi, '')
    .replace(/\[EMPRESA:[^\]]+\]/gi, '')
    .replace(/\[CONDICIONES_PAGO:[^\]]*\]/gi, '')
    .trim();
}

// ── Condiciones de pago (chips rápidos + empaquetado resiliente) ─────────────

export const CONDICIONES_PAGO_CHIPS = [
  'CONTADO',
  '50% ADELANTO / 50% ENTREGA',
  'CONTRA FACTURA',
  'CRÉDITO 7 DÍAS',
  'CRÉDITO 15 DÍAS',
  'CRÉDITO 30 DÍAS',
  'ZELLE / DIVISAS',
  'TRANSFERENCIA BS (BCV)',
] as const;

const CHIPS_PLAZO = new Set([
  'CONTADO',
  '50% ADELANTO / 50% ENTREGA',
  'CONTRA FACTURA',
  'CRÉDITO 7 DÍAS',
  'CRÉDITO 15 DÍAS',
  'CRÉDITO 30 DÍAS',
]);

/**
 * Si el chip implica una cantidad de días de crédito sobre la fecha de emisión, devuelve los días.
 */
export function detectarDiasCreditoChip(chip: string): number | null {
  const u = (chip || '').trim().toUpperCase();
  if (u === 'CONTADO') return 0;
  if (u === 'CRÉDITO 7 DÍAS' || u === 'CREDITO 7 DIAS') return 7;
  if (u === 'CRÉDITO 15 DÍAS' || u === 'CREDITO 15 DIAS') return 15;
  if (u === 'CRÉDITO 30 DÍAS' || u === 'CREDITO 30 DIAS') return 30;
  return null;
}

/**
 * Alterna o combina inteligentemente un chip rápido dentro del campo de condiciones de pago.
 */
export function toggleChipCondicionPago(actual: string, chip: string): string {
  const c = chip.trim().toUpperCase();
  if (!c) return actual;
  const partes = (actual || '')
    .split(/\s*·\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const idx = partes.findIndex((p) => p.toUpperCase() === c);
  if (idx >= 0) {
    partes.splice(idx, 1);
    return partes.join(' · ');
  }
  if (CHIPS_PLAZO.has(c)) {
    const sinOtroPlazo = partes.filter((p) => !CHIPS_PLAZO.has(p.toUpperCase()));
    return [c, ...sinOtroPlazo].join(' · ');
  }
  return [...partes, c].join(' · ');
}

const REGEX_TAG_CONDICIONES = /\[CONDICIONES_PAGO:\s*([^\]]*)\]/i;
const REGEX_REMOVE_CONDICIONES = /\[CONDICIONES_PAGO:[^\]]*\]/gi;

/**
 * Extrae las condiciones de pago desde un texto/nota/observaciones.
 */
export function extraerCondicionesPago(texto?: string | null): string {
  if (!texto) return '';
  const match = String(texto).match(REGEX_TAG_CONDICIONES);
  return match && match[1] ? match[1].trim() : '';
}

/**
 * Elimina únicamente el tag [CONDICIONES_PAGO: ...] dejando intactos otros tags o el texto base.
 */
export function limpiarCondicionesPagoDeNota(texto?: string | null): string {
  if (!texto) return '';
  return String(texto).replace(REGEX_REMOVE_CONDICIONES, '').trim();
}

/**
 * Inyecta o actualiza el tag [CONDICIONES_PAGO: ...] dentro de una nota/observación,
 * preservando cualquier otro tag ([EMPRESA:...], [RECIBO_PAGO:...], etc.).
 */
export function inyectarCondicionesPagoEnNota(
  notaActual: string | null | undefined,
  condiciones: string | null | undefined,
): string | null {
  const base = limpiarCondicionesPagoDeNota(notaActual);
  const condLimpia = (condiciones ?? '').replace(/\]/g, ')').trim();
  if (!condLimpia) return base || null;
  const tag = `[CONDICIONES_PAGO: ${condLimpia}]`;
  return base ? `${base}\n${tag}` : tag;
}

export interface ContextoCondicionesCuenta {
  requirements?: readonly {
    id: string;
    code?: string | null;
    codigo?: number | null;
    observaciones?: string | null;
    note?: string | null;
    condiciones_pago?: string | null;
  }[];
  orders?: readonly {
    id: string;
    note?: string | null;
    condiciones_pago?: string | null;
  }[];
}

function limpiarTextoRequerimientoBasico(obs?: string | null): string {
  if (!obs) return '';
  return String(obs)
    .replace(/\[PROVEEDOR SUGERIDO(?:\s*\([^)]*\))?:[^\]]+\]/gi, '')
    .replace(/\[FACTURA PROVEEDOR:[^\]]+\]/gi, '')
    .replace(/\[RECIBO PAGO:[^\]]+\]/gi, '')
    .replace(/\[DESPACHO ALMACEN:[^\]]+\]/gi, '')
    .replace(/\[RECEPCIÓN ALMACÉN:[^\]]+\]/gi, '')
    .replace(/\[CONDICIONES_PAGO:[^\]]*\]/gi, '')
    .replace(/\[\[FORMATOS_ADJUNTOS:[\s\S]*?:FIN_FORMATOS\]\]/gi, '')
    .replace(/\[\[COTIZACIONES_COMPLETAS:[\s\S]*?:FIN_COTIZACIONES\]\]/gi, '')
    .trim();
}

/**
 * Resuelve tanto las Condiciones de Pago como la Nota limpia de una cuenta,
 * cruzando automáticamente con el Requerimiento u Orden de Compra vinculada.
 */
export function resolverCondicionesYNotaCuenta(
  c: {
    id?: string;
    order_id?: string | null;
    inventory_requirement_id?: string | null;
    concepto?: string | null;
    documento?: string | null;
    nota?: string | null;
    condiciones_pago?: string | null;
  } | null | undefined,
  contexto?: ContextoCondicionesCuenta,
): { condicionesPago: string; notaLimpia: string } {
  if (!c) return { condicionesPago: '', notaLimpia: '' };

  let condicionesPago = ((c as any).condiciones_pago ?? '').trim() || extraerCondicionesPago(c.nota);
  const notaPropia = limpiarNotaCuentasVisual(c.nota);
  // Ignorar el texto automático del trigger SQL si no aporta nota real del usuario
  const esNotaAutoTrigger = /^Generada automáticamente desde Requerimiento REQ-\d+\. El monto se sincroniza con los ítems aprobados\.?$/i.test(notaPropia);
  let notaLimpia = esNotaAutoTrigger ? '' : notaPropia;

  // Buscar requerimiento vinculado
  const reqs = contexto?.requirements ?? [];
  if (reqs.length > 0) {
    let req = c.inventory_requirement_id
      ? reqs.find((r) => r.id === c.inventory_requirement_id)
      : undefined;
    if (!req && c.order_id) {
      req = reqs.find((r) => r.id === c.order_id);
    }
    if (!req) {
      const textoBusqueda = `${c.documento || ''} ${c.concepto || ''} ${c.nota || ''}`;
      const matchReq = textoBusqueda.match(/\b(REQ-\d+)\b/i);
      if (matchReq) {
        const codeUpper = matchReq[1].toUpperCase();
        req = reqs.find((r) => String(r.code || '').toUpperCase() === codeUpper);
      }
    }
    if (req) {
      if (!condicionesPago) {
        condicionesPago =
          ((req as any).condiciones_pago ?? '').trim() ||
          extraerCondicionesPago(req.observaciones) ||
          extraerCondicionesPago(req.note);
      }
      if (!notaLimpia) {
        const obsReq = limpiarTextoRequerimientoBasico(req.observaciones);
        const noteReq = limpiarTextoRequerimientoBasico(req.note);
        notaLimpia = obsReq || noteReq || '';
      }
    }
  }

  // Fallback a orden de compra vinculada
  if (!condicionesPago && c.order_id && contexto?.orders?.length) {
    const ord = contexto.orders.find((o) => o.id === c.order_id);
    if (ord) {
      condicionesPago = ((ord as any).condiciones_pago ?? '').trim() || extraerCondicionesPago(ord.note);
    }
  }

  return { condicionesPago, notaLimpia };
}
