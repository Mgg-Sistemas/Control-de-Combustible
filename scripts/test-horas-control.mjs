/*
 * Test de `horasTurnoDelDia` — la fórmula ÚNICA de horas de un día por máquina.
 *
 * Por qué existe (16-ago-2026): el módulo de CONTROL y el REPORTE POR EMPRESA daban
 * horas distintas para la misma máquina y el mismo día. Causa: el reporte por empresa
 * aplicaba umbral mínimo + cálculo EN VIVO anclado al inicio nominal del turno, y
 * Control leía `day_hours`/`night_hours` crudos — sus consultas ni siquiera traían
 * `jornada_start_at`. Durante el turno, Control mostraba 0 h donde el reporte ya daba
 * horas. Ahora los dos llaman a esta función.
 *
 * Estos casos fijan las reglas del REPORTE POR EMPRESA (que es el documento que el
 * cliente toma como bueno). Si alguien las cambia, este test falla.
 *
 *   npm run test:horas   (o: node scripts/test-horas-control.mjs)
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

// Loader recursivo (mismo patrón que test-inicio-jornada.mjs): hours.ts importa
// caracasDay.ts (businessRoundDateOf, para el tope físico de horasVivasTurno).
const cache = new Map();
function loadTs(abs) {
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}
const { horasTurnoDelDia, workedFromShifts, MIN_WORKED_HOURS } = loadTs(path.join(ROOT, 'src/lib/hours.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const r2 = (n) => Math.round(n * 100) / 100;

// "HOY" fijo para todo el test: 16-ago-2026, 3:00 p.m. hora de Caracas (UTC-4).
const HOY = '2026-08-16';
const AYER = '2026-08-15';
const ahora = new Date(`${HOY}T15:00:00-04:00`).getTime();
const h = (r, date = HOY) => horasTurnoDelDia(r, date, ahora);

// ── 1) Día PASADO: solo lo bancado, nunca cálculo en vivo ──────────────────
eq('día pasado · solo bancado', r2(h({ day_hours: 8, night_hours: 0 }, AYER).trabajadas), 8);
eq('día pasado · jornada abierta NO suma en vivo',
  r2(h({ day_hours: 3, jornada_start_at: `${AYER}T07:00:00-04:00`, jornada_shift: 'day' }, AYER).trabajadas), 3);

// ── 2) HOY con jornada abierta: bancado + tramo desde el inicio REAL ────────
// (Regla 08-oct-2026, `horasVivasTurno`. Hasta el 02-oct el inicio se re-anclaba
// a las 7am y acá se tomaba el MAYOR contra el nominal; con inicio = hora real,
// el MAYOR escondía lo bancado antes de una parada→reactivación.)
// Marcada a las 9am REAL → a las 3pm lleva 6 h (ya NO 8 desde las 7am: el
// cliente pidió el 02-oct «si comienza a las 9am que comience a esa hora»).
eq('hoy · turno día abierto cuenta desde el inicio REAL (9am → 6 h a las 3pm)',
  r2(h({ day_hours: 0, jornada_start_at: `${HOY}T09:00:00-04:00`, jornada_shift: 'day' }).dia), 6);
// PARADA→REACTIVACIÓN: 2 h bancadas antes de la parada + reactivada a las 11am
// → a las 3pm: 2 + 4 = 6 h. Esto es EL reclamo del 08-oct («no suma las horas
// de antes de la parada con las de después»).
eq('hoy · parada→reactivación SUMA bancado + tramo nuevo',
  r2(h({ day_hours: 2, jornada_start_at: `${HOY}T11:00:00-04:00`, jornada_shift: 'day' }).dia), 6);
// TOPE FÍSICO: con 2 h bancadas y el re-inicio TECLEADO a las 7am (contaría
// doble), manda lo transcurrido real del turno: 8 h a las 3pm, no 10.
eq('hoy · tope físico si el re-inicio se teclea hacia atrás',
  r2(h({ day_hours: 2, jornada_start_at: `${HOY}T07:00:00-04:00`, jornada_shift: 'day' }).dia), 8);
eq('hoy · lo bancado nunca se reduce (piso)',
  r2(h({ day_hours: 11, jornada_start_at: `${HOY}T07:00:00-04:00`, jornada_shift: 'day' }).dia), 11);
// Turno noche: a las 3pm todavía no ha empezado (arranca 7pm) → 0, nunca negativo.
eq('hoy · turno noche aún no empieza → 0',
  r2(h({ night_hours: 0, jornada_start_at: `${HOY}T10:00:00-04:00`, jornada_shift: 'night' }).noche), 0);
// Jornada CERRADA hoy (jornada_start_at null): solo lo bancado.
eq('hoy · jornada ya cerrada → solo bancado',
  r2(h({ day_hours: 12, jornada_start_at: null, jornada_shift: 'day' }).dia), 12);
// Jornada que arrancó OTRO día (avería arrastrada) no infla el día que se mira.
eq('hoy · jornada de otro día NO infla',
  r2(h({ day_hours: 0, jornada_start_at: `${AYER}T07:00:00-04:00`, jornada_shift: 'day' }).dia), 0);

// ── 3) Tope de 12 h por turno ──────────────────────────────────────────────
const tarde = new Date(`${HOY}T23:00:00-04:00`).getTime(); // 16 h después de las 7am
eq('tope de 12 h en el cálculo en vivo',
  r2(horasTurnoDelDia({ day_hours: 0, jornada_start_at: `${HOY}T07:00:00-04:00`, jornada_shift: 'day' }, HOY, tarde).dia), 12);

// ── 4) Umbral mínimo: residuos por debajo de 0.05 h se descartan ───────────
eq('umbral · residuo de 0.02 h se descarta', h({ day_hours: 0.02 }, AYER).dia, 0);
eq('umbral · exactamente 0.05 se descarta', h({ day_hours: 0.05 }, AYER).dia, 0);
eq('umbral · 0.06 se conserva', h({ day_hours: 0.06 }, AYER).dia, 0.06);
eq('valor del umbral', MIN_WORKED_HOURS, 0.05);

// ── 5) Paradas y extras (la fórmula canónica) ──────────────────────────────
eq('paradas se restan', r2(h({ day_hours: 12, hours_stopped: 4 }, AYER).trabajadas), 8);
eq('extras se suman', r2(h({ day_hours: 12, overtime_hours: 2 }, AYER).trabajadas), 14);
eq('paradas mayores que las horas no dan negativo', r2(h({ day_hours: 5, hours_stopped: 9 }, AYER).trabajadas), 0);
eq('día + noche (corrido)', r2(h({ day_hours: 12, night_hours: 6 }, AYER).trabajadas), 18);

// ── 6) Nulos y filas ausentes ──────────────────────────────────────────────
eq('fila inexistente → 0', h(null, AYER).trabajadas, 0);
eq('fila vacía → 0', h({}, AYER).trabajadas, 0);
eq('nulls → 0', h({ day_hours: null, night_hours: null }, AYER).trabajadas, 0);

// ── 7) PARIDAD con la fórmula canónica en el caso simple (sin jornada viva) ─
const casos = [[12, 0, 0, 0], [12, 6, 3, 1], [0, 8, 0, 0], [7.6, 0, 0, 2]];
casos.forEach(([d, n, s, o]) => {
  const viaFn = h({ day_hours: d, night_hours: n, hours_stopped: s, overtime_hours: o }, AYER).trabajadas;
  eq(`paridad con workedFromShifts (${d},${n},${s},${o})`, r2(viaFn), r2(workedFromShifts(d, n, s, o)));
});

console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) {
  console.log('\nFallos:');
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('Control y Reporte por Empresa calculan las horas IGUAL.\n');
