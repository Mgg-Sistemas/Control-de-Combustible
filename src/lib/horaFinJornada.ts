// 🕐 LA HORA EN QUE FINALIZÓ LA JORNADA (20-oct-2026, a pedido, urgente).
//
// Pedido textual: «necesito que los inspectores puedan colocar la hora en la que
// finalizó la jornada, por si finalizó antes». El caso real del mismo día: la
// máquina paró a las 5pm, nadie la cerró a tiempo, y el barredor de las 7pm le
// bancó hasta el fin del turno — dos horas que no trabajó. Con la hora declarada,
// el inspector cierra a las 6:30 diciendo «finalizó 17:00» y las horas salen de
// AHÍ.
//
// REGLA PURA (sin React ni Supabase), porque de este número salen las horas que
// se PAGAN. Lo que fija:
//  · VACÍO = AHORA. Quien no toca el campo cierra exactamente como siempre.
//  · LA HORA ES DE CARACAS (UTC-4 fijo, como todo el sistema) y se interpreta
//    sobre el día de HOY; si da en el futuro, se prueba 24 h atrás (una jornada
//    de NOCHE cerrada a la 1am declarando «23:45» pertenece a ayer).
//  · NUNCA EN EL FUTURO y NUNCA ANTES DEL INICIO de la jornada: las dos cosas
//    producirían horas inventadas (negativas o por venir).
//  · EL CIERRE EFECTIVO SIGUE TOPADO AL FIN NOMINAL del turno (día 7pm / noche
//    7am) — declarar «21:00» no regala 2 horas, igual que cerrar tarde de
//    siempre (regla del 26-sep-2026).
//  · ANTICIPADO se decide con la hora DECLARADA, no con el reloj: cerrar a las
//    7:05pm declarando «17:00» ES un cierre anticipado y exige su motivo.
import { caracasParts } from './jornada';

export type FinResuelto =
  | {
      ok: true;
      /** El fin DECLARADO (o «ahora» si no escribieron nada), en ms epoch. */
      finMs: number;
      /** El fin EFECTIVO con el tope nominal aplicado: lo que banca horas. */
      efectivoMs: number;
      /** ¿Quedó antes del fin nominal del turno? (exige motivo) */
      anticipado: boolean;
      /** ¿Escribieron una hora (true) o se usó «ahora» (false)? */
      declarado: boolean;
    }
  | { ok: false; error: string };

/** 'HH:MM' en 24 h (acepta '7:30' y '07:30'). NaN si no es una hora. */
export function parseHHMM(texto: string): { h: number; m: number } | null {
  const m = String(texto ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

const fmtHHMM = (ms: number): string => {
  const p = caracasParts(new Date(ms));
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};

/**
 * Resuelve el fin de la jornada a partir de lo escrito (o de «ahora» si viene
 * vacío), con todas las reglas de arriba. `nowMs` inyectable para probarlo.
 */
export function resolverFinJornada(opts: {
  startMs: number;
  nominalEndMs: number;
  texto?: string | null;
  nowMs?: number;
}): FinResuelto {
  const now = opts.nowMs ?? Date.now();
  const texto = String(opts.texto ?? '').trim();

  let finMs = now;
  let declarado = false;
  if (texto) {
    const hhmm = parseHHMM(texto);
    if (!hhmm) return { ok: false, error: `«${texto}» no es una hora válida. Escríbela como HH:MM (ej. 17:30).` };
    // La hora declarada vive en el día (Caracas) de ESTE momento; si cae en el
    // futuro, era de ayer (noche que cruzó la medianoche). 60 s de gracia para
    // que «ahora mismo» tecleado a mano no rebote por segundos.
    const hoyIso = caracasParts(new Date(now)).iso;
    let cand = new Date(`${hoyIso}T${String(hhmm.h).padStart(2, '0')}:${String(hhmm.m).padStart(2, '0')}:00-04:00`).getTime();
    if (cand > now + 60000) {
      // Solo vale restarle un día si ASÍ cae dentro de la jornada (la noche que
      // cruzó la medianoche); si no, es sencillamente una hora que no ha llegado.
      const ayer = cand - 86400000;
      if (ayer >= opts.startMs) cand = ayer;
      else return { ok: false, error: `La hora de fin (${texto}) está en el futuro. Pon la hora real en que finalizó.` };
    }
    if (cand < opts.startMs) {
      return { ok: false, error: `La hora de fin (${texto}) es anterior al inicio de la jornada (${fmtHHMM(opts.startMs)}).` };
    }
    finMs = cand;
    declarado = true;
  }

  // Permitir que la máquina trabaje más de 12 horas (hasta el tope físico de 24h desde el inicio).
  const maxPhysicalEndMs = opts.startMs + 24 * 3600000;
  const efectivoMs = Math.min(finMs, maxPhysicalEndMs);
  return { ok: true, finMs, efectivoMs, anticipado: finMs < opts.nominalEndMs, declarado };
}
