/*
 * Test de la EDICIÓN MASIVA DE USUARIOS (21-ago-2026).
 *
 * QUÉ PEDIDO CUBRE (textual del cliente):
 *   «dame una opción para editar masivamente a varios usuarios, además de poder
 *    agrupar por roles o buscar por cualquier característica del usuario»
 *   y el caso que lo originó: «quita los permisos de escritura a todos los
 *    usuarios que tengan permiso de catálogo, menos a los admin y a DORIANNE
 *    PEREZ, para que yo no tenga que ir uno a uno».
 *
 * LO QUE BLINDA (`src/lib/usuariosBulk.ts`):
 *   · Agrupar por rol: el personalizado manda sobre el base, y solo salen los
 *     roles que tienen gente.
 *   · Buscar por CUALQUIER característica: nombre, usuario, cédula, rol base,
 *     rol personalizado y estado (bloqueado / inactivo). Sin acentos ni mayúsculas.
 *   · ⚠️ El nivel que le queda DE VERDAD a cada quien:
 *       - un ADMIN nunca baja de 'full' por un permiso explícito;
 *       - con rol personalizado manda el MAYOR entre el rol y lo explícito.
 *     Sin esto, el admin cree que "ya se lo quitó a todos" y media plantilla lo
 *     conserva por su rol.
 *   · El caso completo del cliente: dejar a todos en lectura menos los admin y
 *     Dorianne.
 *
 * No usa framework de test (el repo no tiene): transpila los .ts en memoria con
 * el `typescript` ya instalado.
 *
 *   npm run test:usuarios-bulk   (o: node scripts/test-usuarios-bulk.mjs)
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

const {
  gruposPorRol, filtrarUsuarios, textoBuscableDe, claveRolDe, claveRolBase, claveRolApp,
  nivelEfectivo, motivoNoAplica, repartirPorEfecto,
} = loadTs(path.join(ROOT, 'src/lib/usuariosBulk.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── Datos de prueba ────────────────────────────────────────────────────────
const ROLES = [
  { id: 'r1', name: 'Coordinador de patio', modules: { equipos: 'escritura', mapa: 'lectura' } },
  { id: 'r2', name: 'Analista de datos', modules: { equipos: 'lectura' } },
  { id: 'r3', name: 'Jefe de taller', modules: { servicio: 'full' } },
];
const u = (o) => ({
  id: o.id, full_name: o.name ?? null, role: o.role ?? 'supervisor',
  username: o.username ?? null, cedula: o.cedula ?? null,
  app_role_id: o.app ?? null, locked: o.locked ?? false, active: o.active ?? true,
});
const ADMIN = u({ id: 'a1', name: 'MARIA GONZALEZ', role: 'admin', username: 'mgonzalez', cedula: '12345678' });
const DORIS = u({ id: 'd1', name: 'DORIANNE PEREZ', role: 'analista', username: 'dperez', cedula: '87654321' });
const INSP1 = u({ id: 'i1', name: 'ANGELO VAZQUEZ', username: 'avazquez', cedula: '11111111' });
const INSP2 = u({ id: 'i2', name: 'GLENDER RODRIGUEZ', username: 'grodriguez', locked: true });
const PATIO = u({ id: 'p1', name: 'BRUNO SUAREZ', role: 'operador', app: 'r1' });
const ANALI = u({ id: 'n1', name: 'JOSÉ MARTÍNEZ', role: 'operador', app: 'r2' });
const TALLE = u({ id: 't1', name: 'PEDRO LEÓN', role: 'operador', app: 'r3' });
const TODOS = [ADMIN, DORIS, INSP1, INSP2, PATIO, ANALI, TALLE];
const ids = (arr) => arr.map((x) => x.id).sort();

// ── 1) AGRUPAR POR ROL ─────────────────────────────────────────────────────
{
  // El rol PERSONALIZADO manda sobre el base: Bruno es 'operador' pero se agrupa
  // por "Coordinador de patio", que es lo que ve el admin en la lista.
  eq('agrupa por el rol personalizado si lo tiene', claveRolDe(PATIO), claveRolApp('r1'));
  eq('sin rol personalizado, por el base', claveRolDe(INSP1), claveRolBase('supervisor'));

  const g = gruposPorRol(TODOS, ROLES);
  const porClave = Object.fromEntries(g.map((x) => [x.key, { label: x.label, count: x.count }]));
  eq('cuenta los inspectores (rol base)', porClave[claveRolBase('supervisor')], { label: 'inspector', count: 2 });
  eq('cuenta el rol personalizado por su nombre', porClave[claveRolApp('r1')], { label: 'Coordinador de patio', count: 1 });
  eq('el admin es su propio grupo', porClave[claveRolBase('admin')], { label: 'admin', count: 1 });
  // Ningún chip en cero: solo los roles que de verdad tienen gente.
  ok('no hay grupos vacíos', g.every((x) => x.count > 0));
  eq('total de los grupos = total de usuarios', g.reduce((s, x) => s + x.count, 0), TODOS.length);
  // Los operadores 'r2' y 'r3' NO se mezclan con el 'operador' base.
  ok('roles personalizados no se mezclan entre sí', porClave[claveRolApp('r2')].count === 1 && porClave[claveRolApp('r3')].count === 1);
}

// ── 2) BUSCAR POR CUALQUIER CARACTERÍSTICA ─────────────────────────────────
{
  const buscar = (q) => ids(filtrarUsuarios(TODOS, { q, appRoles: ROLES }));
  eq('por nombre', buscar('dorianne'), ['d1']);
  eq('por apellido', buscar('vazquez'), ['i1']);
  eq('por usuario', buscar('grodriguez'), ['i2']);
  eq('por cédula', buscar('87654321'), ['d1']);
  eq('por rol base (etiqueta visible)', buscar('inspector'), ['i1', 'i2']);
  eq('por rol base (clave interna)', buscar('supervisor'), ['i1', 'i2']);
  eq('por nombre del rol personalizado', buscar('patio'), ['p1']);
  eq('por estado bloqueado', buscar('bloqueado'), ['i2']);
  // Sin acentos ni mayúsculas: "MARTINEZ" encuentra a "JOSÉ MARTÍNEZ".
  eq('sin acentos', buscar('martinez'), ['n1']);
  eq('sin acentos al revés', buscar('LEON'), ['t1']);
  eq('búsqueda vacía = todos', buscar(''), ids(TODOS));
  eq('sin resultados', buscar('zzzz'), []);
}

// ── 3) BUSCAR + AGRUPAR A LA VEZ ───────────────────────────────────────────
{
  const soloInspectores = new Set([claveRolBase('supervisor')]);
  eq('solo el grupo elegido', ids(filtrarUsuarios(TODOS, { roles: soloInspectores, appRoles: ROLES })), ['i1', 'i2']);
  eq('grupo + texto', ids(filtrarUsuarios(TODOS, { roles: soloInspectores, q: 'angelo', appRoles: ROLES })), ['i1']);
  eq('grupos vacío = todos los roles', ids(filtrarUsuarios(TODOS, { roles: new Set(), appRoles: ROLES })), ids(TODOS));
  const dos = new Set([claveRolBase('admin'), claveRolApp('r1')]);
  eq('varios grupos a la vez', ids(filtrarUsuarios(TODOS, { roles: dos, appRoles: ROLES })), ['a1', 'p1']);
}

// ── 4) ⭐ EL PERMISO EXPLÍCITO LE GANA AL ROL ──────────────────────────────
// «si yo le quito los permisos a alguien, no importa el rol, se los pueda quitar»
{
  // Un ADMIN no baja por un permiso explícito: eso se cambia por ROL, no por
  // permiso. Es la ÚNICA excepción que queda.
  eq('al admin no se le baja con un permiso', nivelEfectivo(ADMIN, 'equipos', 'lectura', ROLES), 'full');
  ok('y se avisa el motivo', /ADMIN/.test(motivoNoAplica(ADMIN, 'equipos', 'lectura', ROLES) ?? ''));

  // ⭐ EL CAMBIO: el rol personalizado da "escritura" en equipos, pero al ponerle
  // "lectura" a ESTA persona, queda en lectura. Antes se tomaba el mayor de los
  // dos y seguía escribiendo — quitarle el permiso a uno era imposible sin
  // bajárselo a TODOS los que tienen ese rol.
  eq('⭐ el permiso explícito le gana al rol (baja)', nivelEfectivo(PATIO, 'equipos', 'lectura', ROLES), 'lectura');
  eq('y por eso ya no hay nada que avisar', motivoNoAplica(PATIO, 'equipos', 'lectura', ROLES), null);
  eq('quitarlo del todo también funciona', nivelEfectivo(PATIO, 'equipos', 'none', ROLES), 'none');

  // Lo que ya funcionaba SIGUE funcionando: un explícito mayor sube igual.
  eq('el permiso explícito también sube', nivelEfectivo(ANALI, 'equipos', 'escritura', ROLES), 'escritura');
  eq('sin aviso', motivoNoAplica(ANALI, 'equipos', 'escritura', ROLES), null);
  eq('rol sin ese módulo + explícito full = full', nivelEfectivo(TALLE, 'equipos', 'full', ROLES), 'full');

  // Usuario común, sin rol personalizado: queda exactamente lo que se puso.
  eq('usuario común queda con lo elegido', nivelEfectivo(INSP1, 'equipos', 'lectura', ROLES), 'lectura');
  eq('sin aviso', motivoNoAplica(INSP1, 'equipos', 'lectura', ROLES), null);
  eq('también sirve para SUBIR', nivelEfectivo(INSP1, 'equipos', 'full', ROLES), 'full');
}

// ── 5) EL CASO DEL CLIENTE, COMPLETO ───────────────────────────────────────
// «quita los permisos de escritura a todos, menos a los admin y a DORIANNE PEREZ»
{
  const exceptuados = new Set(['a1', 'd1']);
  const aEditar = TODOS.filter((x) => !exceptuados.has(x.id));
  eq('se editan todos menos admin y Dorianne', ids(aEditar), ['i1', 'i2', 'n1', 'p1', 't1']);

  const { aplican, noAplican } = repartirPorEfecto(aEditar, 'equipos', 'lectura', ROLES);
  // ⭐ TODOS quedan en lectura, incluido Bruno, cuyo rol "Coordinador de patio"
  // da escritura en equipos: el permiso de la persona le gana al rol.
  eq('⭐ a TODOS les queda lectura, sin importar el rol', ids(aplican), ['i1', 'i2', 'n1', 'p1', 't1']);
  eq('no queda nadie por fuera', noAplican, []);
  eq('nadie se pierde en el reparto', aplican.length + noAplican.length, aEditar.length);

  // Y si se cuela un admin en la selección, ESE sí se avisa aparte.
  const conAdmin = repartirPorEfecto([...aEditar, ADMIN], 'equipos', 'lectura', ROLES);
  eq('el admin sí sale avisado', ids(conAdmin.noAplican.map((x) => x.u)), ['a1']);

  // Y los exceptuados conservan lo suyo.
  eq('el admin sigue en full', nivelEfectivo(ADMIN, 'equipos', 'lectura', ROLES), 'full');
  eq('Dorianne conserva escritura si se le deja', nivelEfectivo(DORIS, 'equipos', 'escritura', ROLES), 'escritura');
}

// ── 6) BASURA: no revienta ────────────────────────────────────────────────
{
  eq('sin usuarios', gruposPorRol([], ROLES), []);
  eq('sin roles', gruposPorRol([INSP1], null).length, 1);
  eq('filtrar sin opciones', filtrarUsuarios(TODOS, {}).length, TODOS.length);
  const vacio = { id: 'x' };
  eq('usuario sin ningún dato no revienta', typeof textoBuscableDe(vacio, null), 'string');
  eq('y se agrupa igual', claveRolDe(vacio), claveRolBase(''));
  eq('nivel de un usuario vacío', nivelEfectivo(vacio, 'equipos', 'lectura', null), 'lectura');
  eq('rol personalizado que ya no existe', nivelEfectivo(u({ id: 'z', app: 'BORRADO' }), 'equipos', 'lectura', ROLES), 'lectura');
}

// ── Resultado ─────────────────────────────────────────────────────────────
console.log(`\n👥  Edición masiva de usuarios (agrupar por rol · buscar · nivel real)`);
console.log(`   ${pass} OK · ${fail} fallo(s)`);
if (fail) {
  console.log(`\n${failures.join('\n')}\n`);
  process.exit(1);
}
console.log('   ✅ Todo en verde\n');
