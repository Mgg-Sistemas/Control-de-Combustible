/*
 * 🧰 IMPORTACIÓN EXCEL DE MANTENIMIENTOS + MENSAJE WHATSAPP (24-nov-2026).
 *
 *   node scripts/test-mantenimiento-excel-y-whatsapp.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

require.extensions['.ts'] = (m, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  m._compile(out, filename);
};

const { generarMensajeWhatsAppMantenimiento } = require(path.join(ROOT, 'src/lib/mantenimientoPreventivo.ts'));
const { parsearFechaExcel, parsearMatrizMantenimientoExcel } = require(path.join(ROOT, 'src/lib/mantenimientoExcel.ts'));

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

// 1. Fechas Excel (ISO y serial numérico)
eq('fecha ISO', parsearFechaExcel('2026-09-17'), '2026-09-17');
eq('fecha serial Excel 46245', parsearFechaExcel(46245), '2026-08-11');
eq('fecha vacía usa mes fallback', parsearFechaExcel('', { year: '2026', month: '10' }), '2026-10-01');

// 2. Parseo del formato real multi-mes / multi-empresa
const catalogo = [
  { id: 'm1', code: 'Jumbo con Martillo 320D2', plate: null, serial: 'CAT0320DCZBH00579', company: 'GOLDEN TOUCH', last_horometro: 1510, horometro_base: 1000 },
  { id: 'm2', code: 'Jumbo 320', plate: null, serial: 'FTC003RHVTZ555615', company: 'LICCIONE', last_horometro: 1080, horometro_base: 500 },
  { id: 'm3', code: 'Jumbo 320 B', plate: null, serial: '03RHLTZ555570', company: 'LICCIONE', last_horometro: 1200, horometro_base: 400 },
  { id: 'm4', code: 'Jumbo 330', plate: null, serial: 'HBZN220CCSAA06927', company: 'LICCIONE', last_horometro: 1150, horometro_base: 500 },
];

const rows = [
  ['GOLDEN TOUCH 1127 C.A (ALIADOS)'],
  ['Equipo', 'Marca / Modelo', 'Serial / Placa', 'Horometro\nActual\n(HORAS)', 'Horometro\nProximo Cambio\n(250H)', 'Fecha (08/2026)', 'Horometro\nActual\n(HORAS)2', 'Horometro\nProximo Cambio\n(250H)2', 'Fecha (09/2026)', 'LT', 'UBICACIÓN'],
  ['Jumbo con Martillo 320D2', 'CAT', 'CAT0320DCZBH00579', '', '', '', 1248.7, 1498.7, '2026-09-17', '26LT', 'CARIBE / CORAL BEACH'],
  ['GOLDEN TOUCH 1127 C.A', '', '', '', '', '', '', '', '', 'TOTAL: 26LT', ''],
  ['Equipo', 'Marca / Modelo', 'Serial / Placa', 'Horometro\nActual\n(HORAS)', 'Horometro\nProximo Cambio\n(250H)', 'Fecha (08/2026)', 'Horometro\nActual\n(HORAS)2', 'Horometro\nProximo Cambio\n(250H)2', 'Fecha (09/2026)', 'LT', 'UBICACIÓN'],
  ['Jumbo 320', 'Lovol', 'FTC003RHVTZ555615', 233.9, 483.9, '2026-08-28', 523.5, 773.5, '2026-09-22', 24, 'CDT TANAGUARENAS'],
  ['Jumbo 320', 'Lovol', '03RHLTZ555570', 414.3, 664.3, '2026-08-28', 719.4, 969.4, '2026-09-24', 24, '//'],
  ['Jumbo 330', 'Case Cx220', 'HBZN220CCSAA06927', 563.4, 813.4, 46245, '', '', '', 18, 'CATIA LA MAR'],
  ['No existe', 'X', 'NOEXISTE999', 100, 350, '2026-09-01', '', '', '', 10, 'PATIO'],
  ['EQUIPO', 'MARCA', '', 'EQUIPO', 'MARCA'],
  ['MINI SHOWER', 'LOVOL', '', 'RETRO', 'LOVOL'],
];

const existentes = [
  { machinery_id: 'm2', horometro_servicio: 233.9, fecha_servicio: '2026-08-28T12:00:00-04:00', anulado: false },
];

const res = parsearMatrizMantenimientoExcel(rows, catalogo, existentes);
eq('total detectados', res.servicios.length, 6);
eq('duplicados detectados', res.duplicados, 1);
eq('nuevos a registrar', res.nuevos.length, 5);
eq('omitidas sin coincidencia', res.omitidas.length, 1);
eq('máquinas coincidentes', res.maquinasCoincidentes, 4);

const m3Agosto = res.servicios.find((s) => s.machineryId === 'm3' && s.fechaServicio === '2026-08-28');
eq('hereda ubicación con //', m3Agosto?.ubicacion, 'CDT TANAGUARENAS');
const m1Sep = res.servicios.find((s) => s.machineryId === 'm1');
eq('parsea litros 26LT', m1Sep?.litros, 26);
const m4Ag = res.servicios.find((s) => s.machineryId === 'm4');
eq('parsea fecha serial 46245 en Jumbo 330', m4Ag?.fechaServicio, '2026-08-11');
ok('orden cronológico ascendente', res.nuevos[0].fechaServicio <= res.nuevos[res.nuevos.length - 1].fechaServicio);

// 3. Mensajes WhatsApp (Vencida, Por vencer, Al día)
const ahora = new Date('2026-11-24T13:30:00Z'); // 09:30 a.m. Caracas
const msgVencida = generarMensajeWhatsAppMantenimiento({
  code: 'Jumbo 320',
  plate: 'P-123',
  company: 'GOLDEN TOUCH',
  horometroActual: 1510,
  horometroServicio: 1248.7,
  fechaServicio: '2026-09-17',
  ahora,
});
ok('msg vencida incluye Horómetro Actual', msgVencida.includes('1510 h'));
ok('msg vencida incluye Horómetro próximo cambio (1498.7)', msgVencida.includes('1498.7 h'));
ok('msg vencida incluye Fecha último servicio (17/09/2026)', msgVencida.includes('17/09/2026'));
ok('msg vencida incluye estatus VENCIDA', msgVencida.includes('VENCIDA'));
ok('msg vencida incluye fecha y hora de emisión', msgVencida.includes('24/11/2026') && msgVencida.includes('Emitido:'));

const msgPorVencer = generarMensajeWhatsAppMantenimiento({
  code: 'Retro 420F2',
  serial: 'CAT0420F',
  company: 'GOLDEN TOUCH',
  horometroActual: 490,
  horometroServicio: 268,
  fechaServicio: '2026-09-29',
  ahora,
});
ok('msg por vencer incluye POR VENCER', msgPorVencer.includes('POR VENCER'));
ok('msg por vencer incluye próximo cambio 518 h', msgPorVencer.includes('518 h'));

const msgAlDia = generarMensajeWhatsAppMantenimiento({
  code: 'Payloader',
  plate: '35S01836',
  company: 'GOLDEN TOUCH',
  horometroActual: 22900,
  horometroServicio: 22825.7,
  fechaServicio: '2026-08-31',
  ahora,
});
ok('msg al día incluye AL DÍA', msgAlDia.includes('AL DÍA'));

// 4. Integración en pantallas y modales
const srcScreen = fs.readFileSync(path.join(ROOT, 'src/screens/MantenimientoMaquinariaScreen.tsx'), 'utf8');
const srcHistModal = fs.readFileSync(path.join(ROOT, 'src/components/HistorialServiciosModal.tsx'), 'utf8');
const srcRegModal = fs.readFileSync(path.join(ROOT, 'src/components/RegistrarMantenimientoModal.tsx'), 'utf8');
ok('MantenimientoMaquinariaScreen tiene botón Importar Excel', /Importar Excel/.test(srcScreen));
ok('MantenimientoMaquinariaScreen tiene botón WhatsApp en historial', /Sacar mensaje WhatsApp/.test(srcScreen));
ok('HistorialServiciosModal tiene botón WhatsApp', /💬 WhatsApp/.test(srcHistModal));
ok('RegistrarMantenimientoModal tiene botón Guardar y WhatsApp', /Guardar y WhatsApp/.test(srcRegModal));

console.log(`test-mantenimiento-excel-y-whatsapp: ${pass} pasaron, ${fail} fallaron.`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
