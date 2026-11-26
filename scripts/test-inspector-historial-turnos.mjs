/**
 * Pruebas de regresión — Historial de asignaciones de inspectores por turno (25-nov-2026).
 *
 * Reproduce los dos incidentes reales reportados por el usuario en audio:
 *  1) Reasignación a las 19:37 Caracas (inicio de noche) con "Día + Noche":
 *     el turno DÍA (07:00–19:00) NO debe desaparecer ni moverse al inspector nuevo;
 *     debe seguir bajo Daniel Pérez con sus horas intactas, y el turno NOCHE bajo Luis.
 *  2) Reasignación el lunes tras el domingo:
 *     al consultar el domingo días o semanas después, las máquinas y horas siguen bajo
 *     el inspector del domingo (ni desaparecen ni migran al inspector del lunes).
 *  3) Re-guardar el mismo inspector ya activo conserva `assigned_at`.
 *  4) Bordes: cambio a mitad de turno (sin duplicar), desasignación, prioridad humano
 *     sobre `MAQUINAS FALTANTES`, semilla pre-audit_log (`2020-01-01`).
 *  5) Guardas estáticas de paridad en las 6 superficies históricas.
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
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    console.error(`  ❌ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

console.log('🧪 test-inspector-historial-turnos.mjs');

// ── CASO 1: Incidente real 25-Nov 19:37 Caracas (Daniel -> Luis en Día + Noche) ──
test('Caso 1 (audio 25-Nov 19:37): Día queda en Daniel Pérez y Noche pasa a Luis', () => {
  const spans = [
    // Daniel tuvo M1 en Día y Noche desde el 16-nov hasta el 25-nov 19:37 Caracas
    { machinery_id: 'm1', inspector_id: 'daniel-id', inspector_name: 'Daniel Pérez', shift: 'day', valid_from: '2026-11-16T11:01:00-04:00', valid_to: '2026-11-25T19:37:00-04:00' },
    { machinery_id: 'm1', inspector_id: 'daniel-id', inspector_name: 'Daniel Pérez', shift: 'night', valid_from: '2026-11-16T11:01:00-04:00', valid_to: '2026-11-25T19:37:00-04:00' },
    // A las 19:37 reasignaron con "Ambos" (day + night) a Luis
    { machinery_id: 'm1', inspector_id: 'luis-id', inspector_name: 'luis alexander ferrer reyes', shift: 'day', valid_from: '2026-11-25T19:37:00-04:00', valid_to: null },
    { machinery_id: 'm1', inspector_id: 'luis-id', inspector_name: 'luis alexander ferrer reyes', shift: 'night', valid_from: '2026-11-25T19:37:00-04:00', valid_to: null },
  ];

  // Demostrar por qué el estado vivo fallaba: assigned_at = 19:37 > 19:00 → descartado
  assert.equal(
    daySets.assignmentCountsForShift({ shift: 'day', assigned_at: '2026-11-25T19:37:00-04:00' }, '2026-11-25', 'day'),
    false,
    'El estado actual de las 19:37 es descartado para el turno día (causa raíz del bug)',
  );

  // Con el historial por turno:
  const resolved = hist.resolveAssignmentsForDate(spans, '2026-11-25');
  const dayRow = resolved.find((r) => r.machinery_id === 'm1' && r.shift === 'day');
  const nightRow = resolved.find((r) => r.machinery_id === 'm1' && r.shift === 'night');
  assert.ok(dayRow, 'El turno DÍA NO debe desaparecer');
  assert.equal(dayRow.inspector_name, 'Daniel Pérez', 'El turno DÍA del 25-Nov debe seguir siendo de Daniel Pérez');
  assert.equal(
    daySets.assignmentCountsForShift({ shift: 'day', assigned_at: dayRow.valid_from }, '2026-11-25', 'day'),
    true,
    'La asignación histórica de Daniel pasa assignmentCountsForShift',
  );
  assert.ok(nightRow, 'El turno NOCHE debe existir');
  assert.equal(nightRow.inspector_name, 'luis alexander ferrer reyes', 'El turno NOCHE del 25-Nov debe ser de Luis');
});

// ── CASO 2: Audio Domingo -> Lunes (consultado semanas después) ──────────────────
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

  // Rango multi-día (HistoricoJornadasScreen) en 1 sola pasada en memoria
  const map = hist.buildRangeInspectorMap(spans, ['2026-11-22', '2026-11-23']);
  assert.equal(map.get('m2|2026-11-22|day'), 'INSPECTOR DOMINGO');
  assert.equal(map.get('m2|2026-11-23|day'), 'INSPECTOR LUNES');
});

// ── CASO 3: Re-guardar mismo inspector conserva assigned_at ──────────────────────
test('Caso 3: shouldKeepAssignedAt protege assigned_at al re-guardar el mismo inspector activo', () => {
  assert.equal(hist.shouldKeepAssignedAt({ inspector_id: 'daniel-id', active: true }, 'daniel-id'), true);
  assert.equal(hist.shouldKeepAssignedAt({ inspector_id: 'daniel-id', active: true }, 'luis-id'), false);
  assert.equal(hist.shouldKeepAssignedAt({ inspector_id: 'daniel-id', active: false }, 'daniel-id'), false);
  assert.equal(hist.shouldKeepAssignedAt(null, 'daniel-id'), false);
});

// ── CASO 4: Bordes críticos ──────────────────────────────────────────────────────
test('Caso 4a: Reasignación a mitad de turno devuelve 1 sola fila (sin duplicar totales) por mayor cobertura', () => {
  const spans = [
    { machinery_id: 'm3', inspector_id: 'a', inspector_name: 'Inspector Mañana', shift: 'day', valid_from: '2026-11-25T07:00:00-04:00', valid_to: '2026-11-25T11:00:00-04:00' }, // 4h
    { machinery_id: 'm3', inspector_id: 'b', inspector_name: 'Inspector Tarde', shift: 'day', valid_from: '2026-11-25T11:00:00-04:00', valid_to: null }, // 8h
  ];
  const res = hist.resolveAssignmentsForShift({ spans, selDay: '2026-11-25', shift: 'day' });
  assert.equal(res.length, 1, 'Nunca debe devolver 2 filas para la misma máquina y turno');
  assert.equal(res[0].inspector_name, 'Inspector Tarde');
});

test('Caso 4b: Desasignación a las 15:00 cuenta ese día, pero NO al día siguiente', () => {
  const spans = [
    { machinery_id: 'm4', inspector_id: 'a', inspector_name: 'Daniel Pérez', shift: 'day', valid_from: '2026-11-20T07:00:00-04:00', valid_to: '2026-11-25T15:00:00-04:00' },
  ];
  assert.equal(hist.resolveAssignmentsForShift({ spans, selDay: '2026-11-25', shift: 'day' }).length, 1);
  assert.equal(hist.resolveAssignmentsForShift({ spans, selDay: '2026-11-26', shift: 'day' }).length, 0);
});

test('Caso 4c: Humano gana sobre placeholder MAQUINAS FALTANTES asignado al cierre', () => {
  const spans = [
    { machinery_id: 'm5', inspector_id: 'daniel-id', inspector_name: 'Daniel Pérez', shift: 'day', valid_from: '2026-11-25T07:00:00-04:00', valid_to: '2026-11-25T18:50:00-04:00' },
    { machinery_id: 'm5', inspector_id: PLACEHOLDER_ID, inspector_name: 'MAQUINAS FALTANTES', shift: 'day', valid_from: '2026-11-25T18:50:00-04:00', valid_to: null },
  ];
  const res = hist.resolveAssignmentsForShift({ spans, selDay: '2026-11-25', shift: 'day' });
  assert.equal(res.length, 1);
  assert.equal(res[0].inspector_name, 'Daniel Pérez');

  // Si solo estuvo el placeholder y excludePlaceholder=true, no entra
  const onlyPh = [{ machinery_id: 'm6', inspector_id: PLACEHOLDER_ID, inspector_name: 'MAQUINAS FALTANTES', shift: 'day', valid_from: '2026-11-25T07:00:00-04:00', valid_to: null }];
  assert.equal(hist.resolveAssignmentsForShift({ spans: onlyPh, selDay: '2026-11-25', shift: 'day', excludePlaceholder: true }).length, 0);
});

test('Caso 4d: Semilla pre-audit_log (2020-01-01) resuelve fechas anteriores al 11-ago-2026', () => {
  const spans = [
    { machinery_id: 'm7', inspector_id: 'old-id', inspector_name: 'Inspector Histórico', shift: 'day', valid_from: '2020-01-01T00:00:00Z', valid_to: '2026-08-11T10:00:00-04:00' },
  ];
  const res = hist.resolveAssignmentsForDate(spans, '2026-07-15');
  assert.equal(res.length, 1);
  assert.equal(res[0].inspector_name, 'Inspector Histórico');
  assert.equal(daySets.assignmentCountsForShift({ shift: 'day', assigned_at: res[0].valid_from }, '2026-07-15', 'day'), true);
});

test('Caso 4e: Asignación nueva después de las 19:00 (sin inspector previo) NO entra al turno día ya cerrado', () => {
  const spans = [
    { machinery_id: 'm8', inspector_id: 'luis-id', inspector_name: 'Luis', shift: 'day', valid_from: '2026-11-25T19:30:00-04:00', valid_to: null },
  ];
  const res = hist.resolveAssignmentsForShift({ spans, selDay: '2026-11-25', shift: 'day' });
  assert.equal(res.length, 0);
});

// ── CASO 5: Guardas estáticas de paridad en todas las superficies históricas ─────
test('Caso 5: Todas las superficies históricas pasan fecha/rango al resolver asignaciones', () => {
  const checks = [
    ['src/lib/machineInspectors.ts', /shouldKeepAssignedAt\(/, 'assignInspector preserva assigned_at'],
    ['src/lib/machineInspectors.ts', /listInspectorAssignmentsForDate\(/, 'listInspectorAssignments delega por fecha'],
    ['src/lib/inspectorReport.ts', /listInspectorAssignments\(date\)/, 'inspectorReport usa historial por fecha'],
    ['src/lib/inspectorSummaryReport.ts', /listInspectorAssignments\(date\)/, 'inspectorSummaryReport usa historial por fecha'],
    ['src/lib/porEmpresaReport.ts', /listInspectorAssignments\(date\)/, 'porEmpresaReport usa historial por fecha'],
    ['src/lib/inspectorTrazaReport.ts', /listInspectorAssignments\(date\)/, 'inspectorTrazaReport usa historial por fecha'],
    ['src/screens/redesign/InspectionsSummary.tsx', /listInspectorAssignments\(selDay\)/, 'InspectionsSummary usa historial por selDay'],
    ['src/screens/HistoricoJornadasScreen.tsx', /listInspectorAssignmentsForRange\(from,\s*to\)/, 'HistoricoJornadas usa rango sin N+1'],
    ['src/lib/backup.ts', /machine_inspector_history/, 'backup incluye machine_inspector_history'],
  ];
  for (const [rel, re, msg] of checks) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, re, `Falta: ${msg} (${rel})`);
  }
});

if (process.exitCode) {
  console.error(`\n❌ Fallaron pruebas (${passed} pasaron).`);
} else {
  console.log(`\n🎉 Todas las pruebas pasaron (${passed}/${passed}).`);
}
