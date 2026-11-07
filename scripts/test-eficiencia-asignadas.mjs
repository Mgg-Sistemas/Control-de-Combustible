// 📋 EFICIENCIA: QUE SE VEAN LAS ASIGNADAS (07-nov-2026). Reportado: «la eficiencia no me está
// mostrando la realidad de las máquinas asignadas» (Javier López: 28 en CHECK MÁQUINA, 🟢 17 en
// la gráfica). El 🟢 son las que TRABAJAN AHORA, no las asignadas; el total no salía en ningún lado.
//  · cada barra de la gráfica dice también las asignadas del turno (📋, las mismas que cuenta el %);
//  · una leyenda explica ⚡ / 🟢 / 📋;
//  · CHECK MÁQUINA (web y teléfono) dice cuántas de las asignadas están inactivas o «en espera»
//    (la eficiencia no las cuenta), así los dos números cuadran.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (r) => fs.readFileSync(path.join(ROOT, r), 'utf8');
let ok = 0; const fallas = [];
const check = (c, m) => { if (c) ok++; else fallas.push('  ✗ ' + m); };

const res = leer('src/screens/redesign/InspectionsSummary.tsx');
const barra = res.slice(res.indexOf('{inspShown.map((ins) => {'), res.indexOf('{inspShown.map((ins) => {') + 3000);
check(/🟢 \{ins\.iniActivas\.length\}/.test(barra), 'la barra sigue diciendo las que trabajan ahora (🟢)');
check(/📋 \{ins\.total\}/.test(barra), '⭐ la barra dice las ASIGNADAS del turno (📋), las mismas sobre las que se calcula el %');
check(/⚡ eficiencia · 🟢 trabajando ahora · 📋 asignadas en este turno/.test(res), '⭐ una leyenda explica qué es cada número');
check(/total: visibleIds\.length, eficiencia/.test(res), 'el 📋 es el universo del % (visibleIds), no una cuenta aparte');

for (const f of ['src/components/CheckMaquinaModal.tsx', 'src/screens/SupervisorScreen.tsx']) {
  const s = leer(f);
  check(/inactiva\(s\) o en espera/.test(s) && /!necesitaInspector\(m\)/.test(s), `⭐ ${f}: CHECK MÁQUINA dice cuántas asignadas están inactivas o en espera`);
}

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-eficiencia-asignadas: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-eficiencia-asignadas: ${ok} ok, 0 fallas`);
