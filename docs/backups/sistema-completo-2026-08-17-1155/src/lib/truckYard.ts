// Registro de ENTRADA/SALIDA de camiones (tabla truck_yard_logs, que alimenta el
// calendario "Entrada y salida de camiones"). Regla del negocio: al INICIAR la
// jornada de un camión sale del patio (SALIDA); al FINALIZAR regresa (ENTRADA).
// Nunca lanza: es secundario, no debe romper el flujo de la jornada.
import { supabase } from './supabase';
import { isVolteoVolqueta } from './equipos';

export async function logTruckYard(
  machineryId: string,
  machineCode: string,
  direction: 'entrada' | 'salida',
  loggedBy: string | null,
  loggedByName: string | null
): Promise<void> {
  try {
    await supabase.from('truck_yard_logs').insert({
      machinery_id: machineryId,
      machine_code: machineCode,
      direction,
      logged_by: loggedBy,
      logged_by_name: loggedByName,
    });
  } catch {
    // Silencioso a propósito.
  }
}

/** Igual que logTruckYard pero SOLO si la máquina es un volteo/volqueta. Se usa al
 *  iniciar/finalizar la jornada desde la vista del inspector (que sirve cualquier
 *  máquina): así el movimiento de patio se registra solo para camiones. */
export async function logTruckYardIfTruck(
  machineryId: string,
  machineCode: string,
  direction: 'entrada' | 'salida',
  loggedBy: string | null,
  loggedByName: string | null
): Promise<void> {
  if (!isVolteoVolqueta(machineCode)) return;
  await logTruckYard(machineryId, machineCode, direction, loggedBy, loggedByName);
}
