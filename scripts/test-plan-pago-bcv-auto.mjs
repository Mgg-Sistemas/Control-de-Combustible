/*
 * 🧪 Prueba pura: actualización automática de partes BCV en Plan de Pago (24-nov-2026)
 *
 *   node scripts/test-plan-pago-bcv-auto.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

require.extensions['.ts'] = (m, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  m._compile(out, filename);
};

const { actualizarPlanABcv } = require(path.join(ROOT, 'src/lib/planPago.ts'));

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`✗ ${name}`);
  }
};

const planMixto = {
  partes: [
    { id: 'p1', concepto: 'base', monto_usd: 100, metodo: 'transferencia_bs', tasa_tipo: 'bcv', tasa: 880 },
    { id: 'p2', concepto: 'iva', monto_usd: 16, metodo: 'pago_movil', tasa_tipo: null, tasa: 880 },
    { id: 'p3', concepto: 'parte', monto_usd: 50, metodo: 'transferencia_bs', tasa_tipo: 'euro', tasa: 960 },
    { id: 'p4', concepto: 'parte', monto_usd: 40, metodo: 'transferencia_bs', tasa_tipo: 'usdt', tasa: 1050 },
    { id: 'p5', concepto: 'parte', monto_usd: 30, metodo: 'transferencia_bs', tasa_tipo: 'manual', tasa: 900 },
    { id: 'p6', concepto: 'parte', monto_usd: 25, metodo: 'usdt', tasa_tipo: null, tasa: null },
  ],
  nota: 'Prueba',
};

const res1 = actualizarPlanABcv(planMixto, 919.82);
ok('detecta cambio cuando hay partes BCV con tasa vieja', res1.cambio === true);
ok('actualiza parte transferencia_bs BCV a 919.82', res1.plan.partes[0].tasa === 919.82);
ok('actualiza parte pago_movil sin tasa_tipo (por defecto BCV) a 919.82', res1.plan.partes[1].tasa === 919.82 && res1.plan.partes[1].tasa_tipo === 'bcv');
ok('NO toca parte en tasa Euro (960)', res1.plan.partes[2].tasa === 960 && res1.plan.partes[2].tasa_tipo === 'euro');
ok('NO toca parte en tasa USDT (1050)', res1.plan.partes[3].tasa === 1050 && res1.plan.partes[3].tasa_tipo === 'usdt');
ok('NO toca parte en tasa manual (900)', res1.plan.partes[4].tasa === 900 && res1.plan.partes[4].tasa_tipo === 'manual');
ok('NO toca parte en USDT directo', res1.plan.partes[5].tasa === null);

const res2 = actualizarPlanABcv(res1.plan, 919.82);
ok('si ya está a la tasa de hoy, cambio es false', res2.cambio === false);

const res3 = actualizarPlanABcv(planMixto, 0);
ok('si tasa BCV es 0/inválida, no modifica nada', res3.cambio === false && res3.plan.partes[0].tasa === 880);

console.log(`test-plan-pago-bcv-auto: ${pass} pasaron, ${fail} fallaron.`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
