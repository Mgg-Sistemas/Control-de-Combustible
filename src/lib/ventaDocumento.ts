// EL PAPEL DE LA VENTA: FACTURA o NOTA DE ENTREGA.
//
// Las dos llevan PRECIO (pedido del cliente); lo único que cambia es el rótulo,
// el color del sello y la letra chica del pie. Es una sola plantilla a propósito:
// dos plantillas parecidas se desincronizan y terminan cobrando distinto en el
// mismo negocio.
//
// El equivalente en Bs se imprime con la tasa que traía la venta, NO con la de
// hoy: un papel ya entregado no puede cambiar de monto porque cambió el dólar.
import { LOGO_DATA_URI } from './logoData';
import { GOLDEN_TOUCH_LOGO_DATA_URI } from './logoGoldenTouchData';
import { JHENZAEN_LOGO_DATA_URI } from './logoJhenzaenData';
import { RENACE_LOGO_DATA_URI } from './logoRenaceData';
import { COMPANY_NAME } from './company';
import { VentaDocKind, VentaItem, MetodoPago, metodoLabel, lineaTotal } from './ventas';

export type VentaDocData = {
  docKind: VentaDocKind;
  numero: string;            // FAC-0001 / NE-0001
  codigo?: string | null;    // VTA-0001 (control interno)
  fecha: string;             // ya formateada: "22/09/2026"
  cliente: {
    nombre: string;
    documento?: string | null;   // "V-12345678" / "J-409876543"
    telefono?: string | null;
    direccion?: string | null;
    email?: string | null;
  };
  items: VentaItem[];
  subtotal: number;
  conIva: boolean;
  ivaPct: number;
  ivaMonto: number;
  total: number;             // en $
  tasaBs: number;            // tasa BCV usada
  totalBs: number;           // congelado
  condicion: 'contado' | 'credito';
  metodo?: MetodoPago | null;
  vendedor?: string | null;
  nota?: string | null;
};

// ── Opciones del papel (01-nov-2026) ─────────────────────────────────────────
// Se eligen ANTES de imprimir. Regla de la casa: activar/desactivar una opción
// NO se anuncia en el papel; lo oculto simplemente no sale.
export type VentaLogoKey = 'principal' | 'golden' | 'jhenzaen' | 'renace' | 'ninguno';

export const VENTA_LOGOS: { key: VentaLogoKey; label: string }[] = [
  { key: 'principal', label: 'Logo de la empresa' },
  { key: 'golden', label: 'Golden Touch' },
  { key: 'jhenzaen', label: 'Jhenzaen' },
  { key: 'renace', label: 'Renace' },
  { key: 'ninguno', label: 'Sin logo' },
];

export type VentaDocOpciones = {
  /** En los renglones de SERVICIO no salen precio ni total; y si hay servicios,
   *  tampoco subtotal, IVA, TOTAL ni equivalente en Bs (delatarían el monto). */
  ocultarMontosServicio: boolean;
  /** Sin la etiqueta «Servicio» bajo la descripción ni la unidad «SERV». */
  ocultarIdServicio: boolean;
  /** Logo de arriba a la izquierda. */
  logo: VentaLogoKey;
  /** Logo de arriba a la derecha, junto al sello (por defecto ninguno). */
  logo2: VentaLogoKey;
};

export const VENTA_DOC_OPCIONES_DEFAULT: VentaDocOpciones = {
  ocultarMontosServicio: false,
  ocultarIdServicio: false,
  logo: 'principal',
  logo2: 'ninguno',
};

export function logoUri(k: VentaLogoKey | null | undefined): string {
  switch (k) {
    case 'principal': return LOGO_DATA_URI;
    case 'golden': return GOLDEN_TOUCH_LOGO_DATA_URI;
    case 'jhenzaen': return JHENZAEN_LOGO_DATA_URI;
    case 'renace': return RENACE_LOGO_DATA_URI;
    default: return '';
  }
}

/** Lo guardado (AsyncStorage) puede venir viejo o roto: se completa con lo de fábrica. */
export function opcionesVentaDoc(raw: any): VentaDocOpciones {
  const o = raw && typeof raw === 'object' ? raw : {};
  const esLogo = (v: any) => VENTA_LOGOS.some((l) => l.key === v);
  return {
    ocultarMontosServicio: o.ocultarMontosServicio === true,
    ocultarIdServicio: o.ocultarIdServicio === true,
    logo: esLogo(o.logo) ? o.logo : VENTA_DOC_OPCIONES_DEFAULT.logo,
    logo2: esLogo(o.logo2) ? o.logo2 : VENTA_DOC_OPCIONES_DEFAULT.logo2,
  };
}

/** La unidad que se imprime: «SERV» desaparece si se oculta el identificador. */
export function unidadImpresa(it: VentaItem, op: VentaDocOpciones): string {
  const u = String(it.unit ?? '').trim();
  if (op.ocultarIdServicio && it.kind === 'servicio' && (!u || /^serv/i.test(u))) return '';
  return u || '—';
}

const esc = (s: any): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const usd = (n: any) =>
  `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const bs = (n: any) =>
  `Bs ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: any) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString('es-VE', { maximumFractionDigits: 2 });
};

const NAVY = '#16324F';

/**
 * HTML imprimible de la venta. Carta, listo para `exportPdf`.
 *
 * El diseño mejora la cotización de referencia: cabecera con sello del tipo de
 * documento (para no confundir una NOTA con una FACTURA de un vistazo), datos
 * del cliente en bloque propio, tabla con cantidad/unidad/precio/total, el
 * TOTAL grande en $ y su equivalente en Bs con la tasa usada, y dos firmas.
 */
export function ventaDocumentoHtml(d: VentaDocData, opciones?: Partial<VentaDocOpciones> | null): string {
  const op = opcionesVentaDoc({ ...VENTA_DOC_OPCIONES_DEFAULT, ...(opciones || {}) });
  const hayServicio = d.items.some((it) => it.kind === 'servicio');
  // Con montos de servicio ocultos y TODO servicio, se van las columnas enteras.
  const sinMontos = op.ocultarMontosServicio && hayServicio;
  const sinColumnasMonto = sinMontos && d.items.every((it) => it.kind === 'servicio');
  const montoDe = (it: VentaItem) => op.ocultarMontosServicio && it.kind === 'servicio';
  const logo1 = logoUri(op.logo);
  const logo2 = logoUri(op.logo2);
  const esFactura = d.docKind === 'factura';
  const titulo = esFactura ? 'FACTURA' : 'NOTA DE ENTREGA';
  const sello = esFactura ? NAVY : '#B45309';

  const filas = d.items.map((it, i) => `
    <tr>
      <td class="c mut">${i + 1}</td>
      <td>
        <div class="nm">${esc(it.name)}</div>
        ${it.kind === 'servicio' && op.ocultarIdServicio ? '' : `<div class="tag">${it.kind === 'servicio' ? '🧰 Servicio' : '📦 Material'}</div>`}
        ${/* A QUÉ MÁQUINA se le hizo (23-sep-2026). Va en el papel: un servicio de
              maquinaria sin decir a cuál máquina fue es lo que después no se puede
              cobrar ni reclamar. El nombre viene CONGELADO en el renglón. */''}
        ${it.maquina ? `<div class="tag">🚜 ${esc(it.maquina)}${it.maquina_serial ? ` · Serial ${esc(it.maquina_serial)}` : ''}${it.maquina_placa ? ` · Placa ${esc(it.maquina_placa)}` : ''}</div>` : ''}
      </td>
      <td class="c">${qty(it.qty)}</td>
      <td class="c mut">${esc(unidadImpresa(it, op))}</td>
      ${sinColumnasMonto ? '' : `<td class="r">${montoDe(it) ? '' : usd(it.price)}</td>
      <td class="r b">${montoDe(it) ? '' : usd(lineaTotal(it))}</td>`}
    </tr>`).join('');

  const ivaFila = d.conIva
    ? `<tr><td class="lbl">IVA (${qty(d.ivaPct)}%)</td><td class="val">${usd(d.ivaMonto)}</td></tr>`
    : `<tr><td class="lbl mut">Exento de IVA</td><td class="val mut">—</td></tr>`;

  const pago = d.condicion === 'credito'
    ? `<span class="pill cred">CRÉDITO · genera cuenta por cobrar</span>`
    : `<span class="pill cont">CONTADO · ${esc(metodoLabel(d.metodo))}</span>`;

  const datosCliente = [
    d.cliente.documento ? `<div><b>C.I. / RIF:</b> ${esc(d.cliente.documento)}</div>` : '',
    d.cliente.telefono ? `<div><b>Teléfono:</b> ${esc(d.cliente.telefono)}</div>` : '',
    d.cliente.email ? `<div><b>Correo:</b> ${esc(d.cliente.email)}</div>` : '',
    d.cliente.direccion ? `<div><b>Dirección:</b> ${esc(d.cliente.direccion)}</div>` : '',
  ].join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title></title><style>
  @page{size:letter;margin:12mm 11mm}
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#1a1c20;margin:0;font-size:12px}

  .head{display:flex;align-items:flex-start;gap:14px;border-bottom:3px solid ${NAVY};padding-bottom:10px}
  .head img{height:62px;width:auto}
  .head img.l2{height:54px;margin-left:4px}
  .co{flex:1}
  .co h1{margin:0;font-size:19px;color:${NAVY};letter-spacing:-.2px}
  .co .sub{color:#64748B;font-size:11px;margin-top:2px}
  /* Sello del tipo de documento: que nadie confunda una NOTA con una FACTURA. */
  .stamp{text-align:right;min-width:170px}
  .stamp .kind{display:inline-block;border:2px solid ${sello};color:${sello};border-radius:8px;
    padding:5px 12px;font-weight:900;font-size:15px;letter-spacing:1px}
  .stamp .num{font-size:20px;font-weight:900;color:${sello};margin-top:5px;font-variant-numeric:tabular-nums}
  .stamp .fec{color:#64748B;font-size:11px;margin-top:2px}

  .cli{margin-top:12px;border:1px solid #E2E8F0;border-radius:8px;padding:9px 11px;background:#F8FAFC}
  .cli .t{font-size:10px;font-weight:800;color:#64748B;letter-spacing:.6px;text-transform:uppercase}
  .cli .n{font-size:15px;font-weight:900;color:${NAVY};margin:1px 0 3px}
  .cli div{font-size:11.5px;line-height:1.5;color:#334155}

  table.it{border-collapse:collapse;width:100%;margin-top:12px;font-size:11.5px}
  table.it th{background:${NAVY};color:#fff;padding:7px 8px;text-align:left;font-size:10.5px;
    letter-spacing:.4px;text-transform:uppercase}
  table.it td{border-bottom:1px solid #E2E8F0;padding:7px 8px;vertical-align:top}
  table.it tr:nth-child(even) td{background:#F8FAFC}
  .c{text-align:center}.r{text-align:right}.b{font-weight:800}
  .mut{color:#64748B}
  .nm{font-weight:700;color:#0F172A}
  .tag{font-size:9.5px;color:#64748B;margin-top:1px}
  td.r,th.r{font-variant-numeric:tabular-nums}

  .bot{display:flex;gap:14px;margin-top:12px;align-items:flex-start}
  .left{flex:1}
  .pill{display:inline-block;border-radius:999px;padding:5px 12px;font-weight:800;font-size:11px}
  .pill.cont{background:#DCFCE7;color:#166534}
  .pill.cred{background:#FEF3C7;color:#92400E}
  .nota{margin-top:8px;font-size:11px;color:#475569;border-left:3px solid #CBD5E1;padding-left:8px}

  table.tot{border-collapse:collapse;min-width:260px}
  table.tot td{padding:5px 10px;font-size:12px}
  table.tot td.lbl{color:#475569}
  table.tot td.val{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
  table.tot tr.grand td{background:${NAVY};color:#fff;font-size:15px;font-weight:900;padding:8px 10px}
  table.tot tr.bs td{background:#EAF1FB;color:${NAVY};font-weight:800}
  .tasa{font-size:10px;color:#64748B;text-align:right;margin-top:3px}

  .firmas{display:flex;gap:40px;margin-top:34px}
  .firma{flex:1;text-align:center}
  .firma .line{border-top:1px solid #94A3B8;margin-bottom:4px}
  .firma .lbl{font-size:10.5px;color:#64748B}

  .foot{margin-top:16px;border-top:1px solid #E2E8F0;padding-top:6px;text-align:center;
    color:#94A3B8;font-size:9.5px}
  </style></head><body>

    <div class="head">
      ${logo1 ? `<img src="${logo1}"/>` : ''}
      <div class="co">
        <h1>${esc(COMPANY_NAME)}</h1>
        <div class="sub">Documento de venta · ${esc(titulo.toLowerCase())}</div>
      </div>
      <div class="stamp">
        <div class="kind">${esc(titulo)}</div>
        <div class="num">${esc(d.numero)}</div>
        <div class="fec">${esc(d.fecha)}${d.codigo ? ` · ${esc(d.codigo)}` : ''}</div>
      </div>
      ${logo2 ? `<img class="l2" src="${logo2}"/>` : ''}
    </div>

    <div class="cli">
      <div class="t">Cliente</div>
      <div class="n">${esc(d.cliente.nombre)}</div>
      ${datosCliente}
    </div>

    <table class="it">
      <thead><tr>
        <th class="c" style="width:26px">#</th>
        <th>Descripción</th>
        <th class="c" style="width:56px">Cant.</th>
        <th class="c" style="width:56px">Unidad</th>
        ${sinColumnasMonto ? '' : `<th class="r" style="width:86px">Precio</th>
        <th class="r" style="width:92px">Total</th>`}
      </tr></thead>
      <tbody>${filas || `<tr><td colspan="${sinColumnasMonto ? 4 : 6}" class="c mut">Sin renglones.</td></tr>`}</tbody>
    </table>

    <div class="bot">
      <div class="left">
        ${pago}
        ${d.nota ? `<div class="nota">${esc(d.nota)}</div>` : ''}
      </div>
      ${sinMontos ? '' : `<div>
        <table class="tot">
          <tr><td class="lbl">Subtotal</td><td class="val">${usd(d.subtotal)}</td></tr>
          ${ivaFila}
          <tr class="grand"><td>TOTAL</td><td class="val">${usd(d.total)}</td></tr>
          <tr class="bs"><td>Equivalente</td><td class="val">${bs(d.totalBs)}</td></tr>
        </table>
        <div class="tasa">${d.tasaBs > 0 ? `Tasa BCV: ${bs(d.tasaBs)} / $` : 'Sin tasa BCV registrada'}</div>
      </div>`}
    </div>

    <div class="firmas">
      <div class="firma"><div class="line"></div><div class="lbl">Entregado por${d.vendedor ? ` · ${esc(d.vendedor)}` : ''}</div></div>
      <div class="firma"><div class="line"></div><div class="lbl">Recibido conforme (nombre, C.I. y firma)</div></div>
    </div>

    <div class="foot">
      ${esc(COMPANY_NAME)} · ${esc(titulo)} ${esc(d.numero)}
      ${esFactura ? '' : ' · Este documento ampara la entrega de la mercancía/servicio detallado.'}
    </div>
  </body></html>`;
}
