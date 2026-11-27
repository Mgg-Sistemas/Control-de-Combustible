/*
 * 🧪 26-nov-2026: al abrir Requerimientos los Bs se ven con la tasa de hoy,
 * pero el presupuesto original (con su tasa y fecha) NO se pierde.
 *   node scripts/test-requerimiento-tasa-dia-presupuesto.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'req-tasa-dia-'));

for (const f of ['requerimientoTasa', 'planPago']) {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib', `${f}.ts`), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  fs.writeFileSync(path.join(TMP, `${f}.mjs`), js, 'utf8');
}

const T = await import(pathToFileURL(path.join(TMP, 'requerimientoTasa.mjs')).href);
const P = await import(pathToFileURL(path.join(TMP, 'planPago.mjs')).href);

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else { fail++; console.error(`  ✗ ${name}`); }
};

const itemGuardado = {
  qty: 10, modo_precio: 'unidad', price_usd: 100, est_price: 100, total_usd: 1000,
  price_bs: 91402, total_bs: 914020,
};

// 1. Histórico: se conserva con la tasa realmente usada y la fecha de creación.
const original = T.presupuestoOriginalDeItem(itemGuardado, '2026-11-25');
ok('guarda el presupuesto original en Bs', original?.price_bs === 91402 && original?.total_bs === 914020);
ok('guarda la tasa con que se armó (914,02)', original?.tasa === 914.02);
ok('guarda la fecha de creación', original?.fecha === '2026-11-25');

// 2. Al entrar: Bs ya calculados con la tasa de hoy, sin tocar el original.
const hoy = T.itemConTasaDeHoy(itemGuardado, 924.35);
ok('Bs unitarios con la tasa de hoy', hoy?.price_bs === 92435);
ok('Bs totales con la tasa de hoy', hoy?.total_bs === 924350);
ok('el original sigue intacto', original.price_bs === 91402 && itemGuardado.price_bs === 91402);

// 3. Modo «precio total» y tasa escrita a mano.
const modoTotal = T.itemConTasaDeHoy({ ...itemGuardado, modo_precio: 'total' }, 924.35);
ok('modo total usa el total en USD, no unitario × cantidad', modoTotal?.total_bs === 924350);
const manual = T.presupuestoOriginalDeItem({ ...itemGuardado, price_bs: 96000 }, null);
ok('la tasa escrita a mano se respeta como original (960)', manual?.tasa === 960);
const sinUsd = { ...itemGuardado, price_usd: 0, est_price: 0 };
ok('sin precio en $ usa la tasa BCV de la fecha de creación', T.presupuestoOriginalDeItem(sinUsd, '2026-11-25', 914.02)?.tasa === 914.02);
ok('sin precio en $ y sin tasa guardada dice «sin tasa registrada»', T.presupuestoOriginalDeItem(sinUsd, '2026-11-25')?.tasa === null);
ok('la tasa manual manda sobre la de la fecha', T.presupuestoOriginalDeItem({ ...itemGuardado, price_bs: 96000 }, null, 914.02)?.tasa === 960);

// 4. Si no hay precio en USD, no se inventa nada.
ok('sin USD no recalcula', T.itemConTasaDeHoy({ ...itemGuardado, price_usd: 0, est_price: 0 }, 924.35) === null);
ok('sin Bs guardados no hay presupuesto original', T.presupuestoOriginalDeItem({ ...itemGuardado, price_bs: 0 }, null) === null);

// 5. El botón «Actualizar todos» aparta el presupuesto antes de sobrescribir.
const fila = { price: '100', price_bs: '91402', total_bs: '914020', qty: '10' };
const capturado = T.capturarPresupuestoDeFila(fila, 924.35, '2026-11-25');
ok('botón captura el presupuesto anterior', capturado?.tasa === 914.02 && capturado?.total_bs === 914020);
ok('botón no captura si ya estaba el mismo', T.capturarPresupuestoDeFila({ price: '100', price_bs: '92435', qty: '10' }, 924.35) === null);
ok('botón no pisa un histórico ya guardado', T.capturarPresupuestoDeFila({ ...fila, presupuesto_original: original }, 999) === original);

// 6. El plan de pago también se ve a hoy y conserva su versión original.
const planGuardado = P.normalizarPlan({ partes: [{ id: 'p1', concepto: 'base', monto_usd: 100, metodo: 'transferencia_bs', tasa_tipo: 'bcv', tasa: 914.02 }] });
const { plan: planHoy, cambio } = P.actualizarPlanABcv(planGuardado, 924.35);
ok('plan: detecta el cambio de tasa', cambio === true && planHoy.partes[0].tasa === 924.35);
const planParaForm = { ...planHoy, original: planGuardado };
const alGuardar = P.normalizarPlan(planParaForm);
ok('plan: la tasa de hoy se guarda', alGuardar.partes[0].tasa === 924.35);
ok('plan: el plan original sobrevive al guardar', alGuardar.original?.partes?.[0]?.tasa === 914.02);

console.log(`test-requerimiento-tasa-dia-presupuesto: ${pass} pasaron, ${fail} fallaron.`);
if (fail) process.exit(1);
