// ============================================================================
// EDICIÓN MASIVA DE USUARIOS — agrupar por rol, buscar y aplicar en bloque.
//
// POR QUÉ EXISTE
// ---------------------------------------------------------------------------
// Cambiar el permiso de un módulo a 60 usuarios había que hacerlo de a uno,
// entrando y saliendo de "Editar" sesenta veces. Pedido del cliente
// (21-ago-2026): «dame una opción para editar masivamente a varios usuarios,
// además de poder agrupar por roles o buscar por cualquier característica».
//
// Acá vive solo la LÓGICA (agrupar, buscar, y el cálculo de qué nivel le queda
// de verdad a cada quien). La pantalla es `src/components/BulkPermissionsModal.tsx`.
// `scripts/test-usuarios-bulk.mjs` la amarra.
// ============================================================================

import { norm } from './text';
import { PermLevel, roleLabel } from './permissions';

/** Lo mínimo que se necesita de un usuario para agrupar, buscar y editar. */
export type UsuarioBulk = {
  id: string;
  full_name?: string | null;
  role?: string | null;
  username?: string | null;
  cedula?: string | null;
  app_role_id?: string | null;
  locked?: boolean | null;
  active?: boolean | null;
};

/** Rol personalizado (los "dinámicos" que se crean en 🏷️ Roles del sistema). */
export type RolApp = { id: string; name: string; modules?: Record<string, string> | null };

/** Clave de un grupo de rol. Los roles base van como 'base:admin' y los
 *  personalizados como 'app:<uuid>', para que no se pisen entre ellos. */
export type ClaveRol = string;
export const claveRolBase = (r: string): ClaveRol => `base:${r}`;
export const claveRolApp = (id: string): ClaveRol => `app:${id}`;

/** El rol con el que se AGRUPA a un usuario: el personalizado si lo tiene, si no
 *  el rol base. Es el mismo criterio con el que la lista muestra "Rol asignado". */
export function claveRolDe(u: UsuarioBulk): ClaveRol {
  return u.app_role_id ? claveRolApp(u.app_role_id) : claveRolBase(String(u.role ?? ''));
}

export type GrupoRol = { key: ClaveRol; label: string; count: number };

/** Los grupos de rol presentes, cada uno con cuántos usuarios tiene. Solo salen
 *  los roles que DE VERDAD tienen gente: un chip en cero es ruido. */
export function gruposPorRol(usuarios: UsuarioBulk[], roles: RolApp[] | null | undefined): GrupoRol[] {
  const nombreApp = new Map((roles ?? []).map((r) => [r.id, r.name]));
  const cuenta = new Map<ClaveRol, number>();
  usuarios.forEach((u) => {
    const k = claveRolDe(u);
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  });
  return Array.from(cuenta.entries())
    .map(([key, count]) => {
      const esApp = key.startsWith('app:');
      const raw = key.slice(esApp ? 4 : 5);
      const label = esApp ? (nombreApp.get(raw) ?? 'Rol') : (roleLabel(raw) || 'Sin rol');
      return { key, label, count };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));
}

/** Todo el texto por el que se puede BUSCAR a un usuario. "Cualquier
 *  característica": nombre, usuario, cédula, rol base, rol personalizado y su
 *  estado (bloqueado / inactivo), para poder pedir cosas como "bloqueado". */
export function textoBuscableDe(u: UsuarioBulk, roles: RolApp[] | null | undefined): string {
  const app = u.app_role_id ? (roles ?? []).find((r) => r.id === u.app_role_id)?.name ?? '' : '';
  return [
    u.full_name ?? '',
    u.username ?? '',
    u.cedula ?? '',
    roleLabel(String(u.role ?? '')),
    String(u.role ?? ''),
    app,
    u.locked ? 'bloqueado' : '',
    u.active === false ? 'inactivo' : '',
  ].join(' ');
}

/** Filtra por texto libre Y por los grupos de rol marcados.
 *  Grupos vacío = todos los roles. Texto vacío = todos los usuarios. */
export function filtrarUsuarios(
  usuarios: UsuarioBulk[],
  opts: { q?: string; roles?: Set<ClaveRol>; appRoles?: RolApp[] | null }
): UsuarioBulk[] {
  const q = norm((opts.q ?? '').trim());
  const gruposSel = opts.roles ?? new Set<ClaveRol>();
  return usuarios.filter((u) => {
    if (gruposSel.size > 0 && !gruposSel.has(claveRolDe(u))) return false;
    if (!q) return true;
    return norm(textoBuscableDe(u, opts.appRoles)).includes(q);
  });
}

const ORDEN: PermLevel[] = ['none', 'lectura', 'escritura', 'full'];
const idx = (l: string | null | undefined) => {
  const i = ORDEN.indexOf(String(l ?? '') as PermLevel);
  return i < 0 ? 0 : i;
};

/**
 * EL NIVEL QUE LE QUEDA DE VERDAD a un usuario en un módulo, después de guardarle
 * un permiso explícito. Es el mismo cálculo que hace `AuthContext.moduleLevel`.
 *
 *  · ADMIN: siempre 'full'. Es la ÚNICA excepción que queda — un admin no se
 *    limita con un permiso, se le cambia el ROL. Así nadie se deja fuera del
 *    sistema por error quitándose a sí mismo el módulo de Usuarios.
 *  · Todos los demás, con rol personalizado o sin él: queda EXACTAMENTE el nivel
 *    explícito que se acaba de poner.
 *
 * Hasta el 21-ago-2026 el rol personalizado le ganaba al permiso (se tomaba el
 * MAYOR de los dos), así que ponerle "Lectura" a alguien cuyo rol daba "Escritura"
 * no le quitaba nada. Pedido del cliente: «si yo le quito los permisos a alguien,
 * no importa el rol, se los pueda quitar y ya».
 */
export function nivelEfectivo(
  u: UsuarioBulk,
  _modulo: string,
  nivelExplicito: PermLevel,
  _roles: RolApp[] | null | undefined
): PermLevel {
  if (String(u.role ?? '') === 'admin') return 'full';
  return nivelExplicito;
}

/** Motivo por el que a un usuario NO le va a quedar el nivel que se eligió.
 *  null = sí le queda. Se muestra tal cual en la pantalla, antes de guardar.
 *  Hoy solo puede pasar con los ADMIN. */
export function motivoNoAplica(
  u: UsuarioBulk,
  modulo: string,
  nivel: PermLevel,
  roles: RolApp[] | null | undefined
): string | null {
  const real = nivelEfectivo(u, modulo, nivel, roles);
  if (real === nivel) return null;
  return 'es ADMIN: siempre tiene full control (cámbiale el rol, no el permiso)';
}

/** Reparte los seleccionados en los que SÍ quedan con el nivel elegido y los que
 *  no, con su motivo. La pantalla avisa antes de guardar y después de guardar. */
export function repartirPorEfecto(
  seleccionados: UsuarioBulk[],
  modulo: string,
  nivel: PermLevel,
  roles: RolApp[] | null | undefined
): { aplican: UsuarioBulk[]; noAplican: { u: UsuarioBulk; motivo: string }[] } {
  const aplican: UsuarioBulk[] = [];
  const noAplican: { u: UsuarioBulk; motivo: string }[] = [];
  seleccionados.forEach((u) => {
    const motivo = motivoNoAplica(u, modulo, nivel, roles);
    if (motivo) noAplican.push({ u, motivo });
    else aplican.push(u);
  });
  return { aplican, noAplican };
}
