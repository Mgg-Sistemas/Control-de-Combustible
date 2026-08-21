/*
 * Test del BUSCADOR DE EMPLEADOS (21-ago-2026).
 *
 * QUÉ REPORTE CUBRE (textual del cliente):
 *   «ese buscador solo me deja buscar empresas, pero no me deja buscar a los
 *    empleados, o sea que solo funciona para el filtro de empresa nómina, pero
 *    no para buscar directamente el empleado por alguna información de su ficha»
 *
 * LO QUE BLINDA (`src/lib/empleadosBuscar.ts`):
 *   · ⭐ Se busca por CUALQUIER dato de la ficha, no solo por el nombre: cédula,
 *     número de ficha, cargo, departamento, grupo, teléfono, correo y titular de
 *     la cuenta. Esto es exactamente lo que el cliente decía que no podía hacer.
 *   · ⭐ Las palabras se buscan en CUALQUIER ORDEN: "perez juan" encuentra a
 *     JUAN PEREZ. Antes se comparaba la frase completa y no lo encontraba.
 *   · Se pueden CRUZAR campos: "obrero 0207" = cargo + ficha.
 *   · No importan mayúsculas ni tildes: "josé" encuentra a JOSE.
 *   · Las dos empresas (la real y la de filtro de nómina) siguen sirviendo para
 *     buscar — eso ya funcionaba y no se puede romper.
 *   · Una ficha a medio llenar se busca igual por lo poco que tenga.
 *
 * No usa framework de test (el repo no tiene): transpila el .ts en memoria con
 * el `typescript` ya instalado.
 *
 *   node scripts/test-empleados-buscar.mjs   (o: npm run test:all)
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

const cache = new Map();
function loadTs(abs) {
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

const { coincideEmpleado, textoBuscableEmpleado } = loadTs(path.join(ROOT, 'src/lib/empleadosBuscar.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const no = (name, cond) => eq(name, !!cond, false);

// Empleado de ejemplo, calcado del que sale en la captura del cliente.
const ABRAHAM = {
  first_name: 'ABRAHAM', last_name: 'ALONZO',
  cedula: '27904754', ficha_number: '0207',
  cargo: 'OBRERO (CALETERO)', department: 'OPERACIONES', grupo: 'ZONA 1',
  phone: '04143103426', email: 'abraham@ejemplo.com',
  bank_holder: 'ABRAHAM ALONZO', bank_account: '01020128410000311841',
};
const EMPRESAS = ['SOS LA GUAIRA', 'PRUEBA'];
const busca = (q) => coincideEmpleado(ABRAHAM, q, EMPRESAS);

// ── 1) ⭐ EL RECLAMO: buscar al empleado por datos de SU FICHA ─────────────
{
  ok('por nombre', busca('abraham'));
  ok('por apellido', busca('alonzo'));
  ok('por nombre y apellido', busca('abraham alonzo'));
  ok('⭐ por CÉDULA', busca('27904754'));
  ok('⭐ por parte de la cédula', busca('279047'));
  ok('⭐ por NÚMERO DE FICHA', busca('0207'));
  ok('⭐ por CARGO', busca('caletero'));
  ok('⭐ por DEPARTAMENTO', busca('operaciones'));
  ok('⭐ por GRUPO / zona', busca('zona 1'));
  ok('⭐ por TELÉFONO', busca('0414310'));
  ok('⭐ por CORREO', busca('abraham@ejemplo'));
  ok('⭐ por TITULAR de la cuenta', busca('alonzo'));
  ok('⭐ por N.° DE CUENTA', busca('01020128410000311841'));
}

// ── 2) ⭐ LAS PALABRAS, EN CUALQUIER ORDEN ────────────────────────────────
{
  ok('⭐ "perez juan" encuentra a "juan perez"', coincideEmpleado({ first_name: 'JUAN', last_name: 'PEREZ' }, 'perez juan'));
  ok('⭐ apellido primero', busca('alonzo abraham'));
  ok('⭐ cruza CARGO con FICHA', busca('obrero 0207'));
  ok('⭐ cruza NOMBRE con CÉDULA', busca('abraham 279'));
  ok('⭐ cruza EMPRESA con CARGO', busca('prueba caletero'));
  ok('espacios de más no estorban', busca('   abraham    alonzo   '));
}

// ── 3) LO QUE NO DEBE ENCONTRAR ───────────────────────────────────────────
{
  no('un nombre que no es', busca('rodriguez'));
  no('una cédula que no es', busca('99999999'));
  // Si UNA de las palabras no está, no coincide: si no, "abraham rodriguez"
  // devolvería a Abraham y parecería que el buscador ignora lo que escribes.
  no('⭐ basta que falle UNA palabra', busca('abraham rodriguez'));
  no('cargo de otro', busca('soldador'));
}

// ── 4) MAYÚSCULAS Y TILDES DAN IGUAL ──────────────────────────────────────
{
  const JOSE = { first_name: 'JOSÉ', last_name: 'PÉREZ NÚÑEZ' };
  ok('sin tildes encuentra al que las tiene', coincideEmpleado(JOSE, 'jose perez'));
  ok('con tildes también', coincideEmpleado(JOSE, 'josé pérez'));
  ok('en MAYÚSCULA', coincideEmpleado(JOSE, 'JOSE'));
  ok('mezclado', coincideEmpleado(JOSE, 'JoSé NuÑez'));
  // La ñ NO es una tilde: son apellidos distintos y no se deben confundir.
  no('⭐ "peña" NO encuentra a "pena"', coincideEmpleado({ last_name: 'PENA' }, 'peña'));
  ok('"peña" sí encuentra a PEÑA', coincideEmpleado({ last_name: 'PEÑA' }, 'peña'));
}

// ── 5) LAS EMPRESAS SIGUEN SIRVIENDO (no se puede romper lo que ya andaba) ─
{
  ok('por la empresa real', busca('sos la guaira'));
  ok('por la empresa de filtro de nómina', busca('prueba'));
  no('una empresa que no es', busca('golden touch'));
  // Sin empresas resueltas, el resto se sigue buscando igual.
  ok('sin empresas, el nombre sirve', coincideEmpleado(ABRAHAM, 'abraham'));
  no('sin empresas, la empresa ya no', coincideEmpleado(ABRAHAM, 'sos la guaira'));
}

// ── 6) BÚSQUEDA VACÍA = PASAN TODOS ───────────────────────────────────────
{
  ok('cadena vacía', busca(''));
  ok('solo espacios', busca('   '));
  ok('null', coincideEmpleado(ABRAHAM, null));
  ok('undefined', coincideEmpleado(ABRAHAM, undefined));
}

// ── 7) FICHAS A MEDIO LLENAR: no revienta y se busca por lo que haya ──────
{
  ok('solo nombre', coincideEmpleado({ first_name: 'MARIA' }, 'maria'));
  ok('ficha vacía con búsqueda vacía', coincideEmpleado({}, ''));
  no('ficha vacía con búsqueda', coincideEmpleado({}, 'algo'));
  ok('campos en null no revientan', coincideEmpleado({ first_name: 'ANA', last_name: null, cedula: null, cargo: undefined }, 'ana'));
  eq('el texto buscable ignora los vacíos', textoBuscableEmpleado({ first_name: 'ANA', last_name: null, cargo: '' }), 'ana');
}

// ── Resultado ─────────────────────────────────────────────────────────────
console.log(`\n🔎  Buscador de empleados`);
console.log(`   ${pass} OK · ${fail} fallo(s)`);
if (fail) {
  console.log(`\n${failures.join('\n')}\n`);
  process.exit(1);
}
console.log('   ✅ Todo en verde\n');
