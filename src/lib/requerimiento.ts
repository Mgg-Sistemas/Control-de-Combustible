// PDF de un REQUERIMIENTO DE COMPRA para pasárselo al jefe (aprobar/rechazar).
// Lista los productos (del inventario o nuevos) con cantidad y precio estimado,
// y el total en US$ y en Bs al cambio del día.
import { pdfDocument } from './pdf';
import { FIRMA_DATA_URI, FIRMA2_DATA_URI } from './firmaData';

export type ReqPdfItem = { name: string; unit?: string | null; qty: number; est_price: number; currency: 'USD' | 'VES'; isNew?: boolean };
export type ReqPdfData = {
  code?: string | null;
  fecha: string;              // ya formateada (dd/mm/aaaa)
  title?: string | null;
  note?: string | null;
  company?: string | null;    // empresa para la que se pide (opcional)
  requestedBy?: string | null;
  statusLabel: string;
  rate: number | null;        // Bs por US$ (para el total en Bs)
  items: ReqPdfItem[];
  approved?: boolean;         // true si el requerimiento está APROBADO (muestra la firma)
  decidedBy?: string | null;  // nombre de quien aprobó (define la firma y el cargo)
};

// Firma según QUIÉN aprueba: cada aprobador tiene su cargo y su firma escaneada.
// `flip` voltea la imagen en espejo horizontal (la firma2 venía al revés en el escaneo).
function firmante(decidedBy?: string | null): { label: string; img: string; flip?: boolean } | null {
  const dn = (decidedBy || '').toLowerCase();
  if (dn.includes('lozada') || dn.includes('jesus')) return { label: 'Aprobado por Director General', img: FIRMA_DATA_URI };
  if (dn.includes('dorianne')) return { label: 'Aprobado por Jefe Administrativo', img: FIRMA2_DATA_URI, flip: true };
  return null;
}

const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Lleva un precio a US$ usando la tasa (si viene en Bs). */
const toUsd = (price: number, currency: 'USD' | 'VES', rate: number | null) =>
  currency === 'USD' ? price : (rate && rate > 0 ? price / rate : 0);

export function requerimientoHtml(d: ReqPdfData): string {
  let totalUsd = 0;
  const rows = d.items.map((it, i) => {
    const uUsd = toUsd(Number(it.est_price) || 0, it.currency, d.rate);
    const lineUsd = uUsd * (Number(it.qty) || 0);
    totalUsd += lineUsd;
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.name)}${it.isNew ? ' <span class="new">NUEVO</span>' : ''}</td>
      <td class="c">${money(it.qty)} ${esc(it.unit || '')}</td>
      <td class="r">${it.currency === 'USD' ? '$' : 'Bs '}${money(it.est_price)}</td>
      <td class="r b">$${money(lineUsd)}</td>
    </tr>`;
  }).join('');
  const totalBs = d.rate && d.rate > 0 ? totalUsd * d.rate : null;

  // Bloque de firma: si está APROBADO por un firmante conocido, va su firma escaneada
  // y su cargo. Si no, queda la línea "Aprobado por (jefe)" para firmar a mano.
  const signer = d.approved ? firmante(d.decidedBy) : null;
  const aprobador = (d.decidedBy || '').trim();
  const firmaBlock = signer
    ? `<img src="${signer.img}"${signer.flip ? ' style="transform:scaleX(-1)"' : ''}/><div class="line">${esc(signer.label)}</div>${aprobador ? `<div class="firmante">${esc(aprobador.toUpperCase())}</div>` : ''}`
    : `<div class="line">Aprobado por (jefe)</div>`;

  return pdfDocument({
    title: 'Requerimiento de compra',
    subtitle: `${d.code ? d.code + ' · ' : ''}${esc(d.fecha)} · Estado: ${esc(d.statusLabel)}${d.company ? ' · Empresa: ' + esc(d.company) : ''}${d.requestedBy ? ' · Solicita: ' + esc(d.requestedBy) : ''}`,
    extraCss: `table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}
      th,td{border:1px solid #c9d2dc;padding:6px 8px;text-align:left} th{background:#16324F;color:#fff}
      td.c{text-align:center} td.r{text-align:right} td.b{font-weight:800}
      tr:nth-child(even) td{background:#f4f7fb}
      .new{background:#0F766E;color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;font-weight:800}
      .tot{margin-top:12px;text-align:right;font-size:13px;font-weight:800;color:#16324F}
      .note{margin-top:10px;font-size:11px}
      /* La firma queda AL FONDO de la página: el cuerpo llena el alto y el espaciador
         (.push) empuja la firma hacia abajo. Si el contenido es largo, el espaciador
         se encoge y la firma cae justo debajo (sin romper la página). */
      .reqbody{display:flex;flex-direction:column;min-height:20cm}
      .push{flex:1 1 auto;min-height:24px}
      .firma{text-align:center;page-break-inside:avoid}
      .firma img{height:auto;max-height:110px;max-width:260px;display:block;margin:0 auto 2px}
      .firma .line{width:300px;margin:0 auto;border-top:1px solid #1a1a1a;padding-top:6px;font-weight:800;color:#16324F}
      .firma .firmante{margin-top:2px;font-size:12px;font-weight:700;color:#333;letter-spacing:.3px}`,
    body: `
      <div class="reqbody">
        <div>
          ${d.title ? `<div class="note"><b>${esc(d.title)}</b></div>` : ''}
          <table>
            <thead><tr><th style="width:26px" class="c">#</th><th>Producto</th><th class="c">Cantidad</th>
              <th class="r">Precio est. (unit.)</th><th class="r">Subtotal (US$)</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" class="c">Sin ítems</td></tr>'}</tbody>
          </table>
          <div class="tot">TOTAL ESTIMADO: $${money(totalUsd)}${totalBs != null ? ` · Bs ${money(totalBs)}` : ''}</div>
          ${d.note ? `<div class="note"><b>Nota:</b> ${esc(d.note)}</div>` : ''}
          ${d.rate ? `<div class="note" style="color:#555">Tasa referencial: Bs ${money(d.rate)} / US$</div>` : ''}
        </div>
        <div class="push"></div>
        <div class="firma">
          ${firmaBlock}
        </div>
      </div>`,
  });
}
