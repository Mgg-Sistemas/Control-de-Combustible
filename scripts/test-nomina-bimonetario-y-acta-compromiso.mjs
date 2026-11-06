// Pruebas automatizadas para:
// 1. Visualización bimonetaria (USD / Bs) y configuración de tasa de cambio en Nómina (`src/lib/nominaBimonetario.ts`, `PagoPersonalScreen.tsx`, `NominaScreen.tsx`).
// 2. Módulo de Acta de Compromiso y Entrega de Herramientas (`src/lib/actaCompromiso.ts`, `src/lib/actasCompromisoDb.ts`, `src/components/ActaCompromisoModal.tsx`, `src/components/SignaturePadModal.tsx`).
// 3. Campo «Salario Semanal» en Datos bancarios y columna «💵 Salario Semanal» en el Reporte PDF de Empleados (`src/lib/empleadosReporte.ts`, `src/screens/EmpleadosScreen.tsx`, `src/lib/ficha.ts`, `src/screens/EmployeeCardScreen.tsx`).
//
// Se corre con: node scripts/test-nomina-bimonetario-y-acta-compromiso.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

async function loadTsModule(relPath, mocks = {}) {
  const fullPath = join(rootDir, relPath);
  const source = readFileSync(fullPath, 'utf8');
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  for (const [spec, mockCode] of Object.entries(mocks)) {
    const dataUrl = `data:text/javascript;base64,${Buffer.from(mockCode, 'utf8').toString('base64')}`;
    outputText = outputText.replaceAll(`from '${spec}'`, `from '${dataUrl}'`);
    outputText = outputText.replaceAll(`from "${spec}"`, `from "${dataUrl}"`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(outputText, 'utf8').toString('base64')}`;
  return import(url);
}

const numerosCode = ts.transpileModule(readFileSync(join(rootDir, 'src/lib/numeros.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;

const habilidadesCode = `
export function limpiarHabilidades(raw) {
  if (Array.isArray(raw)) return raw.map(x => String(x || '').trim().toUpperCase()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) return raw.split(/[,;\\n]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
  return [];
}
`;

const bimonetario = await loadTsModule('src/lib/nominaBimonetario.ts', {
  './numeros': numerosCode,
});

const actaMod = await loadTsModule('src/lib/actaCompromiso.ts', {
  './logoData': 'export const LOGO_DATA_URI = "data:image/png;base64,iVBOR";',
  './company': 'export const COMPANY_NAME = "SOS LA GUAIRA";',
  './numeros': numerosCode,
});

const empReporteMod = await loadTsModule('src/lib/empleadosReporte.ts', {
  './empleadosHabilidades': habilidadesCode,
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. Pruebas de nominaBimonetario.ts (USD + VES y tasa manual con punto o coma)
// ══════════════════════════════════════════════════════════════════════════════

// Tasa del período tiene prioridad sobre la tasa global BCV
assert.equal(bimonetario.resolverTasaPeriodo(46.25, 45.10), 46.25);
assert.equal(bimonetario.resolverTasaPeriodo(null, 45.10), 45.10);
assert.equal(bimonetario.resolverTasaPeriodo(0, 45.10), 45.10);
assert.equal(bimonetario.resolverTasaPeriodo(null, null), null);

// Origen de la tasa
assert.equal(bimonetario.origenTasaPeriodo(46.25, 45.10), 'periodo');
assert.equal(bimonetario.origenTasaPeriodo(null, 45.10), 'dia');
assert.equal(bimonetario.origenTasaPeriodo(null, null), 'ninguna');

// Validación de tasa manual aceptando punto o coma
const vComa = bimonetario.validarTasaManual('45,75');
assert.equal(vComa.ok, true);
assert.equal(vComa.valor, 45.75);

const vPunto = bimonetario.validarTasaManual('45.75');
assert.equal(vPunto.ok, true);
assert.equal(vPunto.valor, 45.75);

const vCero = bimonetario.validarTasaManual('0');
assert.equal(vCero.ok, false);

const vVacio = bimonetario.validarTasaManual('   ');
assert.equal(vVacio.ok, false);

// Conversión USD <-> VES
assert.equal(bimonetario.calcularVesDesdeUsd(100, 45.5), 4550);
assert.equal(bimonetario.calcularVesDesdeUsd(50.5, 40), 2020);
assert.equal(bimonetario.calcularVesDesdeUsd(100, null), 0);
assert.equal(bimonetario.calcularUsdDesdeVes(4550, 45.5), 100);

// Formateo bimonetario
const fb = bimonetario.formatearBimonetario(120, 50);
assert.ok(fb.usd.startsWith('$'), `USD debe iniciar con $: ${fb.usd}`);
assert.ok(fb.ves && fb.ves.startsWith('Bs '), `VES debe iniciar con Bs: ${fb.ves}`);
assert.equal(fb.vesNumero, 6000);
assert.ok(fb.bimonetario.includes('$') && fb.bimonetario.includes('Bs '));

console.log('✓ 1. Cálculos bimonetarios (USD / Bs) y validación de tasa con punto o coma verificados');

// ══════════════════════════════════════════════════════════════════════════════
// 2. Pruebas de actaCompromiso.ts (cláusulas legales, ítems, firma y PDF)
// ══════════════════════════════════════════════════════════════════════════════

const codigoActa = actaMod.generarCodigoActaCompromiso(7, '2026-11-04');
assert.equal(codigoActa, 'AC-HER-2026-007');

const itemsSucios = [
  { nombre: '   Taladro percutor ', serial: ' TL-99 ', cantidad: '2', estado: 'Operativo', valor_usd: '85,50' },
  { nombre: '   ', serial: 'X', cantidad: 1, estado: 'Nuevo', valor_usd: 10 },
];
const itemsLimpios = actaMod.limpiarItemsActa(itemsSucios);
assert.equal(itemsLimpios.length, 1, 'Debe descartar filas sin nombre de herramienta');
assert.equal(itemsLimpios[0].nombre, 'Taladro percutor');
assert.equal(itemsLimpios[0].serial, 'TL-99');
assert.equal(itemsLimpios[0].cantidad, 2);
assert.equal(itemsLimpios[0].valor_usd, 85.5);

const totalUsd = actaMod.totalValorReposicionUsd(itemsLimpios);
assert.equal(totalUsd, 171, 'Total de reposición debe ser 2 * 85.50 = 171.00');

const htmlActa = actaMod.actaCompromisoHtml({
  codigo: codigoActa,
  fullName: 'Carlos Pérez',
  cedula: 'V-18.900.123',
  fichaNumber: '0207',
  cargo: 'MECÁNICO DIESEL',
  department: 'MANTENIMIENTO',
  fechaEntrega: '2026-11-04',
  items: itemsLimpios,
  observaciones: 'Entregado en perfecto estado operativo.',
  entregadoPor: 'DIANA DE LA RANS',
  entregadoCargo: 'JEFE DE ALMACÉN',
  firmaTrabajadorDataUri: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"></svg>',
});

assert.ok(htmlActa.includes('Acta de Compromiso y Entrega de Herramientas'), 'Título del acta');
assert.ok(htmlActa.includes('Uso adecuado y exclusivo:'), 'Cláusula 1');
assert.ok(htmlActa.includes('Cuidado, guarda y mantenimiento:'), 'Cláusula 2');
assert.ok(htmlActa.includes('Aceptación de responsabilidad y devolución:'), 'Cláusula 3');
assert.ok(htmlActa.includes('Autorización de deducción salarial por daño o extravío:'), 'Cláusula 4 de descuento salarial');
assert.ok(htmlActa.includes('Taladro percutor') && htmlActa.includes('TL-99'), 'Debe listar la herramienta y su serial');
assert.ok(htmlActa.includes('data:image/svg+xml;utf8,'), 'Debe incrustar la firma digital');

// 2b. Pruebas de Acta de Recepción y Devolución de Herramientas (06/11/2026)
const codigoRecepcion = actaMod.generarCodigoActaRecepcion(3, '2026-11-06');
assert.equal(codigoRecepcion, 'AR-HER-2026-003');
assert.equal(actaMod.esActaRecepcion({ codigo: codigoRecepcion }), true);
assert.equal(actaMod.esActaRecepcion({ codigo: codigoActa }), false);

const prepRec = actaMod.prepararItemsParaRecepcion(itemsLimpios);
assert.equal(prepRec.length, 1);
assert.equal(prepRec[0].cantidad_devuelta, 2);
assert.equal(prepRec[0].estado_retorno, 'BUENO / OPERATIVO');
assert.equal(actaMod.evaluarResultadoRecepcion(prepRec), 'CONFORME');

// Simular devolución con 1 ítem en buen estado y 1 ítem dañado con cargo
const itemsRecepcionConNovedad = actaMod.limpiarItemsActa([
  {
    nombre: 'Casco de seguridad',
    cantidad: 1,
    cantidad_devuelta: 1,
    serial: 'CS-01',
    estado: 'NUEVO',
    estado_retorno: 'DESGASTE NORMAL',
    observacion_retorno: 'Rayones leves por uso en obra',
    valor_usd: 15,
    cargo_usd: 0,
    tipo_acta: 'recepcion',
  },
  {
    nombre: 'Taladro percutor',
    cantidad: 2,
    cantidad_devuelta: '1',
    serial: 'TL-99',
    estado: 'BUENO',
    estado_retorno: 'DAÑADO / AVERIADO',
    observacion_retorno: 'Un taladro regresó con inducido quemado y falta el segundo',
    valor_usd: '85,50',
    cargo_usd: '85,50',
    tipo_acta: 'recepcion',
  },
]);
assert.equal(actaMod.evaluarResultadoRecepcion(itemsRecepcionConNovedad), 'CON_NOVEDAD');
assert.equal(actaMod.totalCargoReposicionUsd(itemsRecepcionConNovedad), 85.5);
const resRet = actaMod.resumenEstadosRetorno(itemsRecepcionConNovedad);
assert.equal(resRet.desgaste, 1);
assert.equal(resRet.danados, 1);
assert.equal(resRet.totalEntregados, 3);
assert.equal(resRet.totalDevueltos, 2);

const htmlRecepcion = actaMod.actaCompromisoHtml({
  codigo: codigoRecepcion,
  fullName: 'Carlos Pérez',
  cedula: 'V-18.900.123',
  cargo: 'MECÁNICO DIESEL',
  department: 'MANTENIMIENTO',
  fechaEntrega: '2026-11-06',
  tipoActa: 'recepcion',
  actaOrigenCodigo: 'AC-HER-2026-007',
  fechaEntregaOrigen: '2026-11-04',
  motivoRecepcion: 'Fin de relación laboral / Liquidación',
  items: itemsRecepcionConNovedad,
  observaciones: 'Se descuenta 1 taladro averiado según acta de compromiso.',
  entregadoPor: 'DIANA DE LA RANS',
  entregadoCargo: 'JEFE DE ALMACÉN',
});
assert.ok(htmlRecepcion.includes('Acta de Recepción y Devolución de Herramientas'), 'Título del acta de recepción');
assert.ok(htmlRecepcion.includes('AC-HER-2026-007'), 'Debe mostrar el acta de entrega de origen');
assert.ok(htmlRecepcion.includes('Fin de relación laboral / Liquidación'), 'Debe mostrar el motivo de devolución');
assert.ok(htmlRecepcion.includes('DAÑADO / AVERIADO') && htmlRecepcion.includes('DESGASTE NORMAL'), 'Debe mostrar el estado en que regresó cada herramienta');
assert.ok(htmlRecepcion.includes('Un taladro regresó con inducido quemado'), 'Debe mostrar la observación de retorno');
assert.ok(htmlRecepcion.includes('$85.50'), 'Debe mostrar el cargo de reposición en USD');

console.log('✓ 2. Generador de Acta de Compromiso/Entrega y Acta de Recepción/Devolución de Herramientas verificado');

// ══════════════════════════════════════════════════════════════════════════════
// 3. Pruebas de «Salario Semanal» en Empleados y Reporte PDF
// ══════════════════════════════════════════════════════════════════════════════

// leerSalarioSemanalEmpleado prioriza base_salary y usa fallback a precio_semana
assert.equal(empReporteMod.leerSalarioSemanalEmpleado({ base_salary: 150, precio_semana: 120 }), 150);
assert.equal(empReporteMod.leerSalarioSemanalEmpleado({ base_salary: null, precio_semana: 120 }), 120);
assert.equal(empReporteMod.leerSalarioSemanalEmpleado({ base_salary: 0, precio_semana: 95.5 }), 95.5);
assert.equal(empReporteMod.leerSalarioSemanalEmpleado({ base_salary: null, precio_semana: null }), null);
assert.equal(empReporteMod.formatearSalarioSemanalReporte({ base_salary: 150 }), '$150,00');
assert.equal(empReporteMod.formatearSalarioSemanalReporte({ base_salary: null, precio_semana: null }), '—');

// Verifica el cálculo de las 4 frecuencias (Día, Semana, Quincenal, Mensual)
const salsSoldador = empReporteMod.calcularSalariosEmpleadoReporte({ base_salary: 250, precio_dia: 35.7142, precio_semana: 250 });
assert.equal(salsSoldador.diario, 35.71);
assert.equal(salsSoldador.semanal, 250);
assert.equal(salsSoldador.quincenal, 500);
assert.equal(salsSoldador.mensual, 1000);

// Cuando se activan las 4 columnas en el reporte PDF, aparecen las 4 columnas, las tarjetas de resumen y el pie de tabla
const opConSalario = {
  ...empReporteMod.OPCIONES_REPORTE_EMPLEADOS_DEFECTO,
  salarioDiario: true,
  salarioSemanal: true,
  salarioQuincenal: true,
  salarioMensual: true,
};
const resConSalario = empReporteMod.cuerpoReporteEmpleados({
  empleados: [
    { id: '1', first_name: 'ANA', last_name: 'NIETO', cedula: '27163024', cargo: 'ANALISTA', department: 'ADMINISTRATIVO', status: 'activo', base_salary: 140 },
    { id: '2', first_name: 'JOSE', last_name: 'GUERRA', cedula: '19782354', cargo: 'AUXILIAR', department: 'SOPORTE Y SERVICIO', status: 'activo', base_salary: null, precio_semana: 70 },
  ],
  opciones: opConSalario,
  estadoTxt: 'Activos',
});
assert.ok(resConSalario.body.includes('Por Día'), 'Debe mostrar columna Por Día cuando está activo');
assert.ok(resConSalario.body.includes('Por Semana'), 'Debe mostrar columna Por Semana cuando está activo');
assert.ok(resConSalario.body.includes('Quincenal'), 'Debe mostrar columna Quincenal cuando está activo');
assert.ok(resConSalario.body.includes('Mensual'), 'Debe mostrar columna Mensual cuando está activo');
assert.ok(resConSalario.body.includes('Total Por Día') && resConSalario.body.includes('Total Por Semana') && resConSalario.body.includes('Total Quincenal') && resConSalario.body.includes('Total Mensual'), 'Debe mostrar los 4 cuadros superiores de totales');
assert.ok(resConSalario.body.includes('$140,00') && resConSalario.body.includes('$70,00') && resConSalario.body.includes('$210,00') && resConSalario.body.includes('$420,00') && resConSalario.body.includes('$840,00'), 'Debe mostrar los montos individuales y las sumas totales (Semana $210, Quincenal $420, Mensual $840)');

// Cuando están en false, NO aparecen en el reporte PDF
const resSinSalario = empReporteMod.cuerpoReporteEmpleados({
  empleados: [
    { id: '1', first_name: 'ANA', last_name: 'NIETO', cedula: '27163024', cargo: 'ANALISTA', department: 'ADMINISTRATIVO', status: 'activo', base_salary: 120 },
  ],
  opciones: { ...empReporteMod.OPCIONES_REPORTE_EMPLEADOS_DEFECTO, salarioDiario: false, salarioSemanal: false, salarioQuincenal: false, salarioMensual: false },
  estadoTxt: 'Activos',
});
assert.ok(!resSinSalario.body.includes('Total Por Semana'), 'No debe mostrar Total Por Semana cuando está desmarcado');

// Turno Diurno vs Turno Nocturno en cargos por turno (ej. OPERADORES DE MAQUINARIA: $45 día / $50 noche)
const opTurnoNocturno = {
  ...empReporteMod.OPCIONES_REPORTE_EMPLEADOS_DEFECTO,
  salarioDiario: false,
  salarioNocturno: true,
  salarioSemanal: true,
};
const resTurnoNocturno = empReporteMod.cuerpoReporteEmpleados({
  empleados: [
    {
      id: 'op1',
      first_name: 'ALBERTO',
      last_name: 'SILVA',
      cedula: '10583795',
      cargo: 'OPERADORES DE MAQUINARIA',
      department: 'OPERACIONES DE MAQUINARIA',
      status: 'activo',
      base_salary: null,
      precio_dia: 45,
      precio_noche: 50,
      precio_semana: 0,
    },
  ],
  opciones: opTurnoNocturno,
  estadoTxt: 'Activos',
});
assert.ok(resTurnoNocturno.body.includes('Por Noche'), 'Debe mostrar columna Por Noche cuando salarioNocturno está activo');
assert.ok(resTurnoNocturno.body.includes('$50,00') && resTurnoNocturno.body.includes('$350,00'), 'En turno nocturno debe mostrar $50,00 por noche y $350,00 por semana');
assert.ok(resTurnoNocturno.body.includes('Total Por Noche'), 'Debe mostrar cuadro superior Total Por Noche');

// Modo Tabulador por Cargo en Resumen por cargo (cuando se apaga Listado de personas y se encienden montos)
const resTabuladorCargo = empReporteMod.cuerpoReporteEmpleados({
  empleados: [
    { id: '1', first_name: 'A', last_name: 'B', cargo: 'EQUIPO DE CORTE', department: 'REMOCION Y EXCAVACION', status: 'activo', precio_dia: 50, precio_semana: 350 },
    { id: '2', first_name: 'C', last_name: 'D', cargo: 'EQUIPO DE CORTE', department: 'REMOCION Y EXCAVACION', status: 'activo', precio_dia: 50, precio_semana: 350 },
    { id: '3', first_name: 'E', last_name: 'F', cargo: 'MECANICO', department: 'SOPORTE Y SERVICIO', status: 'activo', precio_dia: 75, precio_semana: 525 },
  ],
  opciones: {
    ...empReporteMod.OPCIONES_REPORTE_EMPLEADOS_DEFECTO,
    empleado: false,
    cedula: false,
    ficha: false,
    cargo: false,
    habilidades: false,
    empresa: false,
    estado: false,
    telefono: false,
    departamento: true,
    salarioDiario: true,
    salarioSemanal: true,
    resumenCargo: true,
    listadoPersonas: false,
  },
  estadoTxt: 'Activos',
});
assert.ok(resTabuladorCargo.body.includes('Resumen por cargo (2)'), 'Debe renderizar Resumen por cargo');
assert.ok(!resTabuladorCargo.body.includes('>Personas<'), 'En modo Tabulador por Cargo (con montos activos) no debe mostrar la columna Personas');
assert.ok(
  resTabuladorCargo.body.includes('EQUIPO DE CORTE') &&
  resTabuladorCargo.body.includes('REMOCION Y EXCAVACION') &&
  resTabuladorCargo.body.includes('$50,00') &&
  resTabuladorCargo.body.includes('$350,00') &&
  resTabuladorCargo.body.includes('MECANICO') &&
  resTabuladorCargo.body.includes('$75,00') &&
  resTabuladorCargo.body.includes('$525,00'),
  'El Resumen por cargo en modo Tabulador debe mostrar el Cargo, Departamento y las tarifas unitarias Por Día y Por Semana de cada cargo',
);

// Verificar que en EmpleadosScreen.tsx el campo base_salary esté etiquetado como "Salario Semanal" y estén las 5 opciones del reporte (incluyendo Diurno y Nocturno)
const empleadosScreenSrc = readFileSync(join(rootDir, 'src/screens/EmpleadosScreen.tsx'), 'utf8');
assert.ok(
  empleadosScreenSrc.includes("{ key: 'base_salary', label: 'Salario Semanal', type: 'number' }"),
  'EmpleadosScreen debe tener base_salary etiquetado como Salario Semanal',
);
assert.ok(
  empleadosScreenSrc.includes("['salarioDiario', '☀️ Por Día (Diurno)']") &&
  empleadosScreenSrc.includes("['salarioNocturno', '🌙 Por Noche (Nocturno)']") &&
  empleadosScreenSrc.includes("['salarioSemanal', '💵 Por Semana']") &&
  empleadosScreenSrc.includes("['salarioQuincenal', '💵 Quincenal']") &&
  empleadosScreenSrc.includes("['salarioMensual', '💵 Mensual']"),
  'EmpleadosScreen debe incluir ☀️ Por Día (Diurno), 🌙 Por Noche (Nocturno), 💵 Por Semana, 💵 Quincenal y 💵 Mensual en el selector de columnas del reporte',
);

// Verificar reglas críticas en actasCompromisoDb.ts y componentes (sin DELETE, con .select, con Cámara y Galería)
const dbSrc = readFileSync(join(rootDir, 'src/lib/actasCompromisoDb.ts'), 'utf8');
assert.ok(!dbSrc.includes('.delete('), 'actasCompromisoDb.ts NUNCA debe hacer DELETE físico (solo anulado = true)');
assert.ok(dbSrc.includes('.select('), 'actasCompromisoDb.ts debe verificar escrituras con .select()');

const modalSrc = readFileSync(join(rootDir, 'src/components/ActaCompromisoModal.tsx'), 'utf8');
assert.ok(modalSrc.includes('takePhotoAndUpload') && modalSrc.includes('pickPhotoAndUpload'), 'ActaCompromisoModal debe ofrecer Cámara y Galería');
assert.ok(modalSrc.includes('Array.isArray(res?.actas)'), 'ActaCompromisoModal debe extraer el arreglo res.actas de listarActasCompromisoEmpleado');

const cardSrc = readFileSync(join(rootDir, 'src/screens/EmployeeCardScreen.tsx'), 'utf8');
assert.ok(cardSrc.includes('Array.isArray(resActas?.actas)'), 'EmployeeCardScreen debe extraer el arreglo resActas.actas de listarActasCompromisoEmpleado');

const sigSrc = readFileSync(join(rootDir, 'src/components/SignaturePadModal.tsx'), 'utf8');
assert.ok(
  (sigSrc.includes('takePhotoAndUpload') && sigSrc.includes('pickPhotoAndUpload')) ||
  (sigSrc.includes('launchCameraAsync') && sigSrc.includes('launchImageLibraryAsync')),
  'SignaturePadModal debe ofrecer Cámara y Galería',
);

console.log('✓ 3. Campo «Salario Semanal» en Datos bancarios y en Reporte PDF de Empleados + reglas de seguridad verificados');
console.log('✅ TODAS LAS PRUEBAS PASARON EXITOSAMENTE');
