/*
 * Test de caracterización de la clasificación avería/parada/iniciada/pendiente.
 *
 * Fija (pinnea) el comportamiento ACTUAL de la ÚNICA función pura compartida
 * `buildDaySets`/`classifyInspectorMachines` (src/lib/inspectorDaySets.ts), que es
 * la fuente de verdad de la clasificación en el panel de Inspecciones, el PDF por
 * inspector y el Dashboard. Cubre justo los casos que causaron quejas reales del
 * cliente (reactivación de jornada, hoy-vs-arrastrada, "SIEMPRE ACTIVO", prioridad
 * avería>parada, turno noche cruzando medianoche y la reactivación CRUZADA de turno
 * — caso LUMINARIA/PAYLOADER, cuyo parche vive en Dashboard, NO acá).
 *
 * Por qué existe: la auditoría (11-ago-2026) marcó que esta lógica estaba
 * reimplementada en varias pantallas y se desincronizaba en silencio. Antes de
 * unificar más código hay que BLOQUEAR el comportamiento vigente para poder
 * verificar que cualquier refactor futuro no lo cambia.
 *
 * No usa framework de test (el repo no tiene): transpila el .ts en memoria con el
 * `typescript` ya instalado y stubbea la única dependencia (`inspectorSiempreActivo`).
 *
 *   npm run test:clasificacion   (o: node scripts/test-clasificacion.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const srcPath = path.join(ROOT, 'src/lib/inspectorDaySets.ts');
const src = fs.readFileSync(srcPath, 'utf8');
const out = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;

// Cargar el módulo transpilado interceptando ./machineInspectors (que arrastra el
// cliente de Supabase). buildDaySets solo usa inspectorSiempreActivo — se stubbea 1:1.
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
const origRequire = m.require.bind(m);
m.require = (id) =>
  id === './machineInspectors'
    ? { inspectorSiempreActivo: (n) => (n || '').trim().toLowerCase() === 'inspector sos la guaira' }
    : origRequire(id);
m._compile(out, m.filename);
const { buildDaySets, classifyInspectorMachines, paradaShiftOf } = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const arr = (s) => Array.from(s).sort();

const DAY = '2026-08-11';
const iso = (h, min = 0, plusDay = 0) => {
  const d = new Date(`${DAY}T00:00:00-04:00`);
  d.setUTCDate(d.getUTCDate() + plusDay);
  d.setUTCHours(d.getUTCHours() + h, d.getUTCMinutes() + min);
  return d.toISOString();
};
const NOINACT = new Set();
const round = (id, o = {}) => ({
  machinery_id: id, round_date: DAY,
  day_hours: o.day_hours ?? null, night_hours: o.night_hours ?? null,
  jornada_shift: o.jornada_shift ?? null, jornada_start_at: o.jornada_start_at ?? null,
});
const maint = (id, hhmm, material = null, plusDay = 0) => ({
  machinery_id: id, material, created_at: iso(hhmm[0], hhmm[1] || 0, plusDay),
});
const assign = (id, name, shift) => ({ machinery_id: id, inspector_name: name, shift });
const run = (p) => buildDaySets({
  rounds: p.rounds ?? [], maint: p.maint ?? [], assignments: p.assignments ?? [],
  selDay: DAY, shiftArg: p.shift, machInactiveSet: NOINACT, machHardInactiveSet: NOINACT,
});

// 1) paradaShiftOf: día 7am–7pm, resto noche
eq('paradaShiftOf 08:00 = day', paradaShiftOf(iso(8)), 'day');
eq('paradaShiftOf 18:59 = day', paradaShiftOf(iso(18, 59)), 'day');
eq('paradaShiftOf 19:00 = night', paradaShiftOf(iso(19)), 'night');
eq('paradaShiftOf 02:00 = night', paradaShiftOf(iso(2)), 'night');

// 2) Avería HOY de mi turno gana
{
  const ds = run({ shift: 'day', assignments: [assign('A', 'juan', 'day')], maint: [maint('A', [9, 0])] });
  eq('averia HOY dia', arr(ds.averSet), ['A']);
  eq('averia HOY dia sin started', arr(ds.startedSet), []);
}
// 3) Parada HOY de mi turno
{
  const ds = run({ shift: 'day', assignments: [assign('B', 'juan', 'day')], maint: [maint('B', [9, 0], 'MÁQUINA PARADA')] });
  eq('parada HOY dia', arr(ds.paradaSet), ['B']);
  eq('parada HOY dia sin aver', arr(ds.averSet), []);
}
// 4) Prioridad avería > parada
{
  const ds = run({ shift: 'day', assignments: [assign('C', 'juan', 'day')],
    maint: [maint('C', [9, 0], 'MÁQUINA PARADA'), maint('C', [10, 0])] });
  eq('averia+parada gana averia', arr(ds.averSet), ['C']);
  eq('averia+parada sin parada', arr(ds.paradaSet), []);
}
// 5) Reactivación mismo turno (jornada abrió DESPUÉS de la avería)
{
  const ds = run({ shift: 'day', assignments: [assign('D', 'juan', 'day')],
    maint: [maint('D', [8, 0])], rounds: [round('D', { jornada_shift: 'day', jornada_start_at: iso(9, 0) })] });
  eq('reactivada mismo turno sin averiada', arr(ds.averSet), []);
  eq('reactivada mismo turno iniciada', arr(ds.startedSet), ['D']);
  eq('reactivada mismo turno activeNow', arr(ds.activeNowSet), ['D']);
}
// 6) Avería POSTERIOR a la jornada abierta → sigue averiada
{
  const ds = run({ shift: 'day', assignments: [assign('E', 'juan', 'day')],
    maint: [maint('E', [11, 0])], rounds: [round('E', { jornada_shift: 'day', jornada_start_at: iso(8, 0) })] });
  eq('averia posterior a jornada averiada', arr(ds.averSet), ['E']);
}
// 7) Reactivación CRUZADA de turno NO aplica acá (por-turno aislado, a propósito).
//    Caso LUMINARIA/PAYLOADER: el parche cruzado vive en Dashboard, no en buildDaySets.
{
  const ds = run({ shift: 'day', assignments: [assign('L', 'juan', 'day')],
    maint: [maint('L', [10, 0])], rounds: [round('L', { jornada_shift: 'night', jornada_start_at: iso(20, 0) })] });
  eq('cross-shift: dia sigue averiada (aislado)', arr(ds.averSet), ['L']);
}
// 8) SIEMPRE ACTIVO: nunca avería/parada
{
  const ds = run({ shift: 'day', assignments: [assign('S', 'inspector sos la guaira', 'day')],
    maint: [maint('S', [9, 0]), maint('S', [9, 30], 'MÁQUINA PARADA')] });
  eq('siempreActivo sin averiada', arr(ds.averSet), []);
  eq('siempreActivo sin parada', arr(ds.paradaSet), []);
  eq('siempreActivo iniciada sin jornada', arr(ds.startedSet), ['S']);
}
// 9) Arrastrada + trabajó hoy → no cuenta (cerrada)
{
  const ds = run({ shift: 'day', assignments: [assign('F', 'juan', 'day')],
    maint: [maint('F', [9, 0], null, -1)], rounds: [round('F', { day_hours: 6 })] });
  eq('arrastrada+trabajo sin averiada', arr(ds.averSet), []);
  eq('arrastrada+trabajo cerrada', arr(ds.closedSet), ['F']);
}
// 10) Arrastrada + NO trabajó → sigue averiada
{
  const ds = run({ shift: 'day', assignments: [assign('G', 'juan', 'day')], maint: [maint('G', [9, 0], null, -1)] });
  eq('arrastrada sin trabajo averiada', arr(ds.averSet), ['G']);
}
// 11-13) cerrada por horas / abierta activeNow / pendiente
{
  const ds = run({ shift: 'day',
    assignments: [assign('H', 'juan', 'day'), assign('I', 'juan', 'day'), assign('J', 'juan', 'day')],
    rounds: [round('H', { day_hours: 8 }), round('I', { jornada_shift: 'day', jornada_start_at: iso(7, 0) })] });
  eq('cerrada por horas', arr(ds.closedSet), ['H']);
  eq('abierta activeNow', arr(ds.activeNowSet), ['I']);
  eq('asignada sin nada pendiente', arr(ds.pendSet), ['J']);
}
// 14) classifyInspectorMachines: eficiencia = % de las que ya actuó
{
  const ds = run({ shift: 'day',
    assignments: [assign('K1', 'ana', 'day'), assign('K2', 'ana', 'day'), assign('K3', 'ana', 'day'), assign('K4', 'ana', 'day')],
    rounds: [round('K1', { day_hours: 8 }), round('K2', { jornada_shift: 'day', jornada_start_at: iso(7) })],
    maint: [maint('K3', [9, 0])] });
  const c = classifyInspectorMachines({ machineryIds: ['K1', 'K2', 'K3', 'K4'], daySets: ds,
    machInactiveSet: NOINACT, machHardInactiveSet: NOINACT, isVirtual: false });
  eq('clasif ini', c.ini.sort(), ['K1', 'K2']);
  eq('clasif ave', c.ave.sort(), ['K3']);
  eq('clasif pend', c.pend.sort(), ['K4']);
  eq('eficiencia 75%', c.eficiencia, 75);
  const cv = classifyInspectorMachines({ machineryIds: ['K1'], daySets: ds,
    machInactiveSet: NOINACT, machHardInactiveSet: NOINACT, isVirtual: true });
  eq('virtual sin eficiencia', cv.eficiencia, null);
}
// 15) Turno noche cruzando medianoche: avería 2am cuenta en la noche de ESTE día
{
  const ds = run({ shift: 'night', assignments: [assign('N', 'juan', 'night')], maint: [maint('N', [2, 0], null, 1)] });
  eq('noche cruza medianoche averiada', arr(ds.averSet), ['N']);
}

console.log(`\n${'='.repeat(60)}`);
if (fail === 0) console.log(`✓ CLASIFICACIÓN OK — ${pass} aserciones`);
else { console.log(`✗ ${fail} FALLARON de ${pass + fail}\n`); console.log(failures.join('\n\n')); }
console.log('='.repeat(60));
process.exit(fail === 0 ? 0 : 1);
