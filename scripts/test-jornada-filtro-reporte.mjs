/*
 * Test del FILTRO POR CLASIFICACIÓN Y POR MÁQUINA del Informe por jornada (22-sep-2026).
 *
 * Pedido del cliente: «poder filtrar por categoría, por maquinaria en específico; está
 * actualmente solo para filtrar por empresa». Lo que se fija acá y por qué duele:
 *   · vacío = todas (el papel de siempre no cambia ni un número)
 *   · la máquina se elige por `id`, NUNCA por código (hay tres RETROEXCAVADORA)
 *   · clasificación y máquina se CRUZAN
 *   · con el filtro puesto no salen fletes ni abonos (son de la empresa entera) y el
 *     papel lo dice en el subtítulo y en el nombre del archivo
 *   · la pantalla usa la librería y no se inventa sus reglas
 *
 *   node scripts/test-jornada-filtro-reporte.mjs
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

const loadTs = (rel) => {
  const abs = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs)); m._compile(out, abs);
  return m.exports;
};
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado ${b}\n    obtenido ${a}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const F = loadTs('src/lib/jornadaFiltroReporte.ts');
ok('la librería no importa nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/jornadaFiltroReporte.ts'))));

const cat = [
  { id: 'r1', code: 'RETROEXCAVADORA', plate: 'AA1', serial: null, clasificacion: 'Movimiento de tierra', company: 'EMPRESA ALFA', activa: true },
  { id: 'r2', code: 'RETROEXCAVADORA', plate: 'AA2', serial: null, clasificacion: 'Movimiento de tierra', company: 'EMPRESA BETA', activa: true },
  { id: 'r3', code: 'RETROEXCAVADORA', plate: null, serial: 'S-3', clasificacion: 'Movimiento de tierra', company: 'EMPRESA ALFA', activa: false },
  { id: 'v1', code: 'CAMION VOLTEO', plate: 'BB1', serial: null, clasificacion: 'Transporte', company: 'EMPRESA ALFA', activa: true },
  { id: 'x1', code: 'COMPRESOR', plate: null, serial: null, clasificacion: 'Sin clasificación', company: 'EMPRESA BETA', activa: true },
];

// ── 1) VACÍO = TODAS ─────────────────────────────────────────────────────────
{
  ok('⭐ sin filtro entra todo', cat.every((m) => F.pasaFiltroJornada(m, F.FILTRO_JORNADA_TODO)));
  ok('null también es «todo»', F.pasaFiltroJornada(cat[0], null) && F.pasaFiltroJornada(cat[0], undefined));
  eq('no hay filtro', F.hayFiltroJornada(F.FILTRO_JORNADA_TODO), false);
  eq('...ni alcance que decir', F.alcanceFiltroJornada(F.FILTRO_JORNADA_TODO, () => 'x'), '');
  eq('...ni sufijo en el archivo', F.sufijoArchivoFiltroJornada(F.FILTRO_JORNADA_TODO), '');
}

// ── 2) POR MÁQUINA: POR ID, NUNCA POR CÓDIGO ─────────────────────────────────
{
  const f = { clasificaciones: [], maquinas: ['r2'] };
  eq('⭐ una RETROEXCAVADORA elegida no arrastra a las otras dos', cat.filter((m) => F.pasaFiltroJornada(m, f)).map((m) => m.id), ['r2']);
  ok('el id se compara limpio', F.pasaFiltroJornada({ id: ' r2 ', clasificacion: 'x' }, f));
  eq('dos máquinas', cat.filter((m) => F.pasaFiltroJornada(m, { clasificaciones: [], maquinas: ['r1', 'v1'] })).map((m) => m.id), ['r1', 'v1']);
}

// ── 3) POR CLASIFICACIÓN, Y CRUZADA CON MÁQUINA ──────────────────────────────
{
  const f = { clasificaciones: ['Transporte'], maquinas: [] };
  eq('solo esa clasificación', cat.filter((m) => F.pasaFiltroJornada(m, f)).map((m) => m.id), ['v1']);
  ok('mayúsculas y espacios no importan', F.pasaFiltroJornada({ id: 'z', clasificacion: '  transporte ' }, f));
  eq('«Sin clasificación» también se puede elegir (vacía = sin clasificación)', cat.filter((m) => F.pasaFiltroJornada({ id: m.id, clasificacion: m.clasificacion === 'Sin clasificación' ? '' : m.clasificacion }, { clasificaciones: ['Sin clasificación'], maquinas: [] })).map((m) => m.id), ['x1']);
  eq('⭐ clasificación Y máquina se cruzan: una máquina de otra clasificación no entra', cat.filter((m) => F.pasaFiltroJornada(m, { clasificaciones: ['Transporte'], maquinas: ['r1'] })).length, 0);
  eq('...y si es de esa clasificación, entra', cat.filter((m) => F.pasaFiltroJornada(m, { clasificaciones: ['Transporte'], maquinas: ['v1'] })).map((m) => m.id), ['v1']);
}

// ── 4) LO QUE SE OFRECE PARA MARCAR ──────────────────────────────────────────
{
  eq('clasificaciones con su cantidad, «Sin clasificación» al final', F.clasificacionesDisponibles(cat, []), [{ name: 'Movimiento de tierra', count: 3 }, { name: 'Transporte', count: 1 }, { name: 'Sin clasificación', count: 1 }]);
  eq('⭐ acotadas a las empresas marcadas', F.clasificacionesDisponibles(cat, ['EMPRESA BETA']), [{ name: 'Movimiento de tierra', count: 1 }, { name: 'Sin clasificación', count: 1 }]);
  eq('máquinas de la empresa, por código y placa', F.maquinasDisponibles(cat, ['EMPRESA ALFA'], [], '').map((m) => m.id), ['v1', 'r1', 'r3']);
  eq('...acotadas a la clasificación marcada', F.maquinasDisponibles(cat, [], ['Movimiento de tierra'], '').map((m) => m.id), ['r1', 'r2', 'r3']);
  eq('⭐ el buscador encuentra por placa y por serial', [F.maquinasDisponibles(cat, [], [], 'aa2').map((m) => m.id), F.maquinasDisponibles(cat, [], [], 's-3').map((m) => m.id)], [['r2'], ['r3']]);
  eq('etiqueta: código · placa (o serial)', [F.etiquetaMaquinaJornada(cat[0]), F.etiquetaMaquinaJornada(cat[2]), F.etiquetaMaquinaJornada(cat[4])], ['RETROEXCAVADORA · AA1', 'RETROEXCAVADORA · S-3', 'COMPRESOR']);
  eq('⭐ lo marcado que ya no está en el alcance deja de filtrar', F.acotarFiltroJornada({ clasificaciones: ['Transporte', 'Fantasma'], maquinas: ['r2', 'v1', 'zz'] }, cat, ['EMPRESA ALFA']), { clasificaciones: ['Transporte'], maquinas: ['v1'] });
}

// ── 5) EL PAPEL LO DICE ──────────────────────────────────────────────────────
{
  const nombre = (id) => ({ r1: 'RETROEXCAVADORA · AA1', v1: 'CAMION VOLTEO · BB1' })[id] || id;
  const a = F.alcanceFiltroJornada({ clasificaciones: ['Transporte'], maquinas: ['v1'] }, nombre);
  ok('⭐ dice FILTRADO, qué, y que no lleva fletes ni abonos', /FILTRADO POR EQUIPO/.test(a) && /Clasificación: Transporte/.test(a) && /Máquinas: CAMION VOLTEO · BB1/.test(a) && /sin fletes ni abonos/.test(a));
  ok('con muchas máquinas, cuenta en vez de listar', /Máquinas: 5 elegidas/.test(F.alcanceFiltroJornada({ clasificaciones: [], maquinas: ['a', 'b', 'c', 'd', 'e'] }, nombre)));
  eq('sufijo del archivo: una clasificación, por su nombre', F.sufijoArchivoFiltroJornada({ clasificaciones: ['Transporte'], maquinas: [] }), ' - Transporte');
  eq('...varias, contadas; y las máquinas, contadas', F.sufijoArchivoFiltroJornada({ clasificaciones: ['A', 'B'], maquinas: ['x'] }), ' - 2 clasificaciones - 1 maquina(s)');
  ok('el nombre del archivo no lleva barras ni dos puntos', !/[\\/:]/.test(F.sufijoArchivoFiltroJornada({ clasificaciones: ['A/B: C'], maquinas: [] })));
}

// ── 6) LA PANTALLA USA LA LIBRERÍA ───────────────────────────────────────────
{
  const p = sinComentarios(leer('src/screens/ReportsScreen.tsx'));
  ok('⭐ las máquinas que trabajaron pasan por el filtro', /accs\.forEach\(\(a, key\) => \{\s*if \(cos && !cos\.includes\(a\.company\)\) return;\s*if \(!encOk\(a\.encargado\)\) return;\s*if \(!pasaFiltroJornada\(\{ id: key, clasificacion: a\.clasificacion \}, filtroEq\)\) return;/.test(p));
  ok('⭐ las que NO trabajaron (averías, paradas, espera) también', /if \(!pasaFiltroJornada\(\{ id: it\.machineryId, clasificacion: it\.clasificacion \}, filtroEq\)\) return;/.test(p));
  ok('⭐ el estado de la flota respeta el mismo alcance', /pasaFiltroJornada\(\{ id: m\.id, clasificacion: m\.clasificacion \}, filtroEq\)/.test(p));
  ok('⭐ con el filtro puesto no entran fletes', /const fletesRows = hayFiltroJornada\(filtroEq\) \? \[\] : await selectAllRows\(\s*'fletes'/.test(p));
  ok('⭐ ...ni abonos', /const abonoRows = hayFiltroJornada\(filtroEq\) \? \[\] : await selectAllRows\('company_payments'/.test(p));
  ok('el subtítulo y el archivo del PDF llevan el alcance', /sufijoArchivoFiltroJornada\(filtroEqActual\)/.test(p) && /roundsFiltroEq \? ` · \$\{roundsFiltroEq\}` : ''/.test(p));
  ok('la pantalla ofrece clasificaciones y máquinas desde la librería', /clasificacionesDisponibles\(maqCatalogo, repCompanies\)/.test(p) && /maquinasDisponibles\(maqCatalogo, repCompanies, repClasif, repMaqQ\)/.test(p));
  ok('⭐ las máquinas se marcan por id', /setRepMaquinas\(\(prev\) => \(prev\.includes\(m\.id\)/.test(p));
  ok('al cambiar de empresa, lo marcado fuera del alcance se suelta', /acotarFiltroJornada\(\{ clasificaciones: repClasif, maquinas: repMaquinas \}, maqCatalogo, repCompanies\)/.test(p));
}

// ── 7) MANUALES ──────────────────────────────────────────────────────────────
{
  ok('manual (md)', /Filtrar el Informe por jornada por clasificación y por máquina \(22\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app)', /FILTRAR EL INFORME POR JORNADA POR CLASIFICACIÓN Y POR MÁQUINA \(22\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-jornada-filtro-reporte · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
