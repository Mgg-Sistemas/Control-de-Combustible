import AsyncStorage from '@react-native-async-storage/async-storage';
import { GrupoApartadoConfig, DEFAULT_GRUPOS_APARTADOS } from './nominaGrupos';

export const CLAVE_GRUPOS_APARTADOS = '@nomina_grupos_apartados_v2';

/**
 * Lee la lista de grupos apartados configurados en el dispositivo.
 * Garantiza que Carbozulia y Seguridad (los grupos del sistema) siempre existan al inicio.
 */
export async function leerGruposApartados(): Promise<GrupoApartadoConfig[]> {
  try {
    const raw = await AsyncStorage.getItem(CLAVE_GRUPOS_APARTADOS);
    if (!raw) return DEFAULT_GRUPOS_APARTADOS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_GRUPOS_APARTADOS;

    const carbo = parsed.find((g: any) => g.id === 'carbozulia') ?? DEFAULT_GRUPOS_APARTADOS[0];
    const seg = parsed.find((g: any) => g.id === 'seguridad') ?? DEFAULT_GRUPOS_APARTADOS[1];
    const otros = parsed.filter((g: any) => g && g.id !== 'carbozulia' && g.id !== 'seguridad');

    return [
      { ...DEFAULT_GRUPOS_APARTADOS[0], ...carbo, builtin: true },
      { ...DEFAULT_GRUPOS_APARTADOS[1], ...seg, builtin: true },
      ...otros,
    ];
  } catch {
    return DEFAULT_GRUPOS_APARTADOS;
  }
}

/**
 * Guarda la lista de grupos apartados en AsyncStorage.
 */
export async function guardarGruposApartados(grupos: GrupoApartadoConfig[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CLAVE_GRUPOS_APARTADOS, JSON.stringify(grupos));
  } catch {}
}
