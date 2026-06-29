// Inicio de sesión por nombre + apellido.
// Supabase Auth usa email internamente, así que derivamos un correo
// determinístico a partir del nombre y apellido. El usuario nunca lo ve.

/** Dominio interno para los correos sintéticos (no se envían emails reales). */
export const INTERNAL_EMAIL_DOMAIN = 'combustible.app';

/** Quita acentos, pasa a minúsculas y deja solo [a-z0-9]. */
function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // elimina diacríticos (acentos)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Construye el correo interno: "Juan Pérez" -> "juan.perez@combustible.app". */
export function nameToEmail(firstName: string, lastName: string): string {
  const f = slug(firstName);
  const l = slug(lastName);
  return `${f}.${l}@${INTERNAL_EMAIL_DOMAIN}`;
}

/** Valida que haya nombre y apellido. */
export function validateName(firstName: string, lastName: string): string | null {
  if (!slug(firstName)) return 'Ingresa el nombre.';
  if (!slug(lastName)) return 'Ingresa el apellido.';
  return null;
}
