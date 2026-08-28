// CONTRASEÑAS EN MAYÚSCULA — regla del cliente (27-ago-2026):
//
//   «haz que la contraseña se coloque obligatoriamente en mayúscula, porque
//    cuando se crea un usuario, la contraseña y el usuario es en mayúscula.
//    Si se coloca en minúscula que se vuelva mayúscula.»
//
// Toda la app escribe en MAYÚSCULA (ver ./fonts). Las contraseñas eran la
// excepción, y esa excepción fue justo la que produjo el bug del 27-ago-2026:
// el campo MOSTRABA la clave en mayúscula pero GUARDABA lo tecleado, así que el
// administrador dictaba una cosa y el sistema esperaba otra.
//
// La regla de ahora elimina el problema de raíz en vez de taparlo: la clave se
// convierte a mayúscula **en el valor**, no solo en la pantalla. Lo que se ve es
// literalmente lo que se guarda.
//
// ⚠️ ESTE ARCHIVO ES LA ÚNICA VERDAD. Si la conversión se hiciera en cada
//    pantalla por su cuenta, bastaría con que una se olvidara para que esa
//    persona no pudiera entrar nunca más. Todas pasan por aquí.

/**
 * La contraseña tal como debe guardarse: en MAYÚSCULA.
 *
 * Se usa al CREAR un usuario, al CAMBIAR la clave y al INICIAR SESIÓN, para que
 * las tres siempre coincidan.
 */
export function claveNormalizada(clave: string): string {
  return (clave ?? '').toUpperCase();
}

/** ¿El texto trae minúsculas? (o sea: normalizarlo lo cambia). */
export function tieneMinusculas(clave: string): boolean {
  const c = clave ?? '';
  return c !== c.toUpperCase();
}

/**
 * ⭐ LAS CLAVES QUE HAY QUE PROBAR AL INICIAR SESIÓN, EN ORDEN.
 *
 * ⚠️ ESTO NO ES UN CAPRICHO: SIN ESTO SE QUEDA MEDIO SISTEMA FUERA.
 *
 * Las contraseñas se guardan cifradas. **No se pueden convertir a mayúscula
 * hacia atrás**: nadie —ni la base de datos— puede leer las que ya existen para
 * reescribirlas. Así que el día que entra esta regla conviven dos mundos:
 *
 *   · las claves creadas o cambiadas DESDE HOY  → guardadas en MAYÚSCULA
 *   · las que ya existían                        → guardadas como se tecleó,
 *                                                  muchas con minúsculas
 *
 * Si el login mandara solo la versión en mayúscula, TODA la segunda gente
 * dejaría de poder entrar de golpe, sin haber hecho nada mal. Por eso se prueba
 * primero la mayúscula (el mundo nuevo, y el único de aquí en adelante) y, solo
 * si esa falla y la persona escribió minúsculas, se reintenta TAL CUAL lo
 * tecleó (el mundo viejo).
 *
 * Cuando el texto ya viene todo en mayúscula, devuelve UNA sola opción: no hay
 * nada que reintentar y no se gasta un viaje de más.
 *
 * ⏳ ESTE PUENTE SE PUEDE QUITAR algún día: cuando ya no quede nadie con una
 *    clave vieja (porque todos la cambiaron), esta función puede devolver solo
 *    la mayúscula. Hasta entonces, quitarlo deja gente fuera.
 */
export function clavesAProbar(clave: string): string[] {
  const c = clave ?? '';
  const mayus = claveNormalizada(c);
  return mayus === c ? [mayus] : [mayus, c];
}
