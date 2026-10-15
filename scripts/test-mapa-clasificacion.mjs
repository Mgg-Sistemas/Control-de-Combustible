// 🏷️ Candados del filtro por CLASIFICACIÓN en el mapa — 14-oct-2026.
//
// Pedido: «en el mapa necesito la opción para poder filtrar por categoría de la
// maquinaria y que por defecto me salga activa solo la de remoción y excavación».
// Reglas vigiladas: nace con SOLO Remoción y excavación; pastillas por
// clasificación (de la ficha, la misma del Catálogo) + «Todas»; es un filtro
// visual (no toca registros); el enfoque puntual (focus) se lo salta; y convive
// con el filtro de estado activo sin aflojarlo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const scr = fs.readFileSync(path.join(ROOT, 'src/screens/MapScreen.tsx'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

ok('🏷️ nace con SOLO Remoción y excavación encendida',
  scr.includes("const CLASE_DEFECTO = 'REMOCIÓN Y EXCAVACIÓN';")
  && scr.includes('useState<Set<string>>(() => new Set([norm(CLASE_DEFECTO)]))'));
ok('🏷️ el filtro corta los pines por la clasificación de la FICHA',
  scr.includes('clasesVer.has(norm(claseDe(p.clasificacion)))'));
ok('🏷️ sin clasificación no se pierde: entra como su propia pastilla',
  scr.includes("return t || 'SIN CLASIFICACIÓN';"));
ok('✅ «Todas» enciende todas las clasificaciones presentes',
  scr.includes('setClasesVer(new Set(clasesDisp.map((c) => c.key)))'));
ok('⚠️ con todo apagado, el mapa lo dice (no parece un error)',
  scr.includes('Sin ninguna clasificación marcada el mapa queda vacío'));
ok('🎯 el enfoque de UNA máquina se salta el filtro (como siempre)',
  scr.includes('focus ? pins.filter((p) => p.id === focus.id)'));
ok('⭐ convive con el filtro de estado activo sin aflojarlo',
  /\(verNoActivas \|\| pinActivo\(p\)\) && clasesVer\.has\(/.test(scr));

console.log(`\n🏷️ Mapa por clasificación: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   Nace solo Remoción y excavación; las demás vuelven con su pastilla.');
