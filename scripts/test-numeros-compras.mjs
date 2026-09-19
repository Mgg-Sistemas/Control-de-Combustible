/*
 * Test de PUNTO O COMA EN COMPRAS Y SERVICIOS (19-sep-2026).
 *
 * Pedido del cliente: «que en compras y en servicios deje colocar o reconozca el punto
 * o reconozca la coma».
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · punto y coma valen igual como decimal (12,50 = 12.50)
 *   · NUNCA se bota la coma: «12,50» leído como 1250 es una compra cien veces más cara,
 *     guardada sin avisar (así estaban Requerimiento y Cuentas)
 *   · el campo de Servicios deja escribir el decimal (antes se repintaba con el número
 *     y el punto o la coma desaparecían al teclear)
 *   · una sola regla para todo Compras: las cuatro pantallas leen con la misma función
 *
 *   node scripts/test-numeros-compras.mjs
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

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function cargar(rel) {
  const p = path.join(ROOT, rel);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  m._compile(js, p);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const N = cargar('src/lib/numeros.ts');
ok('la librería no importa nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/numeros.ts'))));

// ── 1) PUNTO O COMA, LO MISMO ────────────────────────────────────────────────
eq('⭐ coma decimal', N.leerNumero('12,50'), 12.5);
eq('⭐ punto decimal', N.leerNumero('12.50'), 12.5);
eq('entero', N.leerNumero('1500'), 1500);
eq('a medio escribir con coma', N.leerNumero('12,'), 12);
eq('a medio escribir con punto', N.leerNumero('12.'), 12);
eq('empieza por el signo', [N.leerNumero(',5'), N.leerNumero('.5')], [0.5, 0.5]);
eq('centavos', N.leerNumero('0,05'), 0.05);

// ── 2) LOS DOS SIGNOS: EL ÚLTIMO ES EL DECIMAL ───────────────────────────────
eq('⭐ formato venezolano 1.234,56', N.leerNumero('1.234,56'), 1234.56);
eq('⭐ formato inglés 1,234.56', N.leerNumero('1,234.56'), 1234.56);
eq('varios miles 1.234.567,89', N.leerNumero('1.234.567,89'), 1234567.89);
eq('varios miles 1,234,567.89', N.leerNumero('1,234,567.89'), 1234567.89);

// ── 3) UN SIGNO REPETIDO SEPARA MILES ────────────────────────────────────────
eq('1.234.567', N.leerNumero('1.234.567'), 1234567);
eq('1,234,567', N.leerNumero('1,234,567'), 1234567);
eq('un solo signo, una vez, es decimal: 1.500 = 1,5', N.leerNumero('1.500'), 1.5);

// ── 4) LO QUE NO SE ENTIENDE ─────────────────────────────────────────────────
eq('vacío', [N.leerNumero(''), N.leerNumero(null), N.leerNumero(undefined)], [0, 0, 0]);
eq('letras', N.leerNumero('abc'), 0);
eq('con símbolo de moneda y espacios', N.leerNumero(' $ 12,50 '), 12.5);
eq('negativo', N.leerNumero('-3,5'), -3.5);
ok('nunca NaN', [',', '.', '-', '..', ',,', '1,2,3.4.5'].every((t) => Number.isFinite(N.leerNumero(t))));
eq('un número ya número', N.leerNumero(7.25), 7.25);

// ⭐ LA FALLA QUE SE CORRIGE: jamás cien veces más.
for (const t of ['12,50', '100,5', '0,75', '3,1416', '250,00']) {
  const n = N.leerNumero(t);
  ok(`⭐ «${t}» no se lee sin la coma`, n < 1000 && n === Number(t.replace(',', '.')));
}

// ── 5) EL TEXTO DEL CAMPO MIENTRAS SE ESCRIBE ────────────────────────────────
eq('⭐ mientras hay texto crudo se muestra el crudo («12,»), no el número', N.textoDeCampo('12,', 12), '12,');
eq('el crudo vacío también manda (acaban de borrar el campo)', N.textoDeCampo('', 5), '');
eq('sin crudo, el número guardado', N.textoDeCampo(undefined, 12.5), '12.5');
eq('sin crudo y sin número', N.textoDeCampo(undefined, undefined), '');

// ── 6) LAS CUATRO PANTALLAS DE COMPRAS LEEN CON LA MISMA FUNCIÓN ─────────────
const PANTALLAS = ['src/screens/ComprasScreen.tsx', 'src/screens/ServiciosTab.tsx', 'src/screens/RequerimientoTab.tsx', 'src/screens/CuentasScreen.tsx'];
for (const f of PANTALLAS) {
  const s = sinComentarios(leer(f));
  ok(`${f} lee con leerNumero`, /import \{[^}]*\bleerNumero\b[^}]*\} from '\.\.\/lib\/numeros'/.test(s) && /const parseNum = leerNumero;/.test(s));
  ok(`⭐ ${f} ya no bota la coma`, !/replace\(\/\[\^0-9\.\\-\]\/g/.test(s));
  ok(`${f} no tiene otra copia de parseNum`, !/function parseNum\(/.test(s));
}

// ── 7) SERVICIOS DEJA ESCRIBIR EL DECIMAL ────────────────────────────────────
const serv = sinComentarios(leer('src/screens/ServiciosTab.tsx'));
ok('⭐ el campo ya no se pinta con String(numero)', !/input\(String\(it\.(qty|price)\)/.test(serv));
ok('...se pinta con el texto crudo', /textoDeCampo\(crudo\[claveCrudo\(i, 'qty'\)\], it\.qty\)/.test(serv) && /textoDeCampo\(crudo\[claveCrudo\(i, 'price'\)\], it\.price\)/.test(serv));
ok('...guarda el crudo y el número a la vez', /setCrudo\(\(r\) => \(\{ \.\.\.r, \[claveCrudo\(i, f\)\]: limpio \}\)\);\s*setItem\(i, \{ \[f\]: parseNum\(limpio\) \}/.test(serv));
ok('...solo deja dígitos y un separador', /const limpio = onlyDecimal\(t\);/.test(serv));
ok('...teclado decimal en el teléfono', (serv.match(/keyboardType: 'decimal-pad', inputMode: 'decimal'/g) || []).length === 2);
eq('⭐ el crudo se limpia al quitar renglón, al limpiar el formulario y al abrir uno guardado', (serv.match(/setCrudo\(\{\}\)/g) || []).length, 3);

// ── 8) COMPRAS DIRECTAS / ÓRDENES CONSERVA SU TEXTO CRUDO ────────────────────
const compras = sinComentarios(leer('src/screens/ComprasScreen.tsx'));
ok('el editor de renglones sigue con su texto crudo', /const \[raw, setRaw\] = useState<Record<string, string>>\(\{\}\)/.test(compras) && /raw\[k\] !== undefined \? raw\[k\]/.test(compras));

// ── 9) MANUALES ──────────────────────────────────────────────────────────────
ok('manual (md)', /Punto o coma en Compras \(19\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('manual (app)', /PUNTO O COMA EN COMPRAS \(19\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-numeros-compras · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
