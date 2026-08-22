// BUS DE REALTIME (un solo canal para TODA la app).
//
// Antes, cada instancia de `useTable`/`useRealtimeRefresh` abría su PROPIO canal de
// Supabase (`supabase.channel(...)`): una pantalla con 10 tablas = 10 canales, cada
// uno con su join Phoenix y sus bindings. Este bus mantiene UN ÚNICO canal suscrito a
// todas las tablas que la app escucha, y reparte cada evento a los listeners (callbacks
// baratos) interesados en esa tabla. Menos canales = menos overhead de conexión.
//
// Diseño clave: el conjunto de tablas SOLO CRECE (monótono) durante la sesión — así
// montar/desmontar pantallas NO reconstruye el canal (cero "churn"); solo se reconstruye
// (con debounce) la primera vez que aparece una tabla nueva. Tras el arranque, el set se
// estabiliza y ya no hay reconstrucciones. Los bindings de postgres_changes deben
// agregarse ANTES de `subscribe()` (no se pueden añadir después), por eso "tabla nueva"
// obliga a recrear el canal; el anterior se retira recién cuando el nuevo queda SUBSCRIBED
// (sin ventana sin escucha). En RECONEXIÓN de red se resincroniza a TODOS los listeners.
import { supabase, isSupabaseConfigured } from './supabase';

type Listener = { tables: Set<string>; cb: () => void };

const listeners = new Set<Listener>();
const knownTables = new Set<string>();
let channel: any = null;
let seq = 0;
let rebuildTimer: any = null;

/** Dispara los listeners interesados en `table`. */
function dispatch(table: string) {
  listeners.forEach((l) => { if (l.tables.has(table)) { try { l.cb(); } catch { /* noop */ } } });
}
/** Resincroniza a TODOS (reconexión: pudieron perderse eventos mientras el canal cayó). */
function notifyAll() {
  listeners.forEach((l) => { try { l.cb(); } catch { /* noop */ } });
}

/** (Re)crea el canal único con un binding por cada tabla conocida. */
function buildChannel() {
  if (!isSupabaseConfigured) return;
  const tables = Array.from(knownTables);
  if (!tables.length) return;
  const prev = channel; // canal anterior (si es una reconstrucción aditiva por tabla nueva)
  const ch = supabase.channel(`rt-bus-${++seq}`);
  tables.forEach((t) => ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: t }, () => dispatch(t)));
  let firstStatus = true;
  ch.subscribe((status: string) => {
    if (status !== 'SUBSCRIBED') return;
    if (firstStatus) {
      firstStatus = false;
      // Retira el canal anterior recién ahora: durante el rebuild el viejo siguió
      // escuchando, así que no hubo ventana sin cobertura → no hace falta resync.
      if (prev) supabase.removeChannel(prev);
    } else {
      // Re-SUBSCRIBED del MISMO canal = reconexión tras caída de red → resync a todos.
      notifyAll();
    }
  });
  channel = ch;
}

/**
 * Registra un listener que se dispara cuando cambia (INSERT/UPDATE/DELETE) cualquiera de
 * `tables`. Devuelve una función para desuscribirse. El canal es compartido: agregar/quitar
 * listeners es barato (no toca la conexión) salvo la primera aparición de una tabla nueva.
 */
export function subscribeRealtime(tables: string[], cb: () => void): () => void {
  const clean = tables.filter(Boolean);
  const l: Listener = { tables: new Set(clean), cb };
  listeners.add(l);
  let added = false;
  clean.forEach((t) => { if (!knownTables.has(t)) { knownTables.add(t); added = true; } });
  if (!channel) buildChannel();
  else if (added) { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(buildChannel, 200); } // agrupa varias tablas nuevas
  return () => { listeners.delete(l); };
}
