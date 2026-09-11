/**
 * ESCOGER MÁQUINAS SUELTAS dentro del conteo por tipo de equipo.
 *
 * ── Qué problema resuelve ──────────────────────────────────────────────────
 * Tildar un tipo mete a TODAS sus máquinas. Eso está bien para contar la flota,
 * pero no alcanza cuando el papel es para otra cosa: sacar el volumen de tres
 * volquetas concretas, o el conteo de un tipo dejando fuera las dos que están en
 * el taller. Antes había que tildar el tipo y borrar a mano del PDF.
 *
 * ── Por qué se guarda lo EXCLUIDO y no lo incluido ─────────────────────────
 * La lista guarda a quién se SACÓ, no a quién se dejó. Es lo que hace que el
 * comportamiento de siempre siga igual sin tocar nada: con la lista vacía no se
 * excluye a nadie, que es exactamente lo que pasaba antes. Y cuando se tilda un
 * tipo nuevo, su gente entra sola, sin que haya que acordarse de marcarla.
 * Guardando lo incluido habría que sincronizar la lista cada vez que cambia un
 * filtro, y el día que esa sincronización fallara el reporte saldría con menos
 * equipos SIN AVISAR, que es el peor error posible en un conteo.
 *
 * ── La regla de la intersección ────────────────────────────────────────────
 * Lo excluido se guarda tal cual, pero SOLO cuenta lo que está a la vista. Si se
 * saca una máquina y después se destilda su tipo, esa exclusión deja de contar
 * mientras el tipo esté destildado —el número de excluidas no puede hablar de
 * equipos que ni siquiera están en el reporte— y vuelve a valer si el tipo se
 * tilda de nuevo, porque la intención de sacarla sigue siendo la misma.
 *
 * Sin React ni Supabase, para poder probarla de verdad
 * (scripts/test-conteo-seleccion-maquinas.mjs).
 */

/** Lo único que se le pide a una máquina aquí: tener identidad propia. */
export type ConIdentidad = { id: string };

/**
 * Las exclusiones que de verdad aplican: las guardadas que además están a la
 * vista. Ver "la regla de la intersección" arriba.
 */
export function excluidasEfectivas(guardadas: Iterable<string>, aLaVista: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const id of guardadas) if (aLaVista.has(id)) out.add(id);
  return out;
}

/** Saca de la lista las máquinas excluidas, conservando el orden. */
export function aplicarExclusiones<T extends ConIdentidad>(items: T[], excluidas: Set<string>): T[] {
  return excluidas.size ? items.filter((m) => !excluidas.has(m.id)) : items;
}

/**
 * Cuenta cuántas máquinas quedaron de cada tipo DESPUÉS de excluir.
 *
 * ⚠️ El cuadro «Cantidad por tipo de equipo» del PDF se armaba con el total del
 *    tipo, no con lo que realmente se listó. Mientras no se podía excluir nada,
 *    los dos números eran el mismo y daba igual. Al poder sacar máquinas dejan
 *    de serlo: el cuadro diría 17 y el listado tendría 14, sin que nada avise
 *    de cuál de los dos miente. Por eso se cuenta sobre lo listado.
 */
export function conteoPorTipo<T>(items: T[], claveDe: (x: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  items.forEach((it) => { const k = claveDe(it); m.set(k, (m.get(k) ?? 0) + 1); });
  return m;
}

/**
 * ¿La selección dejó el reporte sin una sola máquina?
 *
 * Se puede llegar aquí a propósito (quitar todas para después marcar una) y es
 * un estado legítimo de la pantalla; lo que no se puede es EMITIR ese papel: un
 * conteo de cero equipos parece un informe y no dice nada.
 */
export function seleccionVacia(aLaVista: number, excluidas: number): boolean {
  return aLaVista > 0 && excluidas >= aLaVista;
}

/**
 * Lo que el PDF dice en el alcance sobre las máquinas sacadas a mano.
 *
 * Va SIEMPRE que haya alguna excluida, y no es opcional como las pastillas: un
 * conteo al que le faltan equipos y no lo dice es un conteo equivocado. Quien lo
 * recibe tiene que poder ver que el número es de una selección y no de la flota.
 */
export function textoExclusiones(aLaVista: number, excluidas: number): string {
  if (!excluidas) return '';
  const quedan = aLaVista - excluidas;
  return `Selección manual de equipos: se dejaron fuera ${excluidas} de ${aLaVista} unidad(es); el informe cuenta ${quedan}.`;
}

/** Rótulo del desplegable: cuántas entran de cuántas hay. */
export function rotuloSeleccion(aLaVista: number, excluidas: number): string {
  return `${aLaVista - excluidas} de ${aLaVista}`;
}
