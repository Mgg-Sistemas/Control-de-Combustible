/*
 * ════════════════════════════════════════════════════════════════════════════
 * ⛏️ UN CAMIÓN CON VARIOS FRENTES, Y EL CATÁLOGO EDITABLE — 30-sep-2026.
 *
 * Pedido del cliente, textual:
 *   «permite que un camion pueda tener varios frentes y ademas permite que el
 *    usuario pueda borrar, editar y agregar mas frentes o modificar lo que ya
 *    tiene el camion»
 *
 * ── QUÉ LO IMPEDÍA ─────────────────────────────────────────────────────────
 * `viaje_frente_asignaciones` tenía UNIQUE (jornada, machinery_id) y el código
 * hacía `upsert` por esa llave: ponerle un segundo frente a un camión PISABA el
 * primero EN SILENCIO. Y el catálogo solo dejaba crear y apagar.
 *
 * ── LO QUE FIJA ESTA SUITE ─────────────────────────────────────────────────
 * ⭐ EL MAPA GUARDA UNA LISTA. Un camión puede recoger en dos frentes la misma
 *    jornada y los dos son verdad.
 *
 * ⭐ CON VARIOS FRENTES NO SE ADIVINA EL DEL VIAJE. Un viaje se carga en UN
 *    frente; si el camión tuvo dos ese día, el sistema NO sabe en cuál se cargó
 *    ESTE viaje. Se deja vacío y se cuenta aparte (`ambiguos`). Inventar el
 *    origen del material es peor que dejarlo en blanco: ese dato termina en el
 *    papel de PAGO, que se agrupa por frente.
 *
 * ⭐ CON UN SOLO FRENTE TODO SIGUE IGUAL QUE ANTES. Es el caso normal y no se
 *    puede romper por darle de comer al nuevo: los viajes sin frente lo siguen
 *    tomando solos.
 *
 * ⭐ EL HISTORIAL CUENTA CAMIONES DISTINTOS, NO FILAS. Contando filas, un día
 *    con 9 camiones diría «14» porque algunos tienen varios frentes.
 *
 * ⚠️ RENOMBRAR Y BORRAR NO TOCAN LOS VIAJES YA REGISTRADOS: cada viaje guardó
 *    el NOMBRE congelado. Un papel ya impreso y un pago ya hecho no cambian
 *    porque alguien corrigió una letra hoy.
 *
 *   node scripts/test-frentes-varios.mjs
 * ════════════════════════════════════════════════════════════════════════════
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

const cache = new Map();
function cargarAbs(abs) {
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return cargarAbs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}
const cargar = (rel) => cargarAbs(path.join(ROOT, rel));
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const A = cargar('src/lib/frentesAuto.ts');
const R = cargar('src/lib/frentesReporte.ts');
const { mapaAsignaciones, frentesDe, completarFrentes, CAMPOS_VIAJE_ROW, CAMPOS_VIAJE_PAGO } = A;

const asig = (machineryId, frenteId, frenteNombre, jornada = '2026-09-30') =>
  ({ jornada, machineryId, frenteId, frenteNombre });
// La jornada de negocio va de 7am a 7am; acá basta recortar el día.
const jornadaDe = (iso) => String(iso).slice(0, 10);

// ── 1) EL MAPA GUARDA VARIOS ────────────────────────────────────────────────
const MAPA = mapaAsignaciones([
  asig('cam-1', 'f-norte', 'Frente norte'),
  asig('cam-1', 'f-sur', 'Frente sur'),
  asig('cam-2', 'f-norte', 'Frente norte'),
]);
eq('⭐ un camión puede tener dos frentes el mismo día',
  frentesDe(MAPA, '2026-09-30', 'cam-1').map((a) => a.frenteNombre), ['Frente norte', 'Frente sur']);
eq('el que tiene uno sigue teniendo uno',
  frentesDe(MAPA, '2026-09-30', 'cam-2').map((a) => a.frenteNombre), ['Frente norte']);
eq('un camión sin asignar no tiene ninguno', frentesDe(MAPA, '2026-09-30', 'cam-9'), []);
eq('otro día tampoco', frentesDe(MAPA, '2026-10-01', 'cam-1'), []);
// ⚠️ La repetida se descarta: la base la impide, pero dos pantallas asignando a
//    la vez podrían colarla, y duplicada contaría dos veces al camión.
eq('⚠️ el mismo frente dos veces cuenta una',
  frentesDe(mapaAsignaciones([asig('cam-1', 'f-norte', 'Frente norte'), asig('cam-1', 'f-norte', 'Frente norte')]),
    '2026-09-30', 'cam-1').length, 1);
eq('la basura se ignora igual que antes',
  mapaAsignaciones([{ jornada: '2026-09-30', machineryId: 'cam-1', frenteId: '', frenteNombre: 'X' }]).size, 0);
eq('nada no revienta', mapaAsignaciones(null).size, 0);

// ── 2) EL FRENTE DEL VIAJE: con UNO se completa, con VARIOS no se adivina ───
const viaje = (machineryId, hora = 'T14:00:00.000Z', extra = {}) =>
  ({ machineryId, registeredAt: `2026-09-30${hora}`, frenteId: null, frenteNombre: null, ...extra });

const r1 = completarFrentes([viaje('cam-2')], MAPA, jornadaDe, CAMPOS_VIAJE_ROW);
eq('⭐ con UN frente, el viaje lo toma solo (como siempre)', r1.filas[0].frenteNombre, 'Frente norte');
eq('...y se cuenta como completado', [r1.completados, r1.ambiguos], [1, 0]);

const r2 = completarFrentes([viaje('cam-1')], MAPA, jornadaDe, CAMPOS_VIAJE_ROW);
eq('⭐ con DOS frentes NO se le inventa uno', r2.filas[0].frenteNombre, null);
eq('⭐ ...y se cuenta aparte, para poder avisarlo', [r2.completados, r2.ambiguos], [0, 1]);
ok('⚠️ no se le puso NINGUNO de los dos (ni el primero)',
  !r2.filas[0].frenteId && !r2.filas[0].frenteNombre);

// ⚠️ Lo congelado sigue mandando, tenga el camión uno o diez frentes.
const r3 = completarFrentes(
  [viaje('cam-1', 'T14:00:00.000Z', { frenteId: 'f-mio', frenteNombre: 'El que le pusieron a mano' })],
  MAPA, jornadaDe, CAMPOS_VIAJE_ROW);
eq('⚠️ un viaje que ya trae frente no se toca', r3.filas[0].frenteNombre, 'El que le pusieron a mano');
eq('...y no cuenta ni como completado ni como ambiguo', [r3.completados, r3.ambiguos], [0, 0]);

// El reporte de PAGO lee las filas crudas: la regla tiene que ser la MISMA, o
// la pantalla y el papel del pago dirían cosas distintas del mismo viaje.
const pago = (machinery_id) => ({ machinery_id, registered_at: '2026-09-30T14:00:00.000Z', frente_nombre: '' });
eq('⭐ el papel de pago usa la misma regla: con uno completa',
  completarFrentes([pago('cam-2')], MAPA, jornadaDe, CAMPOS_VIAJE_PAGO).filas[0].frente_nombre, 'Frente norte');
eq('⭐ ...y con varios deja vacío',
  completarFrentes([pago('cam-1')], MAPA, jornadaDe, CAMPOS_VIAJE_PAGO).filas[0].frente_nombre, '');

eq('sin asignaciones no cambia nada',
  completarFrentes([viaje('cam-1')], new Map(), jornadaDe, CAMPOS_VIAJE_ROW).completados, 0);
eq('sin viajes, cero', completarFrentes([], MAPA, jornadaDe, CAMPOS_VIAJE_ROW).ambiguos, 0);
eq('un camión fuera del catálogo no tiene a qué agarrarse',
  completarFrentes([viaje(null)], MAPA, jornadaDe, CAMPOS_VIAJE_ROW).completados, 0);

// ── 3) EL HISTORIAL CUENTA CAMIONES, NO FILAS ───────────────────────────────
const h = R.historialFrentes([
  { jornada: '2026-09-30', frenteNombre: 'Frente norte', machineryId: 'cam-1' },
  { jornada: '2026-09-30', frenteNombre: 'Frente sur', machineryId: 'cam-1' },
  { jornada: '2026-09-30', frenteNombre: 'Frente norte', machineryId: 'cam-2' },
]);
eq('⭐ el día tiene 2 camiones, aunque sean 3 asignaciones', h[0].camiones, 2);
eq('y cada frente cuenta los suyos',
  h[0].frentes, [{ nombre: 'Frente norte', camiones: 2 }, { nombre: 'Frente sur', camiones: 1 }]);
// ⚠️ El mismo camión repetido en un frente no cuenta dos veces.
eq('⚠️ un camión repetido en el mismo frente cuenta una vez',
  R.historialFrentes([
    { jornada: '2026-09-30', frenteNombre: 'N', machineryId: 'cam-1' },
    { jornada: '2026-09-30', frenteNombre: 'N', machineryId: 'cam-1' },
  ])[0].camiones, 1);
// Sin machineryId (como se llamaba antes) cada fila vale un camión: no se rompe.
eq('sin id de camión, cada fila cuenta como uno (como antes)',
  R.historialFrentes([
    { jornada: '2026-09-30', frenteNombre: 'N' },
    { jornada: '2026-09-30', frenteNombre: 'N' },
  ])[0].camiones, 2);
eq('sin nada, historial vacío', R.historialFrentes([]), []);

// ── 4) LA HOJA DEL DÍA: el camión sale en SUS DOS frentes ───────────────────
const grupos = R.frentesDelDia([
  { frenteNombre: 'Frente norte', camion: { code: 'V-01' } },
  { frenteNombre: 'Frente sur', camion: { code: 'V-01' } },
  { frenteNombre: 'Frente norte', camion: { code: 'V-02' } },
]);
eq('⭐ el camión con dos frentes sale en los dos',
  grupos.map((g) => [g.nombre, g.camiones.map((c) => c.code)]),
  [['Frente norte', ['V-01', 'V-02']], ['Frente sur', ['V-01']]]);

// ── 5) LA PANTALLA ──────────────────────────────────────────────────────────
const ui = sinComentarios(leer('src/components/FrentesTrabajo.tsx'));
ok('⭐ se pueden marcar VARIOS frentes a la vez', /frenteSel, setFrenteSel\] = useState<Set<string>>/.test(ui));
ok('⭐ el catálogo deja renombrar', /renombrarFrente\(/.test(ui));
ok('⭐ ...y borrar', /borrarFrente\(/.test(ui));
ok('⭐ borrar dice ANTES cuántas asignaciones se lleva', /contarAsignacionesFrente\(/.test(ui));
// ⚠️ La confirmación NO puede ser un confirm() del navegador: dentro de un
//    Modal a pantalla completa queda tapado y la pantalla parece colgada.
ok('⚠️ la confirmación de borrar va EN LÍNEA, no en un confirm()',
  /borrando\?\.id === f\.id/.test(ui) && !/window\.confirm|useConfirm\(/.test(ui));
ok('⭐ la ✕ quita UN frente del camión, no todos',
  /quitarAsignacionFrente\(fecha, a\.machineryId, a\.frenteId\)/.test(ui));
ok('el buscador muestra TODOS los frentes que ya tiene el camión',
  /ya\.map\(\(a\) => a\.frenteNombre\)\.join/.test(ui));

const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
ok('⭐ al registrar, con VARIOS frentes no se precarga ninguno',
  /if \(l\.length !== 1\) return \{ frenteId: null, frenteNombre: null \}/.test(scr));

// ── 6) EL SQL QUE QUITA EL CANDADO ──────────────────────────────────────────
const sql = leer('supabase/frentes_varios_por_camion.sql');
ok('⭐ el SQL quita el único de jornada+camión',
  /drop constraint if exists viaje_frente_asignaciones_jornada_machinery_id_key/.test(sql));
ok('⭐ ...y pone el de jornada+camión+frente',
  /unique index if not exists vfa_jornada_camion_frente_key[\s\S]*?\(jornada, machinery_id, frente_id\)/.test(sql));
ok('⚠️ no borra ni una fila de asignaciones', !/delete from public\.viaje_frente_asignaciones/i.test(sql));

console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Un camión recoge en los frentes que haga falta; y donde no se puede saber en cuál, no se inventa.');
