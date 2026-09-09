// QUÉ SE OCULTA en el PDF DE ESTE CONTEO (buscador por tipo de equipo).
//
// Pedido del cliente (09-sep-2026): que ese PDF salga con el MISMO formato que
// el de Ubicaciones tácticas, que se le puedan quitar columnas igual que allá, y
// que traiga las medidas de tolva y el volumen en m³ de cada equipo.
//
// Es una librería APARTE de `tacticoOpciones` a propósito, aunque se parezcan:
// son dos reportes con columnas distintas. El de ubicaciones tiene zona y
// ubicación y no tiene cubicaje; este tiene cubicaje y encargado y no tiene
// zona. Compartir un solo tipo obligaría a llevar pastillas que no hacen nada
// en la mitad de los casos, y una pastilla que no hace nada es peor que no
// tenerla: se toca, no pasa nada, y se pierde la confianza en las demás.
//
// ⚠️ Las pastillas ocultan COLUMNAS y CUADROS, nunca equipos. Los totales del
//    reporte NO cambian con ellas.
//
// Sin React ni Supabase, para poder probarla de verdad
// (scripts/test-conteo-tipo-opciones.mjs).

export type OpcionesConteo = {
  /** Sin la marca (CAT, Iveco…). */
  sinMarca: boolean;
  /** Sin el modelo (Trakker, Eurotech…). */
  sinModelo: boolean;
  /** Sin la columna Serial / Placa. */
  sinPlaca: boolean;
  /** Sin la columna Encargado. */
  sinEncargado: boolean;
  /** Sin nombres de empresas: el listado sale en un solo bloque. */
  sinEmpresas: boolean;
  /** Solo los cuadros de conteo: se cae el listado equipo por equipo. */
  sinListado: boolean;
  /** Sin el cuadro «Cantidad por tipo de equipo». */
  sinTipos: boolean;
  /** Sin el cuadro «Cantidad por clasificación». */
  sinClasificacion: boolean;
  /** Sin las columnas de alto, largo, ancho y m³. */
  sinCubicaje: boolean;
  /** Sin el cuadro de alcance del final. */
  sinAlcance: boolean;
};

/** El papel completo: no se oculta nada. Es el valor por defecto. */
export const OPCIONES_CONTEO_COMPLETO: OpcionesConteo = {
  sinMarca: false,
  sinModelo: false,
  sinPlaca: false,
  sinEncargado: false,
  sinEmpresas: false,
  sinListado: false,
  sinTipos: false,
  sinClasificacion: false,
  sinCubicaje: false,
  sinAlcance: false,
};

export const PASTILLAS_CONTEO: { key: keyof OpcionesConteo; chip: string; largo: string; archivo: string }[] = [
  { key: 'sinMarca', chip: '🚫 Marca', largo: 'marca', archivo: 'sin marca' },
  { key: 'sinModelo', chip: '🚫 Modelo', largo: 'modelo', archivo: 'sin modelo' },
  // En el nombre del archivo sin barra: "/" no se puede usar en un nombre de archivo.
  { key: 'sinPlaca', chip: '🚫 Serial / Placa', largo: 'serial/placa', archivo: 'sin placa' },
  { key: 'sinEncargado', chip: '🚫 Encargado', largo: 'encargado', archivo: 'sin encargado' },
  // La que pidió el cliente aparte: poder sacar el mismo papel sin el cubicaje,
  // para quien solo quiere el conteo.
  { key: 'sinCubicaje', chip: '🚫 Metros cúbicos', largo: 'alto/largo/ancho y m³', archivo: 'sin cubicaje' },
  { key: 'sinEmpresas', chip: '🚫 Nombre de empresas', largo: 'nombres de empresas', archivo: 'sin empresas' },
  { key: 'sinListado', chip: '🚫 Listado por equipo', largo: 'listado por equipo', archivo: 'solo resumen' },
  { key: 'sinTipos', chip: '🚫 Cantidad por tipo', largo: 'cantidad por tipo de equipo', archivo: 'sin tipos' },
  { key: 'sinClasificacion', chip: '🚫 Cantidad por clasificación', largo: 'cantidad por clasificación', archivo: 'sin clasificacion' },
  { key: 'sinAlcance', chip: '🚫 Alcance del informe', largo: 'cuadro de alcance', archivo: 'sin alcance' },
];

export function alternarConteo(o: OpcionesConteo, key: keyof OpcionesConteo): OpcionesConteo {
  return { ...o, [key]: !o[key] };
}

export function hayAlgoOcultoConteo(o: OpcionesConteo): boolean {
  return PASTILLAS_CONTEO.some((p) => !!o[p.key]);
}

export function ocultosConteoLista(o: OpcionesConteo): string[] {
  return PASTILLAS_CONTEO.filter((p) => !!o[p.key]).map((p) => p.largo);
}

/** Para que la pantalla diga en criollo qué va a salir ANTES de descargar. */
export function ocultosConteoEnPalabras(o: OpcionesConteo): string {
  const l = ocultosConteoLista(o);
  return l.length ? `Se oculta: ${l.join(' · ')}. Los totales no cambian.` : 'Sale completo.';
}

/** Va en el NOMBRE DEL ARCHIVO: dos PDF distintos no se pueden pisar en la
 *  carpeta de descargas. */
export function sufijoArchivoConteo(o: OpcionesConteo): string {
  const l = PASTILLAS_CONTEO.filter((p) => !!o[p.key]).map((p) => p.archivo);
  return l.length ? ' ' + l.join(', ') : '';
}

/** Cómo se titula la columna de marca y modelo, o null si no va ninguna. */
export function tituloMarcaModeloConteo(o: OpcionesConteo): string | null {
  if (o.sinMarca && o.sinModelo) return null;
  if (o.sinMarca) return 'Modelo';
  if (o.sinModelo) return 'Marca';
  return 'Marca / Modelo';
}

export function marcaModeloConteo(m: { marca?: unknown; modelo?: unknown }, o: OpcionesConteo): string {
  const partes: string[] = [];
  if (!o.sinMarca) partes.push(String(m?.marca ?? '').trim());
  if (!o.sinModelo) partes.push(String(m?.modelo ?? '').trim());
  return partes.filter(Boolean).join(' ');
}

/** Las columnas del listado, en orden. */
export type ColumnaConteo = 'n' | 'equipo' | 'marcaModelo' | 'placa' | 'encargado' | 'alto' | 'largo' | 'ancho' | 'm3';

/**
 * Qué columnas lleva el listado y en qué orden.
 *
 * ⚠️ La pantalla arma el ENCABEZADO y CADA FILA recorriendo esta misma lista. Un
 *    `<th>` sin su `<td>` corre la tabla entera y el PDF sale con el serial
 *    debajo de «Marca» sin que nadie lo note hasta que el cliente lo lee.
 *
 * ⚠️ NO hay columna de clasificación en el listado, y es a pedido: el cliente
 *    dijo «omite lo de la clasificación». El CUADRO de cantidad por
 *    clasificación sí sigue, con su propia pastilla.
 */
export function columnasConteo(o: OpcionesConteo): ColumnaConteo[] {
  const cols: ColumnaConteo[] = ['n', 'equipo'];
  if (tituloMarcaModeloConteo(o)) cols.push('marcaModelo');
  if (!o.sinPlaca) cols.push('placa');
  if (!o.sinEncargado) cols.push('encargado');
  if (!o.sinCubicaje) cols.push('alto', 'largo', 'ancho', 'm3');
  return cols;
}

export const TITULO_COLUMNA: Record<ColumnaConteo, string> = {
  n: '#',
  equipo: 'Equipo',
  marcaModelo: 'Marca / Modelo',
  placa: 'Serial / Placa',
  encargado: 'Encargado',
  alto: 'Alto (m)',
  largo: 'Largo (m)',
  ancho: 'Ancho (m)',
  m3: 'Volumen (m³)',
};

/** Las columnas numéricas van alineadas a la derecha. */
export const COLUMNA_NUMERICA: Record<ColumnaConteo, boolean> = {
  n: true, equipo: false, marcaModelo: false, placa: false, encargado: false,
  alto: true, largo: true, ancho: true, m3: true,
};

/**
 * Si el reporte quedó SIN NADA que contar ni listar, no se emite.
 *
 * Con los tres cuadros y el listado apagados a la vez queda el membrete y el
 * total pelado: parece un informe y no dice nada. Es mejor decirlo antes de
 * generarlo que entregar la hoja vacía.
 */
export function conteoSinContenido(o: OpcionesConteo): boolean {
  return o.sinListado && o.sinTipos && o.sinClasificacion;
}
