/*
 * LOS FILTROS DE LA LISTA COMPLETA DE VIAJES (22-ago-2026).
 *
 * Lo que fijan estos casos es UNA sola cosa, dicha de varias maneras: el numero
 * que sale en el chip tiene que ser el numero de viajes que van a salir abajo.
 * Antes no lo era — los contadores se calculaban sobre el rango de fechas
 * entero, ignorando los otros filtros marcados, asi que con un listero marcado
 * los chips de empresa seguian mostrando el total de TODOS los listeros.
 *
 *   node scripts/test-viajes-filtros.mjs
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

const srcPath = path.join(ROOT, 'src/lib/viajesFiltros.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const { pasaFiltros, opcionesDeEje, marcadosFueraDelRango, etiquetaRangoViajes } = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};

const cmp = (a, b) => String(a).localeCompare(String(b), 'es');
// Lo marcado va en Map id->etiqueta: la etiqueta es lo unico que permite
// dibujar el chip de algo que ya no aparece en ningun viaje del rango.
const mk = (ids) => new Map(ids.map((id) => [id, id]));
const sel = (l = [], e = [], c = []) => ({ listero: mk(l), empresa: mk(e), camion: mk(c) });
const clavesDe = (r) => ({ listero: r.listero, empresa: r.empresa, camion: r.camion });
const opcionEn = (eje) => (r) => ({ id: r[eje], label: r[eje] });
const opts = (rows, eje, s) => opcionesDeEje(rows, eje, clavesDe, opcionEn(eje), s, cmp);
const conteo = (rows, eje, s) => Object.fromEntries(opts(rows, eje, s).map((o) => [o.id, o.count]));
const visibles = (rows, eje, s) => opts(rows, eje, s).map((o) => o.id);
/** Lo que realmente termina en la lista de abajo y en el PDF. */
const listados = (rows, s) => rows.filter((r) => pasaFiltros(clavesDe(r), s)).length;
const suma = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// Un dia cualquiera: 2 listeros, 2 empresas, 3 camiones.
const v = (listero, empresa, camion) => ({ listero, empresa, camion });
const ROWS = [
  v('ely', 'beraca', 'c1'), v('ely', 'beraca', 'c1'), v('ely', 'beraca', 'c2'),
  v('ely', 'savanna', 'c3'),
  v('arcy', 'beraca', 'c1'),
  v('arcy', 'savanna', 'c3'), v('arcy', 'savanna', 'c3'),
];
// ely: 4 (beraca 3, savanna 1) - arcy: 3 (beraca 1, savanna 2)
// beraca: 4 - savanna: 3 - c1: 3 - c2: 1 - c3: 3

// -- 1) SIN NADA MARCADO: los contadores son el rango entero -----------------
eq('listeros sin filtros', conteo(ROWS, 'listero', sel()), { arcy: 3, ely: 4 });
eq('empresas sin filtros', conteo(ROWS, 'empresa', sel()), { beraca: 4, savanna: 3 });
eq('camiones sin filtros', conteo(ROWS, 'camion', sel()), { c1: 3, c2: 1, c3: 3 });
eq('los tres ejes suman el mismo total',
  [suma(conteo(ROWS, 'listero', sel())), suma(conteo(ROWS, 'empresa', sel())), suma(conteo(ROWS, 'camion', sel()))],
  [ROWS.length, ROWS.length, ROWS.length]);

// -- 2) EL BUG: con un listero marcado, los otros ejes tienen que bajar ------
const soloEly = sel(['ely']);
eq('* empresas con ELY marcado', conteo(ROWS, 'empresa', soloEly), { beraca: 3, savanna: 1 });
eq('* camiones con ELY marcado', conteo(ROWS, 'camion', soloEly), { c1: 2, c2: 1, c3: 1 });
// Y el propio eje NO se filtra a si mismo: si no, arcy caeria a 0 y no habria
// forma de comparar ni de marcarlo tambien.
eq('* el eje marcado se sigue viendo entero', conteo(ROWS, 'listero', soloEly), { arcy: 3, ely: 4 });
eq('* el chip de empresa coincide con lo que se lista',
  conteo(ROWS, 'empresa', soloEly).beraca, listados(ROWS, sel(['ely'], ['beraca'])));

// -- 3) DOS EJES A LA VEZ ---------------------------------------------------
const elyEnBeraca = sel(['ely'], ['beraca']);
eq('camiones con ELY + BERACA', conteo(ROWS, 'camion', elyEnBeraca), { c1: 2, c2: 1 });
eq('el chip del camion coincide con lo listado',
  conteo(ROWS, 'camion', elyEnBeraca).c1, listados(ROWS, sel(['ely'], ['beraca'], ['c1'])));
eq('c3 desaparece de camiones (ELY no lo uso en BERACA)', visibles(ROWS, 'camion', elyEnBeraca), ['c1', 'c2']);

// Marcar DOS opciones del mismo eje suma, no resta.
eq('dos listeros marcados = todo', listados(ROWS, sel(['ely', 'arcy'])), 7);
eq('dos empresas marcadas = todo', listados(ROWS, sel([], ['beraca', 'savanna'])), 7);

// -- 4) UNA OPCION MARCADA NUNCA DESAPARECE, AUNQUE CAIGA A 0 ---------------
// Si desapareciera, quedaria un filtro activo invisible: lista vacia y sin
// manera de saber que la esta tapando.
const c3ConEly = sel(['ely'], ['beraca'], ['c3']);
eq('* el camion marcado sigue visible con cuenta 0', conteo(ROWS, 'camion', c3ConEly).c3, 0);
eq('* y se puede desmarcar porque el chip esta ahi', visibles(ROWS, 'camion', c3ConEly).includes('c3'), true);
eq('* la lista queda vacia, coherente con el 0', listados(ROWS, c3ConEly), 0);
// Ojo: aca NINGUNO de los tres sobra por si solo (ely, beraca y c3 existen en
// el rango); lo que no existe es la COMBINACION. El aviso no debe senalar a uno.
eq('* una combinacion imposible no culpa a ningun filtro suelto',
  marcadosFueraDelRango(ROWS, clavesDe, c3ConEly), []);

// El caso de cambiar de dia: quedo marcado un listero que ese dia no trabajo.
const otroDia = [v('arcy', 'beraca', 'c1')];
const marcadoElyOtroDia = sel(['ely']);
eq('* el listero marcado que no trabajo ese dia NO se pierde de la vista',
  visibles(otroDia, 'listero', marcadoElyOtroDia), ['arcy', 'ely']);
eq('* y sale en 0', conteo(otroDia, 'listero', marcadoElyOtroDia).ely, 0);
eq('* con la lista vacia', listados(otroDia, marcadoElyOtroDia), 0);
eq('* y el aviso dice CUAL filtro sobra', marcadosFueraDelRango(otroDia, clavesDe, marcadoElyOtroDia), ['ely']);
eq('* sin filtros no hay nada que avisar', marcadosFueraDelRango(otroDia, clavesDe, sel()), []);
eq('* y el aviso dice CUAL filtro sobra', marcadosFueraDelRango(otroDia, clavesDe, marcadoElyOtroDia), ['ely']);
eq('* sin filtros no hay nada que avisar', marcadosFueraDelRango(otroDia, clavesDe, sel()), []);

// -- 5) BORDES --------------------------------------------------------------
eq('sin viajes no hay opciones', opts([], 'listero', sel()), []);
eq('sin viajes tampoco revienta el listado', listados([], sel(['ely'])), 0);
eq('un solo viaje', conteo([v('ely', 'beraca', 'c1')], 'listero', sel()), { ely: 1 });
// Orden: por etiqueta, con el comparador de la app (arcy antes que ely).
eq('las opciones salen ordenadas por nombre', visibles(ROWS, 'listero', sel()), ['arcy', 'ely']);
// Claves vacias (empresa sin asignar) se tratan como una mas, no se pierden.
const conSinEmpresa = [...ROWS, v('ely', '__sin_empresa__', 'c9')];
eq('«sin empresa» es una opcion mas', conteo(conSinEmpresa, 'empresa', sel()).__sin_empresa__, 1);
eq('y filtra bien', listados(conSinEmpresa, sel([], ['__sin_empresa__'])), 1);

// -- 6) INVARIANTE GENERAL: chip == lista, para TODA combinacion -------------
// Barrido a fuerza bruta: para cada eje y cada opcion, marcar esa opcion y
// comprobar que la lista de abajo trae exactamente lo que decia el chip.
let descuadres = 0;
const combos = [sel(), sel(['ely']), sel(['arcy']), sel([], ['beraca']), sel([], ['savanna']),
  sel([], [], ['c1']), sel(['ely'], ['beraca']), sel(['arcy'], ['savanna']), sel(['ely'], [], ['c3'])];
for (const base of combos) {
  for (const eje of ['listero', 'empresa', 'camion']) {
    for (const o of opts(ROWS, eje, base)) {
      // Marcar SOLO esa opcion en su eje, dejando los otros ejes como estaban.
      const s = { ...base, [eje]: new Set([o.id]) };
      if (listados(ROWS, s) !== o.count) descuadres++;
    }
  }
}
eq('* ningun chip miente, en ninguna combinacion', descuadres, 0);

// -- 7) COMO SE NOMBRA EL RANGO EN EL ENCABEZADO DEL PDF ---------------------
// Un encabezado que dice «del 5 al 22» sobre un reporte que trae 2 dias hace
// leer 18 jornadas donde hay 2: el total parece un desastre operativo.
const dmy = (iso) => { const [y, mm, d] = String(iso).split('-'); return `${d}/${mm}/${y}`; };
const et = (porDias, desde, hasta, dias = []) => etiquetaRangoViajes(porDias, desde, hasta, dias, dmy);

eq('un solo dia no se dice dos veces', et(false, '2026-08-22', '2026-08-22'), '22/08/2026');
eq('un rango de verdad si es «al»', et(false, '2026-08-18', '2026-08-22'), '18/08/2026 al 22/08/2026');
eq('* dias sueltos NO se dicen como rango',
  et(true, '2026-08-05', '2026-08-22', ['2026-08-05', '2026-08-22']),
  '2 jornadas sueltas: 05/08/2026, 22/08/2026');
eq('* y nunca aparece la palabra «al» ahi',
  et(true, '2026-08-05', '2026-08-22', ['2026-08-05', '2026-08-22']).includes(' al '), false);
eq('un dia marcado se dice pelado', et(true, '2026-08-22', '2026-08-22', ['2026-08-22']), '22/08/2026');
eq('ningun dia marcado se dice', et(true, '2026-08-22', '2026-08-22', []), 'sin días marcados');
eq('los dias salen ordenados aunque se marquen al reves',
  et(true, '2026-08-05', '2026-08-22', ['2026-08-22', '2026-08-05']),
  '2 jornadas sueltas: 05/08/2026, 22/08/2026');
eq('con muchos dias se dice la cantidad y los extremos',
  et(true, '2026-08-01', '2026-08-12', ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04',
    '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-12']),
  '9 jornadas sueltas entre 01/08/2026 y 12/08/2026');
eq('ocho dias todavia se listan uno por uno',
  et(true, '2026-08-01', '2026-08-08', ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04',
    '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08']).startsWith('8 jornadas sueltas: '), true);

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-filtros · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
