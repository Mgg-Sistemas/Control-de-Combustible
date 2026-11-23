/*
 * RESPONSABLE EN LOS REPORTES — integración de los ejes compartidos (23-nov-2026).
 *
 * Fija lo que no se puede romper cuando el responsable entra en TODOS los reportes:
 *   · es un eje MÁS del motor de facetas: O dentro de él, Y con los demás;
 *   · vacío = todos, y «Sin responsable» es una opción seleccionable;
 *   · el contador de un responsable se calculate con los OTROS filtros puestos,
 *     pero sin filtrarse él mismo (regla de `opcionesDeEje`);
 *   · agrupar por responsable NO filtra: el total general cuadra siempre;
 *   · el responsable congelado en el viaje gana al vigente de hoy: reasignar un
 *     camión NUNCA cambia el reporte de los viajes ya registrados;
 *   · `viajesResumen` y `camionResponsables` coinciden en la clave, aunque el
 *     primero se mantenga sin imports para poder probarse solo.
 *
 *   node scripts/test-responsables-reportes.mjs
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

function load(rel) {
  const srcPath = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  m._compile(out, m.filename);
  return m.exports;
}

const filtros = load('src/lib/viajesFiltros.ts');
const resumen = load('src/lib/viajesResumen.ts');
const resp = load('src/lib/camionResponsables.ts');

const {
  pasaFiltros, opcionesDeEje, marcadosFueraDelRango, TODOS_LOS_EJES_FILTRO,
} = filtros;
const { resumirViajes, claveResponsableViaje, SIN_RESPONSABLE: SIN_RES } = resumen;
const {
  claveResponsableDeViaje, pasaFiltroResponsables, etiquetaFiltroResponsables,
  sufijoArchivoResponsables, SIN_RESPONSABLE, ETIQUETA_SIN_RESPONSABLE,
} = resp;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const cmp = (a, b) => String(a).localeCompare(String(b), 'es');
const mk = (ids) => new Map(ids.map((id) => [id, id]));

// ── 1) El eje existe y es recorrido por el motor de facetas ──────────────────
ok('responsable está en TODOS_LOS_EJES_FILTRO', TODOS_LOS_EJES_FILTRO.includes('responsable'));

// Un día: 2 empresas, 2 responsables y viajes viejos sin responsable.
const ROWS = [
  { empresa: 'beraca', responsable: 'r1' },
  { empresa: 'beraca', responsable: 'r1' },
  { empresa: 'beraca', responsable: 'r2' },
  { empresa: 'savanna', responsable: 'r2' },
  { empresa: 'savanna', responsable: SIN_RESPONSABLE },
];
const clavesDe = (r) => ({ empresa: r.empresa, responsable: r.responsable });
const sel = (empresas = [], responsables = []) => ({
  empresa: mk(empresas), responsable: mk(responsables),
});
const opciones = (s) => opcionesDeEje(ROWS, 'responsable', clavesDe,
  (r) => ({ id: r.responsable, label: r.responsable }), s, cmp);
const conteo = (s) => Object.fromEntries(opciones(s).map((o) => [o.id, o.count]).sort((a, b) => a[0].localeCompare(b[0])));
const listados = (s) => ROWS.filter((r) => pasaFiltros(clavesDe(r), s)).length;

eq('conteo sin marcar', conteo(sel()), { [SIN_RESPONSABLE]: 1, r1: 2, r2: 2 });
eq('vacío = todos', listados(sel()), ROWS.length);
eq('marcar uno filtra', listados(sel([], ['r1'])), 2);
eq('marcar varios es OR dentro del eje', listados(sel([], ['r1', 'r2'])), 4);
eq('Sin responsable es seleccionable', listados(sel([], [SIN_RESPONSABLE])), 1);
eq('Y entre ejes: r2 en beraca', listados(sel(['beraca'], ['r2'])), 1);

// El eje NO se filtra a sí mismo: sigue mostrando sus otras opciones.
eq('facetas con r1 marcado', conteo(sel([], ['r1'])), { [SIN_RESPONSABLE]: 1, r1: 2, r2: 2 });
// Pero SÍ respeta los otros ejes: en savanna, r1 no aparece (0 viajes y no marcado).
eq('facetas con empresa savanna', conteo(sel(['savanna'])), { [SIN_RESPONSABLE]: 1, r2: 1 });

eq('lo marcado fuera del rango se reporta con su eje',
  marcadosFueraDelRango(ROWS, clavesDe, sel([], ['fantasma'])),
  [{ eje: 'responsable', label: 'fantasma' }]);

// Un llamador viejo que no calcula el eje nuevo NO tumba el motor.
eq('eje ausente no filtra', ROWS.filter((r) => pasaFiltros({ empresa: r.empresa }, sel([], ['r1']))).length, 0);
eq('selección vieja sin responsable no filtra',
  ROWS.filter((r) => pasaFiltros(clavesDe(r), { empresa: mk(['beraca']) })).length, 3);

// ── 2) Misma clave en los dos mundos (puro con/sin imports) ──────────────────
const nombres = {
  [SIN_RESPONSABLE]: ETIQUETA_SIN_RESPONSABLE,
  r1: 'Pedro Pérez',
};
const pares = [
  { responsable_id: 'r1', responsableNombre: 'Otro nombre' },
  { responsableId: 'r1', responsable_nombre: 'Otro nombre' },
  { responsable_nombre: ' José  Álvarez ' },
  { responsableNombre: 'José Álvarez' },
  { responsable_id: null, responsable_nombre: null },
  {},
];
pares.forEach((v, i) => {
  eq(`clave ${i} coincide`, claveResponsableViaje(v), claveResponsableDeViaje(v));
});
eq('id gana al nombre congelado', claveResponsableViaje(pares[0]), 'r1');
eq('cubeta compartida', SIN_RES, SIN_RESPONSABLE);

// ── 3) Agrupar por responsable NO filtra y usa el congelado ──────────────────
const TRUCKS = {
  t1: { companyId: 'beraca', companyName: 'Beraca', plate: 'A1', serial: null },
  t2: { companyId: 'savanna', companyName: 'Savanna', plate: 'A2', serial: null },
};
const viaje = (id, machineryId, responsableId, responsableNombre = null) => ({
  id, machineryId, machineCode: machineryId, listeroId: 'l1', listeroName: 'Listero',
  responsableId, responsableNombre,
});
const viajes = [
  viaje('v1', 't1', 'r1'),
  viaje('v2', 't1', 'r1'),
  viaje('v3', 't1', 'r2'),          // el camión CAMBIÓ de responsable después
  viaje('v4', 't2', 'r2'),
  viaje('v5', 't2', null),          // viejo, sin snapshot
];
const porEmpresa = resumirViajes(viajes, (id) => TRUCKS[id], 'empresa');
const porResp = resumirViajes(viajes, (id) => TRUCKS[id], 'responsable');

eq('agrupar no cambia el total', porResp.total, porEmpresa.total);
eq('total = filas', porResp.total, viajes.length);
eq('groupBy se reporta', porResp.groupBy, 'responsable');
eq('tres grupos', porResp.empresas.map((g) => g.key).sort(), ['r1', 'r2', SIN_RESPONSABLE].sort());
eq('r1 tiene 2 viajes del camión viejo', porResp.empresas.find((g) => g.key === 'r1').total, 2);
eq('r2 conserva el viaje anterior a la reasignación', porResp.empresas.find((g) => g.key === 'r2').total, 2);
eq('sin responsable no se pierde', porResp.empresas.find((g) => g.key === SIN_RESPONSABLE).total, 1);
eq('la cubeta se rotula', porResp.empresas.find((g) => g.key === SIN_RESPONSABLE).name, 'Sin responsable');
eq('la suma de grupos cuadra', porResp.empresas.reduce((a, g) => a + g.total, 0), viajes.length);

// Un nombre congelado sin id (viaje migrado) cae en su propia cubeta estable.
const conNombre = resumirViajes([viaje('v6', 't1', null, 'José  Álvarez')], (id) => TRUCKS[id], 'responsable');
eq('nombre congelado como clave', conNombre.empresas[0].key, 'nombre:jose alvarez');

// ── 4) Filtro y etiqueta compartidos por todos los papeles ───────────────────
ok('selección vacía pasa todo', pasaFiltroResponsables([], SIN_RESPONSABLE));
ok('marcar r1 excluye r2', !pasaFiltroResponsables(['r1'], 'r2'));
ok('marcar r1 incluye r1', pasaFiltroResponsables(['r1'], 'r1'));
eq('etiqueta del PDF', etiquetaFiltroResponsables(['r1', SIN_RESPONSABLE], nombres),
  'Responsable: Pedro Pérez, Sin responsable');
eq('etiqueta sin selección', etiquetaFiltroResponsables([], nombres), '');
eq('sufijo de un responsable', sufijoArchivoResponsables(['r1']), '-resp-r1');
eq('sufijo de la cubeta', sufijoArchivoResponsables([SIN_RESPONSABLE]), '-sin-responsable');
eq('sufijo de varios', sufijoArchivoResponsables(['r1', 'r2']), '-resp-2');
eq('sufijo sin selección', sufijoArchivoResponsables([]), '');

console.log(`RESPONSABLES EN REPORTES: ${pass} OK, ${fail} FAIL`);
if (fail) {
  failures.forEach((f) => console.error(f));
  process.exit(1);
}
