// ============================================================================
// EL RELOJ DEL TELÉFONO, CONTRASTADO CONTRA EL DEL SERVIDOR (02-sep-2026)
//
// Un viaje se sella con `new Date()` — la hora DEL TELÉFONO. Y esa hora decide
// dos cosas que después nadie puede corregir a ojo:
//
//   · a qué JORNADA pertenece (el día va de 7am a 7am), y
//   · a qué TURNO (el turno se deduce de la hora, no de lo que se eligió).
//
// Un teléfono con el reloj corrido media hora manda los viajes de las 6:45am a
// la jornada anterior, y los de las 6:45pm al turno de día. No revienta nada:
// simplemente aparecen en el día equivocado, y el listero jura que los registró.
//
// ⚠️ NO SE PUEDE SIMPLEMENTE USAR LA HORA DEL SERVIDOR. El registro sin conexión
//    es la razón de ser de la cola offline: en el patio hay señal sin internet a
//    cada rato, y ahí el único reloj que existe es el del teléfono. Por eso esto
//    NO reemplaza la hora — solo AVISA, para que la persona la corrija.
//
// Todo acá es PURO (sin red, sin Supabase): quien llama trae la hora del
// servidor como pueda y esto solo compara. Probado en
// `scripts/test-reloj-desfase.mjs`.
// ============================================================================

/**
 * Cuánto se le tolera al teléfono antes de avisar, en minutos.
 *
 * Tres es a propósito: por debajo, el aviso saldría por el desfase normal de un
 * teléfono que nadie sincroniza —y un aviso que sale siempre no lo lee nadie—.
 * Por encima, ya se puede cruzar un corte de turno y mandar el viaje al lado
 * equivocado sin que se note.
 */
export const DESFASE_TOLERADO_MIN = 3;

/**
 * Minutos de diferencia entre el teléfono y el servidor.
 * Positivo = el teléfono va ADELANTADO. Negativo = ATRASADO.
 *
 * Devuelve `null` cuando no se puede saber (sin hora del servidor, o ilegible):
 * no saber NO es lo mismo que estar bien, y quien llama tiene que poder
 * distinguirlo para no dar por buena una hora que nunca se comprobó.
 */
export function desfaseMinutos(servidorISO?: string | null, telefonoMs?: number): number | null {
  const s = Date.parse(String(servidorISO ?? ''));
  if (!isFinite(s)) return null;
  const t = typeof telefonoMs === 'number' && isFinite(telefonoMs) ? telefonoMs : Date.now();
  return Math.round((t - s) / 60000);
}

/** ¿Este desfase amerita avisar? `null` (no se pudo medir) NO amerita: no se
 *  alarma a nadie por algo que no se comprobó. */
export function relojDesfasado(min: number | null, tolerado: number = DESFASE_TOLERADO_MIN): boolean {
  return min !== null && Math.abs(min) > tolerado;
}

/**
 * El aviso, escrito para quien lo va a leer en el patio: qué pasa, por qué
 * importa y qué hacer. `null` si no hay nada que decir.
 *
 * No dice «desfase de -47 minutos», que no significa nada para nadie: dice si
 * va adelantado o atrasado y cuánto, en palabras.
 */
export function avisoDesfase(min: number | null, tolerado: number = DESFASE_TOLERADO_MIN): string | null {
  if (!relojDesfasado(min, tolerado)) return null;
  const m = Math.abs(min as number);
  const cuanto = m >= 120 ? `${Math.round(m / 60)} horas`
    : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min`
    : `${m} minuto${m === 1 ? '' : 's'}`;
  const lado = (min as number) > 0 ? 'ADELANTADO' : 'ATRASADO';
  return `⏰ La hora de este teléfono está ${lado} ${cuanto} respecto al sistema. `
    + 'Los viajes se guardan con la hora del teléfono, así que pueden caer en el día o el turno equivocado. '
    + 'Ajusta la hora del teléfono (mejor en automático) antes de seguir registrando.';
}
