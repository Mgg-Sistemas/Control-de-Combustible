// 🗺️ Pruebas del MAPA: solo las máquinas ACTIVAS (10-oct-2026, a pedido:
// «en el mapa deben verse solo las que están activas; aunque se actualice la
// ubicación se guarda el registro, pero en el mapa solo se ven las activas»).
//
// La regla: el filtro es SOLO VISUAL. Las coordenadas y el historial de
// ubicaciones se siguen guardando igual; una dada de baja vuelve al mapa con el
// interruptor de las capas («ocultar no es eliminar»).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const scr = leer('src/screens/MapScreen.tsx');
ok('⭐ la consulta de pines ahora trae la columna active', /location_at, active, operational, en_espera/.test(scr));
ok('⭐ el pin sabe si la máquina está dada de baja', /inactiva: m\.active === false,/.test(scr));
ok('⭐⭐ el filtro: dadas de baja fuera, salvo que el interruptor las traiga', /pins \?\? \[\]\)\.filter\(\(p\) => verBajas \|\| !p\.inactiva\)/.test(scr));
ok('⭐ el interruptor NACE APAGADO (solo activas por defecto)', /const \[verBajas, setVerBajas\] = useState\(false\);/.test(scr));
ok('el mapa pinta sobre la base filtrada (no sobre todos los pines)', /pinsBase\.filter\(isMachineShown\)/.test(scr));
ok('las capas agrupan sobre la base filtrada', /pinsBase\.forEach\(\(p\) => m\.set\(p\.id, catOf\(p\)\)\)/.test(scr));
ok('el interruptor existe en las capas y dice cuántas hay', scr.includes('Mostrar también las DADAS DE BAJA'));
ok('⭐ enfocar una máquina puntual la muestra aunque esté de baja (búsqueda a propósito)',
  /focus \? pins\.filter\(\(p\) => p\.id === focus\.id\)/.test(scr));
ok('⭐ el filtro es VISUAL, no de la consulta: la base sigue trayendo y guardando todo',
  !/\.eq\('active'/.test(scr) && /\.not\('latitude', 'is', null\)/.test(scr));

const mapa = leer('src/components/VenezuelaMap.tsx');
ok('el tipo del pin declara inactiva', /inactiva\?: boolean;/.test(mapa));
ok('el popup dice «Dada de baja» en vez de pintarla Operativa', mapa.includes("p.inactiva?'⬛ Dada de baja (inactiva)'"));
ok('el punto de «cercanas» sale gris para una de baja', mapa.includes("x.p.inactiva ? '#4B5563'"));
ok('el panel de detalle también la rotula de baja', mapa.includes("p.inactiva ? '⬛ Dada de baja'"));

console.log(`\n🗺️ Mapa solo activas: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   Se guarda todo, se pinta solo lo activo.');
