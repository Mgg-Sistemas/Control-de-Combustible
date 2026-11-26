import { supabase } from './supabase';
import { resolveAssignmentsForDate, shouldKeepAssignedAt, type AssignmentSpan } from './inspectorHistorial';

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
 *  "cubierta por el sistema" de "asignada a una persona de verdad".
 *  OJO: debe coincidir EXACTO con el id real usado en supabase/maquinas_faltantes.sql — antes
 *  tenía un UUID inventado de una versión temprana que nunca se actualizó al id real, así que
 *  `esVirtual()` (SupervisorScreen.tsx) nunca coincidía y el badge "🤖 sin encargado real" y el
 *  filtro "sin_real" quedaban rotos en silencio. */
export const PLACEHOLDER_INSPECTOR_ID = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';

/**
 * REGLA DE NEGOCIO — INSPECTORES "SIEMPRE ACTIVOS".
 * Las máquinas asignadas a estos inspectores SIEMPRE se consideran trabajando:
 * nunca se clasifican como "parada" ni "avería" (aunque existan solicitudes
 * MÁQUINA PARADA / averías pendientes en el historial de mantenimiento) y sus
 * horas paradas se cuentan como trabajadas. El historial de mantenimiento NO se
 * borra; solo se ignora al clasificar el estado y contar horas.
 * Comparar SIEMPRE contra el nombre VIVO del inspector (el que resuelve
 * listInspectorAssignments() desde profiles), en minúsculas y sin espacios extra.
 *
 * 🛑 APAGADA el 28-oct-2026 (pedido del cliente: «el inspector SOS no debe activar
 * máquinas ni nada»; «si la marcaron parada, que siga parada»). Con el interruptor en
 * false las máquinas del SOS se clasifican como cualquier otra: su avería o parada se
 * ve, y sus horas paradas NO se cuentan como trabajadas. Ocultar no es eliminar: para
 * volver a encenderla, poner `SOS_SIEMPRE_ACTIVO = true`.
 */
export const SOS_SIEMPRE_ACTIVO = false;
const NOMBRES_INSPECTOR_SOS = ['inspector sos la guaira'];
export const INSPECTORES_SIEMPRE_ACTIVOS: string[] = SOS_SIEMPRE_ACTIVO ? NOMBRES_INSPECTOR_SOS : [];
export function inspectorSiempreActivo(name?: string | null): boolean {
  return INSPECTORES_SIEMPRE_ACTIVOS.includes((name || '').trim().toLowerCase());
}

/** ¿Es el «Inspector SOS LA GUAIRA»? Solo IDENTIFICA al inspector (no cambia ningún estado). */
export function esInspectorSos(name?: string | null): boolean {
  return NOMBRES_INSPECTOR_SOS.includes((name || '').trim().toLowerCase());
}

/**
 * ¿Solo un ADMIN puede ASIGNARLE máquinas NUEVAS a este inspector? (pedido del
 * cliente 11-ago-2026: los analistas/coordinadores pueden REASIGNAR — quitarle a
 * este inspector una máquina que ya tiene y dársela a otro — libremente, pero no
 * pueden cargarle máquinas nuevas sin que sea decisión de un admin). Cubre dos
 * casos que antes se confundían en el código: el placeholder "MÁQUINAS FALTANTES"
 * (ya restringido) y ahora también el inspector REAL "Inspector SOS LA GUAIRA"
 * (`inspectorSiempreActivo`). Solo filtra el PICKER de asignar — `unassignInspector`
 * no tiene ni necesita este check, quitar sigue abierto a cualquiera con permiso
 * de coordinar inspectores.
 */
export function soloAdminPuedeAsignar(p: { id?: string | null; full_name?: string | null }): boolean {
  return p.id === PLACEHOLDER_INSPECTOR_ID || esInspectorSos(p.full_name);
}

/**
 * ¿Es el cajón "MAQUINAS FALTANTES" (sin inspector humano real)? Antes la
 * pantalla (InspectionsSummary.tsx) y el PDF (inspectorSummaryReport.ts) tenían
 * cada uno su propia copia de este mismo regex — centralizado acá para que no
 * puedan desincronizarse. Un nombre vacío o que contenga "faltant" no es un
 * inspector real: no se le calcula % de eficiencia.
 */
export function sinInspectorReal(name?: string | null): boolean {
  return !name || /faltant/i.test(name);
}

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
 *  tuviera ese turno en esa máquina (1 inspector por máquina+turno).
 *  Si ya estaba asignado el MISMO inspector activo en ese turno, conserva su
 *  `assigned_at` original para no hacer desaparecer el turno recién cerrado. */
export async function assignInspector(machineryId: string, inspectorId: string, inspectorName: string, shift: Shift): Promise<{ error?: string; missing?: boolean }> {
  let assignedAt = new Date().toISOString();
  const { data: existing } = await supabase
    .from('machine_inspectors')
    .select('inspector_id, active, assigned_at')
    .eq('machinery_id', machineryId)
    .eq('shift', shift)
    .maybeSingle();
  if (existing && shouldKeepAssignedAt(existing as any, inspectorId) && (existing as any).assigned_at) {
    assignedAt = (existing as any).assigned_at as string;
  }
  const { error } = await supabase
    .from('machine_inspectors')
    .upsert(
      { machinery_id: machineryId, inspector_id: inspectorId, inspector_name: inspectorName, shift, active: true, assigned_at: assignedAt },
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
  // MARCA-MODELO de la máquina (campo de texto libre `tipo`, ej. "CAT 320").
  tipo: string | null;
  // Estado del CATÁLOGO: para poder mostrar solo máquinas activas donde se requiera.
  machineActive: boolean | null; machineOperational: boolean | null;
  // En espera de recepción (taller/traslado): mismo criterio que `necesitaInspector()`
  // del teléfono — antes faltaba aquí, así que la PC seguía contando estas máquinas
  // (universo/pendientes/eficiencia) aunque el teléfono ya las ocultara al inspector.
  machineEnEspera: boolean | null;
};

function mapAssignmentRows(raw: any[], liveName: Record<string, string>): AssignmentRow[] {
  return raw.map((r) => ({
    id: r.id as string,
    machinery_id: r.machinery_id as string,
    inspector_id: (r.inspector_id ?? null) as string | null,
    inspector_name: ((r.inspector_id && liveName[r.inspector_id]) || r.inspector_name || '—') as string,
    shift: (r.shift === 'night' ? 'night' : 'day') as Shift,
    assigned_at: (r.assigned_at ?? r.valid_from ?? '') as string,
    code: r.machine?.code ?? '—',
    serial: r.machine?.serial ?? null,
    plate: r.machine?.plate ?? null,
    tipo: r.machine?.tipo ?? null,
    companyName: r.machine?.company?.name ?? 'Sin empresa',
    referencia: r.machine?.referencia ?? null,
    latitude: r.machine?.latitude ?? null,
    longitude: r.machine?.longitude ?? null,
    encargado: r.machine?.encargado ?? null,
    sector: r.machine?.sector ?? null,
    machineActive: (r.machine?.active ?? null) as boolean | null,
    machineOperational: (r.machine?.operational ?? null) as boolean | null,
    machineEnEspera: (r.machine?.en_espera ?? null) as boolean | null,
  }));
}

async function fetchLiveInspectorNames(raw: any[]): Promise<Record<string, string>> {
  const inspIds = Array.from(new Set(raw.map((r) => r.inspector_id).filter(Boolean)));
  const liveName: Record<string, string> = {};
  if (inspIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', inspIds);
    ((profs ?? []) as any[]).forEach((p) => { if (p.full_name) liveName[p.id] = p.full_name; });
  }
  return liveName;
}

function addOneDayIso(iso: string): string {
  const d = new Date(`${iso}T12:00:00-04:00`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Todas las asignaciones ACTIVAS (CHECK) con datos de la máquina (incluye
 *  referencia y ubicación para agrupar por sector).
 *  - Sin `date`: estado VIVO actual (`machine_inspectors`) — para teléfono y vistas en vivo.
 *  - Con `date` (`YYYY-MM-DD`): resuelve el historial de `machine_inspector_history`
 *    por ventana de turno Caracas (Día 07:00–19:00, Noche 19:00–07:00+1) para que
 *    reasignar hoy NUNCA borre ni mueva turnos cerrados ni días pasados. */
export async function listInspectorAssignments(date?: string): Promise<{ rows: AssignmentRow[]; missing: boolean }> {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const hist = await listInspectorAssignmentsForDate(date);
    if (!hist.missing && hist.rows.length > 0) return hist;
  }
  const { data, error } = await supabase
    .from('machine_inspectors')
    .select('id, machinery_id, inspector_id, inspector_name, shift, assigned_at, machine:machinery_id(code, serial, plate, tipo, sector, referencia, encargado, latitude, longitude, active, operational, en_espera, company:company_id(name))')
    .eq('active', true)
    .order('assigned_at', { ascending: false });
  if (error) return { rows: [], missing: isMissingTable(error.message) };
  const raw = (data ?? []) as any[];
  const liveName = await fetchLiveInspectorNames(raw);
  return { rows: mapAssignmentRows(raw, liveName), missing: false };
}

/** Resuelve las asignaciones vigentes por turno para una fecha específica (`YYYY-MM-DD`)
 *  leyendo `public.machine_inspector_history` en 1 sola consulta + 1 de `profiles`. */
export async function listInspectorAssignmentsForDate(date: string): Promise<{ rows: AssignmentRow[]; missing: boolean }> {
  const dayStartIso = `${date}T07:00:00-04:00`;
  const nightEndIso = `${addOneDayIso(date)}T07:00:00-04:00`;
  const { data, error } = await supabase
    .from('machine_inspector_history')
    .select('id, machinery_id, inspector_id, inspector_name, shift, valid_from, valid_to, machine:machinery_id(code, serial, plate, tipo, sector, referencia, encargado, latitude, longitude, active, operational, en_espera, company:company_id(name))')
    .lte('valid_from', nightEndIso)
    .or(`valid_to.is.null,valid_to.gt.${dayStartIso}`);
  if (error) return { rows: [], missing: isMissingTable(error.message) };
  const raw = (data ?? []) as any[];
  if (raw.length === 0) return { rows: [], missing: false };
  const liveName = await fetchLiveInspectorNames(raw);
  const enriched = raw.map((r) => ({
    ...r,
    inspector_name: ((r.inspector_id && liveName[r.inspector_id]) || r.inspector_name || '—') as string,
    shift: (r.shift === 'night' ? 'night' : 'day') as Shift,
    assigned_at: r.valid_from as string,
  }));
  const winners = resolveAssignmentsForDate(enriched, date, false);
  return { rows: mapAssignmentRows(winners, liveName), missing: false };
}

/** Tramos históricos que solapan un rango `[from..to]` en 1 sola consulta (cero N+1),
 *  pensado para `HistoricoJornadasScreen`. Si la tabla aún no existe, cae a la foto actual. */
export async function listInspectorAssignmentsForRange(
  from: string,
  to: string,
): Promise<{ spans: AssignmentSpan[]; missing: boolean }> {
  const rangeStartIso = `${from}T07:00:00-04:00`;
  const rangeEndIso = `${addOneDayIso(to)}T07:00:00-04:00`;
  const { data, error } = await supabase
    .from('machine_inspector_history')
    .select('id, machinery_id, inspector_id, inspector_name, shift, valid_from, valid_to')
    .lte('valid_from', rangeEndIso)
    .or(`valid_to.is.null,valid_to.gt.${rangeStartIso}`);
  if (!error && data && data.length > 0) {
    const raw = data as any[];
    const liveName = await fetchLiveInspectorNames(raw);
    const spans: AssignmentSpan[] = raw.map((r) => ({
      id: r.id as string,
      machinery_id: r.machinery_id as string,
      inspector_id: (r.inspector_id ?? null) as string | null,
      inspector_name: ((r.inspector_id && liveName[r.inspector_id]) || r.inspector_name || '') as string,
      shift: (r.shift === 'night' ? 'night' : 'day') as Shift,
      valid_from: r.valid_from as string,
      valid_to: (r.valid_to ?? null) as string | null,
    }));
    return { spans, missing: false };
  }
  // Fallback defensivo: si no hay filas históricas o falta la tabla, usar foto actual
  const live = await listInspectorAssignments();
  const fallbackSpans: AssignmentSpan[] = live.rows.map((r) => ({
    id: r.id,
    machinery_id: r.machinery_id,
    inspector_id: r.inspector_id,
    inspector_name: r.inspector_name,
    shift: r.shift,
    valid_from: '2020-01-01T00:00:00Z',
    valid_to: null,
  }));
  return { spans: fallbackSpans, missing: live.missing };
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
