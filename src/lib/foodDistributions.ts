import { supabase } from './supabase';
import { FoodDistribution } from '../types/database';

export type SaveFoodInput = {
  employeeId: string | null;
  employeeName: string;
  cedula?: string | null;
  meals: number;
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
      distribution_date: input.distributionDate,
      delivered_at: input.deliveredAt ?? new Date().toISOString(),
      note: (input.note ?? '').trim() || null,
      created_by: input.createdBy ?? null,
      created_by_name: input.createdByName ?? null,
    })
    .select()
    .single();
  return { data: (data as FoodDistribution) ?? null, error: error?.message };
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

/** Todas las entregas de un día (para el módulo de distribución). */
export async function listFoodByDate(fromDate: string, toDate?: string): Promise<FoodDistribution[]> {
  let q = supabase.from('food_distributions').select('*').gte('distribution_date', fromDate).order('delivered_at', { ascending: false });
  if (toDate) q = q.lte('distribution_date', toDate);
  else q = q.eq('distribution_date', fromDate);
  const { data } = await q;
  return (data ?? []) as FoodDistribution[];
}

/** Borra una entrega (por si se registró de más). */
export async function deleteFoodDistribution(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from('food_distributions').delete().eq('id', id);
  return { error: error?.message };
}
