/*
 * Test de los GRUPOS APARTADOS de la nómina — CARBOZULIA y SEGURIDAD (29-ago-2026).
 *
 * QUÉ PEDIDO CUBRE (textual del cliente):
 *   «necesito que me separes a los empleados de carbozulia y seguridad en
 *    pestañas diferentes en la parte de estado. que no aparezcan en "activos" y
 *    tampoco en "todos", que tengan su propia pestaña»
 *
 * LO QUE BLINDA (`src/lib/nominaGrupos.ts`):
 *   · CARBOZULIA se reconoce por la EMPRESA FILTRO NÓMINA, aunque la renombren
 *     ("CARBOZULIA C.A.", "Carbozulia SA") o venga con tildes/minúsculas.
 *   · SEGURIDAD se reconoce por el CARGO, pasando por `canonicalCargo`.
 *   · ⭐ Los apartados NO salen en «Todos», «Activos», «Inactivos» ni «Otro».
 *   · ⭐ Las 6 pestañas son DISJUNTAS y COMPLETAS: cada empleado cae en «Todos»
 *     o en un grupo, nunca en los dos y nunca en ninguno. Sin esto, el pedido
 *     "que no aparezcan en todos" se cumpliría escondiendo gente.
 *   · Si algún día un empleado de Carbozulia tiene cargo SEGURIDAD, manda
 *     CARBOZULIA — no puede contarse en dos pestañas.
 *   · «Inactivos» sigue siendo "ni activo ni otro", como antes del cambio.
 *
 * No usa framework de test (el repo no tiene): transpila los .ts en memoria con
 * el `typescript` ya instalado.
 *
 *   node scripts/test-nomina-grupos.mjs
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
const loadTs = (srcPath) => {
  if (cache.has(srcPath)) return cache.get(srcPath);
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  cache.set(srcPath, m.exports);
  const origRequire = m.require.bind(m);
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(srcPath), `${id}.ts`)) : origRequire(id));
  m._compile(out, m.filename);
  cache.set(srcPath, m.exports);
  return m.exports;
};

const { esCarbozulia, esSeguridad, grupoApartado, pasaFiltroEstado } =
  loadTs(path.join(ROOT, 'src/lib/nominaGrupos.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};

// ── CARBOZULIA por empresa de nómina ────────────────────────────────────────
eq('CARBOZULIA tal cual', esCarbozulia('CARBOZULIA'), true);
eq('minúsculas', esCarbozulia('carbozulia'), true);
eq('con sufijo C.A.', esCarbozulia('CARBOZULIA C.A.'), true);
eq('con espacios', esCarbozulia('  Carbozulia SA  '), true);
eq('SOS LA GUAIRA no es', esCarbozulia('SOS LA GUAIRA'), false);
eq('sin empresa no es', esCarbozulia('Sin empresa de filtro'), false);
eq('null no es', esCarbozulia(null), false);
eq('vacío no es', esCarbozulia(''), false);

// ── SEGURIDAD por cargo ─────────────────────────────────────────────────────
eq('cargo SEGURIDAD', esSeguridad('SEGURIDAD'), true);
eq('cargo en minúsculas', esSeguridad('seguridad'), true);
eq('cargo con espacios', esSeguridad('  Seguridad '), true);
eq('OPERADORES no es', esSeguridad('OPERADORES DE MAQUINARIA'), false);
eq('cargo vacío no es', esSeguridad(''), false);
eq('cargo null no es', esSeguridad(null), false);
// "VIGILANTE" NO es seguridad: el cliente pidió separar por lo REGISTRADO, y en
// la data el cargo se llama SEGURIDAD. Si algún día quieren incluir vigilantes,
// se agrega la variante a `canonicalCargo`, no acá.
eq('VIGILANTE no entra solo', esSeguridad('VIGILANTE'), false);

// ── Grupo y prioridad ───────────────────────────────────────────────────────
eq('carbozulia gana', grupoApartado('CARBOZULIA', 'SEGURIDAD'), 'carbozulia');
eq('solo seguridad', grupoApartado('SOS LA GUAIRA', 'SEGURIDAD'), 'seguridad');
eq('solo carbozulia', grupoApartado('CARBOZULIA', 'CHOFER'), 'carbozulia');
eq('ninguno', grupoApartado('SOS LA GUAIRA', 'CHOFER'), null);
eq('sin datos', grupoApartado(null, null), null);

// ── La regla del filtro ─────────────────────────────────────────────────────
const carboActivo = { g: 'carbozulia', st: 'activo' };
const segActivo = { g: 'seguridad', st: 'activo' };
const normalActivo = { g: null, st: 'activo' };
const normalInactivo = { g: null, st: 'inactivo' };
const normalOtro = { g: null, st: 'otro' };
const normalSusp = { g: null, st: 'suspendido' };
const p = (f, e) => pasaFiltroEstado(f, e.g, e.st);

eq('Carbozulia FUERA de todos', p('todos', carboActivo), false);
eq('Carbozulia FUERA de activos', p('activo', carboActivo), false);
eq('Seguridad FUERA de todos', p('todos', segActivo), false);
eq('Seguridad FUERA de activos', p('activo', segActivo), false);
eq('Carbozulia en SU pestaña', p('carbozulia', carboActivo), true);
eq('Seguridad en SU pestaña', p('seguridad', segActivo), true);
eq('Seguridad NO en pestaña Carbozulia', p('carbozulia', segActivo), false);
eq('Carbozulia NO en pestaña Seguridad', p('seguridad', carboActivo), false);
eq('normal activo en todos', p('todos', normalActivo), true);
eq('normal activo en activos', p('activo', normalActivo), true);
eq('inactivo en inactivos', p('inactivo', normalInactivo), true);
eq('suspendido cuenta como inactivo', p('inactivo', normalSusp), true);
eq('otro en su pestaña', p('otro', normalOtro), true);
eq('otro NO en inactivos', p('inactivo', normalOtro), false);
eq('activo NO en inactivos', p('inactivo', normalActivo), false);
eq('normal NO en pestaña de grupo', p('carbozulia', normalActivo), false);

// ── Disjuntas y completas: nadie repetido, nadie perdido ────────────────────
// Muestra que imita la data real al 29-ago-2026 (40 carbozulia, 16 seguridad,
// y el resto repartido entre activo/inactivo/otro).
const muestra = [
  ...Array.from({ length: 40 }, () => ({ g: 'carbozulia', st: 'activo' })),
  ...Array.from({ length: 16 }, () => ({ g: 'seguridad', st: 'activo' })),
  ...Array.from({ length: 181 }, () => ({ g: null, st: 'activo' })),
  ...Array.from({ length: 61 }, () => ({ g: null, st: 'inactivo' })),
  ...Array.from({ length: 40 }, () => ({ g: null, st: 'otro' })),
];
const cuenta = (f) => muestra.filter((e) => p(f, e)).length;
eq('total de la muestra', muestra.length, 338);
eq('TODOS ya no trae a los apartados', cuenta('todos'), 282);
eq('ACTIVOS sin apartados', cuenta('activo'), 181);
eq('INACTIVOS intacto', cuenta('inactivo'), 61);
eq('OTRO intacto', cuenta('otro'), 40);
eq('CARBOZULIA', cuenta('carbozulia'), 40);
eq('SEGURIDAD', cuenta('seguridad'), 16);
// Todos + los dos grupos = la plantilla completa (nadie se pierde por el camino)
eq('todos + grupos = plantilla', cuenta('todos') + cuenta('carbozulia') + cuenta('seguridad'), muestra.length);
// Y dentro de "todos", las tres sub-pestañas siguen sumando
eq('activos + inactivos + otro = todos', cuenta('activo') + cuenta('inactivo') + cuenta('otro'), cuenta('todos'));
// Ningún empleado cae en dos pestañas a la vez
const PESTANAS = ['todos', 'activo', 'inactivo', 'otro', 'carbozulia', 'seguridad'];
const enDosGrupos = muestra.filter((e) => ['carbozulia', 'seguridad'].filter((f) => p(f, e)).length > 1).length;
eq('nadie en dos grupos', enDosGrupos, 0);
// Ningún empleado queda invisible en TODAS las pestañas
const invisibles = muestra.filter((e) => !PESTANAS.some((f) => p(f, e))).length;
eq('nadie invisible', invisibles, 0);

console.log('\n🏢  Grupos apartados de nómina (CARBOZULIA · SEGURIDAD)');
console.log(`   ${pass} OK · ${fail} fallo(s)`);
if (fail) {
  console.log('\n' + failures.join('\n') + '\n');
  process.exit(1);
}
console.log('   ✅ Todo en verde\n');
