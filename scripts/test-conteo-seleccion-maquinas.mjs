/*
 * Test de ESCOGER MÁQUINAS SUELTAS en el conteo por tipo de equipo (11-sep-2026).
 *
 * Pedido del cliente: «que pueda seleccionar también maquinaria en específico; ahí
 * engloba, lo cual está bien, pero también quiero poder no sacar algunas máquinas,
 * o que sea una en específica».
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · SE GUARDA LO EXCLUIDO, no lo incluido. Con la lista vacía el reporte sale
 *     igual que siempre, y al tildar un tipo nuevo su gente entra sola. Si se
 *     guardara lo incluido, el día que falle la sincronización el conteo saldría
 *     con menos equipos SIN AVISAR, que es el peor error posible en un conteo.
 *   · SE EXCLUYE POR `id`, NUNCA POR CÓDIGO. Hay tres máquinas llamadas
 *     RETROEXCAVADORA: excluir por código sacaría a las tres de un solo toque.
 *   · UN SOLO PUNTO DE FILTRADO. El PDF consume el mismo memo que la pantalla; si
 *     la exclusión se aplicara en otro lado, el papel listaría equipos que la
 *     pantalla no muestra.
 *   · EL CUADRO «CANTIDAD POR TIPO» CUENTA LO LISTADO. Antes usaba el total del
 *     tipo; con exclusiones diría 17 mientras el listado tiene 14, y el pie del
 *     cuadro no cuadraría con sus propias filas.
 *   · UN CONTEO EN CERO NO SE EMITE, y un conteo al que le faltan equipos LO DICE
 *     en el membrete, que no se puede apagar con ninguna pastilla.
 *
 *   node scripts/test-conteo-seleccion-maquinas.mjs
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

const cache = new Map();
function cargarAbs(abs) {
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
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return cargarAbs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}
const cargar = (rel) => cargarAbs(path.join(ROOT, rel));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const sel = cargar('src/lib/conteoSeleccionMaquinas.ts');
const { excluidasEfectivas, aplicarExclusiones, conteoPorTipo, seleccionVacia, textoExclusiones, rotuloSeleccion } = sel;

// Tres equipos que se llaman IGUAL: el caso que obliga a excluir por id.
const FLOTA = [
  { id: 'a', code: 'RETROEXCAVADORA', plate: 'AB123' },
  { id: 'b', code: 'RETROEXCAVADORA', plate: 'CD456' },
  { id: 'c', code: 'RETROEXCAVADORA', plate: null },
  { id: 'd', code: 'CAMION VOLTEO TORONTO', plate: 'EF789' },
];
const ids = (l) => l.map((m) => m.id);

// ── 1) QUITAR MÁQUINAS SIN TOCAR A LAS DEMÁS ───────────────────────────────
eq('sin exclusiones sale la lista entera', ids(aplicarExclusiones(FLOTA, new Set())), ['a', 'b', 'c', 'd']);
ok('sin exclusiones devuelve la MISMA lista, no una copia', aplicarExclusiones(FLOTA, new Set()) === FLOTA);
eq('saca una sola', ids(aplicarExclusiones(FLOTA, new Set(['b']))), ['a', 'c', 'd']);
eq('saca varias', ids(aplicarExclusiones(FLOTA, new Set(['a', 'd']))), ['b', 'c']);
eq('conserva el orden de entrada', ids(aplicarExclusiones(FLOTA, new Set(['a']))), ['b', 'c', 'd']);
eq('quedarse con UNA sola es excluir el resto', ids(aplicarExclusiones(FLOTA, new Set(['a', 'b', 'c']))), ['d']);
eq('sacarlas todas deja la lista vacía', ids(aplicarExclusiones(FLOTA, new Set(['a', 'b', 'c', 'd']))), []);
// EL CASO QUE OBLIGA A USAR `id`: tres máquinas con el mismo código.
eq('excluir una RETRO no se lleva a las otras dos',
  ids(aplicarExclusiones(FLOTA, new Set(['b']))).filter((x) => x !== 'd'), ['a', 'c']);
eq('un id que no existe no saca a nadie', ids(aplicarExclusiones(FLOTA, new Set(['zzz']))), ['a', 'b', 'c', 'd']);

// ── 2) LA REGLA DE LA INTERSECCIÓN ─────────────────────────────────────────
// Lo excluido se guarda, pero solo cuenta lo que está a la vista: el número de
// excluidas no puede hablar de equipos que ni siquiera están en el reporte.
eq('solo cuentan las exclusiones de lo que está a la vista',
  [...excluidasEfectivas(['a', 'z'], new Set(['a', 'b']))], ['a']);
eq('si se destilda el tipo, su exclusión deja de contar',
  [...excluidasEfectivas(['a'], new Set(['d']))], []);
eq('y vuelve a contar si el tipo se tilda de nuevo',
  [...excluidasEfectivas(['a'], new Set(['a', 'd']))], ['a']);
eq('sin nada guardado no hay exclusiones', [...excluidasEfectivas([], new Set(['a']))], []);
eq('sin nada a la vista tampoco', [...excluidasEfectivas(['a'], new Set())], []);
// La intersección es lo que hace que el rótulo no mienta.
eq('el rótulo cuenta sobre lo visible', rotuloSeleccion(4, 1), '3 de 4');
eq('sin exclusiones el rótulo dice todo', rotuloSeleccion(4, 0), '4 de 4');
eq('con todas fuera dice cero', rotuloSeleccion(4, 4), '0 de 4');

// ── 3) EL CUADRO «CANTIDAD POR TIPO» CUENTA LO LISTADO ─────────────────────
// Antes salía del total del tipo. Con exclusiones los dos números se separan, y
// el que vale es el de las filas que se imprimen.
const clave = (m) => m.code;
eq('cuenta por tipo sobre lo que queda',
  [...conteoPorTipo(aplicarExclusiones(FLOTA, new Set(['b'])), clave).entries()],
  [['RETROEXCAVADORA', 2], ['CAMION VOLTEO TORONTO', 1]]);
eq('sin exclusiones cuenta la flota completa',
  [...conteoPorTipo(FLOTA, clave).entries()],
  [['RETROEXCAVADORA', 3], ['CAMION VOLTEO TORONTO', 1]]);
eq('un tipo que se quedó sin máquinas no aparece',
  [...conteoPorTipo(aplicarExclusiones(FLOTA, new Set(['d'])), clave).entries()],
  [['RETROEXCAVADORA', 3]]);
eq('lista vacía, cuenta vacía', [...conteoPorTipo([], clave).entries()], []);
// La suma del cuadro TIENE que dar el total del listado; si no, el pie miente.
const quedan = aplicarExclusiones(FLOTA, new Set(['a', 'd']));
eq('la suma del cuadro da el total del listado',
  [...conteoPorTipo(quedan, clave).values()].reduce((a, b) => a + b, 0), quedan.length);

// ── 4) UN CONTEO EN CERO NO SE EMITE ───────────────────────────────────────
ok('con todas fuera, no hay reporte', seleccionVacia(4, 4));
ok('...aunque sobren exclusiones guardadas', seleccionVacia(4, 9));
eq('con una dentro sí hay reporte', seleccionVacia(4, 3), false);
eq('sin exclusiones hay reporte', seleccionVacia(4, 0), false);
// Sin tipos tildados no hay nada a la vista: eso NO es "selección vacía", es que
// todavía no se eligió nada, y ya lo avisa otro texto de la pantalla.
eq('sin tipos tildados no es una selección vacía', seleccionVacia(0, 0), false);

// ── 5) EL PAPEL DICE QUE LE FALTAN EQUIPOS ─────────────────────────────────
eq('sin exclusiones no dice nada', textoExclusiones(17, 0), '');
eq('dice cuántas se sacaron, de cuántas, y cuántas cuenta',
  textoExclusiones(17, 3), 'Selección manual de equipos: se dejaron fuera 3 de 17 unidad(es); el informe cuenta 14.');

// ── 6) LA PANTALLA: un solo punto de filtrado ──────────────────────────────
const scr = sinComentarios(leer('src/screens/ReportsScreen.tsx'));
const scrCrudo = leer('src/screens/ReportsScreen.tsx');

ok('existe el selector de máquinas', scrCrudo.includes('🚜 Escoger máquinas'));
ok('se guarda lo EXCLUIDO', /const \[maqExcluidas, setMaqExcluidas\] = useState<Set<string>>\(new Set\(\)\)/.test(scr));
ok('se excluye por id, no por código', /toggleMaquina = \(id: string\)/.test(scr));
ok('la casilla se muestra al derecho: tildada = entra', /const on = !maqFuera\.has\(m\.id\)/.test(scr));
ok('la lista se ofrece antes de excluir', /const maquinasDeTipos = useMemo/.test(scr));
ok('las exclusiones se cruzan con lo visible', /excluidasEfectivas\(maqExcluidas, new Set\(maquinasDeTipos\.map\(\(m\) => m\.id\)\)\)/.test(scr));

// ⭐ UN SOLO PUNTO. El PDF consume `tipoResultado`; si la exclusión se aplicara
//    en otro lado, el papel y la pantalla dejarían de coincidir.
eq('la exclusión se aplica en UN solo sitio', (scr.match(/aplicarExclusiones\(/g) || []).length, 1);
ok('...y ese sitio es el memo que alimenta al PDF', /const match = aplicarExclusiones\(maquinasDeTipos, maqFuera\)/.test(scr));
ok('el total sigue saliendo de las filas', /total: match\.length/.test(scr));
ok('el PDF no vuelve a filtrar por su cuenta', /const \{ total, empresas \} = tipoResultado/.test(scr));

// El cuadro por tipo, la trampa que dejaba dos números distintos en el papel.
ok('el cuadro por tipo cuenta lo listado', /const porTipoListado = conteoPorTipo\(empresas\.flatMap\(\(e\) => e\.items\)/.test(scr));
ok('...y el cuadro usa ese conteo, no el del tipo', /count: porTipoListado\.get\(k\) \?\? 0/.test(scr));
ok('ya no se cuenta desde tipoMap en el PDF', !/count: tipoMap\.get\(k\)\?\.count/.test(scr));

// Decirlo o no decirlo: el membrete siempre se imprime, el alcance se puede apagar.
ok('el membrete avisa de los equipos excluidos', /const exclLbl = maqFuera\.size \? ` · \$\{maqFuera\.size\} equipo\(s\) excluido\(s\)`/.test(scr));
ok('...y el membrete lo lleva puesto', /\$\{clasLbl\}\$\{exclLbl\}/.test(scr));
ok('el alcance también lo detalla', /textoExclusiones\(maquinasDeTipos\.length, maqFuera\.size\)/.test(scr));
ok('el archivo se llama distinto si hubo selección', /maqFuera\.size \? ' seleccion' : ''/.test(scr));

// Cero equipos: ni el botón ni la función lo dejan pasar.
ok('el botón se apaga con todas fuera', /disabled=\{conteoSinContenido\(conteoOpciones\) \|\| seleccionVacia\(/.test(scr));
ok('y la función también lo corta', /if \(seleccionVacia\(maquinasDeTipos\.length, maqFuera\.size\)\) \{/.test(scr));

// Al reabrir el conteo se empieza limpio, como los demás filtros del bloque.
ok('al reabrir el conteo no quedan exclusiones viejas', /setMaqExcluidas\(new Set\(\)\); setMaqOpen\(false\)/.test(scr));

// ── 7) EL MANUAL CUENTA LO MISMO ───────────────────────────────────────────
const md = leer('docs/MANUAL-USUARIO.md');
const ms = leer('src/screens/ManualScreen.tsx');
ok('el manual .md explica escoger máquinas', /Escoger máquinas \(11\/09\/2026\)/.test(md));
// Lo que NO se puede omitir del manual: que el papel avisa, y que ese aviso no se
// puede apagar. Es la diferencia entre un conteo de una selección y uno que miente.
ok('el manual .md dice que el PDF avisa que le faltan equipos',
  /El PDF avisa que le faltan equipos/.test(md));
ok('el manual .md dice que ese aviso no se puede apagar',
  /no se puede apagar\*\* con las pastillas/.test(md));
ok('el manual en pantalla lo explica', /ESCOGER MÁQUINAS SUELTAS \(11\/09\/2026\)/.test(ms));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-conteo-seleccion-maquinas · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
