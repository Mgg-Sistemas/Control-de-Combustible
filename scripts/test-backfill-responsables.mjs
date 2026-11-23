/*
 * Test de la lógica PURA del BACKFILL de responsables de camiones (23-nov-2026).
 *
 * Fija lo que NO se puede romper:
 *   · solo se marcan viajes SIN responsable congelado (nunca se sobrescribe uno)
 *   · la operación congelada Miyamoto/TFI se respeta tal cual viene en el viaje
 *   · las jornadas cortan 7am→7am (igual que caracasDay.ts), rango semiabierto
 *   · el filtro por camiones es Y con los demás ejes
 *   · contar y aplicar usan la MISMA ventana y el MISMO filtro
 *   · es idempotente: lo que ya tiene responsable nunca vuelve a cambiar
 *
 * Sin framework: transpila el .ts en memoria con `typescript`.
 *   node scripts/test-backfill-responsables.mjs
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
  SQL_BACKFILL_RESPONSABLES, SIN_RESPONSABLE, claveResponsableDeViaje,
  operacionBackfillValida, isoDesplazar, ventanaJornadasBackfill,
  pasaFiltroBackfillBase, pasaFiltroBackfill, resumenBackfill,
} = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const viaje = (o) => ({
  id: o.id ?? o.registered_at,
  registered_at: o.registered_at,
  machinery_id: o.machinery_id ?? 'm1',
  proyecto_operacion: o.proyecto_operacion ?? null,
  responsable_id: o.responsable_id ?? null,
  responsable_nombre: o.responsable_nombre ?? null,
});

// ── 1) Operación y fechas ────────────────────────────────────────────────────
eq('constante del SQL aditivo', SQL_BACKFILL_RESPONSABLES, 'sql-backfill-responsables-2026-11-23.sql');
eq('operación miyamoto se normaliza', operacionBackfillValida(' MIYAMOTO '), 'miyamoto');
eq('operación tfi se normaliza', operacionBackfillValida('TFI'), 'tfi');
eq('operación desconocida no filtra', operacionBackfillValida('otra'), '');
eq('desplazar días hacia atrás', isoDesplazar('2026-11-23', -6), '2026-11-17');
eq('desplazar cruza año', isoDesplazar('2026-12-31', 1), '2027-01-01');
eq('desplazar cruza mes', isoDesplazar('2026-03-01', -1), '2026-02-28');

const vTodo = ventanaJornadasBackfill('', '', '2026-11-23');
eq('ventana vacía empieza en el principio', vTodo.jornadaDesde, '1900-01-01');
eq('ventana vacía termina hoy', vTodo.jornadaHasta, '2026-11-23');
eq('inicio 7am Caracas', vTodo.desdeISO, '1900-01-01T07:00:00-04:00');
eq('fin exclusivo 7am del día siguiente', vTodo.hastaExclusivoISO, '2026-11-24T07:00:00-04:00');

const vRango = ventanaJornadasBackfill('2026-11-20', '2026-11-22', '2026-11-23');
eq('rango explícito desde', vRango.jornadaDesde, '2026-11-20');
eq('rango explícito hasta', vRango.jornadaHasta, '2026-11-22');
eq('rango explícito inicio', vRango.desdeISO, '2026-11-20T07:00:00-04:00');
eq('rango explícito fin exclusivo', vRango.hastaExclusivoISO, '2026-11-23T07:00:00-04:00');
ok('rango al revés se rechaza', ventanaJornadasBackfill('2026-11-23', '2026-11-22', '2026-11-23') === null);
eq('fecha imposible cae al default', ventanaJornadasBackfill('2026-02-31', '2026-11-22', '2026-11-23').jornadaDesde, '1900-01-01');

// ── 2) Viajes de prueba ──────────────────────────────────────────────────────
const miyamotoViejo = viaje({
  id: 'v1', registered_at: '2026-11-20T12:00:00-04:00', machinery_id: 'm1', proyecto_operacion: 'miyamoto',
});
const tfiViejo = viaje({
  id: 'v2', registered_at: '2026-11-20T15:00:00-04:00', machinery_id: 'm2', proyecto_operacion: 'tfi',
});
const miyamotoYaMarcado = viaje({
  id: 'v3', registered_at: '2026-11-21T12:00:00-04:00', machinery_id: 'm1', proyecto_operacion: 'miyamoto',
  responsable_id: 'juan', responsable_nombre: 'Juan',
});
const sinOperacion = viaje({
  id: 'v4', registered_at: '2026-11-10T12:00:00-04:00', machinery_id: 'm3',
});
const antesDelCorte = viaje({
  id: 'v5', registered_at: '2026-11-20T06:30:00-04:00', machinery_id: 'm1', proyecto_operacion: 'miyamoto',
});
const enElCorte = viaje({
  id: 'v6', registered_at: '2026-11-22T07:00:00-04:00', machinery_id: 'm1', proyecto_operacion: 'miyamoto',
});
const diaSiguiente = viaje({
  id: 'v7', registered_at: '2026-11-23T07:00:00-04:00', machinery_id: 'm1', proyecto_operacion: 'miyamoto',
});
const soloNombre = {
  id: 'v8', registered_at: '2026-11-20T12:00:00-04:00', machinery_id: 'm1',
  proyecto_operacion: 'miyamoto', responsable_nombre: 'Alguien',
};
const todos = [miyamotoViejo, tfiViejo, miyamotoYaMarcado, sinOperacion, antesDelCorte, enElCorte, diaSiguiente, soloNombre];

// ── 3) Filtro base (fecha / operación / camiones) ────────────────────────────
const filtroMiyamoto = { operacion: 'miyamoto' };
ok('base: viaje Miyamoto viejo pasa', pasaFiltroBackfillBase(miyamotoViejo, filtroMiyamoto, vTodo));
ok('base: viaje TFI no pasa filtro Miyamoto', !pasaFiltroBackfillBase(tfiViejo, filtroMiyamoto, vTodo));
ok('base: viaje sin operación no pasa filtro Miyamoto', !pasaFiltroBackfillBase(sinOperacion, filtroMiyamoto, vTodo));
ok('base: sin filtro de operación sí pasa', pasaFiltroBackfillBase(tfiViejo, {}, vTodo));
ok('base: camión m1 pasa', pasaFiltroBackfillBase(miyamotoViejo, { camiones: ['m1'] }, vTodo));
ok('base: camión m2 no pasa', !pasaFiltroBackfillBase(miyamotoViejo, { camiones: ['m2'] }, vTodo));
ok('base: selección vacía = todos los camiones', pasaFiltroBackfillBase(tfiViejo, { camiones: [] }, vTodo));
ok('base: 06:30 pertenece a la jornada anterior', !pasaFiltroBackfillBase(antesDelCorte, filtroMiyamoto, vRango));
ok('base: 07:00 exacto sí entra', pasaFiltroBackfillBase(enElCorte, filtroMiyamoto, vRango));
ok('base: 07:00 del día siguiente queda fuera', !pasaFiltroBackfillBase(diaSiguiente, filtroMiyamoto, vRango));
ok('base: fecha inválida no se marca', !pasaFiltroBackfillBase({ ...miyamotoViejo, registered_at: 'no-es-fecha' }, filtroMiyamoto, vTodo));
ok('base: sin ventana no marca', !pasaFiltroBackfillBase(miyamotoViejo, filtroMiyamoto, null));
ok('base: compatible con camelCase', pasaFiltroBackfillBase({
  registeredAt: '2026-11-20T12:00:00-04:00', machineryId: 'm1', proyectoOperacion: 'miyamoto',
}, filtroMiyamoto, vTodo));

// ── 4) REGLA DE ORO: solo viajes vacíos ──────────────────────────────────────
eq('cubeta de viaje vacío', claveResponsableDeViaje(miyamotoViejo), SIN_RESPONSABLE);
ok('vacío + filtro Miyamoto = candidato', pasaFiltroBackfill(miyamotoViejo, filtroMiyamoto, vTodo));
ok('ya con responsable NO es candidato', !pasaFiltroBackfill(miyamotoYaMarcado, filtroMiyamoto, vTodo));
ok('solo nombre (sin id) NO es candidato', !pasaFiltroBackfill(soloNombre, filtroMiyamoto, vTodo));
ok('candidato con rango acotado', pasaFiltroBackfill(enElCorte, filtroMiyamoto, vRango));
ok('no candidato fuera del rango', !pasaFiltroBackfill(diaSiguiente, filtroMiyamoto, vRango));

eq('resumen Miyamoto todo', resumenBackfill(todos, filtroMiyamoto, vTodo), { aMarcar: 4, yaConResponsable: 2 });
eq('resumen Miyamoto rango 20-22', resumenBackfill(todos, filtroMiyamoto, vRango), { aMarcar: 2, yaConResponsable: 2 });
eq('resumen por camión m3', resumenBackfill(todos, { camiones: ['m3'] }, vTodo), { aMarcar: 1, yaConResponsable: 0 });
eq('resumen vacío', resumenBackfill([], filtroMiyamoto, vTodo), { aMarcar: 0, yaConResponsable: 0 });
eq('resumen sin ventana', resumenBackfill(todos, filtroMiyamoto, null), { aMarcar: 0, yaConResponsable: 0 });

// ── 5) Idempotencia: correr dos veces no reescribe lo ya marcado ─────────────
const yaMarcados = todos.map((v) => (
  v.id === 'v1' || v.id === 'v6'
    ? { ...v, responsable_id: 'miyamoto-id', responsable_nombre: 'Miyamoto' }
    : v
));
eq('segunda pasada: solo quedan los otros vacíos', resumenBackfill(yaMarcados, filtroMiyamoto, vTodo), { aMarcar: 2, yaConResponsable: 4 });
eq('tercera pasada: nada que marcar', resumenBackfill(yaMarcados.map((v) => (
  v.id === 'v5' || v.id === 'v7' ? { ...v, responsable_id: 'miyamoto-id', responsable_nombre: 'Miyamoto' } : v
)), filtroMiyamoto, vTodo), { aMarcar: 0, yaConResponsable: 6 });

// ── Resultado ────────────────────────────────────────────────────────────────
if (fail) {
  console.error(`\n❌ ${fail} fallo(s) en test-backfill-responsables`);
  failures.forEach((f) => console.error(f));
  process.exit(1);
}
console.log(`✅ test-backfill-responsables · ${pass} ok · 0 fallando`);
