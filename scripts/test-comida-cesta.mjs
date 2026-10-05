/*
 * Test de la CESTA DE COMIDAS (`src/lib/comidaCesta.ts`) — 05-oct-2026.
 *
 * QUÉ PEDIDO CUBRE, textual
 *   «solo se puede registrar una comida a la vez […] yo le registro el desayuno
 *   al GNB y no puedo registrar más nada ahí, tengo que volver a hacer un
 *   registro diferente; la idea es poder registrar varios o los que yo quiera».
 *
 * LO QUE BLINDA — y por qué cada cosa
 *   · ⭐ O PASA TODA O NO SE GUARDA NADA: validar mientras se guarda dejaría
 *     media cesta registrada y media no, y nadie sabría cuál.
 *   · ⭐ SI ALGO FALLA A MITAD, EL AVISO DICE QUÉ QUEDÓ GUARDADO: esconderlo
 *     haría repetir la cesta entera y duplicar lo que sí entró.
 *   · Una casilla VACÍA no es un error: es «esta comida no va».
 *   · Cada línea sigue siendo UNA entrega en la base: los reportes, el cobro y
 *     las facturas no cambian ni un número.
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

const srcPath = path.join(ROOT, 'src/lib/comidaCesta.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const C = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); } };
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const L = (mealType, cantidad, itemLabel = null) => ({ mealType, cantidad, itemLabel });
const label = (l) => (l.mealType === 'otros' ? (l.itemLabel || 'Otros') : l.mealType[0].toUpperCase() + l.mealType.slice(1));

// ── 1) QUÉ VA Y QUÉ NO ──────────────────────────────────────────────────────
eq('⭐ una casilla vacía NO es error: es «esta comida no va»',
  C.lineasConCantidad([L('desayuno', '15'), L('almuerzo', ''), L('lunch', '   '), L('cena', '10')]).map((l) => l.mealType),
  ['desayuno', 'cena']);
eq('cantidadDeLinea lee enteros y rechaza lo demás',
  [L('x', '15'), L('x', ' 8 '), L('x', ''), L('x', '2,5'), L('x', '0'), L('x', '-3'), L('x', 'abc'), null].map(C.cantidadDeLinea),
  [15, 8, null, null, null, null, null, null]);
eq('totalCesta suma solo lo que va', C.totalCesta([L('desayuno', '15'), L('almuerzo', ''), L('otros', '8', 'HIELO')]), 23);
eq('resumenCesta canta la cesta', C.resumenCesta([L('desayuno', '15'), L('otros', '8', 'HIELO')], label), '15 Desayuno · 8 HIELO');
eq('nada no revienta', [C.lineasConCantidad(null).length, C.totalCesta(null), C.resumenCesta(null, label)], [0, 0, '']);

// ── 2) ⭐ O PASA TODA O NO SE GUARDA NADA ───────────────────────────────────
eq('una cesta buena pasa', C.validarCesta([L('desayuno', '15'), L('otros', '8', 'HIELO')], label), null);
ok('cesta vacía (o toda en blanco) no pasa', /al menos una comida/.test(C.validarCesta([L('desayuno', ''), L('cena', '')], label)));
ok('⭐ UNA cantidad ilegible tumba la cesta ENTERA, con el nombre de la comida',
  /Almuerzo.*entero desde 1/.test(C.validarCesta([L('desayuno', '15'), L('almuerzo', '2,5')], label)));
ok('cero y negativo tampoco pasan', !!C.validarCesta([L('desayuno', '0')], label) && !!C.validarCesta([L('desayuno', '-2')], label));
ok('⭐ el tope por línea es el MÁS ESTRICTO del sistema (200, el de los contactos)',
  C.MAX_POR_LINEA_CESTA === 200 && /máximo 200/.test(C.validarCesta([L('desayuno', '201')], label)) && C.validarCesta([L('desayuno', '200')], label) === null);
ok('⭐ un «Otros» sin plato no pasa (sin nombre no se puede cobrar)',
  /elige qué fue/.test(C.validarCesta([L('otros', '5')], label)) && C.validarCesta([L('otros', '5', 'HIELO')], label) === null);

// ── 3) ⭐ EL SALDO CUANDO ALGO FALLA A MITAD ────────────────────────────────
eq('todo bien: un solo aviso con la cesta', C.avisoCesta({ ok: ['15 Desayuno', '8 HIELO'], fallos: [] }), '✅ Registrado: 15 Desayuno · 8 HIELO.');
ok('⭐ con un fallo a mitad, dice QUÉ entró y QUÉ no, y que se reintente SOLO lo fallado',
  (() => { const s = C.avisoCesta({ ok: ['15 Desayuno'], fallos: [{ nombre: '8 HIELO', error: 'sin permiso' }] });
    return /Se registró: 15 Desayuno/.test(s) && /FALLÓ 8 HIELO \(sin permiso\)/.test(s) && /SOLO lo que falló/.test(s); })());
ok('si no entró ninguna, lo dice sin rodeos', /No se registró ninguna/.test(C.avisoCesta({ ok: [], fallos: [{ nombre: '15 Desayuno', error: 'x' }] })));

// ── 4) CANDADOS de las pantallas ────────────────────────────────────────────
{
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const lib = sinComentarios(leer('src/lib/comidaCesta.ts'));
  ok('⭐ la librería es PURA (sin imports): cada línea sigue siendo una entrega normal', !/^\s*import\s/m.test(lib));
  for (const f of ['src/screens/FoodCompanyScreen.tsx', 'src/components/ComidaEditor.tsx']) {
    if (!fs.existsSync(path.join(ROOT, f))) { ok(`existe ${f}`, false); continue; }
    const c = sinComentarios(leer(f));
    ok(`⭐ ${f} valida la cesta ENTERA antes de guardar nada`, /validarCesta\(/.test(c));
    ok(`${f} cuenta el saldo con avisoCesta (qué entró y qué falló)`, /avisoCesta\(/.test(c));
  }
  const fc = sinComentarios(leer('src/screens/FoodCompanyScreen.tsx'));
  ok('⭐ el registro de UNA comida de siempre SIGUE igual (la cesta es un botón aparte)', /const registrar = async \(\)/.test(fc) && /saveCompanyMeal\(\{/.test(fc));
  const ed = sinComentarios(leer('src/components/ComidaEditor.tsx'));
  ok('⭐ el editor sigue validando cada alta con la regla de siempre', /validarAltaEmpresa\(/.test(ed) && /agregarEntregaEmpresa\(/.test(ed));
}

console.log('\nCESTA DE COMIDAS — varias comidas de una vez, cada línea sigue siendo una entrega\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-comida-cesta · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
