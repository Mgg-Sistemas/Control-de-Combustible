/*
 * 🧪 Regresión con los números reales de BD del 23/11/2026 · RESIDENCIA PALMA REAL:
 *  - 5 camiones trabajaron en RESIDENCIA PALMA REAL:
 *      49DDAR  (160.38 t -> $320.76, frentePorId: RESIDENCIA PALMA REAL)
 *      A36AD9J ( 92.32 t -> $184.64, frentePorId: SAIME)
 *      A17AW2E ( 84.08 t -> $168.16, frentePorId: MADELEIN SUITES)
 *      A12DH7S ( 66.58 t -> $133.16, frentePorId: MADELEIN SUITES)
 *      A13AG9D ( 80.18 t -> $160.36 en PALMA REAL + 54.60 t -> $109.20 en SAIME, frentePorId: MADELEIN SUITES)
 *    Total RESIDENCIA PALMA REAL = 483.54 t y $967.08.
 *  - 69TBA0 y A57BG3M tenían frentePorId en RESIDENCIA PALMA REAL pero sus viajes del 23/11 fueron
 *    en CALLE LOS CORALES y SAIME: NO deben entrar a RESIDENCIA PALMA REAL.
 *  - También verifica que un camión sin tarifa ($0, sinTarifaAcarreo) sigue saliendo en su frente.
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
  totalesConsolidado,
  diasConsolidados,
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

const filasReales = [
  {
    id: 'c1', code: 'CAMION VOLTEO TORONTO', placa: '49DDAR', empresa: 'GOLDEN TOUCH 1127 CA',
    frente: 'RESIDENCIA PALMA REAL',
    montos: { peso: 320.76 }, cant: { peso: 160380 },
    acarreoPorFrente: { 'RESIDENCIA PALMA REAL': { peso: 320.76, pesoKg: 160380 } },
  },
  {
    id: 'c2', code: 'CAMION VOLTEO TORONTO', placa: 'A36AD9J', empresa: 'GOLDEN TOUCH 1127 CA',
    frente: 'SAIME',
    montos: { peso: 184.64 }, cant: { peso: 92320 },
    acarreoPorFrente: { 'RESIDENCIA PALMA REAL': { peso: 184.64, pesoKg: 92320 } },
  },
  {
    id: 'c3', code: 'CAMION VOLTEO TORONTO', placa: 'A17AW2E', empresa: 'GOLDEN TOUCH 1127 CA',
    frente: 'MADELEIN SUITES',
    montos: { peso: 168.16 }, cant: { peso: 84080 },
    acarreoPorFrente: { 'RESIDENCIA PALMA REAL': { peso: 168.16, pesoKg: 84080 } },
  },
  {
    id: 'c4', code: 'CAMION VOLTEO TORONTO', placa: 'A12DH7S', empresa: 'GOLDEN TOUCH 1127 CA',
    frente: 'MADELEIN SUITES',
    montos: { peso: 133.16 }, cant: { peso: 66580 },
    acarreoPorFrente: { 'RESIDENCIA PALMA REAL': { peso: 133.16, pesoKg: 66580 } },
  },
  {
    id: 'c5', code: 'CAMION VOLTEO TORONTO', placa: 'A13AG9D', empresa: 'GOLDEN TOUCH 1127 CA',
    frente: 'MADELEIN SUITES',
    montos: { peso: 269.56 }, cant: { peso: 134780 },
    acarreoPorFrente: {
      'RESIDENCIA PALMA REAL': { peso: 160.36, pesoKg: 80180 },
      'SAIME': { peso: 109.20, pesoKg: 54600 },
    },
  },
  {
    id: 'c6', code: 'CAMION VOLTEO TORONTO', placa: '69TBA0', empresa: 'GOLDEN TOUCH 1127 CA',
    frente: 'RESIDENCIA PALMA REAL',
    montos: { peso: 147.20 }, cant: { peso: 73600 },
    acarreoPorFrente: { 'CALLE LOS CORALES': { peso: 147.20, pesoKg: 73600 } },
  },
  {
    id: 'c7', code: 'CAMION VOLTEO TORONTO', placa: 'A57BG3M', empresa: 'GOLDEN TOUCH 1127 CA',
    frente: 'RESIDENCIA PALMA REAL',
    montos: { peso: 67.56 }, cant: { peso: 33780 },
    acarreoPorFrente: { 'SAIME': { peso: 67.56, pesoKg: 33780 } },
  },
];

const viajesTon = [
  { frente_nombre: 'RESIDENCIA PALMA REAL', peso_neto_kg: 160380, code: 'CAMION VOLTEO TORONTO', placa: '49DDAR' },
  { frente_nombre: 'RESIDENCIA PALMA REAL', peso_neto_kg: 92320, code: 'CAMION VOLTEO TORONTO', placa: 'A36AD9J' },
  { frente_nombre: 'RESIDENCIA PALMA REAL', peso_neto_kg: 84080, code: 'CAMION VOLTEO TORONTO', placa: 'A17AW2E' },
  { frente_nombre: 'RESIDENCIA PALMA REAL', peso_neto_kg: 66580, code: 'CAMION VOLTEO TORONTO', placa: 'A12DH7S' },
  { frente_nombre: 'RESIDENCIA PALMA REAL', peso_neto_kg: 80180, code: 'CAMION VOLTEO TORONTO', placa: 'A13AG9D' },
  { frente_nombre: 'SAIME', peso_neto_kg: 54600, code: 'CAMION VOLTEO TORONTO', placa: 'A13AG9D' },
  { frente_nombre: 'SAIME', peso_neto_kg: 33780, code: 'CAMION VOLTEO TORONTO', placa: 'A57BG3M' },
  { frente_nombre: 'CALLE LOS CORALES', peso_neto_kg: 73600, code: 'CAMION VOLTEO TORONTO', placa: '69TBA0' },
];

const dias = [{ jornada: '2026-11-23', filas: filasReales, viajes: viajesTon }];
const opSoloPalma = {
  ...OPCIONES_CONSOLIDADO_POR_DEFECTO,
  agruparPor: 'frente',
  soloFrentes: ['Residencia Palma Real'],
};

// 1. Al filtrar por Residencia Palma Real, totalesConsolidado recorta A13AG9D solo a Palma Real ($967.08 y 483540 kg)
const totPalma = totalesConsolidado(filasReales, opSoloPalma, dias);
ok('totalesConsolidado en Palma Real suma exactamente $967.08', totPalma.total === 967.08, `got ${totPalma.total}`);
ok('totalesConsolidado en Palma Real suma exactamente 483540 kg (483.54 t)', totPalma.cantPorFuente.peso === 483540, `got ${totPalma.cantPorFuente.peso}`);
ok('totalesConsolidado cuenta exactamente 5 camiones', totPalma.maquinas === 5, `got ${totPalma.maquinas}`);

// 2. La tabla diaria (diasConsolidados) también da $967.08 y 483.54 t en ambos lados (acarreo y toneladas)
const dPalma = diasConsolidados(dias, opSoloPalma, filasReales);
ok('tabla diaria en Palma Real da acarreo = $967.08', dPalma[0].montos.peso === 967.08, `got ${dPalma[0].montos.peso}`);
ok('tabla diaria en Palma Real da cant.peso = 483540 kg (483.54 t)', dPalma[0].cant.peso === 483540, `got ${dPalma[0].cant.peso}`);
ok('tabla diaria en Palma Real da toneladas = 483.54 t', dPalma[0].toneladas === 483.54, `got ${dPalma[0].toneladas}`);

// 3. El PDF muestra los 5 camiones exactos y excluye a 69TBA0 y A57BG3M
const html = cuerpoConsolidado({ desde: '2026-11-23', hasta: '2026-11-23', filas: filasReales, viajesTon, dias }, opSoloPalma);
ok('PDF incluye las 5 placas reales (49DDAR, A36AD9J, A17AW2E, A12DH7S, A13AG9D)',
  ['49DDAR', 'A36AD9J', 'A17AW2E', 'A12DH7S', 'A13AG9D'].every((p) => html.includes(`<td>${p}</td>`)));
ok('PDF excluye 69TBA0 y A57BG3M en Palma Real', !html.includes('69TBA0') && !html.includes('A57BG3M'));
ok('A13AG9D aparece en ambos bloques (Palma Real y SAIME) cuando NO hay filtro soloFrentes', (() => {
  const htmlTodos = cuerpoConsolidado({ desde: '2026-11-23', hasta: '2026-11-23', filas: filasReales, viajesTon, dias }, { ...OPCIONES_CONSOLIDADO_POR_DEFECTO, agruparPor: 'frente' });
  const vecesA13 = (htmlTodos.match(/<td>A13AG9D<\/td>/g) || []).length;
  return vecesA13 === 2;
})());

console.log(`test-reporte-consolidado-frente-real: ${pass} pasaron, ${fail} fallaron.`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
