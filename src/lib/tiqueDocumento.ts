// EL TIQUE IMPRESO · el papel que se le entrega al camionero (12-sep-2026).
//
// Pedido del cliente: «cuando marcan el viaje, deben dar el ticket», y que el
// papel traiga la placa, la empresa y el CDT donde lo imprimieron.
//
// ⭐ ESTE ARCHIVO NO TOCA LA BASE NI LA PANTALLA. Recibe datos ya resueltos y
//    devuelve HTML. Así se prueba entero sin red y sin navegador, que es lo
//    único que permite verificar un papel que en producción sale de una
//    tiquetera térmica que nadie de nosotros tiene enfrente.
//
// ⚠️ LO QUE ENTRA ES TEXTO DE CAMPO Y VA A UN DOCUMENTO. La nota y el nombre del
//    chofer los escribe una persona en un teléfono; si trae un `<` el documento
//    se rompe callado y el tique sale a medias o en blanco. Todo pasa por
//    `escapar()`, sin excepción. No es paranoia de seguridad: es que un tique
//    en blanco no se nota hasta que ya se entregó.
import {
  CAMPOS_TIQUE, LOGOS_TIQUE, PAPELES,
  type ClaveCampo, type ClaveLogo, type PapelTique, type TiqueConfig,
} from './tiqueConfig';

/** Los datos ya resueltos de UN viaje, listos para imprimir. Todo texto: quien
 *  llama ya decidió cómo se escribe una fecha y cuántos decimales lleva un m³. */
export type DatosTique = Partial<Record<ClaveCampo, string | null>>;

/** Un tique con lo que hace falta saber ADEMÁS de sus datos para imprimirlo. */
export type TiqueParaImprimir = {
  datos: DatosTique;
  /**
   * ⚠️ ESTO TIENE QUE SALIR EN EL PAPEL, no solo en la base.
   *
   * Si un tique se imprime dos veces existen DOS papeles con el mismo número
   * dando vueltas por el CDT, y al cobrar los dos se cuentan como dos viajes.
   * La base ya sabe cuál es la reimpresión, pero la base no está en el patio.
   * El papel tiene que decirlo solo.
   */
  reimpresion?: boolean;
};

/** Lo que se pinta cuando el dato no existe. Una raya, igual que en `tique.ts`. */
export const SIN_DATO_PAPEL = '—';

const limpio = (v: unknown): string => String(v ?? '').trim();

/**
 * ESCAPA PARA HTML. Los cinco de siempre.
 *
 * El apóstrofo y la comilla van incluidos aunque acá nada se meta dentro de un
 * atributo: el día que alguien arme un `title="..."` con un dato, no va a
 * acordarse de volver a esta función.
 */
export function escapar(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * QUÉ RENGLONES LLEVA EL PAPEL.
 *
 * ⭐ ESTA ES LA ÚNICA FUENTE. La usa el papel Y la usa la vista previa de la
 *    pantalla de configuración. Si fueran dos listas, el admin marcaría los
 *    checks mirando una cosa y saldría impresa otra, y se daría cuenta cuando
 *    ya hubiera entregado doscientos tiques.
 *
 * ⚠️ UN CAMPO ENCENDIDO SIN DATO SALE CON RAYA, NO DESAPARECE. Y es a propósito,
 *    por dos motivos. Uno: el admin encendió ese check, así que quiere ver ese
 *    renglón; si le molesta ver «NOTA —» lo apaga, que para eso está el check.
 *    Dos: con 2, 4 o 6 tiques por hoja los recuadros tienen que medir todos
 *    igual o las líneas de corte dejan de cuadrar entre columnas.
 */
export function renglonesDelTique(d: DatosTique, c: TiqueConfig): { k: string; v: string }[] {
  return CAMPOS_TIQUE
    .filter((campo) => c.campos[campo.k])
    .map((campo) => ({ k: campo.corto, v: limpio(d[campo.k]) || SIN_DATO_PAPEL }));
}

/**
 * LAS MEDIDAS DE CADA PAPEL.
 *
 * `porHoja` es cuántos tiques entran en una página. En rollo es 1 y no es una
 * simplificación: una tiquetera corta al final de cada página, así que un tique
 * por página ES el corte entre un camionero y el siguiente.
 *
 * `anchoMm` de los rollos es el papel MENOS los márgenes de impresión (80→72,
 * 58→50). Poner el ancho completo hace que la tiquetera coma el borde derecho
 * de cada renglón, y eso se descubre imprimiendo, no leyendo.
 */
export const MEDIDAS: Record<PapelTique, { porHoja: number; rollo: boolean; anchoMm: number; altoMm: number | null; cols: number }> = {
  rollo80: { porHoja: 1, rollo: true,  anchoMm: 72,  altoMm: null, cols: 1 },
  rollo58: { porHoja: 1, rollo: true,  anchoMm: 50,  altoMm: null, cols: 1 },
  // Carta = 216 × 279 mm. Con 10 mm de margen quedan 196 × 259 útiles.
  carta1:  { porHoja: 1, rollo: false, anchoMm: 196, altoMm: 259,       cols: 1 },
  carta2:  { porHoja: 2, rollo: false, anchoMm: 196, altoMm: 259 / 2,   cols: 1 },
  carta4:  { porHoja: 4, rollo: false, anchoMm: 98,  altoMm: 259 / 2,   cols: 2 },
  carta6:  { porHoja: 6, rollo: false, anchoMm: 98,  altoMm: 259 / 3,   cols: 2 },
};

/** Cuántos tiques entran en una página con este papel. */
export function tiquesPorHoja(papel: PapelTique): number {
  return MEDIDAS[papel]?.porHoja ?? 1;
}

/**
 * CÓMO SE IMPRIMIÓ, para la constancia que queda en la base.
 *
 * No es cosmético: «lo sacó la tiquetera en el momento» y «lo sacaron en una
 * hoja para repartir después» son dos formas distintas de entregar, y cuando
 * falte un tique la primera pregunta va a ser cuál de las dos fue.
 */
export function medioDeImpresion(papel: PapelTique): 'tiquetera' | 'hoja' {
  return MEDIDAS[papel]?.rollo ? 'tiquetera' : 'hoja';
}

/** Cuántas hojas van a salir de la impresora. Se le dice ANTES de mandar: nadie
 *  quiere enterarse de que eran 60 hojas cuando ya están saliendo. */
export function hojasQueSalen(cuantos: number, papel: PapelTique): number {
  const porHoja = tiquesPorHoja(papel);
  return Math.max(0, Math.ceil(cuantos / porHoja));
}

/** Parte la lista en páginas. Se hace acá y no con `page-break` automático
 *  porque el navegador reparte a ojo cuando los recuadros no llenan la hoja y
 *  deja el último de una página arriba de la siguiente. */
export function enHojas<T>(lista: T[], papel: PapelTique): T[][] {
  const n = tiquesPorHoja(papel);
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

// ── CUÁNTO ENTRA EN EL PAPEL ────────────────────────────────────────────────
//
// ⭐ ESTA SECCIÓN EXISTE POR UN TIQUE CORTADO. Mirando el papel de prueba
//    apareció lo que ninguna prueba de texto iba a ver: con los 16 datos
//    encendidos y 4 por hoja, el recuadro se llenaba y el navegador cortaba lo
//    que sobraba — se perdían el estado, la nota Y la línea de la firma. Un
//    tique sin firma no sirve para lo que se hizo, y peor todavía: se cortaba
//    EN SILENCIO, así que nadie se enteraba hasta tener el fajo en la mano.
//
// La salida no es «que quepa a la fuerza» ni «que se corte»: es CALCULAR el
// tamaño de letra que hace que entre, y avisar cuando ni el más chico alcanza.

/** Un punto tipográfico en milímetros. 72 pt = 1 pulgada = 25,4 mm. */
const PT_A_MM = 25.4 / 72;

/** El piso. Por debajo de esto el papel no se lee parado en el patio, con sol y
 *  con las manos sucias, que es donde se lee de verdad. Antes que achicar más
 *  se avisa y se deja que el admin decida. */
export const PT_MINIMO = 6;
/** El techo. Más grande no mejora nada y desperdicia papel del rollo. */
export const PT_MAXIMO = 11;

/**
 * ALTO ESTIMADO DE UN TIQUE, en milímetros.
 *
 * ⚠️ ES UNA ESTIMACIÓN Y ESTÁ HECHA PARA QUEDARSE CORTA. Cada pedazo se calcula
 *    con su tamaño de letra por su interlineado más su margen, igual que en el
 *    CSS de más abajo — si los dos se separan, el cálculo miente. Errar hacia
 *    «ocupa más de lo que ocupa» deja letra un punto más chica de lo necesario;
 *    errar al revés vuelve a cortar el papel, que es lo que se está arreglando.
 */
export function altoDelTique(
  base: number,
  renglones: number,
  opts: { logos: boolean; reimpresion: boolean; rollo: boolean },
): number {
  const linea = (pt: number) => pt * 1.35 * PT_A_MM;
  const padding = opts.rollo ? 2 * 2 : 5 * 2;
  const logos = opts.logos ? altoLogoMm(base, opts.rollo) + (opts.rollo ? 1.5 : 2) : 0;
  const titulo = linea(base + 1) + 1;
  const folio = linea(base + 6) + 3;
  const rei = opts.reimpresion ? linea(base) + 2 + 2 + 2 : 0;
  const hr = 4;
  const firma = 5 + 6 + linea(base - 2) + 1;
  const filas = renglones * (linea(base) + 1);
  return padding + logos + titulo + folio + rei + hr + filas + firma;
}

/** Alto del logo, atado al tamaño de letra: en 6 por hoja un logo de 11 mm se
 *  come el espacio de dos renglones de datos. */
function altoLogoMm(base: number, rollo: boolean): number {
  return rollo ? base * 0.9 : base * 1.1;
}

/**
 * EL TAMAÑO DE LETRA MÁS GRANDE CON EL QUE TODAVÍA ENTRA TODO.
 *
 * En rollo la hoja no tiene fondo —el tique termina donde termina— así que no
 * hay nada que ajustar: va el tamaño cómodo y listo. En hoja el recuadro mide
 * lo que mide, y ahí sí hay que buscar.
 */
export function tamanoQueEntra(
  papel: PapelTique,
  renglones: number,
  opts?: { logos?: boolean; reimpresion?: boolean },
): { pt: number; entra: boolean } {
  const m = MEDIDAS[papel];
  const conf = { logos: opts?.logos !== false, reimpresion: opts?.reimpresion === true, rollo: m.rollo };
  if (m.altoMm == null) return { pt: papel === 'rollo58' ? 10 : 11, entra: true };
  for (let pt = PT_MAXIMO; pt >= PT_MINIMO; pt -= 0.5) {
    if (altoDelTique(pt, renglones, conf) <= m.altoMm) return { pt, entra: true };
  }
  // Ni con la letra más chica entra. Se devuelve el piso igual —el papel sale,
  // aunque apretado— y `entra: false` es lo que dispara el aviso.
  return { pt: PT_MINIMO, entra: false };
}

/**
 * EL AVISO PARA EL ADMIN, en su idioma y con la salida a mano.
 *
 * Devuelve null cuando todo entra bien. No dice «error»: dice cuántos datos
 * tiene puestos, en qué papel no caben y cuál es el papel donde sí caben, que
 * es la pregunta que va a hacer enseguida.
 */
export function avisoDeCapacidad(c: TiqueConfig): string | null {
  const renglones = renglonesDelTique({}, c).length;
  const logos = LOGOS_TIQUE.some((l) => c.logos[l.k]);
  const r = tamanoQueEntra(c.papel, renglones, { logos, reimpresion: true });
  if (r.entra) return null;
  const alternativa = (['carta4', 'carta2', 'carta1'] as PapelTique[]).find((p) =>
    (MEDIDAS[p].porHoja < MEDIDAS[c.papel].porHoja || MEDIDAS[p].altoMm! > MEDIDAS[c.papel].altoMm!)
    && tamanoQueEntra(p, renglones, { logos, reimpresion: true }).entra);
  const label = (p: PapelTique) => PAPELES.find((x) => x.k === p)?.label ?? p;
  return `⚠️ Con ${renglones} dato(s) no caben en «${label(c.papel)}»: el tique saldría cortado.`
    + (alternativa ? ` Prueba con «${label(alternativa)}», o quita datos.` : ' Quita datos o usa un rollo.');
}

/**
 * EL CSS DEL DOCUMENTO.
 *
 * Recibe el tamaño de letra YA CALCULADO por `tamanoQueEntra`, en vez de fijarlo
 * acá: si el CSS eligiera por su cuenta, el cálculo que decide si el tique entra
 * estaría mirando un tamaño distinto del que sale impreso.
 *
 * ⚠️ EL CUERPO CRECE Y LA FIRMA QUEDA ABAJO. El recuadro es una columna flex con
 *    los datos en el medio: en una hoja de alto fijo la firma se va al pie del
 *    recuadro, que es donde tiene que estar para firmar, y en un rollo —donde no
 *    hay alto— queda pegada debajo del último dato.
 */
function cssComun(papel: PapelTique, base: number): string {
  const m = MEDIDAS[papel];
  const rollo = m.rollo;
  const alto = m.altoMm == null ? '' : `height:${m.altoMm.toFixed(2)}mm;`;
  const logo = altoLogoMm(base, rollo).toFixed(1);
  return [
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    'html,body{margin:0;padding:0;background:#fff;color:#000}',
    `body{font-family:Tahoma,Verdana,Geneva,sans-serif;font-size:${base}pt;line-height:1.35;font-variant-numeric:tabular-nums}`,
    `.tq{display:flex;flex-direction:column;width:${m.anchoMm}mm;${alto}padding:${rollo ? '2mm 0' : '5mm'};overflow:hidden;page-break-inside:avoid;break-inside:avoid}`,
    // La línea de corte solo tiene sentido en hoja: en rollo corta la máquina.
    rollo ? '' : '.tq{border:1px dashed #999}',
    `.logos{display:flex;flex-wrap:wrap;gap:${rollo ? '2mm' : '3mm'};align-items:center;justify-content:${rollo ? 'center' : 'flex-start'};margin-bottom:${rollo ? '1.5mm' : '2mm'}}`,
    `.logos img{height:${logo}mm;width:auto;max-width:${rollo ? '30mm' : '40mm'};object-fit:contain}`,
    `.tit{text-align:center;font-weight:800;font-size:${(base + 1).toFixed(1)}pt;letter-spacing:.4px;text-transform:uppercase;margin:0 0 1mm}`,
    `.sub{text-align:center;font-size:${(base - 2).toFixed(1)}pt;color:#333;margin:0 0 2mm}`,
    '.hr{border:0;border-top:1px solid #000;margin:2mm 0}',
    // El cuerpo es lo que crece: empuja la firma al pie del recuadro.
    '.cuerpo{flex:1 1 auto}',
    '.fila{display:flex;gap:2mm;align-items:baseline;padding:.5mm 0}',
    `.k{font-weight:800;text-transform:uppercase;font-size:${(base - 2).toFixed(1)}pt;letter-spacing:.3px;flex:0 0 ${rollo ? '18mm' : '22mm'};color:#333}`,
    '.v{flex:1 1 auto;font-weight:700;word-break:break-word;overflow-wrap:anywhere}',
    // El número del tique es lo que se canta por radio y lo que se reclama. Va
    // grande arriba de todo, no perdido entre los demás renglones.
    `.folio{text-align:center;font-weight:900;font-size:${(base + 6).toFixed(1)}pt;letter-spacing:1px;margin:1mm 0 2mm}`,
    `.rei{text-align:center;font-weight:900;font-size:${base}pt;letter-spacing:1px;border:2px solid #000;padding:1mm;margin:0 0 2mm;text-transform:uppercase}`,
    `.firma{margin-top:5mm;font-size:${(base - 2).toFixed(1)}pt}`,
    '.firma .linea{border-top:1px solid #000;margin-top:6mm;padding-top:1mm;text-align:center}',
    `.hoja{display:grid;grid-template-columns:repeat(${m.cols},1fr);gap:0;page-break-after:always;break-after:page}`,
    '.hoja:last-child{page-break-after:auto;break-after:auto}',
    `@page{size:${rollo ? `${papel === 'rollo80' ? 80 : 58}mm auto` : 'letter'};margin:${rollo ? '3mm 4mm' : '10mm'}}`,
    // En pantalla (la vista previa) se ve como papel sobre una mesa oscura, para
    // que se entienda de un vistazo dónde termina una hoja y empieza la otra.
    `@media screen{body{background:#525659;padding:14px}.hoja{background:#fff;margin:0 auto 14px;padding:${rollo ? '4mm' : '10mm'};width:max-content;box-shadow:0 4px 18px rgba(0,0,0,.35)}}`,
  ].filter(Boolean).join('\n');
}

/**
 * EL ENCABEZADO DEL PAPEL: los logos que el admin dejó encendidos.
 *
 * ⚠️ Un logo encendido cuyo archivo no llegó NO deja un hueco ni un icono roto:
 *    simplemente no sale. Un cuadrito con una cruz en un tique oficial hace
 *    dudar del tique entero.
 */
function logosHtml(c: TiqueConfig, uris: Partial<Record<ClaveLogo, string>>): string {
  const imgs = LOGOS_TIQUE
    .filter((l) => c.logos[l.k] && limpio(uris[l.k]))
    .map((l) => `<img src="${escapar(uris[l.k])}" alt="${escapar(l.label)}"/>`)
    .join('');
  return imgs ? `<div class="logos">${imgs}</div>` : '';
}

/**
 * UN TIQUE.
 *
 * El folio sale DOS veces a propósito: grande arriba, para cantarlo y para
 * encontrarlo en un fajo de cincuenta, y en su renglón, para que la lectura de
 * arriba a abajo tenga la misma forma que la vista previa de la configuración.
 */
export function htmlDeUnTique(
  t: TiqueParaImprimir,
  c: TiqueConfig,
  uris: Partial<Record<ClaveLogo, string>>,
  opts?: { titulo?: string; subtitulo?: string },
): string {
  const filas = renglonesDelTique(t.datos, c)
    .map((r) => `<div class="fila"><div class="k">${escapar(r.k)}</div><div class="v">${escapar(r.v)}</div></div>`)
    .join('');
  const folio = limpio(t.datos.folio);
  return [
    '<div class="tq">',
    logosHtml(c, uris),
    `<div class="tit">${escapar(opts?.titulo ?? 'Tique de viaje')}</div>`,
    opts?.subtitulo ? `<div class="sub">${escapar(opts.subtitulo)}</div>` : '',
    folio ? `<div class="folio">${escapar(folio)}</div>` : '',
    t.reimpresion ? '<div class="rei">Reimpresión</div>' : '',
    '<hr class="hr"/>',
    `<div class="cuerpo">${filas}</div>`,
    '<div class="firma"><div class="linea">Recibí conforme · nombre y firma</div></div>',
    '</div>',
  ].filter(Boolean).join('');
}

/**
 * EL DOCUMENTO COMPLETO, con todos los tiques que se van a imprimir de una.
 *
 * ⚠️ UN SOLO TAMAÑO DE PAPEL POR DOCUMENTO. `@page` no se puede cambiar a mitad
 *    de documento, así que el papel es el que diga la configuración y punto. Es
 *    también lo correcto: mezclar rollo y hoja en un mismo mandado no es algo
 *    que nadie quiera hacer.
 */
export function documentoDeTiques(
  tiques: TiqueParaImprimir[],
  c: TiqueConfig,
  uris: Partial<Record<ClaveLogo, string>>,
  opts?: { titulo?: string; subtitulo?: string },
): string {
  // ⚠️ EL TAMAÑO SE CALCULA PARA EL PEOR TIQUE DEL MANDADO, no para cada uno.
  //    Si hay UNA reimpresión, su recuadro es más alto que el de los demás; con
  //    un tamaño por tique, dos papeles de la misma hoja saldrían con letras
  //    distintas y el fajo parecería armado a pedazos. Uno solo para todos.
  const renglones = renglonesDelTique({}, c).length;
  const hayLogos = LOGOS_TIQUE.some((l) => c.logos[l.k] && String(uris[l.k] ?? '').trim());
  const hayReimpresion = tiques.some((t) => t.reimpresion === true);
  const { pt } = tamanoQueEntra(c.papel, renglones, { logos: hayLogos, reimpresion: hayReimpresion });

  const hojas = enHojas(tiques, c.papel)
    .map((grupo) => `<section class="hoja">${grupo.map((t) => htmlDeUnTique(t, c, uris, opts)).join('')}</section>`)
    .join('');
  // `<title>` vacío para que el navegador no le ponga su propio encabezado a la
  // hoja impresa, igual que en el resto de los documentos del sistema.
  return `<!doctype html><html><head><meta charset="utf-8"/><title></title><style>${cssComun(c.papel, pt)}</style></head><body>${hojas}</body></html>`;
}

/** Nombre sugerido del archivo. Un tique lleva su número; un mandado lleva
 *  cuántos son, porque los números no caben y el primero no representa al resto. */
export function nombreArchivoTiques(tiques: TiqueParaImprimir[]): string {
  if (tiques.length === 1) return `tique-${limpio(tiques[0]?.datos?.folio) || 'sin-numero'}`;
  return `tiques-${tiques.length}`;
}
