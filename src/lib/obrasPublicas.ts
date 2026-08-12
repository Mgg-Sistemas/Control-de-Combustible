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

// ── Vista del supervisor (teléfono): sus máquinas + acciones aisladas ────────

/** IDs de las máquinas asignadas a un supervisor (asignación vigente). */
export async function listMyOpMachineIds(supervisorId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('op_machine_supervisors')
    .select('machinery_id')
    .eq('supervisor_id', supervisorId)
    .eq('active', true);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.machinery_id as string);
}

export type OpRound = {
  machinery_id: string; round_date: string; day_hours: number; night_hours: number;
  jornada_start_at: string | null; jornada_shift: 'day' | 'night' | null;
};

/** Jornadas op_* de una fecha para un conjunto de máquinas. */
export async function fetchOpRounds(machineryIds: string[], roundDate: string): Promise<Record<string, OpRound>> {
  if (!machineryIds.length) return {};
  const { data, error } = await supabase
    .from('op_machine_rounds')
    .select('machinery_id, round_date, day_hours, night_hours, jornada_start_at, jornada_shift')
    .in('machinery_id', machineryIds).eq('round_date', roundDate);
  if (error) throw error;
  const m: Record<string, OpRound> = {};
  (data ?? []).forEach((r: any) => {
    m[r.machinery_id] = {
      machinery_id: r.machinery_id, round_date: r.round_date,
      day_hours: Number(r.day_hours) || 0, night_hours: Number(r.night_hours) || 0,
      jornada_start_at: r.jornada_start_at, jornada_shift: r.jornada_shift,
    };
  });
  return m;
}

export type OpMaint = { machinery_id: string; tipo: 'averia' | 'parada'; motivo: string | null };

/** Averías/paradas op_* PENDIENTES (avería real gana a la parada). */
export async function fetchOpMaintPending(machineryIds: string[]): Promise<Record<string, OpMaint>> {
  if (!machineryIds.length) return {};
  const { data, error } = await supabase
    .from('op_maintenance')
    .select('machinery_id, material, notes, created_at')
    .in('machinery_id', machineryIds).eq('status', 'pendiente')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const m: Record<string, OpMaint> = {};
  (data ?? []).forEach((r: any) => {
    const tipo = r.material === 'MÁQUINA PARADA' ? 'parada' : 'averia';
    const prev = m[r.machinery_id];
    // avería real tiene prioridad; si ya hay avería no la pisa una parada.
    if (!prev || (prev.tipo === 'parada' && tipo === 'averia')) {
      m[r.machinery_id] = { machinery_id: r.machinery_id, tipo, motivo: r.notes ?? (tipo === 'averia' ? r.material : null) };
    }
  });
  return m;
}

/** Inicia la jornada op_* de una máquina (turno según la hora). */
export async function opStartJornada(machineryId: string, roundDate: string, shift: 'day' | 'night', userId?: string | null): Promise<void> {
  const { error } = await supabase.from('op_machine_rounds').upsert(
    { machinery_id: machineryId, round_date: roundDate, round_no: 1, jornada_shift: shift, jornada_start_at: new Date().toISOString(), jornada_marked_at: new Date().toISOString(), recorded_by: userId ?? null },
    { onConflict: 'machinery_id,round_date,round_no' },
  );
  if (error) throw error;
}

/** Finaliza la jornada op_* abierta: banca las horas del turno y cierra. */
export async function opFinishJornada(round: OpRound, userId?: string | null): Promise<void> {
  if (!round.jornada_start_at) return;
  const horas = Math.max(0, Math.round(((Date.now() - new Date(round.jornada_start_at).getTime()) / 3600000) * 100) / 100);
  const key = round.jornada_shift === 'night' ? 'night_hours' : 'day_hours';
  const base = round.jornada_shift === 'night' ? round.night_hours : round.day_hours;
  const { error } = await supabase.from('op_machine_rounds').update(
    { [key]: Math.round((base + horas) * 100) / 100, jornada_start_at: null },
  ).eq('machinery_id', round.machinery_id).eq('round_date', round.round_date).eq('round_no', 1);
  if (error) throw error;
}

/** Marca avería (o parada) op_* de una máquina. `material='MÁQUINA PARADA'` = parada. */
export async function opMarkMaint(machineryId: string, material: string, notes: string, shift: 'day' | 'night', roundDate: string, userId?: string | null): Promise<void> {
  const { error } = await supabase.from('op_maintenance').insert({
    machinery_id: machineryId, material, notes: notes || null, status: 'pendiente', shift, round_date: roundDate, requested_by: userId ?? null,
  });
  if (error) throw error;
}

/** Registra una visita/check-in op_* con GPS. */
export async function opRegistrarVisita(inp: { machineryId: string; supervisorId?: string | null; supervisorName?: string | null; visitDate: string; status: string; lat: number | null; lng: number | null; note?: string | null; machineLat?: number | null; machineLng?: number | null }): Promise<void> {
  const { error } = await supabase.from('op_supervisor_visits').insert({
    machinery_id: inp.machineryId, supervisor_id: inp.supervisorId ?? null, supervisor_name: inp.supervisorName ?? null,
    visit_date: inp.visitDate, status: inp.status, lat: inp.lat, lng: inp.lng, note: inp.note ?? null,
    machine_lat: inp.machineLat ?? null, machine_lng: inp.machineLng ?? null,
  });
  if (error) throw error;
}

/** Actualiza la ubicación de la máquina (COMPARTIDA — se refleja en el mapa). */
export async function updateMachineLocation(machineryId: string, lat: number, lng: number): Promise<void> {
  const { error } = await supabase.from('machinery').update({ latitude: lat, longitude: lng }).eq('id', machineryId);
  if (error) throw error;
}
