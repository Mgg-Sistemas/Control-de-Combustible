// 🚜 LECTURAS DE LA LIB DEL ESTADO DE LAS MÁQUINAS (25-oct-2026) — pruebas.
//
// `src/lib/machineLiveStatus.ts` la usan SEIS pantallas (Catálogo, Inicio, Conteo de
// Reportes, Frentes, Usuarios y Viajes), todas llamando `fetchAveriaCat()` y
// `fetchJornadaCat()` SIN argumentos. El Centro de Operaciones necesita leer SOLO sus
// pocas máquinas vinculadas (`ids`), enterarse si la lectura falla (`estricto`) y
// saber si inspección registró algo nuevo después de una marca
// (`fetchNovedadesInspeccion`). Mesa de maquinaria, §6.1. Esta prueba fija que:
//   1) las consultas sin opciones son, letra por letra, las de antes (foto grabada);
//   2) el resultado sin opciones es el de antes (foto), incluido el «ciego» a errores;
//   3) filtrar por `ids` = leer todo y recortar a esos ids; `[]` = cero consultas;
//   4) `estricto` lanza en español si alguna consulta falla, y si no, no cambia nada;
//   5) los «hechos nuevos de inspección» (D1): avería REAL creada o resuelta y jornada
//      con `jornada_marked_at`; nunca los marcadores de parada ni `jornada_start_at`;
//      con la ventana POR MÁQUINA (lote 6 A2) y aplazando los hechos de hora futura (A1);
//   6) las cinco pruebas que ya tenía la lib siguen verdes sin tocarlas;
//   7) candados: la lib no escribe, el marcador vive en UNA constante, las seis
//      pantallas siguen sin argumentos y lo demás de la lib no cambió.
//
// Nada sale a la red: el `./supabase` DE VERDAD se carga con un cliente FALSO (una
// base en memoria que GRABA cada cadena de llamadas), así `selectAllRows` es el real.
// ⭐ Todos los datos son SINTÉTICOS (el repositorio es público).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

// ═══════════════════ El Supabase FALSO (base en memoria que graba) ═══════════════════
// Cada `supabase.from(t)` crea una llamada { tabla, ops: [[verbo, args], …] } y
// devuelve un constructor que acepta cualquier verbo encadenado. Al esperarlo
// (`await`) contesta como PostgREST: filtra, ordena y corta las filas de `base`,
// salvo que `falla(llamada)` devuelva un error (entonces { data: null, error }).
const llamadas = [];
let base = {};
let falla = () => null;
const reiniciar = (filas = {}, fallo = () => null) => { llamadas.length = 0; base = filas; falla = fallo; };

const esFecha = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v);
const comparar = (a, b) => {
  if (esFecha(a) && esFecha(b)) return Date.parse(a) - Date.parse(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};
const FILTROS = {
  // Como SQL: una comparación contra NULL nunca es verdadera.
  eq: (f, [c, v]) => f[c] != null && f[c] === v,
  neq: (f, [c, v]) => f[c] != null && f[c] !== v,
  in: (f, [c, vs]) => f[c] != null && vs.includes(f[c]),
  gt: (f, [c, v]) => f[c] != null && comparar(f[c], v) > 0,
  not: (f, [c, op, v]) => {
    if (op === 'is' && v === null) return f[c] != null;
    throw new Error(`el Supabase falso no conoce not(${c}, ${op}, ${v})`);
  },
};
// `.or('and(c.op.v,c.op."v"),…')` como PostgREST: alguna rama entera se cumple (lote 6, A2).
const ramasDe = (txt) => {
  const out = [];
  let dep = 0, comillas = false, cur = '';
  for (const ch of txt) {
    if (ch === '"') comillas = !comillas;
    if (!comillas) {
      if (ch === '(') dep++;
      else if (ch === ')') dep--;
      else if (ch === ',' && dep === 0) { out.push(cur); cur = ''; continue; }
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
};
const cumpleFiltro = (f, exp) => {
  const and = /^and\((.*)\)$/s.exec(exp);
  if (and) return ramasDe(and[1]).every((x) => cumpleFiltro(f, x));
  const or = /^or\((.*)\)$/s.exec(exp);
  if (or) return ramasDe(or[1]).some((x) => cumpleFiltro(f, x));
  const m = /^(\w+)\.(\w+)\.(.*)$/s.exec(exp);
  if (!m || !FILTROS[m[2]]) throw new Error(`el Supabase falso no entiende el filtro «${exp}»`);
  const v = m[3].startsWith('"') && m[3].endsWith('"') ? m[3].slice(1, -1) : m[3];
  return FILTROS[m[2]](f, [m[1], v]);
};
FILTROS.or = (f, [txt]) => ramasDe(txt).some((x) => cumpleFiltro(f, x));
function contestar(ll) {
  const error = falla(ll);
  if (error) return { data: null, error };
  let filas = (base[ll.tabla] ?? []).map((f) => ({ ...f }));
  let columnas = null, orden = null, rango = null;
  for (const [verbo, args] of ll.ops) {
    if (verbo === 'select') columnas = args[0].split(',').map((s) => s.trim());
    else if (verbo === 'order') orden = args;
    else if (verbo === 'range') rango = args;
    else if (FILTROS[verbo]) filas = filas.filter((f) => FILTROS[verbo](f, args));
    else throw new Error(`el Supabase falso no conoce el verbo «${verbo}»`);
  }
  if (orden) {
    const [c, o] = orden;
    const asc = o?.ascending !== false;
    // Como Postgres: NULL va al final en ASC y al principio en DESC. Orden estable.
    filas = filas.map((f, i) => [f, i]).sort(([a, ia], [b, ib]) => {
      const na = a[c] == null, nb = b[c] == null;
      if (na || nb) return na && nb ? ia - ib : (na ? 1 : -1) * (asc ? 1 : -1);
      return (asc ? comparar(a[c], b[c]) : comparar(b[c], a[c])) || ia - ib;
    }).map(([f]) => f);
  }
  if (rango) filas = filas.slice(rango[0], rango[1] + 1);
  if (columnas) filas = filas.map((f) => Object.fromEntries(columnas.map((c) => [c, f[c] ?? null])));
  return { data: filas, error: null };
}
const constructor = (ll) => {
  const b = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve().then(() => contestar(ll)).then(res, rej);
      return (...args) => { ll.ops.push([String(prop), JSON.parse(JSON.stringify(args))]); return b; };
    },
  });
  return b;
};
const CLIENTE_FALSO = {
  from(tabla) { const ll = { tabla, ops: [] }; llamadas.push(ll); return constructor(ll); },
  rpc(...args) {
    llamadas.push({ tabla: null, ops: [['rpc', JSON.parse(JSON.stringify(args))]] });
    return Promise.resolve({ data: null, error: { message: 'rpc prohibido en esta prueba' } });
  },
};

// ═══════════════════ Cargador de TypeScript ═══════════════════
// `./supabase` es el DE VERDAD, pero con sus dependencias nativas de mentira y
// `createClient` devolviendo el cliente falso de arriba.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://falso.invalid';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'llave-falsa';
const NATIVOS = {
  'react-native-url-polyfill/auto': {},
  '@react-native-async-storage/async-storage': { __esModule: true, default: {} },
  'react-native': { Platform: { OS: 'web' } },
  'expo-secure-store': {},
  '@supabase/supabase-js': { createClient: () => CLIENTE_FALSO },
};
const SUPABASE_REAL = path.join(ROOT, 'src', 'lib', 'supabase.ts');
const cache = new Map();
function cargarAbs(p) {
  if (cache.has(p)) return cache.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cache.set(p, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (p === SUPABASE_REAL && Object.prototype.hasOwnProperty.call(NATIVOS, id)) return NATIVOS[id];
    if (id.startsWith('.')) {
      const abs = path.resolve(path.dirname(p), id);
      for (const c of [abs + '.ts', abs + '.tsx']) if (fs.existsSync(c)) return cargarAbs(c);
    }
    return orig(id);
  };
  m._compile(js, p);
  cache.set(p, m.exports);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
/** Igual que JSON, pero las llaves de cada objeto en orden: {a,b} = {b,a}. */
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
};
const eq = (name, got, want) => {
  const g = JSON.stringify(canon(got)), w = JSON.stringify(canon(want));
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
/** Corre `fn` y devuelve { valor } o { error } (sin dejar que una excepción corte la prueba). */
const intentar = async (fn) => { try { return { valor: await fn() }; } catch (error) { return { error }; } };

console.log('\n🚜 LIB DEL ESTADO DE LAS MÁQUINAS · LECTURAS\n');

const L = cargarAbs(path.join(ROOT, 'src/lib/machineLiveStatus.ts'));

// ═══ Datos sintéticos ═══════════════════════════════════════════════════════════
const PARADA = 'MÁQUINA PARADA';
// Una «hora fija» de prueba: lunes 20/10/2026 11:00 a. m. en Caracas.
const FECHA = new Date('2026-10-20T15:00:00.000Z');

// Tickets (maintenance_requests): avería REAL + marcador en la misma máquina, dos
// averías, solo marcadores, resueltas, material vacío (el filtro `neq` de SQL lo deja
// fuera de las dos listas) y notas vacías (el motivo cae al material).
const TICKETS = [
  { id: 'r01', machinery_id: 'M1', material: PARADA, notes: 'NO TRABAJÓ · sin volqueta', status: 'pendiente', created_at: '2026-10-20T08:00:00-04:00', resolved_at: null },
  { id: 'r02', machinery_id: 'M1', material: 'CAUCHO', notes: null, status: 'pendiente', created_at: '2026-10-19T08:00:00-04:00', resolved_at: null },
  { id: 'r03', machinery_id: 'M2', material: 'FRENOS', notes: 'falla de frenos', status: 'pendiente', created_at: '2026-10-18T09:00:00-04:00', resolved_at: null },
  { id: 'r04', machinery_id: 'M2', material: 'MOTOR', notes: 'recalienta', status: 'pendiente', created_at: '2026-10-20T07:30:00-04:00', resolved_at: null },
  { id: 'r05', machinery_id: 'M3', material: PARADA, notes: 'NO TRABAJÓ · sin operador', status: 'pendiente', created_at: '2026-10-19T08:00:00-04:00', resolved_at: null },
  { id: 'r06', machinery_id: 'M3', material: PARADA, notes: 'NO TRABAJÓ · lluvia', status: 'pendiente', created_at: '2026-10-20T09:00:00-04:00', resolved_at: null },
  { id: 'r07', machinery_id: 'M4', material: 'HIDRÁULICO', notes: 'fuga', status: 'realizado', created_at: '2026-10-17T10:00:00-04:00', resolved_at: '2026-10-19T10:00:00-04:00' },
  { id: 'r08', machinery_id: 'M5', material: PARADA, notes: 'NO TRABAJÓ', status: 'realizado', created_at: '2026-10-18T08:00:00-04:00', resolved_at: '2026-10-18T19:00:00-04:00' },
  { id: 'r09', machinery_id: 'M6', material: null, notes: 'sin material', status: 'pendiente', created_at: '2026-10-20T10:00:00-04:00', resolved_at: null },
  { id: 'r10', machinery_id: 'M7', material: 'ELÉCTRICO', notes: '', status: 'pendiente', created_at: '2026-10-16T10:00:00-04:00', resolved_at: null },
  { id: 'r11', machinery_id: 'M8', material: PARADA, notes: 'NO TRABAJÓ · sin volqueta', status: 'pendiente', created_at: '2026-10-20T06:00:00-04:00', resolved_at: null },
  { id: 'r12', machinery_id: 'M8', material: 'MOTOR', notes: 'humo', status: 'realizado', created_at: '2026-10-19T06:00:00-04:00', resolved_at: '2026-10-19T18:00:00-04:00' },
];
// Rondas (machine_rounds) de HOY (20/10) y de ANOCHE (19/10): filas repetidas, noche de
// anoche abierta y cerrada, turno de día de ayer, turno sin declarar (se infiere por la
// hora), una máquina con noche de anoche Y de hoy, y una fecha que no entra.
const RONDAS = [
  { id: 'k01', machinery_id: 'J1', round_date: '2026-10-20', day_hours: 3, night_hours: 0, jornada_start_at: '2026-10-20T07:00:00-04:00', jornada_marked_at: '2026-10-20T09:30:00-04:00', jornada_shift: 'day' },
  { id: 'k02', machinery_id: 'J1', round_date: '2026-10-20', day_hours: 5, night_hours: 0, jornada_start_at: null, jornada_marked_at: null, jornada_shift: null },
  { id: 'k03', machinery_id: 'J2', round_date: '2026-10-20', day_hours: 0, night_hours: 2, jornada_start_at: null, jornada_marked_at: null, jornada_shift: null },
  { id: 'k04', machinery_id: 'J3', round_date: '2026-10-19', day_hours: 0, night_hours: 4, jornada_start_at: '2026-10-19T19:00:00-04:00', jornada_marked_at: null, jornada_shift: 'night' },
  { id: 'k05', machinery_id: 'J4', round_date: '2026-10-19', day_hours: 0, night_hours: 6, jornada_start_at: null, jornada_marked_at: null, jornada_shift: 'night' },
  { id: 'k06', machinery_id: 'J5', round_date: '2026-10-19', day_hours: 8, night_hours: 0, jornada_start_at: '2026-10-19T07:00:00-04:00', jornada_marked_at: null, jornada_shift: 'day' },
  { id: 'k07', machinery_id: 'J6', round_date: '2026-10-20', day_hours: 0, night_hours: 0, jornada_start_at: '2026-10-20T19:30:00-04:00', jornada_marked_at: '2026-10-20T19:45:00-04:00', jornada_shift: null },
  { id: 'k08', machinery_id: 'J7', round_date: '2026-10-20', day_hours: 0, night_hours: 1, jornada_start_at: '2026-10-20T19:00:00-04:00', jornada_marked_at: '2026-10-20T20:10:00-04:00', jornada_shift: 'night' },
  { id: 'k09', machinery_id: 'J7', round_date: '2026-10-19', day_hours: 0, night_hours: 3, jornada_start_at: '2026-10-19T19:00:00-04:00', jornada_marked_at: '2026-10-19T19:05:00-04:00', jornada_shift: 'night' },
  { id: 'k10', machinery_id: 'J8', round_date: '2026-10-18', day_hours: 9, night_hours: 0, jornada_start_at: '2026-10-18T07:00:00-04:00', jornada_marked_at: null, jornada_shift: 'day' },
];
const BASE = () => ({ maintenance_requests: TICKETS, machine_rounds: RONDAS });

// Quién es quién entre las consultas (para hacer fallar UNA sola).
const tieneOp = (ll, verbo, ...args) => ll.ops.some(([v, a]) => v === verbo && args.every((x, i) => JSON.stringify(a[i]) === JSON.stringify(x)));
const esAveriasReales = (ll) => ll.tabla === 'maintenance_requests' && tieneOp(ll, 'neq', 'material', PARADA) && tieneOp(ll, 'eq', 'status', 'pendiente');
const esMarcadores = (ll) => ll.tabla === 'maintenance_requests' && tieneOp(ll, 'eq', 'material', PARADA);
const esRondasHoy = (ll) => ll.tabla === 'machine_rounds' && tieneOp(ll, 'eq', 'round_date', '2026-10-20');
const esRondasAnoche = (ll) => ll.tabla === 'machine_rounds' && tieneOp(ll, 'eq', 'round_date', '2026-10-19');
const ERROR_RED = { message: 'TypeError: Network request failed', code: '' };
const fallaSi = (pred) => (ll) => (pred(ll) ? ERROR_RED : null);

// ═══ 1) CONSULTAS GRABADAS: la foto del código de hoy (no se cambia) ═══════════
// Se escribió ANTES de tocar la lib: tabla, columnas, filtros y orden, letra por letra.
const FOTO_CONSULTAS_AVERIAS = [
  { tabla: 'maintenance_requests', ops: [
    ['select', ['machinery_id, material, notes, created_at']],
    ['neq', ['material', 'MÁQUINA PARADA']],
    ['eq', ['status', 'pendiente']],
    ['order', ['created_at', { ascending: false }]],
  ] },
  { tabla: 'maintenance_requests', ops: [
    ['select', ['machinery_id, notes, created_at']],
    ['eq', ['material', 'MÁQUINA PARADA']],
    ['eq', ['status', 'pendiente']],
    ['order', ['created_at', { ascending: false }]],
  ] },
];
const FOTO_CONSULTAS_JORNADAS = [
  { tabla: 'machine_rounds', ops: [
    ['select', ['machinery_id, day_hours, night_hours, jornada_start_at, jornada_marked_at, jornada_shift']],
    ['eq', ['round_date', '2026-10-20']],
  ] },
  { tabla: 'machine_rounds', ops: [
    ['select', ['machinery_id, night_hours, jornada_start_at, jornada_marked_at, jornada_shift']],
    ['eq', ['round_date', '2026-10-19']],
    ['eq', ['jornada_shift', 'night']],
    ['not', ['jornada_start_at', 'is', null]],
  ] },
];
{
  reiniciar(BASE());
  await L.fetchAveriaCat();
  eq('⭐ fetchAveriaCat() hace EXACTAMENTE las dos consultas de siempre', llamadas, FOTO_CONSULTAS_AVERIAS);
  reiniciar(BASE());
  await L.fetchJornadaCat(FECHA);
  eq('⭐ fetchJornadaCat(fecha) hace EXACTAMENTE las dos consultas de siempre', llamadas, FOTO_CONSULTAS_JORNADAS);
}

// ═══ 2) MISMO RESULTADO: la foto del código de hoy (no se cambia) ══════════════
// Con las filas de arriba, y con cada consulta fallando por separado: sin opciones,
// la lib devuelve lo de siempre — y ante un error devuelve lo parcial o `{}` SIN
// lanzar (el «ciego» del que dependen las seis pantallas).
// (Tomada corriendo el código de hoy: ver el respaldo en docs/backups/estado-maquinas-lib-2026-10-25.)
const FOTO_RESULTADOS = {
  averias: {
    M1: { createdMs: 1792411200000, motivo: 'CAUCHO', tipo: 'averia' },
    M2: { createdMs: 1792495800000, motivo: 'recalienta', tipo: 'averia' },
    M3: { createdMs: 1792501200000, motivo: 'NO TRABAJÓ · lluvia', tipo: 'parada' },
    M7: { createdMs: 1792159200000, motivo: 'ELÉCTRICO', tipo: 'averia' },
    M8: { createdMs: 1792490400000, motivo: 'NO TRABAJÓ · sin volqueta', tipo: 'parada' },
  },
  averias_falla_marcadores: {
    M1: { createdMs: 1792411200000, motivo: 'CAUCHO', tipo: 'averia' },
    M2: { createdMs: 1792495800000, motivo: 'recalienta', tipo: 'averia' },
    M7: { createdMs: 1792159200000, motivo: 'ELÉCTRICO', tipo: 'averia' },
  },
  averias_falla_reales: {
    M1: { createdMs: 1792497600000, motivo: 'NO TRABAJÓ · sin volqueta', tipo: 'parada' },
    M3: { createdMs: 1792501200000, motivo: 'NO TRABAJÓ · lluvia', tipo: 'parada' },
    M8: { createdMs: 1792490400000, motivo: 'NO TRABAJÓ · sin volqueta', tipo: 'parada' },
  },
  averias_fallan_las_dos: {},
  jornadas: {
    J1: { dayH: 5, nightH: 0, openStartDay: 1792494000000, openStartNight: null, reactStartDay: 1792503000000, reactStartNight: null },
    J2: { dayH: 0, nightH: 2, openStartDay: null, openStartNight: null, reactStartDay: null, reactStartNight: null },
    J3: { dayH: 0, nightH: 4, openStartDay: null, openStartNight: 1792450800000, reactStartDay: null, reactStartNight: 1792450800000 },
    J6: { dayH: 0, nightH: 0, openStartDay: null, openStartNight: 1792539000000, reactStartDay: null, reactStartNight: 1792539900000 },
    J7: { dayH: 0, nightH: 3, openStartDay: null, openStartNight: 1792450800000, reactStartDay: null, reactStartNight: 1792541400000 },
  },
  jornadas_falla_anoche: {
    J1: { dayH: 5, nightH: 0, openStartDay: 1792494000000, openStartNight: null, reactStartDay: 1792503000000, reactStartNight: null },
    J2: { dayH: 0, nightH: 2, openStartDay: null, openStartNight: null, reactStartDay: null, reactStartNight: null },
    J6: { dayH: 0, nightH: 0, openStartDay: null, openStartNight: 1792539000000, reactStartDay: null, reactStartNight: 1792539900000 },
    J7: { dayH: 0, nightH: 1, openStartDay: null, openStartNight: 1792537200000, reactStartDay: null, reactStartNight: 1792541400000 },
  },
  jornadas_falla_hoy: {
    J3: { dayH: 0, nightH: 4, openStartDay: null, openStartNight: 1792450800000, reactStartDay: null, reactStartNight: 1792450800000 },
    J7: { dayH: 0, nightH: 3, openStartDay: null, openStartNight: 1792450800000, reactStartDay: null, reactStartNight: 1792451100000 },
  },
  jornadas_fallan_las_dos: {},
};
{
  const casos = {
    averias: [() => L.fetchAveriaCat(), () => null],
    averias_falla_reales: [() => L.fetchAveriaCat(), fallaSi(esAveriasReales)],
    averias_falla_marcadores: [() => L.fetchAveriaCat(), fallaSi(esMarcadores)],
    averias_fallan_las_dos: [() => L.fetchAveriaCat(), () => ERROR_RED],
    jornadas: [() => L.fetchJornadaCat(FECHA), () => null],
    jornadas_falla_hoy: [() => L.fetchJornadaCat(FECHA), fallaSi(esRondasHoy)],
    jornadas_falla_anoche: [() => L.fetchJornadaCat(FECHA), fallaSi(esRondasAnoche)],
    jornadas_fallan_las_dos: [() => L.fetchJornadaCat(FECHA), () => ERROR_RED],
  };
  const obtenido = {};
  for (const [nombre, [fn, fallo]] of Object.entries(casos)) {
    reiniciar(BASE(), fallo);
    const r = await intentar(fn);
    obtenido[nombre] = r.error ? `LANZÓ: ${r.error?.message ?? r.error}` : r.valor;
  }
  eq('la foto cubre los mismos casos', Object.keys(casos).sort(), Object.keys(FOTO_RESULTADOS).sort());
  for (const nombre of Object.keys(casos)) {
    eq(`⭐ resultado sin opciones = foto de hoy · ${nombre}`, obtenido[nombre], FOTO_RESULTADOS[nombre]);
  }
}

// ═══ 3) EQUIVALENCIA: con `ids` = leer todo y recortar a esos ids ═══════════════
// El dedupe de las dos lecturas es POR MÁQUINA, así que filtrar en la base no puede
// cambiar lo que sale de cada una. Se prueba con las filas fijas y con juegos al azar.
const recortar = (obj, ids) => Object.fromEntries(Object.entries(obj).filter(([k]) => ids.includes(k)));
function juego(semilla) {
  let s = semilla >>> 0;
  const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const de = (arr) => arr[Math.floor(r() * arr.length)];
  const dos = (n) => String(n).padStart(2, '0');
  const hora = (dia) => `2026-10-${dia}T${dos(Math.floor(r() * 24))}:${dos(Math.floor(r() * 60))}:00-04:00`;
  const MAQ = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'];
  const tickets = Array.from({ length: 40 }, (_, i) => ({
    id: `t${dos(i)}`, machinery_id: de(MAQ), material: de([PARADA, PARADA, 'MOTOR', 'CAUCHO', null]),
    notes: de(['nota a', 'nota b', '', null]), status: de(['pendiente', 'pendiente', 'realizado']),
    created_at: hora(de(['17', '18', '19', '20'])), resolved_at: null,
  }));
  const rondas = Array.from({ length: 40 }, (_, i) => {
    const dia = de(['18', '19', '20']);
    const abierta = r() < 0.6;
    return {
      id: `k${dos(i)}`, machinery_id: de(MAQ), round_date: `2026-10-${dia}`,
      day_hours: Math.floor(r() * 12), night_hours: Math.floor(r() * 12),
      jornada_start_at: abierta ? hora(dia) : null, jornada_marked_at: abierta && r() < 0.5 ? hora(dia) : null,
      jornada_shift: de(['day', 'night', null]),
    };
  });
  return { maintenance_requests: tickets, machine_rounds: rondas };
}
const SUBCONJUNTOS = [['M1'], ['M2', 'M5'], ['M3', 'M4', 'M6', 'M8'], ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'], ['NADA'], ['M7', 'NADA']];
{
  const juegos = [['filas fijas', BASE], ...[1, 2, 3, 4, 5, 6].map((n) => [`juego al azar ${n}`, () => juego(n)])];
  for (const [nombre, filas] of juegos) {
    for (const [fn, etiqueta] of [
      [(op) => (op ? L.fetchAveriaCat(op) : L.fetchAveriaCat()), 'fetchAveriaCat'],
      [(op) => (op ? L.fetchJornadaCat(FECHA, op) : L.fetchJornadaCat(FECHA)), 'fetchJornadaCat'],
    ]) {
      reiniciar(filas());
      const todo = await fn();
      const filtrado = [], recortado = [];
      for (const ids of SUBCONJUNTOS) {
        reiniciar(filas());
        const r = await intentar(() => fn({ ids }));
        filtrado.push(r.error ? `LANZÓ: ${r.error.message}` : r.valor);
        recortado.push(recortar(todo, ids));
      }
      eq(`⭐ ${etiqueta}({ ids }) = ${etiqueta}() recortado · ${nombre}`, filtrado, recortado);
    }
  }
  // Las máquinas que no tienen filas no aparecen.
  reiniciar(BASE());
  eq('ids sin filas → {}', (await intentar(() => L.fetchAveriaCat({ ids: ['NADA', 'OTRA'] }))).valor, {});

  // El filtro va ANTES del orden y lo demás de la cadena no cambia.
  const conIn = (foto, ids) => foto.map((c) => {
    const i = c.ops.findIndex(([v]) => v === 'order');
    const ops = [...c.ops];
    ops.splice(i < 0 ? ops.length : i, 0, ['in', ['machinery_id', ids]]);
    return { tabla: c.tabla, ops };
  });
  reiniciar(BASE());
  await intentar(() => L.fetchAveriaCat({ ids: ['M1', 'M2'] }));
  eq('⭐ con ids, las consultas de averías son las de siempre + .in(machinery_id) antes del orden',
    llamadas, conIn(FOTO_CONSULTAS_AVERIAS, ['M1', 'M2']));
  reiniciar(BASE());
  await intentar(() => L.fetchJornadaCat(FECHA, { ids: ['J1'] }));
  eq('⭐ con ids, las consultas de jornadas son las de siempre + .in(machinery_id)',
    llamadas, conIn(FOTO_CONSULTAS_JORNADAS, ['J1']));

  // `ids: []` → {} y CERO consultas (aunque la base esté caída, y aunque sea estricto).
  for (const op of [{ ids: [] }, { ids: [], estricto: true }]) {
    reiniciar(BASE(), () => ERROR_RED);
    const a = await intentar(() => L.fetchAveriaCat(op));
    const nA = llamadas.length;
    reiniciar(BASE(), () => ERROR_RED);
    const j = await intentar(() => L.fetchJornadaCat(FECHA, op));
    const nJ = llamadas.length;
    eq(`⭐ ids: [] → {} sin consultar · ${JSON.stringify(op)}`,
      { averias: a.valor ?? `LANZÓ: ${a.error?.message}`, consultasAverias: nA, jornadas: j.valor ?? `LANZÓ: ${j.error?.message}`, consultasJornadas: nJ },
      { averias: {}, consultasAverias: 0, jornadas: {}, consultasJornadas: 0 });
  }
}

// ═══ 4) ESTRICTO: si una consulta falla, LANZA en español; si no, nada cambia ═══
const MSJ_LECTURA = 'No se pudo leer el estado de inspección';
const lanzaEnEspanol = (r) => !!r.error && r.error instanceof Error && String(r.error.message).startsWith(MSJ_LECTURA);
{
  for (const [nombre, pred, fn] of [
    ['falla la de averías reales', esAveriasReales, () => L.fetchAveriaCat({ estricto: true })],
    ['falla la de marcadores', esMarcadores, () => L.fetchAveriaCat({ estricto: true })],
    ['falla la de hoy', esRondasHoy, () => L.fetchJornadaCat(FECHA, { estricto: true })],
    ['falla la de anoche', esRondasAnoche, () => L.fetchJornadaCat(FECHA, { estricto: true })],
    ['falla con ids', esAveriasReales, () => L.fetchAveriaCat({ ids: ['M1'], estricto: true })],
  ]) {
    reiniciar(BASE(), fallaSi(pred));
    const r = await intentar(fn);
    ok(`⭐ estricto lanza «${MSJ_LECTURA}…» · ${nombre}`, lanzaEnEspanol(r));
  }
  // Sin error, estricto devuelve LO MISMO y hace las MISMAS consultas.
  reiniciar(BASE());
  const a = await intentar(() => L.fetchAveriaCat({ estricto: true }));
  eq('⭐ fetchAveriaCat({ estricto }) sin errores = foto de hoy', a.valor, FOTO_RESULTADOS.averias);
  eq('…con las mismas consultas', llamadas, FOTO_CONSULTAS_AVERIAS);
  reiniciar(BASE());
  const j = await intentar(() => L.fetchJornadaCat(FECHA, { estricto: true }));
  eq('⭐ fetchJornadaCat(fecha, { estricto }) sin errores = foto de hoy', j.valor, FOTO_RESULTADOS.jornadas);
  eq('…con las mismas consultas', llamadas, FOTO_CONSULTAS_JORNADAS);
  reiniciar(BASE());
  const aIds = await intentar(() => L.fetchAveriaCat({ ids: ['M2', 'M3'], estricto: true }));
  eq('estricto + ids = foto recortada', aIds.valor, recortar(FOTO_RESULTADOS.averias, ['M2', 'M3']));
  // `estricto: false` explícito sigue siendo el «ciego» de siempre.
  reiniciar(BASE(), fallaSi(esAveriasReales));
  const ciego = await intentar(() => L.fetchAveriaCat({ estricto: false }));
  eq('estricto: false con error = lo parcial de siempre, sin lanzar', ciego.valor, FOTO_RESULTADOS.averias_falla_reales);
  // El mensaje lleva el detalle de la base si lo hay; si no, queda la frase sola (nunca «[object Object]»).
  reiniciar(BASE(), () => ({ code: '57014' }));
  const sinDetalle = await intentar(() => L.fetchJornadaCat(FECHA, { estricto: true }));
  eq('error sin mensaje → la frase sola', sinDetalle.error?.message, `${MSJ_LECTURA}.`);
  reiniciar(BASE(), fallaSi(esMarcadores));
  const conDetalle = await intentar(() => L.fetchAveriaCat({ estricto: true }));
  eq('error con mensaje → la frase + el detalle', conDetalle.error?.message, `${MSJ_LECTURA}: ${ERROR_RED.message}`);
}

// ═══ 5) HECHOS NUEVOS DE INSPECCIÓN (D1) ═══════════════════════════════════════
// Hecho = avería REAL creada · avería REAL resuelta · jornada con `jornada_marked_at`,
// POSTERIOR a `desde`. Nunca los marcadores (crearlos, resolverlos ni reabrirlos), ni
// `jornada_start_at` (anclado a 7 a. m. / 7 p. m.; lo ponían también los crons).
const DESDE = '2026-10-20T08:00:00-04:00';
const t = (iso) => Date.parse(iso);
const TICKETS_HECHOS = [
  // A1: solo marcadores después de `desde` (creado, resuelto, reabierto) → NO es hecho.
  { id: 'h01', machinery_id: 'A1', material: PARADA, notes: 'NO TRABAJÓ', status: 'pendiente', created_at: '2026-10-20T09:00:00-04:00', resolved_at: null },
  { id: 'h02', machinery_id: 'A1', material: PARADA, notes: 'NO TRABAJÓ', status: 'realizado', created_at: '2026-10-19T08:00:00-04:00', resolved_at: '2026-10-20T10:00:00-04:00' },
  { id: 'h03', machinery_id: 'A1', material: PARADA, notes: 'NO TRABAJÓ · reabierta', status: 'pendiente', created_at: '2026-10-19T07:00:00-04:00', resolved_at: null },
  // A2: avería real creada después → hecho «averia_creada».
  { id: 'h04', machinery_id: 'A2', material: 'MOTOR', notes: 'humo', status: 'pendiente', created_at: '2026-10-20T09:15:00-04:00', resolved_at: null },
  // A3: avería real vieja, resuelta después → hecho «averia_resuelta» (motivo = material si no hay nota).
  { id: 'h05', machinery_id: 'A3', material: 'FRENOS', notes: null, status: 'realizado', created_at: '2026-10-18T09:00:00-04:00', resolved_at: '2026-10-20T11:00:00-04:00' },
  // A4: justo EN `desde` y antes de `desde` → NO (tiene que ser posterior).
  { id: 'h06', machinery_id: 'A4', material: 'CAUCHO', notes: 'espichado', status: 'pendiente', created_at: '2026-10-20T08:00:00-04:00', resolved_at: null },
  { id: 'h07', machinery_id: 'A4', material: 'CAUCHO', notes: 'otro', status: 'realizado', created_at: '2026-10-19T08:00:00-04:00', resolved_at: '2026-10-20T07:59:00-04:00' },
  // A5: creada y resuelta después (misma fila) + jornada en el medio → el MÁS RECIENTE: la resolución.
  { id: 'h08', machinery_id: 'A5', material: 'CAUCHO', notes: 'cambio de caucho', status: 'realizado', created_at: '2026-10-20T09:00:00-04:00', resolved_at: '2026-10-20T12:00:00-04:00' },
  // A9: avería creada después, y una jornada aún más tarde → gana la jornada.
  { id: 'h09', machinery_id: 'A9', material: 'MOTOR', notes: 'ruido', status: 'pendiente', created_at: '2026-10-20T09:00:00-04:00', resolved_at: null },
  // A10: tiene hecho, pero NO está entre los ids pedidos.
  { id: 'h10', machinery_id: 'A10', material: 'MOTOR', notes: 'ajena', status: 'pendiente', created_at: '2026-10-20T09:00:00-04:00', resolved_at: null },
  // A11: material vacío → ni avería real ni marcador (igual que fetchAveriaCat): NO.
  { id: 'h11', machinery_id: 'A11', material: null, notes: 'sin material', status: 'pendiente', created_at: '2026-10-20T09:00:00-04:00', resolved_at: null },
];
const RONDAS_HECHOS = [
  { id: 'q01', machinery_id: 'A5', round_date: '2026-10-20', jornada_start_at: '2026-10-20T07:00:00-04:00', jornada_marked_at: '2026-10-20T10:00:00-04:00', jornada_shift: 'day' },
  // A6: solo jornada_start_at (sin persona que la marcara) → NO.
  { id: 'q02', machinery_id: 'A6', round_date: '2026-10-20', jornada_start_at: '2026-10-20T09:00:00-04:00', jornada_marked_at: null, jornada_shift: 'day' },
  // A7: start anclado a las 7 (antes de `desde`), marcada a las 9:30 → SÍ, a las 9:30.
  { id: 'q03', machinery_id: 'A7', round_date: '2026-10-20', jornada_start_at: '2026-10-20T07:00:00-04:00', jornada_marked_at: '2026-10-20T09:30:00-04:00', jornada_shift: 'day' },
  // A8: marcada antes de `desde` (aunque su start sea posterior) → NO.
  { id: 'q04', machinery_id: 'A8', round_date: '2026-10-20', jornada_start_at: '2026-10-20T19:00:00-04:00', jornada_marked_at: '2026-10-20T07:00:00-04:00', jornada_shift: 'night' },
  { id: 'q05', machinery_id: 'A9', round_date: '2026-10-20', jornada_start_at: '2026-10-20T07:00:00-04:00', jornada_marked_at: '2026-10-20T13:00:00-04:00', jornada_shift: 'day' },
];
const IDS_HECHOS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A11'];
const BASE_HECHOS = () => ({ maintenance_requests: TICKETS_HECHOS, machine_rounds: RONDAS_HECHOS });
{
  ok('existe fetchNovedadesInspeccion', typeof L.fetchNovedadesInspeccion === 'function');
  const nov = async (...args) => intentar(() => L.fetchNovedadesInspeccion(...args));

  reiniciar(BASE_HECHOS());
  const r = await nov(IDS_HECHOS, DESDE);
  eq('⭐ el hecho MÁS RECIENTE posterior a desde, por máquina (y solo esos)', r.valor ?? `LANZÓ: ${r.error?.message}`, {
    A2: { ms: t('2026-10-20T09:15:00-04:00'), que: 'averia_creada', motivo: 'humo' },
    A3: { ms: t('2026-10-20T11:00:00-04:00'), que: 'averia_resuelta', motivo: 'FRENOS' },
    A5: { ms: t('2026-10-20T12:00:00-04:00'), que: 'averia_resuelta', motivo: 'cambio de caucho' },
    A7: { ms: t('2026-10-20T09:30:00-04:00'), que: 'jornada', motivo: null },
    A9: { ms: t('2026-10-20T13:00:00-04:00'), que: 'jornada', motivo: null },
  });
  const v = r.valor ?? {};
  ok('⭐ marcador creado, resuelto o reabierto después de su marca → NO es hecho (A1)', !('A1' in v));
  ok('⭐ ronda con solo jornada_start_at → NO es hecho (A6)', !('A6' in v));
  ok('⭐ el instante exacto de desde, o antes → NO (A4, A8)', !('A4' in v) && !('A8' in v));
  ok('una máquina que no se pidió no aparece (A10)', !('A10' in v));

  // Solo LEE, y solo lo que debe: tres lecturas, sin marcadores ni jornada_start_at.
  const verbos = new Set(llamadas.flatMap((ll) => ll.ops.map(([vb]) => vb)));
  eq('⭐ solo select (+ filtros, orden y páginas) sobre maintenance_requests y machine_rounds', {
    tablas: [...new Set(llamadas.map((ll) => ll.tabla))].sort(),
    verbosProhibidos: [...verbos].filter((vb) => !['select', 'in', 'neq', 'gt', 'order', 'range'].includes(vb)),
  }, { tablas: ['machine_rounds', 'maintenance_requests'], verbosProhibidos: [] });
  eq('tres lecturas (averías creadas, averías resueltas, jornadas)', llamadas.map((ll) => ll.tabla),
    ['maintenance_requests', 'maintenance_requests', 'machine_rounds']);
  const tickets = llamadas.filter((ll) => ll.tabla === 'maintenance_requests');
  ok('⭐ las dos de tickets dejan fuera el marcador', tickets.length === 2 && tickets.every((ll) => tieneOp(ll, 'neq', 'material', PARADA)));
  ok('…una por created_at y otra por resolved_at, posteriores a desde',
    tickets.some((ll) => tieneOp(ll, 'gt', 'created_at', DESDE)) && tickets.some((ll) => tieneOp(ll, 'gt', 'resolved_at', DESDE)));
  const ronda = llamadas.find((ll) => ll.tabla === 'machine_rounds');
  ok('⭐ la de rondas mira jornada_marked_at y NUNCA jornada_start_at',
    !!ronda && tieneOp(ronda, 'gt', 'jornada_marked_at', DESDE) && !JSON.stringify(ronda.ops).includes('jornada_start_at'));
  ok('las tres filtran por los ids pedidos', llamadas.length === 3 && llamadas.every((ll) => tieneOp(ll, 'in', 'machinery_id', IDS_HECHOS)));

  // Siempre estricta: si falla CUALQUIERA de las tres, lanza en español.
  for (const [nombre, pred] of [
    ['averías creadas', (ll) => JSON.stringify(ll.ops).includes('"created_at"') && ll.tabla === 'maintenance_requests'],
    ['averías resueltas', (ll) => JSON.stringify(ll.ops).includes('"resolved_at"')],
    ['jornadas', (ll) => ll.tabla === 'machine_rounds'],
  ]) {
    reiniciar(BASE_HECHOS(), fallaSi(pred));
    ok(`⭐ si falla la lectura de ${nombre}, lanza «${MSJ_LECTURA}…»`, lanzaEnEspanol(await nov(IDS_HECHOS, DESDE)));
  }
  // ids: [] → {} sin consultar (aunque la base esté caída).
  reiniciar(BASE_HECHOS(), () => ERROR_RED);
  const vacio = await nov([], DESDE);
  eq('⭐ ids: [] → {} sin consultar', { valor: vacio.valor ?? `LANZÓ: ${vacio.error?.message}`, consultas: llamadas.length }, { valor: {}, consultas: 0 });
  // Una fecha que no es fecha no se manda a la base.
  reiniciar(BASE_HECHOS());
  const malaFecha = await nov(['A2'], 'ayer');
  ok('desde inválido → lanza en español sin consultar', !!malaFecha.error && malaFecha.error instanceof Error && /fecha/i.test(malaFecha.error.message) && llamadas.length === 0);
  // Pagina como selectAllRows: un hecho en la SEGUNDA página no se pierde.
  const muchas = Array.from({ length: 1001 }, (_, i) => ({
    id: `p${String(i).padStart(4, '0')}`, machinery_id: 'P1', round_date: '2026-10-20', jornada_start_at: null, jornada_shift: 'day',
    jornada_marked_at: new Date(t('2026-10-20T08:01:00-04:00') + i * 1000).toISOString(),
  }));
  reiniciar({ maintenance_requests: [], machine_rounds: muchas });
  const pag = await nov(['P1'], DESDE);
  eq('⭐ pagina: el hecho más reciente estaba en la segunda página', pag.valor?.P1?.ms, t('2026-10-20T08:01:00-04:00') + 1000 * 1000);

  // ⭐ A2 (lote 6): la ventana POR MÁQUINA: cada una trae solo lo posterior a SU marca, en las
  //    mismas tres consultas (con .or en vez del .gt común).
  reiniciar(BASE_HECHOS());
  const porMaq = await nov(['A2', 'A3', 'A9'], { A2: '2026-10-20T09:30:00-04:00', A3: '2026-10-20T08:00:00-04:00', A9: '2026-10-20T12:30:00-04:00' });
  eq('⭐ A2: desde POR MÁQUINA → A2 (avería 09:15 ≤ su marca 09:30) nada; A3 sí; A9 solo la jornada de las 13:00 (su avería de las 09:00 es anterior a su marca)',
    porMaq.valor ?? `LANZÓ: ${porMaq.error?.message}`, {
      A3: { ms: t('2026-10-20T11:00:00-04:00'), que: 'averia_resuelta', motivo: 'FRENOS' },
      A9: { ms: t('2026-10-20T13:00:00-04:00'), que: 'jornada', motivo: null },
    });
  eq('A2: * siguen siendo tres lecturas, filtradas por los ids, sin .gt común', [llamadas.map((ll) => ll.tabla), llamadas.every((ll) => tieneOp(ll, 'in', 'machinery_id', ['A2', 'A3', 'A9']) && !ll.ops.some(([vb]) => vb === 'gt'))],
    [['maintenance_requests', 'maintenance_requests', 'machine_rounds'], true]);
  eq('⭐ A2: * cada máquina con su ventana en el .or (fechas ISO entre comillas: PostgREST las pide por sus «:» y «.»)',
    llamadas.map((ll) => ll.ops.find(([vb]) => vb === 'or')?.[1]?.[0]), [
      'and(machinery_id.eq.A2,created_at.gt."2026-10-20T13:30:00.000Z"),and(machinery_id.eq.A3,created_at.gt."2026-10-20T12:00:00.000Z"),and(machinery_id.eq.A9,created_at.gt."2026-10-20T16:30:00.000Z")',
      'and(machinery_id.eq.A2,resolved_at.gt."2026-10-20T13:30:00.000Z"),and(machinery_id.eq.A3,resolved_at.gt."2026-10-20T12:00:00.000Z"),and(machinery_id.eq.A9,resolved_at.gt."2026-10-20T16:30:00.000Z")',
      'and(machinery_id.eq.A2,jornada_marked_at.gt."2026-10-20T13:30:00.000Z"),and(machinery_id.eq.A3,jornada_marked_at.gt."2026-10-20T12:00:00.000Z"),and(machinery_id.eq.A9,jornada_marked_at.gt."2026-10-20T16:30:00.000Z")',
    ]);
  ok('A2: * las dos de tickets siguen dejando fuera el marcador', llamadas.filter((ll) => ll.tabla === 'maintenance_requests').every((ll) => tieneOp(ll, 'neq', 'material', PARADA)));
  reiniciar(BASE_HECHOS());
  const sinFecha = await nov(['A2', 'A3'], { A2: '2026-10-20T09:30:00-04:00' });
  ok('A2: a una máquina le falta su fecha → lanza en español sin consultar', !!sinFecha.error && /fecha/i.test(sinFecha.error.message) && llamadas.length === 0);
  reiniciar(BASE_HECHOS());
  const idRaro = await nov(['A2,x'], { 'A2,x': '2026-10-20T09:30:00-04:00' });
  ok('A2: un id con coma o paréntesis (cambiaría el filtro) → lanza sin consultar', !!idRaro.error && /id de una máquina/.test(idRaro.error.message) && llamadas.length === 0);

  // ⭐ A1 (lote 6): un hecho con hora FUTURA (reloj adelantado, fila fantasma) se APLAZA: no
  //    cuenta hasta que llegue su hora; queda el hecho legítimo anterior. Dentro del margen sí cuenta.
  ok('A1: la lib exporta el margen (10 min)', L.MARGEN_HORA_FUTURA_MS === 10 * 60 * 1000);
  const FUTURA = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const CASI_AHORA = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  reiniciar({ maintenance_requests: [
    { id: 'f0', machinery_id: 'F3', material: 'MOTOR', notes: 'de mañana', status: 'pendiente', created_at: FUTURA, resolved_at: null },
  ], machine_rounds: [
    { id: 'f1', machinery_id: 'F1', round_date: '2026-10-20', jornada_start_at: null, jornada_marked_at: FUTURA, jornada_shift: 'day' },
    { id: 'f2', machinery_id: 'F1', round_date: '2026-10-20', jornada_start_at: null, jornada_marked_at: '2026-10-20T09:00:00-04:00', jornada_shift: 'day' },
    { id: 'f3', machinery_id: 'F2', round_date: '2026-10-20', jornada_start_at: null, jornada_marked_at: CASI_AHORA, jornada_shift: 'day' },
  ] });
  const fut = await nov(['F1', 'F2', 'F3'], DESDE);
  eq('⭐ A1: un hecho con hora futura (2 h adelante) se aplaza y queda el legítimo anterior', fut.valor?.F1, { ms: t('2026-10-20T09:00:00-04:00'), que: 'jornada', motivo: null });
  ok('A1: * una avería «de mañana» tampoco cuenta todavía (F3 sin hecho)', !!fut.valor && !('F3' in fut.valor));
  eq('A1: * dentro del margen (5 min adelante) sí cuenta', fut.valor?.F2?.ms, Date.parse(CASI_AHORA));
  reiniciar({ maintenance_requests: [], machine_rounds: [{ id: 'f1', machinery_id: 'F1', round_date: '2026-10-20', jornada_start_at: null, jornada_marked_at: FUTURA, jornada_shift: 'day' }] });
  const futPorMaq = await nov(['F1'], { F1: DESDE });
  ok('A1: * también con la ventana por máquina', !!futPorMaq.valor && !('F1' in futPorMaq.valor));
}

// ═══ 6) LAS CINCO PRUEBAS QUE YA TENÍA LA LIB, SIN TOCARLAS ═══════════════════
for (const nombre of ['test-conteo-estados-reales', 'test-estado-averia-arrastrada', 'test-estado-transferida', 'test-frentes-estado-vivo', 'test-por-empresa-estados']) {
  const r = spawnSync(process.execPath, [path.join(HERE, `${nombre}.mjs`)], { cwd: ROOT, encoding: 'utf8' });
  ok(`⭐ ${nombre} sigue en verde`, r.status === 0);
  if (r.status !== 0) failures.push(`   salida de ${nombre}:\n${(r.stdout + r.stderr).split('\n').slice(-15).join('\n')}`);
}

// ═══ 7) CANDADOS ═══════════════════════════════════════════════════════════════
{
  const lib = leer('src/lib/machineLiveStatus.ts');
  // (i) «recibe, no envía»: la lib no escribe nada.
  eq('⭐ la lib no contiene escrituras ni rpc',
    ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc('].filter((x) => lib.includes(x)), []);
  // El literal del marcador vive en UNA constante, que usan fetchAveriaCat y la función nueva.
  eq('⭐ el literal del marcador aparece UNA vez (la constante MARCADOR_PARADA)',
    [...lib.matchAll(/MÁQUINA PARADA'/g)].length, 1);
  ok('…y es la constante', /const MARCADOR_PARADA = 'MÁQUINA PARADA';/.test(lib));
  ok('…y la usan las consultas', (lib.match(/'material', MARCADOR_PARADA\)/g) ?? []).length >= 4);
  // Lo que no se toca, no se toca: los tipos y todo desde fetchInspByShift hasta el final.
  const huella = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const tipos = lib.slice(lib.indexOf('export type JornadaEntry'), lib.indexOf('// ── Fetchers'));
  const cola = lib.slice(lib.indexOf('/** Inspector ASIGNADO'));
  // Si algún día se cambian A PROPÓSITO, se actualiza la huella con el nuevo texto.
  eq('⭐ los tipos de siempre no cambiaron (JornadaEntry, AveriaEntry, LiveStatus…)', huella(tipos),
    '02631fee3596b3da68229c9a397b2404d5e73df72fc40e4a732aa5471967e6f6');
  eq('⭐ fetchInspByShift, makeLiveStatusOf, estadoConteoDe, bucketMachineStatus y ESTADO_CONTEO_* no cambiaron',
    huella(cola), 'e3038c8cbbcccf0a9ee12f672e783a8c9b8f88f7b34a421b1aebc338a1904d74');
  // Las SEIS pantallas siguen llamando SIN argumentos (M9). El módulo (centroOperaciones*)
  // es el único que puede pasar opciones.
  const SEIS = {
    'src/screens/EquiposScreen.tsx': 2,
    'src/screens/DashboardScreen.tsx': 2,
    'src/screens/ReportsScreen.tsx': 2,
    'src/components/FrentesReportesCard.tsx': 2,
    'src/screens/UsersScreen.tsx': 2,
    'src/screens/ViajesCamionesScreen.tsx': 2,
  };
  for (const [rel, n] of Object.entries(SEIS)) {
    const src = leer(rel);
    eq(`⭐ ${rel}: sus llamadas siguen sin argumentos`,
      { sinArgs: (src.match(/fetch(?:AveriaCat|JornadaCat)\(\)/g) ?? []).length, conArgs: (src.match(/fetch(?:AveriaCat|JornadaCat)\([^)]/g) ?? []).length },
      { sinArgs: n, conArgs: 0 });
  }
  const archivos = [];
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) recorrer(rel);
      else if (/\.(ts|tsx)$/.test(e.name)) archivos.push(rel);
    }
  };
  recorrer('src');
  const conOpciones = archivos.filter((rel) => rel !== 'src/lib/machineLiveStatus.ts' && !/centroOperaciones/i.test(rel))
    .filter((rel) => /fetch(?:AveriaCat|JornadaCat)\([^)]/.test(leer(rel)) || leer(rel).includes('fetchNovedadesInspeccion'));
  eq('⭐ fuera del Centro de Operaciones nadie pasa opciones ni llama fetchNovedadesInspeccion', conOpciones, []);
}

if (fail) {
  console.error(failures.join('\n'));
  console.error(`\n❌ test-live-status-lectura · ${fail} fallo(s), ${pass} ok`);
  process.exit(1);
}
console.log(`✅ test-live-status-lectura · ${pass} pruebas ok`);
