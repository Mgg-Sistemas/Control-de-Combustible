// ⏰ JORNADA DE OTRO DÍA QUE QUEDÓ ABIERTA (06-nov-2026, caso LUMINARIA 05-nov).
//
// Lo que pasó: un inicio de jornada de DÍA quedó abierto (el cierre nunca llegó a la
// base) y desde el día siguiente era INVISIBLE para la ficha del inspector (solo se
// rescataba la de NOCHE de ayer). Nadie podía finalizarla: quedaba "trabajando" para
// siempre por dentro y "pendiente" en Inspecciones.
//
// Reglas que fija esta prueba:
//  1. `ahoraParaCerrarRonda`: el cierre de una ronda cuyo fin nominal quedó atrás por
//     más de 2 h se ancla a ESE fin nominal (no banca horas que nadie trabajó); el
//     cierre normal — incluida la noche que cruza la medianoche y se cierra entre
//     7 y 9 am — queda exactamente igual.
//  2. Con el ancla, la hora declarada HH:MM se interpreta en el día de ESA jornada.
//  3. La ficha del inspector rescata CUALQUIER jornada abierta de ayer (día o noche).
//  4. El camino de PARADA banca con el mismo ancla (y el tramo cierra con esa hora).
//  5. El Inicio se recarga al volver a la pantalla y cada 90 s (red de seguridad si
//     el canal en vivo muere: era el descuadre Inicio 161/20 vs Catálogo 163/18).
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
    if (id === './supabase' || id.endsWith('/supabase')) return { supabase: {}, selectAllRows: async () => [] };
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, abs);
  cache.set(abs, m.exports);
  return m.exports;
}

let ok = 0; const fallas = [];
const check = (cond, msg) => { if (cond) ok++; else fallas.push('  ✗ ' + msg); };

const H = loadTs(path.join(ROOT, 'src/lib/horaFinJornada.ts'));
const ms = (iso) => new Date(iso).getTime();

// ── 1. El ancla ──
// Día 05-nov: turno día, nominal 7pm.
const nominalDia = ms('2026-11-05T19:00:00-04:00');
check(H.ahoraParaCerrarRonda(nominalDia, ms('2026-11-05T16:30:00-04:00')) === ms('2026-11-05T16:30:00-04:00'),
  'cierre normal (antes del fin del turno): el «ahora» no cambia');
check(H.ahoraParaCerrarRonda(nominalDia, ms('2026-11-05T20:00:00-04:00')) === ms('2026-11-05T20:00:00-04:00'),
  'cierre tarde dentro de la gracia de 2 h: el «ahora» no cambia');
check(H.ahoraParaCerrarRonda(nominalDia, ms('2026-11-06T11:00:00-04:00')) === nominalDia,
  '⭐ ronda de AYER cerrada hoy a las 11am: se ancla al fin de SU turno (7pm de ayer)');
// Noche 05-nov: nominal 7am del 06. Cierre 7:30am y 8:59am = sin cambio (gracia).
const nominalNoche = ms('2026-11-06T07:00:00-04:00');
check(H.ahoraParaCerrarRonda(nominalNoche, ms('2026-11-06T07:30:00-04:00')) === ms('2026-11-06T07:30:00-04:00'),
  'noche que cruza la medianoche cerrada 7:30am: igual que siempre');
check(H.ahoraParaCerrarRonda(nominalNoche, ms('2026-11-06T08:59:00-04:00')) === ms('2026-11-06T08:59:00-04:00'),
  'noche cerrada 8:59am (aún en gracia): igual que siempre');
check(H.ahoraParaCerrarRonda(nominalNoche, ms('2026-11-06T15:00:00-04:00')) === nominalNoche,
  'noche huérfana cerrada a las 3pm: anclada a las 7am');

// ── 2. Con el ancla, lo que banca el cierre y la hora declarada ──
const start = ms('2026-11-05T08:00:00-04:00'); // LUMINARIA: inicio real anclado 8am
const nowAncla = H.ahoraParaCerrarRonda(nominalDia, ms('2026-11-06T11:00:00-04:00'));
const sinTexto = H.resolverFinJornada({ startMs: start, nominalEndMs: nominalDia, texto: '', nowMs: nowAncla });
check(sinTexto.ok && sinTexto.efectivoMs === nominalDia,
  'cerrar HOY la jornada de ayer sin hora declarada banca hasta el fin de SU turno (no 24 h)');
check(Math.round((sinTexto.efectivoMs - start) / 3600000) === 11,
  'las horas salen de SU día: 8am→7pm = 11 h (no 27 h del reloj de hoy)');
const declarada = H.resolverFinJornada({ startMs: start, nominalEndMs: nominalDia, texto: '10:00', nowMs: nowAncla });
check(declarada.ok && declarada.efectivoMs === ms('2026-11-05T10:00:00-04:00'),
  '⭐ la hora declarada «10:00» se interpreta en el día de ESA jornada (05-nov), no en hoy');

// ── 3-5. La pantalla usa el ancla y rescata cualquier jornada abierta de ayer ──
const sup = fs.readFileSync(path.join(ROOT, 'src/screens/SupervisorScreen.tsx'), 'utf8');
check(/if \(ry && \(\(ry as any\)\?\.jornada_start_at \|\| \(!r && caracasBusinessToday\(\) === yesterday\)\)\)/.test(sup),
  '⭐ la ficha rescata CUALQUIER jornada abierta de ayer (día o noche), no solo la de noche');
check(!/jornada_shift === 'night'\) \|\| \(!r &&/.test(sup),
  'ya no queda la condición vieja (solo noche) en el rescate');
check(/const nowCierreMs = ahoraParaCerrarRonda\(nominalEndMs\);/.test(sup) && /texto: finTime, nowMs: nowCierreMs/.test(sup),
  'finalizarJornada cierra con el «ahora» anclado');
check(/const nowParadaMs = ahoraParaCerrarRonda\(nominalEndMs\);/.test(sup)
  && /\(nowParadaMs - new Date\(jornadaStart\)\.getTime\(\)\)/.test(sup)
  && /\(nowParadaMs - shiftStartMs\)/.test(sup)
  && /ended_at: new Date\(nowParadaMs\)\.toISOString\(\)/.test(sup),
  'la PARADA banca y cierra el tramo con el mismo ancla');
check(/cierreRondaVieja \? ' · jornada de otro día que quedó abierta/.test(sup),
  'la bitácora dice cuándo fue el cierre de una ronda vieja');
const dash = fs.readFileSync(path.join(ROOT, 'src/screens/DashboardScreen.tsx'), 'utf8');
check(/setInterval\(\(\) => loadCounts\(\), 90000\)/.test(dash) && /addListener\?\.\('focus', \(\) => loadCounts\(\)\)/.test(dash),
  'el Inicio se recarga al volver a la pantalla y cada 90 s (no se desincroniza del Catálogo)');

if (fallas.length) {
  console.error(fallas.join('\n'));
  console.error(`\n❌ test-jornada-ayer-abierta: ${fallas.length} falla(s), ${ok} ok`);
  process.exit(1);
}
console.log(`✅ test-jornada-ayer-abierta: ${ok} ok, 0 fallas`);
