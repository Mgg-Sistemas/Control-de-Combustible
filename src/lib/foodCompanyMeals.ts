import { supabase } from './supabase';
import { norm } from './text';
import { FoodCompanyMeal, MealType } from '../types/database';

// Solo el personal de cocina/alimentación puede ingresar cantidades. Se valida por
// el CARGO en nómina (ayudante de cocina, alimentación, cocinero, cocina, …).
export const COOK_KEYS = ['cocina', 'cociner', 'aliment'];
export const isCookCargo = (cargo?: string | null): boolean => {
  const n = norm(cargo ?? '');
  return !!n && COOK_KEYS.some((k) => n.includes(k));
};

/** Las 3 comidas del día, en orden. */
export const MEALS: { key: MealType; label: string; icon: string; color: string }[] = [
  { key: 'desayuno', label: 'Desayuno', icon: '🌅', color: '#F59E0B' },
  { key: 'almuerzo', label: 'Almuerzo', icon: '🍽️', color: '#2563EB' },
  { key: 'cena', label: 'Cena', icon: '🌙', color: '#7C3AED' },
];

export const mealLabel = (k: MealType) => MEALS.find((m) => m.key === k)?.label ?? k;

/** Total sugerido de comidas = (máquinas de la empresa × 2) + 15. */
export const suggestedMeals = (machines: number) => Math.max(0, Number(machines) || 0) * 2 + 15;

/** Margen permitido por encima del sugerido (comidas extra que se toleran). */
export const MEAL_TOLERANCE = 8;
/** Tope máximo de comidas que se pueden registrar = sugerido + margen. */
export const maxDeliverable = (suggested: number) => (Math.max(0, Number(suggested) || 0)) + MEAL_TOLERANCE;

/** Cuenta las máquinas de una empresa (para calcular el sugerido). */
export async function countCompanyMachines(companyId: string): Promise<number> {
  const { count } = await supabase
    .from('machinery')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);
  return count ?? 0;
}

/** Comidas ya registradas de una empresa en un día (para saber cuáles faltan). */
export async function listForCompanyDay(companyId: string, date: string): Promise<FoodCompanyMeal[]> {
  const { data } = await supabase
    .from('food_company_meals')
    .select('*')
    .eq('company_id', companyId)
    .eq('meal_date', date)
    .order('delivered_at', { ascending: true });
  return (data ?? []) as FoodCompanyMeal[];
}

/** Todas las comidas por empresa de un día (para el módulo/jefe). */
export async function listCompanyMealsByDate(date: string): Promise<FoodCompanyMeal[]> {
  const { data } = await supabase
    .from('food_company_meals')
    .select('*')
    .eq('meal_date', date)
    .order('company_name', { ascending: true });
  return (data ?? []) as FoodCompanyMeal[];
}

/** Comidas por empresa en un RANGO de fechas (control/asistencia por empresa). */
export async function listCompanyMealsBetween(from: string, to: string): Promise<FoodCompanyMeal[]> {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const { data } = await supabase
    .from('food_company_meals')
    .select('*')
    .gte('meal_date', a)
    .lte('meal_date', b)
    .order('meal_date', { ascending: true })
    .order('company_name', { ascending: true });
  return (data ?? []) as FoodCompanyMeal[];
}

export type SaveCompanyMealInput = {
  companyId: string;
  companyName: string;
  mealType: MealType;
  mealDate: string;
  machines: number;
  suggested: number;
  delivered: number;
  note?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  createdByCargo?: string | null;
};

/** Registra la comida de una empresa. Si ya existe (misma empresa/comida/día),
 *  devuelve un error claro (la restricción única lo impide: 1 vez por día). */
export async function saveCompanyMeal(input: SaveCompanyMealInput): Promise<{ data: FoodCompanyMeal | null; error?: string }> {
  const { data, error } = await supabase
    .from('food_company_meals')
    .insert({
      company_id: input.companyId,
      company_name: input.companyName,
      meal_type: input.mealType,
      meal_date: input.mealDate,
      machines: input.machines,
      suggested: input.suggested,
      delivered: input.delivered,
      note: (input.note ?? '').trim() || null,
      created_by: input.createdBy ?? null,
      created_by_name: input.createdByName ?? null,
      created_by_cargo: input.createdByCargo ?? null,
    })
    .select()
    .single();
  if (error) {
    const dup = error.code === '23505' || /duplicate|unique/i.test(error.message);
    return { data: null, error: dup ? 'Esa comida ya se registró hoy para esta empresa.' : error.message };
  }
  return { data: (data as FoodCompanyMeal) ?? null };
}
