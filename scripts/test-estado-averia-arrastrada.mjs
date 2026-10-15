// ⭐ Candados del ESTADO EN VIVO del Catálogo — 14-oct-2026.
//
// Pedido: «me sale una sola averiada, y necesito que en realidad me refleje lo
// que marcaron los inspectores desde su vista en el teléfono». Causa: la regla
// `mismoTurno` (11-ago) tapaba TODO — una avería PENDIENTE del turno día se veía
// «Operativa» cada noche aunque la máquina no hubiera vuelto a trabajar (caso
// real: avería del 08/10 8:38am, sin una ronda después, Operativa a las 8pm).
// Regla nueva: sin trabajo posterior la avería RIGE SIEMPRE; la foto por turno
// queda solo para «trabajó hoy y después cayó».
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const lib = leer('src/lib/machineLiveStatus.ts');

ok('⭐ la avería arrastrada SIN trabajo rige a cualquier hora (mismoTurno ya no tapa esa rama)',
  lib.includes('const averiaVigente = !siempreActivo && !!a && !reactivada && ((esHoy && mismoTurno) || (!hasOpen && total <= 0));'));
ok('⭐ la regla vieja (mismoTurno tapándolo todo) NO volvió',
  !lib.includes('!!a && mismoTurno && !reactivada && (esHoy ||'));
ok('🔁 la reactivación sigue limpiando la avería (jornada nueva después de marcarla)',
  lib.includes('const reactivada = !!a && hasOpen && openStart >= a.createdMs;'));
ok('🕗 la foto por turno del 11-ago queda SOLO para averías de HOY', lib.includes('(esHoy && mismoTurno)'));
ok('🟣 SIEMPRE ACTIVO sigue exento', lib.includes('!siempreActivo &&'));

// Una sola fuente: Catálogo, Inicio y Viajes leen el MISMO clasificador — la
// corrección llega a todos a la vez (nada de volver a copias desincronizadas).
for (const f of ['src/screens/EquiposScreen.tsx', 'src/screens/DashboardScreen.tsx']) {
  ok(`🔗 ${f.split('/').pop()} usa makeLiveStatusOf (fuente única)`, leer(f).includes('makeLiveStatusOf({'));
}
ok('🔗 los 4 cubos del Catálogo salen de bucketMachineStatus (compartido)',
  leer('src/screens/EquiposScreen.tsx').includes('bucketMachineStatus(machinery.data, liveStatusOf)'));

console.log(`\n⭐ Avería arrastrada: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   Lo que marcó el inspector rige hasta resolverse o volver a trabajar.');
