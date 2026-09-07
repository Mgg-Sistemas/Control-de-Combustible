/*
 * LOS MODULOS DE LA AUDITORIA SON LAS SECCIONES DE LA APP (07-sep-2026).
 *
 * Pedido del cliente, textual: «cuando me refiero a modulo, no me refiero a flota
 * y maquinaria, sino que por modulo me imaginaba a Control, Inspecciones... la
 * idea es que si yo busco por modulos, pueda ver los cambios que se hicieron en
 * Nomina, o en Inspecciones, o en cualquier otro».
 *
 * Antes el reparto era por TABLA de base de datos, en once cajones, y uno solo
 * -"Maquinaria y flota"- se tragaba el Catalogo, el Control de maquinaria, el
 * Servicio (averias), el Mantenimiento y la flota.
 *
 * LA TRAMPA DE FONDO: `audit_log` guarda QUE TABLA se toco, NO de que pantalla
 * vino, y a `machinery` le escriben ~20 pantallas. Lo unico que desempata son las
 * ACCIONES propias de la app (JORNADA_INICIO, JORNADA_FIN, PARADA, CHECK, SCAN):
 * por eso el modulo se decide por (tabla + accion), en ese orden. Si alguien
 * invierte ese orden, TODAS las jornadas vuelven a salir como "Catalogo".
 *
 * Lo que fijan estos casos:
 *   - que una jornada sobre `machinery` sea CONTROL y no Catalogo;
 *   - que ninguna tabla con trigger de auditoria caiga en "Otro" (el 20-ago-2026
 *     habia once asi y medio sistema se veia como "Otro");
 *   - que el filtro por modulo y el agrupado usen LA MISMA regla (si se separan,
 *     filtrar por Control y agrupar por Control dan cosas distintas);
 *   - y que la libreria sea pura: no toca la base de datos (el cliente pidio
 *     expresamente que la auditoria no se abuse ni se tumbe).
 *
 *   node scripts/test-auditoria-modulos.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const mod = { exports: {} };
new Function('exports', 'module', ts.transpileModule(
  fs.readFileSync(path.join(ROOT, 'src/lib/auditModulos.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } },
).outputText)(mod.exports, mod);

const { MODULOS_AUDITORIA, MODULO_OTRO, moduloDeFila, etiquetaModulo, filaEnModulos, tablasConocidas } = mod.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? '  -> ' + extra : ''}`); } };
/** La clave del modulo de una fila, o null. */
const keyDe = (table_name, action) => (moduloDeFila({ table_name, action }) || {}).key ?? null;

console.log('LOS MODULOS DE LA AUDITORIA\n');

// ── 1) LA LISTA ────────────────────────────────────────────────────────────
{
  ok('hay modulos', MODULOS_AUDITORIA.length >= 10, String(MODULOS_AUDITORIA.length));
  ok('* cada uno con llave, nombre e icono', MODULOS_AUDITORIA.every((m) => m.key && m.label && m.icon));
  ok('* ninguna llave repetida', new Set(MODULOS_AUDITORIA.map((m) => m.key)).size === MODULOS_AUDITORIA.length);
  ok('* ningun nombre repetido', new Set(MODULOS_AUDITORIA.map((m) => m.label)).size === MODULOS_AUDITORIA.length);
  // ⭐ Lo que pidio el cliente: que las secciones que el nombra existan por separado.
  const claves = new Set(MODULOS_AUDITORIA.map((m) => m.key));
  for (const k of ['control', 'inspecciones', 'nomina', 'servicio', 'equipos', 'combustible', 'mantenimiento']) {
    ok(`⭐ existe el modulo "${k}"`, claves.has(k));
  }
  ok('⭐⭐ ya NO existe el cajon "maquinaria" que se tragaba todo', !claves.has('maquinaria'));
}

// ── 2) ⭐⭐ LA ACCION MANDA SOBRE LA TABLA (esto es todo el arreglo) ──────────
{
  // La MISMA tabla, `machinery`, repartida segun lo que se hizo.
  eq('⭐⭐ una JORNADA sobre machinery es CONTROL, no Catalogo', keyDe('machinery', 'JORNADA_INICIO'), 'control');
  eq('* el fin de jornada tambien', keyDe('machinery', 'JORNADA_FIN'), 'control');
  eq('* y una PARADA tambien', keyDe('machinery', 'PARADA'), 'control');
  eq('⭐ asignar la maquina a un inspector (CHECK) es INSPECCIONES', keyDe('machinery', 'CHECK'), 'inspecciones');
  eq('* escanear el QR de una maquina tambien', keyDe('machinery', 'SCAN'), 'inspecciones');
  eq('⭐ editar la FICHA de la maquina si es el Catalogo', keyDe('machinery', 'UPDATE'), 'equipos');
  eq('* crearla tambien', keyDe('machinery', 'INSERT'), 'equipos');
  eq('* y borrarla', keyDe('machinery', 'DELETE'), 'equipos');

  // El SCAN depende de sobre QUE se hizo: un carnet no es una inspeccion.
  eq('⭐ escanear el carnet de un empleado es NOMINA', keyDe('employees', 'SCAN'), 'nomina');
  eq('* y editar su ficha tambien', keyDe('employees', 'UPDATE'), 'nomina');

  eq('entrar al sistema es USUARIOS', keyDe('profiles', 'LOGIN'), 'usuarios');
  eq('* y salir tambien', keyDe('profiles', 'LOGOUT'), 'usuarios');
  eq('* editar un perfil tambien', keyDe('profiles', 'UPDATE'), 'usuarios');

  // ⭐⭐ La mutacion que mas duele: si la tabla ganara sobre la accion, TODAS las
  //     jornadas volverian a salir como "Catalogo de equipos" y el cliente no
  //     tendria como preguntar "que se hizo en Control".
  ok('⭐⭐ jornada y ficha NO caen en el mismo modulo',
    keyDe('machinery', 'JORNADA_INICIO') !== keyDe('machinery', 'UPDATE'));
}

// ── 3) CADA SECCION EN SU CAJON ────────────────────────────────────────────
{
  eq('las jornadas de la maquina', keyDe('machine_rounds', 'UPDATE'), 'control');
  eq('* el cierre del control tambien', keyDe('control_closures', 'INSERT'), 'control');
  eq('las revisiones de maquinaria', keyDe('machine_inspections', 'INSERT'), 'inspecciones');
  eq('* las rondas del supervisor tambien', keyDe('supervisor_visits', 'INSERT'), 'inspecciones');
  eq('el operador asignado', keyDe('operator_assignments', 'INSERT'), 'operadores');
  eq('⭐ una averia es SERVICIO', keyDe('maintenance_requests', 'INSERT'), 'servicio');
  eq('* la orden de servicio tambien', keyDe('machinery_service_orders', 'INSERT'), 'servicio');
  eq('* y sus repuestos', keyDe('machinery_service_parts', 'INSERT'), 'servicio');
  eq('⭐ un expediente de reparacion es MANTENIMIENTO', keyDe('machinery_repairs', 'INSERT'), 'mantenimiento');
  eq('un viaje de camion', keyDe('camion_viajes', 'INSERT'), 'viajes');
  eq('* y la correccion de un viaje de otro dia', keyDe('camion_viajes', 'EDIT_VIAJE_FUERA_JORNADA'), 'viajes');
  eq('un despacho de combustible', keyDe('dispatches', 'INSERT'), 'combustible');
  eq('la nomina', keyDe('staff_pay_payments', 'INSERT'), 'nomina');
  eq('un pago de empresa', keyDe('company_payments', 'INSERT'), 'empresas');
  eq('una compra', keyDe('purchase_orders', 'INSERT'), 'inventario');
  eq('la comida', keyDe('food_distributions', 'INSERT'), 'alimentacion');
  eq('obras publicas', keyDe('op_edificio_base', 'UPDATE'), 'obras');
  eq('los permisos', keyDe('module_permissions', 'UPDATE'), 'usuarios');
  eq('los avisos', keyDe('notifications', 'INSERT'), 'avisos');
}

// ── 4) LO QUE NO SE SABE NO SE INVENTA ─────────────────────────────────────
{
  eq('una tabla desconocida no tiene modulo', keyDe('tabla_que_no_existe', 'INSERT'), null);
  eq('* y se muestra como "Otro" (no se esconde la fila)', etiquetaModulo({ table_name: 'tabla_que_no_existe', action: 'INSERT' }), MODULO_OTRO);
  eq('sin tabla tampoco revienta', keyDe(null, null), null);
  eq('* ni con una fila vacia', moduloDeFila({}), null);
  eq('* ni sin fila', moduloDeFila(undefined), null);
  // Una accion propia DESCONOCIDA no puede tumbar el reparto: manda la tabla.
  eq('una accion nueva que nadie mapeo cae por su tabla', keyDe('machinery', 'ACCION_NUEVA'), 'equipos');
  // Mayusculas/minusculas y espacios de mas no cambian nada.
  eq('la tabla en mayusculas igual', keyDe('MACHINERY', 'UPDATE'), 'equipos');
  eq('* la accion en minusculas tambien', keyDe('machinery', 'jornada_inicio'), 'control');
  eq('* con espacios sobrantes tambien', keyDe('  machinery  ', '  PARADA  '), 'control');
}

// ── 5) LA ETIQUETA QUE SE VE ───────────────────────────────────────────────
{
  const e = etiquetaModulo({ table_name: 'machine_rounds', action: 'UPDATE' });
  ok('la etiqueta lleva icono y nombre', /^\S+\s+Control de maquinaria/.test(e), e);
  ok('* la de una averia dice Servicio', /Servicio/.test(etiquetaModulo({ table_name: 'maintenance_requests', action: 'INSERT' })));
}

// ── 6) ⭐ EL FILTRO Y EL AGRUPADO USAN LA MISMA REGLA ───────────────────────
{
  const fila = { table_name: 'machinery', action: 'JORNADA_INICIO' };
  ok('sin filtro pasa todo', filaEnModulos(fila, new Set()));
  ok('⭐ filtrando por Control, la jornada pasa', filaEnModulos(fila, new Set(['control'])));
  ok('⭐ filtrando por Catalogo, la jornada NO pasa', !filaEnModulos(fila, new Set(['equipos'])));
  ok('* la ficha si pasa por Catalogo', filaEnModulos({ table_name: 'machinery', action: 'UPDATE' }, new Set(['equipos'])));
  ok('* se pueden pedir varios modulos', filaEnModulos(fila, new Set(['nomina', 'control'])));
  ok('una fila sin modulo no pasa ningun filtro', !filaEnModulos({ table_name: 'xxx' }, new Set(['control'])));

  // ⭐⭐ La invariante: filtrar y agrupar tienen que coincidir SIEMPRE. Si un dia
  //     se separan, se puede filtrar por "Control" y ver grupos de otra cosa.
  const casos = [
    ['machinery', 'JORNADA_FIN'], ['machinery', 'UPDATE'], ['machinery', 'CHECK'],
    ['employees', 'SCAN'], ['profiles', 'LOGIN'], ['camion_viajes', 'INSERT'],
    ['maintenance_requests', 'UPDATE'], ['machinery_repairs', 'INSERT'], ['dispatches', 'INSERT'],
  ];
  let coinciden = 0;
  for (const [t, a] of casos) {
    const m = moduloDeFila({ table_name: t, action: a });
    if (m && filaEnModulos({ table_name: t, action: a }, new Set([m.key])) && etiquetaModulo({ table_name: t, action: a }) === `${m.icon} ${m.label}`) coinciden++;
  }
  eq('⭐⭐ filtro, agrupado y etiqueta coinciden en los 9 casos', coinciden, casos.length);
}

// ── 7) ⭐ NINGUNA TABLA AUDITADA CAE EN "OTRO" ──────────────────────────────
// Si una tabla tiene trigger de auditoria pero no esta en el mapa, sus acciones
// salen como "Otro" y el agrupado deja de servir. El 20-ago-2026 habia ONCE asi.
{
  const sqlDir = path.join(ROOT, 'supabase');
  const auditadas = new Set();
  for (const f of fs.readdirSync(sqlDir).filter((x) => x.endsWith('.sql'))) {
    const txt = fs.readFileSync(path.join(sqlDir, f), 'utf8');
    const arr = /foreach t in array array\[([\s\S]*?)\]/.exec(txt);
    if (arr) for (const m of arr[1].matchAll(/'([a-z_]+)'/g)) auditadas.add(m[1]);
    for (const m of txt.matchAll(/create trigger trg_audit\w*\s+[\s\S]{0,80}?on public\.([a-z_]+)/g)) auditadas.add(m[1]);
  }
  auditadas.delete('audit_row'); // es el nombre de la funcion, no una tabla

  ok('se detectaron las tablas auditadas', auditadas.size > 20, `detectadas ${auditadas.size}`);
  const huerfanas = [...auditadas].filter((t) => !moduloDeFila({ table_name: t, action: 'UPDATE' })).sort();
  ok(`⭐ ninguna tabla auditada cae en "Otro" (${auditadas.size} auditadas)`, huerfanas.length === 0,
    huerfanas.length ? `sin modulo: ${huerfanas.join(', ')}` : '');

  // Y al reves: que el mapa no invente tablas que nadie audita (avisa de un typo).
  const noAuditadas = tablasConocidas().filter((t) => !auditadas.has(t));
  ok('las tablas del mapa que nadie audita son pocas y a proposito', noAuditadas.length <= 12, noAuditadas.join(', '));
}

// ── 8) LA PANTALLA OBEDECE, NO DECIDE ──────────────────────────────────────
{
  const crudo = fs.readFileSync(path.join(ROOT, 'src/screens/AuditScreen.tsx'), 'utf8');
  const vivo = crudo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok('⭐ la pantalla ya no define los modulos por su cuenta', !/const MODULES\s*:/.test(vivo));
  ok('* ni el mapa tabla->modulo', !/TABLE_TO_MODULE/.test(vivo));
  ok('la pantalla los pide a la libreria', /from '\.\.\/lib\/auditModulos'/.test(vivo));
  ok('⭐ el agrupado usa la libreria', /groupBy === 'modulo'\) return etiquetaModulo\(r\)/.test(vivo));
  ok('⭐ y el filtro tambien (la MISMA regla)', /filaEnModulos\(r, moduleFilter\)/.test(vivo));
  ok('* las pastillas salen de la lista de la libreria', /MODULOS_AUDITORIA\.map\(/.test(vivo));

  const lib = fs.readFileSync(path.join(ROOT, 'src/lib/auditModulos.ts'), 'utf8');
  const libVivo = lib.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok('⭐ la libreria NO toca la base de datos', !/supabase|\.from\(|insert\(|update\(/.test(libVivo));
  ok('* ni importa React', !/from 'react/.test(libVivo));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-auditoria-modulos · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Los modulos son las secciones de la app; la accion manda sobre la tabla.');
