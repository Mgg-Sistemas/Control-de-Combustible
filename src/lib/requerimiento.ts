// PDF de un REQUERIMIENTO DE COMPRA para pasárselo al jefe (aprobar/rechazar).
// Lista los productos (del inventario o nuevos) con cantidad y precio estimado,
// y el total en US$ (el documento no muestra Bs ni la tasa BCV; la tasa solo se
// usa internamente para convertir a US$ los ítems cargados en bolívares).
import { pdfDocument } from './pdf';
import { FIRMA_DATA_URI, FIRMA2_DATA_URI } from './firmaData';

export type ReqPdfItem = {
  name: string;
  unit?: string | null;
  qty: number;
  est_price: number;
  currency: 'USD' | 'VES' | string;
  isNew?: boolean;
  note?: string | null;
  image?: string | null;
  supplier_name?: string | null;
  exento?: boolean;
  price_usd?: number;
  price_bs?: number;
  cotizaciones_count?: number;
  metodo_pago?: string | null;
};
export type ReqPdfData = {
  code?: string | null;
  fecha: string;              // ya formateada (dd/mm/aaaa)
  title?: string | null;
  note?: string | null;
  company?: string | null;    // empresa para la que se pide (opcional)
  requestedBy?: string | null;
  /** 👤 Responsable (almacenista) elegido al crear — sale junto a «Solicita» (17-oct-2026). */
  responsable?: string | null;
  statusLabel: string;
  rate: number | null;        // Bs por US$ (solo para convertir a US$ ítems cargados en Bs; no se muestra)
  items: ReqPdfItem[];
  approved?: boolean;         // true si el requerimiento está APROBADO (muestra la firma)
  decidedBy?: string | null;  // nombre de quien aprobó (define la firma y el cargo)
  // 📋 Datos DECLARADOS en el papel — pedido del cliente del 20-oct-2026: el
  // formato debe decir quién lo solicitó, quién lo autorizó, si es para vehículo
  // o maquinaria, a qué área va dirigido y un espacio de observaciones. Todos
  // opcionales porque los ~500 requerimientos viejos no los tienen: lo vacío no
  // se dibuja y esos papeles se ven exactamente igual que siempre.
  /** 👤 Quién SOLICITÓ (persona declarada, 20-oct-2026) — distinto de `requestedBy`,
   *  que es el usuario que lo registró en el sistema. */
  solicitante?: string | null;
  /** ✅ Quién AUTORIZÓ la compra (declarado en el papel) — distinto de `decidedBy`,
   *  que es quien aprobó dentro del sistema. */
  autorizadoPor?: string | null;
  /** 🚜 Para qué es: «Maquinaria» o «Vehículo» (ya viene en palabras). */
  destino?: string | null;
  /** 🏢 Área a la que va dirigido (ADMINISTRATIVO, COCINA…). */
  area?: string | null;
  /** 📝 Observaciones / información adicional, al final del documento. */
  observaciones?: string | null;
  /** 🏢 Empresa Pagadora (Liscioni, Golden Touch...). */
  empresaPagadora?: string | null;
  /** 🏭 Proveedor asignado */
  proveedor?: string | null;
  /** 💳 Coordenadas de pago del proveedor */
  proveedorDatosPago?: {
    banco?: string | null;
    cuenta?: string | null;
    titular?: string | null;
    cedulaRif?: string | null;
    pagoMovil?: string | null;
    binance?: string | null;
  } | string | null;
  /** 🔄 Ciclo de Aclaratoria Técnica */
  aclaratoria?: {
    motivo?: string | null;
    solicitadaPor?: string | null;
    fechaSolicitud?: string | null;
    respuesta?: string | null;
    fechaRespuesta?: string | null;
  } | null;
  /** 🧾 Alícuota de IVA del requerimiento (16% por defecto, editable a 0%) */
  ivaAlicuota?: number | null;
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
/** Lleva un precio a US$ usando la tasa (si viene en Bs u otra moneda). */
const toUsd = (price: number, currency: string, rate: number | null) =>
  currency === 'VES' || currency === 'BS' ? (rate && rate > 0 ? price / rate : 0) : price;

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
      /* Fichas de los datos declarados (20-oct-2026). Van en renglones de dos
         para que entren en el ancho de la hoja sin empujar la tabla, y con el
         gris/azul del resto del documento para que no parezcan un agregado.
         El bloque entero solo existe si hay al menos un dato. */
      .reqdatos{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
      .reqdato{flex:1 1 44%;min-width:200px;box-sizing:border-box;border:1px solid #c9d2dc;border-radius:6px;background:#f4f7fb;padding:5px 8px;font-size:11px;color:#333}
      .reqdato .rot{display:block;font-size:9px;font-weight:800;color:#16324F;letter-spacing:.3px;text-transform:uppercase}
      .reqdato .val{font-weight:700;color:#1a1a1a}
      /* Observaciones: es texto libre que escribe la persona, así que pre-wrap
         para que los saltos de línea salgan en el papel tal como los tecleó. */
      .reqobs{margin-top:10px;font-size:11px;white-space:pre-wrap;border-top:1px solid #c9d2dc;padding-top:6px}
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

/** Filas de la tabla + total en US$ y Bs de UN requerimiento */
function reqTableHtml(d: ReqPdfData): {
  rows: string;
  totalUsd: number;
  subtotalUsd: number;
  baseImponibleUsd: number;
  exentoUsd: number;
  ivaUsd: number;
  totalBs: number;
  subtotalBs: number;
  baseImponibleBs: number;
  exentoBs: number;
  ivaBs: number;
  alicuota: number;
  hasImg: boolean;
} {
  const hasImg = d.items.some((it) => !!it.image);
  let subtotalUsd = 0;
  let baseImponibleUsd = 0;
  let subtotalBs = 0;
  let baseImponibleBs = 0;

  const rows = d.items.map((it, i) => {
    const qty = Number(it.qty) || 0;
    const uUsd = toUsd(Number(it.est_price) || 0, it.currency, d.rate);
    const lineUsd = uUsd * qty;
    const lineBs = (it.price_bs && Number(it.price_bs) > 0)
      ? Number(it.price_bs) * qty
      : (d.rate && d.rate > 0 ? lineUsd * d.rate : 0);

    subtotalUsd += lineUsd;
    subtotalBs += lineBs;
    if (!it.exento) {
      baseImponibleUsd += lineUsd;
      baseImponibleBs += lineBs;
    }
    const imgCell = hasImg ? `<td class="c">${it.image ? `<img class="pimg" src="${it.image}"/>` : ''}</td>` : '';
    const desc = it.note ? `<div class="pdesc">📐 ${esc(it.note)}</div>` : '';
    const provLine = it.supplier_name && it.supplier_name !== d.proveedor
      ? `<div class="pdesc" style="color:#2563EB;font-weight:700">🏢 Proveedor: ${esc(it.supplier_name)}</div>`
      : '';
    const metodoLine = it.metodo_pago
      ? `<div class="pdesc" style="color:#0D9488;font-weight:700">💳 Método cotizado: ${esc(it.metodo_pago)}</div>`
      : '';
    const exentoBadge = it.exento
      ? `<span style="background:#E0F2FE;color:#0369A1;font-size:9px;padding:1px 5px;border-radius:4px;font-weight:800;margin-left:4px">🛡️ EXENTO DE IVA</span>`
      : '';
    const cotBadge = it.cotizaciones_count && it.cotizaciones_count > 0
      ? `<div class="pdesc" style="color:#7C3AED;font-weight:700">📋 ${it.cotizaciones_count} cotizaciones evaluadas</div>`
      : '';
    const bsSubtext = lineBs > 0
      ? `<div style="font-size:9px;color:#0D9488;font-weight:700">Bs ${money(lineBs)}</div>`
      : (d.rate && d.rate > 0
        ? `<div style="font-size:9px;color:#6B7280;font-weight:normal">Bs ${money(lineUsd * d.rate)}</div>`
        : '');

    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.name)}${it.isNew ? ' <span class="new">NUEVO</span>' : ''}${exentoBadge}${desc}${provLine}${metodoLine}${cotBadge}</td>
      ${imgCell}
      <td class="c">${money(it.qty)} ${esc(it.unit || '')}</td>
      <td class="r">$${money(uUsd)}</td>
      <td class="r b">$${money(lineUsd)}${bsSubtext}</td>
    </tr>`;
  }).join('');

  const exentoUsd = subtotalUsd - baseImponibleUsd;
  const exentoBs = subtotalBs - baseImponibleBs;
  const alicuota = d.ivaAlicuota !== undefined && d.ivaAlicuota !== null
    ? Math.min(100, Math.max(0, Number(d.ivaAlicuota)))
    : 16;
  const ivaUsd = Math.round(baseImponibleUsd * (alicuota / 100) * 100) / 100;
  const ivaBs = Math.round(baseImponibleBs * (alicuota / 100) * 100) / 100;
  const totalUsd = Math.round((subtotalUsd + ivaUsd) * 100) / 100;
  const totalBs = Math.round((subtotalBs + ivaBs) * 100) / 100;

  return { rows, totalUsd, subtotalUsd, baseImponibleUsd, exentoUsd, ivaUsd, totalBs, subtotalBs, baseImponibleBs, exentoBs, ivaBs, alicuota, hasImg };
}

/** Fichas con los datos DECLARADOS en el papel (20-oct-2026): el cliente pidió que
 *  el formato diga quién solicitó, quién autorizó, si es para maquinaria o vehículo
 *  y a qué área va dirigido. No se sacan del subtítulo porque esos son los datos
 *  del SISTEMA («Solicita» = quien lo registró, el aprobador = quien lo aprobó aquí):
 *  estos los declara la persona y pueden ser otros.
 *  Lo vacío NO sale, y si no viene ninguno no se dibuja ni el contenedor — de otro
 *  modo los ~500 requerimientos viejos quedarían con un borde suelto arriba. */
function reqDatosHtml(d: ReqPdfData): string {
  const fichas: Array<[string, string]> = [
    ['👤 Solicitado por', (d.solicitante || '').trim()],
    ['✅ Autorizado por', (d.autorizadoPor || '').trim()],
    ['🚜 Para', (d.destino || '').trim()],
    ['🏢 Área', (d.area || '').trim()],
    ['🏢 Empresa Pagadora', (d.empresaPagadora || '').trim()],
    ['🏭 Proveedor', (d.proveedor || '').trim()],
  ];
  const cards = fichas
    .filter(([, valor]) => !!valor)
    .map(([rotulo, valor]) => `<div class="reqdato"><span class="rot">${rotulo}</span><span class="val">${esc(valor)}</span></div>`)
    .join('');
  
  let pagoTexto = '';
  if (typeof d.proveedorDatosPago === 'string') {
    pagoTexto = d.proveedorDatosPago;
  } else if (d.proveedorDatosPago) {
    const p = d.proveedorDatosPago;
    const parts = [
      p.banco || p.cuenta ? `🏦 ${p.banco ?? ''} Cta: ${p.cuenta ?? ''}${p.titular ? ` (${p.titular} ${p.cedulaRif ?? ''})` : ''}`.trim() : '',
      p.pagoMovil ? `📱 PM: ${p.pagoMovil}` : '',
      p.binance ? `🟡 Binance: ${p.binance}` : '',
    ].filter(Boolean);
    pagoTexto = parts.join(' · ');
  }

  const pagoCard = pagoTexto
    ? `<div class="reqdato" style="flex:1 1 95%"><span class="rot">💳 Coordenadas de Pago</span><span class="val" style="font-size:10.5px">${esc(pagoTexto)}</span></div>`
    : '';

  return cards || pagoCard ? `<div class="reqdatos">${cards}${pagoCard}</div>` : '';
}

/** Observaciones AL FINAL del documento (20-oct-2026, «un espacio de observaciones»):
 *  van después del total y de la nota porque son el cierre del papel, no un dato de
 *  cabecera. Si vienen vacías no queda ni el rótulo. */
function reqObsHtml(d: ReqPdfData): string {
  const obs = (d.observaciones || '').trim();
  const a = d.aclaratoria;
  let aclaratoriaHtml = '';
  if (a && (a.motivo || a.respuesta)) {
    aclaratoriaHtml = `
      <div style="margin-top:8px;padding:6px 10px;border-left:3px solid #EA580C;background:#FFF7ED;border-radius:4px;font-size:10.5px;color:#9A3412">
        <b>🔄 Ciclo de Retroalimentación Técnica (Compras):</b><br/>
        ${a.motivo ? `• <b>Aclaratoria solicitada${a.fechaSolicitud ? ` (${esc(a.fechaSolicitud)})` : ''}:</b> ${esc(a.motivo)}<br/>` : ''}
        ${a.respuesta ? `• <b>Respuesta técnica del solicitante${a.fechaRespuesta ? ` (${esc(a.fechaRespuesta)})` : ''}:</b> ${esc(a.respuesta)}` : ''}
      </div>
    `;
  }
  return (obs ? `<div class="reqobs"><b>📝 Observaciones:</b> ${esc(obs)}</div>` : '') + aclaratoriaHtml;
}

/** Encabezado de la tabla (con o sin la columna "Imagen"). */
function reqTheadHtml(hasImg: boolean): string {
  return `<thead><tr><th style="width:26px" class="c">#</th><th>Producto</th>${hasImg ? '<th class="c" style="width:104px">Imagen</th>' : ''}<th class="c">Cantidad</th>` +
    `<th class="r">Precio est. (unit.)</th><th class="r">Subtotal (US$)</th></tr></thead>`;
}

function reqTotalsBlockHtml(res: ReturnType<typeof reqTableHtml>, rate: number | null): string {
  const { subtotalUsd, baseImponibleUsd, exentoUsd, ivaUsd, totalUsd, totalBs, alicuota } = res;
  return `
    <div style="margin-top:12px;border-top:1.5px solid #16324F;padding-top:6px;max-width:340px;margin-left:auto;font-size:11px">
      <div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span style="color:#555">Subtotal:</span>
        <b>$${money(subtotalUsd)}</b>
      </div>
      ${exentoUsd > 0 ? `
      <div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span style="color:#0369A1">Exento de IVA:</span>
        <span style="color:#0369A1;font-weight:700">$${money(exentoUsd)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span style="color:#555">Base imponible (gravada):</span>
        <span>$${money(baseImponibleUsd)}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;margin-bottom:2px">
        <span style="color:#555">IVA (${alicuota}%):</span>
        <b>$${money(ivaUsd)}</b>
      </div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid #c9d2dc;padding-top:4px;font-size:13px;color:#16324F;font-weight:900">
        <span>TOTAL ESTIMADO:</span>
        <div style="text-align:right">
          <div>$${money(totalUsd)}</div>
          ${totalBs > 0 ? `<div style="font-size:11px;color:#0D9488;font-weight:800">Bs ${money(totalBs)}</div>` : ''}
        </div>
      </div>
      ${totalBs > 0 && totalUsd > 0 && Math.abs((totalBs / totalUsd) - (rate || 0)) > 0.1 ? `
      <div style="text-align:right;color:#666;font-size:9.5px;margin-top:2px">
        Tasa efectiva: Bs ${money(totalBs / totalUsd)} por USD ${rate ? `(BCV: ${money(rate)})` : ''}
      </div>` : (rate && rate > 0 ? `
      <div style="text-align:right;color:#666;font-size:10px;margin-top:2px">
        ≈ Bs ${money(totalUsd * rate)} (Tasa: ${money(rate)})
      </div>` : '')}
    </div>`;
}

/** El cuerpo (tabla + total + firma) de UN requerimiento, sin envolver en `pdfDocument`
 *  — así lo puede usar tanto el PDF individual como el de varios requerimientos juntos. */
function reqBodyHtml(d: ReqPdfData, heading?: string): string {
  const tableRes = reqTableHtml(d);
  const { rows, hasImg } = tableRes;

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
          ${reqDatosHtml(d)}
          <table>
            ${reqTheadHtml(hasImg)}
            <tbody>${rows || `<tr><td colspan="${hasImg ? 6 : 5}" class="c">Sin ítems</td></tr>`}</tbody>
          </table>
          ${reqTotalsBlockHtml(tableRes, d.rate)}
          ${d.note ? `<div class="note"><b>Nota:</b> ${esc(d.note)}</div>` : ''}
          ${reqObsHtml(d)}
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
    subtitle: `${d.code ? d.code + ' · ' : ''}${esc(d.fecha)} · Estado: ${esc(d.statusLabel)}${d.company ? ' · Empresa: ' + esc(d.company) : ''}${d.requestedBy ? ' · Solicita: ' + esc(d.requestedBy) : ''}${d.responsable ? ' · Responsable: ' + esc(d.responsable) : ''}`,
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
      const heading = `${i + 1}/${list.length} · ${d.code ? esc(d.code) + ' · ' : ''}${esc(d.fecha)} · Estado: ${esc(d.statusLabel)}${d.company ? ' · Empresa: ' + esc(d.company) : ''}${d.requestedBy ? ' · Solicita: ' + esc(d.requestedBy) : ''}${d.responsable ? ' · Responsable: ' + esc(d.responsable) : ''}`;
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
  const tableRes = reqTableHtml(d);
  const { rows, hasImg } = tableRes;
  return `
      <div class="reqsum">
        <div class="reqhead">${heading}</div>
        ${d.title ? `<div class="note"><b>${esc(d.title)}</b></div>` : ''}
        ${reqDatosHtml(d)}
        <table>
          ${reqTheadHtml(hasImg)}
          <tbody>${rows || `<tr><td colspan="${hasImg ? 6 : 5}" class="c">Sin ítems</td></tr>`}</tbody>
        </table>
        ${reqTotalsBlockHtml(tableRes, d.rate)}
        ${d.note ? `<div class="note"><b>Nota:</b> ${esc(d.note)}</div>` : ''}
        ${reqObsHtml(d)}
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
      const heading = `${i + 1}/${list.length} · ${d.code ? esc(d.code) + ' · ' : ''}${esc(d.fecha)} · Estado: ${esc(d.statusLabel)}${d.company ? ' · Empresa: ' + esc(d.company) : ''}${d.requestedBy ? ' · Solicita: ' + esc(d.requestedBy) : ''}${d.responsable ? ' · Responsable: ' + esc(d.responsable) : ''}`;
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
