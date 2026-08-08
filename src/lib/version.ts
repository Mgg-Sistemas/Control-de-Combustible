import { Platform } from 'react-native';

/**
 * Identificador de la versión con la que se COMPILÓ este bundle. Lo inyecta el
 * robot de despliegue (deploy-web.yml) como EXPO_PUBLIC_BUILD_ID = git short SHA.
 * En desarrollo (expo start) no está definido → 'dev' (no se chequean updates).
 */
export const BUILD_ID: string = process.env.EXPO_PUBLIC_BUILD_ID || 'dev';

/** Nombre del bundle JS que está CARGADO ahora mismo (index-<hash>.js) — cambia en
 *  cada build. Se lee de los <script> del documento. Sirve de huella de la versión. */
function currentBundle(): string | null {
  try {
    const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
    for (const s of scripts) {
      const m = s.src.match(/index-[a-f0-9]+\.js/);
      if (m) return m[0];
    }
  } catch {}
  return null;
}

/** Clave del "objetivo" de actualización (el bundle nuevo que detectamos) y del
 *  "intento" (el objetivo al que ya recargamos). Sirven de guarda anti-lazo: si ya
 *  intentamos llegar a un bundle y seguimos sin estar en él (host sirviendo un index
 *  inconsistente), NO seguimos mostrando el aviso — evita que "no se quite". */
export const UPD_TARGET_KEY = 'sos_upd_target';
export const UPD_ATTEMPT_KEY = 'sos_upd_attempt';
function ls(): any { try { return (globalThis as any).localStorage ?? null; } catch { return null; } }

/**
 * Recarga "blanda" por ACTUALIZAR: al pulsar el botón dejamos una marca en
 * sessionStorage (sobrevive la recarga en la MISMA pestaña) + un respaldo del token
 * de Supabase. Sirve para que ACTUALIZAR nunca deje al usuario fuera en el teléfono:
 *  - `consumeSoftReload()` (en AuthProvider) restaura el token si el navegador móvil
 *    descartó localStorage al recargar, y evita volver a exigir la HUELLA en esa
 *    recarga (antes, cada recarga caía en "🔒 Sesión bloqueada" = parecía cierre de
 *    sesión).
 */
const SOFT_RELOAD_KEY = 'sos_soft_reload';
const AUTH_BACKUP_KEY = 'sos_auth_backup';

/** Copia el token de Supabase (sb-…-auth-token) de localStorage a sessionStorage y
 *  deja la marca de recarga blanda. Se llama justo antes de recargar por ACTUALIZAR. */
function markSoftReload(w: any): void {
  try {
    const lsObj = w.localStorage;
    const entries: [string, string][] = [];
    if (lsObj) {
      for (let i = 0; i < lsObj.length; i++) {
        const k = lsObj.key(i);
        if (k && k.startsWith('sb-') && k.includes('-auth-token')) {
          const v = lsObj.getItem(k);
          if (v != null) entries.push([k, v]);
        }
      }
    }
    w.sessionStorage?.setItem(SOFT_RELOAD_KEY, '1');
    if (entries.length) w.sessionStorage?.setItem(AUTH_BACKUP_KEY, JSON.stringify(entries));
  } catch {}
}

/**
 * ¿La carga actual viene de una recarga por ACTUALIZAR (misma pestaña)? Además de
 * responder, RESTAURA el token de Supabase en localStorage si el navegador lo perdió
 * y CONSUME la marca (una sola vez). AuthProvider usa el resultado para NO re-exigir
 * la huella en esta recarga.
 */
export function consumeSoftReload(): boolean {
  if (Platform.OS !== 'web') return false;
  const w: any = globalThis;
  try {
    const flag = w.sessionStorage?.getItem(SOFT_RELOAD_KEY);
    if (!flag) return false;
    w.sessionStorage?.removeItem(SOFT_RELOAD_KEY);
    const raw = w.sessionStorage?.getItem(AUTH_BACKUP_KEY);
    w.sessionStorage?.removeItem(AUTH_BACKUP_KEY);
    if (raw) {
      const entries: [string, string][] = JSON.parse(raw);
      for (const [k, v] of entries) {
        // Solo restaura si localStorage lo perdió; no pisa una sesión más nueva.
        if (v != null && w.localStorage?.getItem(k) == null) w.localStorage.setItem(k, v);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * ¿Hay una versión más nueva publicada que la que corre el usuario? (para la barra
 * ACTUALIZAR). Solo en web y cuando el bundle trae un BUILD_ID real.
 *
 * Señal: el bundle `index-<hash>.js` que referencia el `index.html` servido AHORA vs
 * el que está cargado. El hash cambia en cada build, así que un deploy nuevo se detecta
 * aunque el host NO sirva `version.json` (hoy /version.json da 404). Se intenta primero
 * version.json por si algún día vuelve a servirse.
 *
 * Guarda anti-lazo: si `servido !== corriendo` pero YA intentamos actualizar a ese
 * mismo `servido` (y no avanzamos), devolvemos false para no dejar el botón pegado.
 * Cuando aparezca un hash DISTINTO (deploy nuevo real), el aviso vuelve a salir.
 */
export async function isUpdateAvailable(): Promise<boolean> {
  if (Platform.OS !== 'web' || BUILD_ID === 'dev') return false;
  const running = currentBundle();
  if (!running) return false;

  let served: string | null = null;
  // 1) version.json (si el host lo sirve) → devuelve el nombre del bundle publicado.
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const b = String(data?.bundle ?? '').trim();
      if (b) served = b;
    }
  } catch {}
  // 2) Fallback: hash del bundle del index.html servido AHORA.
  if (!served) {
    try {
      const res = await fetch(`/?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) served = (await res.text()).match(/index-[a-f0-9]+\.js/)?.[0] ?? null;
    } catch {}
  }
  if (!served) return false;

  const store = ls();
  if (served === running) {
    // Ya estamos en la última: limpia cualquier marca de intento previa.
    try { store?.removeItem?.(UPD_ATTEMPT_KEY); store?.removeItem?.(UPD_TARGET_KEY); } catch {}
    return false;
  }
  // Difieren. Guarda anti-lazo: si ya intentamos llegar EXACTAMENTE a este `served`
  // y seguimos sin estar en él, no insistimos (host inconsistente) → no dejar pegado.
  try { if (store?.getItem?.(UPD_ATTEMPT_KEY) === served) return false; } catch {}
  // Recordamos el objetivo para que el botón marque el intento al recargar.
  try { store?.setItem?.(UPD_TARGET_KEY, served); } catch {}
  return true;
}

/**
 * Fuerza la recarga a la ÚLTIMA versión publicada (solo web). Es la MISMA lógica
 * que dispara la barra `UpdateBanner`, extraída aquí para reutilizarla también en
 * un control MANUAL siempre visible (p. ej. el menú del inspector): así el usuario
 * puede forzar la actualización aunque el aviso automático no llegue a salir.
 *
 * Pasos (el "por qué" de cada uno):
 * 0) Marca el INTENTO: guardamos a qué bundle recargamos. Si el host sigue sirviendo
 *    el mismo (no avanzamos), la guarda anti-lazo de `isUpdateAvailable` evita que el
 *    aviso reaparezca en bucle ("no se quita").
 * 1) Limpia caches del navegador / PWA por si un service worker guardó el index/bundle
 *    viejo.
 * 2) Recarga FORZANDO un index.html FRESCO con un cache-buster (`_v`). Un simple
 *    `location.reload()` reusa el index cacheado → vuelve a cargar el bundle VIEJO. Con
 *    la query nueva el navegador baja el index nuevo, que referencia el bundle con hash
 *    nuevo (URL distinta) → carga la versión nueva.
 */
export function forceReloadLatest(): void {
  if (Platform.OS !== 'web') return;
  const w: any = globalThis;
  // 0) Marca el intento (a qué bundle vamos), para la guarda anti-lazo.
  try { const t = w.localStorage?.getItem?.(UPD_TARGET_KEY); if (t) w.localStorage?.setItem?.(UPD_ATTEMPT_KEY, t); } catch {}
  // 0b) Recarga BLANDA: respalda la sesión y marca que esta recarga es una
  //     actualización, para no cerrar sesión ni re-exigir la huella al volver.
  markSoftReload(w);
  // 1) Limpia caches del navegador / PWA si existen.
  try { w.caches?.keys?.().then((ks: string[]) => ks.forEach((k) => w.caches.delete(k))).catch(() => {}); } catch {}
  // 2) Recarga con cache-buster para bajar un index.html fresco.
  try {
    const url = new w.URL(w.location.href);
    url.searchParams.set('_v', String(Date.now()));
    w.location.replace(url.toString());
    return;
  } catch {}
  // Fallback si algo de lo anterior falla.
  try { w.location?.reload?.(); } catch {}
}
