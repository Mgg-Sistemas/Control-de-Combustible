/*
 * EL TURNO DE UN VIAJE: jornada de DÍA (7am–7pm) o de NOCHE (7pm–7am).
 *
 * Es la otra mitad de la regla de negocio que ya usa el filtro de fechas: el
 * "día" va de las 7am a las 7am, y adentro caben dos turnos. Ver
 * `jornadaWindowISO` y `jornadaDeFecha` en src/lib/caracasDay.ts.
 *
 * ⭐ POR QUÉ EL TURNO SE DEDUCE DE LA HORA Y NO SE LEE DE LA COLUMNA `shift`
 * ---------------------------------------------------------------------------
 * `camion_viajes.shift` existe y se llena al registrar, pero NO sirve como
 * fuente de verdad para mirar hacia atrás, por tres razones concretas:
 *
 *   1. Es NULLABLE (`supabase/viajes_camiones.sql:22`). Los viajes viejos, de
 *      antes de que existiera la columna, la tienen en null: quedarían en un
 *      limbo "sin turno" que no le sirve a nadie.
 *   2. `editarViaje` cambia `registered_at` pero NO toca `shift`. Corregir
 *      un viaje de las 6:50pm a las 7:10pm lo deja marcado como de DÍA para
 *      siempre, aunque su hora ya diga noche.
 *   3. Al registrar, la app guarda `caracasNowShift()`, que es EXACTAMENTE este
 *      mismo cálculo sobre la hora. O sea que para todo viaje sano los dos
 *      valores coinciden: deducirlo no cambia ningún número, solo lo blinda.
 *
 * Se conserva `desacuerdoDeTurno` para no esconder el caso raro: si lo guardado
 * y la hora no coinciden, la pantalla lo puede decir en vez de tapar la
 * diferencia.
 */
import { caracasPartsOf } from './caracasDay';

export type Turno = 'day' | 'night';

/**
 * ¿A qué turno pertenece un instante? Mismo corte que `caracasNowShift()`
 * (src/lib/caracasDay.ts:21) pero para una fecha cualquiera, no para "ahora".
 * Día 7:00–18:59 · noche 19:00–6:59.
 */
export function turnoDeInstante(d: Date): Turno {
  const { hour } = caracasPartsOf(d);
  return hour >= 7 && hour < 19 ? 'day' : 'night';
}

/** El turno de un viaje, deducido de cuándo se registró. */
export function turnoDeViaje(registeredAtISO: string): Turno {
  return turnoDeInstante(new Date(registeredAtISO));
}

/**
 * ¿Lo que dice la columna `shift` contradice a la hora? Solo pasa con viajes
 * a los que se les corrigió la hora cruzando las 7am o las 7pm. Un `shift`
 * nulo (viaje viejo) NO es un desacuerdo: es una ausencia.
 */
export function desacuerdoDeTurno(shiftGuardado: Turno | null | undefined, registeredAtISO: string): boolean {
  return !!shiftGuardado && shiftGuardado !== turnoDeViaje(registeredAtISO);
}

// ── Cómo se escribe, en un solo lugar ───────────────────────────────────────
// Los mismos íconos que usa la fila de un viaje en la pantalla desde siempre.
export const TURNO_ICONO: Record<Turno, string> = { day: '☀️', night: '🌙' };
export const TURNO_NOMBRE: Record<Turno, string> = { day: 'Día', night: 'Noche' };
export const TURNO_HORARIO: Record<Turno, string> = { day: '7am–7pm', night: '7pm–7am' };

/** «☀️ Día» / «🌙 Noche». */
export function turnoLabel(t: Turno): string {
  return `${TURNO_ICONO[t]} ${TURNO_NOMBRE[t]}`;
}

/** «☀️ Día (7am–7pm)» — para donde hace falta recordar el horario. */
export function turnoLabelConHorario(t: Turno): string {
  return `${turnoLabel(t)} (${TURNO_HORARIO[t]})`;
}

/** «☀️ Día 7am–7pm · 🌙 Noche 7pm–7am», la leyenda completa de los dos turnos. */
export function leyendaTurnos(): string {
  return `${TURNO_ICONO.day} ${TURNO_NOMBRE.day} ${TURNO_HORARIO.day} · ${TURNO_ICONO.night} ${TURNO_NOMBRE.night} ${TURNO_HORARIO.night}`;
}

// ── Contar ──────────────────────────────────────────────────────────────────
export type ConteoTurno = { dia: number; noche: number; total: number };

/**
 * ⚠️ ESTRICTO: lo que no sea exactamente 'day' o 'night' no cuenta para ninguno
 * de los dos. La versión perezosa (`if night … else dia++`) contaba como DÍA
 * cualquier cosa —incluido un `null`—, que es justo lo contrario de la regla que
 * sigue `resumirViajes` («no se le inventa a ninguno de los dos»). Hoy no se
 * nota porque el único llamador le pasa `turnoDeViaje`, que nunca devuelve null;
 * pero el día que alguien lo alimente desde la columna `shift`, que sí es
 * nullable, todos los viajes viejos habrían salido diurnos.
 */
export function contarTurnos(turnos: Iterable<Turno>): ConteoTurno {
  let dia = 0, noche = 0;
  for (const t of turnos) {
    if (t === 'day') dia++;
    else if (t === 'night') noche++;
  }
  return { dia, noche, total: dia + noche };
}

/** «☀️ 12 · 🌙 8». Si todo cayó en un solo turno, no se imprime el otro en 0:
 *  un «🌙 0» al lado de cada camión diurno es ruido en cada renglón. */
export function resumenTurno(c: ConteoTurno): string {
  if (c.total === 0) return '—';
  const partes: string[] = [];
  if (c.dia > 0) partes.push(`${TURNO_ICONO.day} ${c.dia}`);
  if (c.noche > 0) partes.push(`${TURNO_ICONO.night} ${c.noche}`);
  return partes.join(' · ');
}

/**
 * En qué turno trabaja un camión, para poder decirlo de un vistazo.
 *
 * «mixto» no es un empate: es que trabajó de verdad en los dos. Un camión con
 * 30 viajes de día y 1 de noche NO es un camión mixto —es uno de día al que se
 * le coló un viaje—, así que hace falta que el turno menor pese al menos un
 * 20% para llamarlo mixto. Sin ese umbral, casi toda la flota saldría «mixto»
 * y la columna no diría nada.
 */
export type PerfilTurno = 'dia' | 'noche' | 'mixto' | 'ninguno';
export const UMBRAL_MIXTO = 0.2;

export function perfilDeTurno(c: ConteoTurno): PerfilTurno {
  if (c.total === 0) return 'ninguno';
  const menor = Math.min(c.dia, c.noche);
  if (menor / c.total >= UMBRAL_MIXTO) return 'mixto';
  return c.dia >= c.noche ? 'dia' : 'noche';
}

export const PERFIL_LABEL: Record<PerfilTurno, string> = {
  dia: '☀️ Trabaja de día',
  noche: '🌙 Trabaja de noche',
  mixto: '☀️🌙 Día y noche',
  ninguno: 'Sin viajes',
};

/** Versión corta para una fila apretada: «☀️ día», «🌙 noche», «☀️🌙 mixto». */
export const PERFIL_CORTO: Record<PerfilTurno, string> = {
  dia: '☀️ día',
  noche: '🌙 noche',
  mixto: '☀️🌙 mixto',
  ninguno: '—',
};
