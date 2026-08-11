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
    horometro_inicial: ex?.horometro_inicial ?? null,
    horometro_final: ex?.horometro_final ?? null,
    horometro_photo: ex?.horometro_photo ?? null,
    jornada_start_at: ex?.jornada_start_at ?? null,
    jornada_shift: ex?.jornada_shift ?? null,
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
  const patch = shift === 'night'
    ? { night_hours: Number(round.night_hours ?? 0) + elapsed, jornada_start_at: null }
    : { day_hours: Number(round.day_hours ?? 0) + elapsed, jornada_start_at: null };
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
