// 💲 Regla única del precio de un renglón (30-oct-2026): si est_price y price_usd
// quedan distintos manda price_usd (lo que muestra la tarjeta). Antes Por pagar
// sumaba est_price y el monto no cuadraba con el requerimiento.
import fs from 'node:fs';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };
const leer = (p) => fs.readFileSync(p, 'utf8').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

// Copia fiel de precioUnitarioUsdLinea / totalUsdLinea (src/lib/requerimientoFlujo.ts)
function precio(it, rate) {
  const qty = Number(it.qty) || 0;
  if (it.modo_precio === 'total' && Number(it.total_usd) > 0 && qty > 0) return Number(it.total_usd) / qty;
  if (Number(it.price_usd) > 0) return Number(it.price_usd);
  const est = Number(it.est_price) || 0;
  const r = Number(rate) || 1;
  return !it.currency || it.currency === 'USD' ? est : est / r;
}
const total = (it, rate) => (it.modo_precio === 'total' && Number(it.total_usd) > 0) ? Number(it.total_usd) : precio(it, rate) * (Number(it.qty) || 0);

const caso = [
  { qty: 2, currency: 'USD', est_price: 11.34, price_usd: 11.34 },
  { qty: 12, currency: 'USD', est_price: 11.34, price_usd: 24.36 },
  { qty: 4, currency: 'USD', est_price: 11.34, price_usd: 7 },
];
ok('el caso del requerimiento suma 343 y no 204,12', Math.round(caso.reduce((s, it) => s + total(it), 0) * 100) / 100 === 343);
ok('sin price_usd usa el estimado', precio({ qty: 3, currency: 'USD', est_price: 5 }) === 5);
ok('en Bs sin price_usd pasa a dólares con la tasa', precio({ qty: 1, currency: 'VES', est_price: 500 }, 250) === 2);
ok('modo total manda el total de la línea', total({ qty: 2, modo_precio: 'total', total_usd: 50, price_usd: 1 }) === 50);

const lib = leer('src/lib/requerimientoFlujo.ts');
const cxp = leer('src/screens/CuentasScreen.tsx');
const exp = leer('src/lib/requerimientoExpediente.ts');
const pdf = leer('src/lib/requerimiento.ts');
ok('la regla vive en requerimientoFlujo', /export function precioUnitarioUsdLinea/.test(lib) && /export function totalUsdLinea/.test(lib));
ok('la copia del test coincide con la regla', /if \(Number\(it\.price_usd\) > 0\) return Number\(it\.price_usd\);/.test(lib));
ok('el total del requerimiento usa la regla', /const lineTotalUsd = \(it: RequirementLine\) => totalUsdLinea\(it, rateBcv\);/.test(lib));
ok('el desglose de Por pagar usa la regla', /const lineTotalUsd = \(it: RequirementLine\) => totalUsdLinea\(it, tasaBcv\);/.test(cxp));
ok('el editor de ítems de Por pagar carga el precio de la regla', /unitUsd: String\(Math\.round\(precioUnitarioUsdLinea\(it, tasaBcv\)/.test(cxp));
ok('Por pagar ya no suma est_price a mano', !/Number\(it\.est_price\) \|\| 0\) \/ rate/.test(cxp) && !/const estPrice = Number\(it\.est_price\)/.test(cxp));
ok('el expediente usa la regla', /totalUsdLinea\(it\)/.test(exp) && /precioUnitarioUsdLinea\(it\)/.test(exp));
ok('el PDF del requerimiento prefiere price_usd', /Number\(it\.price_usd\) > 0 \? Number\(it\.price_usd\)/.test(pdf));

console.log(`${pass}/${pass + fail} ok`);
if (fail) { console.log('FALLAN:\n - ' + failures.join('\n - ')); process.exit(1); }
