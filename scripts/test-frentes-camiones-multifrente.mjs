/*
 * 🧪 Prueba: camiones multi-frente en Reportes → Frentes (24-nov-2026)
 *
 * Verifica que:
 * 1) En Reportes → Frentes (`combinarMaquinariaConViajesCamiones`), la maquinaria pesada
 *    conserva su frente único de oficina (`FRENTES_MAQUINARIA`).
 * 2) Un camión que registró viajes en UNO o VARIOS frentes ese día (p. ej. RESIDENCIA
 *    PALMA REAL y OTRO FRENTE) aparece en todos los frentes donde viajó (repetido por frente),
 *    pisando cualquier asignación vieja que tuviera en otro frente.
 * 3) Los frentes de viaje se mapean al ID del catálogo local por nombre normalizado.
 *
 *   node scripts/test-frentes-camiones-multifrente.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

require.extensions['.ts'] = (m, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  m._compile(out, filename);
};

const { combinarMaquinariaConViajesCamiones } = require(path.join(ROOT, 'src/lib/frentesAuto.ts'));

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`✗ ${name}`);
  }
};

const catalogoLocal = [
  { id: 'maq-f-palma', nombre: 'RESIDENCIA PALMA REAL' },
  { id: 'maq-f-norte', nombre: 'FRENTE NORTE' },
];

const ofiVigentes = [
  { jornada: '2026-11-23', machineryId: 'exc-1', frenteId: 'maq-f-palma', frenteNombre: 'RESIDENCIA PALMA REAL' },
  // cam-1 tenía asignación vieja en FRENTE NORTE, pero el 23/11 viajó en PALMA REAL y FRENTE NORTE
  { jornada: '2026-11-23', machineryId: 'cam-1', frenteId: 'maq-f-norte', frenteNombre: 'FRENTE NORTE' },
  // cam-2 tenía asignación vieja en FRENTE NORTE, pero el 23/11 solo viajó en PALMA REAL
  { jornada: '2026-11-23', machineryId: 'cam-2', frenteId: 'maq-f-norte', frenteNombre: 'FRENTE NORTE' },
  // cam-3 no viajó ese día, conserva su asignación de oficina
  { jornada: '2026-11-23', machineryId: 'cam-3', frenteId: 'maq-f-norte', frenteNombre: 'FRENTE NORTE' },
];

const deViajes = [
  { jornada: '2026-11-23', machineryId: 'cam-1', frenteId: 'viaje-f-palma', frenteNombre: 'RESIDENCIA PALMA REAL' },
  { jornada: '2026-11-23', machineryId: 'cam-1', frenteId: 'viaje-f-norte', frenteNombre: 'FRENTE NORTE' },
  { jornada: '2026-11-23', machineryId: 'cam-2', frenteId: 'viaje-f-palma', frenteNombre: 'RESIDENCIA PALMA REAL' },
];

const esCamion = (id) => id.startsWith('cam-');
const res = combinarMaquinariaConViajesCamiones(ofiVigentes, deViajes, catalogoLocal, esCamion);

const deExc = res.filter((a) => a.machineryId === 'exc-1');
ok('excavadora conserva su frente único de oficina', deExc.length === 1 && deExc[0].frenteId === 'maq-f-palma');

const deCam1 = res.filter((a) => a.machineryId === 'cam-1');
ok('cam-1 repetido en los 2 frentes donde viajó', deCam1.length === 2);
ok('cam-1 mapea al ID del catálogo local maq-f-palma y maq-f-norte',
  deCam1.some((a) => a.frenteId === 'maq-f-palma') && deCam1.some((a) => a.frenteId === 'maq-f-norte'));

const deCam2 = res.filter((a) => a.machineryId === 'cam-2');
ok('cam-2 solo sale en RESIDENCIA PALMA REAL (pisa asignación vieja)', deCam2.length === 1 && deCam2[0].frenteId === 'maq-f-palma');

const deCam3 = res.filter((a) => a.machineryId === 'cam-3');
ok('cam-3 sin viajes conserva asignación de oficina', deCam3.length === 1 && deCam3[0].frenteId === 'maq-f-norte');

console.log(`test-frentes-camiones-multifrente: ${pass} pasaron, ${fail} fallaron.`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
