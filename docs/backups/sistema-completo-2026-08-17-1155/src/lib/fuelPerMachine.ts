// Combustible POR MÁQUINA: agrega los surtidos (dispatches, asset_kind='maquinaria')
// por máquina en un rango de fechas y calcula el rendimiento L/h cruzando con las
// horas trabajadas (machine_rounds). Es el cálculo canónico que ya usa la ficha de
// Equipos; extraído aquí para reutilizarlo en Reportes, Control e Inspecciones.
import { selectAllRows } from './supabase';

export type FuelAgg = { liters: number; count: number; lastDate: string | null };

/** Litros surtidos por máquina (solo maquinaria) en el rango [from, to] (inclusive). */
export async function loadFuelByMachine(fromDate: string, toDate?: string): Promise<Record<string, FuelAgg>> {
  const to = toDate || fromDate;
  const rows = await selectAllRows('dispatches', 'machinery_id, liters, dispatch_date', (q) =>
    q.eq('asset_kind', 'maquinaria').gte('dispatch_date', fromDate).lte('dispatch_date', to));
  const acc: Record<string, FuelAgg> = {};
  (rows ?? []).forEach((r: any) => {
    const id = r.machinery_id as string;
    if (!id) return;
    const cur = acc[id] || { liters: 0, count: 0, lastDate: null };
    cur.liters += Number(r.liters) || 0;
    cur.count += 1;
    if (!cur.lastDate || String(r.dispatch_date) > cur.lastDate) cur.lastDate = r.dispatch_date;
    acc[id] = cur;
  });
  return acc;
}

/** Horas trabajadas de un round = (día + noche) − parada + extras (mín. 0 antes de extras). */
export function workedHoursOfRound(r: any): number {
  return Math.max(0, (Number(r.day_hours) || 0) + (Number(r.night_hours) || 0) - (Number(r.hours_stopped) || 0)) + Math.max(0, Number(r.overtime_hours) || 0);
}

/** Rendimiento L/h = litros ÷ horas trabajadas (redondeado); null si no hay horas. */
export function lphOf(liters: number, hours: number): number | null {
  return hours > 0 ? Math.round((liters / hours) * 100) / 100 : null;
}

/** Litros con hasta 2 decimales y separador de miles. */
export function litersLabel(n: number): string {
  return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
