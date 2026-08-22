// Cola de acciones offline para el registro de VIAJES de camiones (listeros en
// campo). A propósito SEPARADA de `src/lib/offlineQueue.ts` (esa está scoped a
// la pantalla del Supervisor/Inspector) — esta cubre únicamente `registrarViaje`,
// la única acción que un listero necesita poder diferir sin señal. Mismo patrón:
// AsyncStorage FIFO + client_action_id estable para idempotencia contra el
// índice único de la tabla (ver `uq_camion_viajes_client_action` en
// `supabase/viajes_camiones.sql`).
//
// CUARENTENA (15-ago-2026): un ítem que falla por algo que NO es falta de señal
// (camión borrado, clave foránea rota, dato inválido) ya no bloquea la cola. Se
// reintenta `MAX_INTENTOS_COLA` veces y luego se aparta a una lista de
// cuarentena; la cola SIGUE con los viajes de atrás. Nada se descarta solo: la
// pantalla muestra los apartados en rojo con el motivo, con botón para
// reintentar una vez resuelta la causa. Ver `src/lib/colaOfflinePolicy.ts`.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registrarViaje } from './camionViajes';
// Decisión ÚNICA compartida de qué hacer con un ítem que falló (éxito /
// reintentar / cuarentena). No se reimplementa acá — ver el archivo para el
// porqué de cada regla.
import { decidirAccionCola, esErrorDeRed, MAX_INTENTOS_COLA } from './colaOfflinePolicy';
// Utilidades genéricas de conectividad reutilizadas tal cual — ya no son
// específicas de la pantalla del Supervisor, ver `src/lib/offlineQueue.ts`.
// Se re-exportan para que quien use esta cola no tenga que importar de dos
// archivos distintos.
export { isOnline, onConnectivityChange } from './offlineQueue';
export { MAX_INTENTOS_COLA } from './colaOfflinePolicy';

const STORAGE_KEY = 'viajes_offline_queue_v1';
const QUARANTINE_KEY = 'viajes_offline_quarantine_v1';

export type QueuedViaje = {
  id: string;
  createdAt: string;
  payload: Omit<Parameters<typeof registrarViaje>[0], 'clientActionId'>;
  /** Fallos NO de red acumulados. Al llegar a `MAX_INTENTOS_COLA` → cuarentena. */
  intentos?: number;
};

/** Viaje apartado: no pudo subirse y necesita que alguien resuelva la causa. */
export type QuarantinedViaje = {
  id: string;
  createdAt: string;
  payload: QueuedViaje['payload'];
  /** Último mensaje de error del servidor — es lo que se le muestra al usuario. */
  error: string;
  /** Cuándo se apartó. */
  failedAt: string;
  intentos: number;
};

type Listener = (items: QueuedViaje[]) => void;
type QuarantineListener = (items: QuarantinedViaje[]) => void;
const listeners = new Set<Listener>();
const quarantineListeners = new Set<QuarantineListener>();
let cache: QueuedViaje[] | null = null;
let quarantineCache: QuarantinedViaje[] | null = null;

/**
 * TODAS las lecturas-modificaciones-escrituras de la cola pasan por acá, en fila
 * india.
 *
 * Sin esto hay una carrera que BORRA VIAJES: `enqueueViaje` lee la cola, y si
 * entre esa lectura y su escritura corre el `writeAll` final del flush (o el de
 * otra pestaña del navegador), uno pisa al otro y el viaje desaparece del disco
 * para siempre. El guard `flushing` no sirve: impide dos flushes a la vez, no
 * que alguien encole durante uno. Está fijado en `scripts/test-cola-offline.mjs`.
 */
let cadena: Promise<unknown> = Promise.resolve();
//
// ⚠️⚠️ REGLA AL TOCAR ESTE ARCHIVO: NUNCA hagas `await enSerie(...)` —ni llames
//    a `enqueueViaje`, `flushViajesQueue` o `retryQuarantinedViajes`— DESDE
//    DENTRO de un bloque `enSerie`. Esperarías una cadena que se incluye a sí
//    misma y la cola quedaría congelada para el resto de la sesión, en
//    silencio. Llamarlas desde otra tarea (un toque del usuario, un temporizador)
//    sí es correcto: se ponen en la fila y esperan su turno.
//    No hay guard en tiempo de ejecución porque un flag global no puede
//    distinguir la reentrada real del toque legítimo que cae en medio.
function enSerie<T>(fn: () => Promise<T>): Promise<T> {
  const proximo = cadena.then(fn, fn);
  // La cadena nunca se rompe por un fallo: si un paso revienta, el siguiente
  // igual tiene que correr, o la cola se congela para el resto de la sesión.
  cadena = proximo.then(() => undefined, () => undefined);
  return proximo;
}

/** Si el almacenamiento del teléfono está fallando, hay que decirlo, no ocultarlo. */
let ultimoFalloDeGuardado: string | null = null;
/** Solo para el fallo de ESCRITURA. Un fallo de LECTURA no debe hacer que la
 *  memoria le gane al disco para siempre: eso anularía la defensa contra las
 *  dos pestañas del navegador. */
let escrituraFallida = false;
export function falloDeGuardadoLocal(): string | null { return ultimoFalloDeGuardado; }

async function readAll(): Promise<QueuedViaje[]> {
  // ⚠️ EXCEPCIÓN, y es importante: si la última escritura FALLÓ, el disco está
  // ATRASADO respecto a lo que el listero ya registró. Devolver el disco
  // borraría esos viajes de la memoria y no se subirían nunca — el `cache` es
  // lo único que los tiene. Se prefiere la memoria hasta que una escritura
  // vuelva a funcionar, que es lo que hacía la versión vieja de esta función y
  // se había perdido al pasar a leer siempre del disco.
  if (escrituraFallida && cache) return cache;
  // Fuera de ese caso SIEMPRE se lee del almacenamiento, nunca del `cache`. En web el sistema
  // corre en el navegador y el listero puede tener DOS PESTAÑAS abiertas: cada
  // una tendría su propio `cache` en memoria, y la que escribiera de último
  // borraría lo que encoló la otra. El `cache` queda solo como última foto
  // conocida para cuando el almacenamiento falla.
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? (parsed as QueuedViaje[]) : [];
  } catch (e: any) {
    // El JSON se corrompió o el almacenamiento no responde. NO se devuelve una
    // cola vacía como si no hubiera nada: eso hacía que un carácter roto
    // borrara la cola entera en silencio. Se conserva el texto crudo aparte
    // para poder rescatarlo a mano, y se sigue con la última foto en memoria.
    ultimoFalloDeGuardado = `No se pudo leer la cola guardada: ${e?.message ?? e}`;
    console.warn('[viajesOfflineQueue] cola ilegible, se preserva el crudo:', e);
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) await AsyncStorage.setItem(`${STORAGE_KEY}_corrupto_${Date.now()}`, raw);
    } catch { /* si tampoco se puede preservar, ya no hay más que hacer */ }
    cache = cache ?? [];
  }
  return cache;
}

async function writeAll(items: QueuedViaje[]): Promise<void> {
  cache = items;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    escrituraFallida = false;
    ultimoFalloDeGuardado = null;
  } catch (e: any) {
    // Antes esto era `catch { /* best-effort */ }`: la cola quedaba SOLO en
    // memoria y se perdía al cerrar la app, sin que nadie se enterara. Ahora
    // revienta hacia arriba para que quien encoló pueda avisarle al listero que
    // su viaje NO quedó guardado.
    escrituraFallida = true;
    ultimoFalloDeGuardado = `No se pudo guardar en el teléfono: ${e?.message ?? e}`;
    listeners.forEach((l) => l(items));
    throw new Error(ultimoFalloDeGuardado);
  }
  listeners.forEach((l) => l(items));
}

// Misma disciplina que la cola: leer siempre del disco (dos pestañas) y no
// tragarse un fallo de escritura. La cuarentena guarda viajes que YA no están
// en la cola, así que perderla es perder el trabajo del listero definitivamente.
async function readQuarantine(): Promise<QuarantinedViaje[]> {
  try {
    const raw = await AsyncStorage.getItem(QUARANTINE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    quarantineCache = Array.isArray(parsed) ? (parsed as QuarantinedViaje[]) : [];
  } catch (e: any) {
    ultimoFalloDeGuardado = `No se pudo leer los viajes apartados: ${e?.message ?? e}`;
    console.warn('[viajesOfflineQueue] cuarentena ilegible:', e);
    quarantineCache = quarantineCache ?? [];
  }
  return quarantineCache;
}

async function writeQuarantine(items: QuarantinedViaje[]): Promise<void> {
  quarantineCache = items;
  try {
    await AsyncStorage.setItem(QUARANTINE_KEY, JSON.stringify(items));
  } catch (e: any) {
    ultimoFalloDeGuardado = `No se pudo guardar los viajes apartados: ${e?.message ?? e}`;
    console.warn('[viajesOfflineQueue] no se pudo guardar la cuarentena:', e);
  }
  quarantineListeners.forEach((l) => l(items));
}

/** Suscribe a cambios en la cola (para el contador/insignia en la UI). Devuelve función para des-suscribir. */
export function subscribeViajesQueue(cb: Listener): () => void {
  listeners.add(cb);
  readAll().then((items) => cb(items));
  return () => listeners.delete(cb);
}

/** Suscribe a los viajes APARTADOS (cuarentena) — la UI los muestra en rojo. */
export function subscribeViajesQuarantine(cb: QuarantineListener): () => void {
  quarantineListeners.add(cb);
  readQuarantine().then((items) => cb(items));
  return () => quarantineListeners.delete(cb);
}

export async function queueViajesCount(): Promise<number> {
  return (await readAll()).length;
}

/** Viajes apartados que necesitan intervención. */
export async function quarantinedViajes(): Promise<QuarantinedViaje[]> {
  return [...(await readQuarantine())];
}

/**
 * Guarda un viaje para subirlo cuando haya señal.
 *
 * Devuelve si de verdad quedó guardado. Antes no devolvía nada y la pantalla le
 * decía al listero «quedó guardado en el teléfono» aunque la escritura hubiera
 * fallado — la peor mentira posible en este módulo.
 *
 * Lee y escribe DENTRO de `enSerie` para que ningún flush (ni otra pestaña)
 * pueda pisar el viaje entre la lectura y la escritura.
 */
export async function enqueueViaje(
  payload: QueuedViaje['payload'],
  /**
   * Clave de idempotencia. ⭐ HAY QUE PASARLA cuando el viaje YA se intentó
   * subir con señal usando esa misma clave.
   *
   * Sin esto, encolar después de un fallo DUPLICA el viaje en el caso más
   * común de todos: el insert entró y la respuesta se perdió (timeout, portal
   * cautivo, 502 después del commit). El reintento entraría con otra clave y la
   * jefa terminaría pagando un viaje que no existió. Con la misma clave, el
   * reintento choca contra `uq_camion_viajes_client_action` y la política lo da
   * por bueno sin insertar nada.
   */
  id?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await enSerie(async () => {
      const items = await readAll();
      const withNew: QueuedViaje[] = [
        ...items,
        { id: id || nuevoClientActionId(), createdAt: new Date().toISOString(), payload, intentos: 0 },
      ];
      await writeAll(withNew);
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** Clave de idempotencia de un intento de registro. La misma para el intento
 *  con señal y para todos sus reintentos desde la cola. */
export function nuevoClientActionId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

let flushing = false;
/**
 * Sube la cola en orden (FIFO), una por una.
 *  - Sin señal → se detiene y deja TODO para el próximo intento (no se pierde
 *    ni se cuenta como fallo del ítem).
 *  - Error de datos → se reintenta hasta `MAX_INTENTOS_COLA` y después el ítem
 *    se aparta a cuarentena y el bucle CONTINÚA con los siguientes. Este
 *    `continue` es lo que impide que un solo viaje roto congele los de atrás.
 */
export async function flushViajesQueue(): Promise<{ synced: number; remaining: number; quarantined: number }> {
  if (flushing) {
    return { synced: 0, remaining: (await readAll()).length, quarantined: (await readQuarantine()).length };
  }
  flushing = true;
  try {
    const items = await readAll();
    // ⚠️ NO se arma la cola nueva con una FOTO de la vieja. Se anota QUÉ pasó
    //    con cada id y al final se recalcula sobre la cola FRESCA, porque
    //    durante los `await` de este bucle el listero puede haber registrado
    //    viajes nuevos, y escribir la foto vieja los borraría.
    const resueltos = new Set<string>();            // subidos o apartados: salen
    const nuevosIntentos = new Map<string, number>(); // id → intentos actualizados
    const apartados: QuarantinedViaje[] = [];
    let synced = 0;
    let cambio = false;
    // Una vez detenida la pasada (sin señal / error transitorio), el resto se
    // conserva tal cual, en orden, para el próximo intento.
    let detenido = false;

    for (const it of items) {
      // Detenida la pasada, el resto NO se toca: al no marcarlos como resueltos
      // ni cambiarles los intentos, sobreviven solos al recálculo de abajo.
      if (detenido) continue;
      const intentosPrevios = Number(it.intentos) || 0;
      // client_action_id estable (= id de la acción en cola): si un replay anterior
      // ya insertó pero se perdió la respuesta, este reintento choca con el índice
      // único y la política lo trata como éxito, en vez de duplicar el viaje.
      const { error } = await registrarViaje({ ...it.payload, clientActionId: it.id });
      const accion = decidirAccionCola({ error, intentos: intentosPrevios });

      if (accion === 'exito') { resueltos.add(it.id); synced++; cambio = true; continue; }

      if (accion === 'cuarentena') {
        resueltos.add(it.id);
        apartados.push({
          id: it.id,
          createdAt: it.createdAt,
          payload: it.payload,
          error: String(error),
          failedAt: new Date().toISOString(),
          intentos: intentosPrevios + 1,
        });
        cambio = true;
        console.warn(`[viajesOfflineQueue] viaje ${it.id} APARTADO tras ${intentosPrevios + 1} intentos: ${error}`);
        continue; // la cola sigue: los viajes de atrás no se quedan atascados
      }

      // 'reintentar'. La falta de señal NO cuenta como fallo del ítem (si no, un
      // día entero sin cobertura mandaría los viajes a cuarentena sin motivo).
      const deRed = esErrorDeRed(error);
      if (!deRed) { nuevosIntentos.set(it.id, intentosPrevios + 1); cambio = true; }
      detenido = true;
    }

    let restantes: QueuedViaje[];
    {
      try {
        // ⭐ Acá se cierra la carrera: se relee la cola de VERDAD (que puede
        //    traer viajes encolados mientras corría el bucle de arriba) y se le
        //    quitan solo los ids que se resolvieron. Lo que llegó nuevo no está
        //    en `resueltos`, así que sobrevive.
        //
        // ⚠️ LA CUARENTENA SE ESCRIBE ACÁ DENTRO, no antes. Si se escribe por
        //    separado queda un instante en que el viaje apartado está en la
        //    cuarentena Y todavía en la cola; un «🔄 Reintentar» que caiga justo
        //    ahí lo devuelve a la cola y vacía la cuarentena, y este recálculo
        //    lo borra por estar en `resueltos` — desaparecía de las dos partes.
        //    Es la misma clase de carrera que este bloque vino a cerrar.
        restantes = await enSerie(async () => {
          if (apartados.length) await writeQuarantine([...(await readQuarantine()), ...apartados]);
          if (!cambio) return await readAll();
          const frescos = await readAll();
          const quedan = frescos
            .filter((x) => !resueltos.has(x.id))
            .map((x) => (nuevosIntentos.has(x.id) ? { ...x, intentos: nuevosIntentos.get(x.id) } : x));
          await writeAll(quedan);
          return quedan;
        });
      } catch {
        // No se pudo guardar el estado nuevo. Los viajes YA se subieron, así que
        // el próximo intento los reenvía y el índice único los descarta como
        // duplicados: no se duplica nada. `ultimoFalloDeGuardado` queda marcado.
        restantes = await readAll();
      }
    }
    return { synced, remaining: restantes.length, quarantined: (await readQuarantine()).length };
  } finally {
    flushing = false;
  }
}

/**
 * Devuelve los viajes apartados a la cola (al frente) y vuelve a intentarlo —
 * para usar cuando ya se resolvió la causa (p. ej. se restauró el camión).
 * Conservan su `id` original, así que la idempotencia por `client_action_id`
 * sigue protegiendo contra duplicados.
 */
export async function retryQuarantinedViajes(): Promise<{ synced: number; remaining: number; quarantined: number }> {
  // En serie por lo mismo de siempre: entre leer la cola y volver a escribirla
  // el listero puede estar registrando un viaje nuevo.
  await enSerie(async () => {
    const q = await readQuarantine();
    if (!q.length) return;
    const items = await readAll();
    await writeAll([
      ...q.map((x) => ({ id: x.id, createdAt: x.createdAt, payload: x.payload, intentos: 0 })),
      ...items,
    ]);
    // La cuarentena se vacía DESPUÉS de que la cola quedó guardada. Al revés, un
    // fallo de escritura de la cola dejaba los viajes sin cola y sin cuarentena.
    await writeQuarantine([]);
  });
  return flushViajesQueue();
}

/** Descarta UN viaje apartado. Solo por decisión explícita de una persona. */
export async function discardQuarantinedViaje(id: string): Promise<void> {
  const q = await readQuarantine();
  await writeQuarantine(q.filter((x) => x.id !== id));
}
