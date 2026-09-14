/*
 * Test del HISTORIAL DE PRECIOS por jornada (14-sep-2026).
 *
 * Problema del cliente: cambiar el precio de una máquina reescribía semanas ya
 * trabajadas, porque una jornada sin precio congelado se cobraba con el precio de HOY.
 * La regla que manda desde ahora: "lo pasado se conserva, no se cambia".
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · una jornada sin precio congelado toma el precio que regía ESE día
 *   · el precio congelado (> 0) sigue mandando
 *   · dos cambios el mismo día: antes de ese día vale el precio de ANTES del primero
 *   · las TRES pantallas que cobran jornadas usan la misma regla (Control de
 *     Maquinaria, Control de Pagos, Informe por jornada) — si una sola queda con el
 *     precio de hoy, los montos dejan de cuadrar entre pantallas
 *   · cerrar el control congela por (máquina, DÍA), no un precio por máquina
 *   · si el historial no se puede leer, NO se calcula con el precio de hoy en silencio
 *
 * Sin framework (el repo no tiene): transpila el .ts en memoria con `typescript`.
 *
 *   node scripts/test-precio-historial.mjs
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

function cargar(rel) {
  const p = path.join(ROOT, rel);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  m._compile(js, p);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; failures.push(`✗ ${name}\n    obtenido: ${JSON.stringify(got)}\n    esperado: ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── 1) LA REGLA ─────────────────────────────────────────────────────────────
const L = cargar('src/lib/precioHistorial.ts');
ok('la librería no importa nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/precioHistorial.ts'))));

// Máquina A: valía 500; el 14 pasó a 600; el 20 pasó a 700 (el precio de hoy).
// Llegan desordenados a propósito.
const hist = L.indexarHistorialPrecios([
  { machinery_id: 'A', precio_anterior: '600', vigente_desde: '2026-09-20', cambiado_at: '2026-09-20T12:00:00Z' },
  { machinery_id: 'A', precio_anterior: 500, vigente_desde: '2026-09-14', cambiado_at: '2026-09-14T15:00:00Z' },
  // Máquina B: dos cambios el MISMO día (100 → 150 → 200).
  { machinery_id: 'B', precio_anterior: 150, vigente_desde: '2026-09-15', cambiado_at: '2026-09-15T13:00:00Z' },
  { machinery_id: 'B', precio_anterior: 100, vigente_desde: '2026-09-15', cambiado_at: '2026-09-15T11:00:00Z' },
  // Máquina C: no tenía precio antes del cambio.
  { machinery_id: 'C', precio_anterior: null, vigente_desde: '2026-09-16', cambiado_at: '2026-09-16T11:00:00Z' },
  // Filas rotas: se ignoran.
  { machinery_id: '', precio_anterior: 1, vigente_desde: '2026-09-16' },
  { machinery_id: 'D', precio_anterior: 1, vigente_desde: '' },
]);

eq('jornada vieja: el precio de antes del primer cambio', L.precioVigenteEn(hist, 'A', '2026-09-10', 700), 500);
eq('el día del cambio ya rige el precio nuevo', L.precioVigenteEn(hist, 'A', '2026-09-14', 700), 600);
eq('entre dos cambios: el del medio', L.precioVigenteEn(hist, 'A', '2026-09-19', 700), 600);
eq('desde el último cambio: el precio de hoy', L.precioVigenteEn(hist, 'A', '2026-09-20', 700), 700);
eq('después: el precio de hoy', L.precioVigenteEn(hist, 'A', '2026-09-25', 700), 700);
eq('dos cambios el mismo día: antes vale el de antes del PRIMERO', L.precioVigenteEn(hist, 'B', '2026-09-14', 200), 100);
eq('...y ese día vale el de hoy', L.precioVigenteEn(hist, 'B', '2026-09-15', 200), 200);
eq('antes no tenía precio: sale sin precio', L.precioVigenteEn(hist, 'C', '2026-09-01', 300), null);
eq('máquina sin cambios: el precio de hoy', L.precioVigenteEn(hist, 'Z', '2026-09-01', 450), 450);
eq('las filas rotas no crean máquinas', [...hist.keys()].sort(), ['A', 'B', 'C']);
eq('sin id de máquina: el precio de hoy', L.precioVigenteEn(hist, null, '2026-09-10', 700), 700);
eq('sin fecha: el precio de hoy', L.precioVigenteEn(hist, 'A', null, 700), 700);
eq('sin historial cargado: el precio de hoy', L.precioVigenteEn(null, 'A', '2026-09-10', 700), 700);
eq('precio de hoy vacío: sin precio', L.precioVigenteEn(hist, 'Z', '2026-09-10', null), null);
eq('fecha con hora: se usa el día', L.precioVigenteEn(hist, 'A', '2026-09-10T23:00:00', 700), 500);

eq('el precio congelado manda', L.precioEfectivoJornada(800, hist, 'A', '2026-09-10', 700), 800);
eq('congelado en texto también', L.precioEfectivoJornada('800', hist, 'A', '2026-09-10', 700), 800);
eq('congelado en 0 no vale: el del día', L.precioEfectivoJornada(0, hist, 'A', '2026-09-10', 700), 500);
eq('sin congelado: el del día', L.precioEfectivoJornada(null, hist, 'A', '2026-09-10', 700), 500);
eq('congelado basura: el del día', L.precioEfectivoJornada('abc', hist, 'A', '2026-09-10', 700), 500);

// ── 2) LA LECTURA NO SE TRAGA ERRORES ───────────────────────────────────────
const db = sinComentarios(leer('src/lib/precioHistorialDb.ts'));
ok('el historial se lee paginado', /selectAllRows\(\s*'machinery_precio_historial'/.test(db));
ok('si la lectura falla, lanza (no calcula con el precio de hoy)', !/catch/.test(db));

// ── 3) LAS TRES PANTALLAS USAN LA MISMA REGLA ───────────────────────────────
const cm = sinComentarios(leer('src/screens/ControlMaquinariaScreen.tsx'));
const cp = sinComentarios(leer('src/screens/ControlPagosScreen.tsx'));
const rp = sinComentarios(leer('src/screens/ReportsScreen.tsx'));

// Ninguna pantalla vuelve a caer al precio de HOY con el patrón viejo `frozen ? frozen : actual`.
for (const [nombre, src] of [['Control de Maquinaria', cm], ['Control de Pagos', cp], ['Reportes', rp]]) {
  eq(`${nombre}: no queda el patrón «congelado o el de hoy»`, (src.match(/Number\(\w+\.frozen_price\) : /g) || []).length, 0);
}

ok('Control: carga el historial junto a las máquinas', /cargarHistorialPrecios\(\),\s*\]\);/.test(cm) && /setHistPrecios\(hp\);/.test(cm));
ok('Control: el cierre usa el precio del día', /price: precioEfectivoJornada\(r\.frozen_price, histPrecios, r\.machinery\?\.id, r\.round_date, r\.machinery\?\.price_per_hour\)/.test(cm));
ok('Control: el resumen usa el precio del día', /effectivePrice\(b\.machinery_id, b\.frozen_price, b\.round_date\)/.test(cm));
ok('Control: el total de la tarjeta usa el precio del día', /precioEfectivoJornada\(b\.frozen_price, histPrecios, b\.machinery_id, b\.round_date/.test(cm));
ok('...y se recalcula cuando llega el historial', /\[rounds, weekDays, machines, histPrecios\]/.test(cm));
ok('Control: editar un día cerrado usa el precio de ese día', /precioVigenteEn\(histPrecios, m\.id, dISO, m\.price_per_hour\)/.test(cm));
ok('Control: el PDF de un cierre viejo usa el precio del día', /precioVigenteEn\(histPrecios, m\.machineId, m\.date, actual\)/.test(cm));
ok('Control: el detalle de un cierre viejo usa el precio del día', /precioVigenteEn\(histPrecios, d\.machineId, d\.date, actual\)/.test(cm));

const ini = cm.indexOf('const cerrarControl = async');
const cierre = cm.slice(ini, cm.indexOf('const openHistorico', ini));
ok('cerrar el control congela por máquina Y día', ini >= 0 && /\.eq\('round_date', date\)/.test(cierre));
ok('...y ya no estampa un precio por máquina en todo el rango', !/priceByMachine/.test(cierre) && !/\.gte\('round_date', from\)\.lte\('round_date', to\)/.test(cierre));
ok('...solo rellena lo que no tenía precio congelado', /\.or\('frozen_price\.is\.null,frozen_price\.eq\.0'\)/.test(cierre));

ok('Pagos: carga el historial en la semana', /fletesRows, histPrecios\] = await Promise\.all/.test(cp));
ok('Pagos: guarda el precio de cada día', /ma\.pricePerDay\[r\.round_date\] = precioVigenteEn\(histPrecios, r\.machinery\?\.id, r\.round_date, price\)/.test(cp));
ok('Pagos: el precio por rango sigue mandando', /ma\.priceRango = rp;/.test(cp) && /ma\.priceRango == null/.test(cp));
ok('Pagos: el total suma día por día', /ma\.pricePerDay\[fecha\]/.test(cp) && /total \+= bruto;/.test(cp));
ok('Pagos: el cotejo usa el precio del día', /cur\.price = precioEfectivoJornada\(r\.frozen_price, histPrecios, r\.machinery\?\.id, r\.round_date, pph\)/.test(cp));
ok('Pagos: el reporte por tipo usa el precio del día', /effectivePrice\(m, r\.frozen_price, r\.round_date\)/.test(cp) && /rnds, histPrecios\] = await Promise\.all/.test(cp));

ok('Informe por jornada: carga el historial', /const histPrecios = await cargarHistorialPrecios\(\);/.test(rp));
ok('Informe por jornada: usa el precio del día', /cur\.price = precioEfectivoJornada\(r\.frozen_price, histPrecios, mm\.id, r\.round_date, mm\.price_per_hour\)/.test(rp));

// ── 4) MANUAL ───────────────────────────────────────────────────────────────
ok('el manual .md lo explica', /Cambiar un precio ya no reescribe lo pasado \(14\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla también', /CAMBIAR UN PRECIO YA NO REESCRIBE LO PASADO \(14\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-precio-historial · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
