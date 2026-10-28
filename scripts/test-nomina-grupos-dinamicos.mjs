import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const cache = new Map();
const loadTs = (srcPath) => {
  if (cache.has(srcPath)) return cache.get(srcPath);
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  cache.set(srcPath, m.exports);
  const origRequire = m.require.bind(m);
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(srcPath), `${id}.ts`)) : origRequire(id));
  m._compile(out, m.filename);
  cache.set(srcPath, m.exports);
  return m.exports;
};

const {
  DEFAULT_GRUPOS_APARTADOS,
  coincideGrupo,
  grupoApartado,
  pasaFiltroEstado,
  toggleFiltroEstado,
  etiquetaFiltrosEstado,
} = loadTs(path.join(ROOT, 'src/lib/nominaGrupos.ts'));

const {
  limpiarHabilidades,
  leerHabilidadesEmpleado,
  extraerMapaHabilidadesDeEmpresas,
} = loadTs(path.join(ROOT, 'src/lib/empleadosHabilidades.ts'));

const {
  cuerpoReporteEmpleados,
} = loadTs(path.join(ROOT, 'src/lib/empleadosReporte.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};

// 1. Grupos por defecto
eq('grupos por defecto son 2', DEFAULT_GRUPOS_APARTADOS.length, 2);
eq('primero es carbozulia', DEFAULT_GRUPOS_APARTADOS[0].id, 'carbozulia');
eq('segundo es seguridad', DEFAULT_GRUPOS_APARTADOS[1].id, 'seguridad');

// 2. Coincidencias de grupos personalizados
const gTaller = { id: 'taller', label: 'Taller', color: '#D97706', tipo: 'departamento', valor: 'TALLER' };
const gMecanico = { id: 'mecanicos', label: 'Mecánicos', color: '#059669', tipo: 'cargo', valor: 'MECANICO' };
const gLiscioni = { id: 'liscioni', label: 'Liscioni', color: '#2563EB', tipo: 'empresa', valor: 'liscioni' };

eq('coincide departamento taller', coincideGrupo(gTaller, null, null, 'TALLER CENTRAL'), true);
eq('no coincide departamento ajeno', coincideGrupo(gTaller, null, null, 'ADMINISTRACION'), false);

eq('coincide cargo mecanico', coincideGrupo(gMecanico, null, 'MECÁNICO DIESEL', null), true);
eq('no coincide cargo chofer', coincideGrupo(gMecanico, null, 'CHOFER', null), false);

eq('coincide empresa liscioni', coincideGrupo(gLiscioni, 'CONSTRUCCIONES LISCIONI C.A.', null, null), true);
eq('no coincide otra empresa', coincideGrupo(gLiscioni, 'SOS LA GUAIRA', null, null), false);

// 3. Resolución con grupos dinámicos
const listaGrupos = [...DEFAULT_GRUPOS_APARTADOS, gTaller, gMecanico, gLiscioni];

eq('resuelve carbozulia por defecto', grupoApartado('CARBOZULIA C.A.', 'CHOFER', null, listaGrupos), 'carbozulia');
eq('resuelve seguridad por defecto', grupoApartado('SOS LA GUAIRA', 'SEGURIDAD', null, listaGrupos), 'seguridad');
eq('resuelve taller por departamento', grupoApartado('SOS LA GUAIRA', 'OBRERO', 'TALLER', listaGrupos), 'taller');
eq('resuelve mecanico por cargo', grupoApartado('SOS LA GUAIRA', 'MECANICO', 'MANTENIMIENTO', listaGrupos), 'mecanicos');
eq('resuelve liscioni por empresa', grupoApartado('LISCIONI', 'ADMINISTRADOR', 'ADMINISTRACION', listaGrupos), 'liscioni');
eq('empleado comun sin grupo', grupoApartado('SOS LA GUAIRA', 'SECRETARIA', 'RRHH', listaGrupos), null);

// 4. Filtrado disjunto y completo
eq('taller en su pestaña', pasaFiltroEstado('taller', 'taller', 'activo'), true);
eq('taller FUERA de todos', pasaFiltroEstado('todos', 'taller', 'activo'), false);
eq('taller FUERA de activos', pasaFiltroEstado('activo', 'taller', 'activo'), false);
eq('normal en todos', pasaFiltroEstado('todos', null, 'activo'), true);
eq('normal en activos', pasaFiltroEstado('activo', null, 'activo'), true);
eq('normal NO en taller', pasaFiltroEstado('taller', null, 'activo'), false);

// 5. Selección MÚLTIPLE en Estado / Aparte
const selMulti = new Set(['activo', 'carbozulia', 'taller']);
eq('multi-select incluye activo general', pasaFiltroEstado(selMulti, null, 'activo'), true);
eq('multi-select excluye inactivo general', pasaFiltroEstado(selMulti, null, 'inactivo'), false);
eq('multi-select incluye carbozulia', pasaFiltroEstado(selMulti, 'carbozulia', 'inactivo'), true);
eq('multi-select incluye taller', pasaFiltroEstado(selMulti, 'taller', 'activo'), true);
eq('multi-select excluye seguridad', pasaFiltroEstado(selMulti, 'seguridad', 'activo'), false);

let st = new Set(['todos']);
st = toggleFiltroEstado(st, 'carbozulia');
eq('toggle desde todos a carbozulia', Array.from(st), ['carbozulia']);
st = toggleFiltroEstado(st, 'taller');
eq('toggle agrega taller', Array.from(st), ['carbozulia', 'taller']);
eq('etiqueta de multi-selección', etiquetaFiltrosEstado(st, listaGrupos), 'Carbozulia, Taller');
st = toggleFiltroEstado(st, 'carbozulia');
st = toggleFiltroEstado(st, 'taller');
eq('desmarcar todo vuelve a todos', Array.from(st), ['todos']);

// 6. Habilidades por empleado
eq(
  'limpia, mayúsculas y deduplica habilidades',
  limpiarHabilidades(['soldador', '  Operador de retro  ', 'SOLDADOR', '', 'mecánico diesel']),
  ['SOLDADOR', 'OPERADOR DE RETRO', 'MECÁNICO DIESEL']
);
const mapaRemoto = extraerMapaHabilidadesDeEmpresas([
  { id: '1', name: 'SOS LA GUAIRA' },
  { id: '2', name: '__nomina_habilidades__:{"emp-1":["soldador","electricista"]}' },
]);
eq(
  'lee habilidades desde mapa sincronizado',
  leerHabilidadesEmpleado({ id: 'emp-1' }, mapaRemoto),
  ['SOLDADOR', 'ELECTRICISTA']
);

// 7. Reporte modificable de empleados con habilidades
const repConHab = cuerpoReporteEmpleados({
  empleados: [
    {
      id: 'emp-1',
      first_name: 'ABRAHAM',
      last_name: 'ALONZO',
      cedula: '27904754',
      ficha_number: '0207',
      cargo: 'AUXILIAR',
      empresaNomina: 'SOS LA GUAIRA',
      status: 'activo',
      phone: '04143103426',
      habilidades: ['SOLDADOR', 'ELECTRICISTA'],
    },
  ],
  estadoTxt: 'Activos, Carbozulia',
  empresaTxt: 'Todas',
  cargoTxt: 'Todos los cargos',
});
eq('reporte por defecto incluye columna Habilidades', repConHab.body.includes('<th>Habilidades</th>'), true);
eq('reporte refleja las habilidades cargadas', repConHab.body.includes('SOLDADOR') && repConHab.body.includes('ELECTRICISTA'), true);

const repSinHabNiEmpresa = cuerpoReporteEmpleados({
  empleados: [
    {
      id: 'emp-1',
      first_name: 'ABRAHAM',
      last_name: 'ALONZO',
      cedula: '27904754',
      ficha_number: '0207',
      cargo: 'AUXILIAR',
      empresaNomina: 'SOS LA GUAIRA',
      status: 'activo',
      phone: '04143103426',
      habilidades: ['SOLDADOR'],
    },
  ],
  estadoTxt: 'Activos',
  empresaTxt: 'SOS LA GUAIRA',
  cargoTxt: 'Todos los cargos',
  opciones: { habilidades: false, empresa: false, resumenCargo: false },
});
eq('al apagar habilidades no sale en el reporte', repSinHabNiEmpresa.body.includes('SOLDADOR'), false);
eq('al apagar empresa no sale SOS LA GUAIRA', repSinHabNiEmpresa.body.includes('SOS LA GUAIRA'), false);
eq('al apagar resumenCargo no sale Resumen por cargo', repSinHabNiEmpresa.body.includes('Resumen por cargo'), false);

console.log('\n🏢  Grupos apartados dinámicos (Configurables por Empresa, Cargo y Departamento)');
console.log(`   ${pass} OK · ${fail} fallo(s)`);
if (fail) {
  console.log('\n' + failures.join('\n') + '\n');
  process.exit(1);
}
console.log('   ✅ Todo en verde\n');
