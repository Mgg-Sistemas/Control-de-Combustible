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

function fmtDateLong(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  const meses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const mesIndex = parseInt(m, 10) - 1;
  const mesNombre = meses[mesIndex] || m;
  return `${parseInt(d, 10)} de ${mesNombre}, ${y}`;
}

export interface ParsedFleteNote {
  operacionTipo: 'pagar' | 'cobrar';
  operacionEstado: 'pendiente' | 'completado';
  modalidad?: string;
  origen?: string;
  destino?: string;
  conductor?: string;
  cedulaConductor?: string;
  cliente?: string;
  detalle: string;
  viajeIds?: string[];
  tickets?: string[];
}

export function parseFleteNote(raw?: string | null): ParsedFleteNote {
  const str = String(raw || '').trim();
  let operacionTipo: 'pagar' | 'cobrar' = 'pagar';
  let operacionEstado: 'pendiente' | 'completado' = 'pendiente';
  let modalidad = 'Día / Jornada';
  let origen = '';
  let destino = '';
  let conductor = '';
  let cedulaConductor = '';
  let cliente = '';
  let detalle = str;
  let viajeIds: string[] = [];
  let tickets: string[] = [];

  const match = str.match(/^\[([^\]]+)\]\s*(.*)$/s);
  if (match) {
    const meta = match[1];
    detalle = match[2];
    if (meta.includes('POR_COBRAR')) operacionTipo = 'cobrar';
    if (meta.includes('POR_PAGAR')) operacionTipo = 'pagar';
    if (meta.includes('ESTADO:completado') || meta.includes('ESTADO:pagado') || meta.includes('ESTADO:cobrado')) {
      operacionEstado = 'completado';
    }
    const modMatch = meta.match(/MOD:([^|]+)/);
    if (modMatch) modalidad = modMatch[1].trim();

    const origMatch = meta.match(/ORIGEN:([^|]+)/);
    if (origMatch) origen = origMatch[1].trim();

    const destMatch = meta.match(/DEST:([^|]+)/);
    if (destMatch) destino = destMatch[1].trim();

    const condMatch = meta.match(/CHOF:([^|]+)/);
    if (condMatch) conductor = condMatch[1].trim();

    const ciMatch = meta.match(/CI:([^|]+)/);
    if (ciMatch) cedulaConductor = ciMatch[1].trim();

    const cliMatch = meta.match(/CLIENTE:([^|]+)/);
    if (cliMatch) cliente = cliMatch[1].trim();

    const vIdsMatch = meta.match(/VIAJES_IDS:([^|]+)/);
    if (vIdsMatch) viajeIds = vIdsMatch[1].split(',').map((x) => x.trim()).filter(Boolean);

    const tksMatch = meta.match(/TICKETS:([^|]+)/);
    if (tksMatch) tickets = tksMatch[1].split(',').map((x) => x.trim()).filter(Boolean);
  }
  return { operacionTipo, operacionEstado, modalidad, origen, destino, conductor, cedulaConductor, cliente, detalle, viajeIds, tickets };
}

export function formatFleteNote(opts: {
  operacionTipo: 'pagar' | 'cobrar';
  operacionEstado: 'pendiente' | 'completado';
  modalidad?: string;
  origen?: string;
  destino?: string;
  conductor?: string;
  cedulaConductor?: string;
  cliente?: string;
  detalle?: string;
  viajeIds?: string[];
  tickets?: string[];
}): string {
  const parts = [
    opts.operacionTipo === 'cobrar' ? 'POR_COBRAR' : 'POR_PAGAR',
    `ESTADO:${opts.operacionEstado || 'pendiente'}`,
  ];
  if (opts.modalidad && opts.modalidad.trim()) {
    parts.push(`MOD:${opts.modalidad.trim()}`);
  }
  if (opts.origen && opts.origen.trim()) {
    parts.push(`ORIGEN:${opts.origen.trim()}`);
  }
  if (opts.destino && opts.destino.trim()) {
    parts.push(`DEST:${opts.destino.trim()}`);
  }
  if (opts.conductor && opts.conductor.trim()) {
    parts.push(`CHOF:${opts.conductor.trim()}`);
  }
  if (opts.cedulaConductor && opts.cedulaConductor.trim()) {
    parts.push(`CI:${opts.cedulaConductor.trim()}`);
  }
  if (opts.cliente && opts.cliente.trim()) {
    parts.push(`CLIENTE:${opts.cliente.trim()}`);
  }
  if (opts.viajeIds && opts.viajeIds.length > 0) {
    parts.push(`VIAJES_IDS:${opts.viajeIds.join(',')}`);
  }
  if (opts.tickets && opts.tickets.length > 0) {
    parts.push(`TICKETS:${opts.tickets.join(',')}`);
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
  modalidad?: string;
  origen?: string;
  destino?: string;
  conductor?: string;
  cedulaConductor?: string;
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
 * Genera y descarga el comprobante exacto del formato:
 * "COMPROBANTE DE SERVICIO - ACARREO Y TRANSPORTE DE MATERIAL"
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
  const fechaLarga = fmtDateLong(flete.flete_date);

  const parsed = parseFleteNote(flete.note);
  const operacionTipo = flete.operacionTipo || parsed.operacionTipo;
  const operacionEstado = flete.operacionEstado || parsed.operacionEstado;
  const modalidad = flete.modalidad || parsed.modalidad || 'Día / Jornada';
  const origen = flete.origen || parsed.origen || 'Punto de origen no especificado';
  const destino = flete.destino || parsed.destino || 'Zona de disposición autorizada';
  const conductor = flete.conductor || parsed.conductor || 'Conductor asignado';
  const cedula = flete.cedulaConductor || parsed.cedulaConductor || '—';
  const detalleServicio = parsed.detalle || 'Servicio de Acarreo y Disposición Final';

  const esCobro = operacionTipo === 'cobrar';
  const esCompletado = operacionEstado === 'completado';

  const equipo = machineCode ? esc(machineCode) : (flete.code ? esc(flete.code) : 'Camión Volteo');
  const placa = machinePlate ? esc(machinePlate) : (flete.plate ? esc(flete.plate) : '—');
  const tipo = machineTipo ? esc(machineTipo) : (flete.tipo ? esc(flete.tipo) : 'Transporte de Carga');

  // Separar origen en título y subtítulo si tiene guión o coma
  const origParts = origen.split(/[-–—,]/).map((s) => s.trim()).filter(Boolean);
  const origTitle = origParts[0] || origen;
  const origSub = origParts.slice(1).join(' - ') || '';

  const destParts = destino.split(/[-–—,]/).map((s) => s.trim()).filter(Boolean);
  const destTitle = destParts[0] || destino;
  const destSub = destParts.slice(1).join(' - ') || (destParts.length === 1 ? 'Zona de Disposición Autorizada' : '');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Comprobante de Servicio - ${equipo} - ${placa}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 18mm 16mm 18mm 16mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1E293B;
      background: #FFFFFF;
      margin: 0;
      padding: 0;
      line-height: 1.35;
    }

    /* Cabecera idéntica al documento */
    .top-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
      padding-bottom: 12px;
      border-bottom: 2px solid #0F172A;
    }
    .top-left h1 {
      font-size: 26px;
      font-weight: 900;
      letter-spacing: 0.5px;
      color: #0F172A;
      margin: 0 0 4px 0;
      text-transform: uppercase;
    }
    .top-left p {
      font-size: 13.5px;
      font-weight: 700;
      color: #0284C7;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .top-right {
      text-align: right;
    }
    .badge-orden {
      display: inline-block;
      background: #334155;
      color: #FFFFFF;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      padding: 4px 10px;
      border-radius: 4px;
      margin-bottom: 5px;
    }
    .meta-line {
      font-size: 11px;
      color: #64748B;
      font-weight: 600;
      margin-top: 2px;
    }
    .meta-line b {
      color: #0F172A;
    }

    /* Secciones con borde vertical azul */
    .section-title {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      color: #0F172A;
      letter-spacing: 0.5px;
      margin: 22px 0 12px 0;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 28px;
      row-gap: 16px;
    }
    .block-card {
      border-left: 3px solid #0284C7;
      padding-left: 10px;
    }
    .block-card .tag {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      color: #64748B;
      letter-spacing: 0.4px;
      margin-bottom: 3px;
    }
    .block-card .val-main {
      font-size: 13.5px;
      font-weight: 800;
      color: #0F172A;
    }
    .block-card .val-sub {
      font-size: 11.5px;
      color: #475569;
      margin-top: 1px;
      font-weight: 500;
    }

    /* Tabla de detalle y tarifa */
    table.tarifa-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      margin-bottom: 24px;
    }
    table.tarifa-table th {
      background: #475569;
      color: #FFFFFF;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 8px 10px;
      text-align: left;
    }
    table.tarifa-table th.right, table.tarifa-table td.right {
      text-align: right;
    }
    table.tarifa-table th.center, table.tarifa-table td.center {
      text-align: center;
    }
    table.tarifa-table td {
      padding: 12px 10px;
      font-size: 12px;
      color: #0F172A;
      border-bottom: 1px solid #E2E8F0;
    }
    .desc-main {
      font-weight: 800;
      font-size: 12.5px;
      color: #0F172A;
    }
    .desc-sub {
      font-size: 10.5px;
      color: #64748B;
      margin-top: 3px;
    }

    /* Bloque final de Total a Pagar */
    .total-container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
      padding-top: 14px;
    }
    .total-label-box h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 900;
      color: #0F172A;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .total-label-box p {
      margin: 3px 0 0 0;
      font-size: 11px;
      color: #64748B;
      font-weight: 500;
    }
    .total-amount {
      font-size: 26px;
      font-weight: 900;
      color: #0284C7;
      letter-spacing: 0.5px;
    }

    /* Firmas */
    .firmas-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 50px;
      margin-top: 70px;
      text-align: center;
    }
    .firma-box {
      border-top: 1px solid #94A3B8;
      padding-top: 6px;
    }
    .firma-name {
      font-size: 11.5px;
      font-weight: 700;
      color: #0F172A;
    }
    .firma-role {
      font-size: 10px;
      color: #64748B;
      text-transform: uppercase;
      margin-top: 1px;
    }
  </style>
</head>
<body>
  <!-- CABECERA -->
  <div class="top-header">
    <div class="top-left">
      <h1>COMPROBANTE DE SERVICIO</h1>
      <p>ACARREO Y TRANSPORTE DE MATERIAL</p>
    </div>
    <div class="top-right">
      <div class="badge-orden">ORDEN DE ACARREO</div>
      <div class="meta-line">Fecha: <b>${fechaLarga}</b></div>
      <div class="meta-line">Estado: <b style="color: ${esCompletado ? '#059669' : '#D97706'};">${esCompletado ? 'COMPLETADO' : 'PENDIENTE'}</b></div>
    </div>
  </div>

  <!-- SECCIÓN 1: UBICACIÓN Y RUTA DEL SERVICIO -->
  <div class="section-title">UBICACIÓN Y RUTA DEL SERVICIO</div>
  <div class="grid-2">
    <div class="block-card">
      <div class="tag">PUNTO DE ORIGEN / CARGA</div>
      <div class="val-main">${esc(origTitle)}</div>
      ${origSub ? `<div class="val-sub">${esc(origSub)}</div>` : ''}
    </div>
    <div class="block-card">
      <div class="tag">PUNTO DE BOTE / DESTINO</div>
      <div class="val-main">${esc(destTitle)}</div>
      ${destSub ? `<div class="val-sub">${esc(destSub)}</div>` : ''}
    </div>
  </div>

  <!-- SECCIÓN 2: DATOS DE LA UNIDAD Y CONDUCTOR -->
  <div class="section-title">DATOS DE LA UNIDAD Y CONDUCTOR</div>
  <div class="grid-2">
    <div class="block-card">
      <div class="tag">VEHÍCULO DE TRANSPORTE</div>
      <div class="val-main">${esc(equipo)}</div>
      <div class="val-sub">Placa: ${esc(placa)} ${tipo ? `· ${esc(tipo)}` : ''}</div>
    </div>
    <div class="block-card">
      <div class="tag">CONDUCTOR ASIGNADO</div>
      <div class="val-main">${esc(conductor)}</div>
      <div class="val-sub">C.I.: ${esc(cedula)}</div>
    </div>
  </div>

  <!-- SECCIÓN 3: DETALLE DEL SERVICIO Y TARIFA -->
  <div class="section-title">DETALLE DEL SERVICIO Y TARIFA</div>
  <table class="tarifa-table">
    <thead>
      <tr>
        <th style="width: 50%;">DESCRIPCIÓN</th>
        <th class="center" style="width: 12%;">CANT.</th>
        <th style="width: 20%;">MODALIDAD</th>
        <th class="right" style="width: 18%;">MONTO ($)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <div class="desc-main">${esc(detalleServicio)}</div>
          <div class="desc-sub">Carga en ${esc(origTitle)} y bote en ${esc(destTitle)}</div>
          ${parsed.tickets && parsed.tickets.length > 0 ? `<div class="desc-sub" style="color: #0284C7; font-weight: 700; margin-top: 4px;">🎫 Tickets de romana: ${esc(parsed.tickets.join(', '))}</div>` : ''}
        </td>
        <td class="center" style="font-weight: 700;">${viajes}</td>
        <td>${esc(modalidad)}</td>
        <td class="right" style="font-weight: 700;">$${totalUSD.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    </tbody>
  </table>

  <!-- TOTAL A PAGAR / COBRAR -->
  <div class="total-container">
    <div class="total-label-box">
      <h2>TOTAL A ${esCobro ? 'COBRAR' : 'PAGAR'}</h2>
      <p>Tarifa acordada por la jornada del servicio</p>
    </div>
    <div class="total-amount">
      $${totalUSD.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </div>
  </div>

  <!-- FIRMAS -->
  <div class="firmas-grid">
    <div class="firma-box">
      <div class="firma-name">${esc(conductor)}</div>
      <div class="firma-role">Conductor Asignado</div>
    </div>
    <div class="firma-box">
      <div class="firma-name">Supervisor / Control de Operaciones</div>
      <div class="firma-role">Revisión y Aprobación</div>
    </div>
  </div>
</body>
</html>`;

  return await exportPdf(html, `Comprobante_Servicio_${equipo.replace(/\s+/g, '_')}_${placa.replace(/\s+/g, '_')}`);
}

/**
 * Genera y descarga el PDF para VARIOS FLETES (Relación consolidada por Empresa, por Camión o General, desglosando Cobros y Pagos).
 */
export async function exportarReporteConsolidadoFletes(opts: FleteReportOpts): Promise<boolean> {
  const { companyName, machineCode, machinePlate, periodLabel, fletes } = opts;
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
        <td>
          <b>${esc(eqRow)}</b>
          ${parsed.tickets && parsed.tickets.length > 0 ? `<div style="font-size: 9.5px; color: #0284C7; font-weight: 600;">Tickets: ${esc(parsed.tickets.join(', '))}</div>` : ''}
        </td>
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
