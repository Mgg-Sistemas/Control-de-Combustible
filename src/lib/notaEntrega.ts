import { LOGO_DATA_URI } from './logoData';
import { GOLDEN_TOUCH_LOGO_DATA_URI } from './logoGoldenTouchData';
import { RENACE_LOGO_DATA_URI } from './logoRenaceData';
import { JHENZAEN_LOGO_DATA_URI } from './logoJhenzaenData';
import { BCV_LOGO_DATA_URI } from './logoBcvData';
import { COMPANY_NAME } from './company';

export type NotaItem = { name: string; qty: number; unit: string };
export type LogosConfig = {
  sos?: boolean;
  golden?: boolean;
  renace?: boolean;
  jhenzaen?: boolean;
  bcv?: boolean;
};
export type NotaFoto = { uri: string; caption?: string };

export type NotaData = {
  fecha: string;        // ya formateada (ej. "16/07/2026")
  numero?: string | null;
  destino?: string | null;
  empresa?: string | null;
  empresaEmisora?: { nombre: string; rif?: string | null; logoUri?: string | null } | null;
  emisorNombre?: string | null;
  emisorCedula?: string | null;
  emisorCargo?: string | null;
  maquina?: string | null;      // equipo al que se entrega
  vehiculo?: string | null;     // vehículo al que se entrega (pestaña Vehículos del catálogo)
  empleados?: string[];         // empleados que reciben
  empleadosDetalle?: { name: string; cedula?: string | null; cargo?: string | null }[]; // empleados registrados que reciben (con cédula y cargo)
  items: NotaItem[];
  logos?: LogosConfig;
  fotos?: NotaFoto[];
  tituloDoc?: string | null;
  subtituloDoc?: string | null;
};

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();

function renderLogosHtml(logos?: LogosConfig, empresaEmisora?: { nombre: string; rif?: string | null } | null): string {
  if (!logos) {
    if (empresaEmisora && /golden/i.test(empresaEmisora.nombre)) {
      return `<img src="${GOLDEN_TOUCH_LOGO_DATA_URI}" style="height:62px;width:auto;object-fit:contain;"/>`;
    }
    return `<img src="${LOGO_DATA_URI}" style="height:62px;width:auto;object-fit:contain;"/>`;
  }
  const imgs: string[] = [];
  if (logos.golden) imgs.push(`<img src="${GOLDEN_TOUCH_LOGO_DATA_URI}" style="height:58px;width:auto;object-fit:contain;"/>`);
  if (logos.sos) imgs.push(`<img src="${LOGO_DATA_URI}" style="height:58px;width:auto;object-fit:contain;"/>`);
  if (logos.renace) imgs.push(`<img src="${RENACE_LOGO_DATA_URI}" style="height:58px;width:auto;object-fit:contain;"/>`);
  if (logos.jhenzaen) imgs.push(`<img src="${JHENZAEN_LOGO_DATA_URI}" style="height:58px;width:auto;object-fit:contain;"/>`);
  if (logos.bcv) imgs.push(`<img src="${BCV_LOGO_DATA_URI}" style="height:58px;width:auto;object-fit:contain;"/>`);
  return imgs.length ? imgs.join(' ') : '';
}

/**
 * NOTA DE SALIDA / ENTREGA imprimible: logo(s) seleccionables, empresa emisora con RIF,
 * fecha, bloque Emisor / Receptor, lista de productos, registro fotográfico y líneas de firma.
 */
export function notaEntregaHtml(d: NotaData): string {
  const rows = d.items.map((it, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.name)}</td>
      <td class="c b">${qtyFmt(it.qty)}</td>
      <td class="c">${esc(it.unit || '')}</td>
    </tr>`).join('');

  const empleadosDetalle = d.empleadosDetalle || [];
  let recibeHtml = '';
  if (empleadosDetalle.length) {
    const recibeRows = empleadosDetalle.map(e => `
      <div><b>${esc(e.name)}</b>${e.cedula ? ` &nbsp;·&nbsp; C.I. ${esc(e.cedula)}` : ''}${e.cargo ? ` &nbsp;·&nbsp; ${esc(e.cargo)}` : ''}</div>
    `).join('');
    const detalleNombres = new Set(empleadosDetalle.map(e => e.name));
    const otros = (d.empleados || []).filter(n => !detalleNombres.has(n));
    recibeHtml = `
      <div class="box-val">${recibeRows}</div>
      ${otros.length ? `<div class="box-sub"><b>Otros:</b> ${esc(otros.join(' · '))}</div>` : ''}
    `;
  } else if (d.empleados && d.empleados.length) {
    recibeHtml = `<div class="box-val"><b>Responsable(s):</b> ${esc(d.empleados.join(' · '))}</div>`;
  } else {
    recibeHtml = `<div class="box-sub">Sin receptor especificado</div>`;
  }

  const emisorNombre = d.emisorNombre ? esc(d.emisorNombre) : '';
  const emisorCedula = d.emisorCedula ? esc(d.emisorCedula) : '';
  const emisorCargo = d.emisorCargo ? esc(d.emisorCargo) : '';

  const empresaEmisoraNombre = d.empresaEmisora?.nombre || COMPANY_NAME;
  const empresaEmisoraRif = d.empresaEmisora?.rif
    || (/golden\s*touch/i.test(empresaEmisoraNombre) ? 'J-50129993-5' : null);

  const fotos = d.fotos || [];
  const fotosHtml = fotos.length ? `
    <div class="fotos-sec">
      <div class="sec-title">REGISTRO FOTOGRÁFICO DE CONFORMIDAD</div>
      <div class="fotos-grid">
        ${fotos.map((f, i) => `
          <div class="foto-card">
            <img src="${f.uri}" alt="Foto ${i + 1}" />
            ${f.caption ? `<div class="foto-caption">${esc(f.caption)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  const logosHtml = renderLogosHtml(d.logos, d.empresaEmisora);

  return `<!doctype html><html><head><meta charset="utf-8"/><title></title>
  <style>
    @page{ margin:1.8cm; size:letter }
    *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact }
    html,body{ margin:0; padding:0 }
    body{ font-family:Tahoma, Geneva, Verdana, sans-serif; color:#1a1a1a; font-size:11pt; display:flex; flex-direction:column; min-height:100vh }
    @media screen{ body{ padding:22px 28px; background:#fff } }
    .head{ display:flex; align-items:center; justify-content:space-between; gap:14px; border-bottom:3px solid #16324F; padding-bottom:12px; margin-bottom:14px }
    .head-left{ display:flex; align-items:center; gap:12px; flex:1 }
    .head-logos{ display:flex; align-items:center; gap:8px; flex-wrap:wrap }
    .head-titles{ text-align:center; flex:1.4 }
    .head-titles h1{ font-size:15pt; color:#16324F; margin:0 0 4px; letter-spacing:.5px; font-weight:900 }
    .head-titles .sub{ color:#4a5568; font-size:9pt; font-weight:600 }
    .head-right{ text-align:right; font-size:10pt; min-width:140px }
    .head-right .nro{ color:#16324F; font-weight:800; font-size:11pt; margin-bottom:4px }
    .head-right .fec{ color:#333 }
    .co-block{ margin-top:2px }
    .co-block .co{ color:#16324F; font-weight:900; font-size:11pt; letter-spacing:.3px }
    .co-block .rif{ color:#666; font-size:9pt; font-weight:700 }

    .od-grid{ display:flex; gap:12px; margin-bottom:12px }
    .od-box{ flex:1; border:1px solid #c9d2dc; border-radius:6px; padding:8px 10px; background:#f8fafc }
    .od-box.emisor{ border-left:4px solid #16324F }
    .od-box.receptor{ border-left:4px solid #0d6b3f }
    .od-box .tag{ font-weight:900; font-size:9pt; letter-spacing:.4px; text-transform:uppercase; margin-bottom:4px }
    .od-box.emisor .tag{ color:#16324F }
    .od-box.receptor .tag{ color:#0d6b3f }
    .od-box .box-title{ font-weight:800; font-size:10.5pt; color:#111 }
    .od-box .box-sub{ font-size:9pt; color:#555; margin-top:2px }
    .od-box .box-val{ font-size:9.5pt; color:#222; margin-top:3px }

    .meta-dest{ background:#eef4fb; border:1px solid #c8d9ea; border-radius:6px; padding:7px 10px; margin-bottom:12px; font-size:10pt }
    .meta-dest b{ color:#16324F }
    .meta-dest > div{ margin:2px 0 }

    table{ border-collapse:collapse; width:100%; font-size:10.5pt; margin-bottom:14px }
    th,td{ border:1px solid #c9d2dc; padding:7px 9px; text-align:left }
    th{ background:#16324F; color:#fff; font-size:10pt; letter-spacing:.3px }
    td.c{ text-align:center } td.b{ font-weight:800 }
    tr:nth-child(even) td{ background:#f4f7fb }

    .fotos-sec{ margin-top:14px; margin-bottom:14px; page-break-inside:avoid }
    .sec-title{ font-size:10.5pt; font-weight:900; color:#16324F; margin-bottom:8px; border-bottom:2px solid #16324F; padding-bottom:3px; letter-spacing:.4px }
    .fotos-grid{ display:flex; flex-wrap:wrap; gap:12px; justify-content:flex-start }
    .foto-card{ flex:1 1 calc(50% - 12px); max-width:calc(50% - 6px); border:1px solid #cbd5e1; border-radius:6px; padding:6px; background:#fafbfc; text-align:center }
    .foto-card img{ width:100%; max-height:220px; object-fit:contain; border-radius:4px; display:block; margin:0 auto }
    .foto-caption{ font-size:8.5pt; color:#475569; margin-top:5px; font-weight:700 }

    .firmas{ margin-top:auto; padding-top:36px; display:flex; justify-content:space-around; gap:20px; page-break-inside:avoid }
    .firma-col{ width:260px; text-align:center }
    .firma-col .line{ border-top:1px solid #1a1a1a; padding-top:6px; font-weight:900; color:#16324F; font-size:10.5pt }
    .firma-col .sub-line{ font-size:8.5pt; color:#64748b; margin-top:2px }

    .foot{ margin-top:20px; text-align:center; color:#9aa4b2; font-size:8.5pt; border-top:1px solid #e5e7eb; padding-top:8px }
  </style></head><body>
    <div class="head">
      <div class="head-left">
        ${logosHtml ? `<div class="head-logos">${logosHtml}</div>` : ''}
        <div class="co-block">
          <div class="co">${esc(empresaEmisoraNombre)}</div>
          ${empresaEmisoraRif ? `<div class="rif">${esc(empresaEmisoraRif)}</div>` : ''}
        </div>
      </div>
      <div class="head-titles">
        <h1>${esc(d.tituloDoc || 'NOTA DE SALIDA')}</h1>
        <div class="sub">${esc(d.subtituloDoc || 'Comprobante Oficial de Recepción y Despacho')}</div>
      </div>
      <div class="head-right">
        ${d.numero ? `<div class="nro">N° ${esc(d.numero)}</div>` : ''}
        <div class="fec"><b>Fecha:</b> ${esc(d.fecha)}</div>
      </div>
    </div>

    <div class="od-grid">
      <div class="od-box emisor">
        <div class="tag">Entregado por (Emisor)</div>
        <div class="box-title">${esc(empresaEmisoraNombre)}</div>
        ${empresaEmisoraRif ? `<div class="box-sub">RIF: ${esc(empresaEmisoraRif)}</div>` : ''}
        ${emisorNombre ? `<div class="box-val"><b>Responsable:</b> ${emisorNombre}</div>` : ''}
        ${emisorCedula ? `<div class="box-sub"><b>C.I.:</b> ${emisorCedula}${emisorCargo ? ` · ${emisorCargo}` : ''}</div>` : ''}
      </div>
      <div class="od-box receptor">
        <div class="tag">Recibido por (Receptor)</div>
        ${recibeHtml}
        ${d.empresa ? `<div class="box-sub"><b>Empresa destino:</b> ${esc(d.empresa)}</div>` : ''}
      </div>
    </div>

    ${d.maquina || d.vehiculo || d.destino ? `
      <div class="meta-dest">
        ${d.maquina ? `<div><b>Máquina / Equipo:</b> ${esc(d.maquina)}</div>` : ''}
        ${d.vehiculo ? `<div><b>Vehículo:</b> ${esc(d.vehiculo)}</div>` : ''}
        ${d.destino ? `<div><b>Destino / Motivo:</b> ${esc(d.destino)}</div>` : ''}
      </div>
    ` : ''}

    <table>
      <thead><tr><th style="width:34px" class="c">#</th><th>Descripción del Ítem / Material</th><th style="width:95px" class="c">Cantidad</th><th style="width:95px" class="c">Unidad</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="c">Sin productos</td></tr>'}</tbody>
    </table>

    ${fotosHtml}

    <div class="firmas">
      <div class="firma-col">
        <div class="line">ENTREGADO CONFORME</div>
        <div class="sub-line">Firma Emisor / Despachador</div>
      </div>
      <div class="firma-col">
        <div class="line">RECIBIDO CONFORME</div>
        <div class="sub-line">Firma Receptor / Responsable</div>
      </div>
    </div>

    <div class="foot">${esc(empresaEmisoraNombre)} · Comprobante oficial de inventario</div>
  </body></html>`;
}
