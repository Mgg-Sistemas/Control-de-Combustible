import { Platform } from 'react-native';

/**
 * Identificador de la versión con la que se COMPILÓ este bundle. Lo inyecta el
 * robot de despliegue (deploy-web.yml) como EXPO_PUBLIC_BUILD_ID = git short SHA.
 * En desarrollo (expo start) no está definido → 'dev' (no se chequean updates).
 */
export const BUILD_ID: string = process.env.EXPO_PUBLIC_BUILD_ID || 'dev';

/**
 * Consulta el `version.json` publicado junto a la web (lo escribe el robot con
 * el SHA del último deploy). Devuelve true si el servidor tiene una versión
 * DISTINTA a la que está corriendo el usuario (o sea, hay actualización).
 * Solo aplica en web y cuando este bundle trae un BUILD_ID real.
 */
export async function isUpdateAvailable(): Promise<boolean> {
  if (Platform.OS !== 'web' || BUILD_ID === 'dev') return false;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const data = await res.json();
    const server = String(data?.v ?? '').trim();
    return !!server && server !== BUILD_ID;
  } catch {
    return false;
  }
}
