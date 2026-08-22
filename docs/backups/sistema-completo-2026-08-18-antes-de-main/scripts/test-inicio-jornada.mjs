/*
 * INICIO DE JORNADA — regla única compartida.
 *
 * Blinda `calcularInicioJornada` (src/lib/jornada.ts) y, sobre todo, que
 * `startJornada` ESCRIBA los campos sin los cuales una jornada es invisible para
 * el sistema.
 *
 * El caso que lo motivó (18-ago-2026): el QR del operador guardaba nombre, cédula y
 * horómetro, pero NO `jornada_start_at` ni `jornada_shift`. `clasificarEstadoTurno`
 * mira exactamente esos campos, así que la máquina salía "⏳ pendiente por iniciar"
 * aunque el operador llevara horas trabajando. Eran 1.410 rondas desde el 01-jul-2026.
 *
 *   npm run test:inicio   (o: node scripts/test-inicio-jornada.mjs)
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

// ── Carga de módulos TS con supabase simulado ───────────────────────────────
let upsertCapturado = null;   // { machineryId, dateISO, patch, recordedBy }

const stubs = {
  supabase: {
    supabase: {
      from: (tabla) => {
        const q = {
          select: () => q, eq: () => q, in: () => q, gte: () => q, lte: () => q,
          not: () => q, order: () => q, limit: () => q,
          maybeSingle: () => Promise.resolve({ data: DATOS[tabla]?.[0] ?? null, error: null }),
          single: () => Promise.resolve({ data: DATOS[tabla]?.[0] ?? null, error: null }),
          upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'asg-1' }, error: null }) }) }),
          update: () => q,
          then: (res, rej) => Promise.resolve({ data: DATOS[tabla] ?? [], error: null }).then(res, rej),
        };
        return q;
      },
      rpc: (nombre) => Promise.resolve({ data: nombre === 'employee_public_lookup' ? [{ cargo: 'operador', company_id: null }] : null, error: null }),
    },
    selectAllRows: async (t) => DATOS[t] ?? [],
  },
  machineRounds: {
    upsertMachineRound: async (machineryId, dateISO, patch, recordedBy) => {
      upsertCapturado = { machineryId, dateISO, patch, recordedBy };
      return { data: null, error: null };
    },
  },
};

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
    const base = id.split('/').pop();
    if (stubs[base]) return stubs[base];
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

let DATOS = {};
const { calcularInicioJornada, startJornada } = loadTs(path.join(ROOT, 'src/lib/jornada.ts'));

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? `  → ${extra}` : '')); }
};
// Caracas es UTC-4 fijo.
const caracas = (iso, hhmm) => new Date(`${iso}T${hhmm}:00-04:00`);

console.log('INICIO DE JORNADA — regla única + campos obligatorios\n');

// ── 1) DÍA: dentro del margen (≤9:00am) → se ancla a las 7:00 ───────────────
{
  const r = calcularInicioJornada({
    declaredIso: '2026-08-18T07:30:00-04:00', shift: 'day', now: caracas('2026-08-18', '07:30'),
  });
  ok('día 7:30am → se ancla al arranque nominal 7:00', r.startIso === '2026-08-18T07:00:00-04:00', r.startIso);
  ok('día 7:30am → marcada como anclada', r.anclada === true);
  ok('día 7:30am → la ronda es la de hoy', r.roundDate === '2026-08-18', r.roundDate);

  const borde = calcularInicioJornada({
    declaredIso: '2026-08-18T08:59:00-04:00', shift: 'day', now: caracas('2026-08-18', '08:59'),
  });
  ok('día 8:59am (justo dentro) → sigue anclada a las 7:00', borde.startIso === '2026-08-18T07:00:00-04:00', borde.startIso);
}

// ── 2) DÍA: fuera del margen → conserva el inicio declarado ────────────────
{
  const r = calcularInicioJornada({
    declaredIso: '2026-08-18T11:00:00-04:00', shift: 'day', now: caracas('2026-08-18', '11:00'),
  });
  ok('día 11:00am → NO se ancla, conserva el declarado', r.startIso === '2026-08-18T11:00:00-04:00', r.startIso);
  ok('día 11:00am → anclada = false', r.anclada === false);
  ok('día 11:00am → reporta 2 h de retraso', r.retrasoMin === 120, String(r.retrasoMin));
}

// ── 3) NOCHE: dentro del margen (≤9:00pm) → se ancla a las 19:00 ───────────
{
  const r = calcularInicioJornada({
    declaredIso: '2026-08-18T19:40:00-04:00', shift: 'night', now: caracas('2026-08-18', '19:40'),
  });
  ok('noche 7:40pm → se ancla al arranque nominal 19:00', r.startIso === '2026-08-18T19:00:00-04:00', r.startIso);
  ok('noche 7:40pm → la ronda es la de hoy', r.roundDate === '2026-08-18', r.roundDate);
}

// ── 4) NOCHE pasada la medianoche → la ronda es la de AYER ────────────────
// Es el bug del 10-ago-2026: con la fecha de calendario se creaba una ronda
// "fantasma" del día de HOY con horas de la noche de AYER.
{
  const r = calcularInicioJornada({
    declaredIso: '2026-08-19T00:30:00-04:00', shift: 'night', now: caracas('2026-08-19', '00:30'),
  });
  ok('noche 00:30 → la ronda pertenece a la noche de AYER', r.roundDate === '2026-08-18', r.roundDate);
  ok('noche 00:30 → fuera del margen, conserva el declarado', r.startIso === '2026-08-19T00:30:00-04:00', r.startIso);
  ok('noche 00:30 → el retraso se mide contra las 9pm de AYER', r.retrasoMin === 210, String(r.retrasoMin));
}

// ── 5) Lo esencial: startJornada ESCRIBE los campos que hacen falta ────────
{
  DATOS = {
    machinery: [{ en_espera: false, company_id: null }],
    maintenance_requests: [],
    operator_assignments: [],
  };
  upsertCapturado = null;
  const res = await startJornada({
    machineId: 'm1', first: 'JUAN', last: 'PEREZ', cedula: '12345678',
    horometroInicial: 100, createdBy: null, recordedBy: 'uid-1',
  });

  ok('startJornada termina bien', res.ok === true, res.ok ? '' : res.error);
  ok('escribió en machine_rounds', upsertCapturado !== null);
  if (upsertCapturado) {
    const p = upsertCapturado.patch;
    // Estos tres son los que mira clasificarEstadoTurno. Sin ellos la máquina es
    // invisible para el sistema por más operador y horómetro que tenga.
    ok('⭐ guarda jornada_start_at', !!p.jornada_start_at, JSON.stringify(Object.keys(p)));
    ok('⭐ guarda jornada_shift', p.jornada_shift === 'day' || p.jornada_shift === 'night', String(p.jornada_shift));
    ok('⭐ guarda quién la marcó', p.jornada_marked_by === 'uid-1', String(p.jornada_marked_by));
    ok('guarda la hora real de marcado', !!p.jornada_marked_at);
    // La ronda nace 'parada' cuando llega con 0 h: arrancar la vuelve operativa.
    ok('⭐ deja el estado en operativa, no parada', p.status === 'operativa', String(p.status));
    // No se perdió nada de lo que ya guardaba antes.
    ok('sigue guardando el operador', p.day_operator === 'JUAN PEREZ' || p.night_operator === 'JUAN PEREZ');
    ok('sigue guardando la cédula', p.day_operator_ci === '12345678' || p.night_operator_ci === '12345678');
    ok('sigue guardando el horómetro', p.horometro_inicial === 100);
    // La ronda va a la fecha de NEGOCIO, y el resultado la devuelve para que
    // quien cierre escriba en la MISMA ronda.
    ok('la ronda usa la fecha de negocio devuelta', res.ok && upsertCapturado.dateISO === res.roundDate,
      `${upsertCapturado.dateISO} vs ${res.ok ? res.roundDate : '—'}`);
  }
}

if (fail) {
  console.log(`✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nIniciar jornada desde el QR ya deja constancia: la máquina se ve INICIADA, no pendiente.`);
