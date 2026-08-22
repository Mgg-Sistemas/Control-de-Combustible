/*
 * PARIDAD entre el REPORTE DE INSPECTORES (el que imprime el jefe desde la web)
 * y el RECIBO DE JORNADA (el que imprime el inspector desde su teléfono).
 *
 * Por qué existe: los dos documentos salen de la MISMA agregación
 * (`computeInspectorData`) pero los arma código distinto, y se venían
 * desincronizando en silencio — queja repetida del cliente ("el reporte dice una
 * cosa y el del inspector otra"). El 15-ago-2026 el reporte del jefe no traía
 * NINGUNA cifra de horas paradas (se habían quitado el 10-ago porque entonces
 * salían siempre en 0) mientras el recibo del teléfono sí, así que los números
 * no cuadraban al compararlos.
 *
 * Este test renderiza AMBOS con exactamente los mismos datos y exige que las
 * tres cifras que comparte el cliente coincidan: horas trabajadas, horas
 * paradas y jornada. Si alguien vuelve a tocar uno solo de los dos, falla.
 *
 * No usa framework de test (el repo no tiene): transpila los .ts en memoria y
 * stubbea la capa de red/PDF.
 *
 *   npm run test:reportes   (o: node scripts/test-reportes-paridad.mjs)
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
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

// ── Escenario: un inspector de DÍA con los 4 estados que importan ───────────
const DATE = '2026-08-15';
const INSP = 'CESAR FLAMES';
const at = (h) => `${DATE}T${String(h).padStart(2, '0')}:00:00-04:00`;

const MAQ = [
  { id: 'm1', code: 'JUMBO 320',   dayH: 12,   estado: 'finalizada' }, // jornada completa
  { id: 'm2', code: 'JUMBO 330',   dayH: 8.33, estado: 'parada' },     // trabajó y LUEGO paró
  { id: 'm3', code: 'PAYLOADER',   dayH: 0,    estado: 'parada' },     // parada todo el turno
  { id: 'm4', code: 'MINI SHOWER', dayH: 0,    estado: 'averia' },     // averiada
];
const TRABAJADAS = 20.33; // 12 + 8.33

const rounds = MAQ.map((x) => ({
  machinery_id: x.id, day_hours: x.dayH, night_hours: 0,
  jornada_shift: 'day', jornada_start_at: null, recorded_by: 'u1', jornada_marked_by: 'u1',
  machine: { code: x.code, serial: null, plate: null, sector: 'ESTE', parroquia: null, referencia: '', latitude: null, longitude: null, company: { name: 'EMPRESA X' } },
}));
const paradas = MAQ.filter((x) => x.estado === 'parada').map((x) => ({
  machinery_id: x.id, notes: 'NO TRABAJÓ · sin operador', created_at: at(9), status: 'pendiente', resolved_at: null, material: 'MÁQUINA PARADA',
}));
const averias = MAQ.filter((x) => x.estado === 'averia').map((x) => ({
  machinery_id: x.id, notes: 'FALLA ELÉCTRICA', material: 'FALLA', created_at: at(8), status: 'pendiente', resolved_at: null,
}));

const callN = {};
const reset = () => { for (const k of Object.keys(callN)) delete callN[k]; };
stubs['supabase'] = {
  supabase: { from: (t) => ({ select: async () => ({
    data: t === 'machinery'
      ? MAQ.map((x) => ({ id: x.id, active: true, operational: true, en_espera: false }))
      : [{ id: 'u1', full_name: INSP, role: 'supervisor' }],
  }) }) },
  selectAllRows: async (table) => {
    callN[table] = (callN[table] ?? 0) + 1;
    if (table === 'machine_rounds') return callN[table] === 1 ? rounds : [];
    if (table === 'maintenance_requests') return callN[table] === 1 ? paradas : averias;
    return [];
  },
};
let captured = [];
stubs['pdf'] = {
  pdfDocument: ({ body }) => body,
  exportPdf: async (html) => { captured.push(html); return true; },
  nowStamp: () => '15 AGO 2026, 07:47 P. M.',
};
stubs['supervisorVisits'] = { listVisits: async () => [] };
stubs['machineInspectors'] = {
  listInspectorAssignments: async () => ({ rows: MAQ.map((x) => ({
    machinery_id: x.id, inspector_name: INSP, shift: 'day', code: x.code, serial: null, plate: null,
    tipo: 'MARCA', companyName: 'EMPRESA X', sector: 'ESTE', referencia: '', latitude: null, longitude: null, encargado: null,
  })) }),
  inspectorSiempreActivo: () => false,
};

const rep = loadTs(path.join(ROOT, 'src/lib/inspectorReport.ts'));

captured = []; reset();
await rep.generateInspectorReport({ date: DATE, shift: 'day' });
const jefe = captured[0];

captured = []; reset();
await rep.generateMyShiftReceipt({ date: DATE, shift: 'day', inspectorName: INSP });
const tlf = captured[0];

// ── Aserciones ─────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; failures.push(`${name}\n    esperado: ${JSON.stringify(want)}\n    obtenido: ${JSON.stringify(got)}`); }
};
const kpi = (html, label) => {
  const m = html.match(new RegExp(`${label}</div><div class="v">([\\d.]+) H`));
  return m ? Number(m[1]) : null;
};

const jTrab = kpi(jefe, 'Total hrs día');
const jPar = kpi(jefe, 'Total hrs paradas día');
const jJor = kpi(jefe, 'Total de jornada');
const tTrab = kpi(tlf, 'Total hrs día');
const tPar = kpi(tlf, 'Total hrs paradas día');
const tJor = kpi(tlf, 'Total de jornada');

eq('el reporte del jefe trae horas trabajadas', jTrab, TRABAJADAS);
eq('el recibo del teléfono trae horas trabajadas', tTrab, TRABAJADAS);

// El corazón del test: las cifras deben ser IGUALES en los dos documentos.
eq('PARIDAD · horas trabajadas', jTrab, tTrab);
eq('PARIDAD · jornada', jJor, tJor);

// Una máquina que trabajó y LUEGO paró debe aportar sus horas a los dos.
eq('las horas de una máquina parada cuentan como trabajadas', jTrab >= 8.33, true);

// DECISIÓN DEL CLIENTE (15-ago-2026): NINGUNO de los dos documentos muestra el
// TOTAL agregado de horas paradas. Se pidió quitarlo tras verlo en pantalla (ya
// se había quitado una vez el 10-ago). Este par de aserciones existe para que no
// se reponga por descuido: si vuelve a aparecer la tarjeta, el test falla.
eq('el reporte del jefe NO muestra total de horas paradas', jPar, null);
eq('el recibo del teléfono NO muestra total de horas paradas', tPar, null);

// Pero el dato POR MÁQUINA sí se conserva en los dos.
eq('el jefe conserva la columna Horas parada', /Horas<br>parada/.test(jefe), true);
eq('el teléfono conserva la parada por máquina', /Parada [\d.]+h/.test(tlf), true);

// El pie de sección del reporte del jefe cuadra con su KPI.
const pieTrab = jefe.match(/Total de horas de día: <b>([\d.]+) h<\/b>/);
eq('pie de sección · trabajadas', pieTrab && Number(pieTrab[1]), TRABAJADAS);
eq('el pie de sección NO trae total de paradas', /Paradas: <b>/.test(jefe), false);

console.log(`\n  jefe    → trabajadas ${jTrab} h · jornada ${jJor} h · total paradas: ${jPar === null ? 'no se muestra ✓' : jPar}`);
console.log(`  teléfono→ trabajadas ${tTrab} h · jornada ${tJor} h · total paradas: ${tPar === null ? 'no se muestra ✓' : tPar}`);
console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) {
  console.log('\nFallos:');
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('Los dos reportes dan los MISMOS números.\n');
