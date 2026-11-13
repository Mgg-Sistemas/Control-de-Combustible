// Pruebas automatizadas para el módulo de Carta de Autorización para Uso de Banco de Tercero en Nómina:
// 1. Lógica pura y generador HTML/PDF (`src/lib/cartaBancoTercero.ts`).
// 2. Persistencia multi-dispositivo en `payroll_companies` + `employees` (`src/lib/cartaBancoTerceroStorage.ts`).
// 3. Integración en Ficha PDF (`src/lib/ficha.ts`) y Reporte de Empleados (`src/lib/empleadosReporte.ts`).
// 4. Seguridad QR anónimo en `src/screens/EmployeeCardScreen.tsx` (`!isAnonSession`).
//
// Se corre con: node scripts/test-carta-banco-tercero.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function transpileFile(relPath, mocks = {}) {
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
  return outputText;
}

async function loadTsModule(relPath, mocks = {}) {
  const outputText = transpileFile(relPath, mocks);
  const url = `data:text/javascript;base64,${Buffer.from(outputText, 'utf8').toString('base64')}`;
  return import(url);
}

const textCode = transpileFile('src/lib/text.ts');

const constanciaMock = `
export const MEMBRETES_CONSTANCIA = [
  { key: 'sos', chip: '🌊 SOS La Guaira', nombre: 'SOS LA GUAIRA', cabecera: 'SOS LA GUAIRA', logo: 'data:image/png;base64,SOS', sinFinesDeLucro: true },
  { key: 'golden', chip: '✨ Golden Touch', nombre: 'GOLDEN TOUCH 1127, C.A.', cabecera: 'GOLDEN TOUCH 1127, C.A.', logo: 'data:image/png;base64,GOLDEN' },
  { key: 'renace', chip: '🇻🇪 Plan Venezuela Renace', nombre: 'PLAN VENEZUELA RENACE', cabecera: 'PLAN VENEZUELA RENACE', logo: 'data:image/png;base64,RENACE' },
  { key: 'jhenzaen', chip: '🏗️ Jhenzaen', nombre: 'CONSTRUCTORA JHENZAEN, C.A.', cabecera: 'CONSTRUCTORA JHENZAEN, C.A.', logo: 'data:image/png;base64,JHEN' },
  { key: 'bcv', chip: '🏦 BCV', nombre: 'BANCO CENTRAL DE VENEZUELA', cabecera: 'BANCO CENTRAL DE VENEZUELA', logo: 'data:image/png;base64,BCV' },
];
export const MEMBRETE_POR_DEFECTO = MEMBRETES_CONSTANCIA[0];
`;

const cartaCode = transpileFile('src/lib/cartaBancoTercero.ts', {
  './constancia': constanciaMock,
  './text': textCode,
});

const cartaMod = await loadTsModule('src/lib/cartaBancoTercero.ts', {
  './constancia': constanciaMock,
  './text': textCode,
});

const {
  normalizarCartaBancoTercero,
  detectarTitularDistintoAlEmpleado,
  esCuentaDeTercero,
  resolverCartaDeEmpleado,
  estadoCartaBancoTercero,
  construirPayloadCartaEmpresa,
  extraerMapaCartasDeEmpresas,
  nombreArchivoCartaBancoTercero,
  generarCartaBancoTerceroHtml,
  OPCIONES_CARTA_BANCO_TERCERO_DEFECTO,
} = cartaMod;

let passed = 0;
async function ok(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('=== Pruebas: Carta de Autorización para Uso de Banco de Tercero ===');

await ok('1. detectarTitularDistintoAlEmpleado detecta cuando el titular o cédula difiere del trabajador', () => {
  assert.equal(
    detectarTitularDistintoAlEmpleado({
      first_name: 'JUAN',
      last_name: 'PEREZ',
      cedula: 'V-12.345.678',
      bank_holder: null,
      bank_cedula: null,
    }),
    false
  );

  assert.equal(
    detectarTitularDistintoAlEmpleado({
      first_name: 'Juan',
      last_name: 'Pérez',
      cedula: 'V-12.345.678',
      bank_holder: 'JUAN PEREZ',
      bank_cedula: '12345678',
    }),
    false
  );

  assert.equal(
    detectarTitularDistintoAlEmpleado({
      first_name: 'JUAN',
      last_name: 'PEREZ',
      cedula: 'V-12.345.678',
      bank_holder: 'MARIA GOMEZ',
      bank_cedula: 'V-15.999.888',
    }),
    true
  );

  assert.equal(
    detectarTitularDistintoAlEmpleado({
      first_name: 'JUAN',
      last_name: 'PEREZ',
      cedula: 'V-12.345.678',
      bank_holder: '',
      bank_cedula: 'V-15.999.888',
    }),
    true
  );
});

await ok('2. normalizarCartaBancoTercero y estadoCartaBancoTercero clasifican cuenta propia, tercero sin soporte y tercero autorizado', () => {
  const empPropia = {
    first_name: 'CARLOS',
    last_name: 'RUIZ',
    cedula: 'V-18000111',
    bank_name: '0102 - BANCO DE VENEZUELA',
    bank_account: '01020000111122223333',
    bank_holder: 'CARLOS RUIZ',
    bank_cedula: 'V-18000111',
  };
  const stPropia = estadoCartaBancoTercero(empPropia, null);
  assert.equal(stPropia.esTercero, false);
  assert.equal(stPropia.tono, 'muted');

  const empTercero = {
    first_name: 'CARLOS',
    last_name: 'RUIZ',
    cedula: 'V-18000111',
    bank_name: '0102 - BANCO DE VENEZUELA',
    bank_account: '01020000111122223333',
    bank_holder: 'ANA RUIZ',
    bank_cedula: 'V-20111222',
  };
  const stPendiente = estadoCartaBancoTercero(empTercero, null);
  assert.equal(stPendiente.esTercero, true);
  assert.equal(stPendiente.tieneSoporteFirmado, false);
  assert.equal(stPendiente.tono, 'warning');

  const cartaConSoporte = normalizarCartaBancoTercero(
    {
      esTercero: true,
      titularNombre: 'ANA RUIZ',
      titularCedula: 'V-20111222',
      parentesco: 'Hermano(a)',
      bancoNombre: '0102 - BANCO DE VENEZUELA',
      numeroCuenta: '01020000111122223333',
      soportes: [
        {
          id: 'sop-1',
          url: 'https://example.com/carta-firmada.pdf',
          nombre: 'carta-firmada.pdf',
          tipo: 'pdf',
          fecha: '2026-11-13',
        },
      ],
    },
    empTercero
  );
  const stAutorizada = estadoCartaBancoTercero(empTercero, cartaConSoporte);
  assert.equal(stAutorizada.esTercero, true);
  assert.equal(stAutorizada.tieneSoporteFirmado, true);
  assert.equal(stAutorizada.tono, 'success');
  assert.equal(stAutorizada.cantidadSoportes, 1);
  assert.equal(stAutorizada.parentesco, 'Hermano(a)');
});

await ok('3. construirPayloadCartaEmpresa y extraerMapaCartasDeEmpresas serializan y recuperan por empleado sin pérdida', () => {
  const carta1 = normalizarCartaBancoTercero({
    esTercero: true,
    titularNombre: 'LUISA MARTINEZ',
    titularCedula: 'V-14.555.666',
    parentesco: 'Madre / Padre',
    titularTelefono: '0414-1234567',
    bancoNombre: '0134 - BANESCO',
    tipoCuenta: 'ambos',
    numeroCuenta: '0134-0000-11-2222333344',
    pagoMovilTelefono: '0414-1234567',
    pagoMovilBanco: '0134 - BANESCO',
    pagoMovilCedula: 'V-14.555.666',
    motivo: 'No poseo cuenta bancaria propia activa',
  });

  const payload1 = construirPayloadCartaEmpresa('emp-uuid-1', carta1);
  assert.equal(payload1.startsWith('__carta_banco_tercero__:emp-uuid-1:'), true);

  const filasPayrollCompanies = [
    { id: 'c1', name: 'SOS LA GUAIRA', active: true },
    { id: 'c2', name: '__nomina_habilidades__:{"Conductores":[]}', active: false },
    { id: 'c3', name: payload1, active: false },
  ];

  const mapa = extraerMapaCartasDeEmpresas(filasPayrollCompanies);
  assert.equal(Object.keys(mapa).length, 1);
  assert.equal(mapa['emp-uuid-1'].titularNombre, 'LUISA MARTINEZ');
  assert.equal(mapa['emp-uuid-1'].parentesco, 'Madre / Padre');
  assert.equal(mapa['emp-uuid-1'].tipoCuenta, 'ambos');
  assert.equal(mapa['emp-uuid-1'].pagoMovilTelefono, '0414-1234567');
});

await ok('4. generarCartaBancoTerceroHtml genera PDF con membrete elegido, escapa HTML malicioso y respeta opciones', () => {
  const carta = normalizarCartaBancoTercero({
    esTercero: true,
    titularNombre: 'MARIA <script>alert(1)</script> LOPEZ',
    titularCedula: 'V-19.888.777',
    parentesco: 'Esposo(a) / Concubino(a)',
    titularTelefono: '0412-9998877',
    bancoNombre: '0105 - MERCANTIL',
    tipoCuenta: 'ahorro',
    numeroCuenta: '01050000111122223333',
    pagoMovilBanco: '0105 - MERCANTIL',
    pagoMovilTelefono: '0412-9998877',
    pagoMovilCedula: 'V-19.888.777',
    motivo: 'Cuenta propia bloqueada',
    firmaTrabajadorUrl: 'data:image/png;base64,FIRMA_TRABAJADOR',
    membreteKey: 'golden',
  });

  const htmlGolden = generarCartaBancoTerceroHtml({
    trabajadorNombre: 'PEDRO PEREZ',
    trabajadorCedula: 'V-16.111.222',
    trabajadorCargo: 'OPERADOR DE EXCAVADORA',
    trabajadorDepartamento: 'OPERACIONES',
    trabajadorFicha: '0412',
    carta,
    opciones: OPCIONES_CARTA_BANCO_TERCERO_DEFECTO,
  });

  assert.equal(htmlGolden.includes('GOLDEN TOUCH 1127, C.A.'), true);
  assert.equal(htmlGolden.includes('<script>alert(1)</script>'), false);
  assert.equal(htmlGolden.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
  assert.equal(htmlGolden.includes('data:image/png;base64,FIRMA_TRABAJADOR'), true);
  assert.equal(htmlGolden.includes('HUELLA'), true);

  const htmlRecortado = generarCartaBancoTerceroHtml({
    trabajadorNombre: 'PEDRO PEREZ',
    trabajadorCedula: 'V-16.111.222',
    carta,
    opciones: {
      ...OPCIONES_CARTA_BANCO_TERCERO_DEFECTO,
      mostrarClausulaLiberacion: false,
      mostrarRecuadroHuella: false,
      mostrarFirmaTercero: false,
      mostrarTestigo: false,
      mostrarRecepcionRrhh: false,
    },
  });
  assert.equal(htmlRecortado.includes('Efecto liberatorio del pago'), false);
  assert.equal(htmlRecortado.includes('HUELLA DACTILAR'), false);
  assert.equal(htmlRecortado.includes('CONFORMIDAD DEL TITULAR DE LA CUENTA'), false);
  assert.equal(htmlRecortado.includes('TESTIGO / VERIFICACIÓN'), false);
  assert.equal(htmlRecortado.includes('Recibido y verificado en Nómina / RRHH por'), false);

  const htmlBlanco = generarCartaBancoTerceroHtml({
    trabajadorNombre: 'PEDRO PEREZ',
    trabajadorCedula: 'V-16.111.222',
    carta,
    opciones: {
      ...OPCIONES_CARTA_BANCO_TERCERO_DEFECTO,
      modoPlanillaEnBlanco: true,
    },
  });
  assert.equal(htmlBlanco.includes('AUTORIZACIÓN'), true);
  assert.equal(htmlBlanco.includes('19.888.777'), false);
});

await ok('5. nombreArchivoCartaBancoTercero genera nombres de archivo limpios para descarga', () => {
  const fn1 = nombreArchivoCartaBancoTercero('Juan Pérez', null, { modoPlanillaEnBlanco: false });
  assert.equal(fn1, 'Carta autorizacion banco tercero - Juan Pérez');
  const fn2 = nombreArchivoCartaBancoTercero(
    'Juan Pérez',
    { key: 'golden', chip: '✨ Golden Touch', nombre: 'GOLDEN TOUCH 1127, C.A.', cabecera: 'GOLDEN TOUCH 1127, C.A.', logo: '' },
    { modoPlanillaEnBlanco: false }
  );
  assert.equal(fn2, 'Carta autorizacion banco tercero - Juan Pérez - GOLDEN TOUCH 1127, C.A.');
  const fn3 = nombreArchivoCartaBancoTercero('Juan Pérez', null, { modoPlanillaEnBlanco: true });
  assert.equal(fn3, 'Carta autorizacion banco tercero - Planilla en blanco');
});

await ok('6. Integración con empleadosReporte.ts muestra el indicador de Tercero y parentesco en Datos bancarios', async () => {
  const habilidadesCode = `
  export function limpiarHabilidades(raw) {
    return Array.isArray(raw) ? raw : [];
  }
  `;
  const empReporteMod = await loadTsModule('src/lib/empleadosReporte.ts', {
    './empleadosHabilidades': habilidadesCode,
    './cartaBancoTercero': cartaCode,
  });

  const rep = empReporteMod.cuerpoReporteEmpleados({
    empleados: [
      {
        id: 'e1',
        first_name: 'CARLOS',
        last_name: 'RUIZ',
        cedula: 'V-18000111',
        cargo: 'OPERADOR',
        status: 'activo',
        bank_name: '0102 - BANCO DE VENEZUELA',
        bank_account: '01020000111122223333',
        bank_holder: 'ANA RUIZ',
        bank_cedula: 'V-20111222',
        carta_banco_tercero: {
          esTercero: true,
          titularNombre: 'ANA RUIZ',
          titularCedula: 'V-20111222',
          parentesco: 'Hermano(a)',
          bancoNombre: '0102 - BANCO DE VENEZUELA',
          numeroCuenta: '01020000111122223333',
          soportes: [{ id: 's1', url: 'https://example.com/doc.pdf', nombre: 'doc.pdf', tipo: 'pdf', fecha: '2026-11-13' }],
        },
      },
    ],
    opciones: {
      ...empReporteMod.OPCIONES_REPORTE_EMPLEADOS_DEFECTO,
      datosBancarios: true,
    },
    estadoTxt: 'Activos',
  });

  assert.equal(rep.body.includes('ANA RUIZ'), true);
  assert.equal(rep.body.includes('Hermano(a)'), true);
  assert.equal(rep.body.includes('TERCERO'), true);
});

await ok('7. Seguridad QR en EmployeeCardScreen.tsx mantiene los datos bancarios y el modal dentro de !isAnonSession', () => {
  const cardScreenSource = readFileSync(join(rootDir, 'src/screens/EmployeeCardScreen.tsx'), 'utf8');
  assert.equal(cardScreenSource.includes('CartaBancoTerceroModal'), true);
  assert.equal(cardScreenSource.includes('{!isAnonSession ? ('), true);
});

console.log(`\n✅ Todas las pruebas pasaron (${passed}/${passed}).`);
