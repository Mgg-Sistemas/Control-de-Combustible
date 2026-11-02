// 📋 Plan de pago (02-nov-2026): pagos mixtos (base en $, IVA en Bs a BCV, base en
// Bs a tasa USDT, Zelle, USDT…). Transpila las libs REALES con datos sintéticos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-pago-'));
fs.writeFileSync(path.join(tmp, 'pdf.mjs'), 'export function pdfDocument(o) { return o.body; }');
for (const f of ['planPago', 'cuentaMensaje']) {
  const src = fs.readFileSync(path.join(raiz, 'src/lib', `${f}.ts`), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  fs.writeFileSync(path.join(tmp, `${f}.mjs`), js);
}
const P = await import(pathToFileURL(path.join(tmp, 'planPago.mjs')).href);
const M = await import(pathToFileURL(path.join(tmp, 'cuentaMensaje.mjs')).href);

// Base e IVA
const bi = P.baseEIva(116, 16);
ok('base e IVA desde el total', bi.base === 100 && bi.iva === 16);
ok('sin IVA todo es base', P.baseEIva(50, 0).iva === 0);

// Plantillas
const pl1 = P.aplicarPlantilla('base_usd_iva_bs', 116, 16, { bcv: 100 });
ok('base en $ + IVA en Bs a BCV', pl1.length === 2 && pl1[0].metodo === 'efectivo_usd' && pl1[0].monto_usd === 100 && pl1[1].concepto === 'iva' && pl1[1].tasa === 100);
ok('el IVA en Bs se calcula con su tasa', P.montoEnMoneda(pl1[1]) === 1600);
const pl2 = P.aplicarPlantilla('base_bs_usdt_iva_bs_bcv', 116, 16, { bcv: 100 });
ok('base en Bs a USDT queda sin tasa hasta escribirla', pl2[0].tasa_tipo === 'usdt' && pl2[0].tasa === null);
ok('sin la tasa USDT no se puede guardar', /tasa/.test(P.validarPlan(pl2, 116)));
pl2[0].tasa = 110;
ok('con la tasa escrita valida', P.validarPlan(pl2, 116) === null);
ok('la base en Bs a tasa USDT', P.montoEnMoneda(pl2[0]) === 11000);
ok('todas las plantillas suman el total', P.PLANTILLAS.every((t) => {
  const partes = P.aplicarPlantilla(t.key, 3108.58, 16, { bcv: 889.58, usdt: 1000 });
  return Math.abs(partes.reduce((s, p) => s + p.monto_usd, 0) - 3108.58) < 0.005;
}));

// Validación
ok('si no suman el total no se guarda', /faltan/.test(P.validarPlan([{ id: 'a', concepto: 'base', monto_usd: 50, metodo: 'zelle' }], 116)));
ok('si se pasan tampoco', /se pasan/.test(P.validarPlan([{ id: 'a', concepto: 'base', monto_usd: 200, metodo: 'zelle' }], 116)));
ok('sin partes no se guarda', P.validarPlan([], 10) !== null);

// Abonos por parte
const partes = [
  { id: 'b', concepto: 'base', monto_usd: 100, metodo: 'efectivo_usd' },
  { id: 'i', concepto: 'iva', monto_usd: 16, metodo: 'transferencia_bs', tasa_tipo: 'bcv', tasa: 100 },
];
const e1 = P.estadoPartes(partes, [{ monto: 16, parte_id: 'i' }]);
ok('el abono marcado paga su parte', e1[1].pagada && !e1[0].pagada && e1[0].faltaUsd === 100);
const e2 = P.estadoPartes(partes, [{ monto: 60 }]);
ok('el abono sin parte se reparte en orden', e2[0].abonadoUsd === 60 && e2[0].faltaUsd === 40 && e2[1].faltaUsd === 16);
const e3 = P.estadoPartes(partes, [{ monto: 116 }]);
ok('pagado completo: todas en ✅', e3.every((e) => e.pagada));

// Plan guardado viejo o roto
ok('plan roto no revienta', P.normalizarPlan(null) === null && P.normalizarPlan({ partes: [{ monto_usd: 0 }] }) === null);
const n = P.normalizarPlan({ partes: [{ id: 'x', concepto: 'raro', monto_usd: '10', metodo: 'nuevo' }] });
ok('normaliza conceptos y métodos desconocidos', n.partes[0].concepto === 'parte' && n.partes[0].metodo === 'otro' && n.partes[0].monto_usd === 10);

// Mensaje
const linea = P.lineaParte(partes[1], 16);
ok('línea del IVA en Bs', linea === 'IVA 16%: $16,00 → Bs 1.600,00 (tasa BCV 100,00) · 🏦 Transferencia Bs');
ok('parte pagada sale con ✅', P.lineaParte(partes[1], 16, e1[1]).startsWith('✅ '));
const datos = {
  orden: 'REQ-1', proveedor: 'PROVEEDOR', totalUsd: 116, saldoUsd: 116, totalBs: 11600, saldoBs: 11600, tasaBs: 100,
  banco: { titular: 'T', banco: 'Banco', numeroCuenta: '000', pagoMovilTelefono: '0000', binanceId: 'BIN' },
  plan: { partes, alicuotaIva: 16, estados: null },
};
const txt = M.construirMensajeCuentas([datos], M.OPCIONES_MENSAJE_DEFECTO);
ok('con plan sale «Forma de pago» con cada parte', txt.includes('💳 *Forma de pago:*') && txt.includes('1) Base: $100,00') && txt.includes('2) IVA 16%'));
ok('con plan no sale el bloque único «En Bs»', !txt.includes('*En Bs:*'));
ok('con plan solo salen los datos bancarios de sus métodos', txt.includes('💳 Transferencia:') && !txt.includes('Pago móvil') && !txt.includes('Binance'));
const sinPlan = M.construirMensajeCuentas([{ ...datos, plan: null }], M.OPCIONES_MENSAJE_DEFECTO);
ok('sin plan siguen todos los datos bancarios y el «En Bs»', sinPlan.includes('*En Bs:*') && sinPlan.includes('Pago móvil') && sinPlan.includes('Binance'));
const html = M.mensajeCuentasHtml([datos], M.OPCIONES_MENSAJE_DEFECTO);
ok('el PDF también trae la forma de pago', html.includes('Forma de pago') && html.includes('IVA 16%'));

// Fuentes
const lib = fs.readFileSync(path.join(raiz, 'src/lib/planPago.ts'), 'utf8');
const cxp = fs.readFileSync(path.join(raiz, 'src/screens/CuentasScreen.tsx'), 'utf8');
const req = fs.readFileSync(path.join(raiz, 'src/screens/RequerimientoTab.tsx'), 'utf8');
ok('Por Pagar guarda el plan comprobando que la base guardó', cxp.includes("update({ plan_pago: valor, updated_at: nowISO() }).eq('id', c.id).select('id')"));
ok('el abono se marca contra su parte', cxp.includes('parte_id: abParteId'));
ok('una cuenta pagada no cambia de plan', cxp.includes("if (c.situacion === 'pagada') { toast.error('La cuenta ya está pagada"));
ok('el requerimiento también define el plan', req.includes("from('inventory_requirements').update({ plan_pago: valor }"));
ok('Por Pagar usa el plan del requerimiento si no tiene uno propio', cxp.includes('normalizarPlan(req?.plan_pago)'));
ok('los modales del plan se montan al final', cxp.lastIndexOf('<PlanPagoModal') > cxp.lastIndexOf('<ReporteCuentasModal') && req.lastIndexOf('<PlanPagoModal') > req.lastIndexOf('<EditarSoporteReqModal'));
ok('interruptor presente', /export const PLAN_PAGO_ACTIVO = (true|false);/.test(lib));

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
