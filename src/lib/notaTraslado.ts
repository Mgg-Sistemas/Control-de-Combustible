import { LOGO_DATA_URI } from './logoData';
import { COMPANY_NAME } from './company';

export type TrasladoItem = { name: string; qty: number; unit: string };
export type TrasladoData = {
  fecha: string;            // ya formateada (ej. "16/07/2026")
  numero?: string | null;
  empresa?: string | null;
  fromMaquina?: string | null;   // máquina de ORIGEN
  fromEmpleado?: string | null;  // empleado responsable en el ORIGEN
  toMaquina?: string | null;     // máquina de DESTINO
  toEmpleado?: string | null;    // empleado responsable en el DESTINO
  motivo?: string | null;
  items: TrasladoItem[];
};

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();

/**
 * NOTA DE TRASLADO imprimible: logo, fecha, bloque ORIGEN → DESTINO (máquina y
 * responsable de cada lado), lista de materiales y dos líneas de firma (entrega
 * y recibe). Comprobante de traslado de materiales entre máquinas.
 */
export function notaTrasladoHtml(d: TrasladoData): string {
  const rows = d.items.map((it, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.name)}</td>
      <td class="c b">${qtyFmt(it.qty)}</td>
      <td class="c">${esc(it.unit || '')}</td>
    </tr>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"/><title></title>
  <style>
    @page{ margin:1.6cm; size:letter }
    *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact }
    html,body{ margin:0; padding:0 }
    body{ font-family:Tahoma, Geneva, Verdana, sans-serif; color:#1a1a1a; font-size:11.5pt; display:flex; flex-direction:column; min-height:100vh }
    @media screen{ body{ padding:22px 28px; background:#fff } }
    .head{ display:flex; align-items:center; gap:14px; border-bottom:3px solid #16324F; padding-bottom:10px; margin-bottom:14px }
    .head img{ height:64px; width:auto }
    .head .co{ color:#16324F; font-weight:800; font-size:13pt; letter-spacing:.3px }
    .head .sub{ color:#555; font-size:9.5pt }
    h1{ font-size:16pt; text-align:center; color:#16324F; margin:4px 0 10px; letter-spacing:.4px }
    .meta{ display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px; margin-bottom:12px; font-size:11pt }
    .meta b{ color:#16324F }
    .od{ display:flex; gap:12px; margin-bottom:14px }
    .od .box{ flex:1; border:1px solid #c9d2dc; border-radius:6px; padding:9px 11px }
    .od .box.o{ background:#f4f7fb } .od .box.d{ background:#eef7f0 }
    .od .tag{ font-weight:800; font-size:9.5pt; letter-spacing:.5px; text-transform:uppercase; margin-bottom:4px }
    .od .box.o .tag{ color:#16324F } .od .box.d .tag{ color:#0d6b3f }
    .od .val{ font-size:11pt } .od .val b{ color:#16324F }
    .arrow{ align-self:center; font-size:18pt; color:#16324F; font-weight:800 }
    table{ border-collapse:collapse; width:100%; font-size:11pt }
    th,td{ border:1px solid #c9d2dc; padding:7px 9px; text-align:left }
    th{ background:#16324F; color:#fff }
    td.c{ text-align:center } td.b{ font-weight:800 }
    tr:nth-child(even) td{ background:#f4f7fb }
    .firmas{ margin-top:auto; padding-top:54px; display:flex; justify-content:space-around; gap:24px }
    .firmas .line{ width:240px; border-top:1px solid #1a1a1a; padding-top:6px; font-weight:800; color:#16324F; font-size:11pt; text-align:center }
    .foot{ margin-top:22px; text-align:center; color:#9aa4b2; font-size:9pt; border-top:1px solid #e5e7eb; padding-top:8px }
  </style></head><body>
    <div class="head">
      <img src="${LOGO_DATA_URI}"/>
      <div>
        <div class="co">${esc(COMPANY_NAME)}</div>
        <div class="sub">Control de inventario</div>
      </div>
    </div>

    <h1>NOTA DE TRASLADO</h1>

    <div class="meta">
      <div><b>Fecha:</b> ${esc(d.fecha)}${d.numero ? ` &nbsp;·&nbsp; <b>N°:</b> ${esc(d.numero)}` : ''}</div>
      <div>${d.empresa ? `<b>Empresa:</b> ${esc(d.empresa)}` : ''}</div>
    </div>

    <div class="od">
      <div class="box o">
        <div class="tag">Origen</div>
        <div class="val"><b>Máquina:</b> ${esc(d.fromMaquina || '—')}</div>
        <div class="val"><b>Responsable:</b> ${esc(d.fromEmpleado || '—')}</div>
      </div>
      <div class="arrow">→</div>
      <div class="box d">
        <div class="tag">Destino</div>
        <div class="val"><b>Máquina:</b> ${esc(d.toMaquina || '—')}</div>
        <div class="val"><b>Responsable:</b> ${esc(d.toEmpleado || '—')}</div>
      </div>
    </div>
    ${d.motivo ? `<div class="meta"><div><b>Motivo:</b> ${esc(d.motivo)}</div></div>` : ''}

    <table>
      <thead><tr><th style="width:34px" class="c">#</th><th>Material</th><th style="width:90px" class="c">Cantidad</th><th style="width:90px" class="c">Unidad</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="c">Sin materiales</td></tr>'}</tbody>
    </table>

    <div class="firmas">
      <div class="line">Entrega (origen)</div>
      <div class="line">Recibe (destino)</div>
    </div>

    <div class="foot">${esc(COMPANY_NAME)} · Nota de traslado de inventario</div>
  </body></html>`;
}
