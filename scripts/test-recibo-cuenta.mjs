/*
 * RECIBO DE COBRO / PAGO de una CUENTA (Compras → Por cobrar / Por pagar).
 *
 * Blinda `src/lib/reciboCuenta.ts`: título según el tipo, montos, el "Son: … en
 * letras" (que es lo más fácil de romper) y la tabla de abonos.
 *
 *   npm run test:recibo-cuenta   (o: node scripts/test-recibo-cuenta.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const transpilar = (rel) => ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;

// `pdf.ts` arrastra react-native/expo-print: se sustituye por un envoltorio mínimo
// que devuelve el body para poder inspeccionarlo.
const fakeRequire = (id) => {
  if (id.includes('pdf')) return {
    pdfDocument: (o) => `<html><title>${o.title}</title><div class="doc-sub">${o.subtitle || ''}</div><style>${o.extraCss || ''}</style>${o.body}</html>`,
  };
  throw new Error('import inesperado: ' + id);
};

const mod = { exports: {} };
new Function('exports', 'module', 'require', transpilar('src/lib/reciboCuenta.ts'))(mod.exports, mod, fakeRequire);
const { reciboCuentaHtml } = mod.exports;

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    → ${extra}` : ''}`); } };

const BASE = {
  numero: 'F-00153', fecha: '22/08/2026', contraparte: 'CORPORACIÓN VENEZOLANA DE MINERÍA S.A',
  concepto: 'ARRENDAMIENTO DE EQUIPOS', documento: 'F-00153', moneda: 'USD',
  monto: 245676.17, abonado: 0, saldo: 245676.17, situacionLabel: '🕓 Pendiente',
  fechaEmision: '01/07/2026', fechaVencimiento: '30/07/2026', nota: null, abonos: [],
};

// 1) Por cobrar → título RECIBO DE COBRO, y saldo pendiente → "SALDO POR COBRAR".
const cobro = reciboCuentaHtml({ ...BASE, tipo: 'por_cobrar' });
ok('título cobro', cobro.includes('RECIBO DE COBRO'));
ok('saldo por cobrar', cobro.includes('SALDO POR COBRAR'));

// 2) El "Son: … en letras" del ejemplo real de la factura Minería Carabobo.
ok('monto en letras', cobro.includes('DOSCIENTOS CUARENTA Y CINCO MIL SEISCIENTOS SETENTA Y SEIS CON 17/100 DÓLARES'),
  'no salió el monto en letras esperado');

// 3) Por pagar → título RECIBO DE PAGO.
const pago = reciboCuentaHtml({ ...BASE, tipo: 'por_pagar' });
ok('título pago', pago.includes('RECIBO DE PAGO'));
ok('saldo por pagar', pago.includes('SALDO POR PAGAR'));

// 4) Cuenta saldada (saldo 0) → "TOTAL COBRADO" en vez de saldo pendiente.
const saldada = reciboCuentaHtml({ ...BASE, tipo: 'por_cobrar', abonado: 245676.17, saldo: 0, situacionLabel: '✅ Pagada' });
ok('total cobrado', saldada.includes('TOTAL COBRADO') && !saldada.includes('SALDO POR COBRAR'));

// 5) Abonos → salen en su tabla.
const conAbonos = reciboCuentaHtml({
  ...BASE, tipo: 'por_cobrar', abonado: 100, saldo: 245576.17,
  abonos: [{ fecha: '10/08/2026', monto: 100, metodo: 'USDT', referencia: 'TX-9' }],
});
ok('abonos', conAbonos.includes('Abonos registrados') && conAbonos.includes('TX-9'));

// 6) Bs usa "BOLÍVARES" y símbolo Bs.
const enBs = reciboCuentaHtml({ ...BASE, tipo: 'por_cobrar', moneda: 'VES' });
ok('moneda Bs', enBs.includes('BOLÍVARES') && enBs.includes('Bs'));

console.log(`\nRecibo de cuenta: ${pass} pasaron, ${fail} fallaron`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
