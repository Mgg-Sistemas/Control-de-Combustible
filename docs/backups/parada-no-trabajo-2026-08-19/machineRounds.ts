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
  jornada_marked_at: string | null; // hora REAL en que el inspector marcó (≠ inicio declarado)
  jornada_marked_by: string | null; // usuario que INICIÓ la jornada (no se pisa al finalizar)
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

const CARACAS_TZ = 'America/Caracas';
function caracasHour(iso: string): number {
  const p: any = new Intl.DateTimeFormat('en-US', { timeZone: CARACAS_TZ, hour12: false, hour: '2-digit' }).formatToParts(new Date(iso)).reduce((a: any, x) => { a[x.type] = x.value; return a; }, {});
  return Number(p.hour) % 24;
}
function caracasIso(d: Date): string {
  const p: any = new Intl.DateTimeFormat('en-US', { timeZone: CARACAS_TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).reduce((a: any, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * "Congela" una jornada abierta AHORA MISMO (no espera al cierre automático de fin
 * de turno): banca las horas reales desde `jornada_start_at` hasta este instante y
 * pone `jornada_start_at = null`. Se usa cuando la máquina pasa a "En espera de
 * instrucciones" (pedido del cliente 11-ago-2026: congelada por completo — si tenía
 * una jornada corriendo, no debe seguir acumulando horas ni depender de que el
 * inspector la cierre manualmente). Mismo cálculo que el cron `auto_close_jornadas`,
 * pero disparado al instante en vez de a las 7am/7pm.
 */
export async function freezeOpenJornadaNow(
  machineryId: string
): Promise<{ closed: boolean; hours?: number; shift?: 'day' | 'night'; error?: string }> {
  const today = caracasIso(new Date());
  const yesterday = caracasIso(new Date(Date.now() - 86400000));
  let round = await getMachineRound(machineryId, today);
  let roundDate = today;
  if (!round?.jornada_start_at) {
    const ry = await getMachineRound(machineryId, yesterday);
    if (ry?.jornada_start_at && ry.jornada_shift === 'night') { round = ry; roundDate = yesterday; }
  }
  if (!round?.jornada_start_at) return { closed: false };
  const startMs = new Date(round.jornada_start_at).getTime();
  const now = new Date();
  const elapsed = Math.max(0, Math.round(((now.getTime() - startMs) / 3600000) * 100) / 100);
  const shift: 'day' | 'night' = round.jornada_shift === 'night' ? 'night'
    : round.jornada_shift === 'day' ? 'day'
    : (caracasHour(round.jornada_start_at) >= 7 && caracasHour(round.jornada_start_at) < 19 ? 'day' : 'night');
  // TOPE FÍSICO (igual que finalizar/parada): lo bancado nunca supera lo transcurrido
  // desde el inicio del turno (7am día / 7pm noche) ni las 12h. Al re-abrir una jornada
  // el inicio se re-ancla al inicio del turno, así que `bancado + elapsed` contaría dos
  // veces el tramo ya bancado (bug 14-ago-2026: noche 3.49h con solo 1.82h desde 7pm).
  const shiftStartMs = shift === 'night'
    ? new Date(roundDate + 'T19:00:00-04:00').getTime()
    : new Date(roundDate + 'T07:00:00-04:00').getTime();
  const topeFisico = Math.min(12, Math.max(0, (now.getTime() - shiftStartMs) / 3600000));
  const patch = shift === 'night'
    ? { night_hours: Math.min(topeFisico, Number(round.night_hours ?? 0) + elapsed), jornada_start_at: null }
    : { day_hours: Math.min(topeFisico, Number(round.day_hours ?? 0) + elapsed), jornada_start_at: null };
  const res = await upsertMachineRound(machineryId, roundDate, patch as RoundPatch);
  if (res.error) return { closed: false, error: res.error };
  if (elapsed > 0) {
    await supabase.from('machine_work_segments').insert({
      machinery_id: machineryId, round_date: roundDate, shift,
      started_at: round.jornada_start_at, ended_at: now.toISOString(), hours: elapsed, source: 'ajuste_manual',
    });
  }
  return { closed: true, hours: elapsed, shift };
}
