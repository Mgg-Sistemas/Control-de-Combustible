// MEDIDAS DE TOLVA CONOCIDAS DE LA FLOTA (09-sep-2026).
//
// El cliente entregó una hoja con el alto, el largo y el ancho de once unidades
// y pidió que el reporte del conteo saliera ya con esas columnas llenas, sin
// tener que medirlas otra vez. Esto es ESA hoja, puesta en código.
//
// ⚠️ ES UNA SEMILLA, NO LA VERDAD. Se reconoce la unidad por el TEXTO de su
//    código, marca y modelo, porque es lo único que hay para cruzarlas: en el
//    catálogo no existe ninguna columna que diga qué tolva tiene cada máquina.
//    Un nombre parecido puede dar un falso positivo.
//
// ⭐ POR ESO LO MEDIDO EN EL SISTEMA MANDA. Si un camión tiene su medida cargada
//    en «Cubicaje y volumen» (tabla `camion_cubicaje`), esa gana y esta tabla ni
//    se consulta. Acá solo se cae cuando NO hay nada medido, para que el papel
//    salga con datos desde el primer día en vez de con la columna en blanco.
//
// ⚠️ LO QUE NO SE RECONOCE QUEDA EN BLANCO, a propósito. Rellenar con el
//    promedio o con un cero sería inventar un número por el que se cobra.
//
// Sin un solo import: es una tabla de datos y sus reglas, y se prueba entera
// en scripts/test-medidas-flota.mjs.

export type MedidaTolva = {
  /** Cómo se llama la unidad en la hoja del cliente. Es lo que se imprime. */
  nombre: string;
  alto: number;
  largo: number;
  ancho: number;
};

export type SemillaMedida = MedidaTolva & {
  /**
   * Palabras que TIENEN QUE ESTAR TODAS en el texto de la máquina.
   *
   * Se exigen todas y no una cualquiera porque «eurotech» solo no alcanza: hay
   * un volteo Eurotech, una volqueta Eurotech de doble cajón y una telescópica
   * Eurotech, y las tres miden distinto.
   */
  señas: string[];
};

/** Quita acentos, colapsa espacios y baja a minúsculas. Se escribe acá para que
 *  el archivo siga sin depender de nada. */
export function normaliza(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * La hoja del cliente, ORDENADA DE MÁS ESPECÍFICA A MENOS.
 *
 * ⚠️ EL ORDEN ES LA REGLA. Se devuelve la PRIMERA que case, así que las que
 *    comparten palabras van antes que la genérica: «volqueta eurotech doble
 *    cajón» tiene que probarse antes que «volteo eurotech», o un doble cajón se
 *    llevaría las medidas del volteo y el reporte diría 16,12 m³ donde son
 *    12,38.
 */
export const MEDIDAS_CONOCIDAS: SemillaMedida[] = [
  // ── Volquetas y chutos (las más específicas primero) ──────────────────────
  { señas: ['sinotruk'], nombre: 'Carbozulia Sinotruk (HOWO)', alto: 1.70, largo: 6.29, ancho: 2.54 },
  { señas: ['howo'], nombre: 'Carbozulia Sinotruk (HOWO)', alto: 1.70, largo: 6.29, ancho: 2.54 },
  { señas: ['doble', 'tolva'], nombre: 'Chuto Volqueta Doble Tolva MAX-400', alto: 1.10, largo: 9.15, ancho: 2.38 },
  { señas: ['max-400'], nombre: 'Chuto Volqueta Doble Tolva MAX-400', alto: 1.10, largo: 9.15, ancho: 2.38 },
  { señas: ['max 400'], nombre: 'Chuto Volqueta Doble Tolva MAX-400', alto: 1.10, largo: 9.15, ancho: 2.38 },
  { señas: ['telescopic'], nombre: 'Volqueta Iveco Telescópica Eurotech', alto: 1.40, largo: 7.30, ancho: 2.40 },
  { señas: ['doble', 'cajon'], nombre: 'Volqueta Iveco Eurotech Doble Cajón', alto: 1.20, largo: 4.30, ancho: 2.40 },
  { señas: ['chuto', 'trakker'], nombre: 'Chuto con Volqueta Iveco Trakker', alto: 1.25, largo: 7.30, ancho: 2.40 },
  { señas: ['chuto', 'volqueta'], nombre: 'Chuto con Volqueta Iveco Trakker', alto: 1.25, largo: 7.30, ancho: 2.40 },

  // ── Volteos rígidos ───────────────────────────────────────────────────────
  { señas: ['toronto'], nombre: 'Volteo Toronto Iveco Trakker', alto: 1.16, largo: 5.91, ancho: 2.31 },
  { señas: ['freightliner'], nombre: 'Volteo Freightliner', alto: 1.20, largo: 5.10, ancho: 2.30 },
  { señas: ['ikemaz'], nombre: 'Volteo Renault Ikemaz', alto: 1.30, largo: 5.90, ancho: 2.30 },
  { señas: ['renault'], nombre: 'Volteo Renault Ikemaz', alto: 1.30, largo: 5.90, ancho: 2.30 },
  { señas: ['mitsubishi'], nombre: 'Volteo Mitsubishi', alto: 1.30, largo: 4.65, ancho: 2.28 },
  { señas: ['eurotech'], nombre: 'Volteo Iveco Eurotech', alto: 1.30, largo: 5.30, ancho: 2.34 },
  { señas: ['fiat'], nombre: 'Volteo Fiat', alto: 1.32, largo: 4.65, ancho: 2.27 },
];

/**
 * Busca la medida de una unidad por su texto.
 *
 * `null` cuando no se reconoce, y eso es una respuesta: la columna queda EN
 * BLANCO. Poner un promedio ahí sería inventar el número por el que se cobra.
 */
export function medidaConocida(...textos: (string | null | undefined)[]): MedidaTolva | null {
  const t = normaliza(textos.filter(Boolean).join(' '));
  if (!t) return null;
  for (const m of MEDIDAS_CONOCIDAS) {
    if (m.señas.every((s) => t.includes(s))) {
      return { nombre: m.nombre, alto: m.alto, largo: m.largo, ancho: m.ancho };
    }
  }
  return null;
}

/** Cuántas unidades distintas trae la hoja. Va en la nota al pie del reporte,
 *  para que quien lo lea sepa de dónde salieron esas medidas. */
export const UNIDADES_EN_LA_HOJA: number = new Set(MEDIDAS_CONOCIDAS.map((m) => m.nombre)).size;

export const NOTA_ORIGEN =
  `Las medidas de tolva salen de lo cargado en «Cubicaje y volumen». Donde no hay medida cargada se usa la `
  + `hoja de cubicaje entregada el 09/09/2026 (${UNIDADES_EN_LA_HOJA} unidades), reconociendo la unidad por su `
  + `descripción. Las unidades que no se reconocen quedan en blanco: no se estima ningún volumen.`;
