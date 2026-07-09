import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

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
      storage: AsyncStorage,
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
