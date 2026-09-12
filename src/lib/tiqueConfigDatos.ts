// QUÉ SALE EN EL TIQUE · el acceso a la base (12-sep-2026).
//
// Va aparte de `tiqueConfig.ts` a propósito, igual que `cubicajeDatos.ts` está
// aparte de `cubicaje.ts`: las REGLAS son puras y se prueban solas, sin red y
// sin pantalla; acá vive lo único que habla con Supabase.
//
// ⚠️ ESTA TABLA LA CREA `05_tiquetera_viajes.sql`, que NO está en el repositorio
//    porque es público. Y todo tiene que funcionar antes de que se corra: si la
//    tabla no existe, se usa la configuración de fábrica y la pantalla lo AVISA.
//    Nunca se queda en blanco.
import { supabase } from './supabase';
import { CONFIG_POR_DEFECTO, normalizarConfig, type TiqueConfig } from './tiqueConfig';

const TABLA = 'tique_config';

/** ¿El error es «esa tabla no existe»? Mismo criterio que el cubicaje: PostgREST
 *  y Postgres la reportan de tres formas distintas según por dónde entre. */
function faltaLaTabla(e: any): boolean {
  const msg = String(e?.message ?? e).toLowerCase();
  const code = String(e?.code ?? '').toLowerCase();
  return code === '42p01' || code === 'pgrst205' || msg.includes('does not exist');
}

/**
 * Lee la configuración.
 *
 * ⚠️ Un fallo de LECTURA no es lo mismo que «no hay tabla», y se devuelven
 *    separados. Si se confundieran, una consulta rota se vería igual que un SQL
 *    sin correr y el aviso mandaría a alguien a correr un SQL que ya está.
 */
export async function leerConfigTique(): Promise<{ config: TiqueConfig; sinTabla: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.from(TABLA).select('campos, logos, papel').eq('id', true).maybeSingle();
    if (error) throw error;
    return { config: normalizarConfig(data), sinTabla: false };
  } catch (e: any) {
    if (faltaLaTabla(e)) return { config: CONFIG_POR_DEFECTO, sinTabla: true };
    return { config: CONFIG_POR_DEFECTO, sinTabla: false, error: String(e?.message ?? e) };
  }
}

/**
 * Guarda la configuración entera. Es UNA sola fila para todo el sistema, así que
 * es un upsert sobre `id = true`.
 *
 * Se normaliza otra vez antes de escribir: así el folio no se puede apagar ni
 * mandando la fila a mano desde otro sitio.
 */
export async function guardarConfigTique(
  c: TiqueConfig,
  uid: string | null,
): Promise<{ error?: string; sinTabla?: boolean }> {
  const limpia = normalizarConfig(c);
  const fila = {
    id: true,
    campos: limpia.campos,
    logos: limpia.logos,
    papel: limpia.papel,
    updated_by: uid,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from(TABLA).upsert(fila, { onConflict: 'id' });
  if (error) return { error: error.message, sinTabla: faltaLaTabla(error) };
  return {};
}
