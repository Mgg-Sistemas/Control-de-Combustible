/*
 * 📸 FOTOS DE PRODUCTOS EN INVENTARIO (28-oct-2026).
 *
 * EL BUG: «le subí una imagen a una máscara y en vez de verse en la máscara se ve en el cloro y
 * en otros productos». La foto GENERAL de un requerimiento de 16 renglones se le ponía a los 16.
 *
 * LAS REGLAS:
 *  1. La foto general de un requerimiento solo vale si tiene UN renglón.
 *  2. De las compras directas solo cuenta la foto de cada renglón (la columna general no existe
 *     y pedirla hacía fallar la consulta entera).
 *  3. La foto PROPIA del producto se lee de inventory_items por ID (la vista no la trae) y manda.
 *  4. Guardar/quitar la foto avisa si la base la rechaza y se recuerda por ID, nunca por nombre.
 *  5. Al editar, una foto «deducida» no se guarda como propia del producto.
 *
 *   node scripts/test-inventario-fotos.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src/screens/InventarioScreen.tsx'), 'utf8');
let ok = 0; const fallos = [];
const t = (nombre, cond) => { if (cond) ok++; else fallos.push(nombre); };

t('1. la foto general del requerimiento solo con UN renglón', /const unico = \(row\.items \|\| \[\]\)\.length === 1;/.test(src) && /unico && row\.attachment_url/.test(src));
t('2. compras directas: no pide la columna general inexistente', !/foto_producto_url/.test(src));
t('2b. compras directas: solo la foto de cada renglón', /const f = it\.image_url;/.test(src));
t('3. foto propia leída por ID desde inventory_items', /\.from\('inventory_items'\)\s*\.select\('id, image_url'\)/.test(src));
t('3b. la foto propia manda sobre la deducida', /if \(fotosPropias\[it\.id\]\) return fotosPropias\[it\.id\];/.test(src));
t('4. guardar foto avisa si la base la rechaza', (src.match(/No se pudo guardar la foto: /g) || []).length === 2);
t('4b. quitar foto avisa si la base la rechaza', /No se pudo quitar la foto: /.test(src));
t('4c. nada se recuerda por nombre al subir una foto', !/setInferredPhotos\(\(prev\) => \(\{ \.\.\.prev, \[norm\(it\.name\)\]/.test(src));
t('5. al editar solo se carga la foto propia', /setItemPhoto\(fotosPropias\[it\.id\] \|\| it\.image_url \|\| null\);/.test(src));

console.log(`\n📸 Fotos de Inventario: ${ok} OK · ${fallos.length} FALLO(S)`);
fallos.forEach((f) => console.log('  ✗ ' + f));
process.exit(fallos.length ? 1 : 0);
