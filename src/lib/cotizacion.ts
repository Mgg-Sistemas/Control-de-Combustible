import { LOGO_DATA_URI } from './logoData';
import { COMPANY_NAME } from './company';

export type CotizItem = {
  codigo?: string | null;
  referencia?: string | null;
  descripcion: string;
  cant: number;
  precio: number; // precio unitario
};
export type CotizData = {
  numero?: string | null;
  fecha: string;            // ya formateada (ej. "16/07/2026")
  cliente: string;
  clienteRif?: string | null;
  clienteDir?: string | null;
  condicionPago?: string | null;
  moneda?: string | null;   // ej. "Dólares"
  ivaMonto?: number;        // MONTO del IVA (lo coloca el usuario)
  comentario?: string | null;
  items: CotizItem[];
};

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const money = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * COTIZACIÓN imprimible (mismo esquema que la cotización de proveedor NORESTE):
 * membrete con logo, datos del cliente, tabla de ítems (código · referencia ·
 * descripción · cant · precio · total) y totales (base imponible, IVA, total).
 */
export function cotizacionHtml(d: CotizData): string {
  const base = d.items.reduce((s, it) => s + (Number(it.cant) || 0) * (Number(it.precio) || 0), 0);
  const iva = Math.max(0, Number(d.ivaMonto) || 0); // monto del IVA lo coloca el usuario
  const total = base + iva;

  const rows = d.items.map((it) => {
    const tot = (Number(it.cant) || 0) * (Number(it.precio) || 0);
    return `<tr>
      <td>${esc(it.codigo || '')}</td>
      <td>${esc(it.referencia || '')}</td>
      <td>${esc(it.descripcion)}</td>
      <td class="c">${Number(it.cant) || 0}</td>
      <td class="r">${money(it.precio)}</td>
      <td class="r b">${money(tot)}</td>
    </tr>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"/><title></title>
  <style>
    @page{ margin:1.4cm; size:letter }
    *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact }
    html,body{ margin:0; padding:0 }
    body{ font-family:Tahoma, Geneva, Verdana, sans-serif; color:#1a1a1a; font-size:10.5pt }
    @media screen{ body{ padding:20px 26px; background:#fff } }
    .head{ display:flex; align-items:center; gap:14px; border-bottom:3px solid #16324F; padding-bottom:9px; margin-bottom:10px }
    .head img{ height:60px; width:auto }
    .head .co{ color:#16324F; font-weight:800; font-size:13pt }
    .head .sub{ color:#555; font-size:9pt }
    .band{ display:flex; justify-content:space-between; gap:12px; margin-bottom:10px }
    .box{ border:1px solid #c9d2dc; border-radius:6px; padding:8px 10px; font-size:10pt }
    .box.cli{ flex:1 } .box.doc{ width:230px }
    .box b{ color:#16324F }
    h1{ font-size:15pt; color:#16324F; margin:0 0 2px; text-align:right }
    table{ border-collapse:collapse; width:100%; font-size:9.5pt; margin-top:4px }
    th,td{ border:1px solid #c9d2dc; padding:5px 7px; text-align:left; vertical-align:top }
    th{ background:#16324F; color:#fff }
    td.c{ text-align:center } td.r{ text-align:right } td.b{ font-weight:800 }
    tr:nth-child(even) td{ background:#f4f7fb }
    .tot{ margin-top:10px; margin-left:auto; width:280px; font-size:10.5pt }
    .tot .row{ display:flex; justify-content:space-between; padding:3px 0 }
    .tot .row.g{ border-top:2px solid #16324F; margin-top:3px; padding-top:6px; font-weight:800; color:#16324F; font-size:12pt }
    .firma{ margin-top:46px; text-align:center }
    .firma .line{ width:280px; margin:0 auto; border-top:1px solid #1a1a1a; padding-top:6px; font-weight:800; color:#16324F }
    .foot{ margin-top:20px; text-align:center; color:#9aa4b2; font-size:8.5pt; border-top:1px solid #e5e7eb; padding-top:7px }
  </style></head><body>
    <div class="head">
      <img src="${LOGO_DATA_URI}"/>
      <div><div class="co">${esc(COMPANY_NAME)}</div><div class="sub">Herramientas, repuestos y servicios</div></div>
    </div>

    <div class="band">
      <div class="box cli">
        <div><b>Cliente:</b> ${esc(d.cliente || '____________________')}</div>
        ${d.clienteRif ? `<div><b>R.I.F:</b> ${esc(d.clienteRif)}</div>` : ''}
        ${d.clienteDir ? `<div>${esc(d.clienteDir)}</div>` : ''}
      </div>
      <div class="box doc">
        <h1>COTIZACIÓN</h1>
        <div><b>N°:</b> ${esc(d.numero || '—')}</div>
        <div><b>Emisión:</b> ${esc(d.fecha)}</div>
        <div><b>Condición de pago:</b> ${esc(d.condicionPago || 'CONTADO')}</div>
        <div><b>Expresado en:</b> ${esc(d.moneda || 'Dólares')}</div>
      </div>
    </div>

    <table>
      <thead><tr><th>Código</th><th>Referencia</th><th>Descripción</th><th class="c">Cant</th><th class="r">Precio</th><th class="r">Total</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="c">Sin ítems</td></tr>'}</tbody>
    </table>

    <div class="tot">
      <div class="row"><span>Base imponible</span><span>${money(base)}</span></div>
      <div class="row"><span>I.V.A.</span><span>${money(iva)}</span></div>
      <div class="row g"><span>TOTAL</span><span>${money(total)}</span></div>
    </div>

    ${d.comentario ? `<div style="margin-top:10px;font-size:10pt"><b>Comentario:</b> ${esc(d.comentario)}</div>` : ''}

    <div class="firma"><div class="line">Firma autorizado</div></div>
    <div class="foot">${esc(COMPANY_NAME)} · Cotización</div>
  </body></html>`;
}
