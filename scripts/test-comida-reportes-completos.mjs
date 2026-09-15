/*
 * Test de los REPORTES DE COMIDA COMPLETOS (14-sep-2026).
 *
 * Problema: las lecturas de comida no paginaban y el servidor corta en 1000 filas.
 * Una semana ya tuvo 1.259 entregas por carnet: el reporte semanal y su PDF salían
 * incompletos SIN AVISAR. Y si la lectura fallaba, devolvían una lista vacía, que se
 * leía como «no hubo comidas».
 *
 * Lo que fija:
 *   · las lecturas por día y por rango traen TODAS las filas (paginadas)
 *   · con los mismos filtros de antes y el mismo orden
 *   · si la lectura falla, LANZAN (no devuelven vacío)
 *   · la pantalla muestra el error y no arma el PDF del rango con datos a medias
 *
 * Sin framework (el repo no tiene): transpila los .ts en memoria y stubbea la red.
 *
 *   node scripts/test-comida-reportes-completos.mjs
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

const stubs = {};
function loadTs(abs) {
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  const orig = m.require.bind(m);
  m.require = (id) => {
    const base = id.split('/').pop();
    if (stubs[base]) return stubs[base];
    return orig(id);
  };
  m._compile(out, m.filename);
  return m.exports;
}

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; failures.push(`✗ ${name}\n    obtenido: ${JSON.stringify(got)}\n    esperado: ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── Red falsa ───────────────────────────────────────────────────────────────
const tablas = {};
let fallar = false;
let llamadas = [];
const consulta = () => {
  const q = { filtros: [] };
  for (const k of ['eq', 'gte', 'lte', 'in', 'order', 'range', 'select']) q[k] = (...a) => { q.filtros.push([k, ...a]); return q; };
  return q;
};
stubs.supabase = {
  supabase: { from: (t) => { llamadas.push({ simple: t }); return consulta(); } },
  selectAllRows: async (table, cols, filter) => {
    if (fallar) throw new Error('sin conexión');
    const q = filter ? filter(consulta()) : consulta();
    llamadas.push({ table, cols, filtros: q.filtros });
    return (tablas[table] ?? []).map((r) => ({ ...r }));
  },
};
stubs.text = {
  norm: (s) => String(s ?? '').toLowerCase(),
  cmpText: (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'es', { sensitivity: 'base' }),
};

const fd = loadTs(path.join(ROOT, 'src/lib/foodDistributions.ts'));
const fcm = loadTs(path.join(ROOT, 'src/lib/foodCompanyMeals.ts'));

// 2.500 entregas por carnet en una semana, desordenadas (más que las 1.259 reales).
tablas.food_distributions = Array.from({ length: 2500 }, (_, i) => ({
  id: `p${i}`,
  distribution_date: `2026-09-${String(7 + (i % 7)).padStart(2, '0')}`,
  delivered_at: `2026-09-${String(7 + (i % 7)).padStart(2, '0')}T${String((i * 7) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
  meals: 1,
}));
const EMPRESAS = ['Zeta', 'alfa', 'Beta'];
const COMIDAS = ['desayuno', 'almuerzo', 'lunch', 'cena'];
tablas.food_company_meals = Array.from({ length: 1300 }, (_, i) => ({
  id: `e${i}`,
  company_id: `c${i % 3}`,
  company_name: EMPRESAS[i % 3],
  meal_type: COMIDAS[(i * 3) % 4],
  meal_date: `2026-09-${String(1 + ((i * 5) % 30)).padStart(2, '0')}`,
  delivered: 10,
}));

const ordenado = (arr, cmp) => arr.every((x, i) => i === 0 || cmp(arr[i - 1], x) <= 0);
const simples = () => llamadas.filter((l) => l.simple).map((l) => l.simple);

// ── Por persona ─────────────────────────────────────────────────────────────
llamadas = [];
let r = await fd.listFoodByDate('2026-09-07', '2026-09-13');
eq('rango por persona: trae las 2.500, no se corta en 1.000', r.length, 2500);
eq('...con el filtro de rango', llamadas[0]?.filtros, [['gte', 'distribution_date', '2026-09-07'], ['lte', 'distribution_date', '2026-09-13']]);
ok('...más reciente primero', ordenado(r, (a, b) => b.delivered_at.localeCompare(a.delivered_at)));
eq('...sin la consulta simple que se cortaba', simples(), []);

llamadas = [];
r = await fd.listFoodByDate('2026-09-14');
eq('un solo día: filtra por ese día', llamadas[0]?.filtros, [['eq', 'distribution_date', '2026-09-14']]);

// ── Por empresa ─────────────────────────────────────────────────────────────
llamadas = [];
r = await fcm.listCompanyMealsBetween('2026-09-30', '2026-09-01');
eq('rango por empresa: trae las 1.300', r.length, 1300);
eq('...acepta el rango al revés', llamadas[0]?.filtros, [['gte', 'meal_date', '2026-09-01'], ['lte', 'meal_date', '2026-09-30']]);
ok('...por fecha y después por empresa', ordenado(r, (a, b) => a.meal_date.localeCompare(b.meal_date) || stubs.text.cmpText(a.company_name, b.company_name)));
eq('...sin la consulta simple', simples(), []);

llamadas = [];
r = await fcm.listForCompanyBetween('c1', '2026-09-01', '2026-09-30');
eq('una empresa: filtra por empresa y rango', llamadas[0]?.filtros, [['eq', 'company_id', 'c1'], ['gte', 'meal_date', '2026-09-01'], ['lte', 'meal_date', '2026-09-30']]);
ok('...más reciente primero, y por comida', ordenado(r, (a, b) => b.meal_date.localeCompare(a.meal_date) || a.meal_type.localeCompare(b.meal_type)));

llamadas = [];
r = await fcm.listCompanyMealsByDate('2026-09-14');
eq('un día por empresa: filtra por el día', llamadas[0]?.filtros, [['eq', 'meal_date', '2026-09-14']]);
ok('...ordenado por empresa', ordenado(r, (a, b) => stubs.text.cmpText(a.company_name, b.company_name)));

// ── Si la lectura falla, NO devuelve vacío ──────────────────────────────────
fallar = true;
for (const [nombre, fn] of [
  ['por persona', () => fd.listFoodByDate('2026-09-07', '2026-09-13')],
  ['por empresa en rango', () => fcm.listCompanyMealsBetween('2026-09-01', '2026-09-30')],
  ['una empresa', () => fcm.listForCompanyBetween('c1', '2026-09-01', '2026-09-30')],
  ['un día por empresa', () => fcm.listCompanyMealsByDate('2026-09-14')],
]) {
  let lanzo = false;
  try { await fn(); } catch { lanzo = true; }
  ok(`lectura fallida ${nombre}: avisa en vez de devolver vacío`, lanzo);
}
fallar = false;

// ── La pantalla lo muestra ──────────────────────────────────────────────────
const scr = sinComentarios(leer('src/screens/ComidaScreen.tsx'));
ok('el día fallido se avisa', /catch \(e: any\) \{\s*setLoadError\(/.test(scr));
ok('el rango fallido se avisa', /catch \(e: any\) \{\s*setRangeError\(/.test(scr));
ok('una lectura buena limpia el aviso', /setLoadError\(null\);/.test(scr) && /setRangeError\(null\);/.test(scr));
ok('el aviso sale en pantalla', /\{loadError \?\? rangeError\}/.test(scr));
ok('el PDF del rango no se arma con datos a medias', /const downloadRangePdf = async \(\) => \{\s*if \(rangeError\) return;/.test(scr));

// ── Cuadros por comida del rango: empresa + carnet (15-sep-2026) ────────────
// Antes sumaban solo por empresa: 158 en total pero 21+29+0+0 = 50, y la cena de carnet en 0.
ok('las entregas por persona se cuentan por comida', /const rangePersonsByMeal = useMemo\(\(\) => \{[\s\S]*?rangePersons\.forEach\(\(r\) => \{ if \(r\.meal_type\) by\[r\.meal_type\] = \(by\[r\.meal_type\] \|\| 0\) \+ \(Number\(r\.meals\) \|\| 0\); \}\);/.test(scr));
ok('los cuadros por comida suman empresa y persona', /MEALS\.map\(\(m\) => kpi\(m\.label, \(rangeTotals\.by\[m\.key\] \|\| 0\) \+ \(rangePersonsByMeal\[m\.key\] \|\| 0\)/.test(scr));
ok('...y ya no muestran solo lo de empresa', !/kpi\(m\.label, rangeTotals\.by\[m\.key\] \|\| 0,/.test(scr));
ok('el PDF por persona trae el total por comida', /MEALS\.map\(\(m\) => `<td>\$\{rangePersonsByMeal\[m\.key\] \|\| 0\}<\/td>`\)/.test(scr));

// ── Manual ──────────────────────────────────────────────────────────────────
ok('el manual .md lo explica', /Reportes de comida completos \(14\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla también', /REPORTES DE COMIDA COMPLETOS \(14\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
ok('el manual .md explica los cuadros por comida', /Comidas por tiempo en Reportes \(15\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla también', /COMIDAS POR TIEMPO EN REPORTES \(15\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-comida-reportes-completos · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
