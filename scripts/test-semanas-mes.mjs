/*
 * Test de las SEMANAS DEL MES CON CORTE ELEGIBLE (`src/lib/semanasMes.ts`) — 03-oct-2026.
 *
 * QUÉ PEDIDO CUBRE, textual
 *   «Un interruptor en el reporte (Lun→Dom / Dom→Sáb) para que elija al momento
 *   de bajar el PDF, y así también se puede reproducir una hoja vieja si hace
 *   falta; pero también una opción por si lo quiero entre días diferentes.»
 *   (Las hojas de Entradas/Salidas y Escombros salían SIEMPRE de domingo a
 *   sábado y a la encargada, que cuenta de lunes a domingo, no le cuadraban:
 *   «la semana 3 comienza es el 14».)
 *
 * LO QUE BLINDA — y por qué cada cosa
 *   · ⭐ CON DOMINGO SALE EXACTAMENTE LO DE SIEMPRE: una hoja vieja se tiene que
 *     poder reproducir igualita (es la razón de que el selector nazca ahí).
 *   · ⭐ CON LUNES, LA SEMANA 3 DE SEP-2026 ES DEL 14 AL 20: la queja literal.
 *   · La semana puede empezar en CUALQUIER día, los días se recortan al mes y
 *     el nombre de cada columna es el del día REAL, no uno corrido.
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

const srcPath = path.join(ROOT, 'src/lib/semanasMes.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const S = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); } };
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const rangos = (ws) => ws.map((w) => [w.n, w.from, w.to]);

// ── 1) ⭐ DOMINGO = LAS HOJAS DE SIEMPRE (septiembre 2026, el mes de la captura) ──
const sepDom = S.semanasDelMes(2026, 8); // sin tercer argumento: el valor por defecto ES domingo
eq('⭐ sep-2026 con el corte de siempre: 5 hojas, idénticas a las impresas', rangos(sepDom), [
  [1, '2026-09-01', '2026-09-05'],
  [2, '2026-09-06', '2026-09-12'],
  [3, '2026-09-13', '2026-09-19'],
  [4, '2026-09-20', '2026-09-26'],
  [5, '2026-09-27', '2026-09-30'],
]);
eq('⭐ el valor por defecto es DOMINGO (0): sin tocar nada, nada cambia', S.semanasDelMes(2026, 8, 0), sepDom);
eq('la semana 2 completa trae sus 7 días con el nombre REAL de cada uno',
  sepDom[1].days.map((d) => [d.name, d.iso.slice(8)]),
  [['Domingo', '06'], ['Lunes', '07'], ['Martes', '08'], ['Miércoles', '09'], ['Jueves', '10'], ['Viernes', '11'], ['Sábado', '12']]);
eq('la semana 1 está RECORTADA al mes: arranca martes 01, sin días de agosto',
  sepDom[0].days.map((d) => d.name), ['Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']);

// ── 2) ⭐ LUNES = LO QUE CUENTA LA ENCARGADA ─────────────────────────────────
const sepLun = S.semanasDelMes(2026, 8, 1);
eq('⭐ con lunes, la semana 3 es del 14 al 20 (la queja, literal)', rangos(sepLun)[2], [3, '2026-09-14', '2026-09-20']);
eq('…y el mes entero cuadra de lunes a domingo', rangos(sepLun), [
  [1, '2026-09-01', '2026-09-06'],
  [2, '2026-09-07', '2026-09-13'],
  [3, '2026-09-14', '2026-09-20'],
  [4, '2026-09-21', '2026-09-27'],
  [5, '2026-09-28', '2026-09-30'],
]);
eq('con lunes, la primera columna de una semana completa se llama Lunes (no un Domingo corrido)',
  sepLun[1].days[0], { name: 'Lunes', iso: '2026-09-07' });

// ── 3) «ENTRE DÍAS DIFERENTES»: cualquier día puede abrir la semana ──────────
eq('⭐ con MIÉRCOLES, las semanas van de miércoles a martes', rangos(S.semanasDelMes(2026, 8, 3)), [
  [1, '2026-09-01', '2026-09-01'],
  [2, '2026-09-02', '2026-09-08'],
  [3, '2026-09-09', '2026-09-15'],
  [4, '2026-09-16', '2026-09-22'],
  [5, '2026-09-23', '2026-09-29'],
  [6, '2026-09-30', '2026-09-30'],
]);
ok('con cualquier corte, el mes entero queda cubierto UNA sola vez (sin huecos ni repetidos)', [0, 1, 2, 3, 4, 5, 6].every((ini) => {
  const dias = S.semanasDelMes(2026, 8, ini).flatMap((w) => w.days.map((d) => d.iso));
  return dias.length === 30 && new Set(dias).size === 30 && dias[0] === '2026-09-01' && dias[29] === '2026-09-30';
}));
ok('…y en un mes de 31 días y en febrero también', [1, 0].every((ini) =>
  S.semanasDelMes(2026, 9, ini).flatMap((w) => w.days).length === 31
  && S.semanasDelMes(2026, 1, ini).flatMap((w) => w.days).length === 28));
eq('un mes que arranca justo en el día del corte no crea una semana vacía antes',
  rangos(S.semanasDelMes(2026, 10, 0))[0], [1, '2026-11-01', '2026-11-07']); // nov-2026 empieza domingo
eq('las semanas van numeradas 1..N sin saltos', S.semanasDelMes(2026, 8, 2).map((w) => w.n), [1, 2, 3, 4, 5]);

// ── 4) La etiqueta y las pastillas ──────────────────────────────────────────
eq('etiqueta del corte', [S.etiquetaCorteSemana(0), S.etiquetaCorteSemana(1), S.etiquetaCorteSemana(3)],
  ['de domingo a sábado', 'de lunes a domingo', 'de miércoles a martes']);
eq('las pastillas ofrecen los 7 días, en el orden en que la gente nombra la semana',
  S.CORTES_SEMANA.map((c) => c.corto), ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']);
eq('…y cada pastilla apunta a su día real', S.CORTES_SEMANA.map((c) => c.dow), [1, 2, 3, 4, 5, 6, 0]);

// ── 5) CANDADOS de la pantalla ──────────────────────────────────────────────
{
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const scr = sinComentarios(leer('src/screens/ReportsScreen.tsx'));
  ok('⭐ el selector NACE EN DOMINGO: sin tocarlo, las hojas salen como siempre', /useState<DiaSemana>\(0\)/.test(scr));
  ok('⭐ la pantalla usa la lib (el cálculo viejo se fue)', /semanasDelMes\(camYear, camMonth0, camInicioSemana\)/.test(scr) && !/function weeksOfMonth/.test(scr));
  ok('las 7 pastillas están y recalculan al momento', /CORTES_SEMANA\.map/.test(scr) && /cambiarCorteSemana/.test(scr) && /semanasDelMes\(camYear, camMonth0, d\)/.test(scr));
  ok('⭐ con domingo el PAPEL queda idéntico al histórico (el corte solo se escribe cuando NO es domingo)',
    (scr.match(/camInicioSemana !== 0 \? ` · Semanas \$\{etiquetaCorteSemana\(camInicioSemana\)\}` : ''/g) || []).length === 2);
  ok('…y el nombre del archivo sí lo cuenta cuando cambia', (scr.match(/sufijoCorte/g) || []).length >= 4);
  ok('el corte vale para los DOS papeles (entradas/salidas y escombros comparten camData.weeks)',
    /Reportes - Camiones E-S/.test(scr) && /Reportes - Escombros/.test(scr));
}

console.log('\nSEMANAS DEL MES — el corte lo elige el usuario; domingo reproduce las hojas de siempre\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-semanas-mes · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
