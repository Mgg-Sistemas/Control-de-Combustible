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
    .trim();
}
