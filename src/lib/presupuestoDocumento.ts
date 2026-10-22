// ============================================================================
// 💼 DOCUMENTO IMPRIMIBLE DE PRESUPUESTO / COTIZACIÓN DE MAQUINARIA
//
// Formato ejecutivo de alta gama:
// - Membrete oficial de la empresa del grupo (GOLDEN TOUCH, JHENZAEN, etc.) con RIF.
// - Correlativo comercial (PRES-####), fecha y vigencia.
// - Datos del cliente y del proyecto/obra.
// - Tabla de equipos cotizados con unidades de alquiler flexibles (hora, día,
//   mes, flete, standby, viaje, etc.).
// - Cifras en USD y su equivalente en Bs a la tasa oficial BCV.
// - Términos y condiciones del alquiler: combustible, operador, mínimo de horas,
//   mantenimiento, flete y forma de pago.
// - Firmas y sellos de emisión y aceptación conforme.
// ============================================================================
import { Presupuesto, UNIDADES_ALQUILER } from '../types/presupuesto';

const NAVY = '#16324F';
const GOLD = '#EAB308';
const CELESTE = '#EEF4FA';
const BORDE = '#CBD5E1';

function esc(s: any): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dmy(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : iso;
}

function fmtMoney(n: number): string {
  return (n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function presupuestoDocumentoHtml(p: Presupuesto): string {
  const unidadLabel = (key: string, custom?: string) => {
    if (key === 'personalizado' && custom) return custom;
    const found = UNIDADES_ALQUILER.find((u) => u.key === key);
    return found ? found.label : key;
  };

  const statusColor = (st: string) => {
    switch (st) {
      case 'aceptado': return '#16A34A';
      case 'rechazado': return '#DC2626';
      case 'vencido': return '#64748B';
      default: return '#2563EB';
    }
  };

  const statusText = (st: string) => {
    switch (st) {
      case 'aceptado': return 'ACEPTADO';
      case 'rechazado': return 'RECHAZADO';
      case 'vencido': return 'VENCIDO';
      case 'borrador': return 'BORRADOR';
      default: return 'EMITIDO / PENDIENTE';
    }
  };

  const filasItems = p.items.map((it, idx) => {
    const uText = unidadLabel(it.unit, it.unit_label);
    return `
      <tr>
        <td style="text-align:center;font-weight:700;color:#64748B;width:5%">${idx + 1}</td>
        <td style="width:45%">
          <div style="font-weight:800;color:${NAVY}">${esc(it.description)}</div>
          ${it.machine_code ? `<div style="font-size:9.5px;color:#475569;margin-top:2px">Equipo: <b>${esc(it.machine_code)}</b></div>` : ''}
          ${it.notes ? `<div style="font-size:9.5px;color:#64748B;font-style:italic;margin-top:2px">${esc(it.notes)}</div>` : ''}
        </td>
        <td style="text-align:center;width:20%;font-weight:600;color:#334155">${esc(uText)}</td>
        <td style="text-align:center;font-weight:800;width:10%">${it.qty}</td>
        <td style="text-align:right;font-weight:700;width:10%">$ ${fmtMoney(it.unit_price)}</td>
        <td style="text-align:right;font-weight:800;color:${NAVY};width:10%">$ ${fmtMoney(it.subtotal)}</td>
      </tr>
    `;
  }).join('');

  const cond = p.conditions || {};

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.code)}</title><style>
  @page{size:letter;margin:10mm 12mm}
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#1a1c20;margin:0;font-size:11px;line-height:1.4}

  .header-box{display:flex;justify-content:space-between;align-items:flex-start;background:${NAVY};color:#fff;border-radius:8px;padding:16px 20px;margin-bottom:14px}
  .company-name{font-size:22px;font-weight:900;letter-spacing:.5px;line-height:1.2}
  .company-rif{font-size:12px;color:#AFC4DB;margin-top:4px;font-weight:600}
  .doc-badge-col{text-align:right}
  .doc-type{font-size:10px;font-weight:800;color:#CBD5E1;letter-spacing:1px;text-transform:uppercase}
  .doc-number{font-size:24px;font-weight:900;color:${GOLD};margin:2px 0}
  .status-pill{display:inline-block;padding:3px 10px;border-radius:12px;font-size:9.5px;font-weight:800;color:#fff;background:${statusColor(p.status)}}

  .meta-grid{display:flex;gap:12px;margin-bottom:14px}
  .meta-col{flex:1;border:1px solid ${BORDE};border-radius:6px;padding:10px 14px;background:#F8FAFC}
  .meta-col-title{font-size:10px;font-weight:900;color:${NAVY};text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #E2E8F0;padding-bottom:4px;margin-bottom:6px}
  .meta-row{display:flex;margin-bottom:3px;font-size:10.5px}
  .meta-label{font-weight:700;color:#475569;width:32%}
  .meta-val{font-weight:600;color:#0F172A;flex:1}

  table.items{width:100%;border-collapse:collapse;margin:12px 0}
  table.items th{background:${CELESTE};color:${NAVY};font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;padding:7px 9px;border:1px solid ${BORDE};text-align:left}
  table.items td{padding:7px 9px;border:1px solid ${BORDE};font-size:10.5px;vertical-align:top}
  table.items tr:nth-child(even) td{background:#FAFCFE}

  .totals-wrap{display:flex;justify-content:flex-end;margin:8px 0 14px}
  .totals-box{width:290px;border:1px solid ${BORDE};border-radius:6px;overflow:hidden;background:#fff}
  .total-row{display:flex;justify-content:space-between;padding:5px 12px;font-size:10.5px;border-bottom:1px solid #F1F5F9}
  .total-row.main{background:${NAVY};color:#fff;font-size:13px;font-weight:900;border-bottom:none;padding:7px 12px}
  .total-row.main .val{color:${GOLD}}
  .total-row.bs{background:#F8FAFC;font-size:10px;font-weight:700;color:#334155}

  .cond-box{border:1px solid #E2E8F0;border-left:4px solid ${GOLD};border-radius:6px;padding:10px 14px;background:#FFFFFF;margin-bottom:14px;page-break-inside:avoid}
  .cond-title{font-size:11px;font-weight:900;color:${NAVY};margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px}
  .cond-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:10px}
  .cond-item{line-height:1.35}
  .cond-k{font-weight:800;color:#334155}
  .cond-v{color:#475569;margin-top:1px}

  .firmas{display:flex;gap:40px;margin-top:30px;page-break-inside:avoid}
  .firma-col{flex:1;text-align:center}
  .linea-firma{border-top:1px dashed #64748B;margin:35px 20px 6px}
  .firma-cargo{font-size:10.5px;font-weight:800;color:${NAVY}}
  .firma-sub{font-size:9.5px;color:#64748B}

  .pie-legal{font-size:8.5px;color:#94A3B8;text-align:center;margin-top:20px;border-top:1px solid #E2E8F0;padding-top:6px}
  </style></head><body>

  <div class="header-box">
    <div>
      <div class="company-name">${esc(p.company_name)}</div>
      <div class="company-rif">${p.company_rif ? `RIF: ${esc(p.company_rif)}` : 'Empresa Arrendadora de Maquinaria y Equipos'}</div>
    </div>
    <div class="doc-badge-col">
      <div class="doc-type">Presupuesto Comercial</div>
      <div class="doc-number">${esc(p.code)}</div>
      <div><span class="status-pill">${statusText(p.status)}</span></div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-col">
      <div class="meta-col-title">Datos del Cliente / Arrendatario</div>
      <div class="meta-row"><span class="meta-label">Cliente:</span><span class="meta-val" style="font-weight:800;color:${NAVY}">${esc(p.client_name)}</span></div>
      ${p.client_doc ? `<div class="meta-row"><span class="meta-label">RIF / C.I.:</span><span class="meta-val">${esc(p.client_doc)}</span></div>` : ''}
      ${p.client_contact_person ? `<div class="meta-row"><span class="meta-label">Atención:</span><span class="meta-val">${esc(p.client_contact_person)}</span></div>` : ''}
      ${p.client_phone ? `<div class="meta-row"><span class="meta-label">Teléfono:</span><span class="meta-val">${esc(p.client_phone)}</span></div>` : ''}
      ${p.client_email ? `<div class="meta-row"><span class="meta-label">Correo:</span><span class="meta-val">${esc(p.client_email)}</span></div>` : ''}
      ${p.client_address ? `<div class="meta-row"><span class="meta-label">Dirección:</span><span class="meta-val">${esc(p.client_address)}</span></div>` : ''}
    </div>

    <div class="meta-col">
      <div class="meta-col-title">Detalles de la Oferta y Proyecto</div>
      <div class="meta-row"><span class="meta-label">Fecha Emisión:</span><span class="meta-val">${dmy(p.date)}</span></div>
      <div class="meta-row"><span class="meta-label">Vigencia:</span><span class="meta-val" style="color:#B45309;font-weight:800">${dmy(p.valid_until)} (${cond.vigencia_dias || 7} días)</span></div>
      ${p.project_name ? `<div class="meta-row"><span class="meta-label">Proyecto / Obra:</span><span class="meta-val" style="font-weight:700">${esc(p.project_name)}</span></div>` : ''}
      <div class="meta-row"><span class="meta-label">Moneda:</span><span class="meta-val">Dólares Americanos ($ USD)</span></div>
      ${p.rate_bs ? `<div class="meta-row"><span class="meta-label">Tasa Ref. BCV:</span><span class="meta-val">${fmtMoney(p.rate_bs)} Bs./$</span></div>` : ''}
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="text-align:center">#</th>
        <th>Descripción del Equipo / Servicio</th>
        <th style="text-align:center">Modalidad / Unidad</th>
        <th style="text-align:center">Cant.</th>
        <th style="text-align:right">Tarifa Unit. ($)</th>
        <th style="text-align:right">Subtotal ($)</th>
      </tr>
    </thead>
    <tbody>
      ${filasItems}
    </tbody>
  </table>

  <div class="totals-wrap">
    <div class="totals-box">
      <div class="total-row">
        <span>Subtotal</span>
        <b>$ ${fmtMoney(p.subtotal)}</b>
      </div>
      ${p.con_iva ? `
      <div class="total-row">
        <span>IVA (${p.iva_pct}%)</span>
        <b>$ ${fmtMoney(p.iva_monto)}</b>
      </div>
      ` : ''}
      <div class="total-row main">
        <span>TOTAL OFERTA</span>
        <span class="val">$ ${fmtMoney(p.total)}</span>
      </div>
      ${p.total_bs ? `
      <div class="total-row bs">
        <span>Equivalente en Bs. (BCV)</span>
        <b>Bs. ${fmtMoney(p.total_bs)}</b>
      </div>
      ` : ''}
    </div>
  </div>

  <div class="cond-box">
    <div class="cond-title">Condiciones Comerciales y Operativas del Alquiler</div>
    <div class="cond-grid">
      <div class="cond-item">
        <div class="cond-k">⛽ Suministro de Combustible:</div>
        <div class="cond-v">${cond.incluye_combustible ? '✅ Incluido en la tarifa ofertada.' : '❌ Por cuenta y responsabilidad del cliente en sitio de obra.'}${cond.detalle_combustible ? ` (${esc(cond.detalle_combustible)})` : ''}</div>
      </div>
      <div class="cond-item">
        <div class="cond-k">👷 Operador de Equipo:</div>
        <div class="cond-v">${cond.incluye_operador ? '✅ Operador calificado incluido en la tarifa.' : '❌ Alquiler en seco (equipo sin operador).'}${cond.detalle_operador ? ` (${esc(cond.detalle_operador)})` : ''}</div>
      </div>
      <div class="cond-item">
        <div class="cond-k">⏱️ Mínimo Garantizado:</div>
        <div class="cond-v">
          ${cond.horas_minimas_dia ? `• Mínimo de ${cond.horas_minimas_dia} horas facturables por día.<br>` : ''}
          ${cond.horas_minimas_mes ? `• Mínimo de ${cond.horas_minimas_mes} horas facturables por mes.<br>` : ''}
          ${!cond.horas_minimas_dia && !cond.horas_minimas_mes ? '• Según horas efectivas marcadas en horómetro.' : ''}
        </div>
      </div>
      <div class="cond-item">
        <div class="cond-k">🚛 Flete y Movilización:</div>
        <div class="cond-v">${cond.flete_incluido ? '✅ Movilización y desmovilización incluida.' : '❌ Flete de traslado en Lowboy por cuenta del cliente.'}${cond.detalle_flete ? ` (${esc(cond.detalle_flete)})` : ''}</div>
      </div>
      <div class="cond-item" style="grid-column: span 2">
        <div class="cond-k">🔧 Mantenimiento y Asistencia Técnica:</div>
        <div class="cond-v">${esc(cond.mantenimiento || 'El mantenimiento preventivo y desgaste natural corresponde a la arrendadora. Desperfectos derivados de negligencia, sobrecarga o contaminación de combustible correrán por cuenta del cliente.')}</div>
      </div>
      <div class="cond-item" style="grid-column: span 2">
        <div class="cond-k">💳 Forma de Pago y Términos Comerciales:</div>
        <div class="cond-v">${esc(cond.forma_pago || '50% de anticipo para reserva y movilización del equipo; saldos mediante valuaciones semanales o quincenales según reporte de horómetro.')}</div>
      </div>
      ${cond.observaciones_generales ? `
      <div class="cond-item" style="grid-column: span 2">
        <div class="cond-k">📝 Observaciones Adicionales:</div>
        <div class="cond-v">${esc(cond.observaciones_generales)}</div>
      </div>
      ` : ''}
    </div>
  </div>

  <div class="firmas">
    <div class="firma-col">
      <div class="linea-firma"></div>
      <div class="firma-cargo">Por ${esc(p.company_name)}</div>
      <div class="firma-sub">Firma Autorizada y Sello</div>
    </div>
    <div class="firma-col">
      <div class="linea-firma"></div>
      <div class="firma-cargo">Aceptación Conforme del Cliente</div>
      <div class="firma-sub">Nombre, Firma y Sello</div>
    </div>
  </div>

  <div class="pie-legal">
    Documento emitido electrónicamente por el Sistema de Control Operativo · Este presupuesto constituye una oferta sujeta a disponibilidad de los equipos a la fecha de aceptación formal.
  </div>

  </body></html>`;
}
