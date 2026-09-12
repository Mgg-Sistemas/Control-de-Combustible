// SUPERVISORES Y COORDINADORES ELEGIBLES (09-sep-2026).
//
// Cinco pantallas hacían LA MISMA consulta por su cuenta para ofrecer a quién
// asignarle una máquina o una guardia:
//
//   supabase.from('profiles').select('id, full_name, role')
//     .in('role', ['supervisor', 'coordinador_patio']).order('full_name')
//
// Ninguna dejaba fuera a la gente archivada, así que quien ya no trabaja seguía
// apareciendo como asignable. Es el paso 06 del patrón: la parte que se olvida
// cuando el sistema no tiene una fuente única de usuarios.
//
// Se quita lo APAGADO y lo ARCHIVADO. Al principio solo se quitaba lo archivado,
// porque `profiles.active` no mandaba nada en la base y podía haber gente marcada
// como inactiva que seguía trabajando. Desde el 09-09-2026 eso ya no es así:
// `current_role()` termina en `and p.active`, o sea que una cuenta apagada no
// tiene rol y no pasa ninguna puerta. Ofrecerla como asignable era ofrecer a
// alguien que no puede hacer el trabajo.

import { supabase } from './supabase';
import { soloEnUso, faltaColumnaArchivo } from './cicloVidaUsuario';

/** Los roles que pueden recibir una asignación de máquina o de guardia. */
export const ROLES_ASIGNABLES = ['supervisor', 'coordinador_patio'] as const;

export type PersonaAsignable = {
  id: string;
  full_name: string | null;
  role?: string | null;
  cedula?: string | null;
  archivado_en?: string | null;
};

/**
 * Supervisores y coordinadores que se pueden asignar, sin los archivados.
 *
 * `campos` permite pedir algo más (por ejemplo la cédula) sin duplicar la
 * consulta. Si la columna del archivo todavía no existe —porque no se ha
 * corrido el SQL 01— se reintenta sin ella y se devuelve la lista completa,
 * que es exactamente como se comportaba antes. Nunca se queda en blanco.
 */
export async function personalAsignable(campos = 'id, full_name, role'): Promise<PersonaAsignable[]> {
  const pedir = async (sel: string) =>
    supabase.from('profiles').select(sel)
      .in('role', ROLES_ASIGNABLES as unknown as string[])
      .eq('active', true)          // apagado = sin rol desde el 09-09-2026
      .order('full_name');

  let { data, error } = await pedir(campos + ', archivado_en');
  if (error && faltaColumnaArchivo(error.message)) {
    ({ data, error } = await pedir(campos));   // sin el SQL corrido: como antes
  }
  if (error) throw error;
  return soloEnUso((data ?? []) as unknown as PersonaAsignable[]);
}
