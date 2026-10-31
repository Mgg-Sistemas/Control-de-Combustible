/**
 * Pruebas unitarias para:
 * 1. Identificación de Maquinaria y Vehículos en Combustible con Placa y Serial (`etiquetaEquipoCombustible`, `agruparLitrosPorMaquinaTop`).
 * 2. Eliminación / ocultamiento del registro "ajuste manual visible" / "ajuste visible" sin reponer en el tanque (`esAjusteManualVisibleLegado`, `esRegistroAjusteTanque`).
 * 3. Edición y ajuste directo de litros actuales en el tanque (`calcularDiferenciaAjusteTanque`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Mock react-native para evaluar src/lib/fuelRules.ts en Node
const customRequire = (id) => {
  if (id === 'react-native') {
    return { Linking: { canOpenURL: async () => true, openURL: async () => {} }, Platform: { OS: 'web' } };
  }
  return require(id);
};

const mod = { exports: {} };
new Function('exports', 'module', 'require', ts.transpileModule(
  leer('src/lib/fuelRules.ts'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } },
).outputText)(mod.exports, mod, customRequire);

const {
  MARCADOR_AJUSTE_TANQUE,
  esAjusteManualVisibleLegado,
  esRegistroAjusteTanque,
  etiquetaEquipoCombustible,
  agruparLitrosPorMaquinaTop,
  calcularDiferenciaAjusteTanque,
} = mod.exports;

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name + (extra ? ` → ${extra}` : ''));
  }
};

console.log('COMBUSTIBLE — Placa/Serial en gráficas y ajuste directo de tanques\n');

// 1. Maquinaria pesada sin placa pero con serial muestra siempre S/P y el Serial
{
  const jumbo1 = etiquetaEquipoCombustible({
    asset_kind: 'maquinaria',
    machinery_id: 'm-1',
    machine: { code: 'JUMBO CON MARTILLO', plate: null, serial: 'XUG0330A111' },
  });
  ok(
    'Maquinaria sin placa incluye S/P y el Serial en la etiqueta de gráfica',
    jumbo1.etiquetaGrafica.includes('JUMBO CON MARTILLO') &&
      jumbo1.etiquetaGrafica.includes('🚗 S/P') &&
      jumbo1.etiquetaGrafica.includes('🔢 XUG0330A111'),
    jumbo1.etiquetaGrafica
  );

  const autobus = etiquetaEquipoCombustible({
    asset_kind: 'maquinaria',
    machinery_id: 'm-2',
    machine: { code: 'AUTOBUS', plate: '08AAGFR', serial: 'BUS-9988' },
  });
  ok(
    'Maquinaria con placa y serial muestra ambos en la etiqueta',
    autobus.etiquetaGrafica.includes('🚗 08AAGFR') && autobus.etiquetaGrafica.includes('🔢 BUS-9988'),
    autobus.etiquetaGrafica
  );
}

// 2. Agrupación por máquina no mezcla dos JUMBO CON MARTILLO distintos y excluye ajustes
{
  const rows = [
    {
      id: 'd1',
      asset_kind: 'maquinaria',
      machinery_id: 'jumbo-a',
      liters: 1829,
      machine: { code: 'JUMBO CON MARTILLO', plate: '', serial: 'SN-001' },
    },
    {
      id: 'd2',
      asset_kind: 'maquinaria',
      machinery_id: 'jumbo-b',
      liters: 464,
      machine: { code: 'JUMBO CON MARTILLO', plate: '', serial: 'SN-002' },
    },
    {
      id: 'd3',
      asset_kind: 'maquinaria',
      machinery_id: 'jumbo-a',
      liters: 100,
      driver_operator: 'Ajuste manual visible',
      machine: { code: 'JUMBO CON MARTILLO', plate: '', serial: 'SN-001' },
    },
  ];
  const top = agruparLitrosPorMaquinaTop(rows);
  ok('Separa dos máquinas con el mismo código por su machinery_id y serial', top.length === 2, JSON.stringify(top));
  ok('Excluye el registro de ajuste manual visible del conteo de litros por máquina', top[0].value === 1829 && top[1].value === 464, JSON.stringify(top));
  ok('Cada barra incluye el serial correspondiente', top[0].label.includes('SN-001') && top[1].label.includes('SN-002'), JSON.stringify(top));
}

// 3. Detección de "ajuste manual visible" / "ajuste visible" y marcador de ajuste oculto
{
  ok('Detecta "ajuste manual visible" legado', esAjusteManualVisibleLegado({ driver_operator: 'Ajuste manual visible' }));
  ok('Detecta "ajuste visible" legado', esAjusteManualVisibleLegado({ justification: 'AJUSTE VISIBLE EN TANQUE' }));
  ok('Es considerado registro de ajuste de tanque', esRegistroAjusteTanque({ driver_operator: 'ajuste manual visible' }));
  ok('Detecta marcador de ajuste interno oculto', esRegistroAjusteTanque({ driver_operator: `${MARCADOR_AJUSTE_TANQUE} Ajuste directo` }));
  ok('Un consumo normal de operador NO es ajuste de tanque', !esRegistroAjusteTanque({ driver_operator: 'JUAN PEREZ', liters: 200 }));
}

// 4. Cálculo de ajuste de nivel de tanque
{
  const sub = calcularDiferenciaAjusteTanque(5000, 4200, 10000);
  ok('Calcula rebaja de litros en el tanque (-800 L)', sub.delta === -800 && sub.pctNuevo === 42 && !sub.sinCambio, JSON.stringify(sub));

  const add = calcularDiferenciaAjusteTanque(4200, 5500, 10000);
  ok('Calcula aumento de litros en el tanque (+1300 L)', add.delta === 1300 && add.pctNuevo === 55 && !add.sinCambio, JSON.stringify(add));
}

if (fail > 0) {
  console.error(`\n❌ ${fail} FALLO(S):`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
} else {
  console.log(`✅ ${pass} OK · 0 FALLOS`);
}
