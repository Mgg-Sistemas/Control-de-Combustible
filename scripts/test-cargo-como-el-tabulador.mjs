/*
 * ════════════════════════════════════════════════════════════════════════════
 * EL CARGO, ESCRITO COMO LO ESCRIBE EL TABULADOR — 29-sep-2026.
 *
 * Pedido del cliente, textual:
 *   «esos son errores humanos, vamos a unificarlo a como se ve en el tabulador
 *    para que coincida»
 *
 * ── QUÉ PASABA ─────────────────────────────────────────────────────────────
 * Tres fichas tenían el cargo con un PUNTO de más: "MECANICO." y "ELECTRICISTA.".
 * El tabulador los tiene sin punto. Todo lo que enlaza a una persona con su
 * tarifa agrupaba por `norm(cargo)`, que ignora mayúsculas y tildes pero NO los
 * signos, así que "MECANICO." NO era "MECANICO":
 *
 *   · 💰 NO LES LLEGABA EL SUELDO DEL TABULADOR. "🔄 Sincronizar" cuenta y
 *     actualiza por esa misma clave: esas 3 personas no entraban en la cuenta
 *     del botón y quedaban con el precio que tuvieran de antes. Y no avisa:
 *     simplemente no aparecen.
 *   · Tampoco heredaban el DEPARTAMENTO de su cargo, así que se les deducía por
 *     otro lado (el mecánico es de SOPORTE Y SERVICIO, no de mantenimiento).
 *   · Y el filtro por cargo los mostraba como DOS cargos distintos, con la gente
 *     repartida entre los dos.
 *
 * ── LO QUE FIJA ESTA SUITE ─────────────────────────────────────────────────
 * ⭐ UNA SOLA CLAVE DE CARGO (`claveCargo`) para todo: contar, sincronizar,
 *    resolver el departamento y filtrar. Si el tabulador contara con un criterio
 *    y actualizara con otro, el botón diría "Sincronizar (3)" y dejaría a
 *    alguien sin sueldo sin decir nada.
 * ⭐ LA PANTALLA ESCRIBE EL CARGO COMO EL TABULADOR. Lo que se lee en la nómina
 *    tiene que ser lo mismo que se lee en el 🏷️ Tabulador, o no hay forma de
 *    cotejar una cosa con la otra.
 * ⚠️ PERO SIN FUSIONAR CARGOS QUE NO SON EL MISMO: la clave ignora signos, no
 *    palabras. "OPERADOR DE ROQUERO" y "OPERADOR" siguen siendo dos cargos.
 *
 *   node scripts/test-cargo-como-el-tabulador.mjs
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
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const { claveCargo } = cargar('src/lib/personal.ts');
const { mapaDepartamentos, SIN_CARGO } = cargar('src/lib/nominaDepartamentos.ts');

// ── 1) LA CLAVE: qué dos cargos son el mismo ────────────────────────────────
// ⭐ El caso reportado, el que costaba dinero.
eq('⭐ el punto de más no hace otro cargo', claveCargo('MECANICO.'), claveCargo('MECANICO'));
eq('⭐ ídem con el electricista', claveCargo('ELECTRICISTA.'), claveCargo('ELECTRICISTA'));
eq('las mayúsculas tampoco', claveCargo('Ayudante de Cocina'), claveCargo('AYUDANTE DE COCINA'));
eq('ni las tildes', claveCargo('MECÁNICO'), claveCargo('MECANICO'));
eq('ni los espacios dobles', claveCargo('AYUDANTE  DE   COCINA'), claveCargo('AYUDANTE DE COCINA'));
eq('ni los espacios de las puntas', claveCargo('  TODERO '), claveCargo('TODERO'));
eq('ni los paréntesis', claveCargo('OBRERO (CALETERO)'), claveCargo('OBRERO CALETERO'));
// ⚠️ PERO LA Ñ SÍ DISTINGUE: son cargos con nombres distintos, no una tilde.
ok('la ñ no se borra', claveCargo('DISEÑADOR') !== claveCargo('DISEADOR'));
ok('la ñ no se vuelve n', claveCargo('DISEÑADOR') !== claveCargo('DISENADOR'));
// ⚠️ Y NO FUSIONA CARGOS DISTINTOS: la clave quita signos, no palabras.
ok('⭐ un cargo más largo NO es el mismo cargo',
  claveCargo('OPERADOR DE ROQUERO') !== claveCargo('OPERADOR'));
ok('⭐ ni dos cargos que solo comparten una palabra',
  claveCargo('AYUDANTE DE COCINA') !== claveCargo('AYUDANTE DE SOLDADOR'));
ok('los números se conservan', claveCargo('OPERADOR TIPO 2') !== claveCargo('OPERADOR TIPO 3'));
eq('sin cargo, clave vacía', claveCargo(null), '');
eq('solo signos, clave vacía', claveCargo(' . - '), '');

// ── 2) LA PANTALLA LO ESCRIBE COMO EL TABULADOR ─────────────────────────────
const TABULADOR = [
  { cargo: 'MECANICO', departamento: 'soporte y servicio' },
  { cargo: 'ELECTRICISTA', departamento: 'ELECTRICIDAD' },
  { cargo: 'OBRERO (CALETERO)', departamento: 'SERVICIOS GENERALES' },
  { cargo: 'AYUDANTE DE COCINA', departamento: 'ALIMENTACION' },
];
const m = mapaDepartamentos(TABULADOR);

eq('⭐ un "MECANICO." de la ficha se lee MECANICO, como el tabulador',
  m.cargo('MECANICO.'), 'MECANICO');
eq('⭐ y un "ELECTRICISTA." se lee ELECTRICISTA', m.cargo('ELECTRICISTA.'), 'ELECTRICISTA');
eq('el cargo en minúscula se lee como lo escribe el tabulador',
  m.cargo('ayudante de cocina'), 'AYUDANTE DE COCINA');
// ⚠️ El tabulador manda hasta en los signos: escribe "OBRERO (CALETERO)" CON
//    paréntesis, y así tiene que leerse, aunque la clave los ignore para comparar.
eq('⭐ se respetan los signos que SÍ tiene el tabulador',
  m.cargo('obrero caletero'), 'OBRERO (CALETERO)');
// Un cargo que el tabulador no tiene se conserva tal como lo escribieron.
eq('un cargo sin tabulador se conserva como está', m.cargo('OPERADOR VIAL'), 'OPERADOR VIAL');
eq('...y en mayúscula, sin espacios de sobra', m.cargo('  operador  vial '), 'OPERADOR VIAL');
eq('sin cargo se dice SIN CARGO', m.cargo(null), SIN_CARGO);
eq('un cargo en blanco también', m.cargo('   '), SIN_CARGO);
// A dos escrituras del mismo cargo en el tabulador gana la alfabética, para que
// el filtro no cambie de nombre entre una carga y la siguiente.
const dupe = mapaDepartamentos([{ cargo: 'MECANICO.', departamento: 'X' }, { cargo: 'MECANICO', departamento: 'X' }]);
eq('a dos escrituras en el tabulador, la misma siempre', dupe.cargo('mecanico'), 'MECANICO');

// ── 3) Y ASÍ HEREDA SU DEPARTAMENTO ─────────────────────────────────────────
// ⭐ Esto es lo que se perdía: el mecánico es de SOPORTE Y SERVICIO por tabulador.
eq('⭐ el "MECANICO." hereda el departamento de MECANICO',
  m.de('MECANICO.'), 'SOPORTE Y SERVICIO');
eq('⭐ y el "ELECTRICISTA." el de ELECTRICISTA', m.de('ELECTRICISTA.'), 'ELECTRICIDAD');
eq('el tabulador sigue mandando sobre la ficha',
  m.de('MECANICO.', 'OPERACIONES DE MAQUINARIA'), 'SOPORTE Y SERVICIO');

// ── 4) UNA SOLA CLAVE EN TODAS PARTES ───────────────────────────────────────
// ⚠️ El tabulador CUENTA a la gente de un cargo y luego ACTUALIZA a esa misma
//    gente. Si contara con un criterio y actualizara con otro, el botón diría
//    "Sincronizar (3)" y dejaría a alguien sin su sueldo sin avisar.
const tab = sinComentarios(leer('src/components/TabuladorCargos.tsx'));
ok('⭐ el tabulador agrupa a los empleados por claveCargo', /const k = claveCargo\(raw\)/.test(tab));
ok('⭐ ...y busca a los que va a sincronizar con la misma clave',
  /empIds\.current\[claveCargo\(cargo\)\]/.test(tab));
ok('...y los cuenta con la misma', /empByCargo\[claveCargo\(cargo\)\]/.test(tab));
ok('⭐ no queda ningún agrupado de cargo por norm()',
  !/norm\((raw|cargo|t\.cargo)\)/.test(tab.replace(/norm\(t\.cargo\)\.includes/g, '')));
ok('un cargo nuevo no se puede repetir cambiándole un signo',
  /claveCargo\(t\.cargo\) === claveCargo\(cargo\)/.test(tab));

const pago = sinComentarios(leer('src/screens/PagoPersonalScreen.tsx'));
ok('⭐ la nómina escribe el cargo como el tabulador', /cargoOf = useCallback\(\(cargo[^)]*\) => depts\.cargo\(cargo\)/.test(pago));
ok('⚠️ y no quedó la copia vieja que agrupaba por el texto crudo',
  !/\(cargo \?\? ''\)\.trim\(\)\.toUpperCase\(\) \|\| 'SIN CARGO'/.test(pago));

// ── 5) LA LIMPIEZA DE LA FICHA ──────────────────────────────────────────────
// El .sql que deja la ficha escrita como el tabulador. Solo puede tocar lo que
// difiere EN LA ESCRITURA: si igualara por parecido, renombraría cargos que no son.
const sql = leer('supabase/nomina_cargos_como_el_tabulador.sql');
ok('⭐ el SQL iguala contra el tabulador, no contra una lista a mano',
  /staff_cargo_tariffs/.test(sql));
ok('⭐ ...y solo toca los que difieren en la escritura',
  /btrim\(e\.cargo\) (is distinct from|<>) btrim\(t\.cargo\)/.test(sql));
ok('⭐ compara por la misma clave que el código (signos y espacios fuera)',
  /\[\^a-z0-9ñ \]/.test(sql) && /\\s\+/.test(sql));
ok('no se limita a los activos: un inactivo se reincorpora con su cargo malo',
  !/status\s*=\s*'activo'/.test(sql));

console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('El cargo se escribe como el tabulador, y el que lo escribió con un punto de más igual cobra.');
