import { supabase, selectAllRows } from './supabase';
import { FoodDistribution, MealType } from '../types/database';

export type SaveFoodInput = {
  employeeId: string | null;
  employeeName: string;
  cedula?: string | null;
  /** Contacto de cocina al que se le entrega (21-sep-2026). Va en vez de
   *  `employeeId`, nunca junto con él: o es de nómina, o es de la agenda.
   *  `employeeName` y `cedula` se llenan IGUAL con sus datos, para que las
   *  listas y los reportes que ya existen lo muestren sin cambiarles nada. */
  contactoId?: string | null;
  /** A quién se le cobra ESTA entrega. Se congela acá con lo que diga la ficha
   *  del contacto en este momento: si viviera solo en la ficha, cambiarle el
   *  interruptor después reescribiría facturas ya entregadas. */
  cobrarA?: 'empresa' | 'independiente' | null;
  /** CUÁL empresa, congelada igual que `cobrarA` (21-sep-2026). Sin esto, cambiarle
   *  la empresa al contacto mañana mudaría sus entregas viejas a la factura de la
   *  empresa nueva. Va el id Y el nombre, como `empresa_snap` en los viajes: el papel
   *  ya entregado no cambia porque renombren o borren la empresa. Solo con
   *  `cobrarA = 'empresa'`. */
  contactoCompanyId?: string | null;
  contactoCompanyNombre?: string | null;
  meals: number;
  mealType?: MealType | null;  // desayuno/almuerzo/lunch/cena (1 por día por persona); 'otros' solo para contactos
  /** Qué plato fue, SOLO con `mealType = 'otros'` y solo para contactos (22-sep-2026).
   *  La base lo exige: un «Otros» sin plato no se puede cobrar ni explicar. */
  itemLabel?: string | null;
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
      // ⚠️ LAS COLUMNAS DE CONTACTO SOLO SE MANDAN SI HAY CONTACTO, y es a
      //    propósito. Mientras no se corra `sql-comida-contactos-2026-09-21.sql`
      //    esas columnas NO existen, y PostgREST rechaza el insert entero con
      //    «column not found in schema cache». Mandarlas siempre dejaría a la
      //    cocina sin poder registrar NI UNA comida hasta que alguien corriera
      //    el SQL. Así, lo de nómina sigue funcionando igual que ayer y lo único
      //    que falla es justo lo que necesita la tabla nueva.
      ...(input.contactoId ? {
        contacto_id: input.contactoId,
        cobrar_a: input.cobrarA ?? null,
        contacto_company_id: input.cobrarA === 'empresa' ? (input.contactoCompanyId ?? null) : null,
        contacto_company_nombre: input.cobrarA === 'empresa' ? ((input.contactoCompanyNombre ?? '').trim() || null) : null,
        // El plato solo viaja en «Otros»: la base rechaza un plato en un almuerzo.
        ...(input.mealType === 'otros' ? { item_label: (input.itemLabel ?? '').trim() || null } : {}),
      } : {}),
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
    if (dup) return { data: null, error: 'Esa comida ya se registró hoy para esta persona.' };
    // Falta el SQL de contactos: sin esto el aviso sería «column contacto_id does
    // not exist», que no le dice a nadie qué hacer.
    if (input.contactoId && input.mealType === 'otros' && /item_label|otros_|plato_solo/i.test(error.message)) {
      return { data: null, error: 'Falta correr el SQL de «Otros» para contactos en Supabase (sql-comida-contactos-otros-2026-09-22.sql). Avisa al administrador.' };
    }
    if (input.contactoId && /contacto_|cobrar_a|schema cache/i.test(error.message)) {
      return { data: null, error: 'Falta correr el SQL de contactos de cocina en Supabase (sql-comida-contactos-2026-09-21.sql). Avisa al administrador.' };
    }
    return { data: null, error: error.message };
  }
  return { data: (data as FoodDistribution) ?? null };
}

/** Entregas de un CONTACTO de cocina en un día (más reciente primero).
 *
 *  Va aparte de `listForEmployeeDay` porque la clave es otra columna. Y a
 *  diferencia de la de nómina, esta lista NO sirve para trancar: un contacto
 *  puede pedir la misma comida dos veces en el día (paga él). Es para MOSTRAR
 *  lo que ya se llevó, y avisar antes de repetir sin querer. */
export async function listForContactoDay(contactoId: string, date: string): Promise<FoodDistribution[]> {
  const { data, error } = await supabase
    .from('food_distributions')
    .select('*')
    .eq('contacto_id', contactoId)
    .eq('distribution_date', date)
    .order('delivered_at', { ascending: false });
  // Sin la columna todavía (falta el SQL) no hay entregas de contactos que mostrar.
  if (error) return [];
  return (data ?? []) as FoodDistribution[];
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
