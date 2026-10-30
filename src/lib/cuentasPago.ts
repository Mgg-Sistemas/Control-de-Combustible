// 💳 Gestión de Recibos y Comprobantes de Pago para Cuentas por Pagar y Requerimientos
// Permite adjuntar y visualizar soportes de pago (transferencias bancarias, recibos de caja, capture)
// con total resiliencia y compatibilidad sin romper esquemas de base de datos.

import type { Cuenta, CuentaAbono, Supplier } from '../types/database';
import type { ArchivoSoporte, FacturaData } from './requerimientoExpediente';
import { extraerCapturaPago, limpiarNotasUsuario, type CapturaPagoInfo } from './proveedorPago';

export type { ArchivoSoporte, FacturaData, CapturaPagoInfo };

export interface ReciboPagoInfo {
  url: string | null;
  tipo: 'image' | 'pdf';
  nombre?: string | null;
  fecha?: string | null;
  referencia?: string | null;
  metodo?: string | null;
  nota?: string | null;
  monto?: number | null;
  subidoPor?: string | null;
  subidoAt?: string | null;
  archivos?: ArchivoSoporte[];
}

export interface AprobacionCxpInfo {
  estado: 'pendiente' | 'aprobado';
  aprobadoPor?: string | null;
  aprobadoPorId?: string | null;
  fecha?: string | null;
}

function cleanField(s?: string | null): string {
  return String(s ?? '')
    .replace(/\|/g, '/')
    .replace(/\]/g, ')')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function serializarArchivos(archivos?: ArchivoSoporte[] | null): string {
  if (!Array.isArray(archivos) || archivos.length === 0) return '';
  const validos = archivos
    .filter((a) => a && a.url)
    .map((a) => ({
      url: String(a.url).trim(),
      tipo: a.tipo === 'pdf' ? ('pdf' as const) : ('image' as const),
      nombre: a.nombre ? String(a.nombre).trim() : null,
    }));
  if (validos.length === 0) return '';
  try {
    return encodeURIComponent(JSON.stringify(validos));
  } catch {
    return '';
  }
}

function parsearArchivos(
  encoded?: string | null,
  fallbackUrl?: string | null,
  fallbackTipo?: 'image' | 'pdf' | null,
  fallbackNombre?: string | null
): ArchivoSoporte[] {
  const raw = (encoded ?? '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(decodeURIComponent(raw));
      if (Array.isArray(parsed)) {
        const list = parsed
          .filter((a: any) => a && a.url)
          .map((a: any) => ({
            url: String(a.url).trim(),
            tipo: a.tipo === 'pdf' ? ('pdf' as const) : ('image' as const),
            nombre: a.nombre ? String(a.nombre).trim() : null,
          }));
        if (list.length > 0) return list;
      }
    } catch {}
  }
  if (fallbackUrl && fallbackUrl.trim()) {
    return [
      {
        url: fallbackUrl.trim(),
        tipo: fallbackTipo === 'pdf' ? 'pdf' : 'image',
        nombre: fallbackNombre || null,
      },
    ];
  }
  return [];
}

/**
 * Extrae el recibo o comprobante de pago guardado en una cuenta (soporta múltiples fotos/PDFs)
 */
export function extraerReciboPagoCuenta(c?: Partial<Cuenta> | null): ReciboPagoInfo | null {
  if (!c) return null;

  // 1. Extraer de tag en nota: [RECIBO_PAGO: Url: ... | Tipo: ... | Nombre: ... | Fecha: ... | Ref: ... | SubidoPor: ... | SubidoAt: ... | Metodo: ... | Nota: ... | Archivos: ...]
  const nota = c.nota || '';
  const match = nota.match(
    /\[RECIBO_PAGO:\s*Url:\s*([^|]*)\|\s*Tipo:\s*([^|]*)\|\s*Nombre:\s*([^|]*)\|\s*Fecha:\s*([^|]*)\|\s*Ref:\s*([^|]*)\|\s*SubidoPor:\s*([^|]*)\|\s*SubidoAt:\s*([^|\]]*)(?:\|\s*Metodo:\s*([^|\]]*))?(?:\|\s*Nota:\s*([^|\]]*))?(?:\|\s*Archivos:\s*([^\]]*))?\]/i
  );
  if (match) {
    const urlRaw = match[1].trim();
    const tipoRaw = (match[2].trim() as any) === 'pdf' ? ('pdf' as const) : ('image' as const);
    const nombreRaw = match[3].trim() || 'Recibo de pago';
    const ref = match[5].trim();
    const metodo = (match[8] ?? '').trim();
    const notaRec = (match[9] ?? '').trim();
    const archivos = parsearArchivos(match[10], urlRaw, tipoRaw, nombreRaw);
    const urlPrincipal = urlRaw || archivos[0]?.url || '';
    if (urlPrincipal || ref || notaRec || archivos.length > 0) {
      return {
        url: urlPrincipal || null,
        tipo: archivos[0]?.tipo || tipoRaw,
        nombre: archivos[0]?.nombre || nombreRaw,
        fecha: match[4].trim() || null,
        referencia: ref || null,
        subidoPor: match[6].trim() || null,
        subidoAt: match[7].trim() || null,
        metodo: metodo || null,
        nota: notaRec || null,
        archivos,
      };
    }
  }

  // 2. Si la tabla en Supabase tiene columna comprobante_url (o alias futuro)
  const anyC = c as any;
  if (anyC.comprobante_url || anyC.recibo_pago_url) {
    const u = anyC.comprobante_url || anyC.recibo_pago_url;
    const t = anyC.comprobante_tipo === 'pdf' ? ('pdf' as const) : ('image' as const);
    const n = anyC.comprobante_nombre || 'Recibo de pago';
    return {
      url: u,
      tipo: t,
      nombre: n,
      referencia: anyC.documento || null,
      fecha: anyC.settled_at?.slice(0, 10) || null,
      archivos: [{ url: u, tipo: t, nombre: n }],
    };
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
  const archivos = Array.isArray(recibo?.archivos) && recibo!.archivos!.length > 0
    ? recibo!.archivos!.filter((a) => a && a.url)
    : recibo?.url
      ? [{ url: recibo.url, tipo: (recibo.tipo === 'pdf' ? 'pdf' : 'image') as 'image' | 'pdf', nombre: recibo.nombre || 'Recibo de pago' }]
      : [];
  const primera = archivos[0] || null;
  if (!recibo || (!primera?.url && !recibo.referencia?.trim() && !recibo.nota?.trim())) return base || null;

  const encArchivos = serializarArchivos(archivos);
  const tag = `[RECIBO_PAGO: Url: ${cleanField(primera?.url || recibo.url)} | Tipo: ${primera?.tipo || recibo.tipo || 'image'} | Nombre: ${cleanField(primera?.nombre || recibo.nombre || 'Recibo de pago')} | Fecha: ${cleanField(recibo.fecha)} | Ref: ${cleanField(recibo.referencia)} | SubidoPor: ${cleanField(recibo.subidoPor)} | SubidoAt: ${cleanField(recibo.subidoAt || new Date().toISOString())} | Metodo: ${cleanField(recibo.metodo)} | Nota: ${cleanField(recibo.nota)} | Archivos: ${encArchivos}]`;
  return base ? `${base}\n${tag}` : tag;
}

/**
 * Extrae las facturas guardadas en una cuenta (soporta múltiples fotos / PDFs de factura)
 */
export function extraerFacturaCuenta(c?: Partial<Cuenta> | null): FacturaData | null {
  if (!c) return null;
  const nota = c.nota || '';
  const match = nota.match(
    /\[FACTURA_CUENTA:\s*Nro:\s*([^|]*)\|\s*Empresa:\s*([^|]*)\|\s*Fecha:\s*([^|]*)\|\s*Url:\s*([^|]*)\|\s*Tipo:\s*([^|]*)\|\s*Nombre:\s*([^|]*)\|\s*SubidaPor:\s*([^|]*)\|\s*SubidaAt:\s*([^|\]]*)(?:\|\s*Nota:\s*([^|\]]*))?(?:\|\s*Archivos:\s*([^\]]*))?\]/i
  );
  if (match) {
    const num = match[1].trim();
    const emp = match[2].trim();
    const urlRaw = match[4].trim() || c.factura_url || '';
    const tipoRaw = (match[5].trim() as any) === 'pdf' ? ('pdf' as const) : ('image' as const);
    const nombreRaw = match[6].trim() || 'Factura';
    const notaFac = (match[9] ?? '').trim();
    const archivos = parsearArchivos(match[10], urlRaw, tipoRaw, nombreRaw);
    const urlPrincipal = urlRaw || archivos[0]?.url || '';
    if (num || emp || urlPrincipal || notaFac || archivos.length > 0) {
      return {
        numero: num || c.documento || '',
        empresa: emp || '',
        fecha: match[3].trim() || c.fecha_emision || null,
        url: urlPrincipal || null,
        tipo: archivos[0]?.tipo || tipoRaw,
        nombre: archivos[0]?.nombre || nombreRaw,
        subidaPor: match[7].trim() || null,
        subidaAt: match[8].trim() || null,
        nota: notaFac || null,
        archivos,
      };
    }
  }
  if (c.factura_url) {
    const isPdf = /\.pdf($|\?)/i.test(c.factura_url);
    const t = isPdf ? ('pdf' as const) : ('image' as const);
    return {
      numero: c.documento || '',
      empresa: '',
      fecha: c.fecha_emision || null,
      url: c.factura_url,
      tipo: t,
      nombre: 'Factura adjunta',
      archivos: [{ url: c.factura_url, tipo: t, nombre: 'Factura adjunta' }],
    };
  }
  return null;
}

/**
 * Empaqueta los datos y archivos múltiples de la factura dentro de la nota de una cuenta
 */
export function inyectarFacturaEnCuentaNota(
  notaActual: string | null | undefined,
  factura: FacturaData | null
): string | null {
  let base = (notaActual || '').replace(/\[FACTURA_CUENTA:[^\]]+\]/gi, '').trim();
  const archivos = Array.isArray(factura?.archivos) && factura!.archivos!.length > 0
    ? factura!.archivos!.filter((a) => a && a.url)
    : factura?.url
      ? [{ url: factura.url, tipo: (factura.tipo === 'pdf' ? 'pdf' : 'image') as 'image' | 'pdf', nombre: factura.nombre || 'Factura' }]
      : [];
  const primera = archivos[0] || null;
  if (!factura || (!factura.numero?.trim() && !primera?.url && !factura.nota?.trim() && !factura.empresa?.trim())) {
    return base || null;
  }
  const encArchivos = serializarArchivos(archivos);
  const tag = `[FACTURA_CUENTA: Nro: ${cleanField(factura.numero)} | Empresa: ${cleanField(factura.empresa)} | Fecha: ${cleanField(factura.fecha)} | Url: ${cleanField(primera?.url || factura.url)} | Tipo: ${primera?.tipo || factura.tipo || 'image'} | Nombre: ${cleanField(primera?.nombre || factura.nombre || 'Factura')} | SubidaPor: ${cleanField(factura.subidaPor)} | SubidaAt: ${cleanField(factura.subidaAt || new Date().toISOString())} | Nota: ${cleanField(factura.nota)} | Archivos: ${encArchivos}]`;
  return base ? `${base}\n${tag}` : tag;
}

/**
 * Extrae el estado de aprobación de Gerencia General / Usuario Designado en Por Pagar
 */
export function extraerAprobacionCxp(texto?: string | null): AprobacionCxpInfo | null {
  if (!texto) return null;
  const match = String(texto).match(/\[APROBADO_CXP:\s*Estado:\s*([^|]*)\|\s*Por:\s*([^|]*)\|\s*Id:\s*([^|]*)\|\s*Fecha:\s*([^\]]*)\]/i);
  if (!match) return null;
  const est = match[1].trim().toLowerCase() === 'aprobado' ? 'aprobado' : 'pendiente';
  return {
    estado: est,
    aprobadoPor: match[2].trim() || null,
    aprobadoPorId: match[3].trim() || null,
    fecha: match[4].trim() || null,
  };
}

/**
 * Inyecta o actualiza el estado de aprobación en la nota de la cuenta o requerimiento
 */
export function inyectarAprobacionCxpEnNota(
  notaActual: string | null | undefined,
  info: AprobacionCxpInfo | null
): string | null {
  const base = String(notaActual ?? '').replace(/\[APROBADO_CXP:[^\]]*\]/gi, '').trim();
  if (!info) return base || null;
  const tag = `[APROBADO_CXP: Estado: ${info.estado} | Por: ${cleanField(info.aprobadoPor)} | Id: ${cleanField(info.aprobadoPorId)} | Fecha: ${cleanField(info.fecha || new Date().toISOString())}]`;
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
    .replace(/\[FACTURA_CUENTA:[^\]]+\]/gi, '')
    .replace(/\[APROBADO_CXP:[^\]]*\]/gi, '')
    .replace(/\[ENVIADO_CXP:[^\]]*\]/gi, '')
    .replace(/\[\[HISTORIAL_COMPRA:[\s\S]*?:FIN_HISTORIAL\]\]/gi, '')
    .replace(/\[COMPROBANTE_ABONO:[^\]]+\]/gi, '')
    .replace(/\[EMPRESA:[^\]]+\]/gi, '')
    .replace(/\[CONDICIONES_PAGO:[^\]]*\]/gi, '')
    .trim();
}

// ── Condiciones y Métodos de pago (chips rápidos + resolución integral) ──────

export const CONDICIONES_PAGO_CHIPS = [
  'CONTADO',
  '50% ADELANTO / 50% ENTREGA',
  'CONTRA FACTURA',
  'CRÉDITO 7 DÍAS',
  'CRÉDITO 15 DÍAS',
  'CRÉDITO 30 DÍAS',
  '🏦 TRANSFERENCIA BANCARIA',
  '📲 PAGO MÓVIL',
  '💵 EFECTIVO / DIVISAS $',
  '💸 ZELLE',
  '🪙 BINANCE / USDT',
  '🏛️ TASA BCV',
  '💶 TASA EURO',
] as const;

export const METODOS_PAGO_SOLO_CHIPS = [
  '🏦 TRANSFERENCIA BANCARIA',
  '📲 PAGO MÓVIL',
  '💵 EFECTIVO / DIVISAS $',
  '💸 ZELLE',
  '🪙 BINANCE / USDT',
  '💳 PUNTO / DÉBITO',
  '🏛️ TASA BCV',
  '💶 TASA EURO',
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
    .replace(/\[APROBADO_CXP:[^\]]*\]/gi, '')
    .replace(/\[ENVIADO_CXP:[^\]]*\]/gi, '')
    .replace(/\[ORIGEN:SOLICITUD\]/gi, '')
    .replace(/\[CONVERTIDO_EN_REQ\]/gi, '')
    .replace(/\[\[FORMATOS_ADJUNTOS:[\s\S]*?:FIN_FORMATOS\]\]/gi, '')
    .replace(/\[\[COTIZACIONES_COMPLETAS:[\s\S]*?:FIN_COTIZACIONES\]\]/gi, '')
    .replace(/\[\[HISTORIAL_COMPRA:[\s\S]*?:FIN_HISTORIAL\]\]/gi, '')
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

// ── Resolución integral de Métodos de Pago, Tasa y Datos Bancarios en Por Pagar ──

export interface DatosBancariosResumen {
  proveedorId: string | null;
  proveedorNombre: string;
  proveedorRif: string | null;
  proveedorTelefono: string | null;
  // Transferencia Bancaria Nacional
  banco: string | null;
  numeroCuenta: string | null;
  tipoCuenta: string | null;
  titular: string | null;
  rifTitular: string | null;
  // Pago Móvil
  pagoMovilBanco: string | null;
  pagoMovilTelefono: string | null;
  pagoMovilCedulaRif: string | null;
  // Digital / Cripto / Divisas / Zelle
  binanceId: string | null;
  instruccionesPago: string | null;
  capturaPago: CapturaPagoInfo | null;
}

export interface InfoMetodoPagoPorPagar {
  /** Chips de métodos de pago y tasas activas o detectadas */
  metodosActivos: string[];
  /** Condiciones comerciales (ej. CONTADO, CRÉDITO 15 DÍAS, 50% ADELANTO) */
  condicionesPago: string;
  /** Etiqueta destacada de tasa o moneda (ej. '💶 TASA EURO', '🏛️ TASA BCV', '💵 DIVISAS / USD') */
  tasaMonedaTexto: string | null;
  /** Alerta especial si exige pago a Tasa Euro u otra instrucción crítica */
  alertaTasaEspecial: string | null;
  /** Datos bancarios consolidados del proveedor principal */
  datosBancarios: DatosBancariosResumen;
  /** Proveedores adicionales si el requerimiento tiene ítems con distintos proveedores */
  proveedoresSecundarios: DatosBancariosResumen[];
  /** Indica si hay algún dato bancario o método registrado para pagar */
  tieneDatosBancarios: boolean;
  /** Texto formateado listo para copiar al portapapeles en 1 toque */
  resumenCopiable: string;
}

const MAP_METODO_ITEM_LABEL: Record<string, string> = {
  efectivo_usd: '💵 Efectivo / Divisas $',
  pago_movil: '📲 Pago Móvil / Transf. Bs',
  zelle: '💸 Zelle',
  transferencia_usd: '🏦 Transferencia $',
  transferencia: '🏦 Transferencia Bancaria',
  debito: '💳 Punto / Débito',
  binance: '🪙 Binance / USDT',
  credito: '⏳ Crédito',
};

function normNameKey(s?: string | null): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function construirDatosBancariosDeSupplier(
  sup: Supplier | null | undefined,
  fallbackNombre?: string | null,
): DatosBancariosResumen {
  const captura = extraerCapturaPago(sup);
  const notasLimpias = limpiarNotasUsuario(sup?.payment_notes);
  return {
    proveedorId: sup?.id ?? null,
    proveedorNombre: (sup?.name || fallbackNombre || 'Proveedor').trim(),
    proveedorRif: sup?.rif?.trim() || null,
    proveedorTelefono: sup?.phone?.trim() || null,
    banco: sup?.bank_name?.trim() || null,
    numeroCuenta: sup?.account_number?.trim() || null,
    tipoCuenta: sup?.account_type?.trim() || null,
    titular: sup?.account_holder?.trim() || null,
    rifTitular: sup?.account_id_doc?.trim() || sup?.rif?.trim() || null,
    pagoMovilBanco: sup?.pago_movil_bank?.trim() || null,
    pagoMovilTelefono: sup?.pago_movil_phone?.trim() || null,
    pagoMovilCedulaRif: sup?.pago_movil_id?.trim() || sup?.rif?.trim() || null,
    binanceId: sup?.binance_id?.trim() || null,
    instruccionesPago: notasLimpias || null,
    capturaPago: captura,
  };
}

export function tieneCoordenadasBancarias(d: DatosBancariosResumen): boolean {
  return Boolean(
    d.banco ||
      d.numeroCuenta ||
      d.pagoMovilTelefono ||
      d.pagoMovilBanco ||
      d.binanceId ||
      d.instruccionesPago ||
      d.capturaPago?.url,
  );
}

/**
 * Resuelve TODA la información de métodos de pago, condiciones, tasa/moneda y
 * datos bancarios del proveedor para mostrarla directamente en Por Pagar.
 */
export function resolverInfoMetodoPagoPorPagar(
  c: Partial<Cuenta> | null | undefined,
  contexto: {
    suppliers?: readonly Supplier[];
    requirements?: readonly any[];
    orders?: readonly any[];
    contraparteNombre?: string;
    condicionesPago?: string;
    notaLimpia?: string;
    tasaBcv?: number | null;
    saldoUsd?: number;
  },
): InfoMetodoPagoPorPagar {
  const suppliers = contexto.suppliers ?? [];
  const requirements = contexto.requirements ?? [];
  const contraparte = (contexto.contraparteNombre || c?.contraparte || 'Proveedor').trim();

  // 1. Localizar requerimiento vinculado
  let req: any = null;
  if (c && requirements.length > 0) {
    if (c.inventory_requirement_id) {
      req = requirements.find((r) => r.id === c.inventory_requirement_id) || null;
    }
    if (!req && c.order_id) {
      req = requirements.find((r) => r.id === c.order_id) || null;
    }
    if (!req) {
      const textoBusqueda = `${c.documento || ''} ${c.concepto || ''} ${c.nota || ''}`;
      const matchReq = textoBusqueda.match(/\b(REQ-\d+)\b/i);
      if (matchReq) {
        const codeUpper = matchReq[1].toUpperCase();
        req = requirements.find((r) => String(r.code || '').toUpperCase() === codeUpper) || null;
      }
    }
  }

  // 2. Localizar proveedor principal en `suppliers` (por ID o por nombre normalizado)
  let supplierPrincipal: Supplier | undefined;
  const supIdCandidato = c?.supplier_id || req?.supplier_id || null;
  if (supIdCandidato) {
    supplierPrincipal = suppliers.find((s) => s.id === supIdCandidato);
  }
  if (!supplierPrincipal && contraparte) {
    const keyTarget = normNameKey(contraparte);
    if (keyTarget && keyTarget !== 'SIN CONTRAPARTE' && keyTarget !== 'PROVEEDOR') {
      supplierPrincipal = suppliers.find((s) => normNameKey(s.name) === keyTarget);
    }
  }

  const datosBancarios = construirDatosBancariosDeSupplier(supplierPrincipal, contraparte);

  // 3. Detectar proveedores secundarios en ítems del requerimiento (si aplica)
  const proveedoresSecundarios: DatosBancariosResumen[] = [];
  const seenSupIds = new Set<string>();
  if (supplierPrincipal?.id) seenSupIds.add(supplierPrincipal.id);

  const reqItems: any[] = Array.isArray(req?.items) ? req.items : [];
  const metodosSet = new Set<string>();

  for (const it of reqItems) {
    const mpRaw = String(it?.metodo_pago || '').trim().toLowerCase();
    if (mpRaw && MAP_METODO_ITEM_LABEL[mpRaw]) {
      metodosSet.add(MAP_METODO_ITEM_LABEL[mpRaw]);
    } else if (mpRaw) {
      metodosSet.add(mpRaw.toUpperCase());
    }
    // Revisar cotizaciones del ítem si existen
    if (Array.isArray(it?.cotizaciones)) {
      for (const cot of it.cotizaciones) {
        const cotMp = String(cot?.metodo_pago || '').trim().toLowerCase();
        if (cotMp && MAP_METODO_ITEM_LABEL[cotMp]) {
          metodosSet.add(MAP_METODO_ITEM_LABEL[cotMp]);
        }
      }
    }
    const itSupId = it?.supplier_id ? String(it.supplier_id) : null;
    if (itSupId && !seenSupIds.has(itSupId)) {
      const secSup = suppliers.find((s) => s.id === itSupId);
      if (secSup) {
        seenSupIds.add(itSupId);
        const secDatos = construirDatosBancariosDeSupplier(secSup, secSup.name);
        if (tieneCoordenadasBancarias(secDatos)) {
          proveedoresSecundarios.push(secDatos);
        }
      }
    }
  }

  // 4. Detectar métodos disponibles según los campos cargados del proveedor
  if (datosBancarios.banco || datosBancarios.numeroCuenta) {
    metodosSet.add('🏦 Transferencia Bancaria');
  }
  if (datosBancarios.pagoMovilTelefono || datosBancarios.pagoMovilBanco) {
    metodosSet.add('📲 Pago Móvil');
  }
  if (datosBancarios.binanceId) {
    metodosSet.add('🪙 Binance / USDT');
  }

  // 5. Analizar condicionesPago, notaLimpia y notas del proveedor para detectar métodos y tasas
  const condStr = (contexto.condicionesPago || '').trim();
  const notaStr = (contexto.notaLimpia || '').trim();
  const textoCombinado = [
    condStr,
    notaStr,
    datosBancarios.instruccionesPago || '',
    c?.concepto || '',
    req?.note || '',
  ]
    .join(' ')
    .toUpperCase();

  if (/PAGO\s*M[OÓ]VIL/i.test(textoCombinado)) metodosSet.add('📲 Pago Móvil');
  if (/TRANSFERENCIA/i.test(textoCombinado)) metodosSet.add('🏦 Transferencia Bancaria');
  if (/ZELLE|BOFA/i.test(textoCombinado)) metodosSet.add('💸 Zelle');
  if (/BINANCE|USDT|TRX|TRON/i.test(textoCombinado)) metodosSet.add('🪙 Binance / USDT');
  if (/EFECTIVO|DIVISA|CASH/i.test(textoCombinado)) metodosSet.add('💵 Efectivo / Divisas $');
  if (/PUNTO|D[EÉ]BITO|BIOPAGO/i.test(textoCombinado)) metodosSet.add('💳 Punto / Débito');

  let tasaMonedaTexto: string | null = null;
  let alertaTasaEspecial: string | null = null;

  if (/TASA\s*EURO|BCV\s*EURO|EN\s*EUROS|\bEURO(S)?\b|\bEUR\b/i.test(textoCombinado)) {
    tasaMonedaTexto = '💶 TASA EURO';
    alertaTasaEspecial = '💶 PAGO A TASA EURO';
    metodosSet.add('💶 Tasa Euro');
  } else if (/TASA\s*BCV|A\s*BCV|BANCO\s*CENTRAL|\bBCV\b/i.test(textoCombinado)) {
    tasaMonedaTexto = '🏛️ TASA BCV';
    metodosSet.add('🏛️ Tasa BCV');
  } else if (/DIVISA|EFECTIVO\s*\$|USD\s*EFECTIVO/i.test(textoCombinado)) {
    tasaMonedaTexto = '💵 DIVISAS $ USD';
  }

  // Si en la nota escribieron un Pago Móvil o Cuenta en texto libre y el proveedor no lo tenía en sus campos
  if (!datosBancarios.pagoMovilTelefono) {
    const matchTel = notaStr.match(/\b(04(?:12|14|24|16|26)[-\s]?\d{7})\b/);
    if (matchTel) {
      datosBancarios.pagoMovilTelefono = matchTel[1];
    }
  }
  if (!datosBancarios.proveedorRif) {
    const matchRif = notaStr.match(/\b([JVEGP][-\s]?\d{6,10}(?:[-\s]?\d)?)\b/i);
    if (matchRif) {
      datosBancarios.proveedorRif = matchRif[1].toUpperCase();
    }
  }
  if (!datosBancarios.numeroCuenta) {
    const matchCta = notaStr.match(/\b(\d{4}[-\s]?\d{4}[-\s]?\d{2}[-\s]?\d{10}|\d{20})\b/);
    if (matchCta) {
      datosBancarios.numeroCuenta = matchCta[1];
    }
  }

  const tieneDatos = tieneCoordenadasBancarias(datosBancarios) || proveedoresSecundarios.length > 0;
  const metodosActivos = Array.from(metodosSet);

  // 6. Construir bloque de texto listo para copiar al portapapeles (Tesorería / WhatsApp / Banco)
  const lineasCopia: string[] = [];
  lineasCopia.push(`💳 DATOS DE PAGO — ${datosBancarios.proveedorNombre}`);
  if (datosBancarios.proveedorRif) lineasCopia.push(`RIF / C.I.: ${datosBancarios.proveedorRif}`);
  if (datosBancarios.proveedorTelefono) lineasCopia.push(`Teléfono: ${datosBancarios.proveedorTelefono}`);
  if (typeof contexto.saldoUsd === 'number' && contexto.saldoUsd > 0) {
    const bsTxt =
      contexto.tasaBcv && contexto.tasaBcv > 0
        ? ` (≈ Bs. ${(Math.round(contexto.saldoUsd * contexto.tasaBcv * 100) / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a tasa BCV Bs ${contexto.tasaBcv.toLocaleString('es-VE')})`
        : '';
    lineasCopia.push(`Monto a pagar: $${contexto.saldoUsd.toFixed(2)} USD${bsTxt}`);
  }
  if (condStr) lineasCopia.push(`Condiciones: ${condStr}`);
  if (tasaMonedaTexto) lineasCopia.push(`Tasa / Moneda: ${tasaMonedaTexto}`);
  if (metodosActivos.length > 0) lineasCopia.push(`Métodos: ${metodosActivos.join(' · ')}`);
  if (datosBancarios.banco || datosBancarios.numeroCuenta) {
    lineasCopia.push(
      `🏦 Transferencia: ${[datosBancarios.banco, datosBancarios.tipoCuenta, datosBancarios.numeroCuenta].filter(Boolean).join(' · ')}${datosBancarios.titular ? ` | Titular: ${datosBancarios.titular}` : ''}${datosBancarios.rifTitular ? ` (${datosBancarios.rifTitular})` : ''}`,
    );
  }
  if (datosBancarios.pagoMovilTelefono || datosBancarios.pagoMovilBanco) {
    lineasCopia.push(
      `📲 Pago Móvil: ${[datosBancarios.pagoMovilBanco, datosBancarios.pagoMovilTelefono, datosBancarios.pagoMovilCedulaRif].filter(Boolean).join(' · ')}`,
    );
  }
  if (datosBancarios.binanceId) {
    lineasCopia.push(`🪙 Binance / Zelle / ID: ${datosBancarios.binanceId}`);
  }
  if (datosBancarios.instruccionesPago) {
    lineasCopia.push(`📝 Datos de pago proveedor: ${datosBancarios.instruccionesPago}`);
  }
  if (notaStr) {
    lineasCopia.push(`📝 Nota de la cuenta: ${notaStr}`);
  }

  return {
    metodosActivos,
    condicionesPago: condStr,
    tasaMonedaTexto,
    alertaTasaEspecial,
    datosBancarios,
    proveedoresSecundarios,
    tieneDatosBancarios: tieneDatos,
    resumenCopiable: lineasCopia.join('\n'),
  };
}
