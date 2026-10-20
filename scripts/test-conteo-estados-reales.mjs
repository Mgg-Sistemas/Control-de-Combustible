// 📊 CONTEO DE MAQUINARIA · ESTADOS REALES (20-oct-2026) — pruebas.
//
// Pedido: «coloca la opción de que yo pueda seleccionar los estados con los que
// se trabaja, no solo activas e inactivas, sino averiadas, operativas, esperando
// instrucciones, una o varios» y «no me está reflejando lo real del catálogo».
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Carga TS con imports relativos resueltos y './supabase' SIEMPRE de mentira
// (a cualquier profundidad): estadoConteoDe es pura y no necesita la base.
const cache = new Map();
function cargarAbs(p) {
  if (cache.has(p)) return cache.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cache.set(p, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id === './supabase' || id.endsWith('/supabase')) return { supabase: {}, selectAllRows: async () => [] };
    if (id.startsWith('.')) {
      const abs = path.resolve(path.dirname(p), id);
      for (const c of [abs + '.ts', abs + '.tsx']) if (fs.existsSync(c)) return cargarAbs(c);
    }
    return orig(id);
  };
  m._compile(js, p);
  cache.set(p, m.exports);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

console.log('\n📊 CONTEO · ESTADOS REALES DEL CATÁLOGO\n');

const L = cargarAbs(path.join(ROOT, 'src/lib/machineLiveStatus.ts'));

// ═══ 1) La regla compartida (estadoConteoDe), caso por caso ═══════════════════
{
  const op = { operational: true, en_espera: false, transferida: false };
  eq('⭐ retirada manda sobre todo (hasta sobre una avería en vivo)',
    L.estadoConteoDe({ ...op, operational: false }, 'averiada'), 'retirada');
  eq('⭐ transferida es hermana de retirada, contada aparte',
    L.estadoConteoDe({ operational: false, transferida: true }, 'ninguno'), 'transferida');
  eq('⭐ esperando instrucciones va antes que la avería',
    L.estadoConteoDe({ ...op, en_espera: true }, 'averiada'), 'espera');
  eq('⭐ avería vigente = averiada', L.estadoConteoDe(op, 'averiada'), 'averiada');
  eq('⭐ parada vigente = parada', L.estadoConteoDe(op, 'parada'), 'parada');
  eq('trabajando / trabajó / nada = operativa',
    [L.estadoConteoDe(op, 'trabajando'), L.estadoConteoDe(op, 'trabajo_hoy'), L.estadoConteoDe(op, 'ninguno')],
    ['operativa', 'operativa', 'operativa']);
  ok('los 6 estados tienen etiqueta e ícono', L.ESTADO_CONTEO_ORDER.length === 6
    && L.ESTADO_CONTEO_ORDER.every((k) => L.ESTADO_CONTEO_INFO[k]?.label && L.ESTADO_CONTEO_INFO[k]?.icon));
}

// ═══ 2) El Catálogo usa LA MISMA regla (nada de séptima copia) ════════════════
{
  const eqScr = leer('src/screens/EquiposScreen.tsx');
  ok('⭐ el Catálogo importa estadoConteoDe y ya no tiene su copia',
    eqScr.includes('estadoConteoDe(m, liveStatusOf(m.id).estado)')
    && !eqScr.includes("type EstadoConteo = 'operativa'"));
}

// ═══ 3) El conteo de Reportes refleja lo real del Catálogo ════════════════════
{
  const rep = leer('src/screens/ReportsScreen.tsx');
  ok('⭐ cada máquina del conteo lleva su estado REAL (la regla del Catálogo)',
    rep.includes('estadoReal: estadoRealDe(m)')
    && rep.includes('estadoConteoDe(m, statusOf(String(m.id)).estado)'));
  ok('⭐ …con las averías/jornadas/inspectores de la MISMA fuente que el Catálogo',
    rep.includes('fetchAveriaCat(), fetchJornadaCat(), fetchInspByShift()')
    && rep.includes('makeLiveStatusOf({ jornadaCat, averiaCat, inspByShift, retiredIds'));
  ok('⭐ las tarjetas de arriba son los SEIS cubos del Catálogo + total flota',
    rep.includes('...ESTADO_CONTEO_ORDER.map((k) => ({')
    && rep.includes("{ k: 'Total flota', v: conteo.flota"));
  ok('⭐ el filtro de estados es MULTI (uno o varios) y vacío = todas',
    rep.includes('useState<Set<EstadoConteo>>(new Set())')
    && rep.includes('estadosSel.size === 0 ? src : src.filter((m) => estadosSel.has(m.estadoReal))'));
  ok('…y las pastillas viejas (todas/activas/inactivas) ya no existen',
    !rep.includes("'🟢 Solo activas'") && !rep.includes('tipoEstado'));
  ok('el PDF dice qué estados se marcaron, con su nombre completo',
    rep.includes("? 'Todos los estados'")
    && rep.includes('ESTADO_CONTEO_ORDER.filter((k) => estadosSel.has(k))'));
  ok('el detalle de una tarjeta filtra por el estado real y su PDF también',
    rep.includes('conteo.machinesAll.filter((m) => m.estadoReal === conteoDetail)')
    && rep.includes('conteo.machinesAll.filter((m) => m.estadoReal === kind)'));
  ok('si fallan las consultas de avería/jornada, el conteo NO revienta (cae al catálogo)',
    rep.includes("estadoConteoDe(m, 'ninguno')") && /catch \{ \/\* sin estos datos/.test(rep));
}

if (fail) {
  console.error(failures.join('\n'));
  console.error(`\n❌ test-conteo-estados-reales · ${fail} fallo(s), ${pass} ok`);
  process.exit(1);
}
console.log(`✅ test-conteo-estados-reales · ${pass} pruebas ok`);
