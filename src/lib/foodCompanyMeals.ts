import { supabase, selectAllRows } from './supabase';
import { cmpText, norm } from './text';
import { FoodCompanyMeal, MealType } from '../types/database';

// Solo el personal de cocina/alimentación puede ingresar cantidades. Se valida por
// el CARGO en nómina (ayudante de cocina, alimentación, cocinero, cocina, …).
export const COOK_KEYS = ['cocina', 'cociner', 'aliment'];
export const isCookCargo = (cargo?: string | null): boolean => {
  const n = norm(cargo ?? '');
  return !!n && COOK_KEYS.some((k) => n.includes(k));
};

/** Las 4 comidas del día, en orden: desayuno → almuerzo → lunch (merienda tarde) → cena. */
export const MEALS: { key: MealType; label: string; icon: string; color: string }[] = [
  { key: 'desayuno', label: 'Desayuno', icon: '🌅', color: '#F59E0B' },
  { key: 'almuerzo', label: 'Almuerzo', icon: '🍽️', color: '#2563EB' },
  { key: 'lunch', label: 'Lunch', icon: '🥪', color: '#0D9488' },
  { key: 'cena', label: 'Cena', icon: '🌙', color: '#7C3AED' },
];

/** Plato EXTRA "Otros" (17-sep-2026): platos que carga el usuario, con su costo.
 *  Va aparte de MEALS para no meterlo en el flujo por persona ni en los KPIs base. */
export const OTROS_MEAL: { key: MealType; label: string; icon: string; color: string } =
  { key: 'otros', label: 'Otros', icon: '🧾', color: '#DB2777' };

/** Las comidas de la DISTRIBUCIÓN POR EMPRESA: las 4 fijas + Otros. */
export const COMPANY_MEALS = [...MEALS, OTROS_MEAL];

export const mealLabel = (k: MealType) => COMPANY_MEALS.find((m) => m.key === k)?.label ?? k;

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

// ⭐ Las tres lecturas de abajo van PAGINADAS (14-sep-2026): la consulta simple corta en
//    1000 filas y el reporte salía incompleto sin avisar. El orden se aplica después de
//    juntar las páginas. Si la lectura falla, LANZAN: una lista vacía se leía como «no
//    hubo comidas».

/** Todas las comidas por empresa de un día (para el módulo/jefe). */
export async function listCompanyMealsByDate(date: string): Promise<FoodCompanyMeal[]> {
  const rows = (await selectAllRows('food_company_meals', '*', (q) => q.eq('meal_date', date))) as FoodCompanyMeal[];
  return rows.sort((x, y) => cmpText(x.company_name, y.company_name));
}

/** Comidas por empresa en un RANGO de fechas (control/asistencia por empresa). */
export async function listCompanyMealsBetween(from: string, to: string): Promise<FoodCompanyMeal[]> {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const rows = (await selectAllRows('food_company_meals', '*', (q) => q.gte('meal_date', a).lte('meal_date', b))) as FoodCompanyMeal[];
  return rows.sort((x, y) => x.meal_date.localeCompare(y.meal_date) || cmpText(x.company_name, y.company_name));
}

/** Comidas de UNA empresa en un rango de fechas (para su reporte). */
export async function listForCompanyBetween(companyId: string, from: string, to: string): Promise<FoodCompanyMeal[]> {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const rows = (await selectAllRows('food_company_meals', '*', (q) =>
    q.eq('company_id', companyId).gte('meal_date', a).lte('meal_date', b),
  )) as FoodCompanyMeal[];
  return rows.sort((x, y) => y.meal_date.localeCompare(x.meal_date) || String(x.meal_type).localeCompare(String(y.meal_type)));
}

export type SaveCompanyMealInput = {
  companyId: string;
  companyName: string;
  mealType: MealType;
  mealDate: string;
  machines: number;
  suggested: number;
  delivered: number;
  unitCost?: number;        // costo por plato en $ (0 si no lleva costo)
  itemLabel?: string | null; // nombre del plato (para OTROS)
  note?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  createdByCargo?: string | null;
};

/** Registra UNA distribución de comida de una empresa. Ya NO es única por día:
 *  se pueden registrar varias y se suman (cada una es un renglón con su costo). */
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
      unit_cost: Math.max(0, Number(input.unitCost) || 0),
      item_label: (input.itemLabel ?? '').trim() || null,
      note: (input.note ?? '').trim() || null,
      created_by: input.createdBy ?? null,
      created_by_name: input.createdByName ?? null,
      created_by_cargo: input.createdByCargo ?? null,
    })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: (data as FoodCompanyMeal) ?? null };
}

// ── CATÁLOGO de platos OTROS (bolsa de hielo, refresco, postre…) ──────────────
export type FoodExtraItem = { id: string; name: string };

/** Lista los nombres de platos OTROS guardados (A→Z). */
export async function listExtraItems(): Promise<FoodExtraItem[]> {
  const { data } = await supabase.from('food_extra_items').select('id, name').eq('active', true).order('name');
  return (data ?? []) as FoodExtraItem[];
}

/** Guarda un plato OTROS nuevo (si no existe). No pisa el existente. */
export async function saveExtraItem(name: string): Promise<void> {
  const clean = (name ?? '').trim();
  if (!clean) return;
  await supabase.from('food_extra_items').insert({ name: clean }).then(() => {}, () => {});
}

/** Borra una distribución (por si se registró de más). */
export async function deleteCompanyMeal(id: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.from('food_company_meals').delete().eq('id', id).select('id');
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'No se borró: no tienes permiso o ya no existe.' };
  return {};
}
