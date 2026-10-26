// 📑 Expediente Completo de Compra, Factura de Abraham y Trazabilidad de Almacén
// Permite compilar en un solo documento ejecutivo oficial:
// 1. Datos del Requerimiento (Código, fecha, solicitante, departamento, máquina con código y PLACA).
// 2. Galería de repuestos pedidos con fotos y notas técnicas.
// 3. Datos de la cotización y proveedor asignado.
// 4. Trazabilidad de aprobación y pagos de administración.
// 5. Factura fiscal/comercial subida por Abraham (Ilusiones / Golden Touch).
// 6. Estatus físico en Almacén (Disponible para entrega vs Retirado por chofer/mecánico).

import { pdfDocument } from './pdf';
import { GOLDEN_TOUCH_LOGO_DATA_URI } from './logoGoldenTouchData';
import { LOGO_DATA_URI } from './logoData';
import { FIRMA_DATA_URI, FIRMA2_DATA_URI } from './firmaData';
import type { InventoryRequirement, RequirementLine } from '../types/database';

export type EmpresaFactura = 'Inversiones Las Ilusiones' | 'Golden Touch';

export interface FacturaData {
  numero: string;
  empresa: EmpresaFactura;
  fecha?: string | null;
  url?: string | null;
  tipo?: 'image' | 'pdf' | null;
  nombre?: string | null;
  subidaPor?: string | null;
  subidaAt?: string | null;
  monto?: number | null;
}

export interface DespachoAlmacenData {
  estado: 'disponible' | 'retirado';
  retiradoPor?: string | null;
  retiradoCedula?: string | null;
  retiradoCargo?: string | null;
  retiradoEmployeeId?: string | null;
  despachadoPor?: string | null;
  fecha?: string | null;
  nota?: string | null;
  maquinariaCodigo?: string | null;
  maquinariaPlaca?: string | null;
}

export interface AbonoPagoExpediente {
  fecha: string;
  monto: number;
  metodo?: string | null;
  referencia?: string | null;
  nota?: string | null;
}

export interface InfoPagoExpediente {
  estadoCuenta?: string | null; // 'pendiente' | 'pagada' | 'anulada'
  montoTotal?: number | null;
  montoPagado?: number | null;
  saldoPendiente?: number | null;
  concepto?: string | null;
  abonos?: AbonoPagoExpediente[];
}

export interface ExpedienteCompletoPdfData {
  req: InventoryRequirement;
  factura: FacturaData | null;
  despacho: DespachoAlmacenData;
  pagoInfo?: InfoPagoExpediente | null;
  proveedorNombre?: string | null;
  proveedorRif?: string | null;
  proveedorDatosPago?: string | null;
  cotizacionUrl?: string | null;
  cotizacionTipo?: string | null;
  maquinariaLabel?: string | null; // Nombre/Código + PLACA
  itemsConImagenes?: Array<{
    name: string;
    unit?: string | null;
    qty: number;
    est_price: number;
    currency: string;
    note?: string | null;
    image_url?: string | null;
    supplier_name?: string | null;
  }>;
}

const esc = (s: any) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const money = (n: number) =>
  (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function dmyOf(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function dmyTimeOf(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Limpia el texto de observaciones para el usuario final eliminando etiquetas técnicas
 */
export function limpiarObservacionesUsuario(obs?: string | null): string {
  if (!obs) return '';
  return obs
    .replace(/\[PROVEEDOR SUGERIDO(?:\s*\([^)]*\))?:[^\]]+\]/gi, '')
    .replace(/\[FACTURA PROVEEDOR:[^\]]+\]/gi, '')
    .replace(/\[DESPACHO ALMACEN:[^\]]+\]/gi, '')
    .replace(/\[RECEPCIÓN ALMACÉN:[^\]]+\]/gi, '')
    .trim();
}

/**
 * Extrae los datos de la factura fiscal cargada por Abraham desde columnas o etiqueta de observaciones
 */
export function extraerFactura(r: Partial<InventoryRequirement>): FacturaData | null {
  if (!r) return null;

  // 1. Si viene como campo de primer nivel
  if (r.factura_numero) {
    return {
      numero: r.factura_numero,
      empresa: (r.factura_empresa as EmpresaFactura) || 'Inversiones Las Ilusiones',
      fecha: r.factura_fecha || null,
      url: r.factura_url || null,
      tipo: r.factura_tipo || 'image',
      nombre: r.factura_nombre || null,
      subidaPor: r.factura_subida_por || null,
      subidaAt: r.factura_subida_at || null,
    };
  }

  // 2. Extraer de tag en observaciones: [FACTURA PROVEEDOR: Nro: ... | Empresa: ... | Fecha: ... | Url: ... | Tipo: ... | Nombre: ... | SubidaPor: ... | SubidaAt: ...]
  const obs = r.observaciones || '';
  const match = obs.match(/\[FACTURA PROVEEDOR:\s*Nro:\s*([^|]+)\|\s*Empresa:\s*([^|]+)\|\s*Fecha:\s*([^|]*)\|\s*Url:\s*([^|]*)\|\s*Tipo:\s*([^|]*)\|\s*Nombre:\s*([^|]*)\|\s*SubidaPor:\s*([^|]*)\|\s*SubidaAt:\s*([^\]]*)\]/i);
  if (match) {
    const num = match[1].trim();
    if (num && num !== 'No indicado') {
      return {
        numero: num,
        empresa: (match[2].trim() as EmpresaFactura) || 'Inversiones Las Ilusiones',
        fecha: match[3].trim() || null,
        url: match[4].trim() || null,
        tipo: (match[5].trim() as any) || 'image',
        nombre: match[6].trim() || null,
        subidaPor: match[7].trim() || null,
        subidaAt: match[8].trim() || null,
      };
    }
  }

  // 3. Respaldo histórico: si venía en [RECEPCIÓN ALMACÉN: · Factura N° XXXXX (con soporte adjunto)]
  const matchHist = obs.match(/Factura N°\s*([^\s·\]]+)/i);
  if (matchHist && matchHist[1]) {
    return {
      numero: matchHist[1].trim(),
      empresa: 'Inversiones Las Ilusiones',
      fecha: r.received_at ? dmyOf(r.received_at) : null,
      url: r.attachment_url || null,
      tipo: (r.attachment_type === 'pdf' ? 'pdf' : 'image'),
      nombre: r.attachment_name || null,
      subidaPor: 'Almacén',
      subidaAt: r.received_at || null,
    };
  }

  return null;
}

/**
 * Inyecta o actualiza la etiqueta de factura en las observaciones
 */
export function inyectarFacturaEnObservaciones(
  obs: string | null | undefined,
  factura: FacturaData | null
): string {
  let base = (obs || '').replace(/\[FACTURA PROVEEDOR:[^\]]+\]/gi, '').trim();
  if (!factura || !factura.numero.trim()) return base;

  const tag = `[FACTURA PROVEEDOR: Nro: ${factura.numero.trim()} | Empresa: ${factura.empresa} | Fecha: ${factura.fecha || ''} | Url: ${factura.url || ''} | Tipo: ${factura.tipo || 'image'} | Nombre: ${factura.nombre || ''} | SubidaPor: ${factura.subidaPor || ''} | SubidaAt: ${factura.subidaAt || ''}]`;
  return base ? `${base}\n${tag}` : tag;
}

/**
 * Extrae los datos de trazabilidad física en Almacén (Disponible vs Retirado)
 */
export function extraerDespacho(r: Partial<InventoryRequirement>): DespachoAlmacenData {
  if (!r) return { estado: 'disponible' };

  // 1. Si viene en campos de primer nivel
  if (r.despacho_estado) {
    return {
      estado: r.despacho_estado as 'disponible' | 'retirado',
      retiradoPor: r.despachado_a_nombre || null,
      retiradoEmployeeId: r.despachado_a_id || null,
      despachadoPor: r.despachado_por || null,
      fecha: r.despachado_at || null,
      nota: r.despacho_nota || null,
    };
  }

  // 2. Extraer de tag en observaciones: [DESPACHO ALMACEN: Estado: ... | RetiradoPor: ... | Cedula: ... | Cargo: ... | EmpId: ... | DespachadoPor: ... | Fecha: ... | Nota: ... | MaqCod: ... | MaqPlaca: ...]
  const obs = r.observaciones || '';
  const match = obs.match(/\[DESPACHO ALMACEN:\s*Estado:\s*([^|]+)\|\s*RetiradoPor:\s*([^|]*)\|\s*Cedula:\s*([^|]*)\|\s*Cargo:\s*([^|]*)\|\s*EmpId:\s*([^|]*)\|\s*DespachadoPor:\s*([^|]*)\|\s*Fecha:\s*([^|]*)\|\s*Nota:\s*([^|]*)\|\s*MaqCod:\s*([^|]*)\|\s*MaqPlaca:\s*([^\]]*)\]/i);

  if (match) {
    const estado = match[1].trim() === 'retirado' ? 'retirado' : 'disponible';
    return {
      estado,
      retiradoPor: match[2].trim() || null,
      retiradoCedula: match[3].trim() || null,
      retiradoCargo: match[4].trim() || null,
      retiradoEmployeeId: match[5].trim() || null,
      despachadoPor: match[6].trim() || null,
      fecha: match[7].trim() || null,
      nota: match[8].trim() || null,
      maquinariaCodigo: match[9].trim() || null,
      maquinariaPlaca: match[10].trim() || null,
    };
  }

  // Por defecto, si el requerimiento está recibido pero no tiene tag de retiro, está DISPONIBLE en almacén
  return { estado: 'disponible' };
}

/**
 * Inyecta o actualiza la etiqueta de despacho físico en las observaciones
 */
export function inyectarDespachoEnObservaciones(
  obs: string | null | undefined,
  despacho: DespachoAlmacenData
): string {
  let base = (obs || '').replace(/\[DESPACHO ALMACEN:[^\]]+\]/gi, '').trim();
  const tag = `[DESPACHO ALMACEN: Estado: ${despacho.estado} | RetiradoPor: ${despacho.retiradoPor || ''} | Cedula: ${despacho.retiradoCedula || ''} | Cargo: ${despacho.retiradoCargo || ''} | EmpId: ${despacho.retiradoEmployeeId || ''} | DespachadoPor: ${despacho.despachadoPor || ''} | Fecha: ${despacho.fecha || ''} | Nota: ${despacho.nota || ''} | MaqCod: ${despacho.maquinariaCodigo || ''} | MaqPlaca: ${despacho.maquinariaPlaca || ''}]`;
  return base ? `${base}\n${tag}` : tag;
}

// ── ESTILOS CSS DEL EXPEDIENTE ──────────────────────────────────────────────
const EXPEDIENTE_CSS = `
  .exp-section { margin-top: 14px; border: 1px solid #CBD5E1; border-radius: 8px; overflow: hidden; background: #fff; page-break-inside: avoid; }
  .exp-header { background: #1E3A5F; color: #fff; padding: 7px 12px; font-size: 11px; font-weight: 800; display: flex; justify-content: space-between; align-items: center; letter-spacing: 0.5px; }
  .exp-content { padding: 10px 12px; font-size: 10.5px; color: #1E293B; }
  .grid-2 { display: flex; flex-wrap: wrap; gap: 8px; }
  .grid-item { flex: 1 1 45%; min-width: 200px; }
  .k-label { font-size: 9px; font-weight: 800; color: #64748B; text-transform: uppercase; margin-bottom: 2px; }
  .k-val { font-size: 11px; font-weight: 700; color: #0F172A; }
  .k-val.accent { color: #1E3A5F; font-weight: 800; }
  
  table.exp-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 10.5px; }
  table.exp-table th { background: #334155; color: #fff; padding: 6px 8px; text-align: left; font-size: 9.5px; text-transform: uppercase; font-weight: 800; }
  table.exp-table td { border-bottom: 1px solid #E2E8F0; padding: 6px 8px; vertical-align: middle; }
  table.exp-table tr:nth-child(even) td { background: #F8FAFC; }

  .badge-tag { display: inline-block; padding: 2px 7px; border-radius: 12px; font-size: 9px; font-weight: 800; text-transform: uppercase; }
  .badge-golden { background: #FEF3C7; color: #92400E; border: 1px solid #F59E0B; }
  .badge-ilusiones { background: #E0E7FF; color: #3730A3; border: 1px solid #6366F1; }
  .badge-success { background: #DCFCE7; color: #166534; border: 1px solid #22C55E; }
  .badge-warning { background: #FEF3C7; color: #92400E; border: 1px solid #F59E0B; }
  .badge-info { background: #DBEAFE; color: #1E40AF; border: 1px solid #3B82F6; }

  .img-gallery { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .img-card { width: 120px; border: 1px solid #CBD5E1; border-radius: 6px; padding: 4px; background: #F8FAFC; text-align: center; }
  .img-card img { width: 100%; height: 80px; object-fit: contain; border-radius: 4px; background: #fff; }
  .img-card .caption { font-size: 8.5px; font-weight: 700; color: #334155; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .invoice-box { display: flex; gap: 14px; align-items: flex-start; background: #F8FAFC; border: 1.5px solid #CBD5E1; border-radius: 8px; padding: 10px; margin-top: 6px; }
  .invoice-preview { width: 140px; height: 160px; object-fit: contain; border: 1px solid #CBD5E1; border-radius: 4px; background: #fff; }
  
  .timeline { border-left: 2.5px solid #1E3A5F; padding-left: 12px; margin-left: 6px; gap: 8px; display: flex; flex-direction: column; }
  .timeline-step { position: relative; }
  .timeline-dot { position: absolute; left: -18px; top: 2px; width: 10px; height: 10px; border-radius: 50%; background: #1E3A5F; }
  
  .total-row { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding: 6px 10px; background: #F1F5F9; border-radius: 6px; font-weight: 800; font-size: 12px; color: #0F172A; }
`;

/**
 * Genera el documento HTML completo del Expediente de Compra
 */
export function expedienteCompletoHtml(d: ExpedienteCompletoPdfData): string {
  const r = d.req;
  const factura = d.factura;
  const despacho = d.despacho;
  const pago = d.pagoInfo;

  // Determinar empresa de cabecera y membrete
  const empresaNombre = factura?.empresa || (r.company_id ? 'Inversiones Las Ilusiones' : 'Golden Touch');
  const esGolden = empresaNombre.toLowerCase().includes('golden');

  // Calcular totales
  const items = d.itemsConImagenes || (r.items || []).map((it) => ({
    name: it.name,
    unit: it.unit,
    qty: it.qty,
    est_price: it.est_price,
    currency: it.currency || 'USD',
    note: it.note,
    image_url: it.image_url,
    supplier_name: it.supplier_name,
  }));

  const totalUsd = items.reduce((sum, it) => sum + (Number(it.est_price) || 0) * (Number(it.qty) || 0), 0);

  // 1. Sección Requerimiento y Destino
  const obsLimpias = limpiarObservacionesUsuario(r.observaciones);
  const seccionRequerimiento = `
    <div class="exp-section">
      <div class="exp-header">
        <span>1. DATOS DEL REQUERIMIENTO (${r.code || 'REQ'})</span>
        <span>EMISIÓN: ${dmyOf(r.created_at)}</span>
      </div>
      <div class="exp-content">
        <div class="grid-2">
          <div class="grid-item">
            <div class="k-label">👤 Solicitado por:</div>
            <div class="k-val accent">${esc(r.solicitante_nombre || r.requested_by_name || 'Personal de Campo')}</div>
          </div>
          <div class="grid-item">
            <div class="k-label">🚜 Destino / Maquinaria o Vehículo:</div>
            <div class="k-val accent">${esc(d.maquinariaLabel || r.title || 'Maquinaria asignada')}</div>
          </div>
          <div class="grid-item">
            <div class="k-label">🏢 Área / Departamento:</div>
            <div class="k-val">${esc(r.area || 'Operaciones / Mina')}</div>
          </div>
          <div class="grid-item">
            <div class="k-label">🏢 Empresa Destino / Titular:</div>
            <div class="k-val">${esc(empresaNombre)}</div>
          </div>
          ${r.autorizado_nombre ? `
          <div class="grid-item">
            <div class="k-label">✅ Autorizado en Campo por:</div>
            <div class="k-val">${esc(r.autorizado_nombre)}</div>
          </div>` : ''}
          ${r.responsable_nombre ? `
          <div class="grid-item">
            <div class="k-label">📦 Almacenista Asignado:</div>
            <div class="k-val">${esc(r.responsable_nombre)}</div>
          </div>` : ''}
        </div>
        ${obsLimpias ? `<div style="margin-top:8px;padding-top:6px;border-top:1px dashed #CBD5E1;font-size:10px;color:#475569;"><b>Observaciones iniciales:</b> ${esc(obsLimpias)}</div>` : ''}
      </div>
    </div>
  `;

  // 2. Sección Repuestos Solicitados y Galería Fotográfica
  const fotosItems = items.filter((it) => it.image_url);
  const rowsItemsHtml = items
    .map((it, idx) => {
      const subtotal = (Number(it.est_price) || 0) * (Number(it.qty) || 0);
      return `
        <tr>
          <td style="text-align:center;font-weight:800">${idx + 1}</td>
          <td>
            <b>${esc(it.name)}</b>
            ${it.note ? `<div style="font-size:9.5px;color:#2563EB;margin-top:2px;">📐 Especificación: ${esc(it.note)}</div>` : ''}
            ${it.supplier_name ? `<div style="font-size:9px;color:#059669;font-weight:700;">🏢 Proveedor del ítem: ${esc(it.supplier_name)}</div>` : ''}
          </td>
          <td style="text-align:center">${it.qty} ${esc(it.unit || 'UND')}</td>
          <td style="text-align:right">$${money(it.est_price)}</td>
          <td style="text-align:right;font-weight:800">$${money(subtotal)}</td>
        </tr>
      `;
    })
    .join('');

  const galeriaHtml = fotosItems.length > 0
    ? `
      <div style="margin-top:10px;">
        <div class="k-label">📷 MUESTRAS Y EVIDENCIAS FOTOGRÁFICAS DE REPUESTOS SOLICITADOS:</div>
        <div class="img-gallery">
          ${fotosItems.map((it) => `
            <div class="img-card">
              <img src="${it.image_url}" alt="${esc(it.name)}"/>
              <div class="caption">${esc(it.name)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `
    : '';

  const seccionRepuestos = `
    <div class="exp-section">
      <div class="exp-header">
        <span>2. LISTA DE REPUESTOS Y ESPECIFICACIONES TÉCNICAS</span>
        <span>${items.length} ${items.length === 1 ? 'ARTÍCULO' : 'ARTÍCULOS'}</span>
      </div>
      <div class="exp-content">
        <table class="exp-table">
          <thead>
            <tr>
              <th style="width:24px;text-align:center">#</th>
              <th>Descripción del Repuesto / Material</th>
              <th style="width:70px;text-align:center">Cantidad</th>
              <th style="width:80px;text-align:right">Precio Cot.</th>
              <th style="width:90px;text-align:right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${rowsItemsHtml}
          </tbody>
        </table>
        <div class="total-row">
          <span>MONTO TOTAL COTIZADO:</span>
          <span style="color:#1E3A5F;font-size:13px;">$${money(totalUsd)} USD</span>
        </div>
        ${galeriaHtml}
      </div>
    </div>
  `;

  // 3. Sección Cotización y Proveedor
  const proveedorNombre = d.proveedorNombre || r.supplier_id || 'Proveedor Seleccionado';
  const seccionCotizacion = `
    <div class="exp-section">
      <div class="exp-header">
        <span>3. DATOS DE LA COTIZACIÓN Y PROVEEDOR SELECCIONADO</span>
        <span class="badge-tag badge-info">COTIZADO Y VALIDADO</span>
      </div>
      <div class="exp-content">
        <div class="grid-2">
          <div class="grid-item">
            <div class="k-label">🏬 Razón Social del Proveedor:</div>
            <div class="k-val accent">${esc(proveedorNombre)}</div>
          </div>
          ${d.proveedorRif ? `
          <div class="grid-item">
            <div class="k-label">📄 RIF / Documento:</div>
            <div class="k-val">${esc(d.proveedorRif)}</div>
          </div>` : ''}
          ${d.proveedorDatosPago ? `
          <div class="grid-item" style="flex: 1 1 95%;">
            <div class="k-label">💳 Coordenadas Bancarias / Pago Móvil:</div>
            <div class="k-val" style="font-size:10px;">${esc(d.proveedorDatosPago)}</div>
          </div>` : ''}
          ${r.attachment_url ? `
          <div class="grid-item">
            <div class="k-label">📎 Cotización Formal Adjunta:</div>
            <div class="k-val">Documento ${r.attachment_type === 'pdf' ? 'PDF' : 'Digital'} cargado en expediente</div>
          </div>` : ''}
        </div>
      </div>
    </div>
  `;

  // 4. Sección Trazabilidad de Aprobación y Pagos
  const seccionAprobacionYPagos = `
    <div class="exp-section">
      <div class="exp-header">
        <span>4. TRAZABILIDAD DE APROBACIÓN Y PAGOS</span>
        <span class="badge-tag ${r.status === 'aprobado' || r.status === 'recibido' ? 'badge-success' : 'badge-warning'}">
          ${r.status === 'recibido' ? 'COMPLETADO' : r.status.toUpperCase()}
        </span>
      </div>
      <div class="exp-content">
        <div class="timeline">
          <div class="timeline-step">
            <div class="timeline-dot"></div>
            <div class="k-label">Aprobación Técnica y Comercial:</div>
            <div class="k-val">
              ${r.decided_by_name ? `Aprobado formalmente por: <b>${esc(r.decided_by_name)}</b> el ${dmyTimeOf(r.decided_at)}` : 'Pendiente de aprobación formal'}
            </div>
          </div>

          ${totalUsd > 1000 ? `
          <div class="timeline-step" style="margin-top:6px;">
            <div class="timeline-dot" style="background:#7C3AED;"></div>
            <div class="k-label">Filtro de Seguridad (&gt; $1,000 USD):</div>
            <div class="k-val" style="color:#7C3AED;">
              ${r.gerente_aprobado ? `✓ Autorizado por Gerente General (${esc(r.gerente_aprobado_por || 'Gerencia')}) el ${dmyOf(r.gerente_aprobado_at)}` : 'Exige aprobación de Gerencia General'}
            </div>
          </div>` : ''}

          <div class="timeline-step" style="margin-top:6px;">
            <div class="timeline-dot" style="background:#2563EB;"></div>
            <div class="k-label">Gestión de Cuentas por Pagar y Tesorería:</div>
            <div class="k-val">
              ${pago ? `
                Estado de la Cuenta: <b>${esc(pago.estadoCuenta || 'pendiente').toUpperCase()}</b><br/>
                Monto Registrado: $${money(pago.montoTotal || totalUsd)} | Monto Pagado: $${money(pago.montoPagado || 0)} | Saldo: $${money(pago.saldoPendiente || 0)}
              ` : `Cuenta por pagar generada automáticamente para cancelación a ${esc(proveedorNombre)}.`}
            </div>
          </div>

          ${pago?.abonos && pago.abonos.length > 0 ? `
          <div style="margin-top:6px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:4px;padding:6px;">
            <div class="k-label" style="margin-bottom:4px;">Comprobantes de Transferencia / Pagos Realizados:</div>
            ${pago.abonos.map((ab) => `
              <div style="font-size:9.5px;color:#1E293B;margin-bottom:2px;">
                • <b>${dmyOf(ab.fecha)}</b>: $${money(ab.monto)} USD — Método: ${esc(ab.metodo || 'Transferencia')} | Ref: <b>${esc(ab.referencia || 'N/A')}</b> ${ab.nota ? `(${esc(ab.nota)})` : ''}
              </div>
            `).join('')}
          </div>` : ''}
        </div>
      </div>
    </div>
  `;

  // 5. Sección Factura Fiscal / Comercial subida por Abraham
  const seccionFactura = `
    <div class="exp-section">
      <div class="exp-header">
        <span>5. FACTURA FISCAL / COMERCIAL DEL PROVEEDOR</span>
        <span class="badge-tag ${factura ? (factura.empresa.includes('Golden') ? 'badge-golden' : 'badge-ilusiones') : 'badge-warning'}">
          ${factura ? esc(factura.empresa) : 'PENDIENTE DE SUBIDA'}
        </span>
      </div>
      <div class="exp-content">
        ${factura ? `
          <div class="grid-2">
            <div class="grid-item">
              <div class="k-label">🧾 Número de Factura:</div>
              <div class="k-val accent" style="font-size:13px;color:#0F766E;">N° ${esc(factura.numero)}</div>
            </div>
            <div class="grid-item">
              <div class="k-label">🏢 Empresa Titular de la Factura:</div>
              <div class="k-val accent">${esc(factura.empresa)}</div>
            </div>
            <div class="grid-item">
              <div class="k-label">📅 Fecha de Factura:</div>
              <div class="k-val">${esc(factura.fecha ? dmyOf(factura.fecha) : 'Registrada')}</div>
            </div>
            <div class="grid-item">
              <div class="k-label">👤 Subida y Verificada por:</div>
              <div class="k-val">${esc(factura.subidaPor || 'Abraham / Administración')}${factura.subidaAt ? ` (${dmyTimeOf(factura.subidaAt)})` : ''}</div>
            </div>
          </div>
          ${factura.url && factura.tipo === 'image' ? `
            <div style="margin-top:10px;text-align:center;">
              <div class="k-label" style="text-align:left;margin-bottom:4px;">COMPROBANTE FISCAL DIGITALIZADO:</div>
              <img src="${factura.url}" style="max-width:100%;max-height:280px;border:1px solid #CBD5E1;border-radius:6px;object-fit:contain;background:#fff;"/>
            </div>
          ` : factura.url ? `
            <div style="margin-top:8px;padding:8px;background:#F1F5F9;border-radius:4px;font-size:10px;color:#1E293B;">
              📎 <b>Soporte en formato PDF:</b> El archivo original de la factura está adjunto digitalmente al expediente (${esc(factura.nombre || 'factura.pdf')}).
            </div>
          ` : ''}
        ` : `
          <div style="padding:10px;text-align:center;color:#64748B;font-style:italic;">
            🧾 La factura fiscal aún no ha sido cargada por Abraham/Administración para este requerimiento.
          </div>
        `}
      </div>
    </div>
  `;

  // 6. Sección Almacén y Control de Despacho Físico
  const estaRecibido = r.status === 'recibido';
  const esRetirado = despacho.estado === 'retirado';
  const seccionAlmacen = `
    <div class="exp-section">
      <div class="exp-header">
        <span>6. CONTROL FÍSICO EN ALMACÉN Y TRAZABILIDAD DE RETIRO</span>
        <span class="badge-tag ${esRetirado ? 'badge-info' : estaRecibido ? 'badge-success' : 'badge-warning'}">
          ${esRetirado ? '📦 RETIRADO / DESPACHADO' : estaRecibido ? '🟢 DISPONIBLE EN ALMACÉN' : 'EN CAMINO'}
        </span>
      </div>
      <div class="exp-content">
        <div class="grid-2">
          <div class="grid-item">
            <div class="k-label">📅 Fecha de Llegada a Galpón/Almacén:</div>
            <div class="k-val">${r.received_at ? dmyTimeOf(r.received_at) : 'Pendiente de entrega del proveedor'}</div>
          </div>
          <div class="grid-item">
            <div class="k-label">👤 Almacenista que Recibió:</div>
            <div class="k-val">${esc(r.responsable_nombre || 'Almacén')}</div>
          </div>
          <div class="grid-item" style="flex:1 1 95%;">
            <div class="k-label">📦 Estatus de Disponibilidad Física en Estante:</div>
            <div class="k-val" style="font-size:12px;color:${esRetirado ? '#2563EB' : estaRecibido ? '#16A34A' : '#D97706'};">
              ${esRetirado
                ? `📦 Material Retirado del Almacén por: <b>${esc(despacho.retiradoPor || 'Mecánico/Chofer')}</b>${despacho.retiradoCedula ? ` (CI: ${esc(despacho.retiradoCedula)})` : ''}`
                : estaRecibido
                ? `🟢 Físicamente disponible en el estante de almacén, listo para ser retirado por el mecánico o chofer.`
                : `⏳ Pendiente de recepción física en almacén.`}
            </div>
          </div>
          ${esRetirado ? `
          <div class="grid-item">
            <div class="k-label">🕒 Fecha y Hora del Retiro:</div>
            <div class="k-val">${esc(despacho.fecha ? dmyTimeOf(despacho.fecha) : 'Registrado')}</div>
          </div>
          <div class="grid-item">
            <div class="k-label">👤 Despachado / Entregado por:</div>
            <div class="k-val">${esc(despacho.despachadoPor || 'Almacenista')}</div>
          </div>
          ${despacho.maquinariaCodigo || despacho.maquinariaPlaca ? `
          <div class="grid-item">
            <div class="k-label">🚜 Maquinaria Destino de Instalación:</div>
            <div class="k-val accent">${esc(despacho.maquinariaCodigo || '')} · PLACA: ${esc(despacho.maquinariaPlaca || 'Sin placa')}</div>
          </div>` : ''}
          ${despacho.nota ? `
          <div class="grid-item" style="flex:1 1 95%;">
            <div class="k-label">📝 Nota de Entrega / Despacho:</div>
            <div class="k-val" style="font-style:italic;">"${esc(despacho.nota)}"</div>
          </div>` : ''}
          ` : ''}
        </div>
      </div>
    </div>
  `;

  // Cuerpo completo consolidado
  const body = `
    <div style="font-family:Tahoma,Geneva,Verdana,sans-serif;">
      <div style="text-align:center;margin-bottom:12px;">
        <h2 style="margin:0;font-size:18px;color:#1E3A5F;text-transform:uppercase;letter-spacing:1px;">
          EXPEDIENTE EJECUTIVO UNIFICADO DE COMPRA
        </h2>
        <div style="font-size:11px;color:#64748B;font-weight:700;margin-top:3px;">
          CONSOLIDADO OFICIAL DE COMPRA · REQ: ${esc(r.code || 'N/A')} · EMPRESA: ${esc(empresaNombre.toUpperCase())}
        </div>
      </div>

      ${seccionRequerimiento}
      ${seccionRepuestos}
      ${seccionCotizacion}
      ${seccionAprobacionYPagos}
      ${seccionFactura}
      ${seccionAlmacen}
    </div>
  `;

  return pdfDocument({
    title: `Expediente de Compra ${r.code || ''}`,
    subtitle: `${empresaNombre} · Documento Oficial`,
    body,
    extraCss: EXPEDIENTE_CSS,
    logos: {
      golden: esGolden,
      sos: !esGolden,
      bcv: !esGolden,
    },
    marcaTexto: true,
  });
}
