import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

// ── security#5 (auditoría): los tokens de sesión se guardaban en AsyncStorage, sin
//    cifrar (legibles con acceso al almacenamiento del dispositivo). En NATIVO se
//    pasan a expo-secure-store (Keychain iOS / Keystore Android). SecureStore limita
//    cada valor a ~2048 bytes y la sesión de Supabase (JWT + user) puede excederlo,
//    así que se trocea en varios ítems. Migración PEREZOSA desde AsyncStorage para no
//    forzar re-login a los usuarios ya logueados. En WEB no hay SecureStore → se
//    mantiene AsyncStorage (el navegador ya aísla el localStorage por origen).
const CHUNK = 2000;
const CHUNK_MARK = '__sc_chunks__:';
const secureStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const meta = await SecureStore.getItemAsync(key);
    if (meta != null) {
      if (!meta.startsWith(CHUNK_MARK)) return meta;
      const n = parseInt(meta.slice(CHUNK_MARK.length), 10) || 0;
      let out = '';
      for (let i = 0; i < n; i++) out += (await SecureStore.getItemAsync(`${key}.${i}`)) ?? '';
      return out;
    }
    // Migración perezosa: sesión previa en AsyncStorage → moverla a SecureStore.
    const legacy = await AsyncStorage.getItem(key);
    if (legacy != null) {
      await secureStorageAdapter.setItem(key, legacy);
      await AsyncStorage.removeItem(key);
      return legacy;
    }
    return null;
  },
  async setItem(key: string, value: string): Promise<void> {
    const opts = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }; // permite refresco en background
    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(key, value, opts);
      return;
    }
    const n = Math.ceil(value.length / CHUNK);
    await SecureStore.setItemAsync(key, `${CHUNK_MARK}${n}`, opts);
    for (let i = 0; i < n; i++) {
      await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK), opts);
    }
  },
  async removeItem(key: string): Promise<void> {
    const meta = await SecureStore.getItemAsync(key);
    await SecureStore.deleteItemAsync(key);
    if (meta?.startsWith(CHUNK_MARK)) {
      const n = parseInt(meta.slice(CHUNK_MARK.length), 10) || 0;
      for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
    }
  },
};
const authStorage = Platform.OS === 'web' ? AsyncStorage : secureStorageAdapter;

/** True cuando las variables de entorno de Supabase están configuradas. */
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // No lanzamos error: la app debe arrancar igual y mostrar el aviso de configuración.
  console.warn(
    '[Supabase] Falta EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copia .env.example a .env y reinicia el servidor (npx expo start -c).'
  );
}

export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'public-anon-key-placeholder',
  {
    auth: {
      storage: authStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);

/**
 * Trae TODAS las filas de una tabla paginando en bloques (PostgREST/Supabase corta
 * en ~1000 filas por consulta). Sin esto, con muchas rondas los reportes quedaban
 * truncados y los totales salían por debajo de lo real.
 * @param table   nombre de la tabla
 * @param columns columnas a seleccionar
 * @param filter  callback opcional para aplicar filtros (.lte/.eq/…) al query
 */
export async function selectAllRows(
  table: string,
  columns: string,
  filter?: (q: any) => any
): Promise<any[]> {
  const pageSize = 1000;
  const out: any[] = [];
  for (let from = 0; ; from += pageSize) {
    let q: any = supabase.from(table).select(columns);
    if (filter) q = filter(q);
    // Orden estable por id para paginar sin saltar/duplicar filas.
    q = q.order('id', { ascending: true }).range(from, from + pageSize - 1);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
