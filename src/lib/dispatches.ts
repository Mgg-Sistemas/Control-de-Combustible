// Inserción de un despacho (surtido) de combustible a una máquina.
// Centraliza la validación del tope 2× consumo diario para que la vista de
// operador y la de Equipos usen exactamente la misma regla. Las demás reglas
// duras (1 carga por máquina/día, stock suficiente) viven en triggers de la BD.
import { supabase } from './supabase';

export type MachineDispatchInput = {
  machineryId: string;
  dispatchDate: string; // AAAA-MM-DD
  liters: number;
  /** Tanque de origen. OPCIONAL: si se deja vacío, es carga DIRECTA de la bomba
   *  (solo se registran los litros, no se descuenta ningún tanque). */
  tankId?: string | null;
  operator?: string | null;
  kmIda?: number | null;
  kmVuelta?: number | null;
  fuelStart?: number | null;
  fuelEnd?: number | null;
  /** Consumo diario (L) de la máquina — si se define, el tope es 2×. */
  dailyConsumptionL?: number | null;
  createdBy?: string | null;
};

/**
 * Valida y registra un surtido de combustible a la máquina.
 * Devuelve `{ error }` con un mensaje en español si algo falla
 * (validación local o error del backend: 1 carga/día, stock, etc.).
 */
export async function insertMachineDispatch(
  input: MachineDispatchInput
): Promise<{ error?: string }> {
  const liters = Number(input.liters);
  if (!isFinite(liters) || liters <= 0) return { error: 'Ingresa los litros surtidos (mayor a 0).' };
  // El tanque es OPCIONAL: sin tanque = carga directa de la bomba (solo litros).
  if (!input.dispatchDate) return { error: 'Selecciona la fecha.' };

  // Tope: no se puede solicitar más de 2× el consumo diario de la máquina.
  const diario = input.dailyConsumptionL != null ? Number(input.dailyConsumptionL) : null;
  if (diario != null && diario > 0 && liters > diario * 2) {
    return {
      error: `Esta máquina consume ${diario.toLocaleString()} L/día. No se puede surtir más de ${(diario * 2).toLocaleString()} L (2× el consumo diario).`,
    };
  }

  const { error } = await supabase.from('dispatches').insert({
    dispatch_date: input.dispatchDate,
    asset_kind: 'maquinaria',
    machinery_id: input.machineryId,
    liters,
    tank_id: input.tankId || null,
    driver_operator: (input.operator ?? '').trim() || null,
    km_ida: input.kmIda ?? null,
    km_vuelta: input.kmVuelta ?? null,
    fuel_start: input.fuelStart ?? null,
    fuel_end: input.fuelEnd ?? null,
    created_by: input.createdBy ?? null,
  });
  if (error) {
    // Traduce los errores más comunes de los triggers a algo legible.
    const msg = error.message || '';
    if (/one_fuel_per_machine|una.*carga.*d[ií]a|already/i.test(msg))
      return { error: 'Esta máquina ya tiene un surtido registrado hoy (solo se permite una carga por día).' };
    if (/stock|insufficient|suficiente/i.test(msg))
      return { error: 'No hay suficiente combustible en el tanque seleccionado.' };
    return { error: msg };
  }
  return {};
}
