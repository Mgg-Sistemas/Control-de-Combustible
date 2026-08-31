/*
 * Test de la COLA OFFLINE de viajes (listeros en campo).
 *
 * Por qué existe: hasta el 15-ago-2026 la cola se DETENÍA para siempre en el
 * primer ítem que fallara por algo que no fuera falta de señal (camión borrado,
 * dato inválido, etc.). Como `flushViajesQueue` corta el bucle en ese ítem y lo
 * deja a la cabeza, TODOS los viajes registrados después quedaban atascados
 * detrás de él indefinidamente — y lo único que ocurría era un `console.warn`
 * que el listero nunca ve. Riesgo real de perder días de viajes en silencio.
 *
 * Estos casos FIJAN el comportamiento nuevo:
 *  - falta de señal  → se reintenta siempre, NUNCA manda a cuarentena;
 *  - error de datos  → se reintenta MAX_INTENTOS_COLA veces y luego el ítem se
 *                      aparta a CUARENTENA y la cola SIGUE con los demás;
 *  - clave duplicada → éxito (el viaje ya estaba en el servidor, no se duplica).
 *
 * No usa framework de test (el repo no tiene): transpila los .ts en memoria con
 * el `typescript` ya instalado y stubbea las dependencias nativas/de red.
 *
 *   npm run test:cola-offline   (o: node scripts/test-cola-offline.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

/** Transpila un .ts del repo y lo carga, sustituyendo los `require` de `stubs`. */
function loadTs(relPath, stubs = {}) {
  const srcPath = path.join(ROOT, relPath);
  const src = fs.readFileSync(srcPath, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  const orig = m.require.bind(m);
  m.require = (id) => (Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : orig(id));
  m._compile(out, m.filename);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; failures.push(`${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};

// ── 1) La política pura: qué hacer con un ítem que falló ────────────────────
const policy = loadTs('src/lib/colaOfflinePolicy.ts');
const { decidirAccionCola, MAX_INTENTOS_COLA, esErrorDeRed, esErrorDuplicado } = policy;

eq('sin error → exito', decidirAccionCola({ error: null, intentos: 0 }), 'exito');
eq('error vacío → exito', decidirAccionCola({ error: '', intentos: 0 }), 'exito');
eq('duplicate key → exito', decidirAccionCola({ error: 'duplicate key value violates unique constraint "uq_camion_viajes_client_action"', intentos: 0 }), 'exito');
eq('23505 → exito', decidirAccionCola({ error: 'error 23505', intentos: 0 }), 'exito');
eq('duplicado aunque lleve intentos → exito', decidirAccionCola({ error: 'duplicate key', intentos: 9 }), 'exito');

eq('sin señal → reintentar', decidirAccionCola({ error: 'Network request failed', intentos: 0 }), 'reintentar');
eq('sin señal (fetch) → reintentar', decidirAccionCola({ error: 'Failed to fetch', intentos: 0 }), 'reintentar');
eq('sin señal NUNCA va a cuarentena', decidirAccionCola({ error: 'Network request failed', intentos: 99 }), 'reintentar');

eq('dato inválido, 1er fallo → reintentar', decidirAccionCola({ error: 'null value in column "chofer_name"', intentos: 0 }), 'reintentar');
eq('dato inválido, 2do fallo → reintentar', decidirAccionCola({ error: 'null value in column "chofer_name"', intentos: 1 }), 'reintentar');
eq('dato inválido, 3er fallo → cuarentena', decidirAccionCola({ error: 'null value in column "chofer_name"', intentos: 2 }), 'cuarentena');
eq('dato inválido, ya pasado el tope → cuarentena', decidirAccionCola({ error: 'foreign key violation', intentos: 7 }), 'cuarentena');
eq('tope de intentos', MAX_INTENTOS_COLA, 3);

eq('esErrorDeRed reconoce mayúsculas', esErrorDeRed('NETWORK REQUEST FAILED'), true);
eq('esErrorDeRed no confunde validación', esErrorDeRed('violates not-null constraint'), false);
eq('esErrorDeRed con null', esErrorDeRed(null), false);
eq('esErrorDuplicado', esErrorDuplicado('Duplicate Key'), true);
eq('esErrorDuplicado con null', esErrorDuplicado(null), false);

// ── 2) La cola completa: un ítem atascado NO puede bloquear a los demás ─────
const store = new Map();
// ⚠️ `__esModule: true` es OBLIGATORIO. Sin él, el helper `__importDefault` que
// mete TypeScript al transpilar envuelve el stub otra vez (`{default: {default:
// {...}}}`), `AsyncStorage.getItem` queda undefined y CADA lectura y escritura
// revienta... en silencio, porque el código las atrapaba. Resultado: hasta el
// 22-ago-2026 esta suite salía en verde SIN TOCAR NUNCA EL ALMACENAMIENTO —
// probaba la caché en memoria y nada más. Se descubrió al hacer que `readAll`
// leyera siempre del disco: la suite empezó a fallar y destapó el engaño.
const asyncStorageStub = {
  __esModule: true,
  default: {
    getItem: async (k) => (store.has(k) ? store.get(k) : null),
    setItem: async (k, v) => { store.set(k, v); },
    removeItem: async (k) => { store.delete(k); },
  },
};

// El viaje "malo" falla SIEMPRE con un error de datos; los demás pasan.
let intentosDelMalo = 0;
const camionViajesStub = {
  registrarViaje: async (p) => {
    if (p.machineCode === 'MALO') { intentosDelMalo++; return { error: 'insert or update violates foreign key constraint "camion_viajes_machinery_id_fkey"' }; }
    return { error: null };
  },
};

const queue = loadTs('src/lib/viajesOfflineQueue.ts', {
  '@react-native-async-storage/async-storage': asyncStorageStub,
  './camionViajes': camionViajesStub,
  './offlineQueue': { isNetworkErrorMsg: esErrorDeRed, isOnline: () => true, onConnectivityChange: () => () => {} },
  './colaOfflinePolicy': policy,
});

const viaje = (code) => ({
  machineryId: `id-${code}`, machineCode: code, listeroId: 'u1', listeroName: 'Listero',
  choferName: 'Chofer', shift: 'day', estadoMaquina: 'operativa', note: null,
  registeredAt: '2026-08-15T12:00:00.000Z',
});

await queue.enqueueViaje(viaje('BUENO-1'));
await queue.enqueueViaje(viaje('MALO'));
await queue.enqueueViaje(viaje('BUENO-2'));

eq('arranca con 3 en cola', await queue.queueViajesCount(), 3);

// Se corre el flush tantas veces como reintentos permita la política, +1.
let sincronizadosTotal = 0;
for (let i = 0; i < MAX_INTENTOS_COLA + 1; i++) {
  const r = await queue.flushViajesQueue();
  sincronizadosTotal += r.synced;
}

eq('los 2 viajes buenos se subieron', sincronizadosTotal, 2);
eq('la cola quedó vacía (nada atascado detrás)', await queue.queueViajesCount(), 0);
eq('el viaje malo quedó en cuarentena', (await queue.quarantinedViajes()).length, 1);
eq('la cuarentena guarda el motivo', (await queue.quarantinedViajes())[0].error.includes('foreign key'), true);
eq('el malo se reintentó justo el tope de veces', intentosDelMalo, MAX_INTENTOS_COLA);

// ── 3) Reintento manual desde cuarentena, una vez arreglada la causa ────────
const cuarentenaAntes = await queue.quarantinedViajes();
eq('el payload sobrevive en cuarentena', cuarentenaAntes[0].payload.machineCode, 'MALO');

camionViajesStub.registrarViaje = async () => ({ error: null }); // se arregló la causa
await queue.retryQuarantinedViajes();

eq('tras reintentar, la cuarentena queda vacía', (await queue.quarantinedViajes()).length, 0);
eq('y la cola tampoco quedó con residuos', await queue.queueViajesCount(), 0);

// ── 4) Sin señal: la cola se detiene pero NO manda nada a cuarentena ────────
store.clear();
camionViajesStub.registrarViaje = async () => ({ error: 'Network request failed' });
await queue.enqueueViaje(viaje('SIN-SENAL-1'));
await queue.enqueueViaje(viaje('SIN-SENAL-2'));
for (let i = 0; i < MAX_INTENTOS_COLA + 3; i++) await queue.flushViajesQueue();

eq('sin señal, los 2 siguen en cola', await queue.queueViajesCount(), 2);
eq('sin señal, cuarentena vacía', (await queue.quarantinedViajes()).length, 0);

camionViajesStub.registrarViaje = async () => ({ error: null }); // vuelve la señal
const rFinal = await queue.flushViajesQueue();
eq('al volver la señal se suben los 2', rFinal.synced, 2);
eq('y la cola queda limpia', await queue.queueViajesCount(), 0);

// ── 5) ⭐ LA CARRERA: registrar un viaje MIENTRAS la cola se está subiendo ──
//
// Encontrado el 22-ago-2026 auditando el módulo. `flushViajesQueue` tomaba una
// FOTO de la cola al empezar y al final escribía el resto calculado sobre esa
// foto. Un viaje encolado durante los `await` del bucle quedaba escrito en el
// disco y acto seguido el flush lo BORRABA, para siempre y sin dejar rastro.
//
// No es teórico: el flush corre cada 30 s y en cada cambio de conectividad, o
// sea justo cuando la señal va y viene — que es exactamente cuando el listero
// está encolando viajes.
//
// El guard `flushing` NO protege contra esto: impide dos flushes a la vez, no
// que alguien encole durante uno.
store.clear();
let subidos = [];
let yaEncolado = false;
camionViajesStub.registrarViaje = async (p) => {
  subidos.push(p.machineCode);
  // Mientras se sube el primero, el listero toca el botón y registra otro.
  if (!yaEncolado) {
    yaEncolado = true;
    await queue.enqueueViaje(viaje('REGISTRADO-DURANTE-EL-FLUSH'));
  }
  return { error: null };
};

await queue.enqueueViaje(viaje('VIEJO-1'));
await queue.enqueueViaje(viaje('VIEJO-2'));
eq('carrera: arranca con 2 en cola', await queue.queueViajesCount(), 2);

await queue.flushViajesQueue();

// El viaje nuevo tiene que estar SUBIDO o SEGUIR EN LA COLA. Lo único
// inaceptable es que no esté en ninguna de las dos partes: eso es perderlo.
const enCola = await queue.queueViajesCount();
const seSubio = subidos.includes('REGISTRADO-DURANTE-EL-FLUSH');
eq('⭐ el viaje registrado durante el flush NO se pierde', seSubio || enCola > 0, true);

// Y si se quedó en la cola, el siguiente flush tiene que subirlo.
if (!seSubio) {
  await queue.flushViajesQueue();
  eq('⭐ y el flush siguiente lo sube', subidos.includes('REGISTRADO-DURANTE-EL-FLUSH'), true);
}
eq('carrera: al final no queda nada colgando', await queue.queueViajesCount(), 0);
eq('carrera: nada cayó en cuarentena', (await queue.quarantinedViajes()).length, 0);
eq('carrera: se subieron los 3 viajes', subidos.length, 3);

// ── 6) ⭐ QUÉ SE HACE CUANDO FALLA UN REGISTRO **CON SEÑAL** ────────────────
//
// Hasta el 22-ago-2026 la pantalla hacía `if (error) { toast.error(error); return; }`
// dentro del `if (isOnline())`: si la petición fallaba estando "conectado"
// —wifi del patio sin salida a internet, portal cautivo, sesión vencida, 500,
// timeout— el viaje SE DESCARTABA con un aviso que se iba solo a los 3 segundos.
//
// La regla ahora es: se encola SIEMPRE, salvo que el error diga que la fila YA
// ESTÁ en el servidor. Encolar de más cuesta unos reintentos; encolar de menos
// cuesta un viaje de trabajo real.
const { accionTrasFalloConSenal, motivoLegible } = policy;

eq('sin señal → encolar', accionTrasFalloConSenal('Failed to fetch'), 'encolar');
eq('sesión vencida → encolar (se renueva sola y sube)', accionTrasFalloConSenal('JWT expired'), 'encolar');
eq('timeout → encolar', accionTrasFalloConSenal('canceling statement due to statement timeout'), 'encolar');
eq('500 del servidor → encolar', accionTrasFalloConSenal('Internal Server Error'), 'encolar');
eq('portal cautivo (HTML por respuesta) → encolar', accionTrasFalloConSenal("Unexpected token '<'"), 'encolar');
eq('RLS → encolar', accionTrasFalloConSenal('new row violates row-level security policy for table "camion_viajes"'), 'encolar');
// El camión se borró del catálogo: el viaje OCURRIÓ igual. Que el admin lo
// restaure y el listero reintente es mejor que tirar el trabajo del día.
eq('camión borrado del catálogo → encolar igual', accionTrasFalloConSenal('violates foreign key constraint'), 'encolar');
eq('error desconocido → encolar (ante la duda, guardar)', accionTrasFalloConSenal('cualquier cosa rara'), 'encolar');
// ⭐ La ÚNICA excepción: si ya está en el servidor, encolarlo lo duplicaría.
eq('⭐ duplicado → ya estaba, NO encolar', accionTrasFalloConSenal('duplicate key value violates unique constraint'), 'ya_estaba');
eq('⭐ 23505 → ya estaba', accionTrasFalloConSenal('error 23505'), 'ya_estaba');

// Los motivos se le muestran al listero en el campo: en castellano, no el
// mensaje crudo de Postgres en inglés.
eq('motivo: red', motivoLegible('Failed to fetch'), 'sin conexión con el servidor');
eq('motivo: camión borrado', motivoLegible('violates foreign key constraint "camion_viajes_machinery_id_fkey"'), 'ese camión ya no está en el catálogo');
eq('motivo: sesión', motivoLegible('JWT expired'), 'tu sesión venció, vuelve a entrar');
eq('motivo desconocido se muestra tal cual', motivoLegible('boom'), 'boom');
eq('motivo vacío no dice "undefined"', motivoLegible(null), 'error desconocido');

// ── 7) ⭐ LA CLAVE DE IDEMPOTENCIA VIAJA DEL INTENTO ONLINE A LA COLA ───────
//
// Precondición de todo lo anterior: encolar tras un fallo solo es seguro si el
// reintento lleva LA MISMA clave que llevó el intento con señal. Si no, el caso
// más común de todos —el insert entró y se perdió la respuesta— DUPLICARÍA el
// viaje, y la jefa terminaría pagando uno que no existió.
store.clear();
const clavesVistas = [];
camionViajesStub.registrarViaje = async (p) => { clavesVistas.push(p.clientActionId); return { error: null }; };

const CLAVE = 'clave-del-intento-con-senal';
await queue.enqueueViaje(viaje('REINTENTO'), CLAVE);
await queue.flushViajesQueue();
eq('⭐ el reintento sube con la MISMA clave del intento original', clavesVistas, [CLAVE]);

// Y sin clave explícita (registro sin señal desde el principio) se inventa una,
// que es lo correcto: nunca se intentó subir, no hay nada con qué chocar.
store.clear();
clavesVistas.length = 0;
await queue.enqueueViaje(viaje('SIN-CLAVE-PREVIA'));
await queue.flushViajesQueue();
eq('sin clave previa se genera una', clavesVistas.length, 1);
eq('y no es la del otro caso', clavesVistas[0] !== CLAVE, true);
eq('y no viene vacía', String(clavesVistas[0] ?? '').length > 6, true);

// ── 8) ⭐ REINTENTAR APARTADOS JUSTO MIENTRAS LA COLA SE ESTÁ SUBIENDO ──────
//
// Segunda carrera, encontrada al revisar el arreglo de la primera (22-ago-2026).
// Apartar un viaje y reescribir la cola eran DOS escrituras separadas, y entre
// una y otra el viaje quedaba en la cuarentena Y todavía en la cola. Si el
// listero tocaba «🔄 Reintentar» en ese instante, el reintento lo devolvía a la
// cola y vaciaba la cuarentena... y el recálculo del flush lo borraba de la cola
// por considerarlo ya resuelto. EL VIAJE DESAPARECÍA DE LAS DOS PARTES.
//
// No es rebuscado: el flush corre en cada cambio de conectividad, que es justo
// cuando el listero toca reintentar porque le volvió la señal.
store.clear();
camionViajesStub.registrarViaje = async () => ({ error: 'insert or update violates foreign key constraint "camion_viajes_machinery_id_fkey"' });

// El almacenamiento REAL tarda (AsyncStorage en Android, localStorage con el
// hilo ocupado). Sin esa demora la ventana entre escribir la cuarentena y
// reescribir la cola se cierra sola y el fallo no se reproduce: el test pasaría
// aunque el bug siguiera ahí. 2 ms bastan para abrirla.
const getItemOriginal = asyncStorageStub.default.getItem;
const lento = (ms) => new Promise((r) => setTimeout(r, ms));
asyncStorageStub.default.getItem = async (k) => { await lento(2); return getItemOriginal(k); };

// Se dispara el reintento EN EL MOMENTO EXACTO en que se escribe la cuarentena.
let yaDisparado = false;
// El reintento se lanza SIN await: modela el toque del usuario, que es otra
// tarea del bucle de eventos. Awaitarlo acá sería reentrar en la sección
// crítica desde dentro de ella misma, cosa que la app real no puede hacer.
let reintentoEnCurso = null;
const setItemOriginal = asyncStorageStub.default.setItem;
asyncStorageStub.default.setItem = async (k, v) => {
  await lento(2);
  await setItemOriginal(k, v);
  if (k === 'viajes_offline_quarantine_v1' && !yaDisparado && JSON.parse(v).length > 0) {
    yaDisparado = true;
    reintentoEnCurso = queue.retryQuarantinedViajes();
  }
};

await queue.enqueueViaje(viaje('EL-QUE-SE-PERDIA'));
for (let i = 0; i < MAX_INTENTOS_COLA + 1; i++) await queue.flushViajesQueue();
await reintentoEnCurso;
asyncStorageStub.default.setItem = setItemOriginal;
asyncStorageStub.default.getItem = getItemOriginal;

const enColaFinal = await queue.queueViajesCount();
const enCuarentenaFinal = (await queue.quarantinedViajes()).length;
eq('⭐ el viaje NO desaparece de la cola Y de la cuarentena a la vez',
  enColaFinal + enCuarentenaFinal > 0, true);
eq('se disparó el reintento en el momento crítico (si no, el test no prueba nada)', yaDisparado, true);

// ── 9) ⭐ SI EL TELÉFONO NO PUEDE GUARDAR, EL VIAJE IGUAL SE SUBE ───────────
//
// Al hacer que la cola se leyera SIEMPRE del disco (para que dos pestañas del
// navegador no se pisaran), se rompió sin querer algo que antes funcionaba: si
// la escritura fallaba, el viaje seguía en memoria y el flush de los 30 s lo
// subía. Con la lectura desde disco, la relectura lo borraba de memoria y no se
// subía NUNCA — y encima la pantalla decía «no cierres la app hasta que suba».
store.clear();
const subidosSinDisco = [];
camionViajesStub.registrarViaje = async (p) => { subidosSinDisco.push(p.machineCode); return { error: null }; };

asyncStorageStub.default.setItem = async (k, v) => {
  if (k === 'viajes_offline_queue_v1') throw new Error('QuotaExceededError');
  return setItemOriginal(k, v);
};
const r = await queue.enqueueViaje(viaje('SIN-DISCO'));
// `r?.ok` y no `r.ok`: si alguien vuelve a hacer que enqueueViaje no devuelva
// nada, este test tiene que FALLAR con un mensaje, no reventar la suite entera.
eq('el fallo de guardado se REPORTA, no se traga', r?.ok ?? 'no devolvió nada', false);

// Aunque no se pudo guardar en disco, el viaje tiene que llegar al servidor.
await queue.flushViajesQueue();
asyncStorageStub.default.setItem = setItemOriginal;
eq('⭐ el viaje se sube igual aunque el teléfono no pudiera guardarlo',
  subidosSinDisco.includes('SIN-DISCO'), true);

// ── 10) ⭐⭐ SI FALLA EL GUARDADO DE LA CUARENTENA, EL VIAJE NO SE PIERDE ────
//
// ERA EL ÚNICO CAMINO POR EL QUE UN VIAJE SE PERDÍA DE VERDAD (31-ago-2026).
// `writeQuarantine` se tragaba el fallo de disco con un `console.warn`, y dos
// líneas más abajo `writeAll` SÍ funcionaba y sacaba el viaje de la cola por
// considerarlo "resuelto". No quedaba ni en la cola ni en la cuarentena. Y como
// `writeAll` pone `ultimoFalloDeGuardado = null` al escribir bien, el aviso rojo
// tampoco salía: el viaje se esfumaba en silencio absoluto.
//
// La cola ya tenía esta disciplina (revienta hacia arriba). La cuarentena no,
// aunque su propio comentario decía "perderla es perder el trabajo del listero
// definitivamente".
store.clear();
intentosDelMalo = 0;
camionViajesStub.registrarViaje = async (p) => {
  if (p.machineCode === 'MALO') { intentosDelMalo++; return { error: 'insert or update violates foreign key constraint "camion_viajes_machinery_id_fkey"' }; }
  return { error: null };
};

await queue.enqueueViaje(viaje('MALO'));
eq('arranca con el viaje malo en cola', await queue.queueViajesCount(), 1);

// Solo falla la CUARENTENA. La cola escribe bien — que es justo lo que hacía
// del bug algo tan silencioso.
asyncStorageStub.default.setItem = async (k, v) => {
  if (k === 'viajes_offline_quarantine_v1') throw new Error('QuotaExceededError');
  return setItemOriginal(k, v);
};
for (let i = 0; i < MAX_INTENTOS_COLA + 2; i++) await queue.flushViajesQueue();
asyncStorageStub.default.setItem = setItemOriginal;

eq('el viaje llegó al tope de intentos (si no, el test no prueba nada)',
  intentosDelMalo >= MAX_INTENTOS_COLA, true);
eq('⭐ el viaje NO se perdió: sigue en la cola', await queue.queueViajesCount(), 1);
eq('y no quedó a medias en la cuarentena', (await queue.quarantinedViajes()).length, 0);
eq('⭐ y el fallo se REPORTA (el aviso rojo tiene qué decir)',
  typeof queue.falloDeGuardadoLocal() === 'string' && queue.falloDeGuardadoLocal().length > 0, true);

// Y lo que de verdad importa: sobrevive a cerrar la app. Se relee del disco
// desde cero, como si el listero volviera a abrir el teléfono al día siguiente.
const crudoCola = store.get('viajes_offline_queue_v1');
eq('⭐ y sigue GUARDADO en el teléfono, no solo en memoria',
  typeof crudoCola === 'string' && JSON.parse(crudoCola).length === 1, true);

// Resuelta la causa (el disco vuelve), el viaje termina de procesarse normal.
camionViajesStub.registrarViaje = async () => ({ error: null });
await queue.flushViajesQueue();
eq('cuando el disco vuelve, el viaje se sube y la cola queda limpia', await queue.queueViajesCount(), 0);

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) {
  console.log('\nFallos:');
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('Cola offline de listeros: comportamiento fijado.\n');
