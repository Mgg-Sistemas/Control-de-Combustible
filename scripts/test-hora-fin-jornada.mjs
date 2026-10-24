/*
 * 🕐 LA HORA DECLARADA DE FIN DE JORNADA (20-oct-2026, a pedido urgente).
 *
 * Pedido textual: «necesito que los inspectores puedan colocar la hora en la que
 * finalizó la jornada, por si finalizó antes». El caso del mismo día: máquinas
 * que pararon a las 5pm, nadie las cerró, y el barredor de las 7pm les bancó
 * hasta el fin del turno — horas que no se trabajaron y que se PAGAN.
 *
 * LO QUE FIJA, Y POR QUÉ DUELE SI SE ROMPE:
 *  · VACÍO = AHORA: quien no toca el campo cierra EXACTAMENTE como siempre —
 *    500 cierres al mes dependen de que esto no cambie.
 *  · NUNCA EN EL FUTURO, NUNCA ANTES DEL INICIO: horas negativas o por venir
 *    serían horas inventadas en el pago.
 *  · EL TOPE NOMINAL SIGUE MANDANDO: declarar las 9pm no regala 2 horas, igual
 *    que cerrar tarde de toda la vida (regla 26-sep-2026).
 *  · ANTICIPADO SE DECIDE CON LA HORA DECLARADA: cerrar 7:05pm diciendo
 *    «finalizó 17:00» exige motivo como cualquier cierre anticipado.
 *  · LA NOCHE CRUZA LA MEDIANOCHE: a la 1am, «23:45» es de AYER, no un futuro.
 *
 *   node scripts/test-hora-fin-jornada.mjs
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
const compilar = (p) => {
  if (cache.has(p)) return cache.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cache.set(p, m.exports);
  m._compile(js, m.filename);
  cache.set(p, m.exports);
  return m.exports;
};
const realLoad = Module._load;
Module._load = function (req, parent) {
  // './supabase' SIEMPRE de mentira: horaFinJornada usa caracasParts de
  // jornada.ts, que arrastra supabase (y con él react-native) — acá no hace falta.
  if (parent && String(parent.filename || '').endsWith('.ts') && (req === './supabase' || req.endsWith('/supabase'))) {
    return { supabase: {}, selectAllRows: async () => [] };
  }
  if (req.startsWith('.') && parent && String(parent.filename || '').endsWith('.ts')) {
    const cand = path.resolve(path.dirname(parent.filename), req);
    for (const p of [cand, cand + '.ts', path.join(cand, 'index.ts')]) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return compilar(p);
    }
  }
  return realLoad.apply(this, arguments);
};

const { resolverFinJornada, parseHHMM } = compilar(path.join(ROOT, 'src/lib/horaFinJornada.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// Caracas es UTC−4 fijo: las horas de los casos se arman con el desfase explícito.
const CCS = (iso) => new Date(iso + '-04:00').getTime();
// Una jornada de DÍA típica: arrancó 7:30am, fin nominal 7:00pm, son las 6:10pm.
const DIA = {
  startMs: CCS('2026-10-20T07:30:00'),
  nominalEndMs: CCS('2026-10-20T19:00:00'),
  nowMs: CCS('2026-10-20T18:10:00'),
};

// ── 1) parseHHMM ─────────────────────────────────────────────────────────────
eq('07:30 se lee', parseHHMM('07:30'), { h: 7, m: 30 });
eq('* también sin cero (7:30)', parseHHMM('7:30'), { h: 7, m: 30 });
eq('* 25:00 no es una hora', parseHHMM('25:00'), null);
eq('* 17:65 tampoco', parseHHMM('17:65'), null);
eq('* texto suelto tampoco', parseHHMM('cinco'), null);
eq('* vacío tampoco', parseHHMM(''), null);

// ── 2) VACÍO = AHORA (el cierre de siempre, intacto) ─────────────────────────
{
  const r = resolverFinJornada({ ...DIA, texto: '' });
  ok('vacío resuelve ok', r.ok);
  eq('⭐ vacío = ahora, sin marca de declarado', [r.finMs, r.declarado], [DIA.nowMs, false]);
  eq('* efectivo = ahora (aún no llega el fin nominal)', r.efectivoMs, DIA.nowMs);
  ok('* y cuenta como anticipado (son las 6:10pm)', r.anticipado);
}
{
  // Cerrando DESPUÉS de las 7pm sin declarar hora: registra las horas trabajadas en vivo.
  const r = resolverFinJornada({ ...DIA, nowMs: CCS('2026-10-20T19:25:00'), texto: null });
  eq('⭐ cerrar tarde registra las horas reales transcurridas', r.efectivoMs, CCS('2026-10-20T19:25:00'));
  ok('* y NO es anticipado', !r.anticipado);
}

// ── 3) LA HORA DECLARADA ─────────────────────────────────────────────────────
{
  const r = resolverFinJornada({ ...DIA, texto: '17:00' });
  ok('«17:00» resuelve ok', r.ok);
  eq('⭐ el fin es LA HORA DECLARADA, no ahora', r.finMs, CCS('2026-10-20T17:00:00'));
  eq('* efectivo = declarado (está antes del nominal)', r.efectivoMs, CCS('2026-10-20T17:00:00'));
  ok('* declarado y anticipado (exigirá motivo)', r.declarado && r.anticipado);
}
{
  // Son las 7:05pm y declara que la máquina paró a las 5pm: SIGUE siendo anticipado.
  const r = resolverFinJornada({ ...DIA, nowMs: CCS('2026-10-20T19:05:00'), texto: '17:00' });
  ok('⭐ cerrar a las 7:05pm declarando 17:00 ES anticipado (motivo obligatorio)', r.ok && r.anticipado);
}
{
  // Declarar más de 12 horas (ej. 21:00): permitido y registra las horas reales.
  const r = resolverFinJornada({ ...DIA, nowMs: CCS('2026-10-20T21:10:00'), texto: '21:00' });
  eq('⭐ declarar 21:00 registra las 13,5 h reales (más de 12h permitido)', r.efectivoMs, CCS('2026-10-20T21:00:00'));
  ok('* y no es anticipado', !r.anticipado);
}

// ── 4) LO QUE NO PUEDE SER ───────────────────────────────────────────────────
{
  const r = resolverFinJornada({ ...DIA, texto: '18:45' });
  ok('18:45 con reloj en 18:10 es FUTURO → error', !r.ok && /futuro/i.test(r.error));
}
{
  const r = resolverFinJornada({ ...DIA, texto: '07:00' });
  ok('antes del inicio (7:00 < 7:30) → error que DICE el inicio', !r.ok && /anterior al inicio/.test(r.error) && /07:30/.test(r.error));
}
{
  const r = resolverFinJornada({ ...DIA, texto: '99:99' });
  ok('una hora mal escrita → error claro con el formato', !r.ok && /HH:MM/.test(r.error));
}
{
  // 60 s de gracia: declarar «ahora mismo» tecleado a mano no rebota por segundos.
  const r = resolverFinJornada({ ...DIA, texto: '18:10' });
  ok('declarar la hora actual exacta NO rebota', r.ok);
}

// ── 5) LA NOCHE CRUZA LA MEDIANOCHE ──────────────────────────────────────────
{
  // Jornada de NOCHE del 20: arrancó 7:40pm, fin nominal 7am del 21. Es la 1:15am
  // del 21 y el inspector declara que paró a las 23:45 — eso es AYER, no futuro.
  const NOCHE = {
    startMs: CCS('2026-10-20T19:40:00'),
    nominalEndMs: CCS('2026-10-21T07:00:00'),
    nowMs: CCS('2026-10-21T01:15:00'),
  };
  const r = resolverFinJornada({ ...NOCHE, texto: '23:45' });
  ok('«23:45» a la 1am resuelve ok', r.ok);
  eq('⭐ cae en AYER (la noche cruza la medianoche)', r.finMs, CCS('2026-10-20T23:45:00'));
  ok('* y es anticipado (la noche termina 7am)', r.anticipado);
  // Y una hora de ESTA madrugada también vale tal cual.
  const r2 = resolverFinJornada({ ...NOCHE, texto: '00:50' });
  eq('* «00:50» es de HOY madrugada', r2.finMs, CCS('2026-10-21T00:50:00'));
}

// ── 6) LA PANTALLA USA TODO ESTO (no una copia suya) ─────────────────────────
{
  const sup = fs.readFileSync(path.join(ROOT, 'src/screens/SupervisorScreen.tsx'), 'utf8');
  ok('⭐ el cierre resuelve el fin con la librería (no con Date.now a secas)',
    sup.includes('const fin = resolverFinJornada({ startMs: new Date(jornadaStart).getTime(), nominalEndMs, texto: finTime });')
    && sup.includes('const cierreEfectivoMs = fin.efectivoMs;'));
  ok('⭐ una hora inválida NO cierra: error visible y return',
    sup.includes("if (!fin.ok) { setJornadaBusy(false); setNotice('❌ ' + fin.error); return; }"));
  ok('⭐ el MOTIVO de cierre anticipado se decide con la hora DECLARADA',
    /const requiereMotivoCierre = \(\): boolean => \{\s*\n\s*if \(!ci\) return false;\s*\n\s*const r = finResuelto\(\);\s*\n\s*return r\?\.ok \? r\.anticipado : cierreAnticipado\(\);/.test(sup));
  ok('* hay un campo para la hora y explica que vacío = ahora',
    sup.includes('🕐 Hora en que finalizó (opcional)') && sup.includes('Vacío = ahora mismo'));
  ok('* la vista previa dice cuántas horas van a bancar con esa hora',
    sup.includes('Con esa hora, este tramo:'));
  ok('* la bitácora registra la hora declarada',
    sup.includes('` · fin declarado ${finTime.trim()}`'));
  // El campo no puede quedar pegado de un cierre anterior: se limpia en TODAS las
  // salidas (confirmar, cancelar, abrir el confirmador y cambiar de máquina).
  eq('* la hora declarada se limpia en las cuatro salidas',
    (sup.match(/setFinTime\(''\)/g) || []).length >= 4, true);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-hora-fin-jornada · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('   Vacío = ahora; nunca futuro ni antes del inicio; el tope nominal sigue mandando.');
