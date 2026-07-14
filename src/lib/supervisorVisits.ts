import { supabase } from './supabase';
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

export type VisitRow = SupervisorVisit & { machineCode?: string; companyName?: string };

/** Todas las visitas de un día (o rango), con el código y empresa de la máquina. */
export async function listVisits(fromDate: string, toDate?: string): Promise<VisitRow[]> {
  let q = supabase
    .from('supervisor_visits')
    .select('*, machine:machinery_id(code, company:company_id(name))')
    .gte('visit_date', fromDate)
    .order('visited_at', { ascending: false });
  if (toDate) q = q.lte('visit_date', toDate);
  else q = q.eq('visit_date', fromDate);
  const { data } = await q;
  return ((data ?? []) as any[]).map((v) => ({
    ...v,
    machineCode: v.machine?.code ?? '—',
    companyName: v.machine?.company?.name ?? 'Sin empresa',
  }));
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
