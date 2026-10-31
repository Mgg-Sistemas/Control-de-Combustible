// 🧾 Factura del requerimiento (31-oct-2026): la foto del PRODUCTO nunca se muestra
// como factura, y varias fotos de factura/comprobante van y vuelven intactas.
// Corre el código REAL de src/lib/requerimientoExpediente.ts (transpilado al vuelo).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const src = fs.readFileSync('src/lib/requerimientoExpediente.ts', 'utf8');
const desde = src.indexOf('function cleanTagField');
const hasta = src.indexOf('/**\n * Extrae los datos de trazabilidad física');
if (desde < 0 || hasta < 0) { console.error('No se encontró el bloque a probar'); process.exit(1); }
// Solo se evalúa código del propio repositorio (nada externo).
const js = ts.transpileModule(src.slice(desde, hasta).replace(/^export /gm, ''), { compilerOptions: { target: 'ES2020', module: 'None' } }).outputText;
const lib = new Function('dmyOf', `${js}; return { extraerFactura, inyectarFacturaEnObservaciones, extraerReciboPago, inyectarReciboPagoEnObservaciones };`)(
  (iso) => String(iso).slice(0, 10)
);

const FOTO_PRODUCTO = 'https://x/requerimientos_temp/cafetera.jpeg';
const FACTURA = 'https://x/requerimientos/factura.jpeg';

// 1. El caso real: adjunto = foto del producto, la recepción dejó solo el número.
const req182 = {
  attachment_url: FOTO_PRODUCTO, attachment_type: 'image', attachment_name: 'Foto o formato adjunto',
  items: [{ name: 'CAFETERA', image_url: FOTO_PRODUCTO }],
  received_at: '2026-10-31T18:54:14Z',
  observaciones: '[RECEPCIÓN ALMACÉN: Factura N° 00001234 (con soporte adjunto) · Nota: recibido]',
};
const f1 = lib.extraerFactura(req182);
ok('conserva el número de la recepción', f1?.numero === '00001234');
ok('NO muestra la foto del producto como factura', !f1?.url && (f1?.archivos?.length ?? 0) === 0);

// 2. Si el adjunto SÍ era la factura (requerimiento sin adjunto previo), se sigue mostrando.
const req203 = { ...req182, attachment_url: FACTURA, attachment_name: 'factura.jpeg', items: [{ name: 'X', image_url: FOTO_PRODUCTO }] };
ok('el adjunto que es factura se sigue mostrando', lib.extraerFactura(req203)?.url === FACTURA);

// 3. Varias fotos de factura: ida y vuelta.
const tres = [
  { url: FACTURA, tipo: 'image', nombre: 'p1.jpg' },
  { url: 'https://x/f2.pdf', tipo: 'pdf', nombre: 'p2.pdf' },
  { url: 'https://x/f3.jpg', tipo: 'image', nombre: 'Foto | con barra ] y corchete' },
];
const obs = lib.inyectarFacturaEnObservaciones(req182.observaciones, {
  numero: '00001234', empresa: 'Proveedor', fecha: '2026-10-31', url: FACTURA, tipo: 'image', nombre: 'p1.jpg',
  archivos: tres, nota: 'corregida', subidaPor: 'Compras', subidaAt: '2026-10-31T20:00:00Z',
});
const f3 = lib.extraerFactura({ ...req182, observaciones: obs });
ok('guarda las 3 fotos', f3?.archivos?.length === 3);
ok('la primera es la principal', f3?.url === FACTURA);
ok('el PDF conserva su tipo', f3?.archivos?.[1]?.tipo === 'pdf');
ok('nombres raros no rompen la etiqueta', f3?.archivos?.[2]?.url === 'https://x/f3.jpg');
ok('conserva la nota', f3?.nota === 'corregida');
ok('la etiqueta tiene precedencia sobre el número de la recepción', f3?.numero === '00001234');
ok('no se pierde la nota de recepción', obs.includes('[RECEPCIÓN ALMACÉN:'));

// 4. Editar = quitar la equivocada: queda solo lo que se dejó, y sin duplicar etiquetas.
const obs2 = lib.inyectarFacturaEnObservaciones(obs, { numero: '00001234', empresa: 'Proveedor', archivos: [tres[1]], url: tres[1].url, tipo: 'pdf' });
const f4 = lib.extraerFactura({ ...req182, observaciones: obs2 });
ok('editar deja solo la foto que quedó', f4?.archivos?.length === 1 && f4.archivos[0].url === 'https://x/f2.pdf');
ok('una sola etiqueta de factura', (obs2.match(/\[FACTURA PROVEEDOR:/g) || []).length === 1);

// 5. Comprobante con varias fotos; el monto viaja intacto al editar.
const rec = lib.inyectarReciboPagoEnObservaciones('', {
  url: 'https://x/c1.jpg', tipo: 'image', nombre: 'c1', referencia: '11112222', monto: 100, metodo: 'Transferencia',
  fecha: '2026-10-30', archivos: [{ url: 'https://x/c1.jpg', tipo: 'image', nombre: 'c1' }, { url: 'https://x/c2.jpg', tipo: 'image', nombre: 'c2' }],
});
const r5 = lib.extraerReciboPago({ observaciones: rec });
ok('comprobante con 2 fotos', r5?.archivos?.length === 2);
ok('comprobante conserva monto y referencia', r5?.monto === 100 && r5?.referencia === '11112222');
const recEd = lib.inyectarReciboPagoEnObservaciones(rec, { ...r5, archivos: [r5.archivos[1]], url: r5.archivos[1].url });
const r6 = lib.extraerReciboPago({ observaciones: recEd });
ok('editar comprobante quita la foto equivocada', r6?.archivos?.length === 1 && r6.url === 'https://x/c2.jpg');
ok('editar comprobante no pierde el monto', r6?.monto === 100);

// 6. Pantallas: el editor no toca estado ni monto de la cuenta, y la recepción ya guarda la factura.
const modal = fs.readFileSync('src/components/EditarSoporteReqModal.tsx', 'utf8');
ok('el editor no cambia el estado de la cuenta', !/estado\s*:/.test(modal));
ok('el editor no cambia el monto de la cuenta (solo arrastra el que había)', [...modal.matchAll(/\bmonto\s*:\s*([^\s,]+)/g)].every((m) => m[1].startsWith('prev')));
ok('el editor verifica que la base guardó', modal.includes(".select('id')") && modal.includes('okReq.length === 0'));
const tab = fs.readFileSync('src/screens/RequerimientoTab.tsx', 'utf8');
ok('la recepción guarda la factura como etiqueta', tab.includes('obsConTagRecv = inyectarFacturaEnObservaciones(obsConTagRecv, dataFacRecv)'));
ok('la recepción acepta varias fotos', tab.includes('pickAndUploadRequirementFiles(\'requerimientos\')'));
ok('el editor se monta al final', tab.lastIndexOf('<EditarSoporteReqModal') > tab.lastIndexOf('<CotizacionesModal'));

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
