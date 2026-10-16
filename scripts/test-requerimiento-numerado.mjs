// 🔢 Candado: los renglones del requerimiento van NUMERADOS — 16-oct-2026.
//
// Pedido: «a la hora de hacer requerimientos, que me los vaya enumerando».
// Reglas vigiladas:
//  · el formulario numera cada producto (1, 2, 3…) mientras se arma;
//  · el detalle del requerimiento ya creado y el cuadro de RECIBIR numeran igual;
//  · el número sale de la POSICIÓN (i + 1), no de un contador guardado: al
//    quitar un renglón del medio los de abajo se recorren solos y nunca queda
//    un hueco ni dos con el mismo número;
//  · y es el MISMO número que la columna «#» del PDF, que ya numeraba: así
//    «el renglón 3» significa lo mismo en la pantalla, en el papel y al recibir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const scr = leer('src/screens/RequerimientoTab.tsx');

// ── El formulario (lo pedido) ───────────────────────────────────────────────
ok('🔢 el formulario recorre los renglones CON su posición',
  scr.includes('{rows.map((x, i) => {'));
ok('🔢 …y pinta el número del renglón',
  /<Text style=\{\{ color: colors\.brandContrast[^}]*\}\}>\{i \+ 1\}<\/Text>/.test(scr));
ok('🔢 el número va junto a «Del inventario / Producto NUEVO», no reemplazándolo',
  scr.includes("{x.product_id ? 'Del inventario' : 'Producto NUEVO'}"));
ok('🗑 el botón de quitar sigue ahí (numerar no estorba el quitar)',
  scr.includes('onPress={() => rm(x.key)}'));

// ── El detalle ya creado y el cuadro de recibir ─────────────────────────────
ok('🔢 el detalle del requerimiento numera sus renglones',
  scr.includes('<Text style={{ color: colors.muted }}>{i + 1}. </Text>{it.name}'));
ok('🔢 el cuadro de RECIBIR numera igual',
  scr.includes('<Text style={{ color: colors.muted }}>{idx + 1}. </Text>{it.name}'));

// ── La numeración es por posición, no un contador guardado ──────────────────
ok('⭐ numera por POSICIÓN: nada de un número guardado en el renglón',
  !/\b(numero|num|orden|indice)\s*:/.test(scr.split('{rows.map((x, i) => {')[1]?.slice(0, 1200) ?? ''));

// ── El papel ya numeraba: el número de la pantalla es el mismo ──────────────
const pdf = leer('src/lib/requerimiento.ts');
ok('📄 el PDF sigue numerando con su columna «#»',
  pdf.includes('<td class="c">${i + 1}</td>') && pdf.includes('<th style="width:26px" class="c">#</th>'));
ok('📄 …y recorre los ítems con su posición', pdf.includes('d.items.map((it, i) =>'));

console.log(`\n🔢 Requerimiento numerado: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   El renglón 3 es el 3 en el formulario, en el detalle, al recibir y en el PDF.');
