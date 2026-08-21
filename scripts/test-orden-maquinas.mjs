/*
 * Test del ORDEN de la lista de máquinas del Check (21-ago-2026).
 *
 * QUÉ PEDIDO CUBRE (textual del cliente):
 *   «ahorita está organizado por abecedario y maquinarias, pero quiero poder
 *    organizar por encargado, que me salgan todos pero que se vean las máquinas
 *    organizadas por nombre del encargado, que pueda elegir entre una u otra»
 *
 * LO QUE BLINDA (`src/lib/ordenMaquinas.ts`):
 *   · 'maquina'   → A→Z por código, EXACTAMENTE como salía antes.
 *   · 'encargado' → A→Z por encargado y, dentro de cada uno, A→Z por código.
 *   · "SIN ENCARGADO" SIEMPRE de último (es una lista de pendientes, no un
 *     encargado más), aunque el alfabeto lo mandara a otro lado.
 *   · El mismo encargado escrito distinto ("bruno", "Bruno", "BRUNO ") es UN
 *     solo grupo — si no, saldría partido en tres renglones.
 *   · ⭐ Cambiar el orden NUNCA esconde una máquina: salen todas, siempre.
 *   · Los grupos cuadran con la lista que se está viendo (mismo total).
 *
 * No usa framework de test (el repo no tiene): transpila los .ts en memoria con
 * el `typescript` ya instalado.
 *
 *   npm run test:orden-maquinas   (o: node scripts/test-orden-maquinas.mjs)
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
const loadTs = (srcPath) => {
  if (cache.has(srcPath)) return cache.get(srcPath);
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  cache.set(srcPath, m.exports);
  const origRequire = m.require.bind(m);
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(srcPath), `${id}.ts`)) : origRequire(id));
  m._compile(out, m.filename);
  cache.set(srcPath, m.exports);
  return m.exports;
};

const { ordenarMaquinas, agruparMaquinas, encargadoDe, SIN_ENCARGADO } =
  loadTs(path.join(ROOT, 'src/lib/ordenMaquinas.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── Datos de prueba ────────────────────────────────────────────────────────
const m = (code, encargado) => ({ id: code, code, encargado });
const LISTA = [
  m('VOLTEO TORONTO', 'BRUNO'),
  m('EXCAVADORA 12', 'CARLOS'),
  m('PAYLOADER 3', null),
  m('RETRO 7', 'ana'),
  m('CAMION 900', 'BRUNO'),
  m('GRUA 2', '  bruno  '),   // mismo encargado, escrito distinto
  m('MINICARGADOR', ''),
  m('TRACTOR 5', 'ANA'),
];
const codes = (arr) => arr.map((x) => x.code);

// ── 1) NOMBRE DEL ENCARGADO NORMALIZADO ────────────────────────────────────
{
  eq('mayúsculas', encargadoDe(m('X', 'bruno')), 'BRUNO');
  eq('espacios de sobra', encargadoDe(m('X', '  bruno  ')), 'BRUNO');
  eq('espacios internos', encargadoDe(m('X', 'juan   perez')), 'JUAN PEREZ');
  eq('vacío', encargadoDe(m('X', '')), SIN_ENCARGADO);
  eq('nulo', encargadoDe(m('X', null)), SIN_ENCARGADO);
  eq('solo espacios', encargadoDe(m('X', '   ')), SIN_ENCARGADO);
  eq('sin la propiedad', encargadoDe({ id: 'X', code: 'X' }), SIN_ENCARGADO);
}

// ── 2) POR MÁQUINA: como salía antes (A→Z por código) ──────────────────────
{
  const r = ordenarMaquinas(LISTA, 'maquina');
  eq('A→Z por código', codes(r), [
    'CAMION 900', 'EXCAVADORA 12', 'GRUA 2', 'MINICARGADOR',
    'PAYLOADER 3', 'RETRO 7', 'TRACTOR 5', 'VOLTEO TORONTO',
  ]);
  eq('⭐ no se pierde ninguna', r.length, LISTA.length);
  // Un solo grupo y SIN título: la lista se ve igual que siempre.
  const g = agruparMaquinas(r, 'maquina');
  eq('un solo grupo', g.length, 1);
  eq('sin título', g[0].label, '');
  eq('con todas adentro', g[0].items.length, LISTA.length);
}

// ── 3) POR ENCARGADO: agrupadas por nombre ─────────────────────────────────
{
  const r = ordenarMaquinas(LISTA, 'encargado');
  eq('⭐ no se pierde ninguna', r.length, LISTA.length);
  const g = agruparMaquinas(r, 'encargado');
  eq('un grupo por encargado', g.map((x) => x.label), ['ANA', 'BRUNO', 'CARLOS', SIN_ENCARGADO]);
  // Dentro de cada encargado, A→Z por código.
  eq('ANA ordenada por código', codes(g[0].items), ['RETRO 7', 'TRACTOR 5']);
  // "bruno" y "  bruno  " caen en el MISMO grupo que "BRUNO": 3 máquinas.
  eq('⭐ el mismo encargado no se parte', codes(g[1].items), ['CAMION 900', 'GRUA 2', 'VOLTEO TORONTO']);
  eq('CARLOS', codes(g[2].items), ['EXCAVADORA 12']);
  // Las que no tienen encargado, de últimas y juntas.
  eq('sin encargado va de último', codes(g[3].items), ['MINICARGADOR', 'PAYLOADER 3']);
  // Los grupos cuadran con la lista.
  eq('la suma de los grupos = la lista', g.reduce((s, x) => s + x.items.length, 0), LISTA.length);
  // Ninguna máquina en dos grupos.
  const vistos = new Set(g.flatMap((x) => x.items.map((i) => i.id)));
  eq('ninguna repetida', vistos.size, LISTA.length);
}

// ── 4) "SIN ENCARGADO" DE ÚLTIMO AUNQUE EL ALFABETO DIGA OTRA COSA ─────────
{
  // 'ZULEIMA' va después de "SIN ENCARGADO" en el alfabeto (S < Z), pero el
  // grupo de los que no tienen encargado igual tiene que quedar de último.
  const lista = [m('A1', null), m('B2', 'ZULEIMA'), m('C3', 'ANA')];
  const g = agruparMaquinas(ordenarMaquinas(lista, 'encargado'), 'encargado');
  eq('⭐ sin encargado siempre de último', g.map((x) => x.label), ['ANA', 'ZULEIMA', SIN_ENCARGADO]);
}

// ── 5) ACENTOS: no parten ni desordenan ───────────────────────────────────
{
  const lista = [m('A1', 'MARTÍNEZ'), m('B2', 'ANDRÉS'), m('C3', 'ZOILA')];
  const g = agruparMaquinas(ordenarMaquinas(lista, 'encargado'), 'encargado');
  eq('orden con acentos', g.map((x) => x.label), ['ANDRÉS', 'MARTÍNEZ', 'ZOILA']);
}

// ── 6) LA MISMA LISTA, LOS DOS ÓRDENES: siempre las mismas máquinas ────────
{
  const porMaq = ordenarMaquinas(LISTA, 'maquina');
  const porEnc = ordenarMaquinas(LISTA, 'encargado');
  eq('⭐ cambiar el orden no esconde nada',
    codes(porMaq).slice().sort(), codes(porEnc).slice().sort());
  eq('y no inventa ninguna', porEnc.length, porMaq.length);
  // No se toca la lista original (la pantalla la reusa para otras cosas).
  eq('no muta la lista de entrada', codes(LISTA)[0], 'VOLTEO TORONTO');
}

// ── 7) BASURA: no revienta ────────────────────────────────────────────────
{
  eq('lista vacía por máquina', agruparMaquinas(ordenarMaquinas([], 'maquina'), 'maquina'), []);
  eq('lista vacía por encargado', agruparMaquinas(ordenarMaquinas([], 'encargado'), 'encargado'), []);
  const rara = [{ id: 'x' }, { id: 'y', code: null, encargado: null }];
  eq('máquinas sin código no revientan', ordenarMaquinas(rara, 'maquina').length, 2);
  eq('ni agrupadas', agruparMaquinas(ordenarMaquinas(rara, 'encargado'), 'encargado')[0].label, SIN_ENCARGADO);
  eq('una sola máquina', agruparMaquinas(ordenarMaquinas([m('A', 'ANA')], 'encargado'), 'encargado').length, 1);
}

// ── Resultado ─────────────────────────────────────────────────────────────
console.log(`\n🔤  Orden de la lista del Check (por máquina · por encargado)`);
console.log(`   ${pass} OK · ${fail} fallo(s)`);
if (fail) {
  console.log(`\n${failures.join('\n')}\n`);
  process.exit(1);
}
console.log('   ✅ Todo en verde\n');
