/*
 * Test del BUSCADOR DEL CATÁLOGO (15-sep-2026).
 *
 * Pedido del cliente: en el catálogo de maquinaria poder buscar también por
 * encargado, inspector, marca o modelo.
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · marca, modelo e inspectores (día, noche y último check-in) entran en la búsqueda
 *   · el buscador del catálogo y el del detalle por estado buscan en LO MISMO
 *     (si no, una máquina se encuentra en uno y no en el otro)
 *   · el encargado se sigue buscando
 *   · el texto de ayuda dice lo que de verdad busca
 *
 *   node scripts/test-catalogo-buscador.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}`); } };

const scr = sinComentarios(leer('src/screens/EquiposScreen.tsx'));

const extras = scr.match(/const extrasBusqueda = \(m: Machinery\) => \[([\s\S]*?)\];/);
ok('hay una sola lista de datos extra para buscar', !!extras);
const lista = extras ? extras[1] : '';
ok('busca por marca', /\(m as any\)\.marca/.test(lista));
ok('busca por modelo', /\(m as any\)\.modelo/.test(lista));
ok('busca por el inspector de día', /inspByShift\[m\.id\]\?\.day/.test(lista));
ok('busca por el inspector de noche', /inspByShift\[m\.id\]\?\.night/.test(lista));
ok('busca por el inspector del último check-in', /inspectors\[m\.id\]\?\.name/.test(lista));

const catalogo = scr.match(/const machineryList = machinery\.data\.filter\([\s\S]*?\n  \);/);
ok('⭐ el buscador del catálogo usa los extras', !!catalogo && /\.\.\.extrasBusqueda\(m\)/.test(catalogo[0]));
ok('...y sigue buscando por encargado', !!catalogo && /m\.encargado/.test(catalogo[0]));

const detalle = scr.match(/const detailFiltered = detailNq[\s\S]*?: detailList;/);
ok('⭐ el buscador del detalle por estado usa los mismos extras', !!detalle && /\.\.\.extrasBusqueda\(m\)/.test(detalle[0]));
ok('...y sigue buscando por encargado', !!detalle && /m\.encargado/.test(detalle[0]));

ok('los extras se definen antes de usarse', scr.indexOf('const extrasBusqueda') >= 0 && scr.indexOf('const extrasBusqueda') < scr.indexOf('const machineryList'));
ok('el texto de ayuda dice lo que busca', /placeholder="🔎 Buscar por código, placa, serial, empresa, encargado, inspector, marca o modelo…"/.test(scr));

const md = leer('docs/MANUAL-USUARIO.md');
const ms = leer('src/screens/ManualScreen.tsx');
ok('el manual .md lo explica', /Buscador del catálogo \(15\/09\/2026\)/.test(md));
ok('el manual en pantalla también', /BUSCADOR DEL CATÁLOGO \(15\/09\/2026\)/.test(ms));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-catalogo-buscador · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
