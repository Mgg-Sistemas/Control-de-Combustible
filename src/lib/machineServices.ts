// Registro de servicios de máquina que NO son combustible: ACEITE y AIRE.
// Tabla aparte de `dispatches` (ver supabase/machine_services.sql) para no
// chocar con el trigger de "1 carga de combustible por máquina/día" ni tocar
// el stock de ningún tanque.
import { supabase } from './supabase';

export type MachineServiceKind = 'aceite' | 'aire';

export type MachineServiceInput = {
  machineryId: string;
  serviceDate: string; // AAAA-MM-DD
  kind: MachineServiceKind;
  /** Litros (solo 'aceite'; se ignora en 'aire'). */
  liters?: number | null;
  /** Monto por litro (solo 'aceite'). */
  pricePerLiter?: number | null;
  operator?: string | null;
  notes?: string | null;
  photos?: string[] | null;
  createdBy?: string | null;
};

/** Registra un servicio de aceite o aire a una máquina. */
export async function insertMachineService(
  input: MachineServiceInput
): Promise<{ error?: string }> {
  if (!input.machineryId) return { error: 'Falta la máquina.' };
  if (!input.serviceDate) return { error: 'Selecciona la fecha.' };

  let liters: number | null = null;
  let pricePerLiter: number | null = null;
  let total: number | null = null;
  if (input.kind === 'aceite') {
    liters = input.liters != null && isFinite(Number(input.liters)) ? Number(input.liters) : null;
    if (liters == null || liters <= 0) return { error: 'Ingresa los litros de aceite (mayor a 0).' };
    pricePerLiter = input.pricePerLiter != null && isFinite(Number(input.pricePerLiter)) ? Number(input.pricePerLiter) : null;
    total = pricePerLiter != null ? Math.round(pricePerLiter * liters * 100) / 100 : null;
  }

  const { error } = await supabase.from('machine_services').insert({
    machinery_id: input.machineryId,
    service_date: input.serviceDate,
    kind: input.kind,
    liters,
    price_per_liter: pricePerLiter,
    total_amount: total,
    operator: (input.operator ?? '').trim() || null,
    notes: (input.notes ?? '').trim() || null,
    photos: input.photos && input.photos.length ? input.photos : [],
    created_by: input.createdBy ?? null,
  });
  if (error) return { error: error.message };
  return {};
}
