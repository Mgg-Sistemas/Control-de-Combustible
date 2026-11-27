// ============================================================================
// Prueba unitaria: Nota de Salida con Cláusula de Compromiso (Almacén / EPP)
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const transpilar = (src) => ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const cargar = (rel, stubs = {}) => {
  const mod = { exports: {} };
  const req = (n) => { if (n in stubs) return stubs[n]; throw new Error(`import no previsto en ${rel}: ${n}`); };
  new Function('exports', 'module', 'require', transpilar(leer(rel)))(mod.exports, mod, req);
  return mod.exports;
};

const stubs = {
  './logoData': { LOGO_DATA_URI: 'data:image/png;base64,SOS' },
  './logoGoldenTouchData': { GOLDEN_TOUCH_LOGO_DATA_URI: 'data:image/png;base64,GT' },
  './logoRenaceData': { RENACE_LOGO_DATA_URI: 'data:image/png;base64,RENACE' },
  './logoJhenzaenData': { JHENZAEN_LOGO_DATA_URI: 'data:image/png;base64,JHEN' },
  './logoBcvData': { BCV_LOGO_DATA_URI: 'data:image/png;base64,BCV' },
  './company': { COMPANY_NAME: 'SOS La Guaira 2026' },
};

const { notaEntregaHtml } = cargar('src/lib/notaEntrega.ts', stubs);

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(name + (extra ? ` → ${extra}` : ''));
    console.log(`  ❌ ${name}${extra ? ` → ${extra}` : ''}`);
  }
};

console.log('--- Probando Nota de Salida con Cláusula de Compromiso ---');

// 1. Nota estándar sin compromiso
{
  const htmlStd = notaEntregaHtml({
    fecha: '27/11/2026',
    items: [{ name: 'BOMBONA DE OXÍGENO', qty: 1, unit: 'UND' }],
  });

  ok('Debe tener título NOTA DE SALIDA', htmlStd.includes('NOTA DE SALIDA'));
  ok('No debe tener cláusula de compromiso', !htmlStd.includes('CLÁUSULA DE COMPROMISO'));
  ok('Firma receptora estándar es RECIBIDO CONFORME', htmlStd.includes('RECIBIDO CONFORME'));
  ok('Subtítulo de firma receptor estándar', htmlStd.includes('Firma Receptor / Responsable'));
}

// 2. Nota con compromiso y custodia
{
  const htmlComp = notaEntregaHtml({
    fecha: '27/11/2026',
    items: [
      { name: 'BOTAS DE SEGURIDAD TALLA 42', qty: 1, unit: 'PAR' },
      { name: 'RESPIRADOR MEDIA CARA 3M', qty: 1, unit: 'UND' },
    ],
    empleados: ['JESUS RAMON VARGAS'],
    empleadosDetalle: [{ name: 'JESUS RAMON VARGAS', cedula: '6489375', cargo: 'OPERADOR' }],
    incluirActaCompromiso: true,
  });

  ok('Debe tener título compuesto NOTA DE SALIDA Y ACTA DE COMPROMISO', htmlComp.includes('NOTA DE SALIDA Y ACTA DE COMPROMISO'));
  ok('Debe tener subtítulo Asignación de Implementos, Custodia y Despacho', htmlComp.includes('Asignación de Implementos, Custodia y Despacho'));
  ok('Debe incluir la cláusula de compromiso', htmlComp.includes('CLÁUSULA DE COMPROMISO, CUSTODIA Y RESPONSABILIDAD (EPP / HERRAMIENTAS)'));
  ok('Debe contener numeral 1. Uso Exclusivo', htmlComp.includes('1. Uso Exclusivo:'));
  ok('Debe contener numeral 2. Custodia y Cuidado', htmlComp.includes('2. Custodia y Cuidado:'));
  ok('Debe contener numeral 3. Autorización Expresa de deducción', htmlComp.includes('3. Autorización Expresa:'));
  ok('Firma receptora debe ser RECIBIDO Y ACEPTADO', htmlComp.includes('RECIBIDO Y ACEPTADO'));
  ok('Subtítulo debe indicar Firma del Trabajador / Aceptación de Compromiso', htmlComp.includes('Firma del Trabajador / Aceptación de Compromiso'));
  ok('Firma emisora debe indicar Firma Emisor / Almacén', htmlComp.includes('Firma Emisor / Almacén'));
}

// 3. Cláusula personalizada
{
  const htmlCustom = notaEntregaHtml({
    fecha: '27/11/2026',
    items: [{ name: 'TALADRO PERCUTOR DEWALT', qty: 1, unit: 'UND' }],
    incluirActaCompromiso: true,
    textoClausulaCompromiso: 'El trabajador asume la custodia del taladro hasta el 30/11/2026.',
  });

  ok('Debe respetar texto personalizado de la cláusula', htmlCustom.includes('El trabajador asume la custodia del taladro hasta el 30/11/2026.'));
}

// 4. Integración en InventarioScreen
{
  const invCode = leer('src/screens/InventarioScreen.tsx');
  ok('InventarioScreen debe tener el estado incluirCompromiso', invCode.includes('incluirCompromiso'));
  ok('InventarioScreen debe importar y usar guardarActaCompromiso', invCode.includes('guardarActaCompromiso'));
  ok('InventarioScreen debe registrar el tag CON ACTA DE COMPROMISO para reimpresión', invCode.includes('CON ACTA DE COMPROMISO'));
}

console.log(`\nResultado: ${pass} pasaron, ${fail} fallaron.`);
if (fail > 0) {
  process.exit(1);
} else {
  console.log('🎉 Todas las pruebas pasaron exitosamente.');
}
