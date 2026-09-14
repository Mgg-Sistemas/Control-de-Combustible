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

// ── GUARDAS SOBRE LA PANTALLA ───────────────────────────────────────────────
const scr = sinComentarios(leer('src/screens/SupervisionScreen.tsx'));
const ini = scr.indexOf('const reporteCamiones = async');
const cuerpo = scr.slice(ini, scr.indexOf('await exportPdf(html, `Asistencia camiones', ini));
ok('el PDF usa la lista de columnas elegidas', ini >= 0 && /const cols = columnasAsistencia\(opAsis\)/.test(cuerpo));
ok('...para el encabezado y para las filas', /cols\.map\(\(k\) => `<th/.test(cuerpo) && /cols\.map\(\(k\) => `<td/.test(cuerpo));
ok('...con el estado de la librería', /estadoAsistencia\(c\)/.test(cuerpo));
ok('el nombre del archivo dice lo oculto', /Asistencia camiones \$\{dmy\(date\)\}\$\{sufijoArchivoAsistencia\(opAsis\)\}/.test(scr));
ok('la pantalla muestra las pastillas', /PASTILLAS_ASISTENCIA\.map/.test(scr) && /alternarAsistencia\(o, p\.key\)/.test(scr));
ok('la lista se ordena por código y placa', /return ordenarCamionesAsistencia\(Array\.from\(map\.values\(\)\)\)/.test(scr));
ok('la lista de la pantalla usa la misma regla de estado', /const t = estadoAsistencia\(c\);/.test(scr));
ok('se leen marca y modelo de las jornadas', /machine:machinery_id\(code, serial, plate, encargado, marca, modelo,/.test(scr));
ok('...y de los movimientos de patio', /machine:machinery_id\(plate, serial, marca, modelo, company:company_id\(name\)\)/.test(scr));
ok('la tarjeta no usa el código como clave', !/<Card key=\{c\.code\}>/.test(scr));

// ── MANUAL ──────────────────────────────────────────────────────────────────
ok('el manual .md lo explica', /Camiones \(asistencia\): qué columnas salen \(14\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('el manual en pantalla también', /CAMIONES \(ASISTENCIA\): QUÉ COLUMNAS SALEN \(14\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-camiones-asistencia · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
