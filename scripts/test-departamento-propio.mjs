/*
 * ════════════════════════════════════════════════════════════════════════════
 * UN DEPARTAMENTO PROPIO NO SE LO TRAGA OTRO — 29-sep-2026.
 *
 * Pedido del cliente, textual:
 *   «en nomina, esta ocurriendo una especie de bug, al crear un periodo al
 *    momento de filtrarlo por departamento no esta tomando el de soporte y
 *    servicio»
 *   RF-03: «Evitar la reasignación implícita o automática de empleados de
 *    "Soporte y Servicio" hacia "Servicios Generales".»
 *
 * ── LA CAUSA ───────────────────────────────────────────────────────────────
 * `normalizeDept` unificaba buscando la palabra EN CUALQUIER PARTE del nombre:
 * la regla de SERVICIOS GENERALES era /servicio|general|.../, y "SOPORTE Y
 * SERVICIO" contiene "servicio". Los 19 de la ficha y los 11 cargos del
 * tabulador caían en el grupo de SERVICIOS GENERALES, y como ahí había tantos
 * cargos como en el suyo, la etiqueta la ganaba "SERVICIOS GENERALES" por
 * alfabeto: el departamento desaparecía del filtro y su gente salía en la
 * sección equivocada del Excel.
 *
 * La misma raíz se llevaba por delante otros dos:
 *   · "MANTENIMIENTO PREVENTIVO DE MAQUINARIA" caía en OPERACIONES DE
 *     MAQUINARIA, porque contiene "maquinaria".
 *   · "ELECTRICIDAD" caía en MANTENIMIENTO, y como el tabulador tenía 3 cargos
 *     de ELECTRICIDAD contra 1 de MANTENIMIENTO, la sección de mantenimiento
 *     entera pasaba a llamarse ELECTRICIDAD.
 *
 * ── LA REGLA QUE QUEDA ─────────────────────────────────────────────────────
 * ⭐ EL NOMBRE TIENE QUE **EMPEZAR** POR EL DEPARTAMENTO. Lo que venga después
 *    solo lo precisa ("ALMACEN GENERAL" sigue siendo ALMACÉN, "MANTENIMIENTO
 *    PREVENTIVO" sigue siendo MANTENIMIENTO), pero una palabra DELANTE lo hace
 *    otro departamento ("SOPORTE Y SERVICIO" no es "SERVICIOS GENERALES").
 *    Es justo lo que separa un apellido de un departamento distinto.
 *
 * ⚠️ LO QUE NO PUEDE ROMPERSE AL ARREGLARLO: la unificación de verdad. Si
 *    "ALIMENTACION" (tabulador) y "COCINA" (ficha) dejan de ser lo mismo, el
 *    Excel sale con dos secciones que son el mismo gasto y los subtotales no
 *    cuadran con nada. Por eso aquí se prueban las DOS cosas a la vez.
 *
 * ⚠️ Y EL SQL. `supabase/nomina_departamentos.sql` reescribe la ficha con las
 *    MISMAS reglas. Con las viejas, volver a correrlo hoy PISARÍA los 19
 *    "SOPORTE Y SERVICIO" de la ficha y no habría cómo recuperarlos. Por eso
 *    esta suite también vigila el .sql, no solo el .ts.
 *
 *   node scripts/test-departamento-propio.mjs
 * ════════════════════════════════════════════════════════════════════════════
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
function cargarAbs(abs) {
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
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return cargarAbs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}
const cargar = (rel) => cargarAbs(path.join(ROOT, rel));
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const { normalizeDept } = cargar('src/lib/personal.ts');
const { mapaDepartamentos } = cargar('src/lib/nominaDepartamentos.ts');

// ── 1) EL DEPARTAMENTO PROPIO SE QUEDA CON SU NOMBRE ────────────────────────
// ⭐ El caso reportado. 19 fichas y 11 cargos del tabulador dependen de esto.
eq('⭐ SOPORTE Y SERVICIO no se vuelve SERVICIOS GENERALES',
  normalizeDept('SOPORTE Y SERVICIO', null), 'SOPORTE Y SERVICIO');
eq('⭐ ...ni escrito en minúscula', normalizeDept('soporte y servicio', null), 'SOPORTE Y SERVICIO');
eq('...ni con espacios de sobra', normalizeDept('  SOPORTE  Y  SERVICIO  ', null), 'SOPORTE Y SERVICIO');
// Los dos que arrastraba la misma causa.
eq('⭐ MANTENIMIENTO PREVENTIVO DE MAQUINARIA es mantenimiento, no operaciones',
  normalizeDept('MANTENIMIENTO PREVENTIVO DE MAQUINARIA', null), 'MANTENIMIENTO');
eq('⭐ ...y el correctivo igual',
  normalizeDept('MANTENIMIENTO CORRECTIVO DE MAQUINARIA', null), 'MANTENIMIENTO');
eq('⭐ ELECTRICIDAD es su propio departamento, no MANTENIMIENTO',
  normalizeDept('ELECTRICIDAD', null), 'ELECTRICIDAD');
// Los que ya se respetaban tienen que seguir igual.
eq('MANEJO DE CARGA sigue siendo suyo', normalizeDept('MANEJO DE CARGA', null), 'MANEJO DE CARGA');
eq('REMOCION Y EXCAVACION sigue siendo suyo',
  normalizeDept('REMOCION Y EXCAVACION', null), 'REMOCION Y EXCAVACION');

// ── 2) LA UNIFICACIÓN DE VERDAD SIGUE EN PIE ────────────────────────────────
// ⚠️ Esto es lo que NO puede romperse por arreglar lo de arriba: un mismo
//    departamento escrito distinto tiene que seguir cayendo en un solo grupo.
eq('COCINA y ALIMENTACION siguen siendo el mismo grupo',
  [normalizeDept('COCINA', null), normalizeDept('ALIMENTACION', null)], ['COCINA', 'COCINA']);
eq('ADMINISTRACION y ADMINISTRATIVO también',
  [normalizeDept('ADMINISTRACION', null), normalizeDept('ADMINISTRATIVO', null)], ['ADMINISTRATIVO', 'ADMINISTRATIVO']);
eq('el error de dedo ADMINITRATIVO también', normalizeDept('ADMINITRATIVO', null), 'ADMINISTRATIVO');
eq('SERVICIO GENERALES (error de dedo del tabulador) sí es SERVICIOS GENERALES',
  normalizeDept('SERVICIO GENERALES', null), 'SERVICIOS GENERALES');
eq('SERVICIOS GENERALES es SERVICIOS GENERALES',
  normalizeDept('SERVICIOS GENERALES', null), 'SERVICIOS GENERALES');
// ⭐ El apellido PRECISA el departamento; la palabra DELANTE lo cambia.
eq('ALMACEN GENERAL sigue siendo ALMACÉN', normalizeDept('ALMACEN GENERAL', null), 'ALMACÉN');
eq('OPERACIONES DE MAQUINAS es OPERACIONES DE MAQUINARIA',
  normalizeDept('OPERACIONES DE MAQUINAS', null), 'OPERACIONES DE MAQUINARIA');
eq('DIRECTIVO/GERENCIA es DIRECCIÓN Y COORDINACIÓN',
  normalizeDept('DIRECTIVO/GERENCIA', null), 'DIRECCIÓN Y COORDINACIÓN');
eq('y el nombre escrito con "DPTO. DE" delante tampoco despista',
  normalizeDept('DPTO. DE COCINA', null), 'COCINA');
eq('...ni "DEPARTAMENTO DE"', normalizeDept('DEPARTAMENTO DE ALMACEN', null), 'ALMACÉN');
// ⚠️ "DEPOSITO" empieza por "dep" pero NO es la muletilla "departamento".
eq('DEPOSITO no se confunde con la muletilla "depto"', normalizeDept('DEPOSITO', null), 'ALMACÉN');

// ── 3) SIN DEPARTAMENTO SE SIGUE DEDUCIENDO DEL CARGO ───────────────────────
// Esto no se tocó: es el último recurso de quien no tiene departamento por
// ningún lado, y ahí adivinar por el cargo es mejor que dejarlo sin clasificar.
eq('un electricista sin departamento sigue cayendo en MANTENIMIENTO',
  normalizeDept('', 'ELECTRICISTA'), 'MANTENIMIENTO');
eq('un cocinero sin departamento sigue cayendo en COCINA',
  normalizeDept(null, 'COCINERO PRINCIPAL'), 'COCINA');
eq('sin nada no se inventa', normalizeDept(null, null), 'SIN DEPARTAMENTO');

// ── 4) EL FILTRO DEL PERÍODO LO OFRECE ──────────────────────────────────────
// El tabulador real: 11 cargos de SOPORTE Y SERVICIO contra 11 de SERVICIOS
// GENERALES. Con la regla vieja los 22 caían en un grupo y, al empatar, la
// etiqueta la ganaba SERVICIOS GENERALES por alfabeto.
const TABULADOR = [
  ...Array.from({ length: 11 }, (_, i) => ({ cargo: `SOPORTE ${i}`, departamento: 'SOPORTE Y SERVICIO' })),
  ...Array.from({ length: 11 }, (_, i) => ({ cargo: `GENERAL ${i}`, departamento: 'SERVICIOS GENERALES' })),
  { cargo: 'TYPEADO', departamento: 'SERVICIO GENERALES' },
  { cargo: 'JEFE DE ALIMENTACION', departamento: 'ALIMENTACION' },
  { cargo: 'ELECTRICISTA DE PATIO', departamento: 'ELECTRICIDAD' },
];
const m = mapaDepartamentos(TABULADOR);

eq('⭐ un cargo de SOPORTE Y SERVICIO se muestra en SU departamento',
  m.de('SOPORTE 0'), 'SOPORTE Y SERVICIO');
eq('⭐ y uno de SERVICIOS GENERALES en el suyo',
  m.de('GENERAL 0'), 'SERVICIOS GENERALES');
eq('el error de dedo del tabulador sí se suma a SERVICIOS GENERALES',
  m.de('TYPEADO'), 'SERVICIOS GENERALES');
// ⭐ RF-02: la opción tiene que ESTAR en el desplegable del filtro.
const enFiltro = m.orden(TABULADOR.map((t) => m.de(t.cargo)));
ok('⭐ SOPORTE Y SERVICIO aparece en el filtro por departamento',
  enFiltro.includes('SOPORTE Y SERVICIO'));
ok('⭐ ...y SERVICIOS GENERALES sigue apareciendo aparte',
  enFiltro.includes('SERVICIOS GENERALES'));
ok('ELECTRICIDAD también tiene su propia opción', enFiltro.includes('ELECTRICIDAD'));
eq('son departamentos DISTINTOS, no dos nombres del mismo',
  new Set(enFiltro).size, enFiltro.length);

// ⭐ RF-03: la ficha de la persona manda igual que el tabulador; nadie de
// SOPORTE Y SERVICIO puede terminar contado en SERVICIOS GENERALES.
eq('⭐ la ficha de un cargo que no está en el tabulador también se respeta',
  m.de('INSPECTOR DE EQUIPO', 'SOPORTE Y SERVICIO'), 'SOPORTE Y SERVICIO');
eq('⭐ y el coordinador del pantallazo cae donde dice su ficha',
  m.de('COORDINADOR DE SOPORTE Y SERVICIO', 'SOPORTE Y SERVICIO'), 'SOPORTE Y SERVICIO');
// La unificación de siempre, vista desde el mapa completo.
eq('la ficha COCINA sigue adoptando el nombre del tabulador',
  m.de('AYUDANTE SIN TABULAR', 'COCINA'), 'ALIMENTACION');

// ── 5) EL SQL NO PUEDE PISAR LA FICHA ───────────────────────────────────────
// ⚠️ `nomina_departamentos.sql` reescribe `employees.department` de verdad. Si
//    vuelve a llevar la regla ancha, correrlo una vez más borra los 19 SOPORTE
//    Y SERVICIO de la ficha y no hay cómo saber quiénes eran.
const sql = leer('supabase/nomina_departamentos.sql');
const unificacion = sql.split('-- ── 2)')[0]; // solo el bloque que TOCA filas con departamento
ok('⭐ el SQL ya no manda a SERVICIOS GENERALES cualquier cosa que diga "servicio"',
  !/~\*\s*'servicio\|/.test(unificacion));
ok('⭐ el SQL ancla al principio del nombre', /~\*\s*'\^/.test(unificacion));
ok('⭐ el SQL ya no se lleva a MANTENIMIENTO todo lo que diga "electric"',
  !/'MANTENIMIENTO'[\s\S]{0,200}?electric/.test(unificacion));
ok('⭐ el SQL ya no manda a OPERACIONES todo lo que diga "maquin"',
  !/~\*\s*'maquin\|/.test(unificacion));
// Y lo que sí tiene que seguir unificando.
ok('el SQL sigue unificando COCINA/ALIMENTACION', /'COCINA'[\s\S]{0,200}?aliment/.test(unificacion));

console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Un departamento escrito aparte es un departamento aparte: nadie se lo traga por compartir una palabra.');
