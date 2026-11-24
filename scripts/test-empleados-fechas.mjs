/*
 * 📅 FILTRO POR FECHA DE INGRESO + FECHA DE EGRESO (TRABAJÓ HASTA) EN EMPLEADOS (24-nov-2026).
 *
 *   node scripts/test-empleados-fechas.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'react-native') return { Platform: { OS: 'web' } };
  if (request === 'expo-print' || request === 'expo-sharing') return {};
  return origLoad.call(this, request, parent, isMain);
};

require.extensions['.ts'] = (m, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  m._compile(out, filename);
};

const {
  pasaFiltroFechaIngreso,
  cuerpoReporteEmpleados,
  contarColumnasActivasEmpleados,
  OPCIONES_REPORTE_EMPLEADOS_DEFECTO,
} = require(path.join(ROOT, 'src/lib/empleadosReporte.ts'));
const { fichaEmpleadoHtml } = require(path.join(ROOT, 'src/lib/ficha.ts'));

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

// 1. pasaFiltroFechaIngreso
eq('sin filtro pasan todos incluso null', pasaFiltroFechaIngreso(null, '', ''), true);
eq('con desde excluye null', pasaFiltroFechaIngreso(null, '2026-01-01', ''), false);
eq('con desde excluye anterior', pasaFiltroFechaIngreso('2025-12-31', '2026-01-01', ''), false);
eq('con desde incluye igual', pasaFiltroFechaIngreso('2026-01-01', '2026-01-01', ''), true);
eq('con rango incluye medio', pasaFiltroFechaIngreso('2026-05-15', '2026-01-01', '2026-12-31'), true);
eq('con rango excluye posterior', pasaFiltroFechaIngreso('2027-01-01', '2026-01-01', '2026-12-31'), false);

// 2. Columnas fechaIngreso y fechaEgreso en reporte PDF
eq('por defecto fechaIngreso y fechaEgreso nacen false',
  [OPCIONES_REPORTE_EMPLEADOS_DEFECTO.fechaIngreso, OPCIONES_REPORTE_EMPLEADOS_DEFECTO.fechaEgreso],
  [false, false]);
eq('contarColumnasActivasEmpleados suma fechaIngreso y fechaEgreso',
  contarColumnasActivasEmpleados({ ...OPCIONES_REPORTE_EMPLEADOS_DEFECTO, fechaIngreso: true, fechaEgreso: true }) -
    contarColumnasActivasEmpleados(OPCIONES_REPORTE_EMPLEADOS_DEFECTO),
  2);

const rep = cuerpoReporteEmpleados({
  empleados: [
    {
      id: 'e1',
      first_name: 'Maria',
      last_name: 'Gomez',
      status: 'inactivo',
      hire_date: '2026-03-10',
      fecha_egreso: '2026-11-20',
    },
  ],
  estadoTxt: 'Inactivos',
  empresaTxt: 'Todas',
  cargoTxt: 'Todos',
  fechaIngresoTxt: 'Desde 01/03/2026',
  opciones: { ...OPCIONES_REPORTE_EMPLEADOS_DEFECTO, fechaIngreso: true, fechaEgreso: true },
});
ok('reporte incluye columna Ingreso', rep.body.includes('>Ingreso<'));
ok('reporte incluye columna Trabajó hasta', rep.body.includes('>Trabajó hasta<'));
ok('reporte formatea hire_date 10/03/2026', rep.body.includes('10/03/2026'));
ok('reporte formatea fecha_egreso 20/11/2026', rep.body.includes('20/11/2026'));
ok('reporte incluye fechaIngresoTxt en cabecera', rep.body.includes('Desde 01/03/2026'));

// 3. Ficha técnica incluye fecha hasta cuando trabajó
const ficha = fichaEmpleadoHtml({
  id: 'e1',
  first_name: 'Maria',
  last_name: 'Gomez',
  status: 'inactivo',
  hire_date: '2026-03-10',
  fecha_egreso: '2026-11-20',
});
ok('ficha incluye etiqueta Fecha hasta cuando trabajó', ficha.includes('Fecha hasta cuando trabajó'));
ok('ficha incluye fecha 20/11/2026', ficha.includes('20/11/2026'));

// 4. Integración en EmpleadosScreen.tsx
const srcScreen = fs.readFileSync(path.join(ROOT, 'src/screens/EmpleadosScreen.tsx'), 'utf8');
ok('EmpleadosScreen usa pasaFiltroFechaIngreso', /pasaFiltroFechaIngreso/.test(srcScreen));
ok('EmpleadosScreen tiene modal inactivarTarget', /inactivarTarget/.test(srcScreen));
ok('EmpleadosScreen tiene toggle fechaIngreso y fechaEgreso', /'fechaIngreso'/.test(srcScreen) && /'fechaEgreso'/.test(srcScreen));

console.log(`test-empleados-fechas: ${pass} pasaron, ${fail} fallaron.`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
