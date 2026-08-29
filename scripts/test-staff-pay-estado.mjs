/*
 * Test del filtro «Activos / Todos / Inactivos-Desincorporados» del detalle de un
 * período en Control de pago a personal (20-ago-2026).
 *
 * EL BUG QUE FIJA. La versión anterior hacía `if (!st) return true`: un renglón SIN
 * estado resuelto pasaba TODOS los filtros, así que salía a la vez en "Activos" y en
 * "Inactivos/Desincorporados". Un renglón se queda sin estado cuando no tiene
 * `employee_id` (persona suelta) o cuando su empleado ya no está en el registro. Por
 * eso el filtro "no reconocía" a los desincorporados: los mezclaba con gente que no
 * lo era.
 *
 * LA REGLA: sin estado ≠ desincorporado. Si está cobrando en el período cuenta como
 * ACTIVO; desincorporado es SOLO 'inactivo' o 'suspendido'.
 *
 * Además vigila el fuente, porque las otras dos mitades del problema eran de UI:
 *   · "＋ Personal faltante" solo traía `status = 'activo'` → a un desincorporado no
 *     había forma de meterlo en un período (ni de moverlo de uno a otro). Ahora hay
 *     un "👤 Agregar persona" que busca en TODOS los empleados.
 *   · "🗑️ Quitar del período" solo salía si `source === 'manual'`, y `source` NO
 *     significa "lo agregaron a mano" (vale 'auto' cuando la persona tiene jornadas
 *     en el rango). A quien de verdad trabajó no había forma de sacarlo.
 *
 *   npm run test:pagos   (o: node scripts/test-staff-pay-estado.mjs)
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

const srcPath = path.join(ROOT, 'src/lib/staffPayEstado.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const { pasaFiltroEstado, esDesincorporado } = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// Estado ACTUAL de los empleados del período.
const ST = new Map([
  ['activo-1', 'activo'],
  ['inactivo-1', 'inactivo'],
  ['suspendido-1', 'suspendido'],
  ['otro-1', 'otro'],
]);
const pasa = (id, filtro) => pasaFiltroEstado(id, filtro, ST, true);

// ── 1) QUIÉN ES DESINCORPORADO ─────────────────────────────────────────────
eq('inactivo es desincorporado', esDesincorporado('inactivo'), true);
eq('suspendido es desincorporado', esDesincorporado('suspendido'), true);
eq('activo NO es desincorporado', esDesincorporado('activo'), false);
eq('"otro" NO es desincorporado', esDesincorporado('otro'), false);
eq('sin estado NO es desincorporado', esDesincorporado(undefined), false);
eq('null NO es desincorporado', esDesincorporado(null), false);

// ── 2) EL BUG: un renglón SIN estado no puede salir en los dos filtros ─────
// Sin `employee_id` (persona suelta, no vinculada al registro).
eq('sin employee_id → sale en Activos', pasa(null, 'activos'), true);
eq('sin employee_id → NO sale en Desincorporados', pasa(null, 'inactivos'), false);
eq('sin employee_id → sale en Todos', pasa(null, 'todos'), true);

// Empleado que ya no está en el registro (borrado): tampoco resuelve estado.
eq('empleado inexistente → sale en Activos', pasa('fantasma', 'activos'), true);
eq('empleado inexistente → NO sale en Desincorporados', pasa('fantasma', 'inactivos'), false);

// La prueba de fondo: NINGÚN renglón puede estar en Activos Y en Desincorporados.
for (const id of [null, undefined, 'fantasma', 'activo-1', 'inactivo-1', 'suspendido-1', 'otro-1']) {
  ok(`"${id}" no sale a la vez en Activos y en Desincorporados`,
    !(pasa(id, 'activos') && pasa(id, 'inactivos')));
}

// ── 3) LOS ESTADOS NORMALES ────────────────────────────────────────────────
eq('activo → Activos', pasa('activo-1', 'activos'), true);
eq('activo → NO Desincorporados', pasa('activo-1', 'inactivos'), false);
eq('inactivo → Desincorporados', pasa('inactivo-1', 'inactivos'), true);
eq('inactivo → NO Activos', pasa('inactivo-1', 'activos'), false);
eq('suspendido → Desincorporados', pasa('suspendido-1', 'inactivos'), true);
eq('suspendido → NO Activos', pasa('suspendido-1', 'activos'), false);
// "Otro" no es activo ni desincorporado: no debe aparecer en ninguno de los dos.
eq('"otro" → NO Activos', pasa('otro-1', 'activos'), false);
eq('"otro" → NO Desincorporados', pasa('otro-1', 'inactivos'), false);
eq('"otro" → sí en Todos', pasa('otro-1', 'todos'), true);

// ── 4) "TODOS" SIEMPRE MUESTRA TODO ────────────────────────────────────────
for (const id of [null, 'fantasma', 'activo-1', 'inactivo-1', 'suspendido-1', 'otro-1']) {
  eq(`"${id}" sale en Todos`, pasa(id, 'todos'), true);
}

// ── 5) MIENTRAS EL ESTADO NO CARGA, NO SE ESCONDE A NADIE ──────────────────
// Si no, al abrir el período la lista parpadea vacía.
const sinCargar = (id, f) => pasaFiltroEstado(id, f, new Map(), false);
eq('cargando → Activos muestra todo', sinCargar('inactivo-1', 'activos'), true);
eq('cargando → Desincorporados muestra todo', sinCargar('activo-1', 'inactivos'), true);
// Y en cuanto carga, ya filtra de verdad.
eq('cargado → Desincorporados ya excluye al activo', pasa('activo-1', 'inactivos'), false);

// ── 6) GUARDAS SOBRE LA PANTALLA (las otras dos mitades del problema) ──────
const scr = fs.readFileSync(path.join(ROOT, 'src/screens/PagoPersonalScreen.tsx'), 'utf8');

ok('el filtro usa la función pura, no una copia', /pasaFiltroEstado\(it\.employee_id/.test(scr));
ok('no quedó una reimplementación del filtro en la pantalla',
  !/estadoSel === 'activos'\s*\)\s*return st === 'activo'/.test(scr));

ok('existe "👤 Agregar persona"', scr.includes('👤 Agregar persona'));
ok('el selector de persona NO filtra por estado (trae desincorporados)',
  /abrirAgregarPersona[\s\S]{0,600}?from\('employees'\)[\s\S]{0,200}?\.order\('first_name'\)/.test(scr)
  && !/abrirAgregarPersona[\s\S]{0,600}?\.eq\('status', 'activo'\)/.test(scr));
ok('el selector marca a los desincorporados', /Desincorporado/.test(scr));

// "Quitar del período" ya no puede estar amarrado a source === 'manual'.
ok('"Quitar del período" no depende de source === manual',
  !/editItem\.source === 'manual' \?\s*\(\s*<TouchableOpacity onPress=\{\(\) => \{ setEditItem\(null\); eliminarItem/.test(scr));
ok('"Quitar del período" sigue bloqueado en período aprobado/pagado',
  /\{!readOnly \?\s*\(\s*<TouchableOpacity onPress=\{\(\) => \{ setEditItem\(null\); eliminarItem/.test(scr));

// ── 7) PESTAÑAS CARBOZULIA Y SEGURIDAD (29-ago-2026) ───────────────────────
// A diferencia de la pantalla de Empleados, acá los grupos NO se descuentan de
// Todos/Activos: son un ATAJO para filtrar y exportar. El TOTAL del período los
// incluye, así que esconderlos haría que la lista no cuadre con el monto.
const GR = new Map([
  ['carbo-1', 'carbozulia'],
  ['segu-1', 'seguridad'],
]);
const ST2 = new Map([
  ['carbo-1', 'activo'],
  ['segu-1', 'activo'],
  ['normal-1', 'activo'],
  ['inactivo-2', 'inactivo'],
]);
const pasaG = (id, filtro) => pasaFiltroEstado(id, filtro, ST2, true, GR);

eq('Carbozulia trae a los suyos', pasaG('carbo-1', 'carbozulia'), true);
eq('Carbozulia no trae a Seguridad', pasaG('segu-1', 'carbozulia'), false);
eq('Carbozulia no trae al resto', pasaG('normal-1', 'carbozulia'), false);
eq('Seguridad trae a los suyos', pasaG('segu-1', 'seguridad'), true);
eq('Seguridad no trae a Carbozulia', pasaG('carbo-1', 'seguridad'), false);
// ⭐ Lo que separa esta pantalla de la de Empleados: acá SIGUEN contando.
eq('Carbozulia SIGUE en Todos', pasaG('carbo-1', 'todos'), true);
eq('Seguridad SIGUE en Todos', pasaG('segu-1', 'todos'), true);
eq('Carbozulia SIGUE en Activos', pasaG('carbo-1', 'activos'), true);
eq('Seguridad SIGUE en Activos', pasaG('segu-1', 'activos'), true);
// Un renglón suelto (sin employee_id) no puede caer en un grupo.
eq('sin ficha no es de ningún grupo', pasaG(null, 'carbozulia'), false);
// Sin el mapa de grupos (llamada vieja de 4 argumentos) no se inventa nada.
eq('sin mapa de grupos no muestra a nadie', pasaFiltroEstado('carbo-1', 'carbozulia', ST2, true), false);
// Mientras carga, las pestañas de grupo salen VACÍAS (no con el período entero).
eq('cargando → Carbozulia vacía', pasaFiltroEstado('carbo-1', 'carbozulia', new Map(), false, GR), false);
// Las llamadas de 4 argumentos que ya existían siguen comportándose igual.
eq('compatibilidad: Todos sin mapa', pasaFiltroEstado('normal-1', 'todos', ST2, true), true);
eq('compatibilidad: Inactivos sin mapa', pasaFiltroEstado('inactivo-2', 'inactivos', ST2, true), true);

ok('la pantalla le pasa el mapa de grupos a la función pura',
  /pasaFiltroEstado\(it\.employee_id, estadoSel, itemEmployeeStatus, statusLoaded, itemEmployeeGrupo\)/.test(scr));
ok('la pantalla usa grupoApartado (misma regla que Empleados), no una copia',
  /grupoApartado\(/.test(scr) && /from '\.\.\/lib\/nominaGrupos'/.test(scr));
ok('los dos chips nuevos están en la barra de estado',
  /k: 'carbozulia'/.test(scr) && /k: 'seguridad'/.test(scr));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-staff-pay-estado · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
