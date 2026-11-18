// 🧪 Pruebas automatizadas de mensajes de WhatsApp de Compras y Cuentas (18-nov-2026)
// Verifica:
// 1. Cero duplicación de cuentas bancarias/PM/Binance en resumenBancoEnLinea (caso ATLANTA'S CENTRO FERRETERO).
// 2. Separación visual (\n\n) entre órdenes, bloques y sub-proveedores en:
//    - construirMensajeCuentas
//    - construirListaTesoreriaCuentas
//    - construirResumenDecisionCuentas
//    - textoWhatsappReporteCuentas
// 3. Prorrateo correcto de multi-proveedor en textoWhatsappReporteCuentas cuando hay abonos parciales.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cuenta-mensaje-'));

function transpile(rel) {
  const abs = path.join(ROOT, rel);
  let src = fs.readFileSync(abs, 'utf8')
    .replace(/import\s+\{[^}]*\}\s+from\s+['"]\.\/pdf['"];?/g, 'const miles = (n) => Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); const pdfDocument = () => "";')
    .replace(/import\s+\{[^}]*\}\s+from\s+['"]\.\/planPago['"];?/g, 'const lineaParte = () => "Parte";')
    .replace(/from\s+['"]\.\/([^'"]+)['"]/g, "from './$1.mjs'");
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const dest = path.join(TMP, path.basename(rel, '.ts') + '.mjs');
  fs.writeFileSync(dest, out, 'utf8');
  return dest;
}

transpile('src/lib/cuentasEmpresa.ts');
transpile('src/lib/cuentaPagoResuelto.ts');
const msgMod = await import(pathToFileURL(transpile('src/lib/cuentaMensaje.ts')).href);
const repMod = await import(pathToFileURL(transpile('src/lib/cuentasReporte.ts')).href);

const {
  resumenBancoEnLinea,
  construirMensajeCuentas,
  construirListaTesoreriaCuentas,
  construirResumenDecisionCuentas,
} = msgMod;
const { textoWhatsappReporteCuentas, OPCIONES_CUENTAS_POR_DEFECTO } = repMod;

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
};

console.log('\n💬 Probando formato y no-duplicación de mensajes WhatsApp de Compras/Cuentas:\n');

// 1. Cero duplicación en resumenBancoEnLinea (caso exacto reportado en captura)
const bancoEjemplo = {
  banco: 'banesco',
  numeroCuenta: '01340497634971019382',
  titular: "ATLANTA'S CENTRO FERRETERO",
  rifTitular: 'J-313350249',
  pagoMovilBanco: 'Banco Nacional de Crédito',
  pagoMovilTelefono: '04223081801',
  pagoMovilCedulaRif: 'J501971196',
};
const pagoTextoDuplicado = "🏦 banesco Cta: 01340497634971019382 (ATLANTA'S CENTRO FERRETERO J-313350249) · 📱 PM: Banco Nacional de Crédito 04223081801 (J501971196)";
const resLinea = resumenBancoEnLinea(bancoEjemplo, pagoTextoDuplicado, 'CONTADO', true);
const ocurrenciasCta = (resLinea.match(/01340497634971019382/g) || []).length;
const ocurrenciasPm = (resLinea.match(/04223081801/g) || []).length;
ok('resumenBancoEnLinea NO duplica el número de cuenta bancaria', ocurrenciasCta === 1);
ok('resumenBancoEnLinea NO duplica el teléfono de Pago Móvil', ocurrenciasPm === 1);
ok('resumenBancoEnLinea omite condiciones cuando omitirCondiciones=true', !resLinea.includes('CONTADO'));

// 2. Datos de prueba multi-proveedor para los 4 generadores
const cuentasPrueba = [
  {
    orden: 'REQ-0307',
    empresa: 'GOLDEN TOUCH 1127 CA',
    proveedor: '2 PROVEEDORES',
    detalle: 'cemento, yeso, pintura',
    solicita: 'CDT',
    autorizo: 'JESUS LOZADA',
    condiciones: 'CONTADO',
    totalUsd: 1194.58,
    saldoUsd: 1194.58,
    totalBs: 1095011.76,
    tasaBs: 916.65,
    prioridad: 'alta',
    desgloseProveedores: [
      {
        proveedor: "ATLANTA'S CENTRO FERRETERO",
        totalUsd: 1086.53,
        totalBs: 995967.72,
        pago: "🏦 banesco Cta: 01340497634971019382 (ATLANTA'S CENTRO FERRETERO J-313350249)",
        banco: {
          banco: 'banesco',
          numeroCuenta: '01340497634971019382',
          titular: "ATLANTA'S CENTRO FERRETERO",
          rifTitular: 'J-313350249',
        },
      },
      {
        proveedor: 'Aluminiologo',
        totalUsd: 108.05,
        totalBs: 99044.03,
        pago: '🏦 Banco Nacional de Crédito Cta: 01910050202150098018',
        banco: {
          banco: 'Banco Nacional de Crédito',
          numeroCuenta: '01910050202150098018',
        },
      },
    ],
  },
  {
    orden: 'REQ-0308',
    empresa: 'GOLDEN TOUCH 1127 CA',
    proveedor: 'FERRETERÍA EL SOL',
    totalUsd: 250,
    saldoUsd: 250,
    condiciones: 'CONTADO',
  },
];

// 3. Lista Tesorería WS
const msgTes = construirListaTesoreriaCuentas(cuentasPrueba, {
  incluirDetalle: true,
  incluirPersonas: true,
  incluirCondiciones: true,
  incluirBs: true,
  incluirDesgloseProveedores: true,
  incluirMetodosPago: true,
});
ok('Lista Tesorería separa Desglose con \\n\\n', msgTes.includes('\n\n   💳 *Desglose por proveedor'));
ok('Lista Tesorería separa 1.1 y 1.2 con \\n\\n', msgTes.includes('\n\n   • 1.2'));
ok('Lista Tesorería separa cuenta 1 y cuenta 2 con \\n\\n', msgTes.includes('\n\n2. 🔻'));
ok('Lista Tesorería NO duplica la cuenta 01340497634971019382', (msgTes.match(/01340497634971019382/g) || []).length === 1);

// 4. Resumen Decisión
const msgDec = construirResumenDecisionCuentas(cuentasPrueba, {}, {
  incluirDetalle: true,
  incluirPersonas: true,
  incluirCondiciones: true,
  incluirBs: true,
});
ok('Resumen Decisión separa 1.1 y 1.2 con \\n\\n', msgDec.includes('\n\n   • 1.2'));
ok('Resumen Decisión separa cuenta 1 y cuenta 2 con \\n\\n', msgDec.includes('\n\n2. 🔹'));
ok('Resumen Decisión NO duplica la cuenta 01340497634971019382', (msgDec.match(/01340497634971019382/g) || []).length === 1);

// 5. Ficha individual / múltiple
const msgFicha = construirMensajeCuentas([cuentasPrueba[0]], {
  detalle: true,
  personas: true,
  condiciones: true,
  bs: true,
  banco: true,
  empresa: true,
});
ok('Ficha separa encabezado de Total con \\n\\n', msgFicha.includes('\n\n💵 *Total:*'));
ok('Ficha separa proveedor 1) y 2) en multi-proveedor con \\n\\n', msgFicha.includes('\n\n2) 🏭'));
ok('Ficha separa cierre de empresa con \\n\\n', msgFicha.includes('\n\n🏢 *GOLDEN TOUCH 1127 CA*'));

// 6. textoWhatsappReporteCuentas: separación y prorrateo de abono parcial
const cuentaParcial = {
  id: 'c1',
  tipo: 'por_pagar',
  contraparte: '2 PROVEEDORES',
  empresaNombre: 'GOLDEN TOUCH 1127 CA',
  concepto: 'Materiales',
  documento: 'REQ-99',
  monto: 1000,
  abonado: 500,
  saldo: 500,
  situacion: 'pendiente',
  fecha_emision: '2026-11-18',
  desgloseProveedores: [
    { proveedor: 'PROV A', totalUsd: 600, totalBs: 6000, pago: 'Cta A' },
    { proveedor: 'PROV B', totalUsd: 400, totalBs: 4000, pago: 'Cta B' },
  ],
};
const cuenta2 = {
  id: 'c2',
  tipo: 'por_pagar',
  contraparte: 'PROV C',
  empresaNombre: 'GOLDEN TOUCH 1127 CA',
  concepto: 'Aceite',
  documento: 'REQ-100',
  monto: 200,
  abonado: 0,
  saldo: 200,
  situacion: 'pendiente',
  fecha_emision: '2026-11-18',
};
const msgRep = textoWhatsappReporteCuentas({
  tipo: 'por_pagar',
  cuentas: [cuentaParcial, cuenta2],
  op: OPCIONES_CUENTAS_POR_DEFECTO,
  tasaBcv: 10,
  hoyISO: '2026-11-18',
  filtrado: false,
});
ok('textoWhatsappReporteCuentas separa sub-proveedores 1.1 y 1.2 con \\n\\n', msgRep.includes('\n\n   1.2'));
ok('textoWhatsappReporteCuentas separa cuenta 1 y cuenta 2 con \\n\\n', msgRep.includes('\n\n2. '));
ok('textoWhatsappReporteCuentas prorratea PROV A al 50% (300 USD en vez de 600)', msgRep.includes('PROV A* — *USD 300,00*'));
ok('textoWhatsappReporteCuentas prorratea PROV B al 50% (200 USD en vez de 400)', msgRep.includes('PROV B* — *USD 200,00*'));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nResultado: ${pass} OK · ${fail} FALLO(S)\n`);
if (fail > 0) process.exit(1);
