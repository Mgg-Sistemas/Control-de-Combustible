// 🏭 CENTRO DE OPERACIONES — LOS CANDADOS DE AISLAMIENTO (23-oct-2026).
//
// El módulo es un mini sistema AISLADO: tiene sus tablas `cop_*`, solo sus
// archivos las tocan y no le escribe a nadie más. Estos candados vigilan que esa
// frontera no se cruce sin que alguien lo note:
//
//   (a) fuera de los archivos del módulo y de la lista permitida, ningún archivo
//       de `src/` ni de `scripts/` nombra `cop_` (ni para leer ni para escribir);
//   (b) ningún archivo del módulo llama a `.rpc(` (todo va por tablas con RLS);
//   (c) el permiso existe, NACE CERRADO ('none') y el menú lo nombra;
//   (d) por REGLA: fuera de centroOperacionesDb.ts, ningún archivo del módulo (también
//       los que se agreguen) importa supabase ni arma consultas.
//
// Si un candado falla, NO se afloja el candado: se mueve el código a su lugar.
//
//   node scripts/test-centro-operaciones-aislamiento.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

// El mismo cargador de scripts/test-reporte-personalizado.mjs: transpila el .ts
// a CommonJS y resuelve los imports relativos a otros .ts.
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

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? '  -> ' + extra : ''}`); }
};

/** Ruta relativa a la raíz, siempre con «/» (en Windows `path` usa «\»). */
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const leer = (r) => fs.readFileSync(path.join(ROOT, r), 'utf8');
const existe = (r) => fs.existsSync(path.join(ROOT, r));

/** Todos los archivos de texto de código bajo un directorio (recursivo). */
function archivos(dir, out = []) {
  for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const r = `${dir}/${ent.name}`;
    if (ent.isDirectory()) archivos(r, out);
    else if (/\.(tsx?|jsx?|mjs|cjs|json)$/.test(ent.name)) out.push(r);
  }
  return out;
}

// ── LOS ARCHIVOS DEL MÓDULO (Global Constraints) ──────────────────────────
// Algunos todavía no existen (los hacen otras tareas): el candado los permite
// igual, y el (b) solo revisa los que ya están.
const MODULO_FIJOS = [
  'src/lib/centroOperaciones.ts',
  'src/lib/centroOperacionesPapel.ts',
  'src/lib/centroOperacionesDb.ts',
  // La librería pura de ✍️ Cargar y 📋 Registros (R17); la (b) y la (d) también la revisan.
  'src/lib/centroOperacionesCarga.ts',
  // Las librerías puras de 📄 Reportes, del Reporte General pegado de WhatsApp y de
  // materiales/bloques (24-oct-2026); la (b) y la (d) también las revisan.
  'src/lib/centroOperacionesReportes.ts',
  'src/lib/centroOperacionesReporteGeneral.ts',
  'src/lib/centroOperacionesMateriales.ts',
  // La librería pura de maquinaria, bloques y km del 📅 Parte diario (PD4, 24-oct-2026).
  'src/lib/centroOperacionesMaquinariaBloques.ts',
  // La librería pura del 📄 Reporte completo (PD5a, 25-oct-2026).
  'src/lib/centroOperacionesReporteCompleto.ts',
  'src/screens/CentroOperacionesScreen.tsx',
];
const DIR_COMPONENTES = 'src/components/centroOperaciones/';
const esDelModulo = (r) => MODULO_FIJOS.includes(r) || r.startsWith(DIR_COMPONENTES);

// Fuera del módulo, `cop_` solo puede aparecer aquí: los tipos de las tablas, el
// mapa de la auditoría y su prueba. Más las pruebas del propio módulo.
const PERMITIDOS_FUERA = [
  'src/types/database.ts',
  'src/lib/auditModulos.ts',
  'scripts/test-auditoria-modulos.mjs',
];
const esPruebaDelModulo = (r) => /^scripts\/test-centro-operaciones[^/]*\.mjs$/.test(r);
const permitido = (r) => esDelModulo(r) || PERMITIDOS_FUERA.includes(r) || esPruebaDelModulo(r);

// `cop_` como palabra: «scope_» o «trg_xcop_» no son el prefijo de las tablas,
// pero «trg_cop_» y «'cop_sitios'» sí.
const NOMBRA_COP = /(?<![a-z0-9])cop_/i;

console.log('🏭 CENTRO DE OPERACIONES · CANDADOS DE AISLAMIENTO\n');

// ── (a) NADIE DE AFUERA NOMBRA cop_ ───────────────────────────────────────
{
  const todos = [...archivos('src'), ...archivos('scripts')];
  ok('(a) se recorrieron src/ y scripts/', todos.length > 200, `archivos ${todos.length}`);

  // El patrón tiene que detectar de verdad: los tipos de las tablas lo nombran.
  ok('(a) el detector encuentra cop_ donde sí está (src/types/database.ts)', NOMBRA_COP.test(leer('src/types/database.ts')));
  ok('(a) * y no confunde «scope_» con el prefijo', !NOMBRA_COP.test("const coordinator_scope_id = 1; // scope_x"));
  ok('(a) * pero sí ve «trg_cop_»', NOMBRA_COP.test('create trigger trg_cop_sello'));

  const intrusos = todos.filter((r) => !permitido(r) && NOMBRA_COP.test(fs.readFileSync(path.join(ROOT, r), 'utf8'))).sort();
  ok('⭐ (a) fuera del módulo y de la lista permitida, nadie nombra cop_', intrusos.length === 0, intrusos.join(', '));

  // La lista permitida no puede crecer en silencio: son exactamente tres.
  ok('(a) * la lista permitida de afuera son exactamente 3 archivos', PERMITIDOS_FUERA.length === 3);
}

// ── (b) EL MÓDULO NO LLAMA A NINGÚN RPC ───────────────────────────────────
{
  const delModulo = [
    ...MODULO_FIJOS.filter(existe),
    ...(existe(DIR_COMPONENTES) ? archivos(DIR_COMPONENTES.replace(/\/$/, '')) : []),
  ];
  ok('(b) hay archivos del módulo que revisar', delModulo.length >= 2, delModulo.join(', '));
  const conRpc = delModulo.filter((r) => leer(r).includes('.rpc('));
  ok('⭐ (b) ningún archivo del módulo contiene .rpc(', conRpc.length === 0, conRpc.join(', '));
}

// ── (d) POR REGLA, NO ARCHIVO POR ARCHIVO (spec §12.1; auditoría A16/B8) ──
// Todo archivo del módulo —los de la lista, los que aparezcan en
// src/components/centroOperaciones/ (el 📄 Reportes de la tarea 8, por ejemplo) y cualquier
// src/lib/centroOperaciones*.ts— habla con la base SOLO a través de centroOperacionesDb.ts:
// no importa supabase, no usa selectAllRows ni .rpc(, ni arma consultas con .from('…').
// (`.from(` CON comilla: `Array.from(` no es una consulta.)
{
  const CAPA_DE_DATOS = 'src/lib/centroOperacionesDb.ts';
  const libsDelModulo = fs.readdirSync(path.join(ROOT, 'src/lib')).filter((n) => /^centroOperaciones\w*\.ts$/.test(n)).map((n) => `src/lib/${n}`);
  const fuera = libsDelModulo.filter((r) => !MODULO_FIJOS.includes(r));
  ok('⭐ (d) toda librería src/lib/centroOperaciones*.ts está en la lista del módulo (MODULO_FIJOS)', fuera.length === 0, fuera.join(', '));

  /** Lo que un archivo del módulo no puede tener (fuera de la capa de datos). */
  const habla = (src) => [
    /from\s+['"][^'"]*\/supabase['"]/.test(src) ? 'importa supabase' : '',
    /require\(\s*['"][^'"]*supabase/.test(src) ? 'require de supabase' : '',
    /\bselectAllRows\b/.test(src) ? 'selectAllRows' : '',
    /\.rpc\(/.test(src) ? '.rpc(' : '',
    /\.from\(\s*['"`]/.test(src) ? ".from('…')" : '',
  ].filter(Boolean);
  // El detector tiene que detectar de verdad (y no confundir Array.from).
  ok('(d) el detector ve un import de supabase, un selectAllRows y un .from(\'tabla\')',
    habla("import { supabase } from '../../lib/supabase';").length === 1 && habla('await selectAllRows(x)').length === 1
    && habla("supabase.from('machinery').update({})").length === 1);
  ok('(d) * y no confunde Array.from( con una consulta', habla('const xs = Array.from(new Set(a));').length === 0);

  const delModulo = [
    ...new Set([...MODULO_FIJOS, ...libsDelModulo].filter(existe)),
    ...(existe(DIR_COMPONENTES) ? archivos(DIR_COMPONENTES.replace(/\/$/, '')) : []),
  ].filter((r) => r !== CAPA_DE_DATOS);
  ok('(d) se revisan la pantalla, las pestañas y las librerías puras', delModulo.includes('src/screens/CentroOperacionesScreen.tsx')
    && delModulo.includes('src/lib/centroOperacionesCarga.ts') && delModulo.some((r) => r.startsWith(DIR_COMPONENTES)), delModulo.join(', '));
  const infractores = delModulo.map((r) => [r, habla(leer(r))]).filter(([, h]) => h.length).map(([r, h]) => `${r} (${h.join(', ')})`);
  ok('⭐ (d) fuera de centroOperacionesDb.ts, ningún archivo del módulo habla con la base', infractores.length === 0, infractores.join(' · '));
}

// ── (d') (e) (g) (h) (i) EL ESTADO DE INSPECCIÓN (mesa de maquinaria §7, 26-oct-2026) ──
// El módulo muestra lo que dice inspección de las unidades vinculadas, leyéndolo con LA regla
// del sistema (`src/lib/machineLiveStatus.ts`) y SOLO desde la capa de datos. Estos candados
// impiden que el módulo copie la regla, la lea por otro lado o le escriba a alguien:
{
  const CAPA_DE_DATOS = 'src/lib/centroOperacionesDb.ts';
  const libsDelModulo = fs.readdirSync(path.join(ROOT, 'src/lib')).filter((n) => /^centroOperaciones\w*\.ts$/.test(n)).map((n) => `src/lib/${n}`);
  const delModulo = [...new Set([
    ...MODULO_FIJOS.filter(existe), ...libsDelModulo,
    ...(existe(DIR_COMPONENTES) ? archivos(DIR_COMPONENTES.replace(/\/$/, '')) : []),
  ])];
  ok("(d') se revisan la capa de datos, las librerías y las pantallas", delModulo.includes(CAPA_DE_DATOS)
    && delModulo.includes('src/lib/centroOperacionesMaquinariaBloques.ts') && delModulo.some((r) => r.startsWith(DIR_COMPONENTES)));

  // (d') Fuera de la capa de datos, `machineLiveStatus` solo por TIPO (un componente que la
  //      importara por valor pasaría el (d) y hablaría con la base por la puerta de atrás).
  /** Las importaciones de un módulo que NO son `import type` (y los require). */
  const porValor = (src, modulo) => {
    const re = new RegExp(`(^|\\n)\\s*import\\s+(type\\s+)?[^;]*?from\\s+['"][^'"]*\\b${modulo}['"]`, 'g');
    const malas = [...src.matchAll(re)].filter((x) => !x[2]).length;
    const req = new RegExp(`require\\(\\s*['"][^'"]*\\b${modulo}['"]`).test(src) ? 1 : 0;
    const dinamico = new RegExp(`import\\(\\s*['"][^'"]*\\b${modulo}['"]`).test(src) ? 1 : 0;
    return malas + req + dinamico;
  };
  ok("(d') el detector ve un import por valor, un require y un import() dinámico, y deja pasar el import type",
    porValor("import { fetchAveriaCat } from './machineLiveStatus';", 'machineLiveStatus') === 1
    && porValor("const L = require('../../lib/machineLiveStatus');", 'machineLiveStatus') === 1
    && porValor("const L = await import('./machineLiveStatus');", 'machineLiveStatus') === 1
    && porValor("import type { EstadoConteo } from './machineLiveStatus';", 'machineLiveStatus') === 0);
  const conLaLib = delModulo.filter((r) => r !== CAPA_DE_DATOS && porValor(leer(r), 'machineLiveStatus') > 0);
  ok("⭐ (d') fuera de centroOperacionesDb.ts nadie del módulo importa machineLiveStatus por valor (solo import type)", conLaLib.length === 0, conLaLib.join(', '));
  ok("(d') * y la capa de datos SÍ la importa por valor (la única puerta)", porValor(leer(CAPA_DE_DATOS), 'machineLiveStatus') === 1);

  // (e) Ni escritores ni otros clasificadores del sistema.
  const PROHIBIDOS = ['jornada', 'jornadaEstados', 'estadoCamionListero', 'controlEstado', 'inspectorDaySets', 'machineService',
    'machineInspectors', 'machineRounds', 'offlineQueue'];
  /** Los módulos de la lista prohibida que el archivo importa (por valor o por tipo, o require). */
  const importaProhibidos = (src) => PROHIBIDOS.filter((m) => new RegExp(`(from|require\\(|import\\()\\s*['"][^'"]*\\/${m}['"]`).test(src));
  ok('(e) el detector ve «../../lib/jornada» y no confunde «./jornadaX» ni «caracasDay»',
    importaProhibidos("import { caracasParts } from '../../lib/jornada';").join() === 'jornada'
    && importaProhibidos("import { x } from './jornadaX'; import { caracasBusinessToday } from '../../lib/caracasDay';").length === 0);
  const conProhibidos = delModulo.map((r) => [r, importaProhibidos(leer(r))]).filter(([, p]) => p.length).map(([r, p]) => `${r} (${p.join(', ')})`);
  ok('⭐ (e) ningún archivo del módulo importa escritores ni otros clasificadores (jornada, machineService, offlineQueue…)', conProhibidos.length === 0, conProhibidos.join(' · '));

  // (g) Nadie del módulo —la capa de datos INCLUIDA— nombra las tablas de inspección ni el marcador:
  //     el módulo no puede escribir una séptima copia de la regla porque ni nombra sus datos.
  const NOMBRES_INSPECCION = [/maintenance_requests/, /machine_rounds/, /machine_inspectors/, /M[ÁA]QUINA\s+PARADA/i];
  ok('(g) el detector ve las tablas y el marcador (con o sin tilde)', NOMBRES_INSPECCION.every((re, i) =>
    re.test(['x.from(\'maintenance_requests\')', 'machine_rounds', 'machine_inspectors', 'material = \'Maquina parada\''][i])));
  const conNombres = delModulo.filter((r) => NOMBRES_INSPECCION.some((re) => re.test(leer(r))));
  ok('⭐ (g) ningún archivo del módulo (ni la capa de datos) nombra maintenance_requests, machine_rounds, machine_inspectors ni MÁQUINA PARADA',
    conNombres.length === 0, conNombres.join(', '));

  // (h) La capa de datos USA la regla (makeLiveStatusOf + estadoConteoDe) y nadie del módulo
  //     define piezas del clasificador (patrón de test-frentes-estado-vivo.mjs).
  const db = leer(CAPA_DE_DATOS);
  ok('⭐ (h) la capa de datos llama makeLiveStatusOf( y estadoConteoDe(', /\bmakeLiveStatusOf\(/.test(db) && /\bestadoConteoDe\(/.test(db));
  const PIEZAS = ['averiaVigente', 'reactivada', 'mismoTurno', 'esHoy', 'paradaShiftOf'];
  const define = (src) => PIEZAS.filter((n) => new RegExp(`\\b(const|let|var|function)\\s+${n}\\b|\\b${n}\\s*[:=]\\s*(\\(|function|async)`).test(src));
  ok('(h) el detector ve «const reactivada =» y «function esHoy(», y no «reactivadaMs»',
    define('const reactivada = !!a;').join() === 'reactivada' && define('function esHoy() {}').join() === 'esHoy' && define('const reactivadaMs = 1;').length === 0);
  const conPiezas = delModulo.map((r) => [r, define(leer(r))]).filter(([, p]) => p.length).map(([r, p]) => `${r} (${p.join(', ')})`);
  ok('⭐ (h) ningún archivo del módulo define averiaVigente, reactivada, mismoTurno, esHoy ni paradaShiftOf', conPiezas.length === 0, conPiezas.join(' · '));
  ok('(h) * y nadie del módulo llama paradaShiftOf (es de la regla del sistema)', delModulo.every((r) => !/paradaShiftOf/.test(leer(r))));

  // (i) «Recibe, no envía» TRANSITIVO: la librería que el módulo usa para leer no escribe.
  const lib = leer('src/lib/machineLiveStatus.ts');
  const escribe = ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc('].filter((x) => lib.includes(x));
  ok('⭐ (i) src/lib/machineLiveStatus.ts no contiene .insert( .update( .upsert( .delete( ni .rpc(', lib.length > 0 && escribe.length === 0, escribe.join(' '));
}

// ── (c) EL PERMISO, EL MENÚ Y LA RUTA ─────────────────────────────────────
{
  const permisosTxt = leer('src/lib/permissions.ts');
  const P = loadTs(path.join(ROOT, 'src/lib/permissions.ts'));
  ok('(c) permissions.ts nombra centro_operaciones', permisosTxt.includes("'centro_operaciones'"));
  ok('(c) * está en MODULES con su etiqueta', P.MODULES.some((m) => m.key === 'centro_operaciones' && m.label === 'Centro de Operaciones'),
    JSON.stringify(P.MODULES.find((m) => m.key === 'centro_operaciones') ?? null));
  ok("⭐ (c) defaultLevel('centro_operaciones') === 'none' (nace cerrado)", P.defaultLevel('centro_operaciones') === 'none',
    String(P.defaultLevel('centro_operaciones')));
  ok('(c) * y no hereda el permiso de otro módulo', !('centro_operaciones' in P.MODULE_HEREDA_DE));

  const more = leer('src/screens/MoreScreen.tsx');
  ok('(c) MoreScreen nombra centro_operaciones', more.includes("module: 'centro_operaciones'"));
  ok('⭐ (c) * con el renglón exacto, en una sola línea',
    more.includes("{ label: 'Centro de Operaciones', route: 'CentroOperaciones', desc: 'Sitios, flota, entradas, movimientos y salidas, con sus reportes', icon: '🏭', module: 'centro_operaciones' }"));

  const nav = leer('src/navigation/index.tsx');
  ok('(c) la ruta CentroOperaciones está registrada', /<Stack\.Screen name="CentroOperaciones" component=\{CentroOperacionesScreen\}/.test(nav));
  ok('(c) * y el enlace web es centro-operaciones', /CentroOperaciones: 'centro-operaciones'/.test(nav));

  // La pantalla obedece al permiso del módulo, no a otro.
  const pantalla = existe('src/screens/CentroOperacionesScreen.tsx') ? leer('src/screens/CentroOperacionesScreen.tsx') : '';
  ok("(c) la pantalla pide moduleLevel('centro_operaciones')", pantalla.includes("moduleLevel('centro_operaciones')"));
  ok('(c) * y decide con levelMeets', /levelMeets\(/.test(pantalla));
}

console.log(`${fail === 0 ? '✅' : '❌'} test-centro-operaciones-aislamiento · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('El módulo sigue aislado: nadie de afuera nombra cop_, ningún rpc, y el permiso nace cerrado.');
