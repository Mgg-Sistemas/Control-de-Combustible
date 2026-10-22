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
// 📷 Las fotos se piden REDUCIDAS (21-oct-2026, reporte: «la ficha técnica no
//    me sale, está lenta»): una foto de equipo de 6 MB tardaba 13 s y la vista
//    previa no imprime hasta que llegan. `imgPapel` pide la misma foto por el
//    transformador del Storage y, si eso falla, cae sola a la original.
import { imgPapel } from './fotoRemota';

const esc = (v: any): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Número en formato venezolano, sin ceros de relleno: «70,8», «9.430». */
const num = (v: number, dec = 2): string =>
  (Math.round(v * 10 ** dec) / 10 ** dec).toLocaleString('es-VE', { maximumFractionDigits: dec });

export type FichaRenglon = {
  id: string;
  categoria?: string; // 'Datos Generales', 'Componentes Principales', etc.
  etiqueta: string;
  valor: string;
};

export type FichaMetrica = {
  id: string;
  titulo: string;
  subtitulo?: string;
  valor: string;
};

export type FichaObservacion = {
  id: string;
  titulo: string;
  texto: string;
};

export type FichaFoto = {
  id: string;
  url: string;
  leyenda?: string;
};

export type FichaPersonalizada = {
  titulo?: string | null;         // Título principal en la cabecera (ej. "GRUPO ELECTRÓGENO DIESEL")
  subtitulo?: string | null;      // Metadatos en línea (ej. "Marca: METRO | Motor: Cummins...")
  badgeSuperior?: string | null;  // Badge dorado arriba a la derecha (ej. "350 kVA")
  subcodigo?: string | null;      // Subcódigo / modelo (ej. "MODELO: MXGA350-1DY")
  seccionTitulo?: string | null;  // Título de la sección de especificaciones
  seccionTag?: string | null;     // Tag / enlace lateral (ej. "Placa de Identificación")
  metricas?: FichaMetrica[];      // Tarjetas métricas superiores destacadas
  renglones?: FichaRenglon[];     // Renglones de especificaciones adicionales o editados
  observaciones?: FichaObservacion[]; // Cuadros de texto / observaciones con borde dorado
  fotosExtra?: FichaFoto[];       // Fotos adicionales con sus leyendas
};

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
  /** Personalización interactiva: títulos, métricas, campos y observaciones añadidas */
  personalizada?: FichaPersonalizada | null;
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
// informe técnico) con sus celestes de apoyo y detalles dorados modernos.
const NAVY = '#16324F';
const CELESTE = '#EAF1FB';
const BORDE = '#D7E3F4';
const GOLD = '#EAB308'; // dorado/ámbar sobrio para destacar el badge y las notas técnicas

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
 * Página 1: cabecera estilo ficha técnica industrial, tarjetas métricas clave,
 * especificaciones estructuradas en columnas, observaciones con borde dorado y
 * fotos del equipo.
 * Página 2 (si hay foto de placa o anexo): anexo fotográfico de certificación.
 */
export function fichaTecnicaMaquinaHtml(m: MaquinaFichaTecnica, op: OpcionesFichaTecnica = {}): string {
  const p = op.personalizada;
  const nombre = nombreDeMaquina(m);
  const subtituloAuto = String(m.clasificacion ?? '').trim() || String(m.tipo ?? '').trim()
    || String(op.fallbackSubtitulo ?? '').trim() || 'Maquinaria pesada';
  const subtituloFinal = p?.subtitulo ? p.subtitulo : subtituloAuto;
  const tituloFinal = p?.titulo ? p.titulo : 'FICHA TÉCNICA';
  const badgeFinal = p?.badgeSuperior ? p.badgeSuperior : nombre;
  const subcodigoHtml = p?.subcodigo ? `<div class="subcode">${esc(p.subcodigo)}</div>` : '';

  const empresa = String(m.companyName ?? '').trim();
  const rif = String(m.companyRif ?? '').trim();
  const horas = m.last_horometro != null ? `${num(Number(m.last_horometro), 1)} h` : null;
  const proximo = proximoServicioTexto(m);
  const estado = String(op.estado ?? '').trim();

  // Las tarjetas del estado / métricas automáticas
  const tarjetasAuto = [
    horas ? { t: 'HORAS DE TRABAJO ACUMULADAS', v: horas } : null,
    estado ? { t: 'ESTADO ACTUAL', v: estado } : null,
    proximo ? { t: 'PRÓXIMO SERVICIO (250 H)', v: proximo } : null,
  ].filter(Boolean) as { t: string; v: string }[];

  let tarjetasHtml = '';
  if (p?.metricas && p.metricas.length > 0) {
    tarjetasHtml = `<div class="cards">${p.metricas.map((c) =>
      `<div class="card">
        <div class="cv">${esc(c.valor)}</div>
        <div class="ct">${esc(c.titulo)}</div>
        ${c.subtitulo ? `<div class="cs">${esc(c.subtitulo)}</div>` : ''}
      </div>`
    ).join('')}</div>`;
  } else if (tarjetasAuto.length) {
    tarjetasHtml = `<h2>Estado operativo actual</h2>
    <div class="cards">${tarjetasAuto.map((c) => `<div class="card"><div class="ct">${esc(c.t)}</div><div class="cv">${esc(c.v)}</div></div>`).join('')}</div>`;
  }

  // Especificaciones
  const secTitle = p?.seccionTitulo ? esc(p.seccionTitulo) : 'Especificaciones técnicas principales';
  const secTagHtml = p?.seccionTag ? `<span class="sec-tag">${esc(p.seccionTag)}</span>` : '';

  let specsHtml = '';
  if (p?.renglones && p.renglones.length > 0) {
    // Si tienen categorías, dividirlas en columnas dobles estilo catálogo técnico
    const catsMap = new Map<string, FichaRenglon[]>();
    p.renglones.forEach((r) => {
      const c = r.categoria?.trim() || 'Especificaciones';
      const arr = catsMap.get(c) ?? [];
      arr.push(r);
      catsMap.set(c, arr);
    });

    if (catsMap.size > 1) {
      specsHtml = `<div class="specs-dual">${Array.from(catsMap.entries()).map(([cat, items]) => `
        <div class="specs-col">
          <div class="specs-col-hdr">${esc(cat)}</div>
          <table class="ft"><tbody>
            ${items.map((r) => `<tr><td class="k">${esc(r.etiqueta)}</td><td>${esc(r.valor)}</td></tr>`).join('')}
          </tbody></table>
        </div>
      `).join('')}</div>`;
    } else {
      specsHtml = `<table class="ft"><tbody>
        ${p.renglones.map((r) => `<tr><td class="k">${esc(r.etiqueta)}</td><td>${esc(r.valor)}</td></tr>`).join('')}
      </tbody></table>`;
    }
  } else {
    const filasAuto = kv([
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
    specsHtml = filasAuto
      ? `<table class="ft"><tbody>${filasAuto}</tbody></table>`
      : '<div class="vacia">Esta máquina no tiene características cargadas en el catálogo todavía.</div>';
  }

  // Observaciones y cuadros de texto con borde dorado lateral
  let obsHtml = '';
  if (p?.observaciones && p.observaciones.length > 0) {
    obsHtml = `
      <div class="sec-hd">
        <div class="sec-title">OBSERVACIONES Y CONDICIONES TÉCNICAS</div>
      </div>
      ${p.observaciones.map((o) => `
        <div class="obs-box">
          ${o.titulo ? `<div class="obs-title">${esc(o.titulo)}</div>` : ''}
          <div class="obs-body">${esc(o.texto)}</div>
        </div>
      `).join('')}
    `;
  }

  // Fotos extras añadidas
  let fotosExtraHtml = '';
  if (p?.fotosExtra && p.fotosExtra.length > 0) {
    const imgExtra = imgPapel;
    fotosExtraHtml = `
      <div class="sec-hd">
        <div class="sec-title">REGISTRO FOTOGRÁFICO DE COMPONENTES</div>
      </div>
      <div class="foto-grid">
        ${p.fotosExtra.map((f) => `
          <div class="foto-card">
            ${imgExtra(f.url)}
            ${f.leyenda ? `<div class="foto-cap">${esc(f.leyenda)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  const pie = op.emitidoPor || op.fecha
    ? `<div class="pie">Ficha generada${op.fecha ? ` el ${esc(dmy(op.fecha))}` : ''}${op.emitidoPor ? ` por ${esc(op.emitidoPor)}` : ''} desde el Catálogo de maquinaria. Los datos son los cargados en el sistema.</div>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title></title><style>
  @page{size:letter;margin:10mm 12mm}
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#1a1c20;margin:0;font-size:11px;line-height:1.4}

  .hd{background:${NAVY};color:#fff;border-radius:8px;padding:14px 18px;display:flex;
    align-items:center;justify-content:space-between;gap:14px}
  .hd-left{flex:1;min-width:0}
  .hd .t{color:#fff;font-size:22px;font-weight:900;letter-spacing:.5px;line-height:1.15}
  .hd .s{color:#AFC4DB;font-size:11.5px;margin-top:3px;font-weight:500}
  .hd-right{text-align:right;flex:none}
  .hd .badge{background:${GOLD};color:${NAVY};font-weight:900;font-size:14px;
    padding:6px 14px;border-radius:6px;white-space:nowrap;display:inline-block;box-shadow:0 2px 4px rgba(0,0,0,0.18)}
  .hd .subcode{color:#CBD5E1;font-size:10px;font-weight:800;letter-spacing:.8px;margin-top:4px}

  .sec-hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid ${NAVY};padding-bottom:4px;margin:14px 0 8px;page-break-after:avoid}
  .sec-title{font-size:12px;font-weight:900;color:${NAVY};text-transform:uppercase;letter-spacing:.4px}
  .sec-tag{font-size:10.5px;font-weight:700;color:#2563EB}

  h2{font-size:12px;color:${NAVY};margin:14px 0 6px;padding-bottom:3px;
    border-bottom:2px solid ${NAVY};text-transform:uppercase;letter-spacing:.4px;page-break-after:avoid}

  .cards{display:flex;gap:8px;margin:10px 0 12px;flex-wrap:wrap}
  .card{flex:1;min-width:105px;background:#F8FAFC;border:1px solid ${BORDE};border-top:3px solid ${NAVY};
    border-radius:6px;padding:8px 10px;text-align:center}
  .card .ct{font-size:8.5px;font-weight:800;letter-spacing:.3px;color:#47617D;text-transform:uppercase}
  .card .cv{font-size:15px;font-weight:900;color:${NAVY};margin-top:2px}
  .card .cs{font-size:8px;color:#64748B;margin-top:1px}

  .specs-dual{display:flex;gap:12px;margin-bottom:10px}
  .specs-col{flex:1;min-width:0}
  .specs-col-hdr{background:${CELESTE};color:${NAVY};font-size:10.5px;font-weight:800;padding:5px 8px;border:1px solid ${BORDE};border-bottom:none;border-radius:4px 4px 0 0}

  table{border-collapse:collapse;width:100%}
  table.ft td{border:1px solid ${BORDE};padding:6px 9px;vertical-align:top;font-size:11px}
  table.ft td.k{background:${CELESTE};color:#334155;width:40%;font-weight:700}
  table.ft tr:nth-child(even) td:not(.k){background:#F8FAFC}

  .obs-box{background:#FFFFFF;border:1px solid #E2E8F0;border-left:4px solid ${GOLD};border-radius:6px;padding:8px 12px;margin:8px 0;page-break-inside:avoid}
  .obs-title{font-size:11px;font-weight:800;color:${NAVY};margin-bottom:3px}
  .obs-body{font-size:10.5px;color:#334155;line-height:1.45;white-space:pre-wrap}

  .foto-grid{display:flex;gap:10px;margin:8px 0;page-break-inside:avoid;flex-wrap:wrap}
  .foto-card{flex:1;min-width:200px;border:1px solid ${BORDE};border-radius:6px;overflow:hidden;background:#FAFBFD;text-align:center}
  .foto-card img{max-width:100%;max-height:220px;object-fit:cover;display:block;margin:0 auto}
  .foto-cap{padding:4px 8px;font-size:9.5px;font-weight:600;color:#475569;background:#F1F5F9;border-top:1px solid #E2E8F0}

  .foto{margin-top:12px;text-align:center;page-break-inside:avoid}
  .foto img{max-width:100%;max-height:300px;border-radius:6px;border:1px solid ${BORDE}}
  .foto .cap{color:#6B7280;font-size:10px;margin-top:4px}

  .vacia{border:1px dashed #CBD5E1;border-radius:6px;padding:12px;text-align:center;color:#64748B;font-size:11px}
  .anexo{page-break-before:always}
  .anexo .hd .t{font-size:18px}
  .pie{color:#9CA3AF;font-size:9px;margin-top:12px;text-align:center}
  </style></head><body>

  <div class="hd">
    <div class="hd-left">
      <div class="t">${esc(tituloFinal)}</div>
      <div class="s">${esc(subtituloFinal)}</div>
    </div>
    <div class="hd-right">
      <div class="badge">${esc(badgeFinal)}</div>
      ${subcodigoHtml}
    </div>
  </div>

  ${tarjetasHtml}

  <div class="sec-hd">
    <div class="sec-title">${secTitle}</div>
    ${secTagHtml}
  </div>
  ${specsHtml}

  ${obsHtml}

  ${m.photo_url ? `<div class="foto">
    ${imgPapel(m.photo_url)}
    <div class="cap">Registro visual de la condición exterior del equipo en terreno</div>
  </div>` : ''}

  ${fotosExtraHtml}

  ${m.photo_serial_url || m.fotoHorometroUrl ? `<div class="anexo">
    <div class="hd">
      <div>
        <div class="t">ANEXO · REGISTRO FOTOGRÁFICO</div>
        <div class="s">${esc(nombre)}${m.code ? ` · ${esc(m.code)}` : ''}</div>
      </div>
    </div>
    ${m.photo_serial_url ? `<div class="foto">
      ${imgPapel(m.photo_serial_url)}
      <div class="cap">Detalle de la placa de identificación (serial / placa) del equipo</div>
    </div>` : ''}
    ${m.fotoHorometroUrl ? `<div class="foto">
      ${imgPapel(m.fotoHorometroUrl)}
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

