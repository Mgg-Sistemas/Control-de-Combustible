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

/**
 * ¿Hay una versión más nueva publicada que la que corre el usuario? (para la barra
 * ACTUALIZAR). Solo en web y cuando el bundle trae un BUILD_ID real.
 *
 * Dos vías, en orden:
 *  1) `version.json` (lo publica el deploy con el SHA). Si el host lo sirve, se usa.
 *  2) FALLBACK: comparar el bundle `index-<hash>.js` que referencia el `index.html`
 *     servido AHORA contra el que está cargado. El hash cambia en cada build, así que
 *     un deploy nuevo se detecta aunque el host NO sirva `version.json` (que es lo que
 *     pasa hoy: /version.json da 404 y por eso el botón nunca salía).
 */
export async function isUpdateAvailable(): Promise<boolean> {
  if (Platform.OS !== 'web' || BUILD_ID === 'dev') return false;
  // 1) version.json (si el host lo sirve).
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const server = String(data?.v ?? '').trim();
      if (server) return server !== BUILD_ID;
    }
  } catch {}
  // 2) Fallback: hash del bundle del index servido vs el bundle cargado.
  try {
    const res = await fetch(`/?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const html = await res.text();
    const served = html.match(/index-[a-f0-9]+\.js/)?.[0] ?? null;
    const running = currentBundle();
    if (!served || !running) return false;
    return served !== running;
  } catch {
    return false;
  }
}
