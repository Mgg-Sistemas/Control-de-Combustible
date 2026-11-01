import { LogosConfig } from './notaEntrega';
import { LOGO_DATA_URI } from './logoData';
import { GOLDEN_TOUCH_LOGO_DATA_URI } from './logoGoldenTouchData';
import { RENACE_LOGO_DATA_URI } from './logoRenaceData';
import { JHENZAEN_LOGO_DATA_URI } from './logoJhenzaenData';
import { BCV_LOGO_DATA_URI } from './logoBcvData';

export interface AutorizacionTrasladoData {
  // Control y fecha
  numeroControl: string;             // ej: "AT-2026-17092026"
  fecha: string;                     // ej: "17 / 9 / 2026"

  // Empresa Emisora
  empresaEmisora: {
    nombre: string;
    rif?: string | null;
  };
  logos?: LogosConfig;

  // 1. Maquinaria
  maquinaria: {
    codigo?: string | null;
    tipo?: string | null;            // ej: "Minishover"
    marca?: string | null;           // ej: "Lovol"
    modelo?: string | null;          // ej: "FSL75"
    anio?: string | number | null;   // ej: "2025"
    color?: string | null;           // ej: "Amarillo / Negro"
    serial?: string | null;          // ej: "CLW09L58VSH000104"
    placa?: string | null;           // ¡OBLIGATORIA POR REGLA DEL PROYECTO!
    pesoOperativo?: string | null;   // ej: "3.500 kg"
    potenciaMotor?: string | null;   // ej: "55KW"
  };

  // 2. Origen y Destino
  origen: string;                    // ej: "Camuri Chico / La Guaira"
  destino: string;                   // ej: "Puerto Ordaz / Estado Bolivar"

  // 3. Transporte y Conductor
  transporte: {
    conductorNombre?: string | null; // ej: "Jose Gregorio Gomez"
    conductorCedula?: string | null; // ej: "V-11.683.953"
    vehiculoChuto?: string | null;   // ej: "Chuto" o "Chuto Mack"
    placaChuto?: string | null;      // ej: "A22CY0J"
    vehiculoLowboy?: string | null;  // ej: "Lowboy" o "Batea 3 ejes"
    placaLowboy?: string | null;     // ej: "A97BE9P"
    telefonoContacto?: string | null;// ej: "04264902690"
    vigenciaTraslado?: string | null;// ej: "Del 17/9 al 23/9"
  };

  // 4. Estado del equipo al salir
  estado: {
    operativo: boolean;
    inoperativo: boolean;
    combustiblePct?: number | string | null; // ej: 75 o "___"
    limpiezaAceptable: boolean;
    observacionesDanios?: string | null;
  };

  // Firmas
  firmas?: {
    autorizadoPorEmpresa?: string | null;
    transportistaNombre?: string | null;
    recibidoDestinoNombre?: string | null;
  };

  // Servicio / Flete (opcional para trazabilidad interna)
  servicio?: {
    registraServicio?: boolean;
    modalidad?: 'monto_fijo' | 'por_jornada' | 'traslado_interno';
    monto?: number | null;
    jornadas?: number | null;
    tarifaJornada?: number | null;
    moneda?: string;
    estadoPago?: 'pendiente' | 'cobrado' | 'pagado';
    clienteOProveedor?: string | null;
  } | null;
}

function esc(val: any): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLogosHtml(logos?: LogosConfig, empresa?: { nombre: string }): string {
  if (!logos) {
    if (empresa && /golden/i.test(empresa.nombre)) {
      return `<img src="${GOLDEN_TOUCH_LOGO_DATA_URI}" style="height:54px;width:auto;object-fit:contain;"/>`;
    }
    if (empresa && /sos/i.test(empresa.nombre)) {
      return `<img src="${LOGO_DATA_URI}" style="height:54px;width:auto;object-fit:contain;"/>`;
    }
    return '';
  }
  const imgs: string[] = [];
  if (logos.golden) imgs.push(`<img src="${GOLDEN_TOUCH_LOGO_DATA_URI}" style="height:52px;width:auto;object-fit:contain;"/>`);
  if (logos.sos) imgs.push(`<img src="${LOGO_DATA_URI}" style="height:52px;width:auto;object-fit:contain;"/>`);
  if (logos.renace) imgs.push(`<img src="${RENACE_LOGO_DATA_URI}" style="height:52px;width:auto;object-fit:contain;"/>`);
  if (logos.jhenzaen) imgs.push(`<img src="${JHENZAEN_LOGO_DATA_URI}" style="height:52px;width:auto;object-fit:contain;"/>`);
  if (logos.bcv) imgs.push(`<img src="${BCV_LOGO_DATA_URI}" style="height:52px;width:auto;object-fit:contain;"/>`);
  return imgs.join('&nbsp;&nbsp;');
}

/**
 * Genera el documento HTML idéntico al PDF "AUTORIZACIÓN DE TRASLADO"
 * para maquinaria pesada, salvoconducto de tránsito y entrega a transportista.
 */
export function autorizacionTrasladoHtml(d: AutorizacionTrasladoData): string {
  const logosHtml = renderLogosHtml(d.logos, d.empresaEmisora);
  const nombreEmpresa = (d.empresaEmisora.nombre || 'EMPRESA EMISORA').toUpperCase();
  const rifEmpresa = d.empresaEmisora.rif ? d.empresaEmisora.rif.toUpperCase() : '';

  // Identificación legal
  const empLegalStr = rifEmpresa
    ? `la empresa <b>${esc(nombreEmpresa)}</b>, RIF <b>${esc(rifEmpresa)}</b>`
    : `la empresa <b>${esc(nombreEmpresa)}</b>`;

  // Checkboxes con formato idéntico: [ x ] o [ &nbsp; ]
  const cbOperativo = d.estado.operativo ? '[ x ]' : '[ &nbsp; ]';
  const cbInoperativo = d.estado.inoperativo ? '[ x ]' : '[ &nbsp; ]';
  const pct = d.estado.combustiblePct != null && String(d.estado.combustiblePct).trim() !== ''
    ? `${d.estado.combustiblePct}%`
    : '____%';
  const cbCombustible = d.estado.combustiblePct != null ? '[ x ]' : '[ &nbsp; ]';
  const cbLimpieza = d.estado.limpiezaAceptable ? '[ x ]' : '[ &nbsp; ]';

  const obs = d.estado.observacionesDanios && d.estado.observacionesDanios.trim()
    ? esc(d.estado.observacionesDanios.trim())
    : 'Ninguna observada. Maquinaria despachada conforme.';

  const autorizadoTexto = d.firmas?.autorizadoPorEmpresa?.trim() || nombreEmpresa;
  const transportistaTexto = d.firmas?.transportistaNombre?.trim() || d.transporte.conductorNombre || '';
  const transportistaCi = d.transporte.conductorCedula ? `C.I. ${esc(d.transporte.conductorCedula)}` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <title>Autorización de Traslado - ${esc(d.numeroControl)}</title>
  <style>
    @page {
      size: letter portrait;
      margin: 14mm 15mm 12mm 15mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1a1a1a;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 11.5px;
      line-height: 1.45;
    }

    /* Encabezado */
    .header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
    }
    .header-table td {
      vertical-align: top;
      border: none;
      padding: 0;
    }
    .company-title {
      font-size: 15px;
      font-weight: 800;
      color: #1a2b49;
      letter-spacing: 0.3px;
      margin: 0 0 2px 0;
    }
    .company-rif {
      font-size: 12px;
      font-weight: 700;
      color: #2b5282;
      margin: 0;
    }
    .doc-meta {
      text-align: right;
    }
    .doc-title {
      font-size: 14px;
      font-weight: 800;
      color: #1a2b49;
      letter-spacing: 0.5px;
      margin: 0 0 4px 0;
      text-transform: uppercase;
    }
    .control-row {
      font-size: 11px;
      color: #555;
      margin: 1px 0;
    }
    .control-row b {
      color: #1a1a1a;
      font-weight: 700;
    }

    .top-divider {
      height: 1px;
      background-color: #cbd5e1;
      margin: 8px 0 12px 0;
    }

    /* Párrafo legal */
    .legal-paragraph {
      font-size: 11px;
      text-align: justify;
      color: #222;
      line-height: 1.5;
      margin-bottom: 14px;
    }

    /* Secciones con barra azul vertical */
    .section-header {
      font-size: 11.5px;
      font-weight: 800;
      color: #1e3a8a;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      margin: 12px 0 8px 0;
      display: flex;
      align-items: center;
    }
    .section-bar {
      display: inline-block;
      width: 3.5px;
      height: 13px;
      background-color: #2563eb;
      margin-right: 6px;
      border-radius: 1px;
    }

    /* Tablas de datos de 2 columnas */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
      font-size: 11px;
    }
    .data-table td {
      padding: 3.5px 4px;
      vertical-align: top;
      border: none;
    }
    .data-table td.col-lbl {
      color: #4b5563;
      font-weight: 600;
      width: 22%;
    }
    .data-table td.col-val {
      color: #111827;
      font-weight: 700;
      width: 28%;
    }

    /* Checklist de estado */
    .state-box {
      margin: 8px 0 10px 0;
      padding: 8px 10px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
    }
    .state-options {
      display: flex;
      flex-wrap: wrap;
      gap: 18px;
      font-size: 11px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 8px;
    }
    .state-item {
      display: inline-block;
    }
    .cb {
      font-family: monospace;
      font-weight: 800;
      color: #1e3a8a;
      font-size: 12px;
      margin-right: 3px;
    }
    .obs-line {
      font-size: 11px;
      color: #374151;
      border-top: 1px dashed #cbd5e1;
      padding-top: 6px;
      margin-top: 4px;
    }
    .obs-line b {
      color: #1f2937;
    }

    /* Bloque de firmas */
    .signatures-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 36px;
      margin-bottom: 16px;
    }
    .signatures-table td {
      width: 33.33%;
      text-align: center;
      vertical-align: top;
      padding: 0 10px;
      border: none;
    }
    .sig-line {
      border-top: 1px solid #1f2937;
      margin-bottom: 6px;
      width: 90%;
      margin-left: auto;
      margin-right: auto;
    }
    .sig-title {
      font-size: 10.5px;
      font-weight: 800;
      color: #111827;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .sig-sub {
      font-size: 9.5px;
      color: #4b5563;
      line-height: 1.3;
    }

    /* Nota legal al pie */
    .legal-footer-box {
      margin-top: 18px;
      padding: 7px 10px;
      border: 1px solid #cbd5e1;
      background: #fbfcfe;
      border-radius: 4px;
      font-size: 9.5px;
      color: #334155;
      line-height: 1.4;
      text-align: justify;
    }
    .legal-footer-box b {
      color: #1e293b;
    }
  </style>
</head>
<body>

  <!-- ENCABEZADO -->
  <table class="header-table">
    <tr>
      <td style="width: 58%;">
        ${logosHtml ? `<div style="margin-bottom: 6px;">${logosHtml}</div>` : ''}
        <div class="company-title">${esc(nombreEmpresa)}</div>
        ${rifEmpresa ? `<div class="company-rif">RIF: ${esc(rifEmpresa)}</div>` : ''}
      </td>
      <td style="width: 42%;" class="doc-meta">
        <div class="doc-title">AUTORIZACIÓN DE TRASLADO</div>
        <div class="control-row">Nº Control: <b>${esc(d.numeroControl)}</b></div>
        <div class="control-row">Fecha: <b>${esc(d.fecha)}</b></div>
      </td>
    </tr>
  </table>

  <div class="top-divider"></div>

  <!-- PÁRRAFO LEGAL -->
  <div class="legal-paragraph">
    Por medio del presente documento, ${empLegalStr}, autoriza de forma explícita el movilizado y transporte del equipo / maquinaria pesada detallado a continuación, conforme a los términos y destino indicados en esta orden.
  </div>

  <!-- 1. IDENTIFICACIÓN DE LA MAQUINARIA -->
  <div class="section-header">
    <span class="section-bar"></span> 1. IDENTIFICACIÓN DE LA MAQUINARIA
  </div>
  <table class="data-table">
    <tr>
      <td class="col-lbl">Equipo / Tipo:</td>
      <td class="col-val">${esc(d.maquinaria.tipo || d.maquinaria.codigo || '—')}</td>
      <td class="col-lbl">Marca:</td>
      <td class="col-val">${esc(d.maquinaria.marca || '—')}</td>
    </tr>
    <tr>
      <td class="col-lbl">Modelo:</td>
      <td class="col-val">${esc(d.maquinaria.modelo || '—')}</td>
      <td class="col-lbl">Año:</td>
      <td class="col-val">${esc(d.maquinaria.anio || '—')}</td>
    </tr>
    <tr>
      <td class="col-lbl">Color:</td>
      <td class="col-val">${esc(d.maquinaria.color || '—')}</td>
      <td class="col-lbl">Serial / Identificación:</td>
      <td class="col-val">${esc(d.maquinaria.serial || '—')}</td>
    </tr>
    <tr>
      <td class="col-lbl">Placa:</td>
      <td class="col-val">${esc(d.maquinaria.placa || '—')}</td>
      <td class="col-lbl">Peso Operativo:</td>
      <td class="col-val">${esc(d.maquinaria.pesoOperativo || '—')}</td>
    </tr>
    <tr>
      <td class="col-lbl">Potencia de motor:</td>
      <td class="col-val">${esc(d.maquinaria.potenciaMotor || '—')}</td>
      <td class="col-lbl">Código interno:</td>
      <td class="col-val">${esc(d.maquinaria.codigo || '—')}</td>
    </tr>
  </table>

  <!-- 2. DATOS DE ORIGEN, DESTINO -->
  <div class="section-header">
    <span class="section-bar"></span> 2. DATOS DE ORIGEN, DESTINO
  </div>
  <table class="data-table">
    <tr>
      <td class="col-lbl" style="width: 22%;">Lugar de Origen:</td>
      <td class="col-val" style="width: 78%;" colspan="3">${esc(d.origen || '—')}</td>
    </tr>
    <tr>
      <td class="col-lbl" style="width: 22%;">Lugar de Destino:</td>
      <td class="col-val" style="width: 78%;" colspan="3">${esc(d.destino || '—')}</td>
    </tr>
  </table>

  <!-- 3. IDENTIFICACIÓN DE LA EMPRESA DE TRANSPORTE Y CONDUCTOR -->
  <div class="section-header">
    <span class="section-bar"></span> 3. IDENTIFICACIÓN DE LA EMPRESA DE TRANSPORTE Y CONDUCTOR
  </div>
  <table class="data-table">
    <tr>
      <td class="col-lbl">Nombre Conductor:</td>
      <td class="col-val">${esc(d.transporte.conductorNombre || '—')}</td>
      <td class="col-lbl">C.I. Conductor:</td>
      <td class="col-val">${esc(d.transporte.conductorCedula || '—')}</td>
    </tr>
    <tr>
      <td class="col-lbl">Vehículo / Batea:</td>
      <td class="col-val">${esc(d.transporte.vehiculoChuto || 'Chuto')}</td>
      <td class="col-lbl">Placa Chuto:</td>
      <td class="col-val">${esc(d.transporte.placaChuto || '—')}</td>
    </tr>
    <tr>
      <td class="col-lbl">Vehículo / Batea:</td>
      <td class="col-val">${esc(d.transporte.vehiculoLowboy || 'Lowboy')}</td>
      <td class="col-lbl">Placa Lowboy:</td>
      <td class="col-val">${esc(d.transporte.placaLowboy || '—')}</td>
    </tr>
    <tr>
      <td class="col-lbl">Teléfono Contacto:</td>
      <td class="col-val">${esc(d.transporte.telefonoContacto || '—')}</td>
      <td class="col-lbl">Vigencia Traslado:</td>
      <td class="col-val">${esc(d.transporte.vigenciaTraslado || '—')}</td>
    </tr>
  </table>

  <!-- 4. ESTADO DEL EQUIPO AL MOMENTO DE SALIDA -->
  <div class="section-header">
    <span class="section-bar"></span> 4. ESTADO DEL EQUIPO AL MOMENTO DE SALIDA
  </div>
  <div class="state-box">
    <div class="state-options">
      <div class="state-item"><span class="cb">${cbOperativo}</span> Operativo</div>
      <div class="state-item"><span class="cb">${cbInoperativo}</span> Inoperativo / Averiado</div>
      <div class="state-item"><span class="cb">${cbCombustible}</span> Combustible: <b>${pct}</b></div>
      <div class="state-item"><span class="cb">${cbLimpieza}</span> Limpieza Aceptable</div>
    </div>
    <div class="obs-line">
      <b>Observaciones / Daños Preexistentes:</b> ${obs}
    </div>
  </div>

  <!-- FIRMAS -->
  <table class="signatures-table">
    <tr>
      <td>
        <div class="sig-line"></div>
        <div class="sig-title">AUTORIZADO POR</div>
        <div class="sig-sub"><b>${esc(autorizadoTexto)}</b><br/>Firma y Sello Comercial</div>
      </td>
      <td>
        <div class="sig-line"></div>
        <div class="sig-title">TRANSPORTISTA / CONDUCTOR</div>
        <div class="sig-sub">Recibí Conforme / <b>${esc(transportistaTexto)}</b><br/>${transportistaCi ? `${transportistaCi} · ` : ''}Firma</div>
      </td>
      <td>
        <div class="sig-line"></div>
        <div class="sig-title">RECIBIDO EN DESTINO</div>
        <div class="sig-sub">Nombre, C.I. y Fecha<br/>Firma y Sello</div>
      </td>
    </tr>
  </table>

  <!-- NOTA LEGAL AL PIE -->
  <div class="legal-footer-box">
    <b>Nota de Autorización Legal:</b> Este documento autoriza únicamente el tránsito del equipo especificado en las fechas y rutas señaladas. Se solicita a las autoridades civiles y militares brindar la colaboración necesaria para el libre tránsito de la maquinaria.
  </div>

</body>
</html>`;
}
