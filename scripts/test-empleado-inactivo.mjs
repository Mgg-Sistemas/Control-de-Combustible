/*
 * Test de 🚫 EMPLEADO INACTIVO NO RECIBE COMIDA (26-sep-2026).
 *
 * Pedido del cliente, textual:
 *   «cuando se marque en nomina un empleado como deshabilitado o inactivo, no
 *    permitas que desde comidas o distribucion pueda recibir comidas. Que al
 *    escanear el carnet salga un msj que diga EMPLEADO INACTIVO»
 *
 * LO QUE BLINDA, Y POR QUÉ DUELE SI SE ROMPE:
 *   · ⭐ «OTRO» NO TRANCA. Nómina tiene CUATRO estados y «Otro» es un grupo
 *     aparte, con su propia pastilla y su propio conteo. Trancarlo dejaría sin
 *     comer a 42 personas que la empresa nunca marcó como salida. Si alguien
 *     cambia esto por «todo lo que no sea activo», esta prueba se pone roja.
 *   · ⭐ EL CARTEL DICE «EMPLEADO INACTIVO», que es lo que se pidió, y dice
 *     QUIÉN y DÓNDE se arregla: un «no se puede» pelado deja al cocinero
 *     discutiendo en el mostrador sin saber a quién mandar a la persona.
 *   · EL CANDADO ESTÁ EN LA BASE. La comida se registra desde DOS sitios (el
 *     mostrador y el editor de Comidas); una regla que viva solo en una pantalla
 *     se olvida en la otra.
 *   · ⚠️ NO SE TOCA NI UNA ENTREGA VIEJA: lo que se sirvió, servido está. Los
 *     reportes y los cobros lo siguen mostrando igual.
 *
 * Valores inventados: no hay datos reales en el repositorio (es público).
 *
 *   node scripts/test-empleado-inactivo.mjs
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
function loadTs(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(abs), id) + '.ts') : orig(id));
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond, extra) => eq(name + (extra ? ` [${extra}]` : ''), !!cond, true);

const E = loadTs('src/lib/empleadoEstado.ts');

// ── 1) QUIÉN COME Y QUIÉN NO ────────────────────────────────────────────────
{
  eq('un activo come', E.puedeRecibirComida('activo'), true);
  eq('⭐ un INACTIVO no come', E.puedeRecibirComida('inactivo'), false);
  eq('⭐ un SUSPENDIDO tampoco', E.puedeRecibirComida('suspendido'), false);
  // ⭐ LA LÍNEA QUE HAY QUE CUIDAR. «Otro» es un grupo aparte en Nómina —tiene su
  //    propia pastilla y su propio conteo—, y el pedido nombró «deshabilitado o
  //    inactivo». Trancarlo dejaría sin comer a gente que nadie marcó como salida.
  eq('⭐ «Otro» SÍ come: en Nómina es un grupo aparte', E.puedeRecibirComida('otro'), true);
  // Un estado que Nómina invente mañana tampoco tranca por sorpresa.
  eq('un estado desconocido no tranca solo', E.puedeRecibirComida('vacaciones'), true);
  eq('sin estado, come (no se tranca por un dato que falta)', E.puedeRecibirComida(null), true);
  eq('vacío tampoco tranca', E.puedeRecibirComida(''), true);
  // Cómo esté escrito no cambia la regla: la base tiene de todo.
  eq('MAYÚSCULAS igual trancan', E.puedeRecibirComida('INACTIVO'), false);
  eq('con espacios también', E.puedeRecibirComida('  Inactivo  '), false);
  eq('la lista de los que no comen es corta y explícita',
    [...E.ESTADOS_SIN_COMIDA], ['inactivo', 'suspendido']);
}

// ── 2) EL CARTEL QUE SE PIDIÓ ───────────────────────────────────────────────
{
  // ⭐ TEXTUAL DEL CLIENTE: «que salga un msj que diga EMPLEADO INACTIVO».
  eq('⭐ el cartel dice EMPLEADO INACTIVO', E.etiquetaBloqueo('inactivo'), 'EMPLEADO INACTIVO');
  eq('y el suspendido dice la verdad de lo suyo', E.etiquetaBloqueo('suspendido'), 'EMPLEADO SUSPENDIDO');
  eq('un activo no tiene cartel', E.etiquetaBloqueo('activo'), null);
  eq('«Otro» tampoco', E.etiquetaBloqueo('otro'), null);

  const m = E.mensajeBloqueo('JUAN PEREZ', 'inactivo');
  ok('⭐ el aviso lleva el cartel', m.includes('EMPLEADO INACTIVO'));
  ok('...y dice de QUIÉN se trata', m.includes('JUAN PEREZ'));
  // ⚠️ Un «no se puede» pelado deja al cocinero discutiendo en el mostrador.
  ok('⭐ ...y dónde se arregla', /Nómina/i.test(m));
  ok('...y que no puede recibir comida', /no puede recibir comida/i.test(m));
  eq('sin nombre no queda un « · » suelto', E.mensajeBloqueo('', 'inactivo').includes(' · '), false);
  eq('un activo no genera aviso', E.mensajeBloqueo('JUAN', 'activo'), null);
}

// ── 3) EL RECHAZO DE LA BASE, EN CRIOLLO ────────────────────────────────────
{
  // Este es el texto EXACTO que devolvió la base el 26-sep-2026 al probarlo.
  const real = 'EMPLEADO INACTIVO: JOHAN PROIETTO esta marcado como inactivo en Nomina y no puede recibir comida';
  eq('⭐ reconoce el rechazo del trigger', E.esErrorEmpleadoInactivo(real), true);
  eq('...y el del suspendido', E.esErrorEmpleadoInactivo('EMPLEADO SUSPENDIDO: X esta suspendido'), true);
  eq('un error cualquiera no se confunde', E.esErrorEmpleadoInactivo('duplicate key value'), false);
  eq('nada no revienta', E.esErrorEmpleadoInactivo(null), false);

  const limpio = E.mensajeDeErrorInactivo(real);
  ok('⭐ el mostrador ve el cartel, no un error de Postgres', limpio.startsWith('🚫 EMPLEADO INACTIVO'));
  ok('...con el nombre de la persona', limpio.includes('JOHAN PROIETTO'));
  eq('otro error se deja pasar tal cual', E.mensajeDeErrorInactivo('permission denied'), null);
  // ⚠️ Postgres pega el SQLSTATE y la función en el mensaje: no deben salir.
  const sucio = 'PostgREST error P0001: EMPLEADO INACTIVO: ANA LOPEZ esta marcada\nCONTEXT: PL/pgSQL function food_bloquea_empleado_inactivo()';
  ok('⭐ no arrastra el CONTEXT de Postgres', !/CONTEXT/i.test(E.mensajeDeErrorInactivo(sucio)));
  ok('...ni la línea de abajo', !E.mensajeDeErrorInactivo(sucio).includes('\n'));
}

// ── 4) EL CANDADO DE LA BASE ────────────────────────────────────────────────
{
  const sql = leer('supabase/comida_empleado_inactivo.sql');
  ok('crea la regla', /create or replace function public\.food_bloquea_empleado_inactivo/.test(sql));
  ok('⭐ el mensaje es el que se pidió', /raise exception 'EMPLEADO INACTIVO/.test(sql));
  ok('...y el del suspendido también', /raise exception 'EMPLEADO SUSPENDIDO/.test(sql));
  ok('⭐ «otro» NO está en la lista de los que trancan',
    !/st = 'otro'/.test(sql) && !/in \('inactivo', 'suspendido', 'otro'\)/.test(sql));
  ok('un contacto de cocina no tiene estado que revisar', /if new\.employee_id is null then\s*return new;/.test(sql));
  // ⚠️ Si el empleado no existe, que se queje la llave foránea con su mensaje.
  ok('un empleado que no existe no es asunto de este trigger', /if st is null then\s*return new;/.test(sql));
  // ⭐ Solo al INSERT y al cambiar de persona: editar la nota de una comida vieja
  //    no puede volverse imposible porque la persona se dio de baja después.
  ok('⭐ solo tranca al registrar, no al corregir lo viejo',
    /before insert or update of employee_id on public\.food_distributions/.test(sql));
  // ⭐ EL CONTROL QUE IMPORTA: no toca ni una fila.
  ok('⭐ no borra ninguna entrega', !/delete from public\.food_distributions/i.test(sql));
  ok('...ni las modifica', !/update public\.food_distributions/i.test(sql));
  ok('...ni toca la nómina', !/update public\.employees/i.test(sql) && !/delete from public\.employees/i.test(sql));
  ok('trae su verificación', /✅/.test(sql));
  ok('avisa a cuánta gente afecta', /comieron en los últimos 30 días/i.test(sql));
  ok('y cómo se deshace', /drop trigger if exists trg_food_empleado_inactivo/.test(sql));
}

// ── 5) LA PANTALLA DE COCINA ────────────────────────────────────────────────
{
  const s = sinComentarios(leer('src/screens/CocinaScreen.tsx'));
  // Sin traer el estado, la pantalla no puede saber a quién trancar.
  ok('⭐ trae el estado del empleado al escanear',
    (s.match(/photo_url, status, company:company_id\(name\)/g) ?? []).length === 2);
  // ⭐ LOS DOS CAMINOS DEL CARNET: abrir la ficha y el torniquete.
  ok('⭐ lo tranca en los dos caminos del carnet',
    (s.match(/const bloqueo = mensajeBloqueo\(p\.name, p\.status\);/g) ?? []).length === 2);
  ok('...y no le deja la ficha abierta', /setPerson\(null\); setTodayList\(\[\]\); setNotice\(bloqueo\); return;/.test(s));
  // Defensa en profundidad: la pantalla vive abierta horas en el mostrador.
  ok('⭐ revisa otra vez al registrar la comida', /!esContacto && !puedeRecibirComida\(person\.status\)/.test(s));
  // Si lo trancó la base, se ve el cartel y no un error crudo.
  ok('⭐ el rechazo de la base se muestra como el cartel',
    (s.match(/mensajeDeErrorInactivo\(error\)/g) ?? []).length === 2);
  // ⚠️ Un CONTACTO de cocina no es de nómina: no tiene estado y paga lo suyo.
  ok('⭐ a un contacto de cocina no se le aplica', /!esContacto && !puedeRecibirComida/.test(s));
}

// ── 6) EL EDITOR DE COMIDAS ─────────────────────────────────────────────────
{
  // La otra puerta: agregar una entrega en cualquier día desde 🍲 Comidas.
  const s = sinComentarios(leer('src/lib/comidaEditar.ts'));
  ok('⭐ el editor también muestra el cartel', /const inactivo = mensajeDeErrorInactivo\(msg\);\s*if \(inactivo\) return inactivo;/.test(s));
  // ⚠️ Va ANTES del check genérico, o se leería «La base no acepta ese valor».
  const iInactivo = s.indexOf('mensajeDeErrorInactivo');
  const iCheck = s.indexOf('23514');
  ok('⭐ y va ANTES del «la base no acepta ese valor»', iInactivo > 0 && iInactivo < iCheck);
}

// ── 7) MANUALES ─────────────────────────────────────────────────────────────
{
  ok('manual (md) lo explica', /empleado inactivo no recibe comida \(26\/09\/2026\)/i.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) lo explica', /EMPLEADO INACTIVO NO RECIBE COMIDA \(26\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-empleado-inactivo · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
