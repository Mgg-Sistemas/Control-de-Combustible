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
 *  - Falta de señal, sesión vencida, timeout o 5xx → REINTENTAR, siempre. NUNCA
 *    cuenta para la cuarentena: no es culpa del ítem y se resuelve sola al volver
 *    la conexión o al volver a entrar. Un listero que pasa el día entero sin
 *    cobertura no puede perder sus viajes por eso (ver `esErrorTransitorio`).
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

/**
 * Mensajes típicos de fallo de RED (no de validación) al llamar a Supabase.
 *
 * Cada navegador y cada versión de Android dice lo suyo, y la lista se quedó
 * corta: eran cuatro cadenas y dejaban fuera el mensaje de Firefox de Android
 * ("NetworkError when attempting to fetch resource"), el de WebKit ("The
 * Internet connection appears to be offline") y el aborto del propio fetch.
 * Un fallo de red que no se reconoce se trata como si fuera culpa del dato.
 */
export function esErrorDeRed(msg?: string | null): boolean {
  if (!msg) return false;
  const m = String(msg).toLowerCase();
  return m.includes('failed to fetch')
    || m.includes('network request failed')
    || m.includes('fetch failed')
    || m.includes('load failed')
    || m.includes('networkerror')
    || m.includes('connection appears to be offline')
    || m.includes('network is unreachable')
    || m.includes('err_internet_disconnected')
    || m.includes('err_network')
    || m.includes('econnreset')
    || m.includes('econnrefused')
    || m.includes('etimedout')
    || m.includes('aborterror')
    || m.includes('the operation was aborted')
    || m.includes('signal is aborted');
}

/**
 * ¿El fallo es AJENO al dato del viaje?
 *
 * Distinta de `esErrorDeRed`, y la diferencia importa: aparta o no aparta un
 * viaje de trabajo real. Un fallo transitorio NO cuenta para la cuarentena
 * porque el mismo viaje, sin tocarle una coma, va a entrar bien en el próximo
 * intento. Aquí entran tres familias además de la red:
 *
 *  - **Sesión** (JWT vencido, RLS). Es EL caso que se comía los viajes: con la
 *    app parada en la pantalla de entrar, cada intento choca con RLS y con
 *    `MAX_INTENTOS_COLA = 3` cada 30 s la cola ENTERA se iba a cuarentena en
 *    minuto y medio. Vuelve a entrar y suben solos.
 *  - **Timeout / aborto.** El servidor tardó, no es que el viaje esté malo.
 *  - **5xx de puerta de enlace.** El portal cautivo del patio devuelve HTML y
 *    revienta el parse con un mensaje que no se parece a nada.
 *
 * Se buscan frases explicitas, NUNCA el numero suelto: un "500" pelado matchea
 * el codigo de un camion.
 */
export function esErrorTransitorio(msg?: string | null): boolean {
  if (!msg) return false;
  if (esErrorDeRed(msg)) return true;
  const m = String(msg).toLowerCase();
  return m.includes('jwt')
    || m.includes('row-level security')
    || m.includes('row level security')
    || m.includes('timeout')
    || m.includes('timed out')
    || m.includes('statement canceled')
    || m.includes('internal server error')
    || m.includes('bad gateway')
    || m.includes('service unavailable')
    || m.includes('gateway time');
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
  // Transitorio, no solo "de red": ver `esErrorTransitorio`. Con la comprobación
  // vieja, una sesión vencida o un 502 del portal cautivo apartaban viajes
  // buenos en ~90 segundos.
  if (esErrorTransitorio(x.error)) return 'reintentar';
  return (Number(x.intentos) || 0) + 1 >= MAX_INTENTOS_COLA ? 'cuarentena' : 'reintentar';
}

/**
 * ¿Qué se hace con un viaje cuyo intento CON SEÑAL acaba de fallar?
 *
 * Regla: SE ENCOLA SIEMPRE, salvo que el error diga que la fila ya está en el
 * servidor. Un viaje en cuarentena es visible y recuperable; un viaje descartado
 * por un toast que se va a los 3 segundos no existió nunca.
 *
 * A propósito NO se distingue «error de red» de «error del servidor». Un wifi
 * sin internet, un portal cautivo, un JWT vencido, un 500 y un timeout llegan
 * con mensajes distintos e inestables, y acertar en esa clasificación NO es
 * requisito para no perder el dato: encolar de más cuesta unos reintentos,
 * encolar de menos cuesta un viaje de trabajo real. Por eso NO se reutiliza
 * `esErrorDeRed` acá — reconoce cuatro cadenas y deja fuera JWT, timeout y 500.
 *
 * Y sí, hasta un error de datos se encola: si el camión se borró del catálogo,
 * el viaje OCURRIÓ igual; que el admin lo restaure y el listero le dé a
 * reintentar es mejor que tirar el trabajo del día.
 *
 * ⚠️ PRECONDICIÓN: quien llame tiene que haber mandado el MISMO
 * `clientActionId` en el intento con señal que va a mandar el reintento. Sin
 * eso, encolar tras un fallo duplica el viaje cuando el insert sí entró y se
 * perdió la respuesta.
 */
export function accionTrasFalloConSenal(error?: string | null): 'ya_estaba' | 'encolar' {
  return esErrorDuplicado(error) ? 'ya_estaba' : 'encolar';
}

/**
 * El motivo del fallo, en castellano y accionable.
 *
 * Antes al listero se le mostraba el mensaje crudo de Postgres en inglés
 * (`violates foreign key constraint "camion_viajes_machinery_id_fkey"`), que en
 * el campo no le dice a nadie qué hacer.
 */
export function motivoLegible(msg?: string | null): string {
  const m = String(msg ?? '').toLowerCase();
  if (!m) return 'error desconocido';
  if (esErrorDeRed(m)) return 'sin conexión con el servidor';
  if (m.includes('foreign key')) return 'ese camión ya no está en el catálogo';
  if (m.includes('cv_fuera_catalogo_coherente')) return 'el viaje quedó a medias entre camión del catálogo y anotado a mano';
  // Nada de buscar '401' suelto: un código de camión con esos dígitos daba el
  // consejo de cerrar sesión sin motivo.
  if (m.includes('row-level security') || m.includes('jwt')) return 'tu sesión venció, vuelve a entrar';
  if (m.includes('schema cache') || m.includes('does not exist')) return 'falta configurar la tabla de viajes en la base de datos';
  if (m.includes('timeout')) return 'el servidor tardó demasiado en responder';
  return String(msg);
}
