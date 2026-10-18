// ⛏️ Candado: el estado en la hoja de FRENTES es el VIVO del Catálogo — 18-oct-2026.
//
// Reporte real: «en reportes, frentes, me sale que todas las máquinas están
// operativas y no es así: la 79669 está en maquinaria averiada pero dice operativa».
// La causa: el estado salía SOLO de las banderas de la ficha (operational/en_espera/
// active), que la avería marcada por el inspector NO toca.
// Reglas vigiladas:
//  · la tarjeta de frentes clasifica con el clasificador COMPARTIDO del Catálogo
//    (makeLiveStatusOf + fetchAveriaCat/fetchJornadaCat/fetchInspByShift);
//  · una avería/parada vigente gana sobre «Operativa»;
//  · las banderas de la ficha conservan su prioridad (Inactiva → Retirada/
//    Transferida → En espera), igual que los cubos excluyentes;
//  · y la vieja clasificación solo-banderas no vuelve.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const card = leer('src/components/FrentesReportesCard.tsx');

ok('⭐ usa el clasificador compartido del Catálogo',
  card.includes("from '../lib/machineLiveStatus'") && card.includes('makeLiveStatusOf({ jornadaCat, averiaCat, inspByShift, retiredIds'));
ok('🔧 la avería vigente gana sobre «Operativa»',
  card.includes("st === 'averiada' ? 'Averiada'"));
ok('🟡 la parada vigente también se dice',
  card.includes("st === 'parada' ? 'Parada'"));
ok('🏷 las banderas de la ficha conservan su prioridad (Inactiva primero)',
  card.includes("if (m.active === false) return 'Inactiva';"));
ok('🔁 retirada vs transferida distinguidas, como en el Catálogo',
  card.includes("m.transferida === true ? 'Transferida a otros' : 'Retirada'"));
ok('⏳ «En espera» sigue saliendo',
  card.includes("if (m.en_espera === true) return 'En espera';"));
ok('🚫 la clasificación vieja (solo banderas → Operativa) no vuelve',
  !card.includes("m.operational === false ? 'Inoperativa' : 'Operativa'"));
ok('🧯 si las lecturas extra fallan, la hoja sale igual (catch por lectura)',
  (card.match(/fetch(AveriaCat|JornadaCat|InspByShift)\(\)\.catch\(/g) ?? []).length === 3);

console.log(`\n⛏️ Frentes con estado vivo: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   La hoja de frentes dice lo mismo que los cubos del Catálogo.');
