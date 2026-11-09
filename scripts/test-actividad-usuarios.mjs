// 👥 AUDITORÍA DE USUARIOS (09-nov-2026): latido cada 60 s y panel con conectados, tiempo,
// acciones por usuario / día / módulo. Calcado de Golden Touch, con el resumen en la base.
// Esta prueba fija las reglas puras y el cableado (sin red).
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
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
  const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs)); cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id === './supabase' || id.endsWith('/supabase')) return { supabase: {} };
    if (id === 'react-native') return { Platform: { OS: 'web' } };
    if (id.startsWith('.')) { const p = path.resolve(path.dirname(abs), id); for (const c of [p + '.ts', p + '.tsx']) if (fs.existsSync(c)) return loadTs(c); }
    return orig(id);
  };
  m._compile(out, abs); cache.set(abs, m.exports); return m.exports;
}
let ok = 0; const fallas = [];
const check = (c, m, x) => { if (c) ok++; else fallas.push('  ✗ ' + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const eq = (a, b, m) => check(JSON.stringify(a) === JSON.stringify(b), m, { esperado: b, obtenido: a });

const A = loadTs(path.join(ROOT, 'src/lib/actividadUsuarios.ts'));

// Equipo
eq(A.dispositivoDeUA('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/1'), 'android', 'Android');
eq(A.dispositivoDeUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156'), 'pc', 'Windows = PC');
eq(A.dispositivoDeUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604'), 'iphone', 'iPhone (aunque diga Mac OS X)');
eq(A.dispositivoDeUA('', 'android'), 'android', 'app nativa Android sin user agent');
eq(A.navegadorDeUA('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120'), 'edge', 'Edge antes que Chrome');
eq(A.navegadorDeUA('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537'), 'chrome', 'Chrome');

// Pantalla actual
eq(A.pantallaDeEstado({ index: 1, routes: [{ name: 'Inicio' }, { name: 'Mas', state: { index: 0, routes: [{ name: 'ViajesCamiones' }] } }] }), 'ViajesCamiones', '⭐ la pantalla más adentro de la navegación');
eq(A.pantallaDeEstado(null), '', 'sin estado: vacío');

// Períodos: jornada de 7am a 7am
const r = A.rangoDePeriodo('hoy', '2026-11-09');
eq([r.desde, r.hasta], ['2026-11-09T11:00:00.000Z', '2026-11-10T11:00:00.000Z'], '⭐ «Hoy» = jornada 7am → 7am del día siguiente (hora de Caracas)');
eq(A.rangoDePeriodo('7d', '2026-11-09').desde, '2026-11-03T11:00:00.000Z', '7 días = desde la jornada de hace 6 días');
eq(A.rangoDePeriodo('mes', '2026-11-09').desde, '2026-11-01T11:00:00.000Z', 'este mes = desde el 1');
const rr = A.rangoDePeriodo('rango', '2026-11-09', '2026-11-05', '2026-11-03');
eq([rr.desde, rr.hasta], ['2026-11-05T11:00:00.000Z', '2026-11-06T11:00:00.000Z'], 'rango al revés: se toma el desde como un solo día (no explota)');

// Resumen
const res = A.normalizarResumen({ ahora: '2026-11-09T18:00:00Z', conectados: [{ user_id: 'u1', nombre: 'A', inicio: '2026-11-09T16:00:00Z' }],
  usuarios: [{ user_id: 'u1', nombre: 'A', sesiones: '2', minutos: '125.5', acciones: 30 }, { user_id: 'u2', nombre: 'B', sesiones: 0, minutos: 0, acciones: 5 }],
  acciones_por_tabla: [{ tabla: 'machine_rounds', accion: 'UPDATE', n: 10 }, { tabla: 'tabla_que_no_existe', accion: 'INSERT', n: 2 }], por_dia: null });
const t = A.totalesActividad(res);
eq([t.conectados, Math.round(t.minutos * 10) / 10, t.sesiones, t.activos, t.acciones], [1, 125.5, 2, 2, 35], '⭐ totales de las tarjetas (números en texto se leen; por_dia nulo no rompe)');
eq(A.fmtDuracion(125.5), '2h 6m', 'duración «2h 6m»');
eq(A.fmtDuracion(45), '45m', 'duración «45m»');
eq(A.minutosEntre('2026-11-09T16:00:00Z', '2026-11-09T18:00:00Z'), 120, 'minutos conectado');
const mods = A.accionesPorModulo(res.acciones_por_tabla);
check(mods.length === 2 && mods.some((m) => m.modulo === '📁 Otro' && m.n === 2), '⭐ acciones por módulo con LA MISMA regla de la bitácora (lo desconocido cae en «Otro», nunca se esconde)', mods);
check(A.versionVieja('index-aaa.js', 'index-bbb.js') && !A.versionVieja('index-aaa.js', 'index-aaa.js') && !A.versionVieja(null, 'index-a.js'), '⭐ avisa la versión anterior solo si ambas son de la web y difieren');

// Cableado
const auth = fs.readFileSync(path.join(ROOT, 'src/context/AuthContext.tsx'), 'utf8');
check(/const latido = setInterval\(latir, LATIDO_MS\);/.test(auth) && /clearInterval\(latido\);/.test(auth), '⭐ el latido corre cada 60 s y se limpia al cerrar sesión');
check(/visibilityState === 'hidden'\) return;/.test(auth) && /esAnonima/.test(auth), 'no late con la pestaña oculta ni en sesiones anónimas (QR)');
eq(A.LATIDO_MS, 60000, 'latido de 60 s');
const nav = fs.readFileSync(path.join(ROOT, 'src/navigation/index.tsx'), 'utf8');
check(/onStateChange=\{\(st\) => setPantallaActual\(pantallaDeEstado\(st\)\)\}/.test(nav), 'la navegación avisa la pantalla actual');
const lib = fs.readFileSync(path.join(ROOT, 'src/lib/actividadUsuarios.ts'), 'utf8');
check(/rpc\('auditoria_actividad'/.test(lib) && !/from\('audit_log'\)/.test(lib) && !/from\('sesiones_usuario'\)/.test(lib), '⭐ el panel pide el RESUMEN a la base (no descarga la bitácora ni las sesiones)');
const pantalla = fs.readFileSync(path.join(ROOT, 'src/components/UsuariosActividad.tsx'), 'utf8');
check(/const esc = /.test(pantalla) && /esc\(c\.nombre\)/.test(pantalla), 'el PDF escapa los nombres');
check(/ocultosPdf/.test(pantalla) && /Vista previa PDF/.test(pantalla), 'el PDF tiene «qué sale» (lo oculto no deja rastro)');
const audit = fs.readFileSync(path.join(ROOT, 'src/screens/AuditScreen.tsx'), 'utf8');
check(/'👥 Usuarios'/.test(audit) && /<UsuariosActividad \/>/.test(audit), 'la pestaña «👥 Usuarios» está en Auditoría (que ya exige admin o can_audit)');

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-actividad-usuarios: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-actividad-usuarios: ${ok} ok, 0 fallas`);
