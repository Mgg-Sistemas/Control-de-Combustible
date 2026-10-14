// 🔀 Candados de MOVER LISTEROS DE OBRA — 13-oct-2026.
//
// Pedido: «los que tienen permiso de escritura y full control para el módulo de
// viajes de camiones no pueden cambiar a los listeros de obras». Causa doble:
// (1) la RLS de `profiles` solo deja tocar la fila PROPIA (o admin): el update
//     de un supervisor filtraba 0 filas SIN error y el listero rebotaba;
// (2) la tarjeta entera estaba detrás de canFull: los de escritura ni la veían.
// Arreglo: función de la base (security definer, valida escritura/full de
// viajes_camiones, toca SOLO ubicacion_id) + la tarjeta abre para escritura.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const lib = leer('src/lib/camionViajes.ts');
// El camino nuevo: la función de la base.
ok('🔐 mover va por la función de la base (rpc asignar_obra_a_listero)',
  lib.includes("supabase.rpc('asignar_obra_a_listero', { p_listero_id: listeroId, p_ubicacion_id: ubicacionId })"));
// El respaldo es honesto: nada de fingir éxito con 0 filas.
ok('⭐ el respaldo pide las filas tocadas (.select) y las cuenta',
  lib.includes(".update({ ubicacion_id: ubicacionId }).eq('id', listeroId).select('id')"));
ok('⭐ 0 filas = error claro, no éxito fingido',
  lib.includes('if (!data?.length) return { error:') && lib.includes('La base no dejó mover al listero'));
// El aviso de «falta el SQL de obras» sigue vivo.
ok('🧯 «falta correr el SQL» se sigue distinguiendo', lib.includes('esColumnaQueFalta(error)) return { error: error.message, falta: true }'));

const comp = leer('src/components/ObrasListeros.tsx');
ok('🔀 la tarjeta sale con escritura (canMover) o con full', comp.includes('if (!canFull && !canMover) return null;'));
ok('🔒 el catálogo de obras (crear/editar/zona/eliminar) sigue siendo solo de full',
  /\{canFull \? \(<>\s*\n\s*\{\/\* ── CREAR/.test(comp));
ok('🔀 canMover está declarado en las Props', comp.includes('canMover: boolean;'));

const scr = leer('src/screens/ViajesCamionesScreen.tsx');
ok('🔀 la lista de listeros se carga con escritura (antes solo full)', scr.includes('if (!canWrite || soyListero) return;'));
ok('📵 al teléfono del listero NO se le carga la lista (soyListero)',
  scr.includes('const soyListero = esRolListero(appRole?.modules);') && scr.includes('canMover={canWrite && !soyListero}'));
ok('📵 …con la regla compartida del rol (rolListero.ts), no otra copia',
  scr.includes("import { esRolListero } from '../lib/rolListero';"));

console.log(`\n🔀 Listeros de obra: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   Escritura y full mueven; la base valida; 0 filas ya no finge éxito.');
