/*
 * Test de EDITAR UN PERÍODO DE NÓMINA (12-sep-2026).
 *
 * Pedido del cliente: «después de que creo un período no lo puedo editar, es
 * decir cambiarle las fechas… que los que tengan permiso full o admin sí puedan».
 *
 * Lo que fija, y por que duele si se rompe:
 *   · pide FULL, no escritura — mover el rango cambia lo que se le paga a TODO
 *     el mundo, y quien genera un pago no es quien redefine el periodo
 *   · al mover el rango se PREGUNTA si recalcular — dejar los montos viejos en
 *     silencio hace que el total describa un rango que ya no existe
 *   · el recalculo usa las fechas NUEVAS — `sel` todavia tiene las viejas
 *     cuando se llama, porque setSel no se ve hasta el proximo render
 *   · solo en BORRADOR — un periodo aprobado o pagado esta congelado a
 *     proposito: es el respaldo de lo que ya se pago
 *
 * Sin framework (el repo no tiene): transpila el .ts en memoria con `typescript`.
 *
 *   node scripts/test-periodo-nomina.mjs
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
const ok = (n, c) => { if (c) { pass++; return; } fail++; failures.push(`✗ ${n}`); };
const eq = (n, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) { pass++; return; }
  fail++; failures.push(`✗ ${n}\n    obtenido: ${JSON.stringify(a)}\n    esperado: ${JSON.stringify(b)}`);
};

const {
  validarPeriodo, cambiaElRango, hayCambios, diasDelRango, avisoRecalcular,
  limpioNombre, MAX_NOMBRE_PERIODO,
} = cargar('src/lib/periodoNomina.ts');

const P = (name, from, to) => ({ name, date_from: from, date_to: to });

// ── 1) QUE SE PUEDE GUARDAR ─────────────────────────────────────────────────
eq('un periodo bien puesto pasa', validarPeriodo(P('Semana 1', '2026-09-06', '2026-09-13')), null);
eq('un solo dia tambien vale', validarPeriodo(P('Un dia', '2026-09-13', '2026-09-13')), null);

// ⚠️ EL ORDEN DE LOS MOTIVOS. A quien dejo la fecha vacia no se le puede
//    contestar «la fecha de inicio es posterior a la final»: no entiende que hizo.
eq('sin nombre lo dice primero', validarPeriodo(P('   ', '2026-09-20', '2026-09-01')), 'Escribe el nombre del período.');
eq('sin fecha de inicio lo dice', validarPeriodo(P('X', '', '2026-09-13')), 'Falta la fecha de inicio.');
eq('sin fecha final lo dice', validarPeriodo(P('X', '2026-09-06', '')), 'Falta la fecha final.');
eq('una fecha con otro formato no cuela', validarPeriodo(P('X', '06/09/2026', '2026-09-13')), 'Falta la fecha de inicio.');
eq('al reves no se puede', validarPeriodo(P('X', '2026-09-14', '2026-09-13')),
  'La fecha de inicio no puede ser posterior a la final.');
ok('un nombre larguisimo se corta',
  validarPeriodo(P('a'.repeat(MAX_NOMBRE_PERIODO + 1), '2026-09-06', '2026-09-13')) !== null);
eq('...y uno del largo justo pasa', validarPeriodo(P('a'.repeat(MAX_NOMBRE_PERIODO), '2026-09-06', '2026-09-13')), null);

eq('el nombre se limpia de espacios de sobra', limpioNombre('  Semana   1   '), 'Semana 1');

// ── 2) QUE CAMBIO ───────────────────────────────────────────────────────────
const ANTES = P('Semana 1', '2026-09-06', '2026-09-12');

// ⭐ LA PREGUNTA QUE DECIDE SI HAY QUE RECALCULAR. Corregirle una tilde al
//    nombre no toca ni un numero; correr la fecha final un dia si.
ok('cambiar solo el nombre NO cambia el rango', cambiaElRango(ANTES, P('Semana uno', '2026-09-06', '2026-09-12')) === false);
ok('correr la fecha final SI', cambiaElRango(ANTES, P('Semana 1', '2026-09-06', '2026-09-13')) === true);
ok('correr la de inicio tambien', cambiaElRango(ANTES, P('Semana 1', '2026-09-05', '2026-09-12')) === true);

ok('cambiar el nombre igual es un cambio que guardar', hayCambios(ANTES, P('Semana uno', '2026-09-06', '2026-09-12')) === true);
ok('sin tocar nada no hay que guardar', hayCambios(ANTES, P('Semana 1', '2026-09-06', '2026-09-12')) === false);
// Escribir dos espacios en el nombre no es un cambio: el boton no se debe prender.
ok('espacios de sobra no cuentan como cambio', hayCambios(ANTES, P('  Semana   1 ', '2026-09-06', '2026-09-12')) === false);

// ── 3) CUANTOS DIAS ─────────────────────────────────────────────────────────
eq('del 6 al 12 son siete dias, contando los dos extremos', diasDelRango(P('', '2026-09-06', '2026-09-12')), 7);
eq('...y hasta el 13 son ocho', diasDelRango(P('', '2026-09-06', '2026-09-13')), 8);
eq('un solo dia es un dia', diasDelRango(P('', '2026-09-13', '2026-09-13')), 1);
// Cruzar un cambio de mes y un fin de ano no puede dar un numero raro.
eq('cruzando el fin de mes cuenta bien', diasDelRango(P('', '2026-08-30', '2026-09-02')), 4);
eq('cruzando el ano tambien', diasDelRango(P('', '2026-12-30', '2027-01-02')), 4);
// Y el horario de verano no aplica en Caracas, pero el calculo va en UTC igual:
// si usara Date local, un cambio de hora daria 6,96 dias y redondearia mal.
eq('un rango largo no se descuadra', diasDelRango(P('', '2026-01-01', '2026-12-31')), 365);
eq('un rango invalido da cero, no un negativo', diasDelRango(P('', '2026-09-14', '2026-09-13')), 0);
eq('sin fechas da cero', diasDelRango(P('', '', '')), 0);

// ⚠️ ESTE ES UN GUARDA SOBRE EL CODIGO, NO SOBRE EL RESULTADO, Y ES A PROPOSITO.
//    En Caracas no hay horario de verano, asi que calcular con `new Date()` local
//    da EXACTAMENTE los mismos numeros que `Date.UTC` y ninguna prueba de
//    resultado puede separarlos — lo comprobe rompiendolo y la suite paso igual.
//    Pero la maquina que corre esto puede estar en cualquier parte, y con
//    horario de verano un rango que cruce el cambio de hora da 6,96 dias y
//    redondea mal. Se fija la implementacion porque el comportamiento no alcanza.
{
  const lib = sinComentarios(leer('src/lib/periodoNomina.ts'));
  ok('los dias se cuentan en UTC', /Date\.UTC\(/.test(lib));
  ok('...y NO con fechas locales', !/new Date\(/.test(lib));
}

// ── 4) EL AVISO ─────────────────────────────────────────────────────────────
// Es la unica senal que va a tener quien mueva una fecha de que los montos que
// esta viendo son del rango viejo.
{
  const a = avisoRecalcular(ANTES, P('Semana 1', '2026-09-06', '2026-09-13'));
  ok('el aviso dice que el rango crecio', /pasa de 7 a 8 día\(s\)/.test(a));
  ok('...y que las cantidades son las viejas', /son todavía las del rango anterior/.test(a));
  ok('...y pregunta si recalcular', /¿Recalcular ahora/.test(a));
}
ok('si el rango se achica lo dice al reves',
  /baja de 7 a 4 día\(s\)/.test(avisoRecalcular(ANTES, P('Semana 1', '2026-09-06', '2026-09-09'))));
// Correr las DOS fechas un dia mantiene el largo: el aviso no puede decir que crecio.
ok('mover el rango entero sin cambiar el largo lo dice',
  /sigue con los mismos días/.test(avisoRecalcular(ANTES, P('Semana 1', '2026-09-07', '2026-09-13'))));

// ── 5) GUARDAS SOBRE LA PANTALLA ────────────────────────────────────────────
const scr = sinComentarios(leer('src/screens/PagoPersonalScreen.tsx'));

// ⭐ FULL, NO ESCRITURA. Es literalmente lo que pidio el cliente, y la razon es
//    que quien genera un pago no es necesariamente quien puede redefinir el
//    periodo. Un admin lo tiene por su rol (ver AuthContext.moduleLevel).
ok('editar el periodo pide FULL', /const puedeEditarPeriodo = levelMeets\(moduleLevel\('nomina'\), 'full'\);/.test(scr));
ok('...y no se confunde con el de generar pagos',
  /const puedeTarifa = levelMeets\(moduleLevel\('nomina'\), 'escritura'\);/.test(scr));
ok('el boton solo sale con ese permiso', /\{puedeEditarPeriodo \?/.test(scr));

// ⚠️ SOLO EN BORRADOR. Un periodo aprobado o pagado esta congelado a proposito.
//    El guarda mira que el boton viva DENTRO de la rama de borrador.
{
  const i = scr.indexOf("sel.status === 'borrador' ? (");
  const rama = i >= 0 ? scr.slice(i, scr.indexOf("sel.status === 'aprobada'", i)) : '';
  ok('el boton de editar vive dentro de la rama de borrador', rama.includes('abrirEditar'));
}

// ⭐ EL RECALCULO CON LAS FECHAS NUEVAS. `sel` todavia tiene las viejas cuando se
//    llama, porque setSel no se ve hasta el proximo render. Sin el parametro,
//    mover una fecha recalculaba contra el rango anterior.
ok('recalcularAuto acepta un rango', /const recalcularAuto = async \(rango\?: \{ from: string; to: string \}\) =>/.test(scr));
ok('...y lo usa en vez del periodo viejo',
  /const desde = rango\?\.from \?\? sel\.date_from;/.test(scr) && /const hasta = rango\?\.to \?\? sel\.date_to;/.test(scr));
ok('...y buildAuto recibe esas fechas', /const byCed = await buildAuto\(desde, hasta\);/.test(scr));
ok('al guardar se recalcula con las nuevas',
  /await recalcularAuto\(\{ from: ahora\.date_from, to: ahora\.date_to \}\)/.test(scr));

// ⚠️ `onPress` pasa el evento del toque como primer argumento. Sin el envoltorio,
//    el boton de recalcular le mandaria un GestureResponderEvent como rango.
ok('el boton de recalcular no le pasa el evento como rango', /onPress=\{\(\) => recalcularAuto\(\)\}/.test(scr));

// No se recalcula solo: se pregunta. Cambiar en silencio un monto que alguien ya
// reviso es peor que dejarlo viejo.
ok('se pregunta antes de recalcular', /if \(cambiaElRango\(antes, ahora\)\) \{[\s\S]{0,400}?await confirm\(/.test(scr));
ok('...y si dicen que no, se avisa que quedaron viejas',
  /Las cantidades quedaron como estaban/.test(scr));

// Si RLS bloquea no llega error, llega una respuesta sin filas. Sin esto
// pareceria que el boton no hace nada, que es la queja que motivo todo esto.
ok('se detecta el update que no toco ninguna fila',
  /if \(!data \|\| data\.length === 0\) \{[\s\S]{0,300}?No tienes permiso para cambiar este período/.test(scr));

// ── 5b) QUIEN LO EDITO (12-sep-2026) ────────────────────────────────────────
// Pedido del cliente: «me tienes que guardar y decir quien hizo el cambio,
// ademas de que se debe guardar en auditoria obviamente».
ok('se guarda quien edito', /updated_by: session\?\.user\?\.id \?\? null/.test(scr));
// El NOMBRE va como foto ademas del uuid: si dan de baja al usuario, la FK deja
// el uuid en null y sin el texto no quedaria de quien fue.
ok('...y su nombre como foto', /updated_by_name: fullName \|\| null/.test(scr));
ok('...y cuando', /updated_at: new Date\(\)\.toISOString\(\)/.test(scr));
ok('la marca viaja en el mismo update que las fechas', /date_to: ahora\.date_to, \.\.\.marca \}/.test(scr));
// Sin esto la pantalla seguiria mostrando el periodo sin la marca hasta recargar.
ok('...y queda en lo que se ve al instante', /\{ \.\.\.sel, \.\.\.ahora, \.\.\.marca \}/.test(scr));
ok('el nombre sale del usuario en sesion', /const \{ session, role, moduleLevel, fullName \} = useAuth\(\);/.test(scr));

// Se ENSEÑA, no solo se guarda: la bitacora hay que ir a buscarla.
ok('se ve quien lo edito en la ficha del periodo', /Editado por \{sel\.updated_by_name \|\| 'un usuario dado de baja'\}/.test(scr));
// Y NO se ve en un periodo recien creado: decir «editado por nadie» es peor.
ok('...y no sale si nunca se edito', /\{sel\.updated_at \?/.test(scr));

// La tabla lleva el trigger generico de auditoria (`audit_row`), que es el
// mismo de las otras 45 tablas. Se corrio como migracion, no vive en el repo.
ok('el modulo de auditoria sabe a que modulo pertenece la tabla',
  /staff_pay_periods: 'nomina'/.test(leer('src/lib/auditModulos.ts')));

// Las reglas son puras: si importaran algo, esta prueba no podria correrlas.
ok('la libreria del periodo NO importa nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/periodoNomina.ts'))));

// ── 6) EL MANUAL CUENTA LO MISMO ────────────────────────────────────────────
const md = leer('docs/MANUAL-USUARIO.md');
const ms = leer('src/screens/ManualScreen.tsx');
ok('el manual .md explica que se puede editar', /Cambiarle las fechas a un período \(12\/09\/2026\)/.test(md));
ok('...y que pide control total', /control total/i.test(md));
ok('...y que hay que recalcular', /recalcul/i.test(md));
ok('el manual en pantalla tambien', /CAMBIARLE LAS FECHAS A UN PERÍODO \(12\/09\/2026\)/.test(ms));
ok('el manual .md dice que queda constancia de quien', /Queda constancia de quién lo cambió/.test(md));
ok('...y que entra en auditoria', /entra en \*\*Auditoría\*\*/.test(md));
ok('...y por que los renglones NO entran', /no entran en Auditoría, y es a propósito/i.test(md));
ok('el manual en pantalla tambien lo dice', /QUEDA CONSTANCIA DE QUIÉN LO CAMBIÓ/.test(ms));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-periodo-nomina · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
