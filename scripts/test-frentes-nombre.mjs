// ⛏️ EL MISMO FRENTE, ESCRITO DE VARIAS MANERAS (21-oct-2026).
//
// Pedido: «me salen repetidos, acomoda los nombres para que se junten todos…
// o haz lo que consideres correcto sin que se pierda la información».
//
// Los casos de abajo NO son inventados: son los nombres REALES de los dos
// catálogos (viaje_frentes / maquinaria_frentes) y de los `frente_nombre`
// congelados en los viajes, leídos de la base el 21-oct-2026.
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
const loadTs = (p) => {
  if (cache.has(p)) return cache.get(p);
  const out = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cache.set(p, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(p), `${id}.ts`)) : orig(id));
  m._compile(out, p);
  cache.set(p, m.exports);
  return m.exports;
};

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const F = loadTs(path.join(ROOT, 'src/lib/frentesNombre.ts'));

console.log('\n⛏️  EL MISMO FRENTE, ESCRITO DE VARIAS MANERAS\n');

// ── 1) La clave: lo que no distingue un frente, no cuenta ───────────────────
ok('⭐⭐ «RES. CORAL» y «RESIDENCIAS CORAL» son la misma clave',
  F.claveFrente('RES. CORAL') === F.claveFrente('RESIDENCIAS CORAL')
  && F.claveFrente('Res. coral') === F.claveFrente('RESIDENCIAS CORAL'));
ok('⭐ «RESIDENCIA LA ESTRELLA» = «RES. LA ESTRELLA»',
  F.claveFrente('RES. LA ESTRELLA') === F.claveFrente('RESIDENCIA LA ESTRELLA'));
ok('⭐ el apóstrofe raro no parte un nombre (EDUARD´S = EDUARD\'S)',
  F.claveFrente('HOTEL EDUARD´S') === F.claveFrente("HOTEL EDUARD'S"));
ok('* acentos, puntos y espacios de más no cuentan',
  F.claveFrente('  Residencia   Breogán. ') === F.claveFrente('RES BREOGAN'));
ok('* el & se lee «y»', F.claveFrente('SUITES & RESORTS') === F.claveFrente('SUITES Y RESORTS'));
// Lo que SÍ distingue sigue distinguiendo.
ok('⭐⭐ frentes DISTINTOS siguen distintos (coral, coral mar, coral park…)',
  new Set(['RESIDENCIAS CORAL', 'RESIDENCIA CORAL MAR', 'RESIDENCIA CORAL PARK', 'RESIDENCIA CORAL PLAZA']
    .map(F.claveFrente)).size === 4);

// ── 2) Los nombres REALES del sistema (21-oct-2026) ─────────────────────────
// Izquierda: lo congelado en los viajes. Derecha: el catálogo de maquinaria.
// Lo CONGELADO en cada viaje (camion_viajes.frente_nombre): el nombre que vio
// el listero ese día. No se puede cambiar: es historia.
const CONGELADOS = [
  'RES. BAHIA MAR', 'Res. coral', 'RES. CORAL BEACH', 'res. coral bella', 'res. coral mar',
  'RES. CORAL PARK', 'coral garden', 'coral plaza', 'RES. LA ESTRELLA', 'res. rita sol',
  'Res. Breogan', 'Res. costa brava', 'HOTEL EDUARD´S', 'mil ceramica', 'quinta paula',
  'INVERSIONES MISJES 200', 'colegio emilio sterling', 'cdt playa escondida al cdf santa eduvigis',
];
// Los dos CATÁLOGOS (viaje_frentes + maquinaria_frentes): frentes de verdad.
const CATALOGO = [
  'RESIDENCIAS BAHIA MAR', 'RESIDENCIAS CORAL', 'RESIDENCIAS CORAL BEACH', 'resIDENCIA coral bella',
  'RESIDENCIA CORAL MAR', 'RESIDENCIA CORAL PARK', 'RESIDENCIA CORAL GARDEN', 'RESIDENCIA CORAL PLAZA',
  'RESIDENCIA LA ESTRELLA', 'RESIDENCIA RITA SOL PALACE', 'residencia breogan', 'ResIDENCIAS costa brava',
  "Hotel Eduard's Suites & Resorts", 'cdt playa escondida', 'cdf santa eduvigis - oeste',
  'Complejo Educativo Emilio Gimón Sterling', 'quinta deltana', 'quinta tamales', 'NAIGUATA',
  'CDT PLAYA ESCONDIDA', 'cdt playa escondida al cdf santa eduvigis', 'mil ceramica', 'quinta paula',
  'INVERSIONES MISJES 200', 'colegio emilio sterling', 'CERAMICA LA PASTORA', 'coliseo',
];
const REALES = [...CONGELADOS, ...CATALOGO];
const idx = F.indiceFrentes(REALES, CATALOGO);
const juntos = (a, b) => idx.clave(a) === idx.clave(b);

eq('⭐⭐ los nueve pares que el papel repetía quedan en UNO solo',
  [
    juntos('RES. BAHIA MAR', 'RESIDENCIAS BAHIA MAR'),
    juntos('Res. coral', 'RESIDENCIAS CORAL'),
    juntos('RES. CORAL BEACH', 'RESIDENCIAS CORAL BEACH'),
    juntos('res. coral bella', 'resIDENCIA coral bella'),
    juntos('res. coral mar', 'RESIDENCIA CORAL MAR'),
    juntos('RES. CORAL PARK', 'RESIDENCIA CORAL PARK'),
    juntos('RES. LA ESTRELLA', 'RESIDENCIA LA ESTRELLA'),
    juntos('Res. Breogan', 'residencia breogan'),
    juntos('Res. costa brava', 'ResIDENCIAS costa brava'),
  ], [true, true, true, true, true, true, true, true, true]);

eq('⭐⭐ y los que solo se adivinan por contexto también (falta el tipo o el apellido)',
  [
    juntos('coral garden', 'RESIDENCIA CORAL GARDEN'),   // le faltaba «RESIDENCIA»
    juntos('coral plaza', 'RESIDENCIA CORAL PLAZA'),
    juntos('res. rita sol', 'RESIDENCIA RITA SOL PALACE'), // le faltaba «PALACE»
    juntos('HOTEL EDUARD´S', "Hotel Eduard's Suites & Resorts"),
  ], [true, true, true, true]);

// ⚠️ LO QUE NO SE JUNTA, Y ESTÁ BIEN QUE NO SE JUNTE.
eq('⭐⭐ NO se traga frentes parecidos: coral ≠ coral mar ≠ coral park ≠ coral beach',
  [
    juntos('RESIDENCIAS CORAL', 'RESIDENCIA CORAL MAR'),
    juntos('RESIDENCIAS CORAL', 'RESIDENCIA CORAL PARK'),
    juntos('RESIDENCIAS CORAL BEACH', 'RESIDENCIA CORAL GARDEN'),
  ], [false, false, false]);
ok('⭐⭐ un TRAMO no es el sitio: «playa escondida» ≠ «playa escondida AL cdf santa eduvigis»',
  !juntos('cdt playa escondida', 'cdt playa escondida al cdf santa eduvigis'));
ok('* dos quintas distintas no se juntan', !juntos('quinta deltana', 'quinta tamales'));
ok('* un nombre que nadie más usa se queda como está',
  idx.nombre('INVERSIONES MISJES 200') === 'INVERSIONES MISJES 200'
  && idx.nombre('NAIGUATA') === 'NAIGUATA');

// ⭐⭐ LA PROTECCIÓN DEL CATÁLOGO: un frente que EXISTE nunca se absorbe.
{
  // Sin la protección, «RESIDENCIAS CORAL» (único candidato en una lista corta)
  // se habría ido dentro de «RESIDENCIA CORAL MAR» y habría sumado toneladas
  // de otro frente. Con el catálogo delante, cada uno se queda donde está.
  const cat = ['RESIDENCIAS CORAL', 'RESIDENCIA CORAL MAR'];
  const i2 = F.indiceFrentes(['RES. CORAL', 'RESIDENCIA CORAL MAR', 'RESIDENCIAS CORAL'], cat);
  ok('⭐⭐ un frente del catálogo NO se absorbe dentro de otro parecido',
    i2.clave('RESIDENCIAS CORAL') !== i2.clave('RESIDENCIA CORAL MAR')
    && i2.clave('RES. CORAL') === i2.clave('RESIDENCIAS CORAL'));
  // Y SIN catálogo a la vista, la lib se vuelve prudente: solo perdona el tipo.
  const i3 = F.indiceFrentes(['RESIDENCIAS CORAL', 'RESIDENCIA CORAL MAR', 'coral garden', 'RESIDENCIA CORAL GARDEN']);
  ok('⭐ sin catálogo no adivina: junta lo que solo cambia el tipo y nada más',
    i3.clave('coral garden') === i3.clave('RESIDENCIA CORAL GARDEN')
    && i3.clave('RESIDENCIAS CORAL') !== i3.clave('RESIDENCIA CORAL MAR'));
}

// ── 3) Con qué nombre se imprime el grupo ───────────────────────────────────
eq('⭐ el grupo sale con el nombre MÁS COMPLETO, no con la abreviatura',
  ['RES. BAHIA MAR', 'Res. coral', 'res. rita sol', 'HOTEL EDUARD´S', 'coral garden'].map(idx.nombre),
  ['RESIDENCIAS BAHIA MAR', 'RESIDENCIAS CORAL', 'RESIDENCIA RITA SOL PALACE',
    "Hotel Eduard's Suites & Resorts", 'RESIDENCIA CORAL GARDEN']);
ok('* el nombre es SIEMPRE uno de los que existen (no se inventa ninguno)',
  REALES.every((n) => REALES.includes(idx.nombre(n))));

// ── 4) Bordes ───────────────────────────────────────────────────────────────
eq('vacío, nulo y espacios no arman grupo', [F.claveFrente(null), F.claveFrente('   '), F.claveFrente(undefined)], ['', '', '']);
ok('un nombre nuevo (fuera de la lista) se responde a sí mismo',
  F.indiceFrentes([]).nombre('FRENTE NUEVO') === 'FRENTE NUEVO');
eq('sin nombres no hay grupos', F.agruparNombresFrente([]).length, 0);
ok('la lib es PURA (sin imports): se prueba sola',
  !/^\s*import\s/m.test(fs.readFileSync(path.join(ROOT, 'src/lib/frentesNombre.ts'), 'utf8')));

console.log(`\n${fail ? '❌' : '✅'} test-frentes-nombre · ${pass} ok · ${fail} fallando\n`);
if (failures.length) console.log(failures.join('\n'));
if (fail) process.exit(1);
