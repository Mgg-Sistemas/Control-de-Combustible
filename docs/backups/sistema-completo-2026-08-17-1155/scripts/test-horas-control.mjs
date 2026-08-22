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

const srcPath = path.join(ROOT, 'src/lib/hours.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const { horasTurnoDelDia, workedFromShifts, MIN_WORKED_HOURS } = m.exports;

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

// ── 2) HOY con jornada abierta: cuenta desde el inicio NOMINAL del turno ────
// Marcada a las 9am, pero el turno día arranca a las 7am → a las 3pm van 8 h.
eq('hoy · turno día abierto cuenta desde las 7am (no desde que marcó)',
  r2(h({ day_hours: 0, jornada_start_at: `${HOY}T09:00:00-04:00`, jornada_shift: 'day' }).dia), 8);
// Ya tenía 2 h bancadas: se toma el MAYOR, no la suma (si no, contaría doble).
eq('hoy · MAYOR entre bancado y transcurrido, no la suma',
  r2(h({ day_hours: 2, jornada_start_at: `${HOY}T07:00:00-04:00`, jornada_shift: 'day' }).dia), 8);
eq('hoy · si lo bancado es MAYOR, gana lo bancado',
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
