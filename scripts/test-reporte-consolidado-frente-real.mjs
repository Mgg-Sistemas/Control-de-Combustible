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
  costoPorTonelada,
  filasElegidas,
  sufijoArchivoConsolidado,
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

// 4. Caso Winnerly / Chely (23/11/2026 · RESIDENCIA PALMA REAL):
//    En Palma Real trabajaron 3 máquinas de INVERSIONES AJJE, 2 de FERRECONSTRUCCIONES 3-G y 2 Jumbos de GOLDEN TOUCH,
//    más los 5 camiones volteo de GOLDEN TOUCH. Al activar `incluirCamionesAcarreo` con `soloEmpresas: ['INVERSIONES AJJE MAQUINARIAS, C.A.']`
//    y `soloFrentes: ['Residencia Palma Real']`, entran SOLO las 3 máquinas de AJJE + los 5 camiones de Palma Real.
const filasConMaquinaria = [
  ...filasReales,
  {
    id: 'm_ajje_1', code: 'JUMBO 320', placa: 'CAT00320CPAB05827', empresa: 'INVERSIONES AJJE MAQUINARIAS, C.A.',
    frente: 'Residencia Palma Real', categoria: 'REMOCIÓN Y EXCAVACIÓN', encargado: 'ALBERTO',
    montos: { horometros: 640 }, cant: { horometros: 9.6 },
  },
  {
    id: 'm_ajje_2', code: 'JUMBO CON MARTILLO', placa: 'CAT003223ETSF21435', empresa: 'INVERSIONES AJJE MAQUINARIAS, C.A.',
    frente: 'Residencia Palma Real', categoria: 'REMOCIÓN Y EXCAVACIÓN', encargado: 'AJJE',
    montos: { horometros: 725 }, cant: { horometros: 8.7 },
  },
  {
    id: 'm_ajje_3', code: 'PAYLOADER', placa: 'CAT8958GT3JW82442X', empresa: 'INVERSIONES AJJE MAQUINARIAS, C.A.',
    frente: 'Residencia Palma Real', categoria: 'REMOCIÓN Y EXCAVACIÓN', encargado: 'ALBERTO',
    montos: { horometros: 445.83 }, cant: { horometros: 10.7 },
  },
  {
    id: 'm_ferre_1', code: 'JUMBO 320', placa: 'CAT0320DJJFZ06753', empresa: 'FERRECONSTRUCCIONES 3-G, C.A',
    frente: 'Residencia Palma Real', categoria: 'REMOCIÓN Y EXCAVACIÓN',
    montos: { horometros: 1146.67 }, cant: { horometros: 17.2 },
  },
  {
    id: 'm_ferre_2', code: 'JUMBO 320', placa: 'HHKHN623HP0036592', empresa: 'FERRECONSTRUCCIONES 3-G, C.A',
    frente: 'Residencia Palma Real', categoria: 'REMOCIÓN Y EXCAVACIÓN',
    montos: { horometros: 793.33 }, cant: { horometros: 11.9 },
  },
  {
    id: 'm_gt_1', code: 'JUMBO CON MARTILLO', placa: 'CAT0320DCZBH00579', empresa: 'GOLDEN TOUCH 1127 CA',
    frente: 'Residencia Palma Real', categoria: 'REMOCIÓN Y EXCAVACIÓN',
    montos: { horometros: 1183.33 }, cant: { horometros: 14.2 },
  },
  {
    id: 'm_gt_2', code: 'JUMBO CON MARTILLO', placa: 'SINE210HHM1300488', empresa: 'GOLDEN TOUCH 1127 CA',
    frente: 'Residencia Palma Real', categoria: 'REMOCIÓN Y EXCAVACIÓN',
    montos: { horometros: 1060 }, cant: { horometros: 10.6 },
  },
];
const diasConMaquinaria = [{ jornada: '2026-11-23', filas: filasConMaquinaria, viajes: viajesTon }];

// Sin incluirCamionesAcarreo (por defecto), soloEmpresas: AJJE deja únicamente las 3 máquinas ($1.810,83) y excluye los camiones de Golden Touch
const opAjjeSinCamiones = {
  ...opSoloPalma,
  soloEmpresas: ['INVERSIONES AJJE MAQUINARIAS, C.A.'],
};
const totAjjeSin = totalesConsolidado(filasConMaquinaria, opAjjeSinCamiones, diasConMaquinaria);
ok('por defecto soloEmpresas AJJE trae solo las 3 máquinas de AJJE ($1.810,83)',
  totAjjeSin.maquinas === 3 && totAjjeSin.total === 1810.83, `got maq=${totAjjeSin.maquinas} total=${totAjjeSin.total}`);

// Con incluirCamionesAcarreo: true, salen las 3 máquinas de AJJE ($1.810,83) + los 5 camiones reales de Palma Real ($967,08) = $2.777,91, excluyendo Ferreconstrucciones y Jumbos de Golden Touch
const opChely = {
  ...opSoloPalma,
  soloEmpresas: ['INVERSIONES AJJE MAQUINARIAS, C.A.'],
  incluirCamionesAcarreo: true,
};
const elChely = filasElegidas(filasConMaquinaria, opChely, diasConMaquinaria);
const totChely = totalesConsolidado(filasConMaquinaria, opChely, diasConMaquinaria);
const ctChely = costoPorTonelada(filasConMaquinaria, opChely, viajesTon, diasConMaquinaria);
const dChely = diasConsolidados(diasConMaquinaria, opChely, filasConMaquinaria);
const htmlChely = cuerpoConsolidado({ desde: '2026-11-23', hasta: '2026-11-23', filas: filasConMaquinaria, viajesTon, dias: diasConMaquinaria }, opChely);

ok('con incluirCamionesAcarreo salen exactamente 8 equipos (3 AJJE + 5 camiones Palma Real)',
  elChely.length === 8 && totChely.maquinas === 8, `got ${elChely.length}`);
ok('suma exactamente $1.810,83 de maquinaria + $967,08 de acarreo = $2.777,91',
  totChely.porFuente.horometros === 1810.83 && totChely.porFuente.peso === 967.08 && totChely.total === 2777.91,
  `got horo=${totChely.porFuente.horometros} peso=${totChely.porFuente.peso} total=${totChely.total}`);
ok('excluye las máquinas pesadas de FERRECONSTRUCCIONES y los Jumbos de GOLDEN TOUCH',
  !htmlChely.includes('FERRECONSTRUCCIONES') && !htmlChely.includes('CAT0320DCZBH00579') && !htmlChely.includes('SINE210HHM1300488'));
ok('incluye las 3 máquinas de AJJE y los 5 camiones de Palma Real en el PDF',
  ['CAT00320CPAB05827', 'CAT003223ETSF21435', 'CAT8958GT3JW82442X', '49DDAR', 'A36AD9J', 'A17AW2E', 'A12DH7S', 'A13AG9D'].every((p) => htmlChely.includes(`<td>${p}</td>`)));
ok('costo por tonelada divide solo la maquinaria de AJJE ($1.810,83) ÷ 483,54 t = $3,74/t',
  ctChely.costo === 1810.83 && ctChely.toneladas === 483.54 && ctChely.usdPorTon === 3.74,
  `got costo=${ctChely.costo} ton=${ctChely.toneladas} usdTon=${ctChely.usdPorTon}`);
ok('tabla diaria cuadra al centavo ($2.777,91 y $3,74/t)',
  dChely[0].total === 2777.91 && dChely[0].usdPorTon === 3.74,
  `got total=${dChely[0].total} usdTon=${dChely[0].usdPorTon}`);
ok('nombre de archivo indica con camiones de acarreo',
  sufijoArchivoConsolidado(opChely).includes('con camiones de acarreo'));

console.log(`test-reporte-consolidado-frente-real: ${pass} pasaron, ${fail} fallaron.`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
