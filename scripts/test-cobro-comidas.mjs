/*
 * Test del COBRO DE COMIDAS (15-sep-2026).
 *
 * Pedido del cliente: en Distribución de comida, cobrar lo entregado por empresa, con
 * precios editables por comida (general desde una fecha o blindado a un rango).
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · el precio blindado manda en su rango y no fuera; el anulado no cuenta; lo pasado conserva su precio
 *   · lo entregado por QR va a la empresa GUARDADA en la entrega
 *   · lo de carnet va a la empresa de la ficha; sin empresa = nómina; sin ficha = aparte (no se le carga a nadie)
 *   · lo que no tiene precio no suma, pero no desaparece
 *   · vive solo en Distribución de comida, con permiso completo, y no toca el registro de la cocina
 *
 * Valores inventados: no hay precios reales en el repositorio (es público).
 *
 *   node scripts/test-cobro-comidas.mjs
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

function cargar(rel) {
  const p = path.join(ROOT, rel);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  m._compile(js, p);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; failures.push(`✗ ${name}\n    obtenido: ${JSON.stringify(got)}\n    esperado: ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const L = cargar('src/lib/cobroComidas.ts');
ok('la librería no importa nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/cobroComidas.ts'))));

// ── 1) PRECIO VIGENTE ────────────────────────────────────────────────────────
const P = [
  { id: 'g1', categoria: 'desayuno', precio: 7, desde: '2026-09-01', created_at: '2026-09-01T10:00:00Z' },
  { id: 'g2', categoria: 'desayuno', precio: 9, desde: '2026-09-10', created_at: '2026-09-10T10:00:00Z' },
  { id: 'b1', categoria: 'desayuno', precio: 3, desde: '2026-09-12', hasta: '2026-09-13', created_at: '2026-09-11T10:00:00Z' },
  { id: 'an', categoria: 'desayuno', precio: 99, desde: '2026-09-11', created_at: '2026-09-11T11:00:00Z', anulada_at: '2026-09-11T12:00:00Z' },
  { id: 'a1', categoria: 'almuerzo', precio: '11,5', desde: '2026-09-01', created_at: '2026-09-01T10:00:00Z' },
  { id: 'a2', categoria: 'almuerzo', precio: 12, desde: '2026-09-01', created_at: '2026-09-02T10:00:00Z' },
  { id: 'c0', categoria: 'cena', precio: 0, desde: '2026-09-01', created_at: '2026-09-01T10:00:00Z' },
];
const pid = (cat, f) => L.precioComidaEn(P, cat, f)?.id ?? null;
eq('antes del primer precio: sin precio', pid('desayuno', '2026-08-31'), null);
eq('general vigente', pid('desayuno', '2026-09-05'), 'g1');
eq('el general más nuevo manda desde su fecha', pid('desayuno', '2026-09-10'), 'g2');
eq('el día antes del cambio conserva el precio viejo', pid('desayuno', '2026-09-09'), 'g1');
eq('el anulado no cuenta', pid('desayuno', '2026-09-11'), 'g2');
eq('blindado manda en su primer día', pid('desayuno', '2026-09-12'), 'b1');
eq('blindado manda en su último día', pid('desayuno', '2026-09-13'), 'b1');
eq('fuera del blindado vuelve el general', pid('desayuno', '2026-09-14'), 'g2');
eq('mismo «desde»: gana el creado después', pid('almuerzo', '2026-09-05'), 'a2');
eq('precio 0 no cuenta', pid('cena', '2026-09-05'), null);
eq('categoría sin precios', pid('lunch', '2026-09-05'), null);
eq('una categoría no toma el precio de otra', L.precioComidaEn(P, 'almuerzo', '2026-09-12')?.categoria, 'almuerzo');

// ── 2) VALIDACIÓN ────────────────────────────────────────────────────────────
const CATS = ['desayuno', 'almuerzo', 'lunch', 'cena'];
eq('válido', L.validarPrecioComida({ categoria: 'cena', precio: '4,5', desde: '2026-09-15' }, CATS), null);
ok('categoría desconocida', L.validarPrecioComida({ categoria: 'postre', precio: 1, desde: '2026-09-15' }, CATS));
ok('precio 0', L.validarPrecioComida({ categoria: 'cena', precio: '0', desde: '2026-09-15' }, CATS));
ok('precio vacío', L.validarPrecioComida({ categoria: 'cena', precio: '', desde: '2026-09-15' }, CATS));
ok('sin desde', L.validarPrecioComida({ categoria: 'cena', precio: 1, desde: '' }, CATS));
ok('hasta antes de desde', L.validarPrecioComida({ categoria: 'cena', precio: 1, desde: '2026-09-15', hasta: '2026-09-14' }, CATS));
eq('hasta igual a desde vale', L.validarPrecioComida({ categoria: 'cena', precio: 1, desde: '2026-09-15', hasta: '2026-09-15' }, CATS), null);

// ── 3) CUENTAS ───────────────────────────────────────────────────────────────
const empresas = [
  { company_id: 'EMPA', company_name: 'EMPRESA A', meal_type: 'desayuno', meal_date: '2026-09-08', delivered: 2 },  // 7
  { company_id: 'EMPA', company_name: 'EMPRESA A', meal_type: 'desayuno', meal_date: '2026-09-09', delivered: 10 }, // 7 (se suma al de arriba)
  { company_id: 'EMPZ', company_name: 'EMPRESA CERO', meal_type: 'cena', meal_date: '2026-09-09', delivered: 0 },   // solo ceros: no hay cuenta
  { company_id: 'EMPA', company_name: 'EMPRESA A', meal_type: 'desayuno', meal_date: '2026-09-12', delivered: 4 },  // blindado 3
  { company_id: 'EMPA', company_name: 'EMPRESA A', meal_type: 'lunch', meal_date: '2026-09-12', delivered: 6 },     // sin precio
  { company_id: 'EMPA', company_name: 'EMPRESA A', meal_type: 'almuerzo', meal_date: '2026-09-12', delivered: 0 },  // 0: no entra
  { company_id: null, company_name: 'EMPRESA VIEJA', meal_type: 'almuerzo', meal_date: '2026-09-12', delivered: '2' }, // sin id
];
const personas = [
  { employee_id: 'e1', meal_type: 'almuerzo', distribution_date: '2026-09-12', meals: 1 }, // ficha EMPA
  { employee_id: 'e2', meal_type: 'desayuno', distribution_date: '2026-09-14', meals: 1 }, // nómina
  { employee_id: 'e2', meal_type: 'cena', distribution_date: '2026-09-14', meals: 1 },     // nómina, precio 0 = sin precio
  { employee_id: 'e9', meal_type: 'desayuno', distribution_date: '2026-09-14', meals: 1 }, // ficha no leída
  { employee_id: null, meal_type: 'desayuno', distribution_date: '2026-09-14', meals: 1 }, // ficha borrada
  { employee_id: 'e2', meal_type: null, distribution_date: '2026-09-14', meals: 1 },       // sin tipo
];
const fichas = new Map([
  ['e1', { companyId: 'EMPA', companyName: 'EMPRESA A' }],
  ['e2', { companyId: null, companyName: null }],
]);
const C = L.calcularCobroComidas({ empresas, personas, empresaDePersona: fichas, precios: P });
const cuenta = (k) => C.find((c) => c.clave === k);

eq('orden: empresas, luego nómina, luego sin ficha', C.map((c) => c.clave), ['EMPA', 'EMPRESA VIEJA', L.CUENTA_NOMINA, L.CUENTA_SIN_FICHA]);

const A = cuenta('EMPA');
eq('empresa A: comidas (QR + carnet, sin las de 0)', A.comidas, 23);
eq('empresa A: por QR', A.porQr, 22);
eq('empresa A: por carnet (su gente)', A.porCarnet, 1);
eq('empresa A: sin precio (lunch)', A.sinPrecio, 6);
eq('empresa A: cobradas', A.cobradas, 17);
eq('empresa A: monto = 12×7 + 4×3 + 1×12', A.monto, 108);
eq('empresa A: detalle por comida y precio', A.items, [
  { categoria: 'almuerzo', precio: 12, cantidad: 1, monto: 12 },
  { categoria: 'desayuno', precio: 7, cantidad: 12, monto: 84 },
  { categoria: 'desayuno', precio: 3, cantidad: 4, monto: 12 },
  { categoria: 'lunch', precio: null, cantidad: 6, monto: 0 },
]);

const V = cuenta('EMPRESA VIEJA');
eq('entrega sin id de empresa: cuenta por el nombre guardado', [V.nombre, V.comidas, V.monto], ['EMPRESA VIEJA', 2, 24]);

const N = cuenta(L.CUENTA_NOMINA);
eq('nómina: comidas', N.comidas, 3);
eq('nómina: desayuno a 9, cena sin precio, sin tipo sin precio', [N.cobradas, N.sinPrecio, N.monto], [1, 2, 9]);
ok('nómina: lo sin tipo sale como «sin categoría»', N.items.some((i) => i.categoria === L.SIN_CATEGORIA && i.precio === null));

const S = cuenta(L.CUENTA_SIN_FICHA);
eq('sin ficha (no leída o borrada): aparte, no en nómina', [S.comidas, S.monto], [2, 18]);

const T = L.totalCobroComidas(C);
eq('total', T, { comidas: 30, cobradas: 22, sinPrecio: 8, monto: 159 });
ok('una empresa con solo entregas de 0 no abre cuenta', !cuenta('EMPZ'));

eq('sin entregas: sin cuentas', L.calcularCobroComidas({ empresas: [], personas: null, empresaDePersona: new Map(), precios: P }), []);
eq('sin precios: todo sin precio, nada suma',
  L.totalCobroComidas(L.calcularCobroComidas({ empresas, personas, empresaDePersona: fichas, precios: [] })),
  { comidas: 30, cobradas: 0, sinPrecio: 30, monto: 0 });
eq('centavos: 3 × 1,10 = 3,30 exactos',
  L.calcularCobroComidas({ empresas: [{ company_id: 'X', company_name: 'X', meal_type: 'cena', meal_date: '2026-09-15', delivered: 3 }], personas: [], empresaDePersona: new Map(),
    precios: [{ id: 'c', categoria: 'cena', precio: 1.1, desde: '2026-09-01' }] })[0].monto, 3.3);

// ── 4) DÓNDE VIVE Y QUIÉN LO VE ──────────────────────────────────────────────
const pantalla = sinComentarios(leer('src/screens/ComidaScreen.tsx'));
ok('ComidaScreen usa la tarjeta de cobro', /<CobroComidasResumen[\s>]/.test(pantalla));
ok('la tarjeta exige permiso completo de comida', /levelMeets\(\s*moduleLevel\(\s*'comida'\s*\)\s*,\s*'full'\s*\)/.test(pantalla));
ok('la tarjeta va dentro de canCobro', /canCobro\s*&&\s*!rangeError\s*\?\s*\(\s*<CobroComidasResumen/.test(pantalla));
ok('la tarjeta recibe las entregas del rango sin filtrar', /empresas=\{rangeRows\}/.test(pantalla) && /personas=\{rangePersons\}/.test(pantalla));

for (const f of ['src/screens/CocinaScreen.tsx', 'src/screens/FoodCompanyScreen.tsx', 'src/lib/foodDistributions.ts', 'src/lib/foodCompanyMeals.ts']) {
  ok(`${f} no sabe del cobro`, !/cobroComidas|CobroComidas|comida_precios/.test(leer(f)));
}
const resumen = sinComentarios(leer('src/components/CobroComidasResumen.tsx')) + sinComentarios(leer('src/components/CobroComidasPrecios.tsx'));
ok('el cobro no escribe entregas', !/food_distributions|food_company_meals|saveFoodDistribution|saveCompanyMeal|deleteFoodDistribution/.test(resumen));

const db = sinComentarios(leer('src/lib/cobroComidasDb.ts'));
eq('escrituras con .select(\'id\') (insert y update)', (db.match(/\.(insert|update)\(/g) || []).length, (db.match(/\.select\('id'\)/g) || []).length);
ok('avisa el rechazo por permiso', /SIN_PERMISO_COMIDA/.test(db) && /!data\?\.length/.test(db));
ok('la lectura de fichas lanza si falla', /if \(error\) throw/.test(db));

// ── 5) AUDITORÍA Y MANUAL ────────────────────────────────────────────────────
ok('auditoría agrupa comida_precios en alimentación', /comida_precios:\s*'alimentacion'/.test(leer('src/lib/auditModulos.ts')));
ok('manual (md) explica el cobro', /Cobro de comidas \(15\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('manual (app) explica el cobro', /COBRO DE COMIDAS \(15\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\nCobro de comidas: ${pass} ok, ${fail} fallas`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
