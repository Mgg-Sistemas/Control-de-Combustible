/*
 * MATRIZ de agrupación del REPORTE POR EMPRESA (activa/avería/espera/pendiente).
 *
 * Blinda `grupoEmpresaDe` (src/lib/empresaGrupo.ts) contra el bug del 17-ago-2026:
 * una parada/avería de UN turno metía toda la máquina en "Averiadas" aunque el OTRO
 * turno se hubiera declarado/trabajado limpio. Cubre TODA la matriz día × noche +
 * espera/pendiente. Si alguien vuelve a mezclar los turnos, esto falla.
 *
 *   npm run test:empresa-grupo   (o: node scripts/test-empresa-grupo.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

// empresaGrupo.ts es PURO (sin imports) → transpila y evalúa directo.
const src = fs.readFileSync(path.join(ROOT, 'src/lib/empresaGrupo.ts'), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'module', js)(mod.exports, mod);
const { grupoEmpresaDe } = mod.exports;

// Atajos para armar un turno: W=trabajó, D=declaró, F=avería/parada propia.
const T = (worked, declared, hasFault) => ({ worked, declared, hasFault });
const OFF = T(false, false, false);
const g = (dia, noche, hasFaultAny, enEspera = false) => grupoEmpresaDe({ dia, noche, hasFaultAny, enEspera });

let pass = 0, fail = 0; const failures = [];
const eq = (name, got, want) => { if (got === want) pass++; else { fail++; failures.push(`${name}: esperado ${want}, obtuvo ${got}`); } };

// ── ACTIVAS: basta que UN turno trabaje o declare limpio ─────────────────────
eq('día trabajó + noche off', g(T(true, false, false), OFF, false), 'activa');
eq('día declaró limpio (0h) + noche off', g(T(false, true, false), OFF, false), 'activa');
eq('noche trabajó + día off', g(OFF, T(true, false, false), false), 'activa');
eq('noche declaró limpio + día off', g(OFF, T(false, true, false), false), 'activa');
eq('ambos trabajaron (full)', g(T(true, false, false), T(true, false, false), false), 'activa');

// ── EL BUG: un turno limpio + el otro parado/averiado → ACTIVA (no averiada) ──
eq('día declaró limpio + NOCHE parada → activa', g(T(false, true, false), T(false, false, true), true), 'activa');
eq('día trabajó + NOCHE avería → activa', g(T(true, false, false), T(false, false, true), true), 'activa');
eq('noche declaró limpio + DÍA avería → activa', g(T(false, false, true), T(false, true, false), true), 'activa');
eq('día trabajó CON avería propia + noche off → activa (trabajó gana)', g(T(true, false, true), OFF, true), 'activa');

// ── AVERÍA: ningún turno limpio y hay avería/parada ──────────────────────────
eq('día avería + noche off (nada limpio)', g(T(false, false, true), OFF, true), 'averia');
eq('día declaró CON avería propia + noche off', g(T(false, true, true), OFF, true), 'averia');
eq('avería en ambos turnos', g(T(false, false, true), T(false, false, true), true), 'averia');
eq('día parada + noche parada (sin declarar)', g(T(false, false, true), T(false, false, true), true), 'averia');

// ── ESPERA / PENDIENTE ───────────────────────────────────────────────────────
eq('sin nada + en_espera → espera', g(OFF, OFF, false, true), 'espera');
eq('sin nada, sin espera → pendiente', g(OFF, OFF, false, false), 'pendiente');
eq('en_espera pero con avería → averia (avería gana a espera)', g(OFF, OFF, true, true), 'averia');
eq('declaró con avería, sin trabajar, en_espera → averia', g(T(false, true, true), OFF, true, true), 'averia');

if (fail) {
  console.log(`\n✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`\n${pass} OK · 0 FALLO(S)\nAgrupación por empresa: por-turno, una parada de un turno NO arrastra toda la máquina.`);
