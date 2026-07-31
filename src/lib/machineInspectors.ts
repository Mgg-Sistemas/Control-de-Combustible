import { supabase } from './supabase';

/**
 * ASIGNACIÓN INSPECTOR ↔ MÁQUINA (el "CHECK MÁQUINA" del teléfono).
 *
 * Cada inspector, desde su sesión, ve SOLO las máquinas que tiene asignadas. La
 * asignación se crea/quita con el CHECK y "casa" a la persona logueada con la
 * máquina. Es independiente de la custodia militar (machine_guards) y de las
 * visitas de inspección (supervisor_visits).
 *
 * Tabla: public.machine_inspectors (ver supabase/inspector_asignacion.sql).
 */

/** IDs de las máquinas asignadas ACTUALMENTE a un inspector.
 *  `missing` = la tabla aún no existe (falta correr el SQL en Supabase). */
export async function myInspectorMachineIds(inspectorId: string): Promise<{ ids: Set<string>; missing: boolean }> {
  if (!inspectorId) return { ids: new Set(), missing: false };
  const { data, error } = await supabase
    .from('machine_inspectors')
    .select('machinery_id')
    .eq('inspector_id', inspectorId)
    .eq('active', true);
  if (error) return { ids: new Set(), missing: isMissingTable(error.message) };
  return { ids: new Set(((data ?? []) as any[]).map((r) => r.machinery_id as string)), missing: false };
}

/** Asigna (o reactiva) una máquina al inspector. */
export async function assignInspector(machineryId: string, inspectorId: string, inspectorName: string): Promise<{ error?: string; missing?: boolean }> {
  const { error } = await supabase
    .from('machine_inspectors')
    .upsert(
      { machinery_id: machineryId, inspector_id: inspectorId, inspector_name: inspectorName, active: true, assigned_at: new Date().toISOString() },
      { onConflict: 'machinery_id,inspector_id' },
    );
  if (error) return { error: error.message, missing: isMissingTable(error.message) };
  return {};
}

export type AssignmentRow = {
  id: string; machinery_id: string; inspector_id: string | null; inspector_name: string;
  assigned_at: string; code: string; serial: string | null; plate: string | null; companyName: string;
};

/** Todas las asignaciones ACTIVAS (CHECK) con datos de la máquina, para el módulo
 *  de Inspecciones. Más reciente primero. `missing` = falta correr el SQL. */
export async function listInspectorAssignments(): Promise<{ rows: AssignmentRow[]; missing: boolean }> {
  const { data, error } = await supabase
    .from('machine_inspectors')
    .select('id, machinery_id, inspector_id, inspector_name, assigned_at, machine:machinery_id(code, serial, plate, company:company_id(name))')
    .eq('active', true)
    .order('assigned_at', { ascending: false });
  if (error) return { rows: [], missing: isMissingTable(error.message) };
  const rows = ((data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    machinery_id: r.machinery_id as string,
    inspector_id: (r.inspector_id ?? null) as string | null,
    inspector_name: (r.inspector_name || '—') as string,
    assigned_at: r.assigned_at as string,
    code: r.machine?.code ?? '—',
    serial: r.machine?.serial ?? null,
    plate: r.machine?.plate ?? null,
    companyName: r.machine?.company?.name ?? 'Sin empresa',
  }));
  return { rows, missing: false };
}

/** Quita la asignación de una máquina al inspector. */
export async function unassignInspector(machineryId: string, inspectorId: string): Promise<{ error?: string; missing?: boolean }> {
  const { error } = await supabase
    .from('machine_inspectors')
    .delete()
    .eq('machinery_id', machineryId)
    .eq('inspector_id', inspectorId);
  if (error) return { error: error.message, missing: isMissingTable(error.message) };
  return {};
}

/** Detecta el error típico de "la tabla todavía no existe" (falta correr el SQL). */
function isMissingTable(msg: string): boolean {
  return /machine_inspectors|does not exist|relation|schema cache|could not find/i.test(msg || '');
}
