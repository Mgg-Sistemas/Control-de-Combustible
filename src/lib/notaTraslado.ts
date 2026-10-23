import { LOGO_DATA_URI } from './logoData';
import { GOLDEN_TOUCH_LOGO_DATA_URI } from './logoGoldenTouchData';
import { RENACE_LOGO_DATA_URI } from './logoRenaceData';
import { JHENZAEN_LOGO_DATA_URI } from './logoJhenzaenData';
import { BCV_LOGO_DATA_URI } from './logoBcvData';
import { COMPANY_NAME } from './company';

export type TrasladoItem = { name: string; qty: number; unit: string };
export type LogosConfig = {
  sos?: boolean;
  golden?: boolean;
  renace?: boolean;
  jhenzaen?: boolean;
  bcv?: boolean;
};
export type TrasladoFoto = { uri: string; caption?: string };

export type TrasladoData = {
  fecha: string;            // ya formateada (ej. "16/07/2026")
  numero?: string | null;
  empresa?: string | null;
  empresaEmisora?: { nombre: string; rif?: string | null; logoUri?: string | null } | null;
  fromMaquina?: string | null;   // máquina de ORIGEN
  fromVehiculo?: string | null;  // vehículo de ORIGEN (tabla vehicles)
  fromEmpleado?: string | null;  // empleado responsable en el ORIGEN
  fromEmpleadoDetalle?: { name: string; cedula?: string | null; cargo?: string | null } | null;
  toMaquina?: string | null;     // máquina de DESTINO
  toVehiculo?: string | null;    // vehículo de DESTINO (tabla vehicles)
  toEmpleado?: string | null;    // empleado responsable en el DESTINO
  toEmpleadoDetalle?: { name: string; cedula?: string | null; cargo?: string | null } | null;
  motivo?: string | null;
  lugar?: string | null;
  estado?: string | null;
  items: TrasladoItem[];
  logos?: LogosConfig;
  fotos?: TrasladoFoto[];
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
 * NOTA DE TRASLADO imprimible: logo(s) seleccionables, empresa emisora con RIF,
 * fecha, bloque ORIGEN → DESTINO (máquina, vehículo y responsable), lista de materiales,
 * registro fotográfico y líneas de firma.
 */
export function notaTrasladoHtml(d: TrasladoData): string {
  const rows = d.items.map((it, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.name)}</td>
      <td class="c b">${qtyFmt(it.qty)}</td>
      <td class="c">${esc(it.unit || '')}</td>
    </tr>`).join('');

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

    .od{ display:flex; gap:12px; margin-bottom:12px; align-items:stretch }
    .od .box{ flex:1; border:1px solid #c9d2dc; border-radius:6px; padding:9px 11px }
    .od .box.o{ background:#f4f7fb; border-left:4px solid #16324F }
    .od .box.d{ background:#eef7f0; border-left:4px solid #0d6b3f }
    .od .tag{ font-weight:900; font-size:9pt; letter-spacing:.5px; text-transform:uppercase; margin-bottom:5px }
    .od .box.o .tag{ color:#16324F } .od .box.d .tag{ color:#0d6b3f }
    .od .val{ font-size:10pt; margin:2px 0 } .od .val b{ color:#16324F }
    .arrow{ align-self:center; font-size:18pt; color:#16324F; font-weight:900 }

    .meta-tags{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; font-size:10pt; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:7px 10px }
    .meta-tags b{ color:#16324F }

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
        <h1>${esc(d.tituloDoc || 'NOTA DE TRASLADO')}</h1>
        <div class="sub">${esc(d.subtituloDoc || 'Comprobante Oficial de Traslado de Materiales y Equipos')}</div>
      </div>
      <div class="head-right">
        ${d.numero ? `<div class="nro">N° ${esc(d.numero)}</div>` : ''}
        <div class="fec"><b>Fecha:</b> ${esc(d.fecha)}</div>
      </div>
    </div>

    <div class="od">
      <div class="box o">
        <div class="tag">Origen (Entrega)</div>
        <div class="val"><b>Máquina:</b> ${esc(d.fromMaquina || '—')}</div>
        ${d.fromVehiculo ? `<div class="val"><b>Vehículo:</b> ${esc(d.fromVehiculo)}</div>` : ''}
        <div class="val"><b>Responsable:</b> ${esc(d.fromEmpleado || '—')}</div>
        ${d.fromEmpleadoDetalle ? `<div class="val" style="font-size:9pt;color:#555"><b>C.I.:</b> ${esc(d.fromEmpleadoDetalle.cedula || '—')}${d.fromEmpleadoDetalle.cargo ? ` &nbsp;·&nbsp; <b>Cargo:</b> ${esc(d.fromEmpleadoDetalle.cargo)}` : ''}</div>` : ''}
      </div>
      <div class="arrow">→</div>
      <div class="box d">
        <div class="tag">Destino (Recibe)</div>
        <div class="val"><b>Máquina:</b> ${esc(d.toMaquina || '—')}</div>
        ${d.toVehiculo ? `<div class="val"><b>Vehículo:</b> ${esc(d.toVehiculo)}</div>` : ''}
        <div class="val"><b>Responsable:</b> ${esc(d.toEmpleado || '—')}</div>
        ${d.toEmpleadoDetalle ? `<div class="val" style="font-size:9pt;color:#555"><b>C.I.:</b> ${esc(d.toEmpleadoDetalle.cedula || '—')}${d.toEmpleadoDetalle.cargo ? ` &nbsp;·&nbsp; <b>Cargo:</b> ${esc(d.toEmpleadoDetalle.cargo)}` : ''}</div>` : ''}
        ${d.empresa ? `<div class="val" style="font-size:9pt;color:#555"><b>Empresa destino:</b> ${esc(d.empresa)}</div>` : ''}
      </div>
    </div>

    ${d.motivo || d.lugar || d.estado ? `
      <div class="meta-tags">
        ${d.lugar ? `<div><b>📍 Lugar / Obra:</b> ${esc(d.lugar)}</div>` : ''}
        ${d.estado ? `<div><b>🏷️ Condición:</b> ${esc(d.estado.toUpperCase())}</div>` : ''}
        ${d.motivo ? `<div><b>📝 Motivo:</b> ${esc(d.motivo)}</div>` : ''}
      </div>
    ` : ''}

    <table>
      <thead><tr><th style="width:34px" class="c">#</th><th>Material / Equipo</th><th style="width:95px" class="c">Cantidad</th><th style="width:95px" class="c">Unidad</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="c">Sin materiales</td></tr>'}</tbody>
    </table>

    ${fotosHtml}

    <div class="firmas">
      <div class="firma-col">
        <div class="line">ENTREGADO CONFORME (ORIGEN)</div>
        <div class="sub-line">Firma y Sello de Entrega</div>
      </div>
      <div class="firma-col">
        <div class="line">RECIBIDO CONFORME (DESTINO)</div>
        <div class="sub-line">Firma y Sello de Recepción</div>
      </div>
    </div>

    <div class="foot">${esc(empresaEmisoraNombre)} · Comprobante oficial de inventario</div>
  </body></html>`;
}
