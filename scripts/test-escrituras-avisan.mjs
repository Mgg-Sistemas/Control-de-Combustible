/*
 * Test: un borrado o cambio RECHAZADO POR PERMISOS se avisa, no se disimula (14-sep-2026).
 *
 * La base ya no deja borrar comidas ni tocar obras a cualquiera. Un cambio que la
 * base rechaza por permisos vuelve SIN error y con 0 filas. Antes la pantalla lo
 * daba por hecho: quitaba la comida de la lista o decía «obra renombrada» con la
 * base intacta, y pantalla y base quedaban desincronizadas.
 *
 * Lo que fija: cada una de esas escrituras pide `.select('id')` y, si no vuelve
 * ninguna fila, devuelve/avisa error en vez de seguir como si nada.
 *
 *   node scripts/test-escrituras-avisan.mjs
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

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; failures.push(`✗ ${name}\n    obtenido: ${JSON.stringify(got)}\n    esperado: ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── 1) deleteFoodDistribution con red falsa ─────────────────────────────────
let filas = [];
let errorRed = null;
const stubs = {
  supabase: { supabase: { from: () => {
    const q = {};
    for (const k of ['delete', 'eq', 'select']) q[k] = () => q;
    q.then = (res) => res({ data: filas, error: errorRed });
    return q;
  } }, selectAllRows: async () => [] },
};
function loadTs(abs) {
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
  const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs));
  const orig = m.require.bind(m);
  m.require = (id) => stubs[id.split('/').pop()] ?? orig(id);
  m._compile(out, m.filename);
  return m.exports;
}
const fd = loadTs(path.join(ROOT, 'src/lib/foodDistributions.ts'));

filas = [{ id: 'x' }];
eq('borrado que sí borró: sin error', await fd.deleteFoodDistribution('x'), {});
filas = [];
ok('borrado rechazado por permisos (0 filas): avisa', /No se borró/.test((await fd.deleteFoodDistribution('x')).error ?? ''));
filas = null;
ok('sin filas (null) también avisa', !!(await fd.deleteFoodDistribution('x')).error);
errorRed = { message: 'sin conexión' };
eq('error de red: lo devuelve', (await fd.deleteFoodDistribution('x')).error, 'sin conexión');

// ── 2) La cocina no quita de la lista lo que no se borró ────────────────────
const cocina = sinComentarios(leer('src/screens/CocinaScreen.tsx'));
ok('Cocina: si borrar devuelve error, no toca la lista', /const \{ error \} = await deleteFoodDistribution\(id\);\s*if \(error\) \{ setNotice\('❌ ' \+ error\); return; \}\s*setTodayList/.test(cocina));

// ── 3) Obras: renombrar, activar y borrar piden filas y avisan ───────────────
const obras = sinComentarios(leer('src/components/ObrasListeros.tsx'));
eq('las tres escrituras de obras piden .select(\'id\')', (obras.match(/from\('ubicaciones_obra'\)\.(update|delete)\([^;]*\.select\('id'\)/g) || []).length, 3);
eq('...y las tres avisan si no volvió ninguna fila', (obras.match(/if \(!data\?\.length\) \{ toast\.error\(SIN_PERMISO_OBRA\); return; \}/g) || []).length, 3);
ok('el aviso dice quién sí puede', /permiso completo de viajes/.test(obras));

// ── 4) Manual ───────────────────────────────────────────────────────────────
ok('el manual .md explica el cierre de permisos', /La base ahora protege lo que la pantalla esconde \(14\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla también', /LA BASE AHORA PROTEGE LO QUE LA PANTALLA ESCONDE \(14\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-escrituras-avisan · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
