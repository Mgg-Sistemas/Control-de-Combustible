// 📎 SOPORTES DEL PAGO DE CADA PERSONA (19-oct-2026) — pruebas.
//
// Pedido: «en el pago para un período poder subirle una o varias imágenes…
// una imagen de factura o algo así a cada persona, sin dañar ni nada».
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// La lib importa ./supabase (el cliente); para las funciones PURAS basta un stub.
function cargarConStub(rel) {
  const p = path.join(ROOT, rel);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  const orig = m.require.bind(m);
  m.require = (id) => (id === './supabase' ? { supabase: {} } : orig(id));
  m._compile(js, p);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

console.log('\n📎 SOPORTES DEL PAGO DE CADA PERSONA\n');

const S = cargarConStub('src/lib/nominaSoportes.ts');

// ═══ 1) Las funciones puras ═══════════════════════════════════════════════════
{
  const sops = [
    { id: '1', itemId: 'a', periodId: 'p', url: 'u1', kind: 'image', name: 'factura.jpg', creadoAt: '2026-10-19T10:00:00Z', por: 'MARÍA' },
    { id: '2', itemId: 'b', periodId: 'p', url: 'u2', kind: 'pdf', name: null, creadoAt: null, por: null },
    { id: '3', itemId: 'a', periodId: 'p', url: 'u3', kind: 'image', name: null, creadoAt: '2026-10-19T11:00:00Z', por: 'JOSÉ' },
  ];
  const m = S.agruparSoportes(sops);
  eq('⭐ agrupa por persona conservando el orden', m.get('a').map((x) => x.id), ['1', '3']);
  eq('…y cada quien tiene lo suyo', m.get('b').length, 1);
  eq('vacío o nulo: mapa vacío, sin reventar', [S.agruparSoportes([]).size, S.agruparSoportes(null).size], [0, 0]);
  eq('⭐ la etiqueta dice nombre, fecha y quién',
    S.etiquetaSoporte(sops[0]), 'factura.jpg · 19/10 · por MARÍA');
  eq('sin nombre: dice qué es (PDF o imagen)', S.etiquetaSoporte(sops[1]), 'PDF');
  eq('imagen sin nombre, con fecha', S.etiquetaSoporte(sops[2]), 'imagen · 19/10 · por JOSÉ');
}

// ═══ 2) Los candados del código ═══════════════════════════════════════════════
{
  const lib = leer('src/lib/nominaSoportes.ts');
  ok('⭐ la tabla es staff_pay_item_docs (aparte: no toca los montos)',
    (lib.match(/staff_pay_item_docs/g) || []).length >= 3 && !/staff_pay_items'\)\.update|staff_pay_items'\)\.insert/.test(lib));
  ok('⭐ insertar y borrar llevan .select(\'id\') (la RLS que rechaza sin error se delata)',
    /insert\(\{[\s\S]{0,300}?\}\)\.select\('id'\)/.test(lib) && /delete\(\)\.eq\('id', id\)\.select\('id'\)/.test(lib));
  ok('…y 0 filas se trata como NO guardado/NO borrado', /data\.length === 0\) return \{ error/.test(lib));

  const box = leer('src/components/SoportesPagoBox.tsx');
  ok('⭐ cámara Y galería/archivo, los dos (regla de la casa 27-sep)',
    /📷 Cámara/.test(box) && /🖼️ Imagen o PDF/.test(box)
    && /takePhotoAndUpload\('nomina-soportes', itemId\)/.test(box)
    && /pickAndUploadDocFile\('nomina-soportes', itemId\)/.test(box));
  ok('⭐ borrar confirma antes (es evidencia de un pago)', /Sí, borrar/.test(box) && /setBorrando/.test(box));
  ok('tocar el soporte lo abre', /Linking\.openURL\(s\.url\)/.test(box));
  ok('cancelar la cámara no regaña (solo errores de verdad)', /sin error = canceló/.test(box));

  const scr = leer('src/screens/PagoPersonalScreen.tsx');
  ok('⭐ la tarjeta de cada persona tiene su botón 📎 con el conteo',
    /soportesPorItem\.get\(it\.id\) \?\? \[\]\)\.length \|\| 'Soportes'/.test(scr));
  ok('⭐ subir exige escritura en nómina y borrar exige full',
    /puedeSubir=\{puedeTarifa\}/.test(scr) && /puedeBorrar=\{puedeEditarPeriodo\}/.test(scr));
  ok('⭐ la cajita NO depende del candado del período (el comprobante llega después de pagar)',
    /\{soportesDe === it\.id && sel \? \(/.test(scr) && !/soportesDe === it\.id && sel && sel\.status/.test(scr));
  ok('los soportes se cargan con el detalle del período', /listarSoportesPeriodo\(p\.id\)/.test(scr));
}

// ═══ 3) El arreglo de la pastilla contradictoria (mismo día) ══════════════════
{
  // «Maquinaria averiada» decía «● Operativa» en la esquina: solo miraba
  // `operational`. Ahora usa el MISMO estado en vivo que la tarjeta del catálogo.
  const eq2 = leer('src/screens/EquiposScreen.tsx');
  const bloques = eq2.match(/const liveEstado = liveStatusOf\(m\.id\)\.estado;/g) || [];
  ok('⭐ la etiqueta en vivo está en la tarjeta del catálogo Y en el listado por estado', bloques.length >= 2);
  ok('…y ya no queda el ternario viejo que solo miraba operational',
    !/m\.en_espera \? '⏳ Esperando' : m\.operational \? '● Operativa' : '● Retirada'/.test(eq2));
}

if (fail) {
  console.error(failures.join('\n'));
  console.error(`\n❌ test-nomina-soportes · ${fail} fallo(s), ${pass} ok`);
  process.exit(1);
}
console.log(`✅ test-nomina-soportes · ${pass} pruebas ok`);
