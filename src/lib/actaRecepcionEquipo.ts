export interface ChecklistItem {
  id?: string;
  item: string;
  estado: 'OPERATIVO' | 'CONFORME' | 'REGULAR' | 'PENDIENTE' | 'AVERÍA' | 'NO APLICA' | string;
  observaciones?: string | null;
}

export interface FotoRecepcion {
  uri: string;
  titulo?: string | null;
}

export interface ActaRecepcionData {
  // Metadatos
  codigo: string;                    // ej: "AR-EQ-2026-089"
  fecha: string;                     // ej: "23 de Octubre, 2026"
  hora: string;                      // ej: "21:44 hrs"
  departamento?: string;             // ej: "DEPARTAMENTO DE MAQUINARIA Y EQUIPO PESADO"

  // Datos principales destacados (tarjetas superiores)
  equipoModeloHeader?: string | null;// ej: "CASE CX330"
  pinSerialHeader?: string | null;   // ej: "DAC331342"
  placaHeader?: string | null;       // ¡OBLIGATORIA POR REGLA DEL PROYECTO!
  horometroHeader?: string | null;   // ej: "8,317.4 hrs"

  // 1. Datos Generales
  datosGenerales: {
    equipo?: string | null;          // ej: "Excavadora de Cadenas"
    fabricante?: string | null;      // ej: "CNH America LLC (Made in Japan)"
    marca?: string | null;           // ej: "CASE"
    modelo?: string | null;          // ej: "CX330"
    serialPin?: string | null;       // ej: "DAC331342"
    placa?: string | null;           // ¡OBLIGATORIA!
    horometro?: string | null;       // ej: "8317.4 Horas"
    ubicacionRecepcion?: string | null; // ej: "Patio Central / Zona de Descarga"
    modoTransporte?: string | null;  // ej: "Lowboy / Batea de Transporte"
    entregadoPor?: string | null;    // ej: "José Gregorio Gómez (Transportista)"
    recibidoPor?: string | null;     // ej: "Ing. Carlos Mendoza (Inspector)"
  };

  // Visibilidad configurable de campos opcionales
  visibilidad?: {
    mostrarChofer?: boolean;
    mostrarInspector?: boolean;
    mostrarFabricante?: boolean;
    mostrarHorometro?: boolean;
    mostrarTransporte?: boolean;
  };

  // 2. Checklist
  checklist: ChecklistItem[];

  // 3. Observaciones / Comentarios
  observacionesGenerales?: string | null;

  // 4. Firmas
  firmas?: {
    entregadoPorNombre?: string | null;
    entregadoPorCargoCi?: string | null;
    recibidoPorNombre?: string | null;
    recibidoPorCargoCi?: string | null;
  };

  // 5. Evidencia fotográfica (Página 2)
  fotos?: FotoRecepcion[];
}

function esc(val: any): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badgeEstado(estado: string): string {
  const norm = String(estado || '').trim().toUpperCase();
  let bg = '#DCFCE7';
  let color = '#15803D';
  let border = '#86EFAC';

  if (norm === 'AVERÍA' || norm === 'AVERIA' || norm === 'DAÑADO' || norm === 'NO CONFORME') {
    bg = '#FEE2E2';
    color = '#B91C1C';
    border = '#FCA5A5';
  } else if (norm === 'REGULAR' || norm === 'PENDIENTE') {
    bg = '#FEF3C7';
    color = '#B45309';
    border = '#FCD34D';
  } else if (norm === 'NO APLICA' || norm === 'N/A') {
    bg = '#F3F4F6';
    color = '#4B5563';
    border = '#D1D5DB';
  }

  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:800;background-color:${bg};color:${color};border:1px solid ${border};letter-spacing:0.3px;">${esc(norm)}</span>`;
}

/**
 * Genera el HTML para imprimir o exportar a PDF el "ACTA DE RECEPCCIÓN DE EQUIPO"
 * con diseño corporativo exacto de 1 o 2 páginas (con anexo fotográfico).
 */
export function actaRecepcionHtml(d: ActaRecepcionData): string {
  const vis = d.visibilidad || {
    mostrarChofer: true,
    mostrarInspector: true,
    mostrarFabricante: true,
    mostrarHorometro: true,
    mostrarTransporte: true,
  };

  const depto = d.departamento || 'DEPARTAMENTO DE MAQUINARIA Y EQUIPO PESADO';
  const equipoModeloHeader = d.equipoModeloHeader || `${d.datosGenerales.marca || ''} ${d.datosGenerales.modelo || ''}`.trim() || 'MAQUINARIA';
  const pinHeader = d.pinSerialHeader || d.datosGenerales.serialPin || '—';
  const placaHeader = d.placaHeader || d.datosGenerales.placa || null;
  const horoHeader = d.horometroHeader || d.datosGenerales.horometro || '—';

  // Filas del checklist
  const rowsChecklist = d.checklist.map((c) => `
    <tr>
      <td style="font-weight:600;color:#1F2937;">${esc(c.item)}</td>
      <td style="text-align:center;">${badgeEstado(c.estado)}</td>
      <td style="color:#4B5563;font-size:10.5px;">${esc(c.observaciones || '—')}</td>
    </tr>
  `).join('');

  // Filas de fotos en anexo
  const fotos = d.fotos || [];
  let fotosHtml = '';
  if (fotos.length > 0) {
    const cards = fotos.map((f, i) => `
      <div class="photo-card">
        <div class="photo-img-wrap">
          <img src="${f.uri}" alt="Evidencia ${i + 1}" />
        </div>
        <div class="photo-caption">${esc(f.titulo || `Evidencia Fotográfica ${i + 1}`)}</div>
      </div>
    `).join('');

    fotosHtml = `
      <div class="page-break"></div>
      <div class="page-header-mini">
        Acta de Recepción de Equipo Pesado — ${esc(equipoModeloHeader)} (PIN: ${esc(pinHeader)}${placaHeader ? ` · Placa: ${esc(placaHeader)}` : ''})
        <span style="float:right;">Página 2 de 2</span>
      </div>

      <div class="anexo-title-box">
        <div class="anexo-title">ANEXO FOTOGRÁFICO DE RECEPCCIÓN</div>
        <div class="anexo-sub">REGISTRO VISUAL DE INSPECCIÓN Y CONDICIÓN DE LLEGADA</div>
        <div class="anexo-meta">Equipo: <b>${esc(equipoModeloHeader)}</b> &nbsp;·&nbsp; PIN: <b>${esc(pinHeader)}</b>${placaHeader ? ` &nbsp;·&nbsp; Placa: <b>${esc(placaHeader)}</b>` : ''}</div>
      </div>

      <div class="sec-title" style="margin-top:14px;">4. EVIDENCIA FOTOGRÁFICA INSPECCIONADA</div>
      <div class="photos-grid">
        ${cards}
      </div>
    `;
  }

  // Firmas
  const firmanteEntregado = d.firmas?.entregadoPorNombre || d.datosGenerales.entregadoPor || 'Transporte / Proveedor';
  const firmanteRecibido = d.firmas?.recibidoPorNombre || d.datosGenerales.recibidoPor || 'Inspector / Recepción';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <title>Acta de Recepción - ${esc(d.codigo)}</title>
  <style>
    @page {
      size: letter portrait;
      margin: 12mm 14mm 12mm 14mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #111827;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 11px;
      line-height: 1.4;
    }

    .page-break {
      page-break-before: always;
    }

    /* Encabezado Principal */
    .top-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
    }
    .top-table td {
      vertical-align: top;
      border: none;
      padding: 0;
    }
    .main-title {
      font-size: 16px;
      font-weight: 900;
      color: #111827;
      letter-spacing: 0.4px;
      margin: 0;
      text-transform: uppercase;
    }
    .dept-title {
      font-size: 10.5px;
      font-weight: 700;
      color: #4B5563;
      letter-spacing: 0.5px;
      margin-top: 2px;
      text-transform: uppercase;
    }
    .meta-box {
      text-align: right;
      font-size: 10.5px;
      color: #4B5563;
      line-height: 1.35;
    }
    .meta-box b {
      color: #111827;
    }

    /* 3 Tarjetas Destacadas */
    .kpi-cards {
      display: flex;
      gap: 10px;
      margin: 10px 0 14px 0;
    }
    .kpi-card {
      flex: 1;
      background: #FFFBEB;
      border: 1px solid #FEF08A;
      border-left: 4px solid #D97706;
      border-radius: 4px;
      padding: 6px 10px;
    }
    .kpi-lbl {
      font-size: 9px;
      font-weight: 800;
      color: #B45309;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-bottom: 2px;
    }
    .kpi-val {
      font-size: 13px;
      font-weight: 900;
      color: #1F2937;
    }

    /* Títulos de Sección */
    .sec-title {
      font-size: 11px;
      font-weight: 900;
      color: #B45309;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      border-bottom: 1.5px solid #F59E0B;
      padding-bottom: 3px;
      margin: 12px 0 6px 0;
    }

    /* Tablas */
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
      font-size: 10.5px;
    }
    table.data-table td, table.data-table th {
      border: 1px solid #E5E7EB;
      padding: 4px 6px;
      vertical-align: top;
    }
    table.data-table td.lbl {
      background: #F9FAFB;
      font-weight: 700;
      color: #374151;
      width: 18%;
    }
    table.data-table td.val {
      color: #111827;
      width: 32%;
    }

    /* Tabla de Checklist */
    table.check-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
      font-size: 10.5px;
    }
    table.check-table th {
      background: #1E3A5F;
      color: #FFFFFF;
      font-weight: 800;
      text-align: left;
      padding: 5px 8px;
      font-size: 10px;
      text-transform: uppercase;
      border: 1px solid #1E3A5F;
    }
    table.check-table td {
      border: 1px solid #E5E7EB;
      padding: 4.5px 8px;
      vertical-align: middle;
    }

    /* Caja de Observaciones */
    .obs-box {
      border: 1px solid #D1D5DB;
      background: #F9FAFB;
      border-radius: 4px;
      padding: 8px 10px;
      font-size: 10.5px;
      color: #1F2937;
      line-height: 1.45;
      text-align: justify;
      margin-bottom: 14px;
      min-height: 48px;
    }

    /* Firmas */
    .sign-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 24px;
      margin-bottom: 10px;
    }
    .sign-table td {
      width: 50%;
      text-align: center;
      border: none;
      padding: 0 25px;
      vertical-align: top;
    }
    .sign-line {
      border-top: 1px solid #1F2937;
      margin-bottom: 4px;
      width: 85%;
      margin-left: auto;
      margin-right: auto;
    }
    .sign-title {
      font-size: 10px;
      font-weight: 800;
      color: #111827;
      text-transform: uppercase;
    }
    .sign-sub {
      font-size: 9px;
      color: #6B7280;
    }

    /* Anexo Fotográfico (Pág 2) */
    .page-header-mini {
      font-size: 9.5px;
      color: #6B7280;
      border-bottom: 1px solid #E5E7EB;
      padding-bottom: 4px;
      margin-bottom: 10px;
    }
    .anexo-title-box {
      margin-bottom: 8px;
    }
    .anexo-title {
      font-size: 14px;
      font-weight: 900;
      color: #111827;
      letter-spacing: 0.3px;
    }
    .anexo-sub {
      font-size: 10px;
      font-weight: 700;
      color: #4B5563;
      margin-top: 1px;
    }
    .anexo-meta {
      font-size: 10px;
      color: #374151;
      margin-top: 2px;
    }

    .photos-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 10px;
    }
    .photo-card {
      width: 48.5%;
      border: 1px solid #D1D5DB;
      border-radius: 4px;
      overflow: hidden;
      background: #FFFFFF;
    }
    .photo-img-wrap {
      width: 100%;
      height: 220px;
      background: #F3F4F6;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .photo-img-wrap img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .photo-caption {
      padding: 5px 8px;
      font-size: 9.5px;
      font-weight: 700;
      color: #1F2937;
      background: #F9FAFB;
      border-top: 1px solid #E5E7EB;
      text-align: center;
    }
  </style>
</head>
<body>

  <!-- ENCABEZADO -->
  <table class="top-table">
    <tr>
      <td style="width:65%;">
        <div class="main-title">ACTA DE RECEPCCIÓN DE EQUIPO</div>
        <div class="dept-title">${esc(depto)}</div>
      </td>
      <td style="width:35%;" class="meta-box">
        Código: <b>${esc(d.codigo)}</b><br/>
        Fecha: <b>${esc(d.fecha)}</b><br/>
        Hora: <b>${esc(d.hora)}</b>
      </td>
    </tr>
  </table>

  <!-- 3 TARJETAS DESTACADAS -->
  <div class="kpi-cards">
    <div class="kpi-card">
      <div class="kpi-lbl">EQUIPO / MODELO</div>
      <div class="kpi-val">${esc(equipoModeloHeader)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-lbl">N° IDENTIFICACIÓN (PIN) / PLACA</div>
      <div class="kpi-val">${esc(pinHeader)}${placaHeader ? ` · ${esc(placaHeader)}` : ''}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-lbl">HORÓMETRO REGISTRADO</div>
      <div class="kpi-val">${esc(horoHeader)}</div>
    </div>
  </div>

  <!-- 1. DATOS GENERALES DEL EQUIPO Y TRASLADO -->
  <div class="sec-title">1. DATOS GENERALES DEL EQUIPO Y TRASLADO</div>
  <table class="data-table">
    <tr>
      <td class="lbl">Equipo:</td>
      <td class="val">${esc(d.datosGenerales.equipo || '—')}</td>
      <td class="lbl">Fabricante:</td>
      <td class="val">${vis.mostrarFabricante !== false ? esc(d.datosGenerales.fabricante || '—') : 'N/A'}</td>
    </tr>
    <tr>
      <td class="lbl">Marca:</td>
      <td class="val">${esc(d.datosGenerales.marca || '—')}</td>
      <td class="lbl">Modelo / Tipo:</td>
      <td class="val">${esc(d.datosGenerales.modelo || '—')}</td>
    </tr>
    <tr>
      <td class="lbl">Serial / PIN:</td>
      <td class="val">${esc(d.datosGenerales.serialPin || '—')}</td>
      <td class="lbl">Horómetro:</td>
      <td class="val">${vis.mostrarHorometro !== false ? esc(d.datosGenerales.horometro || '—') : 'N/A'}</td>
    </tr>
    <tr>
      <td class="lbl">⭐ Placa:</td>
      <td class="val"><b>${esc(d.datosGenerales.placa || '—')}</b></td>
      <td class="lbl">Modo Transporte:</td>
      <td class="val">${vis.mostrarTransporte !== false ? esc(d.datosGenerales.modoTransporte || '—') : 'N/A'}</td>
    </tr>
    <tr>
      <td class="lbl">Ubicación Recepción:</td>
      <td class="val" colspan="3">${esc(d.datosGenerales.ubicacionRecepcion || 'Patio Central')}</td>
    </tr>
    ${(vis.mostrarChofer !== false || vis.mostrarInspector !== false) ? `
    <tr>
      <td class="lbl">Entregado Por:</td>
      <td class="val">${vis.mostrarChofer !== false ? esc(d.datosGenerales.entregadoPor || '—') : 'N/A'}</td>
      <td class="lbl">Recibido Por:</td>
      <td class="val">${vis.mostrarInspector !== false ? esc(d.datosGenerales.recibidoPor || '—') : 'N/A'}</td>
    </tr>
    ` : ''}
  </table>

  <!-- 2. LISTA DE VERIFICACIÓN DE RECEPCIÓN (CHECKLIST INICIAL) -->
  <div class="sec-title">2. LISTA DE VERIFICACIÓN DE RECEPCIÓN (CHECKLIST INICIAL)</div>
  <table class="check-table">
    <thead>
      <tr>
        <th style="width:42%;">Item / Componente Inspeccionado</th>
        <th style="width:18%;text-align:center;">Estado Inicial</th>
        <th style="width:40%;">Observaciones</th>
      </tr>
    </thead>
    <tbody>
      ${rowsChecklist || '<tr><td colspan="3" style="text-align:center;color:#6B7280;">Sin componentes inspeccionados.</td></tr>'}
    </tbody>
  </table>

  <!-- 3. OBSERVACIONES / COMENTARIOS DE RECEPCIÓN -->
  <div class="sec-title">3. OBSERVACIONES / COMENTARIOS DE RECEPCIÓN</div>
  <div class="obs-box">
    ${esc(d.observacionesGenerales || 'El equipo ingresa transportado a patio. Se verifica correspondencia de los seriales, placa y documentación presentada. Se autoriza la recepción y descarga al patio de almacenamiento/mantenimiento.')}
  </div>

  <!-- FIRMAS -->
  <table class="sign-table">
    <tr>
      <td>
        <div class="sign-line"></div>
        <div class="sign-title">ENTREGADO POR (${esc(firmanteEntregado)})</div>
        <div class="sign-sub">Nombre, C.I. y Firma</div>
      </td>
      <td>
        <div class="sign-line"></div>
        <div class="sign-title">RECIBIDO POR (${esc(firmanteRecibido)})</div>
        <div class="sign-sub">Nombre, C.I. y Firma</div>
      </td>
    </tr>
  </table>

  <!-- PÁGINA 2 (ANEXO FOTOGRÁFICO SI HAY FOTOS) -->
  ${fotosHtml}

</body>
</html>`;
}
