/*
 * Test de los nuevos campos de Viajes de Camiones (16-nov-2026):
 *  - Sentido (Entrada / Salida)
 *  - Material (Material triturado, Escombro, etc.)
 *  - Operación (Miyamoto / TFI)
 *  - Filtros facetados (viajesFiltros.ts)
 *  - Columnas ocultables (cubicaje.ts)
 *  - Informe operativo (informeOperativo.ts)
 *  - Campos configurables del Ticket (tiqueConfig.ts)
 *
 *   node scripts/test-viajes-nuevos-campos.mjs
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

const { proyectoOperacionValido, etiquetaProyectoOperacion, motivoOperacionInvalida } = require(path.join(ROOT, 'src', 'lib', 'ubicacionesObra.ts'));
const { pasaFiltros } = require(path.join(ROOT, 'src', 'lib', 'viajesFiltros.ts'));
const { columnasDetalle, OPCIONES_POR_DEFECTO } = require(path.join(ROOT, 'src', 'lib', 'cubicaje.ts'));
const { CAMPOS_TIQUE } = require(path.join(ROOT, 'src', 'lib', 'tiqueConfig.ts'));
const {
  filtrarViajesOperativo,
  sentidosOperativo,
  materialesOperativo,
  operacionesOperativo,
  FILTRO_OPERATIVO_TODO,
} = require(path.join(ROOT, 'src', 'lib', 'informeOperativo.ts'));

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

console.log('\n🚛 Probando Sentido, Material y Operación (Miyamoto / TFI) en Viajes...\n');

test('1. proyectoOperacionValido y etiquetaProyectoOperacion reconocen miyamoto y tfi', () => {
  assert.equal(proyectoOperacionValido('miyamoto'), 'miyamoto');
  assert.equal(proyectoOperacionValido('TFI'), 'tfi');
  assert.equal(proyectoOperacionValido('otro'), null);
  assert.equal(etiquetaProyectoOperacion('miyamoto'), 'Miyamoto');
  assert.equal(etiquetaProyectoOperacion('tfi'), 'TFI');
  assert.equal(etiquetaProyectoOperacion(null), 'Sin definir');
});

test('2. viajesFiltros.ts filtra por sentido, material y operacion', () => {
  const claves = {
    listero: 'l1', empresa: 'e1', camion: 'c1', turno: 'day', ubicacion: 'u1', formato: 'f1', frente: 'fr1',
    sentido: 'entrada', material: 'Material triturado', operacion: 'miyamoto',
  };
  const selVacia = {
    listero: new Map(), empresa: new Map(), camion: new Map(), turno: new Map(), ubicacion: new Map(), formato: new Map(), frente: new Map(),
    sentido: new Map(), material: new Map(), operacion: new Map(),
  };
  assert.equal(pasaFiltros(claves, selVacia), true);

  const selSoloSalida = { ...selVacia, sentido: new Map([['salida', 'Salida']]) };
  assert.equal(pasaFiltros(claves, selSoloSalida), false);

  const selTfi = { ...selVacia, operacion: new Map([['tfi', 'TFI']]) };
  assert.equal(pasaFiltros(claves, selTfi), false);

  const selMatch = {
    ...selVacia,
    sentido: new Map([['entrada', 'Entrada']]),
    material: new Map([['Material triturado', 'Material triturado']]),
    operacion: new Map([['miyamoto', 'Miyamoto']]),
  };
  assert.equal(pasaFiltros(claves, selMatch), true);
});

test('3. columnasDetalle oculta y muestra Sentido, Material y Operación según opciones', () => {
  const colsOff = columnasDetalle(OPCIONES_POR_DEFECTO);
  assert.equal(colsOff.some((c) => c.key === 'sentido' || c.key === 'material' || c.key === 'operacion'), false);

  const colsOn = columnasDetalle({ ...OPCIONES_POR_DEFECTO, sentido: true, material: true, operacion: true });
  assert.ok(colsOn.some((c) => c.key === 'sentido' && c.head === 'Sentido'));
  assert.ok(colsOn.some((c) => c.key === 'material' && c.head === 'Material'));
  assert.ok(colsOn.some((c) => c.key === 'operacion' && c.head === 'Operación'));
});

test('4. informeOperativo.ts separa Miyamoto de TFI y filtra por Sentido y Material', () => {
  const viajes = [
    { id: '1', machinery_id: 'm1', company_id: 'c1', zona_pago: 'este', registered_at: '2026-11-16T14:00:00Z', sentido: 'entrada', material_nombre: 'Material triturado', proyecto_operacion: 'miyamoto' },
    { id: '2', machinery_id: 'm2', company_id: 'c1', zona_pago: 'este', registered_at: '2026-11-16T15:00:00Z', sentido: 'salida', material_nombre: 'Escombro', proyecto_operacion: 'tfi' },
  ];

  assert.equal(sentidosOperativo(viajes).length, 2);
  assert.equal(materialesOperativo(viajes).length, 2);
  assert.equal(operacionesOperativo(viajes).length, 2);

  const soloMiyamoto = filtrarViajesOperativo(viajes, { ...FILTRO_OPERATIVO_TODO, operaciones: ['Miyamoto'] });
  assert.equal(soloMiyamoto.length, 1);
  assert.equal(soloMiyamoto[0].id, '1');

  const soloEscombro = filtrarViajesOperativo(viajes, { ...FILTRO_OPERATIVO_TODO, materiales: ['Escombro'] });
  assert.equal(soloEscombro.length, 1);
  assert.equal(soloEscombro[0].id, '2');
});

test('5. CAMPOS_TIQUE incluye sentido, material y operacion', () => {
  const keys = new Set(CAMPOS_TIQUE.map((c) => c.k));
  assert.ok(keys.has('sentido'));
  assert.ok(keys.has('material'));
  assert.ok(keys.has('operacion'));
});

test('6. motivoOperacionInvalida exige Miyamoto o TFI de forma obligatoria', () => {
  assert.equal(motivoOperacionInvalida(null), 'Debes seleccionar la OPERACIÓN (Miyamoto o TFI) para registrar el viaje.');
  assert.equal(motivoOperacionInvalida(undefined), 'Debes seleccionar la OPERACIÓN (Miyamoto o TFI) para registrar el viaje.');
  assert.equal(motivoOperacionInvalida(''), 'Debes seleccionar la OPERACIÓN (Miyamoto o TFI) para registrar el viaje.');
  assert.equal(motivoOperacionInvalida('otra'), 'Debes seleccionar la OPERACIÓN (Miyamoto o TFI) para registrar el viaje.');

  assert.equal(motivoOperacionInvalida('miyamoto'), null);
  assert.equal(motivoOperacionInvalida('tfi'), null);
  assert.equal(motivoOperacionInvalida('TFI'), null);

  assert.equal(motivoOperacionInvalida(null, 'cargar'), 'Debes seleccionar la OPERACIÓN (Miyamoto o TFI) para cargar los viajes.');
  assert.equal(motivoOperacionInvalida(null, 'editar'), 'La operación no puede quedar vacía: debe ser Miyamoto o TFI.');
});

console.log(`\nResultado: ${passed} pruebas pasaron.\n`);
