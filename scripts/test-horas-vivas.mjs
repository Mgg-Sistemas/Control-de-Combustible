/*
 * Test de `horasVivasTurno` — horas EN VIVO de un turno con jornada abierta.
 *
 * Por qué existe (08-oct-2026): «cuando los inspectores marcan una máquina parada
 * o averiada y la reactivan, no suma las horas de antes de la parada con las que
 * hizo después». Causa raíz: hasta el 02-oct-2026 re-iniciar una jornada
 * RE-ANCLABA el inicio a las 7am/7pm, y OCHO sitios distintos calculaban el vivo
 * como «el MAYOR entre lo bancado y lo transcurrido» (o anclado al nominal).
 * El 02-oct el inicio pasó a ser la HORA REAL y todos esos MAYOR quedaron mal:
 * 2 h bancadas + 1 h del tramo nuevo mostraban «2 h».
 *
 * La regla ÚNICA quedó en `horasVivasTurno` (src/lib/hours.ts):
 *   max(bancado, min(topeFisico, bancado + transcurrido desde el inicio REAL))
 * y los candados de abajo vigilan que NADIE vuelva a reimplementarla a mano.
 *
 *   node scripts/test-horas-vivas.mjs
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
const { horasVivasTurno } = loadTs(path.join(ROOT, 'src/lib/hours.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};

const D = '2026-10-08';
const ms = (hhmm, d = D) => new Date(`${d}T${hhmm}:00-04:00`).getTime();
const viva = (bancado, start, shift, now) => horasVivasTurno({ bancado, startMs: start, shift, nowMs: now });

// ── 1) EL CASO DEL RECLAMO: parada→reactivación SUMA ───────────────────────
// Trabajó 7–9am (2 h bancadas al marcar la parada), reactivada a las 11am.
eq('parada 2h + reactivada 11am → a las 12 lleva 3 h (no 2)',
  viva(2, ms('11:00'), 'day', ms('12:00')), 3);
eq('parada 2h + reactivada 11am → a las 5pm lleva 8 h',
  viva(2, ms('11:00'), 'day', ms('17:00')), 8);
eq('tramo nuevo más largo que lo bancado: 2h + 5h = 7 (el MAYOR daba 5)',
  viva(2, ms('11:00'), 'day', ms('16:00')), 7);

// ── 2) Sin parada: inicio REAL tardío (regla 02-oct) ───────────────────────
eq('inicio real 9am, nada bancado → a las 12 lleva 3 h (no 5 desde las 7am)',
  viva(0, ms('09:00'), 'day', ms('12:00')), 3);

// ── 3) Jornada cerrada: devuelve lo bancado ────────────────────────────────
eq('cerrada (startMs null) → bancado', viva(4.5, null, 'day', ms('12:00')), 4.5);
eq('cerrada → bancado topa en 12', viva(14, null, 'day', ms('12:00')), 12);

// ── 4) TOPE FÍSICO: el re-inicio tecleado hacia atrás no cuenta doble ──────
// Reactivan a las 11 pero escriben 07:00 → bancado+tramo daría 2+5=7 a las 12,
// pero el turno solo ha durado 5 h desde las 7am → 5.
eq('re-inicio tecleado 7am con 2h bancadas → tope físico 5 h a las 12',
  viva(2, ms('07:00'), 'day', ms('12:00')), 5);
eq('tope duro de 12 h por turno', viva(6, ms('08:00'), 'day', ms('23:30')), 12);

// ── 5) PISO: lo ya bancado nunca se reduce ─────────────────────────────────
// 11 h bancadas a las 4:30pm superan lo físicamente posible (9.5 h desde las
// 7am): no se baja lo guardado, pero TAMPOCO se le sigue sumando encima.
eq('bancado por encima del tope físico → se mantiene, sin sumarle más',
  viva(11, ms('16:00'), 'day', ms('16:30')), 11);
eq('bancado mayor que el tope físico → gana lo bancado',
  viva(9, ms('08:00'), 'day', ms('09:00')), 9);

// ── 6) NOCHE: cruza medianoche con el nominal del día de NEGOCIO ───────────
// Parada 7pm–11pm bancó 3 h… (noche inicia 19:00; reactivada 23:00 del día D).
eq('noche · 3h bancadas + reactivada 11pm → a la 1am lleva 5 h',
  viva(3, ms('23:00'), 'night', ms('01:00', '2026-10-09')), 5);
// Reactivada ya pasada la medianoche: el nominal 7pm es el de AYER (negocio).
eq('noche · reactivada 00:30 con 4h bancadas → a las 2am lleva 5.5 h',
  viva(4, ms('00:30', '2026-10-09'), 'night', ms('02:00', '2026-10-09')), 5.5);
eq('noche · tope físico desde las 7pm del día de negocio',
  viva(2, ms('19:00'), 'night', ms('23:00')), 4);

// ── 7) Bordes ──────────────────────────────────────────────────────────────
eq('recién reactivada (ahora = inicio) → lo bancado tal cual', viva(2.5, ms('11:00'), 'day', ms('11:00')), 2.5);
eq('bancado basura (negativo/NaN) → 0', viva(-3, null, 'day', ms('12:00')), 0);
eq('redondeo a 2 decimales', viva(1.333, ms('11:00'), 'day', ms('11:20')), 1.67);

// ── 8) CANDADOS: nadie reimplementa el vivo a mano ─────────────────────────
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const usa = (rel, min) => {
  const n = (src(rel).match(/horasVivasTurno\(/g) || []).length;
  eq(`candado · ${rel} usa horasVivasTurno (≥${min})`, n >= min, true);
};
usa('src/lib/hours.ts', 3);                              // definición + día + noche
usa('src/lib/machineLiveStatus.ts', 2);                  // día y noche en vivo
usa('src/screens/ReportsScreen.tsx', 2);                 // informe de jornada
usa('src/screens/redesign/InspectionsSummary.tsx', 6);   // liveHorasOf/Shift + lista + buscador
usa('src/screens/SupervisorScreen.tsx', 2);              // acumulado del turno (teléfono)
usa('src/screens/SupervisionScreen.tsx', 1);             // detalle de jornada

// El patrón viejo (MAYOR entre bancado y transcurrido) no debe volver:
eq('candado · hours.ts sin Math.max(nn, elapsed)', /Math\.max\((nn|dd), elapsed\)/.test(src('src/lib/hours.ts')), false);
eq('candado · InspectionsSummary sin Math.max(night, elapsed)', /Math\.max\((night|day), elapsed\)/.test(src('src/screens/redesign/InspectionsSummary.tsx')), false);
eq('candado · ReportsScreen sin Math.max(nn, elapsed)', /Math\.max\((nn|dd), elapsed\)/.test(src('src/screens/ReportsScreen.tsx')), false);
// El vivo del Catálogo ya no ancla el día al nominal de las 7am:
eq('candado · machineLiveStatus sin nominalDiaStart', src('src/lib/machineLiveStatus.ts').includes('nominalDiaStart'), false);
// El teléfono ya no muestra el MAYOR como «Acumulado del turno»:
eq('candado · SupervisorScreen sin Math.max(curRoundHours…)', src('src/screens/SupervisorScreen.tsx').includes('Math.max(curRoundHours'), false);
// Y el guardado del cierre manual sigue ACUMULANDO con tope físico y piso real:
const sup = src('src/screens/SupervisorScreen.tsx');
eq('candado · cierre manual acumula base + horas con tope y piso',
  sup.includes('Math.max(pisoReal, Math.min(topeFisico, base + horas))'), true);

console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) {
  console.log('\nFallos:');
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('Las horas en vivo SUMAN lo bancado antes de la parada con el tramo nuevo.\n');
