/*
 * Test: el ADMIN decide qué máquinas salen en Viajes de camiones (17-sep-2026).
 *
 * Pedido del cliente: «como admin poder quitarle o colocarle máquinas a ese módulo de
 * viajes… si quiero que vean más o que vean menos».
 *
 * Lo que fija:
 *   · sin ajuste, la lista sigue igual que siempre (regla por código)
 *   · el ajuste del admin MANDA: pone una excavadora o quita un volteo
 *   · la lista del listero y su buscador obedecen el ajuste
 *   · solo el admin ve la tarjeta; si falta la tabla, la lista sigue como antes
 *   · quitar una máquina no toca sus viajes ni el pago; una puesta a mano se puede pagar
 *
 * La tabla y sus permisos (solo admin escribe) van en un .sql que no se sube al git.
 *
 *   node scripts/test-viajes-lista-camiones.mjs
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

const cache = new Map();
function cargarAbs(abs) {
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx']) if (fs.existsSync(c)) return cargarAbs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── 1) LA REGLA ─────────────────────────────────────────────────────────────
const L = cargarAbs(path.join(ROOT, 'src/lib/viajesListaCamiones.ts'));
const idx = L.indexarAjustesLista([
  { machinery_id: 'exc', visible: true },
  { machinery_id: 'vol', visible: false },
  { machinery_id: 'mal', visible: 'si' },
  { machinery_id: '', visible: true },
]);
eq('solo entran los ajustes válidos', Array.from(idx.keys()).sort(), ['exc', 'vol']);
eq('sin ajuste: el volteo sale, como siempre', L.saleEnViajes('CAMION VOLTEO 1', undefined), true);
eq('sin ajuste: la excavadora no sale, como siempre', L.saleEnViajes('EXCAVADORA 3', undefined), false);
eq('⭐ el admin PUSO la excavadora: sale', L.saleEnViajes('EXCAVADORA 3', idx.get('exc')), true);
eq('⭐ el admin QUITÓ el volteo: no sale', L.saleEnViajes('CAMION VOLTEO 1', idx.get('vol')), false);
eq('un ajuste inválido no cuenta: vuelve a la regla', L.saleEnViajes('CAMION VOLTEO 1', idx.get('mal')), true);
eq('estados', [
  L.estadoEnLista('TORONTO 2', null), L.estadoEnLista('PAYLOADER 1', null),
  L.estadoEnLista('PAYLOADER 1', { machinery_id: 'x', visible: true }), L.estadoEnLista('TORONTO 2', { machinery_id: 'x', visible: false }),
], ['auto_sale', 'auto_no_sale', 'puesta', 'quitada']);
ok('cada estado tiene su texto', ['auto_sale', 'auto_no_sale', 'puesta', 'quitada'].every((e) => L.etiquetaEstadoEnLista(e).length > 5));

// ── 2) LA BASE ──────────────────────────────────────────────────────────────
const db = sinComentarios(leer('src/lib/viajesListaCamionesDb.ts'));
ok('lee la tabla paginando por machinery_id (no tiene columna id)', /selectAllRows\('viajes_lista_camiones', [^)]*'machinery_id'\)/.test(db));
ok('si falta la tabla lo dice y no revienta', /if \(esTablaQueFalta\(e\)\) return \{ filas: \[\], falta: true \}/.test(db));
ok('volver a lo automático borra el ajuste', /\.delete\(\)\.eq\('machinery_id', machineryId\)\.select\('machinery_id'\)/.test(db));
ok('poner o quitar es un upsert por máquina', /\.upsert\(\{ machinery_id: machineryId, visible \}, \{ onConflict: 'machinery_id' \}\)/.test(db));
eq('las dos escrituras avisan si la base las rechazó', (db.match(/if \(!data\?\.length\) return \{ error: SIN_PERMISO_LISTA \}/g) || []).length, 2);

// ── 3) LA PANTALLA DE VIAJES ────────────────────────────────────────────────
const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
ok('⭐ la lista del listero obedece el ajuste', /\.filter\(\(m\) => saleEnViajes\(m\.code \|\| '', ajustes\.get\(m\.id\)\)\)/.test(scr));
ok('...y ya no usa la regla sola', !/isVolteoVolqueta\(m\.code/.test(scr));
ok('el buscador tampoco ofrece la que el admin quitó', /ajustesLista\.get\(t\.id\)\?\.visible !== false/.test(scr));
ok('si la lectura de ajustes falla, se quedan los últimos que se leyeron', /if \(!ajLista\.error\) \{\s*ajustesListaRef\.current = indexarAjustesLista\(ajLista\.filas\);/.test(scr));
ok('⭐ la tarjeta es solo del admin', /\{role === 'admin' \? \(\s*<Plegable\s*titulo="🚜 Máquinas que salen en Viajes"/.test(scr));
ok('...trabaja sobre el catálogo completo y recarga la lista al cambiar', /<ListaCamionesViajes\s*catalogo=\{catalogoTrucks\}\s*ajustes=\{ajustesLista\}\s*faltaSql=\{faltaSqlLista\}\s*onChanged=\{loadTrucks\}/.test(scr));

const comp = sinComentarios(leer('src/components/ListaCamionesViajes.tsx'));
ok('la tarjeta pone, quita y vuelve a lo automático', /cambiar\(m, !sale\)/.test(comp) && /cambiar\(m, null\)/.test(comp));
ok('...y avisa si falta la tabla en vez de dejar botones que fallan', /if \(faltaSql\) \{/.test(comp));
ok('...y dice que quitar no toca los viajes', leer('src/components/ListaCamionesViajes.tsx').includes('Sus viajes ya registrados no se tocan'));

// ── 4) EL PAGO ──────────────────────────────────────────────────────────────
const panel = sinComentarios(leer('src/components/PagoViajesPanel.tsx'));
const tar = sinComentarios(leer('src/components/PagoViajesTarifas.tsx'));
ok('una máquina puesta a mano se puede meter al pago', /esCamionDeViajes\(m\.code\) \|\| puestasEnViajes\.has\(m\.id\)/.test(panel));
ok('...y darle tarifa', /esCamionDeViajes\(m\.code\) \|\| !!puestasEnViajes\?\.has\(m\.id\)/.test(tar));
ok('...pero quitarla de Viajes NO la saca del pago (solo se usan las puestas)', /aj\.filas\.filter\(\(f\) => f\.visible\)/.test(panel));

// ── 5) AUDITORÍA Y MANUAL ───────────────────────────────────────────────────
ok('la tabla sale en Auditoría como Viajes', /viajes_lista_camiones: 'viajes'/.test(leer('src/lib/auditModulos.ts')));
ok('el manual .md lo explica', /Máquinas que salen en Viajes \(17\/09\/2026/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla también', /MÁQUINAS QUE SALEN EN VIAJES \(17\/09\/2026/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-lista-camiones · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
