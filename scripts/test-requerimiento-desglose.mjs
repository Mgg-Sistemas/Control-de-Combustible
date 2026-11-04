// Prueba del desglose por proveedor y de las observaciones limpias del PDF del
// requerimiento (04-nov-2026). Caso real: REQ-0171, 6 renglones de 5 proveedores.
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cargar = (rel, stubs) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', 'require', js)(mod.exports, mod, (id) => {
    for (const [k, v] of Object.entries(stubs)) if (id.endsWith(k)) return v;
    throw new Error('import inesperado: ' + id);
  });
  return mod.exports;
};
const R = cargar('src/lib/requerimiento.ts', {
  './pdf': { pdfDocument: (o) => `<html>${o.title}|${o.subtitle}|${o.body}</html>` },
  './firmaData': { FIRMA_DATA_URI: 'x', FIRMA2_DATA_URI: 'y' },
});

let pass = 0, fail = 0; const fallos = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fallos.push(`  ✗ ${n}`); } };
const eq = (n, a, b) => ok(`${n} — obtenido ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

const it = (name, qty, price, supplier_name) => ({ name, unit: 'UND', qty, est_price: price, currency: 'USD', supplier_name });
const D = {
  code: 'REQ-0171', fecha: '28/10/2026', statusLabel: 'Aprobado', rate: 893.22, ivaAlicuota: 16,
  proveedor: 'INVERSIONES ROTULOS I C.A.',
  items: [
    it('MASCARILLA MEDIA CARA 3M CON CARTUCHOS', 20, 41.5, 'interweld, c.a.'),
    it('TABLA PARA ANOTACIONES', 10, 7, null),
    it('CASCOS COLOR AMARILLO', 50, 8.5, 'interweld, c.a.'),
    it('JABON LIQUIDO', 2, 3.8, 'proveduria tu universo , c.a.'),
    it('CHALECOS REFLECTIVOS', 100, 3.38, 'INVERSIONES GUANTCA C.A.'),
    it('PROTECTOR DE VOLTAJE', 4, 27.3, 'elecpower'),
  ],
  proveedoresPago: { [R.claveProveedorReq('interweld, c.a.')]: '📱 PM: 04143285360' },
};
const g = R.desgloseProveedoresReq(D);
eq('un grupo por proveedor; sin proveedor en el renglón = el del requerimiento',
  g.map((x) => [x.proveedor, x.renglones]),
  [['interweld, c.a.', 2], ['INVERSIONES ROTULOS I C.A.', 1], ['proveduria tu universo , c.a.', 1], ['INVERSIONES GUANTCA C.A.', 1], ['elecpower', 1]]);
eq('subtotal de cada uno', g.map((x) => x.subtotalUsd), [1255, 70, 7.6, 338, 109.2]);
eq('a pagar a cada uno (con IVA)', g.map((x) => x.totalUsd), [1455.8, 81.2, 8.82, 392.08, 126.67]);
eq('⭐ la suma da EXACTO el total del papel ($2.064,57)', Math.round(g.reduce((a, x) => a + x.totalUsd, 0) * 100) / 100, 2064.57);
eq('⭐ y el IVA suma exacto ($284,77)', Math.round(g.reduce((a, x) => a + x.ivaUsd, 0) * 100) / 100, 284.77);
eq('trae los datos de pago del que los tiene', [g[0].pago, g[1].pago], ['📱 PM: 04143285360', '']);
eq('trae los productos de cada uno', g[0].items.map((i) => [i.name, i.lineUsd]), [['MASCARILLA MEDIA CARA 3M CON CARTUCHOS', 830], ['CASCOS COLOR AMARILLO', 425]]);
const exento = R.desgloseProveedoresReq({ ...D, items: [{ ...D.items[0], exento: true }, D.items[4]] });
eq('lo exento no paga IVA', [exento[0].ivaUsd, exento[0].exentoUsd, exento[1].ivaUsd], [0, 830, 54.08]);

const html = R.requerimientoHtml({ ...D, observaciones: '' });
ok('con varios proveedores el papel trae el desglose', /Desglose por proveedor/.test(html) && /\$1\.455,80/.test(html));
ok('y avisa el que no tiene datos de pago', /sin datos de pago cargados/.test(html));
ok('con un solo proveedor no sale el desglose (el total ya lo dice)', !/Desglose por proveedor/.test(R.requerimientoHtml({ ...D, items: [D.items[1]] })));

// Las observaciones de la captura: marcas internas que se colaban al papel.
const OBS = `ANOTACIONES, CARTUCHOS *IMPORTANTE* SOLICITUD DE MULTIPLES ITEMS, CADA UNO CON SU PROVEEDOR Y SUS DATOS DE PAGO POR FAVOR VERIFICAR BIEN

[CONDICIONES_PAGO: CONTADO · 🏦 TASA BCV]
[IVA_CUENTA: 16][ENVIADO_CXP: Por: GABRIELA GONZALEZ | Id: 73aa2109 | Fecha: 2026-11-02T19:01:01.914Z | Origen: requerimiento]

[APROBADO_CXP: Estado: aprobado | Por: JESUS LOZADA | Id: c6f6eee0 | Fecha: 2026-11-03T20:26:41.471Z]
[[HISTORIAL_COMPRA:%5B%7B%22id%22%3A%22ev-1%22%7D%5D:FIN_HISTORIAL]]`;
eq('🧹 las observaciones quedan con lo que escribió la persona',
  R.limpiarObservacionesPapel(OBS),
  'ANOTACIONES, CARTUCHOS *IMPORTANTE* SOLICITUD DE MULTIPLES ITEMS, CADA UNO CON SU PROVEEDOR Y SUS DATOS DE PAGO POR FAVOR VERIFICAR BIEN');
ok('🧹 un historial sin cierre tampoco se cuela', R.limpiarObservacionesPapel('hola [[HISTORIAL_COMPRA:%5B%7B') === 'hola');
ok('🧹 el texto normal entre corchetes se queda', R.limpiarObservacionesPapel('Ver [nota del jefe: urgente]') === 'Ver [nota del jefe: urgente]');
const htmlObs = R.requerimientoHtml({ ...D, observaciones: OBS });
ok('🧹 el papel ya no trae el historial ni las etiquetas', !/HISTORIAL_COMPRA|APROBADO_CXP|ENVIADO_CXP|IVA_CUENTA|CONDICIONES_PAGO/.test(htmlObs) && /VERIFICAR BIEN/.test(htmlObs));

const cxp = fs.readFileSync(path.join(ROOT, 'src/screens/CuentasScreen.tsx'), 'utf8');
const req = fs.readFileSync(path.join(ROOT, 'src/screens/RequerimientoTab.tsx'), 'utf8');
ok('Por Pagar muestra el desglose y el PDF', /<DesgloseProveedoresCxp/.test(cxp));
ok('Requerimientos y Por Pagar arman el PDF con la MISMA función', /armarReqPdfData\(r,/.test(req) && /armarReqPdfData\(props\.req/.test(fs.readFileSync(path.join(ROOT, 'src/components/DesgloseProveedoresCxp.tsx'), 'utf8')));

console.log(`\n💳 Desglose por proveedor y PDF del requerimiento: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { console.error(fallos.join('\n')); process.exit(1); }
