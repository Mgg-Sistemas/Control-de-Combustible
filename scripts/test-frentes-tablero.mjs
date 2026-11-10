// ⛏️ TABLERO DE FRENTES (10-nov-2026): la vista nueva de la asignación (Viajes y Reportes usan
// la misma pantalla). Fija qué sale dónde y QUÉ se escribe al mover, sin cambiar cómo se guarda.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');
function loadTs(abs) {
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
  const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs)); m._compile(out, abs); return m.exports;
}
let ok = 0; const fallas = [];
const check = (c, m, x) => { if (c) ok++; else fallas.push('  ✗ ' + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const eq = (a, b, m) => check(JSON.stringify(a) === JSON.stringify(b), m, { esperado: b, obtenido: a });

const T = loadTs(path.join(ROOT, 'src/lib/frentesTablero.ts'));
const EQ = [
  { id: 'c1', code: 'A10', plate: 'AAA1', companyName: 'Liccione' },
  { id: 'c2', code: 'A2', plate: 'BBB2', companyName: 'Jhenzaen' },
  { id: 'c3', code: 'B5', serial: 'SER5', companyName: 'Liccione' },
  { id: 'c4', code: 'C9', companyName: 'ML 40206' },
];
const FR = [{ id: 'f1', nombre: 'Tanaguarena', activo: true }, { id: 'f2', nombre: 'Muelle', activo: true }, { id: 'f3', nombre: 'Viejo', activo: false }, { id: 'f4', nombre: 'Apagado vacío', activo: false }];
const AS = [
  { machineryId: 'c1', frenteId: 'f1', frenteNombre: 'Tanaguarena' },
  { machineryId: 'c1', frenteId: 'f2', frenteNombre: 'Muelle' },     // camión en 2 frentes
  { machineryId: 'c3', frenteId: 'f3', frenteNombre: 'Viejo' },      // frente desactivado con algo
  { machineryId: 'zz', frenteId: 'f1', frenteNombre: 'Tanaguarena' }, // de OTRA lista: no se ve
];

const t = T.armarTablero(EQ, AS, FR);
eq(t.sinFrente.map((e) => e.code), ['A2', 'C9'], '⭐ «Sin frente» arriba: los que no tienen ninguno (orden por código, A2 antes que A10)');
eq(t.cajas.map((c) => c.nombre), ['Muelle', 'Tanaguarena', 'Viejo'], 'una caja por frente activo + el desactivado CON algo (el vacío y apagado no sale)');
eq(t.cajas.find((c) => c.nombre === 'Tanaguarena').equipos.map((e) => e.code), ['A10'], 'solo los equipos de ESTA lista (el de otra no aparece)');
check(t.cajas.find((c) => c.nombre === 'Muelle').equipos[0].code === 'A10', '⭐ un camión con 2 frentes sale en las 2 cajas');
eq([t.totalEquipos, t.conFrente], [4, 2], 'contadores: 2 de 4 con frente');
eq(t.empresas, ['Jhenzaen', 'Liccione', 'ML 40206'], 'empresas para el filtro');
check(new Set(t.cajas.map((c) => c.color)).size === 3, 'cada frente con su color');

const b = T.armarTablero(EQ, AS, FR, { query: 'bbb' });
eq([b.sinFrente.map((e) => e.code), b.cajas.every((c) => c.equipos.length === 0)], [['A2'], true], 'el buscador filtra por placa en todas las cajas');
const e = T.armarTablero(EQ, AS, FR, { empresa: 'liccione' });
eq(e.sinFrente.length + e.cajas.reduce((s, c) => s + c.equipos.length, 0), 3, 'filtro por empresa (sin importar mayúsculas)');
eq(T.armarTablero(EQ, AS, FR, { soloSinFrente: true }).cajas, [], '«Solo los sin frente» esconde las cajas');
const borrado = T.armarTablero(EQ, [{ machineryId: 'c2', frenteId: 'fx', frenteNombre: 'Frente borrado' }], FR);
check(borrado.cajas.some((c) => c.nombre === 'Frente borrado' && c.equipos.length === 1), 'un frente que ya no está en el catálogo igual se muestra (lo asignado no desaparece)');

// Mover — CAMIONES (frente del día)
eq(T.planMover(['c2'], 'f1', AS, false), { asignar: ['c2'], quitar: [], sinFrenteDesde: [], sinCambio: [] }, 'camión sin frente → asignar');
eq(T.planMover(['c1'], 'f1', AS, false), { asignar: [], quitar: [{ machineryId: 'c1', frenteId: 'f2' }], sinFrenteDesde: [], sinCambio: [] }, '⭐ mover a un frente que ya tiene: le quita el OTRO (queda solo en el elegido)');
eq(T.planMover(['c1'], 'f1', AS, false, true), { asignar: [], quitar: [], sinFrenteDesde: [], sinCambio: ['c1'] }, 'con «además» y ya lo tiene: no se toca nada');
eq(T.planMover(['c3'], 'f1', AS, false), { asignar: ['c3'], quitar: [{ machineryId: 'c3', frenteId: 'f3' }], sinFrenteDesde: [], sinCambio: [] }, '⭐ mover de un frente a otro: asigna el nuevo y quita el viejo');
eq(T.planMover(['c3'], 'f1', AS, false, true).quitar, [], '«además»: agrega sin quitar el actual');
eq(T.planMover(['c1'], null, AS, false).quitar.length, 2, 'quitar a un camión: se le quitan TODOS sus frentes de ese día');
eq(T.planMover(['c2'], null, AS, false).sinCambio, ['c2'], 'quitar a uno que no tiene: nada');
eq(T.planMover(['c2', 'c2', ''], 'f1', AS, false).asignar, ['c2'], 'ids repetidos o vacíos no duplican');

// Mover — MÁQUINAS (frente pegajoso)
eq(T.planMover(['c3'], 'f1', AS, true), { asignar: ['c3'], quitar: [], sinFrenteDesde: [], sinCambio: [] }, '⭐ máquina: reasignar = asignar el nuevo (rige el último, como siempre)');
eq(T.planMover(['c3'], 'f3', AS, true).sinCambio, ['c3'], 'máquina ya en ese frente: nada');
eq(T.planMover(['c3'], null, AS, true), { asignar: [], quitar: [], sinFrenteDesde: ['c3'], sinCambio: [] }, '⭐ máquina: quitar = marca «sin frente desde ese día» (los días anteriores no cambian)');

// Cableado: usa las funciones de guardado de SIEMPRE y la vista vieja sigue
const ft = fs.readFileSync(path.join(ROOT, 'src/components/FrentesTrabajo.tsx'), 'utf8');
const mover = ft.slice(ft.indexOf('const mover = async'), ft.indexOf('const input = {'));
check(/asignarFrente\(fecha, plan\.asignar, destino/.test(mover) && /quitarAsignacionFrente\(fecha, q\.machineryId, q\.frenteId/.test(mover) && /quitarFrenteDesde\(fecha, id/.test(mover), '⭐ el tablero guarda con las MISMAS funciones de siempre (asignar / quitar / sin frente desde)');
check(mover.indexOf('asignarFrente(') < mover.indexOf('quitarAsignacionFrente('), 'primero asigna y después quita (si falla, nadie queda sin frente a medias)');
check(/if \(!fallos\.length\) \{/.test(mover) && /No se guardó todo/.test(mover), 'si algo falla lo dice y no quita lo que tenían');
check(/<FrentesTablero\b/.test(ft) && /📋 Asignar en lista \(la vista de antes\)/.test(ft), 'el tablero arriba y la vista de lista de siempre sigue (plegada)');
check(/⚙️ Los frentes: crear, renombrar, apagar o borrar/.test(ft), 'el catálogo de frentes va plegado aparte');
check((ft.match(/\{confirmacionRepetir\}/g) || []).length === 2, 'la confirmación de «repetir» es UNA pieza usada en el tablero y en el historial');
check(/exportarPdf/.test(ft) && /Por cuáles frentes sale el reporte/.test(ft), 'el PDF y sus opciones siguen igual');
const tab = fs.readFileSync(path.join(ROOT, 'src/components/FrentesTablero.tsx'), 'utf8');
check(/ANCHO_CAJA/.test(tab) && /onLayout/.test(tab) && /width: ab \? '100%' : anchoCol/.test(tab), '⭐ cuadrícula pareja: columnas del mismo ancho en PC (una en el teléfono) y la caja desplegada a todo el ancho (no se descuadra)');
check(/numberOfLines=\{ab \? undefined : 1\}/.test(tab), 'plegadas: el nombre en una sola línea (todas del mismo alto)');
check(/useState<Set<string>>\(new Set\(\)\)/.test(tab) && /abierta\('sin', t\.sinFrente\.length\) \?/.test(tab) && /const ab = abierta\(c\.frenteId/.test(tab), '⭐ «Sin frente» y cada frente arrancan PLEGADOS y se despliegan tocando el título');
check(/buscando && cuantos > 0/.test(tab), 'al buscar, se abren solas las cajas con resultados');
check(/Desplegar todos/.test(tab) && /Plegar todos/.test(tab), 'botón para desplegar / plegar todas de una vez');
check(!/horizontal/.test(tab.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')), '⭐ las empresas van en varias filas (en PC una tira horizontal no se corre con el mouse)');
check(/<Modal\b/.test(tab) && /Buscar el frente por su nombre/.test(tab) && /frentesQueCoinciden\(activos, buscaDestino\)/.test(tab), '⭐ «Mover a:» es una ventana con BUSCADOR de frentes (los nombres largos ya no se salen de la caja)');
check(/Buscar frente por su nombre/.test(tab) && /frenteQuery/.test(tab), '🔎 buscador de frentes también arriba, para encontrar la caja');
check(/grupo\('ESTADO'/.test(tab) && /grupo\('CATEGORÍA'/.test(tab) && /grupo\('EMPRESA'/.test(tab), 'filtros por estado, categoría y empresa');

// Filtros nuevos (lib)
const EQ2 = [
  { id: 'm1', code: 'EX1', estado: 'Operativa', clasificacion: 'Excavadora' },
  { id: 'm2', code: 'EX2', estado: 'Averiada', clasificacion: 'Excavadora' },
  { id: 'm3', code: 'RT1', estado: 'Operativa', clasificacion: 'Retroexcavadora' },
  { id: 'm4', code: 'XX1' },
];
const AS2 = [{ machineryId: 'm1', frenteId: 'f1', frenteNombre: 'Tanaguarena' }, { machineryId: 'm2', frenteId: 'f2', frenteNombre: 'Muelle' }];
const t2 = T.armarTablero(EQ2, AS2, FR);
eq([t2.estados, t2.categorias], [['Averiada', 'Operativa', 'Sin dato'], ['Excavadora', 'Retroexcavadora', 'Sin dato']], 'estados y categorías que hay en la lista («Sin dato» al final)');
const porEstado = T.armarTablero(EQ2, AS2, FR, { estado: 'operativa' });
eq([porEstado.sinFrente.map((e) => e.code), porEstado.cajas.find((c) => c.nombre === 'Muelle').equipos.length], [['RT1'], 0], '⭐ filtro por ESTADO (en sin frente y en las cajas)');
eq(T.armarTablero(EQ2, AS2, FR, { categoria: 'Excavadora' }).sinFrente.length, 0, '⭐ filtro por CATEGORÍA');
eq(T.armarTablero(EQ2, AS2, FR, { categoria: 'Sin dato' }).sinFrente.map((e) => e.code), ['XX1'], 'se puede filtrar los que no tienen categoría');
const pf = T.armarTablero(EQ2, AS2, FR, { frenteQuery: 'tana' });
eq(pf.cajas.map((c) => c.nombre), ['Tanaguarena'], '⭐ buscar frente por nombre: solo esa caja');
eq(pf.cajas[0].color, t2.cajas.find((c) => c.nombre === 'Tanaguarena').color, 'buscar un frente no le cambia el color');
eq(T.frentesQueCoinciden(FR, 'MUÉ').map((f) => f.nombre), ['Muelle'], 'el buscador de la ventana encuentra sin importar mayúsculas ni acentos');

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-frentes-tablero: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-frentes-tablero: ${ok} ok, 0 fallas`);
