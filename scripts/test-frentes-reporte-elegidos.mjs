/*
 * ════════════════════════════════════════════════════════════════════════════
 * ⛏️ EL REPORTE POR LOS FRENTES QUE YO ELIJA — 06-oct-2026.
 *
 * Pedido del cliente, textual:
 *   «En reportes/ frentes, hace falta la opción de poder sacar el reporte por
 *    uno o varios frentes que yo seleccione o que quiera que salgan en el
 *    reporte»
 *
 * ── LO QUE FIJA ────────────────────────────────────────────────────────────
 * ⭐ VACÍO = TODOS. Quien no toque esta opción tiene que sacar EXACTAMENTE la
 *    hoja de siempre. Una opción nueva que le cambia el papel al que no la usó
 *    es una regresión disfrazada de función.
 *
 * ⭐ EL FILTRO VIVE EN `frentesParaReporte`, el único sitio por donde pasan la
 *    prevista del tablero Y el PDF. Si cada uno filtrara por su cuenta, la
 *    pantalla enseñaría el resumen de ocho frentes y el papel saldría con dos.
 *
 * ⚠️ TAPA TAMBIÉN LOS FRENTES VACÍOS. «Incluir los frentes sin camiones» no
 *    puede colar los otros siete en blanco cuando pediste solo uno.
 *
 * ⚠️ EL NOMBRE DEL ARCHIVO LO DICE, EL PAPEL NO. Es la regla que el cliente
 *    pidió el 29-sep («si activo o desactivo un check, no me salga esa
 *    información en el PDF») y el mismo remate del inventario: la hoja se lee
 *    limpia y lo único que avisa que va recortada es cómo se llama el archivo.
 *    Sin eso, la hoja de dos frentes PISA en la carpeta de descargas a la del
 *    día completo, y se abre creyendo que están todos.
 *
 *   node scripts/test-frentes-reporte-elegidos.mjs
 * ════════════════════════════════════════════════════════════════════════════
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
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const R = cargar('src/lib/frentesReporte.ts');
const {
  frentesParaReporte, FRENTES_POR_DEFECTO, claveFrente, frentesElegidos,
  alcanceFrentesEnPalabras, nombreArchivoFrentes, totalesFrentes,
} = R;

const cam = (code) => ({ code });
const ASIGS = [
  { frenteNombre: 'Frente norte', camion: cam('V-01') },
  { frenteNombre: 'Frente norte', camion: cam('V-02') },
  { frenteNombre: 'Frente sur', camion: cam('V-03') },
  { frenteNombre: 'Cerro alto', camion: cam('V-04') },
];
const ACTIVOS = ['Frente norte', 'Frente sur', 'Cerro alto', 'Frente vacío'];
const soloCon = (lista, extra = {}) => ({ ...FRENTES_POR_DEFECTO, soloFrentes: lista, ...extra });
const nombres = (g) => g.map((x) => x.nombre);

// ── 1) VACÍO = TODOS (la hoja de siempre) ───────────────────────────────────
eq('⭐ sin elegir ninguno salen todos los asignados',
  nombres(frentesParaReporte(ASIGS, ACTIVOS, FRENTES_POR_DEFECTO)),
  ['Cerro alto', 'Frente norte', 'Frente sur']);
eq('⭐ una lista vacía es lo mismo que no poner nada',
  nombres(frentesParaReporte(ASIGS, ACTIVOS, soloCon([]))),
  nombres(frentesParaReporte(ASIGS, ACTIVOS, FRENTES_POR_DEFECTO)));
eq('sin opciones tampoco cambia', nombres(frentesParaReporte(ASIGS, ACTIVOS)),
  ['Cerro alto', 'Frente norte', 'Frente sur']);

// ── 2) UNO O VARIOS ─────────────────────────────────────────────────────────
eq('⭐ UN frente elegido: sale solo ese',
  nombres(frentesParaReporte(ASIGS, ACTIVOS, soloCon(['Frente norte']))), ['Frente norte']);
eq('⭐ VARIOS: salen esos y en orden alfabético',
  nombres(frentesParaReporte(ASIGS, ACTIVOS, soloCon(['Frente sur', 'Cerro alto']))),
  ['Cerro alto', 'Frente sur']);
eq('⭐ y se lleva SUS camiones, no los de los otros',
  frentesParaReporte(ASIGS, ACTIVOS, soloCon(['Frente norte']))[0].camiones.map((c) => c.code),
  ['V-01', 'V-02']);
eq('los totales cuadran con lo filtrado',
  totalesFrentes(frentesParaReporte(ASIGS, ACTIVOS, soloCon(['Frente norte']))),
  { frentes: 1, frentesConCamiones: 1, camiones: 2 });
// El nombre se reconoce aunque esté escrito con otras mayúsculas o espacios.
eq('no distingue mayúsculas ni espacios de sobra',
  nombres(frentesParaReporte(ASIGS, ACTIVOS, soloCon(['  frente   NORTE '])))
  , ['Frente norte']);
eq('un frente que no existe deja el reporte vacío (no inventa)',
  nombres(frentesParaReporte(ASIGS, ACTIVOS, soloCon(['No existe']))), []);
// Los viajes sin frente se agrupan como «Sin frente»: también se puede pedir.
eq('⭐ «Sin frente» también se puede elegir',
  nombres(frentesParaReporte([{ frenteNombre: '', camion: cam('V-09') }], ACTIVOS, soloCon(['Sin frente']))),
  ['Sin frente']);

// ── 3) TAPA TAMBIÉN LOS FRENTES VACÍOS ──────────────────────────────────────
eq('con «incluir los vacíos» y sin filtro salen todos los activos',
  nombres(frentesParaReporte(ASIGS, ACTIVOS, soloCon([], { sinCamiones: true }))),
  ['Cerro alto', 'Frente norte', 'Frente sur', 'Frente vacío']);
eq('⚠️ con filtro, «incluir los vacíos» NO cuela los otros',
  nombres(frentesParaReporte(ASIGS, ACTIVOS, soloCon(['Frente norte'], { sinCamiones: true }))),
  ['Frente norte']);
eq('⭐ se puede pedir un frente vacío a propósito',
  nombres(frentesParaReporte(ASIGS, ACTIVOS, soloCon(['Frente vacío'], { sinCamiones: true }))),
  ['Frente vacío']);

// ── 4) CÓMO SE DICE ─────────────────────────────────────────────────────────
eq('sin filtro no hay nada que decir', alcanceFrentesEnPalabras(FRENTES_POR_DEFECTO, 8), null);
eq('⭐ con uno lo nombra', alcanceFrentesEnPalabras(soloCon(['Frente norte']), 8), 'solo 1 de 8 frente: Frente norte');
eq('con varios los nombra', alcanceFrentesEnPalabras(soloCon(['A', 'B']), 8), 'solo 2 de 8 frentes: A · B');
eq('con muchos no tapa el renglón: solo cuenta',
  alcanceFrentesEnPalabras(soloCon(['A', 'B', 'C', 'D', 'E']), 8), 'solo 5 de 8 frentes');
eq('si se eligieron TODOS no dice «de N» (no sobra la cuenta)',
  alcanceFrentesEnPalabras(soloCon(['A', 'B']), 2), 'solo 2 frentes: A · B');

// ── 5) EL NOMBRE DEL ARCHIVO ────────────────────────────────────────────────
eq('sin filtro, el nombre de siempre',
  nombreArchivoFrentes('2026-10-06'), 'Frentes de trabajo 2026-10-06');
eq('⭐ con filtro, el archivo lo dice (si no, pisa al del día completo)',
  nombreArchivoFrentes('2026-10-06', soloCon(['Frente norte'])),
  'Frentes de trabajo 2026-10-06 - solo Frente norte');
eq('con varios, los nombra', nombreArchivoFrentes('2026-10-06', soloCon(['A', 'B'])),
  'Frentes de trabajo 2026-10-06 - solo A, B');
eq('con muchos, los cuenta', nombreArchivoFrentes('2026-10-06', soloCon(['A', 'B', 'C', 'D'])),
  'Frentes de trabajo 2026-10-06 - solo 4 frentes');
// ⚠️ Un nombre de frente con / o : rompería el guardado del archivo.
eq('⚠️ los signos que rompen un nombre de archivo se limpian',
  nombreArchivoFrentes('2026-10-06', soloCon(['Norte/Sur: 1'])),
  'Frentes de trabajo 2026-10-06 - solo Norte Sur 1');

// ── 6) LA CLAVE ─────────────────────────────────────────────────────────────
eq('la clave ignora mayúsculas y espacios', claveFrente('  Frente   NORTE '), 'frente norte');
eq('nada es nada', claveFrente(null), '');
eq('los elegidos se guardan sin repetir',
  frentesElegidos(soloCon(['Norte', 'NORTE', ' norte '])).size, 1);
eq('sin opciones, ningún elegido', frentesElegidos(null).size, 0);

// ── 7) LA PANTALLA ──────────────────────────────────────────────────────────
const ui = sinComentarios(leer('src/components/FrentesTrabajo.tsx'));
ok('⭐ hay un selector de frentes para el reporte', /Por cuáles frentes sale el reporte/.test(ui));
ok('⭐ se marcan varios (es un Set, no uno solo)',
  /soloFrentes, setSoloFrentes\] = useState<Set<string>>/.test(ui));
ok('⭐ el botón «Todos» limpia la selección', /setSoloFrentes\(new Set\(\)\)/.test(ui));
ok('⭐ la elección viaja en las opciones del papel', /soloFrentes: Array\.from\(soloFrentes\)/.test(ui));
// ⚠️ Si el PDF y la prevista no usaran el MISMO opPapel, la pantalla enseñaría
//    un resumen de ocho frentes y el papel saldría con dos.
eq('⚠️ la prevista y el PDF filtran con lo mismo',
  (ui.match(/frentesParaReporte\([\s\S]{0,1200}?opPapel,/g) || []).length, 2);
ok('⭐ el nombre del archivo lleva el alcance', /nombreArchivoFrentes\(fecha, opPapel\)/.test(ui));
// ⚠️ La regla del 29-sep: el papel NO dice lo que se filtró.
ok('⚠️ el subtítulo del papel sigue sin decirlo',
  !/subtitle:[^\n]*alcanceFrentesEnPalabras/.test(ui));
ok('⭐ al cambiar de día se vuelve a «todos» (los frentes de ayer no son los de hoy)',
  /diaEditado\.current = fecha;[\s\S]{0,200}?setSoloFrentes\(new Set\(\)\)/.test(ui));
ok('avisa si lo marcado no tiene nada ese día', /el reporte saldría vacío/.test(ui));

console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('El reporte sale por los frentes que elijas; sin elegir ninguno, sale como siempre.');
