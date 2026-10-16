// 🕐 Candado: la planilla CONTROL DE HORÓMETROS del inspector — 16-oct-2026.
//
// Pedido: «en la vista de inspectores deben tener un boton para poder descargar ese
// formato ya rellenado en su mayoria … lo que si podrian colocar o modificar seria
// las observaciones».
// Reglas vigiladas:
//  · la librería es SOLO LECTURA (no escribe nada en la base);
//  · el PDF reproduce la planilla: № · EMPRESA · PLACA/SERIAL · HORÓMETRO INICIO ·
//    HORA INICIO · HORÓMETRO FINAL · HORA FINAL · FRENTE · OBSERVACIÓN, con
//    INSPECTOR/FECHA/DÍA en la cabecera y en HORIZONTAL como el papel;
//  · las filas van numeradas por POSICIÓN (i + 1), como los requerimientos;
//  · el frente sale de la planificación de MAQUINARIA (no la de viajes);
//  · lo que falta queda EN BLANCO (nunca se inventa un 0 de horómetro);
//  · la pantalla solo deja editar la OBSERVACIÓN (los demás datos no tienen input);
//  · y el modal va al FINAL del render (en web gana el último montado).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const lib = leer('src/lib/controlHorometrosInspectorPdf.ts');
const scr = leer('src/screens/SupervisorScreen.tsx');

// ── Solo lectura ─────────────────────────────────────────────────────────────
ok('🔒 la librería NO escribe en la base (sin insert/update/delete/upsert/rpc)',
  !/\.(insert|update|delete|upsert|rpc)\(/.test(lib));

// ── El formato del papel ─────────────────────────────────────────────────────
ok('📄 título CONTROL DE HORÓMETROS', lib.includes("title: 'CONTROL DE HORÓMETROS'"));
ok('📄 horizontal como la planilla física', lib.includes('@page{size:A4 landscape}'));
ok('📄 cabecera INSPECTOR / FECHA / DÍA',
  lib.includes('<b>INSPECTOR:</b>') && lib.includes('<b>FECHA:</b>') && lib.includes('<b>DÍA:</b>'));
['EMPRESA', 'PLACA / SERIAL', 'HORÓMETRO<br/>INICIO', 'HORA<br/>INICIO', 'HORÓMETRO<br/>FINAL', 'HORA<br/>FINAL', 'FRENTE', 'OBSERVACIÓN'].forEach((col) =>
  ok(`📄 columna ${col.replace('<br/>', ' ')}`, lib.includes(`>${col}</th>`)));
ok('🔢 numera por POSICIÓN (i + 1), como los requerimientos',
  lib.includes('<td class="c num">${i + 1}</td>'));

// ── Las fuentes de los datos ─────────────────────────────────────────────────
ok('⛏️ el frente sale de la planificación de MAQUINARIA',
  lib.includes('listAsignacionesFrente(date, FRENTES_MAQUINARIA)'));
ok('🕐 los horómetros salen de lo que cargó el inspector (lecturas_horometro_trabajo)',
  lib.includes('cargarLecturasHorometro(date, date)'));
ok('⏱ las horas salen de los tramos trabajados (machine_work_segments)',
  lib.includes("selectAllRows('machine_work_segments'"));
ok('👷 misma columna vertebral que su recibo (computeInspectorData)',
  lib.includes('computeInspectorData(date, null)'));
ok('⬜ sin lectura queda EN BLANCO, no en 0',
  /n == null \|\| !Number\.isFinite\(n\) \? ''/.test(lib));

// ── La pantalla: solo la observación se edita ────────────────────────────────
ok('🖥 botón en la vista del inspector', scr.includes('Control de horómetros (PDF)'));
ok('🖥 visible para TODO inspector, aun sin turno fijo, y para coordinador/admin',
  scr.includes("const puedeControlHorometros = !!fixedShift || role === 'supervisor' || puedeCoordinar;"));
// ── El coordinador/admin saca la planilla suya o la de cualquiera ───────────
ok('👥 el selector de inspectores SOLO lo ve el coordinador/admin',
  /\{puedeCoordinar \? \(\s*<View style=\{\{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing\.xs \}\}>\s*\{\[null, \.\.\.choInspectores/.test(scr));
ok('👥 la lista de inspectores sale del MISMO cálculo de las filas',
  scr.includes('setChoInspectores(inspectores);') && leer('src/lib/controlHorometrosInspectorPdf.ts').includes('return { filas, inspectores };'));
ok('👥 cambiar de inspector limpia las observaciones (son de SU planilla)',
  scr.includes('onPress={() => { setChoInspector(n); setChoObs({}); }}'));
ok('👥 el PDF sale a nombre del inspector ELEGIDO',
  scr.includes('inspectorName: choInspectorEff'));
const modal = scr.split('🕐 CONTROL DE HORÓMETROS (al FINAL del render')[1] ?? '';
ok('🖥 el modal existe y queda al FINAL del render (gana el apilado en web)',
  modal.includes('</Screen>') && !modal.includes('<Modal visible={asisScan}'));
ok('📝 la observación es lo único editable (un solo TextInput en el modal)',
  (modal.match(/<TextInput/g) ?? []).length === 1 && modal.includes('choObs[f.machineryId]'));
ok('📝 la sugerencia no pisa lo escrito por el inspector',
  scr.includes('if (f.obsSugerida && !(f.machineryId in next)) next[f.machineryId] = f.obsSugerida;'));
ok('📄 el PDF recibe las observaciones por máquina',
  lib.includes('observaciones[f.machineryId]'));

console.log(`\n🕐 Control de horómetros (inspector): ${pass} OK · ${fail} FALLO(S)`);
if (fail) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
console.log('   La planilla sale rellena con lo registrado; el inspector solo escribe la observación.');
