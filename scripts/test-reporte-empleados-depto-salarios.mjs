// 🗂️ PRUEBA AUTOMATIZADA: Monto mensual y desglose por departamento en Reporte de Empleados
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'react-native') return { Platform: { OS: 'web' } };
  if (request === 'expo-print' || request === 'expo-sharing') return {};
  return origLoad.call(this, request, parent, isMain);
};

require.extensions['.ts'] = (m, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  m._compile(out, filename);
};

const {
  cuerpoReporteEmpleados,
  resolverOpcionesReporteEmpleados,
} = require(path.join(ROOT, 'src/lib/empleadosReporte.ts'));

const empleadosPrueba = [
  {
    id: '1',
    first_name: 'PEDRO',
    last_name: 'PEREZ',
    cargo: 'CHOFER',
    department: 'TRANSPORTE',
    status: 'activo',
    precio_dia: 20,
    precio_mes: 600,
  },
  {
    id: '2',
    first_name: 'JUAN',
    last_name: 'RODRIGUEZ',
    cargo: 'MECANICO',
    department: 'MANTENIMIENTO',
    status: 'activo',
    precio_dia: 30,
    precio_mes: 900,
  },
  {
    id: '3',
    first_name: 'LUIS',
    last_name: 'GARCIA',
    cargo: 'CHOFER',
    department: 'TRANSPORTE',
    status: 'activo',
    precio_dia: 25,
    precio_mes: 750,
  },
];

console.log('--- TEST 1: Resumen por departamento con montos salariales activados ---');
{
  const res = cuerpoReporteEmpleados({
    empleados: empleadosPrueba,
    estadoTxt: 'Activos',
    empresaTxt: 'Todas',
    departamentoTxt: 'Todos',
    cargoTxt: 'Todos',
    opciones: {
      resumenDepartamento: true,
      salarioMensual: true,
      salarioDiario: true,
      salarioPorDepartamento: true,
    },
  });

  assert.ok(res.body.includes('Resumen por departamento (2)'), 'Debe mostrar 2 departamentos');
  assert.ok(res.body.includes('Total Mensual'), 'Debe incluir columna Total Mensual');
  assert.ok(res.body.includes('Total Por Día'), 'Debe incluir columna Total Por Día');
  
  // TRANSPORTE tiene 2 personas, día = 45, mes = 1350
  assert.ok(res.body.includes('TRANSPORTE'), 'Debe incluir TRANSPORTE');
  assert.ok(res.body.includes('1.350,00'), 'TRANSPORTE debe sumar 1350 mensual');
  assert.ok(res.body.includes('45,00'), 'TRANSPORTE debe sumar 45 diario');

  // MANTENIMIENTO tiene 1 persona, día = 30, mes = 900
  assert.ok(res.body.includes('MANTENIMIENTO'), 'Debe incluir MANTENIMIENTO');
  assert.ok(res.body.includes('900,00'), 'MANTENIMIENTO debe sumar 900 mensual');
  assert.ok(res.body.includes('30,00'), 'MANTENIMIENTO debe sumar 30 diario');

  // Total footer: 3 personas, 2.250,00 mes, 75,00 día
  assert.ok(res.body.includes('2.250,00'), 'Footer debe sumar 2250 mensual');
  assert.ok(res.body.includes('75,00'), 'Footer debe sumar 75 diario');
  console.log('✓ TEST 1 superado con éxito');
}

console.log('--- TEST 2: Apagar salarioPorDepartamento oculta las columnas de monto ---');
{
  const res = cuerpoReporteEmpleados({
    empleados: empleadosPrueba,
    estadoTxt: 'Activos',
    empresaTxt: 'Todas',
    departamentoTxt: 'Todos',
    cargoTxt: 'Todos',
    opciones: {
      resumenDepartamento: true,
      salarioMensual: true,
      salarioDiario: true,
      salarioPorDepartamento: false, // Apagado por el usuario
    },
  });

  assert.ok(res.body.includes('Resumen por departamento (2)'), 'Debe mostrar 2 departamentos');
  assert.ok(!res.body.includes('<th class="r nw" style="width:120px">Total Mensual</th>'), 'No debe tener columna Total Mensual');
  assert.ok(!res.body.includes('<th class="r nw" style="width:110px">Total Por Día</th>'), 'No debe tener columna Total Por Día');
  console.log('✓ TEST 2 superado con éxito');
}

console.log('--- TEST 3: Filtrar por departamento en tarjetas de resumen (.tiles) ---');
{
  const res = cuerpoReporteEmpleados({
    empleados: [empleadosPrueba[0], empleadosPrueba[2]], // Solo transporte
    estadoTxt: 'Activos',
    empresaTxt: 'Todas',
    departamentoTxt: 'TRANSPORTE',
    cargoTxt: 'Todos',
    opciones: {
      cuadrosResumen: true,
      salarioMensual: true,
    },
  });

  assert.ok(res.body.includes('Total Mensual (TRANSPORTE)'), 'Tarjeta de total mensual debe reflejar el departamento');
  assert.ok(res.body.includes('1.350,00'), 'Tarjeta mensual debe mostrar 1350');
  console.log('✓ TEST 3 superado con éxito');
}

console.log('--- TEST 4: Opciones por defecto ---');
{
  const op = resolverOpcionesReporteEmpleados();
  assert.equal(op.salarioPorDepartamento, true, 'salarioPorDepartamento debe ser true por defecto');
  console.log('✓ TEST 4 superado con éxito');
}

console.log('\n🎉 TODOS LOS TESTS DE SALARIOS Y DESGLOSE POR DEPARTAMENTO PASARON.');
