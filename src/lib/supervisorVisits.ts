import { supabase, selectAllRows } from './supabase';
import { SupervisorVisit, VisitStatus } from '../types/database';

/**
 * Tolerancia de cercanía (metros). El supervisor cuenta como "en sitio" si su
 * GPS está dentro de este radio de la ubicación conocida de la máquina. Es
 * amplio a propósito: la máquina puede estar trabajando y no se puede
 * interrumpir, así que basta con estar "más o menos cerca".
 */
export const VISIT_NEAR_M = 300;

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // radio terrestre (m)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export type SaveVisitInput = {
  machineryId: string;
  supervisorId: string | null;
  supervisorName: string;
  visitDate: string;        // día ISO (Caracas)
  status: VisitStatus;
  lat?: number | null;
  lng?: number | null;
  note?: string | null;
  /** Ubicación conocida de la máquina, para calcular la cercanía. */
  machineLat?: number | null;
  machineLng?: number | null;
};

/**
 * Registra una visita (check-in) del supervisor a la máquina. Si hay GPS del
 * supervisor y coordenadas de la máquina, calcula la distancia y si está dentro
 * de la tolerancia. Devuelve la fila creada.
 */
export async function saveVisit(input: SaveVisitInput): Promise<{ data: SupervisorVisit | null; error?: string; distance_m: number | null; near: boolean | null }> {
  let distance_m: number | null = null;
  let near: boolean | null = null;
  if (input.lat != null && input.lng != null && input.machineLat != null && input.machineLng != null) {
    distance_m = haversineM(input.lat, input.lng, input.machineLat, input.machineLng);
    near = distance_m <= VISIT_NEAR_M;
  }
  const { data, error } = await supabase
    .from('supervisor_visits')
    .insert({
      machinery_id: input.machineryId,
      supervisor_id: input.supervisorId,
      supervisor_name: input.supervisorName,
      visit_date: input.visitDate,
      status: input.status,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      distance_m,
      near,
      note: (input.note ?? '').trim() || null,
    })
    .select()
    .single();
  return { data: (data as SupervisorVisit) ?? null, error: error?.message, distance_m, near };
}

export type VisitRow = SupervisorVisit & {
  machineCode?: string; machineSerial?: string | null; machinePlate?: string | null;
  machineRef?: string | null; machineLat?: number | null; machineLng?: number | null;
  machineEncargado?: string | null;
  companyName?: string;
};

/** Todas las visitas de un día (o rango), con el código, serial/placa, referencia,
 *  ubicación (para el sector) y empresa de la máquina. */
export async function listVisits(fromDate: string, toDate?: string): Promise<VisitRow[]> {
  let q = supabase
    .from('supervisor_visits')
    .select('*, machine:machinery_id(code, serial, plate, referencia, latitude, longitude, encargado, company:company_id(name))')
    .gte('visit_date', fromDate)
    .order('visited_at', { ascending: false });
  if (toDate) q = q.lte('visit_date', toDate);
  else q = q.eq('visit_date', fromDate);
  const { data } = await q;
  return ((data ?? []) as any[]).map((v) => ({
    ...v,
    machineCode: v.machine?.code ?? '—',
    machineSerial: v.machine?.serial ?? null,
    machinePlate: v.machine?.plate ?? null,
    machineRef: v.machine?.referencia ?? null,
    machineLat: v.machine?.latitude ?? null,
    machineLng: v.machine?.longitude ?? null,
    machineEncargado: v.machine?.encargado ?? null,
    companyName: v.machine?.company?.name ?? 'Sin empresa',
  }));
}

/** Inspector "asignado" a una máquina. PRIORIDAD: la asignación explícita del
 *  CHECK del teléfono (machine_inspectors). Si no hay CHECK, cae al ÚLTIMO
 *  check-in (visita). Las de usuarios ADMIN se IGNORAN (pruebas de sistemas). */
export type InspectorInfo = { name: string; date: string; status: VisitStatus; near: boolean | null };
export async function latestInspectorByMachine(): Promise<Record<string, InspectorInfo>> {
  const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
  const adminIds = new Set(((admins ?? []) as any[]).map((a) => a.id as string));
  // Solo necesitamos la ÚLTIMA visita por máquina: un check-in de hace meses ya no
  // dice quién es el inspector "actual". Acotamos a los últimos 90 días para no
  // descargar toda la tabla histórica (que crece sin límite). Además, la asignación
  // explícita del CHECK (machine_inspectors, más abajo) manda por encima de esto.
  const floor = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await selectAllRows('supervisor_visits', 'machinery_id, supervisor_id, supervisor_name, visit_date, visited_at, status, near', (q) => q.gte('visit_date', floor));
  const acc: Record<string, InspectorInfo & { _ts: string }> = {};
  (rows ?? []).forEach((v: any) => {
    if (v.supervisor_id && adminIds.has(v.supervisor_id)) return; // ignora visitas de admin (pruebas)
    const cur = acc[v.machinery_id];
    if (!cur || String(v.visited_at) > cur._ts) {
      acc[v.machinery_id] = { name: v.supervisor_name, date: v.visit_date, status: v.status, near: v.near, _ts: v.visited_at };
    }
  });
  const out: Record<string, InspectorInfo> = {};
  Object.entries(acc).forEach(([k, v]) => { out[k] = { name: v.name, date: v.date, status: v.status, near: v.near }; });

  // Superpone la asignación EXPLÍCITA del CHECK (machine_inspectors): tiene
  // prioridad sobre el último check-in. Cada máquina tiene inspector de DÍA (☀️)
  // y de NOCHE (🌙); se muestran ambos. Si la tabla no existe, se ignora.
  try {
    const { data: asg } = await supabase
      .from('machine_inspectors')
      .select('machinery_id, inspector_id, inspector_name, shift, assigned_at')
      .eq('active', true);
    const per: Record<string, { day?: { name: string; ts: string }; night?: { name: string; ts: string } }> = {};
    ((asg ?? []) as any[]).forEach((a) => {
      // El CHECK es explícito: se respeta aunque sea de un usuario admin (no se filtra).
      const slot: 'day' | 'night' = a.shift === 'night' ? 'night' : 'day';
      const cur = (per[a.machinery_id] ||= {})[slot];
      if (!cur || String(a.assigned_at) > String(cur.ts)) per[a.machinery_id][slot] = { name: a.inspector_name || '—', ts: a.assigned_at || '' };
    });
    // Fecha de asignación de CADA turno, en su propia etiqueta: antes se mostraba
    // una sola fecha (la más reciente de las dos) pegada a AMBOS nombres, lo que
    // hacía parecer que el inspector de día y el de noche se asignaron el mismo
    // día aunque fuera falso — "se solapaba" el día con la noche.
    const dmyOf = (ts?: string) => { const [y, mo, d] = (ts || '').slice(0, 10).split('-'); return y && mo && d ? `${d}/${mo}/${y}` : ''; };
    Object.entries(per).forEach(([mid, s]) => {
      const parts: string[] = [];
      if (s.day) parts.push(`☀️ ${s.day.name}${dmyOf(s.day.ts) ? ` (${dmyOf(s.day.ts)})` : ''}`);
      if (s.night) parts.push(`🌙 ${s.night.name}${dmyOf(s.night.ts) ? ` (${dmyOf(s.night.ts)})` : ''}`);
      if (parts.length === 0) return;
      out[mid] = {
        name: parts.join(' · '),
        // La fecha por turno ya va dentro de `name`; se deja vacía para que quien
        // solo imprima "name · date" (EquiposScreen) no repita/mezcle una fecha
        // única que ya no aplica a ambos turnos por igual.
        date: '',
        status: out[mid]?.status ?? 'trabajando',
        near: out[mid]?.near ?? null,
      };
    });
  } catch { /* tabla aún no creada: se usa solo el último check-in */ }
  return out;
}

/** IDs de máquinas visitadas en un día (para saber cuáles están validadas). */
export async function visitedMachineIds(fromDate: string, toDate?: string): Promise<Set<string>> {
  let q = supabase.from('supervisor_visits').select('machinery_id').gte('visit_date', fromDate);
  if (toDate) q = q.lte('visit_date', toDate);
  else q = q.eq('visit_date', fromDate);
  const { data } = await q;
  return new Set(((data ?? []) as any[]).map((r) => r.machinery_id as string));
}

/**
 * Últimas visitas de un supervisor en un día, por máquina (para marcar en su
 * lista cuáles ya revisó hoy). Devuelve un mapa machinery_id → visita.
 */
export async function myVisitsToday(supervisorId: string, date: string): Promise<Record<string, SupervisorVisit>> {
  const { data } = await supabase
    .from('supervisor_visits')
    .select('*')
    .eq('supervisor_id', supervisorId)
    .eq('visit_date', date)
    .order('visited_at', { ascending: false });
  const map: Record<string, SupervisorVisit> = {};
  ((data ?? []) as SupervisorVisit[]).forEach((v) => { if (!map[v.machinery_id]) map[v.machinery_id] = v; });
  return map;
}
