/*
 * 🧪 26-nov-2026: el mensaje/PDF de pago y «Por pagar» deben usar la tasa BCV
 * del día en las partes del plan, sin tocar lo guardado en la base.
 *   node scripts/test-plan-pago-mensaje-tasa-dia.mjs
 *
 * La prueba FALLA si el mensaje sigue usando la tasa guardada (914,02) y PASA
 * cuando se usa la del día (924,35). La opción «tasa de ese día» conserva la
 * guardada; Euro / USDT / manual y las partes en $ no se tocan.
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-mensaje-tasa-'));

fs.writeFileSync(
  path.join(TMP, 'pdf.mjs'),
  'export function pdfDocument(o) { return JSON.stringify({ title: o.title, logos: o.logos }) + o.body; }',
);
for (const f of ['planPago', 'cuentaMensaje', 'cuentaPagoResuelto']) {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib', `${f}.ts`), 'utf8');
  let js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  fs.writeFileSync(path.join(TMP, `${f}.mjs`), js, 'utf8');
}

const M = await import(pathToFileURL(path.join(TMP, 'cuentaMensaje.mjs')).href);
const R = await import(pathToFileURL(path.join(TMP, 'cuentaPagoResuelto.mjs')).href);
const OP = M.OPCIONES_MENSAJE_DEFECTO;

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else { fail++; console.error(`  ✗ ${name}`); }
};

const planGuardado = {
  partes: [
    { id: 'p1', concepto: 'base', monto_usd: 100, metodo: 'transferencia_bs', tasa_tipo: 'bcv', tasa: 914.02 },
    { id: 'p2', concepto: 'iva', monto_usd: 16, metodo: 'pago_movil', tasa_tipo: 'euro', tasa: 960 },
    { id: 'p3', concepto: 'parte', monto_usd: 20, metodo: 'usdt', tasa_tipo: null, tasa: null },
  ],
  nota: 'Plan guardado el día anterior',
};
const dato = {
  orden: 'REQ-0300', proveedor: 'PROVEEDOR PRUEBA', detalle: 'PRUEBA DE TASA',
  totalUsd: 136, saldoUsd: 136, totalBs: 124266.72, saldoBs: 124266.72,
  tasaBs: 914.02, tasaBsHoy: 924.35, bsFijos: false,
  plan: planGuardado,
};

// Sin el arreglo: el mensaje sale con la tasa de ayer (esto es lo que fallaba).
const antes = M.construirMensajeCuentas([dato], OP);
ok('REPRODUCCIÓN: sin el arreglo el mensaje dice la tasa guardada 914,02', antes.includes('914,02'));

// Con el arreglo: la lib pura que usa el modal convierte solo las partes BCV.
const convertir = typeof M.planParaMensaje === 'function'
  ? (d, usarDia, hoy) => M.planParaMensaje(d, usarDia, hoy)
  : (d) => d; // sin el arreglo queda la tasa vieja y las aserciones fallan
const planHoy = convertir(planGuardado, false, 924.35);
const msgHoy = M.construirMensajeCuentas([{ ...dato, plan: planHoy }], OP);
ok('mensaje: usa la tasa BCV de hoy 924,35', msgHoy.includes('924,35'));
ok('mensaje: ya no dice la tasa de ayer 914,02', !msgHoy.includes('914,02'));
ok('mensaje: Bs de la parte BCV recalculados (100 × 924,35)', msgHoy.includes('92.435,00') && !msgHoy.includes('91.402,00'));
ok('mensaje: respeta la parte en Euro 960', msgHoy.includes('960'));
ok('mensaje: respeta la parte en USDT', msgHoy.includes('20,00 USDT'));

const htmlHoy = M.mensajeCuentasHtml([{ ...dato, plan: planHoy }], OP);
ok('PDF: usa la tasa BCV de hoy 924,35', htmlHoy.includes('924,35'));
ok('PDF: ya no dice la tasa de ayer 914,02', !htmlHoy.includes('914,02'));

// Opción explícita «tasa de ese día»: se conserva el histórico, no se sobrescribe.
const planEseDia = convertir(planGuardado, true, 924.35);
const msgEseDia = M.construirMensajeCuentas([{ ...dato, plan: planEseDia }], OP);
ok('tasa de ese día: conserva 914,02', msgEseDia.includes('914,02') && !msgEseDia.includes('924,35'));
ok('tasa de ese día: no modifica el plan original', planGuardado.partes[0].tasa === 914.02);

// Sin tasa de hoy válida: no inventar ni ocultar la tasa vieja.
const planSinTasa = convertir(planGuardado, false, null);
ok('sin tasa de hoy: conserva la guardada y avisa el modal',
  M.construirMensajeCuentas([{ ...dato, plan: planSinTasa }], OP).includes('914,02'));

// «Por pagar» (ficha, reporte y lista tesorería) debe reflejar la misma tasa.
const baseCuenta = { monto: 136, saldo: 136, situacion: 'pendiente', contraparte: 'PROVEEDOR PRUEBA' };
const resueltoAntes = R.resolverPagoCuenta({ ...baseCuenta, plan: planGuardado }, 924.35);
const resueltoHoy = R.resolverPagoCuenta({ ...baseCuenta, plan: planHoy }, 924.35);
ok('Por pagar: antes mostraba la tasa guardada', resueltoAntes.cubetas[0].tasaValor === 914.02);
ok('Por pagar: ahora muestra la tasa del día', resueltoHoy.cubetas[0].tasaValor === 924.35);
ok('Por pagar: el monto en Bs de la parte BCV se recalcula', resueltoHoy.cubetas[0].montoBs === 92435);
ok('Por pagar: la parte en Euro sigue en 960', resueltoHoy.cubetas[1].tasaValor === 960);

console.log(`test-plan-pago-mensaje-tasa-dia: ${pass} pasaron, ${fail} fallaron.`);
if (fail) process.exit(1);
