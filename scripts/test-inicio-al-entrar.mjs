// 🏠 A DÓNDE ENTRA CADA USUARIO (11-nov-2026, a pedido: «los que tengan permiso, que los
// lleve directo a Inicio, y los que no, al apartado Más y listo»). Corre la regla REAL
// (tabsHomeRoute, sacada del archivo) y fija que al cerrar sesión o cambiar de usuario la
// dirección de la página se limpia (antes el siguiente caía en la pantalla del anterior).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
let ok = 0; const fallas = [];
const check = (c, m, x) => { if (c) ok++; else fallas.push('  ✗ ' + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const eq = (a, b, m) => check(JSON.stringify(a) === JSON.stringify(b), m, { esperado: b, obtenido: a });

const nav = fs.readFileSync(path.join(ROOT, 'src/navigation/index.tsx'), 'utf8');
const i = nav.indexOf('function tabsHomeRoute(');
const j = nav.indexOf('\n}\n', i) + 3;
check(i > 0, 'se encontró tabsHomeRoute');
const js = ts.transpileModule(nav.slice(i, j) + '\nmodule.exports = tabsHomeRoute;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
const mod = { exports: {} }; new Function('module', 'exports', js)(mod, mod.exports);
const home = mod.exports;
const puede = (...mods) => (k) => mods.includes(k);

eq(home('admin', null, puede()), { name: 'Dashboard', path: '/inicio' }, 'el admin entra a Inicio');
eq(home('analista', null, puede('inicio', 'equipos')), { name: 'Dashboard', path: '/inicio' }, '⭐ con permiso de Inicio → Inicio');
eq(home('analista', { modules: { inicio: 'lectura', control_maquinaria: 'full', mapa: 'lectura' } }, puede('inicio', 'control_maquinaria', 'mapa')), { name: 'Dashboard', path: '/inicio' }, '⭐ rol personalizado CON Inicio → Inicio (antes iba a Control)');
eq(home('analista', { modules: { control_maquinaria: 'full' } }, puede('control_maquinaria', 'mapa', 'equipos')), { name: 'More', path: '/mas' }, '⭐ sin permiso de Inicio → Más (antes iba a Control)');
eq(home('analista', null, puede()), { name: 'More', path: '/mas' }, 'sin nada → Más');

// Al cerrar sesión o cambiar de usuario, la dirección vuelve a «/» (y de ahí a SU inicio).
const k = nav.indexOf('const uidAnterior = React.useRef');
const efecto = nav.slice(k, nav.indexOf('}, [loading, loggedInReal, session?.user?.id, inQrFlow]);', k));
check(k > 0 && /antes === undefined \|\| antes === uid \|\| !antes\) return;/.test(efecto) && /replaceState\(\{\}, '', '\/' \+ w\.location\.search\)/.test(efecto), '⭐ al salir o cambiar de usuario se limpia la dirección (el siguiente no cae en la pantalla del anterior)');
check(/if \(w\.location\.pathname === '\/' \|\| w\.location\.pathname === ''\) \{\s*w\.history\.replaceState\(\{\}, '', home/.test(nav), 'y desde «/» la lleva a su inicio (recargar con la misma sesión conserva la pantalla)');
check(/role === 'admin' \|\| canSee\('inicio'\) \? \(\s*<Tab\.Screen\s*name="Dashboard"/.test(nav), 'la pestaña Inicio solo existe con el permiso (coincide con la regla)');
check(/A DÓNDE ENTRA CADA USUARIO/.test(fs.readFileSync(path.join(ROOT, 'src/screens/ManualScreen.tsx'), 'utf8')), 'el manual lo explica');

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-inicio-al-entrar: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-inicio-al-entrar: ${ok} ok, 0 fallas`);
