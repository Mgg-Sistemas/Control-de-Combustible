import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from './supabase';

type Pos = { coords: { latitude: number; longitude: number } };

// ── Caché de posición "pre-calentada" ───────────────────────────────────────
// Mantenemos una suscripción al GPS y guardamos la última posición en memoria,
// para que "Marcar ubicación" sea INSTANTÁNEO (ya tenemos las coordenadas listas
// cuando el usuario toca el botón). Antes cada toque esperaba un fix nuevo.
let cached: { pos: Pos; at: number } | null = null;
let watching = false;
const FRESH_MS = 120000; // una posición de hasta 2 min se considera vigente

/** Arranca (una sola vez) la suscripción al GPS para tener la posición lista. */
export function warmLocation(): void {
  if (watching) return;
  watching = true;
  if (Platform.OS === 'web') {
    const geo = (globalThis as any)?.navigator?.geolocation;
    if (!geo) { watching = false; return; }
    try {
      geo.watchPosition(
        (p: any) => { cached = { pos: p, at: Date.now() }; },
        () => {},
        { enableHighAccuracy: false, maximumAge: FRESH_MS, timeout: 20000 }
      );
    } catch { watching = false; }
  } else {
    Location.requestForegroundPermissionsAsync()
      .then(({ status }) => {
        if (status !== 'granted') { watching = false; return; }
        Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Low, timeInterval: 15000, distanceInterval: 25 },
          (p: any) => { cached = { pos: p, at: Date.now() }; }
        ).catch(() => { watching = false; });
      })
      .catch(() => { watching = false; });
  }
}

/** Envuelve una promesa con un tope de tiempo: si tarda de más, resuelve null. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: T | null) => { if (!done) { done = true; resolve(v); } };
    const t = setTimeout(() => finish(null), ms);
    p.then((v) => { clearTimeout(t); finish(v); }).catch(() => { clearTimeout(t); finish(null); });
  });
}

/** WEB: navigator.geolocation aceptando un fix reciente en caché (instantáneo). */
function getPositionWeb(): Promise<Pos | null> {
  const geo = (globalThis as any)?.navigator?.geolocation;
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: Pos | null) => { if (!done) { done = true; resolve(v); } };
    try {
      geo.getCurrentPosition(
        (p: any) => finish(p),
        () => finish(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: FRESH_MS }
      );
    } catch { finish(null); }
  });
}

/** NATIVO: última posición conocida (instantánea) o una lectura con tope de tiempo. */
async function getPositionNative(): Promise<{ pos: Pos | null; denied?: boolean }> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return { pos: null, denied: true };
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: FRESH_MS, requiredAccuracy: 300 });
    if (last) return { pos: last as any };
  } catch {}
  const cur = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }) as any, 8000);
  return { pos: cur as any };
}

/**
 * Devuelve las coordenadas GPS actuales del dispositivo SIN escribir nada en la
 * base de datos. Sirve, por ejemplo, para ubicar al SUPERVISOR al hacer un
 * check-in (y medir su distancia a la máquina) sin tocar la ubicación de la
 * máquina. Usa la posición pre-calentada si está vigente; si no, pide una nueva.
 */
export async function getCurrentCoords(): Promise<{ ok: boolean; error?: string; lat?: number; lng?: number }> {
  warmLocation();
  let pos: Pos | null = cached && Date.now() - cached.at < FRESH_MS ? cached.pos : null;
  if (!pos) {
    if (Platform.OS === 'web') {
      pos = await getPositionWeb();
      if (!pos) return { ok: false, error: 'No se pudo obtener la ubicación. Permite el acceso al GPS del navegador e inténtalo de nuevo.' };
    } else {
      const r = await getPositionNative();
      if (r.denied) return { ok: false, error: 'Permiso de ubicación denegado.' };
      pos = r.pos;
      if (!pos) return { ok: false, error: 'El GPS tardó demasiado. Inténtalo de nuevo (mejor al aire libre).' };
    }
  }
  return { ok: true, lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) };
}

/**
 * Captura la ubicación GPS actual, la guarda en el historial (ruta) de la
 * máquina y actualiza sus coordenadas más recientes.
 *
 * INSTANTÁNEO: si hay una posición pre-calentada vigente (de la suscripción),
 * se usa de inmediato; si no, se pide una nueva (baja precisión, con tope de
 * tiempo). El historial se guarda en segundo plano para no demorar la respuesta.
 */
export async function captureLocation(
  machineryId: string
): Promise<{ ok: boolean; error?: string; lat?: number; lng?: number }> {
  // Asegura que la suscripción esté activa para las próximas veces.
  warmLocation();

  let pos: Pos | null = cached && Date.now() - cached.at < FRESH_MS ? cached.pos : null;
  if (!pos) {
    if (Platform.OS === 'web') {
      pos = await getPositionWeb();
      if (!pos) return { ok: false, error: 'No se pudo obtener la ubicación. Permite el acceso al GPS del navegador e inténtalo de nuevo.' };
    } else {
      const r = await getPositionNative();
      if (r.denied) return { ok: false, error: 'Permiso de ubicación denegado.' };
      pos = r.pos;
      if (!pos) return { ok: false, error: 'El GPS tardó demasiado. Inténtalo de nuevo (mejor al aire libre).' };
    }
  }

  const lat = Number(pos.coords.latitude.toFixed(6));
  const lng = Number(pos.coords.longitude.toFixed(6));

  // RPC (SECURITY DEFINER): actualiza las coordenadas de la máquina Y guarda el
  // punto en el historial (ruta) en una sola llamada. Así funciona también para
  // OPERADORES (sin permiso de escritura sobre 'equipos'/'control_maquinaria'),
  // y cada actualización va generando la ruta.
  const { error } = await supabase.rpc('update_machine_location', { p_id: machineryId, p_lat: lat, p_lng: lng });
  if (error) return { ok: false, error: error.message };
  return { ok: true, lat, lng };
}
