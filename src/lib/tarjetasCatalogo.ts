// 🏷️ QUÉ ESTADOS MUESTRA CADA TARJETA DE CATEGORÍA DEL CATÁLOGO (20-oct-2026).
//
// Pedido del cliente: «solo en transporte de escombros que salgan las paradas,
// pero también dame la opción de configurar qué quiero que salga en esas
// tarjetas o qué estados quiero que salgan, por si quiero quitarle a una
// tarjeta o varias cualquier estado».
//
// ⭐ ES SOLO LO QUE SE VE: quitar un estado de una tarjeta no cambia ningún
//    conteo real — las máquinas siguen en sus cubos y sus listas. Y cuando una
//    tarjeta NO muestra «Paradas», esas máquinas se cuentan dentro de
//    «Operativas» (como siempre fue), para que el total de la tarjeta no
//    cambie nunca.
//
// ⚠️ RETIRADAS no se ofrece a propósito: el 14-oct se pidió que en estas
//    tarjetas «no se vea ni se cuente las retiradas». Si algún día las quiere
//    de vuelta, es decisión suya.
//
// La preferencia se guarda EN ESTE DISPOSITIVO (AsyncStorage): es cómo cada
// quien quiere ver su catálogo, no un dato del sistema.

export type EstadoTarjeta = 'operativa' | 'averiada' | 'parada' | 'espera' | 'transferida';
export const ESTADOS_TARJETA: EstadoTarjeta[] = ['operativa', 'averiada', 'parada', 'espera', 'transferida'];

/** La tarjeta «Σ Todas las categorías» también se configura; esta es su clave. */
export const TARJETA_TOTAL = '__total__';

export const CLAVE_GUARDADO_TARJETAS = 'catalogo_tarjetas_estados_v1';

/** La clave estable de una tarjeta: sin acentos, sin mayúsculas y sin espacios
 *  dobles — «Transporte de Escombros» y «TRANSPORTE DE ESCOMBROS » son la misma. */
export const claveTarjeta = (nombre: string): string =>
  String(nombre ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Lo que una tarjeta muestra SI NADIE la ha configurado: los cuatro estados de
 * siempre — y «Paradas» además, SOLO en Transporte de escombros (el pedido
 * literal). Se compara por el inicio («escombro») para cubrir singular/plural.
 */
export function estadosPorDefecto(nombre: string): EstadoTarjeta[] {
  const base: EstadoTarjeta[] = ['operativa', 'averiada', 'espera', 'transferida'];
  if (nombre !== TARJETA_TOTAL && claveTarjeta(nombre).startsWith('transporte de escombro')) {
    return ['operativa', 'averiada', 'parada', 'espera', 'transferida'];
  }
  return base;
}

/** La configuración guardada: clave de tarjeta → estados visibles. */
export type ConfigTarjetas = Record<string, EstadoTarjeta[]>;

/** Qué estados muestra la tarjeta `nombre` con la config `cfg` (null = sin leer
 *  todavía → defaults). Los valores desconocidos (de una versión vieja del
 *  guardado) se filtran en vez de reventar. */
export function estadosDeTarjeta(cfg: ConfigTarjetas | null | undefined, nombre: string): EstadoTarjeta[] {
  const guardado = cfg?.[nombre === TARJETA_TOTAL ? TARJETA_TOTAL : claveTarjeta(nombre)];
  if (!Array.isArray(guardado)) return estadosPorDefecto(nombre);
  return guardado.filter((e): e is EstadoTarjeta => (ESTADOS_TARJETA as string[]).includes(e));
}

/** Prende/apaga un estado en una tarjeta y devuelve la config nueva (el que
 *  llama la guarda). Mantiene el ORDEN canónico de ESTADOS_TARJETA. */
export function alternarEstadoTarjeta(cfg: ConfigTarjetas | null | undefined, nombre: string, estado: EstadoTarjeta): ConfigTarjetas {
  const k = nombre === TARJETA_TOTAL ? TARJETA_TOTAL : claveTarjeta(nombre);
  const actuales = new Set(estadosDeTarjeta(cfg, nombre));
  actuales.has(estado) ? actuales.delete(estado) : actuales.add(estado);
  return { ...(cfg ?? {}), [k]: ESTADOS_TARJETA.filter((e) => actuales.has(e)) };
}

/** Lee la config de un JSON guardado. Cualquier basura → {} (defaults). */
export function leerConfigTarjetas(json: string | null | undefined): ConfigTarjetas {
  try {
    const v = JSON.parse(String(json ?? ''));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as ConfigTarjetas) : {};
  } catch { return {}; }
}
