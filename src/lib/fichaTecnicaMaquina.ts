// ============================================================================
// 📄 FICHA TÉCNICA DE UNA MÁQUINA — el documento del Catálogo.
//
// Reproduce el formato que trajo el cliente («FICHA TÉCNICA — Trituradora de
// Mandíbula Móvil XCMG XPE0912», 28-sep-2026): cabecera con el título grande y
// la insignia del equipo, las tarjetas de ESTADO OPERATIVO ACTUAL, la tabla de
// ESPECIFICACIONES TÉCNICAS PRINCIPALES, la foto del equipo en terreno y, en
// página aparte, el ANEXO fotográfico con la foto de la placa/serial — pero con
// LOS COLORES DEL SISTEMA (el azul marino de todos los reportes, pedido de la
// misma tarde), no el negro/ámbar del documento de ejemplo.
//
// Sirve para MAQUINARIA y para VEHÍCULOS: el tipo de entrada es el mismo y lo
// que un vehículo no tiene (horómetro, aceite) simplemente no sale.
//
// TODO ESTE ARCHIVO ES PURO: no toca Supabase ni React. La pantalla del
// Catálogo (`EquiposScreen`) trae la máquina ya cargada y acá solo se imprime —
// así `scripts/test-ficha-tecnica-maquina.mjs` lo prueba sin base de datos.
//
// ⚠️ LO VACÍO NO SALE. La ficha del ejemplo tiene renglones (peso, dimensiones)
//    que muchas máquinas del catálogo no tienen cargados: un renglón sin dato
//    se OMITE, no se imprime «—» ni se inventa. La ficha de una máquina a la
//    que solo se le sabe marca, serial y foto sale corta pero honesta.
// ============================================================================
import { dmy, INTERVALO_PM_HORAS } from './informeTecnico';

const esc = (v: any): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Número en formato venezolano, sin ceros de relleno: «70,8», «9.430». */
const num = (v: number, dec = 2): string =>
  (Math.round(v * 10 ** dec) / 10 ** dec).toLocaleString('es-VE', { maximumFractionDigits: dec });

/** Lo que la ficha necesita de la máquina. Todo opcional a propósito: lo que
 *  falte simplemente no se imprime. */
export type MaquinaFichaTecnica = {
  code?: string | null;
  marca?: string | null; modelo?: string | null; tipo?: string | null;
  clasificacion?: string | null;
  serial?: string | null; plate?: string | null; identifier?: string | null;
  photo_url?: string | null; photo_serial_url?: string | null;
  companyName?: string | null; companyRif?: string | null;
  encargado?: string | null; zona?: string | null; grupo?: string | null;
  weight_ton?: number | null;
  length_m?: number | null; width_m?: number | null; height_m?: number | null;
  oil_type?: string | null; oil_capacity_l?: number | null; oil_notes?: string | null;
  con_tapa?: boolean | null; tapa_doble?: boolean | null;
  expected_lph?: number | null; daily_consumption_l?: number | null;
  last_horometro?: number | null; horometro_base?: number | null;
  entry_date?: string | null;
  // Campos de VEHÍCULO (la misma ficha sirve para los dos):
  tank_capacity_l?: number | null;
  expected_kml?: number | null;
  // La ÚLTIMA foto del horómetro subida (la busca la pantalla en las lecturas,
  // las fotos adicionales y el cierre de jornada). Sin foto, el anexo no la trae.
  fotoHorometroUrl?: string | null;
  fotoHorometroLeyenda?: string | null;
};

export type OpcionesFichaTecnica = {
  /** Estado en vivo, lo pone la pantalla («Operativa», «Averiada…»). */
  estado?: string | null;
  /** Pie: quién la emitió y cuándo (AAAA-MM-DD). Vacíos = sin pie. */
  emitidoPor?: string | null;
  fecha?: string | null;
  /** Subtítulo cuando el equipo no tiene clasificación: «Maquinaria pesada»
   *  (default) o «Vehículo». */
  fallbackSubtitulo?: string | null;
};

/** «XCMG · XPE0912», o el tipo histórico combinado, o el código. Es el nombre
 *  grande de la insignia de la cabecera. */
export function nombreDeMaquina(m: MaquinaFichaTecnica): string {
  const marca = String(m.marca ?? '').trim();
  const modelo = String(m.modelo ?? '').trim();
  if (marca || modelo) return [marca, modelo].filter(Boolean).join(' · ');
  return String(m.tipo ?? '').trim() || String(m.code ?? '').trim() || 'Equipo';
}

/** «70,8 t (70.830 kg)». Null si no hay peso cargado. */
export function pesoTexto(m: MaquinaFichaTecnica): string | null {
  const t = m.weight_ton;
  if (t == null || !isFinite(Number(t)) || Number(t) <= 0) return null;
  return `${num(Number(t), 2)} t (${num(Number(t) * 1000, 0)} kg)`;
}

/** «L 9,43 m × An 0,60 m × Al 2,95 m» — solo con las medidas que existan.
 *  Null si no hay ninguna. */
export function dimensionesTexto(m: MaquinaFichaTecnica): string | null {
  const partes: string[] = [];
  if (m.length_m != null && Number(m.length_m) > 0) partes.push(`L ${num(Number(m.length_m))} m`);
  if (m.width_m != null && Number(m.width_m) > 0) partes.push(`An ${num(Number(m.width_m))} m`);
  if (m.height_m != null && Number(m.height_m) > 0) partes.push(`Al ${num(Number(m.height_m))} m`);
  return partes.length ? partes.join(' × ') : null;
}

/** «Doble» / «Sencilla» / null (sin dato no se imprime el renglón). */
export function tapaTexto(m: MaquinaFichaTecnica): string | null {
  if (m.con_tapa == null) return null;
  if (!m.con_tapa) return 'Sin tapa';
  return m.tapa_doble ? 'Con tapa doble' : 'Con tapa sencilla';
}

/** «15W-40 · 25 L» o solo lo que haya. Null sin nada. */
export function aceiteTexto(m: MaquinaFichaTecnica): string | null {
  const tipo = String(m.oil_type ?? '').trim();
  const cant = m.oil_capacity_l != null && Number(m.oil_capacity_l) > 0
    ? `${num(Number(m.oil_capacity_l))} L` : '';
  const partes = [tipo, cant].filter(Boolean);
  return partes.length ? partes.join(' · ') : null;
}

/** El horómetro del próximo servicio: base del último mantenimiento + 250 h
 *  (mismo intervalo de las alertas). Null sin lecturas. */
export function proximoServicioTexto(m: MaquinaFichaTecnica): string | null {
  if (m.last_horometro == null) return null;
  const base = m.horometro_base != null ? Number(m.horometro_base) : Number(m.last_horometro);
  return `${num(base + INTERVALO_PM_HORAS, 1)} h`;
}

// LOS COLORES DEL SISTEMA: el mismo azul marino de todos los reportes (pdf.ts,
// informe técnico) con sus celestes de apoyo — no el negro/ámbar del ejemplo.
const NAVY = '#16324F';
const CELESTE = '#EAF1FB';
const BORDE = '#D7E3F4';

/** Filas clave/valor de la tabla de especificaciones, saltando lo vacío. */
function kv(pairs: [string, any][]): string {
  return pairs
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('');
}

/**
 * HTML imprimible de la ficha, listo para `exportPdf`. Carta.
 *
 * Página 1: cabecera, estado operativo, especificaciones y la foto del equipo.
 * Página 2 (solo si hay foto de placa/serial): el anexo fotográfico, como el
 * documento del cliente.
 */
export function fichaTecnicaMaquinaHtml(m: MaquinaFichaTecnica, op: OpcionesFichaTecnica = {}): string {
  const nombre = nombreDeMaquina(m);
  const subtitulo = String(m.clasificacion ?? '').trim() || String(m.tipo ?? '').trim()
    || String(op.fallbackSubtitulo ?? '').trim() || 'Maquinaria pesada';
  const empresa = String(m.companyName ?? '').trim();
  const rif = String(m.companyRif ?? '').trim();
  const horas = m.last_horometro != null ? `${num(Number(m.last_horometro), 1)} h` : null;
  const proximo = proximoServicioTexto(m);
  const estado = String(op.estado ?? '').trim();

  // Las tarjetas del estado: solo salen las que tienen dato.
  const tarjetas = [
    horas ? { t: 'HORAS DE TRABAJO ACUMULADAS', v: horas } : null,
    estado ? { t: 'ESTADO ACTUAL', v: estado } : null,
    proximo ? { t: 'PRÓXIMO SERVICIO (250 H)', v: proximo } : null,
  ].filter(Boolean) as { t: string; v: string }[];

  const filas = kv([
    ['Fabricante / marca', m.marca],
    ['Modelo', m.modelo],
    ['Código en el sistema', m.code],
    ['Clasificación', m.clasificacion],
    ['Número de identificación (serial / PIN)', m.serial],
    ['Placa', m.plate],
    ['Identificador', m.identifier],
    ['Peso operativo', pesoTexto(m)],
    ['Dimensiones (L × An × Al)', dimensionesTexto(m)],
    ['Empresa supervisora', empresa ? `${empresa}${rif ? ` (RIF: ${rif})` : ''}` : null],
    ['Encargado', m.encargado],
    ['A disposición de', m.zona],
    ['Grupo', m.grupo],
    ['Aceite del motor', aceiteTexto(m)],
    ['Nota de lubricación', m.oil_notes],
    ['Tapa', tapaTexto(m)],
    ['Rendimiento esperado', m.expected_lph != null && Number(m.expected_lph) > 0 ? `${num(Number(m.expected_lph))} L/h` : null],
    ['Rendimiento esperado (km/L)', m.expected_kml != null && Number(m.expected_kml) > 0 ? `${num(Number(m.expected_kml))} km/L` : null],
    ['Capacidad del tanque', m.tank_capacity_l != null && Number(m.tank_capacity_l) > 0 ? `${num(Number(m.tank_capacity_l))} L` : null],
    ['Consumo diario de combustible', m.daily_consumption_l != null && Number(m.daily_consumption_l) > 0 ? `${num(Number(m.daily_consumption_l))} L` : null],
    ['Fecha de ingreso al sistema', m.entry_date ? dmy(m.entry_date) : null],
  ]);

  const pie = op.emitidoPor || op.fecha
    ? `<div class="pie">Ficha generada${op.fecha ? ` el ${esc(dmy(op.fecha))}` : ''}${op.emitidoPor ? ` por ${esc(op.emitidoPor)}` : ''} desde el Catálogo de maquinaria. Los datos son los cargados en el sistema.</div>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title></title><style>
  @page{size:letter;margin:12mm 12mm}
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#1a1c20;margin:0;font-size:11.5px;line-height:1.45}

  .hd{background:${NAVY};color:#fff;border-radius:10px;padding:16px 18px;display:flex;
    align-items:center;justify-content:space-between;gap:14px}
  .hd .t{color:#fff;font-size:26px;font-weight:900;letter-spacing:.5px}
  .hd .s{color:#AFC4DB;font-size:12px;margin-top:2px}
  .hd .badge{background:${CELESTE};color:${NAVY};font-weight:900;font-size:13px;
    padding:7px 14px;border-radius:8px;white-space:nowrap}

  h2{font-size:13px;color:${NAVY};margin:16px 0 8px;padding-bottom:4px;
    border-bottom:3px solid ${NAVY};text-transform:uppercase;letter-spacing:.4px;page-break-after:avoid}

  .cards{display:flex;gap:10px}
  .card{flex:1;background:${CELESTE};border:1px solid ${BORDE};border-left:4px solid ${NAVY};
    border-radius:8px;padding:10px 12px;text-align:center}
  .card .ct{font-size:9.5px;font-weight:800;letter-spacing:.4px;color:#47617D}
  .card .cv{font-size:17px;font-weight:900;color:${NAVY};margin-top:3px}

  table{border-collapse:collapse;width:100%}
  table.ft td{border:1px solid ${BORDE};padding:7px 11px;vertical-align:top;font-size:11.5px}
  table.ft td.k{background:${CELESTE};color:#334155;width:40%;font-weight:700}
  table.ft tr:nth-child(even) td:not(.k){background:#F8FAFC}

  .foto{margin-top:14px;text-align:center;page-break-inside:avoid}
  .foto img{max-width:100%;max-height:340px;border-radius:8px;border:1px solid ${BORDE}}
  .foto .cap{color:#6B7280;font-size:10px;margin-top:5px}

  .vacia{border:1px dashed #CBD5E1;border-radius:8px;padding:14px;text-align:center;
    color:#64748B;font-size:11.5px}

  .anexo{page-break-before:always}
  .anexo .hd .t{font-size:20px}
  .pie{color:#9CA3AF;font-size:9.5px;margin-top:14px;text-align:center}
  </style></head><body>

  <div class="hd">
    <div>
      <div class="t">FICHA TÉCNICA</div>
      <div class="s">${esc(subtitulo)}</div>
    </div>
    <div class="badge">${esc(nombre)}</div>
  </div>

  ${tarjetas.length ? `<h2>Estado operativo actual</h2>
  <div class="cards">${tarjetas.map((c) => `<div class="card"><div class="ct">${esc(c.t)}</div><div class="cv">${esc(c.v)}</div></div>`).join('')}</div>` : ''}

  <h2>Especificaciones técnicas principales</h2>
  ${filas ? `<table class="ft"><tbody>${filas}</tbody></table>`
    : '<div class="vacia">Esta máquina no tiene características cargadas en el catálogo todavía.</div>'}

  ${m.photo_url ? `<div class="foto">
    <img src="${esc(m.photo_url)}" alt=""/>
    <div class="cap">Registro visual de la condición exterior del equipo en terreno</div>
  </div>` : ''}

  ${m.photo_serial_url || m.fotoHorometroUrl ? `<div class="anexo">
    <div class="hd">
      <div>
        <div class="t">ANEXO · REGISTRO FOTOGRÁFICO</div>
        <div class="s">${esc(nombre)}${m.code ? ` · ${esc(m.code)}` : ''}</div>
      </div>
    </div>
    ${m.photo_serial_url ? `<div class="foto">
      <img src="${esc(m.photo_serial_url)}" alt=""/>
      <div class="cap">Detalle de la placa de identificación (serial / placa) del equipo</div>
    </div>` : ''}
    ${m.fotoHorometroUrl ? `<div class="foto">
      <img src="${esc(m.fotoHorometroUrl)}" alt=""/>
      <div class="cap">Última foto del horómetro subida${m.fotoHorometroLeyenda ? ` (${esc(m.fotoHorometroLeyenda)})` : ''}</div>
    </div>` : ''}
  </div>` : ''}

  ${pie}
  </body></html>`;
}

/** «Ficha tecnica JUMBO 320.pdf» — sin caracteres raros para el archivo. */
export function nombreArchivoFichaTecnica(m: MaquinaFichaTecnica): string {
  const base = String(m.code ?? '').trim() || nombreDeMaquina(m);
  const limpio = base.replace(/[^\w\s.-]/g, '').trim() || 'equipo';
  return `Ficha tecnica ${limpio}`;
}
