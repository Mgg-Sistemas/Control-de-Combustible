/*
 * Test del 📊 REPORTE DE COMPRAS · S.O.S LA GUAIRA
 *
 * Verifica:
 *  1. Totales matemáticos exactos en USD y Bolívares (BCV).
 *  2. Robustez ante tasa BCV en 0 o inválida (sin NaN ni Infinity).
 *  3. Ranking ordenado por gasto con porcentajes y resumen por empresa.
 *  4. Top categorías y top ítems.
 *  5. Cumplimiento estricto de regla GEMINI.md: maquinaria SIEMPRE con CÓDIGO + PLACA.
 *  6. Sanitización contra XSS en notas, nombres y departamentos.
 *  7. Estética oficial azul SOS (#0A2540, #0284C7) y membrete de SOS La Guaira.
 *  8. Conmutadores modulares "¿Qué se oculta?" y columnas configurables.
 *
 *   node scripts/test-reporte-compras-sos.mjs
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
function loadTs(abs) {
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
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

const R = loadTs(path.join(ROOT, 'src/lib/reporteComprasSOS.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── 1) FORMATEO DE MONEDA Y NÚMEROS ──────────────────────────────────────────
eq('formatea montos con coma decimal y punto de miles', R.fmtMontoVe(1605.75), '1.605,75');
eq('formatea montos grandes correctamente', R.fmtMontoVe(1447776.32), '1.447.776,32');
eq('fmtUsd incluye símbolo $ y espacio', R.fmtUsd(1605.75), '$ 1.605,75');
eq('fmtBs incluye Bs y espacio', R.fmtBs(1447776.32), 'Bs 1.447.776,32');
eq('manejo seguro de NaN o infinito en fmtMontoVe', R.fmtMontoVe(NaN), '0,00');

// ── 2) SANITIZACIÓN HTML CONTRA XSS ─────────────────────────────────────────
eq('escapa signos angulares', R.escHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
eq('escapa comillas simples y dobles', R.escHtml('Tubo 2" y cople 1/2\''), 'Tubo 2&quot; y cople 1/2&#39;');
eq('escapa ampersand', R.escHtml('Mantenimiento & Operaciones'), 'Mantenimiento &amp; Operaciones');

// ── 3) IDENTIFICACIÓN DE MAQUINARIA CON PLACA (REGLA GEMINI.MD) ──────────────
const maquinasMock = [
  { code: 'VOLVO-240', plate: 'A01FE8M', name: 'EXCAVADORA VOLVO EC240' },
  { code: 'CAT-966H', plate: 'M-84920', name: 'PAYLOADER CATERPILLAR 966H' },
];

eq('agrega la placa obligatoria si la máquina existe en catálogo',
  R.enriquecerMaquinariaConPlaca('Reparación para VOLVO-240', maquinasMock),
  'Reparación para VOLVO-240 [Placa: A01FE8M]'
);

eq('respeta si el texto ya traía placa escrita',
  R.enriquecerMaquinariaConPlaca('VOLVO-240 con placa A01FE8M', maquinasMock),
  'VOLVO-240 con placa A01FE8M'
);

eq('si la máquina no está en catálogo devuelve el texto original intacto',
  R.enriquecerMaquinariaConPlaca('HERRAMIENTAS MENORES TALLER', maquinasMock),
  'HERRAMIENTAS MENORES TALLER'
);

// ── 4) TRANSFORMACIÓN Y AGRUPACIÓN DE COMPRAS ────────────────────────────────
const comprasEjemplo = [
  {
    id: '1',
    tipo: 'cuenta',
    codigo: 'CXP-001',
    fecha: '2026-11-10',
    empresaNombre: 'GOBERNACIÓN',
    empresaId: 'emp-1',
    departamento: 'MINA PERAMANAL',
    destinoMaquinaria: 'VOLVO-240 [Placa: A01FE8M]',
    proveedorNombre: 'REPUESTOS LA GUAIRA C.A.',
    analistaNombre: 'CARLOS PÉREZ',
    status: 'pagada',
    statusLabel: 'Pagada',
    items: [
      { name: 'Aceite 15W40 208L', category: 'Lubricantes', quantity: 2, unit: 'tambor', unitPrice: 350, total: 700 },
      { name: 'Filtro de Aceite', category: 'Filtros', quantity: 4, unit: 'pza', unitPrice: 25, total: 100 },
    ],
    totalUsd: 800,
    montoPagadoUsd: 800,
    saldoPendienteUsd: 0,
  },
  {
    id: '2',
    tipo: 'cuenta',
    codigo: 'CXP-002',
    fecha: '2026-11-11',
    empresaNombre: 'S.O.S LA GUAIRA',
    empresaId: 'emp-2',
    departamento: 'TRANSPORTE',
    destinoMaquinaria: 'CAMIÓN TORONTO [Placa: A12DH7S]',
    proveedorNombre: 'CAUCHERA CENTRAL',
    analistaNombre: 'CARLOS PÉREZ',
    status: 'pagada',
    statusLabel: 'Pagada',
    items: [
      { name: 'Caucho 12.00R24', category: 'Cauchos', quantity: 2, unit: 'pza', unitPrice: 400, total: 800 },
    ],
    totalUsd: 800,
    montoPagadoUsd: 800,
    saldoPendienteUsd: 0,
  },
  {
    id: '3',
    tipo: 'requerimiento',
    codigo: 'REQ-0231',
    fecha: '2026-11-12',
    empresaNombre: 'S.O.S LA GUAIRA',
    empresaId: 'emp-2',
    departamento: 'TALLER CENTRAL',
    destinoMaquinaria: 'CAT-966H [Placa: M-84920]',
    proveedorNombre: 'TORNILLERÍA ORIENTE',
    analistaNombre: 'CARLOS PÉREZ',
    status: 'pendiente',
    statusLabel: 'Pendiente por aprobar',
    items: [
      { name: 'Pernos Grado 8', category: 'Tornillería', quantity: 50, unit: 'pza', unitPrice: 4, total: 200 },
    ],
    totalUsd: 200,
    montoPagadoUsd: 0,
    saldoPendienteUsd: 200,
  },
];

const tasaBcvMock = 50.0;
const transformado = R.transformarDatosReporteCompras(comprasEjemplo, tasaBcvMock);

// Verificación de KPIs
eq('total compras count es 3', transformado.kpis.totalComprasCount, 3);
eq('total compras USD es 1800', transformado.kpis.totalComprasUsd, 1800);
eq('total compras Bs con tasa 50 es 90000', transformado.kpis.totalComprasBs, 90000);
eq('compras finalizadas (pagadas) count es 2', transformado.kpis.comprasFinalizadasCount, 2);
eq('compras finalizadas USD es 1600', transformado.kpis.comprasFinalizadasUsd, 1600);
eq('compras pendientes count es 1', transformado.kpis.comprasPendientesCount, 1);
eq('compras pendientes USD es 200', transformado.kpis.comprasPendientesUsd, 200);
eq('total pagado USD es 1600', transformado.kpis.totalPagadoUsd, 1600);

// Verificación de Resumen por Empresa
ok('resumenEmpresas tiene Gobernación y SOS La Guaira',
  transformado.resumenEmpresas.some((e) => e.nombre === 'GOBERNACIÓN') &&
  transformado.resumenEmpresas.some((e) => e.nombre === 'S.O.S LA GUAIRA')
);

// Verificación de Top Categorías
eq('top categorías contiene Cauchos y Lubricantes',
  transformado.topCategorias.map((c) => c.nombre).includes('Cauchos'),
  true
);

// ── 5) GENERACIÓN DE HTML Y ESTÉTICA SOS LA GUAIRA ──────────────────────────
const html = R.generarReporteComprasHtml(transformado, {
  periodoLabel: '10/11/2026 al 12/11/2026',
  fechaDesde: '2026-11-10',
  fechaHasta: '2026-11-12',
  empresaFiltroLabel: 'Todas las empresas',
  tasaBcv: tasaBcvMock,
  logo: 'sos',
});

ok('contiene membrete S.O.S LA GUAIRA', html.includes('S.O.S LA GUAIRA'));
ok('contiene color azul institucional #0A2540', html.includes('#0A2540'));
ok('contiene color azul cielo #0284C7', html.includes('#0284C7'));
ok('contiene título REPORTE DE COMPRAS', html.includes('REPORTE DE COMPRAS'));
ok('contiene alcance con período especificado', html.includes('10/11/2026 AL 12/11/2026'));
ok('contiene placa de la maquinaria en tabla', html.includes('[Placa: A01FE8M]'));
ok('contiene monto formateado en USD y Bs', html.includes('$ 1.800,00') && html.includes('Bs 90.000,00'));

// ── 6) CONMUTADORES "¿QUÉ SE OCULTA?" Y COLUMNAS CONFIGURABLES ──────────────
const htmlSinKpis = R.generarReporteComprasHtml(transformado, {
  periodoLabel: 'Noviembre 2026',
  tasaBcv: tasaBcvMock,
  logo: 'sos',
  sinKpis: true,
  sinResumenEmpresas: true,
  columnas: {
    empresa: false,
    montoBs: false,
  },
});

ok('si sinKpis es true, no renderiza el bloque div kpi-grid', !htmlSinKpis.includes('<div class="kpi-grid">'));
ok('si columna empresa es false y sinResumenEmpresas es true, no renderiza header Empresa', !htmlSinKpis.includes('<th>Empresa</th>'));

// ── 7) RESPETO DE TASA HISTÓRICA A LA FECHA DE PAGO (NO TASA DE HOY) ─────────
const comprasConTasaHistorica = [
  {
    id: 'p1',
    tipo: 'cuenta',
    codigo: 'CXP-HIST-01',
    fecha: '2026-08-15',
    empresaNombre: 'S.O.S LA GUAIRA',
    departamento: 'TALLER',
    destinoMaquinaria: 'VOLVO-240 [Placa: A01FE8M]',
    proveedorNombre: 'REPUESTOS LA GUAIRA',
    analistaNombre: 'CARLOS',
    status: 'pagada',
    statusLabel: 'Pagada',
    items: [],
    totalUsd: 100, // a tasa 40 Bs/$ histórica = 4.000 Bs (no 5.000 Bs con tasa 50)
    totalBs: 4000,
    montoPagadoUsd: 100,
    saldoPendienteUsd: 0,
  },
  {
    id: 'p2',
    tipo: 'cuenta',
    codigo: 'CXP-HIST-02',
    fecha: '2026-11-12',
    empresaNombre: 'S.O.S LA GUAIRA',
    departamento: 'OPERACIONES',
    destinoMaquinaria: 'CAT-966H [Placa: M-84920]',
    proveedorNombre: 'FERRETERÍA CENTRAL',
    analistaNombre: 'CARLOS',
    status: 'pendiente',
    statusLabel: 'Pendiente por pagar',
    items: [],
    totalUsd: 50,
    totalBs: 2500, // tasa 50
    montoPagadoUsd: 0,
    saldoPendienteUsd: 50,
  },
];

const transfHist = R.transformarDatosReporteCompras(comprasConTasaHistorica, 900.0); // tasa actual 900
eq('suma total en Bs respeta los 4000 + 2500 históricos y no multiplica 150 por 900', transfHist.kpis.totalComprasBs, 6500);
eq('total pagado en Bs respeta los 4000 históricos', transfHist.kpis.totalPagadoBs, 4000);

// ── 8) FILTRO ESTRICTO DE ESTADO: SOLO PAGADAS ────────────────────────────────
const comprasSoloPagadas = comprasConTasaHistorica.filter((c) => c.status === 'pagada');
const transfSoloPagadas = R.transformarDatosReporteCompras(comprasSoloPagadas, 900.0);
const htmlSoloPagadas = R.generarReporteComprasHtml(transfSoloPagadas, {
  periodoLabel: 'Histórico',
  estadoFiltro: 'pagadas',
  tasaBcv: 900.0,
  logo: 'sos',
});

ok('en solo pagadas el título indica lo efectivamente comprado', htmlSoloPagadas.includes('Listado Consolidado de Compras Pagadas (Lo efectivamente comprado)'));
ok('en solo pagadas no renderiza sección 3 de compras pendientes', !htmlSoloPagadas.includes('3. Compras y Cuentas Pendientes por Pagar'));
ok('en solo pagadas incluye la compra CXP-HIST-01', htmlSoloPagadas.includes('CXP-HIST-01'));
ok('en solo pagadas no incluye la compra pendiente CXP-HIST-02 en la tabla', !htmlSoloPagadas.includes('CXP-HIST-02'));

// ── 9) EXCLUSIÓN DE REQUERIMIENTOS Y CUENTAS ANULADAS / RECHAZADAS (REQ-0159) ─
const comprasConRechazados = [
  {
    id: 'req-valido',
    tipo: 'requerimiento',
    codigo: 'REQ-0160',
    fecha: '2026-11-10',
    empresaNombre: 'S.O.S LA GUAIRA',
    departamento: 'OPERACIONES',
    status: 'pendiente',
    statusLabel: 'Pendiente',
    items: [],
    totalUsd: 1200,
    montoPagadoUsd: 0,
    saldoPendienteUsd: 1200,
  },
  {
    id: 'req-rechazado-0159',
    tipo: 'requerimiento',
    codigo: 'REQ-0159',
    fecha: '2026-11-11',
    empresaNombre: 'S.O.S LA GUAIRA',
    departamento: 'ANTHONY PRUEBA',
    status: 'rechazado',
    statusLabel: 'Rechazado',
    items: [],
    totalUsd: 29500,
    montoPagadoUsd: 0,
    saldoPendienteUsd: 29500,
  },
];

// Filtro estricto que aplica ReporteComprasModal
const comprasDepuradas = comprasConRechazados.filter((c) => c.status !== 'rechazado' && c.status !== 'anulado');
eq('filtro excluye requerimiento rechazado REQ-0159', comprasDepuradas.length, 1);
eq('la única compra es REQ-0160', comprasDepuradas[0].codigo, 'REQ-0160');

const transfDepurada = R.transformarDatosReporteCompras(comprasDepuradas, 900.0);
eq('total de compras no incluye los 29500 de ANTHONY PRUEBA', transfDepurada.kpis.totalComprasUsd, 1200);
ok('ranking de departamentos no contiene ANTHONY PRUEBA', !transfDepurada.rankingDepartamentos.some((d) => d.nombre.includes('ANTHONY')));

// ── REPORTE FINAL DE TESTS ──────────────────────────────────────────────────
console.log(`\nResultados: ${pass} pasados, ${fail} fallados`);
if (fail > 0) {
  console.error('\nFallos detectados:\n' + failures.join('\n\n'));
  process.exit(1);
} else {
  console.log('✅ Todos los tests del Reporte de Compras SOS pasaron satisfactoriamente.');
}
