// 💱 Requerimientos (02-nov-2026): el total en Bs es el que escribió la persona.
// Antes salía de (US$ redondeado × tasa de HOY): 130.000 + 20.800 = 150.800 se
// mostraba como 150.801,60 y cambiaba cada día. Transpila la lib REAL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'req-bs-'));
const src = fs.readFileSync(path.join(raiz, 'src/lib/requerimientoFlujo.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
fs.writeFileSync(path.join(tmp, 'flujo.mjs'), js);
const F = await import(pathToFileURL(path.join(tmp, 'flujo.mjs')).href);

// Montos sintéticos con la misma forma del caso reportado.
const tasa = 889.56;
const items = [
  { qty: 1, currency: 'USD', est_price: 146.14, price_usd: 146.14, price_bs: 130000, total_bs: 130000, modo_precio: 'unidad' },
  { qty: 1, currency: 'USD', est_price: 23.38, price_usd: 23.38, price_bs: 20800, total_bs: 20800, modo_precio: 'unidad' },
];
ok('el total en Bs es la suma de lo escrito', F.calcularTotalesReqBs(items, tasa, 0).totalBs === 150800);
ok('la tasa de otro día no lo cambia', F.calcularTotalesReqBs(items, 950, 0).totalBs === 150800);
ok('antes daba otra cosa (el bug)', Math.round((146.14 + 23.38) * tasa * 100) / 100 !== 150800);
ok('con cantidad multiplica el unitario en Bs', F.totalBsLinea({ qty: 3, price_bs: 1000, price_usd: 1.1 }, tasa) === 3000);
ok('modo total manda el total en Bs', F.totalBsLinea({ qty: 4, modo_precio: 'total', total_bs: 5000, price_bs: 1 }, tasa) === 5000);
ok('renglón en Bs sin precio en $ usa su est_price', F.totalBsLinea({ qty: 2, currency: 'VES', est_price: 700 }, tasa) === 1400);
ok('renglón solo en $ pasa con la tasa', F.totalBsLinea({ qty: 1, currency: 'USD', est_price: 10 }, 100) === 1000);
ok('sin tasa y sin Bs da 0', F.totalBsLinea({ qty: 1, currency: 'USD', est_price: 10 }, null) === 0);
const conIva = F.calcularTotalesReqBs([{ qty: 1, price_bs: 1000 }, { qty: 1, price_bs: 500, exento: true }], tasa, 16);
ok('IVA en Bs solo sobre lo no exento', conIva.ivaBs === 160 && conIva.totalBs === 1660);

const tab = fs.readFileSync(path.join(raiz, 'src/screens/RequerimientoTab.tsx'), 'utf8');
ok('la tarjeta usa los Bs de los renglones', tab.includes('calcularTotalesReqBs(r.items, rate, alic)'));
ok('la tarjeta ya no recalcula el total con la tasa de hoy', !tab.includes('fmtBs(bsFromUsd(totalConIvaUsd, rate))'));

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
