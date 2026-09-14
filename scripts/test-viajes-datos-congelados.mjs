/*
 * Test: cada viaje nuevo guarda su EMPRESA, su ZONA DE PAGO y su ORIGEN (14-sep-2026).
 *
 * Punto 0 del plan de cobro por viaje. El cliente decidió que la zona (Este 30 $ /
 * Oeste 50 $) sale del CDT/obra del viaje. Sin guardar estos datos AL REGISTRAR, el
 * cobro tendría que leer la empresa y la zona de HOY, y un camión que cambió de dueño
 * o una obra que cambió de zona reescribirían lo ya viajado.
 *
 * Lo que fija:
 *   · la empresa y la zona NO salen del teléfono: las pone la base (la app no las manda)
 *   · la app sí dice el origen: campo, cola sin señal o carga manual
 *   · la tarjeta de obras deja marcar Este/Oeste y avisa si la base lo rechaza
 *   · la zona se valida: solo 'este' u 'oeste'
 *
 * Lo de la base (trigger que copia y trigger que impide cambiar) se probó contra la base
 * real con rollback; el SQL no va al repositorio.
 *
 *   node scripts/test-viajes-datos-congelados.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const stubs = {
  text: {
    norm: (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(),
    cmpText: (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'es', { sensitivity: 'base' }),
  },
};
function loadTs(abs) {
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
  const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs));
  const orig = m.require.bind(m);
  m.require = (id) => stubs[id.split('/').pop()] ?? orig(id);
  m._compile(out, m.filename);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; failures.push(`✗ ${name}\n    obtenido: ${JSON.stringify(got)}\n    esperado: ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── 1) LA ZONA DE PAGO ──────────────────────────────────────────────────────
const U = loadTs(path.join(ROOT, 'src/lib/ubicacionesObra.ts'));
eq('este', U.zonaPagoValida('este'), 'este');
eq('con mayúsculas y espacios', U.zonaPagoValida(' OESTE '), 'oeste');
eq('otra cosa no es zona', U.zonaPagoValida('norte'), null);
eq('vacío no es zona', U.zonaPagoValida(''), null);
eq('null no es zona', U.zonaPagoValida(null), null);
eq('etiqueta Este', U.etiquetaZonaPago('este'), 'Este');
eq('etiqueta Oeste', U.etiquetaZonaPago('oeste'), 'Oeste');
eq('etiqueta sin zona', U.etiquetaZonaPago(null), 'Sin zona');
eq('solo dos zonas, en orden', U.ZONAS_PAGO.map((z) => z.key), ['este', 'oeste']);
eq('cuenta las obras ACTIVAS sin zona', U.obrasActivasSinZona([
  { id: '1', nombre: 'A', active: true, zona_pago: 'este' },
  { id: '2', nombre: 'B', active: true, zona_pago: null },
  { id: '3', nombre: 'C', active: false, zona_pago: null },
  { id: '4', nombre: 'D', active: true, zona_pago: 'sur' },
]), 2);

// ── 2) LA APP NO MANDA EMPRESA NI ZONA; SÍ EL ORIGEN ─────────────────────────
const cv = sinComentarios(leer('src/lib/camionViajes.ts'));
const ini = cv.indexOf('export async function registrarViaje');
const reg = cv.slice(ini, cv.indexOf('export async function', ini + 10));
ok('registrarViaje existe', ini >= 0);
ok('no manda la empresa (company_id): la pone la base', !/company_id\s*:/.test(reg));
ok('no manda la zona de pago: la pone la base', !/zona_pago\s*:/.test(reg));
ok('manda el origen solo si lo sabe', /\.\.\.\(params\.origen \? \{ origen: params\.origen \} : \{\}\)/.test(reg));

const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
ok('el viaje tocado en el patio dice «campo»', /registrarViaje\(\{ \.\.\.payload, clientActionId, origen: 'campo' \}\)/.test(scr));
ok('la carga a mano dice «manual»', /note: nota,\s*origen: 'manual',/.test(scr));
ok('el viaje guardado sin señal NO dice «campo» al guardarse en la cola', !/guardarEnCola\(\{[^}]*origen/.test(scr));
const cola = sinComentarios(leer('src/lib/viajesOfflineQueue.ts'));
ok('la cola sin señal dice «cola»', /registrarViaje\(\{ \.\.\.it\.payload, clientActionId: it\.id, origen: 'cola' \}\)/.test(cola));

// ── 3) LA TARJETA DE OBRAS ──────────────────────────────────────────────────
const ob = sinComentarios(leer('src/components/ObrasListeros.tsx'));
ok('cambiar la zona pide filas y avisa si la base lo rechaza',
  /from\('ubicaciones_obra'\)\.update\(\{ zona_pago: nueva \}\)\.eq\('id', o\.id\)\.select\('id'\)/.test(ob) && /cambiarZona[\s\S]*?if \(!data\?\.length\) \{ toast\.error\(SIN_PERMISO_OBRA\); return; \}/.test(ob));
ok('tocar la zona marcada la quita', /zonaPagoValida\(o\.zona_pago\) === zona \? null : zona/.test(ob));
ok('hay un botón por zona', /ZONAS_PAGO\.map\(/.test(ob) && /onPress=\{\(\) => cambiarZona\(o, z\.key\)\}/.test(ob));
ok('arriba avisa las obras sin zona', /obrasActivasSinZona\(obras\)/.test(ob) && /obra\(s\) sin zona/.test(ob));

// ── 4) MANUAL ───────────────────────────────────────────────────────────────
ok('el manual .md lo explica', /Marcar la zona de pago de cada obra \(14\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla también', /ZONA DE PAGO DE CADA OBRA \(14\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-datos-congelados · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
