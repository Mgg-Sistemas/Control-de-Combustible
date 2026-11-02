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
const src = fs.readFileSync(path.join(raiz, 'src/lib/cuentaMensaje.ts'), 'utf8');
let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
fs.writeFileSync(path.join(tmp, 'cuentaMensaje.mjs'), js);
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

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
