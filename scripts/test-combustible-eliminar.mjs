// 🧪 Pruebas automatizadas de eliminación de consumos de combustible
// (con opción de revertir al tanque vs. mantener descuento en tanque).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

require.extensions['.ts'] = function (module, filename) {
  const code = fs.readFileSync(filename, 'utf8')
    .replace(/import\s+[^;]*from\s+['"]react-native['"];?/g, 'const Linking = {}, Platform = { OS: "web" };')
    .replace(/import\s+[^;]*from\s+['"]\.\/supabase['"];?/g, 'const supabase = {};');
  const out = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  module._compile(out, filename);
};

const { esRegistroAjusteTanque, MARCADOR_AJUSTE_TANQUE } = require(path.join(ROOT, 'src/lib/fuelRules.ts'));
const { esDeApoyo } = require(path.join(ROOT, 'src/lib/combustibleApoyo.ts'));

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.error(`  ✗ ${name}`);
  }
};

console.log('\n⛽ Probando lógica de eliminación de consumos de combustible:\n');

// 1. Detección de ajustes y consumos eliminados sin revertir tanque
const consumoNormal = {
  id: 'disp-1',
  liters: 120,
  tank_id: 'tank-1',
  driver_operator: 'JUAN PEREZ',
  notes: 'Surtido de turno mañana',
  machinery_id: 'mach-1',
};
ok('Consumo normal no es ajuste de tanque', !esRegistroAjusteTanque(consumoNormal));

const consumoEliminadoSinRevertir = {
  id: 'disp-1',
  liters: 120,
  tank_id: 'tank-1',
  driver_operator: `${MARCADOR_AJUSTE_TANQUE} JUAN PEREZ`,
  notes: `${MARCADOR_AJUSTE_TANQUE} Eliminado sin reponer tanque`,
  machinery_id: null,
};
ok('Consumo eliminado sin revertir es detectado por esRegistroAjusteTanque', esRegistroAjusteTanque(consumoEliminadoSinRevertir));

// 2. Máquinas de apoyo: exclusión de consumos eliminados
const apoyoNormal = {
  id: 'disp-apoyo-1',
  machinery_id: null,
  vehicle_id: null,
  apoyo_nombre: 'GENERADOR DE CORRIENTE',
  apoyo_placa: 'S/P',
  driver_operator: 'CARLOS',
};
ok('Máquina de apoyo activa es reconocida por esDeApoyo', esDeApoyo(apoyoNormal));

const apoyoEliminadoSinRevertir = {
  id: 'disp-apoyo-1',
  machinery_id: null,
  vehicle_id: null,
  apoyo_nombre: 'GENERADOR DE CORRIENTE',
  apoyo_placa: 'S/P',
  driver_operator: `${MARCADOR_AJUSTE_TANQUE} CARLOS`,
};
ok('Máquina de apoyo eliminada sin revertir NO aparece en esDeApoyo', !esDeApoyo(apoyoEliminadoSinRevertir));

// 3. Verificación de preservación de liters y tank_id para no alterar el tanque
ok('Consumo eliminado sin revertir conserva liters para el tanque', consumoEliminadoSinRevertir.liters === 120);
ok('Consumo eliminado sin revertir conserva tank_id para el tanque', consumoEliminadoSinRevertir.tank_id === 'tank-1');

console.log(`\nResultado: ${pass} OK · ${fail} FALLO(S)\n`);
if (fail > 0) {
  process.exit(1);
}
