import type { AutorizacionTrasladoData } from './autorizacionTraslado';

function esc(val: any): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Genera el HTML para el formato:
 * "INFORME DE TRASLADO DE CARGA - CONTROL LOGÍSTICO OPERATIVO Y REGISTRO DE VIAJES"
 * Formato ejecutivo con cronograma, tabla de rutas y resumen narrativo de movimientos.
 */
export function informeTrasladoCargaHtml(d: AutorizacionTrasladoData): string {
  const fecha = esc(d.fecha || new Date().toLocaleDateString('es-VE'));
  const origen = esc(d.origen || 'Origen no especificado');
  const destino = esc(d.destino || 'Destino no especificado');

  const maq = d.maquinaria || {};
  const equipoNombre = esc(maq.codigo || maq.tipo || 'Equipo / Maquinaria');
  const placaEquipo = maq.placa && maq.placa !== '—' ? esc(maq.placa) : '';

  const trans = d.transporte || {};
  const conductor = esc(trans.conductorNombre && trans.conductorNombre !== '—' ? trans.conductorNombre : 'Sin asignar');
  const placaVehiculo = esc(trans.placaChuto && trans.placaChuto !== '—' ? trans.placaChuto : (trans.placaLowboy || 'Sin placa'));

  const autoriza = esc(d.firmas?.autorizadoPorEmpresa || d.empresaEmisora?.nombre || 'Autorizado por la Gerencia');
  const estatusGeneral = d.estado?.operativo ? 'Completado' : 'En proceso / Observación';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Informe de Traslado - ${origen} a ${destino}</title>
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
      margin: 0;
      padding: 0;
      color: #0F172A;
      background: #FFFFFF;
      line-height: 1.4;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    .header-left h1 {
      margin: 0 0 2px 0;
      font-size: 21px;
      font-weight: 900;
      letter-spacing: -0.3px;
      color: #0F172A;
      text-transform: uppercase;
    }
    .header-left .subtitle {
      font-size: 11px;
      font-weight: 600;
      color: #64748B;
      letter-spacing: 0.8px;
      text-transform: uppercase;
    }
    .header-right {
      text-align: right;
      font-size: 11px;
      color: #0F172A;
    }
    .header-right .line {
      margin-bottom: 2px;
    }
    .header-right .lbl {
      color: #475569;
    }
    .header-right .val {
      font-weight: 700;
      color: #0F172A;
    }
    .divider-main {
      border: 0;
      border-top: 2.5px solid #0F172A;
      margin: 8px 0 16px 0;
    }
    .meta-box {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 4px;
      padding: 12px 18px;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 22px;
    }
    .meta-col {
      flex: 1;
    }
    .meta-lbl {
      font-size: 10px;
      font-weight: 700;
      color: #64748B;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .meta-val {
      font-size: 13.5px;
      font-weight: 800;
      color: #0F172A;
    }
    .sec-title {
      font-size: 12.5px;
      font-weight: 800;
      color: #0F172A;
      text-transform: uppercase;
      letter-spacing: 0.2px;
      margin: 22px 0 10px 0;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    table.data-table th {
      background: #001F3F;
      color: #FFFFFF;
      font-size: 10.5px;
      font-weight: 700;
      text-align: left;
      padding: 9px 10px;
      letter-spacing: 0.3px;
    }
    table.data-table th:first-child {
      border-top-left-radius: 3px;
    }
    table.data-table th:last-child {
      border-top-right-radius: 3px;
    }
    table.data-table td {
      border-bottom: 1px solid #E2E8F0;
      padding: 9px 10px;
      font-size: 12px;
      color: #1E293B;
    }
    .badge-completado {
      display: inline-block;
      background: #DCFCE7;
      color: #166534;
      font-size: 10.5px;
      font-weight: 800;
      padding: 2.5px 7px;
      border-radius: 3px;
    }
    .summary-text {
      font-size: 12px;
      color: #334155;
      margin: 0 0 10px 0;
    }
    .summary-list {
      margin: 0;
      padding-left: 20px;
      font-size: 12px;
      color: #1E293B;
      line-height: 1.6;
    }
    .summary-list li {
      margin-bottom: 6px;
    }
    .footer-bar {
      margin-top: 48px;
      padding-top: 10px;
      border-top: 1px solid #E2E8F0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      color: #94A3B8;
    }
  </style>
</head>
<body>

  <!-- Encabezado superior -->
  <div class="header-row">
    <div class="header-left">
      <h1>INFORME DE TRASLADO DE CARGA</h1>
      <div class="subtitle">CONTROL LOGÍSTICO OPERATIVO Y REGISTRO DE VIAJES</div>
    </div>
    <div class="header-right">
      <div class="line"><span class="lbl">Fecha Emisión:</span> <span class="val">${fecha}</span></div>
      <div class="line"><span class="lbl">Estatus General:</span> <span class="val">${estatusGeneral}</span></div>
    </div>
  </div>

  <hr class="divider-main" />

  <!-- Bloque de 3 columnas de metadata -->
  <div class="meta-box">
    <div class="meta-col">
      <div class="meta-lbl">CONDUCTOR ASIGNADO</div>
      <div class="meta-val">${conductor}</div>
    </div>
    <div class="meta-col">
      <div class="meta-lbl">PLACA DEL VEHÍCULO</div>
      <div class="meta-val">${placaVehiculo}</div>
    </div>
    <div class="meta-col">
      <div class="meta-lbl">AUTORIZACIÓN GENERAL</div>
      <div class="meta-val">${autoriza}</div>
    </div>
  </div>

  <!-- 1. Cronograma y Registro de Traslados -->
  <div class="sec-title">1. CRONOGRAMA Y REGISTRO DE TRASLADOS</div>
  <table class="data-table">
    <thead>
      <tr>
        <th style="width: 14%;">Fecha</th>
        <th style="width: 22%;">Carga / Equipo</th>
        <th style="width: 18%;">Origen</th>
        <th style="width: 18%;">Destino</th>
        <th style="width: 16%;">Autoriza</th>
        <th style="width: 12%;">Estado</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${fecha}</td>
        <td>
          <b>${equipoNombre}</b>
          ${placaEquipo ? `<br/><span style="font-size: 10.5px; color: #64748B;">Placa: ${placaEquipo}</span>` : ''}
        </td>
        <td>${origen}</td>
        <td>${destino}</td>
        <td>${autoriza}</td>
        <td><span class="badge-completado">${estatusGeneral}</span></td>
      </tr>
    </tbody>
  </table>

  <!-- 2. Resumen de Movimientos -->
  <div class="sec-title">2. RESUMEN DE MOVIMIENTOS</div>
  <p class="summary-text">
    Se confirma la correcta ejecución de la operación de traslado bajo los parámetros aprobados:
  </p>
  <ul class="summary-list">
    <li>
      <b>${equipoNombre}</b>: Movilizado desde <b>${origen}</b> con destino a <b>${destino}</b>, operado por el chofer <b>${conductor}</b> (Placa <b>${placaVehiculo}</b>) y autorizado por <b>${autoriza}</b> el ${fecha}.${placaEquipo ? ` Identificación placa del equipo: <b>${placaEquipo}</b>.` : ''}
    </li>
  </ul>

  <!-- Pie de página -->
  <div class="footer-bar">
    <div>Informe de Traslado - ${origen} a ${destino}</div>
    <div>Página 1</div>
  </div>

</body>
</html>`;
}
