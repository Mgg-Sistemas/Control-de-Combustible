import { supabase, selectAllRows } from './supabase';
import { FoodDistribution, MealType } from '../types/database';

export type SaveFoodInput = {
  employeeId: string | null;
  employeeName: string;
  cedula?: string | null;
  meals: number;
  mealType?: MealType | null;  // desayuno/almuerzo/lunch/cena (1 por día por persona)
  distributionDate: string;   // día ISO (Caracas)
  deliveredAt?: string;       // hora de entrega (ISO). Por defecto ahora.
  note?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
};

/** Registra una entrega de comida. Devuelve la fila creada. */
export async function saveFoodDistribution(input: SaveFoodInput): Promise<{ data: FoodDistribution | null; error?: string }> {
  const { data, error } = await supabase
    .from('food_distributions')
    .insert({
      employee_id: input.employeeId,
      employee_name: input.employeeName,
      cedula: (input.cedula ?? '').trim() || null,
      meals: input.meals,
      meal_type: input.mealType ?? null,
      distribution_date: input.distributionDate,
      delivered_at: input.deliveredAt ?? new Date().toISOString(),
      note: (input.note ?? '').trim() || null,
      created_by: input.createdBy ?? null,
      created_by_name: input.createdByName ?? null,
    })
    .select()
    .single();
  if (error) {
    const dup = (error as any).code === '23505' || /duplicate|unique/i.test(error.message);
    return { data: null, error: dup ? 'Esa comida ya se registró hoy para esta persona.' : error.message };
  }
  return { data: (data as FoodDistribution) ?? null };
}

/** Entregas de comida de una persona en un día (más reciente primero). */
export async function listForEmployeeDay(employeeId: string, date: string): Promise<FoodDistribution[]> {
  const { data } = await supabase
    .from('food_distributions')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('distribution_date', date)
    .order('delivered_at', { ascending: false });
  return (data ?? []) as FoodDistribution[];
}

/** Todas las entregas de un día o de un rango (más reciente primero).
 *
 *  PAGINADO (14-sep-2026): la consulta simple cortaba en 1000 filas y el reporte
 *  semanal y su PDF salían incompletos sin avisar (una semana ya tuvo 1.259 entregas).
 *  Si la lectura falla, LANZA: una lista vacía se leía como «no hubo comidas». */
export async function listFoodByDate(fromDate: string, toDate?: string): Promise<FoodDistribution[]> {
  const rows = (await selectAllRows('food_distributions', '*', (q) =>
    toDate ? q.gte('distribution_date', fromDate).lte('distribution_date', toDate) : q.eq('distribution_date', fromDate),
  )) as FoodDistribution[];
  return rows.sort((a, b) => String(b.delivered_at ?? '').localeCompare(String(a.delivered_at ?? '')));
}

/** Borra una entrega (por si se registró de más).
 *
 *  `.select('id')` para distinguir «borrada» de «no se borró nada» (14-sep-2026):
 *  la base ya no deja borrar a cualquiera, y un borrado rechazado por permisos
 *  vuelve SIN error y con 0 filas. Sin esto la pantalla la quitaba de la lista
 *  aunque siguiera guardada, y la lista quedaba desincronizada con la base. */
export async function deleteFoodDistribution(id: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.from('food_distributions').delete().eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'No se borró: no tienes permiso para borrar esa entrega (solo la cocina que la registró hoy, o quien tenga permiso completo de Comida) o ya no existe.' };
  return {};
}
