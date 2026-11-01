import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function cargarTs(relPath) {
  const fullPath = path.resolve(relPath);
  const tsCode = fs.readFileSync(fullPath, 'utf8');
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', jsCode);
  fn(() => ({}), mod, mod.exports);
  return mod.exports;
}

const { informeTrasladoCargaHtml } = cargarTs('src/lib/informeTrasladoCarga.ts');

test('informeTrasladoCargaHtml genera documento idéntico al solicitado', () => {
  const data = {
    numeroControl: 'AT-2026-1710001',
    fecha: '17/10/2026',
    empresaEmisora: { nombre: 'CONSTRUCCIONES LICCIONE, C.A.' },
    maquinaria: {
      codigo: 'Jumbo',
      tipo: 'Jumbo',
      placa: 'A97BE9P',
    },
    origen: 'Caribe',
    destino: 'Caraballeda',
    transporte: {
      conductorNombre: 'José Gómez',
      placaChuto: 'A22CY0J',
    },
    estado: {
      operativo: true,
      inoperativo: false,
      limpiezaAceptable: true,
    },
    firmas: {
      autorizadoPorEmpresa: 'Sr. Joel Gómez',
    },
  };

  const html = informeTrasladoCargaHtml(data);

  // 1. Encabezados
  assert.ok(html.includes('INFORME DE TRASLADO DE CARGA'), 'Debe incluir el título exacto');
  assert.ok(html.includes('CONTROL LOGÍSTICO OPERATIVO Y REGISTRO DE VIAJES'), 'Debe incluir el subtítulo exacto');
  assert.ok(html.includes('Fecha Emisión:</span> <span class="val">17/10/2026</span>'), 'Debe incluir fecha de emisión');
  assert.ok(html.includes('Estatus General:</span> <span class="val">Completado</span>'), 'Debe incluir estatus general');

  // 2. Metadatos
  assert.ok(html.includes('CONDUCTOR ASIGNADO'), 'Debe incluir bloque Conductor Asignado');
  assert.ok(html.includes('José Gómez'), 'Debe mostrar el nombre del conductor');
  assert.ok(html.includes('PLACA DEL VEHÍCULO'), 'Debe incluir bloque Placa del Vehículo');
  assert.ok(html.includes('A22CY0J'), 'Debe mostrar la placa del vehículo');
  assert.ok(html.includes('AUTORIZACIÓN GENERAL'), 'Debe incluir bloque Autorización General');
  assert.ok(html.includes('Sr. Joel Gómez'), 'Debe mostrar quién autoriza');

  // 3. Tabla Cronograma
  assert.ok(html.includes('1. CRONOGRAMA Y REGISTRO DE TRASLADOS'), 'Debe incluir sección 1');
  assert.ok(html.includes('Caribe'), 'Debe incluir origen Caribe');
  assert.ok(html.includes('Caraballeda'), 'Debe incluir destino Caraballeda');
  assert.ok(html.includes('Jumbo'), 'Debe incluir equipo Jumbo');

  // 4. Resumen de Movimientos
  assert.ok(html.includes('2. RESUMEN DE MOVIMIENTOS'), 'Debe incluir sección 2');
  assert.ok(html.includes('Se confirma la correcta ejecución de la operación de traslado'), 'Debe incluir párrafo introductorio');
  assert.ok(html.includes('Movilizado desde <b>Caribe</b> con destino a <b>Caraballeda</b>'), 'Debe narrar el movimiento');

  // 5. Pie de página
  assert.ok(html.includes('Informe de Traslado - Caribe a Caraballeda'), 'Debe incluir el pie de página');

  console.log('✅ Test de informeTrasladoCargaHtml superado con éxito.');
});
