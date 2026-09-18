// PLATOS DE «OTROS»: lo que lee y escribe en la base (18-sep-2026).
// La regla (nombres, categoría de precio, a qué plato va cada entrega) vive en
// comidaPlatos.ts; el precio se guarda con crearPrecioComida (cobroComidasDb.ts).
//
// ⚠️ Toda escritura pide .select() de vuelta: con RLS, un «no tienes permiso» llega
//    como 0 filas y SIN error. Sin contar las filas, la pantalla diría «✅ listo» a
//    algo que no se guardó.
import { supabase, selectAllRows } from './supabase';
import { PlatoCatalogo, entregasDelPlato, limpiarNombrePlato, platoConNombre } from './comidaPlatos';

const SIN_PERMISO = 'No se guardó: hace falta permiso completo en Distribución de comida.';

/** Todos los platos, también los quitados de la lista: sus entregas viejas se siguen cobrando. */
export async function cargarPlatos(): Promise<PlatoCatalogo[]> {
  const rows = await selectAllRows('food_extra_items', 'id, name, active');
  return (rows as any[]).map((p) => ({ id: String(p.id), name: limpiarNombrePlato(p.name), active: p.active !== false }));
}

/**
 * Crea el plato. Si ya hay uno con ese nombre, NO crea otro: lo devuelve (y si
 * estaba quitado de la lista, lo vuelve a poner). Así «crear» un plato que la cocina
 * ya había inventado es lo mismo que ponerle precio.
 */
export async function crearOReusarPlato(
  nombre: string,
  platos: PlatoCatalogo[],
): Promise<{ plato?: PlatoCatalogo; yaExistia?: boolean; error?: string }> {
  const limpio = limpiarNombrePlato(nombre);
  const ya = platoConNombre(platos, limpio);
  if (ya) {
    if (ya.active === false) {
      const r = await cambiarListaPlato(ya.id, true);
      if (r.error) return { error: r.error };
    }
    return { plato: { ...ya, active: true }, yaExistia: true };
  }
  const { data, error } = await supabase.from('food_extra_items').insert({ name: limpio }).select('id, name, active');
  if (error) {
    // Otro teléfono lo creó en el mismo momento: el índice único lo frena. Se busca.
    if ((error as any).code === '23505') {
      const todos = await cargarPlatos().catch(() => [] as PlatoCatalogo[]);
      const otro = platoConNombre(todos, limpio);
      if (otro) return { plato: otro, yaExistia: true };
    }
    return { error: error.message };
  }
  const fila = (data as any[] | null)?.[0];
  if (!fila) return { error: SIN_PERMISO };
  return { plato: { id: String(fila.id), name: limpiarNombrePlato(fila.name), active: fila.active !== false } };
}

/** Quitar de la lista (false) o devolver a la lista (true). Nunca se borra. */
export async function cambiarListaPlato(id: string, activo: boolean): Promise<{ error?: string }> {
  const { data, error } = await supabase.from('food_extra_items').update({ active: activo }).eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data?.length) return { error: SIN_PERMISO };
  return {};
}

/** Las entregas por QR registradas con el nombre de ese plato (id y nombre como quedó escrito). */
export async function entregasConNombre(nombre: string): Promise<{ id: string; item_label: string | null }[]> {
  // Se traen TODAS las de «Otros» y se compara acá, sin mayúsculas ni espacios de más:
  // un ILIKE de PostgREST toma «*», «%» y «_» del nombre como comodines, y un plato
  // «Jugo_natural» terminaría cambiándole el nombre a otros.
  const rows = await selectAllRows('food_company_meals', 'id, meal_type, item_label', (q: any) => q.eq('meal_type', 'otros'));
  return entregasDelPlato(rows as any[], nombre).map((r: any) => ({ id: String(r.id), item_label: r.item_label ?? null }));
}

async function ponerNombreAEntregas(ids: string[], nombre: string): Promise<{ cambiadas: string[]; error?: string }> {
  const cambiadas: string[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('food_company_meals')
      .update({ item_label: nombre })
      .in('id', ids.slice(i, i + 200))
      .select('id');
    if (error) return { cambiadas, error: error.message };
    (data as any[] | null)?.forEach((r) => cambiadas.push(String(r.id)));
  }
  return { cambiadas };
}

/**
 * CAMBIAR EL NOMBRE de un plato: en la lista Y en las entregas ya registradas con ese
 * nombre. Si solo cambiara la lista, las entregas viejas quedarían con un nombre que ya
 * no es de ningún plato: perderían su precio y en los reportes saldrían dos platos.
 *
 * Todo o nada: primero las entregas (si la base no deja corregir TODAS, se devuelven
 * las que alcanzó a cambiar y no se toca la lista), después la lista (si falla, las
 * entregas vuelven a su nombre). Cada entrega corregida queda en la bitácora.
 */
export async function renombrarPlato(plato: PlatoCatalogo, nuevo: string): Promise<{ entregas: number; error?: string }> {
  const limpio = limpiarNombrePlato(nuevo);
  let entregas: { id: string; item_label: string | null }[];
  try {
    entregas = await entregasConNombre(plato.name);
  } catch (e: any) {
    return { entregas: 0, error: `No se pudo revisar las entregas de ese plato (${e?.message ?? 'revisa la conexión'}). No se cambió nada.` };
  }
  // Devolver cada entrega a como estaba escrita (con sus mayúsculas), no al nombre de la lista.
  const devolver = async (ids: string[]) => {
    for (const e of entregas.filter((x) => ids.includes(x.id))) {
      await supabase.from('food_company_meals').update({ item_label: e.item_label }).eq('id', e.id);
    }
  };
  const ids = entregas.filter((e) => e.item_label !== limpio).map((e) => e.id);
  const r = await ponerNombreAEntregas(ids, limpio);
  if (r.error || r.cambiadas.length < ids.length) {
    await devolver(r.cambiadas);
    return {
      entregas: 0,
      error: r.error
        ? `No se cambió el nombre: ${r.error}`
        : 'No se cambió el nombre: la base no dejó corregir las entregas ya registradas con ese plato. Hace falta permiso completo en Distribución de comida (y que esté corrido el SQL de «corregir comidas» del 18/09).',
    };
  }
  const { data, error } = await supabase.from('food_extra_items').update({ name: limpio }).eq('id', plato.id).select('id');
  if (error || !data?.length) {
    await devolver(r.cambiadas);
    const dup = (error as any)?.code === '23505';
    return { entregas: 0, error: dup ? `Ya hay otro plato llamado «${limpio}».` : error?.message ?? SIN_PERMISO };
  }
  return { entregas: entregas.length };
}
