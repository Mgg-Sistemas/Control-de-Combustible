import { supabase } from './supabase';

/**
 * ALCANCE DE MÁQUINAS del Coordinador de Operadores: qué máquinas puede
 * ver/asignar cada coordinador (por USUARIO, no por rol — dos coordinadores
 * pueden necesitar ver empresas distintas). Ver
 * supabase/coordinador_alcance_maquinas.sql.
 *
 * Sin ninguna fila en NINGUNA de las dos tablas = SIN restricción, ve TODAS
 * las máquinas (comportamiento por defecto — no bloquea de golpe a los
 * coordinadores que ya existen). El alcance final es la UNIÓN de:
 *   · coordinator_company_scope: TODA una empresa, EN VIVO (una máquina nueva
 *     de esa empresa entra sola).
 *   · coordinator_machine_scope: máquinas SUELTAS puntuales.
 */

function isMissingTable(msg: string): boolean {
  return /coordinator_(company|machine)_scope|does not exist|relation|schema cache|could not find/i.test(msg || '');
}

export type CompanyScopeRow = { companyId: string; companyName: string };
export type MachineScopeRow = { machineryId: string; code: string };

/** Empresas asignadas en bloque a este coordinador (alcance por empresa). */
export async function listCompanyScope(userId: string): Promise<{ rows: CompanyScopeRow[]; missing: boolean }> {
  if (!userId) return { rows: [], missing: false };
  const { data, error } = await supabase
    .from('coordinator_company_scope')
    .select('company_id, company:company_id(name)')
    .eq('user_id', userId);
  if (error) return { rows: [], missing: isMissingTable(error.message) };
  const rows = ((data ?? []) as any[]).map((r) => ({ companyId: r.company_id as string, companyName: r.company?.name ?? 'Sin nombre' }));
  rows.sort((a, b) => a.companyName.localeCompare(b.companyName));
  return { rows, missing: false };
}

/** Máquinas sueltas asignadas a este coordinador (alcance por máquina). */
export async function listMachineScope(userId: string): Promise<{ rows: MachineScopeRow[]; missing: boolean }> {
  if (!userId) return { rows: [], missing: false };
  const { data, error } = await supabase
    .from('coordinator_machine_scope')
    .select('machinery_id, machinery:machinery_id(code)')
    .eq('user_id', userId);
  if (error) return { rows: [], missing: isMissingTable(error.message) };
  const rows = ((data ?? []) as any[]).map((r) => ({ machineryId: r.machinery_id as string, code: r.machinery?.code ?? '—' }));
  rows.sort((a, b) => a.code.localeCompare(b.code));
  return { rows, missing: false };
}

export async function addCompanyScope(userId: string, companyId: string): Promise<{ error?: string; missing?: boolean }> {
  const { error } = await supabase
    .from('coordinator_company_scope')
    .upsert({ user_id: userId, company_id: companyId }, { onConflict: 'user_id,company_id' });
  if (error) return { error: error.message, missing: isMissingTable(error.message) };
  return {};
}
export async function removeCompanyScope(userId: string, companyId: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('coordinator_company_scope').delete().eq('user_id', userId).eq('company_id', companyId);
  if (error) return { error: error.message };
  return {};
}
export async function addMachineScope(userId: string, machineryId: string): Promise<{ error?: string; missing?: boolean }> {
  const { error } = await supabase
    .from('coordinator_machine_scope')
    .upsert({ user_id: userId, machinery_id: machineryId }, { onConflict: 'user_id,machinery_id' });
  if (error) return { error: error.message, missing: isMissingTable(error.message) };
  return {};
}
export async function removeMachineScope(userId: string, machineryId: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('coordinator_machine_scope').delete().eq('user_id', userId).eq('machinery_id', machineryId);
  if (error) return { error: error.message };
  return {};
}

/**
 * IDs de máquinas visibles para este coordinador, o `null` = SIN restricción
 * (ve todas — ni una fila configurada en ninguna de las dos tablas, o la
 * migración de Supabase todavía no corrió). Uso:
 *   const scope = await resolveScopedMachineIds(uid);
 *   if (scope && !scope.has(m.id)) return false; // fuera de su alcance
 */
export async function resolveScopedMachineIds(userId: string): Promise<Set<string> | null> {
  if (!userId) return null;
  const [{ rows: companyRows, missing: missingCompany }, { rows: machineRows, missing: missingMachine }] = await Promise.all([
    listCompanyScope(userId),
    listMachineScope(userId),
  ]);
  if (missingCompany || missingMachine) return null; // tabla aún no existe en Supabase: no bloquear a nadie
  if (companyRows.length === 0 && machineRows.length === 0) return null; // sin configurar = ve todas
  const ids = new Set<string>(machineRows.map((r) => r.machineryId));
  if (companyRows.length > 0) {
    const { data } = await supabase.from('machinery').select('id').in('company_id', companyRows.map((r) => r.companyId));
    ((data ?? []) as any[]).forEach((r) => ids.add(r.id as string));
  }
  return ids;
}
