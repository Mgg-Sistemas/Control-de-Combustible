// ============================================================================
// IDENTIDAD VISIBLE DE UNA MÁQUINA — un solo lugar para todo el sistema.
//
// `machinery.code` es el NOMBRE y NO es único: el esquema lo dice y lo fuerza
// (`schema.sql` elimina la restricción de código único y la pone sobre serial y
// placa). En la flota hay TRES máquinas llamadas exactamente `RETROEXCAVADORA`
// (identificadores 008, 053 y 073). Mostrar solo el nombre las vuelve
// indistinguibles.
//
// El caso real (18-ago-2026): el cliente comparó dos reportes, vio "RETROEXCAVADORA
// averiada" en uno y "RETROEXCAVADORA con 9.34 h trabajadas" en el otro, y concluyó
// que el sistema se contradecía. Los dos documentos estaban bien — eran DOS MÁQUINAS
// DISTINTAS con el mismo nombre.
//
// Antes de este archivo había SIETE copias locales de esta lógica repartidas por el
// proyecto, cada una con su formato, y NINGUNA incluía el identificador.
//
// Orden del discriminante (pedido del cliente): PLACA primero — "es lo que usan para
// asignar" —, luego SERIAL, luego IDENTIFICADOR. Para parte de la flota el
// identificador es el único que existe (ver el comentario de VenezuelaMap.tsx: "muchas
// máquinas guardan su serial ahí").
//
// Blindado por `scripts/test-machine-label.mjs` (`npm run test:maquina`).
// ============================================================================

/** Lo mínimo que hace falta para identificar una máquina sin ambigüedad. */
export type MaquinaIdentificable = {
  code?: string | null;
  plate?: string | null;
  serial?: string | null;
  identifier?: string | null;
};

const limpio = (v: unknown): string => String(v ?? '').trim();

/**
 * El dato que DISTINGUE a esta máquina de otra con el mismo nombre.
 * Devuelve `null` si la máquina no trae ninguno (no inventa nada).
 */
export function machineDiscriminante(m: MaquinaIdentificable | null | undefined): string | null {
  if (!m) return null;
  return limpio(m.plate) || limpio(m.serial) || limpio(m.identifier) || null;
}

/**
 * Etiqueta completa para mostrar o imprimir: `NOMBRE · DISCRIMINANTE`.
 * Si la máquina no tiene ningún discriminante, devuelve solo el nombre — nunca
 * un separador suelto ni un "undefined".
 *
 * @param sep separador (por defecto " · "); en nombres de archivo conviene " - ".
 */
export function machineLabel(m: MaquinaIdentificable | null | undefined, sep = ' · '): string {
  const nombre = limpio(m?.code);
  const disc = machineDiscriminante(m);
  if (!nombre) return disc ?? '';
  return disc ? `${nombre}${sep}${disc}` : nombre;
}

/**
 * Igual que `machineLabel` pero apto para NOMBRE DE ARCHIVO: sin separadores raros
 * ni caracteres que Windows rechaza. Hace falta porque tres máquinas del mismo
 * nombre generaban tres PDF llamados igual, y el último pisaba a los anteriores.
 */
export function machineFileLabel(m: MaquinaIdentificable | null | undefined): string {
  return machineLabel(m, ' - ').replace(/[\\/:*?"<>|]/g, '-').trim();
}

/**
 * ¿El texto que escribió el usuario coincide con esta máquina? Busca en el nombre y
 * en LOS TRES discriminantes, para que se pueda encontrar una máquina escribiendo su
 * placa o su serial — no solo el nombre, que es justo el dato ambiguo.
 * Compara sin distinguir mayúsculas ni espacios sobrantes.
 */
export function machineMatches(m: MaquinaIdentificable | null | undefined, q: string): boolean {
  const needle = limpio(q).toLowerCase();
  if (!needle) return true;
  if (!m) return false;
  return [m.code, m.plate, m.serial, m.identifier]
    .some((v) => limpio(v).toLowerCase().includes(needle));
}
