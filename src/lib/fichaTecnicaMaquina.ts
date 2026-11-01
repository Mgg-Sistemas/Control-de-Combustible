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
  leyenda?: string;        // Título de la foto, sale en negrita debajo (ej. «FILTRO DE AIRE»)
  descripcion?: string;    // Subtítulo explicativo opcional, debajo del título
};

/** 📎 Una sección del anexo fotográfico (01-nov-2026), como en la ficha hecha a
 *  mano: «1. VISTAS ESTRUCTURALES Y TREN DE RODAJE», «2. CABINA DE MANDO…».
 *  Cada sección empieza en página nueva, numerada, con sus fotos en 2 o 3
 *  columnas y cada foto con su título y su explicación. */
export type FichaAnexo = {
  id: string;
  titulo: string;
  subtitulo?: string | null;   // Texto explicativo de la sección, debajo del título
  columnas?: 2 | 3;
  fotos: FichaFoto[];
};

/** Títulos de sección del anexo que trae la ficha de referencia (para elegir rápido). */
export const SECCIONES_ANEXO_SUGERIDAS = [
  'Vistas estructurales y tren de rodaje',
  'Cabina de mando y panel de instrumentos',
  'Compartimento de motor, filtros y refrigeración',
  'Placa de identificación y horómetro',
];

export type FichaPersonalizada = {
  titulo?: string | null;         // Título principal en la cabecera (ej. "GRUPO ELECTRÓGENO DIESEL")
  subtitulo?: string | null;      // Metadatos en línea (ej. "Marca: METRO | Motor: Cummins...")
  badgeSuperior?: string | null;  // Badge dorado arriba a la derecha (ej. "350 kVA")
  subcodigo?: string | null;      // Subcódigo / modelo (ej. "MODELO: MXGA350-1DY")
  seccionTitulo?: string | null;  // Título de la sección de especificaciones
  seccionTag?: string | null;     // Tag / enlace lateral (ej. "Placa de Identificación")
  metricas?: FichaMetrica[];      // Tarjetas métricas superiores destacadas
  renglones?: FichaRenglon[];     // Renglones de especificaciones adicionales o editados
  renglonesOcultos?: string[];    // IDs de renglones del catálogo que el usuario ocultó/eliminó explícitamente
  observaciones?: FichaObservacion[]; // Cuadros de texto / observaciones con borde dorado
  fotosExtra?: FichaFoto[];       // Fotos adicionales con sus leyendas
  // 🖼️ Fotos de Vista General en Página 1 (garantizadas en la primera página):
  fotoPrincipalUrl?: string | null;       // Foto 1 (Vista Lateral o General)
  fotoPrincipalLeyenda?: string | null;   // Leyenda foto 1
  fotoSecundariaUrl?: string | null;      // Foto 2 (Vista Posterior o Frontal lado a lado)
  fotoSecundariaLeyenda?: string | null;  // Leyenda foto 2
  seccionFotosTitulo?: string | null;     // Título sección fotos P1 (ej. "VISTA GENERAL DEL EQUIPO")
  seccionFotosTag?: string | null;        // Tag lateral (ej. "Insonorizado Heavy-Duty")
  // 📐 Cómo sale la tabla de especificaciones en el PDF (01-nov-2026):
  //    'tabla'    → una sola tabla, en el orden del formulario (como las fichas
  //                 hechas a mano que trajo el equipo). Es lo que sale si no se dice.
  //    'columnas' → una columna por categoría (Datos Generales / Componentes…),
  //                 el diseño anterior, que sigue disponible.
  diseno?: 'tabla' | 'columnas';
  // 📝 Título del recuadro de observaciones (por defecto «OBSERVACIONES DE INSPECCIÓN»).
  seccionObsTitulo?: string | null;
  // 📎 Anexo fotográfico por secciones (ver FichaAnexo).
  anexos?: FichaAnexo[];
  // 📄 Texto del pie de cada página, a la izquierda (a la derecha va «Página X de Y»).
  //    null/undefined = «Ficha Técnica - <equipo>»; '' = sin pie.
  pieTexto?: string | null;
  // 🕒 Cuándo se guardó esta versión (ISO). Sirve para decidir entre la copia
  //    del teléfono y la de la nube: gana la más reciente, no «la más larga».
  actualizadoEn?: string | null;
};

// ── CAMPOS FIJOS DE LA FICHA (01-nov-2026) ─────────────────────────────────
// Pedido del equipo: los datos que SIEMPRE lleva una ficha técnica van ya
// puestos en el formulario, en el orden de las fichas de referencia hechas a
// mano (excavadora XCMG XE225BR y camión taller Sinotruk Howo), en vez de
// añadirlos uno a uno con «+ Añadir» (de ahí salían filas «Nuevo campo» vacías
// y columnas mal escritas). Lo que se sabe del catálogo viene precargado; lo
// demás se teclea. La etiqueta se puede cambiar (un camión dice «Configuración
// de Ejes» y una excavadora «Tren»). LO QUE QUEDE VACÍO NO SALE EN EL PDF.

/** Un campo fijo de la ficha. `equivalentes`: ids de renglones viejos que ya
 *  traen ese dato — si una ficha guardada los tiene, el campo fijo no se añade
 *  para no imprimir el mismo dato dos veces. */
export type CampoFijoFicha = {
  id: string;
  etiqueta: string;
  ayuda: string;
  equivalentes?: string[];
};

export const CAMPOS_FIJOS_FICHA: CampoFijoFicha[] = [
  { id: 'f-fabricante', etiqueta: 'Fabricante', ayuda: 'Ej. XCMG BRASIL INDÚSTRIA LTDA.', equivalentes: ['r-marca'] },
  { id: 'f-modelo-serie', etiqueta: 'Modelo / Serie', ayuda: 'Ej. XE225BR / XUG00225CTPA00246', equivalentes: ['r-modelo'] },
  { id: 'f-placa', etiqueta: 'Número de Placa / Identificación', ayuda: 'Ej. A30CV1J', equivalentes: ['r-placa'] },
  { id: 'f-tipo-combustible', etiqueta: 'Tipo / Combustible', ayuda: 'Ej. DIÉSEL / EXCAVADORA HIDRÁULICA SOBRE ORUGAS' },
  { id: 'f-anio', etiqueta: 'Año de Fabricación', ayuda: 'Ej. 2025-11 (Noviembre 2025)' },
  { id: 'f-ejes', etiqueta: 'Configuración de Ejes / Tren', ayuda: 'Ej. 4x2 (Eje sencillo posterior) u Orugas de servicio pesado' },
  { id: 'f-capacidad', etiqueta: 'Capacidad Nominal de Carga', ayuda: 'Ej. 22.040 kg (22,0 t) / Balde 1,2 m³' },
  { id: 'f-equipamiento', etiqueta: 'Equipamiento Integrado', ayuda: 'Ej. Motor 165 kW, cabina climatizada, cuchara para trabajo pesado' },
  { id: 'f-origen', etiqueta: 'País de Origen', ayuda: 'Ej. Brasil (Made in Brazil)' },
  { id: 'f-horometro', etiqueta: 'Horómetro', ayuda: 'Ej. 10,7 horas registradas' },
];

/** Las tres tarjetas de arriba de las fichas de referencia. */
export const METRICAS_FIJAS_FICHA: { id: string; titulo: string; ayuda: string }[] = [
  { id: 'm-horas', titulo: 'HORÓMETRO / KILOMETRAJE', ayuda: 'Ej. 10,7 h o 3000 KM' },
  { id: 'm-peso', titulo: 'CAPACIDAD / PESO OPERATIVO', ayuda: 'Ej. 22,0 TONELADAS' },
  { id: 'm-estado', titulo: 'ESTADO GENERAL', ayuda: 'Ej. OPERATIVO 100%' },
];

/** Los tres cuadros de «Observaciones de inspección» de las fichas de referencia. */
export const OBSERVACIONES_FIJAS_FICHA: { id: string; titulo: string; ayuda: string }[] = [
  { id: 'o-estado', titulo: 'Estado General', ayuda: 'Ej. Los datos del modelo y la placa fueron verificados con el registro fotográfico de la unidad.' },
  { id: 'o-componentes', titulo: 'Componentes', ayuda: 'Ej. Cabina, pluma, brazo, balde y tren de rodaje integrados y en condición operativa.' },
  { id: 'o-anexo', titulo: 'Anexo', ayuda: 'Ej. Consultar el registro fotográfico en las siguientes secciones del informe.' },
];

/**
 * Entre la copia del teléfono y la de la nube gana LA MÁS RECIENTE
 * (`actualizadoEn`), no «la lista más larga»: con la regla vieja un renglón
 * borrado en otro equipo volvía a aparecer. Si ninguna dice cuándo se guardó
 * (fichas de antes del 01-nov-2026), manda la nube. Las fotos tomadas en el
 * teléfono (dataURL) no suben a la nube, así que se conservan de la copia local.
 */
export function elegirFichaMasReciente(
  local: FichaPersonalizada | null,
  remoto: FichaPersonalizada | null
): FichaPersonalizada | null {
  if (!remoto) return local;
  if (!local) return remoto;
  const tLocal = Date.parse(String(local.actualizadoEn ?? '')) || 0;
  const tRemoto = Date.parse(String(remoto.actualizadoEn ?? '')) || 0;
  const base = tLocal > tRemoto ? local : remoto;
  return {
    ...base,
    fotoPrincipalUrl: base.fotoPrincipalUrl ?? local.fotoPrincipalUrl ?? null,
    fotoSecundariaUrl: base.fotoSecundariaUrl ?? local.fotoSecundariaUrl ?? null,
    fotosExtra: (base.fotosExtra && base.fotosExtra.length > 0) ? base.fotosExtra : (local.fotosExtra ?? []),
  };
}

/**
 * ↕ Pone los renglones en el orden de la ficha de referencia (01-nov-2026): los
 * campos fijos primero, en su orden, y cada renglón viejo equivalente en el
 * lugar de su campo (r-marca donde va Fabricante, r-modelo y r-serial donde va
 * Modelo / Serie, r-placa donde va la Placa). Lo demás queda después, en el
 * orden que tenía. No borra ni cambia ningún valor.
 */
export function ordenarRenglonesComoReferencia(renglones: FichaRenglon[]): FichaRenglon[] {
  const lugar = new Map<string, number>();
  CAMPOS_FIJOS_FICHA.forEach((c, i) => {
    lugar.set(c.id, i);
    (c.equivalentes ?? []).forEach((eq) => lugar.set(eq, i));
  });
  lugar.set('r-serial', CAMPOS_FIJOS_FICHA.findIndex((c) => c.id === 'f-modelo-serie') + 0.5);
  return (renglones ?? [])
    .map((r, idx) => ({ r, idx, pos: lugar.has(r.id) ? lugar.get(r.id)! : 1000 + idx }))
    .sort((a, b) => a.pos - b.pos || a.idx - b.idx)
    .map((x) => x.r);
}

/** Quita lo que no debe subir a la nube: fotos que solo existen en el teléfono
 *  (dataURL), también dentro de las secciones del anexo. */
export function limpiarFichaParaNube(data: FichaPersonalizada): FichaPersonalizada {
  const esDataUrl = (u?: string | null) => typeof u === 'string' && u.startsWith('data:');
  return {
    ...data,
    fotoPrincipalUrl: esDataUrl(data.fotoPrincipalUrl) ? undefined : data.fotoPrincipalUrl,
    fotoSecundariaUrl: esDataUrl(data.fotoSecundariaUrl) ? undefined : data.fotoSecundariaUrl,
    fotosExtra: (data.fotosExtra ?? []).filter((f) => !esDataUrl(f.url)),
    ...(data.anexos
      ? { anexos: data.anexos.map((a) => ({ ...a, fotos: (a.fotos ?? []).filter((f) => !esDataUrl(f.url)) })) }
      : {}),
  };
}

/** El texto de ayuda (placeholder) de un campo, métrica u observación fija. */
export function ayudaCampoFicha(id: string): string | null {
  return CAMPOS_FIJOS_FICHA.find((c) => c.id === id)?.ayuda
    ?? METRICAS_FIJAS_FICHA.find((c) => c.id === id)?.ayuda
    ?? OBSERVACIONES_FIJAS_FICHA.find((c) => c.id === id)?.ayuda
    ?? null;
}

/** Vacío para el PDF: nada escrito, o solo el «—» que antes se ponía de relleno. */
export function vacioEnFicha(v: unknown): boolean {
  const t = String(v ?? '').trim();
  return t === '' || t === '—' || t === '-';
}

/** «✅ Operativa» → «OPERATIVA». El estado en vivo trae su emoji delante. */
export function estadoSinEmoji(estado: string | null | undefined): string {
  return String(estado ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

/** Los campos fijos con lo que el catálogo ya sabe de la máquina (vacío si no). */
export function camposFijosDeMaquina(m: MaquinaFichaTecnica): FichaRenglon[] {
  const marca = String(m.marca ?? '').trim();
  const modelo = String(m.modelo ?? '').trim();
  const serial = String(m.serial ?? '').trim();
  const placa = String(m.plate ?? '').trim() || String(m.identifier ?? '').trim();
  const horas = m.last_horometro != null ? `${num(Number(m.last_horometro), 1)} h` : '';
  const precargado: Record<string, string> = {
    'f-fabricante': marca,
    'f-modelo-serie': [modelo, serial].filter(Boolean).join(' / '),
    'f-placa': placa,
    'f-horometro': horas,
  };
  return CAMPOS_FIJOS_FICHA.map((c) => ({
    id: c.id,
    categoria: 'Datos Generales',
    etiqueta: c.etiqueta,
    valor: precargado[c.id] ?? '',
  }));
}

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

  // Lo vacío no sale: una tarjeta sin valor no se imprime (01-nov-2026).
  const metricasValidas = (p?.metricas ?? []).filter((c) => c && !vacioEnFicha(c.valor));
  let tarjetasHtml = '';
  if (p?.metricas && p.metricas.length > 0) {
    // Título arriba y valor grande debajo, como la ficha de referencia (01-nov-2026).
    tarjetasHtml = metricasValidas.length === 0 ? '' : `<div class="cards">${metricasValidas.map((c) =>
      `<div class="card">
        <div class="ct">${esc(c.titulo)}</div>
        ${c.subtitulo ? `<div class="cs">${esc(c.subtitulo)}</div>` : ''}
        <div class="cv">${esc(c.valor)}</div>
      </div>`
    ).join('')}</div>`;
  } else if (tarjetasAuto.length) {
    tarjetasHtml = `<h2>Estado operativo actual</h2>
    <div class="cards">${tarjetasAuto.map((c) => `<div class="card"><div class="ct">${esc(c.t)}</div><div class="cv">${esc(c.v)}</div></div>`).join('')}</div>`;
  }

  // Especificaciones
  // Como la ficha de referencia: una franja celeste con el título y, entre
  // paréntesis, la etiqueta («… PRINCIPALES (PLACA DE IDENTIFICACIÓN)»).
  const secTitle = p?.seccionTitulo ? esc(p.seccionTitulo) : 'Especificaciones técnicas principales';
  const secTagHtml = p?.seccionTag ? `<span class="sec-tag">(${esc(p.seccionTag)})</span>` : '';

  let specsHtml = '';
  // Lo vacío no sale (01-nov-2026): un renglón sin valor no se imprime, aunque
  // tenga etiqueta. Así los campos fijos que no se llenaron y las filas
  // «Nuevo campo» vacías no aparecen como «—» en el papel.
  const renglonesValidos = (p?.renglones ?? []).filter((r) => r && !vacioEnFicha(r.valor));
  if (p?.renglones && p.renglones.length > 0 && renglonesValidos.length === 0) {
    specsHtml = '<div class="vacia">Esta ficha todavía no tiene especificaciones llenas.</div>';
  } else if (renglonesValidos.length > 0) {
    // Si tienen categorías, dividirlas en columnas dobles estilo catálogo técnico
    const catsMap = new Map<string, FichaRenglon[]>();
    renglonesValidos.forEach((r) => {
      const c = String(r.categoria ?? '').trim() || 'Componentes Principales';
      const arr = catsMap.get(c) ?? [];
      arr.push(r);
      catsMap.set(c, arr);
    });

    // Las columnas por categoría solo si la ficha las pide; por defecto, una
    // sola tabla en el orden del formulario, como las fichas de referencia.
    if (p?.diseno === 'columnas' && catsMap.size > 1) {
      specsHtml = `<div class="specs-dual">${Array.from(catsMap.entries()).map(([cat, items]) => `
        <div class="specs-col">
          <div class="specs-col-hdr">${esc(cat)}</div>
          <table class="ft"><tbody>
            ${items.map((r) => `<tr><td class="k">${esc(String(r.etiqueta ?? '').trim() || '—')}</td><td>${esc(String(r.valor ?? '').trim() || '—')}</td></tr>`).join('')}
          </tbody></table>
        </div>
      `).join('')}</div>`;
    } else {
      specsHtml = `<table class="ft"><tbody>
        ${renglonesValidos.map((r) => `<tr><td class="k">${esc(String(r.etiqueta ?? '').trim() || '—')}</td><td>${esc(String(r.valor ?? '').trim() || '—')}</td></tr>`).join('')}
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

  // Observaciones: como la ficha de referencia (01-nov-2026), UN recuadro en la
  // primera página, debajo de las especificaciones, con un párrafo por
  // observación: «**Estado General:** texto». Lo vacío no sale.
  let obsHtml = '';
  const obsValidas = (p?.observaciones ?? []).filter((o) => o && !vacioEnFicha(o.texto));
  if (obsValidas.length > 0) {
    const obsTitulo = String(p?.seccionObsTitulo ?? '').trim() || 'OBSERVACIONES DE INSPECCIÓN';
    obsHtml = `
      <div class="sec-hd">
        <div class="sec-title">${esc(obsTitulo)}</div>
      </div>
      <div class="obs-box">
        ${obsValidas.map((o) => `<p class="obs-p">${o.titulo ? `<b>${esc(o.titulo)}:</b> ` : ''}${esc(o.texto)}</p>`).join('')}
      </div>
    `;
  }

  // ── FOTOS DE VISTA GENERAL (PÁGINA 1) ─────────────────────────────────────
  // La foto 1 es:
  // 1) p?.fotoPrincipalUrl (si el usuario la asignó o cambió en la personalización)
  // 2) m.photo_url (la foto que ya tiene cargada la máquina o vehículo en el catálogo)
  // 3) La primera foto de fotosExtra (si el usuario subió fotos en el modal)
  const foto1 = p?.fotoPrincipalUrl || m.photo_url || (p?.fotosExtra && p.fotosExtra[0]?.url) || null;
  // En una ficha personalizada la leyenda es la que se escribió: vacía = sin
  // leyenda (la foto de la ficha de referencia va sola, a todo lo ancho).
  const leyenda1 = p && p.fotoPrincipalLeyenda !== undefined
    ? String(p.fotoPrincipalLeyenda ?? '').trim()
    : (p?.fotoPrincipalUrl ? 'Registro visual de la condición exterior del equipo en terreno'
      : (m.photo_url ? 'Registro visual de la condición exterior del equipo en terreno'
        : (p?.fotosExtra && p.fotosExtra[0]?.leyenda) || 'Registro visual del equipo'));

  // La foto 2 (para vista dual lado a lado como el documento del ejemplo Metro):
  // 1) p?.fotoSecundariaUrl (si el usuario la asignó)
  // 2) Si foto1 fue p?.fotoPrincipalUrl o m.photo_url, la foto 2 puede ser p?.fotosExtra[0]
  // 3) Si foto1 fue p?.fotosExtra[0], la foto 2 puede ser p?.fotosExtra[1]
  let foto2: string | null = null;
  let leyenda2 = 'Vista complementaria del equipo';

  if (p?.fotoSecundariaUrl) {
    foto2 = p.fotoSecundariaUrl;
    leyenda2 = p.fotoSecundariaLeyenda || 'Vista complementaria del equipo';
  } else if (p?.fotosExtra && p.fotosExtra.length > 0) {
    if (foto1 === m.photo_url || foto1 === p?.fotoPrincipalUrl) {
      foto2 = p.fotosExtra[0]?.url || null;
      leyenda2 = p.fotosExtra[0]?.leyenda || 'Vista complementaria del equipo';
    } else if (p.fotosExtra.length > 1) {
      foto2 = p.fotosExtra[1]?.url || null;
      leyenda2 = p.fotosExtra[1]?.leyenda || 'Vista complementaria del equipo';
    }
  }

  // Fotos de componentes para Página 2 (cualquier foto extra que no se haya usado en Página 1)
  const fotosUsadasP1 = new Set([foto1, foto2].filter(Boolean));
  const fotosComponentes = (p?.fotosExtra ?? []).filter((f) => !fotosUsadasP1.has(f.url));

  // El título de la sección de fotos: en una ficha personalizada, vacío = sin
  // franja (la ficha de referencia pone la foto sola, debajo de las observaciones).
  const secFotosTituloTxt = p && p.seccionFotosTitulo !== undefined
    ? String(p.seccionFotosTitulo ?? '').trim()
    : 'VISTA GENERAL DEL EQUIPO';
  const secFotosTagHtml = p?.seccionFotosTag ? `<span class="sec-tag">(${esc(p.seccionFotosTag)})</span>` : '';
  const secFotosHd = secFotosTituloTxt
    ? `<div class="sec-hd"><div class="sec-title">${esc(secFotosTituloTxt)}</div>${secFotosTagHtml}</div>`
    : '';
  const capHtml = (t: string) => (t ? `<div class="foto-p1-cap">${esc(t)}</div>` : '');

  const imgVista = imgPapel;
  let vistaGeneralHtml = '';
  if (foto1 && foto2) {
    vistaGeneralHtml = `
      ${secFotosHd}
      <div class="fotos-p1-grid">
        <div class="foto-p1-col">
          ${imgPapel(foto1)}
          ${capHtml(leyenda1)}
        </div>
        <div class="foto-p1-col">
          ${imgVista(foto2)}
          ${capHtml(leyenda2)}
        </div>
      </div>
    `;
  } else if (foto1) {
    vistaGeneralHtml = `
      ${secFotosHd}
      <div class="foto-p1-single">
        ${imgVista(foto1)}
        ${capHtml(leyenda1)}
      </div>
    `;
  }

  // ── ANEXO FOTOGRÁFICO POR SECCIONES (01-nov-2026) ─────────────────────────
  // Como la ficha de referencia: «1. VISTAS ESTRUCTURALES Y TREN DE RODAJE»,
  // «2. CABINA DE MANDO…», cada sección en página nueva, numerada, con sus
  // fotos en 2 o 3 columnas y cada foto con su título en negrita y, si se
  // escribió, su explicación debajo. Las fotos extra de antes (sin sección)
  // salen como una sección más, para no perderlas.
  const seccionesAnexo: FichaAnexo[] = (p?.anexos ?? [])
    .map((a) => ({ ...a, fotos: (a?.fotos ?? []).filter((f) => f && String(f.url ?? '').trim()) }))
    .filter((a) => a.fotos.length > 0);
  if (fotosComponentes.length > 0) {
    seccionesAnexo.push({
      id: 'fotos-extra',
      titulo: 'Registro fotográfico de componentes y detalles',
      columnas: 2,
      fotos: fotosComponentes,
    });
  }
  const imgAnexo = imgPapel; // misma foto reducida (alias, como imgVista)
  const anexosHtml = seccionesAnexo.map((a, i) => {
    const cols = a.columnas === 3 ? 3 : 2;
    return `
      <div class="anx-sec">
        <div class="sec-hd"><div class="sec-title">${i + 1}. ${esc(String(a.titulo ?? '').trim() || 'Registro fotográfico')}</div></div>
        ${String(a.subtitulo ?? '').trim() ? `<div class="anx-sub">${esc(a.subtitulo)}</div>` : ''}
        <div class="anx-grid c${cols}">
          ${a.fotos.map((f) => `
            <div class="anx-foto">
              ${imgAnexo(f.url)}
              ${String(f.leyenda ?? '').trim() ? `<div class="anx-cap">${esc(f.leyenda)}</div>` : ''}
              ${String(f.descripcion ?? '').trim() ? `<div class="anx-desc">${esc(f.descripcion)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  // La foto de la placa y la del horómetro del catálogo van al anexo automático,
  // salvo que el usuario ya las haya puesto en una sección (no se repiten).
  const urlsEnAnexo = new Set(seccionesAnexo.flatMap((a) => a.fotos.map((f) => f.url)));
  const fotoPlacaAuto = m.photo_serial_url && !urlsEnAnexo.has(m.photo_serial_url) ? m.photo_serial_url : null;
  const fotoHorometroAuto = m.fotoHorometroUrl && !urlsEnAnexo.has(m.fotoHorometroUrl) ? m.fotoHorometroUrl : null;

  // Pie de cada página (solo en la ficha personalizada): «Ficha Técnica - …» a
  // la izquierda y «Página X de Y» a la derecha, como la ficha de referencia.
  const cssStr = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3C ').replace(/\r?\n/g, ' ')}"`;
  const pieTexto = p ? (p.pieTexto == null ? `Ficha Técnica - ${nombre}` : String(p.pieTexto).trim()) : '';
  const pageCss = p
    ? `@page{size:letter;margin:10mm 12mm 14mm;
        ${pieTexto ? `@bottom-left{content:${cssStr(pieTexto)};font-family:Arial,Helvetica,sans-serif;font-size:8.5px;color:#64748B;border-top:1px solid ${BORDE}}` : ''}
        @bottom-right{content:"Página " counter(page) " de " counter(pages);font-family:Arial,Helvetica,sans-serif;font-size:8.5px;color:#64748B;border-top:1px solid ${BORDE}}}`
    : '@page{size:letter;margin:10mm 12mm}';

  const pie = op.emitidoPor || op.fecha
    ? `<div class="pie">Ficha generada${op.fecha ? ` el ${esc(dmy(op.fecha))}` : ''}${op.emitidoPor ? ` por ${esc(op.emitidoPor)}` : ''} desde el Catálogo de maquinaria. Los datos son los cargados en el sistema.</div>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title></title><style>
  ${pageCss}
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

  /* 01-nov-2026: franja celeste con el título, como la ficha de referencia */
  .sec-hd{display:flex;align-items:center;gap:6px;background:${CELESTE};border-radius:4px;padding:6px 12px;margin:14px 0 8px;page-break-after:avoid}
  .sec-title{font-size:11.5px;font-weight:900;color:${NAVY};text-transform:uppercase;letter-spacing:.3px}
  .sec-tag{font-size:11.5px;font-weight:900;color:${NAVY};text-transform:uppercase;letter-spacing:.3px}

  h2{font-size:12px;color:${NAVY};margin:14px 0 6px;padding-bottom:3px;
    border-bottom:2px solid ${NAVY};text-transform:uppercase;letter-spacing:.4px;page-break-after:avoid}

  .cards{display:flex;gap:8px;margin:10px 0 12px;flex-wrap:wrap}
  .card{flex:1;min-width:105px;background:#F8FAFC;border:1.5px solid ${BORDE};
    border-radius:4px;padding:8px 10px;text-align:center}
  .card .ct{font-size:8.5px;font-weight:800;letter-spacing:.3px;color:#64748B;text-transform:uppercase}
  .card .cv{font-size:15px;font-weight:900;color:#111827;margin-top:2px;text-transform:uppercase}
  .card .cs{font-size:8px;color:#64748B;margin-top:1px}

  .specs-dual{display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap}
  .specs-col{flex:1;min-width:240px}
  .specs-col-hdr{background:${CELESTE};color:${NAVY};font-size:10.5px;font-weight:800;padding:5px 8px;border:1px solid ${BORDE};border-bottom:none;border-radius:4px 4px 0 0}

  table{border-collapse:collapse;width:100%}
  /* 01-nov-2026: tabla limpia como la ficha de referencia: sin rejilla, filas alternas */
  table.ft td{padding:5px 12px;vertical-align:middle;font-size:10.5px;color:#334155}
  table.ft td.k{color:#111827;width:38%;font-weight:700}
  table.ft tr:nth-child(even) td{background:#F5F8FC}

  .fotos-p1-grid{display:flex;gap:10px;margin:8px 0;page-break-inside:avoid}
  .foto-p1-col{flex:1;min-width:0;border:1px solid ${BORDE};border-radius:6px;overflow:hidden;background:#FAFBFD;text-align:center}
  .foto-p1-col img{width:100%;height:165px;object-fit:cover;display:block;margin:0 auto}
  .foto-p1-single{border:1px solid ${BORDE};border-radius:4px;overflow:hidden;background:#FAFBFD;text-align:center;margin:10px 0;page-break-inside:avoid}
  .foto-p1-single img{width:100%;height:260px;object-fit:cover;display:block;margin:0 auto}
  .foto-p1-cap{padding:4px 8px;font-size:9.5px;font-weight:600;color:#475569;background:#F1F5F9;border-top:1px solid #E2E8F0}

  .obs-box{background:#FFFFFF;border:1.5px solid ${BORDE};border-radius:4px;padding:10px 14px;margin:8px 0;page-break-inside:avoid}
  .obs-title{font-size:11px;font-weight:800;color:${NAVY};margin-bottom:3px}
  .obs-body{font-size:10.5px;color:#334155;line-height:1.45;white-space:pre-wrap}
  .obs-p{margin:0 0 5px;font-size:10px;color:#1F2937;line-height:1.45;white-space:pre-wrap}
  .obs-p:last-child{margin-bottom:0}
  .obs-p b{color:#111827}

  /* 📎 Anexo fotográfico por secciones (01-nov-2026) */
  .anx-sec{page-break-before:always}
  .anx-sub{font-size:10px;color:#475569;margin:-2px 0 8px}
  .anx-grid{display:flex;flex-wrap:wrap;gap:10px}
  .anx-foto{page-break-inside:avoid;text-align:center}
  .anx-grid.c2 .anx-foto{width:calc(50% - 5px)}
  .anx-grid.c3 .anx-foto{width:calc(33.333% - 7px)}
  .anx-foto img{width:100%;object-fit:cover;display:block;border-radius:3px}
  .anx-grid.c2 .anx-foto img{height:290px}
  .anx-grid.c3 .anx-foto img{height:190px}
  .anx-cap{font-size:9px;font-weight:800;color:#111827;text-transform:uppercase;margin-top:5px;letter-spacing:.2px}
  .anx-desc{font-size:8.5px;color:#64748B;margin-top:2px}

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

  ${vistaGeneralHtml}

  ${anexosHtml}

  ${fotoPlacaAuto || fotoHorometroAuto ? `<div class="anexo">
    <div class="hd">
      <div>
        <div class="t">ANEXO · REGISTRO FOTOGRÁFICO</div>
        <div class="s">${esc(nombre)}${m.code ? ` · ${esc(m.code)}` : ''}</div>
      </div>
    </div>
    ${fotoPlacaAuto ? `<div class="foto">
      ${imgPapel(fotoPlacaAuto)}
      <div class="cap">Detalle de la placa de identificación (serial / placa) del equipo</div>
    </div>` : ''}
    ${fotoHorometroAuto ? `<div class="foto">
      ${imgPapel(fotoHorometroAuto)}
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

const CATEGORIAS_CONOCIDAS = new Set([
  'datos generales',
  'componentes principales',
  'especificaciones',
]);

/**
 * Construye un `FichaRenglon` a partir de lo que el usuario haya escrito en los campos
 * de nuevo renglón. Tolera cualquier combinación de llenado (por ejemplo si el usuario
 * escribió el nombre del campo en la casilla de categoría y el valor abajo, o escribió
 * "Motor: Cummins" en un solo campo). Devuelve `null` solo si todo está vacío.
 */
export function resolverNuevoRenglon(input: {
  categoriaSeleccionada?: string | null;
  categoria?: string | null;
  etiqueta?: string | null;
  valor?: string | null;
  id?: string;
}): FichaRenglon | null {
  const catSel = String(input.categoriaSeleccionada ?? '').trim() || 'Componentes Principales';
  const catTxt = String(input.categoria ?? '').trim();
  const etqTxt = String(input.etiqueta ?? '').trim();
  const valTxt = String(input.valor ?? '').trim();

  if (!catTxt && !etqTxt && !valTxt) return null;

  const id = input.id || `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Caso 1: etiqueta y valor llenos normalmente
  if (etqTxt && valTxt) {
    return {
      id,
      categoria: catTxt || catSel,
      etiqueta: etqTxt,
      valor: valTxt,
    };
  }

  // Caso 2: el usuario escribió en la 1ra casilla (catTxt) y en valor (valTxt), dejando etiqueta vacía
  if (catTxt && valTxt && !etqTxt) {
    return {
      id,
      categoria: CATEGORIAS_CONOCIDAS.has(catTxt.toLowerCase()) ? catTxt : catSel,
      etiqueta: catTxt,
      valor: valTxt,
    };
  }

  // Caso 3: el usuario escribió en la 1ra casilla (catTxt) y en la 2da (etqTxt), dejando valor vacío
  if (catTxt && etqTxt && !valTxt) {
    if (!CATEGORIAS_CONOCIDAS.has(catTxt.toLowerCase())) {
      return {
        id,
        categoria: catSel,
        etiqueta: catTxt,
        valor: etqTxt,
      };
    }
    const idx = etqTxt.indexOf(':');
    if (idx > 0) {
      return {
        id,
        categoria: catTxt,
        etiqueta: etqTxt.slice(0, idx).trim(),
        valor: etqTxt.slice(idx + 1).trim() || '—',
      };
    }
    return {
      id,
      categoria: catTxt,
      etiqueta: etqTxt,
      valor: '—',
    };
  }

  // Caso 4: solo llenó etiqueta (ej. "Motor: Cummins 6BT" o nombre del campo)
  if (etqTxt && !valTxt) {
    const idx = etqTxt.indexOf(':');
    if (idx > 0) {
      return {
        id,
        categoria: catTxt || catSel,
        etiqueta: etqTxt.slice(0, idx).trim(),
        valor: etqTxt.slice(idx + 1).trim() || '—',
      };
    }
    return {
      id,
      categoria: catTxt || catSel,
      etiqueta: etqTxt,
      valor: '—',
    };
  }

  // Caso 5: solo llenó valor
  if (valTxt && !etqTxt) {
    const idx = valTxt.indexOf(':');
    if (idx > 0) {
      return {
        id,
        categoria: catTxt || catSel,
        etiqueta: valTxt.slice(0, idx).trim(),
        valor: valTxt.slice(idx + 1).trim() || '—',
      };
    }
    return {
      id,
      categoria: catTxt || catSel,
      etiqueta: 'Especificación',
      valor: valTxt,
    };
  }

  return null;
}

/**
 * Vuelca cualquier dato que el usuario haya dejado escrito en los formularios de
 * "+ Agregar renglón", "+ Agregar métrica" o "+ Agregar observación" sin haber
 * pulsado el botón "Añadir" antes de pulsar "Guardar" o "Exportar PDF".
 */
export function aplicarPendientesFicha(
  data: FichaPersonalizada,
  pend: {
    categoriaSeleccionada?: string | null;
    nuevoCampoCat?: string | null;
    nuevoCampoEtq?: string | null;
    nuevoCampoVal?: string | null;
    nuevaMetricaTit?: string | null;
    nuevaMetricaSub?: string | null;
    nuevaMetricaVal?: string | null;
    nuevaObsTit?: string | null;
    nuevaObsTxt?: string | null;
  }
): {
  data: FichaPersonalizada;
  agregados: { renglon: boolean; metrica: boolean; observacion: boolean };
} {
  let renglones = [...(data.renglones ?? [])].filter(
    (r) => r && (String(r.etiqueta ?? '').trim().length > 0 || String(r.valor ?? '').trim().length > 0)
  );
  let metricas = [...(data.metricas ?? [])];
  let observaciones = [...(data.observaciones ?? [])];

  let agregoRenglon = false;
  let agregoMetrica = false;
  let agregoObs = false;

  const nuevoRenglon = resolverNuevoRenglon({
    categoriaSeleccionada: pend.categoriaSeleccionada,
    categoria: pend.nuevoCampoCat,
    etiqueta: pend.nuevoCampoEtq,
    valor: pend.nuevoCampoVal,
  });
  if (nuevoRenglon) {
    renglones.push(nuevoRenglon);
    agregoRenglon = true;
  }

  const mTit = String(pend.nuevaMetricaTit ?? '').trim();
  const mSub = String(pend.nuevaMetricaSub ?? '').trim();
  const mVal = String(pend.nuevaMetricaVal ?? '').trim();
  if (mTit || mVal) {
    metricas.push({
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      titulo: mTit || 'MÉTRICA',
      subtitulo: mSub || undefined,
      valor: mVal || '—',
    });
    agregoMetrica = true;
  }

  const oTit = String(pend.nuevaObsTit ?? '').trim();
  const oTxt = String(pend.nuevaObsTxt ?? '').trim();
  if (oTit || oTxt) {
    observaciones.push({
      id: `o-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      titulo: oTit || 'Observaciones Técnicas',
      texto: oTxt || oTit,
    });
    agregoObs = true;
  }

  return {
    data: {
      ...data,
      renglones,
      metricas,
      observaciones,
    },
    agregados: {
      renglon: agregoRenglon,
      metrica: agregoMetrica,
      observacion: agregoObs,
    },
  };
}

/**
 * Combina una ficha personalizada guardada previamente con los datos actuales del
 * catálogo de la máquina:
 * - Conserva TODOS los renglones personalizados que el usuario haya añadido o editado.
 * - Si en el catálogo de la máquina se cargaron campos nuevos (ej. peso, aceite, placa,
 *   dimensiones) que antes no estaban en `saved.renglones` y no fueron eliminados por
 *   el usuario (`renglonesOcultos`), los incorpora automáticamente.
 */
export function sincronizarFichaConCatalogo(
  saved: FichaPersonalizada,
  inicial: FichaPersonalizada
): FichaPersonalizada {
  const ocultos = new Set(saved.renglonesOcultos ?? []);
  const guardados = [...(saved.renglones ?? [])];
  const idsGuardados = new Set(guardados.map((r) => r.id));
  const etiquetasGuardadas = new Set(
    guardados.map((r) => String(r.etiqueta ?? '').trim().toLowerCase())
  );

  // Un campo fijo no se añade a una ficha vieja que ya trae ese dato con su
  // renglón de antes (ej. «Fabricante / Marca» = r-marca): saldría dos veces.
  const equivalenteGuardado = (id: string) =>
    (CAMPOS_FIJOS_FICHA.find((c) => c.id === id)?.equivalentes ?? [])
      .some((eqId) => idsGuardados.has(eqId) || ocultos.has(eqId));

  for (const rInit of inicial.renglones ?? []) {
    if (ocultos.has(rInit.id)) continue;
    if (equivalenteGuardado(rInit.id)) continue;
    const etqNorm = String(rInit.etiqueta ?? '').trim().toLowerCase();
    if (!idsGuardados.has(rInit.id) && !etiquetasGuardadas.has(etqNorm)) {
      guardados.push(rInit);
      idsGuardados.add(rInit.id);
      etiquetasGuardadas.add(etqNorm);
    }
  }

  // Los tres cuadros fijos de observaciones también llegan a las fichas viejas
  // (vacíos no se imprimen); los que el usuario ya escribió se conservan.
  const observaciones = [...(saved.observaciones ?? inicial.observaciones ?? [])];
  const idsObs = new Set(observaciones.map((o) => o.id));
  for (const oInit of inicial.observaciones ?? []) {
    if (!idsObs.has(oInit.id) && !ocultos.has(oInit.id)) observaciones.push(oInit);
  }

  return {
    ...inicial,
    ...saved,
    renglones: guardados,
    observaciones,
    renglonesOcultos: Array.from(ocultos),
  };
}


