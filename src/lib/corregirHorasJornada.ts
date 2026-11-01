// 🕐 CORREGIR LA HORA DE INICIO / FIN DE UNA JORNADA YA FINALIZADA (28-oct-2026).
//
// Pedido: que el INSPECTOR, desde su teléfono, pueda corregir la hora de inicio y
// la hora de fin de una jornada que ÉL finalizó, dentro del mismo plazo de gracia
// que ya tiene para corregir el horómetro (HOY y AYER).
//
// REGLA PURA (sin React ni Supabase), porque de estas horas sale lo que se PAGA.
// Lo que fija:
//  · SOLO LO SUYO: el tramo es un cierre manual (manual_finish / _early) grabado
//    con SU usuario, de una máquina suya en ese turno, de hoy o de ayer.
//  · LO QUE CONTROL CORRIGIÓ NO SE TOCA: si el turno tiene un `ajuste_manual`,
//    «Corregido por Control: pídeselo a Control». Tampoco un turno anulado por
//    «NO TRABAJÓ» (`no_trabajo_correction`): devolverle horas sería inventarlas.
//  · LAS HORAS VIVEN DENTRO DEL TURNO: día 7:00→19:00; noche 19:00→7:00 del día
//    siguiente (hora de Caracas, UTC−4 fijo como todo el sistema). Inicio < fin,
//    nunca en el futuro, máximo 12 h, y sin pisar otros tramos del turno.
//  · NO SE CREAN TRAMOS: se mueve el inicio/fin del tramo EXISTENTE y la ronda del
//    turno se ajusta solo por la DIFERENCIA (nuevas − viejas horas), con tope 0..12.
//  · MOTIVO OBLIGATORIO, como el del horómetro.
import { parseHHMM } from './horaFinJornada';
import { calcularInicioJornada } from './jornada';
import { businessRoundDateOf } from './caracasDay';

export type Turno = 'day' | 'night';

/** Lo que la pantalla lee de `machine_work_segments`. */
export type TramoTurno = {
  id: string;
  shift: Turno | string;
  source: string;
  started_at: string;
  ended_at: string;
  hours: number | string;
  recorded_by: string | null;
  notes?: string | null;
  close_reason?: string | null;
};

/** Los tramos que nacen al FINALIZAR la jornada desde el teléfono. */
export const FUENTES_FINALIZAR = ['manual_finish', 'manual_finish_early'] as const;
export const esCierreManual = (source: string): boolean => (FUENTES_FINALIZAR as readonly string[]).includes(source);

export const MAX_HORAS_TURNO = 12;
const HORA_MS = 3600000;
const GRACIA_FUTURO_MS = 60000; // «ahora mismo» tecleado a mano no rebota por segundos
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Ventana del turno en ms epoch: día 7:00→19:00; noche 19:00→7:00 del día siguiente. */
export function ventanaTurno(roundDate: string, shift: Turno): { inicioMs: number; finMs: number } {
  const base = new Date(`${roundDate}T00:00:00-04:00`).getTime();
  return shift === 'night'
    ? { inicioMs: base + 19 * HORA_MS, finMs: base + 31 * HORA_MS }
    : { inicioMs: base + 7 * HORA_MS, finMs: base + 19 * HORA_MS };
}

/**
 * 'HH:MM' (Caracas) → ms epoch, ubicado en el día que le toca dentro del turno.
 * Noche: de 12:00 a 23:59 cae en el `roundDate`; de 00:00 a 11:59, en el día
 * siguiente (la noche cruza la medianoche). Día: siempre el `roundDate`.
 * null si no es una hora. Que caiga FUERA del turno lo dice `validarCorreccionHoras`.
 */
export function horaDelTurnoMs(roundDate: string, shift: Turno, texto: string): number | null {
  const hm = parseHHMM(texto);
  if (!hm) return null;
  const base = new Date(`${roundDate}T00:00:00-04:00`).getTime();
  const dia = shift === 'night' && hm.h < 12 ? 24 * HORA_MS : 0;
  return base + dia + hm.h * HORA_MS + hm.m * 60000;
}

/** ms epoch → 'HH:MM' de Caracas (UTC−4 fijo). */
export function hhmmCaracas(ms: number): string {
  const d = new Date(ms - 4 * HORA_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
/** ms epoch → 'DD/MM' de Caracas. */
export function ddmmCaracas(ms: number): string {
  const d = new Date(ms - 4 * HORA_MS);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export type Permiso = { ok: true } | { ok: false; error: string; porControl?: boolean };

/**
 * ¿Puede ESTE inspector corregir las horas de ESTE tramo? `tramosDelTurno` son
 * TODOS los tramos de esa máquina, fecha y turno (incluido el propio).
 */
export function puedeCorregirHoras(opts: {
  tramo: TramoTurno;
  uid: string;
  roundDate: string;
  today: string;
  yesterday: string;
  /** ¿La máquina es suya en ese turno (o coordina)? */
  asignadoEnTurno: boolean;
  tramosDelTurno: readonly TramoTurno[];
}): Permiso {
  const { tramo, uid, roundDate, today, yesterday } = opts;
  if (!esCierreManual(tramo.source)) return { ok: false, error: 'Solo se corrige una jornada finalizada a mano desde el teléfono.' };
  if (!uid || tramo.recorded_by !== uid) return { ok: false, error: 'Esta jornada la finalizó otra persona: solo puedes corregir las que finalizaste tú.' };
  if (roundDate !== today && roundDate !== yesterday) return { ok: false, error: 'Fuera del plazo: solo se corrigen las jornadas de hoy y de ayer. Pídeselo a Control.' };
  if (!opts.asignadoEnTurno) return { ok: false, error: 'Esta máquina no es tuya en ese turno.' };
  const delTurno = opts.tramosDelTurno.filter((t) => t.shift === tramo.shift);
  if (delTurno.some((t) => t.source === 'ajuste_manual')) return { ok: false, porControl: true, error: 'Corregido por Control: pídeselo a Control.' };
  if (delTurno.some((t) => t.source === 'no_trabajo_correction')) return { ok: false, porControl: true, error: 'Ese turno quedó anulado por «NO TRABAJÓ»: pídeselo a Control.' };
  return { ok: true };
}

export type Correccion =
  | { ok: true; startMs: number; endMs: number; horasNuevas: number; horasViejas: number; diferencia: number }
  | { ok: false; error: string };

/** Valida las horas nuevas del tramo. No mira permisos: eso es `puedeCorregirHoras`. */
export function validarCorreccionHoras(opts: {
  roundDate: string;
  shift: Turno;
  inicioTexto: string;
  finTexto: string;
  motivo: string;
  tramo: TramoTurno;
  /** Todos los tramos de la máquina/fecha (se filtran acá por turno y se excluye el propio). */
  tramosDelTurno: readonly TramoTurno[];
  nowMs?: number;
}): Correccion {
  const now = opts.nowMs ?? Date.now();
  const ini = String(opts.inicioTexto ?? '').trim();
  const fin = String(opts.finTexto ?? '').trim();
  const startMs = horaDelTurnoMs(opts.roundDate, opts.shift, ini);
  if (startMs == null) return { ok: false, error: `«${ini}» no es una hora de inicio válida. Escríbela como HH:MM (ej. 07:30).` };
  const endMs = horaDelTurnoMs(opts.roundDate, opts.shift, fin);
  if (endMs == null) return { ok: false, error: `«${fin}» no es una hora de fin válida. Escríbela como HH:MM (ej. 17:00).` };
  const v = ventanaTurno(opts.roundDate, opts.shift);
  const rango = opts.shift === 'night' ? '19:00 a 07:00' : '07:00 a 19:00';
  if (startMs < v.inicioMs || startMs > v.finMs) return { ok: false, error: `La hora de inicio (${ini}) está fuera del turno (${rango}).` };
  if (endMs < v.inicioMs || endMs > v.finMs) return { ok: false, error: `La hora de fin (${fin}) está fuera del turno (${rango}).` };
  if (startMs >= endMs) return { ok: false, error: `La hora de inicio (${ini}) tiene que ser antes que la de fin (${fin}).` };
  if (endMs > now + GRACIA_FUTURO_MS) return { ok: false, error: `La hora de fin (${fin}) está en el futuro. Pon la hora real.` };
  const horasNuevas = r2((endMs - startMs) / HORA_MS);
  if (horasNuevas > MAX_HORAS_TURNO) return { ok: false, error: `Son ${horasNuevas.toFixed(2)} h: el máximo de un turno es ${MAX_HORAS_TURNO} h.` };
  if (!String(opts.motivo ?? '').trim()) return { ok: false, error: 'Escribe el MOTIVO de la corrección (es obligatorio).' };
  const oldStart = new Date(opts.tramo.started_at).getTime();
  const oldEnd = new Date(opts.tramo.ended_at).getTime();
  if (startMs === oldStart && endMs === oldEnd) return { ok: false, error: 'No cambiaste ninguna hora.' };
  // Sin pisar otros tramos del turno (paradas, otro cierre…). Solo cuentan los que
  // ocupan tiempo de verdad: los ajustes/anulaciones son marcas de un instante.
  const pisa = opts.tramosDelTurno.find((t) => {
    if (t.id === opts.tramo.id || t.shift !== opts.shift) return false;
    const a = new Date(t.started_at).getTime();
    const b = new Date(t.ended_at).getTime();
    if (!(b > a) || !(Number(t.hours) > 0)) return false;
    return startMs < b && endMs > a;
  });
  if (pisa) {
    const a = new Date(pisa.started_at).getTime();
    const b = new Date(pisa.ended_at).getTime();
    return { ok: false, error: `Esas horas pisan otro tramo del turno (${hhmmCaracas(a)}–${hhmmCaracas(b)}). Ajusta para que no se crucen.` };
  }
  const horasViejas = r2(Number(opts.tramo.hours) || 0);
  return { ok: true, startMs, endMs, horasNuevas, horasViejas, diferencia: r2(horasNuevas - horasViejas) };
}

/**
 * Horas del turno en `machine_rounds` tras la corrección: lo que había MÁS la
 * diferencia, con tope 0..12. Si SUBIR lo pasaría de 12 h es un error (no se
 * recorta en silencio, para que tramo y ronda no se descuadren). Si ya estaba
 * por encima de 12 (dato viejo) y la corrección baja, baja; el tope nunca le
 * quita horas por sí solo.
 */
export function nuevasHorasRonda(actual: number, diferencia: number): { ok: true; horas: number } | { ok: false; error: string } {
  const a = Number(actual) || 0;
  const suma = r2(a + diferencia);
  if (diferencia > 0 && suma > MAX_HORAS_TURNO) {
    return { ok: false, error: `El turno quedaría con ${suma.toFixed(2)} h y el máximo es ${MAX_HORAS_TURNO} h (ya tiene ${a.toFixed(2)} h).` };
  }
  return { ok: true, horas: r2(Math.min(Math.max(MAX_HORAS_TURNO, a), Math.max(0, suma))) };
}

/** La traza que queda en el tramo: «Corregido por inspector el DD/MM HH:MM: antes HH:MM–HH:MM (X h) · motivo: …». */
export function trazaCorreccion(opts: { nowMs: number; tramo: TramoTurno; motivo: string }): string {
  const a = new Date(opts.tramo.started_at).getTime();
  const b = new Date(opts.tramo.ended_at).getTime();
  const h = r2(Number(opts.tramo.hours) || 0);
  return `Corregido por inspector el ${ddmmCaracas(opts.nowMs)} ${hhmmCaracas(opts.nowMs)}: antes ${hhmmCaracas(a)}–${hhmmCaracas(b)} (${h} h) · motivo: ${String(opts.motivo).trim()}`;
}

/** Notas nuevas del tramo: la traza se AGREGA a lo que hubiera, nunca lo reemplaza. */
export function notasConTraza(previas: string | null | undefined, traza: string): string {
  const p = String(previas ?? '').trim();
  return p ? `${p}\n${traza}` : traza;
}

// ─────────────────────────────────────────────────────────────────────────────
// 🕐 CORREGIR LA HORA DE INICIO DE UNA JORNADA QUE SIGUE ABIERTA (28-oct-2026).
//
// El inspector se equivocó al tocar «Iniciar» (puso 9:00 y era 7:30, o al revés)
// y la jornada todavía está EN CURSO. Solo se mueve `machine_rounds.jornada_start_at`
// (el inicio declarado, del que salen las horas en vivo y el FINALIZAR); no se
// inventan horas ni se crean tramos. Lo que fija:
//  · SU máquina en ESE turno (o coordina), jornada de hoy o de ayer (la noche que
//    cruza la medianoche), y la jornada tiene que seguir ABIERTA.
//  · El inicio nuevo cae DENTRO del turno de la jornada (día 7:00→19:00; noche
//    19:00→7:00 del día siguiente), nunca en el futuro y distinto del actual.
//  · Mismo ANCLAJE que el inicio normal: pasa por `calcularInicioJornada` (hoy no
//    ancla —se respeta la hora declarada— desde el 02-oct; si un día vuelve a
//    anclar, esta corrección anclará igual, sin tocar nada acá).
//  · NO PISA NADA: no puede quedar antes del FIN de otro tramo del mismo turno
//    (la jornada anterior, el tramo trabajado antes de una parada), y no puede
//    cruzar una avería/parada marcada ENTRE el inicio viejo y el nuevo — ver
//    `validarCorreccionInicioAbierta`.
//  · `jornada_marked_at` NO se mueve: es la hora REAL en que se tocó «Iniciar», y la
//    reactivación (machineLiveStatus / SupervisorScreen) la compara contra la hora de
//    la parada. Moverla haría «reactivada» una parada que no lo está (o al revés).
//  · MOTIVO OBLIGATORIO.

/** Una avería/parada marcada (`maintenance_requests`) de la máquina. */
export type MarcaAveria = { id?: string; material?: string | null; status?: string | null; created_at: string };

/** Marcas de un instante (no ocupan tiempo): Control las graba al ajustar o anular. */
const MARCAS_DE_UN_INSTANTE = ['ajuste_manual', 'no_trabajo_correction'];

/** ¿Puede corregir el inicio de ESTA jornada abierta? */
export function puedeCorregirInicioAbierta(opts: {
  /** La ronda sigue con `jornada_start_at` (jornada en curso). */
  abierta: boolean;
  /** round_date de la jornada (fecha de NEGOCIO del inicio). */
  roundDate: string;
  today: string;
  yesterday: string;
  /** ¿La máquina es suya en ese turno (o coordina)? Misma regla que `asignadoEnTurnoDe`. */
  asignadoEnTurno: boolean;
}): Permiso {
  if (!opts.abierta) return { ok: false, error: 'La jornada ya no está abierta (la finalizaron o marcaron parada). Recarga la pantalla.' };
  if (opts.roundDate !== opts.today && opts.roundDate !== opts.yesterday) return { ok: false, error: 'Esta jornada es de hace días: pídeselo a Control.' };
  if (!opts.asignadoEnTurno) return { ok: false, error: 'Esta máquina no es tuya en ese turno.' };
  return { ok: true };
}

export type CorreccionInicio =
  | { ok: true; startMs: number; anteriorMs: number; diferenciaMin: number }
  | { ok: false; error: string };

/**
 * Valida la hora de inicio nueva de una jornada ABIERTA. No mira permisos (eso es
 * `puedeCorregirInicioAbierta`). `tramosDelTurno` = los tramos YA cerrados de esa
 * máquina/fecha (se filtran acá por turno); `marcas` = averías/paradas de la máquina
 * alrededor del turno (se filtran acá por el intervalo entre los dos inicios).
 */
export function validarCorreccionInicioAbierta(opts: {
  roundDate: string;
  shift: Turno;
  /** `jornada_start_at` actual (el que se va a corregir). */
  inicioActualIso: string;
  inicioTexto: string;
  motivo: string;
  tramosDelTurno: readonly TramoTurno[];
  marcas: readonly MarcaAveria[];
  nowMs?: number;
}): CorreccionInicio {
  const now = opts.nowMs ?? Date.now();
  const txt = String(opts.inicioTexto ?? '').trim();
  const tecleado = horaDelTurnoMs(opts.roundDate, opts.shift, txt);
  if (tecleado == null) return { ok: false, error: `«${txt}» no es una hora válida. Escríbela como HH:MM (ej. 07:30).` };
  // El MISMO anclaje que el inicio normal (iniciarJornada / startJornada).
  const ini = calcularInicioJornada({ declaredIso: new Date(tecleado).toISOString(), shift: opts.shift, now: new Date(now) });
  const startMs = new Date(ini.startIso).getTime();
  const v = ventanaTurno(opts.roundDate, opts.shift);
  const rango = opts.shift === 'night' ? '19:00 a 07:00 del día siguiente' : '07:00 a 19:00';
  // Fin del turno EXCLUIDO: arrancar a las 19:00 (día) o 07:00 (noche) es 0 h, y ese
  // instante ya pertenece al turno siguiente.
  if (startMs < v.inicioMs || startMs >= v.finMs) return { ok: false, error: `La hora de inicio (${txt}) está fuera del turno de esta jornada (${rango}).` };
  // Guardia: el FINALIZAR busca la ronda por la fecha de negocio del inicio; si no
  // cayera en la MISMA ronda, la jornada quedaría abierta en una y cerrada en otra.
  if (businessRoundDateOf(new Date(startMs), opts.shift) !== opts.roundDate || ini.roundDate !== opts.roundDate) {
    return { ok: false, error: `La hora de inicio (${txt}) no pertenece a la jornada del ${opts.roundDate.split('-').reverse().join('/')}.` };
  }
  if (startMs > now + GRACIA_FUTURO_MS) return { ok: false, error: `La hora de inicio (${txt}) está en el futuro. Pon la hora real en que arrancó la máquina.` };
  const anteriorMs = new Date(opts.inicioActualIso).getTime();
  if (!isFinite(anteriorMs)) return { ok: false, error: 'No se pudo leer la hora de inicio actual. Recarga la pantalla.' };
  // Mismo MINUTO = sin cambio (el inicio del QR guarda segundos; el texto no).
  if (Math.floor(startMs / 60000) === Math.floor(anteriorMs / 60000)) return { ok: false, error: `La jornada ya empieza a las ${hhmmCaracas(anteriorMs)}: no cambiaste la hora.` };
  if (!String(opts.motivo ?? '').trim()) return { ok: false, error: 'Escribe el MOTIVO de la corrección (es obligatorio).' };
  // 1) Sin pisar tramos ya cerrados del turno: el inicio no puede quedar antes de su FIN.
  const pisa = opts.tramosDelTurno
    .filter((t) => t.shift === opts.shift && !MARCAS_DE_UN_INSTANTE.includes(t.source))
    .map((t) => ({ a: new Date(t.started_at).getTime(), b: new Date(t.ended_at).getTime() }))
    .filter((x) => isFinite(x.b) && startMs < x.b)
    .sort((x, y) => y.b - x.b)[0];
  if (pisa) {
    // «Antes de las…» al minuto SIGUIENTE si el tramo cerró con segundos (10:00:30 → 10:01).
    const desde = Math.ceil(pisa.b / 60000) * 60000;
    return { ok: false, error: `La jornada no puede empezar antes de las ${hhmmCaracas(desde)}: ahí terminó otro tramo de este turno (${hhmmCaracas(pisa.a)}–${hhmmCaracas(pisa.b)}).` };
  }
  // 2) Sin cruzar una avería/parada marcada ENTRE el inicio viejo y el nuevo
  //    [menor, mayor):
  //    · HACIA ATRÁS, ninguna (pendiente o ya resuelta): la jornada «trabajaría»
  //      encima de la parada, y el FINALIZAR —que resuelve las paradas creadas desde
  //      el inicio— resolvería una que se marcó ANTES de que arrancara.
  //    · HACIA ADELANTE, ninguna PENDIENTE: el FINALIZAR dejaría de resolver una que
  //      hoy sí resuelve. Una ya resuelta no cambia nada (correr el inicio solo quita
  //      horas que no se trabajaron), p. ej. la parada que cerró la jornada anterior.
  const atras = startMs < anteriorMs;
  const lo = Math.min(startMs, anteriorMs);
  const hi = Math.max(startMs, anteriorMs);
  const pendiente = (m: MarcaAveria) => m.status == null || m.status === 'pendiente';
  const cruza = opts.marcas
    .filter((m) => atras || pendiente(m))
    .map((m) => ({ m, t: new Date(m.created_at).getTime() }))
    .filter((x) => isFinite(x.t) && x.t >= lo && x.t < hi)
    .sort((x, y) => x.t - y.t)[0];
  if (cruza) {
    const que = cruza.m.material === 'MÁQUINA PARADA' ? 'una parada' : 'una avería';
    return { ok: false, error: `A las ${hhmmCaracas(cruza.t)} se marcó ${que} en esta máquina, entre la hora actual (${hhmmCaracas(anteriorMs)}) y la nueva (${hhmmCaracas(startMs)}). No se puede mover el inicio por encima de ella: pídeselo a Control.` };
  }
  return { ok: true, startMs, anteriorMs, diferenciaMin: Math.round((startMs - anteriorMs) / 60000) };
}

/** Traza en las notas de la ronda: «Inicio de jornada corregido por inspector el DD/MM HH:MM: HH:MM → HH:MM · motivo: …». */
export function trazaInicioAbierta(opts: { nowMs: number; anteriorMs: number; nuevoMs: number; motivo: string }): string {
  return `Inicio de jornada corregido por inspector el ${ddmmCaracas(opts.nowMs)} ${hhmmCaracas(opts.nowMs)}: ${hhmmCaracas(opts.anteriorMs)} → ${hhmmCaracas(opts.nuevoMs)} · motivo: ${String(opts.motivo).trim()}`;
}
