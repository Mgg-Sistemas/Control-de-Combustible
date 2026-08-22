import { supabase } from './supabase';

/**
 * VIAJES DE CAMIONES: bitácora de viajes (regreso/entrada = un viaje) registrada
 * por listeros en campo, sobre camiones de volteo (filas de `machinery`). Ver
 * `supabase/viajes_camiones.sql`.
 *
 * El chofer/responsable NO se duplica a mano en cada viaje: se resuelve desde
 * `machine_operators` (la asignación planeada por turno que ya administra el
 * Coordinador de Operadores, ver `src/lib/machineOperators.ts`) y se copia como
 * snapshot (`chofer_name`) al momento del viaje — si luego cambia el chofer
 * asignado, los viajes ya registrados conservan el nombre de quién iba en ese
 * momento.
 *
 * RLS de `camion_viajes`/`camion_viajes_config` está abierta a 'authenticated'
 * (using(true)): el control de quién puede registrar/editar/borrar se hace en
 * la UI/módulo (mismo criterio que `machine_operators`/`coordinator_*_scope`),
 * no aquí. Las funciones que dicen "se valida en la pantalla" NO repiten ese
 * chequeo — confían en que quien las llama ya lo hizo.
 */

function isMissingTable(msg: string): boolean {
  return /camion_viajes(_config)?|does not exist|relation|schema cache|could not find/i.test(msg || '');
}

export type CamionViajeRow = {
  id: string;
  machineryId: string;
  machineCode: string;
  listeroId: string;
  listeroName: string;
  choferName: string | null;
  shift: 'day' | 'night' | null;
  estadoMaquina: string | null;
  note: string | null;
  registeredAt: string; // ISO
};

function mapRow(r: any): CamionViajeRow {
  return {
    id: r.id as string,
    machineryId: r.machinery_id as string,
    machineCode: (r.machine_code ?? '—') as string,
    listeroId: r.listero_id as string,
    listeroName: (r.listero_name ?? '—') as string,
    choferName: (r.chofer_name ?? null) as string | null,
    shift: (r.shift === 'night' ? 'night' : r.shift === 'day' ? 'day' : null) as 'day' | 'night' | null,
    estadoMaquina: (r.estado_maquina ?? null) as string | null,
    note: (r.note ?? null) as string | null,
    registeredAt: r.registered_at as string,
  };
}

const SELECT_COLS = 'id, machinery_id, machine_code, listero_id, listero_name, chofer_name, shift, estado_maquina, note, registered_at';

/** Registra un viaje. `registeredAt` ya viene calculado por quien llama (la hora
 *  REAL del toque en el teléfono) — se inserta TAL CUAL, nunca `now()` del
 *  servidor (necesario para que un viaje registrado sin señal conserve su hora
 *  exacta al sincronizarse después, ver `src/lib/viajesOfflineQueue.ts`). */
export async function registrarViaje(params: {
  machineryId: string;
  machineCode: string;
  listeroId: string;
  listeroName: string;
  choferName: string | null;
  shift: 'day' | 'night' | null;
  estadoMaquina: string | null;
  note?: string | null;
  registeredAt: string; // ISO
  clientActionId?: string;
}): Promise<{ error?: string; missing?: boolean }> {
  const { error } = await supabase.from('camion_viajes').insert({
    machinery_id: params.machineryId,
    machine_code: params.machineCode,
    listero_id: params.listeroId,
    listero_name: params.listeroName,
    chofer_name: params.choferName,
    shift: params.shift,
    estado_maquina: params.estadoMaquina,
    note: params.note ?? null,
    registered_at: params.registeredAt,
    ...(params.clientActionId ? { client_action_id: params.clientActionId } : {}),
  });
  if (error) return { error: error.message, missing: isMissingTable(error.message) };
  return {};
}

/** Viajes del listero indicado dentro de un rango (normalmente "hoy", según su
 *  jornada) — para su propia pantalla de registro. Más reciente primero. */
export async function listMisViajesHoy(listeroId: string, desdeISO: string, hastaISO: string): Promise<{ rows: CamionViajeRow[]; missing: boolean }> {
  if (!listeroId) return { rows: [], missing: false };
  const { data, error } = await supabase
    .from('camion_viajes')
    .select(SELECT_COLS)
    .eq('listero_id', listeroId)
    .gte('registered_at', desdeISO)
    .lte('registered_at', hastaISO)
    .order('registered_at', { ascending: false });
  if (error) return { rows: [], missing: isMissingTable(error.message) };
  return { rows: ((data ?? []) as any[]).map(mapRow), missing: false };
}

/** TODOS los viajes en un rango, con filtros opcionales por listero y/o
 *  máquina — para la pantalla de la jefa/admin (reporte general). */
export async function listTodosLosViajes(filtro: {
  desdeISO: string;
  hastaISO: string;
  listeroIds?: string[];
  machineryIds?: string[];
}): Promise<{ rows: CamionViajeRow[]; missing: boolean }> {
  let q: any = supabase
    .from('camion_viajes')
    .select(SELECT_COLS)
    .gte('registered_at', filtro.desdeISO)
    .lte('registered_at', filtro.hastaISO);
  if (filtro.listeroIds && filtro.listeroIds.length > 0) q = q.in('listero_id', filtro.listeroIds);
  if (filtro.machineryIds && filtro.machineryIds.length > 0) q = q.in('machinery_id', filtro.machineryIds);
  q = q.order('registered_at', { ascending: false });
  const { data, error } = await q;
  if (error) return { rows: [], missing: isMissingTable(error.message) };
  return { rows: ((data ?? []) as any[]).map(mapRow), missing: false };
}

/** Corrige la hora de un viaje ya registrado. El listero solo debe poder
 *  llamar esto sobre sus PROPIOS viajes — se valida en la pantalla, no aquí. */
export async function editarHoraViaje(id: string, registeredAtISO: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('camion_viajes').update({ registered_at: registeredAtISO }).eq('id', id);
  if (error) return { error: error.message };
  return {};
}

/** Borrado real (hard delete) — la auditoría automática (`trg_audit`) conserva
 *  el registro completo igual. Solo debe quedar accesible desde la UI para
 *  nivel "full" del módulo (jefa/admin) — se valida en la pantalla, no aquí. */
export async function borrarViaje(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('camion_viajes').delete().eq('id', id);
  if (error) return { error: error.message };
  return {};
}

/** Meta de viajes/día por camión (columna `machinery.meta_viajes_diarios`,
 *  NULL = sin meta definida). Batch por lista de IDs. */
export async function getMetasPorCamion(machineryIds: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  if (!machineryIds || machineryIds.length === 0) return out;
  const { data, error } = await supabase.from('machinery').select('id, meta_viajes_diarios').in('id', machineryIds);
  if (error) return out;
  ((data ?? []) as any[]).forEach((r) => { out[r.id as string] = (r.meta_viajes_diarios ?? null) as number | null; });
  return out;
}

export async function setMetaCamion(machineryId: string, meta: number | null): Promise<{ error?: string }> {
  const { error } = await supabase.from('machinery').update({ meta_viajes_diarios: meta }).eq('id', machineryId);
  if (error) return { error: error.message };
  return {};
}

const DEFAULT_ALERTA_HORAS = 6;

/** Umbral configurable de "camión sin viajes hace X horas" (singleton
 *  `camion_viajes_config`). Si falla o falta la tabla, usa el default (6h)
 *  para no bloquear la alerta por un problema de configuración. */
export async function getAlertaHoras(): Promise<number> {
  const { data, error } = await supabase.from('camion_viajes_config').select('alerta_horas_sin_viaje').eq('id', true).maybeSingle();
  if (error || !data) return DEFAULT_ALERTA_HORAS;
  const n = Number((data as any).alerta_horas_sin_viaje);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ALERTA_HORAS;
}

export async function setAlertaHoras(horas: number, userId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('camion_viajes_config')
    .update({ alerta_horas_sin_viaje: horas, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) return { error: error.message };
  return {};
}

/** Chofer PLANEADO del turno (tabla `machine_operators`, ya administrada por el
 *  Coordinador de Operadores — NO se modifica aquí, solo se lee, mismo patrón
 *  de `listOperatorAssignments` en `src/lib/machineOperators.ts`: nombre VIVO
 *  desde `employees` si hay `employee_id`, si no el `operator_name` congelado).
 *  `null` si no hay nadie asignado a esa máquina en ese turno (o si falla). */
export async function resolveChoferActual(machineryId: string, shift: 'day' | 'night'): Promise<string | null> {
  if (!machineryId) return null;
  const { data, error } = await supabase
    .from('machine_operators')
    .select('employee_id, operator_name')
    .eq('machinery_id', machineryId)
    .eq('shift', shift)
    .eq('active', true)
    .maybeSingle();
  if (error || !data) return null;
  const employeeId = (data as any).employee_id as string | null;
  const operatorName = (data as any).operator_name as string | null;
  if (employeeId) {
    const { data: emp } = await supabase.from('employees').select('first_name, last_name').eq('id', employeeId).maybeSingle();
    const nm = emp ? `${(emp as any).first_name ?? ''} ${(emp as any).last_name ?? ''}`.trim() : '';
    if (nm) return nm;
  }
  return operatorName ?? null;
}
