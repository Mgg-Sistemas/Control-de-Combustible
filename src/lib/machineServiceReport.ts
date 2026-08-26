// ============================================================================
// REPORTE DE SERVICIOS DE MAQUINARIA (PDF).
//
// Reproduce el documento que trajo el cliente («Ficha técnica Jumbo con martillo
// 0488», Golden Touch 1127 C.A.): la ficha técnica de la máquina en la primera
// página, y sus reparaciones a partir de la segunda.
//
// ⭐ CADA REPARACIÓN ES UNA HOJA DEL FORMULARIO (25-ago-2026). Antes salían como
//    tarjetitas resumidas —una línea con el nombre, unas píldoras con los tipos y
//    dos renglones de texto—. Ahora cada una se imprime con la MISMA forma que la
//    hoja de papel que llena el taller: franja azul con el título, los cuatro
//    datos de cabecera (fecha · operador/técnico · equipo · serial), las CASILLAS
//    de tipo de intervención, y los tres recuadros (problema · acciones ·
//    repuestos), con sus dos firmas al pie. Así el PDF y el papel se pueden poner
//    uno al lado del otro.
//
// ⚠️ LAS CASILLAS SE IMPRIMEN TODAS, marcadas y sin marcar — es lo que las hace
//    una casilla y no una etiqueta. Por eso el reporte necesita saber el CATÁLOGO
//    completo (`tiposIntervencion`), no solo lo que el servicio marcó. Un tipo
//    marcado que ya no está en el catálogo (lo desactivaron) igual sale, al final
//    y marcado: un servicio viejo no puede perder lo que dijo.
//
// ⚠️ EL CRUCE ES POR **CLAVE**, NUNCA POR EL NOMBRE VISIBLE. La primera versión
//    comparaba textos en minúsculas y se caía de cuatro maneras distintas, todas
//    alcanzables desde el modal de «⚙️ Tipos de intervención»:
//      · «Aire Acondicionado» (nombre) nunca cruzaba con `aire_acondicionado`
//        (clave), así que la casilla marcada salía SIN marcar y aparecía una
//        segunda casilla, cruda y marcada;
//      · dos tipos que solo difieren en mayúsculas se marcaban LOS DOS —falso
//        positivo en un papel que se firma—;
//      · dos tipos con el mismo nombre salían como dos casillas repetidas
//        (`validarTipoIntervencion` exige clave única, no nombre único);
//      · «Mecanica» sin tilde no cruzaba con «Mecánica».
//    La clave es única por construcción y es lo que queda GUARDADO dentro de cada
//    servicio, así que es lo único con lo que se puede comparar sin equivocarse.
//
// Función PURA: recibe los datos ya cargados por la pantalla, no consulta
// Supabase. Mismo contrato que `hoseServiceReport.ts`.
//
// EL MODO LO DECIDE EL REPORTE, no un botón: si el filtro dejó UNA sola máquina
// imprime su ficha; si dejó varias, agrupa sin ficha — cuarenta fichas seguidas
// no le sirven a nadie.
//
// ⚠️ SIN DINERO: acá no se imprime ningún costo. El módulo no los lleva.
//
// Blindado por `scripts/test-servicio.mjs` (`npm run test:servicio`).
// ============================================================================
import { pdfDocument, exportPdf } from './pdf';
import { machineLabel, machineFileLabel, MaquinaIdentificable } from './machineLabel';
import { quienLoHizo, etiquetaIntervencion, INTERVENCIONES_POR_DEFECTO,
  TipoIntervencion, ServiceOrigen } from './machineService';

const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dmy = (iso?: string | null) => {
  const [y, m, d] = String(iso ?? '').split('T')[0].split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
};
const oDash = (v: any) => (v == null || v === '' ? '—' : String(v));

/** Lo que hace falta de la máquina para imprimir su ficha técnica. */
export type MaquinaFicha = MaquinaIdentificable & {
  tipo?: string | null; marca?: string | null; modelo?: string | null;
  photo_url?: string | null; companyName?: string | null; encargado?: string | null;
  oil_type?: string | null; oil_capacity_l?: number | null; oil_notes?: string | null;
  last_horometro?: number | null; horometro_base?: number | null;
};

/** Un trabajo, listo para imprimir. Sirve tanto a las órdenes nuevas como a los
 *  expedientes viejos de `machinery_repairs`, que traen menos datos. */
export type ServicioImprimible = {
  id: string;
  service_date: string;
  origen: ServiceOrigen;
  technician?: string | null;
  provider?: string | null;
  /** Las CLAVES tal como están guardadas (`mecanica`, `aire_acondicionado`…),
   *  NO los nombres visibles: la casilla se cruza por clave. */
  intervenciones?: string[] | null;
  problem?: string | null;
  work_done?: string | null;
  parts?: { quantity: number | null; description: string; estado: string | null }[];
  /** Texto de la avería que atiende, si la hay. */
  averia?: string | null;
  /** Expediente viejo de `machinery_repairs`: se marca como tal para que no
   *  parezca un formulario llenado a medias. */
  esRegistroAnterior?: boolean;
};

/** Estilos de LA FICHA sola. Se exportan aparte porque otros documentos la
 *  embeben (el Recibo de cobro de mangueras) y necesitan su CSS sin arrastrar
 *  el del resto del reporte de servicios. */
export const FICHA_CSS = `
  .sv-head{display:flex;gap:18px;align-items:center;margin:6px 0 4px}
  .sv-photo{width:150px;height:120px;object-fit:cover;border:3px solid #1E3A5F;border-radius:10px;background:#EEF2F7}
  .sv-name{font-size:22px;font-weight:800;color:#1E3A5F;line-height:1.1}
  .sv-sub{font-size:13px;color:#374151;font-weight:700;margin-top:3px}
  h3.sec{margin:16px 0 4px;font-size:13px;color:#1E3A5F;border-top:2px solid #1E3A5F;padding-top:8px}
  table.ft{width:100%;border-collapse:collapse;font-size:12px}
  table.ft td{border:1px solid #D7E3F4;padding:5px 9px;vertical-align:top}
  table.ft td.k{background:#EAF1FB;color:#374151;width:42%;font-weight:700}
  .corte{page-break-after:always}
`;

const CSS = FICHA_CSS + `
  /* ── LA HOJA ──────────────────────────────────────────────────────────────
     «page-break-inside:avoid» PIDE que no se parta entre dos páginas, y el motor
     lo cumple MIENTRAS LA HOJA QUEPA en una. En la práctica va UNA HOJA POR
     PÁGINA —igual que el formulario de papel, que también es de una página—.
     Con muchos repuestos la hoja se pasa de largo y el motor la parte igual;
     por eso «.firmas» lleva además «page-break-before:avoid», para que las dos
     rayas de firmar no terminen solas en una página en blanco.

     ⚠️ LAS MEDIDAS DE ACÁ ABAJO ESTÁN AJUSTADAS AL MILÍMETRO, NO LAS ENGORDES.
     Contado en PDFs de verdad: una carta con «@page{margin:2cm}» deja ~905px, y
     EL MEMBRETE (los dos logos, el título y la línea de empresa) se come ~190px
     — quedan ~715px para la hoja. Con los valores originales una hoja con UN
     SOLO REPUESTO ya medía ~790px y salía en DOS páginas. Cada punto que se le
     sume a los «min-height» o a los márgenes de acá empuja la hoja fuera de su
     página. Si tocas algo, vuelve a contar las páginas del PDF; no lo supongas. */
  .hoja{border:1px solid #D7E3F4;border-radius:10px;overflow:hidden;margin-bottom:16px;page-break-inside:avoid}
  .hoja-band{background:#2F4257;color:#fff;text-align:center;padding:8px 10px}
  .hb-t{font-size:16px;font-weight:800;letter-spacing:.4px;line-height:1.15}
  .hb-s{font-size:9.5px;color:#C3CEDC;letter-spacing:2.2px;margin-top:4px}
  .hoja-viejo{background:#FFFBEB;border-bottom:1px solid #FDE68A;color:#92400E;font-size:10px;font-weight:700;padding:5px 14px}
  .hoja-datos{display:flex;gap:14px;align-items:flex-start;padding:8px 14px 2px}
  .hoja-foto{width:104px;height:78px;object-fit:cover;border:2px solid #1E3A5F;border-radius:8px;background:#EEF2F7;flex:none}
  .campos{flex:1}
  .campo{display:flex;gap:8px;border-bottom:1px solid #E8EDF3;padding:5px 2px;font-size:12px}
  .campo .k{font-weight:800;color:#1E3A5F;white-space:nowrap}
  /* Sin «overflow-wrap» un serial largo sin espacios se sale de la hoja y, como
     «.hoja» recorta, NO LLEGA AL PAPEL — el mismo fallo que ya tenía «.caja». */
  .campo .v{color:#333;flex:1;min-width:0;overflow-wrap:anywhere;word-break:break-word}
  /* La banda gris con el filito azul, igual que en la hoja de papel. */
  .banda{background:#EEF2F7;border-left:4px solid #1E3A5F;color:#1E3A5F;font-size:11.5px;font-weight:800;letter-spacing:.5px;padding:5px 12px;margin:8px 14px 5px}
  .chks{display:flex;flex-wrap:wrap;gap:5px 22px;padding:0 16px 2px;font-size:12px}
  .chk{display:flex;gap:6px;align-items:flex-start;min-width:140px}
  /* La casilla se dibuja con un borde, no con el carácter ☐: no todas las
     fuentes de impresión lo traen y salía un cuadrito vacío o nada. */
  .bx{display:inline-block;width:12px;height:12px;line-height:11px;text-align:center;border:1.5px solid #1E3A5F;border-radius:2px;font-size:10px;font-weight:900;flex:none;margin-top:1px}
  .bx.on{background:#1E3A5F;color:#fff}
  /* ⚠️ «overflow-wrap:anywhere» NO ES COSMÉTICO: «.hoja» recorta lo que se sale
     («overflow:hidden»), así que sin esto una referencia larga sin espacios
     —«REF3PZ112088HIDRAULICO…», una URL, un serial pegado— se sale del recuadro
     y NO LLEGA AL PAPEL. No se ve mal: desaparece. */
  .caja{border:1px solid #D7E3F4;border-radius:8px;margin:0 14px;padding:7px 11px;min-height:38px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
  table.rep{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}
  table.rep th{background:#1E3A5F;color:#fff;padding:4px 7px;text-align:left}
  table.rep td{border:1px solid #D7E3F4;padding:4px 7px;overflow-wrap:anywhere;word-break:break-word}
  .firmas{display:flex;gap:56px;margin:20px 22px 10px;page-break-inside:avoid;page-break-before:avoid;break-before:avoid}
  .firmas div{flex:1;border-top:1px solid #333;padding-top:6px;text-align:center;font-size:11px;font-weight:700}
  .sin{border:1px dashed #D7E3F4;border-radius:8px;padding:12px;font-size:12px;color:#6B7280;margin-bottom:12px}
  .grupo{font-size:15px;font-weight:800;color:#1E3A5F;margin:14px 0 6px;border-bottom:2px solid #1E3A5F;page-break-after:avoid}
`;

/** Filas de una tabla clave/valor, saltando lo que viene vacío. */
function filas(pairs: [string, any][]): string {
  return pairs
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join('');
}

/** Opciones de la ficha cuando se EMBEBE en otro documento (recibo de cobro). */
export type FichaOpts = {
  /** ¿Corta la página después de la ficha? En el reporte de servicios sí (la ficha
   *  es la página 1); embebida en otro documento, no. Por defecto `true`. */
  corte?: boolean;
  /** Encabezado de la sección. Por defecto "FICHA TÉCNICA DE MAQUINARIA". */
  titulo?: string;
};

/**
 * Página 1: la ficha técnica de la máquina, como el documento del cliente.
 *
 * ⚠️ SIN LUBRICACIÓN NI HORÓMETRO (20-ago-2026, pedido del cliente sobre el PDF
 * real): en la flota esos dos bloques salían casi siempre vacíos ("SIN DATOS DE
 * LUBRICACIÓN — ") o con lecturas que no son del taller, y ocupaban media página
 * antes de las reparaciones, que es lo que se viene a leer. Los campos siguen
 * viviendo en la máquina y se siguen editando en Control de Maquinaria; lo único
 * que cambió es que ya no se IMPRIMEN acá.
 */
export function fichaTecnicaHtml(m: MaquinaFicha, opts: FichaOpts = {}): string {
  const { corte = true, titulo = 'FICHA TÉCNICA DE MAQUINARIA' } = opts;
  // ⚠️ `width`/`height` NO SON ADORNO — ver la nota larga en `servicioCardHtml`.
  const foto = m.photo_url
    ? `<img class="sv-photo" src="${esc(m.photo_url)}" width="150" height="120" alt=""/>`
    : '';
  const vacio = (k: string) => `<tr><td class="k">${k}</td><td>—</td></tr>`;
  return `<div${corte ? ' class="corte"' : ''}>
    <h3 class="sec">${esc(titulo)}</h3>
    <div class="sv-head">${foto}
      <div><div class="sv-name">${esc(machineLabel(m))}</div>
        <div class="sv-sub">${esc(m.companyName ?? '')}</div></div>
    </div>
    <h3 class="sec">🚜 Información general</h3>
    <table class="ft"><tbody>${filas([
      ['Tipo de equipo', m.tipo], ['Marca', m.marca], ['Modelo', m.modelo],
      ['Número de serial', m.serial], ['Placa', m.plate], ['Identificador', m.identifier],
      ['Empresa', m.companyName], ['Encargado', m.encargado],
    ]) || vacio('Sin datos')}</tbody></table>
  </div>`;
}

const limpio = (v: unknown): string => String(v ?? '').trim();

/** Un renglón de la cabecera: «Fecha: 18/08/2026». */
function campo(k: string, v: string): string {
  return `<div class="campo"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
}

/** Un recuadro con lo que escribió el taller. Se dibuja SIEMPRE, aunque venga
 *  vacío: en la hoja de papel el recuadro está para llenarlo a mano si hace
 *  falta, y una hoja a la que le faltan recuadros ya no es la misma hoja. */
function caja(html: string): string {
  return `<div class="caja">${html}</div>`;
}

/** Un tipo de intervención como lo necesita la casilla: su CLAVE (con la que se
 *  cruza) y su NOMBRE (el que se imprime). Es la forma que ya tiene
 *  `TipoIntervencion`, así que la pantalla pasa su catálogo tal cual. */
export type TipoParaCasilla = { key?: string | null; label?: string | null };

/**
 * Las casillas de «Tipo de intervención», TODAS: las marcadas y las que no.
 *
 * @param marcadas las CLAVES que guardó el servicio (`camion_viajes` no, esto es
 *        `machinery_service_orders.intervenciones`) — tal como están en la base.
 * @param tipos el catálogo ACTIVO, en su orden: es lo que dibuja las casillas y
 *        es el mismo que ve el formulario en pantalla.
 * @param conocidos TODOS los tipos, incluidos los desactivados. Solo sirve para
 *        ponerle NOMBRE a una clave marcada que ya no está en el catálogo.
 *
 * Lo que el servicio marcó y ya no está en el catálogo —un tipo que desactivaron
 * después— se agrega al final, marcado: el servicio viejo tiene que seguir
 * diciendo lo que dijo.
 *
 * Sin catálogo (nadie corrió `supabase/servicio_tipos_intervencion.sql`) salen
 * los cuatro de siempre, que son exactamente los de la hoja de papel.
 */
export function casillasIntervencionHtml(
  marcadas?: unknown[] | null,
  tipos?: TipoParaCasilla[] | null,
  conocidos?: TipoParaCasilla[] | null,
): string {
  // `etiquetaIntervencion` ya sabe la cadena de respaldo (catálogo → los cuatro
  // de siempre → la clave cruda) y NUNCA devuelve vacío. No se reimplementa acá.
  const nombreDe = (k: string) => etiquetaIntervencion(k, (conocidos ?? []) as TipoIntervencion[]);

  // ⚠️ `Array.isArray` y no `?? []`: si un jsonb llega como texto (o como null
  // dentro de un array), `.map` reventaría y el usuario solo vería «No se pudo
  // generar el PDF» sin saber por qué.
  const claves = (xs: unknown) => (Array.isArray(xs) ? xs : []);
  const marcadasKeys = new Set(claves(marcadas).map(limpio).filter(Boolean));

  // El catálogo, deduplicado POR CLAVE y en su orden. Se deduplica porque
  // `validarTipoIntervencion` exige clave única pero NO nombre único: dos tipos
  // llamados igual son legales y salían como dos casillas idénticas.
  const catalogo: { key: string; label: string }[] = [];
  const enCatalogo = new Set<string>();
  for (const t of claves(tipos) as TipoParaCasilla[]) {
    const key = limpio(t?.key);
    if (!key || enCatalogo.has(key)) continue;
    enCatalogo.add(key);
    catalogo.push({ key, label: limpio(t?.label) || nombreDe(key) });
  }
  if (!catalogo.length) {
    for (const t of INTERVENCIONES_POR_DEFECTO) {
      enCatalogo.add(t.key);
      catalogo.push({ key: t.key, label: t.label });
    }
  }

  // Las sobrantes: marcadas que el catálogo no tiene. Un `Set` ya las trae sin
  // repetir y en el orden en que se marcaron.
  const sobrantes = Array.from(marcadasKeys)
    .filter((k) => !enCatalogo.has(k))
    .map((k) => ({ key: k, label: nombreDe(k) }));

  return `<div class="chks">${[...catalogo, ...sobrantes].map(({ key, label }) => {
    const on = marcadasKeys.has(key);
    return `<span class="chk"><span class="bx${on ? ' on' : ''}">${on ? '✓' : ''}</span>${esc(label)}</span>`;
  }).join('')}</div>`;
}

/** Las dos líneas para firmar a mano, al pie de CADA hoja — como en el papel:
 *  cada intervención la firman el técnico que la hizo y su supervisor. */
const FIRMAS = `<div class="firmas"><div>Firma del Técnico</div><div>Firma Supervisor</div></div>`;

/**
 * Una reparación, con la forma de la hoja «Reporte de mantenimiento /
 * reparación» que llena el taller.
 *
 * @param m la máquina, para los renglones «Equipo» y «Código de Serial» y para
 *          su foto. Va en CADA hoja a propósito: cuando se imprime un rango con
 *          varias máquinas y después alguien separa los papeles, una hoja suelta
 *          tiene que poder decir de qué máquina es.
 * @param opts `tipos` (catálogo activo) y `conocidos` (todos, para nombrar un
 *        tipo desactivado). Ver `casillasIntervencionHtml`.
 */
export function servicioCardHtml(
  s: ServicioImprimible,
  m?: MaquinaFicha | null,
  opts: { tipos?: TipoParaCasilla[] | null; conocidos?: TipoParaCasilla[] | null } = {},
): string {
  // `limpio` y no la verdad cruda: un `photo_url` con solo espacios dejaba un
  // `<img src="   ">` roto, y ahora la foto va en CADA hoja — se repetiría N veces.
  const url = limpio(m?.photo_url);
  /**
   * ⭐ LA FOTO LLEVA MEDIDAS (26-ago-2026).
   *
   * ⚠️ EL PORQUÉ. Las fotos se guardan a 1600 px de lado (`photo.ts:69`) y acá
   *    se pintan a 104×78 (`.hoja-foto`, ver el CSS de arriba). Sin los
   *    atributos `width`/`height`, el navegador NO sabe qué tamaño va a ocupar
   *    la imagen hasta que la descarga, así que la maquetación de TODAS las
   *    hojas se queda esperando — y la vista previa aparece vacía o brincando.
   *    Con las medidas puestas, el hueco se reserva de una vez y el documento
   *    se arma completo aunque las fotos todavía vengan en camino.
   *
   * 🚫 AQUÍ IBA UN `decoding="async"` Y HUBO QUE QUITARLO EL MISMO DÍA.
   *    NO VOLVER A PONERLO. Ese atributo le da permiso EXPLÍCITO al navegador
   *    para pintar el cuadro SIN esperar a que la foto termine de decodificarse
   *    — justo lo contrario de lo que uno quiere al imprimir. En el PDF salían
   *    recuadros NEGROS (la foto a medio decodificar) y recuadros VACÍOS (sin
   *    decodificar todavía), mezclados con las que sí alcanzaron a salir. Lo
   *    reportó el taller con un PDF de 11 servicios donde 4 hojas salieron así.
   *    Ahorraba trabajo de decodificación a costa de imprimir mal: mal negocio.
   *
   *    La espera de las fotos se resuelve donde corresponde: el botón
   *    🖨️ Imprimir de `pdf.ts` no llama a `print()` hasta que todas cargaron.
   */
  const foto = url
    ? `<img class="hoja-foto" src="${esc(url)}" width="104" height="78" alt=""/>`
    : '';
  const modelo = [limpio(m?.marca), limpio(m?.modelo)].filter(Boolean).join(' ');
  const equipo = [machineLabel(m ?? null), modelo].filter(Boolean).join(' · ');

  // `.filter(Boolean)`: un null dentro de `parts` tumbaba la exportación entera
  // con un TypeError que la pantalla mostraba como «No se pudo generar el PDF».
  const partes = (Array.isArray(s.parts) ? s.parts : []).filter(Boolean);
  const reps = partes.length
    ? `<table class="rep"><thead><tr><th>Cant.</th><th>Descripción del repuesto / insumo</th><th>Estado</th></tr></thead><tbody>${
        partes.map((p) =>
          `<tr><td>${esc(oDash(p.quantity))}</td><td>${esc(p.description)}</td><td>${esc(oDash(p.estado))}</td></tr>`
        ).join('')}</tbody></table>`
    : '';

  return `<div class="hoja">
    <div class="hoja-band">
      <div class="hb-t">Reporte de mantenimiento / reparación</div>
      <div class="hb-s">Maquinaria pesada</div>
    </div>
    ${s.esRegistroAnterior
      ? '<div class="hoja-viejo">⚠️ Registro anterior del taller — se guardó antes de este formulario, por eso trae menos datos.</div>'
      : ''}
    <div class="hoja-datos">${foto}
      <div class="campos">
        ${campo('Fecha:', dmy(s.service_date))}
        ${campo('Operador / Técnico:', quienLoHizo(s))}
        ${campo('Equipo (ID / Modelo):', oDash(equipo))}
        ${campo('Código de Serial:', oDash(limpio(m?.serial)))}
        ${s.averia ? campo('Avería que atiende:', s.averia) : ''}
      </div>
    </div>
    <div class="banda">Tipo de intervención</div>
    ${casillasIntervencionHtml(s.intervenciones, opts.tipos, opts.conocidos)}
    <div class="banda">Descripción del problema</div>
    ${caja(esc(limpio(s.problem)))}
    <div class="banda">Acciones realizadas</div>
    ${caja(esc(limpio(s.work_done)))}
    <div class="banda">Repuestos utilizados</div>
    ${caja(reps)}
    ${FIRMAS}
  </div>`;
}

export type ReportOpts = {
  maquinas: { m: MaquinaFicha; servicios: ServicioImprimible[] }[];
  desde?: string; hasta?: string;
  /** El catálogo ACTIVO de tipos de intervención, en su orden, para dibujar
   *  TODAS las casillas. Si no viene, salen los cuatro de siempre. */
  tiposIntervencion?: TipoParaCasilla[] | null;
  /** TODOS los tipos, incluidos los desactivados: solo para ponerle nombre a una
   *  clave marcada que ya salió del catálogo. */
  tiposConocidos?: TipoParaCasilla[] | null;
};

/** El documento completo. PURA — devuelve el HTML, no imprime nada. */
export function buildMachineServiceReportHtml(opts: ReportOpts): string {
  const { maquinas, desde, hasta, tiposIntervencion, tiposConocidos } = opts;
  const unaSola = maquinas.length === 1;   // ← acá se decide el modo
  const rango = desde && hasta ? `${dmy(desde)} — ${dmy(hasta)}` : '';

  const cuerpo = maquinas.map(({ m, servicios }) => {
    const lista = servicios.length
      ? servicios.map((s) => servicioCardHtml(s, m, { tipos: tiposIntervencion, conocidos: tiposConocidos })).join('')
      : '<div class="sin">Sin servicios registrados en el período.</div>';
    return unaSola
      ? fichaTecnicaHtml(m) + `<h3 class="sec">🔧 Reparaciones${rango ? ` · ${esc(rango)}` : ''}</h3>` + lista
      : `<div class="grupo">${esc(machineLabel(m))}</div>` + lista;
  }).join('');

  const total = maquinas.reduce((a, x) => a + x.servicios.length, 0);
  return pdfDocument({
    title: unaSola ? 'Ficha técnica y reparaciones' : 'Reparaciones de maquinaria',
    subtitle: `${total} servicio(s)${rango ? ` · ${rango}` : ''}`,
    // Las firmas ya NO van al final del documento: cada hoja trae las suyas,
    // porque cada intervención se firma por separado (igual que en el papel).
    body: cuerpo,
    extraCss: CSS,
  });
}

/**
 * ⚠️ SOLO PARA EL DOCUMENTO DE UNA HOJA: acá la hoja SÍ se puede partir.
 *
 * En el reporte grande «page-break-inside:avoid» evita que una hoja quede a
 * caballo entre dos páginas, y está bien. Pero en un documento de UNA sola hoja
 * esa misma regla se vuelve en contra: si la hoja no cabe debajo del membrete
 * —que se come ~190px de los ~905px de la carta—, el motor la empuja ENTERA a
 * la página 2 y deja la 1 con el membrete y nada más. Dejándola fluir, la hoja
 * arranca en la página 1 y a la 2 pasa solo lo que sobre; y las firmas siguen
 * pegadas a lo anterior por su propio «page-break-before:avoid».
 */
const HOJA_SUELTA_CSS = `
  .hoja{page-break-inside:auto}
`;

/**
 * UNA SOLA HOJA: el papel de ESA reparación y nada más.
 *
 * ⭐ POR QUÉ EXISTE (25-ago-2026, queja del taller). «Exportar PDF» saca todo lo
 *    que haya en el filtro, y los filtros de fecha arrancan VACÍOS: quien
 *    registraba un servicio de prueba recibía un PDF con ese, con el que ya
 *    tenía montado y con los expedientes viejos del taller, todo junto. Lo que
 *    pidieron fue poder sacar «nada más el del servicio».
 *
 * Sin ficha técnica a propósito: la hoja ya lleva la foto de la máquina, el
 * equipo con su placa y el código de serial. La ficha sería una segunda página
 * repitiendo lo mismo, y lo que se pidió fue UN documento, no dos páginas.
 */
export function buildServicioHojaHtml(opts: {
  m: MaquinaFicha;
  servicio: ServicioImprimible;
  tiposIntervencion?: TipoParaCasilla[] | null;
  tiposConocidos?: TipoParaCasilla[] | null;
}): string {
  const { m, servicio, tiposIntervencion, tiposConocidos } = opts;
  return pdfDocument({
    // ⚠️ «Hoja de servicio» y NO «Reporte de mantenimiento / reparación»: ese
    //    nombre ya lo lleva la franja de la hoja, tres centímetros más abajo.
    //    Puesto en los dos sitios salía repetido y encima partía el título en
    //    dos líneas.
    title: 'Hoja de servicio',
    // ⚠️ `esc()` OBLIGATORIO: `pdfDocument` interpola el subtítulo CRUDO
    //    (src/lib/pdf.ts), y acá adentro va el nombre/placa/serial de la
    //    máquina, que un humano escribe en Control de Maquinaria. En web la
    //    vista previa se pinta con `document.write` sobre un iframe DEL MISMO
    //    ORIGEN, así que un `<script>` en el nombre de una máquina se ejecutaría
    //    en el origen de la app. Y sin llegar a tanto: un `&` o un `<` sueltos
    //    rompen el encabezado del papel que se firma.
    subtitle: esc(`${machineLabel(m)} · ${dmy(servicio.service_date)}`),
    body: servicioCardHtml(servicio, m, { tipos: tiposIntervencion, conocidos: tiposConocidos }),
    extraCss: CSS + HOJA_SUELTA_CSS,
  });
}

/** Genera y exporta la hoja de UN servicio. @returns true si el usuario confirmó. */
export async function generateServicioHojaPdf(
  opts: Parameters<typeof buildServicioHojaHtml>[0]
): Promise<boolean> {
  // El nombre lleva máquina Y fecha: si no, dos hojas de la misma máquina se
  // pisan en la carpeta de descargas y se pierde la primera.
  const fecha = String(opts.servicio.service_date ?? '').slice(0, 10);
  return exportPdf(buildServicioHojaHtml(opts), `Servicio - ${machineFileLabel(opts.m)}${fecha ? ` - ${fecha}` : ''}`);
}

/** Genera y exporta el PDF. @returns true si el usuario confirmó (imprimió/guardó). */
export async function generateMachineServiceReport(opts: ReportOpts): Promise<boolean> {
  // El nombre del archivo lleva placa o serial: tres máquinas se llaman
  // RETROEXCAVADORA y sus PDF se pisaban entre sí.
  const nombre = opts.maquinas.length === 1
    ? `Servicios - ${machineFileLabel(opts.maquinas[0].m)}`
    : 'Reparaciones de maquinaria';
  return exportPdf(buildMachineServiceReportHtml(opts), nombre);
}
