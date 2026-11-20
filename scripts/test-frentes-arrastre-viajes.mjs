// 🧪 Pruebas automatizadas de ARRASTRE CONTINUO (Frente Pegajoso) y CAMBIOS INTRA-JORNADA en Camiones
//
// Valida:
// 1. Camión sin asignación hoy que arrastra el frente de días previos (caso del 19-Nov).
// 2. Camión con cambio de frente a las 11:30 AM:
//    - Viajes matutinos (9:00 AM y 10:30 AM) se quedan en Frente A.
//    - Viajes vespertinos (1:00 PM y 3:00 PM) se quedan en Frente B.
//    - Cero viajes en «Sin frente» (0 ambiguos).
// 3. Respeto de desasignación explícita («sin frente desde»).
// 4. Múltiples camiones simultáneos (caso real de liquidación).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const cargar = (rel) => {
  const srcPath = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  m._compile(out, m.filename);
  return m.exports;
};

const {
  resolverAsignacionesArrastrables,
  combinarAsignacionesConRespaldoMaquinaria,
  mapaAsignaciones,
  completarFrentes,
  CAMPOS_VIAJE_ROW,
  CAMPOS_VIAJE_PAGO,
} = cargar('src/lib/frentesAuto.ts');

const jornadaDe = (iso) => {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const base = new Date(d.getTime() - (h < 11 ? 24 * 3600 * 1000 : 0));
  return base.toISOString().slice(0, 10);
};

console.log('🧪 Iniciando prueba de Arrastre de Frentes y Cambios Intra-Jornada...\n');

// ── Test 1: Camión sin asignación hoy que arrastra el frente de días previos ──────────
{
  const hist = [
    { jornada: '2026-11-17', machineryId: 'cam-A36AD7J', frenteId: 'f-porto', frenteNombre: 'PORTO FINO', creadoAt: '2026-11-17T08:00:00Z' },
  ];
  const resueltas = resolverAsignacionesArrastrables(hist, ['2026-11-19']);
  assert.equal(resueltas.length, 1, 'Debe arrastrar 1 asignación al 2026-11-19');
  assert.equal(resueltas[0].jornada, '2026-11-19');
  assert.equal(resueltas[0].machineryId, 'cam-A36AD7J');
  assert.equal(resueltas[0].frenteNombre, 'PORTO FINO');

  const viajes = [
    { id: 'v1', machineryId: 'cam-A36AD7J', registeredAt: '2026-11-19T09:00:00.000-04:00', frenteId: null, frenteNombre: null },
    { id: 'v2', machineryId: 'cam-A36AD7J', registeredAt: '2026-11-19T11:00:00.000-04:00', frenteId: null, frenteNombre: null },
    { id: 'v3', machineryId: 'cam-A36AD7J', registeredAt: '2026-11-19T14:00:00.000-04:00', frenteId: null, frenteNombre: null },
  ];

  const { filas, completados, ambiguos } = completarFrentes(
    viajes,
    mapaAsignaciones(resueltas),
    (iso) => jornadaDe(iso),
    CAMPOS_VIAJE_ROW,
  );

  assert.equal(completados, 3, 'Los 3 viajes deben quedar completados');
  assert.equal(ambiguos, 0, 'Cero viajes ambiguos');
  assert.ok(filas.every((v) => v.frenteNombre === 'PORTO FINO'), 'Todos deben tomar PORTO FINO');
  console.log('✅ Test 1 pasado: Camión sin asignación el 19-Nov arrastra PORTO FINO correctamente.');
}

// ── Test 2: Cambio de frente a mitad de jornada (11:30 AM) ─────────────────────────
{
  // El camión estuvo en EL MAMON desde la mañana (07:00 AM) y a las 11:30 AM lo pasaron a VENLIV
  const asigsDelDia = [
    { jornada: '2026-11-20', machineryId: 'cam-49DDAR', frenteId: 'f-mamon', frenteNombre: 'EL MAMON', creadoAt: '2026-11-20T07:00:00.000-04:00' },
    { jornada: '2026-11-20', machineryId: 'cam-49DDAR', frenteId: 'f-venliv', frenteNombre: 'VENLIV', creadoAt: '2026-11-20T11:30:00.000-04:00' },
  ];

  const resueltas = resolverAsignacionesArrastrables(asigsDelDia, ['2026-11-20']);
  assert.equal(resueltas.length, 2, 'Debe conservar las 2 asignaciones del día');

  const viajes = [
    { id: 'v-manana-1', machineryId: 'cam-49DDAR', registeredAt: '2026-11-20T09:00:00.000-04:00', frenteId: null, frenteNombre: null },
    { id: 'v-manana-2', machineryId: 'cam-49DDAR', registeredAt: '2026-11-20T10:30:00.000-04:00', frenteId: null, frenteNombre: null },
    { id: 'v-tarde-1', machineryId: 'cam-49DDAR', registeredAt: '2026-11-20T13:00:00.000-04:00', frenteId: null, frenteNombre: null },
    { id: 'v-tarde-2', machineryId: 'cam-49DDAR', registeredAt: '2026-11-20T15:00:00.000-04:00', frenteId: null, frenteNombre: null },
  ];

  const { filas, completados, ambiguos } = completarFrentes(
    viajes,
    mapaAsignaciones(resueltas),
    (iso) => jornadaDe(iso),
    CAMPOS_VIAJE_ROW,
  );

  assert.equal(completados, 4, 'Todos los 4 viajes deben quedar completados');
  assert.equal(ambiguos, 0, 'Cero viajes ambiguos');
  assert.equal(filas[0].frenteNombre, 'EL MAMON', 'Viaje de las 9:00 AM debe pertenecer a EL MAMON');
  assert.equal(filas[1].frenteNombre, 'EL MAMON', 'Viaje de las 10:30 AM debe pertenecer a EL MAMON');
  assert.equal(filas[2].frenteNombre, 'VENLIV', 'Viaje de las 1:00 PM debe pertenecer a VENLIV');
  assert.equal(filas[3].frenteNombre, 'VENLIV', 'Viaje de las 3:00 PM debe pertenecer a VENLIV');
  console.log('✅ Test 2 pasado: Cambio de frente a las 11:30 AM separa con precisión mañana (EL MAMON) y tarde (VENLIV).');
}

// ── Test 3: Desasignación explícita («sin frente desde») ──────────────────────────────
{
  const hist = [
    { jornada: '2026-11-10', machineryId: 'cam-1', frenteId: 'f-mamon', frenteNombre: 'EL MAMON', creadoAt: '2026-11-10T08:00:00Z' },
    // El 15 se le quitó el frente explícitamente (frenteId vacío)
    { jornada: '2026-11-15', machineryId: 'cam-1', frenteId: '', frenteNombre: '', creadoAt: '2026-11-15T08:00:00Z' },
  ];
  const resueltas = resolverAsignacionesArrastrables(hist, ['2026-11-19']);
  assert.equal(resueltas.length, 0, 'No debe arrastrar ningún frente porque fue desasignado');

  const viajes = [
    { id: 'v1', machineryId: 'cam-1', registeredAt: '2026-11-19T09:00:00.000-04:00', frenteId: null, frenteNombre: null },
  ];
  const { filas, completados } = completarFrentes(
    viajes,
    mapaAsignaciones(resueltas),
    (iso) => jornadaDe(iso),
    CAMPOS_VIAJE_ROW,
  );
  assert.equal(completados, 0, 'No debe completar frente');
  assert.equal(filas[0].frenteNombre, null, 'Debe permanecer sin frente');
  console.log('✅ Test 3 pasado: Desasignación explícita no arrastra frente.');
}

// ── Test 4: Caso real de liquidación del 19-Nov con los 7 camiones ────────────────────
{
  const camionesIds = ['A36AD7J', 'A12DH7S', '49DDAR', '98WGBI', 'A43AT7M', 'A95AF5T', 'A13AG9D'];
  const hist = camionesIds.map((placa, i) => ({
    jornada: '2026-11-17',
    machineryId: `mach-${placa}`,
    frenteId: i % 2 === 0 ? 'f-porto' : 'f-venliv',
    frenteNombre: i % 2 === 0 ? 'PORTO FINO' : 'VENLIV',
    creadoAt: '2026-11-17T08:00:00Z',
  }));

  const resueltas = resolverAsignacionesArrastrables(hist, ['2026-11-19']);
  assert.equal(resueltas.length, 7, 'Los 7 camiones deben arrastrar su asignación al 19');

  // Generamos los 13 viajes de la foto del usuario
  const viajesRaw = [
    // A36AD7J: 3 viajes
    { id: 'v1', machinery_id: 'mach-A36AD7J', registered_at: '2026-11-19T08:30:00.000-04:00', frente_id: null, frente_nombre: null },
    { id: 'v2', machinery_id: 'mach-A36AD7J', registered_at: '2026-11-19T10:30:00.000-04:00', frente_id: null, frente_nombre: null },
    { id: 'v3', machinery_id: 'mach-A36AD7J', registered_at: '2026-11-19T13:00:00.000-04:00', frente_id: null, frente_nombre: null },
    // A12DH7S: 2 viajes
    { id: 'v4', machinery_id: 'mach-A12DH7S', registered_at: '2026-11-19T09:00:00.000-04:00', frente_id: null, frente_nombre: null },
    { id: 'v5', machinery_id: 'mach-A12DH7S', registered_at: '2026-11-19T11:00:00.000-04:00', frente_id: null, frente_nombre: null },
    // 49DDAR: 2 viajes
    { id: 'v6', machinery_id: 'mach-49DDAR', registered_at: '2026-11-19T09:15:00.000-04:00', frente_id: null, frente_nombre: null },
    { id: 'v7', machinery_id: 'mach-49DDAR', registered_at: '2026-11-19T11:30:00.000-04:00', frente_id: null, frente_nombre: null },
    // 98WGBI: 2 viajes
    { id: 'v8', machinery_id: 'mach-98WGBI', registered_at: '2026-11-19T09:45:00.000-04:00', frente_id: null, frente_nombre: null },
    { id: 'v9', machinery_id: 'mach-98WGBI', registered_at: '2026-11-19T12:00:00.000-04:00', frente_id: null, frente_nombre: null },
    // A43AT7M: 2 viajes
    { id: 'v10', machinery_id: 'mach-A43AT7M', registered_at: '2026-11-19T10:00:00.000-04:00', frente_id: null, frente_nombre: null },
    { id: 'v11', machinery_id: 'mach-A43AT7M', registered_at: '2026-11-19T14:00:00.000-04:00', frente_id: null, frente_nombre: null },
    // A95AF5T: 1 viaje
    { id: 'v12', machinery_id: 'mach-A95AF5T', registered_at: '2026-11-19T10:15:00.000-04:00', frente_id: null, frente_nombre: null },
    // A13AG9D: 1 viaje
    { id: 'v13', machinery_id: 'mach-A13AG9D', registered_at: '2026-11-19T10:45:00.000-04:00', frente_id: null, frente_nombre: null },
  ];

  const { filas, completados, ambiguos } = completarFrentes(
    viajesRaw,
    mapaAsignaciones(resueltas),
    (iso) => jornadaDe(iso),
    CAMPOS_VIAJE_PAGO,
  );

  assert.equal(completados, 13, 'Los 13 viajes deben quedar completados');
  assert.equal(ambiguos, 0, 'Cero viajes ambiguos');
  assert.ok(filas.every((v) => !!v.frente_nombre), 'Todos los 13 viajes deben tener frente asignado');
  console.log('✅ Test 4 pasado: Los 13 viajes del 19-Nov se resuelven al 100% (cero viajes en Sin Frente).');
}

console.log('\n🎉 TODAS LAS PRUEBAS DE ARRASTRE Y CAMBIOS INTRA-JORNADA PASARON EXITOSAMENTE.');
