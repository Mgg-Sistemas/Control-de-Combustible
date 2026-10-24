import { exportPdf, nowStamp } from './pdf';
import { LOGO_DATA_URI } from './logoData';

function esc(val: any): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export interface ParsedFleteNote {
  operacionTipo: 'pagar' | 'cobrar';
  operacionEstado: 'pendiente' | 'completado';
  cliente?: string;
  detalle: string;
}

export function parseFleteNote(raw?: string | null): ParsedFleteNote {
  const str = String(raw || '').trim();
  let operacionTipo: 'pagar' | 'cobrar' = 'pagar';
  let operacionEstado: 'pendiente' | 'completado' = 'pendiente';
  let cliente = '';
  let detalle = str;

  const match = str.match(/^\[([^\]]+)\]\s*(.*)$/s);
  if (match) {
    const meta = match[1];
    detalle = match[2];
    if (meta.includes('POR_COBRAR')) operacionTipo = 'cobrar';
    if (meta.includes('POR_PAGAR')) operacionTipo = 'pagar';
    if (meta.includes('ESTADO:completado') || meta.includes('ESTADO:pagado') || meta.includes('ESTADO:cobrado')) {
      operacionEstado = 'completado';
    }
    const cliMatch = meta.match(/CLIENTE:([^|]+)/);
    if (cliMatch) cliente = cliMatch[1].trim();
  }
  return { operacionTipo, operacionEstado, cliente, detalle };
}

export function formatFleteNote(opts: {
  operacionTipo: 'pagar' | 'cobrar';
  operacionEstado: 'pendiente' | 'completado';
  cliente?: string;
  detalle?: string;
}): string {
  const parts = [
    opts.operacionTipo === 'cobrar' ? 'POR_COBRAR' : 'POR_PAGAR',
    `ESTADO:${opts.operacionEstado || 'pendiente'}`,
  ];
  if (opts.cliente && opts.cliente.trim()) {
    parts.push(`CLIENTE:${opts.cliente.trim()}`);
  }
  const meta = `[${parts.join('|')}]`;
  const text = (opts.detalle || '').trim();
  return text ? `${meta} ${text}` : meta;
}

export interface FleteItemData {
  id: string;
  flete_date: string;
  viajes: number;
  precio: number;
  code?: string;
  machinery_id?: string | null;
  plate?: string | null;
  tipo?: string | null;
  operacionTipo?: 'pagar' | 'cobrar';
  operacionEstado?: 'pendiente' | 'completado';
  cliente?: string;
  note?: string | null;
}

export interface FleteReportOpts {
  companyName: string;
  machineCode?: string;
  machinePlate?: string | null;
  machineTipo?: string | null;
  periodLabel?: string;
  filterTipo?: 'todos' | 'pagar' | 'cobrar';
  fletes: FleteItemData[];
}

/**
 * Genera y descarga el PDF para UN SOLO FLETE (Comprobante individual de viaje, ya sea de Pago o de Cobro).
 */
export async function exportarComprobanteFlete(opts: {
  flete: FleteItemData;
  companyName: string;
  machineCode?: string;
  machinePlate?: string | null;
  machineTipo?: string | null;
}): Promise<boolean> {
  const { flete, companyName, machineCode, machinePlate, machineTipo } = opts;
  const viajes = Number(flete.viajes) || 0;
  const precio = Number(flete.precio) || 0;
  const totalUSD = viajes * precio;
  const fecha = fmtDate(flete.flete_date);
  const emitido = nowStamp();

  const parsed = parseFleteNote(flete.note);
  const operacionTipo = flete.operacionTipo || parsed.operacionTipo;
  const operacionEstado = flete.operacionEstado || parsed.operacionEstado;
  const cliente = flete.cliente || parsed.cliente;
  const detalleNota = parsed.detalle || '';

  const esCobro = operacionTipo === 'cobrar';
  const esCompletado = operacionEstado === 'completado';

  const docTitle = esCobro ? 'COMPROBANTE DE COBRO DE FLETE' : 'COMPROBANTE DE PAGO / LIQUIDACIÓN DE FLETE';
  const docSubtitle = esCobro
    ? 'Servicio de Transporte y Movilización de Carga Facturable'
    : 'Liquidación de Viajes y Transporte a Contratista';

  const estadoBadge = esCompletado
    ? `<span style="background: #DCFCE7; color: #166534; padding: 4px 8px; border-radius: 4px; font-weight: 800; font-size: 11px;">✅ ${esCobro ? 'COBRADO' : 'PAGADO'}</span>`
    : `<span style="background: #FEF3C7; color: #92400E; padding: 4px 8px; border-radius: 4px; font-weight: 800; font-size: 11px;">⏳ PENDIENTE</span>`;

  const equipo = machineCode ? esc(machineCode) : (flete.code ? esc(flete.code) : 'General / No especificado');
  const placa = machinePlate ? esc(machinePlate) : (flete.plate ? esc(flete.plate) : '—');
  const tipo = machineTipo ? esc(machineTipo) : (flete.tipo ? esc(flete.tipo) : 'Transporte de carga');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${docTitle} - ${equipo}</title>
  <style>
    @page { size: A4 portrait; margin: 20mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0F172A; background: #fff; margin: 0; padding: 0; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid ${esCobro ? '#059669' : '#1E3A8A'}; padding-bottom: 12px; margin-bottom: 20px; }
    .logo-box img { height: 60px; width: auto; object-fit: contain; }
    .header-text { text-align: right; }
    .header-text h1 { margin: 0; font-size: 18.5px; font-weight: 800; color: ${esCobro ? '#059669' : '#1E3A8A'}; letter-spacing: 0.5px; }
    .header-text p { margin: 4px 0 0; font-size: 12px; color: #64748B; font-weight: 600; }
    
    .card { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .card-title { font-size: 13px; font-weight: 800; text-transform: uppercase; color: ${esCobro ? '#059669' : '#1E3A8A'}; margin-bottom: 12px; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { display: flex; flex-direction: column; }
    .label { font-size: 11px; text-transform: uppercase; color: #64748B; font-weight: 700; margin-bottom: 3px; }
    .val { font-size: 13.5px; font-weight: 700; color: #0F172A; }

    table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 16px; }
    th { background: ${esCobro ? '#059669' : '#1E3A8A'}; color: #fff; text-align: left; padding: 10px 12px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    td { padding: 12px; border-bottom: 1px solid #E2E8F0; font-size: 13px; color: #0F172A; }
    .num { text-align: right; }
    .tot-row { background: #F1F5F9; font-weight: 800; }
    .tot-val { font-size: 16px; color: ${esCobro ? '#059669' : '#15803D'}; font-weight: 800; }

    .signatures { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 45px; text-align: center; }
    .sign-box { border-top: 1px solid #64748B; padding-top: 8px; }
    .sign-name { font-size: 12px; font-weight: 700; color: #0F172A; }
    .sign-role { font-size: 10px; color: #64748B; text-transform: uppercase; }
    .footer { margin-top: 30px; font-size: 10px; color: #94A3B8; text-align: center; border-top: 1px solid #E2E8F0; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-box">
      ${LOGO_DATA_URI ? `<img src="${LOGO_DATA_URI}" alt="Logo" />` : ''}
    </div>
    <div class="header-text">
      <h1>${docTitle}</h1>
      <p>${docSubtitle}</p>
    </div>
  </div>

  <div class="card">
    <div class="card-title">
      <span>Datos del Servicio y Maquinaria</span>
      <span>${estadoBadge}</span>
    </div>
    <div class="grid">
      <div class="field">
        <span class="label">${esCobro ? 'Cliente / Receptor:' : 'Empresa / Contratista:'}</span>
        <span class="val">${cliente ? esc(cliente) : esc(companyName)}</span>
      </div>
      <div class="field">
        <span class="label">Modalidad / Operación:</span>
        <span class="val" style="color: ${esCobro ? '#059669' : '#1E3A8A'};">${esCobro ? '💰 Servicio por Cobrar (Facturable)' : '💸 Servicio por Pagar (Liquidación a Fletero)'}</span>
      </div>
      <div class="field">
        <span class="label">Fecha del Viaje:</span>
        <span class="val">${fecha}</span>
      </div>
      <div class="field">
        <span class="label">Maquinaria / Camión:</span>
        <span class="val">${equipo}</span>
      </div>
      <div class="field">
        <span class="label">Placa del Camión/Equipo:</span>
        <span class="val">${placa !== '—' ? placa : '<span style="color:#94A3B8">(Sin placa registrada)</span>'}</span>
      </div>
      <div class="field">
        <span class="label">Tipo / Clasificación:</span>
        <span class="val">${tipo}</span>
      </div>
      ${detalleNota ? `
      <div class="field" style="grid-column: 1 / -1;">
        <span class="label">Ruta / Detalle del Viaje:</span>
        <span class="val" style="font-weight: 500; font-style: italic;">${esc(detalleNota)}</span>
      </div>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Concepto / Detalle</th>
        <th class="num" style="width: 100px;">Fecha</th>
        <th class="num" style="width: 110px;">Nº Viajes</th>
        <th class="num" style="width: 130px;">Tarifa / Viaje</th>
        <th class="num" style="width: 130px;">Total ($ USD)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Flete / Transporte de carga — ${equipo} ${placa !== '—' ? `(Placa: ${placa})` : ''}</td>
        <td class="num">${fecha}</td>
        <td class="num" style="font-weight: 700;">${viajes}</td>
        <td class="num">$${precio.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="num" style="font-weight: 800; color: ${esCobro ? '#059669' : '#1E3A8A'};">$${totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
      <tr class="tot-row">
        <td colspan="4" style="text-align: right; text-transform: uppercase;">${esCobro ? 'Total a Cobrar:' : 'Total a Liquidar:'}</td>
        <td class="num tot-val">$${totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</td>
      </tr>
    </tbody>
  </table>

  <div class="signatures">
    <div class="sign-box">
      <div class="sign-name">Chofer / Transportista</div>
      <div class="sign-role">Transporte Realizado</div>
    </div>
    <div class="sign-box">
      <div class="sign-name">${esCobro ? 'Cliente / Recibido' : 'Supervisor de Campo'}</div>
      <div class="sign-role">Conformidad del Servicio</div>
    </div>
    <div class="sign-box">
      <div class="sign-name">Administración y Control</div>
      <div class="sign-role">${esCobro ? 'Facturación / Cobranza' : 'Aprobación de Pago'}</div>
    </div>
  </div>

  <div class="footer">
    Documento emitido por el Sistema de Control de Operaciones · Fecha: ${emitido}
  </div>
</body>
</html>`;

  const safePref = esCobro ? 'Comprobante_Cobro' : 'Comprobante_Pago';
  return await exportPdf(html, `${safePref}_${equipo.replace(/\s+/g, '_')}_${fecha.replace(/\//g, '-')}`);
}

/**
 * Genera y descarga el PDF para VARIOS FLETES (Relación consolidada por Empresa, por Camión o General, desglosando Cobros y Pagos).
 */
export async function exportarReporteConsolidadoFletes(opts: FleteReportOpts): Promise<boolean> {
  const { companyName, machineCode, machinePlate, periodLabel, filterTipo, fletes } = opts;
  const emitido = nowStamp();

  const equipo = machineCode ? esc(machineCode) : '';
  const placa = machinePlate ? esc(machinePlate) : '';

  let totalViajesPagar = 0;
  let totalUSDPagar = 0;
  let totalViajesCobrar = 0;
  let totalUSDCobrar = 0;

  const rows = fletes
    .slice()
    .sort((a, b) => String(a.flete_date).localeCompare(String(b.flete_date)))
    .map((f, i) => {
      const v = Number(f.viajes) || 0;
      const p = Number(f.precio) || 0;
      const sub = v * p;

      const parsed = parseFleteNote(f.note);
      const operacionTipo = f.operacionTipo || parsed.operacionTipo;
      const esCobro = operacionTipo === 'cobrar';

      if (esCobro) {
        totalViajesCobrar += v;
        totalUSDCobrar += sub;
      } else {
        totalViajesPagar += v;
        totalUSDPagar += sub;
      }

      const eqRow = f.code || machineCode || 'General';
      const plRow = f.plate || machinePlate || '—';

      const tagTipo = esCobro
        ? `<span style="color: #059669; font-weight: 800; font-size: 10px;">💰 COBRO</span>`
        : `<span style="color: #1E3A8A; font-weight: 800; font-size: 10px;">💸 PAGO</span>`;

      return `<tr>
        <td style="text-align: center; color: #64748B;">${i + 1}</td>
        <td>${fmtDate(f.flete_date)}</td>
        <td>${tagTipo}</td>
        <td><b>${esc(eqRow)}</b></td>
        <td>${esc(plRow)}</td>
        <td class="num" style="font-weight: 700;">${v}</td>
        <td class="num">$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="num" style="font-weight: 800; color: ${esCobro ? '#059669' : '#1E3A8A'};">$${sub.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Reporte de Fletes - ${esc(companyName)}</title>
  <style>
    @page { size: A4 portrait; margin: 18mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0F172A; background: #fff; margin: 0; padding: 0; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1E3A8A; padding-bottom: 12px; margin-bottom: 16px; }
    .logo-box img { height: 55px; width: auto; object-fit: contain; }
    .header-text { text-align: right; }
    .header-text h1 { margin: 0; font-size: 19px; font-weight: 800; color: #1E3A8A; letter-spacing: 0.5px; }
    .header-text p { margin: 3px 0 0; font-size: 12px; color: #64748B; font-weight: 600; }

    .summary-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    .summary-card { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px; }
    .sum-title { font-size: 11px; text-transform: uppercase; color: #64748B; font-weight: 700; margin-bottom: 4px; }
    .sum-amt { font-size: 16px; font-weight: 800; }

    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
    th { background: #1E3A8A; color: #fff; text-align: left; padding: 9px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    td { padding: 9px 10px; border-bottom: 1px solid #E2E8F0; color: #0F172A; }
    .num { text-align: right; }
    .tot-row { background: #F1F5F9; font-weight: 800; font-size: 13px; }

    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; text-align: center; }
    .sign-box { border-top: 1px solid #64748B; padding-top: 8px; }
    .sign-name { font-size: 12px; font-weight: 700; color: #0F172A; }
    .sign-role { font-size: 10px; color: #64748B; text-transform: uppercase; }
    .footer { margin-top: 25px; font-size: 10px; color: #94A3B8; text-align: center; border-top: 1px solid #E2E8F0; padding-top: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-box">
      ${LOGO_DATA_URI ? `<img src="${LOGO_DATA_URI}" alt="Logo" />` : ''}
    </div>
    <div class="header-text">
      <h1>RELACIÓN DE FLETES Y VIAJES</h1>
      <p>${periodLabel ? `Período: ${esc(periodLabel)}` : 'Resumen Operativo de Viajes'}</p>
    </div>
  </div>

  <div class="summary-grid">
    <div class="summary-card">
      <div class="sum-title">Criterio / Entidad:</div>
      <div style="font-weight: 800; font-size: 13px; color: #0F172A;">${esc(companyName)}</div>
      ${equipo ? `<div style="font-size: 11.5px; color: #64748B; margin-top: 2px;">🚜 ${equipo} ${placa ? `· Placa: ${placa}` : ''}</div>` : ''}
    </div>
    <div class="summary-card" style="border-left: 3px solid #1E3A8A;">
      <div class="sum-title">💸 Total por Pagar (Fleteros):</div>
      <div class="sum-amt" style="color: #1E3A8A;">$${totalUSDPagar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      <div style="font-size: 11px; color: #64748B;">${totalViajesPagar} viaje(s) por pagar</div>
    </div>
    <div class="summary-card" style="border-left: 3px solid #059669;">
      <div class="sum-title">💰 Total por Cobrar (Clientes):</div>
      <div class="sum-amt" style="color: #059669;">$${totalUSDCobrar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      <div style="font-size: 11px; color: #64748B;">${totalViajesCobrar} viaje(s) por cobrar</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 25px; text-align: center;">#</th>
        <th style="width: 80px;">Fecha</th>
        <th style="width: 75px;">Tipo</th>
        <th>Camión / Equipo</th>
        <th style="width: 95px;">Placa</th>
        <th class="num" style="width: 65px;">Viajes</th>
        <th class="num" style="width: 90px;">Tarifa ($)</th>
        <th class="num" style="width: 105px;">Total ($)</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="tot-row">
        <td colspan="5" style="text-align: right; text-transform: uppercase;">Totales:</td>
        <td class="num">${totalViajesPagar + totalViajesCobrar}</td>
        <td></td>
        <td class="num" style="font-size: 14px; color: #0F172A;">
          $${(totalUSDPagar + totalUSDCobrar).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>
      </tr>
    </tbody>
  </table>

  <div class="signatures">
    <div class="sign-box">
      <div class="sign-name">Responsable de Transporte / Supervisor</div>
      <div class="sign-role">Conformidad de Viajes Realizados</div>
    </div>
    <div class="sign-box">
      <div class="sign-name">Administración y Finanzas</div>
      <div class="sign-role">Revisión y Aprobación Contable</div>
    </div>
  </div>

  <div class="footer">
    Reporte generado automáticamente · ${emitido} · Sistema de Control de Operaciones
  </div>
</body>
</html>`;

  const safeTitle = (machineCode || companyName || 'Fletes').replace(/\s+/g, '_');
  return await exportPdf(html, `Relacion_Fletes_${safeTitle}_${nowStamp().replace(/[^a-zA-Z0-9]/g, '_')}`);
}
