/*
 * ⚙️ PERSONALIZACIÓN COMPLETA DEL REPORTE DE TARAS Y COMBUSTIBLE (28-oct-2026).
 * Valida colocar y quitar columnas, logos, títulos, subtítulos, tarjetas y notas.
 *
 *   node scripts/test-reporte-taras-personalizacion.mjs
 */
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

const cache = new Map();
function cargarAbs(abs) {
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id === 'react-native') return { Platform: { OS: 'web' } };
    if (id === 'expo-print') return {};
    if (id === 'expo-sharing') return {};
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return cargarAbs(c);
    }
    return orig(id);
  };
  m._compile(out, abs);
  cache.set(abs, m.exports);
  return m.exports;
}

const modReporte = cargarAbs(path.join(ROOT, 'src/lib/reporteTaras.ts'));
const {
  OPCIONES_TARAS_POR_DEFECTO,
  cuerpoReporteTaras,
  resumenTaras,
  subtituloReporteTaras,
} = modReporte;

const modPdf = cargarAbs(path.join(ROOT, 'src/lib/pdf.ts'));
const { pdfDocument } = modPdf;

console.log('🧪 Iniciando pruebas de personalización del Reporte de Taras...');

const MOCK_CAMIONES = [
  {
    id: 'c1',
    code: 'CAMION VOLTEO TORONTO #01',
    plate: 'A11AS6G',
    serial: 'SER-001',
    marca: 'MACK',
    modelo: 'VISION',
    companyName: 'CONSTRUCCIONES LICCIONE',
    clasificacion: 'GRAN CAPACIDAD',
    choferDia: 'CARLOS PEREZ',
    choferNoche: 'LUIS MORA',
    combustibleLitros: 120,
  },
  {
    id: 'c2',
    code: 'CAMION VOLTEO TORONTO #02',
    plate: '49DDAR',
    serial: 'SER-002',
    marca: 'FORD',
    modelo: 'CARGO',
    companyName: 'GOLDEN TOUCH',
    clasificacion: 'MEDIA CAPACIDAD',
    choferDia: 'PEDRO RAMIREZ',
    choferNoche: 'PEDRO RAMIREZ',
    combustibleLitros: 100,
  },
];

const MOCK_TARAS = new Map([
  ['c1', { pesoTaraKg: 13840, updatedAt: '2026-10-28T12:00:00Z', updatedByNombre: 'WINNERLY RODRIGUEZ', exentoRomana: false, combustibleLitros: 120 }],
  ['c2', { pesoTaraKg: 11000, updatedAt: '2026-10-28T12:00:00Z', updatedByNombre: 'WINNERLY RODRIGUEZ', exentoRomana: false, combustibleLitros: 100 }],
]);

// 1. Quitar y colocar columnas
{
  // A) Quitar equipo
  const sinEquipo = cuerpoReporteTaras(MOCK_CAMIONES, MOCK_TARAS, {
    ...OPCIONES_TARAS_POR_DEFECTO,
    equipo: false,
  });
  assert.ok(!sinEquipo.includes('<th>Equipo</th>'), 'Debe omitir encabezado Equipo');
  assert.ok(!sinEquipo.includes('<td>CAMION VOLTEO TORONTO #01</td>'), 'Debe omitir celda de código de equipo');

  // B) Quitar tara (ej. reporte solo de combustible y flota)
  const sinTara = cuerpoReporteTaras(MOCK_CAMIONES, MOCK_TARAS, {
    ...OPCIONES_TARAS_POR_DEFECTO,
    tara: false,
  });
  assert.ok(!sinTara.includes('<th>Tara'), 'Debe omitir encabezado Tara');
  assert.ok(!sinTara.includes('13.840'), 'Debe omitir peso de tara');

  // C) Colocar columna de firma
  const conFirma = cuerpoReporteTaras(MOCK_CAMIONES, MOCK_TARAS, {
    ...OPCIONES_TARAS_POR_DEFECTO,
    firma: true,
  });
  assert.ok(conFirma.includes('Firma / Recibido'), 'Debe incluir columna de firma');
  assert.ok(conFirma.includes('border-bottom:1px dashed'), 'Debe incluir línea punteada de firma');

  // D) Quitar combustible
  const sinComb = cuerpoReporteTaras(MOCK_CAMIONES, MOCK_TARAS, {
    ...OPCIONES_TARAS_POR_DEFECTO,
    combustible: false,
  });
  assert.ok(!sinComb.includes('<th>Combustible (L)</th>'), 'Debe omitir encabezado Combustible');
  assert.ok(!sinComb.includes('120 L'), 'Debe omitir celdas de combustible');

  console.log('  ✓ Colocar y quitar columnas individuales funciona correctamente');
}

// 2. Colocar y quitar logos y membrete en pdfDocument
{
  // A) Ningún logo (membrete limpio)
  const htmlSinLogos = pdfDocument({
    title: 'Reporte de taras',
    body: '<div>Contenido</div>',
    logos: { bcv: false, sos: false, golden: false, renace: false, jhenzaen: false },
    marcaTexto: false,
    verEmitida: false,
  });
  assert.ok(!htmlSinLogos.includes('Banco Central de Venezuela'), 'No debe tener BCV');
  assert.ok(!htmlSinLogos.includes('SOS La Guaira'), 'No debe tener SOS');
  assert.ok(!htmlSinLogos.includes('Golden Touch'), 'No debe tener Golden');
  assert.ok(!htmlSinLogos.includes('Jhenzaen'), 'No debe tener Jhenzaen');
  assert.ok(!htmlSinLogos.includes('<div class="emit">'), 'No debe tener fecha de emisión');

  // B) Solo Jhenzaen
  const htmlJhenzaen = pdfDocument({
    title: 'Reporte de taras',
    body: '<div>Contenido</div>',
    logos: { bcv: false, sos: false, golden: false, renace: false, jhenzaen: true },
    marcaTexto: false,
  });
  assert.ok(htmlJhenzaen.includes('Jhenzaen 2.012 C.A'), 'Debe tener Jhenzaen');
  assert.ok(!htmlJhenzaen.includes('Banco Central de Venezuela'), 'No debe tener BCV');
  assert.ok(!htmlJhenzaen.includes('SOS La Guaira'), 'No debe tener SOS');

  // C) Todos los logos
  const htmlTodos = pdfDocument({
    title: 'Reporte de taras',
    body: '<div>Contenido</div>',
    logos: { bcv: true, sos: true, golden: true, renace: true, jhenzaen: true },
    marcaTexto: true,
  });
  assert.ok(htmlTodos.includes('Banco Central de Venezuela'), 'Debe tener BCV');
  assert.ok(htmlTodos.includes('SOS La Guaira'), 'Debe tener SOS');
  assert.ok(htmlTodos.includes('Golden Touch'), 'Debe tener Golden Touch');
  assert.ok(htmlTodos.includes('Plan Venezuela Renace'), 'Debe tener Renace');
  assert.ok(htmlTodos.includes('Jhenzaen 2.012 C.A'), 'Debe tener Jhenzaen');
  assert.ok(htmlTodos.includes('Sistema de control interno'), 'Debe tener marca de texto');

  console.log('  ✓ Colocar y quitar logos del membrete funciona correctamente');
}

// 3. Título y subtítulo personalizados
{
  const r = resumenTaras(MOCK_CAMIONES, MOCK_TARAS);
  const subAuto = subtituloReporteTaras(r, 'conTara');
  assert.ok(subAuto.includes('2 camión(es) con tara cargada'), 'Subtítulo automático correcto');

  const subApagado = subtituloReporteTaras(r, 'conTara', { ...OPCIONES_TARAS_POR_DEFECTO, verSubtitulo: false });
  assert.equal(subApagado, '', 'Subtítulo apagado devuelve cadena vacía');

  const subCustom = subtituloReporteTaras(r, 'conTara', { ...OPCIONES_TARAS_POR_DEFECTO, subtituloPersonalizado: 'SUBTITULO DE PRUEBA' });
  assert.equal(subCustom, 'SUBTITULO DE PRUEBA', 'Subtítulo personalizado se respeta');
  console.log('  ✓ Título y subtítulo personalizables correcto');
}

// 4. Tarjetas individuales de resumen (KPIs)
{
  // Desactivar tarjetas específicas
  const sinPromedio = cuerpoReporteTaras(MOCK_CAMIONES, MOCK_TARAS, {
    ...OPCIONES_TARAS_POR_DEFECTO,
    kpiPromedio: false,
  });
  assert.ok(!sinPromedio.includes('TARA PROMEDIO'), 'Debe omitir tarjeta TARA PROMEDIO');
  assert.ok(sinPromedio.includes('TARA MAYOR'), 'Debe conservar TARA MAYOR');
  assert.ok(sinPromedio.includes('TARA MENOR'), 'Debe conservar TARA MENOR');

  const sinKpis = cuerpoReporteTaras(MOCK_CAMIONES, MOCK_TARAS, {
    ...OPCIONES_TARAS_POR_DEFECTO,
    kpis: false,
  });
  assert.ok(!sinKpis.includes('class="kpis"'), 'Debe omitir todas las tarjetas');
  console.log('  ✓ Opciones de tarjetas de resumen (KPIs) correcto');
}

// 5. Pie de totales
{
  const conTotales = cuerpoReporteTaras(MOCK_CAMIONES, MOCK_TARAS, {
    ...OPCIONES_TARAS_POR_DEFECTO,
    totalesPie: true,
  });
  assert.ok(conTotales.includes('<tfoot>'), 'Debe incluir pie de tabla con totales');

  const sinTotales = cuerpoReporteTaras(MOCK_CAMIONES, MOCK_TARAS, {
    ...OPCIONES_TARAS_POR_DEFECTO,
    totalesPie: false,
  });
  assert.ok(!sinTotales.includes('<tfoot>'), 'Debe omitir pie de tabla con totales');
  console.log('  ✓ Fila de totales en el pie de tabla correcto');
}

console.log('🎉 Todas las pruebas de personalización del Reporte de Taras pasaron exitosamente.');
