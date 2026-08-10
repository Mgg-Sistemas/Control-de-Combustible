import { supabase } from './supabase';

/**
 * ASIGNACIÓN PLANEADA OPERADOR ↔ MÁQUINA (para el Coordinador de Operadores).
 *
 * A diferencia de `operator_assignments` (que se crea sola cuando el operador
 * escanea el QR y arranca su jornada — es un registro de lo que YA pasó), esta
 * tabla guarda lo que el coordinador PLANEÓ: quién debería estar en cada
 * máquina, por turno, antes de que el operador llegue. Mismo patrón que
 * `machine_inspectors` (ver `src/lib/machineInspectors.ts`), un turno por
 * máquina.
 *
 * Tabla: public.machine_operators.
 */

export type Shift = 'day' | 'night';
export const shiftIcon = (s: Shift) => (s === 'night' ? '🌙' : '☀️');
export const shiftLabel = (s: Shift) => (s === 'night' ? 'Noche' : 'Día');

export type OperatorAssignmentRow = {
  id: string; machinery_id: string; employee_id: string | null; operator_name: string; cedula: string | null;
  shift: Shift; assigned_at: string; code: string; serial: string | null; plate: string | null;
  companyName: string; referencia: string | null; encargado: string | null; sector: string | null;
  tipo: string | null;
  machineActive: boolean | null; machineOperational: boolean | null; machineEnEspera: boolean | null;
};

/** Asigna un operador a una máquina en un TURNO (día/noche). Reemplaza al que
 *  tuviera ese turno en esa máquina (1 operador planeado por máquina+turno). */
export async function assignOperator(
  machineryId: string, employeeId: string | null, operatorName: string, cedula: string | null, shift: Shift, assignedBy: string | null,
): Promise<{ error?: string; missing?: boolean }> {
  const { error } = await supabase
    .from('machine_operators')
    .upsert(
      { machinery_id: machineryId, employee_id: employeeId, operator_name: operatorName, cedula, shift, active: true, assigned_by: assignedBy, assigned_at: new Date().toISOString() },
      { onConflict: 'machinery_id,shift' },
    );
  if (error) return { error: error.message, missing: isMissingTable(error.message) };
  return {};
}

/** Quita la asignación planeada de una máquina en un turno (día/noche). */
export async function unassignOperator(machineryId: string, shift: Shift): Promise<{ error?: string; missing?: boolean }> {
  const { error } = await supabase
    .from('machine_operators')
    .delete()
    .eq('machinery_id', machineryId)
    .eq('shift', shift);
  if (error) return { error: error.message, missing: isMissingTable(error.message) };
  return {};
}

/** Todas las asignaciones planeadas ACTIVAS, con datos de la máquina (para la
 *  vista del Coordinador de Operadores). Más reciente primero. `missing` =
 *  falta correr el SQL de `machine_operators` en Supabase. */
export async function listOperatorAssignments(): Promise<{ rows: OperatorAssignmentRow[]; missing: boolean }> {
  const { data, error } = await supabase
    .from('machine_operators')
    .select('id, machinery_id, employee_id, operator_name, cedula, shift, assigned_at, machine:machinery_id(code, serial, plate, tipo, sector, referencia, encargado, active, operational, en_espera, company:company_id(name))')
    .eq('active', true)
    .order('assigned_at', { ascending: false });
  if (error) return { rows: [], missing: isMissingTable(error.message) };
  // Nombre VIVO del operador: `operator_name` queda "congelado" al asignar; si luego
  // se corrige el nombre en Empleados, preferimos el vigente (mismo criterio que
  // `listInspectorAssignments()` con `profiles.full_name`).
  const empIds = Array.from(new Set(((data ?? []) as any[]).map((r) => r.employee_id).filter(Boolean)));
  const liveName: Record<string, string> = {};
  if (empIds.length) {
    const { data: emps } = await supabase.from('employees').select('id, first_name, last_name').in('id', empIds);
    ((emps ?? []) as any[]).forEach((e) => {
      const nm = `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim();
      if (nm) liveName[e.id] = nm;
    });
  }
  const rows = ((data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    machinery_id: r.machinery_id as string,
    employee_id: (r.employee_id ?? null) as string | null,
    operator_name: ((r.employee_id && liveName[r.employee_id]) || r.operator_name || '—') as string,
    cedula: (r.cedula ?? null) as string | null,
    shift: (r.shift === 'night' ? 'night' : 'day') as Shift,
    assigned_at: r.assigned_at as string,
    code: r.machine?.code ?? '—',
    serial: r.machine?.serial ?? null,
    plate: r.machine?.plate ?? null,
    tipo: r.machine?.tipo ?? null,
    companyName: r.machine?.company?.name ?? 'Sin empresa',
    referencia: r.machine?.referencia ?? null,
    encargado: r.machine?.encargado ?? null,
    sector: r.machine?.sector ?? null,
    machineActive: (r.machine?.active ?? null) as boolean | null,
    machineOperational: (r.machine?.operational ?? null) as boolean | null,
    machineEnEspera: (r.machine?.en_espera ?? null) as boolean | null,
  }));
  return { rows, missing: false };
}

/** Detecta el error típico de "la tabla todavía no existe" (falta correr el SQL). */
function isMissingTable(msg: string): boolean {
  return /machine_operators|does not exist|relation|schema cache|could not find/i.test(msg || '');
}
