/*
 * SINCRONÍA del REPORTE POR EMPRESA con el resto de las vistas.
 *
 * Blinda la regla del 14-ago-2026 (aplicada al reporte por empresa el
 * 17-ago-2026, "fuente de verdad = teléfono"): una máquina que DECLARÓ jornada
 * y cerró en 0 h es ✅ FINALIZADA (grupo ACTIVAS), NO 🟡 Parada. Antes el
 * reporte por empresa la metía en "Averiadas / Paradas (en 0)" con la regla
 * vieja "0 h = parada", desincronizándose del teléfono, las tarjetas y el
 * reporte por firma. Si alguien la revierte, este test falla.
 *
 * No usa framework (el repo no tiene): transpila los .ts en memoria y stubbea
 * la capa de red/PDF. Mismo patrón que scripts/test-reportes-paridad.mjs.
 *
 *   npm run test:empresa   (o: node scripts/test-empresa-sync.mjs)
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

// ── Cargador recursivo de .ts, con stubs por NOMBRE de módulo ───────────────
const stubs = {};
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
      const cand = [p + '.ts', p + '.tsx', path.join(p, 'index.ts')].find(fs.existsSync);
      if (cand) return loadTs(cand);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

// ── Escenario: 3 máquinas de una empresa, cada una en un estado distinto ─────
const DATE = '2026-08-15';           // día PASADO → sin cálculo EN VIVO (determinista)
const at = (h) => `${DATE}T${String(h).padStart(2, '0')}:00:00-04:00`;

// m1: DECLARÓ jornada de día y cerró en 0 h (jornada_start_at null) → FINALIZADA (activa).
// m2: parada de verdad (ticket MÁQUINA PARADA, 0 h)               → averia.
// m3: trabajó 12 h                                                → activa.
// m4: DÍA declarado limpio (0 h) + NOCHE parada → ACTIVA (el día finalizó; la noche
//     parada se muestra SOLO en su columna). Antes caía en Averiadas (bug 17-ago-2026).
const MACHS = [
  { id: 'm1', code: 'RETRO DECLARADA', serial: 'S1', plate: null, tipo: 'MARCA A', encargado: null, active: true, operational: true, en_espera: false, company_id: 'c1', company: { name: 'EMPRESA X' } },
  { id: 'm2', code: 'PALA PARADA',     serial: 'S2', plate: null, tipo: 'MARCA B', encargado: null, active: true, operational: true, en_espera: false, company_id: 'c1', company: { name: 'EMPRESA X' } },
  { id: 'm3', code: 'EXCA TRABAJO',    serial: 'S3', plate: null, tipo: 'MARCA C', encargado: null, active: true, operational: true, en_espera: false, company_id: 'c1', company: { name: 'EMPRESA X' } },
  { id: 'm4', code: 'JUMBO DIANOCHE',  serial: 'S4', plate: null, tipo: 'MARCA D', encargado: null, active: true, operational: true, en_espera: false, company_id: 'c1', company: { name: 'EMPRESA X' } },
  // m5: TRABAJÓ 8 h de día y LUEGO se averió (avería del mismo día) → AVERIADA, pero se
  //     muestran las 8 h y la hora de avería (fix 18-ago-2026). Antes salía Activa.
  { id: 'm5', code: 'PAYLOADER TRABMORE', serial: 'S5', plate: null, tipo: 'MARCA E', encargado: null, active: true, operational: true, en_espera: false, company_id: 'c1', company: { name: 'EMPRESA X' } },
];
const ROUNDS = [
  { machinery_id: 'm1', day_hours: 0,  night_hours: 0, hours_stopped: 0, overtime_hours: 0, jornada_start_at: null, jornada_shift: 'day', declared_day: true,  declared_night: null,  jornada_marked_by: null },
  { machinery_id: 'm2', day_hours: 0,  night_hours: 0, hours_stopped: 0, overtime_hours: 0, jornada_start_at: null, jornada_shift: null,  declared_day: null,  declared_night: null,  jornada_marked_by: null },
  { machinery_id: 'm3', day_hours: 12, night_hours: 0, hours_stopped: 0, overtime_hours: 0, jornada_start_at: null, jornada_shift: 'day', declared_day: true,  declared_night: null,  jornada_marked_by: null },
  { machinery_id: 'm4', day_hours: 0,  night_hours: 0, hours_stopped: 0, overtime_hours: 0, jornada_start_at: null, jornada_shift: 'day', declared_day: true,  declared_night: false, jornada_marked_by: null },
  { machinery_id: 'm5', day_hours: 8,  night_hours: 0, hours_stopped: 0, overtime_hours: 0, jornada_start_at: null, jornada_shift: 'day', declared_day: true,  declared_night: null,  jornada_marked_by: null },
];
const MR = [
  { machinery_id: 'm2', material: 'MÁQUINA PARADA', notes: 'NO TRABAJÓ · sin operador', created_at: at(9),  status: 'pendiente', resolved_at: null },
  { machinery_id: 'm4', material: 'MÁQUINA PARADA', notes: 'NO TRABAJÓ DE NOCHE',        created_at: at(21), status: 'pendiente', resolved_at: null },
  // m5: trabajó de día y a las 2pm se averió (par MÁQUINA PARADA + avería real, mismo evento).
  { machinery_id: 'm5', material: 'MÁQUINA PARADA', notes: 'GATO HIDRÁULICO',            created_at: at(14), status: 'pendiente', resolved_at: null },
  { machinery_id: 'm5', material: 'GATO HIDRÁULICO', notes: 'GATO HIDRÁULICO',           created_at: at(14), status: 'pendiente', resolved_at: null },
];

// supabase: `from(t)` devuelve una cadena thenable (sirve tanto para
// `.select().in()` como para `.select().in().lte().or().order()`), y `selectAllRows`.
const makeChain = (data) => {
  const o = {};
  ['select', 'in', 'lte', 'gte', 'or', 'eq', 'order', 'not'].forEach((k) => (o[k] = () => o));
  o.then = (res) => res({ data });
  return o;
};
let roundsCall = 0;
stubs['supabase'] = {
  supabase: {
    from: (t) => makeChain(t === 'maintenance_requests' ? MR : t === 'profiles' ? [] : []),
  },
  selectAllRows: async (table) => {
    if (table === 'machinery') return MACHS;
    if (table === 'machine_rounds') { roundsCall += 1; return roundsCall === 1 ? ROUNDS : []; }
    if (table === 'machine_work_segments') return [];
    return [];
  },
};
let captured = [];
stubs['pdf'] = {
  pdfDocument: ({ body }) => body,
  exportPdf: async (html) => { captured.push(html); return true; },
  nowStamp: () => '15 AGO 2026, 07:47 P. M.',
};
stubs['machineInspectors'] = {
  listInspectorAssignments: async () => ({ rows: MACHS.map((m) => ({
    machinery_id: m.id, inspector_name: 'PEPE PÉREZ', shift: 'day', code: m.code, serial: m.serial, plate: null,
    tipo: m.tipo, companyName: 'EMPRESA X', sector: 'ESTE', referencia: '', latitude: null, longitude: null, encargado: null,
  })) }),
  inspectorSiempreActivo: () => false,
};

const rep = loadTs(path.join(ROOT, 'src/lib/porEmpresaReport.ts'));
await rep.generateEmpresaDiaReport({ date: DATE, companyIds: ['c1'] });
const html = captured[0] || '';

// ── Aserciones ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };
const grpCount = (label) => { const m = html.match(new RegExp(`${label} · (\\d+)`)); return m ? Number(m[1]) : null; };

ok('el reporte se generó', html.length > 0);
ok('ACTIVAS = 3 (declaró+0h + trabajó 12h + día limpio/noche parada)', grpCount('✅ Activas') === 3);
ok('AVERIADAS/PARADAS = 2 (parada real + trabajó-y-se-averió)', grpCount('🔴 Averiadas / Paradas') === 2);
ok('la declaró+0h NO se rotula "Parada · jornada en 0"', !html.includes('Parada · jornada en 0'));
ok('la declaró+0h se rotula "Jornada finalizada (0 h)"', html.includes('Jornada finalizada (0 h)'));
ok('la máquina declarada aparece en el reporte', html.includes('RETRO DECLARADA'));
ok('la parada real aparece en el reporte', html.includes('PALA PARADA'));
// El bug del 17-ago: día declarado limpio + noche parada → ACTIVA, no averiada.
ok('día declarado + noche parada aparece en el reporte', html.includes('JUMBO DIANOCHE'));
ok('la parada de NOCHE se sigue mostrando (en su columna)', /No trabaj/i.test(html));
// El fix del 18-ago: trabajó y se averió → AVERIADA, pero muestra las horas + la hora de avería.
ok('trabajó-y-se-averió aparece en el reporte', html.includes('PAYLOADER TRABMORE'));
ok('trabajó-y-se-averió muestra sus 8 h trabajadas', html.includes('8 h'));
ok('trabajó-y-se-averió muestra el motivo de avería (GATO)', /GATO/i.test(html));

console.log(`\n  Activas: ${grpCount('✅ Activas')} · Averiadas/Paradas: ${grpCount('🔴 Averiadas / Paradas')}`);
if (fail) {
  console.log(`\n✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`\n${pass} OK · 0 FALLO(S)\nReporte por empresa: "declaró jornada + 0h" = FINALIZADA (no parada).`);
