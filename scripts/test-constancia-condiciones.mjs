// ============================================================================
// Prueba unitaria: Constancia de Trabajo con Declaraciones y Condiciones Opcionales
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

const { constanciaTrabajoHtml } = cargar('src/lib/constancia.ts', stubs);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ` → ${extra}` : ''}`);
  }
};

console.log('--- Probando Constancia de Trabajo con Declaraciones y Condiciones ---');

// 1. Constancia estándar sin condiciones (para bancos)
{
  const htmlStd = constanciaTrabajoHtml({
    fullName: 'JESUS RAMON VARGAS',
    cedula: '6489375',
    cargo: 'OPERADOR DE MAQUINARIA',
    hireDate: '2026-06-26',
    montoQuincenal: '$945,00',
  });

  ok('Debe tener título Constancia de Trabajo', htmlStd.includes('<h1>Constancia de Trabajo</h1>'));
  ok('Debe contener nombre y cédula', htmlStd.includes('JESUS RAMON VARGAS') && htmlStd.includes('6489375'));
  ok('Debe contener monto quincenal cuando se indica', htmlStd.includes('$945,00'));
  ok('No debe contener declaraciones ni condiciones', !htmlStd.includes('Declaraciones y condiciones del servicio'));
  ok('No debe contener firma del colaborador', !htmlStd.includes('Firma del Colaborador'));
  ok('Debe tener firma de Jefa de Administración centrada', htmlStd.includes('Jefa de Administración') && htmlStd.includes('firma-final'));
}

// 2. Constancia con condiciones activadas
{
  const htmlCond = constanciaTrabajoHtml({
    fullName: 'JESUS RAMON VARGAS',
    cedula: '6489375',
    cargo: 'OPERADOR DE MAQUINARIA',
    hireDate: '2026-06-26',
    montoQuincenal: '$945,00',
    incluirCondiciones: true,
  });

  ok('Debe contener sección de Declaraciones y condiciones del servicio', htmlCond.includes('Declaraciones y condiciones del servicio'));
  ok('Debe contener numeral 1 Modalidad de pago a destajo', htmlCond.includes('<b>Modalidad de pago a destajo:</b>'));
  ok('Debe contener numeral 2 Cálculo de la remuneración', htmlCond.includes('<b>Cálculo de la remuneración:</b>'));
  ok('Debe contener numeral 3 Uso del carnet', htmlCond.includes('<b>Uso del carnet:</b>'));
  ok('Debe contener texto de leído y firmado', htmlCond.includes('Leído y firmado en señal de total conformidad por el colaborador:'));
  ok('Debe tener grid de doble firma (firmas-grid)', htmlCond.includes('firmas-grid'));
  ok('Debe contener firma de Jefa de Administración', htmlCond.includes('Jefa de Administración'));
  ok('Debe contener firma del Colaborador con nombre y cédula', htmlCond.includes('Firma del Colaborador') && htmlCond.includes('6489375'));
}

// 3. Constancia con condiciones pero sin monto
{
  const htmlSinMonto = constanciaTrabajoHtml({
    fullName: 'PEDRO PEREZ',
    cedula: '12345678',
    cargo: 'MECANICO',
    hireDate: '2026-01-15',
    incluirCondiciones: true,
  });

  ok('No debe mencionar remuneración quincenal si no se pasa monto', !htmlSinMonto.includes('devenga una remuneración'));
  ok('Debe tener las condiciones y la firma del colaborador', htmlSinMonto.includes('Declaraciones y condiciones del servicio') && htmlSinMonto.includes('Firma del Colaborador'));
}

// 4. Cláusula personalizada
{
  const htmlCustom = constanciaTrabajoHtml({
    fullName: 'PEDRO PEREZ',
    cedula: '12345678',
    incluirCondiciones: true,
    textoCondiciones: 'Condiciones especiales acordadas para obra específica.',
  });

  ok('Debe permitir texto personalizado de condiciones', htmlCustom.includes('Condiciones especiales acordadas para obra específica.'));
}

// 5. Integración en EmpleadosScreen
{
  const empCode = leer('src/screens/EmpleadosScreen.tsx');
  ok('EmpleadosScreen debe tener el estado constanciaConCondiciones', empCode.includes('constanciaConCondiciones'));
  ok('EmpleadosScreen debe pasar incluirCondiciones a imprimirConstanciaTrabajo', empCode.includes('incluirCondiciones: conCondiciones'));
  ok('EmpleadosScreen debe incluir el botón/casilla interactiva', empCode.includes('🤝 Incluir declaraciones y condiciones del servicio'));
}

console.log(`\nResultado: ${pass} pasaron, ${fail} fallaron.`);
if (fail > 0) {
  process.exit(1);
} else {
  console.log('🎉 Todas las pruebas de Constancia con Condiciones pasaron exitosamente.');
}
