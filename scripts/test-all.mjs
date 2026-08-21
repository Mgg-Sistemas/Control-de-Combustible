/*
 * CORRE TODAS LAS PRUEBAS. Busca solo los archivos `scripts/test-*.mjs`.
 *
 * POR QUÉ EXISTE
 * ---------------------------------------------------------------------------
 * `test:all` era UNA SOLA LÍNEA de package.json con los 24 archivos escritos a
 * mano y encadenados con `&&`. Cada vez que alguien agregaba una prueba tenía
 * que tocar ESA misma línea — y como somos dos trabajando en paralelo, esa línea
 * chocaba en CADA merge a main (21-ago-2026: tres veces en un día). Resolver el
 * conflicto a mano es además peligroso: al quedarse con "su versión" o "la mía"
 * se pierde en silencio la suite del otro y deja de correrse sin que nadie lo
 * note.
 *
 * Ahora la lista se descubre sola. Agregar una prueba es SOLO crear el archivo:
 * nadie edita `test:all`, así que ya no hay nada que chocar, y la suite del otro
 * no se puede perder.
 *
 * QUÉ CUENTA COMO PRUEBA: cualquier `scripts/test-*.mjs`. Este archivo
 * (`test-all.mjs`) se excluye a sí mismo, si no se llamaría en círculo.
 *
 * SALIDA: corre TODAS aunque alguna falle —así se ve todo lo roto de una vez, en
 * vez de arreglar una y descubrir la siguiente— y al final sale con código 1 si
 * alguna falló, para que el CI y los `&&` lo detecten igual que antes.
 *
 *   npm run test:all
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YO = path.basename(fileURLToPath(import.meta.url)); // 'test-all.mjs'

const suites = fs
  .readdirSync(HERE)
  .filter((f) => /^test-.+\.mjs$/.test(f) && f !== YO)
  .sort(); // orden alfabético: estable y reproducible entre máquinas

if (suites.length === 0) {
  console.error('\n❌ No se encontró ninguna prueba en scripts/test-*.mjs\n');
  process.exit(1);
}

console.log(`\n🧪 Corriendo ${suites.length} suite(s) de prueba…`);

const fallaron = [];
for (const f of suites) {
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { stdio: 'inherit' });
  // `status` es null si el proceso murió por una señal: eso también es fallo.
  if (r.status !== 0) fallaron.push(f);
}

console.log('\n' + '─'.repeat(60));
if (fallaron.length) {
  console.log(`❌ ${fallaron.length} de ${suites.length} suite(s) FALLARON:`);
  fallaron.forEach((f) => console.log(`   · ${f}`));
  console.log('');
  process.exit(1);
}
console.log(`✅ Las ${suites.length} suites pasaron.\n`);
