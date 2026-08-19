/*
 * RECIBO DE JORNADA DEL INSPECTOR (el PDF que saca desde su teléfono).
 *
 * BUG DEL CLIENTE (19-ago-2026): "el reporte que deben firmar está excelente y refleja
 * que finalizó tanto y tanto, pero en el que sacan los inspectores desde el teléfono la
 * máquina sale parada y no le toma las horas que sí trabajó" — ejemplo real: STEVEEN
 * CAMACHO, jornada de NOCHE del 18-ago-2026, máquina de placa FF02700X070391.
 *
 * NO era el cálculo. Los dos documentos salen de la MISMA agregación
 * (`computeInspectorData`) y con la misma fecha dan EXACTAMENTE lo mismo — eso lo prueba
 * el bloque 2 de este archivo. Lo que fallaba era el DÍA que el teléfono pedía: el botón
 * arrancaba en `caracasBusinessToday()`, que salta al día nuevo a las 7:00am EN PUNTO,
 * que es justo cuando el inspector de NOCHE termina su turno y descarga su reporte. Le
 * salía la noche que TODAVÍA NO EMPIEZA: 0 horas, y las máquinas con parada/avería
 * pendiente de la noche anterior en "🟡 Parada" (el cron las expira más tarde). El jefe
 * no lo sufría porque en su reporte elige la fecha a mano.
 *
 * Este test cuida las dos mitades del arreglo:
 *   1. `ultimaJornadaRoundDate` — el día por defecto correcto para cada turno.
 *   2. PARIDAD del turno NOCHE — jefe y teléfono dicen lo mismo (el test de paridad que
 *      ya existía solo cubría el turno DÍA, por eso esto pudo pasar desapercibido).
 *   3. La prueba del delito — pedir el día SIGUIENTE devuelve "Parada · 0 h", con el
 *      aviso ⚠️ que ahora sale impreso en el PDF.
 *
 *   npm run test:recibo   (o: node scripts/test-recibo-jornada.mjs)
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

// ── Cargador recursivo de .ts con stubs por NOMBRE de módulo (igual que test-reportes-paridad) ──
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

let pass = 0, fail = 0; const failures = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; failures.push(`${name}\n      esperado: ${JSON.stringify(want)}\n      obtenido: ${JSON.stringify(got)}`); }
};

console.log('RECIBO DE JORNADA DEL INSPECTOR — el día correcto y las horas que sí trabajó');

// ══ 1. EL DÍA POR DEFECTO ═══════════════════════════════════════════════════
const { ultimaJornadaRoundDate } = loadTs(path.join(ROOT, 'src/lib/caracasDay.ts'));
const enCaracas = (s) => new Date(`${s}-04:00`);

// NOCHE: la jornada de la noche del 18 arranca el 18 a las 7pm y cierra el 19 a las 7am.
eq('noche · 8:00pm del 18 (turno en curso) → 18',        ultimaJornadaRoundDate('night', enCaracas('2026-08-18T20:00:00')), '2026-08-18');
eq('noche · 2:00am del 19 (cruzó medianoche) → 18',      ultimaJornadaRoundDate('night', enCaracas('2026-08-19T02:00:00')), '2026-08-18');
eq('noche · 6:59am del 19 (por cerrar) → 18',            ultimaJornadaRoundDate('night', enCaracas('2026-08-19T06:59:00')), '2026-08-18');
eq('⭐ noche · 7:05am del 19 (RECIÉN cerró: el bug) → 18', ultimaJornadaRoundDate('night', enCaracas('2026-08-19T07:05:00')), '2026-08-18');
eq('⭐ noche · 2:00pm del 19 (ya descansando) → 18',      ultimaJornadaRoundDate('night', enCaracas('2026-08-19T14:00:00')), '2026-08-18');
eq('noche · 6:59pm del 19 (aún no arranca la nueva) → 18', ultimaJornadaRoundDate('night', enCaracas('2026-08-19T18:59:00')), '2026-08-18');
eq('noche · 7:00pm del 19 (arranca la nueva) → 19',      ultimaJornadaRoundDate('night', enCaracas('2026-08-19T19:00:00')), '2026-08-19');

// DÍA: 7am–7pm del mismo día de calendario (idéntico a `caracasBusinessToday`).
eq('día · 6:00am del 19 (aún no arranca) → 18',          ultimaJornadaRoundDate('day', enCaracas('2026-08-19T06:00:00')), '2026-08-18');
eq('día · 7:00am del 19 (arranca) → 19',                 ultimaJornadaRoundDate('day', enCaracas('2026-08-19T07:00:00')), '2026-08-19');
eq('día · 8:00pm del 19 (ya cerró) → 19',                ultimaJornadaRoundDate('day', enCaracas('2026-08-19T20:00:00')), '2026-08-19');

// ══ 2 y 3. LOS DOS DOCUMENTOS, TURNO NOCHE ══════════════════════════════════
// Escenario calcado del caso real: jornada de NOCHE del 18, con máquinas que trabajaron
// unas horas y LUEGO se pararon/averiaron (una de ellas ya pasada la medianoche).
const NOCHE = '2026-08-18';
const SIGUIENTE = '2026-08-19';
const INSP = 'STEVEEN CAMACHO';
const PLACA = 'FF02700X070391';

const MAQ = [
  { id: 'n1', code: 'CAMION 01', nightH: 5.47, inc: 'parada', hora: `${SIGUIENTE}T00:28:00-04:00` }, // trabajó y LUEGO paró (tras medianoche)
  { id: 'n2', code: 'CAMION 02', nightH: 4,    inc: 'averia', hora: `${NOCHE}T23:00:00-04:00` },     // trabajó y LUEGO se averió
  { id: 'n3', code: 'CAMION 03', nightH: 0,    inc: 'parada', hora: `${NOCHE}T20:00:00-04:00` },     // parada de verdad: 0 h
  { id: 'n4', code: 'CAMION 04', nightH: 12,   inc: null,     hora: null },                          // noche completa
];
const HORAS_NOCHE = 21.47; // 5.47 + 4 + 0 + 12

const maquinaBase = {
  code: '', serial: null, plate: PLACA, sector: 'ESTE', parroquia: null, referencia: '',
  latitude: null, longitude: null, company: { name: 'EMPRESA X' },
};
const roundsNoche = MAQ.map((x) => ({
  machinery_id: x.id, day_hours: 0, night_hours: x.nightH,
  jornada_shift: 'night', jornada_start_at: null, declared_day: false, declared_night: true,
  recorded_by: 'u1', jornada_marked_by: 'u1', machine: { ...maquinaBase, code: x.code },
}));
const paradas = MAQ.filter((x) => x.inc === 'parada').map((x) => ({
  machinery_id: x.id, notes: 'NO TRABAJÓ · sin operador', created_at: x.hora,
  status: 'pendiente', resolved_at: null, material: 'MÁQUINA PARADA',
}));
const averias = MAQ.filter((x) => x.inc === 'averia').map((x) => ({
  machinery_id: x.id, notes: 'FALLA HIDRÁULICA', material: 'FALLA', created_at: x.hora,
  status: 'pendiente', resolved_at: null,
}));

// Las rondas existen SOLO en el día de la noche del 18. Pedir el 19 no devuelve ninguna
// (esa noche todavía no arrancó) — que es exactamente lo que pasaba en el teléfono.
let fechaPedida = NOCHE;
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
    if (table === 'machine_rounds') return callN[table] === 1 && fechaPedida === NOCHE ? roundsNoche : [];
    if (table === 'maintenance_requests') return callN[table] === 1 ? paradas : averias;
    return [];
  },
};
let captured = [];
stubs['pdf'] = {
  pdfDocument: ({ body }) => body,
  exportPdf: async (html) => { captured.push(html); return true; },
  nowStamp: () => '19 AGO 2026, 07:05 A. M.',
};
stubs['supervisorVisits'] = { listVisits: async () => [] };
stubs['machineInspectors'] = {
  listInspectorAssignments: async () => ({ rows: MAQ.map((x) => ({
    machinery_id: x.id, inspector_name: INSP, shift: 'night', code: x.code, serial: null, plate: PLACA,
    tipo: 'MARCA', companyName: 'EMPRESA X', sector: 'ESTE', referencia: '',
    latitude: null, longitude: null, encargado: null,
  })) }),
  inspectorSiempreActivo: () => false,
};

const rep = loadTs(path.join(ROOT, 'src/lib/inspectorReport.ts'));
const generar = async (fecha) => {
  fechaPedida = fecha;
  captured = []; reset();
  await rep.generateInspectorReport({ date: fecha, shift: 'night' });
  const jefe = captured[0] ?? '';
  captured = []; reset();
  await rep.generateMyShiftReceipt({ date: fecha, shift: 'night', inspectorName: INSP });
  return { jefe, tlf: captured[0] ?? '' };
};
const kpiNoche = (html) => {
  const m = html.match(/Total hrs noche<\/div><div class="v">([\d.]+) H/);
  return m ? Number(m[1]) : null;
};

// ── El día CORRECTO: los dos documentos dicen lo mismo ──────────────────────
const bien = await generar(NOCHE);
eq('el reporte del jefe trae las horas de la noche', kpiNoche(bien.jefe), HORAS_NOCHE);
eq('el recibo del teléfono trae las horas de la noche', kpiNoche(bien.tlf), HORAS_NOCHE);
eq('⭐ PARIDAD turno NOCHE · horas', kpiNoche(bien.jefe), kpiNoche(bien.tlf));

// La máquina del caso real: trabajó 5.47 h y LUEGO paró pasada la medianoche.
const filaJefe = bien.jefe.split('<b>CAMION 01</b>')[1]?.split('</tr>')[0] ?? '';
const filaTlf = bien.tlf.split('CAMION 01')[1]?.split('</div>\n    </div>')[0] ?? '';
eq('trabajó-y-paró · el jefe NO la pone 🟡 Parada', /🟡 Parada/.test(filaJefe), false);
eq('trabajó-y-paró · el jefe la pone ✅ Finalizada', /✅ Finalizada/.test(filaJefe), true);
eq('⭐ trabajó-y-paró · el TELÉFONO tampoco la pone 🟡 Parada', /🟡 Parada/.test(filaTlf), false);
eq('⭐ trabajó-y-paró · el TELÉFONO la pone ✅ Finalizada', /✅ Finalizada/.test(filaTlf), true);
eq('⭐ trabajó-y-paró · el TELÉFONO sí cuenta sus horas', /Trabajó 5\.47h/.test(filaTlf), true);
eq('trabajó-y-paró · el teléfono conserva la nota del incidente', /se paró a las/.test(filaTlf), true);
// La que NO trabajó nada sí sigue parada en los dos.
eq('0 h + parada · sigue 🟡 Parada en el jefe', /🟡 Parada/.test(bien.jefe), true);
eq('0 h + parada · sigue 🟡 Parada en el teléfono', /🟡 Parada/.test(bien.tlf), true);
eq('el día correcto NO lleva aviso de día equivocado', /no tiene NINGUNA hora registrada/.test(bien.tlf), false);

// ── La prueba del delito: el día SIGUIENTE (lo que salía a las 7am) ─────────
const mal = await generar(SIGUIENTE);
eq('día equivocado · el teléfono da 0 horas', kpiNoche(mal.tlf), 0);
eq('⭐ día equivocado · así se veía el bug: la máquina sale 🟡 Parada', /🟡 Parada/.test(mal.tlf), true);
eq('⭐ día equivocado · el PDF ahora lo AVISA', /no tiene NINGUNA hora registrada/.test(mal.tlf), true);

console.log(`\n  día correcto (${NOCHE}) → jefe ${kpiNoche(bien.jefe)} h · teléfono ${kpiNoche(bien.tlf)} h ✓ iguales`);
console.log(`  día siguiente (${SIGUIENTE}) → teléfono ${kpiNoche(mal.tlf)} h · con aviso ⚠️ impreso`);

if (fail) {
  console.log(`\n✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`\n${pass} OK · 0 FALLO(S)\nEl inspector descarga la jornada que acaba de cerrar, con las horas que sí trabajó.`);
