import { supabase, selectAllRows } from './supabase';
import type { AjusteListaViajes } from './viajesListaCamiones';

// Lecturas y escrituras de los ajustes de la lista de Viajes (tabla `viajes_lista_camiones`).
// Escribe quien tiene permiso COMPLETO en Viajes de camiones (lo exige la base, 17-sep-2026);
// todos leen, porque la lista del listero lo usa.

export const SIN_PERMISO_LISTA = 'No se guardó: hace falta permiso completo en Viajes de camiones para cambiar qué máquinas salen.';

const esTablaQueFalta = (e: any) =>
  e?.code === '42P01' || e?.code === 'PGRST205' || /does not exist|schema cache|could not find the table/i.test(String(e?.message ?? ''));

/**
 * `falta: true` = la tabla todavía no existe en la base (falta correr el SQL): la lista
 * sigue con la regla automática, como antes. `error` = no se pudo leer por otra razón.
 */
export async function cargarAjustesListaViajes(): Promise<{ filas: AjusteListaViajes[]; falta: boolean; error?: string }> {
  try {
    const filas = await selectAllRows('viajes_lista_camiones', 'machinery_id, visible, updated_at, updated_by_nombre', undefined, 'machinery_id');
    return { filas: filas as AjusteListaViajes[], falta: false };
  } catch (e: any) {
    if (esTablaQueFalta(e)) return { filas: [], falta: true };
    return { filas: [], falta: false, error: String(e?.message ?? e) };
  }
}

/**
 * `visible` true/false = ajuste a mano; null = quitar el ajuste y volver a la regla
 * automática. Pide filas de vuelta: un rechazo por permisos vuelve sin error y con 0 filas.
 */
export async function guardarAjusteListaViajes(machineryId: string, visible: boolean | null): Promise<{ error?: string }> {
  if (visible === null) {
    const { data, error } = await supabase.from('viajes_lista_camiones').delete().eq('machinery_id', machineryId).select('machinery_id');
    if (error) return { error: error.message };
    if (!data?.length) return { error: SIN_PERMISO_LISTA };
    return {};
  }
  const { data, error } = await supabase
    .from('viajes_lista_camiones')
    .upsert({ machinery_id: machineryId, visible }, { onConflict: 'machinery_id' })
    .select('machinery_id');
  if (error) return { error: error.code === '42501' ? SIN_PERMISO_LISTA : error.message };
  if (!data?.length) return { error: SIN_PERMISO_LISTA };
  return {};
}
