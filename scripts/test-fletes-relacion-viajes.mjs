// 🧾 RELACIÓN DE VIAJES DE LOS FLETES (11-nov-2026, a pedido: «el reporte consolidado de los
// fletes que me salga así» — la hoja de Excel «RELACION DE VIAJES»). Fija:
//   · las columnas y la fila TOTAL (suma de viajes, sin montos),
//   · que lo escrito en el flete manda y lo que falta se completa con Traslados del MISMO chuto ese día,
//   · que la nota guarda el equipo trasladado (EQ) y quién autoriza (AUT) sin romper lo demás,
//   · que de Traslados solo se LEEN columnas sin montos.
// Con --html <archivo> además escribe el HTML de ejemplo (para verlo).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');
const orig = Module._load;
Module._load = function (r) {
  if (r === './pdf') return { exportPdf: async () => true, nowStamp: () => '11/11/2026 12:00' };
  if (r === './logoData') return { LOGO_DATA_URI: '' };
  return orig.apply(this, arguments);
};
function loadTs(abs) {
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
  const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs)); m._compile(out, abs); return m.exports;
}
let ok = 0; const fallas = [];
const check = (c, m, x) => { if (c) ok++; else fallas.push('  ✗ ' + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const eq = (a, b, m) => check(JSON.stringify(a) === JSON.stringify(b), m, { esperado: b, obtenido: a });

const P = loadTs(path.join(ROOT, 'src/lib/fletePdf.ts'));
const R = loadTs(path.join(ROOT, 'src/lib/fleteRutaTraslado.ts'));

// ── 1) La nota guarda EQ y AUT, y nada se pierde al rehacerla ──
const nota = P.formatFleteNote({ operacionTipo: 'pagar', operacionEstado: 'pendiente', origen: 'Barcelona', destino: 'La Guaira', conductor: 'Jose Gomez', equipo: 'Jumbo martillo', autoriza: 'Ezequiel Gomez', viajeIds: ['a1', 'b2'], detalle: 'x' });
const p = P.parseFleteNote(nota);
eq([p.equipo, p.autoriza, p.origen, p.conductor, p.viajeIds], ['Jumbo martillo', 'Ezequiel Gomez', 'Barcelona', 'Jose Gomez', ['a1', 'b2']], '⭐ la nota guarda el equipo trasladado y quién autoriza (y lo demás sigue)');
const p2 = P.parseFleteNote(P.rehacerNotaFlete(nota, { operacionEstado: 'completado' }));
eq([p2.equipo, p2.autoriza, p2.operacionEstado, p2.viajeIds], ['Jumbo martillo', 'Ezequiel Gomez', 'completado', ['a1', 'b2']], '⭐ cambiar el estado NO borra el equipo ni quién autoriza');
eq(P.parseFleteNote(P.formatFleteNote({ operacionTipo: 'cobrar', operacionEstado: 'pendiente', autoriza: 'Cheli | Inversiones [x]' })).autoriza, 'Cheli / Inversiones (x)', '«|» y «[ ]» escritos a mano no rompen la nota');
eq([P.parseFleteNote('[POR_PAGAR|ESTADO:pendiente|ORIGEN:A] viejo').equipo, P.parseFleteNote('sin metadato').autoriza], ['', ''], 'las notas viejas se leen igual (sin equipo ni autoriza)');

// ── 2) La fila: lo del flete manda; lo que falta, del traslado del MISMO chuto ese día ──
const tr = (o) => ({ id: o.id, numero: '', fechaTxt: '', fechaIso: o.fecha, origen: o.origen ?? '', destino: o.destino ?? '', chutoTxt: o.chuto, chuto: R.normalizarPlaca(o.chuto), lowboy: '', equipo: o.equipo ?? '', autoriza: o.autoriza ?? '', chofer: o.chofer ?? '', creadoMs: o.ms ?? 0 });
const TR = [
  tr({ id: 't1', fecha: '2026-10-23', chuto: 'A22CY0J', origen: 'Barcelona', destino: 'La Guaira', equipo: 'JUMBO MARTILLO', autoriza: 'EZEQUIEL GOMEZ', chofer: 'JOSE GOMEZ', ms: 1 }),
  tr({ id: 't2', fecha: '2026-10-24', chuto: 'A22CY0J', origen: 'Playa Escondida', destino: 'Playa Grande', equipo: 'TRACTOR DE ORUGA D9', autoriza: 'CHELI - INVERSIONES', chofer: 'JOSE GOMEZ', ms: 2 }),
  tr({ id: 't3', fecha: '2026-10-24', chuto: 'A22CY0J', origen: 'Centro de acopio', destino: 'El Tigre', equipo: 'RETROEXCAVADORA', autoriza: 'SR CHELI', chofer: 'JOSE GOMEZ', ms: 3 }),
  tr({ id: 't4', fecha: '2026-10-23', chuto: 'OTRO999', equipo: 'NO VA', autoriza: 'NO VA' }),
];
const f1 = R.filaRelacionViajes({ fecha: '2026-10-23', viajes: 1, placa: 'A22CY0J/LOW123' }, TR);
eq([f1.chofer, f1.vehiculo, f1.equipo, f1.origen, f1.destino, f1.viajes, f1.autoriza, f1.completadoDeTraslado], ['JOSE GOMEZ', 'A22CY0J', 'JUMBO MARTILLO', 'Barcelona', 'La Guaira', 1, 'EZEQUIEL GOMEZ', true], '⭐ sin datos propios: se completa con el traslado del MISMO chuto ese día (el de otro chuto no); vehículo = placa del chuto');
const f2 = R.filaRelacionViajes({ fecha: '2026-10-24', viajes: 1, placa: 'A22CY0J', equipo: 'Tractor de oruga D9', autoriza: 'Cheli - Inversiones', origen: 'Playa Escondida', destino: 'Playa Grande', chofer: 'Jose Gomez' }, TR);
eq([f2.equipo, f2.autoriza, f2.origen, f2.completadoDeTraslado], ['Tractor de oruga D9', 'Cheli - Inversiones', 'Playa Escondida', false], '⭐ lo escrito en el flete MANDA sobre el traslado');
const f3 = R.filaRelacionViajes({ fecha: '2026-10-24', viajes: 2, placa: 'A22CY0J' }, TR);
eq([f3.equipo, f3.autoriza], ['TRACTOR DE ORUGA D9 / RETROEXCAVADORA', 'CHELI - INVERSIONES / SR CHELI'], 'dos traslados ese día: se ponen los dos (no se adivina cuál)');
const f4 = R.filaRelacionViajes({ fecha: '2026-11-01', viajes: 1, placa: null, codigo: 'CHUTO CON VOLQUETA' }, TR);
eq([f4.vehiculo, f4.equipo, f4.autoriza, f4.completadoDeTraslado], ['CHUTO CON VOLQUETA', '', '', false], 'sin placa ni traslado: no se inventa nada (vacío)');
eq(R.filaRelacionViajes({ fecha: '2026-10-23', viajes: 1, placa: 'A22CY0J' }, []).equipo, '', 'si no se pudieron leer los traslados, sale con lo del flete');

// ── 3) El papel: columnas del Excel y TOTAL de viajes ──
const filas = [f2, f1, { ...f1, fecha: '2026-10-23' }, { ...f3, equipo: 'RETROEXCAVADORA', autoriza: 'SR CHELI', origen: 'Centro de acopio', destino: 'El Tigre', viajes: 1 }];
const html = P.relacionViajesHtml({ companyName: 'Todas las empresas', periodLabel: 'Del 12/10/2026 al 11/11/2026', filas, emitido: '11/11/2026' });
const ths = [...html.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
eq(ths, ['Fecha', 'Nombre y apellido', 'Vehículo', 'Equipo', 'Origen', 'Destino', 'Viajes', 'Quién lo autoriza'], '⭐ las 8 columnas del Excel, en su orden');
check(/RELACIÓN DE VIAJES/.test(html) && /<td class="izq">TOTAL<\/td>(<td><\/td>){5}\s*<td>4<\/td>/.test(html), '⭐ fila TOTAL con la suma de viajes (4)');
check(!/\$|Tarifa|Total \(\$\)/.test(html), 'sin montos (es la relación de viajes)');
check(html.indexOf('23/10/2026') < html.indexOf('24/10/2026'), 'ordenada por fecha');
check(/size: A4 landscape/.test(html) && /background: #1F3864/.test(html) && /#B4C6E7/.test(html), 'horizontal, encabezado azul oscuro y total azul claro, como el Excel');
const sucio = P.relacionViajesHtml({ companyName: 'X', filas: [{ ...f1, equipo: '<script>alert(1)</script>' }] });
check(!/<script>alert/.test(sucio), 'lo escrito a mano se escapa (no se cuela HTML)');

// ── 4) Cableado ──
const scr = fs.readFileSync(path.join(ROOT, 'src/screens/ServicioFletesScreen.tsx'), 'utf8');
check(/onPress=\{imprimirRelacionViajes\}/.test(scr) && /Reporte Consolidado · Relación de viajes/.test(scr) && /💲 Consolidado con montos/.test(scr), '⭐ el consolidado es la Relación de viajes; el de montos sigue en su botón');
check(/traslados = await cargarRutasDeTraslados\(\);/.test(scr) && /la relación sale solo con lo escrito en cada flete/.test(scr), 'lee los traslados al generar; si fallan, avisa y sale igual');
check(/equipo: formEquipo,\s*autoriza: formAutoriza,/.test(scr) && /equipo: importEquipo,\s*autoriza: importAutoriza,/.test(scr), 'registrar, editar e importar guardan el equipo y quién autoriza');
check(/unirDeTraslados\(lista, 'equipo'\)/.test(scr) && /unirDeTraslados\(lista, 'autoriza'\)/.test(scr), '«Traer de Traslados» también llena el equipo y quién autoriza');
const db = fs.readFileSync(path.join(ROOT, 'src/lib/fleteRutaTrasladoDb.ts'), 'utf8');
check(/'autoriza:datos->firmas->>autorizadoPorEmpresa'/.test(db) && /'chofer:datos->transporte->>conductorNombre'/.test(db) && !/'datos'|servicio|monto/.test(db.replace(/\/\/.*$/gm, '')), 'de Traslados solo columnas sueltas, sin montos');

const iHtml = process.argv.indexOf('--html');
if (iHtml > 0) fs.writeFileSync(process.argv[iHtml + 1], html);

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-fletes-relacion-viajes: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-fletes-relacion-viajes: ${ok} ok, 0 fallas`);
