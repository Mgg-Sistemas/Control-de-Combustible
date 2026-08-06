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

/** UUID fijo del usuario de SISTEMA "MAQUINAS FALTANTES" (ver supabase/maquinas_faltantes.sql):
 *  cubre automáticamente los turnos que se queden sin inspector humano (cron cada 15 min) para
 *  que la máquina siga acumulando horas, pero NO es un encargado real — sirve para distinguir
 *  "cubierta por el sistema" de "asignada a una persona de verdad". */
export const PLACEHOLDER_INSPECTOR_ID = '00000000-0000-0000-0000-00000000fa1a';

/** Turno de la asignación: día (☀️) o noche (🌙). */
export type Shift = 'day' | 'night';
export const shiftIcon = (s: Shift) => (s === 'night' ? '🌙' : '☀️');
export const shiftLabel = (s: Shift) => (s === 'night' ? 'Noche' : 'Día');

/** IDs de las máquinas asignadas ACTUALMENTE a un inspector (cualquier turno).
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

/** Asigna una máquina al inspector en un TURNO (día/noche). Reemplaza al que
 *  tuviera ese turno en esa máquina (1 inspector por máquina+turno). */
export async function assignInspector(machineryId: string, inspectorId: string, inspectorName: string, shift: Shift): Promise<{ error?: string; missing?: boolean }> {
  const { error } = await supabase
    .from('machine_inspectors')
    .upsert(
      { machinery_id: machineryId, inspector_id: inspectorId, inspector_name: inspectorName, shift, active: true, assigned_at: new Date().toISOString() },
      { onConflict: 'machinery_id,shift' },
    );
  if (error) return { error: error.message, missing: isMissingTable(error.message) };
  return {};
}

export type AssignmentRow = {
  id: string; machinery_id: string; inspector_id: string | null; inspector_name: string; shift: Shift;
  assigned_at: string; code: string; serial: string | null; plate: string | null; companyName: string;
  referencia: string | null; latitude: number | null; longitude: number | null; encargado: string | null;
  sector: string | null;
};

/** Todas las asignaciones ACTIVAS (CHECK) con datos de la máquina (incluye
 *  referencia y ubicación para agrupar por sector), para el módulo de
 *  Inspecciones. Más reciente primero. `missing` = falta correr el SQL. */
export async function listInspectorAssignments(): Promise<{ rows: AssignmentRow[]; missing: boolean }> {
  const { data, error } = await supabase
    .from('machine_inspectors')
    .select('id, machinery_id, inspector_id, inspector_name, shift, assigned_at, machine:machinery_id(code, serial, plate, sector, referencia, encargado, latitude, longitude, company:company_id(name))')
    .eq('active', true)
    .order('assigned_at', { ascending: false });
  if (error) return { rows: [], missing: isMissingTable(error.message) };
  // Nombre VIVO del inspector: `inspector_name` queda "congelado" al asignar (se guardó
  // el full_name de ese momento), así que si luego lo renombran en Usuarios no cambia.
  // Leemos el full_name actual de profiles por inspector_id y lo PREFERIMOS, para que
  // el módulo/teléfono/PDF siempre muestren el nombre vigente. Fallback: el guardado.
  const inspIds = Array.from(new Set(((data ?? []) as any[]).map((r) => r.inspector_id).filter(Boolean)));
  const liveName: Record<string, string> = {};
  if (inspIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', inspIds);
    ((profs ?? []) as any[]).forEach((p) => { if (p.full_name) liveName[p.id] = p.full_name; });
  }
  const rows = ((data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    machinery_id: r.machinery_id as string,
    inspector_id: (r.inspector_id ?? null) as string | null,
    inspector_name: ((r.inspector_id && liveName[r.inspector_id]) || r.inspector_name || '—') as string,
    shift: (r.shift === 'night' ? 'night' : 'day') as Shift,
    assigned_at: r.assigned_at as string,
    code: r.machine?.code ?? '—',
    serial: r.machine?.serial ?? null,
    plate: r.machine?.plate ?? null,
    companyName: r.machine?.company?.name ?? 'Sin empresa',
    referencia: r.machine?.referencia ?? null,
    latitude: r.machine?.latitude ?? null,
    longitude: r.machine?.longitude ?? null,
    encargado: r.machine?.encargado ?? null,
    sector: r.machine?.sector ?? null,
  }));
  return { rows, missing: false };
}

/** Quita la asignación de una máquina al inspector en un turno (día/noche). */
export async function unassignInspector(machineryId: string, inspectorId: string, shift: Shift): Promise<{ error?: string; missing?: boolean }> {
  const { error } = await supabase
    .from('machine_inspectors')
    .delete()
    .eq('machinery_id', machineryId)
    .eq('inspector_id', inspectorId)
    .eq('shift', shift);
  if (error) return { error: error.message, missing: isMissingTable(error.message) };
  return {};
}

/** Detecta el error típico de "la tabla todavía no existe" (falta correr el SQL). */
function isMissingTable(msg: string): boolean {
  return /machine_inspectors|does not exist|relation|schema cache|could not find/i.test(msg || '');
}
