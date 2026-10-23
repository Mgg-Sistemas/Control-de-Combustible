import AsyncStorage from '@react-native-async-storage/async-storage';
import { GrupoApartadoConfig, DEFAULT_GRUPOS_APARTADOS } from './nominaGrupos';
import { supabase } from './supabase';

export const CLAVE_GRUPOS_APARTADOS = '@nomina_grupos_apartados_v2';
export const PREFIX_CONFIG_GRUPOS = '__nomina_grupos__:';

function normalizarGrupos(rawArray: any[]): GrupoApartadoConfig[] {
  if (!Array.isArray(rawArray) || rawArray.length === 0) return DEFAULT_GRUPOS_APARTADOS;

  const carbo = rawArray.find((g: any) => g && g.id === 'carbozulia') ?? DEFAULT_GRUPOS_APARTADOS[0];
  const seg = rawArray.find((g: any) => g && g.id === 'seguridad') ?? DEFAULT_GRUPOS_APARTADOS[1];
  const otros = rawArray.filter((g: any) => g && g.id && g.id !== 'carbozulia' && g.id !== 'seguridad');

  return [
    { ...DEFAULT_GRUPOS_APARTADOS[0], ...carbo, builtin: true },
    { ...DEFAULT_GRUPOS_APARTADOS[1], ...seg, builtin: true },
    ...otros,
  ];
}

/**
 * Lee la lista de grupos apartados.
 * Sincronizado centralmente en Supabase para que cualquier pestaña creada por
 * Agatha, Anthony o cualquier usuario sea inmediatamente visible para todos.
 * Si en local existen grupos previos (ej. Agatha ya los creó en su navegador),
 * los migra y sincroniza automáticamente hacia la nube.
 */
export async function leerGruposApartados(): Promise<GrupoApartadoConfig[]> {
  let localGrupos: GrupoApartadoConfig[] = DEFAULT_GRUPOS_APARTADOS;
  try {
    const rawLocal = await AsyncStorage.getItem(CLAVE_GRUPOS_APARTADOS);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      localGrupos = normalizarGrupos(parsed);
    }
  } catch {}

  try {
    const { data, error } = await supabase
      .from('payroll_companies')
      .select('id, name')
      .ilike('name', `${PREFIX_CONFIG_GRUPOS}%`)
      .limit(1);

    if (!error && data && data.length > 0 && data[0]?.name) {
      const jsonStr = data[0].name.slice(PREFIX_CONFIG_GRUPOS.length);
      const parsed = JSON.parse(jsonStr);
      const finalGrupos = normalizarGrupos(parsed);
      // Actualizar caché local
      AsyncStorage.setItem(CLAVE_GRUPOS_APARTADOS, JSON.stringify(finalGrupos)).catch(() => {});
      return finalGrupos;
    }

    // Si en Supabase no hay fila pero en local sí hay grupos personalizados,
    // sincronizar hacia arriba (caso: Agatha ya tenía grupos en su navegador)
    const tienePersonalizados = localGrupos.some((g) => g.id !== 'carbozulia' && g.id !== 'seguridad');
    if (tienePersonalizados) {
      const payload = `${PREFIX_CONFIG_GRUPOS}${JSON.stringify(localGrupos)}`;
      supabase.from('payroll_companies').insert({ name: payload, active: false }).then(() => {}, () => {});
    }
  } catch {}

  return localGrupos;
}

/**
 * Guarda la lista de grupos apartados en AsyncStorage y sincroniza en Supabase
 * para que todos los usuarios del sistema compartan las mismas pestañas.
 */
export async function guardarGruposApartados(grupos: GrupoApartadoConfig[]): Promise<void> {
  const normalizados = normalizarGrupos(grupos);
  try {
    await AsyncStorage.setItem(CLAVE_GRUPOS_APARTADOS, JSON.stringify(normalizados));
  } catch {}

  try {
    const payload = `${PREFIX_CONFIG_GRUPOS}${JSON.stringify(normalizados)}`;
    const { data: existing } = await supabase
      .from('payroll_companies')
      .select('id')
      .ilike('name', `${PREFIX_CONFIG_GRUPOS}%`)
      .limit(1);

    if (existing && existing.length > 0) {
      await supabase
        .from('payroll_companies')
        .update({ name: payload, active: false })
        .eq('id', existing[0].id);
    } else {
      await supabase
        .from('payroll_companies')
        .insert({ name: payload, active: false });
    }
  } catch {}
}
