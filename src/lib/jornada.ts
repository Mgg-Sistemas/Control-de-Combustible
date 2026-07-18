// Inicio de jornada de un operador en una máquina. Lógica de negocio compartida
// entre la vista rápida (operador escanea con su teléfono) y la vista del
// supervisor (escanea el carnet del operador y coteja la cédula, por si el
// operador no tiene teléfono). Así las reglas viven en UN solo lugar.
import { supabase } from './supabase';
import { upsertMachineRound } from './machineRounds';
import { OperatorAssignment } from '../types/database';
import { norm } from './text';

const CARACAS_TZ = 'America/Caracas';

/** Fecha ISO (AAAA-MM-DD) y hora (0–23) del momento `d` en Caracas. */
export function caracasParts(d: Date): { iso: string; hour: number; minute: number } {
  const p: any = new Intl.DateTimeFormat('en-US', {
    timeZone: CARACAS_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d).reduce((a: any, x) => { a[x.type] = x.value; return a; }, {});
  return { iso: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

/** Jornada según la hora de inicio: día 6:00–17:59, noche el resto. */
export function shiftOf(hour: number): { key: 'day' | 'night'; label: string } {
  return hour >= 6 && hour < 18
    ? { key: 'day', label: '☀️ Jornada de día' }
    : { key: 'night', label: '🌙 Jornada de noche' };
}

// Solo estos cargos (en nómina) pueden iniciar jornada en una máquina.
export const OPERATOR_CARGOS = ['operador', 'chofer', 'servicios generales', 'obrero'];
export const isOperatorCargo = (cargo?: string | null): boolean => {
  const n = norm(cargo ?? '');
  return !!n && OPERATOR_CARGOS.some((k) => n.includes(k));
};

export type StartJornadaInput = {
  machineId: string;
  companyName?: string | null;
  first: string;
  last: string;
  cedula: string;
  horometroInicial: number;
  horometroPhoto?: string | null;
  createdBy: string | null;        // profiles.id de quien registra (operador anónimo → null)
  recordedBy?: string | null;      // uid para la ronda (machine_rounds.recorded_by)
  startCoords?: { lat: number; lng: number } | null;
};

export type StartJornadaResult =
  | { ok: true; assignment: OperatorAssignment | null; shift: { key: 'day' | 'night'; label: string }; startedAt: string; workDate: string; horometroInicial: number }
  | { ok: false; error: string };

/**
 * Inicia la jornada del operador en la máquina, aplicando TODAS las reglas:
 *  - la cédula debe ser de un empleado en nómina con cargo permitido;
 *  - 1 máquina por operador por día;
 *  - máximo 2 operadores por turno (día/noche) → hasta 4 al día.
 * Registra la asignación (operator_assignments), marca la máquina "En obra" y la
 * ronda del día (machine_rounds) con el operador + horómetro inicial.
 */
export async function startJornada(inp: StartJornadaInput): Promise<StartJornadaResult> {
  const first = (inp.first || '').trim();
  const last = (inp.last || '').trim();
  const ci = (inp.cedula || '').trim();
  if (!first || !last || !ci) return { ok: false, error: 'Completa nombre, apellido y cédula.' };

  // Blindaje: la cédula debe ser de un empleado en NÓMINA con cargo permitido.
  const { data: empRows } = await supabase.from('employees').select('cargo').eq('cedula', ci).limit(1);
  const empCargo = (empRows && (empRows[0] as any)?.cargo) ?? null;
  if (!empCargo) return { ok: false, error: 'Esa cédula no está en nómina. Solo personal de nómina puede iniciar jornada.' };
  if (!isOperatorCargo(empCargo)) return { ok: false, error: `Cargo "${empCargo}" no autorizado. Solo OPERADORES, CHOFERES, SERVICIOS GENERALES u OBREROS pueden iniciar jornada.` };

  const hi = Number(inp.horometroInicial);
  if (!isFinite(hi) || hi < 0) return { ok: false, error: 'Ingresa el horómetro inicial.' };

  const now = new Date();
  const { iso, hour } = caracasParts(now);
  const sh = shiftOf(hour);

  // Regla: un operador (cédula) no puede tener OTRA máquina el mismo día.
  const { data: dup } = await supabase
    .from('operator_assignments')
    .select('id, machinery_id')
    .eq('cedula', ci)
    .eq('work_date', iso)
    .maybeSingle();
  if (dup && (dup as any).machinery_id !== inp.machineId) {
    return { ok: false, error: 'Esa cédula ya tiene otra máquina asignada hoy. Un operador solo puede tener 1 máquina por día.' };
  }

  // Regla: MÁXIMO 2 operadores por TURNO (día/noche) → hasta 4 al día.
  const { data: opsTurno } = await supabase
    .from('operator_assignments')
    .select('cedula')
    .eq('machinery_id', inp.machineId)
    .eq('work_date', iso)
    .eq('shift', sh.key);
  const soloDigitos = (s: string) => (s || '').replace(/\D/g, '');
  const cedulasTurno = new Set((opsTurno ?? []).map((o: any) => soloDigitos(o.cedula)));
  if (!cedulasTurno.has(soloDigitos(ci)) && cedulasTurno.size >= 2) {
    return { ok: false, error: `El turno de ${sh.key === 'day' ? 'DÍA' : 'NOCHE'} de esta máquina ya tiene 2 operadores (máximo por turno).` };
  }

  const full = `${first} ${last}`;
  // 1) Asignación del operador (upsert por cédula+día → si reabre la misma máquina, actualiza).
  const asgPayload: any = {
    first_name: first, last_name: last, cedula: ci, machinery_id: inp.machineId,
    company_name: inp.companyName ?? null, work_date: iso, shift: sh.key,
    started_at: now.toISOString(), ended_at: null, worked_hours: null,
    horometro_inicial: hi, horometro_final: null, horometro_photo: inp.horometroPhoto ?? null, created_by: inp.createdBy,
    start_lat: inp.startCoords?.lat ?? null, start_lng: inp.startCoords?.lng ?? null,
  };
  const { data: asgRow, error: eAsg } = await supabase
    .from('operator_assignments')
    .upsert(asgPayload, { onConflict: 'cedula,work_date' })
    .select()
    .single();
  // 2) Máquina "En obra" + 3) ronda con operador + horómetro inicial.
  const roundPatch: any = sh.key === 'day'
    ? { day_operator: full, day_operator_ci: ci, horometro_inicial: hi, horometro_photo: inp.horometroPhoto ?? null }
    : { night_operator: full, night_operator_ci: ci, horometro_inicial: hi, horometro_photo: inp.horometroPhoto ?? null };
  const [{ error: e2 }, r3] = await Promise.all([
    supabase.from('machinery').update({ entry_at: now.toISOString(), entry_date: iso, exit_at: null, exit_date: null }).eq('id', inp.machineId),
    upsertMachineRound(inp.machineId, iso, roundPatch, inp.recordedBy ?? null),
  ]);
  if (eAsg || e2 || r3.error) return { ok: false, error: (eAsg?.message || e2?.message || r3.error) as string };

  return { ok: true, assignment: (asgRow as OperatorAssignment) ?? null, shift: sh, startedAt: now.toISOString(), workDate: iso, horometroInicial: hi };
}
