/*
 * Test de las COLUMNAS del reporte de ASISTENCIA DE CAMIONES (14-sep-2026).
 *
 * Pedido del cliente: poder poner o quitar placa, modelo, empresa y el enumerado,
 * «como está en el de reportes conteo de equipos».
 *
 * Lo que fija:
 *   · encabezado y filas salen de la MISMA lista de columnas
 *   · camión, salida, entrada y estado no se pueden quitar
 *   · el orden es por código Y placa, para que el Nº le caiga siempre al mismo camión
 *   · la pantalla y el PDF usan la misma regla de estado
 *
 * Sin framework (el repo no tiene): transpila el .ts en memoria con `typescript`.
 *
 *   node scripts/test-camiones-asistencia.mjs
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
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; failures.push(`✗ ${name}\n    obtenido: ${JSON.stringify(got)}\n    esperado: ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const L = cargar('src/lib/camionesAsistenciaColumnas.ts');
const D = L.OPCIONES_ASISTENCIA_POR_DEFECTO;
ok('la librería no importa nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/camionesAsistenciaColumnas.ts'))));

// ── COLUMNAS ────────────────────────────────────────────────────────────────
eq('por defecto sale todo', L.columnasAsistencia(D), ['n', 'camion', 'marcaModelo', 'placa', 'empresa', 'salida', 'entrada', 'estado']);
const todo = Object.fromEntries(Object.keys(D).map((k) => [k, true]));
eq('con todo oculto queda la asistencia', L.columnasAsistencia(todo), ['camion', 'salida', 'entrada', 'estado']);
eq('sin enumerado', L.columnasAsistencia({ ...D, sinNumero: true })[0], 'camion');
ok('sin marca sigue la columna, titulada Modelo', L.columnasAsistencia({ ...D, sinMarca: true }).includes('marcaModelo')
  && L.tituloColumnaAsistencia('marcaModelo', { ...D, sinMarca: true }) === 'Modelo');
ok('sin marca ni modelo la columna no va', !L.columnasAsistencia({ ...D, sinMarca: true, sinModelo: true }).includes('marcaModelo'));
ok('sin placa no va', !L.columnasAsistencia({ ...D, sinPlaca: true }).includes('placa'));
ok('sin empresa no va', !L.columnasAsistencia({ ...D, sinEmpresa: true }).includes('empresa'));
eq('una pastilla por opción', L.PASTILLAS_ASISTENCIA.map((p) => p.key).sort(), Object.keys(D).sort());
eq('cada columna tiene título', L.columnasAsistencia(D).map((c) => L.tituloColumnaAsistencia(c, D)),
  ['Nº', 'Camión', 'Marca / Modelo', 'Placa / Serial', 'Empresa', 'Salida', 'Entrada', 'Estado']);
eq('alternar enciende una sola', L.alternarAsistencia(D, 'sinPlaca'), { ...D, sinPlaca: true });
ok('...sin tocar el original', D.sinPlaca === false);

// ── VALORES ─────────────────────────────────────────────────────────────────
eq('marca y modelo', L.marcaModeloAsistencia({ marca: 'MARCA X', modelo: 'M1' }, D), 'MARCA X M1');
eq('solo modelo', L.marcaModeloAsistencia({ marca: 'MARCA X', modelo: 'M1' }, { ...D, sinMarca: true }), 'M1');
eq('solo marca', L.marcaModeloAsistencia({ marca: 'MARCA X', modelo: 'M1' }, { ...D, sinModelo: true }), 'MARCA X');
eq('sin datos, raya', L.marcaModeloAsistencia({}, D), '—');
eq('placa primero', L.placaAsistencia({ plate: 'P-001', serial: 'S-1' }), 'P-001');
eq('sin placa, el serial', L.placaAsistencia({ plate: '', serial: 'S-1' }), 'S-1');
eq('sin nada, raya', L.placaAsistencia({}), '—');
eq('regresó', L.estadoAsistencia({ salida: 'a', entrada: 'b', jornada: true }), '🟢 Regresó');
eq('en obra con salida', L.estadoAsistencia({ salida: 'a', entrada: null, jornada: false }), '🟠 En obra');
eq('en obra por jornada', L.estadoAsistencia({ salida: null, entrada: null, jornada: true }), '🟠 En obra');
eq('sin salida', L.estadoAsistencia({ salida: null, entrada: null, jornada: false }), '— sin salida');
eq('palabras por defecto', L.ocultosAsistenciaEnPalabras(D), 'Sale completo.');
eq('palabras con placa y empresa ocultas', L.ocultosAsistenciaEnPalabras({ ...D, sinPlaca: true, sinEmpresa: true }), 'Se oculta: placa/serial · empresa.');
eq('archivo por defecto sin sufijo', L.sufijoArchivoAsistencia(D), '');
eq('archivo con lo oculto', L.sufijoArchivoAsistencia({ ...D, sinNumero: true, sinPlaca: true }), ' sin numero, sin placa');

// ⭐ El enumerado no puede saltar de camión: mismo código, desempata la placa.
const orden = L.ordenarCamionesAsistencia([
  { code: 'CAMION VOLTEO TORONTO', plate: 'P-300' },
  { code: 'CHUTO CON VOLQUETA', plate: 'P-100' },
  { code: 'CAMION VOLTEO TORONTO', plate: 'P-020' },
  { code: 'CAMION VOLTEO TORONTO', plate: null, serial: 'S-9' },
]);
eq('orden por código y después placa', orden.map((c) => c.plate ?? c.serial), ['P-020', 'P-300', 'S-9', 'P-100']);

// ── QUIÉN ENTRA A LA ASISTENCIA (18-sep-2026, «debería ser la B») ──────────
//
// Un camión al que le quitaron las horas en Control NO sale, aunque tenga salida
// de patio: el inspector le inició la jornada, el camión no salió, le dejaron 0 h.
// Si siguiera en la lista, el reporte diría que hizo viajes.
{
  eq('con horas entra', L.entraEnAsistencia({ worked: 3, startAt: null }), true);
  eq('⭐ jornada abierta (0 h hasta que cierre) entra', L.entraEnAsistencia({ worked: 0, startAt: '2026-09-18T11:00:00Z' }), true);
  eq('⭐ 0 horas y jornada cerrada NO entra', L.entraEnAsistencia({ worked: 0, startAt: null }), false);
  eq('sin jornada no entra', L.entraEnAsistencia(null), false);
  eq('las horas pueden venir como texto', L.entraEnAsistencia({ worked: '2.5', startAt: null }), true);

  const T = (id, extra = {}) => ({ machinery_id: id, code: 'CAMION VOLTEO TORONTO', companyName: 'SAVANNA', plate: 'P-' + id, startAt: null, worked: 0, ...extra });
  const S = (id, at, extra = {}) => ({ machinery_id: id, direction: 'salida', at, ...extra });
  const E = (id, at) => ({ machinery_id: id, direction: 'entrada', at });

  // El caso del cliente: lo iniciaron (quedó la salida de patio), no salió, 0 h.
  const quitado = L.armarAsistenciaCamiones([T('a')], [S('a', '2026-09-18T11:00:00Z')]);
  eq('⭐ 0 h en Control + salida de patio = NO sale', quitado.length, 0);

  // El mismo camión con horas: sale, y el patio le pone la hora exacta.
  const conHoras = L.armarAsistenciaCamiones([T('a', { worked: 8 })], [S('a', '2026-09-18T11:00:00Z'), E('a', '2026-09-18T20:00:00Z')]);
  // `jornada` = sigue ABIERTA. Esta ya cerró (tiene horas y no tiene inicio): false.
  eq('con horas sale, con salida y entrada del patio', conHoras.map((c) => [c.salida, c.entrada, c.jornada]), [['2026-09-18T11:00:00Z', '2026-09-18T20:00:00Z', false]]);
  eq('...y su estado es Regresó', L.estadoAsistencia(conHoras[0]), '🟢 Regresó');

  // En obra ahora mismo: 0 h todavía, jornada abierta. Sale, con la hora del patio
  // si es más temprana que la del inicio.
  const enObra = L.armarAsistenciaCamiones([T('b', { startAt: '2026-09-18T11:05:00Z' })], [S('b', '2026-09-18T11:00:00Z')]);
  eq('⭐ jornada abierta sale aunque tenga 0 h', enObra.length, 1);
  eq('...con la salida más temprana', enObra[0].salida, '2026-09-18T11:00:00Z');
  eq('...en obra', L.estadoAsistencia(enObra[0]), '🟠 En obra');

  // Un movimiento de patio SOLO (sin jornada) no abre fila.
  eq('⭐ patio sin jornada no abre fila', L.armarAsistenciaCamiones([], [S('c', '2026-09-18T11:00:00Z'), E('c', '2026-09-18T20:00:00Z')]).length, 0);

  // Horas cargadas a mano en Control, sin jornada ni patio: sale, sin hora de salida.
  const aMano = L.armarAsistenciaCamiones([T('d', { worked: 12 })], []);
  eq('horas a mano: sale sin hora de salida', [aMano.length, aMano[0].salida, aMano[0].entrada], [1, null, null]);
  // ⭐ 19-sep: las 12 h que el sistema pone solo a las 7:05 p. m. (o las cargadas a
  //    mano) NO son «En obra»: nadie vio salir ese camión.
  eq('⭐ con horas pero sin salida ni jornada abierta: «— sin salida», no «En obra»', L.estadoAsistencia(aMano[0]), '— sin salida');
  eq('...la jornada abierta sí marca el camión', enObra[0].jornada, true);

  // ── QUÉ CAMIONES SALEN EN EL PAPEL ─────────────────────────────────────────
  const dia = L.armarAsistenciaCamiones(
    [T('s1', { worked: 8, plate: 'P-1' }), T('s2', { startAt: '2026-09-18T11:00:00Z', plate: 'P-2' }), T('a1', { worked: 12, plate: 'P-3' }), T('a2', { worked: 12, plate: 'P-4' })],
    [S('s1', '2026-09-18T11:30:00Z')],
  );
  eq('todos con movimiento: los 4', L.filtrarAsistencia(dia, 'movimiento').map((c) => c.plate), ['P-1', 'P-2', 'P-3', 'P-4']);
  eq('⭐ solo con salida: los 2 que alguien inició o pasaron por el patio', L.filtrarAsistencia(dia, 'salida').map((c) => c.plate), ['P-1', 'P-2']);
  ok('no toca la lista original', L.filtrarAsistencia(dia, 'salida') !== dia && dia.length === 4);
  eq('⭐ «solo con salida» da lo mismo que cuenta «Con salida»', L.filtrarAsistencia(dia, 'salida').length, dia.filter((c) => c.salida).length);
  eq('subtítulo completo (el de siempre)', L.subtituloAsistencia('movimiento', 19, 52), '19 con salida (asistencia) de 52 con movimiento');
  eq('⭐ subtítulo corto: dice que es corto y de cuántos', L.subtituloAsistencia('salida', 19, 52), 'SOLO CON SALIDA: 19 camión(es) con salida registrada, de 52 con movimiento');
  eq('las dos opciones, y la completa es la primera', L.ALCANCES_ASISTENCIA.map((a) => a.key), ['movimiento', 'salida']);
  eq('el archivo del papel completo no cambia de nombre', L.ALCANCES_ASISTENCIA[0].archivo, '');

  // Dos rondas del mismo camión el mismo día se juntan en una fila.
  const dos = L.armarAsistenciaCamiones([T('e', { worked: 6 }), T('e', { worked: 0, startAt: '2026-09-18T23:00:00Z' })], [E('e', '2026-09-18T18:00:00Z')]);
  eq('dos rondas del mismo camión: una fila', dos.length, 1);
  eq('...con la salida de la jornada abierta y la entrada del patio', [dos[0].salida, dos[0].entrada], ['2026-09-18T23:00:00Z', '2026-09-18T18:00:00Z']);

  // Varios camiones: entran los que corresponde, ordenados.
  const varios = L.armarAsistenciaCamiones(
    [T('z', { worked: 1, plate: 'P-9' }), T('y', { worked: 0 }), T('x', { worked: 0, startAt: '2026-09-18T11:00:00Z', plate: 'P-1' })],
    [S('y', '2026-09-18T11:00:00Z')],
  );
  eq('⭐ solo entran los que tienen horas o jornada abierta, en orden', varios.map((c) => c.plate), ['P-1', 'P-9']);
  // El patio completa placa/marca si la jornada no la trajo.
  const datos = L.armarAsistenciaCamiones([T('f', { worked: 2, plate: null })], [S('f', '2026-09-18T11:00:00Z', { plate: 'P-F', marca: 'IVECO' })]);
  eq('el patio completa placa y marca', [datos[0].plate, datos[0].marca], ['P-F', 'IVECO']);
}

// ── GUARDAS SOBRE LA PANTALLA ───────────────────────────────────────────────
const scr = sinComentarios(leer('src/screens/SupervisionScreen.tsx'));
const ini = scr.indexOf('const reporteCamiones = async');
const cuerpo = scr.slice(ini, scr.indexOf('await exportPdf(html, `Asistencia camiones', ini));
ok('el PDF usa la lista de columnas elegidas', ini >= 0 && /const cols = columnasAsistencia\(opAsis\)/.test(cuerpo));
ok('...para el encabezado y para las filas', /cols\.map\(\(k\) => `<th/.test(cuerpo) && /cols\.map\(\(k\) => `<td/.test(cuerpo));
ok('...con el estado de la librería', /estadoAsistencia\(c\)/.test(cuerpo));
ok('el nombre del archivo dice lo oculto', /Asistencia camiones \$\{dmy\(date\)\}\$\{sufijoAlcance\}\$\{sufijoArchivoAsistencia\(opAsis\)\}/.test(scr));
ok('la pantalla muestra las pastillas', /PASTILLAS_ASISTENCIA\.map/.test(scr) && /alternarAsistencia\(o, p\.key\)/.test(scr));
ok('la lista se ordena por código y placa (en la librería)', /return ordenarCamionesAsistencia\(Array\.from\(map\.values\(\)\)\)/.test(sinComentarios(leer('src/lib/camionesAsistenciaColumnas.ts'))));
ok('⭐ la pantalla arma la lista con la regla de la librería', /armarAsistenciaCamiones\(rawRounds\.filter\(\(r\) => isVolteoVolqueta\(r\.code\)\), yardLogs\)/.test(scr));
ok('...y ya no abre filas por movimientos de patio', !/yardLogs\.forEach/.test(scr));
ok('«Con salida» cuenta los que tienen hora de salida', /camiones\.filter\(\(c\) => c\.salida\)\.length/.test(scr));
ok('la pantalla avisa que 0 horas en Control no sale', /Un camión al que le dejaron 0 horas no sale/.test(scr));
ok('⭐ por defecto salen todos con movimiento (lo que imprimía siempre)', /useState<AlcanceAsistencia>\('movimiento'\)/.test(scr));
ok('⭐ la lista y el PDF usan la MISMA lista filtrada', /const filas = camionesVista\.map\(/.test(scr) && /\{camionesVista\.map\(\(c, i\) => \{/.test(scr));
ok('...y ya nadie pinta la lista sin filtrar', !/\{camiones\.map\(\(c, i\)/.test(scr) && !/const filas = camiones\.map\(/.test(scr));
ok('el subtítulo del PDF dice qué alcance salió', /subtituloAsistencia\(alcanceAsis, camPresentes, camiones\.length\)/.test(scr));
ok('el nombre del archivo también', /\$\{sufijoAlcance\}\$\{sufijoArchivoAsistencia\(opAsis\)\}/.test(scr));
ok('las pastillas muestran cuántos trae cada opción', /a\.key === 'salida' \? camPresentes : camiones\.length/.test(scr));
ok('la lista de la pantalla usa la misma regla de estado', /const t = estadoAsistencia\(c\);/.test(scr));
ok('se leen marca y modelo de las jornadas', /machine:machinery_id\(code, serial, plate, encargado, marca, modelo,/.test(scr));
ok('...y de los movimientos de patio', /machine:machinery_id\(plate, serial, marca, modelo, company:company_id\(name\)\)/.test(scr));
ok('la tarjeta no usa el código como clave', !/<Card key=\{c\.code\}>/.test(scr));

// ── MANUAL ──────────────────────────────────────────────────────────────────
ok('el manual .md lo explica', /Camiones \(asistencia\): qué columnas salen \(14\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla también', /CAMIONES \(ASISTENCIA\): QUÉ COLUMNAS SALEN \(14\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
ok('el manual .md explica que sin horas no sale', /Camiones \(asistencia\): sin horas en Control no sale \(18\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla también', /CAMIONES \(ASISTENCIA\): SIN HORAS EN CONTROL NO SALE \(18\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
ok('el manual .md explica «solo con salida»', /Camiones \(asistencia\): solo con salida o todos \(19\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla también', /CAMIONES \(ASISTENCIA\): SOLO CON SALIDA O TODOS \(19\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-camiones-asistencia · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
