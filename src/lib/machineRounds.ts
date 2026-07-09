// Guardado de la jornada de una máquina en un día (registro base round_no=1).
// Misma lógica que ControlMaquinariaScreen.upsertRound, pero autocontenida
// (lee el registro previo de la BD y lo fusiona) para reutilizarla desde la
// vista de operador sin duplicar las reglas de negocio.
import { supabase } from './supabase';
import { MachineRound } from '../types/database';

export type RoundPatch = Partial<{
  day_hours: number;
  night_hours: number;
  hours_stopped: number;
  overtime_hours: number;
  day_operator: string | null;
  day_operator_ci: string | null;
  night_operator: string | null;
  night_operator_ci: string | null;
}>;

/**
 * Inserta/actualiza la jornada (round_no=1) de una máquina en una fecha,
 * conservando lo ya registrado y aplicando `patch`. El estado ('operativa' /
 * 'parada') se deriva de las horas de turno. Devuelve la fila o un error.
 */
export async function upsertMachineRound(
  machineryId: string,
  dateISO: string,
  patch: RoundPatch,
  recordedBy?: string | null
): Promise<{ data?: MachineRound; error?: string }> {
  // Trae el registro previo (si existe) para no pisar los otros campos.
  const { data: ex } = await supabase
    .from('machine_rounds')
    .select('*')
    .eq('machinery_id', machineryId)
    .eq('round_date', dateISO)
    .eq('round_no', 1)
    .maybeSingle();

  const payload: any = {
    machinery_id: machineryId,
    round_date: dateISO,
    round_no: 1,
    day_hours: Number(ex?.day_hours ?? 0),
    night_hours: Number(ex?.night_hours ?? 0),
    hours_stopped: Number(ex?.hours_stopped ?? 0),
    overtime_hours: Number(ex?.overtime_hours ?? 0),
    day_operator: ex?.day_operator ?? null,
    day_operator_ci: ex?.day_operator_ci ?? null,
    night_operator: ex?.night_operator ?? null,
    night_operator_ci: ex?.night_operator_ci ?? null,
    ...patch,
  };
  if (recordedBy && !ex) payload.recorded_by = recordedBy;
  payload.status = Number(payload.day_hours) + Number(payload.night_hours) > 0 ? 'operativa' : 'parada';

  const { data, error } = await supabase
    .from('machine_rounds')
    .upsert(payload, { onConflict: 'machinery_id,round_date,round_no' })
    .select()
    .single();
  if (error) return { error: error.message };
  return { data: data as MachineRound };
}

/** Lee la jornada (round_no=1) de una máquina en una fecha, o null si no existe. */
export async function getMachineRound(
  machineryId: string,
  dateISO: string
): Promise<MachineRound | null> {
  const { data } = await supabase
    .from('machine_rounds')
    .select('*')
    .eq('machinery_id', machineryId)
    .eq('round_date', dateISO)
    .eq('round_no', 1)
    .maybeSingle();
  return (data as MachineRound) ?? null;
}
