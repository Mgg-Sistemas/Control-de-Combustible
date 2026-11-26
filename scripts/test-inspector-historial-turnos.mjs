/**
 * Pruebas de regresión e integración — Historial de asignaciones de inspectores por turno (25-nov-2026).
 *
 * Cubre:
 *  1) Incidente audio 25-Nov 19:37 Caracas (Daniel -> Luis en "Día + Noche"): Día queda en Daniel, Noche en Luis.
 *  2) Incidente audio Domingo -> Lunes (consultado semanas después): Domingo queda en Inspector A.
 *  3) `shouldKeepAssignedAt` (mismo inspector activo vs cambio vs inactivo).
 *  4) Bordes de `inspectorHistorial.ts`:
 *     - Cambio a mitad de turno (sin duplicar máquinas ni horas).
 *     - Desasignación a las 15:00 (cuenta hoy, NO mañana).
 *     - Humano con solapamiento real gana a `MAQUINAS FALTANTES`, pero humano con `0 ms` (19:00:00 exactas) NO gana.
 *     - Borde semiabierto exacto `19:00:00-04:00` (día) y `07:00:00-04:00+1` (noche).
 *     - Turno noche cruzando medianoche (02:00am).
 *     - Empate exacto de duración (6h vs 6h → gana `valid_from` más reciente).
 *     - Tramos invertidos (`valid_to <= valid_from`) o `valid_to` corrupto rechazados.
 *     - `selDay` inválido NO lanza `RangeError` (ni en día ni en noche ni en `buildRangeInspectorMap`).
 *     - Semilla pre-`audit_log` (`2020-01-01`).
 *  5) Integración real con `src/lib/machineInspectors.ts` (stubbeando solo `supabase`):
 *     - `listInspectorAssignments(date)` resuelve el 25-Nov con Daniel en Día y Luis en Noche.
 *     - Paginación >1,000 filas vía `selectAllRows` (sin truncado silencioso).
 *     - Fecha histórica con 0 filas (`missing: false`) NO contamina cayendo a foto actual.
 *  6) Guardas estáticas de paridad y seguridad (bloqueo de `doAssign` en días pasados, `selectAllRows`, etc.).
 */

import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import assert from 'node:assert/strict';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')), '..');

function loadTs(relPath, stubs = {}) {
  const full = path.join(ROOT, relPath);
  const src = fs.readFileSync(full, 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
    fileName: full,
  });
  const mod = new Module(full);
  mod.filename = full;
  mod.paths = Module._nodeModulePaths(path.dirname(full));
  const origReq = mod.require.bind(mod);
  mod.require = (req) => {
    for (const [k, v] of Object.entries(stubs)) {
      if (req === k || req.endsWith('/' + k) || req.endsWith('\\' + k)) return v;
    }
    if (req.startsWith('.')) {
      const base = path.resolve(path.dirname(full), req);
      if (fs.existsSync(base + '.ts')) return loadTs(path.relative(ROOT, base + '.ts'), stubs);
      if (fs.existsSync(base + '.tsx')) return loadTs(path.relative(ROOT, base + '.tsx'), stubs);
    }
    return origReq(req);
  };
  mod._compile(outputText, full);
  return mod.exports;
}

const PLACEHOLDER_ID = '3b996dc0-b2a7-42d7-9fa0-4b96b8af4f7b';
const miStub = {
  PLACEHOLDER_INSPECTOR_ID: PLACEHOLDER_ID,
  sinInspectorReal: (name) => !name || /faltant/i.test(name),
  inspectorSiempreActivo: () => false,
};

const hist = loadTs('src/lib/inspectorHistorial.ts', { machineInspectors: miStub });
const daySets = loadTs('src/lib/inspectorDaySets.ts', { machineInspectors: miStub });

let passed = 0;
const asyncTests = [];
function test(name, fn) {
  const r = fn();
  if (r && typeof r.then === 'function') {
    asyncTests.push(
      r.then(
        () => { passed++; console.log(`  ✅ ${name}`); },
        (e) => { console.error(`  ❌ ${name}`); console.error(e); process.exitCode = 1; },
      ),
    );
  } else {
    passed++;
    console.log(`  ✅ ${name}`);
  }
}

console.log('🧪 test-inspector-historial-turnos.mjs');

// ── CASO 1: Incidente real 25-Nov 19:37 Caracas (Daniel -> Luis en Día + Noche) ──
test('Caso 1 (audio 25-Nov 19:37): Día queda en Daniel Pérez y Noche pasa a Luis', () => {
  const spans = [
    { machinery_id: 'm1', inspector_id: 'daniel-id', inspector_name: 'Daniel Pérez', shift: 'day', valid_from: '2026-11-16T11:01:00-04:00', valid_to: '2026-11-25T19:37:00-04:00' },
    { machinery_id: 'm1', inspector_id: 'daniel-id', inspector_name: 'Daniel Pérez', shift: 'night', valid_from: '2026-11-16T11:01:00-04:00', valid_to: '2026-11-25T19:37:00-04:00' },
    { machinery_id: 'm1', inspector_id: 'luis-id', inspector_name: 'luis alexander ferrer reyes', shift: 'day', valid_from: '2026-11-25T19:37:00-04:00', valid_to: null },
    { machinery_id: 'm1', inspector_id: 'luis-id', inspector_name: 'luis alexander ferrer reyes', shift: 'night', valid_from: '2026-11-25T19:37:00-04:00', valid_to: null },
  ];

  assert.equal(
    daySets.assignmentCountsForShift({ shift: 'day', assigned_at: '2026-11-25T19:37:00-04:00' }, '2026-11-25', 'day'),
    false,
    'El estado actual de las 19:37 es descartado para el turno día (causa raíz del bug)',
  );

  const resolved = hist.resolveAssignmentsForDate(spans, '2026-11-25');
  const dayRow = resolved.find((r) => r.machinery_id === 'm1' && r.shift === 'day');
  const nightRow = resolved.find((r) => r.machinery_id === 'm1' && r.shift === 'night');
  assert.ok(dayRow, 'El turno DÍA NO debe desaparecer');
  assert.equal(dayRow.inspector_name, 'Daniel Pérez');
  assert.equal(daySets.assignmentCountsForShift({ shift: 'day', assigned_at: dayRow.valid_from }, '2026-11-25', 'day'), true);
  assert.ok(nightRow, 'El turno NOCHE debe existir');
  assert.equal(nightRow.inspector_name, 'luis alexander ferrer reyes');
});

// ── CASO 2: Audio Domingo -> Lunes ──────────────────────────────────────────────
test('Caso 2 (audio domingo → lunes): consultar domingo 22-Nov conserva al inspector del domingo', () => {
  const spans = [
    { machinery_id: 'm2', inspector_id: 'insp-a', inspector_name: 'INSPECTOR DOMINGO', shift: 'day', valid_from: '2026-11-01T07:00:00-04:00', valid_to: '2026-11-23T08:00:00-04:00' },
    { machinery_id: 'm2', inspector_id: 'insp-b', inspector_name: 'INSPECTOR LUNES', shift: 'day', valid_from: '2026-11-23T08:00:00-04:00', valid_to: null },
  ];

  const dom = hist.resolveAssignmentsForDate(spans, '2026-11-22');
  assert.equal(dom.length, 1);
  assert.equal(dom[0].inspector_name, 'INSPECTOR DOMINGO');

  const lun = hist.resolveAssignmentsForDate(spans, '2026-11-23');
  assert.equal(lun.length, 1);
  assert.equal(lun[0].inspector_name, 'INSPECTOR LUNES');

  const map = hist.buildRangeInspectorMap(spans, ['2026-11-22', '2026-11-23', '2026-11-22']);
  assert.equal(map.get('m2|2026-11-22|day'), 'INSPECTOR DOMINGO');
  assert.equal(map.get('m2|2026-11-23|day'), 'INSPECTOR LUNES');
});

// ── CASO 3: Re-guardar mismo inspector ──────────────────────────────────────────
test('Caso 3: shouldKeepAssignedAt protege assigned_at al re-guardar el mismo inspector activo', () => {
  assert.equal(hist.shouldKeepAssignedAt({ inspector_id: 'daniel-id', active: true }, 'daniel-id'), true);
  assert.equal(hist.shouldKeepAssignedAt({ inspector_id: 'daniel-id', active: true }, 'luis-id'), false);
  assert.equal(hist.shouldKeepAssignedAt({ inspector_id: 'daniel-id', active: false }, 'daniel-id'), false);
  assert.equal(hist.shouldKeepAssignedAt(null, 'daniel-id'), false);
});

// ── CASO 4: Bordes críticos (auditados por los 8 agentes) ───────────────────────
test('Caso 4a: Reasignación a mitad de turno devuelve 1 sola fila (sin duplicar totales) por mayor cobertura', () => {
  const spans = [
    { machinery_id: 'm3', inspector_id: 'a', inspector_name: 'Inspector Mañana', shift: 'day', valid_from: '2026-11-25T07:00:00-04:00', valid_to: '2026-11-25T11:00:00-04:00' },
    { machinery_id: 'm3', inspector_id: 'b', inspector_name: 'Inspector Tarde', shift: 'day', valid_from: '2026-11-25T11:00:00-04:00', valid_to: null },
  ];
  const res = hist.resolveAssignmentsForShift({ spans, selDay: '2026-11-25', shift: 'day' });
  assert.equal(res.length, 1);
  assert.equal(res[0].inspector_name, 'Inspector Tarde');
});

test('Caso 4b: Desasignación a las 15:00 cuenta ese día, pero NO al día siguiente', () => {
  const spans = [
    { machinery_id: 'm4', inspector_id: 'a', inspector_name: 'Daniel Pérez', shift: 'day', valid_from: '2026-11-20T07:00:00-04:00', valid_to: '2026-11-25T15:00:00-04:00' },
  ];
  assert.equal(hist.resolveAssignmentsForShift({ spans, selDay: '2026-11-25', shift: 'day' }).length, 1);
  assert.equal(hist.resolveAssignmentsForShift({ spans, selDay: '2026-11-26', shift: 'day' }).length, 0);
});

test('Caso 4c: Humano con solapamiento real gana a MAQUINAS FALTANTES, pero humano en 19:00:00 exactas (0 ms) NO gana', () => {
  const spansReal = [
    { machinery_id: 'm5', inspector_id: 'daniel-id', inspector_name: 'Daniel Pérez', shift: 'day', valid_from: '2026-11-25T07:00:00-04:00', valid_to: '2026-11-25T18:50:00-04:00' },
    { machinery_id: 'm5', inspector_id: PLACEHOLDER_ID, inspector_name: 'MAQUINAS FALTANTES', shift: 'day', valid_from: '2026-11-25T18:50:00-04:00', valid_to: null },
  ];
  const resReal = hist.resolveAssignmentsForShift({ spans: spansReal, selDay: '2026-11-25', shift: 'day' });
  assert.equal(resReal.length, 1);
  assert.equal(resReal[0].inspector_name, 'Daniel Pérez');

  // Borde exacto 19:00:00-04:00 (0 ms de solape en turno día): NO debe desplazar a MAQUINAS FALTANTES
  const spansZero = [
    { machinery_id: 'm5b', inspector_id: PLACEHOLDER_ID, inspector_name: 'MAQUINAS FALTANTES', shift: 'day', valid_from: '2026-11-25T07:00:00-04:00', valid_to: '2026-11-25T19:00:00-04:00' },
    { machinery_id: 'm5b', inspector_id: 'humano-id', inspector_name: 'Humano Tardío', shift: 'day', valid_from: '2026-11-25T19:00:00-04:00', valid_to: null },
  ];
  const resZero = hist.resolveAssignmentsForShift({ spans: spansZero, selDay: '2026-11-25', shift: 'day' });
  assert.equal(resZero.length, 1);
  assert.equal(resZero[0].inspector_name, 'MAQUINAS FALTANTES', 'Un humano con 0 ms de solape (19:00:00) no puede apropiarse del turno día');
});

test('Caso 4d: Turno NOCHE cruzando medianoche (02:00am), borde 07:00:00+1 y empate exacto 6h vs 6h', () => {
  const spans = [
    // Asignado a las 2am del 26-nov -> pertenece a la NOCHE del 25-nov
    { machinery_id: 'mn1', inspector_id: 'n1', inspector_name: 'Inspector Madrugada', shift: 'night', valid_from: '2026-11-26T02:00:00-04:00', valid_to: '2026-11-26T07:00:00-04:00' },
    // Asignado a las 07:00:00 exactas del 26-nov -> 0 ms en noche del 25-nov, descartado
    { machinery_id: 'mn2', inspector_id: 'n2', inspector_name: 'Inspector 7am', shift: 'night', valid_from: '2026-11-26T07:00:00-04:00', valid_to: null },
    // Empate exacto 6h vs 6h en día -> gana valid_from más reciente
    { machinery_id: 'mtie', inspector_id: 't1', inspector_name: 'Primero 6h', shift: 'day', valid_from: '2026-11-25T07:00:00-04:00', valid_to: '2026-11-25T13:00:00-04:00' },
    { machinery_id: 'mtie', inspector_id: 't2', inspector_name: 'Segundo 6h', shift: 'day', valid_from: '2026-11-25T13:00:00-04:00', valid_to: '2026-11-25T19:00:00-04:00' },
  ];
  const night = hist.resolveAssignmentsForShift({ spans, selDay: '2026-11-25', shift: 'night' });
  assert.equal(night.length, 1);
  assert.equal(night[0].machinery_id, 'mn1');
  assert.equal(night[0].inspector_name, 'Inspector Madrugada');

  const tie = hist.resolveAssignmentsForShift({ spans, selDay: '2026-11-25', shift: 'day' });
  assert.equal(tie.length, 1);
  assert.equal(tie[0].inspector_name, 'Segundo 6h');
});

test('Caso 4e: Tramos invertidos/corruptos y selDay inválido NO crashean ni contaminan', () => {
  const spans = [
    { machinery_id: 'mbad1', inspector_id: 'x', inspector_name: 'Invertido', shift: 'day', valid_from: '2026-11-25T15:00:00-04:00', valid_to: '2026-11-25T10:00:00-04:00' },
    { machinery_id: 'mbad2', inspector_id: 'y', inspector_name: 'Corrupto', shift: 'day', valid_from: '2026-11-25T08:00:00-04:00', valid_to: 'not-a-date' },
    { machinery_id: 'mok', inspector_id: 'ok', inspector_name: 'Semilla Antigua', shift: 'day', valid_from: '2020-01-01T00:00:00Z', valid_to: '2026-08-11T10:00:00-04:00' },
  ];
  assert.equal(hist.resolveAssignmentsForShift({ spans, selDay: '2026-11-25', shift: 'day' }).length, 0);
  assert.equal(hist.resolveAssignmentsForShift({ spans, selDay: '2026-07-15', shift: 'day' })[0].inspector_name, 'Semilla Antigua');
  // selDay inválido no debe lanzar RangeError ni en day ni en night ni en buildRangeInspectorMap
  assert.deepEqual(hist.resolveAssignmentsForDate(spans, 'invalido'), []);
  assert.equal(hist.buildRangeInspectorMap(spans, ['', '   ', 'invalido', '2026-07-15']).get('mok|2026-07-15|day'), 'Semilla Antigua');
});

// ── CASO 5: Integración real con src/lib/machineInspectors.ts (paginación >1000 y sin fallback falso) ──
test('Caso 5 (integración machineInspectors.ts): paginación >1,000 filas y fecha vacía NO cae a foto actual', async () => {
  const bigSpans = Array.from({ length: 1250 }, (_, i) => ({
    id: `span-${i}`,
    machinery_id: `mach-${i}`,
    inspector_id: 'daniel-id',
    inspector_name: 'Daniel Pérez',
    shift: i % 2 === 0 ? 'day' : 'night',
    valid_from: '2026-11-01T07:00:00-04:00',
    valid_to: null,
    machine: { code: `M-${i}`, serial: null, plate: `P-${i}`, tipo: null, sector: null, referencia: null, encargado: null, latitude: null, longitude: null, active: true, operational: true, en_espera: false, company: { name: 'SOS' } },
  }));

  let liveQueried = false;
  let currentRows = bigSpans;

  const supabaseStub = {
    selectAllRows: async (table) => {
      if (table === 'machine_inspector_history') return currentRows;
      return [];
    },
    supabase: {
      from: (table) => {
        if (table === 'machine_inspectors') {
          liveQueried = true;
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [{ id: 'live-1', machinery_id: 'm-live', inspector_id: 'live-id', inspector_name: 'FOTO HOY', shift: 'day', assigned_at: '2026-11-25T20:00:00-04:00', machine: { code: 'LIVE' } }],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'profiles') {
          return {
            select: () => ({
              in: async () => ({ data: [{ id: 'daniel-id', full_name: 'Daniel Pérez' }], error: null }),
            }),
          };
        }
        return { select: async () => ({ data: [], error: null }) };
      },
    },
  };

  const miReal = loadTs('src/lib/machineInspectors.ts', { supabase: supabaseStub });

  // 1) >1,000 filas: selectAllRows trae las 1,250 sin truncar
  const rangeRes = await miReal.listInspectorAssignmentsForRange('2026-11-01', '2026-11-25');
  assert.equal(rangeRes.spans.length, 1250, 'listInspectorAssignmentsForRange no debe truncar en 1,000 filas');

  const dateRes = await miReal.listInspectorAssignments('2026-11-25');
  assert.equal(dateRes.rows.length, 1250, 'listInspectorAssignments(date) no debe truncar en 1,000 filas');
  assert.equal(liveQueried, false, 'No debe tocar machine_inspectors cuando machine_inspector_history responde');

  // 2) Fecha histórica sin filas (tabla SÍ existe): NO debe caer a foto viva de hoy
  currentRows = [];
  const emptyRes = await miReal.listInspectorAssignments('2026-01-01');
  assert.equal(emptyRes.rows.length, 0, 'Una fecha pasada sin tramos debe devolver [] y NO contaminarse con foto de hoy');
  assert.equal(liveQueried, false, 'NO debe consultar machine_inspectors si la tabla historial existe pero tiene 0 filas');
});

// ── CASO 6: Guardas estáticas de paridad y seguridad ────────────────────────────
test('Caso 6: Todas las superficies históricas, bloqueo en días pasados y selectAllRows en su sitio', () => {
  const checks = [
    ['src/lib/machineInspectors.ts', /selectAllRows\(\s*'machine_inspector_history'/, 'machineInspectors usa selectAllRows paginado'],
    ['src/lib/inspectorReport.ts', /listInspectorAssignments\(date\)/, 'inspectorReport usa historial por fecha'],
    ['src/lib/inspectorSummaryReport.ts', /listInspectorAssignments\(date\)/, 'inspectorSummaryReport usa historial por fecha'],
    ['src/lib/porEmpresaReport.ts', /listInspectorAssignments\(date\)/, 'porEmpresaReport usa historial por fecha'],
    ['src/lib/porEmpresaReport.ts', /assignmentCountsForShift\(/, 'porEmpresaReport valida assignmentCountsForShift'],
    ['src/lib/inspectorTrazaReport.ts', /listInspectorAssignments\(date\)/, 'inspectorTrazaReport usa historial por fecha'],
    ['src/lib/supervisorVisits.ts', /latestInspectorByMachine\(date\?: string\)/, 'latestInspectorByMachine soporta date histórico'],
    ['src/screens/ReportsScreen.tsx', /latestInspectorByMachine\(date\)/, 'ReportsScreen.generateInspeccion pasa date'],
    ['src/screens/redesign/InspectionsSummary.tsx', /listInspectorAssignments\(selDay\)/, 'InspectionsSummary usa historial por selDay'],
    ['src/screens/redesign/InspectionsSummary.tsx', /selDay !== caracasBusinessToday\(\)/, 'InspectionsSummary bloquea doAssign en días pasados'],
    ['src/screens/redesign/InspectionsSummary.tsx', /loadReqRef/, 'InspectionsSummary descarta respuestas obsoletas al cambiar de día'],
    ['src/screens/HistoricoJornadasScreen.tsx', /listInspectorAssignmentsForRange\(from,\s*to\)/, 'HistoricoJornadas usa rango paginado'],
    ['src/lib/backup.ts', /machine_inspector_history/, 'backup incluye machine_inspector_history'],
  ];
  for (const [rel, re, msg] of checks) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, re, `Falta: ${msg} (${rel})`);
  }
});

Promise.all(asyncTests).then(() => {
  if (process.exitCode) {
    console.error(`\n❌ Fallaron pruebas (${passed} pasaron).`);
  } else {
    console.log(`\n🎉 Todas las pruebas pasaron (${passed}/${passed}).`);
  }
});
