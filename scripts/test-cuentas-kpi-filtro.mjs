/*
 * 💰 TOTALES KPI AL FILTRAR ESTADOS EN CUENTAS POR PAGAR (23-nov-2026).
 * Verifica que al seleccionar un estado (Pagadas, Vencidas, > $1,000 USD, etc.)
 * las tarjetas superiores muestren el monto en USD de las cuentas filtradas.
 *
 *   node scripts/test-cuentas-kpi-filtro.mjs
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

require.extensions['.ts'] = (m, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  m._compile(out, filename);
};

const cargar = (rel) => require(path.join(ROOT, rel));

const { calcularTotalesKpiCxp, calcularTarjetasFiltroCxp } = cargar('src/lib/cuentasEmpresa.ts');
const srcCuentas = fs.readFileSync(path.join(ROOT, 'src/screens/CuentasScreen.tsx'), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) pass++;
  else {
    fail++;
    failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`);
  }
};

const porEmpresas = [
  { situacion: 'vencida', saldo: 500, monto: 500 },
  { situacion: 'vencida', saldo: 257, monto: 300 },
  { situacion: 'por_vencer', saldo: 1200, monto: 1200 },
  { situacion: 'pendiente', saldo: 34764.72, monto: 34764.72 },
  { situacion: 'pagada', saldo: 0, monto: 100000 },
  { situacion: 'pagada', saldo: 0, monto: 70331.06 },
  { situacion: 'anulada', saldo: 999, monto: 999 },
];

// 1. Estado "todos": suma pendiente/vencido/porVencer sobre porEmpresas (sin pagadas ni anuladas)
const resTodos = calcularTotalesKpiCxp(porEmpresas, porEmpresas, 'por_pagar', 'todos');
eq('todos: etiquetaPrincipal', resTodos.etiquetaPrincipal, 'TOTAL PENDIENTE');
eq('todos: pendiente', Number(resTodos.pendiente.toFixed(2)), 36721.72);
eq('todos: vencido', resTodos.vencido, 757);
eq('todos: nVencidas', resTodos.nVencidas, 2);
eq('todos: porVencer', resTodos.porVencer, 1200);
eq('todos: nPrincipal undefined', resTodos.nPrincipal, undefined);

// 2. Estado "pagada": usa monto (porque saldo es 0) y etiqueta TOTAL PAGADAS
const pagadasVis = porEmpresas.filter((c) => c.situacion === 'pagada');
const resPagadas = calcularTotalesKpiCxp(porEmpresas, pagadasVis, 'por_pagar', 'pagada');
eq('pagada: etiquetaPrincipal', resPagadas.etiquetaPrincipal, 'TOTAL PAGADAS');
eq('pagada: monto total en USD', Number(resPagadas.pendiente.toFixed(2)), 170331.06);
eq('pagada: nPrincipal', resPagadas.nPrincipal, 2);
eq('pagada: vencido en 0', resPagadas.vencido, 0);
eq('pagada: porVencer en 0', resPagadas.porVencer, 0);

// 3. Estado "vencida": solo las vencidas filtradas
const vencidasVis = porEmpresas.filter((c) => c.situacion === 'vencida');
const resVencidas = calcularTotalesKpiCxp(porEmpresas, vencidasVis, 'por_pagar', 'vencida');
eq('vencida: etiquetaPrincipal', resVencidas.etiquetaPrincipal, 'TOTAL VENCIDAS');
eq('vencida: principal', resVencidas.pendiente, 757);
eq('vencida: nPrincipal', resVencidas.nPrincipal, 2);
eq('vencida: vencido', resVencidas.vencido, 757);
eq('vencida: porVencer', resVencidas.porVencer, 0);

// 4. Estado "mayor_mil": refleja solo las > $1,000 USD filtradas y su desglose
const mayorMilVis = [porEmpresas[2], porEmpresas[3]];
const resMayorMil = calcularTotalesKpiCxp(porEmpresas, mayorMilVis, 'por_pagar', 'mayor_mil');
eq('mayor_mil: etiquetaPrincipal', resMayorMil.etiquetaPrincipal, 'TOTAL PAGO > $1,000 USD');
eq('mayor_mil: principal', Number(resMayorMil.pendiente.toFixed(2)), 35964.72);
eq('mayor_mil: nPrincipal', resMayorMil.nPrincipal, 2);
eq('mayor_mil: porVencer', resMayorMil.porVencer, 1200);
eq('mayor_mil: nPorVencer', resMayorMil.nPorVencer, 1);

// 5. En por_cobrar nunca aplica filtro de estado CxP
const resCobrar = calcularTotalesKpiCxp(porEmpresas, pagadasVis, 'por_cobrar', 'pagada');
eq('por_cobrar: mantiene TOTAL PENDIENTE', resCobrar.etiquetaPrincipal, 'TOTAL PENDIENTE');
eq('por_cobrar: mantiene pendiente general', Number(resCobrar.pendiente.toFixed(2)), 36721.72);

// 6. Integración en CuentasScreen.tsx
eq('CuentasScreen importa calcularTotalesKpiCxp', /calcularTotalesKpiCxp/.test(srcCuentas), true);
eq('Quick usa tot.etiquetaPrincipal', /label=\{tot\.etiquetaPrincipal\}/.test(srcCuentas), true);
eq('Quick muestra sub de nPrincipal', /tot\.nPrincipal\s*!=\s*null/.test(srcCuentas), true);

// 7. Tarjetas individuales con monto en USD para cada uno de los 7 filtros de Por Pagar
const muestra7 = [
  { situacion: 'vencida', saldo: 500, monto: 500, aprobacionEstado: 'esperando_pago', esMayorAMil: false, prioridad: 'alta' },
  { situacion: 'vencida', saldo: 257, monto: 300, aprobacionEstado: 'esperando_aprobacion', esMayorAMil: false, prioridad: 'media' },
  { situacion: 'por_vencer', saldo: 1200, monto: 1200, aprobacionEstado: 'esperando_pago', esMayorAMil: true, prioridad: 'alta' },
  { situacion: 'pendiente', saldo: 3400, monto: 3400, aprobacionEstado: 'esperando_aprobacion', esMayorAMil: true, prioridad: 'alta' },
  { situacion: 'pagada', saldo: 0, monto: 10000, aprobacionEstado: 'pagada', esMayorAMil: true, prioridad: 'alta' },
  { situacion: 'anulada', saldo: 999, monto: 999, aprobacionEstado: 'no_aplica', esMayorAMil: false, prioridad: 'alta' },
];
const t7 = calcularTarjetasFiltroCxp(muestra7);
eq('tarjeta todos: abiertas (sin pagadas ni anuladas)', [t7.todos.count, t7.todos.totalUsd], [4, 5357]);
eq('tarjeta esperando_aprobacion: cuenta y suma saldo', [t7.esperando_aprobacion.count, t7.esperando_aprobacion.totalUsd], [2, 3657]);
eq('tarjeta mayor_mil: solo abiertas > $1,000 USD', [t7.mayor_mil.count, t7.mayor_mil.totalUsd], [2, 4600]);
eq('tarjeta esperando_pago: cuenta y suma saldo', [t7.esperando_pago.count, t7.esperando_pago.totalUsd], [2, 1700]);
eq('tarjeta vencida: cuenta y suma saldo', [t7.vencida.count, t7.vencida.totalUsd], [2, 757]);
eq('tarjeta prioridad_alta: solo abiertas de prioridad alta', [t7.prioridad_alta.count, t7.prioridad_alta.totalUsd], [3, 5100]);
eq('tarjeta pagada: cuenta y suma monto pagado', [t7.pagada.count, t7.pagada.totalUsd], [1, 10000]);
eq('CuentasScreen renderiza las 7 tarjetas con tarjetasFiltroCxp', /calcularTarjetasFiltroCxp/.test(srcCuentas) && /tarjetasFiltroCxp\[item\.key\]/.test(srcCuentas), true);

console.log(`test-cuentas-kpi-filtro: ${pass} pasaron, ${fail} fallaron.`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
