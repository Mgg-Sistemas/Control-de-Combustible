/**
 * POLÍTICA ÚNICA de las colas offline (viajes de listeros, acciones del inspector).
 *
 * Responde UNA sola pregunta: un ítem de la cola acaba de fallar al subirse,
 * ¿qué se hace con él? Es la fuente de verdad compartida — igual que
 * `clasificarEstadoTurno` para los estados de máquina — para que las colas no
 * vuelvan a divergir cada vez que se ajuste una regla.
 *
 * Por qué existe (15-ago-2026): las dos colas cortaban el bucle en el PRIMER
 * ítem que fallara, fuera cual fuera el motivo, y lo dejaban a la cabeza. Un
 * error que nunca se va a resolver solo (camión borrado, dato inválido, clave
 * foránea rota) dejaba atascados detrás de él TODOS los viajes/acciones
 * registrados después, indefinidamente y en silencio: el teléfono solo mostraba
 * el contador subiendo. Riesgo real de perder días de trabajo de campo.
 *
 * Reglas:
 *  - Sin error, o clave duplicada → ÉXITO. El duplicado significa que el insert
 *    ya se aplicó en el servidor y se perdió la respuesta (ver `client_action_id`
 *    y el índice único `uq_camion_viajes_client_action`): reintentar no debe
 *    duplicar la fila, así que cuenta como subido.
 *  - Falta de señal → REINTENTAR, siempre. NUNCA cuenta para la cuarentena: no
 *    es culpa del ítem y se resolverá sola al volver la conexión. Un listero que
 *    pasa el día entero sin cobertura no puede perder sus viajes por eso.
 *  - Cualquier otro error → REINTENTAR hasta `MAX_INTENTOS_COLA` y después
 *    CUARENTENA: el ítem se aparta a un lado, la cola sigue con los demás y la
 *    pantalla lo muestra en rojo con el motivo para que alguien lo resuelva.
 *    Nunca se descarta solo — los datos de campo no se tiran a la basura.
 *
 * Blindada por `scripts/test-cola-offline.mjs` (`npm run test:cola-offline`).
 */

/** Qué hacer con un ítem de la cola tras un intento de subida. */
export type AccionCola = 'exito' | 'reintentar' | 'cuarentena';

/**
 * Cuántos fallos NO de red aguanta un ítem antes de apartarse a cuarentena.
 * 3 con el reintento cada 30 s = ~90 s atascado como mucho, suficiente para
 * absorber un error transitorio del servidor (un 500 puntual, un timeout) sin
 * apartar un ítem que sí iba a subir bien.
 */
export const MAX_INTENTOS_COLA = 3;

/** Mensajes típicos de fallo de RED (no de validación) al llamar a Supabase. */
export function esErrorDeRed(msg?: string | null): boolean {
  if (!msg) return false;
  const m = String(msg).toLowerCase();
  return m.includes('failed to fetch')
    || m.includes('network request failed')
    || m.includes('fetch failed')
    || m.includes('load failed');
}

/**
 * Violación de clave única (Postgres 23505). En un replay significa que la fila
 * YA se insertó en el servidor y la respuesta se perdió tras el commit: se trata
 * como éxito para no duplicarla.
 */
export function esErrorDuplicado(msg?: string | null): boolean {
  if (!msg) return false;
  const m = String(msg).toLowerCase();
  return m.includes('duplicate key') || m.includes('23505');
}

/**
 * Decisión única.
 * @param intentos fallos NO de red que ESTE ítem ya acumulaba ANTES de este
 *   intento (el actual se cuenta acá dentro).
 */
export function decidirAccionCola(x: { error?: string | null; intentos: number }): AccionCola {
  if (!x.error) return 'exito';
  if (esErrorDuplicado(x.error)) return 'exito';
  if (esErrorDeRed(x.error)) return 'reintentar';
  return (Number(x.intentos) || 0) + 1 >= MAX_INTENTOS_COLA ? 'cuarentena' : 'reintentar';
}
