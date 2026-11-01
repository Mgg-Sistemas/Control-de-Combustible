// 01-nov-2026 — Combustible: editar la foto y la nota de un consumo o de un
// ingreso ya registrados, y el enlace de WhatsApp de los comprobantes.
//
// QUIÉN EDITA: solo quien tiene nivel 'full' en el módulo de la pestaña
// ('consumos' para dispatches, 'ingresos' para fuel_intakes). La RLS de ambas
// tablas pide can_write_module(...): si no alcanza, el UPDATE vuelve SIN error y
// con 0 filas. Por eso se guarda con .select('id') y se avisa cuando no se guardó.
//
// COLUMNAS (creadas y verificadas el 01-nov-2026): dispatches.notes, fuel_intakes.notes,
// fuel_intakes.photos. Los interruptores quedan por si hubiera que apagarlo.
// Editar solo foto/nota NO toca el tanque: mv_dispatch/mv_intake salen antes
// si no cambian ni los litros ni el tanque.
import { supabase } from './supabase';

/** Enciende la nota/observación en consumos (dispatches.notes). */
export const CONSUMOS_NOTAS_ACTIVAS = true;
/** Enciende la nota/observación en ingresos (fuel_intakes.notes). */
export const INGRESOS_NOTAS_ACTIVAS = true;
/** Enciende las fotos de los ingresos (fuel_intakes.photos). */
export const INGRESOS_FOTOS_ACTIVAS = true;

export type TablaCombustible = 'dispatches' | 'fuel_intakes';

export function notasActivas(tabla: TablaCombustible): boolean {
  return tabla === 'dispatches' ? CONSUMOS_NOTAS_ACTIVAS : INGRESOS_NOTAS_ACTIVAS;
}
export function fotosActivas(tabla: TablaCombustible): boolean {
  return tabla === 'dispatches' ? true : INGRESOS_FOTOS_ACTIVAS;
}

/**
 * Arma el UPDATE: solo manda las columnas que existen (según los interruptores).
 * Las fotos vacías se limpian; la nota en blanco queda null.
 */
export function armarCambiosCombustible(
  tabla: TablaCombustible,
  fotos: string[],
  nota: string,
): Record<string, any> {
  const cambios: Record<string, any> = {};
  if (fotosActivas(tabla)) cambios.photos = (fotos || []).map((f) => String(f || '').trim()).filter(Boolean);
  if (notasActivas(tabla)) cambios.notes = String(nota ?? '').trim() || null;
  return cambios;
}

/** Guarda fotos/nota. ok=false con mensaje claro si la RLS dejó 0 filas. */
export async function guardarFotosNotaCombustible(
  tabla: TablaCombustible,
  id: string,
  fotos: string[],
  nota: string,
): Promise<{ ok: boolean; error?: string }> {
  const cambios = armarCambiosCombustible(tabla, fotos, nota);
  if (Object.keys(cambios).length === 0) return { ok: false, error: 'Nada que guardar en este registro.' };
  const { data, error } = await supabase.from(tabla).update(cambios).eq('id', id).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: 'No se guardó: no tienes permiso para editar este registro (0 filas).' };
  }
  return { ok: true };
}
