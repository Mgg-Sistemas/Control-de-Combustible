// Cola de acciones offline para la vista del INSPECTOR (SupervisorScreen). Si el
// teléfono se queda sin señal en campo, en vez de fallar la acción se guarda
// localmente (AsyncStorage) y se sube sola en cuanto vuelva la conexión.
//
// Alcance a propósito LIMITADO a acciones seguras de diferir (inserts propios o
// updates por filtro, sin dependencias de lectura previa que puedan quedar
// desactualizadas): check-in (visita), avería libre, parada (avería/no trabajó,
// con el "bancado" de horas resuelto en el momento del flush, no antes) y volver
// a operativa. INICIAR/FINALIZAR JORNADA NO se difieren: calculan retrasos,
// alertas a admin y validan el horómetro contra el estado del servidor — hacerlo
// mal offline podría dejar horas o alertas incorrectas, así que esas dos exigen
// conexión (se lo avisamos al inspector en el momento).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Network from 'expo-network';
import { supabase } from './supabase';
import { saveVisit, SaveVisitInput } from './supervisorVisits';
import { getMachineRound, upsertMachineRound } from './machineRounds';
import { logAudit } from './audit';

const STORAGE_KEY = 'offline_queue_v1';

type MaintenanceInsert = {
  machinery_id: string;
  material: string;
  quantity?: number | null;
  notes: string | null;
  status: string;
  requested_by: string | null;
  photo_url?: string | null;
  /** Clave de idempotencia (auditoría sync#5): la ponen los replays de la cola,
   *  no los inserts online. Ver replayOne + índice único uq_maintenance_client_action. */
  client_action_id?: string;
};

export type QueuedAveria = {
  kind: 'averia';
  payload: MaintenanceInsert;
};

export type QueuedParada = {
  kind: 'parada';
  payload: {
    visita: SaveVisitInput; // status: 'parada'
    maintenance: MaintenanceInsert[]; // 1 (no trabajó) o 2 filas (avería real + MÁQUINA PARADA)
    hourBanking: null | { machineryId: string; roundDate: string; shiftKey: 'day_hours' | 'night_hours'; horas: number };
    auditDetail: string;
    machineryId: string;
    machineCode: string;
    /** Sub-pasos ya confirmados con éxito (se persiste tras cada uno). Si un
     *  reintento falla a mitad de camino, el próximo `replayOne` retoma desde
     *  aquí en vez de repetir pasos que ya se aplicaron en el servidor
     *  (evita duplicar la visita, banca horas dos veces o duplicar tickets). */
    progress?: { visitaHecha?: boolean; horasBancadas?: boolean; maintenanceDone?: number };
  };
};

export type QueuedVolverOperativa = {
  kind: 'volver_operativa';
  payload: {
    visita: SaveVisitInput; // status: 'trabajando'
    machineryId: string;
    machineCode: string;
    resolvedBy: string | null;
  };
};

export type QueuedAction = { id: string; createdAt: string; label: string } & (
  | QueuedAveria
  | QueuedParada
  | QueuedVolverOperativa
);

type Listener = (items: QueuedAction[]) => void;
const listeners = new Set<Listener>();
let cache: QueuedAction[] | null = null;

async function readAll(): Promise<QueuedAction[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as QueuedAction[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function writeAll(items: QueuedAction[]): Promise<void> {
  cache = items;
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* best-effort */ }
  listeners.forEach((l) => l(items));
}

/** Persiste el progreso de sub-pasos de un ítem `parada` (por id) sin tocar el
 *  resto de la cola. Se llama tras cada sub-paso exitoso de `replayOne` para
 *  que un fallo posterior en el MISMO ítem no repita lo ya confirmado. */
async function persistParadaProgress(id: string, progress: NonNullable<QueuedParada['payload']['progress']>): Promise<void> {
  const items = await readAll();
  const idx = items.findIndex((it) => it.id === id);
  if (idx === -1) return;
  const item = items[idx];
  if (item.kind !== 'parada') return;
  const updated = [...items];
  updated[idx] = { ...item, payload: { ...item.payload, progress } };
  await writeAll(updated);
}

/** Suscribe a cambios en la cola (para el contador/insignia en la UI). Devuelve función para des-suscribir. */
export function subscribeQueue(cb: Listener): () => void {
  listeners.add(cb);
  readAll().then((items) => cb(items));
  return () => listeners.delete(cb);
}

export async function queueCount(): Promise<number> {
  return (await readAll()).length;
}

export async function queueItems(): Promise<QueuedAction[]> {
  return [...(await readAll())];
}

async function enqueue<T extends QueuedAveria | QueuedParada | QueuedVolverOperativa>(action: T & { label: string }): Promise<void> {
  const items = await readAll();
  const withNew: QueuedAction[] = [...items, { ...action, id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString() }];
  await writeAll(withNew);
}

export const enqueueAveria = (payload: MaintenanceInsert, label: string) => enqueue({ kind: 'averia', payload, label });
export const enqueueParada = (payload: QueuedParada['payload'], label: string) => enqueue({ kind: 'parada', payload, label });
export const enqueueVolverOperativa = (payload: QueuedVolverOperativa['payload'], label: string) => enqueue({ kind: 'volver_operativa', payload, label });

// Estado de conectividad EN VIVO en nativo (auditoría frontend#2): antes isOnline()
// devolvía SIEMPRE true en nativo (no había NetInfo), así que la cola nunca sabía
// que el teléfono estaba sin señal y solo se enteraba por el catch reactivo de cada
// petición. Con expo-network reflejamos la conexión real. En web se sigue usando
// navigator.onLine (fiable para "sin señal").
let nativeOnline = true;
const stateToOnline = (s: { isConnected?: boolean | null; isInternetReachable?: boolean | null }): boolean =>
  s.isConnected !== false && s.isInternetReachable !== false;
if (Platform.OS !== 'web') {
  Network.getNetworkStateAsync().then((s) => { nativeOnline = stateToOnline(s); }).catch(() => {});
  try {
    Network.addNetworkStateListener((s) => { nativeOnline = stateToOnline(s); });
  } catch { /* si la API cambia, queda el estado inicial + el catch reactivo por acción */ }
}

/** ¿Hay red? En web usa navigator.onLine; en nativo, el estado real de expo-network. */
export function isOnline(): boolean {
  if (Platform.OS === 'web') {
    return typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
  }
  return nativeOnline;
}

/** Se suscribe a los cambios de conectividad: eventos del navegador en web,
 *  addNetworkStateListener de expo-network en nativo. */
export function onConnectivityChange(cb: (online: boolean) => void): () => void {
  if (Platform.OS !== 'web') {
    try {
      const sub = Network.addNetworkStateListener((s) => cb(stateToOnline(s)));
      return () => { try { sub.remove(); } catch { /* best-effort */ } };
    } catch { return () => {}; }
  }
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
  const onUp = () => cb(true);
  const onDown = () => cb(false);
  window.addEventListener('online', onUp);
  window.addEventListener('offline', onDown);
  return () => { window.removeEventListener('online', onUp); window.removeEventListener('offline', onDown); };
}

/** Mensajes típicos de fallo de RED (no de validación) al llamar a Supabase. */
export function isNetworkErrorMsg(msg?: string | null): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return m.includes('failed to fetch') || m.includes('network request failed') || m.includes('fetch failed') || m.includes('load failed');
}

/** Violación de clave única (Postgres 23505). En un replay de la cola significa
 *  que ese insert YA se aplicó en el servidor (la respuesta se perdió tras el
 *  commit, ver sync#5): se trata como éxito, no como error, para no duplicar. */
function isDuplicateKeyError(error: any): boolean {
  return error?.code === '23505' || String(error?.message ?? '').toLowerCase().includes('duplicate key');
}

async function replayOne(item: QueuedAction): Promise<void> {
  if (item.kind === 'averia') {
    // client_action_id estable (= id de la acción en cola) → si un replay anterior
    // ya insertó pero se perdió la respuesta, este reintento choca con el índice
    // único y se trata como éxito (sync#5), en vez de crear un ticket duplicado.
    const { error } = await supabase.from('maintenance_requests').insert({ ...item.payload, client_action_id: item.id });
    if (error && !isDuplicateKeyError(error)) throw new Error(error.message);
    return;
  }
  if (item.kind === 'parada') {
    const { visita, maintenance, hourBanking, auditDetail, machineryId } = item.payload;
    // Idempotencia por sub-paso: retoma desde lo último confirmado (ver
    // `progress`) para que un reintento tras fallo parcial no repita la
    // visita, banque las horas dos veces ni duplique tickets ya insertados.
    const progress = { ...(item.payload.progress ?? {}) };
    if (!progress.visitaHecha) {
      const v = await saveVisit(visita);
      if (v.error) throw new Error(v.error);
      progress.visitaHecha = true;
      await persistParadaProgress(item.id, progress);
    }
    if (hourBanking && !progress.horasBancadas) {
      const prev = await getMachineRound(hourBanking.machineryId, hourBanking.roundDate);
      const base = Number((prev as any)?.[hourBanking.shiftKey] ?? 0);
      // TOPE 12h por turno (igual que finalizarJornada, el módulo y los reportes).
      const total = Math.round(Math.min(12, base + hourBanking.horas) * 100) / 100;
      const res = await upsertMachineRound(hourBanking.machineryId, hourBanking.roundDate, { [hourBanking.shiftKey]: total, jornada_start_at: null } as any, visita.supervisorId);
      if (res.error) throw new Error(res.error);
      progress.horasBancadas = true;
      await persistParadaProgress(item.id, progress);
    }
    const desde = progress.maintenanceDone ?? 0;
    for (let mi = desde; mi < maintenance.length; mi++) {
      // client_action_id único por (acción, fila) → idempotente ante respuesta
      // perdida tras el commit (sync#5): un reintento no duplica el ticket.
      const { error } = await supabase.from('maintenance_requests').insert({ ...maintenance[mi], client_action_id: `${item.id}:${mi}` });
      if (error && !isDuplicateKeyError(error)) throw new Error(error.message);
      progress.maintenanceDone = mi + 1;
      await persistParadaProgress(item.id, progress);
    }
    logAudit('PARADA', 'machinery', machineryId, auditDetail);
    return;
  }
  if (item.kind === 'volver_operativa') {
    const { visita, machineryId, resolvedBy } = item.payload;
    await saveVisit(visita); // best-effort: no bloquea el cierre de las averías si falla
    const { error: e1 } = await supabase.from('maintenance_requests')
      .update({ status: 'realizado', resolved_by: resolvedBy, resolved_at: new Date().toISOString() })
      .eq('machinery_id', machineryId).eq('material', 'MÁQUINA PARADA').eq('status', 'pendiente');
    const { error: e2 } = await supabase.from('maintenance_requests')
      .update({ status: 'realizado', resolved_by: resolvedBy, resolved_at: new Date().toISOString() })
      .eq('machinery_id', machineryId).neq('material', 'MÁQUINA PARADA').eq('status', 'pendiente');
    if (e1 && e2) throw new Error(e1.message);
    logAudit('JORNADA_INICIO', 'machinery', machineryId, `vuelve a OPERATIVA (sincronizado)`);
    return;
  }
}

let flushing = false;
/** Sube la cola en orden (FIFO), una por una. Si una falla (sigue sin señal),
 *  se detiene ahí y deja el resto en la cola para el próximo intento. */
export async function flushQueue(): Promise<{ synced: number; remaining: number }> {
  if (flushing) return { synced: 0, remaining: (await readAll()).length };
  flushing = true;
  try {
    const items = await readAll();
    let synced = 0;
    let rest = items;
    for (let i = 0; i < items.length; i++) {
      try {
        await replayOne(items[i]);
        synced++;
        rest = items.slice(i + 1);
      } catch {
        // El ítem que falló pudo haber persistido progreso parcial (ver
        // `persistParadaProgress` en `replayOne`) mientras este bucle corría;
        // se relee la cola en vez de usar el snapshot `items` de más arriba
        // para no pisar ese progreso con la versión sin confirmar.
        const freshItems = await readAll();
        const idx = freshItems.findIndex((it) => it.id === items[i].id);
        rest = idx === -1 ? freshItems : freshItems.slice(idx);
        break;
      }
    }
    if (synced > 0) await writeAll(rest);
    return { synced, remaining: rest.length };
  } finally {
    flushing = false;
  }
}
