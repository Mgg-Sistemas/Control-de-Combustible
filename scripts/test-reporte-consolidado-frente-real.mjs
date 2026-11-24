/*
 * 🧪 Regresión: Detalle por frente de trabajo en Reporte Consolidado (24-nov-2026)
 *
 * Reproduce el caso real de 23/11/2026 · RESIDENCIA PALMA REAL:
 *  - 5 camiones trabajaron en RESIDENCIA PALMA REAL (49DDAR, A36AD9J, A17AW2E, A13AG9D, A12DH7S = 483,54 t).
 *  - Solo 49DDAR tenía tarifa de peso ($320,76 / 160,38 t); los otros 4 quedaron en $0 (sin tarifa),
 *    pero AHORA SÍ salen como filas en la tabla con sus placas, toneladas reales y marca «💲 sin tarifa de acarreo»,
 *    y el Subtotal del frente suma las 483,54 t completas.
 *  - Camiones con frentePorId en RESIDENCIA PALMA REAL pero que viajaron en OTRO FRENTE (69TBA0)
 *    no se meten en RESIDENCIA PALMA REAL.
 *
 *   node scripts/test-reporte-consolidado-frente-real.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const cache = new Map();
function loadTs(filename) {
  const abs = path.resolve(filename);
  if (cache.has(abs)) return cache.get(abs).exports;
  const mod = { exports: {} };
  cache.set(abs, mod);
  const src = fs.readFileSync(abs, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', out);
  const localReq = (id) => {
    if (id.startsWith('.')) {
      const base = path.resolve(path.dirname(abs), id);
      const target = fs.existsSync(`${base}.ts`) ? `${base}.ts` : fs.existsSync(`${base}.tsx`) ? `${base}.tsx` : base;
      if (target.endsWith('.ts') || target.endsWith('.tsx')) return loadTs(target);
    }
    return require(id);
  };
  fn(localReq, mod, mod.exports, abs, path.dirname(abs));
  return mod.exports;
}

const {
  OPCIONES_CONSOLIDADO_POR_DEFECTO,
  cuerpoConsolidado,
} = loadTs(path.join(ROOT, 'src/lib/reporteConsolidado.ts'));

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`✗ ${name}${detail ? ` (${detail})` : ''}`);
  }
};

// Los 5 camiones de RESIDENCIA PALMA REAL (160.38 + 105.00 + 84.00 + 67.08 + 67.08 = 483.54 t):
// - 49DDAR: con tarifa ($320.76)
// - A36AD9J, A17AW2E, A13AG9D, A12DH7S: sin tarifa ($0, sinTarifaAcarreo: true, pero con sus kg reales!)
// - 69TBA0: asignado en frentePorId a RESIDENCIA PALMA REAL pero sus viajes fueron en OTRO FRENTE ($147.20 / 73.60 t)
const filas = [
  {
    id: 'c1',
    code: 'CAMION VOLTEO TORONTO',
    placa: '49DDAR',
    empresa: 'GOLDEN TOUCH 1127 CA',
    frente: 'RESIDENCIA PALMA REAL',
    montos: { peso: 320.76 },
    cant: { peso: 160380 },
    acarreoPorFrente: { 'RESIDENCIA PALMA REAL': { peso: 320.76, pesoKg: 160380 } },
  },
  {
    id: 'c2',
    code: 'CAMION VOLTEO TORONTO',
    placa: 'A36AD9J',
    empresa: 'OTRA EMPRESA CA',
    frente: 'OTRO FRENTE',
    sinTarifaAcarreo: true,
    montos: { peso: 0 },
    cant: { peso: 105000 },
    acarreoPorFrente: { 'RESIDENCIA PALMA REAL': { peso: 0, pesoKg: 105000 } },
  },
  {
    id: 'c3',
    code: 'CAMION VOLTEO TORONTO',
    placa: 'A17AW2E',
    empresa: 'OTRA EMPRESA CA',
    frente: 'OTRO FRENTE',
    sinTarifaAcarreo: true,
    montos: { peso: 0 },
    cant: { peso: 84000 },
    acarreoPorFrente: { 'RESIDENCIA PALMA REAL': { peso: 0, pesoKg: 84000 } },
  },
  {
    id: 'c4',
    code: 'CAMION VOLTEO TORONTO',
    placa: 'A13AG9D',
    empresa: 'OTRA EMPRESA CA',
    frente: 'Sin frente',
    sinTarifaAcarreo: true,
    montos: { peso: 0 },
    cant: { peso: 67080 },
    acarreoPorFrente: { 'RESIDENCIA PALMA REAL': { peso: 0, pesoKg: 67080 } },
  },
  {
    id: 'c5',
    code: 'CAMION VOLTEO TORONTO',
    placa: 'A12DH7S',
    empresa: 'OTRA EMPRESA CA',
    frente: 'Sin frente',
    sinTarifaAcarreo: true,
    montos: { peso: 0 },
    cant: { peso: 67080 },
    acarreoPorFrente: { 'RESIDENCIA PALMA REAL': { peso: 0, pesoKg: 67080 } },
  },
  {
    id: 'c6',
    code: 'CAMION VOLTEO TORONTO',
    placa: '69TBA0',
    empresa: 'GOLDEN TOUCH 1127 CA',
    frente: 'RESIDENCIA PALMA REAL',
    montos: { peso: 147.20 },
    cant: { peso: 73600 },
    acarreoPorFrente: { 'OTRO FRENTE': { peso: 147.20, pesoKg: 73600 } },
  },
];

const viajesTon = [
  { frente_nombre: 'RESIDENCIA PALMA REAL', peso_neto_kg: 160380, code: 'CAMION VOLTEO TORONTO', placa: '49DDAR' },
  { frente_nombre: 'RESIDENCIA PALMA REAL', peso_neto_kg: 105000, code: 'CAMION VOLTEO TORONTO', placa: 'A36AD9J' },
  { frente_nombre: 'RESIDENCIA PALMA REAL', peso_neto_kg: 84000, code: 'CAMION VOLTEO TORONTO', placa: 'A17AW2E' },
  { frente_nombre: 'RESIDENCIA PALMA REAL', peso_neto_kg: 67080, code: 'CAMION VOLTEO TORONTO', placa: 'A13AG9D' },
  { frente_nombre: 'RESIDENCIA PALMA REAL', peso_neto_kg: 67080, code: 'CAMION VOLTEO TORONTO', placa: 'A12DH7S' },
  { frente_nombre: 'OTRO FRENTE', peso_neto_kg: 73600, code: 'CAMION VOLTEO TORONTO', placa: '69TBA0' },
];

const op = {
  ...OPCIONES_CONSOLIDADO_POR_DEFECTO,
  agruparPor: 'frente',
};

const html = cuerpoConsolidado(
  { desde: '2026-11-23', hasta: '2026-11-23', filas, viajesTon },
  op
);

const bloquePalma = html.split('⛏️ RESIDENCIA PALMA REAL')[1]?.split('⛏️')[0] ?? '';
ok('RESIDENCIA PALMA REAL incluye los 5 camiones en la tabla (49DDAR, A36AD9J, A17AW2E, A13AG9D, A12DH7S)',
  ['49DDAR', 'A36AD9J', 'A17AW2E', 'A13AG9D', 'A12DH7S'].every((p) => bloquePalma.includes(`<td>${p}</td>`)));
ok('Marca con «💲 sin tarifa de acarreo» los camiones en $0', bloquePalma.includes('💲 sin tarifa de acarreo'));
ok('Subtotal RESIDENCIA PALMA REAL suma las 483,54 t completas', bloquePalma.includes('483,54 t'));
ok('Subtotal RESIDENCIA PALMA REAL mantiene el monto real facturado ($320,76)', bloquePalma.includes('320,76'));
ok('RESIDENCIA PALMA REAL NO mete a 69TBA0 que viajó en OTRO FRENTE', !bloquePalma.includes('69TBA0'));
ok('TOTAL GENERAL mantiene la suma exacta ($467,96)', html.includes('467,96'));

const htmlSoloPalma = cuerpoConsolidado(
  { desde: '2026-11-23', hasta: '2026-11-23', filas, viajesTon },
  { ...op, soloFrentes: ['RESIDENCIA PALMA REAL'] }
);
ok('soloFrentes RESIDENCIA PALMA REAL muestra los 5 camiones',
  ['49DDAR', 'A36AD9J', 'A17AW2E', 'A13AG9D', 'A12DH7S'].every((p) => htmlSoloPalma.includes(`<td>${p}</td>`)));
ok('soloFrentes RESIDENCIA PALMA REAL excluye 69TBA0', !htmlSoloPalma.includes('69TBA0'));

console.log(`test-reporte-consolidado-frente-real: ${pass} pasaron, ${fail} fallaron.`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
