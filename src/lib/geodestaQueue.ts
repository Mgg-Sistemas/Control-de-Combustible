// Cola OFFLINE del módulo de Geodesta: cuando no hay señal en campo, las capturas
// (puntos) se guardan localmente y se SINCRONIZAN al reconectar, enviándose POR
// LOTES (chunking) para no saturar la red. Es independiente de la cola del inspector
// (src/lib/offlineQueue.ts) para no mezclar dominios.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const KEY = 'geodesta_offline_queue_v1';
const CHUNK = 200; // filas por lote al sincronizar

export type QItem = { id: string; table: string; row: any; at: number };

let seq = 0;

async function readQ(): Promise<QItem[]> {
  try { const raw = await AsyncStorage.getItem(KEY); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
async function writeQ(items: QItem[]): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(items)); } catch { /* almacenamiento lleno: no rompemos la captura */ }
}

/** ¿Hay conexión? En web usa navigator.onLine; en nativo asumimos que sí (y si el
 *  insert falla por red, el llamador encola). */
export function isOnline(): boolean {
  if (Platform.OS === 'web') { try { return (globalThis as any)?.navigator?.onLine !== false; } catch { return true; } }
  return true;
}

/** Encola una fila para insertar luego en `table`. Devuelve el id local. */
export async function enqueue(table: string, row: any): Promise<string> {
  const q = await readQ();
  const id = `${Date.now()}-${seq++}`;
  q.push({ id, table, row, at: Date.now() });
  await writeQ(q);
  return id;
}

/** Cantidad de capturas pendientes de sincronizar. */
export async function pendingCount(): Promise<number> {
  return (await readQ()).length;
}

/** Inserta un arreglo de filas en `table` por LOTES (chunking). */
export async function insertChunked(table: string, rows: any[]): Promise<{ ok: boolean; error?: string; inserted: number }> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).insert(batch);
    if (error) return { ok: false, error: error.message, inserted };
    inserted += batch.length;
  }
  return { ok: true, inserted };
}

/** Sincroniza la cola: agrupa por tabla e inserta por lotes. Lo que entra bien se
 *  quita de la cola; si algo falla (sigue sin red), se conserva para el próximo intento. */
export async function flush(): Promise<{ done: number; left: number; error?: string }> {
  if (!isOnline()) return { done: 0, left: (await readQ()).length };
  const q = await readQ();
  if (!q.length) return { done: 0, left: 0 };
  const byTable = new Map<string, QItem[]>();
  q.forEach((it) => { const a = byTable.get(it.table) ?? []; a.push(it); byTable.set(it.table, a); });
  const remaining: QItem[] = [];
  let done = 0;
  let firstError: string | undefined;
  for (const [table, items] of byTable) {
    const res = await insertChunked(table, items.map((it) => it.row));
    if (res.ok) { done += items.length; }
    else { firstError = firstError ?? res.error; remaining.push(...items); }
  }
  await writeQ(remaining);
  return { done, left: remaining.length, error: firstError };
}

/** Se suscribe al evento de reconexión (web). Devuelve una función para desuscribir. */
export function onReconnect(cb: () => void): () => void {
  if (Platform.OS !== 'web') return () => {};
  try {
    const w: any = globalThis;
    w.addEventListener?.('online', cb);
    return () => w.removeEventListener?.('online', cb);
  } catch { return () => {}; }
}
