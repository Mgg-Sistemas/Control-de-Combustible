/*
 * Test de QUIÉN TOCÓ LAS COMIDAS (18-sep-2026).
 *
 * Pedido del cliente: «que quede un registro de quién borró y cuándo borró
 * cualquier registro de las comidas, o quién creó el nuevo modo de comida».
 *
 * Lo que fija:
 *   · de un BORRADO se puede reconstruir QUÉ se borró, porque el trigger guarda
 *     la fila entera en `changes` (si esto se rompe, queda «Fulano borró la fila
 *     a3b4…» y no sirve de nada)
 *   · un CAMBIO se lee como «platos: 12 → 9», con los nombres en español
 *   · la hora va en Caracas, escrita, no en la del teléfono
 *   · solo pasan las tablas de COMIDA: `audit_log` recibe una fila por cada
 *     escritura de ~34 tablas, y sin filtro saldrían jornadas y combustible
 *   · el catálogo de platos «Otros» (el «nuevo modo de comida») está vigilado
 *   · el orden es del más reciente al más viejo
 *
 *   node scripts/test-comida-movimientos.mjs
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

function loadTs(rel) {
  const abs = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  m._compile(out, m.filename);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const M = loadTs('src/lib/comidaMovimientos.ts');

// ── 0) NO IMPORTA NADA ──────────────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/comidaMovimientos.ts'), 'utf8');
  ok('⭐ comidaMovimientos.ts no importa nada (se prueba sola)', !/^\s*import\s/m.test(src));
}

// ── FILAS DE `audit_log` COMO LAS ESCRIBE EL TRIGGER ────────────────────────
// En DELETE, `changes` es la fila borrada completa (supabase/audit_detalle.sql).
// En UPDATE, es {campo:{de,a}}. En INSERT, la fila creada.
const filas = [
  {
    id: 1, at: '2026-09-17T15:12:00Z', user_name: 'Jefa de Comida', action: 'DELETE',
    table_name: 'food_company_meals', row_id: 'a3',
    changes: { id: 'a3', company_name: 'EMPRESA DOS', meal_type: 'almuerzo', meal_date: '2026-09-14', delivered: 12, unit_cost: 0 },
  },
  {
    id: 2, at: '2026-09-17T16:00:00Z', user_name: 'Jefa de Comida', action: 'UPDATE',
    table_name: 'food_company_meals', row_id: 'a2',
    changes: { delivered: { de: 12, a: 9 }, note: { de: null, a: 'sobraron 3' } },
  },
  {
    id: 3, at: '2026-09-17T17:00:00Z', user_name: 'Cocina Uno', action: 'INSERT',
    table_name: 'food_extra_items', row_id: 'i1',
    changes: { id: 'i1', name: 'Bolsa de hielo', active: true },
  },
  {
    id: 4, at: '2026-09-17T18:00:00Z', user_name: 'Jefa de Comida', action: 'DELETE',
    table_name: 'food_distributions', row_id: 'p9',
    changes: { id: 'p9', employee_name: 'Persona Uno', meal_type: 'cena', distribution_date: '2026-09-16', meals: 2 },
  },
  // Ruido de OTRO módulo: no puede salir en la tarjeta de comidas.
  { id: 5, at: '2026-09-17T19:00:00Z', user_name: 'Otro', action: 'DELETE', table_name: 'machine_rounds', row_id: 'j1', changes: { id: 'j1' } },
  { id: 6, at: '2026-09-17T19:30:00Z', user_name: 'Otro', action: 'INSERT', table_name: 'dispatches', row_id: 'd1', changes: { id: 'd1' } },
];

const movs = M.movimientosDeComida(filas);

// ── 1) SOLO LAS TABLAS DE COMIDA ────────────────────────────────────────────
{
  eq('⭐ pasan las 4 de comida y se caen las 2 de otros módulos', movs.length, 4);
  ok('no se coló la jornada', !movs.some((m) => m.titulo.includes('j1')));
  eq('las tablas vigiladas son las cinco de comida', [...M.TABLAS_COMIDA].sort(), [
    'comida_cuentas_config', 'comida_precios', 'food_company_meals', 'food_distributions', 'food_extra_items',
  ]);
  ok('⭐ el catálogo de platos «Otros» está vigilado (el «nuevo modo de comida»)',
    M.TABLAS_COMIDA.includes('food_extra_items'));
}

// ── 2) DE UN BORRADO SE SABE QUÉ SE BORRÓ ───────────────────────────────────
{
  const b = movs.find((m) => m.clave === '1');
  eq('es un borrado', b.tipo, 'borrado');
  eq('con su verbo', b.verbo, 'Borró');
  eq('y su icono', b.icono, '🗑️');
  eq('quién', b.quien, 'Jefa de Comida');
  ok('⭐ dice CUÁNTOS platos eran', b.titulo.includes('12'));
  ok('⭐ dice de QUÉ empresa', b.titulo.includes('EMPRESA DOS'));
  ok('⭐ dice de QUÉ día', b.titulo.includes('14/09'));
  ok('⭐ y de qué comida', b.titulo.includes('almuerzo'));

  const bp = movs.find((m) => m.clave === '4');
  ok('de una persona dice el nombre', bp.titulo.includes('Persona Uno'));
  ok('...cuántas comidas', bp.titulo.includes('2'));
  ok('...y el día', bp.titulo.includes('16/09'));
}

// ── 3) UN CAMBIO SE LEE EN CRIOLLO ──────────────────────────────────────────
{
  const c = movs.find((m) => m.clave === '2');
  eq('es un cambio', c.tipo, 'cambio');
  eq('con su verbo', c.verbo, 'Corrigió');
  ok('⭐ dice de cuánto a cuánto', c.detalle.includes('platos: 12 → 9'));
  ok('⭐ el nombre del campo va en español, no «delivered»', !c.detalle.includes('delivered'));
  ok('un valor vacío se dice «(vacío)»', c.detalle.includes('(vacío)'));
  ok('...y el nuevo también sale', c.detalle.includes('sobraron 3'));
}

// ── 4) EL PLATO NUEVO ───────────────────────────────────────────────────────
{
  const a = movs.find((m) => m.clave === '3');
  eq('es un alta', a.tipo, 'alta');
  eq('con su verbo', a.verbo, 'Agregó');
  ok('⭐ dice qué plato se creó', a.titulo.includes('Bolsa de hielo'));
  ok('y quién lo creó', a.quien === 'Cocina Uno');
}

// ── 5) ORDEN Y RESUMEN ──────────────────────────────────────────────────────
{
  ok('⭐ del más reciente al más viejo', movs.every((m, i) => i === 0 || movs[i - 1].at >= m.at));
  const r = M.resumenMovimientos(movs);
  ok('cuenta los borrados', r.includes('2 borrada(s)'));
  ok('cuenta las correcciones', r.includes('1 corregida(s)'));
  ok('cuenta las altas', r.includes('1 agregada(s)'));
  ok('⭐ cuenta 2 personas distintas, no 4 renglones', r.includes('2 personas'));
  eq('sin nada, lo dice sin asustar', M.resumenMovimientos([]), 'Nadie ha agregado, corregido ni borrado comidas en estas fechas.');
}

// ── 6) LAS PASTILLAS DE LA TARJETA ──────────────────────────────────────────
{
  eq('«todo» no filtra', M.soloDelTipo(movs, 'todo').length, 4);
  eq('solo borrados', M.soloDelTipo(movs, 'borrado').length, 2);
  eq('solo cambios', M.soloDelTipo(movs, 'cambio').length, 1);
  eq('solo altas', M.soloDelTipo(movs, 'alta').length, 1);
}

// ── 7) LA HORA VA EN CARACAS ────────────────────────────────────────────────
{
  // 2026-09-17T15:12:00Z son las 11:12 a. m. en Caracas (UTC−4).
  const h = M.fechaHoraCaracas('2026-09-17T15:12:00Z');
  ok(`⭐ la hora se escribe en Caracas, no en UTC (salió «${h}»)`, h.includes('11:12'));
  ok('...con su fecha', h.includes('17/09/2026'));
  eq('una fecha rota no revienta la tarjeta', M.fechaHoraCaracas('nada'), '—');
}

// ── 8) LO QUE FALTA NO SE INVENTA ───────────────────────────────────────────
{
  const sinNombre = M.movimientosDeComida([
    { id: 9, at: '2026-09-17T12:00:00Z', user_name: null, action: 'DELETE', table_name: 'food_company_meals', row_id: 'z', changes: { delivered: 3 } },
  ]);
  eq('sin nombre de usuario se dice, no se deja en blanco', sinNombre[0].quien, M.SIN_NOMBRE);
  ok('sin empresa se dice', sinNombre[0].titulo.includes('empresa sin nombre'));

  const sinChanges = M.movimientosDeComida([
    { id: 10, at: '2026-09-17T12:00:00Z', user_name: 'A', action: 'DELETE', table_name: 'food_distributions', row_id: 'abcdef123456', changes: null },
  ]);
  ok('⭐ sin `changes` no revienta: cae a algo legible', sinChanges.length === 1 && sinChanges[0].titulo.length > 0);
}

// ── 9) LA TABLA NUEVA ESTÁ EN EL MAPA DE MÓDULOS DE AUDITORÍA ───────────────
//
// Si no, la pantalla de Auditoría la manda a «📁 Otro» y la prueba de módulos
// falla en otro archivo. Se comprueba acá también porque es parte del pedido.
{
  const mapa = fs.readFileSync(path.join(ROOT, 'src/lib/auditModulos.ts'), 'utf8');
  ok('⭐ food_extra_items está mapeado a alimentación', /food_extra_items:\s*'alimentacion'/.test(mapa));
  const pantalla = fs.readFileSync(path.join(ROOT, 'src/screens/AuditScreen.tsx'), 'utf8');
  ok('...y tiene nombre legible en Auditoría', /food_extra_items:\s*'/.test(pantalla));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-comida-movimientos · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
