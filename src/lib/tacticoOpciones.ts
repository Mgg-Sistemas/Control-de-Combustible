// QUÉ SE OCULTA en el INVENTARIO DE MAQUINARIA (reporte de Ubicaciones tácticas).
//
// Pedido del cliente (06-sep-2026): poder sacar el mismo papel SIN la marca, SIN
// el modelo, SIN las ubicaciones o SIN decir si es Este u Oeste — según a quién
// se le entregue. Son cuatro pastillas independientes (se encienden varias a la
// vez), y por defecto ninguna: quien no toque nada sigue sacando el papel de
// siempre.
//
// Vive en su propia librería, sin React ni Supabase, para poder probarla de
// verdad (ver scripts/test-reporte-tactico-opciones.mjs). La pantalla obedece:
// le pregunta acá qué columnas van y en qué orden, y arma el encabezado y cada
// fila CON LA MISMA LISTA — así no pueden desalinearse.
//
// ⚠️ Las pastillas ocultan COLUMNAS y TEXTOS, nunca máquinas. Los totales del
//    reporte no cambian con ellas.

export type OpcionesTactico = {
  /** Sin la marca de la máquina (CAT, Komatsu…). */
  sinMarca: boolean;
  /** Sin el modelo (320, PC200…). */
  sinModelo: boolean;
  /** Sin la columna Ubicación del listado ("Este · Macuto · referencia"). */
  sinUbicaciones: boolean;
  /** Sin decir Este/Oeste en ningún lado: ni columnas de zona, ni prefijo en la ubicación. */
  sinZona: boolean;
};

/** El papel de siempre: no se oculta nada. */
export const OPCIONES_TACTICO_COMPLETO: OpcionesTactico = {
  sinMarca: false,
  sinModelo: false,
  sinUbicaciones: false,
  sinZona: false,
};

/** Las cuatro pastillas de la pantalla, en el orden en que se muestran y se nombran. */
export const PASTILLAS_OCULTAR: { key: keyof OpcionesTactico; chip: string; largo: string; archivo: string }[] = [
  { key: 'sinMarca', chip: '🚫 Marca', largo: 'marca', archivo: 'sin marca' },
  { key: 'sinModelo', chip: '🚫 Modelo', largo: 'modelo', archivo: 'sin modelo' },
  { key: 'sinUbicaciones', chip: '🚫 Ubicaciones', largo: 'ubicaciones', archivo: 'sin ubicaciones' },
  // En el nombre del archivo va con guion: la barra "/" no se puede usar en un nombre de archivo.
  { key: 'sinZona', chip: '🚫 Este / Oeste', largo: 'Este/Oeste', archivo: 'sin Este-Oeste' },
];

/** Enciende o apaga UNA pastilla. Devuelve un objeto nuevo (no toca el que recibe). */
export function alternarOcultar(o: OpcionesTactico, key: keyof OpcionesTactico): OpcionesTactico {
  return { ...o, [key]: !o[key] };
}

export function hayAlgoOculto(o: OpcionesTactico): boolean {
  return PASTILLAS_OCULTAR.some((p) => !!o[p.key]);
}

/** Lo oculto, en palabras cortas y en el orden de las pastillas: ['marca', 'Este/Oeste']. */
export function ocultosLista(o: OpcionesTactico): string[] {
  return PASTILLAS_OCULTAR.filter((p) => !!o[p.key]).map((p) => p.largo);
}

/** Para que la pantalla diga en criollo qué va a salir ANTES de descargar. */
export function ocultosEnPalabras(o: OpcionesTactico): string {
  const l = ocultosLista(o);
  return l.length ? `Se oculta: ${l.join(' · ')}.` : 'Sale completo.';
}

/** Va en el NOMBRE DEL ARCHIVO: dos PDF distintos no se pueden pisar en la carpeta de descargas. */
export function sufijoArchivoOcultos(o: OpcionesTactico): string {
  const l = PASTILLAS_OCULTAR.filter((p) => !!o[p.key]).map((p) => p.archivo);
  return l.length ? ' ' + l.join(', ') : '';
}

/** Va en el SUBTÍTULO del membrete, junto al alcance. */
export function sufijoSubtituloOcultos(o: OpcionesTactico): string {
  const l = ocultosLista(o);
  return l.length ? l.map((x) => ` · Sin ${x}`).join('') : '';
}

/** Cómo se titula la columna, o null si no va (las dos ocultas). */
export function tituloMarcaModelo(o: OpcionesTactico): string | null {
  if (o.sinMarca && o.sinModelo) return null;
  if (o.sinMarca) return 'Modelo';
  if (o.sinModelo) return 'Marca';
  return 'Marca / Modelo';
}

/** "CAT 320", o solo la mitad que se muestra, o '' si las dos están ocultas o vacías. */
export function marcaModeloDe(m: { marca?: unknown; modelo?: unknown }, o: OpcionesTactico): string {
  const partes: string[] = [];
  if (!o.sinMarca) partes.push(String(m?.marca ?? '').trim());
  if (!o.sinModelo) partes.push(String(m?.modelo ?? '').trim());
  return partes.filter(Boolean).join(' ');
}

/** Las columnas del listado de maquinaria, en orden. */
export type ColumnaMaquinaria = 'n' | 'equipo' | 'marcaModelo' | 'placa' | 'ubicacion' | 'opDia' | 'opNoche' | 'estado';

/**
 * Qué columnas lleva el listado de maquinaria y en qué orden. La pantalla arma el
 * encabezado Y cada fila recorriendo ESTA lista: un <th> sin su <td> corre toda la
 * tabla y el PDF sale con la placa debajo de "Marca" sin que nadie lo note.
 */
export function columnasMaquinaria(o: OpcionesTactico, conPersonal: boolean): ColumnaMaquinaria[] {
  const cols: ColumnaMaquinaria[] = ['n', 'equipo'];
  if (tituloMarcaModelo(o)) cols.push('marcaModelo');
  cols.push('placa');
  if (!o.sinUbicaciones) cols.push('ubicacion');
  if (conPersonal) cols.push('opDia', 'opNoche');
  cols.push('estado');
  return cols;
}

/** Sin GPS ni referencia, la máquina se ubica en el Patio de Camurí Chico (pedido del cliente). */
export const UBICACION_POR_DEFECTO = 'Patio - Camuri Chico';

/**
 * La ubicación de una máquina en palabras: "Este · Macuto · Edificio X". Con
 * `sinZona` se cae el "Este ·" y queda "Macuto · Edificio X".
 *
 * Sin nada que decir, va el patio por defecto — que está en el ESTE, así que con
 * `sinZona` sale sin el prefijo. Pero si la máquina SÍ tenía zona y lo único que
 * se sabía era eso, ocultarla NO la puede mandar al patio: eso sería inventar.
 * Ahí se pone un guion.
 */
export function ubicacionEnPalabras(p: { macro?: string | null; sub?: string | null; ref?: string | null }, o: OpcionesTactico): string {
  const limpio = (s: unknown) => String(s ?? '').trim();
  const macro = limpio(p?.macro);
  const partes = [o.sinZona ? '' : macro, limpio(p?.sub), limpio(p?.ref)].filter(Boolean);
  if (partes.length) return partes.join(' · ');
  if (macro && o.sinZona) return '—';
  return o.sinZona ? UBICACION_POR_DEFECTO : `Este · ${UBICACION_POR_DEFECTO}`;
}
