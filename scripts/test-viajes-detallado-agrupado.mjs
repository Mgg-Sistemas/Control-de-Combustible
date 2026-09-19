/*
 * Test del DETALLADO PARTIDO POR EMPRESA / LISTERO / OBRA y de la pastilla «Todos»
 * (19-sep-2026).
 *
 * Pedido del cliente: que la lista completa de viajes se pueda sacar por empresa, por
 * obra o por listero, eligiendo todos o algunos en específico.
 *
 * Lo que ya estaba (y NO se tocó): las filas de filtros dejan marcar varias a la vez y
 * el PDF sale con lo marcado; el resumido y «solo camiones» ya se agrupaban.
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · partir el detallado no pierde ni repite un solo viaje: la suma de los grupos es el total
 *   · los grupos usan las MISMAS claves que los filtros y el resumido
 *   · «Sin empresa / listero / ubicación» van al final
 *   · el detallado tiene su PROPIO eje: haber mirado el resumido «por obra» no le quita
 *     la columna Obra al detallado sin agrupar
 *   · «Todos» limpia UNA fila, no las cinco
 *
 *   node scripts/test-viajes-detallado-agrupado.mjs
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

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function cargar(rel) {
  const p = path.join(ROOT, rel);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  m._compile(js, p);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const R = cargar('src/lib/viajesResumen.ts');

// ── 1) PARTIR NO PIERDE NI REPITE ────────────────────────────────────────────
const V = (id, emp, listero, obra) => ({ id, emp, listero, obra });
const viajes = [
  V(1, 'SAVANNA', 'Glender', 'Parque del Agua'),
  V(2, 'COSTA BRAVA', 'Glender', 'Parque del Agua'),
  V(3, 'SAVANNA', 'Julio', 'Playa Escondida'),
  V(4, null, 'Glender', null),
  V(5, 'COSTA BRAVA', 'Julio', 'Parque del Agua'),
  V(6, 'SAVANNA', 'Glender', 'Parque del Agua'),
];
const porEmpresa = (r) => (r.emp ? { key: r.emp, name: r.emp } : { key: R.SIN_EMPRESA, name: 'Sin empresa' });
const porObra = (r) => (r.obra ? { key: r.obra, name: r.obra } : { key: R.SIN_UBICACION, name: 'Sin ubicación' });
const porListero = (r) => ({ key: r.listero, name: r.listero });
{
  const g = R.agruparDetalle(viajes, porEmpresa);
  eq('⭐ por empresa: A→Z y «Sin empresa» al final', g.map((x) => x.name), ['COSTA BRAVA', 'SAVANNA', 'Sin empresa']);
  eq('cada grupo con sus viajes, en el orden en que venían', g.map((x) => x.filas.map((f) => f.id)), [[2, 5], [1, 3, 6], [4]]);
  eq('⭐ la suma de los grupos es el total', g.reduce((a, x) => a + x.filas.length, 0), viajes.length);
  const ids = g.flatMap((x) => x.filas.map((f) => f.id)).sort();
  eq('⭐ ni un viaje perdido ni repetido', ids, [1, 2, 3, 4, 5, 6]);

  const o = R.agruparDetalle(viajes, porObra);
  eq('por obra: «Sin ubicación» al final', o.map((x) => [x.name, x.filas.length]), [['Parque del Agua', 4], ['Playa Escondida', 1], ['Sin ubicación', 1]]);
  const l = R.agruparDetalle(viajes, porListero);
  eq('por listero', l.map((x) => [x.name, x.filas.length]), [['Glender', 4], ['Julio', 2]]);
}
{
  eq('sin viajes: sin grupos', R.agruparDetalle([], porEmpresa), []);
  eq('null: sin grupos', R.agruparDetalle(null, porEmpresa), []);
  // Dos empresas distintas con el mismo nombre NO se funden: manda la clave.
  const dos = R.agruparDetalle([{ id: 1 }, { id: 2 }], (r) => ({ key: 'k' + r.id, name: 'MGG' }));
  eq('⭐ agrupa por CLAVE, no por nombre', dos.length, 2);
  // Y la misma clave con nombre escrito distinto sigue siendo un solo grupo.
  const uno = R.agruparDetalle([{ id: 1, n: 'Savanna' }, { id: 2, n: 'SAVANNA ' }], (r) => ({ key: 'e1', name: r.n }));
  eq('misma clave = un grupo (con el primer nombre visto)', [uno.length, uno[0].name, uno[0].filas.length], [1, 'Savanna', 2]);
  eq('un nombre vacío no deja el título en blanco', R.agruparDetalle([{ id: 1 }], () => ({ key: 'x', name: '  ' }))[0].name, '—');
  // Filtrar primero y partir después: es lo que hace la pantalla.
  const soloDos = viajes.filter((v) => v.emp === 'SAVANNA' || v.emp === 'COSTA BRAVA');
  const g2 = R.agruparDetalle(soloDos, porObra);
  eq('⭐ dos empresas marcadas, partido por obra', g2.map((x) => [x.name, x.filas.map((f) => f.id)]), [['Parque del Agua', [1, 2, 5, 6]], ['Playa Escondida', [3]]]);
}

// ── 2) LA PANTALLA ───────────────────────────────────────────────────────────
const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
ok('el detallado tiene su propio eje y arranca sin agrupar', /const \[detalleEje, setDetalleEje\] = useState<EjeResumen \| 'ninguno'>\('ninguno'\)/.test(scr));
ok('⭐ parte las MISMAS filas filtradas de la lista', /agruparDetalle\(filteredRangeRows, \(r\) => grupoDeViaje\(r, detalleEje\)\)/.test(scr));
ok('⭐ la obra se agrupa con la misma clave que el filtro y el resumido', /if \(eje === 'ubicacion'\) \{\s*return \{\s*key: claveUbicacionViaje\(\{ ubicacionId: r\.ubicacionId, ubicacionName: r\.ubicacionNombre \}\)/.test(scr));
ok('...la empresa, con companyOfRow', /return companyOfRow\(r\);\s*\};/.test(scr));
ok('...el listero, por su id', /key: r\.listeroId \|\| SIN_LISTERO/.test(scr));
ok('el selector ofrece «Sin agrupar», empresa, listero y obra', /\['ninguno', '📄 Sin agrupar'\], \['empresa', '🏢 Empresa'\], \['listero', '👤 Listero'\], \['ubicacion', '🏗️ Obra'\]/.test(scr));
ok('la lista de la pantalla pinta el encabezado de cada grupo', /gruposDetalle\s*\?\s*gruposDetalle\.map\(\(g\) => \(/.test(scr) && /\{g\.filas\.length\} viaje\(s\)/.test(scr));
ok('...y sin agrupar sigue siendo la lista de siempre', /: filteredRangeRows\.map\(\(row\) => renderRow\(row, \{ canEdit: true, canDelete: true, showListero: true \}\)\)/.test(scr));

// El PDF.
ok('⭐ el PDF detallado usa SU eje, no el del resumido', /const ejeD: EjeResumen = detalleEje === 'ninguno' \? 'empresa' : detalleEje;\s*const colsD = columnasDetalle\(op, ejeD\);/.test(scr));
ok('...un título y una tabla por grupo, con su subtotal', /gruposDetalle\.map\(\(g\) => \{[\s\S]{0,400}<h3>\$\{icoD\} \$\{esc\(g\.name\)\} — \$\{g\.filas\.length\} viaje\(s\)<\/h3>\$\{tabla\(colsD, g\.filas\.map\(filaD\), pieG\)\}/.test(scr));
ok('...el nombre del grupo va escapado (lo teclea gente)', /\$\{esc\(g\.name\)\}/.test(scr));
ok('...sin agrupar, la tabla única de siempre', /: tabla\(colsD, filasD, pieD\);/.test(scr));
ok('...el total general no cambia al partir', /TOTAL: \$\{filteredRangeRows\.length\} viaje\(s\)/.test(scr));
ok('el título y el archivo dicen por dónde se partió', /'Viajes de camiones · detallado por obra'/.test(scr) && /'detallado por empresa '/.test(scr));

// «Todos / Todas».
ok('⭐ «Todos» limpia solo su fila', /const chipTodos = \(label: string, sel: Map<string, string>, limpiar: [^)]*\) => \{\s*const on = sel\.size === 0;[\s\S]{0,200}onPress=\{\(\) => limpiar\(new Map\(\)\)\}/.test(scr));
for (const [label, sel, set] of [['Los dos', 'filterTurnoSel', 'setFilterTurnoSel'], ['Todos', 'filterListeroSel', 'setFilterListeroSel'], ['Todas', 'filterCompanySel', 'setFilterCompanySel'], ['Todos', 'filterTruckSel', 'setFilterTruckSel'], ['Todas', 'filterUbicacionSel', 'setFilterUbicacionSel']]) {
  ok(`la fila de ${sel} tiene su «${label}»`, scr.includes(`{chipTodos('${label}', ${sel}, ${set})}`));
}
ok('la pantalla dice que se pueden marcar varias', /Toca una o varias pastillas de cada fila/.test(scr));
ok('«Limpiar filtros» (las cinco a la vez) sigue estando', /✕ Limpiar filtros/.test(scr));

// ── 3) MANUALES ──────────────────────────────────────────────────────────────
ok('manual (md)', /El detallado también se parte, y «Todos» en cada fila \(19\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('manual (app)', /EL DETALLADO TAMBIÉN SE PARTE, Y «TODOS» EN CADA FILA \(19\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-detallado-agrupado · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
