// Cola de acciones offline para el registro de VIAJES de camiones (listeros en
// campo). A propósito SEPARADA de `src/lib/offlineQueue.ts` (esa está scoped a
// la pantalla del Supervisor/Inspector) — esta cubre únicamente `registrarViaje`,
// la única acción que un listero necesita poder diferir sin señal. Mismo patrón:
// AsyncStorage FIFO + client_action_id estable para idempotencia contra el
// índice único de la tabla (ver `uq_camion_viajes_client_action` en
// `supabase/viajes_camiones.sql`).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registrarViaje } from './camionViajes';
// Utilidades genéricas de conectividad reutilizadas tal cual — ya no son
// específicas de la pantalla del Supervisor, ver `src/lib/offlineQueue.ts`.
// Se re-exportan para que quien use esta cola no tenga que importar de dos
// archivos distintos.
import { isNetworkErrorMsg } from './offlineQueue';
export { isOnline, onConnectivityChange } from './offlineQueue';

const STORAGE_KEY = 'viajes_offline_queue_v1';

export type QueuedViaje = {
  id: string;
  createdAt: string;
  payload: Omit<Parameters<typeof registrarViaje>[0], 'clientActionId'>;
};

type Listener = (items: QueuedViaje[]) => void;
const listeners = new Set<Listener>();
let cache: QueuedViaje[] | null = null;

async function readAll(): Promise<QueuedViaje[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as QueuedViaje[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function writeAll(items: QueuedViaje[]): Promise<void> {
  cache = items;
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* best-effort */ }
  listeners.forEach((l) => l(items));
}

/** Suscribe a cambios en la cola (para el contador/insignia en la UI). Devuelve función para des-suscribir. */
export function subscribeViajesQueue(cb: Listener): () => void {
  listeners.add(cb);
  readAll().then((items) => cb(items));
  return () => listeners.delete(cb);
}

export async function queueViajesCount(): Promise<number> {
  return (await readAll()).length;
}

export async function enqueueViaje(payload: QueuedViaje['payload']): Promise<void> {
  const items = await readAll();
  const withNew: QueuedViaje[] = [
    ...items,
    { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), payload },
  ];
  await writeAll(withNew);
}

/** Violación de clave única (Postgres 23505). En un replay significa que ese
 *  viaje YA se insertó en el servidor (la respuesta se perdió tras el commit):
 *  se trata como éxito, no como error, para no duplicarlo. `registrarViaje`
 *  solo expone `error.message` (no el `.code` original de Postgres), así que
 *  se detecta por el texto del mensaje. */
function isDuplicateKeyErrorMsg(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes('duplicate key') || m.includes('23505');
}

let flushing = false;
/** Sube la cola en orden (FIFO), una por una. Si una falla (sigue sin señal, o
 *  cualquier otro error no de duplicado), se detiene ahí y deja el resto en la
 *  cola para el próximo intento. */
export async function flushViajesQueue(): Promise<{ synced: number; remaining: number }> {
  if (flushing) return { synced: 0, remaining: (await readAll()).length };
  flushing = true;
  try {
    const items = await readAll();
    let synced = 0;
    let rest = items;
    for (let i = 0; i < items.length; i++) {
      // client_action_id estable (= id de la acción en cola): si un replay anterior
      // ya insertó pero se perdió la respuesta, este reintento choca con el índice
      // único y se trata como éxito, en vez de duplicar el viaje.
      const { error } = await registrarViaje({ ...items[i].payload, clientActionId: items[i].id });
      if (error && !isDuplicateKeyErrorMsg(error)) {
        rest = items.slice(i);
        if (!isNetworkErrorMsg(error)) {
          console.warn(`[viajesOfflineQueue] item ${items[i].id} atascado — error no transitorio: ${error}`);
        }
        break;
      }
      synced++;
      rest = items.slice(i + 1);
    }
    if (synced > 0) await writeAll(rest);
    return { synced, remaining: rest.length };
  } finally {
    flushing = false;
  }
}
