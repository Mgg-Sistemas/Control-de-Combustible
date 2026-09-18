// ESCRIBIR CORRECCIONES DE COMIDA EN LA BASE (18-sep-2026).
//
// El «cómo» de `comidaEditar.ts`, que tiene el «qué». Acá solo va lo que toca la
// red, para que la regla se pueda probar sin levantar nada.
//
// ⚠️ TODAS LAS ESCRITURAS PIDEN `.select('id')`. Una escritura rechazada por la
//    RLS vuelve SIN error y con cero filas: sin esto, la pantalla daba por
//    guardado lo que la base había rechazado y quedaba mintiendo hasta que
//    alguien refrescara. Ya pasó al borrar (ver `deleteFoodDistribution`).
//
// ⚠️ NO SE MANDA `updated_at` NI `updated_by`: esas columnas no existen. Quién
//    corrigió y cuándo lo guarda el trigger `trg_audit` de la base, que además
//    guarda la fila COMPLETA de antes. Es el mismo rastro que lee
//    `comidaMovimientos.ts` y el que ve la pantalla de Auditoría.

import { supabase } from './supabase';
import { norm } from './text';
import { AltaEmpresa, AltaPersona, CambioEmpresa, CambioPersona, mensajeDeError } from './comidaEditar';
import { FilaAuditoria, TABLAS_COMIDA } from './comidaMovimientos';
import { FoodCompanyMeal, FoodDistribution } from '../types/database';

type Resultado<T> = { data: T | null; error?: string };

/** Corrige una entrega POR EMPRESA ya registrada. */
export async function corregirEntregaEmpresa(id: string, patch: CambioEmpresa): Promise<Resultado<FoodCompanyMeal>> {
  const fila: Record<string, unknown> = {};
  if (patch.cantidad !== undefined) fila.delivered = patch.cantidad;
  if (patch.costo !== undefined) fila.unit_cost = patch.costo;
  if (patch.plato !== undefined) fila.item_label = patch.plato;
  if (patch.nota !== undefined) fila.note = patch.nota;
  if (Object.keys(fila).length === 0) return { data: null, error: 'No cambiaste nada.' };

  const { data, error } = await supabase.from('food_company_meals').update(fila).eq('id', id).select('*');
  const msg = mensajeDeError(error, data?.length ?? 0, 'guardar');
  if (msg) return { data: null, error: msg };
  return { data: (data?.[0] ?? null) as FoodCompanyMeal | null };
}

/** Corrige una entrega POR PERSONA ya registrada. */
export async function corregirEntregaPersona(id: string, patch: CambioPersona): Promise<Resultado<FoodDistribution>> {
  const fila: Record<string, unknown> = {};
  if (patch.cantidad !== undefined) fila.meals = patch.cantidad;
  if (patch.nota !== undefined) fila.note = patch.nota;
  if (Object.keys(fila).length === 0) return { data: null, error: 'No cambiaste nada.' };

  const { data, error } = await supabase.from('food_distributions').update(fila).eq('id', id).select('*');
  const msg = mensajeDeError(error, data?.length ?? 0, 'guardar');
  if (msg) return { data: null, error: msg };
  return { data: (data?.[0] ?? null) as FoodDistribution | null };
}

/**
 * Agrega una entrega POR EMPRESA en CUALQUIER día.
 *
 * `machines` y `suggested` van en cero a propósito: el sugerido (máquinas × 2 +
 * 15) se calcula con las máquinas de HOY, y ponerle a una entrega de hace un mes
 * el conteo de hoy sería inventar un dato que nadie midió. La columna queda en
 * cero y el papel no la usa; lo que se cobra es lo ENTREGADO.
 */
export async function agregarEntregaEmpresa(
  a: AltaEmpresa,
  autor: { id: string | null; nombre: string | null },
  /** La hora de verdad, cuando se sabe (una entrega de HOY). */
  entregadaAt?: string,
): Promise<Resultado<FoodCompanyMeal>> {
  const { data, error } = await supabase
    .from('food_company_meals')
    .insert({
      company_id: a.companyId,
      company_name: a.companyName,
      meal_type: a.mealType,
      meal_date: a.mealDate,
      machines: 0,
      suggested: 0,
      delivered: a.cantidad,
      unit_cost: a.costo,
      item_label: a.plato,
      // La hora de una entrega VIEJA no se sabe: se marca al mediodía de ese día
      // para que caiga dentro de su jornada y no se vea como una entrega de
      // madrugada que nadie hizo. Si es de HOY, va la hora de verdad.
      delivered_at: entregadaAt ?? `${a.mealDate}T12:00:00-04:00`,
      note: a.nota,
      created_by: autor.id,
      created_by_name: autor.nombre,
      created_by_cargo: 'Corrección desde Distribución de comida',
    })
    .select('*');
  const msg = mensajeDeError(error, data?.length ?? 0, 'guardar');
  if (msg) return { data: null, error: msg };
  return { data: (data?.[0] ?? null) as FoodCompanyMeal | null };
}

/** Agrega una entrega POR PERSONA en cualquier día. */
export async function agregarEntregaPersona(
  a: AltaPersona,
  autor: { id: string | null; nombre: string | null },
  entregadaAt?: string,
): Promise<Resultado<FoodDistribution>> {
  const { data, error } = await supabase
    .from('food_distributions')
    .insert({
      employee_id: a.employeeId,
      employee_name: a.employeeName,
      cedula: a.cedula,
      meals: a.cantidad,
      meal_type: a.mealType,
      distribution_date: a.distributionDate,
      delivered_at: entregadaAt ?? `${a.distributionDate}T12:00:00-04:00`,
      note: a.nota,
      created_by: autor.id,
      created_by_name: autor.nombre,
    })
    .select('*');
  const msg = mensajeDeError(error, data?.length ?? 0, 'guardar');
  if (msg) return { data: null, error: msg };
  return { data: (data?.[0] ?? null) as FoodDistribution | null };
}

/** Borra una entrega por empresa. La bitácora guarda la fila completa. */
export async function borrarEntregaEmpresa(id: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.from('food_company_meals').delete().eq('id', id).select('id');
  const msg = mensajeDeError(error, data?.length ?? 0, 'borrar');
  return msg ? { error: msg } : {};
}

/** Borra una entrega por persona. La bitácora guarda la fila completa. */
export async function borrarEntregaPersona(id: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.from('food_distributions').delete().eq('id', id).select('id');
  const msg = mensajeDeError(error, data?.length ?? 0, 'borrar');
  return msg ? { error: msg } : {};
}

// ── LA BITÁCORA (quién agregó, corrigió o borró) ────────────────────────────
//
// Va acá y no en un archivo aparte porque es la otra mitad de lo mismo: quien
// corrige una comida deja un renglón, y la tarjeta que lo muestra vive al lado
// del editor. La regla de cómo se LEE ese renglón sí está separada, en
// `comidaMovimientos.ts`, para poder probarla sin red.

/**
 * Lee de `audit_log` lo que se tocó de comida entre dos fechas.
 *
 * ⚠️ `audit_log` recibe una fila por CADA escritura de unas 34 tablas del
 *    sistema, y ya pasó los 60 mil registros: sin el `in` por tabla y sin el
 *    rango de fechas, esta consulta se traería media base. Las dos van siempre.
 *
 * ⚠️ La RLS de `audit_log` solo deja leer a quien tenga `can_audit` o sea admin.
 *    El .sql de esta tanda agrega una política acotada para que quien tenga
 *    permiso COMPLETO de Comida vea SOLO las filas de las tablas de comida. Sin
 *    correrlo, esta lectura vuelve vacía (no falla) y la tarjeta lo dice.
 */
export async function cargarMovimientosComida(desde: string, hasta: string, tope = 500): Promise<FilaAuditoria[]> {
  const [a, b] = desde <= hasta ? [desde, hasta] : [hasta, desde];
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, at, user_name, action, table_name, row_id, changes')
    .in('table_name', TABLAS_COMIDA as unknown as string[])
    .gte('at', `${a}T00:00:00-04:00`)
    .lte('at', `${b}T23:59:59.999-04:00`)
    .order('at', { ascending: false })
    .limit(tope);
  // Una lectura fallida NO se disfraza de «no pasó nada»: la tarjeta necesita
  // distinguir «nadie tocó nada» de «no pude leer la bitácora».
  if (error) throw new Error(error.message);
  return (data ?? []) as FilaAuditoria[];
}

/** Empleados para el buscador del alta por persona (activos, A→Z). */
//
// ⚠️ «Juan Pérez» no aparecía: la base busca UNA palabra en nombre, apellido o
//    cédula, y «juan pérez» no está entero en ninguno de los tres. Ahora se busca
//    por la palabra más larga y el resto se exige acá, sin importar el orden.
//    Las comas y paréntesis se quitan: rompen el `or(...)` de PostgREST.
export async function buscarEmpleados(texto: string, limite = 25): Promise<{ id: string; nombre: string; cedula: string | null }[]> {
  const palabras = String(texto ?? '').toLowerCase().replace(/[,()%*]/g, ' ').split(/\s+/).filter(Boolean);
  if (palabras.join('').length < 2) return [];
  const clave = [...palabras].sort((a, b) => b.length - a.length)[0];
  const { data } = await supabase
    .from('employees')
    .select('id, first_name, last_name, cedula')
    .or(`first_name.ilike.%${clave}%,last_name.ilike.%${clave}%,cedula.ilike.%${clave}%`)
    .limit(200);
  // Mismo criterio de comparación que el resto del sistema (sin tildes, sin mayúsculas).
  const sinTilde = (v: string) => norm(v);
  return ((data ?? []) as any[])
    .map((e) => ({
      id: e.id as string,
      nombre: `${e.first_name ?? ''} ${e.last_name ?? ''}`.replace(/\s+/g, ' ').trim(),
      cedula: (e.cedula ?? null) as string | null,
    }))
    .filter((e) => {
      const todo = sinTilde(`${e.nombre} ${e.cedula ?? ''}`);
      return palabras.every((p) => todo.includes(sinTilde(p)));
    })
    .slice(0, limite);
}
