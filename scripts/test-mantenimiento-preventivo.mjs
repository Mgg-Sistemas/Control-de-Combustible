/*
 * Test del flujo de Mantenimiento Preventivo (ciclo 250H, registro retroactivo,
 * anulación lógica sin DELETE, placa obligatoria y campana global por permisos).
 *
 *   node scripts/test-mantenimiento-preventivo.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const Module = require('node:module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('./') || request.startsWith('../')) {
    const baseDir = parent ? path.dirname(parent.filename) : ROOT;
    const tsPath = path.resolve(baseDir, request + '.ts');
    if (fs.existsSync(tsPath)) return tsPath;
  }
  return origResolve.call(this, request, parent, ...rest);
};
require.extensions['.ts'] = (mod, filename) => {
  const src = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  mod._compile(outputText, filename);
};

const {
  calcularCicloPreventivo,
  validarHorometroServicio,
  resolverBaseTrasAnulacion,
  etiquetaMaquinaConPlaca,
  filtrarNotificacionesPorPermisos,
} = require(path.join(ROOT, 'src', 'lib', 'mantenimientoPreventivo.ts'));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}:`, err.message);
    process.exitCode = 1;
  }
}

console.log('\n🧰 Probando Mantenimiento Preventivo 250H y Campana Global...\n');

test('1. Cálculo retroactivo exacto: 1209.3 actual y servicio a las 1200.0', () => {
  const p = calcularCicloPreventivo(1209.3, 1200.0);
  assert.equal(p.horometroBase, 1200);
  assert.equal(p.acumuladas, 9.3);
  assert.equal(p.restante, 240.7);
  assert.equal(p.proximoObjetivo, 1450);
  assert.equal(p.vencida, false);
  assert.equal(p.proxima, false);
});

test('2. Cálculo al día (0 acumuladas) y máquina vencida (>= 250 h)', () => {
  const alDia = calcularCicloPreventivo(1500, 1500);
  assert.equal(alDia.acumuladas, 0);
  assert.equal(alDia.restante, 250);
  assert.equal(alDia.vencida, false);

  const vencida = calcularCicloPreventivo(1500, 1240);
  assert.equal(vencida.acumuladas, 260);
  assert.equal(vencida.vencida, true);
  assert.equal(vencida.proxima, true);
});

test('3. validarHorometroServicio acepta punto y coma, y rechaza valores inválidos o futuros', () => {
  const rComa = validarHorometroServicio('1200,5', 1250);
  assert.equal(rComa.ok, true);
  if (rComa.ok) assert.equal(rComa.valor, 1200.5);

  const rPunto = validarHorometroServicio('1200.5', 1250);
  assert.equal(rPunto.ok, true);

  assert.equal(validarHorometroServicio('', 1250).ok, false);
  assert.equal(validarHorometroServicio('0', 1250).ok, false);
  assert.equal(validarHorometroServicio('-5', 1250).ok, false);
  assert.equal(validarHorometroServicio('1300', 1250).ok, false);
});

test('4. resolverBaseTrasAnulacion restaura el servicio activo anterior más reciente', () => {
  const servicios = [
    { id: '2', machinery_id: 'm1', horometro_servicio: 1200, horometro_anterior: 950, fecha_servicio: '2026-11-17T12:00:00Z', created_at: '2026-11-17T12:00:00Z', anulado: true },
    { id: '1', machinery_id: 'm1', horometro_servicio: 950, horometro_anterior: 700, fecha_servicio: '2026-10-01T12:00:00Z', created_at: '2026-10-01T12:00:00Z', anulado: false },
  ];
  const baseRestaurada = resolverBaseTrasAnulacion(servicios, 1209.3);
  assert.equal(baseRestaurada, 950);

  // Si todos fueron anulados, vuelve al horometro_anterior del primero
  const todosAnulados = servicios.map((s) => ({ ...s, anulado: true }));
  assert.equal(resolverBaseTrasAnulacion(todosAnulados, 1209.3), 700);
});

test('5. Identificación de maquinaria incluye siempre código y PLACA', () => {
  assert.equal(etiquetaMaquinaConPlaca('VOLVO-240', 'A01FE8M'), '🚜 VOLVO-240 · Placa: A01FE8M');
  assert.equal(etiquetaMaquinaConPlaca('EXC-01', null), '🚜 EXC-01 · Placa: Sin placa');
});

test('6. Filtrado estricto de notificaciones por permisos y visibilidad universal', () => {
  const notifs = [
    { id: '1', type: 'requerimiento', recipient_id: null },
    { id: '2', type: 'mantenimiento_preventivo', recipient_id: null },
    { id: '3', type: 'solicitud_existencia', recipient_id: 'u-otro' },
    { id: '4', type: 'requerimiento', recipient_id: 'u-yo' },
  ];

  // Sin permisos: solo ve la dirigida directamente a él (recipient_id === uid)
  const sinPermisos = filtrarNotificacionesPorPermisos(notifs, {
    uid: 'u-yo', role: 'user', canMantenimiento: false, canServicio: false, canCompras: false, canInventario: false,
  });
  assert.deepEqual(sinPermisos.map((n) => n.id), ['4']);

  // Con permiso de mantenimiento: ve mantenimiento + propia
  const conMant = filtrarNotificacionesPorPermisos(notifs, {
    uid: 'u-yo', role: 'user', canMantenimiento: true, canServicio: false, canCompras: false, canInventario: false,
  });
  assert.deepEqual(conMant.map((n) => n.id), ['2', '4']);

  // Admin ve todo
  const admin = filtrarNotificacionesPorPermisos(notifs, {
    uid: 'u-admin', role: 'admin', canMantenimiento: false, canServicio: false, canCompras: false, canInventario: false,
  });
  assert.equal(admin.length, 4);
});

test('7. Cero DELETE en mantenimientoPreventivoDb.ts y campana visible para todos', () => {
  const dbSrc = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'mantenimientoPreventivoDb.ts'), 'utf8');
  assert.equal(/\.delete\(/.test(dbSrc), false);
  const bellSrc = fs.readFileSync(path.join(ROOT, 'src', 'components', 'NotificationBell.tsx'), 'utf8');
  assert.equal(bellSrc.includes("if (role !== 'admin' && items.length === 0) return null;"), false);
  assert.ok(bellSrc.includes('if (!uid) return null;'));
});

console.log(`\nResultado: ${passed} pruebas pasaron.\n`);
