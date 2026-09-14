// QUÉ ES UN LISTERO · regla compartida (13-sep-2026).
//
// Pedido del cliente: «necesito que ahí solo me aparezcan los que tienen el rol de
// listeros», sobre la lista de «Listeros y su obra».
//
// ⭐ ES LA MISMA REGLA CON LA QUE EL MENÚ MANDA A ALGUIEN AL PANEL DEL LISTERO, y por
//    eso vive acá y no copiada en dos sitios. Si la lista usara otra, alguien podría
//    entrar al panel del listero y no aparecer para asignarle obra, o aparecer como
//    listero sin serlo.
//
// ⚠️ NO SE MIRA EL NOMBRE DEL ROL. «Listero» se puede renombrar desde Usuarios, y una
//    regla atada al texto dejaría la lista vacía sin que nadie entienda por qué. Se
//    mira lo que el rol HACE: un rol cuyo único módulo activo es Viajes de camiones.
//
// ⚠️ Y SE EXIGE QUE SEA SU ÚNICO MÓDULO, no que lo tenga. Un coordinador puede tener
//    Viajes junto con otros módulos, y eso no lo vuelve listero.
//
// Este archivo no importa nada: se prueba solo, sin red y sin pantalla.

export const MODULOS_DEL_LISTERO = ['viajes_camiones'];

/** ¿Este rol es de listero? Recibe el `modules` del rol tal como viene de la base. */
export function esRolListero(modules: Record<string, unknown> | null | undefined): boolean {
  const mods = modules ?? {};
  const activos = Object.keys(mods).filter((k) => mods[k] && mods[k] !== 'none');
  return activos.length > 0 && activos.every((k) => MODULOS_DEL_LISTERO.includes(k));
}
