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
const asyncStorageStub = {
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

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) {
  console.log('\nFallos:');
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('Cola offline de listeros: comportamiento fijado.\n');
