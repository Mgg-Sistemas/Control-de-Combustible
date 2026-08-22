// Cola de acciones offline para el registro de VIAJES de camiones (listeros en
// campo). A propósito SEPARADA de `src/lib/offlineQueue.ts` (esa está scoped a
// la pantalla del Supervisor/Inspector) — esta cubre únicamente `registrarViaje`,
// la única acción que un listero necesita poder diferir sin señal. Mismo patrón:
// AsyncStorage FIFO + client_action_id estable para idempotencia contra el
// índice único de la tabla (ver `uq_camion_viajes_client_action` en
// `supabase/viajes_camiones.sql`).
//
// CUARENTENA (15-ago-2026): un ítem que falla por algo que NO es falta de señal
// (camión borrado, clave foránea rota, dato inválido) ya no bloquea la cola. Se
// reintenta `MAX_INTENTOS_COLA` veces y luego se aparta a una lista de
// cuarentena; la cola SIGUE con los viajes de atrás. Nada se descarta solo: la
// pantalla muestra los apartados en rojo con el motivo, con botón para
// reintentar una vez resuelta la causa. Ver `src/lib/colaOfflinePolicy.ts`.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registrarViaje } from './camionViajes';
// Decisión ÚNICA compartida de qué hacer con un ítem que falló (éxito /
// reintentar / cuarentena). No se reimplementa acá — ver el archivo para el
// porqué de cada regla.
import { decidirAccionCola, esErrorDeRed, MAX_INTENTOS_COLA } from './colaOfflinePolicy';
// Utilidades genéricas de conectividad reutilizadas tal cual — ya no son
// específicas de la pantalla del Supervisor, ver `src/lib/offlineQueue.ts`.
// Se re-exportan para que quien use esta cola no tenga que importar de dos
// archivos distintos.
export { isOnline, onConnectivityChange } from './offlineQueue';
export { MAX_INTENTOS_COLA } from './colaOfflinePolicy';

const STORAGE_KEY = 'viajes_offline_queue_v1';
const QUARANTINE_KEY = 'viajes_offline_quarantine_v1';

export type QueuedViaje = {
  id: string;
  createdAt: string;
  payload: Omit<Parameters<typeof registrarViaje>[0], 'clientActionId'>;
  /** Fallos NO de red acumulados. Al llegar a `MAX_INTENTOS_COLA` → cuarentena. */
  intentos?: number;
};

/** Viaje apartado: no pudo subirse y necesita que alguien resuelva la causa. */
export type QuarantinedViaje = {
  id: string;
  createdAt: string;
  payload: QueuedViaje['payload'];
  /** Último mensaje de error del servidor — es lo que se le muestra al usuario. */
  error: string;
  /** Cuándo se apartó. */
  failedAt: string;
  intentos: number;
};

type Listener = (items: QueuedViaje[]) => void;
type QuarantineListener = (items: QuarantinedViaje[]) => void;
const listeners = new Set<Listener>();
const quarantineListeners = new Set<QuarantineListener>();
let cache: QueuedViaje[] | null = null;
let quarantineCache: QuarantinedViaje[] | null = null;

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

async function readQuarantine(): Promise<QuarantinedViaje[]> {
  if (quarantineCache) return quarantineCache;
  try {
    const raw = await AsyncStorage.getItem(QUARANTINE_KEY);
    quarantineCache = raw ? (JSON.parse(raw) as QuarantinedViaje[]) : [];
  } catch {
    quarantineCache = [];
  }
  return quarantineCache;
}

async function writeQuarantine(items: QuarantinedViaje[]): Promise<void> {
  quarantineCache = items;
  try { await AsyncStorage.setItem(QUARANTINE_KEY, JSON.stringify(items)); } catch { /* best-effort */ }
  quarantineListeners.forEach((l) => l(items));
}

/** Suscribe a cambios en la cola (para el contador/insignia en la UI). Devuelve función para des-suscribir. */
export function subscribeViajesQueue(cb: Listener): () => void {
  listeners.add(cb);
  readAll().then((items) => cb(items));
  return () => listeners.delete(cb);
}

/** Suscribe a los viajes APARTADOS (cuarentena) — la UI los muestra en rojo. */
export function subscribeViajesQuarantine(cb: QuarantineListener): () => void {
  quarantineListeners.add(cb);
  readQuarantine().then((items) => cb(items));
  return () => quarantineListeners.delete(cb);
}

export async function queueViajesCount(): Promise<number> {
  return (await readAll()).length;
}

/** Viajes apartados que necesitan intervención. */
export async function quarantinedViajes(): Promise<QuarantinedViaje[]> {
  return [...(await readQuarantine())];
}

export async function enqueueViaje(payload: QueuedViaje['payload']): Promise<void> {
  const items = await readAll();
  const withNew: QueuedViaje[] = [
    ...items,
    { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), payload, intentos: 0 },
  ];
  await writeAll(withNew);
}

let flushing = false;
/**
 * Sube la cola en orden (FIFO), una por una.
 *  - Sin señal → se detiene y deja TODO para el próximo intento (no se pierde
 *    ni se cuenta como fallo del ítem).
 *  - Error de datos → se reintenta hasta `MAX_INTENTOS_COLA` y después el ítem
 *    se aparta a cuarentena y el bucle CONTINÚA con los siguientes. Este
 *    `continue` es lo que impide que un solo viaje roto congele los de atrás.
 */
export async function flushViajesQueue(): Promise<{ synced: number; remaining: number; quarantined: number }> {
  if (flushing) {
    return { synced: 0, remaining: (await readAll()).length, quarantined: (await readQuarantine()).length };
  }
  flushing = true;
  try {
    const items = await readAll();
    const pending: QueuedViaje[] = [];
    const apartados: QuarantinedViaje[] = [];
    let synced = 0;
    let cambio = false;
    // Una vez detenida la pasada (sin señal / error transitorio), el resto se
    // conserva tal cual, en orden, para el próximo intento.
    let detenido = false;

    for (const it of items) {
      if (detenido) { pending.push(it); continue; }
      const intentosPrevios = Number(it.intentos) || 0;
      // client_action_id estable (= id de la acción en cola): si un replay anterior
      // ya insertó pero se perdió la respuesta, este reintento choca con el índice
      // único y la política lo trata como éxito, en vez de duplicar el viaje.
      const { error } = await registrarViaje({ ...it.payload, clientActionId: it.id });
      const accion = decidirAccionCola({ error, intentos: intentosPrevios });

      if (accion === 'exito') { synced++; cambio = true; continue; }

      if (accion === 'cuarentena') {
        apartados.push({
          id: it.id,
          createdAt: it.createdAt,
          payload: it.payload,
          error: String(error),
          failedAt: new Date().toISOString(),
          intentos: intentosPrevios + 1,
        });
        cambio = true;
        console.warn(`[viajesOfflineQueue] viaje ${it.id} APARTADO tras ${intentosPrevios + 1} intentos: ${error}`);
        continue; // la cola sigue: los viajes de atrás no se quedan atascados
      }

      // 'reintentar'. La falta de señal NO cuenta como fallo del ítem (si no, un
      // día entero sin cobertura mandaría los viajes a cuarentena sin motivo).
      const deRed = esErrorDeRed(error);
      if (!deRed) cambio = true;
      pending.push(deRed ? it : { ...it, intentos: intentosPrevios + 1 });
      detenido = true;
    }

    if (apartados.length) await writeQuarantine([...(await readQuarantine()), ...apartados]);
    if (cambio) await writeAll(pending);
    return { synced, remaining: pending.length, quarantined: (await readQuarantine()).length };
  } finally {
    flushing = false;
  }
}

/**
 * Devuelve los viajes apartados a la cola (al frente) y vuelve a intentarlo —
 * para usar cuando ya se resolvió la causa (p. ej. se restauró el camión).
 * Conservan su `id` original, así que la idempotencia por `client_action_id`
 * sigue protegiendo contra duplicados.
 */
export async function retryQuarantinedViajes(): Promise<{ synced: number; remaining: number; quarantined: number }> {
  const q = await readQuarantine();
  if (q.length) {
    const items = await readAll();
    await writeQuarantine([]);
    await writeAll([
      ...q.map((x) => ({ id: x.id, createdAt: x.createdAt, payload: x.payload, intentos: 0 })),
      ...items,
    ]);
  }
  return flushViajesQueue();
}

/** Descarta UN viaje apartado. Solo por decisión explícita de una persona. */
export async function discardQuarantinedViaje(id: string): Promise<void> {
  const q = await readQuarantine();
  await writeQuarantine(q.filter((x) => x.id !== id));
}
