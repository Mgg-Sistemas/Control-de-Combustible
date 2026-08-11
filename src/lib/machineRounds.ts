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
  horometro_inicial: number | null;
  horometro_final: number | null;
  horometro_photo: string | null;
  jornada_start_at: string | null;
  jornada_shift: string | null;
}>;

/**
 * Inserta/actualiza la jornada (round_no=1) de una máquina en una fecha,
 * conservando lo ya registrado y aplicando `patch`. El estado ('operativa' /
 * 'parada') se deriva de las horas de turno. Devuelve la fila o un error.
 *
 * ATÓMICO (auditoría sync#3): delega en el RPC `upsert_machine_round`, que hace
 * un INSERT ... ON CONFLICT DO UPDATE escribiendo SOLO las columnas presentes en
 * `patch` (clave presente, aun con valor null, gana; ausente conserva lo de la
 * BD) en un único statement. Antes esta función leía la fila completa, la
 * fusionaba en memoria y re-escribía TODO: si dos actualizaban campos distintos
 * del mismo round a la vez, el segundo pisaba el cambio del primero (lost-update
 * de horas → pagos). El RPC elimina esa ventana: nunca reenvía valores stale.
 */
export async function upsertMachineRound(
  machineryId: string,
  dateISO: string,
  patch: RoundPatch,
  recordedBy?: string | null
): Promise<{ data?: MachineRound; error?: string }> {
  const { data, error } = await supabase.rpc('upsert_machine_round', {
    p_machinery_id: machineryId,
    p_round_date: dateISO,
    p_patch: patch,
    p_recorded_by: recordedBy ?? null,
  });
  if (error) return { error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as MachineRound;
  return { data: row };
}

/**
 * Último horómetro FINAL registrado de una máquina (la jornada más reciente con
 * horómetro final). Sirve para precargar el horómetro INICIAL de la próxima
 * jornada: el final de una jornada es el inicial de la siguiente.
 */
export async function lastHorometroFinal(machineryId: string): Promise<number | null> {
  const { data } = await supabase
    .from('machine_rounds')
    .select('horometro_final')
    .eq('machinery_id', machineryId)
    .not('horometro_final', 'is', null)
    .order('round_date', { ascending: false })
    .limit(1);
  const r = (data && (data[0] as any)) || null;
  return r?.horometro_final != null ? Number(r.horometro_final) : null;
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
