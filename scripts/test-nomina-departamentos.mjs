/*
 * Test del BUSCADOR DE NÓMINAS, el FILTRO POR DEPARTAMENTO y el EXCEL DIVIDIDO
 * POR DEPARTAMENTO (11-sep-2026).
 *
 * Pedido del cliente, en tres partes:
 *   1) un buscador en la lista de nóminas (pestaña "Por período");
 *   2) poder filtrar por uno o varios DEPARTAMENTOS, además de por cargo;
 *   3) que el Excel del período salga partido por departamento y ordenado, como
 *      la nómina que la empresa venía llevando a mano.
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · UN DEPARTAMENTO = UNA SECCIÓN. El mismo departamento está escrito distinto
 *     en el tabulador ("ALIMENTACION") y en la ficha ("COCINA"). Si se dejan de
 *     unificar, el Excel sale con dos secciones que son lo mismo, y los subtotales
 *     dejan de cuadrar con nada.
 *   · MANDA EL NOMBRE DEL TABULADOR. Es el vocabulario de la empresa. Si gana el
 *     del sistema, el usuario renombra un departamento y el Excel lo ignora.
 *   · EL ORDEN ES LA JERARQUÍA, NO EL ALFABETO, y es el MISMO en el filtro y en el
 *     Excel. Si cada uno ordena por su cuenta, el mismo departamento aparece en
 *     posiciones distintas y no hay forma de cotejar pantalla contra papel.
 *   · EL TOTAL SUMA LOS SUBTOTALES, no el rango completo: un SUM de todo contaría
 *     a cada persona dos veces, porque los subtotales están dentro del rango.
 *   · EL ÍTEM REINICIA en cada departamento (así es la nómina de siempre).
 *
 *   node scripts/test-nomina-departamentos.mjs
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

// Carga un .ts resolviendo a mano sus imports relativos (mismo cargador que
// scripts/test-empleados-buscar.mjs). Los `stubs` sustituyen dependencias que en
// Node no existen —`react-native`— o que hay que espiar.
const cache = new Map();
function cargarAbs(abs, stubs) {
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
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return cargarAbs(c, stubs);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}
const cargar = (rel, stubs = {}) => cargarAbs(path.join(ROOT, rel), stubs);

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ── 1) UNIFICAR EL DEPARTAMENTO: el tabulador manda, la ficha respalda ──────
const dep = cargar('src/lib/nominaDepartamentos.ts');
const { mapaDepartamentos, SIN_DEPARTAMENTO } = dep;

// Tabulador como el que llena la empresa: departamento por CARGO, con SUS palabras.
const TABULADOR = [
  { cargo: 'COORDINADOR GENERAL', departamento: 'DIRECTIVO/GERENCIA' },
  { cargo: 'JEFE DE ADMINISTRACION', departamento: 'ADMINISTRACION' },
  { cargo: 'ANALISTA ADMINISTRATIVOS', departamento: 'ADMINISTRACION' },
  { cargo: 'SISTEMAS', departamento: 'ADMINISTRACION' },
  { cargo: 'JEFE DE ALIMENTACION', departamento: 'ALIMENTACION' },
  { cargo: 'COCINERO PRINCIPAL', departamento: 'ALIMENTACION' },
];
const m = mapaDepartamentos(TABULADOR);

eq('el cargo del tabulador trae su departamento', m.de('COORDINADOR GENERAL'), 'DIRECTIVO/GERENCIA');
eq('no distingue mayúsculas ni acentos al buscar el cargo', m.de('coordinador general'), 'DIRECTIVO/GERENCIA');
eq('un cargo administrativo cae en ADMINISTRACION', m.de('ANALISTA ADMINISTRATIVOS'), 'ADMINISTRACION');
// SISTEMAS es un CARGO dentro de administración, no un departamento aparte: así lo
// lleva la empresa en su nómina, y el tabulador es quien lo dice.
eq('SISTEMAS va donde el tabulador diga, no donde el sistema supondría', m.de('SISTEMAS'), 'ADMINISTRACION');

// EL CASO QUE PARTÍA EL EXCEL EN DOS: alguien cuyo cargo NO está en el tabulador,
// pero cuya ficha dice "COCINA". Es la misma gente de "ALIMENTACION".
eq('la ficha dice COCINA y el tabulador ALIMENTACION → una sola sección',
  m.de('AYUDANTE DE COCINA SIN TABULAR', 'COCINA'), 'ALIMENTACION');
eq('ídem sin ficha: se deduce del cargo y se renombra igual',
  m.de('LAVAPLATOS'), 'ALIMENTACION');
eq('la ficha administrativa también adopta el nombre del tabulador',
  m.de('CARGO NUEVO', 'ADMINISTRATIVO'), 'ADMINISTRACION');

// Sin tabulador que aporte nombre, se usa el canónico del sistema.
eq('un departamento sin equivalente en el tabulador conserva el canónico',
  m.de('OPERADOR DE MAQUINARIA'), 'OPERACIONES DE MAQUINARIA');
eq('sin cargo y sin ficha no se inventa nada', m.de(null, null), SIN_DEPARTAMENTO);
eq('cargo que no dice nada tampoco se adivina', m.de('ZZZ'), SIN_DEPARTAMENTO);

// A empate de escrituras gana la alfabética: el mismo período exportado dos veces
// tiene que salir con el mismo título de sección.
const empate = mapaDepartamentos([
  { cargo: 'A', departamento: 'ALMACEN GENERAL' },
  { cargo: 'B', departamento: 'ALMACEN' },
]);
eq('a empate gana la escritura alfabéticamente primera', empate.de('A'), 'ALMACEN');
const mayoria = mapaDepartamentos([
  { cargo: 'A', departamento: 'ALMACEN GENERAL' },
  { cargo: 'B', departamento: 'ALMACEN GENERAL' },
  { cargo: 'C', departamento: 'ALMACEN' },
]);
eq('gana la escritura más usada', mayoria.de('C'), 'ALMACEN GENERAL');

// Un tabulador vacío no puede romper nada: se cae al criterio del sistema.
const vacio = mapaDepartamentos([]);
eq('sin tabulador se usa el departamento canónico', vacio.de('COCINERO'), 'COCINA');
eq('sin tabulador la ficha sigue valiendo', vacio.de('X', 'almacen'), 'ALMACÉN');
eq('filas del tabulador sin departamento se ignoran',
  mapaDepartamentos([{ cargo: 'COCINERO', departamento: null }]).de('COCINERO'), 'COCINA');

// ── 2) EL ORDEN ES LA JERARQUÍA, NO EL ALFABETO ────────────────────────────
eq('el orden es el de la nómina, no A→Z',
  m.orden(['ALIMENTACION', 'ADMINISTRACION', 'DIRECTIVO/GERENCIA']),
  ['DIRECTIVO/GERENCIA', 'ADMINISTRACION', 'ALIMENTACION']);
eq('SIN DEPARTAMENTO cierra siempre',
  m.orden([SIN_DEPARTAMENTO, 'ADMINISTRACION', 'DIRECTIVO/GERENCIA']),
  ['DIRECTIVO/GERENCIA', 'ADMINISTRACION', SIN_DEPARTAMENTO]);
eq('mantenimiento va antes que operaciones',
  m.orden(['OPERACIONES DE MAQUINARIA', 'MANTENIMIENTO']),
  ['MANTENIMIENTO', 'OPERACIONES DE MAQUINARIA']);
eq('lo desconocido va detrás de lo conocido, en orden alfabético',
  m.orden(['ZZZ', 'ADMINISTRACION', 'AAA']),
  ['ADMINISTRACION', 'AAA', 'ZZZ']);
eq('no repite un departamento que venga dos veces',
  m.orden(['ADMINISTRACION', 'ADMINISTRACION']), ['ADMINISTRACION']);
eq('una lista vacía no revienta', m.orden([]), []);

// ── 3) EL EXCEL: se genera de verdad y se le leen las celdas ────────────────
// No basta con mirar el fuente: lo que importa es qué hoja sale. Se sustituye
// `react-native` (Platform) y se intercepta `XLSX.write` para quedarse con el
// libro en vez de intentar descargarlo.
const XLSXreal = require('xlsx-js-style');
let libro = null;
const xlsxStub = { __esModule: true, ...XLSXreal, write: (wb) => { libro = wb; return new Uint8Array(0); } };
globalThis.document = {
  createElement: () => ({ click() {}, remove() {} }),
  body: { appendChild() {} },
};
globalThis.Blob = class { };
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};

const xls = cargar('src/lib/staffXlsx.ts', {
  'react-native': { __esModule: true, Platform: { OS: 'web' } },
  'xlsx-js-style': xlsxStub,
});

const persona = (departamento, nombre, total) => ({
  departamento, nombre, cedula: '0', cargo: 'C', cuenta: '', titular: nombre, cedulaTitular: '0',
  dias: 5, dias_noche: 0, horas: 0, semanas: 0,
  devengado: total, bonos: 0, deducciones: 0, total, pagado: 0, saldo: total,
});
const META = {
  periodo: 'Nómina de prueba', tipo: 'Semana', desde: '01/09/2026', hasta: '07/09/2026',
  modo: 'Por día', estado: 'Borrador', empresa: 'EMPRESA',
};

ok('el Excel se generó', xls.exportPagoPersonalXlsx([
  persona('DIRECTIVO/GERENCIA', 'UNO', 100),
  persona('DIRECTIVO/GERENCIA', 'DOS', 200),
  persona('ADMINISTRACION', 'TRES', 300),
], null, META) === true);

const hoja = libro.Sheets['Pago de personal'];
const celda = (ref) => hoja[ref];
const valor = (ref) => (hoja[ref] ? hoja[ref].v : undefined);

// Encabezado: el ítem abre la tabla, como en la nómina de la empresa.
eq('la primera columna es el ítem', valor('A3'), 'Ítem');
eq('la segunda sigue siendo el nombre', valor('B3'), 'Nombre completo');
eq('el total sigue en su columna', valor('O3'), 'Total (US$)');

// Fila 4 = franja del primer departamento; 5 y 6 su gente; 7 su subtotal.
eq('abre con la franja del primer departamento', valor('A4'), 'DIRECTIVO/GERENCIA — 2 persona(s)');
eq('la primera persona lleva el ítem 1', valor('A5'), 1);
eq('la segunda lleva el 2', valor('A6'), 2);
eq('la fila de subtotal se rotula con su departamento', valor('B7'), 'Subtotal DIRECTIVO/GERENCIA');
eq('el subtotal suma SOLO su rango', celda('O7').f, 'SUM(O5:O6)');

// Segundo departamento: el ítem VUELVE a 1.
eq('la franja del segundo departamento', valor('A8'), 'ADMINISTRACION — 1 persona(s)');
eq('el ítem reinicia en cada departamento', valor('A9'), 1);
eq('el segundo subtotal suma su propio rango', celda('O10').f, 'SUM(O9:O9)');

// TOTAL: suma los subtotales. Un SUM(O5:O10) contaría a todos dos veces.
eq('el total del período suma los subtotales, no el rango', celda('O11').f, 'SUM(O7,O10)');
eq('el total dice cuánta gente hay', valor('B11'), '3 persona(s)');
eq('el total también suma los días así', celda('H11').f, 'SUM(H7,H10)');

// Formato: la franja pintada de punta a punta, y el ancho del ítem.
ok('la franja del departamento va pintada', !!(celda('A4').s && celda('A4').s.fill));
ok('la franja se pinta hasta la última columna', !!(celda('Q4') && celda('Q4').s && celda('Q4').s.fill));
ok('la franja ocupa la fila entera', hoja['!merges'].some((x) => x.s.r === 3 && x.s.c === 0 && x.e.c === 16));
eq('la columna del ítem es angosta', hoja['!cols'][0].wch, 6);
eq('hay una columna de ancho por cada encabezado', hoja['!cols'].length, 17);

// El orden lo decide quien llama: staffXlsx respeta el orden de llegada.
libro = null;
xls.exportPagoPersonalXlsx([
  persona('ADMINISTRACION', 'TRES', 300),
  persona('DIRECTIVO/GERENCIA', 'UNO', 100),
], null, META);
eq('respeta el orden en que le llegan las filas', libro.Sheets['Pago de personal']['A4'].v, 'ADMINISTRACION — 1 persona(s)');

// Sin departamento en la fila, no se pierde: cae en su propia sección.
libro = null;
xls.exportPagoPersonalXlsx([persona('', 'SOLO', 50)], null, META);
eq('una fila sin departamento cae en SIN DEPARTAMENTO', libro.Sheets['Pago de personal']['A4'].v, `${SIN_DEPARTAMENTO} — 1 persona(s)`);

// Un período vacío no puede reventar la descarga.
libro = null;
ok('un período sin gente igual genera el archivo', xls.exportPagoPersonalXlsx([], null, META) === true);
eq('y el total dice cero personas', libro.Sheets['Pago de personal']['B4'].v, '0 persona(s)');

// El filtro aplicado queda escrito en la hoja: un Excel filtrado y uno completo
// no pueden verse iguales.
libro = null;
xls.exportPagoPersonalXlsx([persona('ADMINISTRACION', 'UNO', 1)], null, { ...META, deptoFiltro: 'ADMINISTRACION' });
ok('la hoja anota el filtro de departamento', String(libro.Sheets['Pago de personal']['B1'].v).includes('Departamento(s): ADMINISTRACION'));

// ── 4) LA PANTALLA: buscador de nóminas y filtro por departamento ───────────
const scr = sinComentarios(leer('src/screens/PagoPersonalScreen.tsx'));
const scrCrudo = leer('src/screens/PagoPersonalScreen.tsx');

ok('existe el buscador de nóminas', scrCrudo.includes('🔎 Buscar nómina por nombre, fecha o estado…'));
ok('la lista de nóminas se arma con lo filtrado, no con todo', /periodsShown\.forEach/.test(scr));
ok('el buscador no distingue acentos ni mayúsculas', /const nq = norm\(periodQuery\)/.test(scr));
ok('busca también por estado y por fechas, no solo por nombre',
  /PAGO_STATUS_META\[p\.status\]/.test(scr) && /fmtDMY\(p\.date_from\)/.test(scr));
ok('si nada coincide lo dice, en vez de parecer vacío', scrCrudo.includes('Ninguna nómina coincide'));

ok('existe el filtro por departamento', scrCrudo.includes('🏛️ Filtrar por departamento'));
ok('el filtro por departamento admite varios a la vez', /deptoSel\.has\(/.test(scr) && /setDeptoSel/.test(scr));
// Dos veces y no una: el filtro tiene que aplicarse en la LISTA que se ve y en la
// BASE de los documentos. Tenerlo en una sola de las dos es el error que se cuela.
eq('el filtro de departamento se aplica en la lista Y en los documentos',
  (scr.match(/!deptoSel\.size \|\| deptoSel\.has\(deptoDe\(it\)\)/g) || []).length, 2);
ok('la lista se recalcula cuando cambia el filtro de departamento',
  /\}, \[items, cargoSel, deptoSel, deptoDe, personaQuery/.test(scr));
ok('departamento y cargo se combinan, no se excluyen',
  /!cargoSel\.size \|\| cargoSel\.has\(cargoOf\(it\.cargo\)\)/.test(scr) && /!deptoSel\.size/.test(scr));
ok('el desplegable se puede limpiar', /setDeptoSel\(new Set\(\)\)/.test(scr));
ok('los dos filtros se borran al abrir otra nómina', /setDeptoSel\(new Set\(\)\); setDeptoOpen\(false\)/.test(scr));

// El departamento NO está en el renglón: sale del tabulador y de la ficha.
ok('la pantalla lee el tabulador', /useTable<[^>]*>\('staff_cargo_tariffs'/.test(scr));
ok('la consulta del detalle trae el departamento de la ficha', /select\('id, status, cargo, department,/.test(scr));
ok('el departamento se resuelve con la regla compartida', /mapaDepartamentos\(tarifas/.test(scr));
ok('no hay una segunda copia de la regla en la pantalla', !/normalizeDept\(/.test(scr));

// Una sola definición de "quién sale en los documentos", para PDF y Excel.
eq('la base de los documentos se define una sola vez', (scr.match(/const baseDocumentos = useCallback/g) || []).length, 1);
eq('y la usan los dos documentos', (scr.match(/baseDocumentos\(\)/g) || []).length, 2);
ok('ya no queda la cadena de precedencia duplicada',
  !/cargoSel\.size \? items\.filter\(\(it\) => cargoSel\.has\(cargoOf\(it\.cargo\)\)\) : items/.test(scr));
ok('la selección manual sigue ganándole a los filtros', /itemSelIds\.size\s*\?\s*items\.filter\(\(it\) => itemSelIds\.has\(it\.id\)\)/.test(scr));

// El Excel: cada fila lleva su departamento y va ordenada antes de exportar.
ok('cada fila del Excel lleva su departamento', /departamento: deptoDe\(it\)/.test(scr));
ok('se ordena por departamento antes de exportar', /puestoDepto/.test(scr) && /depts\.orden\(base\.map\(deptoDe\)\)/.test(scr));
// Ordenar y NO exportar lo ordenado deja el Excel partido en secciones repetidas,
// porque staffXlsx agrupa respetando el orden de llegada.
ok('el Excel exporta lo ordenado, no la base cruda', /exportPagoPersonalXlsx\(\s*ordenadas\.map/.test(scr));
ok('dentro de cada departamento va por nombre', /cmpText\(a\.person_name, b\.person_name\)/.test(scr));
ok('el filtro de departamento se anota en el Excel', /deptoFiltro:/.test(scr));

// ── 5) EL MANUAL CUENTA LO MISMO ───────────────────────────────────────────
// Un módulo que nadie sabe usar es un módulo que no existe.
const md = leer('docs/MANUAL-USUARIO.md');
const ms = leer('src/screens/ManualScreen.tsx');
ok('el manual .md explica el buscador de nóminas', /[Bb]uscador de nóminas \(11\/09\/2026\)/.test(md));
ok('el manual .md explica el filtro por departamento', /Filtrar por departamento/.test(md));
ok('el manual .md explica el Excel por departamento', /Excel .*dividido por departamento/i.test(md));
ok('el manual .md dice dónde se define el departamento', /[Tt]abulador/.test(md) && /SIN DEPARTAMENTO/.test(md));
ok('el manual en pantalla explica el buscador de nóminas', /BUSCADOR DE NÓMINAS \(11\/09\/2026\)/.test(ms));
ok('el manual en pantalla explica el filtro por departamento', /Filtrar por departamento/.test(ms));
ok('el manual en pantalla explica el Excel por departamento', /dividido por departamento/i.test(ms));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-nomina-departamentos · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
