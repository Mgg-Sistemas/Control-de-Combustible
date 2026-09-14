// HISTORIAL DE ENTREGAS DE UN TIQUE · qué dice cada renglón (14-sep-2026).
//
// Pedido del cliente: que la pastilla «entregado ×7», al tocarla, muestre quién
// imprimió o reimprimió ese tique y a qué hora.
//
// ⭐ ESTE ARCHIVO NO TOCA LA BASE NI LA PANTALLA, y no importa nada. Recibe las
//    filas de `tique_emisiones` y decide el orden y el texto. Así se prueba solo.

/** Una entrega tal como la guarda `tique_emisiones`. */
export type EmisionHistorial = {
  id: string;
  folio: string;
  reimpresion: boolean;
  medio: string | null;
  emitidoPorNombre: string | null;
  ubicacionNombre: string | null;
  emitidoAt: string;
  loteId: string | null;
};

/** Un renglón listo para pintar. */
export type FilaHistorial = {
  clave: string;
  n: number;
  titulo: string;
  esReimpresion: boolean;
  quien: string;
  cuando: string;
  donde: string;
  medio: string;
};

export const SIN_NOMBRE = 'Usuario sin nombre';
/** Quien imprimió no tenía obra asignada, o lo sacó desde la oficina. Se dice:
 *  un hueco en blanco parece un error del sistema. */
export const SIN_CDT = 'Sin CDT asignado';

const MEDIO: Record<string, string> = {
  tiquetera: 'En tiquetera',
  hoja: 'En hoja',
  imagen: 'Como imagen',
};

const limpio = (v: unknown): string => String(v ?? '').trim();

/**
 * FECHA Y HORA DE CARACAS, con el mismo formato que el resto de la pantalla.
 *
 * ⚠️ LA ZONA HORARIA VA ESCRITA, no se toma la del teléfono. Un historial en UTC
 *    dice que alguien imprimió a mediodía lo que imprimió a las 8 de la mañana, y
 *    la hora es justo el dato que se va a discutir cuando falte un tique.
 */
export function fmtFechaHoraCaracas(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const fecha = new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const hora = new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
  return `${fecha} · ${hora}`;
}

/**
 * EN ORDEN DE RELOJ, la primera arriba.
 *
 * El número 1 es la primera impresión y el número de cada renglón coincide con el
 * «×N» de la pastilla. Dos entregas del mismo segundo —pasa con un lote— se
 * desempatan por id, para que cada una tenga siempre el mismo número.
 */
function enOrden(filas: readonly EmisionHistorial[]): EmisionHistorial[] {
  return [...filas].sort((a, b) => {
    const ta = new Date(a.emitidoAt).getTime();
    const tb = new Date(b.emitidoAt).getTime();
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * LOS RENGLONES DEL HISTORIAL.
 *
 * Si fue reimpresión lo dice la BASE, no la posición: la marca la pone un trigger
 * al guardar, y es la misma que salió impresa en el papel.
 */
export function filasDelHistorial(filas: readonly EmisionHistorial[]): FilaHistorial[] {
  return enOrden(filas).map((e, i) => ({
    clave: e.id,
    n: i + 1,
    titulo: e.reimpresion ? 'Reimpresión' : 'Primera impresión',
    esReimpresion: e.reimpresion === true,
    quien: limpio(e.emitidoPorNombre) || SIN_NOMBRE,
    cuando: fmtFechaHoraCaracas(e.emitidoAt),
    donde: limpio(e.ubicacionNombre) || SIN_CDT,
    medio: MEDIO[limpio(e.medio)] ?? 'Sin dato del medio',
  }));
}

/**
 * EL RESUMEN DE ARRIBA: cuántas entregas, cuántas personas, cuántas reimpresiones.
 *
 * La misma persona escrita con otras mayúsculas o espacios cuenta UNA vez: si no,
 * «4 personas» podrían ser dos, y ese número es el que llama la atención.
 */
export function resumenHistorial(filas: readonly EmisionHistorial[]): string {
  const n = filas.length;
  if (n === 0) return 'Todavía no se entregó este tique.';
  if (n === 1) return '1 entrega: la primera impresión';
  const personas = new Set(filas.map((e) => limpio(e.emitidoPorNombre).toLowerCase())).size;
  const reimp = filas.filter((e) => e.reimpresion === true).length;
  return `${n} entregas · ${personas} ${personas === 1 ? 'persona' : 'personas'} · ${reimp} ${reimp === 1 ? 'reimpresión' : 'reimpresiones'}`;
}
