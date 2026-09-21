/*
 * Test de los CONTACTOS DE COCINA (21-sep-2026).
 *
 * Pedido del cliente: «hay personas que vienen nuevas y piden n cantidad de comidas,
 * esas personas se manejarán por facturas también desde el módulo de distribución de
 * comidas […] es como crear un contacto, ese contacto sería solo para cocina […] que
 * nada de esos registros choquen con nada […] que tenga reconocimiento de cédula o de
 * datos por si el usuario ya existe en el sistema, para que no haya duplicados».
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · la misma cédula escrita de otra manera es la MISMA persona (si no, la factura
 *     de alguien sale partida en tres pedazos y nadie sabe cuál cobrar)
 *   · quien ya está en la nómina NO se registra como contacto: se atiende con su carnet
 *   · la cédula es OBLIGATORIA, acá y en la base (sin ella la gente se duplica sola)
 *   · sin empresa se cobra al contacto, diga lo que diga su ficha
 *   · el buscador encuentra por los dígitos, que es como la gente busca de verdad
 *   · un contacto puede pedir VARIAS comidas y repetir en el día; la nómina no
 *   · las columnas nuevas solo se mandan si hay contacto (si no, sin el SQL corrido la
 *     cocina no podría registrar NI UNA comida)
 *   · nada se borra: se quita de la lista
 *
 * Valores inventados: no hay cédulas ni teléfonos reales en el repositorio (es público).
 *
 *   node scripts/test-comida-contactos.mjs
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
function loadTs(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(abs), id) + '.ts') : orig(id));
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const C = loadTs('src/lib/comidaContactos.ts');

// Gente inventada para las pruebas.
const ana = { id: 'c1', nombre: 'Ana', apellido: 'Rojas', cedula: 'V-11.111.111', telefono1: '04121111111', telefono2: null, company_id: null, cobrar_a: 'empresa', activo: true };
const beto = { id: 'c2', nombre: 'Beto', apellido: 'Mora', cedula: '22222222', telefono1: null, telefono2: null, company_id: 'emp-1', cobrar_a: 'empresa', activo: true };
const caro = { id: 'c3', nombre: 'Caro', apellido: 'Díaz', cedula: 'V-33.333.333', telefono1: '04143333333', telefono2: null, company_id: 'emp-1', cobrar_a: 'independiente', activo: true };
const dani = { id: 'c4', nombre: 'Dani', apellido: 'Luna', cedula: 'E-44444444', telefono1: null, telefono2: null, company_id: null, cobrar_a: 'empresa', activo: false };
const TODOS = [ana, beto, caro, dani];

// ── 1) LA LIBRERÍA SE PRUEBA SOLA ────────────────────────────────────────────
{
  ok('la librería de contactos no importa nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/comidaContactos.ts'))));
}

// ── 2) LA CÉDULA ES LA LLAVE, Y SE COMPARA POR LOS DÍGITOS ───────────────────
{
  eq('los puntos, los guiones y la V no cuentan',
    ['V-12.345.678', 'v12345678', '12.345.678', ' 12345678 '].map(C.normalizarCedula),
    ['12345678', '12345678', '12345678', '12345678']);
  eq('sin dígitos no hay cédula', [C.normalizarCedula(''), C.normalizarCedula(null), C.normalizarCedula('V-')], ['', '', '']);
  eq('la letra se conserva para mostrarla', C.prefijoCedula('e-9876543'), 'E');
  eq('se muestra con puntos', C.formatearCedula('V12345678'), 'V-12.345.678');
  eq('sin letra también se muestra', C.formatearCedula('1234567'), '1.234.567');

  // ⭐ EL CASO QUE DESTAPA EL DUPLICADO: la misma persona escrita de otra manera.
  ok('⭐ «11111111» encuentra a quien está como «V-11.111.111»', C.contactoConCedula(TODOS, '11111111')?.id === 'c1');
  ok('⭐ ...y al revés también', C.contactoConCedula(TODOS, 'V-22.222.222')?.id === 'c2');
  eq('una cédula que no está no inventa a nadie', C.contactoConCedula(TODOS, '99999999'), null);
  eq('sin cédula no devuelve al primero que encuentre', C.contactoConCedula(TODOS, ''), null);
  // Un quitado de la lista SÍ aparece: si no, se crearía otro con la misma cédula y
  // la base lo rechazaría con un error que no dice qué pasó.
  ok('⭐ el quitado de la lista también se encuentra', C.contactoConCedula(TODOS, '44444444')?.id === 'c4');
}

// ── 3) LA NÓMINA MANDA SOBRE LA AGENDA ───────────────────────────────────────
{
  const ficha = { id: 'e1', nombre: 'Pedro Pérez', empresa: 'EMPRESA INVENTADA' };
  const h1 = C.dictamenCedula('11111111', ficha, TODOS);
  eq('⭐ si está en nómina, se atiende por su carnet (aunque también sea contacto)', h1.tipo, 'nomina');
  ok('...y NO deja crear', !C.dejaCrear(h1));
  ok('...y lo dice con nombre y empresa', /Pedro Pérez/.test(C.mensajeDeHallazgo(h1)) && /EMPRESA INVENTADA/.test(C.mensajeDeHallazgo(h1)));

  const h2 = C.dictamenCedula('11111111', null, TODOS);
  eq('si no está en nómina pero sí en la agenda, se abre ese contacto', h2.tipo, 'contacto');
  ok('...y tampoco deja crear otro', !C.dejaCrear(h2));
  ok('...y lo dice por su nombre', /Ana Rojas/.test(C.mensajeDeHallazgo(h2)));

  const h3 = C.dictamenCedula('99999999', null, TODOS);
  eq('una cédula libre deja crear', h3.tipo, 'libre');
  ok('...y no tiene nada que decir', C.dejaCrear(h3) && C.mensajeDeHallazgo(h3) === '');

  // Una ficha sin id no es una ficha: no puede trancar el alta de nadie.
  eq('una ficha rota no se toma como nómina', C.dictamenCedula('99999999', { id: '', nombre: 'x' }, TODOS).tipo, 'libre');
  eq('el quitado de la lista avisa que se devuelva, no que se cree otro', C.dictamenCedula('44444444', null, TODOS).tipo, 'contacto');
  ok('...y lo dice con esas palabras', /quitado de la lista/.test(C.mensajeDeHallazgo(C.dictamenCedula('44444444', null, TODOS))));
}

// ── 4) VALIDAR: QUÉ SE EXIGE Y QUÉ NO ────────────────────────────────────────
{
  const base = { nombre: 'Nuevo', apellido: 'Cliente', cedula: '99999999' };
  eq('con nombre, apellido y cédula alcanza', C.validarContacto(base, TODOS), null);
  ok('sin nombre no', /nombre/i.test(C.validarContacto({ ...base, nombre: '  ' }, TODOS)));
  ok('sin apellido tampoco', /apellido/i.test(C.validarContacto({ ...base, apellido: '' }, TODOS)));
  ok('sin cédula pide la cédula o la casilla', /cédula/i.test(C.validarContacto({ ...base, cedula: '' }, TODOS)));
  ok('una cédula a medias no pasa', /incompleta/i.test(C.validarContacto({ ...base, cedula: '123' }, TODOS)));
  ok('⭐ una cédula repetida no pasa, aunque se escriba distinto', /Ana Rojas/.test(C.validarContacto({ ...base, cedula: 'V-11.111.111' }, TODOS)));
  eq('⭐ corrigiendo a esa misma persona, su cédula sí vale', C.validarContacto({ ...base, cedula: 'V-11.111.111' }, TODOS, 'c1'), null);

  // ⭐ LOS TELÉFONOS Y LA EMPRESA NO SE EXIGEN. Pedido textual del cliente.
  eq('⭐ el teléfono no se exige', C.validarContacto({ ...base, telefono1: '', telefono2: '' }, TODOS), null);
  eq('⭐ la empresa tampoco', C.validarContacto({ ...base, companyId: '' }, TODOS), null);

  // ⭐ LA CÉDULA SÍ, SIEMPRE (decisión del cliente, 21-sep-2026). Se había propuesto una
  //    salida —casilla «no la tiene a la mano» + teléfono como llave— y la descartó. Estas
  //    guardas existen para que no se reintroduzca sin darse cuenta.
  ok('⭐ no hay forma de saltarse la cédula con un teléfono',
    !!C.validarContacto({ ...base, cedula: '', telefono1: '04129999999', telefono2: '02129999999' }, TODOS));
  ok('⭐ ni con una bandera que diga que no la tiene', !!C.validarContacto({ ...base, cedula: '', sinCedula: true, telefono1: '04129999999' }, TODOS));
  ok('⭐ ni dejándola en blanco a secas', !!C.validarContacto({ ...base, cedula: '   ' }, TODOS));
  ok('...y el aviso no manda a marcar ninguna casilla', !/casilla/i.test(C.validarContacto({ ...base, cedula: '' }, TODOS)));

  ok('un teléfono con letras no pasa', /números/i.test(C.validarContacto({ ...base, telefono1: '0412-ABC' }, TODOS)));
  ok('un teléfono a medias no pasa', /incompleto/i.test(C.validarContacto({ ...base, telefono1: '0412' }, TODOS)));
  eq('un teléfono con guiones y paréntesis sí', C.validarContacto({ ...base, telefono1: '(0412) 123-4567' }, TODOS), null);
  ok('un nombre larguísimo no pasa', /largo/i.test(C.validarContacto({ ...base, nombre: 'x'.repeat(61) }, TODOS)));
}

// ── 5) LOS POSIBLES REPETIDOS AVISAN, NO TRANCAN ─────────────────────────────
{
  const mismoNombre = C.posiblesDuplicados({ nombre: 'Ana', apellido: 'Rojas' }, TODOS);
  eq('⭐ avisa del que se llama igual', mismoNombre.map((c) => c.id), ['c1']);
  const mismoTel = C.posiblesDuplicados({ nombre: 'Otro', apellido: 'Distinto', telefono1: '0412-111-1111' }, TODOS);
  eq('⭐ y del que tiene el mismo teléfono, escrito como sea', mismoTel.map((c) => c.id), ['c1']);
  eq('no se avisa a sí mismo al corregirse', C.posiblesDuplicados({ nombre: 'Ana', apellido: 'Rojas' }, TODOS, 'c1'), []);
  eq('sin parecidos no avisa nada', C.posiblesDuplicados({ nombre: 'Zoe', apellido: 'Vera' }, TODOS), []);
  // Nadie comparte «nada» con nadie: un formulario en blanco no puede avisar de todos.
  eq('un formulario vacío no señala a toda la agenda', C.posiblesDuplicados({}, TODOS), []);
  // Un teléfono a medias tampoco: emparejaría a media agenda por tres dígitos.
  eq('un teléfono a medias no sirve para emparejar', C.contactosConTelefono(TODOS, '0412'), []);
}

// ── 6) A QUIÉN SE LE COBRA ───────────────────────────────────────────────────
{
  eq('con empresa y preferencia «empresa», paga la empresa', C.cobrarAEfectivo(beto), 'empresa');
  eq('con empresa y preferencia «independiente», paga él', C.cobrarAEfectivo(caro), 'independiente');
  // ⭐ EL CASO QUE DEJARÍA COMIDA SIN COBRAR: la ficha dice «empresa» pero no tiene.
  eq('⭐ sin empresa paga él, diga lo que diga la ficha', C.cobrarAEfectivo(ana), 'independiente');
  eq('sin contacto, nadie paga por nadie', C.cobrarAEfectivo(null), 'independiente');
}

// ── 7) EL BUSCADOR ───────────────────────────────────────────────────────────
{
  eq('sin texto salen todos', C.buscarContactos(TODOS, '').length, 4);
  eq('busca por nombre sin importar mayúsculas', C.buscarContactos(TODOS, 'ANA').map((c) => c.id), ['c1']);
  eq('busca por apellido', C.buscarContactos(TODOS, 'mora').map((c) => c.id), ['c2']);
  // ⭐ NADIE ESCRIBE LOS PUNTOS. Este es el caso que hace útil al buscador.
  eq('⭐ escribiendo 11111111 aparece V-11.111.111', C.buscarContactos(TODOS, '11111111').map((c) => c.id), ['c1']);
  eq('⭐ un pedazo de la cédula también sirve', C.buscarContactos(TODOS, '2222').map((c) => c.id), ['c2']);
  eq('busca por teléfono', C.buscarContactos(TODOS, '3333333').map((c) => c.id), ['c3']);
  eq('lo que no está no aparece', C.buscarContactos(TODOS, 'zzz'), []);
}

// ── 8) LA LISTA Y LOS QUE FALTA COMPLETAR ────────────────────────────────────
{
  eq('los de la lista primero, y ordenados', C.ordenarContactos(TODOS).map((c) => c.id), ['c1', 'c2', 'c3', 'c4']);
  ok('el quitado de la lista se reconoce', !C.contactoActivo(dani) && C.contactoActivo(ana));
  // Con la cédula obligatoria ya no hay nada que «completar después»: esos ayudantes
  // se quitaron para que no quede código muerto prometiendo algo que no puede pasar.
  ok('⭐ ya no existen los ayudantes de «sin cédula»', C.sinCedula === undefined && C.contarSinCedula === undefined);
  eq('nombre completo listo para imprimir', C.nombreDeContacto(beto), 'Beto Mora');
  eq('sin nombre no se imprime vacío', C.nombreDeContacto({ nombre: '', apellido: '' }), 'Sin nombre');
}

// ── 9) LA CANTIDAD: COMO LAS EMPRESAS ────────────────────────────────────────
{
  eq('una comida vale', C.validarCantidadComidas('1'), null);
  eq('⭐ ocho también (pidió para su cuadrilla)', C.validarCantidadComidas('8'), null);
  ok('cero no', /al menos una/i.test(C.validarCantidadComidas('0')));
  ok('en blanco no', /cuántas/i.test(C.validarCantidadComidas('')));
  ok('media comida no', /enteras/i.test(C.validarCantidadComidas('1.5')));
  ok('una letra no', /número/i.test(C.validarCantidadComidas('x')));
  ok('un disparate se frena', /demasiadas/i.test(C.validarCantidadComidas('5000')));
}

// ── 10) EL PUENTE CON LA BASE ────────────────────────────────────────────────
{
  const fd = sinComentarios(leer('src/lib/foodDistributions.ts'));
  // ⭐ LA REGRESIÓN QUE DEJARÍA A LA COCINA SIN REGISTRAR NADA. Mientras el SQL no
  //    corra, esas columnas no existen y PostgREST rechaza el insert ENTERO.
  // Las CUATRO columnas de contacto van dentro del mismo «solo si hay contacto»: fuera
  // de ese bloque, el insert de nómina no puede nombrar ninguna.
  const bloque = (fd.match(/\.\.\.\(input\.contactoId \? \{([\s\S]*?)\} : \{\}\),/) || [])[1] || '';
  ok('⭐ las columnas de contacto solo se mandan si hay contacto',
    /contacto_id: input\.contactoId,/.test(bloque) && /cobrar_a: input\.cobrarA \?\? null,/.test(bloque)
    && /contacto_company_id:/.test(bloque) && /contacto_company_nombre:/.test(bloque));
  ok('...y nunca sueltas en el insert', !/contacto_|cobrar_a:/.test(fd.replace(bloque, '').split('.insert({')[1].split('.select()')[0]));
  // ⭐ LA EMPRESA TAMBIÉN SE CONGELA (Fase 2). Si solo se congelara «a la empresa» pero
  //    no CUÁL, cambiarle la empresa al contacto mudaría sus entregas viejas de factura.
  ok('⭐ la empresa se congela solo cuando se le cobra a ella',
    /contacto_company_id: input\.cobrarA === 'empresa' \? \(input\.contactoCompanyId \?\? null\) : null,/.test(bloque));
  ok('⭐ la cocina manda la empresa del contacto al registrar',
    /contactoCompanyId: esContacto \? \(person\.companyId \?\? null\) : null,/.test(sinComentarios(leer('src/screens/CocinaScreen.tsx'))));
  ok('las entregas de un contacto se leen por SU columna', /\.eq\('contacto_id', contactoId\)/.test(fd));
  ok('falta el SQL se dice con esas palabras', /sql-comida-contactos-2026-09-21\.sql/.test(fd));

  const db = sinComentarios(leer('src/lib/comidaContactosDb.ts'));
  ok('toda escritura cuenta las filas que volvieron', (db.match(/\.select\(/g) ?? []).length >= 4);
  ok('la nómina se compara por los dígitos, no por el texto', /normalizarCedula\(e\?\.cedula\) === d/.test(db));
  ok('⭐ no hay forma de BORRAR un contacto', !/\.delete\(\)/.test(db));
}

// ── 11) LAS PANTALLAS ────────────────────────────────────────────────────────
{
  const coc = sinComentarios(leer('src/screens/CocinaScreen.tsx'));
  ok('⭐ crear contactos exige escritura en Comida (decisión del cliente)',
    /levelMeets\(moduleLevel\('comida'\), 'escritura'\)/.test(coc));
  ok('la nómina se busca ANTES que la agenda', coc.indexOf("from('employees')") < coc.indexOf('contactoConCedula(contactos, ci)'));
  ok('⭐ o es de nómina o es de la agenda, nunca las dos', /employeeId: esContacto \? null : person\.id/.test(coc));
  ok('⭐ a quién se le cobra se congela en la entrega', /cobrarA: esContacto \? \(person\.cobrarA \?\? 'independiente'\) : null/.test(coc));
  ok('⭐ el candado de «una por día» NO le aplica al contacto', /if \(!esContacto && doneMeal\(mealType\)\)/.test(coc));
  ok('...y el botón tampoco se tranca', /const trancado = !person\.contactoId && !!done/.test(coc));
  // Regresión atrapada al escribirlo: el refresco en vivo vaciaba la lista del
  // contacto abierto, porque su id no es un employee_id.
  ok('⭐ el refresco en vivo lee la columna correcta', /person\.contactoId\s*\n?\s*\? listForContactoDay\(person\.contactoId, today\)/.test(coc));
  ok('la cantidad se valida antes de guardar', /validarCantidadComidas\(cantidad\)/.test(coc));
  ok('sin la tabla se avisa y no se ofrece crear', /sinTablaContactos \?/.test(coc));

  const form = sinComentarios(leer('src/components/ContactoCocinaForm.tsx'));
  // ⭐ PEDIDO TEXTUAL: «que sea opcional sin que diga que es opcional».
  ok('⭐ en el formulario no aparece la palabra «opcional»', !/opcional/i.test(form));
  // ⭐ Y la casilla de escape NO vuelve: ni el interruptor, ni el campo apagado.
  ok('⭐ el formulario no tiene casilla de «no la tiene a la mano»', !/No la tiene a la mano/.test(form) && !/setSinCed/.test(form));
  ok('...y el campo de la cédula nunca se apaga', !/editable=\{!sinCed\}/.test(form));
  ok('la cédula se revisa con espera y con turno', /setTimeout\(/.test(form) && /turno\.current === mio/.test(form));
  ok('⭐ si no se pudo consultar la nómina, NO se dice «libre»', /if \(turno\.current === mio\) setHallazgo\(null\)/.test(form));
  ok('estando en nómina el botón de guardar no se puede tocar', /disabled=\{guardando \|\| esDeNomina/.test(form));
  ok('con parecidos hace falta un segundo toque', /parecidos\.length > 0 && !confirmar/.test(form));
  ok('⭐ y ese segundo toque caduca si cambian los datos', /useEffect\(\(\) => \{ setConfirmar\(false\); \}, \[nombre, apellido, tel1, tel2\]\)/.test(form));

  const tab = sinComentarios(leer('src/components/CobroComidasContactos.tsx'));
  ok('la pestaña tiene buscador', /buscarContactos\(contactos, busqueda\)/.test(tab));
  ok('⭐ quitar de la lista pide confirmación', /confirmarQuitar !== c\.id/.test(tab));
  ok('⭐ no hay forma de borrar un contacto desde la pantalla', !/borrarContacto|\.delete\(/.test(tab));
  ok('⭐ la pestaña ya no promete completar cédulas después', !/contarSinCedula|sin cédula/i.test(tab));
  ok('cambiar a quién se le cobra dice que lo viejo no cambia', /Lo ya entregado no cambia/.test(tab));

  const precios = sinComentarios(leer('src/components/CobroComidasPrecios.tsx'));
  ok('la pestaña está enganchada', /pestana === 'contactos'/.test(precios) && /📇 Contactos/.test(leer('src/components/CobroComidasPrecios.tsx')));
  ok('la agenda se lee junto con los precios, no aparte', /cargarContactos\(\),/.test(precios));
}

// ── 12) MANUALES ─────────────────────────────────────────────────────────────
{
  ok('manual (md) explica los contactos', /📇 Contactos de cocina \(21\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) explica los contactos', /📇 CONTACTOS DE COCINA \(21\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-comida-contactos · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
