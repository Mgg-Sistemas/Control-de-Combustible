// ============================================================================
// Módulo OBRAS PÚBLICAS — capa de datos AISLADA (tablas op_*).
// El "Supervisor Externo Obras Públicas" gestiona jornadas/averías/paradas/visitas
// de SUS máquinas sin tocar el módulo de inspectores. Este archivo solo habla con
// las tablas op_* y con `machinery` (catálogo/ubicación, que sí es compartida).
// ============================================================================
import { supabase } from './supabase';

/** Un supervisor de obras públicas (usuario con el rol dinámico correspondiente). */
export type OpSupervisor = { id: string; full_name: string };

/** Asignación vigente máquina → supervisor. */
export type OpAssignment = { machinery_id: string; supervisor_id: string; supervisor_name: string };

/**
 * Usuarios que son "Supervisor Externo Obras Públicas": los perfiles cuyo
 * `app_role_id` apunta a un rol dinámico que tiene el módulo `obras_publicas`.
 * No se hardcodea el id del rol — se resuelve por el módulo, así sigue andando
 * si se crea/renombra otro rol de obras públicas.
 */
export async function listOpSupervisors(): Promise<OpSupervisor[]> {
  const { data: roles, error: rErr } = await supabase.from('app_roles').select('id, modules');
  if (rErr) throw rErr;
  const roleIds = (roles ?? [])
    .filter((r: any) => r?.modules && r.modules['obras_publicas'] && r.modules['obras_publicas'] !== 'none')
    .map((r: any) => r.id as string);
  if (!roleIds.length) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, active')
    .in('app_role_id', roleIds)
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((p: any) => p.active !== false)
    .map((p: any) => ({ id: p.id as string, full_name: (p.full_name as string) ?? '(sin nombre)' }));
}

/** Asignaciones vigentes (una por máquina), con el nombre del supervisor. */
export async function listOpAssignments(): Promise<Map<string, OpAssignment>> {
  const { data, error } = await supabase
    .from('op_machine_supervisors')
    .select('machinery_id, supervisor_id, active, profiles:supervisor_id(full_name)')
    .eq('active', true);
  if (error) throw error;
  const m = new Map<string, OpAssignment>();
  (data ?? []).forEach((r: any) => {
    m.set(r.machinery_id as string, {
      machinery_id: r.machinery_id as string,
      supervisor_id: r.supervisor_id as string,
      supervisor_name: (r.profiles?.full_name as string) ?? '',
    });
  });
  return m;
}

/**
 * Asigna un supervisor a una o varias máquinas (por lote o individual). Cada
 * máquina tiene UN supervisor activo: primero se desactiva el anterior y luego se
 * inserta el nuevo (respeta el índice único parcial `una activa por máquina`).
 */
export async function assignOpSupervisor(
  machineryIds: string[],
  supervisorId: string,
  assignedBy?: string | null,
): Promise<number> {
  const ids = Array.from(new Set(machineryIds.filter(Boolean)));
  if (!ids.length) return 0;
  // 1) Baja las asignaciones activas anteriores de esas máquinas.
  const { error: offErr } = await supabase
    .from('op_machine_supervisors')
    .update({ active: false })
    .in('machinery_id', ids)
    .eq('active', true);
  if (offErr) throw offErr;
  // 2) Inserta la nueva asignación activa.
  const rows = ids.map((machinery_id) => ({
    machinery_id, supervisor_id: supervisorId, assigned_by: assignedBy ?? null, active: true,
  }));
  const { error: insErr } = await supabase.from('op_machine_supervisors').insert(rows);
  if (insErr) throw insErr;
  return ids.length;
}

/** Quita el supervisor de obras públicas de una máquina (deja de reflejarse). */
export async function clearOpAssignment(machineryId: string): Promise<void> {
  const { error } = await supabase
    .from('op_machine_supervisors')
    .update({ active: false })
    .eq('machinery_id', machineryId)
    .eq('active', true);
  if (error) throw error;
}
