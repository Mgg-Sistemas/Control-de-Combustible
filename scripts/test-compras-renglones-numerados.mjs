// 🔢 Candado: los renglones de COMPRAS van numerados — 16-oct-2026.
//
// Pedido: «lo que te pedí para compra, hace falta en compra directa» (la numeración
// de los requerimientos, también al registrar una compra directa).
// Reglas vigiladas:
//  · el editor de renglones de Compras (compartido por COMPRA DIRECTA y ÓRDENES)
//    numera cada renglón con su posición (1, 2, 3…) mientras se arma;
//  · el detalle de una compra directa ya guardada numera igual (antes era «•»);
//  · el número sale de la POSICIÓN (i + 1), no de un contador guardado: al quitar
//    un renglón del medio los de abajo se recorren solos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const scr = leer('src/screens/ComprasScreen.tsx');

// ── El editor (al armar la compra) ──────────────────────────────────────────
ok('🔢 el editor recorre los renglones CON su posición', scr.includes('{items.map((l, i) => {'));
ok('🔢 …y pinta el número del renglón (pastilla, como los requerimientos)',
  /backgroundColor: colors\.brand,[^}]*\}\}>\s*<Text style=\{\{ color: colors\.brandContrast[^}]*\}\}>\{i \+ 1\}<\/Text>/s.test(scr));
ok('🗑 el botón de quitar sigue ahí (numerar no estorba el quitar)',
  scr.includes('setItems(items.filter((_, j) => j !== i))'));

// ── El detalle de la compra directa guardada ────────────────────────────────
ok('🔢 el detalle numera sus renglones (ya no es «•»)',
  scr.includes('fontSize: 12 }}>{i + 1}. {l.qty} {l.unit || \'\'} {l.description}'));
ok('🔢 …y el «•» viejo ya no queda en ese detalle',
  !scr.includes(">• {l.qty} {l.unit || ''} {l.description}"));

// ── Por posición, no un contador guardado ───────────────────────────────────
ok('⭐ numera por POSICIÓN: nada de un número guardado en el renglón',
  !/\b(numero|orden|indice)\s*:/.test(scr.split('{items.map((l, i) => {')[1]?.slice(0, 800) ?? ''));

console.log(`\n🔢 Compras numeradas: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   El renglón 3 es el 3 al armar la compra y en el detalle guardado.');
