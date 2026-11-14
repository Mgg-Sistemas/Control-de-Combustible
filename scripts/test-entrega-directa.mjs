/*
 * Test del flujo 🚀 ENTREGA DIRECTA / CONSUMO EN CAMPO (sin ingresar al stock del almacén)
 *
 * Verifica:
 *  1. esEntregaDirecta devuelve false para requerimientos normales y true cuando tiene [ENTREGA_DIRECTA: ...].
 *  2. inyectarEntregaDirectaEnObservaciones + extraerEntregaDirecta hacen roundtrip exacto y preservan otras marcas.
 *  3. Sanitización de caracteres especiales ([ ] |) dentro de los campos ingresados por el usuario.
 *  4. calcularEstadoRequerimiento clasifica como 'entrega_directa' cuando status === 'recibido' y es entrega directa.
 *  5. quitarTodasLasMarcasDeTexto remueve el marcador [ENTREGA_DIRECTA: ...] limpiamente.
 *
 *   node scripts/test-entrega-directa.mjs
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

// Mock mínimo de @react-native-async-storage/async-storage para cargar requerimientoFlujo en Node
const Module = require('node:module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === '@react-native-async-storage/async-storage') {
    return 'mock-async-storage';
  }
  if (request.startsWith('./') || request.startsWith('../')) {
    const baseDir = parent ? path.dirname(parent.filename) : ROOT;
    const tsPath = path.resolve(baseDir, request + '.ts');
    if (fs.existsSync(tsPath)) return tsPath;
  }
  return origResolve.call(this, request, parent, ...rest);
};
require.cache['mock-async-storage'] = {
  id: 'mock-async-storage',
  filename: 'mock-async-storage',
  loaded: true,
  exports: { default: { getItem: async () => null, setItem: async () => {} } },
};
require.extensions['.ts'] = (mod, filename) => {
  const src = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  mod._compile(outputText, filename);
};

const {
  esEntregaDirecta,
  extraerEntregaDirecta,
  inyectarEntregaDirectaEnObservaciones,
  calcularEstadoRequerimiento,
  quitarTodasLasMarcasDeTexto,
} = require(path.join(ROOT, 'src', 'lib', 'requerimientoFlujo.ts'));

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

console.log('\n🚀 Probando flujo de Entrega Directa / Consumo en Campo...\n');

test('1. esEntregaDirecta es false en requerimientos normales', () => {
  assert.equal(esEntregaDirecta(null), false);
  assert.equal(esEntregaDirecta({ observaciones: 'Repuesto urgente para camión' }), false);
  assert.equal(esEntregaDirecta({ observaciones: '[DESTINO_MAQUINA: JUMBO 320]' }), false);
});

test('2. inyectarEntregaDirectaEnObservaciones y extraerEntregaDirecta hacen roundtrip y preservan otras marcas', () => {
  const obsInicial = 'Urgente para cantera\n[DESTINO_MAQUINA: RETROEXCAVADORA 2269 · PLACA: A12BC34]\n[FACTURA PROVEEDOR: 00045]';
  const obsActualizada = inyectarEntregaDirectaEnObservaciones(obsInicial, {
    receptor: 'Carlos Pérez',
    maquinaria: 'Retroexcavadora 2269 (A12BC34)',
    entregadoPor: 'Admin Compras',
    fecha: '2026-11-14T10:30:00Z',
    nota: 'Instalado directo en campo',
    soporteUrl: 'https://example.com/foto.jpg',
  });

  assert.equal(esEntregaDirecta({ observaciones: obsActualizada }), true);
  assert.ok(obsActualizada.includes('[DESTINO_MAQUINA: RETROEXCAVADORA 2269 · PLACA: A12BC34]'));
  assert.ok(obsActualizada.includes('[FACTURA PROVEEDOR: 00045]'));

  const extraido = extraerEntregaDirecta({ observaciones: obsActualizada });
  assert.equal(extraido.receptor, 'Carlos Pérez');
  assert.equal(extraido.maquinaria, 'Retroexcavadora 2269 (A12BC34)');
  assert.equal(extraido.entregadoPor, 'Admin Compras');
  assert.equal(extraido.fecha, '2026-11-14T10:30:00Z');
  assert.equal(extraido.nota, 'Instalado directo en campo');
  assert.equal(extraido.soporteUrl, 'https://example.com/foto.jpg');
});

test('3. Sanitiza corchetes y pipes en textos ingresados por usuario', () => {
  const obs = inyectarEntregaDirectaEnObservaciones('', {
    receptor: 'Juan [Mecánico] | Turno A',
    nota: 'Pieza [nueva] | instalada',
  });
  assert.equal(esEntregaDirecta({ observaciones: obs }), true);
  const extraido = extraerEntregaDirecta({ observaciones: obs });
  assert.equal(extraido.receptor, 'Juan Mecánico Turno A');
  assert.equal(extraido.nota, 'Pieza nueva instalada');
});

test('4. Reemplaza tag previo si se actualiza entrega directa sin duplicar', () => {
  const obs1 = inyectarEntregaDirectaEnObservaciones('Nota base', { receptor: 'Pedro' });
  const obs2 = inyectarEntregaDirectaEnObservaciones(obs1, { receptor: 'Luis' });
  const matches = obs2.match(/\[ENTREGA_DIRECTA:/g) || [];
  assert.equal(matches.length, 1);
  assert.equal(extraerEntregaDirecta({ observaciones: obs2 }).receptor, 'Luis');
});

test('5. calcularEstadoRequerimiento clasifica como entrega_directa cuando status === recibido', () => {
  const obs = inyectarEntregaDirectaEnObservaciones('', { receptor: 'María Gómez' });
  const reqMock = {
    id: 'req-1',
    code: 'REQ-0200',
    status: 'recibido',
    observaciones: obs,
    items: [{ name: 'Correa', qty: 1, est_price: 25, unit: 'u.' }],
    created_at: '2026-11-14T08:00:00Z',
  };
  const info = calcularEstadoRequerimiento(reqMock);
  assert.equal(info.codigo, 'entrega_directa');
  assert.equal(info.short, 'Entrega Directa');
});

test('6. quitarTodasLasMarcasDeTexto limpia el marcador [ENTREGA_DIRECTA: ...]', () => {
  const obs = inyectarEntregaDirectaEnObservaciones('Texto visible para PDF', { receptor: 'Pedro' });
  const limpio = quitarTodasLasMarcasDeTexto(obs);
  assert.equal(limpio, 'Texto visible para PDF');
});

console.log(`\nResultado: ${passed} pruebas pasaron.\n`);

