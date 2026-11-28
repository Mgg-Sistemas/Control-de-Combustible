// ⏱️ PRUEBA AUTOMATIZADA: Horas extras en Control de pago a personal (28/11/2026)
// Verifica:
// 1. Caso real del cliente (Armando Correa: 15 días × $20 + 8 horas extras × $2 = $316).
// 2. Decimales con punto y coma en horas extras y precio de hora extra.
// 3. Horas extras en períodos "Por semana".
// 4. Modo "Por hora" NO suma dos veces las horas.
// 5. Blindaje anti-doble-cobro en operadores automáticos (`source === 'auto'`).
// 6. Blindaje de períodos cerrados (`aprobada` / `pagada`) históricos vs nuevos.
// 7. Integración en PagoPersonalScreen (modal, tarjeta, recibo PDF, reporte PDF, Excel) y Manual.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

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

const {
  devengadoBaseOf,
  devengadoTotalOf,
  totalRenglonOf,
  horasExtrasEfectivas,
  precioHoraExtraOf,
  montoHorasExtrasOf,
  horasInicialesEditor,
  desgloseDevengadoTexto,
} = require(path.join(ROOT, 'src/lib/horasExtrasNomina.ts'));

const fmtUsd = (n) => `$${Number(n).toFixed(2)}`;

let pass = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  pass++;
};
const eq = (actual, expected, msg) => {
  assert.equal(actual, expected, msg);
  pass++;
};

console.log('--- 1. Caso real del cliente: ARMANDO CORREA (15 días × $20 + 8 h extras × $2 = $316) ---');
{
  const armando = {
    source: 'manual',
    overridden: true,
    precio_hora: 2,
    precio_semana: 140,
    precio_dia: 20,
    precio_noche: 0,
    horas: 8,
    semanas: 0,
    dias: 15,
    dias_noche: 0,
    bonos: [],
    deducciones: [],
  };

  eq(devengadoBaseOf(armando, 'dia'), 300, 'Jornadas base = 15 × 20 = 300');
  eq(horasExtrasEfectivas(armando, 'dia', 'borrador'), 8, '8 horas extras efectivas');
  eq(precioHoraExtraOf(armando), 2, 'Precio hora extra = $2');
  eq(montoHorasExtrasOf(armando, 'dia', 'borrador'), 16, 'Subtotal horas extras = 8 × 2 = $16');
  eq(devengadoTotalOf(armando, 'dia', 'borrador'), 316, 'Devengado total = 300 + 16 = $316');
  eq(totalRenglonOf(armando, 'dia', 'borrador'), 316, 'Total a pagar = $316');

  const desc = desgloseDevengadoTexto(armando, 'dia', fmtUsd, 'borrador');
  ok(desc.includes('☀️ 15 × $20.00'), 'Desglose incluye jornadas día');
  ok(desc.includes('⏱️ 8 h ext. × $2.00 ($16.00)'), 'Desglose incluye precio, cantidad y subtotal de horas extras');
}

console.log('--- 2. Decimales con coma y punto + bonos y deducciones ---');
{
  const emp = {
    source: 'manual',
    overridden: true,
    precio_dia: '20',
    dias: '10',
    precio_noche: '25',
    dias_noche: '2',
    precio_hora: '2,50',
    horas: '7,5',
    bonos: [{ label: 'Transporte', amount: 10 }],
    deducciones: [{ label: 'Adelanto', amount: '5,25' }],
  };
  // Base = 200 + 50 = 250; H.Extra = 7.5 * 2.5 = 18.75 -> Devengado = 268.75
  // Total = 268.75 + 10 - 5.25 = 273.50
  eq(devengadoBaseOf(emp, 'dia'), 250, 'Base día + noche');
  eq(montoHorasExtrasOf(emp, 'dia', 'borrador'), 18.75, '7,5 h × $2,50 = $18,75');
  eq(devengadoTotalOf(emp, 'dia', 'borrador'), 268.75, 'Devengado con decimales');
  eq(totalRenglonOf(emp, 'dia', 'borrador'), 273.5, 'Total con bonos y deducciones');
}

console.log('--- 3. Modo "Por semana" también suma horas extras ---');
{
  const empSem = {
    source: 'manual',
    overridden: true,
    precio_semana: 140,
    semanas: 2,
    precio_hora: 2,
    horas: 6,
  };
  eq(devengadoBaseOf(empSem, 'semana'), 280, '2 semanas × $140 = $280');
  eq(montoHorasExtrasOf(empSem, 'semana', 'borrador'), 12, '6 h × $2 = $12');
  eq(devengadoTotalOf(empSem, 'semana', 'borrador'), 292, 'Devengado semanal + horas extras = $292');
}

console.log('--- 4. Modo "Por hora" NO duplica las horas ---');
{
  const empHora = {
    source: 'manual',
    overridden: true,
    precio_hora: 3,
    horas: 40,
  };
  eq(horasExtrasEfectivas(empHora, 'hora', 'borrador'), 0, 'En modo hora no hay horas extras aparte');
  eq(montoHorasExtrasOf(empHora, 'hora', 'borrador'), 0, 'Monto extra en modo hora = 0');
  eq(devengadoTotalOf(empHora, 'hora', 'borrador'), 120, '40 h × $3 = $120 exactos (sin duplicar)');
}

console.log('--- 5. Blindaje de operadores automáticos (source === "auto") ---');
{
  // Operador con 10 jornadas y 120 worked_hours arrastradas de máquina, sin ajuste manual
  const opAuto = {
    source: 'auto',
    overridden: false,
    dias: 10,
    precio_dia: 60,
    horas: 120,
    precio_hora: 2,
  };
  eq(horasExtrasEfectivas(opAuto, 'dia', 'borrador'), 0, 'Horas de máquina auto sin tocar valen 0 h extras');
  eq(horasInicialesEditor(opAuto, 'dia', 'borrador'), 0, 'Al abrir el modal del operador auto arranca en 0 h extras');
  eq(devengadoTotalOf(opAuto, 'dia', 'borrador'), 600, 'Solo cobra sus 10 jornadas ($600), sin sumar las 120h de máquina');

  // Si RRHH le carga manualmente 4 horas extras a ese operador:
  const opConExtras = {
    ...opAuto,
    overridden: true,
    horas: 4,
    precio_hora: 2,
  };
  eq(horasExtrasEfectivas(opConExtras, 'dia', 'borrador'), 4, 'Operador con horas extras manuales sí cuenta 4 h');
  eq(devengadoTotalOf(opConExtras, 'dia', 'borrador'), 608, '$600 + 4 × $2 = $608');

  // Operador donde editaron días antes pero precio_hora es 0 y quedaron 96h viejas:
  const opViejo = {
    source: 'auto',
    overridden: true,
    dias: 8,
    precio_dia: 60,
    horas: 96,
    precio_hora: 0,
  };
  eq(horasInicialesEditor(opViejo, 'dia', 'borrador'), 0, 'Limpia las 96h viejas de máquina si precio_hora es 0');
}

console.log('--- 6. Blindaje de períodos cerrados (aprobada / pagada) ---');
{
  // Período viejo cerrado ANTES de este cambio (su devengado guardado en BD fue 200, no 360)
  const cerradoViejo = {
    source: 'manual',
    overridden: true,
    dias: 10,
    precio_dia: 20,
    horas: 80,
    precio_hora: 2,
    devengado: 200,
    total: 200,
  };
  eq(horasExtrasEfectivas(cerradoViejo, 'dia', 'pagada'), 0, 'Período cerrado viejo conserva 0 h extras');
  eq(devengadoTotalOf(cerradoViejo, 'dia', 'pagada'), 200, 'Período cerrado viejo conserva su devengado congelado ($200)');

  // Período nuevo cerrado CON horas extras (devengado guardado en BD = 316)
  const cerradoNuevo = {
    source: 'manual',
    overridden: true,
    dias: 15,
    precio_dia: 20,
    horas: 8,
    precio_hora: 2,
    devengado: 316,
    total: 316,
  };
  eq(horasExtrasEfectivas(cerradoNuevo, 'dia', 'aprobada'), 8, 'Período aprobado nuevo mantiene sus 8 h extras');
  eq(devengadoTotalOf(cerradoNuevo, 'dia', 'aprobada'), 316, 'Período aprobado nuevo mantiene sus $316');
}

console.log('--- 7. Integración en PagoPersonalScreen y ManualScreen ---');
{
  const scr = fs.readFileSync(path.join(ROOT, 'src/screens/PagoPersonalScreen.tsx'), 'utf8');
  const man = fs.readFileSync(path.join(ROOT, 'src/screens/ManualScreen.tsx'), 'utf8');

  ok(scr.includes('⏱️ Precio hora extra ($)'), 'Modal rotula claramente Precio hora extra ($)');
  ok(scr.includes('⏱️ Horas extras'), 'Modal rotula claramente Horas extras');
  ok(scr.includes('Precio ⏱️ hora extra'), 'Recibo PDF muestra cuánto vale la hora extra');
  ok(scr.includes('Cantidad ⏱️ horas extras'), 'Recibo PDF muestra cuántas horas extras hizo');
  ok(scr.includes('⏱️ H.Ext:'), 'Reporte PDF de nómina muestra cuánto vale la hora extra');
  ok(scr.includes('incl. H.Ext:'), 'Reporte PDF de nómina muestra el subtotal de horas extras en Devengado');
  ok(man.includes('HORAS EXTRAS EN NÓMINA POR PERÍODO (28/11/2026)'), 'Manual actualizado con fecha 28/11/2026');
}

console.log(`\n✅ test-nomina-horas-extras: ${pass} verificaciones pasaron con éxito (0 fallos).`);
