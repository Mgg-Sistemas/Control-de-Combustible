// 🏭 CENTRO DE OPERACIONES — LOS PAPELES (23-oct-2026).
//
// Convierte los modelos de `./centroOperaciones` (donde viven TODAS las cuentas)
// en el CUERPO HTML de los tres PDF del módulo:
//   · el consolidado del sitio a una fecha de corte (papel A),
//   · el corte de viajes de una unidad en un período (papel B),
//   · el listado detallado, agrupado por día, unidad o tipo.
// El cuarto, el 📄 Reporte completo (PD5b), lo pinta `centroOperacionesReporteCompleto.ts`
// con las piezas de acá (`tabla`, `ficha`, `seccion`, `CSS_COP`); sus secciones, su título
// y su nombre de archivo viven acá con los de los otros tres (una sola fuente).
// `pdfDocument` (src/lib/pdf.ts) les pone el membrete; acá solo va el cuerpo y su
// CSS (`CSS_COP`). ⭐ ESTE ARCHIVO NO CALCULA: solo pinta lo que el modelo dice,
// así que los tres papeles no pueden contradecirse.
//
// LAS REGLAS DE LA CASA (diseño, sección 9):
//   · TODO texto variable pasa por `escaparHtml`: lo que ella escribe («<b>»,
//     «&», comillas) sale literal en el papel, nunca como HTML.
//   · LO OCULTO NO DEJA RASTRO: una sección o columna apagada no se genera (ni el
//     título, ni la columna en blanco, ni un «(oculto)»).
//   · Las opciones y los filtros NO se anuncian en el papel: solo en el nombre
//     del archivo (`nombreArchivoCop`) y en la pantalla. El subtítulo es neutro.
//   · Período sin registros: ceros y «Sin registros en el período», sin NaN.
//   · Flechas como carácter (→), nunca código crudo; filas que no se parten entre
//     hojas y ningún bloque vacío al final (dejaba una página en blanco).
//   · Lo por confirmar del corte va en la columna DE SU TIPO (internos o salidas),
//     nunca en la otra: la tarjeta de salidas no cuenta los internos pendientes.
//   · El listado por unidad y el corte reciben la MISMA regla de pertenencia
//     (`unidadDeLosRenglones` armada con la lista base): `cuerpoListado(…, unidadDe)` y
//     `cortePorUnidad(…, { …, unidadDe })`. Un renglón no puede salir en una unidad en
//     un papel y en otra en el otro.
//
// TODO ESTE ARCHIVO ES PURO: solo importa de `./centroOperaciones` y de
// `./frentesReporte` (las dos puras). `scripts/test-centro-operaciones-papel.mjs`
// lo prueba solo.
import { cmpMovimientoJornada, juntarFilasVisibles, m3De, momentoDelCorte, textoSalidasDe, textoViajes, totalesDe, unidadDeLosRenglones } from './centroOperaciones';
import type { EstadoMov, FilaTabla, FiltrosCop, ModeloConsolidado, ModeloCorte, Movimiento, PendientesCop, RangoCop, TipoMov, Totales } from './centroOperaciones';
import { aplicarEdicionResumen, CSS_FRENTES } from './frentesReporte';
import type { EdicionResumen, ResumenFrentes, TarjetaFrentes } from './frentesReporte';

// ═══════════════════════════ Tipos y opciones ═══════════════════════════

/** 'completo' (PD5b): el 📄 Reporte completo del 📅 Parte diario; su cuerpo lo pinta
 *  `centroOperacionesReporteCompleto.ts`, pero sus secciones, su título y su nombre de
 *  archivo viven acá con los de los otros papeles (una sola fuente). */
export type PapelCop = 'completo' | 'consolidado' | 'corte' | 'listado';
/** Las 7 secciones del Reporte completo, en el orden de su hoja. */
export type SeccionCompleto = 'reporteGeneral' | 'patios' | 'agregados' | 'acero' | 'aluminioPlastico' | 'maquinaria' | 'bloques';
export type SeccionConsolidado = 'presentacion' | 'tarjetas' | 'transportistas' | 'internos' | 'salidas' | 'origenes' | 'textoSalidas';
/** Las secciones del corte que se pueden esconder (viven en el mismo `ocultosSecciones`). */
export type SeccionCorte = 'tarjetas' | 'consideraciones';
export type ColumnaCop = 'pct' | 'toneladas' | 'm3' | 'placa' | 'transportista' | 'observaciones' | 'capacidad' | 'estado';

export type OpcionesPapelCop = {
  /** En blanco = el título de siempre del papel (`tituloCop`). */
  titulo: string;
  /** En blanco = sitio y período (`subtituloCop`): neutro, nunca nombra opciones. */
  subtitulo: string;
  /** Párrafo de arriba del consolidado. En blanco = uno automático y neutro. */
  presentacion: string;
  /** Texto libre al pie del corte (condiciones contractuales). En blanco = no sale. */
  consideraciones: string;
  /** El texto de «Emitida:» del membrete. En blanco = la fecha y hora reales. */
  emitida: string;
  ocultosSecciones: string[];
  ocultosColumnas: ColumnaCop[];
  orden: 'cantidad' | 'az';
  columnasPorDestino: boolean;
  diasSinAnotacion: 'cero' | 'ocultar';
  agruparListado: 'dia' | 'unidad' | 'tipo';
  logos: { bcv: boolean; sos: boolean; golden: boolean; renace: boolean; jhenzaen: boolean };
};

/** Como nacen las opciones de cada papel: nada oculto y el membrete de Golden Touch. */
export const OPCIONES_PAPEL_POR_DEFECTO: OpcionesPapelCop = {
  titulo: '',
  subtitulo: '',
  presentacion: '',
  consideraciones: '',
  emitida: '',
  ocultosSecciones: [],
  ocultosColumnas: [],
  orden: 'cantidad',
  columnasPorDestino: true,
  diasSinAnotacion: 'cero',
  agruparListado: 'dia',
  logos: { bcv: false, sos: false, golden: true, renace: false, jhenzaen: false },
};

// ═══════════════════════════ Los textos fijos del sitio (cop_ajustes) ═══════════════════════════
//
// ⭐ UNA sola lectura de lo que ⚙️ Ajustes guarda en `cop_ajustes` del sitio (auditoría
//    de pantallas, A6): Ajustes la usa para mostrar y 📄 Reportes para poner los textos y
//    el membrete. Con dos lectores, uno podía tomar por «no guardado» lo que el otro
//    guardó como `false`, y el papel y Ajustes mostrarían logos distintos.

export type LogosCop = OpcionesPapelCop['logos'];
/** Las claves de `cop_ajustes` con los textos fijos de los papeles (además de `logos`). */
export const CLAVES_TEXTO_COP = ['titulo_consolidado', 'titulo_corte', 'presentacion', 'consideraciones'] as const;
export type ClaveTextoCop = (typeof CLAVES_TEXTO_COP)[number];
export type TextosCop = Record<ClaveTextoCop, string> & { logos: LogosCop };

/** Los logos guardados, saneados. El defecto es el de los papeles (solo Golden Touch);
 *  lo que no sea sí/no toma ese defecto, y un `false` guardado se queda en `false`. */
export function logosDe(v: unknown): LogosCop {
  const r: LogosCop = { ...OPCIONES_PAPEL_POR_DEFECTO.logos };
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(r) as (keyof LogosCop)[]) if (typeof o[k] === 'boolean') r[k] = o[k] as boolean;
  }
  return r;
}

/** Los ajustes del sitio ({ clave: valor }) → los textos fijos y los logos. Lo que no
 *  es texto sale vacío (en blanco = el texto automático del papel). */
export function textosDe(ajustes: Record<string, unknown> | null | undefined): TextosCop {
  const aj = ajustes ?? {};
  const r = { logos: logosDe(aj['logos']) } as TextosCop;
  for (const c of CLAVES_TEXTO_COP) r[c] = typeof aj[c] === 'string' ? (aj[c] as string) : '';
  return r;
}

/** Algo que se puede esconder: su clave, cómo se llama en la pantalla y en el nombre del archivo. */
export type OcultableCop<K extends string> = { k: K; etiqueta: string; enArchivo: string };

/** ⭐ Qué secciones tiene cada papel. La pantalla pinta sus interruptores de acá y
 *  el nombre del archivo nombra solo las de ESE papel. */
const SECCIONES_DEL_COMPLETO: OcultableCop<SeccionCompleto>[] = [
  { k: 'reporteGeneral', etiqueta: 'Reporte General desglosado', enArchivo: 'reporte general' },
  { k: 'patios', etiqueta: 'Entrada por patio', enArchivo: 'patios' },
  { k: 'agregados', etiqueta: 'Salida de agregados', enArchivo: 'agregados' },
  { k: 'acero', etiqueta: 'Acero', enArchivo: 'acero' },
  { k: 'aluminioPlastico', etiqueta: 'Aluminio y plástico', enArchivo: 'aluminio y plástico' },
  { k: 'maquinaria', etiqueta: 'Maquinaria', enArchivo: 'maquinaria' },
  { k: 'bloques', etiqueta: 'Bloques', enArchivo: 'bloques' },
];

export const SECCIONES_COP: Record<PapelCop, OcultableCop<string>[]> = {
  // El Reporte completo: `SECCIONES_COMPLETO` (centroOperacionesReporteCompleto.ts) es ESTA lista.
  completo: SECCIONES_DEL_COMPLETO,
  consolidado: [
    { k: 'presentacion', etiqueta: 'Presentación', enArchivo: 'presentación' },
    { k: 'tarjetas', etiqueta: 'Tarjetas del resumen', enArchivo: 'tarjetas' },
    { k: 'transportistas', etiqueta: 'Recepción por empresa transportista', enArchivo: 'transportistas' },
    { k: 'internos', etiqueta: 'Movimientos internos', enArchivo: 'internos' },
    { k: 'salidas', etiqueta: 'Salidas / despacho', enArchivo: 'salidas' },
    { k: 'origenes', etiqueta: 'Recepción por frente u obra de origen', enArchivo: 'orígenes' },
    { k: 'textoSalidas', etiqueta: 'Resumen de salidas en texto', enArchivo: 'resumen de salidas' },
  ],
  corte: [
    { k: 'tarjetas', etiqueta: 'Tarjetas del resumen', enArchivo: 'tarjetas' },
    { k: 'consideraciones', etiqueta: 'Consideraciones', enArchivo: 'consideraciones' },
  ],
  listado: [],
};

/** ⭐ Qué columnas tiene cada papel (mismo uso que `SECCIONES_COP`). */
export const COLUMNAS_COP: Record<PapelCop, OcultableCop<ColumnaCop>[]> = {
  // Sus tablas son de cada sección: lo que se esconde son las secciones.
  completo: [],
  consolidado: [
    { k: 'pct', etiqueta: 'Participación (%)', enArchivo: '%' },
    { k: 'toneladas', etiqueta: 'Toneladas', enArchivo: 'toneladas' },
    { k: 'm3', etiqueta: 'm³', enArchivo: 'm³' },
    { k: 'capacidad', etiqueta: 'Capacidad', enArchivo: 'capacidad' },
    { k: 'estado', etiqueta: 'Estado', enArchivo: 'estado' },
  ],
  corte: [
    { k: 'placa', etiqueta: 'Placa', enArchivo: 'placa' },
    { k: 'observaciones', etiqueta: 'Observaciones', enArchivo: 'observaciones' },
  ],
  listado: [
    { k: 'placa', etiqueta: 'Placa', enArchivo: 'placa' },
    { k: 'transportista', etiqueta: 'Transportista', enArchivo: 'transportista' },
    { k: 'capacidad', etiqueta: 'Capacidad', enArchivo: 'capacidad' },
    { k: 'toneladas', etiqueta: 'Toneladas', enArchivo: 'toneladas' },
    { k: 'm3', etiqueta: 'm³', enArchivo: 'm³' },
    { k: 'estado', etiqueta: 'Estado', enArchivo: 'estado' },
    { k: 'observaciones', etiqueta: 'Observaciones', enArchivo: 'observaciones' },
  ],
};

// ═══════════════════════════ Texto y cifras ═══════════════════════════

/** ⭐ El único camino de un texto variable al papel: `<`, `>`, `&` y comillas salen literales. */
export function escaparHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const esc = escaparHtml;

/** Cada cuántos caracteres seguidos sin espacio se deja dónde partir el renglón. */
const TRAMO_PARTIBLE = 20;
/**
 * Escapa un texto LIBRE y, en los tramos de más de 20 caracteres sin espacio (un código
 * o un enlace pegado), deja dónde partir (`<wbr>`) cada 20: si no, en una columna angosta
 * el texto se salía de la hoja y se perdía. Cada pedazo se escapa ANTES de unirlos (nunca
 * se parte un «&amp;»). Solo para texto: el CSS que parte palabras partía las cifras.
 */
function escPartible(s: unknown): string {
  return String(s ?? '').split(/(\s+)/).map((p) => {
    const letras = Array.from(p);
    if (letras.length <= TRAMO_PARTIBLE || /\s/.test(p)) return esc(p);
    const trozos: string[] = [];
    for (let i = 0; i < letras.length; i += TRAMO_PARTIBLE) trozos.push(esc(letras.slice(i, i + TRAMO_PARTIBLE).join('')));
    return trozos.join('<wbr>');
  }).join('');
}

/** Texto limpio: sin espacios a los lados y con los dobles colapsados. */
const limpia = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Un número de verdad o 0: el papel jamás imprime NaN ni Infinity. */
const finito = (n: unknown): number => (typeof n === 'number' && isFinite(n) ? n : 0);

/** Viajes: enteros (si alguien escribió medio viaje, se ve). */
const fmtViajes = (n: number): string => finito(n).toLocaleString('es-VE', { maximumFractionDigits: 2 });
/** Toneladas y m³: siempre con 2 decimales («4.321,09»). */
const fmt2 = (n: number): string => finito(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Toneladas de `viajes` viajes: con viajes y ni una tonelada es «sin dato» («—»): ningún
 *  camión se pesa en 0, así que «0,00» parecería una cifra. Sin viajes, el 0 sí es el dato. */
const fmtTon = (t: number, viajes: number): string => (finito(t) === 0 && finito(viajes) > 0 ? '—' : fmt2(t));
/** Participación: 1 decimal y el signo separado («45,5 %»). */
const fmtPct = (n: number): string => `${finito(n).toLocaleString('es-VE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
/** La capacidad del camión: «18 m³», «7,5 m³» o «—». */
const fmtCapacidad = (c: number | null): string =>
  typeof c === 'number' && isFinite(c) ? `${c.toLocaleString('es-VE', { maximumFractionDigits: 2 })} m³` : '—';

const plural = (n: number, uno: string, varios: string): string => (n === 1 ? uno : varios);

/** Ordena textos A→Z en español: sin mirar mayúsculas ni tildes, y «U-2» antes que «U-10». */
const cmpAz = (a: string, b: string): number => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

/** Para COMPARAR textos impresos: sin mayúsculas, tildes ni espacios de más (la ñ se queda). */
const normTexto = (s: unknown): string =>
  limpia(s).toLowerCase().replace(/ñ/g, '\u0001').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\u0001/g, 'ñ');

/** «2026-10-06» → «06/10/2026». Lo que no es una fecha sale tal cual (y se escapa después). */
export function fechaCop(f: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(f ?? '');
}

/** «19:00» → «07:00 p. m.» (como la fecha de emisión de los demás reportes). Basura → ''. */
function horaLegible(h: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h ?? '').trim());
  if (!m) return '';
  const hh = Number(m[1]);
  if (hh > 23 || Number(m[2]) > 59) return '';
  const ap = hh < 12 ? 'a. m.' : 'p. m.';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${String(h12).padStart(2, '0')}:${m[2]} ${ap}`;
}

/** «08:10:00» → «08:10». Basura → ''. */
function horaCorta(h: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h ?? '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

/**
 * El instante REAL del corte (`momentoDelCorte`, el mismo que suma `enRango` y que dice
 * `corteCop`; con 07:00 en punto cierra la jornada: el día siguiente, R33): el día
 * calendario y la hora. null sin corte (o con uno que no se entiende).
 */
function corteReal(r: RangoCop): { dia: string; hora: string } | null {
  const m = r.corteHora ? momentoDelCorte(r.hasta, r.corteHora) : null;
  return m ? { dia: m.slice(0, 10), hora: m.slice(11, 16) } : null;
}

/**
 * El período en palabras, para la ficha del papel: «09/10/2026», «del 06/10/2026 al
 * 09/10/2026» y, con hora de corte, «…, corte a las 07:00 p. m.». ⭐ Un corte de
 * madrugada (antes de las 7am, y a las 07:00 en punto, que cierra la jornada: R33) ya es
 * del día calendario SIGUIENTE al «hasta» y se dice ese día: «…, corte el 10/10/2026 a
 * las 05:00 a. m.» (si no, el papel se leería 24 horas antes de lo que sumó). Texto
 * plano: quien lo imprime lo escapa.
 */
export function periodoCop(r: RangoCop): string {
  const base = r.desde === r.hasta ? fechaCop(r.desde) : `del ${fechaCop(r.desde)} al ${fechaCop(r.hasta)}`;
  const c = corteReal(r);
  if (!c) return base;
  const hora = horaLegible(c.hora);
  return c.dia === r.hasta ? `${base}, corte a las ${hora}` : `${base}, corte el ${fechaCop(c.dia)} a las ${hora}`;
}

/** Párrafos de un texto libre: una línea en blanco separa párrafos; un salto simple, renglones. */
function parrafos(texto: string, clase: string): string {
  return String(texto ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => `<p class="${clase}">${b.split('\n').map((l) => esc(l.trim())).join('<br/>')}</p>`)
    .join('');
}

// ═══════════════════════════ Título, subtítulo y archivo ═══════════════════════════

/** El título de siempre del 📄 Reporte completo (en blanco en las opciones = este). */
export const TITULO_REPORTE_COMPLETO = 'Reporte completo';

const TITULO_POR_DEFECTO: Record<PapelCop, string> = {
  completo: TITULO_REPORTE_COMPLETO,
  consolidado: 'Consolidado del sitio',
  corte: 'Corte de viajes por unidad',
  listado: 'Listado detallado',
};

/** El título del membrete, YA ESCAPADO (pdfDocument lo pega tal cual). En blanco = el de siempre. */
export function tituloCop(papel: PapelCop, op?: Pick<OpcionesPapelCop, 'titulo'> | null): string {
  return esc(limpia(op?.titulo) || TITULO_POR_DEFECTO[papel]);
}

/**
 * El subtítulo del membrete, YA ESCAPADO. En blanco = «Sitio · período».
 * ⭐ NEUTRO POR CONSTRUCCIÓN: no recibe los filtros, así que no puede nombrarlos; y
 *    lo oculto tampoco se menciona (eso va al nombre del archivo).
 */
export function subtituloCop(papel: PapelCop, sitio: string, r: RangoCop, op?: Pick<OpcionesPapelCop, 'subtitulo'> | null): string {
  const escrito = limpia(op?.subtitulo);
  if (escrito) return esc(escrito);
  return esc([limpia(sitio), periodoCop(r)].filter(Boolean).join(' · '));
}

/**
 * El texto de «Emitida:» del membrete, YA ESCAPADO: ⚠️ `pdfDocument` lo pega tal cual,
 * así que se le pasa `emitida: emitidaCop(op)`, NUNCA `op.emitida` (un «<» o un «&»
 * escrito a mano rompería el membrete). En blanco = undefined: pdfDocument pone la fecha
 * y hora reales.
 */
export function emitidaCop(op?: Pick<OpcionesPapelCop, 'emitida'> | null): string | undefined {
  const t = limpia(op?.emitida);
  return t ? esc(t) : undefined;
}

const PAPEL_EN_ARCHIVO: Record<PapelCop, string> = { completo: TITULO_REPORTE_COMPLETO, consolidado: 'Consolidado', corte: 'Corte por unidad', listado: 'Listado' };
const TIPO_EN_ARCHIVO: Record<TipoMov, string> = { entrada: 'entradas', interno: 'internos', salida: 'salidas', otro: 'otros', produccion: 'producción' };
const ESTADO_EN_ARCHIVO: Record<EstadoMov, string> = { confirmado: 'confirmados', por_confirmar: 'por confirmar', esperando_pesaje: 'esperando pesaje' };
/** Lo que `exportPdf` deja del nombre (corta en 120): pasado eso, se resume. */
const LARGO_ARCHIVO = 120;

/** Lo que queda del sitio, como mínimo, antes de resumir las marcas (si no cabe ni eso). */
const MIN_SITIO_ARCHIVO = 20;

/** Sin los caracteres que Windows prohíbe en un nombre de archivo (ni los de control). */
const paraArchivo = (s: unknown): string =>
  String(s ?? '').replace(/[\\/:*?"<>|\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim();

/** Recorta a `n` caracteres, con «…» al final si hizo falta. */
const recortar = (s: string, n: number): string => (s.length <= n ? s : n < 2 ? '' : `${s.slice(0, n - 1).trimEnd()}…`);

/**
 * «Consolidado Sitio 1 2026-10-06 al 2026-10-09 corte 19-00 - sin transportistas, sin %».
 *
 * ⭐ ES EL ÚNICO LUGAR (además de la pantalla) DONDE SE NOMBRA LO OCULTO Y LO
 *    FILTRADO: dos papeles del mismo período —uno completo y otro recortado— se
 *    pisarían en la carpeta de descargas, y el segundo se abriría creyendo que es
 *    el completo. Solo se nombra lo que ESE papel tiene.
 * ⭐ NUNCA PASA DE 120 (exportPdf corta ahí a ciegas y se comería las marcas): lo que
 *    se recorta es el SITIO (con «…»), no las marcas; solo si ni así cabe, las marcas
 *    se resumen («sin 7 partes», «filtrado»).
 *
 * `unidades` (opcional): los nombres IMPRESOS de las hojas del corte (los de la ficha).
 * Con ellos, dos cortes del mismo período de unidades distintas no se pisan: «… - U-1»,
 * «… - U-1, U-2 y U-3» o, con más de tres, «… - 5 unidades» (y ya no hace falta la marca
 * «solo N unidades»). La unidad no es nada oculto: su hoja la nombra.
 */
export function nombreArchivoCop(papel: PapelCop, sitio: string, r: RangoCop, op: OpcionesPapelCop, filtros?: FiltrosCop, unidades?: string[]): string {
  // El corte con el día REAL si es de madrugada («corte 2026-10-10 05-00»); si no, solo la hora.
  const cr = corteReal(r);
  const corte = cr ? `${cr.dia === r.hasta ? '' : `${cr.dia} `}${cr.hora.replace(':', '-')}` : '';
  const fechas = [r.desde === r.hasta ? r.desde : `${r.desde} al ${r.hasta}`, corte ? `corte ${corte}` : ''].filter(Boolean).join(' ');
  const elSitio = paraArchivo(sitio);
  const lasUnidades = (unidades ?? []).map((u) => recortar(paraArchivo(u), 30)).filter(Boolean);
  const cuantas = lasUnidades.length ? `${lasUnidades.length} ${plural(lasUnidades.length, 'unidad', 'unidades')}` : '';
  const porNombre = !lasUnidades.length ? ''
    : lasUnidades.length === 1 ? lasUnidades[0]
      : lasUnidades.length <= 3 ? `${lasUnidades.slice(0, -1).join(', ')} y ${lasUnidades[lasUnidades.length - 1]}`
        : cuantas;

  const ocS = new Set(op.ocultosSecciones ?? []);
  const ocC = new Set<string>(op.ocultosColumnas ?? []);
  const ocultos = [
    ...SECCIONES_COP[papel].filter((s) => ocS.has(s.k)).map((s) => `sin ${s.enArchivo}`),
    ...COLUMNAS_COP[papel].filter((c) => ocC.has(c.k)).map((c) => `sin ${c.enArchivo}`),
  ];
  if (papel === 'corte' && op.diasSinAnotacion === 'ocultar') ocultos.push('sin días vacíos');

  const filtrado: string[] = [];
  if (filtros) {
    const nombres = (lista: string[] | undefined, varios: string): void => {
      const n = (lista ?? []).map(paraArchivo).filter(Boolean);
      if (!n.length) return;
      filtrado.push(n.length <= 3 ? `solo ${n.join(' y ')}` : `solo ${n.length} ${varios}`);
    };
    if (filtros.tipos?.length) filtrado.push(`solo ${filtros.tipos.map((t) => TIPO_EN_ARCHIVO[t] ?? t).join(' y ')}`);
    if (filtros.estados?.length) filtrado.push(`solo ${filtros.estados.map((e) => ESTADO_EN_ARCHIVO[e] ?? e).join(' y ')}`);
    // Con los nombres de las unidades en el nombre, «solo N unidades» ya está dicho.
    if (filtros.unidadIds?.length && !lasUnidades.length) filtrado.push(`solo ${filtros.unidadIds.length} ${plural(filtros.unidadIds.length, 'unidad', 'unidades')}`);
    nombres(filtros.transportistas, 'transportistas');
    nombres(filtros.origenes, 'orígenes');
    nombres(filtros.destinos, 'destinos');
    nombres(filtros.materiales, 'materiales');
    const texto = paraArchivo(filtros.texto);
    if (texto) filtrado.push(`con «${texto}»`);
  }

  const armar = (s: string, u: string, o: string[], f: string[]): string => {
    const base = [PAPEL_EN_ARCHIVO[papel], s, fechas].filter(Boolean).join(' ') + (u ? ` - ${u}` : '');
    return paraArchivo(o.length || f.length ? `${base} - ${[...o, ...f].join(', ')}` : base);
  };
  // De lo más detallado a lo más resumido: primero se resume lo oculto, luego los filtros
  // y, al final, los nombres de las unidades pasan a «N unidades».
  const resumidos = ocultos.length > 1 ? [`sin ${ocultos.length} partes`] : ocultos;
  const marcas: [string[], string[]][] = [
    [ocultos, filtrado],
    [resumidos, filtrado],
    [resumidos, filtrado.length ? ['filtrado'] : []],
  ];
  const opcionesUnidades = porNombre && porNombre !== cuantas ? [porNombre, cuantas] : [porNombre];
  const niveles: [string, string[], string[]][] = opcionesUnidades.flatMap((u) => marcas.map(([o, f]): [string, string[], string[]] => [u, o, f]));
  // En cada nivel, el sitio entero si cabe; si no, recortado (si le quedan al menos 20).
  for (const [u, o, f] of niveles) {
    const libre = LARGO_ARCHIVO - armar('', u, o, f).length - 1;
    if (elSitio.length <= libre) return armar(elSitio, u, o, f);
    if (libre >= MIN_SITIO_ARCHIVO) return armar(recortar(elSitio, libre), u, o, f);
  }
  const [u, o, f] = niveles[niveles.length - 1];
  return armar(recortar(elSitio, Math.max(LARGO_ARCHIVO - armar('', u, o, f).length - 1, 0)), u, o, f).slice(0, LARGO_ARCHIVO);
}

// ═══════════════════════════ Piezas comunes del HTML ═══════════════════════════

/** Una columna de tabla. `celda` y `total` devuelven HTML YA ESCAPADO (el título no: se escapa acá). */
type Col<T> = { titulo: string; celda: (f: T) => string; total?: string; num?: boolean };
/** La columna de `tabla` para quien la usa desde fuera (el 📄 Reporte completo). */
export type ColTablaCop<T> = Col<T>;

/**
 * La tabla con su fila de totales (si alguna columna la tiene). Sin filas ni totales, no hay tabla.
 * `etiquetaTotal` es un texto FIJO del papel («TOTALES», «Subtotal»): va tal cual.
 * ⭐ La comparten todos los papeles del módulo (también el Reporte completo, PD5b): una sola.
 */
export function tabla<T>(cols: Col<T>[], filas: T[], etiquetaTotal = 'TOTALES'): string {
  const td = (c: Col<T>, html: string): string => `<td${c.num ? ' class="n"' : ''}>${html}</td>`;
  const cabeza = cols.map((c) => `<th${c.num ? ' class="n"' : ''}>${esc(c.titulo)}</th>`).join('');
  const cuerpo = filas.map((f) => `<tr>${cols.map((c) => td(c, c.celda(f))).join('')}</tr>`).join('');
  // La etiqueta ocupa todas las columnas que van antes del primer total: así
  // «SUBTOTAL» no ensancha la primera columna (con 13 columnas, eso desbordaba la hoja).
  const primero = cols.findIndex((c) => c.total !== undefined);
  const etiqueta = primero > 0 ? `<td${primero > 1 ? ` colspan="${primero}"` : ''}>${etiquetaTotal}</td>` : '';
  const pie = primero >= 0
    ? `<tfoot><tr class="cop-total">${etiqueta}${cols.slice(Math.max(primero, 0)).map((c) => td(c, c.total ?? '')).join('')}</tr></tfoot>`
    : '';
  if (!cuerpo && !pie) return '';
  return `<table><thead><tr>${cabeza}</tr></thead><tbody>${cuerpo}</tbody>${pie}</table>`;
}

/**
 * La celda del TOTAL de viajes de una tabla: el número y, abajo y en chico, sus avisos
 * («+1 pendiente, +4 por confirmar», las palabras de `textoViajes`). Todo junto, en
 * negrita y sin cortes, ensanchaba la columna y la tabla se salía del margen.
 */
function celdaTotalViajes(t: { viajes: number; pendientesSinNumero: number; porConfirmarViajes: number }): string {
  const avisos = /\((.*)\)$/.exec(textoViajes(t))?.[1] ?? '';
  return `${fmtViajes(t.viajes)}${avisos ? `<small class="cop-pend">${esc(avisos)}</small>` : ''}`;
}

/** Una sección con su título (escapado). `derecha` es la cifra chica a la derecha del título.
 *  La comparten todos los papeles del módulo (también el Reporte completo). */
export function seccion(titulo: string, contenido: string, derecha = ''): string {
  return `<div class="cop-sec"><div class="fr-h cop-h">${esc(titulo)}${derecha ? `<span>${esc(derecha)}</span>` : ''}</div>${contenido}</div>`;
}

const vacioDe = (texto: string): string => `<p class="fr-vacio">${esc(texto)}</p>`;
const LEYENDA_VACIO = '<p class="cop-vacio">Sin registros en el período.</p>';

/** La ficha de arriba («Sitio: … · Corte: …»), escapada. Lo que viene en blanco no sale; todo
 *  en blanco, nada. La comparten todos los papeles del módulo (también el Reporte completo). */
export function ficha(pares: [string, string][]): string {
  const llenos = pares.filter(([, v]) => limpia(v) !== '');
  if (!llenos.length) return '';
  return `<div class="cop-ficha">${llenos.map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(limpia(v))}</span>`).join('')}</div>`;
}

/** Las tarjetas del resumen ejecutivo, con el mismo dibujo que el de los frentes. Sin tarjetas, nada. */
function htmlTarjetas(r: ResumenFrentes): string {
  if (!r.tarjetas.length) return '';
  return `<div class="fr-tj">${r.tarjetas.map((t: TarjetaFrentes) =>
    `<div><span>${esc(t.titulo)}</span><b>${esc(t.valor)}</b>${t.nota ? `<small>${esc(t.nota)}</small>` : ''}</div>`).join('')}</div>`;
}

const ETIQUETA_ESTADO: Record<EstadoMov, string> = {
  confirmado: 'Confirmado',
  esperando_pesaje: 'Esperando pesaje',
  por_confirmar: 'Por confirmar',
};
const ETIQUETA_TIPO: Record<TipoMov, string> = { entrada: 'Entrada', interno: 'Interno', salida: 'Salida', otro: 'Otro', produccion: 'Producción' };

// ═══════════════════════════ El consolidado del sitio (papel A) ═══════════════════════════

/**
 * Las tarjetas del consolidado, con CLAVES ESTABLES (`viajes`, `toneladas`,
 * `promedio`): con ellas el editor del resumen las esconde, renombra o les pone
 * un valor a mano. Son de lo RECIBIDO (las entradas).
 *
 * ⭐ Cada tarjeta sigue a su columna (como `resumenFrentes`): con `op` y la columna
 *    «toneladas» apagada, no salen ni la de toneladas ni la del promedio (es t/viaje).
 *    Pásale el mismo `op` al editor del resumen, así ofrece las tarjetas del papel.
 */
export function resumenConsolidado(m: ModeloConsolidado, op?: Pick<OpcionesPapelCop, 'ocultosColumnas'> | null): ResumenFrentes {
  const t = m.totales;
  const conToneladas = !(op?.ocultosColumnas ?? []).includes('toneladas');
  const tarjetas: TarjetaFrentes[] = [{ k: 'viajes', titulo: 'Viajes recibidos', valor: textoViajes(t) }];
  if (conToneladas) {
    tarjetas.push(
      { k: 'toneladas', titulo: 'Toneladas netas', valor: fmtTon(t.toneladas, t.viajes) },
      // Sin entradas pesadas no hay promedio: «—», nunca una división entre cero.
      { k: 'promedio', titulo: 'Promedio t/viaje', valor: t.promedioTonViaje === null ? '—' : fmt2(t.promedioTonViaje) },
    );
  }
  return { tarjetas, cuadros: [] };
}

/** La tabla «por transportista» o «por origen»: viajes, participación y toneladas, con su fila de totales. */
function tablaRecepcion(titulo: string, filas: FilaTabla[], t: Totales, oc: Set<string>): string {
  const cols: Col<FilaTabla>[] = [
    { titulo, celda: (f) => esc(f.clave) },
    { titulo: 'Viajes', num: true, celda: (f) => fmtViajes(f.viajes), total: celdaTotalViajes(t) },
  ];
  if (!oc.has('pct')) cols.push({ titulo: 'Participación', num: true, celda: (f) => fmtPct(f.pct), total: t.viajes > 0 ? '100 %' : fmtPct(0) });
  if (!oc.has('toneladas')) cols.push({ titulo: 'Toneladas', num: true, celda: (f) => fmtTon(f.toneladas, f.viajes), total: fmtTon(t.toneladas, t.viajes) });
  return tabla(cols, filas);
}

/**
 * El cuerpo del papel A. `m` sale de `consolidadoSitio` (ya ordenado según
 * `op.orden`); `cabecera` es el sitio y el corte en palabras (texto plano).
 */
export function cuerpoConsolidado(
  m: ModeloConsolidado,
  op: OpcionesPapelCop,
  ed: EdicionResumen | null,
  cabecera: { sitio: string; corte: string },
): string {
  const ocS = new Set(op.ocultosSecciones ?? []);
  const oc = new Set<string>(op.ocultosColumnas ?? []);
  const ve = (s: SeccionConsolidado): boolean => !ocS.has(s);
  // ⭐ Lo oculto no deja rastro, ni derivado: las filas se JUNTAN por lo que se ve (sin
  //    capacidad o sin estado, dos filas iguales a la vista serían una sola cosa contada
  //    dos veces) y el texto de salidas no dice lo apagado. Las cuentas son de la librería.
  const orden = op.orden ?? 'cantidad';
  const ver = { capacidad: !oc.has('capacidad'), m3: !oc.has('m3'), estado: !oc.has('estado') };
  const filas = juntarFilasVisibles(m, orden, ver);
  const sitio = limpia(cabecera.sitio);
  const corte = limpia(cabecera.corte);
  const partes: string[] = [ficha([['Sitio', sitio], ['Corte', corte]])];

  if (ve('presentacion')) {
    // La automática es NEUTRA a propósito: no nombra secciones (alguna podría estar oculta).
    const frase = `Consolidado de las operaciones del sitio${sitio ? ` ${sitio}` : ''}${corte ? ` con corte al ${corte}` : ''}`;
    // «… 07:00 p. m.» ya trae su punto: no se le pone otro.
    const auto = frase.endsWith('.') ? frase : `${frase}.`;
    partes.push(parrafos(limpia(op.presentacion) ? op.presentacion : auto, 'cop-pres'));
  }
  if (ve('tarjetas')) partes.push(htmlTarjetas(aplicarEdicionResumen(resumenConsolidado(m, op), ed)));

  if (m.vacio) {
    partes.push(LEYENDA_VACIO);
    return partes.join('');
  }

  // Con entradas por confirmar (que no van en las tablas), «Sin entradas» contradiría a la
  // tarjeta que las anuncia: se dice que no hay entradas CONFIRMADAS.
  const sinEntradas = vacioDe(m.totales.pendientesSinNumero > 0 || m.totales.porConfirmarViajes > 0
    ? 'Sin entradas confirmadas en el período.'
    : 'Sin entradas en el período.');

  if (ve('transportistas')) {
    const t = tablaRecepcion('Transportista', m.porTransportista, m.totales, oc);
    partes.push(seccion('Recepción por empresa transportista', m.porTransportista.length ? t : sinEntradas));
  }

  if (ve('internos')) {
    const pend = m.pendientesInternos;
    const internos = filas.internos;
    const viajes = internos.reduce((s, g) => s + g.viajes, 0);
    type Fila = ModeloConsolidado['internos'][number];
    const cols: Col<Fila>[] = [{ titulo: 'Recorrido', celda: (g) => `${esc(g.origen)} → ${esc(g.destino)}` }];
    if (!oc.has('capacidad')) cols.push({ titulo: 'Capacidad', num: true, celda: (g) => fmtCapacidad(g.capacidadM3) });
    cols.push({ titulo: 'Viajes', num: true, celda: (g) => fmtViajes(g.viajes), total: celdaTotalViajes({ viajes, ...pend }) });
    if (!oc.has('m3')) cols.push({ titulo: 'm³', num: true, celda: (g) => fmt2(g.m3), total: fmt2(internos.reduce((s, g) => s + g.m3, 0)) });
    const hay = internos.length > 0 || pend.pendientesSinNumero > 0 || pend.porConfirmarViajes > 0;
    partes.push(seccion('Movimientos internos (terraza a terraza)', hay ? tabla(cols, internos) : vacioDe('Sin movimientos internos en el período.')));
  }

  if (ve('salidas')) {
    const pend = m.pendientesSalidas;
    const salidas = filas.salidas;
    const viajes = salidas.reduce((s, g) => s + g.viajes, 0);
    type Fila = ModeloConsolidado['salidas'][number];
    const cols: Col<Fila>[] = [
      { titulo: 'Material', celda: (g) => esc(g.material) },
      { titulo: 'Destino', celda: (g) => esc(g.destino) },
    ];
    if (!oc.has('capacidad')) cols.push({ titulo: 'Capacidad', num: true, celda: (g) => fmtCapacidad(g.capacidadM3) });
    cols.push({ titulo: 'Viajes', num: true, celda: (g) => fmtViajes(g.viajes), total: celdaTotalViajes({ viajes, ...pend }) });
    // Lo que espera pesaje todavía no tiene peso neto: «—», no un 0 que parezca dato.
    // Lo que no se pesó (confirmado sin toneladas, o esperando pesaje) dice «—», no un 0 que parezca dato.
    if (!oc.has('toneladas')) cols.push({ titulo: 'Toneladas', num: true, celda: (g) => (g.estado === 'confirmado' ? fmtTon(g.toneladas, g.viajes) : '—'), total: fmtTon(salidas.reduce((s, g) => s + g.toneladas, 0), viajes) });
    if (!oc.has('m3')) cols.push({ titulo: 'm³', num: true, celda: (g) => fmt2(g.m3), total: fmt2(salidas.reduce((s, g) => s + g.m3, 0)) });
    if (!oc.has('estado')) cols.push({ titulo: 'Estado', celda: (g) => esc(ETIQUETA_ESTADO[g.estado] ?? g.estado) });
    const hay = salidas.length > 0 || pend.pendientesSinNumero > 0 || pend.porConfirmarViajes > 0;
    partes.push(seccion('Salidas / despacho', hay ? tabla(cols, salidas) : vacioDe('Sin salidas en el período.')));
  }

  if (ve('origenes')) {
    const t = tablaRecepcion('Frente / obra de origen', m.porOrigen, m.totales, oc);
    partes.push(seccion('Recepción por frente u obra de origen', m.porOrigen.length ? t : sinEntradas));
  }

  if (ve('textoSalidas')) {
    const pend = m.pendientesSalidas;
    const viajes = m.salidas.reduce((s, g) => s + g.viajes, 0);
    const m3 = m.salidas.reduce((s, g) => s + g.m3, 0);
    const lineas = textoSalidasDe(m.salidas, orden, ver);
    const totalM3 = ver.m3 ? `${fmt2(m3)} m³ · ` : '';
    // La lista y su total van en UN bloque que no se parte: si no, «Total despachado»
    // quedaba sola en la hoja siguiente (el pie corrido que el diseño pide no repetir).
    const contenido = lineas.length
      ? `<div class="cop-junto"><ul class="cop-lista">${lineas.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
        + `<p class="fr-tot">Total despachado: ${totalM3}Viajes: ${esc(textoViajes({ viajes, ...pend }))}</p></div>`
      : vacioDe('Sin salidas en el período.');
    partes.push(seccion('Resumen de salidas', contenido));
  }

  return partes.join('');
}

// ═══════════════════════════ El corte por unidad (papel B) ═══════════════════════════

/**
 * Las tarjetas del corte (R2), con CLAVES ESTABLES `internos`, `salidas` y `total`.
 * La de salidas lleva sus pendientes: «2 (+1 pendiente)».
 */
export function resumenCorte(c: ModeloCorte): ResumenFrentes {
  const t = c.totales;
  return {
    tarjetas: [
      { k: 'internos', titulo: 'Viajes internos', valor: fmtViajes(t.internos) },
      { k: 'salidas', titulo: 'Viajes externos (salidas)', valor: textoViajes({ viajes: t.salidas, pendientesSinNumero: t.pendientesSinNumero, porConfirmarViajes: t.porConfirmarViajes }) },
      { k: 'total', titulo: 'Total de viajes', valor: fmtViajes(t.total) },
    ],
    cuadros: [],
  };
}

/** ¿Hay algo por confirmar (con o sin número)? */
const hayPendiente = (p: PendientesCop): boolean => p.pendientesSinNumero > 0 || p.porConfirmarViajes > 0;
/** Los avisos con las palabras de `textoViajes`: «+1 pendiente», «+4 por confirmar» o los dos. */
const avisosDe = (p: PendientesCop): string => /\((.*)\)$/.exec(textoViajes({ viajes: 0, ...p }))?.[1] ?? '';
/** Una celda sin viajes confirmados de ese tipo pero con algo por confirmar: «Por confirmar» (sin número) o «4 por confirmar». */
const textoPorConfirmar = (p: PendientesCop): string => {
  if (p.porConfirmarViajes <= 0) return 'Por confirmar';
  const sinNumero = p.pendientesSinNumero > 0 ? ` (+${fmtViajes(p.pendientesSinNumero)} ${plural(p.pendientesSinNumero, 'pendiente', 'pendientes')})` : '';
  return `${fmtViajes(p.porConfirmarViajes)} por confirmar${sinNumero}`;
};

/**
 * El cuerpo del papel B para UNA unidad, envuelto en `<section class="cop-hoja">`:
 * varias unidades se pegan una detrás de otra y cada una empieza en su hoja.
 * `periodo` es el período en palabras (texto plano; ver `periodoCop`).
 *
 * `encabezado` (opcional; auditoría del lote 4, A1): el título del papel y la línea
 * «Emitida:», YA ESCAPADOS (los mismos que van al membrete: `tituloCop`, `emitidaCop`).
 * Con él, la hoja dice qué es y cuándo se emitió aunque se entregue suelta (la 2.ª en
 * adelante de un corte de varias unidades no tiene el membrete). Va DENTRO de la
 * `<section>` —si fuera entre dos, `.cop-hoja+.cop-hoja` dejaría de casar y se perdería
 * el salto de página— y sin logo (los logos son data: URI y multiplicarían el HTML).
 */
export function cuerpoCorte(
  c: ModeloCorte,
  op: OpcionesPapelCop,
  ed: EdicionResumen | null,
  periodo: string,
  encabezado?: { titulo?: string; emitida?: string } | null,
): string {
  const ocS = new Set(op.ocultosSecciones ?? []);
  const oc = new Set<string>(op.ocultosColumnas ?? []);
  const conObs = !oc.has('observaciones');
  const t = c.totales;
  // La placa no se repite si es lo mismo que el nombre de la hoja (una unidad suelta que
  // solo trae placa se llama por ella): se comparan como placas, solo letras y números.
  const comoPlaca = (s: unknown): string => normTexto(s).replace(/[^a-z0-9ñ]/g, '');
  const placaRepetida = comoPlaca(c.placa) !== '' && comoPlaca(c.placa) === comoPlaca(c.unidad);
  const partes: string[] = [ficha([
    ['Unidad', c.unidad],
    ['Placa', oc.has('placa') || placaRepetida ? '' : c.placa ?? ''],
    ['Período', periodo],
  ])];

  if (!ocS.has('tarjetas')) partes.push(htmlTarjetas(aplicarEdicionResumen(resumenCorte(c), ed)));
  if (c.vacio) partes.push(LEYENDA_VACIO);

  if (c.dias.length) {
    // ⭐ Sin salidas en el período la columna de externos NO desaparece (el papel B
    //    siempre la trae): sale una sola «Salidas» en 0. Y el encabezado agrupado lo
    //    decide el modelo (`porDestino`), no el op del papel: así nunca «Salidas» sobre
    //    «Salidas». Un modelo armado sin ese campo usa el op, como antes.
    const sinSalidas = c.destinos.length === 0;
    const destinos = sinSalidas ? ['Salidas'] : c.destinos;
    const porDestino = typeof c.porDestino === 'boolean' ? c.porDestino : op.columnasPorDestino;
    const agrupado = porDestino && !sinSalidas;
    const n = (x: string): string => `<th class="n">${x}</th>`;
    const cabeza = agrupado
      ? `<tr><th rowspan="2">Fecha</th><th class="n" rowspan="2">Internos</th><th class="cop-grupo" colspan="${destinos.length}">Salidas</th>${conObs ? '<th rowspan="2">Observaciones</th>' : ''}</tr>`
        + `<tr>${destinos.map((d) => n(esc(d))).join('')}</tr>`
      : `<tr><th>Fecha</th>${n('Internos')}${destinos.map((d) => n(esc(d))).join('')}${conObs ? '<th>Observaciones</th>' : ''}</tr>`;

    // ⭐ Lo por confirmar va en la columna DE SU TIPO (`pendienteInternos` /
    //    `pendienteSalidas`): un interno pendiente jamás dice «Por confirmar» en las
    //    salidas, cuya tarjeta no lo cuenta. Sin viajes confirmados de ese tipo, la celda
    //    dice «Por confirmar» (o «4 por confirmar»); con viajes, el número y el aviso abajo.
    const filas = c.dias.map((d) => {
      const pi = d.pendienteInternos, ps = d.pendienteSalidas;
      const internos = !hayPendiente(pi)
        ? `<td class="n">${fmtViajes(d.internos)}</td>`
        : finito(d.internos) === 0
          ? `<td class="cop-pc">${esc(textoPorConfirmar(pi))}</td>`
          : `<td class="n">${fmtViajes(d.internos)}<small class="cop-pend">${esc(avisosDe(pi))}</small></td>`;

      const enCero = destinos.every((x) => finito(d.salidas[x]) === 0);
      const pcEnCelda = hayPendiente(ps) && destinos.length > 0 && enCero;
      const avisoEnCelda = hayPendiente(ps) && !enCero && destinos.length === 1;
      // Con varios destinos no se sabe de cuál es lo pendiente: se dice junto a la fecha,
      // nombrando las salidas (ponerlo en una columna diría un destino que no es).
      const avisoEnFecha = hayPendiente(ps) && !pcEnCelda && !avisoEnCelda;
      const fecha = `${esc(fechaCop(d.fecha))}${avisoEnFecha ? `<small class="cop-pend">Salidas: ${esc(avisosDe(ps))}</small>` : ''}`;
      const salidas = pcEnCelda
        ? `<td class="cop-pc" colspan="${destinos.length}">${esc(textoPorConfirmar(ps))}</td>`
        : destinos.map((x) => `<td class="n">${fmtViajes(finito(d.salidas[x]))}${avisoEnCelda ? `<small class="cop-pend">${esc(avisosDe(ps))}</small>` : ''}</td>`).join('');
      const obs = conObs ? `<td>${d.observaciones.map((o) => esc(o)).join(' · ')}</td>` : '';
      return `<tr><td>${fecha}</td>${internos}${salidas}${obs}</tr>`;
    }).join('');

    const totalesDestino = destinos.length === 1
      ? [esc(textoViajes({ viajes: t.salidas, pendientesSinNumero: t.pendientesSinNumero, porConfirmarViajes: t.porConfirmarViajes }))]
      : destinos.map((x) => fmtViajes(c.dias.reduce((s, d) => s + finito(d.salidas[x]), 0)));
    const pie = `<tr class="cop-total"><td>TOTALES</td><td class="n">${fmtViajes(t.internos)}</td>${totalesDestino.map((v) => `<td class="n">${v}</td>`).join('')}${conObs ? '<td></td>' : ''}</tr>`;

    partes.push(`<table><thead>${cabeza}</thead><tbody>${filas}</tbody><tfoot>${pie}</tfoot></table>`);
  }
  // Con varios destinos la fila de totales no tiene dónde decir los pendientes de las
  // salidas: se dicen acá (con uno solo, ya van en esa fila).
  const avisoSalidas = c.destinos.length > 1 && (t.pendientesSinNumero > 0 || t.porConfirmarViajes > 0)
    ? ` · Salidas: ${esc(textoViajes({ viajes: t.salidas, pendientesSinNumero: t.pendientesSinNumero, porConfirmarViajes: t.porConfirmarViajes }))}`
    : '';
  partes.push(`<p class="fr-tot cop-dias">${fmtViajes(c.diasEvaluados)} ${plural(c.diasEvaluados, 'día evaluado', 'días evaluados')}${avisoSalidas}</p>`);

  if (!ocS.has('consideraciones') && limpia(op.consideraciones)) {
    partes.push(`<div class="cop-cons"><div class="fr-h cop-h">Consideraciones</div>${parrafos(op.consideraciones, 'cop-pres')}</div>`);
  }
  // El encabezado llega YA ESCAPADO (es el mismo texto del membrete): se pega tal cual.
  const encTitulo = String(encabezado?.titulo ?? '').trim();
  const encEmitida = String(encabezado?.emitida ?? '').trim();
  const enc = encTitulo || encEmitida
    ? `<div class="cop-hoja-enc"><b>${encTitulo}</b>${encEmitida ? `<span><b>Emitida:</b> ${encEmitida}</span>` : ''}</div>`
    : '';
  return `<section class="cop-hoja">${enc}${partes.join('')}</section>`;
}

// ═══════════════════════════ El listado detallado ═══════════════════════════

/** El título del grupo de los renglones sin unidad ni placa. */
const SIN_UNIDAD = 'Sin unidad';
const TITULO_GRUPO_TIPO: Record<TipoMov, string> = { entrada: 'Entradas', interno: 'Movimientos internos', salida: 'Salidas', otro: 'Otros', produccion: 'Producción' };
const ORDEN_TIPO: TipoMov[] = ['entrada', 'interno', 'salida', 'otro', 'produccion'];

/** «Terraza 1 → Terraza 2», o el que haya de los dos, o «—». */
function recorrido(m: Movimiento): string {
  const o = limpia(m.origen), d = limpia(m.destino);
  if (o && d) return `${escPartible(o)} → ${escPartible(d)}`;
  return escPartible(o || d || '—');
}

/**
 * El listado renglón por renglón, agrupado por día (jornada), unidad o tipo, con
 * el subtotal de cada grupo y el total al final. `movs` llega YA filtrado.
 *
 * Quién es de qué unidad lo decide `unidadDeLosRenglones` (la misma regla que el
 * corte). ⭐ `unidadDe` es esa regla armada con la LISTA BASE (todo lo cargado, antes
 * de filtrar), la misma que recibe el corte: pásala siempre, porque armada con el
 * subconjunto filtrado puede no ver el renglón que dice de quién es una placa, y el
 * mismo renglón saldría en otra unidad que en el corte. Si no llega, se arma con `movs`.
 */
export function cuerpoListado(movs: Movimiento[], op: OpcionesPapelCop, unidadDe?: (m: Movimiento) => string): string {
  const oc = new Set<string>(op.ocultosColumnas ?? []);
  const ve = (c: ColumnaCop): boolean => !oc.has(c);

  // Lo que ya dice el título del grupo no se repite en cada renglón (así caben las
  // 13 columnas en la hoja): por día queda solo la hora; por tipo, sin «Tipo»; por
  // unidad, sin «Unidad». No es esconder nada: el dato está en el título.
  const agrupar = op.agruparListado;
  const cols: Col<Movimiento>[] = [
    agrupar === 'dia'
      ? { titulo: 'Hora', celda: (m) => esc(horaCorta(m.hora) || '—') }
      // La fecha es la de la JORNADA (7am a 7am) y la hora es de reloj: un viaje de la
      // jornada del 06 a las 04:30 ocurrió el 07 de madrugada. Por eso se llama «Jornada».
      : { titulo: 'Jornada / hora', celda: (m) => esc([fechaCop(m.fecha), horaCorta(m.hora)].filter(Boolean).join(' ')) },
  ];
  if (agrupar !== 'tipo') cols.push({ titulo: 'Tipo', celda: (m) => esc(ETIQUETA_TIPO[m.tipo] ?? m.tipo) });
  // Unidad y placa van en UNA columna (la placa abajo, chica): con las dos por separado
  // la tabla no cabía en la hoja. Agrupado por unidad, la unidad está en el título y
  // la placa queda sola.
  if (agrupar !== 'unidad') {
    cols.push(ve('placa')
      ? {
        titulo: 'Unidad / placa',
        celda: (m) => {
          const u = limpia(m.unidadTexto), p = limpia(m.placa);
          if (u && p && u !== p) return `${escPartible(u)}<br/><small>${escPartible(p)}</small>`;
          return escPartible(u || p || '—');
        },
      }
      : { titulo: 'Unidad', celda: (m) => escPartible(limpia(m.unidadTexto) || '—') });
  } else if (ve('placa')) {
    cols.push({ titulo: 'Placa', celda: (m) => escPartible(limpia(m.placa) || '—') });
  }
  if (ve('transportista')) cols.push({ titulo: 'Transportista', celda: (m) => escPartible(limpia(m.transportista) || '—') });
  cols.push({ titulo: 'Origen → destino', celda: recorrido });
  cols.push({ titulo: 'Material', celda: (m) => escPartible(limpia(m.material) || '—') });
  if (ve('capacidad')) cols.push({ titulo: 'Cap. m³', num: true, celda: (m) => (typeof m.capacidadM3 === 'number' && isFinite(m.capacidadM3) ? m.capacidadM3.toLocaleString('es-VE', { maximumFractionDigits: 2 }) : '—') });
  // Un por confirmar NO suma: su celda lo dice, aunque la columna de estado esté apagada.
  cols.push({
    titulo: 'Viajes', num: true, celda: (m) => {
      const v = typeof m.viajes === 'number' && isFinite(m.viajes) ? m.viajes : null;
      if (m.estado === 'por_confirmar') return v !== null && v > 0 ? `${fmtViajes(v)} por confirmar` : 'Por confirmar';
      return v === null ? '—' : fmtViajes(v);
    },
  });
  // ⭐ Las PIEZAS (bloques producidos o vendidos; auditoría del lote 5, A4): sin viajes, su
  //    cifra es la cantidad. La columna existe solo si algún renglón la trae (si no, no deja
  //    rastro) y no suma en los subtotales: producción y ventas no se mezclan en una cifra.
  const piezasDe = (m: Movimiento): number | null => (typeof m.cantidad === 'number' && isFinite(m.cantidad) ? m.cantidad : null);
  if (movs.some((m) => piezasDe(m) !== null)) {
    cols.push({ titulo: 'Cantidad', num: true, celda: (m) => { const c = piezasDe(m); return c === null ? '—' : fmtViajes(c); } });
  }
  // Solo lo confirmado tiene peso neto (lo demás no suma, así que tampoco se imprime).
  if (ve('toneladas')) cols.push({ titulo: 'Ton.', num: true, celda: (m) => (m.estado === 'confirmado' && typeof m.toneladas === 'number' && isFinite(m.toneladas) ? fmt2(m.toneladas) : '—') });
  if (ve('m3')) cols.push({ titulo: 'm³', num: true, celda: (m) => { const v = m.estado === 'por_confirmar' ? null : m3De(m); return v === null ? '—' : fmt2(v); } });
  if (ve('estado')) cols.push({ titulo: 'Estado', celda: (m) => esc(ETIQUETA_ESTADO[m.estado] ?? m.estado) });
  if (ve('observaciones')) cols.push({ titulo: 'Observaciones', celda: (m) => escPartible(limpia(m.observacion)) });

  /** La línea de totales de un conjunto: lo apagado no sale ni acá. */
  const lineaTotales = (t: Totales): string => [
    `Viajes: ${esc(textoViajes(t))}`,
    ve('toneladas') ? `Toneladas: ${fmtTon(t.toneladas, t.viajes)}` : '',
    ve('m3') ? `m³: ${fmt2(t.m3)}` : '',
  ].filter(Boolean).join(' · ');
  const totalGeneral = (t: Totales): string =>
    `<p class="fr-tot">Total del listado: ${fmtViajes(t.renglones)} ${plural(t.renglones, 'renglón', 'renglones')} · ${lineaTotales(t)}</p>`;

  if (!movs.length) return `<div class="cop-listado">${LEYENDA_VACIO}${totalGeneral(totalesDe([]))}</div>`;

  // Dentro de cada grupo: por jornada; con hora, en el orden real (7am a 7am); sin hora, al
  // final del día; a igual momento, por cuándo se cargó. ⭐ Es LA regla del orden de la
  // jornada (`cmpMovimientoJornada`, la misma de ✍️ Cargar y 📋 Registros): sin copia acá.
  const enOrden = movs.slice().sort(cmpMovimientoJornada);

  // `propio`: el renglón está VINCULADO a la unidad del grupo (su nombre es el de la flota).
  type Grupo = { clave: string; titulo: string; sinDato: boolean; propio: boolean; filas: Movimiento[] };
  const grupos = new Map<string, Grupo>();
  const deUnidad = op.agruparListado === 'unidad' ? unidadDe ?? unidadDeLosRenglones(movs) : null;
  for (const m of enOrden) {
    let clave: string, titulo: string, sinDato = false, propio = false;
    if (op.agruparListado === 'tipo') {
      clave = m.tipo;
      titulo = TITULO_GRUPO_TIPO[m.tipo] ?? m.tipo;
    } else if (deUnidad) {
      clave = deUnidad(m);
      const placa = ve('placa') ? limpia(m.placa) : '';
      const texto = limpia(m.unidadTexto);
      titulo = texto && placa && texto !== placa ? `${texto} · ${placa}` : texto || placa;
      sinDato = !titulo;
      if (sinDato) titulo = SIN_UNIDAD;
      propio = !!m.unidadId && m.unidadId === clave;
    } else {
      clave = m.fecha;
      titulo = `Jornada del ${fechaCop(m.fecha)}`;
    }
    const g = grupos.get(clave);
    if (!g) grupos.set(clave, { clave, titulo, sinDato, propio, filas: [m] });
    else {
      // El título del grupo: uno con texto antes que «Sin unidad», y el de un renglón
      // vinculado a la unidad antes que el de uno escrito a mano con su placa.
      if (!sinDato && (g.sinDato || (propio && !g.propio))) { g.titulo = titulo; g.sinDato = false; g.propio = propio; }
      g.filas.push(m);
    }
  }

  // ⭐ Por unidad, dos grupos con el MISMO título impreso son UNO: el renglón en blanco y
  //    el escrito «Sin unidad», o dos «Volteo» sueltos con la placa apagada (dos grupos
  //    iguales delataban la placa escondida). Se junta acá, por el título, y no en la regla
  //    de pertenencia (que también usa el selector de unidades de la pantalla).
  let valores = [...grupos.values()];
  if (deUnidad) {
    const posicion = new Map(enOrden.map((m, i) => [m, i]));
    const porTitulo = new Map<string, Grupo>();
    for (const g of valores) {
      const k = normTexto(g.titulo);
      const j = porTitulo.get(k);
      if (!j) porTitulo.set(k, { ...g, filas: g.filas.slice() });
      else j.filas.push(...g.filas);
    }
    valores = [...porTitulo.values()].map((g) => ({
      ...g,
      filas: g.filas.sort((a, b) => (posicion.get(a) ?? 0) - (posicion.get(b) ?? 0)),
      sinDato: g.sinDato || normTexto(g.titulo) === normTexto(SIN_UNIDAD),
    }));
  }
  const lista = valores.map((g) => ({ ...g, t: totalesDe(g.filas) }));
  if (op.agruparListado === 'tipo') {
    lista.sort((a, b) => ORDEN_TIPO.indexOf(a.clave as TipoMov) - ORDEN_TIPO.indexOf(b.clave as TipoMov));
  } else if (op.agruparListado === 'unidad') {
    lista.sort((a, b) => {
      if (a.sinDato !== b.sinDato) return a.sinDato ? 1 : -1;
      return (op.orden === 'cantidad' ? b.t.viajes - a.t.viajes : 0) || cmpAz(a.titulo, b.titulo);
    });
  } // por día ya vienen en orden de fecha

  const bloques = lista.map((g) => {
    // La fila de subtotal lleva solo el número: «18 (+1 pendiente)» en negrita ensanchaba
    // la columna y la tabla se salía de la hoja. Los avisos van junto al título del grupo
    // (con las mismas palabras de `textoViajes`, de donde se toman).
    const conTotales = cols.map((c) => {
      if (c.titulo === 'Viajes') return { ...c, total: fmtViajes(g.t.viajes) };
      if (c.titulo === 'Ton.') return { ...c, total: fmtTon(g.t.toneladas, g.t.viajes) };
      if (c.titulo === 'm³') return { ...c, total: fmt2(g.t.m3) };
      return c;
    });
    const avisos = /\((.*)\)$/.exec(textoViajes(g.t))?.[1] ?? '';
    const derecha = `${fmtViajes(g.filas.length)} ${plural(g.filas.length, 'renglón', 'renglones')}${avisos ? ` · ${avisos}` : ''}`;
    return seccion(g.titulo, tabla(conTotales, g.filas, 'Subtotal'), derecha);
  }).join('');

  return `<div class="cop-listado">${bloques}${totalGeneral(totalesDe(movs))}</div>`;
}

// ═══════════════════════════ El CSS ═══════════════════════════

/**
 * El CSS del cuerpo: el mismo dibujo de tarjetas y tablas que los frentes
 * (`CSS_FRENTES`) más lo propio. Complementa `PDF_BASE_CSS` (que ya repite el
 * encabezado de la tabla en cada hoja y no repite el pie). Las filas no se
 * parten entre hojas; el título de una sección no se queda solo al pie.
 * ⭐ Es el ÚNICO CSS de los papeles del módulo: también el del 📄 Reporte completo (sus
 *    notas `.cop-nota`, el «pendiente de pesaje» `.cop-pdte` y `.cop-completo`), así la
 *    pestaña tiene un solo `pdfDocument` con un solo `extraCss` (PD5b).
 */
export const CSS_COP = CSS_FRENTES + `
  .cop-ficha{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:11px;margin:0 0 10px}
  .cop-ficha b{color:#16324F}
  .cop-pres{font-size:11px;line-height:1.5;margin:0 0 8px;text-transform:none;text-align:justify}
  .cop-sec{margin:0 0 14px}
  .cop-sec:last-child{margin-bottom:0}
  .cop-h{page-break-after:avoid;break-after:avoid}
  thead{display:table-header-group}
  tr{page-break-inside:avoid;break-inside:avoid}
  th.n,td.n{text-align:right;white-space:nowrap}
  th.cop-grupo{text-align:center}
  tr.cop-total td{background:#e3eaf3;font-weight:800;color:#16324F}
  .cop-pc{text-align:center;font-style:italic;color:#9A6700}
  .cop-pend{display:block;font-size:9px;font-style:italic;color:#9A6700;white-space:normal}
  .cop-junto{page-break-inside:avoid;break-inside:avoid}
  .cop-vacio{margin:10px 0;padding:8px 10px;border:1px dashed #c9d2dc;border-radius:6px;font-size:12px;color:#5B6B80;text-align:center}
  .cop-lista{margin:0 0 6px;padding-left:18px;font-size:11px;line-height:1.5}
  .cop-listado table{font-size:8.5px}
  .cop-listado th,.cop-listado td{padding:2px 3px}
  .cop-listado td.n{white-space:normal}
  .cop-dias{margin-top:6px}
  .cop-cons{margin-top:12px;page-break-inside:avoid}
  .cop-hoja+.cop-hoja{page-break-before:always;break-before:page}
  .cop-hoja-enc{display:flex;justify-content:space-between;align-items:baseline;gap:12px;border-bottom:3px solid #16324F;padding:0 0 4px;margin:0 0 10px}
  .cop-hoja-enc>b{font-size:16px;font-weight:800;color:#16324F;letter-spacing:.5px;text-transform:uppercase}
  .cop-hoja-enc span{font-size:11px;color:#333;white-space:nowrap}
  .cop-hoja-enc span b{color:#6B7280}
  .cop-nota{font-size:10.5px;line-height:1.4;color:#5B6B80;margin:2px 0 6px}
  .cop-pdte{color:#9A6700;font-style:italic;white-space:normal}
  .cop-completo table{margin:0 0 6px}
  .cop-completo td small{display:block;font-size:9px;color:#5B6B80;white-space:normal}
  .cop-dif{color:#B42318;font-weight:800}
  .cop-aviso{font-size:10.5px;line-height:1.4;font-weight:700;color:#9A6700;border-left:3px solid #9A6700;padding:2px 0 2px 6px;margin:2px 0 6px}`;
