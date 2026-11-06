// 💱 Por pagar (02-nov-2026): la cuenta que viene de un requerimiento cargado en Bs
// muestra los Bs escritos en el requerimiento, no «US$ × tasa de hoy».
// Transpila las libs REALES (cuentasBs + requerimientoFlujo) con datos sintéticos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxp-bs-'));
for (const f of ['cuentasBs', 'requerimientoFlujo']) {
  const src = fs.readFileSync(path.join(raiz, 'src/lib', `${f}.ts`), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  fs.writeFileSync(path.join(tmp, `${f}.mjs`), js);
}
const B = await import(pathToFileURL(path.join(tmp, 'cuentasBs.mjs')).href);

const req = {
  items: [
    { qty: 1, currency: 'USD', price_usd: 146.14, price_bs: 130000, total_bs: 130000 },
    { qty: 1, currency: 'USD', price_usd: 23.38, price_bs: 20800, total_bs: 20800 },
  ],
};
const cuenta = { monto: 169.52, saldo: 169.52, nota: 'Generada automáticamente.' };
const m = B.montosBsCuenta(cuenta, req, 889.56);
ok('monto en Bs = lo escrito en el requerimiento', m.fijo && m.montoBs === 150800);
ok('sin abonos el saldo en Bs es el mismo', m.saldoBs === 150800);
ok('otra tasa del día no lo mueve', B.montosBsCuenta(cuenta, req, 1000).montoBs === 150800);
const mitad = B.montosBsCuenta({ ...cuenta, saldo: 84.76 }, req, 889.56);
ok('con abono, el saldo en Bs es la parte que falta', mitad.saldoBs === 75400);
ok('pagada: saldo en Bs 0', B.montosBsCuenta({ ...cuenta, saldo: 0 }, req, 889.56).saldoBs === 0);
const enDolares = B.montosBsCuenta({ monto: 10, saldo: 10 }, { items: [{ qty: 1, currency: 'USD', est_price: 10 }] }, 100);
ok('requerimiento solo en $: aproximado con la tasa de hoy', !enDolares.fijo && enDolares.montoBs === 1000);
ok('cuenta sin requerimiento: aproximado', B.montosBsCuenta({ monto: 5, saldo: 5 }, null, 100).fijo === false);
const conIva = B.montosBsCuenta({ monto: 11.6, saldo: 11.6, alicuota_iva: 16 }, { items: [{ qty: 1, price_usd: 10, price_bs: 1000 }] }, 100);
ok('el IVA de la cuenta se suma en Bs', conIva.montoBs === 1160);
ok('lee la tasa congelada de la nota', B.tasaDeNotaCuenta('… (Bs 100.50 por $): equivale …') === 100.5);

const pant = fs.readFileSync(path.join(raiz, 'src/screens/CuentasScreen.tsx'), 'utf8');
const rep = fs.readFileSync(path.join(raiz, 'src/lib/cuentasReporte.ts'), 'utf8');
ok('Por pagar usa los Bs del requerimiento', pant.includes('montosBsCuenta(c,') && pant.includes('bsDe(c).saldoBs'));
ok('el reporte recibe los Bs fijados', pant.includes('saldoBsDe={') && rep.includes('args.saldoBsDe'));
ok('ya no queda el saldo solo con la tasa en la lista', !pant.includes('≈ {fmtBs(bsFromUsd(c.saldo, tasaBcv))}'));

// ── 05-nov-2026: Actualizar siempre a la tasa del día en Por Pagar + botón enorme para tasa de ese día ──
const actualizadoHoy = B.montosBsCuenta(cuenta, req, 1000, { actualizarATasaDelDia: true });
ok('con actualizarATasaDelDia=true actualiza siempre a la tasa del día de hoy',
  !actualizadoHoy.fijo &&
  actualizadoHoy.montoBs === 169520 &&
  actualizadoHoy.saldoBs === 169520 &&
  actualizadoHoy.tieneTasaEseDia === true &&
  actualizadoHoy.montoBsEseDia === 150800);
const tasaEseDiaActiva = B.montosBsCuenta(cuenta, req, 1000, { actualizarATasaDelDia: false });
ok('con actualizarATasaDelDia=false usa la tasa de ese día (del requerimiento)',
  tasaEseDiaActiva.fijo &&
  tasaEseDiaActiva.montoBs === 150800 &&
  tasaEseDiaActiva.montoBsHoy === 169520);
ok('pantalla tiene el botón enorme para alternar a la tasa de ese día',
  pant.includes('QUIERO LA TASA DE ESE DÍA') && pant.includes('toggleTasaEseDiaGlobal'));

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
