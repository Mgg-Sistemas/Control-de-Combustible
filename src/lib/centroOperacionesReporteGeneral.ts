// 🏭 CENTRO DE OPERACIONES — LEER EL «REPORTE GENERAL» PEGADO DE WHATSAPP (24-oct-2026).
//
// Todos los días llega por WhatsApp un texto así (estructura; los nombres y las
// cifras cambian de un día a otro, y hay más o menos líneas):
//
//   REPORTE DE VIAJES Y TONELAJE - CDT SITIO - ZONA
//   Fecha de corte: 05/10/2026 (7:00 PM)
//   Viajes Totales: 12
//   Total Neto: 280.50 TNS
//
//   Por Empresa:
//   TRANSPORTISTA UNO: 7 viajes | 160.25 TNS
//   …
//   Por Frente:
//   OBRA NORTE: 6 viajes | 150.00 TNS
//   …
//
// La encargada lo PEGA y esta librería lo reconoce, en vez de teclear renglón por
// renglón. Es PURA: no habla con la base ni con la pantalla (solo importa
// `leerNumero` y `norm`). Pruebas: scripts/test-centro-operaciones-reporte-general.mjs
//
// LAS REGLAS:
//   · Nunca revienta: cualquier cosa (vacío, basura, un texto enorme) devuelve un
//     resultado con sus avisos.
//   · Nada se pierde en silencio: lo que no se entiende va a `lineasNoLeidas`, en
//     su escritura original, para que ella lo vea. Solo se saltan las líneas sin
//     una sola letra ni número (rayas «━━━», emojis sueltos).
//   · Tolera lo que hacen WhatsApp y la gente: CRLF, negritas/cursivas (* _ ~),
//     emojis y viñetas (• ▪️ ➡️ «1.»), espacios de más, tildes y mayúsculas en los
//     encabezados, «viaje/viajes/V», «TNS/TN/Ton/t/toneladas», separadores
//     «| - / :» y el orden toneladas-antes-que-viajes.
//   · Una fila se lee DESDE LA DERECHA: el nombre puede llevar dígitos, guiones,
//     apóstrofos y «&» («LOMA AZUL 2», «DELL'X», «R&X»). El nombre conserva su
//     escritura, solo sin la decoración.
//   · El mismo nombre dos veces en una sección (igual sin tildes ni mayúsculas) se
//     suma, se muestra con la primera escritura y se avisa.
//   · La jornada va de 7 am a 7 am: un corte antes de las 07:00 cuenta para el día
//     anterior, y el de las 07:00 EN PUNTO también (R28, 24-oct-2026): ese corte
//     CIERRA la jornada anterior, no abre la del día escrito.
//   · La fecha de una línea «Fecha / Corte / Hora» manda sobre la del título o una
//     suelta; y una FILA nunca es fecha ni hora («CORTE 2: 13 viajes» no son las 02:13).
//   · Al copiar varios mensajes, el «[06/10/26, 7:05 p. m.] Fulano:» que antepone
//     WhatsApp se quita: esa es la hora del mensaje, no la del corte.
//   · Encabezados desconocidos: «Por Material:» (o un «Algo:» después de la primera
//     sección) abre una sección que no se lee; sus filas quedan a la vista con un
//     aviso, nunca se cuelan en empresas ni frentes.
//
// ⚠️ LAS CIFRAS: «4,321.09» y «4.321,09» se leen igual (leerNumero). Lo ambiguo es
//    «1.500» (un solo signo, tres cifras detrás): si el MISMO reporte escribe en
//    otra parte los miles con ese signo («4.321,09»), son mil quinientos; si no hay
//    pista, manda leerNumero (uno y medio) y el descuadre de la suma lo delata.
//    Los VIAJES son enteros: «1.240 viajes» siempre son mil doscientos cuarenta, y
//    una fila con viajes fraccionarios («2,5 viajes») no se inventa: queda sin leer.
import { leerNumero } from './numeros';
import { norm } from './text';

export type FilaReporteGeneral = { nombre: string; viajes: number; toneladas: number };
export type ReporteGeneral = {
  titulo: string | null;        // la primera línea con sentido
  sitioTexto: string | null;    // lo que va después de «TONELAJE -» en el título
  fecha: string | null;         // 'YYYY-MM-DD' de la «Fecha de corte»
  horaCorte: string | null;     // 'HH:MM' en 24 h
  jornada: string | null;       // día operativo 7am–7am: corte a las 07:00 o antes → fecha − 1 día (R28)
  viajesTotal: number | null;
  toneladasTotal: number | null;
  empresas: FilaReporteGeneral[];
  frentes: FilaReporteGeneral[];
  avisos: string[];             // en español llano, para la persona
  lineasNoLeidas: string[];     // líneas no vacías que no se entendieron
};

// ——— Topes para que un texto enorme no congele la pantalla ———
const MAX_LINEAS = 2000;       // un reporte real trae ~40
const MAX_NO_LEIDAS = 200;     // las demás se cuentan en un aviso
const MAX_LARGO_LINEA = 300;   // más largo no es una línea del reporte (y se muestra recortada)
const MAX_MUESTRA_MILES = 200000;
const TOLERANCIA_TON = 0.01 + 1e-9;

const AVISO_VACIO = 'No hay texto para leer: pega el Reporte General completo.';
const AVISO_NADA = 'Esto no parece un Reporte General: no se encontró la fecha de corte, ni los totales, ni las secciones «Por Empresa» y «Por Frente».';
const AVISO_ERROR = 'No se pudo leer el texto por un error inesperado; revísalo o cárgalo a mano.';

type Miles = '.' | ',' | null;
type SeccionConocida = 'empresas' | 'frentes';

// ============================================================================
// Limpieza de una línea: lo que agrega WhatsApp y no es parte del dato.
// Sin la bandera `u` en las regex (Hermes): los emojis de fuera del plano básico
// se quitan como par sustituto.
// ============================================================================
const RE_TECLA = /[0-9#*]\uFE0F?\u20E3/g;                        // 1️⃣ (se va entero, con su dígito)
const RE_ASTRAL = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;              // 📊 🚛 📅 …
const RE_SIMBOLOS = /[\u00B7\u2022\u2023\u2043\u2219\u2190-\u21FF\u2300-\u23FF\u2460-\u24FF\u2500-\u27BF\u2900-\u297F\u2B00-\u2BFF\u3030\u303D\u3297\u3299]/g; // • ▪ ➡ ⚖ ✅ ━ ⏰ ⭐
const RE_INVISIBLES = /[\uFE00-\uFE0F\u200B-\u200F\u2060-\u2064\uFEFF\u20E3]/g;
const RE_MARCAS = /[*_~`]/g;                                     // negrita, cursiva, tachado, monoespacio
// Al copiar VARIOS mensajes, WhatsApp antepone la fecha, la hora y quién lo mandó:
//   iPhone:  «[06/10/26, 7:05:12 p. m.] Fulano: …»
//   Android: «06/10/26, 7:05 p. m. - Fulano: …»
// Esa fecha es la del MENSAJE, no la del corte: se quita.
const RE_PREFIJO_IPHONE = /^\[\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4},?\s[^\]]{1,30}\]\s?[^:]{1,60}:\s?/;
const RE_PREFIJO_ANDROID = /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4},?\s\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?\s-\s[^:]{1,60}:\s?/i;

function limpiarLinea(linea: string): string {
  return linea
    .replace(RE_TECLA, ' ')
    .replace(RE_ASTRAL, ' ')
    .replace(RE_SIMBOLOS, ' ')
    .replace(RE_INVISIBLES, '')
    .replace(RE_MARCAS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(RE_PREFIJO_IPHONE, '')
    .replace(RE_PREFIJO_ANDROID, '')
    .replace(/^[\s\-\u2013\u2014+>]+/, '')     // viñetas de guion
    .replace(/^\d{1,3}[.)]\s+(?=\S)/, '')       // numeración «1.» «2)»
    .trim();
}

const tieneDato = (s: string): boolean => /[A-Za-z0-9\u00C0-\u024F]/.test(s);
const clave = (s: string): string => norm(s).replace(/\s+/g, ' ').trim();
const pad2 = (n: number): string => String(n).padStart(2, '0');
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

// ============================================================================
// Cifras
// ============================================================================
/** ¿Qué signo usa ESTE reporte para los miles? Solo votan las cifras que no dejan
 *  duda: «4.321,09», «1,234.50», «1.234.567». Una fecha «05.10.2026» no vota. */
function detectarMiles(texto: string): Miles {
  const s = texto.length > MAX_MUESTRA_MILES ? texto.slice(0, MAX_MUESTRA_MILES) : texto;
  const re = /\d+(?:[.,]\d+)+/g;
  let punto = 0, coma = 0, vueltas = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) && vueltas++ < 5000) {
    const t = m[0];
    if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(t) || /^\d{1,3}(?:\.\d{3}){2,}$/.test(t)) punto++;
    else if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(t) || /^\d{1,3}(?:,\d{3}){2,}$/.test(t)) coma++;
  }
  return punto > coma ? '.' : coma > punto ? ',' : null;
}

function leerCifra(tok: string, miles: Miles): number {
  if (miles) {
    const re = miles === '.' ? /^\d{1,3}(?:\.\d{3})+$/ : /^\d{1,3}(?:,\d{3})+$/;
    if (re.test(tok)) return Number(tok.split(miles).join(''));
  }
  return leerNumero(tok);
}

/** Los viajes son enteros: «1.240» son mil doscientos cuarenta. Fraccionario → null. */
function leerViajes(tok: string, miles: Miles): number | null {
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(tok)) return Number(tok.replace(/[.,]/g, ''));
  const n = leerCifra(tok, miles);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function fmtEntero(n: number): string {
  const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return n < 0 ? '-' + s : s;
}

/** 4321.09 → «4.321,09» (como se escribe en Venezuela), sin depender de Intl. */
function fmtTon(n: number): string {
  const [ent, dec] = Math.abs(n).toFixed(2).split('.');
  const s = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec;
  return n < 0 ? '-' + s : s;
}

// ============================================================================
// Encabezados de sección
// ============================================================================
function textoEncabezado(n: string): string {
  return n.replace(/\(\s*\d+\s*\)/g, ' ').replace(/[:.;,|=>\-\u2013\u2014]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const PREFIJO_ENC = '^(?:(?:resumen|detalle|desglose|totales?|viajes|tonelaje)\\s+)?(?:por\\s+)?';
const RE_ENC_EMPRESAS = new RegExp(PREFIJO_ENC + '(?:empresas?|transportistas?|contratistas?|proveedor(?:es)?|compañias?|companias?)(?:\\s+de\\s+[a-zñ]+)?$');
const RE_ENC_FRENTES = new RegExp(PREFIJO_ENC + '(?:frentes?|obras?|procedencias?|origen(?:es)?)(?:\\s+de\\s+[a-zñ]+)?$');

function encabezadoConocido(n: string): SeccionConocida | null {
  const h = textoEncabezado(n);
  // Con «por» se admite una palabra de más al final: «Por Empresas Transportistas»,
  // «Por Frente de Trabajo Norte». Sin «por», no: «EMPRESA UNO» no es un encabezado.
  const candidatos = /^(?:[a-zñ]+\s)?por\s/.test(h) ? [h, h.replace(/\s[a-zñ]+$/, '')] : [h];
  for (const t of candidatos) {
    if (RE_ENC_EMPRESAS.test(t)) return 'empresas';
    if (RE_ENC_FRENTES.test(t)) return 'frentes';
  }
  return null;
}

// ============================================================================
// Totales: «Viajes Totales: 12», «Total Neto: 280.50 TNS», «Total viajes: 1.240»…
// La etiqueta solo puede tener palabras de este vocabulario (así «OBRA NORTE: 6»
// nunca pasa por un total).
// ============================================================================
const RE_TOTAL = /^([a-zñ°º#.\s]+?)\s?[:=\-\u2013\u2014]*\s?(\d+(?:[.,]\d+)*)\s?([a-zñ]+)?\.?\s?$/;
const PALABRAS_TOTAL = new Set([
  'total', 'totales', 'general', 'neto', 'neta', 'netos', 'netas', 'de', 'del', 'el', 'la', 'los', 'las', 'dia',
  'cantidad', 'numero', 'nro', 'n', 'no', 'n°', 'nº', 'viaje', 'viajes', 'vjs', 'toneladas', 'tonelada', 'tonelaje',
  'tns', 'tn', 'ton', 'tons', 'tm', 'peso', 'acumulado', 'acumulados', 'realizados', 'transportadas', 'transportados',
  'recibidos', 'recibidas',
]);
const PAL_VIAJES = new Set(['viaje', 'viajes', 'vjs']);
const PAL_TON = new Set(['toneladas', 'tonelada', 'tonelaje', 'tns', 'tn', 'ton', 'tons', 'tm', 'neto', 'neta', 'netos', 'netas', 'peso']);
const RE_UNI_VIAJES = /^(?:viajes?|vjes?|vjs?|v)$/;
const RE_UNI_TON = /^(?:toneladas?|tons?|tns?|tn|tm|t)$/;
const NOMBRES_TOTAL = new Set(['total', 'totales', 'total general', 'totales generales', 'gran total', 'subtotal', 'sub total', 'total neto']);

function leerTotal(n: string): { tipo: 'viajes' | 'toneladas'; tok: string } | null {
  const m = RE_TOTAL.exec(n);
  if (!m) return null;
  const palabras = m[1].replace(/[.#]/g, ' ').split(/\s+/).filter(Boolean);
  if (!palabras.length || !palabras.every((p) => PALABRAS_TOTAL.has(p))) return null;
  const unidad = m[3] || '';
  if (unidad && !RE_UNI_VIAJES.test(unidad) && !RE_UNI_TON.test(unidad)) return null;
  const v = palabras.some((p) => PAL_VIAJES.has(p));
  const t = palabras.some((p) => PAL_TON.has(p));
  let tipo: 'viajes' | 'toneladas' | null = v && !t ? 'viajes' : t && !v ? 'toneladas' : null;
  if (!v && !t) tipo = RE_UNI_VIAJES.test(unidad) ? 'viajes' : RE_UNI_TON.test(unidad) ? 'toneladas' : null;
  return tipo ? { tipo, tok: m[2] } : null;
}

// ============================================================================
// Filas: «NOMBRE: N viajes | X TNS» (o toneladas primero), leídas desde la derecha.
// El número de viajes tiene que ir pegado a su unidad: eso separa «LOMA AZUL 2»
// de «16 viajes». Las líneas ya vienen con un solo espacio entre palabras.
// ============================================================================
const NUM = '(\\d+(?:[.,]\\d+)*)';
const SEP_NOMBRE = '(?:\\s?[:|=/\\-\\u2013\\u2014>]+\\s?|\\s)';
const SEP_MEDIO = '\\s?[|/\\-\\u2013\\u2014,;:]*\\s?\\(?\\s?';
const UNI_V = '(?:viajes?|vjes?|vjs?|v)\\.?';
const UNI_T = '(?:toneladas?|tons?|tns?|tn|tm|t)\\.?';
const RE_FILA_VT = new RegExp(`^(.*?\\S)${SEP_NOMBRE}${NUM}\\s?${UNI_V}${SEP_MEDIO}${NUM}\\s?(?:${UNI_T})?\\s?\\)?$`, 'i');
const RE_FILA_TV = new RegExp(`^(.*?\\S)${SEP_NOMBRE}${NUM}\\s?${UNI_T}${SEP_MEDIO}${NUM}\\s?${UNI_V}\\s?\\)?$`, 'i');

function leerFila(c: string, miles: Miles): FilaReporteGeneral | null {
  let nombre = '', tokV = '', tokT = '';
  const vt = RE_FILA_VT.exec(c);
  if (vt) { nombre = vt[1]; tokV = vt[2]; tokT = vt[3]; }
  else {
    const tv = RE_FILA_TV.exec(c);
    if (!tv) return null;
    nombre = tv[1]; tokT = tv[2]; tokV = tv[3];
  }
  nombre = nombre.replace(/[\s:|=/\-\u2013\u2014>,;]+$/, '').trim();
  if (!tieneDato(nombre)) return null;
  const viajes = leerViajes(tokV, miles);
  if (viajes === null) return null;
  return { nombre, viajes, toneladas: leerCifra(tokT, miles) };
}

// ============================================================================
// Fecha y hora de corte
// ============================================================================
const MESES: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
const RE_FECHA_ISO = /(^|\D)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/;
const RE_FECHA_DMY = /(^|\D)(\d{1,2})\s?[/\-.]\s?(\d{1,2})\s?[/\-.]\s?(\d{4}|\d{2})(?!\d)/;
const RE_FECHA_LARGA = /(^|\D)(\d{1,2})\s(?:de\s)?(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*\.?\s(?:del?\s)?(\d{4})(?!\d)/;

function isoValido(a: number, m: number, d: number): string | null {
  if (a < 1900 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(a, m, 0)).getUTCDate()) return null;
  return `${a}-${pad2(m)}-${pad2(d)}`;
}

type FechaLeida = { iso: string | null; avisos: string[]; resto: string };

function buscarFecha(n: string): FechaLeida | null {
  const quitar = (m: RegExpExecArray) => n.slice(0, m.index) + m[1] + ' ' + n.slice(m.index + m[0].length);
  const escrito = (m: RegExpExecArray) => m[0].slice(m[1].length).trim();
  let m = RE_FECHA_ISO.exec(n);
  if (m) {
    const iso = isoValido(+m[2], +m[3], +m[4]);
    return { iso, avisos: iso ? [] : [`La fecha «${escrito(m)}» no existe en el calendario; revísala.`], resto: quitar(m) };
  }
  m = RE_FECHA_DMY.exec(n) || RE_FECHA_LARGA.exec(n);
  if (!m) return null;
  let d = +m[2];
  let mes = MESES[m[3]] ?? +m[3];
  const a = m[4].length === 2 ? 2000 + +m[4] : +m[4];
  const avisos: string[] = [];
  if (mes > 12 && d >= 1 && d <= 12 && !MESES[m[3]]) {
    // Escrita al estilo de EE. UU. (mes/día): se voltea y se avisa.
    [d, mes] = [mes, d];
    if (isoValido(a, mes, d)) avisos.push(`La fecha venía como mes/día (${escrito(m)}); se leyó como ${pad2(d)}/${pad2(mes)}/${a}.`);
  }
  const iso = isoValido(a, mes, d);
  if (!iso) avisos.push(`La fecha «${escrito(m)}» no existe en el calendario; revísala.`);
  return { iso, avisos, resto: quitar(m) };
}

const RE_HORA_12 = /(^|\D)(\d{1,2})\s?[:.h]\s?(\d{2})\s?(?:hrs?\.?\s?|h\s?)?([ap])\s?\.?\s?m(?![a-zñ])/;
const RE_HORA_12_SOLA = /(^|\D)(\d{1,2})\s?([ap])\s?\.?\s?m(?![a-zñ])/;
const RE_HORA_24 = /(^|\D)(\d{1,2})\s?[:h]\s?(\d{2})(?!\d)/;
const RE_HORA_HRS = /(^|\D)(\d{1,2})\s?(?:hrs?|horas)(?![a-zñ])/;

function armarHora(h: number, mi: number, ap: string | null): string | null {
  if (mi > 59 || h > 23) return null;
  if (ap && h <= 12) h = (h % 12) + (ap === 'p' ? 12 : 0); // «19:00 PM» se queda en 19
  return `${pad2(h)}:${pad2(mi)}`;
}

/** «7:00 PM», «7 PM», «7:00 p. m.», «19:00», «7pm», «19 hrs» → 'HH:MM'. */
function buscarHora(s: string): string | null {
  let m = RE_HORA_12.exec(s);
  if (m) return armarHora(+m[2], +m[3], m[4]);
  m = RE_HORA_12_SOLA.exec(s);
  if (m) return armarHora(+m[2], 0, m[3]);
  m = RE_HORA_24.exec(s);
  if (m) return armarHora(+m[2], +m[3], null);
  m = RE_HORA_HRS.exec(s);
  if (m) return armarHora(+m[2], 0, null);
  return null;
}

function diaAnterior(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d - 1));
  return `${f.getUTCFullYear()}-${pad2(f.getUTCMonth() + 1)}-${pad2(f.getUTCDate())}`;
}

// ============================================================================
// Lectura
// ============================================================================
function vacio(): ReporteGeneral {
  return {
    titulo: null, sitioTexto: null, fecha: null, horaCorte: null, jornada: null, viajesTotal: null, toneladasTotal: null,
    empresas: [], frentes: [], avisos: [], lineasNoLeidas: [],
  };
}

function sumar(filas: FilaReporteGeneral[]): { viajes: number; toneladas: number } {
  let viajes = 0, toneladas = 0;
  for (const f of filas) { viajes += Number(f.viajes) || 0; toneladas += Number(f.toneladas) || 0; }
  return { viajes, toneladas: r3(toneladas) };
}

const NOMBRE_SECCION: Record<SeccionConocida, { titulo: string; en: string; quien: string; de: string }> = {
  empresas: { titulo: '«Por Empresa»', en: 'en las empresas', quien: 'Las empresas', de: 'de las empresas' },
  frentes: { titulo: '«Por Frente»', en: 'en los frentes', quien: 'Los frentes', de: 'de los frentes' },
};

function diferenciaViajes(d: number): string {
  const n = Math.abs(d);
  const verbo = d > 0 ? 'falta' : 'sobra';
  return n === 1 ? `${verbo} 1 viaje` : `${verbo}n ${fmtEntero(n)} viajes`;
}

function diferenciaToneladas(d: number): string {
  const n = Math.abs(d);
  const verbo = d > 0 ? 'falta' : 'sobra';
  return n === 1 ? `${verbo} 1,00 tonelada` : `${verbo}n ${fmtTon(n)} toneladas`;
}

function leerSinRed(texto: unknown): ReporteGeneral {
  const r = vacio();
  const fuente = typeof texto === 'string' ? texto : typeof texto === 'number' ? String(texto) : '';
  const miles = detectarMiles(fuente);
  const crudas = fuente.split(/\r\n|\r|\n|\u2028|\u2029/);
  const lineas = crudas.length > MAX_LINEAS ? crudas.slice(0, MAX_LINEAS) : crudas;

  let seccion: SeccionConocida | 'desconocida' | null = null;
  const vio = { empresas: false, frentes: false };
  const filas: Record<SeccionConocida, Map<string, { fila: FilaReporteGeneral; veces: number }>> = {
    empresas: new Map(), frentes: new Map(),
  };
  // De dónde salió la fecha (y la hora): 0 = de ningún lado · 1 = del título o de
  // una línea suelta · 2 = de una línea «Fecha / Corte / Hora». La de más rango manda.
  let prioFecha = 0, prioHora = 0, algunaLinea = false;
  let avisosDeLaFecha: string[] = [];
  let totalesLeidos = { viajes: false, toneladas: false };
  const dobleAvisado = { viajes: false, toneladas: false };
  const avisosSueltos: string[] = [];
  let noLeidasDeMas = 0;

  const noLeida = (cruda: string) => {
    if (r.lineasNoLeidas.length >= MAX_NO_LEIDAS) { noLeidasDeMas++; return; }
    const t = cruda.trim();
    r.lineasNoLeidas.push(t.length > MAX_LARGO_LINEA ? t.slice(0, MAX_LARGO_LINEA) + '…' : t);
  };

  /** Toma la fecha y/o la hora de la línea si no se tenían, o si las que había
   *  venían de una fuente de menos rango. Devuelve true si la línea aportó algo. */
  const tomarFechaHora = (n: string, exigirFecha: boolean, prio: 1 | 2): boolean => {
    const f = buscarFecha(n);
    if (exigirFecha && !f) return false;
    const h = buscarHora(f ? f.resto : n);
    let aporto = false;
    if (f && prio > prioFecha) {
      // La hora que vino con una fecha de OTRO día no se arrastra a la nueva.
      if (prioHora > 0 && prioHora < prio && r.fecha !== f.iso) { r.horaCorte = null; prioHora = 0; }
      prioFecha = prio;
      r.fecha = f.iso;
      avisosDeLaFecha = f.avisos;
      aporto = true;
    }
    if (h && prio > prioHora && (aporto || !f)) {
      prioHora = prio;
      r.horaCorte = h;
      aporto = true;
    }
    return aporto;
  };

  const asignarTotal = (tipo: 'viajes' | 'toneladas', valor: number) => {
    totalesLeidos = { ...totalesLeidos, [tipo]: true };
    const actual = tipo === 'viajes' ? r.viajesTotal : r.toneladasTotal;
    if (actual === null) {
      if (tipo === 'viajes') r.viajesTotal = valor; else r.toneladasTotal = valor;
      return;
    }
    const iguales = tipo === 'viajes' ? actual === valor : Math.abs(actual - valor) <= TOLERANCIA_TON;
    if (iguales || dobleAvisado[tipo]) return;
    dobleAvisado[tipo] = true;
    const fmt = tipo === 'viajes' ? fmtEntero : fmtTon;
    avisosSueltos.push(`El reporte trae dos totales de ${tipo} distintos (${fmt(actual)} y ${fmt(valor)}); se usó el primero.`);
  };

  for (const cruda of lineas) {
    const c = limpiarLinea(cruda);
    if (!c || !tieneDato(c)) continue; // vacía o pura decoración («━━━», un emoji suelto)
    const esPrimera = !algunaLinea;
    algunaLinea = true;
    if (c.length > MAX_LARGO_LINEA) { noLeida(cruda); continue; }
    const n = norm(c);

    // 1. Encabezado de sección conocido.
    const enc = encabezadoConocido(n);
    if (enc) { seccion = enc; vio[enc] = true; continue; }

    const total = leerTotal(n);
    const fila = total ? null : leerFila(c, miles);
    const h = textoEncabezado(n);
    const porDesconocido = !/\d/.test(h) && /^por\s+[a-zñ]/.test(h) && h.split(' ').length <= 6;

    // 2. El título: la primera línea con sentido (si no es fecha, total, fila ni sección).
    if (esPrimera && !total && !fila && !porDesconocido && !/^(?:fecha|corte|hora|dia)\b/.test(n)) {
      r.titulo = c;
      const sitio = /tonelaje\s?[-\u2013\u2014:|]+\s?(.+)$/i.exec(c);
      r.sitioTexto = sitio ? sitio[1].trim() || null : null;
      tomarFechaHora(n, true, 1);
      continue;
    }

    // 3. Fecha / hora de corte. Una fila nunca lo es: «CORTE 2: 13 viajes» no es la hora 02:13.
    if (!fila && /\b(?:fecha|corte|hora|dia)\b/.test(n) && tomarFechaHora(n, false, 2)) continue;

    // 4. Totales.
    if (total) {
      const valor = total.tipo === 'viajes' ? leerViajes(total.tok, miles) : leerCifra(total.tok, miles);
      if (valor !== null) { asignarTotal(total.tipo, valor); continue; }
      noLeida(cruda);
      continue;
    }

    // 5. Filas.
    if (fila) {
      if (NOMBRES_TOTAL.has(clave(fila.nombre))) { // «TOTAL: 12 viajes | 280.50 TNS»
        asignarTotal('viajes', fila.viajes);
        asignarTotal('toneladas', fila.toneladas);
        continue;
      }
      if (seccion === 'empresas' || seccion === 'frentes') {
        const mapa = filas[seccion];
        const k = clave(fila.nombre);
        const previa = mapa.get(k);
        if (previa) {
          previa.fila.viajes += fila.viajes;
          previa.fila.toneladas = r3(previa.fila.toneladas + fila.toneladas);
          previa.veces++;
        } else mapa.set(k, { fila, veces: 1 });
        continue;
      }
      noLeida(cruda); // antes de la primera sección, o dentro de una que no se conoce
      continue;
    }

    // 6. Una sección que no se conoce («Por Material:», «Observaciones:»): sus líneas quedan a la vista.
    //    Un «Algo:» suelto solo cuenta como sección después de la primera (antes, un
    //    saludo como «Buenos días:» es solo una línea sin leer).
    const dosPuntosDesconocido = seccion !== null && !/\d/.test(c) && /:\s*$/.test(c) && h.split(' ').length <= 5;
    if (porDesconocido || dosPuntosDesconocido) {
      seccion = 'desconocida';
      avisosSueltos.push(`La sección «${c.replace(/[\s:]+$/, '')}» no se reconoce; sus líneas quedan sin leer.`);
      noLeida(cruda);
      continue;
    }

    // 7. Una fecha suelta antes de las secciones («05/10/2026 7:00 PM»).
    if (seccion === null && prioFecha === 0 && tomarFechaHora(n, true, 1)) continue;

    noLeida(cruda);
  }

  if (!algunaLinea) { r.avisos.push(AVISO_VACIO); return r; }

  r.empresas = [...filas.empresas.values()].map((x) => x.fila);
  r.frentes = [...filas.frentes.values()].map((x) => x.fila);

  // ——— Jornada (7 am a 7 am) ———
  // R28: el corte de las 07:00 en punto cierra la jornada anterior (por eso «<=»).
  r.jornada = r.fecha ? (r.horaCorte !== null && r.horaCorte <= '07:00' ? diaAnterior(r.fecha) : r.fecha) : null;

  const avisosCola: string[] = [];
  if (crudas.length > MAX_LINEAS) {
    avisosCola.push(`El texto es muy largo: solo se leyeron las primeras ${fmtEntero(MAX_LINEAS)} líneas (quedaron ${fmtEntero(crudas.length - MAX_LINEAS)} sin revisar).`);
  }
  if (noLeidasDeMas > 0) {
    avisosCola.push(noLeidasDeMas === 1
      ? 'Hay 1 línea más sin leer que no se muestra.'
      : `Hay ${fmtEntero(noLeidasDeMas)} líneas más sin leer que no se muestran.`);
  }

  const nadaReconocido = prioFecha === 0 && prioHora === 0 && !totalesLeidos.viajes && !totalesLeidos.toneladas
    && !vio.empresas && !vio.frentes && !r.empresas.length && !r.frentes.length;
  if (nadaReconocido) { r.avisos = [AVISO_NADA, ...avisosCola]; return r; }

  // ——— Fecha y hora ———
  const avisosFecha = [...avisosDeLaFecha];
  if (prioFecha === 0) avisosFecha.push('No se encontró la fecha de corte.');
  if (r.horaCorte === null) {
    avisosFecha.push(r.fecha ? 'No se encontró la hora de corte; la jornada se tomó igual a la fecha.' : 'No se encontró la hora de corte.');
  }

  // ——— Totales que faltan: se toman de las filas ———
  const avisosTotales: string[] = [];
  const base: SeccionConocida | null = r.empresas.length ? 'empresas' : r.frentes.length ? 'frentes' : null;
  const sumaBase = base ? sumar(r[base]) : null;
  if (r.viajesTotal === null) {
    if (base && sumaBase) {
      r.viajesTotal = sumaBase.viajes;
      avisosTotales.push(`El reporte no trae los viajes totales; se usó la suma ${NOMBRE_SECCION[base].de}: ${fmtEntero(sumaBase.viajes)}.`);
    } else avisosTotales.push('El reporte no trae los viajes totales.');
  }
  if (r.toneladasTotal === null) {
    if (base && sumaBase) {
      r.toneladasTotal = sumaBase.toneladas;
      avisosTotales.push(`El reporte no trae el total de toneladas; se usó la suma ${NOMBRE_SECCION[base].de}: ${fmtTon(sumaBase.toneladas)}.`);
    } else avisosTotales.push('El reporte no trae el total de toneladas.');
  }

  // ——— Secciones que faltan o vienen vacías ———
  const avisosSecciones: string[] = [];
  if (!vio.empresas && !vio.frentes) avisosSecciones.push('No se encontraron las secciones «Por Empresa» ni «Por Frente».');
  else {
    for (const s of ['empresas', 'frentes'] as SeccionConocida[]) {
      if (!vio[s]) avisosSecciones.push(`No se encontró la sección ${NOMBRE_SECCION[s].titulo}.`);
      else if (!r[s].length) avisosSecciones.push(`La sección ${NOMBRE_SECCION[s].titulo} no trae ninguna línea.`);
    }
  }

  // ——— ¿Cada sección suma el total? ———
  const avisosSumas: string[] = [];
  for (const s of ['empresas', 'frentes'] as SeccionConocida[]) {
    if (!r[s].length) continue;
    const suma = sumar(r[s]);
    const quien = NOMBRE_SECCION[s].quien;
    if (r.viajesTotal !== null && suma.viajes !== r.viajesTotal) {
      avisosSumas.push(`${quien} suman ${fmtEntero(suma.viajes)} viajes, pero el total dice ${fmtEntero(r.viajesTotal)}: ${diferenciaViajes(r.viajesTotal - suma.viajes)}.`);
    }
    if (r.toneladasTotal !== null && Math.abs(suma.toneladas - r.toneladasTotal) > TOLERANCIA_TON) {
      avisosSumas.push(`${quien} suman ${fmtTon(suma.toneladas)} toneladas, pero el total dice ${fmtTon(r.toneladasTotal)}: ${diferenciaToneladas(r3(r.toneladasTotal - suma.toneladas))}.`);
    }
  }

  // ——— Nombres repetidos ———
  const avisosRepetidos: string[] = [];
  for (const s of ['empresas', 'frentes'] as SeccionConocida[]) {
    for (const { fila, veces } of filas[s].values()) {
      if (veces > 1) avisosRepetidos.push(`«${fila.nombre}» aparece ${veces} veces ${NOMBRE_SECCION[s].en}; se sumaron sus viajes y toneladas.`);
    }
  }

  r.avisos = [...avisosFecha, ...avisosTotales, ...avisosSecciones, ...avisosSumas, ...avisosRepetidos, ...avisosSueltos, ...avisosCola];
  return r;
}

/** Lee el Reporte General pegado de WhatsApp. Nunca lanza: ante cualquier texto
 *  devuelve un resultado, con avisos y las líneas que no entendió. */
export function leerReporteGeneral(texto: string): ReporteGeneral {
  try {
    return leerSinRed(texto);
  } catch {
    const r = vacio();
    r.avisos.push(AVISO_ERROR);
    return r;
  }
}

/** ¿Cuadra? Empresas y frentes suman, cada uno, los viajes totales (exacto) y las
 *  toneladas totales (±0,01). Sin totales no cuadra. */
export function reporteCuadra(r: ReporteGeneral): boolean {
  try {
    if (!r || r.viajesTotal == null || r.toneladasTotal == null) return false;
    const viajesTotal = r.viajesTotal, toneladasTotal = r.toneladasTotal;
    const sumaBien = (filas: FilaReporteGeneral[]) => {
      if (!Array.isArray(filas)) return false;
      const s = sumar(filas);
      return s.viajes === viajesTotal && Math.abs(s.toneladas - toneladasTotal) <= TOLERANCIA_TON;
    };
    return sumaBien(r.empresas) && sumaBien(r.frentes);
  } catch {
    return false;
  }
}
