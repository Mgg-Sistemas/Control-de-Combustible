/*
 * 🧪 Prueba: ordenamiento del listado en el Reporte de Empleados (24-nov-2026)
 *
 *   node scripts/test-empleados-reporte-orden.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const cache = new Map();
function loadTs(filename) {
  const abs = path.resolve(filename);
  if (cache.has(abs)) return cache.get(abs).exports;
  const mod = { exports: {} };
  cache.set(abs, mod);
  const src = fs.readFileSync(abs, 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', out);
  const localReq = (id) => {
    if (id.startsWith('.')) {
      const base = path.resolve(path.dirname(abs), id);
      const target = fs.existsSync(`${base}.ts`) ? `${base}.ts` : fs.existsSync(`${base}.tsx`) ? `${base}.tsx` : base;
      if (target.endsWith('.ts') || target.endsWith('.tsx')) return loadTs(target);
    }
    return require(id);
  };
  fn(localReq, mod, mod.exports, abs, path.dirname(abs));
  return mod.exports;
}

const {
  ordenarEmpleadosReporte,
  cuerpoReporteEmpleados,
} = loadTs(path.join(ROOT, 'src/lib/empleadosReporte.ts'));

const srcScreen = fs.readFileSync(path.join(ROOT, 'src/screens/EmpleadosScreen.tsx'), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`✗ ${name}`);
  }
};

const sample = [
  { id: '1', first_name: 'CARLOS', last_name: 'ZAPATA', cargo: 'TESORERIA', department: 'FINANZAS', cedula: '20000000', ficha_number: '10', precio_mes: 800 },
  { id: '2', first_name: 'ANA', last_name: 'ALVAREZ', cargo: 'OBRERO', department: 'OPERACIONES', cedula: '10000000', ficha_number: '3', precio_mes: 400 },
  { id: '3', first_name: 'BEATRIZ', last_name: 'MENDEZ', cargo: 'ANALISTA DE COMPRA', department: 'ADMINISTRATIVO', cedula: '15000000', ficha_number: '1', precio_mes: 1200 },
];

ok('nombre_az ordena Ana, Beatriz, Carlos', ordenarEmpleadosReporte(sample, 'nombre_az').map((x) => x.id).join(',') === '2,3,1');
ok('nombre_za ordena Carlos, Beatriz, Ana', ordenarEmpleadosReporte(sample, 'nombre_za').map((x) => x.id).join(',') === '1,3,2');
ok('cargo_az ordena Analista, Obrero, Tesoreria', ordenarEmpleadosReporte(sample, 'cargo_az').map((x) => x.id).join(',') === '3,2,1');
ok('departamento_az ordena Administrativo, Finanzas, Operaciones', ordenarEmpleadosReporte(sample, 'departamento_az').map((x) => x.id).join(',') === '3,1,2');
ok('cedula ordena 10M, 15M, 20M', ordenarEmpleadosReporte(sample, 'cedula').map((x) => x.id).join(',') === '2,3,1');
ok('ficha ordena 1, 3, 10', ordenarEmpleadosReporte(sample, 'ficha').map((x) => x.id).join(',') === '3,2,1');
ok('salario_desc ordena 1200, 800, 400', ordenarEmpleadosReporte(sample, 'salario_desc').map((x) => x.id).join(',') === '3,1,2');

const { body } = cuerpoReporteEmpleados({
  empleados: sample,
  estadoTxt: 'Activos',
  empresaTxt: 'Todas',
  cargoTxt: 'Todos',
  opciones: { ordenarPor: 'cargo_az' },
});
const posBeatriz = body.indexOf('BEATRIZ MENDEZ');
const posAna = body.indexOf('ANA ALVAREZ');
const posCarlos = body.indexOf('CARLOS ZAPATA');
ok('cuerpoReporteEmpleados respeta cargo_az en la tabla HTML', posBeatriz > 0 && posBeatriz < posAna && posAna < posCarlos);

ok('EmpleadosScreen incluye selector ORDEN DEL LISTADO EN EL REPORTE', srcScreen.includes('ORDEN DEL LISTADO EN EL REPORTE'));
ok('EmpleadosScreen incluye opción Por Cargo (A → Z)', srcScreen.includes('🏷️ Por Cargo (A → Z)'));

console.log(`test-empleados-reporte-orden: ${pass} pasaron, ${fail} fallaron.`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
