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

export interface FleteItemData {
  id: string;
  flete_date: string;
  viajes: number;
  precio: number;
  code?: string;
  machinery_id?: string | null;
  plate?: string | null;
  tipo?: string | null;
}

export interface FleteReportOpts {
  companyName: string;
  machineCode?: string;
  machinePlate?: string | null;
  machineTipo?: string | null;
  periodLabel?: string;
  fletes: FleteItemData[];
}

/**
 * Genera y descarga el PDF para UN SOLO FLETE (Comprobante individual de viaje).
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

  const equipo = machineCode ? esc(machineCode) : (flete.code ? esc(flete.code) : 'General / No especificado');
  const placa = machinePlate ? esc(machinePlate) : (flete.plate ? esc(flete.plate) : '—');
  const tipo = machineTipo ? esc(machineTipo) : (flete.tipo ? esc(flete.tipo) : 'Transporte de carga');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Comprobante de Flete - ${equipo}</title>
  <style>
    @page { size: A4 portrait; margin: 20mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0F172A; background: #fff; margin: 0; padding: 0; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1E3A8A; padding-bottom: 12px; margin-bottom: 20px; }
    .logo-box img { height: 60px; width: auto; object-fit: contain; }
    .header-text { text-align: right; }
    .header-text h1 { margin: 0; font-size: 20px; font-weight: 800; color: #1E3A8A; letter-spacing: 0.5px; }
    .header-text p { margin: 4px 0 0; font-size: 12px; color: #64748B; font-weight: 600; }
    
    .card { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .card-title { font-size: 13px; font-weight: 800; text-transform: uppercase; color: #1E3A8A; margin-bottom: 12px; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { display: flex; flex-direction: column; }
    .label { font-size: 11px; text-transform: uppercase; color: #64748B; font-weight: 700; margin-bottom: 3px; }
    .val { font-size: 14px; font-weight: 700; color: #0F172A; }

    table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 16px; }
    th { background: #1E3A8A; color: #fff; text-align: left; padding: 10px 12px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    td { padding: 12px; border-bottom: 1px solid #E2E8F0; font-size: 13px; color: #0F172A; }
    .num { text-align: right; }
    .tot-row { background: #F1F5F9; font-weight: 800; }
    .tot-val { font-size: 16px; color: #15803D; font-weight: 800; }

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
      <h1>COMPROBANTE DE FLETE / VIAJE</h1>
      <p>Control Logístico y Liquidación de Transporte</p>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Datos de la Empresa y Maquinaria</div>
    <div class="grid">
      <div class="field">
        <span class="label">Empresa / Contratista:</span>
        <span class="val">${esc(companyName)}</span>
      </div>
      <div class="field">
        <span class="label">Fecha del Viaje:</span>
        <span class="val">${fecha}</span>
      </div>
      <div class="field">
        <span class="label">Maquinaria / Equipo:</span>
        <span class="val">${equipo}</span>
      </div>
      <div class="field">
        <span class="label">Placa del Equipo:</span>
        <span class="val">${placa !== '—' ? placa : '<span style="color:#94A3B8">(Sin placa registrada)</span>'}</span>
      </div>
      <div class="field">
        <span class="label">Tipo / Clasificación:</span>
        <span class="val">${tipo}</span>
      </div>
      <div class="field">
        <span class="label">Emisión del Comprobante:</span>
        <span class="val">${emitido}</span>
      </div>
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
        <td>Flete / Transporte operativo de carga — ${equipo} ${placa !== '—' ? `(Placa: ${placa})` : ''}</td>
        <td class="num">${fecha}</td>
        <td class="num" style="font-weight: 700;">${viajes}</td>
        <td class="num">$${precio.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="num" style="font-weight: 800; color: #1E3A8A;">$${totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
      <tr class="tot-row">
        <td colspan="4" style="text-align: right; text-transform: uppercase;">Total a Liquidar:</td>
        <td class="num tot-val">$${totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</td>
      </tr>
    </tbody>
  </table>

  <div class="signatures">
    <div class="sign-box">
      <div class="sign-name">Chofer / Operador</div>
      <div class="sign-role">Transporte Realizado</div>
    </div>
    <div class="sign-box">
      <div class="sign-name">Supervisor de Campo</div>
      <div class="sign-role">Conformidad de Viaje</div>
    </div>
    <div class="sign-box">
      <div class="sign-name">Control de Maquinaria</div>
      <div class="sign-role">Liquidación Aprobada</div>
    </div>
  </div>

  <div class="footer">
    Documento emitido por el Sistema de Control de Operaciones · Fecha: ${emitido}
  </div>
</body>
</html>`;

  return await exportPdf(html, `Comprobante_Flete_${equipo.replace(/\s+/g, '_')}_${fecha.replace(/\//g, '-')}`);
}

/**
 * Genera y descarga el PDF para VARIOS FLETES (Relación consolidada del bloque/período).
 */
export async function exportarReporteConsolidadoFletes(opts: FleteReportOpts): Promise<boolean> {
  const { companyName, machineCode, machinePlate, machineTipo, periodLabel, fletes } = opts;
  const emitido = nowStamp();

  const equipo = machineCode ? esc(machineCode) : '';
  const placa = machinePlate ? esc(machinePlate) : '';
  const totalViajes = fletes.reduce((s, f) => s + (Number(f.viajes) || 0), 0);
  const totalUSD = fletes.reduce((s, f) => s + (Number(f.viajes) || 0) * (Number(f.precio) || 0), 0);

  const rows = fletes
    .slice()
    .sort((a, b) => String(a.flete_date).localeCompare(String(b.flete_date)))
    .map((f, i) => {
      const v = Number(f.viajes) || 0;
      const p = Number(f.precio) || 0;
      const sub = v * p;
      const eqRow = f.code || machineCode || 'General';
      const plRow = f.plate || machinePlate || '—';
      return `<tr>
        <td style="text-align: center; color: #64748B;">${i + 1}</td>
        <td>${fmtDate(f.flete_date)}</td>
        <td><b>${esc(eqRow)}</b></td>
        <td>${esc(plRow)}</td>
        <td class="num" style="font-weight: 700;">${v}</td>
        <td class="num">$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="num" style="font-weight: 800; color: #1E3A8A;">$${sub.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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

    .summary-box { display: flex; justify-content: space-between; align-items: center; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
    .summary-item { display: flex; flex-direction: column; }
    .sum-label { font-size: 11px; text-transform: uppercase; color: #64748B; font-weight: 700; margin-bottom: 2px; }
    .sum-val { font-size: 13.5px; font-weight: 800; color: #0F172A; }

    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
    th { background: #1E3A8A; color: #fff; text-align: left; padding: 9px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    td { padding: 9px 10px; border-bottom: 1px solid #E2E8F0; color: #0F172A; }
    .num { text-align: right; }
    .tot-row { background: #F1F5F9; font-weight: 800; font-size: 13px; }
    .tot-val { font-size: 15px; color: #15803D; font-weight: 800; }

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

  <div class="summary-box">
    <div class="summary-item">
      <span class="sum-label">Empresa Contratista:</span>
      <span class="sum-val">${esc(companyName)}</span>
    </div>
    ${equipo ? `
    <div class="summary-item">
      <span class="sum-label">Equipo / Placa:</span>
      <span class="sum-val">${equipo} ${placa ? `· Placa: ${placa}` : ''}</span>
    </div>` : ''}
    <div class="summary-item">
      <span class="sum-label">Cantidad de Fletes:</span>
      <span class="sum-val">${fletes.length} registro(s)</span>
    </div>
    <div class="summary-item" style="text-align: right;">
      <span class="sum-label">Total Liquidado:</span>
      <span class="sum-val" style="color: #15803D; font-size: 15px;">$${totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 30px; text-align: center;">#</th>
        <th style="width: 85px;">Fecha</th>
        <th>Equipo / Código</th>
        <th style="width: 100px;">Placa</th>
        <th class="num" style="width: 75px;">Viajes</th>
        <th class="num" style="width: 100px;">Tarifa ($)</th>
        <th class="num" style="width: 110px;">Total ($)</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="tot-row">
        <td colspan="4" style="text-align: right; text-transform: uppercase;">Gran Total:</td>
        <td class="num" style="color: #1E3A8A;">${totalViajes}</td>
        <td></td>
        <td class="num tot-val">$${totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    </tbody>
  </table>

  <div class="signatures">
    <div class="sign-box">
      <div class="sign-name">Responsable de Transporte / Contratista</div>
      <div class="sign-role">Conformidad de Viajes Realizados</div>
    </div>
    <div class="sign-box">
      <div class="sign-name">Control de Maquinaria / Administración</div>
      <div class="sign-role">Liquidación Aprobada</div>
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
