/*
 * Test de la lógica PURA de RESPONSABLES DE CAMIONES (23-nov-2026).
 *
 * Fija lo que no se puede romper:
 *   · un camión tiene UN responsable vigente; reasignar CIERRA y ABRE, nunca borra
 *   · el responsable se resuelve en una FECHA (para congelar al registrar viajes)
 *   · viajes viejos / fuera de catálogo caen en una cubeta explícita y filtrable
 *   · filtrar por varios responsables es O, y entre ejes es Y
 *   · los contadores son tipo faceta: se cuentan sobre los otros filtros, no el propio
 *
 * Sin framework: transpila el .ts en memoria con `typescript`.
 *   node scripts/test-camion-responsables.mjs
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

const srcPath = path.join(ROOT, 'src/lib/camionResponsables.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const {
  SIN_RESPONSABLE, ETIQUETA_SIN_RESPONSABLE, SQL_RESPONSABLES,
  normalizarNombreResponsable, nombreValidoResponsable,
  claveResponsableDeViaje, nombreResponsableDeViaje, mapaNombresResponsables,
  asignacionResponsableEnFecha, responsableCongeladoParaViaje,
  responsableVigentePorCamion, conteoCamionesPorResponsable,
  planAsignarCamiones, planQuitarCamion,
  pasaFiltroResponsables, opcionesFiltroResponsables, etiquetaFiltroResponsables,
  sufijoArchivoResponsables, alternarResponsable,
} = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const resp = (id, name, active = true) => ({ id, name, active });
const asig = (id, responsable_id, machinery_id, desde, hasta = null) => ({
  id, responsable_id, machinery_id, desde, hasta,
});

// ── 1) Nombres y cubeta "Sin responsable" ────────────────────────────────────
eq('normaliza acentos y mayúsculas', normalizarNombreResponsable('  José  Pérez '), 'jose perez');
ok('nombre de 1 letra no vale', !nombreValidoResponsable('J'));
ok('nombre válido', nombreValidoResponsable('José Pérez'));
eq('viaje viejo → cubeta explícita', claveResponsableDeViaje({}), SIN_RESPONSABLE);
eq('viaje con id → id', claveResponsableDeViaje({ responsable_id: 'r1' }), 'r1');
eq('viaje sin id pero con nombre → clave estable', claveResponsableDeViaje({ responsable_nombre: 'José Pérez' }), 'nombre:jose perez');
eq('etiqueta de la cubeta', nombreResponsableDeViaje({}), ETIQUETA_SIN_RESPONSABLE);
eq('nombre del catálogo gana', nombreResponsableDeViaje({ responsable_id: 'r1', responsable_nombre: 'otro' }, { r1: 'José Pérez' }), 'José Pérez');
eq('catálogo incluye siempre la cubeta', mapaNombresResponsables([resp('r1', 'José Pérez')])[SIN_RESPONSABLE], ETIQUETA_SIN_RESPONSABLE);
eq('SQL va en mensaje, no en archivo del repo', SQL_RESPONSABLES, 'sql-camion-responsables-2026-11-23.sql');

// ── 2) Vigencia en fecha (para congelar al registrar) ────────────────────────
const historial = [
  asig('a1', 'r1', 'camion1', '2026-11-01T07:00:00-04:00', '2026-11-10T07:00:00-04:00'),
  asig('a2', 'r2', 'camion1', '2026-11-10T07:00:00-04:00'),
  asig('a3', 'r3', 'camion2', '2026-11-01T07:00:00-04:00'),
];
eq('responsable en fecha intermedia', asignacionResponsableEnFecha(historial, 'camion1', '2026-11-05T12:00:00-04:00')?.responsable_id, 'r1');
eq('responsable en el cambio (el nuevo)', asignacionResponsableEnFecha(historial, 'camion1', '2026-11-10T12:00:00-04:00')?.responsable_id, 'r2');
eq('antes de la primera asignación', asignacionResponsableEnFecha(historial, 'camion1', '2026-10-30T12:00:00-04:00'), null);
eq('no cruza camiones', asignacionResponsableEnFecha(historial, 'camion3', '2026-11-12T12:00:00-04:00'), null);
const catalogoResp = [resp('r1', 'José Pérez'), resp('r2', 'María')];
eq('congelar viaje de ayer', responsableCongeladoParaViaje(historial, catalogoResp, 'camion1', '2026-11-05T12:00:00-04:00'), { id: 'r1', nombre: 'José Pérez' });
eq('congelar viaje de hoy (sincronización offline)', responsableCongeladoParaViaje(historial, catalogoResp, 'camion1', '2026-11-12T12:00:00-04:00'), { id: 'r2', nombre: 'María' });
eq('congelar camión sin responsable', responsableCongeladoParaViaje(historial, catalogoResp, 'camion9', '2026-11-23T09:00:00-04:00'), { id: null, nombre: null });
eq('mapa vigente por camión', responsableVigentePorCamion(historial, '2026-11-12T12:00:00-04:00'), { camion1: 'r2', camion2: 'r3' });
eq('conteo de camiones por responsable', conteoCamionesPorResponsable(historial, '2026-11-12T12:00:00-04:00'), { r2: 1, r3: 1 });

// ── 3) Reasignar CIERRA + ABRE; nadie borra el historial ─────────────────────
const ahora = '2026-11-23T09:00:00-04:00';
const plan1 = planAsignarCamiones(historial, 'r4', ['camion1', 'camion2', 'camion1'], ahora, 'admin1');
eq('camiones dup no generan filas dobles', plan1.abrir.length, 2);
eq('cierra las 2 vigencias anteriores', plan1.cerrar.sort(), ['a2', 'a3']);
eq('avisa de los 2 conflictos', plan1.conflictos.map((c) => c.responsable_id).sort(), ['r2', 'r3']);
ok('ningún plan contiene DELETE', !('borrar' in plan1));
ok('las nuevas filas arrancan sin hasta', plan1.abrir.every((a) => a.hasta === null));
const planMismo = planAsignarCamiones(historial, 'r2', ['camion1'], ahora);
eq('reasignar al mismo no genera conflicto', planMismo.conflictos.length, 0);
eq('aun así cierra y abre (historial)', planMismo.abrir.length, 1);
const planVacio = planAsignarCamiones(historial, 'r4', [], ahora);
eq('asignar sin camiones no hace nada', planVacio, { cerrar: [], abrir: [], conflictos: [] });
eq('quitar cierra solo la vigencia de ese responsable', planQuitarCamion(historial, 'r2', 'camion1', ahora).cerrar, ['a2']);
eq('quitar de otro responsable no cierra nada', planQuitarCamion(historial, 'r9', 'camion1', ahora).cerrar, []);

// ── 4) Filtro multi-selección con contadores tipo faceta ─────────────────────
const viajes = [
  { responsable_id: 'r1' }, { responsable_id: 'r1' }, { responsable_id: 'r2' },
  { responsable_id: 'r2', responsable_nombre: 'María' }, {}, {}, {},
];
const nombres = mapaNombresResponsables([resp('r1', 'José Pérez'), resp('r2', 'María')]);
ok('selección vacía = todos', pasaFiltroResponsables([], 'r1') && pasaFiltroResponsables(null, SIN_RESPONSABLE));
ok('marcar varios = O', pasoDos());
function pasoDos() {
  return pasaFiltroResponsables(['r1', 'r2'], 'r1') && pasaFiltroResponsables(['r1', 'r2'], 'r2')
    && !pasaFiltroResponsables(['r1', 'r2'], SIN_RESPONSABLE);
}
const opciones = opcionesFiltroResponsables(viajes, viajes, nombres, ['r1']);
eq('universo conserva todas las opciones', opciones.map((o) => o.clave), ['r1', 'r2', SIN_RESPONSABLE]);
eq('total de la cubeta vieja', opciones.find((o) => o.clave === SIN_RESPONSABLE).total, 3);
eq('el contador propio NO se cae al marcarlo', opciones.find((o) => o.clave === 'r2').total, 2);
// base = viajes que ya pasaron OTRO filtro (empresa X): 2 de José, 1 sin responsable
const base = [{ responsable_id: 'r1' }, { responsable_id: 'r1' }, {}];
const facetas = opcionesFiltroResponsables(viajes, base, nombres, ['r1']);
eq('contador sobre los OTROS filtros', facetas.find((o) => o.clave === 'r1').total, 2);
eq('opción no presente en la base sigue visible en (0)', facetas.find((o) => o.clave === 'r2').total, 0);
eq('marcada correctamente', facetas.find((o) => o.clave === 'r1').marcada, true);
eq('etiqueta del papel', etiquetaFiltroResponsables(['r1', SIN_RESPONSABLE], nombres), 'Responsable: José Pérez, Sin responsable');
eq('sin filtro → sin etiqueta', etiquetaFiltroResponsables([], nombres), '');
eq('sufijo de archivo 1 responsable', sufijoArchivoResponsables(['r1']), '-resp-r1');
eq('sufijo de archivo varios', sufijoArchivoResponsables(['r1', 'r2']), '-resp-2');
eq('sufijo sin responsable', sufijoArchivoResponsables([SIN_RESPONSABLE]), '-sin-responsable');
eq('alternar agrega', alternarResponsable(['r1'], 'r2'), ['r1', 'r2']);
eq('alternar quita sin mutar', alternarResponsable(['r1', 'r2'], 'r1'), ['r2']);

console.log(`\nRESPONSABLES DE CAMIONES: ${pass} OK, ${fail} FAIL`);
if (fail) {
  console.log(failures.join('\n'));
  process.exit(1);
}
