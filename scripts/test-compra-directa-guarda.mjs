/*
 * 🛒 COMPRA DIRECTA: SE GUARDA CON O SIN FOTO (28-oct-2026).
 * EL BUG: «no se puede subir una compra directa si no se sube una imagen». En realidad NINGUNA
 * se guardaba desde el 27-oct: el guardado mandaba foto_producto_url / foto_producto_name,
 * columnas que direct_purchases NO tiene, y la base rechazaba todo.
 * LAS REGLAS: 1) el guardado no manda esas columnas (la foto general viaja en la nota);
 * 2) la foto es opcional (nada la exige); 3) cada renglón guarda la suya y solo con UN renglón
 * la foto general y la del renglón se igualan.
 *   node scripts/test-compra-directa-guarda.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src/screens/ComprasScreen.tsx'), 'utf8');
const ini = src.indexOf('const crear = async () => {');
const crear = src.slice(ini, src.indexOf("from('direct_purchases').insert", ini) + 80)
  .replace(/\/\/.*$/gm, ''); // sin comentarios: solo cuenta el código
let ok = 0; const fallos = [];
const t = (n, c) => { if (c) ok++; else fallos.push(n); };
t('se encontró el guardado', ini > 0);
t('1. no manda foto_producto_url (no existe en la base)', !/foto_producto_url\s*:/.test(crear));
t('1b. no manda foto_producto_name', !/foto_producto_name\s*:/.test(crear));
t('1c. la foto general viaja en la nota', /empaquetarNotaConFotoProducto\(/.test(crear));
t('2. ninguna validación exige foto', !/return toast\.error\([^)]*(foto|imagen)/i.test(crear));
t('3. solo con UN renglón se igualan foto general y del renglón', /const unRenglon = clean\.length === 1;/.test(crear) && /if \(unRenglon && fotoDefinitiva\?\.url && !clean\[0\]\?\.image_url\)/.test(crear));
t('3b. la foto de un renglón no se vuelve general si hay varios', (src.match(/if \(!fotoProducto && items\.length === 1\)/g) || []).length === 2);
console.log(`\n🛒 Compra directa: ${ok} OK · ${fallos.length} FALLO(S)`);
fallos.forEach((f) => console.log('  ✗ ' + f));
process.exit(fallos.length ? 1 : 0);
