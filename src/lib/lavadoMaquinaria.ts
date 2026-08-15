// ============================================================================
// Módulo LAVADO DE MAQUINARIA — capa de datos AISLADA (tablas lm_*).
// El "lavador" registra los lavados de máquinas del catálogo (machinery). Este
// archivo solo habla con lm_wash_types / lm_washes y con `machinery` (catálogo,
// compartido). No toca inspecciones ni ningún otro módulo.
// ============================================================================
import { supabase } from './supabase';

/** Un tipo de lavado (exterior / motor / completo / …). Editable. */
export type LmWashType = { id: string; name: string; active: boolean; sort: number };

/** Una máquina del catálogo elegible para lavar. */
export type LmMachine = {
  id: string; code: string; serial: string | null; plate: string | null;
  marca: string | null; modelo: string | null; tipo: string | null; company: string;
};

/** Un lavado registrado (con datos de la máquina para mostrar sin re-join). */
export type LmWash = {
  id: string; machinery_id: string; machine_code: string; machine_serial: string | null;
  washed_by: string | null; washed_by_name: string | null; washed_at: string;
  tipo: string | null; observaciones: string | null; photo: string | null;
};

/** Fila del panel PC: una máquina con su conteo de lavados en el periodo. */
export type LmMachineCount = {
  machinery_id: string; code: string; serial: string | null; company: string; count: number; last_at: string | null;
};

// ── Tipos de lavado ─────────────────────────────────────────────────────────
export async function listWashTypes(): Promise<LmWashType[]> {
  const { data, error } = await supabase
    .from('lm_wash_types').select('id, name, active, sort').eq('active', true)
    .order('sort', { ascending: true }).order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, active: r.active, sort: r.sort ?? 0 }));
}

/** Agrega un tipo de lavado (o lo reactiva si existía). Devuelve el nombre normalizado. */
export async function addWashType(name: string): Promise<string> {
  const clean = name.trim();
  if (!clean) throw new Error('Nombre vacío');
  const { error } = await supabase
    .from('lm_wash_types')
    .upsert({ name: clean, active: true }, { onConflict: 'name' });
  if (error) throw error;
  return clean;
}

// ── Máquinas del catálogo (para elegir / escanear) ──────────────────────────
export async function listWashMachines(): Promise<LmMachine[]> {
  const { data, error } = await supabase
    .from('machinery')
    .select('id, code, serial, plate, marca, modelo, tipo, company:company_id(name)')
    .eq('active', true)
    .order('code', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((m: any) => ({
    id: m.id, code: m.code ?? '—', serial: m.serial ?? null, plate: m.plate ?? null,
    marca: m.marca ?? null, modelo: m.modelo ?? null, tipo: m.tipo ?? null,
    company: m.company?.name ?? 'Sin empresa',
  }));
}

/** Una máquina por id (para el flujo de escaneo de QR). null si no existe/está inactiva. */
export async function getWashMachine(id: string): Promise<LmMachine | null> {
  const { data, error } = await supabase
    .from('machinery')
    .select('id, code, serial, plate, marca, modelo, tipo, active, company:company_id(name)')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data || (data as any).active === false) return null;
  const m: any = data;
  return {
    id: m.id, code: m.code ?? '—', serial: m.serial ?? null, plate: m.plate ?? null,
    marca: m.marca ?? null, modelo: m.modelo ?? null, tipo: m.tipo ?? null,
    company: m.company?.name ?? 'Sin empresa',
  };
}

// ── Lavados ─────────────────────────────────────────────────────────────────
/** Lavados dentro de un rango [fromISO, toISO). Ordenados del más reciente al más viejo. */
export async function listWashesInRange(fromISO: string, toISO: string): Promise<LmWash[]> {
  const { data, error } = await supabase
    .from('lm_washes')
    .select('id, machinery_id, washed_by, washed_by_name, washed_at, tipo, observaciones, photo, machine:machinery_id(code, serial)')
    .gte('washed_at', fromISO).lt('washed_at', toISO)
    .order('washed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id, machinery_id: r.machinery_id, machine_code: r.machine?.code ?? '—', machine_serial: r.machine?.serial ?? null,
    washed_by: r.washed_by ?? null, washed_by_name: r.washed_by_name ?? null, washed_at: r.washed_at,
    tipo: r.tipo ?? null, observaciones: r.observaciones ?? null, photo: r.photo ?? null,
  }));
}

/** Registra un lavado. `photo` opcional (base64). Devuelve el id creado. */
export async function registerWash(payload: {
  machineryId: string; washedBy: string | null; washedByName?: string | null;
  tipo?: string | null; observaciones?: string | null; photo?: string | null; washedAt?: string;
}): Promise<string> {
  const row = {
    machinery_id: payload.machineryId,
    washed_by: payload.washedBy,
    washed_by_name: payload.washedByName ?? null,
    washed_at: payload.washedAt ?? new Date().toISOString(),
    tipo: payload.tipo ?? null,
    observaciones: payload.observaciones ?? null,
    photo: payload.photo ?? null,
  };
  const { data, error } = await supabase.from('lm_washes').insert(row).select('id').single();
  if (error) throw error;
  return (data as any).id as string;
}

/** Borra un lavado (corrección). */
export async function deleteWash(id: string): Promise<void> {
  const { error } = await supabase.from('lm_washes').delete().eq('id', id);
  if (error) throw error;
}

// ── Panel PC ────────────────────────────────────────────────────────────────
/**
 * Conteo de lavados por máquina en un rango [fromISO, toISO) — para "Máquinas
 * lavadas" del panel. Se agrega en el cliente (no hay tantos lavados/mes como
 * para necesitar un RPC). Devuelve solo las máquinas CON al menos un lavado.
 */
export async function fetchWashCountsByMachine(fromISO: string, toISO: string): Promise<LmMachineCount[]> {
  const { data, error } = await supabase
    .from('lm_washes')
    .select('machinery_id, washed_at, machine:machinery_id(code, serial, company:company_id(name))')
    .gte('washed_at', fromISO).lt('washed_at', toISO);
  if (error) throw error;
  const map = new Map<string, LmMachineCount>();
  (data ?? []).forEach((r: any) => {
    const id = r.machinery_id as string;
    const cur = map.get(id) ?? {
      machinery_id: id, code: r.machine?.code ?? '—', serial: r.machine?.serial ?? null,
      company: r.machine?.company?.name ?? 'Sin empresa', count: 0, last_at: null as string | null,
    };
    cur.count += 1;
    if (!cur.last_at || r.washed_at > cur.last_at) cur.last_at = r.washed_at;
    map.set(id, cur);
  });
  return [...map.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code, 'es', { numeric: true }));
}

/** Detalle: todos los lavados de UNA máquina dentro del rango (para el drill-down). */
export async function fetchMachineWashes(machineryId: string, fromISO: string, toISO: string): Promise<LmWash[]> {
  const { data, error } = await supabase
    .from('lm_washes')
    .select('id, machinery_id, washed_by, washed_by_name, washed_at, tipo, observaciones, photo, machine:machinery_id(code, serial)')
    .eq('machinery_id', machineryId)
    .gte('washed_at', fromISO).lt('washed_at', toISO)
    .order('washed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id, machinery_id: r.machinery_id, machine_code: r.machine?.code ?? '—', machine_serial: r.machine?.serial ?? null,
    washed_by: r.washed_by ?? null, washed_by_name: r.washed_by_name ?? null, washed_at: r.washed_at,
    tipo: r.tipo ?? null, observaciones: r.observaciones ?? null, photo: r.photo ?? null,
  }));
}

/**
 * Usuarios "lavador": perfiles cuyo rol dinámico (app_roles.modules) o permiso
 * por-usuario (module_permissions) incluye 'lavado_maquinaria'. Mismo criterio
 * que listOpSupervisors de obras públicas.
 */
export async function listLavadoWorkers(): Promise<{ id: string; full_name: string }[]> {
  const [rolesRes, permsRes] = await Promise.all([
    supabase.from('app_roles').select('id, modules'),
    supabase.from('module_permissions').select('user_id, level').eq('module', 'lavado_maquinaria').neq('level', 'none'),
  ]);
  if (rolesRes.error) throw rolesRes.error;
  if (permsRes.error) throw permsRes.error;
  const roleIds = (rolesRes.data ?? [])
    .filter((r: any) => r?.modules && r.modules['lavado_maquinaria'] && r.modules['lavado_maquinaria'] !== 'none')
    .map((r: any) => r.id as string);
  const permUserIds = (permsRes.data ?? []).map((p: any) => p.user_id as string);
  if (!roleIds.length && !permUserIds.length) return [];
  const [byRole, byPerm] = await Promise.all([
    roleIds.length ? supabase.from('profiles').select('id, full_name, active').in('app_role_id', roleIds) : Promise.resolve({ data: [] as any[], error: null }),
    permUserIds.length ? supabase.from('profiles').select('id, full_name, active').in('id', permUserIds) : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (byRole.error) throw byRole.error;
  if (byPerm.error) throw byPerm.error;
  const seen = new Set<string>();
  const out: { id: string; full_name: string }[] = [];
  [...(byRole.data ?? []), ...(byPerm.data ?? [])].forEach((p: any) => {
    if (p.active === false || seen.has(p.id)) return;
    seen.add(p.id);
    out.push({ id: p.id, full_name: p.full_name ?? '(sin nombre)' });
  });
  out.sort((a, b) => a.full_name.localeCompare(b.full_name, 'es', { sensitivity: 'base' }));
  return out;
}
