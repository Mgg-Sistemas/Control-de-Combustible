// 📄 LOS DATOS DEL PDF DE UN REQUERIMIENTO, en UN solo sitio (04-nov-2026). Antes
// vivían dentro de RequerimientoTab; ahora Por Pagar también descarga el mismo
// papel («en Por Pagar deberían poder descargar o ver el PDF así como en
// Requerimientos»), y dos copias terminarían diciendo cosas distintas.
import type { InventoryRequirement, Supplier } from '../types/database';
import { urlToDataUri } from './pdf';
import { limpiarObservacionesFormatos } from './formatosAdjuntos';
import { destinoLabel } from './requerimientoPersonas';
import { resolverAlicuotaIvaRequerimiento } from './cuentasPago';
import { claveProveedorReq, desgloseProveedoresReq, type DesgloseProveedorReq, type ReqPdfData, type ReqPdfItem } from './requerimiento';

/** Estado del requerimiento en palabras cortas (lo que sale en el subtítulo). */
export const REQ_ESTADO_CORTO: Record<string, string> = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  esperando_recepcion: 'Esperando Recepción',
  pagado: 'Esperando Recepción',
  rechazado: 'Rechazado',
  recibido: 'Recibido',
  aclaratoria_solicitada: 'En Aclaratoria',
};

const dmy = (iso?: string | null): string => {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/** Los datos de pago de un proveedor en una línea (banco, Pago Móvil, Binance). */
export function textoPagoProveedor(s: Partial<Supplier> | null | undefined): string {
  if (!s) return '';
  const partes = [
    s.bank_name || s.account_number
      ? `🏦 ${s.bank_name ?? ''} Cta: ${s.account_number ?? ''}${s.account_holder ? ` (${s.account_holder}${s.account_id_doc ? ` ${s.account_id_doc}` : ''})` : ''}`.replace(/\s+/g, ' ').trim()
      : '',
    s.pago_movil_phone ? `📱 PM: ${s.pago_movil_bank ?? ''} ${s.pago_movil_phone}${s.pago_movil_id ? ` (${s.pago_movil_id})` : ''}`.replace(/\s+/g, ' ').trim() : '',
    s.binance_id ? `🟡 Binance: ${s.binance_id}` : '',
  ].filter(Boolean);
  return partes.join(' · ');
}

/** Datos de pago de TODOS los proveedores del requerimiento, por nombre normalizado. */
export function proveedoresPagoDeReq(r: InventoryRequirement, suppliers: readonly Supplier[]): Record<string, string> {
  const out: Record<string, string> = {};
  const porId = new Map(suppliers.map((s) => [s.id, s]));
  const porNombre = new Map(suppliers.map((s) => [claveProveedorReq(s.name), s]));
  const poner = (s: Supplier | undefined, nombreRenglon?: string | null) => {
    if (!s) return;
    const txt = textoPagoProveedor(s);
    if (!txt) return;
    out[claveProveedorReq(s.name)] = txt;
    if (nombreRenglon) out[claveProveedorReq(nombreRenglon)] = txt;
  };
  poner(r.supplier_id ? porId.get(r.supplier_id) : undefined);
  for (const it of r.items ?? []) {
    const s = (it.supplier_id ? porId.get(it.supplier_id) : undefined) ?? porNombre.get(claveProveedorReq(it.supplier_name));
    poner(s, it.supplier_name);
  }
  return out;
}

/** Un renglón del requerimiento en el formato del papel (sin la imagen). */
export function itemPdfDe(it: InventoryRequirement['items'][number]): ReqPdfItem {
  return {
    name: it.name, unit: it.unit, qty: it.qty, est_price: it.est_price, currency: it.currency,
    isNew: !it.product_id, note: it.note,
    supplier_name: it.supplier_name || null,
    exento: Boolean(it.exento),
    modo_precio: it.modo_precio || 'unidad',
    price_usd: it.price_usd,
    price_bs: it.price_bs,
    total_usd: it.total_usd,
    total_bs: it.total_bs,
    metodo_pago: (it as any).metodo_pago || null,
    cotizaciones_count: Array.isArray(it.cotizaciones) ? it.cotizaciones.length : 0,
    image: null,
  };
}

/** 💳 Cuánto pagarle a cada proveedor de un requerimiento (para la pantalla de
 *  Por Pagar): la MISMA cuenta que el desglose del PDF, sin bajar imágenes. */
export function desgloseProveedoresDeReq(r: InventoryRequirement, suppliers: readonly Supplier[], rate: number | null): DesgloseProveedorReq[] {
  const sel = suppliers.find((s) => s.id === r.supplier_id);
  return desgloseProveedoresReq({
    fecha: '', statusLabel: '', rate,
    proveedor: sel?.name ?? null,
    proveedoresPago: proveedoresPagoDeReq(r, suppliers),
    ivaAlicuota: r.iva_alicuota != null ? Number(r.iva_alicuota) : resolverAlicuotaIvaRequerimiento(r as any),
    items: (r.items ?? []).map(itemPdfDe),
  });
}

/**
 * Arma los datos del PDF de un requerimiento. Las imágenes de los productos van
 * incrustadas (data-URI) para que salgan sí o sí al imprimir.
 */
export async function armarReqPdfData(r: InventoryRequirement, ctx: {
  suppliers: readonly Supplier[];
  /** Nombre de la empresa por id (o null). */
  companyName: (id: string | null | undefined) => string | null;
  /** Bs por US$ (para lo cargado en Bs). */
  rate: number | null;
  /** Estado en palabras; si no se da, se usa REQ_ESTADO_CORTO. */
  statusLabel?: string;
}): Promise<ReqPdfData> {
  const sel = ctx.suppliers.find((s) => s.id === r.supplier_id);
  const items = await Promise.all((r.items ?? []).map(async (it) => ({
    ...itemPdfDe(it),
    image: it.image_url ? ((await urlToDataUri(it.image_url).catch(() => null)) || it.image_url) : null,
  })));
  return {
    code: r.code, fecha: dmy(r.created_at), title: r.title, note: r.note,
    company: ctx.companyName(r.company_id),
    empresaPagadora: r.empresa_pagadora_nombre ?? null,
    proveedor: sel?.name ?? null,
    proveedorDatosPago: sel ? {
      banco: sel.bank_name,
      cuenta: sel.account_number,
      titular: sel.account_holder,
      cedulaRif: sel.account_id_doc,
      pagoMovil: sel.pago_movil_phone ? `${sel.pago_movil_bank ?? ''} - ${sel.pago_movil_phone} (${sel.pago_movil_id ?? ''})` : null,
      binance: sel.binance_id,
    } : null,
    proveedoresPago: proveedoresPagoDeReq(r, ctx.suppliers),
    requestedBy: r.requested_by_name, responsable: r.responsable_nombre ?? null,
    statusLabel: ctx.statusLabel ?? REQ_ESTADO_CORTO[r.status] ?? r.status,
    rate: ctx.rate,
    solicitante: r.solicitante_nombre ?? null, autorizadoPor: r.autorizado_nombre ?? null,
    destino: destinoLabel(r.destino_tipo), area: r.area ?? null,
    observaciones: limpiarObservacionesFormatos(r.observaciones) ?? null,
    aclaratoria: r.aclaratoria_motivo ? {
      motivo: r.aclaratoria_motivo,
      solicitadaPor: r.aclaratoria_solicitada_por ?? null,
      fechaSolicitud: r.aclaratoria_fecha_solicitud ? dmy(r.aclaratoria_fecha_solicitud) : null,
      respuesta: r.aclaratoria_respuesta ?? null,
      fechaRespuesta: r.aclaratoria_fecha_respuesta ? dmy(r.aclaratoria_fecha_respuesta) : null,
    } : null,
    approved: r.status === 'aprobado', decidedBy: r.decided_by_name,
    ivaAlicuota: r.iva_alicuota != null ? Number(r.iva_alicuota) : resolverAlicuotaIvaRequerimiento(r as any),
    items,
  };
}
