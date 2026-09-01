/*
 * LOS TRES INFORMES DE UBICACIONES TACTICAS (01-sep-2026).
 *
 * Pedido del cliente, textual: «Son tres informes. Uno, que tenga las maquinas
 * de Golden Touch y Liccione nada mas, que no tenga las de las empresas
 * subcontratadas. El otro, que tenga Golden Touch y Liccione pero que tambien
 * tenga las maquinas de las subcontratadas, sin su empresa subcontratada -- ese
 * ya es el que esta. Y el tercero, que las maquinas esten divididas por cada
 * empresa, que se muestren las subcontratadas.»
 *
 * Y la regla, confirmada por el: «subcontratada es simplemente todo lo que no
 * sea Liccione ni Golden Touch».
 *
 * EL PROBLEMA DE FONDO que esto resuelve: el reporte agrupaba en DOS sacos
 * fijos, y el segundo -- GOLDEN TOUCH -- se tragaba a TODAS las demas empresas.
 * O sea que el codigo no sabia distinguir Golden Touch de La Veglia: las metia
 * juntas. Por eso el informe 2 "ya era el que estaba" y el informe 1 era el
 * unico que necesitaba informacion nueva.
 *
 * Lo que fijan estos casos:
 *   - quien es propia y quien subcontratada, con las variantes de escritura
 *     reales ("LICCIONE C.A.", "Golden Touch, C.A.");
 *   - que "Sin empresa" NO cuenta como propia (es un cajon de sastre) y que va
 *     de ultimo en el orden;
 *   - LA INVARIANTE QUE MAS IMPORTA: que el filtro se aplique en UN SOLO punto,
 *     para que el resumen de arriba del PDF cuadre con la lista de abajo. Un
 *     papel que diga "296 equipos" arriba y liste 180 no se vuelve a creer;
 *   - que los tres PDF tengan NOMBRES DE ARCHIVO DISTINTOS: son tres papeles
 *     casi iguales y si dos se llaman igual, el segundo pisa al primero en la
 *     carpeta de descargas sin decir nada;
 *   - y que el boton real y el SIMULADO manden los dos el alcance escogido.
 *
 *   node scripts/test-reporte-tactico-tres-informes.mjs
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
const compilar = (p) => {
  if (cache.has(p)) return cache.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cache.set(p, m.exports);
  m._compile(js, m.filename);
  cache.set(p, m.exports);
  return m.exports;
};
const realLoad = Module._load;
Module._load = function (req, parent) {
  if (req.startsWith('.') && parent && String(parent.filename || '').endsWith('.ts')) {
    const cand = path.resolve(path.dirname(parent.filename), req);
    for (const p of [cand, cand + '.ts', path.join(cand, 'index.ts')]) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return compilar(p);
    }
  }
  return realLoad.apply(this, arguments);
};

const {
  ALCANCES, alcanceInfoDe, esEmpresaPropia, grupoDeEmpresa, nombreEmpresa,
  ordenGrupoEmpresa, ordenarGrupos, repartirPorAlcance, SIN_EMPRESA,
} = compilar(path.join(ROOT, 'src/lib/empresasPropias.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── 1) QUIEN ES NUESTRO ─────────────────────────────────────────────────────
ok('LICCIONE es propia', esEmpresaPropia('LICCIONE'));
ok('* con su razon social tambien', esEmpresaPropia('LICCIONE C.A.'));
ok('* en minusculas igual', esEmpresaPropia('liccione'));
ok('GOLDEN TOUCH es propia', esEmpresaPropia('GOLDEN TOUCH'));
ok('* con coma y razon social', esEmpresaPropia('Golden Touch, C.A.'));
ok('* aunque venga junta', esEmpresaPropia('GOLDENTOUCH'));

ok('LA VEGLIA es subcontratada', !esEmpresaPropia('LA VEGLIA'));
ok('* COSTA BRAVA tambien', !esEmpresaPropia('COSTA BRAVA'));
ok('* y cualquier otra que venga', !esEmpresaPropia('CONSTRUCTORA X'));
// El cajon de sastre NO es una empresa nuestra: una maquina sin empresa cargada
// no puede colarse en el informe de "solo las nuestras".
ok('"Sin empresa" NO es propia', !esEmpresaPropia(SIN_EMPRESA));
ok('* ni el vacio', !esEmpresaPropia('') && !esEmpresaPropia('   '));
ok('* ni null ni undefined', !esEmpresaPropia(null) && !esEmpresaPropia(undefined));

// De donde sale el nombre.
eq('el nombre sale de company.name', nombreEmpresa({ company: { name: '  LA VEGLIA  ' } }), 'LA VEGLIA');
eq('* sin empresa, el cajon de sastre', nombreEmpresa({ company: null }), SIN_EMPRESA);
eq('* una maquina rota tampoco revienta', nombreEmpresa(undefined), SIN_EMPRESA);

// ── 2) EN QUE SECCION CAE ───────────────────────────────────────────────────
eq('juntas: Liccione a su saco', grupoDeEmpresa('LICCIONE C.A.', 'juntas'), 'LICCIONE');
eq('* y TODO lo demas al de Golden', grupoDeEmpresa('LA VEGLIA', 'juntas'), 'GOLDEN TOUCH');
eq('* incluso las sin empresa', grupoDeEmpresa(SIN_EMPRESA, 'juntas'), 'GOLDEN TOUCH');
// Es exactamente el informe 2, el de siempre: la subcontratada sale, pero
// disfrazada de Golden Touch. Por eso el cliente dice "ese ya es el que esta".
eq('propias: los mismos dos sacos', grupoDeEmpresa('GOLDEN TOUCH', 'propias'), 'GOLDEN TOUCH');
// En `propias` La Veglia ya no esta en la lista, asi que ese saco trae SOLO
// Golden Touch de verdad. La funcion no filtra: filtra `repartirPorAlcance`.
eq('porEmpresa: cada quien con su nombre', grupoDeEmpresa('LA VEGLIA', 'porEmpresa'), 'LA VEGLIA');
eq('* y Liccione con el suyo', grupoDeEmpresa('LICCIONE C.A.', 'porEmpresa'), 'LICCIONE C.A.');

// ── 3) EL ORDEN DE LAS SECCIONES ────────────────────────────────────────────
eq('las nuestras primero, el cajon de sastre al final',
  ordenarGrupos(['COSTA BRAVA', SIN_EMPRESA, 'GOLDEN TOUCH', 'LA VEGLIA', 'LICCIONE']),
  ['LICCIONE', 'GOLDEN TOUCH', 'COSTA BRAVA', 'LA VEGLIA', SIN_EMPRESA]);
eq('* Liccione antes que Golden', ordenGrupoEmpresa('LICCIONE') < ordenGrupoEmpresa('GOLDEN TOUCH'), true);
eq('* y las dos antes que una subcontratada', ordenGrupoEmpresa('GOLDEN TOUCH') < ordenGrupoEmpresa('AAA CONSTRUCTORA'), true);
eq('* "Sin empresa" de ultimo, aunque empiece con S', ordenGrupoEmpresa(SIN_EMPRESA) > ordenGrupoEmpresa('ZZZ CONSTRUCTORA'), true);
ok('no toca el arreglo que le pasan', (() => {
  const original = ['B', 'A'];
  ordenarGrupos(original);
  return original[0] === 'B';
})());

// ── 4) EL REPARTO, QUE ES LO QUE DECIDE LOS TRES INFORMES ───────────────────
const maq = (empresa, id) => ({ id, company: empresa ? { name: empresa } : null });
const universo = [
  maq('LICCIONE C.A.', 1), maq('LICCIONE C.A.', 2),
  maq('GOLDEN TOUCH', 3),
  maq('LA VEGLIA', 4), maq('LA VEGLIA', 5),
  maq('COSTA BRAVA', 6),
  maq(null, 7),
];

{
  const r = repartirPorAlcance(universo, 'propias', nombreEmpresa);
  eq('INFORME 1 · solo las nuestras: 3 de 7', r.list.map((m) => m.id), [1, 2, 3]);
  eq('* dice cuales entraron', r.empresasDentro, ['LICCIONE C.A.', 'GOLDEN TOUCH']);
  eq('* y cuales quedaron fuera', r.empresasFuera, ['COSTA BRAVA', 'LA VEGLIA', SIN_EMPRESA]);
}
{
  const r = repartirPorAlcance(universo, 'juntas', nombreEmpresa);
  eq('INFORME 2 · todas sin separar: no saca a nadie', r.list.length, universo.length);
  eq('* no deja a nadie fuera', r.empresasFuera, []);
  eq('* y lista las cinco empresas', r.empresasDentro.length, 5);
}
{
  const r = repartirPorAlcance(universo, 'porEmpresa', nombreEmpresa);
  eq('INFORME 3 · por empresa: tampoco saca a nadie', r.list.length, universo.length);
  eq('* no deja a nadie fuera', r.empresasFuera, []);
}

// LA INVARIANTE QUE MAS IMPORTA: dentro + fuera = todo. Si alguna empresa se
// pierde entre los dos lados, el pie del PDF miente sobre su propio alcance.
for (const a of ['propias', 'juntas', 'porEmpresa']) {
  const r = repartirPorAlcance(universo, a, nombreEmpresa);
  const todas = [...new Set(universo.map(nombreEmpresa))];
  eq(`${a}: dentro + fuera = todas las empresas`, r.empresasDentro.length + r.empresasFuera.length, todas.length);
  ok(`${a}: ninguna empresa esta en los dos lados`, !r.empresasDentro.some((c) => r.empresasFuera.includes(c)));
  ok(`${a}: la lista nunca crece`, r.list.length <= universo.length);
}
// Un universo vacio no puede reventar (catalogo sin cargar, consulta fallida).
{
  const r = repartirPorAlcance([], 'propias', nombreEmpresa);
  eq('con la flota vacia no revienta', [r.list.length, r.empresasDentro.length, r.empresasFuera.length], [0, 0, 0]);
}

// ── 5) LOS TRES PAPELES NO SE PISAN ─────────────────────────────────────────
eq('son exactamente tres informes', ALCANCES.length, 3);
eq('* con los ids acordados', ALCANCES.map((a) => a.id), ['propias', 'juntas', 'porEmpresa']);
ok('* todos con chip, nombre largo y nombre de archivo',
  ALCANCES.every((a) => a.chip && a.largo && a.archivo));
// Si dos se llaman igual, el segundo PDF pisa al primero en la carpeta de
// descargas y nadie se entera de que esta mirando el papel equivocado.
eq('* y los tres nombres de archivo son DISTINTOS', new Set(ALCANCES.map((a) => a.archivo)).size, 3);
eq('* igual que los nombres largos del subtitulo', new Set(ALCANCES.map((a) => a.largo)).size, 3);
// El de siempre es el que viene por defecto: quien no toque nada saca el mismo
// papel de ayer.
eq('un alcance desconocido cae en el de siempre', alcanceInfoDe('lo-que-sea').id, 'juntas');
eq('* y cada uno se encuentra a si mismo', ALCANCES.map((a) => alcanceInfoDe(a.id).id), ['propias', 'juntas', 'porEmpresa']);

// ── 6) LA PANTALLA LO USA DE VERDAD ─────────────────────────────────────────
const fuente = fs.readFileSync(path.join(ROOT, 'src/screens/ReportsScreen.tsx'), 'utf8');
// Ciego a comentarios: un comentario que nombre el alcance no puede hacer pasar
// una prueba que pregunta si el CODIGO lo usa.
const limpio = fuente.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const desde = limpio.indexOf('const downloadTacticalPdf');
// Hasta la FUNCION SIGUIENTE, no hasta una seccion del medio: el pie del
// alcance, el subtitulo y el nombre del archivo estan al final de todo, y una
// rebanada corta los dejaba afuera haciendo pasar las guardias por casualidad.
const hasta = limpio.indexOf('const downloadDetailPdf', desde);
const bloque = desde >= 0 && hasta > desde ? limpio.slice(desde, hasta) : '';
ok('el reporte tactico existe', desde >= 0 && bloque.length > 3000);
ok('* y la rebanada llega hasta el final de la funcion', bloque.includes('exportPdf(renaceShell'));

ok('recibe el alcance', /alcance: AlcanceEmpresas = 'juntas'/.test(bloque));
ok('* y reparte con la libreria', /repartirPorAlcance\(universo, alcance, nombreEmpresa\)/.test(bloque));
ok('* la regla ya no esta escrita a mano en la pantalla', !/liccion\|golden/i.test(limpio));

// EL FILTRO EN UN SOLO PUNTO. `universo` solo puede aparecer tres veces: donde
// se define, donde se reparte, y en el pie que dice "N de M de la flota". Una
// cuarta seria un resumen calculado sobre la flota entera dentro de un informe
// filtrado -- justo el "296 arriba, 180 abajo" que se quiere evitar.
eq('el universo sin filtrar solo se toca en 3 sitios', (bloque.match(/\buniverso\b/g) || []).length, 3);

ok('el agrupado pasa por la libreria', /grupoDeEmpresa\(companyOf\(m\), alcance\)/.test(bloque));
ok('* y el orden tambien', /ordenarGrupos\(\[\.\.\.groups\.keys\(\)\]\)/.test(bloque));
// El resumen de ARRIBA tiene que usar la misma lista de secciones que el
// listado de ABAJO, o en el informe 3 saldrian dos empresas arriba y ocho abajo.
ok('el resumen de arriba usa las mismas secciones', /<tbody>\$\{enteNames\.filter\(\(g\) => countByCo\.has\(g\)\)/.test(bloque));
ok('* ya no lleva los dos sacos fijos', !/\['LICCIONE', 'GOLDEN TOUCH'\]\.filter\(\(g\) => countByCo/.test(bloque));

// El pie que dice que entro y que quedo fuera: es la red de seguridad de toda
// la idea, porque "propia" se decide por un nombre que escribio una persona.
ok('el PDF imprime su propio alcance', /Alcance de este informe/.test(bloque));
ok('* con las empresas incluidas', /Empresas incluidas/.test(bloque) && /empresasDentro/.test(bloque));
ok('* y las dejadas fuera', /Empresas dejadas fuera/.test(bloque) && /empresasFuera/.test(bloque));
ok('* y va dentro del cuerpo del PDF', /\$\{alcanceHtml\}/.test(bloque));

ok('el subtitulo dice cual de los tres es', /\$\{subBase\} · \$\{alcanceInfo\.largo\}/.test(bloque));
ok('* y el nombre del archivo tambien', /Inventario de maquinaria \(\$\{alcanceInfo\.archivo\}\)/.test(bloque));

// ── 7) LOS BOTONES ──────────────────────────────────────────────────────────
// Un solo boton para los tres, y el simulado tiene que respetar lo escogido:
// si no, el chip diria una cosa y el papel traeria otra.
ok('el boton real manda el alcance', /downloadTacticalPdf\(tacConPersonal, false, tacAlcance\)/.test(limpio));
ok('* y el SIMULADO tambien', /downloadTacticalPdf\(tacConPersonal, true, tacAlcance\)/.test(limpio));
ok('* ya no queda ninguna llamada sin alcance', !/downloadTacticalPdf\(tacConPersonal\)\)/.test(limpio));
ok('los chips salen de la misma lista que el PDF', /ALCANCES\.map\(\(a\) =>/.test(limpio));
ok('* arrancan en el informe de siempre', /useState<AlcanceEmpresas>\('juntas'\)/.test(limpio));
// Que diga en criollo que va a salir ANTES de descargarlo.
ok('* y avisa que va a salir antes de bajarlo', /ALCANCES\.find\(\(a\) => a\.id === tacAlcance\)\?\.largo/.test(limpio));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-reporte-tactico-tres-informes · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
