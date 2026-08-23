/*
 * LA JORNADA ES EL DÍA (22-ago-2026).
 *
 * En este negocio el "día" va de las 7am a las 7am del día siguiente: turno de
 * día (7am–7pm) más turno de noche (7pm–7am). Los dos juntos son UN día de
 * trabajo, y así es como el cliente cuenta, paga y reclama.
 *
 * Por qué existe este test: el módulo de Viajes de Camiones filtraba por día de
 * CALENDARIO, así que la jornada de noche quedaba partida en dos fechas. Un
 * listero que trabajó una sola noche veía sus viajes repartidos y creía que le
 * faltaban — fue exactamente el reclamo de "registré 7 y el sistema muestra 4".
 *
 * Lo que estos casos FIJAN:
 *   · la madrugada pertenece a la jornada de la NOCHE ANTERIOR;
 *   · las ventanas son SEMIABIERTAS: [7am, 7am) — sin huecos ni solapes;
 *   · dos jornadas seguidas se tocan exactamente, sin dejar un instante afuera;
 *   · el reclamo original (7 viajes en una noche) da 7 y no 4.
 *
 *   node scripts/test-jornada-ventana.mjs
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

const srcPath = path.join(ROOT, 'src/lib/caracasDay.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const { jornadaDeFecha, jornadaWindowISO, isoTomorrow } = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};

/** Un instante en hora de Venezuela (UTC-4). */
const enCaracas = (iso, hh, mm = 0) => new Date(`${iso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-04:00`);

// ── 1) A QUÉ JORNADA PERTENECE CADA HORA ───────────────────────────────────
eq('7:00am arranca la jornada del día', jornadaDeFecha(enCaracas('2026-08-20', 7)), '2026-08-20');
eq('mediodía es del mismo día', jornadaDeFecha(enCaracas('2026-08-20', 12)), '2026-08-20');
eq('6:59pm todavía es turno de día', jornadaDeFecha(enCaracas('2026-08-20', 18, 59)), '2026-08-20');
eq('7:00pm arranca la noche, misma jornada', jornadaDeFecha(enCaracas('2026-08-20', 19)), '2026-08-20');
eq('11:59pm sigue siendo la jornada del 20', jornadaDeFecha(enCaracas('2026-08-20', 23, 59)), '2026-08-20');

// ⭐ El corazón del asunto: pasada la medianoche NO empieza un día nuevo.
eq('⭐ 00:01 pertenece a la jornada de AYER', jornadaDeFecha(enCaracas('2026-08-21', 0, 1)), '2026-08-20');
eq('⭐ 3 de la mañana pertenece a la jornada de AYER', jornadaDeFecha(enCaracas('2026-08-21', 3)), '2026-08-20');
eq('⭐ 6:59am todavía es la jornada de AYER', jornadaDeFecha(enCaracas('2026-08-21', 6, 59)), '2026-08-20');
eq('⭐ 7:00am en punto ya es la jornada NUEVA', jornadaDeFecha(enCaracas('2026-08-21', 7)), '2026-08-21');

// Cambio de mes y de año, que es donde se rompen los cálculos a mano.
eq('madrugada del 1 de mes → jornada del último día del mes anterior',
  jornadaDeFecha(enCaracas('2026-09-01', 2)), '2026-08-31');
eq('madrugada del 1 de enero → jornada del 31 de diciembre',
  jornadaDeFecha(enCaracas('2027-01-01', 2)), '2026-12-31');

// ── 2) LA VENTANA DE UNA JORNADA ───────────────────────────────────────────
const v = jornadaWindowISO('2026-08-20');
eq('la jornada arranca a las 7am', v.desdeISO, '2026-08-20T07:00:00-04:00');
eq('y termina a las 7am del día siguiente', v.hastaExclusivoISO, '2026-08-21T07:00:00-04:00');

const varios = jornadaWindowISO('2026-08-18', '2026-08-20');
eq('un rango arranca en la primera jornada', varios.desdeISO, '2026-08-18T07:00:00-04:00');
eq('y cierra al terminar la última', varios.hastaExclusivoISO, '2026-08-21T07:00:00-04:00');

eq('isoTomorrow cruza el mes', isoTomorrow('2026-08-31'), '2026-09-01');
eq('isoTomorrow cruza el año', isoTomorrow('2026-12-31'), '2027-01-01');
eq('isoTomorrow en año bisiesto', isoTomorrow('2028-02-28'), '2028-02-29');

// ── 3) ⭐ NI HUECOS NI SOLAPES ENTRE JORNADAS SEGUIDAS ──────────────────────
// El fin de una tiene que ser EXACTAMENTE el arranque de la siguiente. Si no,
// hay instantes que no caen en ninguna jornada (se pierden viajes del reporte)
// o caen en dos (se cuentan dos veces, y se paga de más).
const j1 = jornadaWindowISO('2026-08-20');
const j2 = jornadaWindowISO('2026-08-21');
eq('⭐ el fin de una jornada es el arranque de la siguiente', j1.hastaExclusivoISO, j2.desdeISO);

// Barrido real: 48 horas seguidas, minuto a minuto cada 30, y CADA instante
// tiene que caer en una sola jornada.
const dentro = (t, w) => t >= new Date(w.desdeISO).getTime() && t < new Date(w.hastaExclusivoISO).getTime();
let huecos = 0, solapes = 0;
for (let min = 0; min < 48 * 60; min += 30) {
  const t = new Date(enCaracas('2026-08-20', 7).getTime() + min * 60000).getTime();
  const n = (dentro(t, j1) ? 1 : 0) + (dentro(t, j2) ? 1 : 0);
  if (n === 0) huecos++;
  if (n > 1) solapes++;
}
eq('⭐ ningún instante queda fuera de las dos jornadas', huecos, 0);
eq('⭐ ningún instante cae en las dos a la vez', solapes, 0);

// ── 4) ⭐ EL RECLAMO ORIGINAL: 7 VIAJES EN UNA NOCHE DAN 7, NO 4 ────────────
// Un listero de noche registra 4 viajes antes de medianoche y 3 después.
const viajesDeLaNoche = [
  enCaracas('2026-08-20', 20), enCaracas('2026-08-20', 21, 30),
  enCaracas('2026-08-20', 22), enCaracas('2026-08-20', 23, 45),
  enCaracas('2026-08-21', 0, 30), enCaracas('2026-08-21', 2), enCaracas('2026-08-21', 5, 15),
];
const porJornada = viajesDeLaNoche.filter((d) => jornadaDeFecha(d) === '2026-08-20').length;
// Así los contaba ANTES: por día de calendario DE CARACAS (no de UTC — comparar
// contra UTC daría 0 y el test pasaría por el motivo equivocado).
const calendarioCaracas = (d) => new Date(d.getTime() - 4 * 3600000).toISOString().slice(0, 10);
const porCalendario = viajesDeLaNoche.filter((d) => calendarioCaracas(d) === '2026-08-20').length;

eq('⭐ contados por JORNADA salen los 7 de la noche', porJornada, 7);
eq('⭐ por calendario salían 4 — el reclamo del cliente, clavado', porCalendario, 4);
eq('y los otros 3 se iban al día siguiente',
  viajesDeLaNoche.filter((d) => calendarioCaracas(d) === '2026-08-21').length, 3);

// Y la ventana de la base también los trae a los 7.
const w = jornadaWindowISO('2026-08-20');
const enVentana = viajesDeLaNoche.filter((d) => dentro(d.getTime(), w)).length;
eq('⭐ la consulta a la base trae los 7 de esa jornada', enVentana, 7);

console.log(`\n${fail === 0 ? '✅' : '❌'} test-jornada-ventana · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
