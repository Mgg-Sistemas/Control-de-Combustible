/*
 * Test del REPORTE POR INSPECTOR (14-sep-2026).
 *
 * Pedido del cliente: «ese reporte no me refleja la realidad» y que tenga las
 * opciones de columnas (placa, modelo, empresa…) como el Conteo de equipos.
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · cuenta las máquinas ASIGNADAS, no solo las que tuvieron check-in — si no,
 *     un inspector sin escanear desaparece del reporte con 72 jornadas encima
 *   · el estado y las exclusiones son los de las TARJETAS de Inspecciones
 *   · las horas son las del TURNO y cuadran con el reporte con firma
 *   · el check-in es una columna, y dice quién revisó si fue otro inspector
 *   · las pastillas ocultan COLUMNAS, nunca máquinas
 *
 * Sin framework (el repo no tiene): transpila los .ts en memoria y stubbea la red.
 *
 *   node scripts/test-reporte-inspector.mjs
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

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; failures.push(`✗ ${name}\n    obtenido: ${JSON.stringify(got)}\n    esperado: ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── 1) LA LIBRERÍA PURA ─────────────────────────────────────────────────────
const col = loadTs(path.join(ROOT, 'src/lib/inspectorTrazaColumnas.ts'));
const D = col.OPCIONES_INSPECTOR_POR_DEFECTO;
ok('la librería de columnas no importa nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/inspectorTrazaColumnas.ts'))));

eq('columnas por defecto, en orden', col.columnasInspector(D),
  ['n', 'maquina', 'marcaModelo', 'placa', 'empresa', 'sector', 'estado', 'revision', 'horas', 'inicio', 'nota']);
const todoOculto = Object.fromEntries(Object.keys(D).map((k) => [k, true]));
eq('con todo oculto quedan las que no se pueden quitar', col.columnasInspector(todoOculto), ['n', 'maquina', 'estado', 'horas']);
const todoVisible = Object.fromEntries(Object.keys(D).map((k) => [k, false]));
eq('con todo visible salen clasificación, encargado y edificio', col.columnasInspector(todoVisible),
  ['n', 'maquina', 'marcaModelo', 'placa', 'empresa', 'clasificacion', 'encargado', 'sector', 'edificio', 'estado', 'revision', 'horas', 'inicio', 'nota']);
eq('hay una pastilla por cada opción', col.PASTILLAS_INSPECTOR.map((p) => p.key).sort(), Object.keys(D).sort());
eq('alternar enciende una sola', col.alternarColumna(D, 'sinPlaca').sinPlaca, true);
ok('...y no toca el original', D.sinPlaca === false);

eq('título con marca y modelo', col.tituloMarcaModeloInspector(D), 'Marca / Modelo');
eq('título sin marca', col.tituloMarcaModeloInspector({ ...D, sinMarca: true }), 'Modelo');
eq('sin marca ni modelo la columna no va', col.tituloMarcaModeloInspector({ ...D, sinMarca: true, sinModelo: true }), null);
eq('marca y modelo juntos', col.marcaModeloInspector({ marca: 'CAT', modelo: '320' }, D), 'CAT 320');
eq('solo el modelo si la marca está oculta', col.marcaModeloInspector({ marca: 'CAT', modelo: '320' }, { ...D, sinMarca: true }), '320');
eq('máquina vieja: cae al tipo combinado', col.marcaModeloInspector({ tipo: 'CAT 320 VIEJO' }, D), 'CAT 320 VIEJO');
eq('...pero no si media columna está oculta', col.marcaModeloInspector({ tipo: 'CAT 320 VIEJO' }, { ...D, sinModelo: true }), '—');

eq('palabras: lo que se oculta por defecto', col.ocultosInspectorEnPalabras(D), 'Se oculta: clasificación · encargado · edificio.');
eq('palabras: todo visible', col.ocultosInspectorEnPalabras(todoVisible), 'Salen todas las columnas.');
eq('el archivo por defecto no lleva sufijo', col.sufijoArchivoInspector(D), '');
ok('el archivo con la placa oculta lo dice', /sin placa/.test(col.sufijoArchivoInspector({ ...D, sinPlaca: true })));

// ⭐ Estado como la tarjeta: avería y parada ganan aunque la jornada siga abierta.
eq('trabajó y se averió con la jornada abierta: averiada, como la tarjeta',
  col.estadoComoTarjeta({ estado: 'encurso', incidenteAveria: { tipo: 'averia' } }), 'averia');
eq('en curso sin incidente sigue en curso', col.estadoComoTarjeta({ estado: 'encurso', incidenteAveria: null }), 'encurso');
eq('finalizada es cerrada', col.estadoComoTarjeta({ estado: 'finalizada' }), 'cerrada');
eq('pendiente sigue pendiente', col.estadoComoTarjeta({ estado: 'pendiente' }), 'pendiente');

ok('asignada después del turno: fuera', !col.entraEnLasTarjetas({ estado: 'averia', asignacionCuenta: false, horasOtroTurno: 0 }));
ok('pendiente pero trabajando en el otro turno: fuera', !col.entraEnLasTarjetas({ estado: 'pendiente', asignacionCuenta: true, horasOtroTurno: 3 }));
ok('parada con horas en el otro turno: se queda', col.entraEnLasTarjetas({ estado: 'parada', asignacionCuenta: true, horasOtroTurno: 3 }));
ok('pendiente sin nada en el otro turno: se queda', col.entraEnLasTarjetas({ estado: 'pendiente', asignacionCuenta: true, horasOtroTurno: 0 }));

const orden = col.ordenFilasInspector([
  { estadoTarjeta: 'pendiente', code: 'A', placa: '1' },
  { estadoTarjeta: 'encurso', code: 'B', placa: '2' },
  { estadoTarjeta: 'averia', code: 'C', placa: '3' },
  { estadoTarjeta: 'encurso', code: 'B', placa: '1' },
]);
eq('orden: lo que necesita atención arriba, luego código y placa', orden.map((f) => f.code + f.placa), ['C3', 'B1', 'B2', 'A1']);
eq('resumen por estado', col.resumenEstadosInspector([
  { estadoTarjeta: 'encurso', horas: 5.5 }, { estadoTarjeta: 'cerrada', horas: 12 }, { estadoTarjeta: 'pendiente', horas: 0 },
  { estadoTarjeta: 'parada', horas: 1.25 }, { estadoTarjeta: 'averia', horas: 0 },
]), { asignadas: 5, encurso: 1, cerradas: 1, pendientes: 1, paradas: 1, averiadas: 1, horas: 18.75 });

const hora = (iso) => iso.slice(11, 16);
eq('sin check-in lo dice', col.revisionInspectorTexto([], 'ANA', hora), 'Sin check-in');
eq('check-in del mismo inspector: solo la hora', col.revisionInspectorTexto([{ nombre: 'ana', at: '2026-09-14T08:10' }], 'ANA', hora), '08:10');
eq('check-in de otro inspector: dice quién', col.revisionInspectorTexto([{ nombre: 'inspector dos', at: '2026-09-14T10:43' }], 'ANA', hora), '10:43 · inspector dos');
eq('varias revisiones: la primera y cuántas más', col.revisionInspectorTexto([
  { nombre: 'ana', at: '2026-09-14T11:00' }, { nombre: 'ana', at: '2026-09-14T07:05' },
], 'ANA', hora), '07:05 (+1)');

// ── 2) EL REPORTE ENTERO, CON DATOS DE MENTIRA ──────────────────────────────
const DATE = '2026-08-15'; // pasado: solo cuenta lo bancado, no depende del reloj
const INSP = 'INSPECTOR UNO';
const at = (h) => `${DATE}T${String(h).padStart(2, '0')}:00:00-04:00`;
const MAQ = [
  { id: 'm1', code: 'JUMBO 320', dayH: 12, nightH: 0 },           // cerrada
  { id: 'm2', code: 'JUMBO 330', dayH: 8.33, nightH: 0 },         // trabajó y LUEGO paró
  { id: 'm3', code: 'PAYLOADER', dayH: 0, nightH: 0 },            // parada todo el turno
  { id: 'm4', code: 'MINI SHOWER', dayH: 0, nightH: 0 },          // averiada
  { id: 'm5', code: 'TARDIA 999', dayH: 0, nightH: 0, tarde: true }, // asignada a las 8pm
  { id: 'm6', code: 'NOCTURNA 777', dayH: 0, nightH: 5, shift: 'night' }, // la cubre la noche
  // Corrido: trabajó día Y noche. El reporte de DÍA solo puede sumar sus 12 h de día.
  { id: 'm7', code: 'CORRIDO 555', dayH: 12, nightH: 6, shift: 'night' },
  // Trabajó 4 h y se averió con la jornada TODAVÍA abierta: la tarjeta dice averiada,
  // el reporte con firma dice «en curso». Este reporte cuenta como la tarjeta.
  { id: 'm8', code: 'ABIERTA 888', dayH: 4, nightH: 0, abierta: true },
];
const rounds = MAQ.map((x) => ({
  machinery_id: x.id, day_hours: x.dayH, night_hours: x.nightH,
  jornada_shift: x.shift ?? 'day', jornada_start_at: x.abierta ? at(7) : null, recorded_by: 'u1', jornada_marked_by: 'u1',
  machine: { code: x.code, serial: null, plate: `P-${x.id}`, sector: 'ESTE', parroquia: null, referencia: '', latitude: null, longitude: null, company: { name: 'EMPRESA X' } },
}));
const paradas = ['m2', 'm3'].map((id) => ({ machinery_id: id, notes: 'NO TRABAJÓ · sin operador', created_at: at(9), status: 'pendiente', resolved_at: null, material: 'MÁQUINA PARADA' }));
const averias = [
  { machinery_id: 'm4', notes: 'FALLA ELÉCTRICA', material: 'FALLA', created_at: at(8), status: 'pendiente', resolved_at: null },
  { machinery_id: 'm8', notes: 'MANGUERA ROTA', material: 'FALLA', created_at: at(11), status: 'pendiente', resolved_at: null },
];
const visitas = [
  { supervisor_name: 'inspector dos', machinery_id: 'm1', visited_at: at(10) },
  { supervisor_name: INSP, machinery_id: 'm3', visited_at: at(7) },
  { supervisor_name: INSP, machinery_id: 'm3', visited_at: at(11) },
];
const fichas = MAQ.map((x) => ({ id: x.id, marca: x.id === 'm1' ? 'CAT' : null, modelo: x.id === 'm1' ? '320' : null, tipo: 'TIPO VIEJO', clasificacion: 'REMOCIÓN', encargado: null }));

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
    if (table === 'supervisor_visits') return visitas;
    if (table === 'machinery') return fichas;
    return [];
  },
};
let captured = [];
let archivo = '';
stubs['pdf'] = {
  pdfDocument: ({ body, subtitle }) => `<sub>${subtitle}</sub>${body}`,
  exportPdf: async (html, name) => { captured.push(html); archivo = name; return true; },
  nowStamp: () => '15 AGO 2026',
};
stubs['supervisorVisits'] = { listVisits: async () => [] };
stubs['machineInspectors'] = {
  listInspectorAssignments: async () => ({ rows: MAQ.map((x) => ({
    machinery_id: x.id, inspector_name: INSP, shift: 'day', assigned_at: x.tarde ? at(20) : at(6),
    code: x.code, serial: null, plate: `P-${x.id}`, tipo: 'TIPO VIEJO', companyName: 'EMPRESA X', sector: 'ESTE',
    referencia: '', latitude: null, longitude: null, encargado: null,
  })) }),
  inspectorSiempreActivo: () => false,
};

const traza = loadTs(path.join(ROOT, 'src/lib/inspectorTrazaReport.ts'));
const firma = loadTs(path.join(ROOT, 'src/lib/inspectorReport.ts'));

const kpi = (html, label) => { const m = html.match(new RegExp(`${label}</div><div class="v">([\\d.]+)</div>`)); return m ? Number(m[1]) : null; };
const fila = (html, code) => html.split(`<b>${code}</b>`)[1]?.split('</tr>')[0] ?? '';

captured = []; reset();
await traza.generateInspectorTrazaReport({ date: DATE, turno: 'day' });
const rep = captured[0] ?? '';

// ⭐ Cuenta las asignadas, no las revisadas: m2 y m4 no tuvieron check-in y salen igual.
eq('cuenta las asignadas que entran en las tarjetas', kpi(rep, 'Asignadas'), 6);
ok('una máquina sin check-in sale igual', fila(rep, 'MINI SHOWER').length > 0 && /Sin check-in/.test(fila(rep, 'MINI SHOWER')));
ok('la asignada después del turno NO sale', !/TARDIA 999/.test(rep));
ok('la que cubre el otro turno NO sale como pendiente', !/NOCTURNA 777/.test(rep));
eq('cerradas', kpi(rep, 'Cerradas'), 2);
eq('paradas', kpi(rep, 'Paradas'), 2);
eq('averiadas', kpi(rep, 'Averiadas'), 2);
eq('pendientes', kpi(rep, 'Pendientes'), 0);
// ⭐ La que se averió con la jornada abierta NO cuenta en curso: la tarjeta dice averiada.
eq('en curso', kpi(rep, 'En curso'), 0);
ok('trabajó y se averió con la jornada abierta: sale averiada, con su nota', /🔴 Averiada/.test(fila(rep, 'ABIERTA 888')) && /averiada desde/.test(fila(rep, 'ABIERTA 888')));
// ⭐ Solo las horas del turno: el corrido aporta sus 12 de día, no 18.
eq('horas del turno', kpi(rep, 'Horas del turno'), 36.33);
ok('el corrido muestra solo sus horas de día', /12\.00/.test(fila(rep, 'CORRIDO 555')) && !/18\.00/.test(fila(rep, 'CORRIDO 555')));
ok('la que trabajó y paró sale parada, con su nota', /🟡 Parada/.test(fila(rep, 'JUMBO 330')) && /parada desde/.test(fila(rep, 'JUMBO 330')));
ok('...y sus horas suman', /8\.33/.test(fila(rep, 'JUMBO 330')));
ok('check-in hecho por otro inspector: dice quién', /· inspector dos/.test(fila(rep, 'JUMBO 320')));
ok('varias revisiones: dice cuántas más', /\(\+1\)/.test(fila(rep, 'PAYLOADER')));
ok('marca y modelo salen del catálogo', /CAT 320/.test(fila(rep, 'JUMBO 320')));
ok('la placa sale por defecto', /<th class="c-placa">/.test(rep) && /P-m1/.test(fila(rep, 'JUMBO 320')));
ok('la clasificación no sale por defecto', !/c-clasificacion/.test(rep));
ok('dice quién inició', /▶️ INSPECTOR UNO/.test(fila(rep, 'JUMBO 320')));

// ⭐ Las horas cuadran con el reporte con firma (misma agregación, mismo turno).
captured = []; reset();
await firma.generateInspectorReport({ date: DATE, shift: 'day' });
const jefe = captured[0] ?? '';
const jefeDia = Number((jefe.match(/Total hrs día<\/div><div class="v">([\d.]+) H/) ?? [])[1]);
eq('PARIDAD · mismas horas que el reporte con firma', kpi(rep, 'Horas del turno'), jefeDia);

// Pastillas: ocultan columnas, nunca máquinas.
captured = []; reset();
await traza.generateInspectorTrazaReport({ date: DATE, turno: 'day', opciones: { ...col.OPCIONES_INSPECTOR_POR_DEFECTO, sinPlaca: true, sinClasificacion: false } });
const conOpciones = captured[0] ?? '';
ok('placa oculta: no hay columna', !/c-placa/.test(conOpciones) && !/P-m1/.test(conOpciones));
ok('clasificación visible: sale con su valor', /c-clasificacion/.test(conOpciones) && /REMOCIÓN/.test(conOpciones));
eq('ocultar columnas no cambia los totales', [kpi(conOpciones, 'Asignadas'), kpi(conOpciones, 'Horas del turno')], [6, 36.33]);
ok('el nombre del archivo dice lo oculto', /sin placa/.test(archivo));

// El filtro de inspector no distingue mayúsculas.
captured = []; reset();
await traza.generateInspectorTrazaReport({ date: DATE, turno: 'day', inspectors: ['inspector uno'] });
eq('filtro por inspector sin importar mayúsculas', kpi(captured[0] ?? '', 'Asignadas'), 6);
captured = []; reset();
await traza.generateInspectorTrazaReport({ date: DATE, turno: 'day', inspectors: ['OTRA PERSONA'] });
ok('inspector sin máquinas: lo dice', /Sin máquinas asignadas/.test(captured[0] ?? ''));

// ── 3) GUARDAS SOBRE EL CÓDIGO ──────────────────────────────────────────────
const src = sinComentarios(leer('src/lib/inspectorTrazaReport.ts'));
ok('el reporte sale de la agregación de las asignadas', /computeInspectorData\(date, null\)/.test(src));
ok('...con la regla de asignación tardía de las tarjetas', /assignmentCountsForShift\(asig, date, turno\)/.test(src));
ok('...y las columnas de la librería', /columnasInspector\(op\)/.test(src));
const sec = sinComentarios(leer('src/components/ReportesSection.tsx'));
ok('la ventana pasa turno y columnas', /generateInspectorTrazaReport\(\{ date, turno, inspectors: names\.length \? names : undefined, opciones \}\)/.test(sec));
ok('la ventana muestra las pastillas', /PASTILLAS_INSPECTOR\.map/.test(sec) && /conColumnas: true/.test(sec) && /conTurno: true/.test(sec));
ok('el manual .md lo explica', /Reporte por inspector — cuenta como las tarjetas \(14\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla también', /REPORTE POR INSPECTOR — CUENTA COMO LAS TARJETAS \(14\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-reporte-inspector · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
