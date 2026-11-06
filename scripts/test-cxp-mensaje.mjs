// 📲 Por pagar (02-nov-2026): mensaje de WhatsApp y PDF de pago de una cuenta o
// de varias marcadas. Transpila la lib REAL (cuentaMensaje) con datos sintéticos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cxp-msg-'));
fs.writeFileSync(path.join(tmp, 'pdf.mjs'), 'export function pdfDocument(o) { return JSON.stringify({ title: o.title, logos: o.logos, marcaTexto: o.marcaTexto }) + o.body; }');
for (const f of ['cuentaMensaje', 'planPago']) {
  const src = fs.readFileSync(path.join(raiz, 'src/lib', `${f}.ts`), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  fs.writeFileSync(path.join(tmp, `${f}.mjs`), js);
}
const M = await import(pathToFileURL(path.join(tmp, 'cuentaMensaje.mjs')).href);
const OP = M.OPCIONES_MENSAJE_DEFECTO;

const base = {
  orden: 'REQ-0001', prioridad: null, proveedor: 'PROVEEDOR PRUEBA C.A.', detalle: 'PEDIDO DE PRUEBA',
  nota: 'Nota de prueba', solicita: 'COCINA', analista: 'Analista Uno', autorizo: 'Gerente Uno',
  condiciones: 'CONTADO', totalUsd: 3108.58, saldoUsd: 3108.58, totalBs: 2765330.6, saldoBs: 2765330.6,
  tasaBs: 889.58, bsFijos: true,
  banco: { titular: 'PROVEEDOR PRUEBA', rifTitular: 'J-000000000', banco: 'Banco Prueba (0000)', numeroCuenta: '00000000000000000000' },
  empresa: 'EMPRESA PAGADORA C.A.',
};
const t1 = M.construirMensajeCuentas([base], OP);
ok('trae la orden', t1.includes('🔹 *ORDEN:* REQ-0001'));
ok('prioridad sin dato = Normal en verde', t1.includes('🟢 *Prioridad:* Normal'));
ok('trae proveedor, detalle, nota y personas', t1.includes('PROVEEDOR PRUEBA C.A.') && t1.includes('PEDIDO DE PRUEBA') && t1.includes('Nota de prueba') && t1.includes('🙋 *Solicita:* COCINA') && t1.includes('Analista Uno') && t1.includes('👔 *Autorizó:* Gerente Uno'));
ok('total con formato venezolano', t1.includes('💵 *Total:* $3.108,58'));
ok('Bs con la tasa', t1.includes('💱 *En Bs:* Bs 2.765.330,60 (tasa 889,58)'));
ok('datos de transferencia en viñetas', t1.includes('💳 Transferencia:') && t1.includes('• Titular: PROVEEDOR PRUEBA') && t1.includes('• Cuenta: 00000000000000000000'));
ok('la empresa al final', t1.trim().endsWith('🏢 *EMPRESA PAGADORA C.A.*'));
ok('sin pago móvil no sale su bloque', !t1.includes('Pago móvil'));

const apagado = M.construirMensajeCuentas([base], { ...OP, nota: false, personas: false, bs: false, banco: false, empresa: false, condiciones: false });
ok('lo apagado no sale ni deja rastro', !/Nota|Solicita|Analista|Autorizó|En Bs|Transferencia|EMPRESA|Condiciones/.test(apagado) && apagado.includes('Total'));

const parcial = M.construirMensajeCuentas([{ ...base, saldoUsd: 1000, saldoBs: 889580, bsFijos: false, tasaBs: 889.58 }], OP);
ok('con abonos dice lo que falta', parcial.includes('⏳ *Falta por pagar:* $1.000,00') && parcial.includes('Falta en Bs:* Bs 889.580,00 (tasa BCV de hoy 889,58)'));

const varias = M.construirMensajeCuentas([base, { ...base, orden: 'REQ-0002', prioridad: 'alta', totalUsd: 100, saldoUsd: 100 }], OP);
ok('varias: cabecera con total por pagar', varias.startsWith('🧾 *PAGOS PENDIENTES (2)* · Total por pagar: $3.208,58'));
ok('varias: numeradas y la urgente en rojo', varias.includes('*1.*') && varias.includes('*2.*') && varias.includes('🔴 *Prioridad:* Alta (urgente)'));
ok('varias de la misma empresa: una sola línea de empresa', (varias.match(/EMPRESA PAGADORA/g) || []).length === 1);

const vacio = M.construirMensajeCuentas([{ orden: 'X', proveedor: '', totalUsd: 5 }], OP);
ok('sin datos opcionales no salen líneas vacías', !/: *$/m.test(vacio) && !vacio.includes('undefined') && !vacio.includes('null'));

const url = M.urlWhatsappMensaje(t1);
ok('WhatsApp por api.whatsapp.com con saltos de línea', url.startsWith('https://api.whatsapp.com/send?text=') && url.includes('%0A'));

const html = M.mensajeCuentasHtml([base], { ...OP, logoGolden: true, logoBcv: false });
ok('PDF: título de una cuenta', html.includes('"title":"SOLICITUD DE PAGO"'));
ok('PDF: respeta los logos elegidos', html.includes('"golden":true') && html.includes('"bcv":false'));
ok('PDF: trae proveedor, total y banco', html.includes('PROVEEDOR PRUEBA C.A.') && html.includes('$3.108,58') && html.includes('Transferencia'));
const html2 = M.mensajeCuentasHtml([base, base], OP);
ok('PDF de varias: «PAGOS PENDIENTES» con resumen', html2.includes('"title":"PAGOS PENDIENTES"') && html2.includes('2 cuentas · Total por pagar'));
ok('opciones guardadas raras no rompen', M.normalizarOpcionesMensaje({ bs: 'no', nota: false }).bs === true && M.normalizarOpcionesMensaje(null).banco === true);

const pant = fs.readFileSync(path.join(raiz, 'src/screens/CuentasScreen.tsx'), 'utf8');
ok('botón por cuenta en Por pagar', pant.includes('📲 Mensaje / PDF de pago'));
ok('botón para las marcadas', pant.includes('📲 Mensaje / PDF de marcadas'));
ok('los Bs salen de la regla del requerimiento', pant.includes('const bs = bsDe(c);'));
ok('el modal se monta al final', pant.lastIndexOf('<MensajeCuentaModal') > pant.lastIndexOf('<ReporteCuentasModal'));

// ── Nuevos formatos ejecutivos: Lista Tesorería (1 línea) y Resumen ¿Se pagará? ──
const listaTes = M.construirListaTesoreriaCuentas(
  [
    { ...base, proveedor: 'FARMAHUMANA, C.A', totalUsd: 133.5, saldoUsd: 133.5 },
    { ...base, orden: 'REQ-0002', proveedor: 'PUBLICIDAD CAÑON,C.A.', totalUsd: 116.0, saldoUsd: 116.0 },
  ],
  { desde: '2026-11-01', hasta: '2026-11-04', empresaTexto: 'SOS LA GUAIRA' },
);
ok('Lista Tesorería: cabecera y período', listaTes.includes('🧾 *Reporte de Tesorería — Pendientes por pagar*') && listaTes.includes('_SOS LA GUAIRA · 01/11/2026 al 04/11/2026_'));
ok('Lista Tesorería: renglones con 🔻 y USD', listaTes.includes('1. 🔻 FARMAHUMANA, C.A — *USD 133,50*') && listaTes.includes('2. 🔻 PUBLICIDAD CAÑON,C.A. — *USD 116,00*'));
ok('Lista Tesorería: total con 💰 Total (2): $ 249,50', listaTes.includes('💰 *Total (2):* $ 249,50'));

const htmlTes = M.listaTesoreriaCuentasHtml([base], { incluirOrden: true, incluirDetalle: true, incluirBs: true });
ok('PDF Lista Tesorería: título y proveedor', htmlTes.includes('REPORTE DE TESORERÍA — PENDIENTES POR PAGAR') && htmlTes.includes('PROVEEDOR PRUEBA C.A.'));

const c1 = { ...base, id: 'cta-1', orden: 'REQ-0101', proveedor: 'FARMAHUMANA, C.A', totalUsd: 133.5, saldoUsd: 133.5 };
const c2 = { ...base, id: 'cta-2', orden: 'REQ-0102', proveedor: 'PUBLICIDAD CAÑON, C.A.', totalUsd: 116.0, saldoUsd: 116.0 };
const c3 = { ...base, id: 'cta-3', orden: 'REQ-0103', proveedor: 'SUBLI MAX', totalUsd: 234.32, saldoUsd: 234.32 };
const resumenDec = M.construirResumenDecisionCuentas(
  [c1, c2, c3],
  {
    'cta-1': { motivo: 'si' },
    'cta-2': { motivo: 'esperando_jefe' },
    'cta-3': { motivo: 'otro', motivoOtro: 'Falta factura fiscal original' },
  },
  { fechaHoraTexto: '05/11/2026' },
);
ok('Resumen Decisión: cabecera y fecha', resumenDec.includes('🧾 *RESUMEN · CUENTAS POR PAGAR*') && resumenDec.includes('📅 *Fecha:* 05/11/2026'));
ok('Resumen Decisión: motivos por cuenta',
  resumenDec.includes('✅ *Se pagará*') &&
  resumenDec.includes('⏸ *No se pagará* · Esperando respuestas por el jefe') &&
  resumenDec.includes('⏸ *No se pagará* · Falta factura fiscal original'));
ok('Resumen Decisión: totales separados de Se pagarán y No se pagarán',
  resumenDec.includes('💰 *Total evaluado (3 cuentas):* *$483,82*') &&
  resumenDec.includes('✅ *Se pagarán (1):* *$133,50*') &&
  resumenDec.includes('⏸ *No se pagarán (2):* *$350,32*'));

const htmlDec = M.resumenDecisionCuentasHtml([c1, c2], { 'cta-1': { motivo: 'si' }, 'cta-2': { motivo: 'sin_fondos' } }, OP);
ok('PDF Resumen Decisión: KPIs y motivo en tabla',
  htmlDec.includes('SE PAGARÁN (1)') &&
  htmlDec.includes('NO SE PAGARÁN (1)') &&
  htmlDec.includes('Sin fondos en estos momentos'));

// ── 05-nov-2026: Desglose de lo que se debe pagar a cada proveedor + método de pago de cada uno ──
const cuentaMultiProv = {
  ...base,
  id: 'cta-req-0171',
  orden: 'REQ-0171',
  proveedor: 'Proveedor',
  totalUsd: 2064.57,
  saldoUsd: 2064.57,
  totalBs: 1900000,
  saldoBs: 1900000,
  tasaBs: 920.28,
  bsFijos: false,
  desgloseProveedores: [
    {
      proveedor: 'INTERWELD, C.A.',
      totalUsd: 1455.8,
      totalBs: 1339743.62,
      pago: 'Banesco · Corriente · 0134-0000-00-0000000001 · RIF J-30123456-0',
      lineas: [{ name: 'MASCARILLA MEDIA CARA 3M', qty: 20, unit: 'UND', lineUsd: 830 }],
    },
    {
      proveedor: 'INVERSIONES ROTULOS I C.A.',
      totalUsd: 81.2,
      totalBs: 74726.74,
      pago: 'Pago móvil: 0102 · 0414-1234567 · J-40111222-3',
      lineas: [{ name: 'TABLA PARA ANOTACIONES', qty: 10, unit: 'UND', lineUsd: 70 }],
    },
    {
      proveedor: 'ELECPOWER',
      totalUsd: 126.67,
      totalBs: 116571.87,
      pago: 'Zelle: pagos@elecpower.com',
      lineas: [{ name: 'PROTECTOR DE VOLTAJE', qty: 4, unit: 'UND', lineUsd: 109.2 }],
    },
  ],
};
const fichaMulti = M.construirMensajeCuentas([cuentaMultiProv], OP);
ok('Ficha de pago multi-proveedor: incluye cada proveedor, cuánto pagarle y su método de pago',
  fichaMulti.includes('INTERWELD, C.A.') &&
  fichaMulti.includes('$1.455,80') &&
  fichaMulti.includes('Banesco · Corriente') &&
  fichaMulti.includes('INVERSIONES ROTULOS I C.A.') &&
  fichaMulti.includes('Pago móvil: 0102') &&
  fichaMulti.includes('ELECPOWER') &&
  fichaMulti.includes('Zelle: pagos@elecpower.com'));

const tesMulti = M.construirListaTesoreriaCuentas([cuentaMultiProv], {
  incluirDesgloseProveedores: true,
  incluirMetodosPago: true,
  incluirBs: true,
});
ok('Lista Tesorería multi-proveedor: desglosa cada proveedor con USD, Bs y método de pago',
  tesMulti.includes('REQ-0171 (3 proveedores)') &&
  tesMulti.includes('1.1 🏭 *INTERWELD, C.A.* — *USD 1.455,80*') &&
  tesMulti.includes('💳 Método de pago: Banesco · Corriente') &&
  tesMulti.includes('1.2 🏭 *INVERSIONES ROTULOS I C.A.* — *USD 81,20*') &&
  tesMulti.includes('1.3 🏭 *ELECPOWER* — *USD 126,67*'));

const decMulti = M.construirResumenDecisionCuentas([cuentaMultiProv], { 'cta-req-0171': { motivo: 'si' } });
ok('Resumen Decisión multi-proveedor: desglosa proveedores y métodos de pago',
  decMulti.includes('💳 *Desglose por proveedor (3):*') &&
  decMulti.includes('INTERWELD, C.A.') &&
  decMulti.includes('Zelle: pagos@elecpower.com'));

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
