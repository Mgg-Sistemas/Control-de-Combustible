// 🏷️ Candados del DESGLOSE POR CATEGORÍA del Catálogo — 14-oct-2026.
//
// Pedido: «abajo de esas opciones una tarjeta por categoría con todas las
// máquinas por estado… y al final una tarjeta con un total de todas las
// categorías». Reglas vigiladas: usa los MISMOS buckets excluyentes de los
// cubos (nada de recontar aparte, que es como se desincronizan los números),
// la ficha sin clasificación no se pierde, y la tarjeta Σ suma todas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const scr = fs.readFileSync(path.join(ROOT, 'src/screens/EquiposScreen.tsx'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

ok('🏷️ suma sobre los MISMOS buckets de los cubos (los 5, sin recontar)',
  scr.includes("suma(activeMachines, 'operativa')") && scr.includes("suma(averiadaMachines, 'averiada')")
  && scr.includes("suma(esperaMachines, 'espera')") && scr.includes("suma(retiradaMachines, 'retirada')")
  && scr.includes("suma(transferidaMachines, 'transferida')"));
ok('🏷️ sin clasificación no se pierde: entra como SU tarjeta',
  /claseDe = \(m: Machinery\) => \(m\.clasificacion && String\(m\.clasificacion\)\.trim\(\)\.toUpperCase\(\)\) \|\| 'SIN CLASIFICACIÓN'/.test(scr));
ok('Σ la tarjeta final suma TODAS las categorías',
  scr.includes('Σ TODAS LAS CATEGORÍAS') && scr.includes('total.transferida += c.transferida'));
ok('🏷️ las categorías salen ordenadas (cmpText)', scr.includes('porCat.entries()).sort((a, b) => cmpText(a[0], b[0]))'));
ok('🏷️ cada tarjeta trae los 5 estados con su color', scr.includes("{ k: 'transferida', label: 'Transferidas', color: '#0D9488' }"));

console.log(`\n🏷️ Catálogo por categoría: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   Una tarjeta por clasificación, cuadrada con los cubos, y la Σ final.');
