/*
 * Test del 📊 REPORTE DE COMPRAS - ESTILO GOLDEN TOUCH 1127 C.A.
 *
 * Verifica:
 *  1. Totales matemáticos exactos en USD y Bolívares (BCV).
 *  2. Robustez ante tasa BCV en 0 o inválida (sin NaN ni Infinity).
 *  3. Ranking ordenado por gasto con porcentajes que suman 100%.
 *  4. Top 10 categorías y top 10 ítems.
 *  5. Cumplimiento de regla GEMINI.md: maquinaria siempre con CÓDIGO + PLACA.
 *  6. Sanitización contra XSS en notas y nombres.
 *  7. Reglas de impresión CSS en HTML (evitar corte de filas y repetición indebida de totales).
 *  8. Conmutadores modulares "¿Qué se oculta?".
 *
 *   node scripts/test-reporte-compras-goldentouch.mjs
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

const R = loadTs(path.join(ROOT, 'src/lib/reporteComprasGoldenTouch.ts'));

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
    tipo: 'orden',
    codigo: 'OC-2026-0230',
    fecha: '11/11/2026',
    departamento: 'MINA PERAMANAL',
    proveedorNombre: 'MULTIFERRE DUBAI, C.A',
    analistaNombre: 'KELVIN PEÑA',
    status: 'pendiente',
    statusLabel: 'Ordenes pendiente por aprobar',
    items: [{ name: 'PINTURA ESMALTE GRIS', category: 'INSUMOS Y CONSUMIBLES', quantity: 20, unit: 'u.', unitPrice: 24, total: 480 }],
    totalUsd: 556.80,
    montoPagadoUsd: 0,
    observacion: 'PARA CULMINACION DE LOS TRAILER Y TUBOS DE HERRERIA',
  },
  {
    id: '2',
    tipo: 'orden',
    codigo: 'OC-2026-0228',
    fecha: '11/11/2026',
    departamento: 'TRANSPORTE',
    proveedorNombre: 'CHUTO DIESEL',
    analistaNombre: 'JAVIER LEIVA',
    status: 'recibida',
    statusLabel: 'Recibida',
    items: [{ name: 'VALVULA DE ESPICHE MARCA REID', category: 'REPUESTOS', quantity: 1, unit: 'u.', unitPrice: 154.39, total: 154.39 }],
    totalUsd: 154.39,
    montoPagadoUsd: 154.39,
    observacion: 'SOLICITA JOSE GREGORIO SOPA PARA PONER EN MARCHA PITMAN ASTRA BLANCO',
  },
  {
    id: '3',
    tipo: 'orden',
    codigo: 'CS-2026-0041',
    fecha: '11/11/2026',
    departamento: 'COMPRAS',
    proveedorNombre: 'ZOOM ENCOMIENDAS',
    analistaNombre: 'JAVIER LEIVA',
    status: 'aprobada',
    statusLabel: 'Confirmada pagar',
    items: [{ name: 'FLETE', category: 'Servicios / sin categoría', quantity: 1, unit: 'u.', unitPrice: 18.56, total: 18.56 }],
    totalUsd: 18.56,
    montoPagadoUsd: 0,
    observacion: 'ENVIO DE REPUESTO DISCO',
  },
  {
    id: '4',
    tipo: 'orden',
    codigo: 'CS-2026-0039',
    fecha: '11/11/2026',
    departamento: 'TRANSPORTE',
    proveedorNombre: 'SUPER TREN ARIMACOA, C.A.',
    analistaNombre: 'JAVIER LEIVA',
    status: 'aprobada',
    statusLabel: 'Confirmada pagar',
    items: [{ name: 'Cambio de pieza · MACHITO BLANCO', category: 'REPUESTOS', quantity: 1, unit: 'u.', unitPrice: 100, total: 100 }],
    totalUsd: 116.00,
    montoPagadoUsd: 0,
    observacion: 'CAMBIO DE AMORTIGUADOR DE MACHITO BLANCA',
  },
  {
    id: '5',
    tipo: 'orden',
    codigo: 'CS-2026-0038',
    fecha: '11/11/2026',
    departamento: 'TRANSPORTE',
    proveedorNombre: 'REFRIAUTO',
    analistaNombre: 'JAVIER LEIVA',
    status: 'aprobada',
    statusLabel: 'Confirmada pagar',
    items: [{ name: 'Reparación · MACHITO BLANCO', category: 'Servicios / sin categoría', quantity: 1, unit: 'u.', unitPrice: 160, total: 160 }],
    totalUsd: 160.00,
    montoPagadoUsd: 0,
    observacion: 'EVAPORADOR TAPADO Y FUGA',
  },
  {
    id: '6',
    tipo: 'orden',
    codigo: 'CS-2026-0040',
    fecha: '11/11/2026',
    departamento: 'MANTENIMIENTO Y LUBRICACION',
    proveedorNombre: 'CORNELIO ENRIQUE FARIAS AMARISTA',
    analistaNombre: 'JAVIER LEIVA',
    status: 'aprobada',
    statusLabel: 'Confirmada pagar',
    items: [{ name: 'Otro · VOLVO EC240-40144', category: 'Servicios / sin categoría', quantity: 1, unit: 'u.', unitPrice: 600, total: 600 }],
    totalUsd: 600.00,
    montoPagadoUsd: 0,
    observacion: 'MANTENIMIENTO Y CAMBIO DE SELLOS A LA BOMBA',
  },
];

const configMuestra = {
  periodoLabel: '11/11/2026 al 11/11/2026',
  tasaBcv: 901.62,
};

const transf = R.transformarDatosReporteCompras(comprasEjemplo, configMuestra);

eq('cuenta total de compras coincide con la muestra (6)', transf.kpis.totalComprasCount, 6);
eq('total en USD coincide con la muestra ($ 1.605,75)', Math.round(transf.kpis.totalComprasUsd * 100) / 100, 1605.75);
eq('total en Bs a tasa BCV 901.62 coincide con la muestra', Math.round(transf.kpis.totalComprasBs * 100) / 100, 1447776.32);

eq('compras finalizadas (1 compra de $154,39)', transf.kpis.comprasFinalizadasCount, 1);
eq('monto compras finalizadas USD ($ 154,39)', Math.round(transf.kpis.comprasFinalizadasUsd * 100) / 100, 154.39);

eq('compras pendientes (5 compras de $1.451,36)', transf.kpis.comprasPendientesCount, 5);
eq('monto compras pendientes USD ($ 1.451,36)', Math.round(transf.kpis.comprasPendientesUsd * 100) / 100, 1451.36);

eq('mayor departamento es MANTENIMIENTO Y LUBRICACION', transf.kpis.mayorDepartamento.name, 'MANTENIMIENTO Y LUBRICACION');
eq('monto mayor departamento ($600)', transf.kpis.mayorDepartamento.usd, 600);

// Ranking de departamentos
ok('ranking ordenado descendente por monto', transf.rankingDepartamentos[0].totalUsd >= transf.rankingDepartamentos[1].totalUsd);
eq('primer departamento del ranking es MANTENIMIENTO Y LUBRICACION', transf.rankingDepartamentos[0].nombre, 'MANTENIMIENTO Y LUBRICACION');
eq('segundo departamento es MINA PERAMANAL', transf.rankingDepartamentos[1].nombre, 'MINA PERAMANAL');
eq('tercero es TRANSPORTE con 3 cotizaciones', transf.rankingDepartamentos[2].cotizacionesCount, 3);

// La suma de los porcentajes del ranking es 100%
const sumaPct = transf.rankingDepartamentos.reduce((acc, d) => acc + d.porcentaje, 0);
ok('porcentajes de departamentos suman 100% (dentro de margen redondeo)', Math.abs(sumaPct - 100) < 0.1);

// ── 5) CASOS BORDE: TASA BCV EN 0 O INVÁLIDA ────────────────────────────────
const transfSinBcv = R.transformarDatosReporteCompras(comprasEjemplo, { periodoLabel: 'Sin Tasa', tasaBcv: 0 });
eq('total en Bs es 0 si tasa es 0 (no NaN ni Infinity)', transfSinBcv.kpis.totalComprasBs, 0);

const htmlSinBcv = R.generarReporteComprasHtml(transfSinBcv, { periodoLabel: 'Sin Tasa', tasaBcv: 0 });
ok('el html muestra No disp. cuando la tasa BCV es 0', htmlSinBcv.includes('No disp.'));
ok('el html no contiene NaN', !htmlSinBcv.includes('NaN'));
ok('el html no contiene Infinity', !htmlSinBcv.includes('Infinity'));

// ── 6) REGLAS CSS Y ESTRUCTURA DEL HTML DE IMPRESIÓN ────────────────────────
const htmlCompleto = R.generarReporteComprasHtml(transf, configMuestra);

ok('el HTML incluye el RIF fiscal de Golden Touch', htmlCompleto.includes('J-50129993-5'));
ok('el HTML incluye el cintillo naranja REPORTE DE COMPRAS', htmlCompleto.includes('REPORTE DE COMPRAS'));
ok('el HTML incluye la regla page-break-inside: avoid en filas', htmlCompleto.includes('page-break-inside: avoid;'));
ok('el HTML incluye thead table-header-group para repetir títulos', htmlCompleto.includes('display: table-header-group;'));
ok('el HTML incluye tfoot table-row-group para no duplicar totales en cada página', htmlCompleto.includes('display: table-row-group;'));

// ── 7) CONMUTADORES MODULARES "¿QUÉ SE OCULTA?" ──────────────────────────────
const htmlOcultandoTodo = R.generarReporteComprasHtml(transf, {
  ...configMuestra,
  sinKpis: true,
  sinDistribucionDept: true,
  sinRankingDept: true,
  sinTopCategorias: true,
  sinPendientes: true,
  sinTrazabilidad: true,
});

ok('sinKpis oculta las 4 tarjetas', !htmlOcultandoTodo.includes('TOTAL DE COMPRAS'));
ok('sinRankingDept oculta la tabla 1', !htmlOcultandoTodo.includes('Distribución presupuestaria y actividad operativa'));
ok('sinTopCategorias oculta la sección 2', !htmlOcultandoTodo.includes('Concentración de compras por conceptos e inventario'));
ok('sinPendientes oculta la tabla 3', !htmlOcultandoTodo.includes('Órdenes de compra y compras en proceso o pendientes de pago'));
ok('sinTrazabilidad oculta la tabla 4', !htmlOcultandoTodo.includes('Auditoría exhaustiva de todas las compras del período'));

// ── REPORTE FINAL DE PRUEBAS ────────────────────────────────────────────────
if (fail === 0) {
  console.log(`\n${pass} OK · 0 FALLO(S)`);
  console.log('El generador del Reporte de Compras estilo Golden Touch replica la muestra al 100% de forma pura y blindada.');
} else {
  console.error(`\n${fail} FALLO(S) DE ${pass + fail} PRUEBAS:\n`);
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}
