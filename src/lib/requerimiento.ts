// PDF de un REQUERIMIENTO DE COMPRA para pasárselo al jefe (aprobar/rechazar).
// Lista los productos (del inventario o nuevos) con cantidad y precio estimado,
// y el total en US$ (el documento no muestra Bs ni la tasa BCV; la tasa solo se
// usa internamente para convertir a US$ los ítems cargados en bolívares).
import { pdfDocument } from './pdf';
import { FIRMA_DATA_URI, FIRMA2_DATA_URI } from './firmaData';

export type ReqPdfItem = { name: string; unit?: string | null; qty: number; est_price: number; currency: 'USD' | 'VES'; isNew?: boolean; note?: string | null; image?: string | null };
export type ReqPdfData = {
  code?: string | null;
  fecha: string;              // ya formateada (dd/mm/aaaa)
  title?: string | null;
  note?: string | null;
  company?: string | null;    // empresa para la que se pide (opcional)
  requestedBy?: string | null;
  statusLabel: string;
  rate: number | null;        // Bs por US$ (solo para convertir a US$ ítems cargados en Bs; no se muestra)
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

const REQ_CSS = `table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}
      th,td{border:1px solid #c9d2dc;padding:6px 8px;text-align:left} th{background:#16324F;color:#fff}
      td.c{text-align:center} td.r{text-align:right} td.b{font-weight:800}
      tr:nth-child(even) td{background:#f4f7fb}
      .new{background:#0F766E;color:#fff;font-size:9px;padding:1px 5px;border-radius:6px;font-weight:800}
      /* Imagen de referencia del producto dentro de su celda. */
      .pimg{max-width:88px;max-height:66px;border-radius:4px;display:block;margin:0 auto;object-fit:contain}
      .pdesc{color:#555;font-size:10px;margin-top:2px;text-transform:none;font-weight:400}
      .tot{margin-top:12px;text-align:right;font-size:13px;font-weight:800;color:#16324F}
      .note{margin-top:10px;font-size:11px}
      .reqhead{font-size:13px;font-weight:800;color:#16324F;margin-bottom:2px}
      /* La firma queda AL FONDO de la página: el cuerpo llena el alto y el espaciador
         (.push) empuja la firma hacia abajo. Si el contenido es largo, el espaciador
         se encoge y la firma cae justo debajo (sin romper la página). */
      .reqbody{display:flex;flex-direction:column;min-height:20cm}
      .push{flex:1 1 auto;min-height:24px}
      .firma{text-align:center;page-break-inside:avoid}
      .firma img{height:auto;max-height:110px;max-width:260px;display:block;margin:0 auto 2px}
      .firma .line{width:300px;margin:0 auto;border-top:1px solid #1a1a1a;padding-top:6px;font-weight:800;color:#16324F}
      .firma .firmante{margin-top:2px;font-size:12px;font-weight:700;color:#333;letter-spacing:.3px}
      .pgbreak{page-break-after:always}
      .reqsum{margin-bottom:16px;page-break-inside:avoid}
      .reqsum + .reqsum{border-top:1px dashed #c9d2dc;padding-top:14px;margin-top:2px}`;

/** Filas de la tabla + total en US$ de UN requerimiento (compartido entre
 *  el PDF con firma y el resumen sin firma). El precio unitario se muestra
 *  siempre en US$ (si el ítem se cargó en Bs, se convierte con la tasa del
 *  día solo para este cálculo; el documento no muestra Bs ni la tasa). */
function reqTableHtml(d: ReqPdfData): { rows: string; totalUsd: number; hasImg: boolean } {
  // La columna "Imagen" solo sale si ALGÚN producto trae imagen (así los
  // requerimientos viejos sin fotos se ven igual que siempre).
  const hasImg = d.items.some((it) => !!it.image);
  let totalUsd = 0;
  const rows = d.items.map((it, i) => {
    const uUsd = toUsd(Number(it.est_price) || 0, it.currency, d.rate);
    const lineUsd = uUsd * (Number(it.qty) || 0);
    totalUsd += lineUsd;
    const imgCell = hasImg ? `<td class="c">${it.image ? `<img class="pimg" src="${it.image}"/>` : ''}</td>` : '';
    const desc = it.note ? `<div class="pdesc">${esc(it.note)}</div>` : '';
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.name)}${it.isNew ? ' <span class="new">NUEVO</span>' : ''}${desc}</td>
      ${imgCell}
      <td class="c">${money(it.qty)} ${esc(it.unit || '')}</td>
      <td class="r">$${money(uUsd)}</td>
      <td class="r b">$${money(lineUsd)}</td>
    </tr>`;
  }).join('');
  return { rows, totalUsd, hasImg };
}

/** Encabezado de la tabla (con o sin la columna "Imagen"). */
function reqTheadHtml(hasImg: boolean): string {
  return `<thead><tr><th style="width:26px" class="c">#</th><th>Producto</th>${hasImg ? '<th class="c" style="width:104px">Imagen</th>' : ''}<th class="c">Cantidad</th>` +
    `<th class="r">Precio est. (unit.)</th><th class="r">Subtotal (US$)</th></tr></thead>`;
}

/** El cuerpo (tabla + total + firma) de UN requerimiento, sin envolver en `pdfDocument`
 *  — así lo puede usar tanto el PDF individual como el de varios requerimientos juntos. */
function reqBodyHtml(d: ReqPdfData, heading?: string): string {
  const { rows, totalUsd, hasImg } = reqTableHtml(d);

  // Bloque de firma: si está APROBADO por un firmante conocido, va su firma escaneada
  // y su cargo. Si no, queda la línea "Aprobado por (jefe)" para firmar a mano.
  const signer = d.approved ? firmante(d.decidedBy) : null;
  const aprobador = (d.decidedBy || '').trim();
  const firmaBlock = signer
    ? `<img src="${signer.img}"${signer.flip ? ' style="transform:scaleX(-1)"' : ''}/><div class="line">${esc(signer.label)}</div>${aprobador ? `<div class="firmante">${esc(aprobador.toUpperCase())}</div>` : ''}`
    : `<div class="line">Aprobado por (jefe)</div>`;

  return `
      <div class="reqbody">
        <div>
          ${heading ? `<div class="reqhead">${heading}</div>` : ''}
          ${d.title ? `<div class="note"><b>${esc(d.title)}</b></div>` : ''}
          <table>
            ${reqTheadHtml(hasImg)}
            <tbody>${rows || `<tr><td colspan="${hasImg ? 6 : 5}" class="c">Sin ítems</td></tr>`}</tbody>
          </table>
          <div class="tot">TOTAL ESTIMADO: $${money(totalUsd)}</div>
          ${d.note ? `<div class="note"><b>Nota:</b> ${esc(d.note)}</div>` : ''}
        </div>
        <div class="push"></div>
        <div class="firma">
          ${firmaBlock}
        </div>
      </div>`;
}

export function requerimientoHtml(d: ReqPdfData): string {
  return pdfDocument({
    title: 'Requerimiento de compra',
    subtitle: `${d.code ? d.code + ' · ' : ''}${esc(d.fecha)} · Estado: ${esc(d.statusLabel)}${d.company ? ' · Empresa: ' + esc(d.company) : ''}${d.requestedBy ? ' · Solicita: ' + esc(d.requestedBy) : ''}`,
    extraCss: REQ_CSS,
    body: reqBodyHtml(d),
  });
}

/**
 * PDF de VARIOS requerimientos en un solo documento (uno por página, con su propia
 * tabla/total/firma) — para descargar de una vez los que el usuario filtró/seleccionó
 * en vez de uno por uno. `list` ya viene ordenada como se quiere ver en el PDF.
 */
export function requerimientosBulkHtml(list: ReqPdfData[]): string {
  const body = list
    .map((d, i) => {
      const heading = `${i + 1}/${list.length} · ${d.code ? esc(d.code) + ' · ' : ''}${esc(d.fecha)} · Estado: ${esc(d.statusLabel)}${d.company ? ' · Empresa: ' + esc(d.company) : ''}${d.requestedBy ? ' · Solicita: ' + esc(d.requestedBy) : ''}`;
      const block = reqBodyHtml(d, heading);
      return i < list.length - 1 ? `${block}<div class="pgbreak"></div>` : block;
    })
    .join('');
  return pdfDocument({
    title: 'Requerimientos de compra',
    subtitle: `${list.length} requerimiento(s)`,
    extraCss: REQ_CSS,
    body,
  });
}

/** Bloque de UN requerimiento para el RESUMEN: tabla + total, SIN firma y sin
 *  forzar salto de página — se apila debajo del anterior en el mismo documento. */
function reqSummaryBlockHtml(d: ReqPdfData, heading: string): string {
  const { rows, totalUsd, hasImg } = reqTableHtml(d);
  return `
      <div class="reqsum">
        <div class="reqhead">${heading}</div>
        ${d.title ? `<div class="note"><b>${esc(d.title)}</b></div>` : ''}
        <table>
          ${reqTheadHtml(hasImg)}
          <tbody>${rows || `<tr><td colspan="${hasImg ? 6 : 5}" class="c">Sin ítems</td></tr>`}</tbody>
        </table>
        <div class="tot">TOTAL ESTIMADO: $${money(totalUsd)}</div>
        ${d.note ? `<div class="note"><b>Nota:</b> ${esc(d.note)}</div>` : ''}
      </div>`;
}

/**
 * RESUMEN de varios requerimientos en un solo documento: misma tabla/total de
 * cada uno, pero SIN firma y agrupados uno debajo del otro (no uno por
 * página) — para una vista rápida de todo lo filtrado/seleccionado.
 */
export function requerimientosResumenHtml(list: ReqPdfData[]): string {
  const body = list
    .map((d, i) => {
      const heading = `${i + 1}/${list.length} · ${d.code ? esc(d.code) + ' · ' : ''}${esc(d.fecha)} · Estado: ${esc(d.statusLabel)}${d.company ? ' · Empresa: ' + esc(d.company) : ''}${d.requestedBy ? ' · Solicita: ' + esc(d.requestedBy) : ''}`;
      return reqSummaryBlockHtml(d, heading);
    })
    .join('');
  return pdfDocument({
    title: 'Resumen de requerimientos',
    subtitle: `${list.length} requerimiento(s)`,
    extraCss: REQ_CSS,
    body,
  });
}
