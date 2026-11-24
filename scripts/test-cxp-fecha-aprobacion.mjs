/*
 * ✅ FECHA DE APROBACIÓN EN POR PAGAR + RESUMEN POR DÍA + FORMATO CRÉDITO OC/OS (24-nov-2026).
 *
 *   node scripts/test-cxp-fecha-aprobacion.mjs
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
  fechaAprobacionSoloDiaDe,
  fmtFechaAprobacionLegible,
  agruparCuentasPorFechaAprobacion,
  SIN_FECHA_APROBACION,
} = require(path.join(ROOT, 'src/lib/cuentasEmpresa.ts'));
const { construirMensajeCuentas } = require(path.join(ROOT, 'src/lib/cuentaMensaje.ts'));
const { armarReporteCuentas, OPCIONES_CUENTAS_POR_DEFECTO } = require(path.join(ROOT, 'src/lib/cuentasReporte.ts'));

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
const ok = (name, cond) => eq(name, Boolean(cond), true);

// 1. fechaAprobacionSoloDiaDe (Caracas UTC-4)
eq('extrae día de aprobacionInfo.fecha en hora Caracas',
  fechaAprobacionSoloDiaDe({ aprobacionInfo: { estado: 'aprobado', fecha: '2026-11-23T13:45:00Z' } }),
  '2026-11-23');
eq('extrae día cuando aprobacionInfo.fecha es noche UTC (cambia a día anterior Caracas)',
  fechaAprobacionSoloDiaDe({ aprobacionInfo: { estado: 'aprobado', fecha: '2026-11-24T02:00:00Z' } }),
  '2026-11-23');
eq('usa fallback reqVinculado.approved_at',
  fechaAprobacionSoloDiaDe({ aprobacionInfo: null, traza: { reqVinculado: { approved_at: '2026-11-22T15:00:00Z' } } }),
  '2026-11-22');
eq('devuelve null si no está aprobado ni tiene fecha',
  fechaAprobacionSoloDiaDe({ aprobacionInfo: { estado: 'pendiente', fecha: '2026-11-24T12:00:00Z' } }),
  null);

// 2. agruparCuentasPorFechaAprobacion
const cuentas = [
  { situacion: 'pendiente', saldo: 92.8, aprobacionInfo: { estado: 'aprobado', fecha: '2026-11-23T14:00:00Z' } },
  { situacion: 'pendiente', saldo: 139.87, aprobacionInfo: { estado: 'aprobado', fecha: '2026-11-23T16:00:00Z' } },
  { situacion: 'pendiente', saldo: 2556.27, aprobacionInfo: { estado: 'aprobado', fecha: '2026-11-24T13:00:00Z' } },
  { situacion: 'pagada', saldo: 0, aprobacionInfo: { estado: 'aprobado', fecha: '2026-11-24T13:00:00Z' } },
  { situacion: 'pendiente', saldo: 50, aprobacionInfo: null },
];
const grupos = agruparCuentasPorFechaAprobacion(cuentas);
eq('3 grupos (24, 23 y sin fecha; excluye pagadas)', grupos.length, 3);
eq('primer grupo es 2026-11-24', grupos[0].fecha, '2026-11-24');
eq('total del 24 = 2556.27', grupos[0].totalUsd, 2556.27);
eq('total del 23 = 232.67', grupos[1].totalUsd, 232.67);
eq('grupo del 23 tiene 2 cuentas', grupos[1].count, 2);
eq('último grupo es sin fecha', grupos[2].fecha, SIN_FECHA_APROBACION);

// 3. Mensaje WhatsApp incluye Fecha de aprobación
const msg = construirMensajeCuentas(
  [
    {
      orden: 'OC-2026-0274',
      proveedor: 'TECNO MAX, C.A',
      detalle: 'SISTEMAS',
      totalUsd: 139.87,
      autorizo: 'JAVIER LEIVA',
      fechaAprobacion: fmtFechaAprobacionLegible('2026-11-23T13:45:00Z'),
    },
  ],
  { personas: true, nota: true, condiciones: true, bs: false, banco: false, empresa: true }
);
ok('mensaje WhatsApp incluye Fecha de aprobación', msg.includes('Fecha de aprobación:'));

// 4. Modo crédito (OC y OS)
const repCero = armarReporteCuentas({
  tipo: 'por_pagar',
  cuentas: [],
  op: { ...OPCIONES_CUENTAS_POR_DEFECTO, modo: 'credito' },
  tasaBcv: 919.82,
  hoyISO: '2026-11-24',
  filtrado: false,
});
ok('modo crédito con 0 pendientes muestra TESORERÍA AL DÍA', repCero.cuerpo.includes('TESORERÍA AL DÍA EN CUENTAS A CRÉDITO'));

const repCon = armarReporteCuentas({
  tipo: 'por_pagar',
  cuentas: [
    {
      id: 'c1',
      contraparte: 'SUPER HOME C.A',
      empresaNombre: 'SOS',
      concepto: 'OC-1',
      documento: 'OC-2026-0275',
      fecha_emision: '2026-11-20',
      fecha_vencimiento: '2026-11-30',
      monto: 2556.27,
      abonado: 0,
      saldo: 2556.27,
      situacion: 'por_vencer',
      condicionesPago: 'Crédito 15 días',
    },
  ],
  op: { ...OPCIONES_CUENTAS_POR_DEFECTO, modo: 'credito' },
  tasaBcv: 919.82,
  hoyISO: '2026-11-24',
  filtrado: false,
});
ok('modo crédito con pendientes lista SUPER HOME C.A', repCon.cuerpo.includes('SUPER HOME C.A'));
ok('modo crédito con pendientes suma $2,556.27', repCon.cuerpo.includes('2.556,27') || repCon.cuerpo.includes('2,556.27'));

// 5. Integración en CuentasScreen.tsx y ReporteCuentasModal.tsx
const srcScreen = fs.readFileSync(path.join(ROOT, 'src/screens/CuentasScreen.tsx'), 'utf8');
const srcModal = fs.readFileSync(path.join(ROOT, 'src/components/ReporteCuentasModal.tsx'), 'utf8');
ok('CuentasScreen tiene filtro campoFechaCxp aprobacion', /'aprobacion'/.test(srcScreen));
ok('CuentasScreen tiene resumen por fecha de aprobación', /RESUMEN POR FECHA DE APROBACIÓN/.test(srcScreen));
ok('ReporteCuentasModal tiene modo credito', /'credito'/.test(srcModal));

console.log(`test-cxp-fecha-aprobacion: ${pass} pasaron, ${fail} fallaron.`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
