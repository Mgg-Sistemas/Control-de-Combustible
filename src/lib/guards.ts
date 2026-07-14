import { supabase } from './supabase';
import { MachineGuard } from '../types/database';

/** Historial completo de guardias/militares de una máquina (más reciente primero). */
export async function listGuards(machineryId: string): Promise<MachineGuard[]> {
  const { data } = await supabase
    .from('machine_guards')
    .select('*')
    .eq('machinery_id', machineryId)
    .order('assigned_at', { ascending: false });
  return (data ?? []) as MachineGuard[];
}

/** Nombres de supervisores ya usados (para autocompletar/lista desplegable). */
export async function listGuardNames(): Promise<string[]> {
  const { data } = await supabase
    .from('machine_guards')
    .select('guard_name')
    .order('assigned_at', { ascending: false })
    .limit(500);
  const seen = new Set<string>();
  const out: string[] = [];
  (data ?? []).forEach((g: any) => {
    const n = String(g.guard_name ?? '').trim();
    if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n); }
  });
  return out.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

/** Guardia ACTUAL (activo) de cada máquina indicada. Devuelve un mapa id→guardia. */
export async function fetchActiveGuards(machineIds: string[]): Promise<Record<string, MachineGuard>> {
  const map: Record<string, MachineGuard> = {};
  if (machineIds.length === 0) return map;
  const { data } = await supabase
    .from('machine_guards')
    .select('*')
    .eq('active', true)
    .in('machinery_id', machineIds);
  (data ?? []).forEach((g: any) => { map[g.machinery_id] = g as MachineGuard; });
  return map;
}

/**
 * Asigna un nuevo militar/guardia a la máquina. El historial es ACUMULABLE:
 * cierra el registro activo anterior (ended_at + active=false) e inserta el
 * nuevo activo, de modo que quede la traza de quién la custodió y hasta cuándo.
 * Devuelve el registro nuevo.
 */
export async function assignGuard(
  machineryId: string,
  input: { guard_name: string; rank?: string | null; note?: string | null },
  userId?: string | null
): Promise<MachineGuard | null> {
  const name = input.guard_name.trim();
  if (!name) return null;
  // Cierra el/los activos anteriores de esta máquina.
  await supabase
    .from('machine_guards')
    .update({ active: false, ended_at: new Date().toISOString() })
    .eq('machinery_id', machineryId)
    .eq('active', true);
  const { data, error } = await supabase
    .from('machine_guards')
    .insert({
      machinery_id: machineryId,
      guard_name: name,
      rank: (input.rank ?? '').trim() || null,
      note: (input.note ?? '').trim() || null,
      active: true,
      created_by: userId || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as MachineGuard;
}

/** Retira el guardia actual sin asignar otro (la máquina queda sin custodia). */
export async function clearGuard(machineryId: string): Promise<void> {
  await supabase
    .from('machine_guards')
    .update({ active: false, ended_at: new Date().toISOString() })
    .eq('machinery_id', machineryId)
    .eq('active', true);
}

/**
 * Renombra un supervisor en TODOS sus registros (corrige un nombre mal escrito
 * en el historial completo y en las asignaciones activas). Devuelve cuántos
 * registros se actualizaron.
 */
export async function renameGuardName(oldName: string, newName: string): Promise<number> {
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to || from === to) return 0;
  const { data, error } = await supabase
    .from('machine_guards')
    .update({ guard_name: to })
    .eq('guard_name', from)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}

/**
 * Elimina un supervisor por completo: borra TODOS sus registros de
 * `machine_guards` (historial y asignaciones activas). Las máquinas que
 * custodiaba quedan sin supervisor. Devuelve cuántos registros se borraron.
 */
export async function deleteGuardName(name: string): Promise<number> {
  const n = name.trim();
  if (!n) return 0;
  const { data, error } = await supabase
    .from('machine_guards')
    .delete()
    .eq('guard_name', n)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
}
