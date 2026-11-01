/*
 * ✏️ EDITAR UNA SOLICITUD DE COMPRA (28-oct-2026).
 * EL BUG: al quitar un renglón con «✏️ Editar» salía «Could not find the 'updated_at' column
 * of 'inventory_requirements'»: la app mandaba una columna que esa tabla NO tiene y la base
 * rechazaba el guardado entero.
 * REGLAS: el guardado de la edición no manda `updated_at`, y si la base no deja guardar (0
 * filas) lo dice en vez de fingir éxito.
 *   node scripts/test-solicitud-editar-guarda.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src/screens/SolicitudesCompraTab.tsx'), 'utf8');
const ini = src.indexOf('const payload: Record<string, any> = {');
const bloque = src.slice(ini, src.indexOf("toast.success(`Solicitud ${editTarget.code} actualizada", ini));
let ok = 0; const fallos = [];
const t = (n, c) => { if (c) ok++; else fallos.push(n); };
t('se encontró el guardado de la edición', ini > 0 && bloque.length > 0);
t('el guardado NO manda updated_at (la columna no existe)', !/updated_at\s*:/.test(bloque));
t('sigue guardando los renglones', /items: finalItems,/.test(bloque));
t('pide la fila guardada para comprobarla', /\.select\('id'\)/.test(bloque));
t('0 filas = error visible, no éxito fingido', /upd\.length === 0\) throw new Error/.test(bloque));
console.log(`\n✏️ Editar solicitud: ${ok} OK · ${fallos.length} FALLO(S)`);
fallos.forEach((f) => console.log('  ✗ ' + f));
process.exit(fallos.length ? 1 : 0);
