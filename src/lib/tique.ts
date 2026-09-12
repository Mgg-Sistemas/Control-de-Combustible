// TIQUETERA DE VIAJES · lo que va impreso en un tique (12-sep-2026).
//
// Pedido del cliente: «cuando los chamos me impriman a mí la primera tiquetera,
// me salga la placa, la empresa y el CDT en que imprimieron».
//
// ⭐ ESTE ARCHIVO NO TOCA LA BASE DE DATOS y no importa nada de React. Es
//    matemática de textos: decidir QUÉ dice cada renglón del tique. Así se
//    prueba solo, sin pantalla y sin red (ver scripts/test-tique.mjs).
//
// ⚠️ LA REGLA QUE LO ORDENA TODO: **manda lo congelado**. Un tique impreso queda
//    firmado en el CDT con una placa concreta. Si al reimprimirlo la placa se
//    resolviera del catálogo de HOY, una corrección hecha la semana que viene
//    haría que el papel firmado y el reimpreso no coincidan, y ahí no hay manera
//    de saber cuál de los dos miente. Por eso el viaje guarda su propia foto y
//    el catálogo es solo el respaldo para los viajes viejos, que no la tienen.

/** Lo que hace falta de la ficha del catálogo. Nada más, para no arrastrar tipos. */
export type FichaCamion = {
  code?: string | null;
  plate?: string | null;
  serial?: string | null;
  companyName?: string | null;
};

/** Lo que hace falta del viaje. Los tres campos que congela la tiquetera. */
export type ViajeParaTique = {
  machineCode?: string | null;
  camionRef?: string | null;
  placa?: string | null;
  empresa?: string | null;
  folio?: string | null;
};

/** Lo que se pinta cuando no hay dato. Una raya, nunca un texto inventado. */
export const SIN_DATO = '—';

/** Lo que se pinta cuando el viaje todavía no tiene número de tique. */
export const SIN_TIQUE = 'Sin tique';

const limpio = (v: unknown): string => String(v ?? '').trim();

/**
 * QUÉ SE CONGELA EN EL VIAJE AL REGISTRARLO.
 *
 * ⚠️ LA PLACA CAE AL SERIAL, y es a propósito. Cuatro camiones de la flota no
 *    tienen placa cargada (dos de Costa Brava y dos de Savanna, 177 viajes
 *    entre los cuatro) y el cliente pidió que la placa salga en el tique. Con
 *    el serial el papel sigue identificando la unidad; sin nada, no identifica
 *    nada. La empresa sale igual en los dos casos, que es lo que él dijo que
 *    basta para saber cuál es.
 *
 * Un camión FUERA DE CATÁLOGO no tiene ficha: lo único que existe es la seña
 * que anotó el listero a mano. Se guarda esa, que es mejor que una raya.
 */
export function datosDelCamion(
  ficha: FichaCamion | null | undefined,
  senaLibre?: string | null,
): { placa: string | null; empresa: string | null } {
  if (!ficha) {
    return { placa: limpio(senaLibre) || null, empresa: null };
  }
  return {
    placa: limpio(ficha.plate) || limpio(ficha.serial) || null,
    empresa: limpio(ficha.companyName) || null,
  };
}

/**
 * QUÉ PLACA SE IMPRIME.
 *
 * El orden no es capricho: lo congelado primero porque es lo que dice el papel
 * firmado; el catálogo después, solo para los viajes anteriores a la tiquetera,
 * que no congelaron nada; y la seña del listero para los que nunca estuvieron
 * en el catálogo.
 */
export function placaDeTique(viaje: ViajeParaTique, ficha?: FichaCamion | null): string {
  return limpio(viaje.placa)
    || limpio(ficha?.plate)
    || limpio(ficha?.serial)
    || limpio(viaje.camionRef)
    || SIN_DATO;
}

/** Misma escalera para la empresa. */
export function empresaDeTique(viaje: ViajeParaTique, ficha?: FichaCamion | null): string {
  return limpio(viaje.empresa) || limpio(ficha?.companyName) || SIN_DATO;
}

/**
 * EL NÚMERO DEL TIQUE.
 *
 * ⚠️ NO SE INVENTA NUNCA. Un viaje sin folio es un viaje que todavía no llegó al
 *    servidor —está en la cola offline— o que es anterior a la tiquetera. En los
 *    dos casos NO HAY TIQUE QUE ENTREGAR, y decirlo es la única respuesta
 *    honesta: si la pantalla mostrara un número provisional, alguien lo cantaría
 *    por radio y después no existiría.
 */
export function folioDeTique(viaje: ViajeParaTique): string {
  return limpio(viaje.folio) || SIN_TIQUE;
}

/** ¿Este viaje ya tiene tique que se pueda imprimir? */
export function tieneTique(viaje: ViajeParaTique): boolean {
  return limpio(viaje.folio).length > 0;
}
