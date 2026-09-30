/*
 * ════════════════════════════════════════════════════════════════════════════
 * EL HORÓMETRO SE ESCRIBE CON COMA O CON PUNTO — 29-sep-2026.
 *
 * Pedido del cliente, textual:
 *   «en todos los horometros valida , y .»
 *   «desde la vista de tlf y desde la pc en control. QUE SEA , Y . COMO DECIMAL»
 *
 * ── QUÉ PASABA ─────────────────────────────────────────────────────────────
 * Cada pantalla leía el horómetro por su cuenta con `Number(txt.replace(',', '.'))`,
 * que cambia SOLO LA PRIMERA coma. Escribir el número como se escribe acá
 * —«7.919,5»— daba NaN:
 *   · en el TELÉFONO el botón no hacía nada (la validación devolvía "no es un
 *     número" sin decir cuál era el problema);
 *   · en CONTROL el modal ✎ decía «no es un numero valido» y no dejaba guardar;
 *   · y en el surtido de gasoil el campo ni siquiera filtraba lo tecleado.
 *
 * ── LA REGLA QUE QUEDA (una sola, en src/lib/horometroTrabajo.ts) ──────────
 * ⭐ Coma y punto valen IGUAL como decimal: 720,2 = 720.2.
 * ⭐ Si vienen los dos, el que agrupa de tres en tres es el de MILES:
 *    7.919,5 = 7,919.5 = 7919,5.
 * ⭐ Un separador con grupos de TRES exactos es de MILES: «7.919» son 7919 horas.
 *    Es el caso real que el propio modal trae de ejemplo: «tecleó 791,9 y era
 *    7.919». Un horómetro de 7,919 h sería una máquina de menos de 8 horas de uso.
 * ⚠️ LO QUE NO SE ENTIENDE SE RECHAZA, NO SE ADIVINA: «7.7.7» no es un número.
 *    Un horómetro mal leído se arrastra como inicial de la próxima jornada, así
 *    que es preferible que lo vuelvan a teclear. Por eso esta regla es MÁS
 *    ESTRICTA que la del dinero (`leerNumero`), que nunca puede dar NaN.
 * ⚠️ VACÍO NO ES CERO. El horómetro es opcional; si «» valiera 0, una jornada
 *    sin horómetro pasaría a ser una de cero horas.
 *
 *   node scripts/test-horometro-coma-punto.mjs
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
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const H = cargar('src/lib/horometroTrabajo.ts');
const { horometroDeTexto: leer1, numeroDeTexto, soloHorometro } = H;
// NaN no sobrevive a JSON.stringify: se compara como texto.
const n = (v) => { const r = leer1(v); return Number.isFinite(r) ? r : 'NADA'; };

// ── 1) COMA Y PUNTO VALEN IGUAL ─────────────────────────────────────────────
eq('⭐ con coma', n('720,2'), 720.2);
eq('⭐ con punto', n('720.2'), 720.2);
eq('⭐ los dos dan lo mismo', n('7919,5'), n('7919.5'));
eq('un entero pelado', n('7919'), 7919);
eq('el cero es un horómetro válido', n('0'), 0);
eq('no molestan los espacios', n('  7919,5  '), 7919.5);
eq('dos decimales también', n('7919,25'), 7919.25);

// ── 2) LOS MILES, COMO SE ESCRIBEN ACÁ ──────────────────────────────────────
// ⭐ El caso que el propio modal trae de ejemplo: «tecleó 791,9 y era 7.919».
eq('⭐ «7.919» son 7919 horas, no 7,919', n('7.919'), 7919);
eq('⭐ «7.919,5» = 7919,5', n('7.919,5'), 7919.5);
eq('⭐ y al revés, «7,919.5» = 7919,5', n('7,919.5'), 7919.5);
eq('miles de miles', n('1.234.567'), 1234567);
eq('miles de miles con decimal', n('1.234.567,8'), 1234567.8);
// ⚠️ Cuatro dígitos delante NO son un grupo de miles: ahí el signo es decimal.
eq('⚠️ «7919,500» no son miles: el 500 es decimal', n('7919,500'), 7919.5);

// ── 3) LO QUE NO SE ENTIENDE SE RECHAZA ─────────────────────────────────────
// ⚠️ Adivinar acá es peor que rechazar: el número mal leído se arrastra como
//    horómetro INICIAL de la próxima jornada.
eq('⭐ «7.7.7» no es un número', n('7.7.7'), 'NADA');
eq('⭐ ni «1,2,3»', n('1,2,3'), 'NADA');
eq('las letras tampoco', n('abc'), 'NADA');
eq('ni un número con letras pegadas', n('791h'), 'NADA');
eq('negativo, no', n('-3'), 'NADA');
eq('solo signos, no', n(','), 'NADA');
eq('⚠️ vacío NO es cero', n(''), 'NADA');
eq('...ni con espacios', n('   '), 'NADA');
eq('...ni nada', [n(null), n(undefined)], ['NADA', 'NADA']);
// A medio escribir no puede reventar: se teclea dígito por dígito.
eq('«7919,» a medio escribir vale 7919', n('7919,'), 7919);
eq('«7919.» también', n('7919.'), 7919);

// ── 4) EL CONTRATO DEL MODAL DE CONTROL: vacío BORRA, malo AVISA ────────────
// ⚠️ Los tres estados son distintos a propósito: `null` borra el número
//    guardado y `false` es lo que hace que la pantalla diga qué está mal.
eq('vacío = borrar (null)', [numeroDeTexto(''), numeroDeTexto('  ')], [null, null]);
eq('⭐ malo = false, para poder avisar', [numeroDeTexto('abc'), numeroDeTexto('7.7.7')], [false, false]);
eq('bueno = el número', [numeroDeTexto('720,2'), numeroDeTexto('7.919,5')], [720.2, 7919.5]);
eq('el cero se guarda, no se confunde con vacío', numeroDeTexto('0'), 0);

// ── 5) LO QUE DEJA TECLEAR EL CAMPO ─────────────────────────────────────────
// ⚠️ Si la máscara se comiera el segundo separador, «7.919,5» no se podría ni
//    escribir y la regla de arriba no serviría de nada.
eq('⭐ la máscara deja escribir los dos separadores', soloHorometro('7.919,5'), '7.919,5');
eq('quita las letras', soloHorometro('79a19'), '7919');
eq('y los signos raros', soloHorometro('-79 19$'), '7919');
eq('nada es nada', soloHorometro(null), '');

// ── 6) TELÉFONO Y PC: TODOS LEEN IGUAL ──────────────────────────────────────
// ⚠️ Esto es lo que pidió el cliente: «desde la vista de tlf y desde la pc en
//    control». Una pantalla que se quede con su propia copia vuelve al bug, y
//    no se nota hasta que alguien teclea un punto en ESA pantalla.
const PANTALLAS = [
  ['📱 inspector (teléfono)', 'src/screens/SupervisorScreen.tsx'],
  ['📱 QR de la máquina', 'src/screens/MachineQuickScreen.tsx'],
  ['📱 patio', 'src/screens/PatioScreen.tsx'],
  ['📱 asistencia de camiones', 'src/screens/AsistenciaCamionesScreen.tsx'],
  ['💻 Control — modal ✎ corregir', 'src/components/HorometroCorregirModal.tsx'],
  ['⛽ surtido de gasoil', 'src/components/SurtidoGasoil.tsx'],
];
for (const [quien, rel] of PANTALLAS) {
  const src = sinComentarios(leer(rel));
  ok(`⭐ ${quien} usa la librería para leer el horómetro`,
    /horometroDeTexto\(|numeroDeTexto\(/.test(src));
  ok(`${quien} usa la máscara compartida`, /soloHorometro\(/.test(src));
  ok(`${quien} la importa de horometroTrabajo`, /from '\.\.?\/(?:\.\.\/)?lib\/horometroTrabajo'/.test(src));
  // ⚠️ La copia vieja, la que solo cambiaba la PRIMERA coma.
  ok(`⚠️ ${quien} ya no lee el horómetro por su cuenta`,
    !/(horo|hIni|hFin|opHoro)\w*\s*\|\|\s*''\)\.replace\(',', '\.'\)/i.test(src));
}

// El surtido lee los LITROS aparte a propósito: cambiar cómo se leen movería
// cantidades de combustible ya cargadas, y eso no es lo que se pidió.
const gasoil = leer('src/components/SurtidoGasoil.tsx');
ok('⚠️ los litros del surtido siguen leyéndose como antes', /const numOrNull = /.test(gasoil));
ok('...y el horómetro no', /const horoOrNull = .*horometroDeTexto/.test(gasoil));

console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Coma o punto, teléfono o PC: el horómetro se lee igual en todos lados, y lo que no se entiende se rechaza.');
