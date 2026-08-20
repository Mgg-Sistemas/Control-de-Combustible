/*
 * Test del bug «🟡 PARADA · NO TRABAJÓ borraba el turno equivocado» (19-ago-2026).
 *
 * QUÉ PASABA. El inspector de NOCHE marcaba "no trabajó" a partir de las 7pm y la app
 * le anulaba las horas del turno de DÍA a su compañero. Causa: el bloque de corrección
 * de `marcarParadaNoTrabajo` elegía el turno con `jornadaShift`, que sale de
 * `machine_rounds.jornada_shift` — columna que DESPUÉS de las 7pm todavía dice 'day'
 * (la dejó el turno que acaba de cerrar).
 *
 * Probado con datos reales de esa noche (audit_log + maintenance_requests): CHUTO 000
 * 12h→0 a las 19:40, CHUTO Laveglia 10.3h→0 a las 20:04, PAYLOADER APP26 11.99h→0 a las
 * 20:13, GRÚAS 251619 12h→0 a las 20:15. En los cuatro casos quien borró fue el
 * `inspector_night` de esa misma máquina. Entre el 10 y el 12-ago (última fecha con
 * rastro) hubo 101 casos por 1.046 h.
 *
 * QUÉ FIJA ESTE TEST.
 *   1. El turno se decide por la HORA REAL (`paradaShiftOf`: día 7am–7pm), y la
 *      corrección de una noche pasada la medianoche cae en la ronda del día en que
 *      esa noche EMPEZÓ (`businessRoundDateOf`).
 *   2. El código de `marcarParadaNoTrabajo` NO vuelve a usar `jornadaShift` para
 *      decidir qué turno anular, y RELEE la ronda de la BD en vez de fiarse de la
 *      copia en pantalla (`curRoundHours`).
 *   3. Ninguna migración de `machine_work_segments.source` vuelve a dejar fuera
 *      'no_trabajo_correction' — ese fue el segundo bug: el CHECK lo rechazaba y el
 *      `.then(() => {}, () => {})` se tragaba el error, así que la corrección borraba
 *      horas SIN dejar rastro del 13-ago en adelante.
 *
 * Sin framework (el repo no tiene): transpila los .ts en memoria con `typescript`.
 *
 *   npm run test:parada   (o: node scripts/test-parada-no-trabajo.mjs)
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

/** Transpila y carga un .ts del repo, stubbeando los require que se indiquen. */
const cargar = (rel, stubs = {}) => {
  const p = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  const orig = m.require.bind(m);
  m.require = (id) => (id in stubs ? stubs[id] : orig(id));
  m._compile(out, m.filename);
  return m.exports;
};

const { paradaShiftOf } = cargar('src/lib/inspectorDaySets.ts', {
  './machineInspectors': { inspectorSiempreActivo: () => false },
});
const { businessRoundDateOf } = cargar('src/lib/caracasDay.ts');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

/** Un instante de Caracas (UTC-4 fijo) como ISO en UTC. */
const caracas = (iso, hhmm) => `${iso}T${hhmm}:00.000-04:00`;

/**
 * Reproduce la DECISIÓN del bloque de corrección ya arreglado: con qué turno y sobre
 * qué ronda se anulan las horas cuando el inspector marca "NO TRABAJÓ". Usa las MISMAS
 * funciones que el código de producción, no una copia.
 */
const decidir = (ahoraIso) => {
  const ahora = new Date(ahoraIso);
  const turnoAhora = paradaShiftOf(ahora.toISOString());
  return {
    turno: turnoAhora,
    shiftKey: turnoAhora === 'night' ? 'night_hours' : 'day_hours',
    roundDate: businessRoundDateOf(ahora, turnoAhora),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 1) EL CASO REAL DEL 19-ago-2026 — la regresión que provocó todo esto
// ─────────────────────────────────────────────────────────────────────────────
// glender rodriguez, inspector de NOCHE, 19:40. La ronda traía jornada_shift='day'
// y day_hours=12. ANTES esto resolvía 'day_hours' y borraba las 12 h del compañero.
eq('19:40 (inspector de noche) → anula la NOCHE, no el día',
  decidir(caracas('2026-08-19', '19:40')),
  { turno: 'night', shiftKey: 'night_hours', roundDate: '2026-08-19' });

// Constancia de POR QUÉ se cambió: la lógica vieja leía el turno de la columna
// `jornada_shift` de la ronda, que a esa hora todavía decía 'day'. Mismo instante,
// resultado opuesto — esta es exactamente la diferencia que borró 1.046 h.
const viejo = (jornadaShiftGuardadoEnLaRonda) =>
  (jornadaShiftGuardadoEnLaRonda === 'night' ? 'night_hours' : 'day_hours');
eq('(bug) con el turno guardado en la ronda, a las 19:40 anulaba el DÍA', viejo('day'), 'day_hours');
eq('(arreglo) con la hora real, el mismo instante anula la NOCHE',
  decidir(caracas('2026-08-19', '19:40')).shiftKey, 'night_hours');

eq('20:04 → noche',  decidir(caracas('2026-08-19', '20:04')).shiftKey, 'night_hours');
eq('20:13 → noche',  decidir(caracas('2026-08-19', '20:13')).shiftKey, 'night_hours');
eq('20:15 → noche',  decidir(caracas('2026-08-19', '20:15')).shiftKey, 'night_hours');

// ─────────────────────────────────────────────────────────────────────────────
// 2) LOS BORDES DEL TURNO — día 7am–7pm, resto noche
// ─────────────────────────────────────────────────────────────────────────────
eq('06:59 → todavía noche',        decidir(caracas('2026-08-19', '06:59')).turno, 'night');
eq('07:00 en punto → arranca día', decidir(caracas('2026-08-19', '07:00')).turno, 'day');
eq('12:00 → día',                  decidir(caracas('2026-08-19', '12:00')).turno, 'day');
eq('18:59 → todavía día',          decidir(caracas('2026-08-19', '18:59')).turno, 'day');
eq('19:00 en punto → arranca noche', decidir(caracas('2026-08-19', '19:00')).turno, 'night');

// El inspector de DÍA que marca "no trabajó" a las 3pm SÍ debe anular el día: el
// arreglo no puede romper el caso legítimo para el que se escribió el bloque.
eq('15:00 (inspector de día) → anula el DÍA',
  decidir(caracas('2026-08-19', '15:00')),
  { turno: 'day', shiftKey: 'day_hours', roundDate: '2026-08-19' });

// ─────────────────────────────────────────────────────────────────────────────
// 3) LA NOCHE QUE CRUZA MEDIANOCHE — cae en la ronda del día en que EMPEZÓ
// ─────────────────────────────────────────────────────────────────────────────
eq('23:30 → noche del 19',
  decidir(caracas('2026-08-19', '23:30')),
  { turno: 'night', shiftKey: 'night_hours', roundDate: '2026-08-19' });

eq('00:30 del 20 → sigue siendo la noche del 19',
  decidir(caracas('2026-08-20', '00:30')),
  { turno: 'night', shiftKey: 'night_hours', roundDate: '2026-08-19' });

eq('06:30 del 20 → sigue siendo la noche del 19',
  decidir(caracas('2026-08-20', '06:30')).roundDate, '2026-08-19');

eq('07:30 del 20 → ya es el día del 20',
  decidir(caracas('2026-08-20', '07:30')),
  { turno: 'day', shiftKey: 'day_hours', roundDate: '2026-08-20' });

// ─────────────────────────────────────────────────────────────────────────────
// 4) EL CÓDIGO NO PUEDE VOLVER ATRÁS  (guardas sobre el fuente)
// ─────────────────────────────────────────────────────────────────────────────
const sup = fs.readFileSync(path.join(ROOT, 'src/screens/SupervisorScreen.tsx'), 'utf8');
// Aísla el bloque de corrección para no confundirlo con los OTROS usos legítimos de
// `jornadaShift` (bancar una jornada ABIERTA sí debe usar el turno de esa jornada).
const iCorr = sup.indexOf('const turnoAhora = paradaShiftOf(');
const bloque = iCorr >= 0 ? sup.slice(iCorr, iCorr + 2200) : '';

ok('el bloque de corrección usa paradaShiftOf (turno por hora real)', iCorr >= 0);
ok('la corrección NO vuelve a decidir el turno con jornadaShift',
  bloque.length > 0 && !/shiftKey\s*=\s*jornadaShift/.test(bloque));
ok('la corrección NO lee las horas de curRoundHours (copia de pantalla)',
  bloque.length > 0 && !/prevHoras\s*=\s*curRoundHours/.test(bloque));
ok('la corrección RELEE la ronda de la BD antes de anular',
  /getMachineRound\(ci\.id,\s*corrRoundDate\)/.test(bloque));
ok('la corrección usa la fecha de negocio del turno (cruce de medianoche)',
  /businessRoundDateOf\(ahora,\s*turnoAhora\)/.test(bloque));
ok('el tramo auditable se escribe con el turno corregido',
  /shift:\s*turnoAhora/.test(bloque));
ok('sigue existiendo un solo sitio que pone un turno en 0 desde el teléfono',
  (sup.match(/\[shiftKey\]:\s*0/g) || []).length === 1);

// ─────────────────────────────────────────────────────────────────────────────
// 5) EL RASTRO NO PUEDE VOLVER A ROMPERSE
// ─────────────────────────────────────────────────────────────────────────────
// `machine_segments_source_finish_early.sql` re-creó el CHECK de `source` SIN
// 'no_trabajo_correction' → el insert del tramo negativo se rechazaba y el
// `.then(() => {}, () => {})` se tragaba el error. Del 13-ago en adelante la
// corrección borró horas sin dejar ni una fila de rastro.
// Las migraciones VIEJAS se dejan como están (son el registro de lo que ya se corrió).
// La regla se aplica sobre el archivo CANÓNICO, que es la lista única de ahora en
// adelante: TODO `source` que la app escriba tiene que estar permitido ahí.
const canonicoPath = path.join(ROOT, 'supabase/machine_segments_source_check.sql');
ok('existe la migración canónica del CHECK de source', fs.existsSync(canonicoPath));
const canonico = fs.existsSync(canonicoPath) ? fs.readFileSync(canonicoPath, 'utf8') : '';
ok('la canónica crea el constraint',
  /add\s+constraint\s+machine_work_segments_source_check/i.test(canonico));

// Todos los `source` que la app escribe en machine_work_segments, sacados del fuente
// (incluye los ternarios y el tipo del parámetro de `registrarParadaBase`).
const fuentes = new Set();
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : (/\.tsx?$/.test(e.name) ? [p] : []);
});
for (const f of walk(path.join(ROOT, 'src'))) {
  const txt = fs.readFileSync(f, 'utf8');
  if (!txt.includes('machine_work_segments')) continue;
  for (const ln of txt.split('\n')) {
    // `source: 'x'`, el ternario `source: cond ? 'a' : 'b'`, o el tipo del parámetro
    // `(source: 'a' | 'b')` que después se escribe tal cual como source.
    const m = /\bsource\s*:\s*(.+)$/.exec(ln);
    if (!m) continue;
    // En un ternario, los valores reales son los que van DESPUÉS del `?` (lo de antes
    // es la condición, p. ej. `action === 'averia' ? …`).
    const lado = m[1].includes('?') ? m[1].slice(m[1].indexOf('?') + 1) : m[1];
    for (const lit of lado.matchAll(/'([a-z][a-z_]{4,})'/g)) fuentes.add(lit[1]);
  }
}
// Los dos que solo escriben los crons de la BD (no aparecen en el fuente de la app).
fuentes.add('auto_close');
fuentes.add('auto_full_shift');

ok('se detectaron los `source` que usa la app', fuentes.size >= 6);
for (const s of [...fuentes].sort()) {
  ok(`la canónica permite '${s}' (lo escribe la app o un cron)`, canonico.includes(`'${s}'`));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? '✅' : '❌'} test-parada-no-trabajo · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
