// Inicio de jornada de un operador en una máquina. Lógica de negocio compartida
// entre la vista rápida (operador escanea con su teléfono) y la vista del
// supervisor (escanea el carnet del operador y coteja la cédula, por si el
// operador no tiene teléfono). Así las reglas viven en UN solo lugar.
import { supabase } from './supabase';
import { upsertMachineRound } from './machineRounds';
import { businessRoundDateOf } from './caracasDay';
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

/** Turno con su etiqueta a partir de la clave elegida a mano (sol/luna). */
export function shiftFromKey(key: 'day' | 'night'): { key: 'day' | 'night'; label: string } {
  return key === 'day'
    ? { key: 'day', label: '☀️ Jornada de día' }
    : { key: 'night', label: '🌙 Jornada de noche' };
}

/**
 * HORARIO NOMINAL del turno (jornadas fijas): DÍA 07:00 a. m. → 07:00 p. m.,
 * NOCHE 07:00 p. m. → 07:00 a. m. Es la ÚNICA fuente de las horas de inicio/fin que
 * se MUESTRAN (no las horas trabajadas, que se miden aparte). Aunque el inspector
 * marque el inicio a las 9am o el fin a las 6:30pm, la jornada se muestra 7am→7pm
 * (permanencia del turno completo). Compartido por el panel de Inspecciones (tarjeta
 * de jornada), el Reporte por Empresa y el Reporte con Firma para que TODOS coincidan.
 */
export function horarioNominal(shift: 'day' | 'night'): { ini: string; fin: string } {
  return shift === 'day'
    ? { ini: '07:00 a. m.', fin: '07:00 p. m.' }
    : { ini: '07:00 p. m.', fin: '07:00 a. m.' };
}

/**
 * HORA FIN REAL de una jornada CERRADA = inicio nominal del turno + horas TRABAJADAS.
 * El inicio se ancla al nominal (día 7am / noche 7pm), pero el fin refleja cuánto
 * trabajó de verdad: un día completo (12h) da 7:00 p. m., pero una noche de 5.47h da
 * ~12:28 a. m. (NO 7am). Antes el fin era fijo 7pm/7am y mentía en los turnos
 * parciales. Solo formatea la HORA del reloj (maneja el cruce de medianoche por mod
 * 24h); no depende de la fecha. Para jornada EN CURSO usar "En curso", no esto.
 */
export function horaFinJornada(shift: 'day' | 'night', horasTrabajadas: number): string {
  const startMin = (shift === 'day' ? 7 : 19) * 60;
  const total = ((startMin + Math.round(Math.max(0, horasTrabajadas) * 60)) % 1440 + 1440) % 1440;
  let h = Math.floor(total / 60); const m = total % 60;
  const ap = h < 12 ? 'a. m.' : 'p. m.';
  h = h % 12; if (h === 0) h = 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ap}`;
}

/** Lo que hay que escribir en `machine_rounds` para que una jornada quede INICIADA. */
export type InicioJornada = {
  /** `round_date` de NEGOCIO (no de calendario): una noche que cruzó la medianoche
   *  pertenece al día en que arrancó a las 7pm, no al siguiente. */
  roundDate: string;
  /** `jornada_start_at`: inicio NOMINAL del turno si marcó a tiempo; el declarado si no. */
  startIso: string;
  shift: 'day' | 'night';
  /** Minutos de retraso sobre el margen (≤0 = marcó dentro). */
  retrasoMin: number;
  /** true = se ancló al arranque nominal del turno (7am/7pm). */
  anclada: boolean;
};

/**
 * REGLA ÚNICA DEL INICIO DE JORNADA — un solo lugar para todo el sistema.
 *
 * Extraída de `SupervisorScreen.iniciarJornada`, que era el único camino que la
 * aplicaba bien. `startJornada` (QR del operador / carnet del supervisor) ni siquiera
 * escribía `jornada_start_at`, así que 1.410 rondas desde el 01-jul-2026 quedaron
 * invisibles para el sistema: la máquina tenía operador y horómetro pero salía
 * "⏳ pendiente por iniciar" en Inspecciones (queja del cliente 18-ago-2026).
 * Centralizarla acá garantiza que los dos caminos escriban EXACTAMENTE lo mismo.
 *
 * Las dos reglas que aplica, ambas ya acordadas con el cliente:
 *  1. `round_date` de NEGOCIO (`businessRoundDateOf`): una jornada de NOCHE iniciada
 *     pasada la medianoche sigue perteneciendo a la noche que arrancó AYER a las 7pm.
 *     Usar la fecha de calendario creaba rondas "fantasma" (BUG 10-ago-2026).
 *  2. ANCLAJE AL TURNO (13-ago-2026): el turno de DÍA inicia siempre a las 7:00am y el
 *     de NOCHE a las 7:00pm. Si se marca DENTRO del margen (≤9:00am día / ≤9:00pm
 *     noche), la jornada se ancla al arranque nominal aunque se marque un poco más
 *     tarde → cuenta el turno completo. Fuera del margen conserva el inicio DECLARADO,
 *     para no regalarle 12 h a una marca muy tardía.
 *
 * Blindada por `scripts/test-inicio-jornada.mjs` (`npm run test:inicio`).
 *
 * @param declaredIso instante DECLARADO del inicio (ISO con offset de Caracas)
 * @param now instante de referencia (inyectable para poder probarlo)
 */
export function calcularInicioJornada(p: {
  declaredIso: string;
  shift: 'day' | 'night';
  now?: Date;
}): InicioJornada {
  const now = p.now ?? new Date();
  const nowParts = caracasParts(now);
  const roundDate = businessRoundDateOf(new Date(p.declaredIso), p.shift);
  // Margen para marcar SIN alerta: 9:00am (día) / 9:00pm (noche). Si el turno de noche
  // ya pasó la medianoche (hora < 6), el margen fue el del día anterior.
  let limitDay = nowParts.iso;
  if (p.shift === 'night' && nowParts.hour < 6) {
    const d = new Date(`${nowParts.iso}T12:00:00-04:00`);
    d.setUTCDate(d.getUTCDate() - 1);
    limitDay = caracasParts(d).iso;
  }
  const limitIso = p.shift === 'night' ? `${limitDay}T21:00:00-04:00` : `${limitDay}T09:00:00-04:00`;
  const retrasoMin = Math.round((now.getTime() - new Date(limitIso).getTime()) / 60000);
  const nominalIso = p.shift === 'night' ? `${roundDate}T19:00:00-04:00` : `${roundDate}T07:00:00-04:00`;
  const anclada = retrasoMin <= 0;
  return { roundDate, startIso: anclada ? nominalIso : p.declaredIso, shift: p.shift, retrasoMin, anclada };
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
  shift?: 'day' | 'night';         // turno ELEGIDO a mano (sol/luna); si falta, se deriva de la hora.
};

export type StartJornadaResult =
  // `workDate` = fecha de CALENDARIO (la de `operator_assignments`). `roundDate` = fecha
  // de NEGOCIO, la de `machine_rounds`: son distintas en una noche que cruzó la medianoche,
  // y quien cierre la jornada debe usar `roundDate` o la partiría en dos rondas.
  | { ok: true; assignment: OperatorAssignment | null; shift: { key: 'day' | 'night'; label: string }; startedAt: string; workDate: string; roundDate: string; horometroInicial: number }
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

  // Blindaje: no se puede iniciar jornada en una máquina AVERIADA/PARADA (solicitud de
  // mantenimiento pendiente) ni EN ESPERA de instrucciones. Primero hay que resolverla
  // (marcarla Operativa desde Catálogo/Control de Maquinaria — el mismo botón que ya
  // limpia la solicitud pendiente) o, si aún no se decidió qué hacer con ella, dejarla
  // en "Esperando instrucciones" — cualquiera de los dos saca a la máquina de este bloqueo.
  const { data: machStatus } = await supabase.from('machinery').select('en_espera').eq('id', inp.machineId).maybeSingle();
  if ((machStatus as any)?.en_espera) {
    return { ok: false, error: 'Esta máquina está "Esperando instrucciones" — primero debe salir de ese estado (Catálogo → Esperando instrucciones) antes de iniciar jornada.' };
  }
  const { data: pendMr } = await supabase
    .from('maintenance_requests')
    .select('material')
    .eq('machinery_id', inp.machineId)
    .eq('status', 'pendiente');
  if (pendMr && pendMr.length) {
    // Con varias filas pendientes (avería + parada a la vez) la avería REAL manda en el
    // mensaje, igual que en el resto de la app (Catálogo/Control): antes con `.limit(1)`
    // sin ordenar podía mostrar "PARADA" aunque la máquina tuviera una avería real pendiente.
    const esParada = (pendMr as any[]).every((r) => r.material === 'MÁQUINA PARADA');
    return { ok: false, error: `Esta máquina está marcada como ${esParada ? 'PARADA' : 'AVERIADA'} — primero debe resolverse (marcarla Operativa) antes de iniciar jornada.` };
  }

  // Blindaje: la cédula debe ser de un empleado en NÓMINA con cargo permitido.
  // RPC pública (sin sueldo/datos bancarios): esta llamada corre bajo sesión
  // anónima del QR de máquina, así que no puede leer employees directo.
  const { data: empRows } = await supabase.rpc('employee_public_lookup', { p_cedula: ci });
  const emp = (empRows && (empRows as any)[0]) ?? null;
  const empCargo = emp?.cargo ?? null;
  if (!empCargo) return { ok: false, error: 'Esa cédula no está en nómina. Solo personal de nómina puede iniciar jornada.' };
  if (!isOperatorCargo(empCargo)) return { ok: false, error: `Cargo "${empCargo}" no autorizado. Solo OPERADORES, CHOFERES, SERVICIOS GENERALES u OBREROS pueden iniciar jornada.` };

  // Blindaje de EMPRESA: el operador solo puede trabajar equipos de SU empresa.
  // (Si la máquina o el empleado no tienen empresa asignada, no se bloquea.)
  const { data: macRow } = await supabase.from('machinery').select('company_id, company:company_id(name)').eq('id', inp.machineId).maybeSingle();
  const macCompany = (macRow as any)?.company_id ?? null;
  if (macCompany && emp?.company_id && emp.company_id !== macCompany) {
    const macName = (macRow as any)?.company?.name ?? 'otra empresa';
    return { ok: false, error: `Este equipo es de ${macName}. El operador solo puede trabajar equipos de su propia empresa.` };
  }

  const hi = Number(inp.horometroInicial);
  if (!isFinite(hi) || hi < 0) return { ok: false, error: 'Ingresa el horómetro inicial.' };

  const now = new Date();
  const { iso, hour } = caracasParts(now);
  // Turno: el elegido a mano (sol/luna) tiene prioridad; si no, se deriva de la hora.
  const sh = inp.shift ? shiftFromKey(inp.shift) : shiftOf(hour);

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
  //
  // ⚠️ LOS CAMPOS `jornada_*` SON OBLIGATORIOS, no adorno. Hasta el 18-ago-2026 este
  // camino escribía SOLO operador y horómetro: la máquina quedaba con nombre, cédula y
  // horómetro guardados, pero para toda la app NUNCA había arrancado. `clasificarEstadoTurno`
  // mira exactamente `jornada_start_at`, `declared_day/night` (que el RPC deriva de
  // `jornada_shift`) y las horas — nada más — así que caía en "⏳ pendiente por iniciar".
  // Eran 1.410 rondas desde el 01-jul-2026. La regla del inicio se comparte con
  // SupervisorScreen vía `calcularInicioJornada` para que los dos escriban IGUAL.
  const ini = calcularInicioJornada({ declaredIso: now.toISOString(), shift: sh.key, now });
  const jornadaPatch = {
    jornada_start_at: ini.startIso,
    jornada_shift: ini.shift,
    jornada_marked_at: now.toISOString(),
    jornada_marked_by: inp.recordedBy ?? null,
    // La ronda nace en 'parada' cuando llega con 0 horas (lo pone el RPC). Arrancar una
    // jornada la vuelve operativa: si no, el estado se queda pegado en "parada" con la
    // jornada abierta — y Control de Pagos lee esa columna.
    status: 'operativa' as const,
  };
  const roundPatch: any = sh.key === 'day'
    ? { ...jornadaPatch, day_operator: full, day_operator_ci: ci, horometro_inicial: hi, horometro_photo: inp.horometroPhoto ?? null }
    : { ...jornadaPatch, night_operator: full, night_operator_ci: ci, horometro_inicial: hi, horometro_photo: inp.horometroPhoto ?? null };
  const [{ error: e2 }, r3] = await Promise.all([
    supabase.from('machinery').update({ entry_at: now.toISOString(), entry_date: iso, exit_at: null, exit_date: null }).eq('id', inp.machineId),
    // La ronda va a la fecha de NEGOCIO (`ini.roundDate`), no a la de calendario: una
    // jornada de noche iniciada pasada la medianoche pertenece a la noche de AYER.
    // `operator_assignments.work_date` sigue usando `iso` (calendario) a propósito.
    upsertMachineRound(inp.machineId, ini.roundDate, roundPatch, inp.recordedBy ?? null),
  ]);
  if (eAsg || e2 || r3.error) return { ok: false, error: (eAsg?.message || e2?.message || r3.error) as string };

  return { ok: true, assignment: (asgRow as OperatorAssignment) ?? null, shift: sh, startedAt: ini.startIso, workDate: iso, roundDate: ini.roundDate, horometroInicial: hi };
}
