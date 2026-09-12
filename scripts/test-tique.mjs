/*
 * Test de la TIQUETERA DE VIAJES (12-sep-2026).
 *
 * Pedido del cliente: que al marcar el viaje se de un tique, que traiga la
 * PLACA, la EMPRESA y el CDT donde se imprimio, y que quede constancia de los
 * tiques que se entregaron.
 *
 * Lo que fija, y por que duele si se rompe:
 *   · el FOLIO no se inventa nunca — un viaje en cola o anterior a la tiquetera
 *     NO tiene tique, y mostrar un numero provisional hace que alguien lo cante
 *     por radio y despues no exista
 *   · manda LO CONGELADO sobre el catalogo — el papel firmado en el CDT no puede
 *     dejar de coincidir con su reimpresion porque alguien corrigio una ficha
 *   · la placa cae al SERIAL — cuatro camiones de la flota no tienen placa y el
 *     cliente pidio que la placa salga en el tique
 *   · el insert baja de escalon si falta una columna — si no, entre el
 *     despliegue y el SQL el listero no podria registrar NI UN VIAJE
 *
 * Sin framework (el repo no tiene): transpila el .ts en memoria con `typescript`.
 *
 *   node scripts/test-tique.mjs
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
const ok = (nombre, cond) => {
  if (cond) { pass++; return; }
  fail++; failures.push(`✗ ${nombre}`);
};
const eq = (nombre, a, b) => {
  const iguales = JSON.stringify(a) === JSON.stringify(b);
  if (iguales) { pass++; return; }
  fail++; failures.push(`✗ ${nombre}\n    obtenido: ${JSON.stringify(a)}\n    esperado: ${JSON.stringify(b)}`);
};

const {
  datosDelCamion, placaDeTique, empresaDeTique, folioDeTique, tieneTique, SIN_DATO, SIN_TIQUE,
} = cargar('src/lib/tique.ts');

// ── 1) QUE SE CONGELA AL REGISTRAR ──────────────────────────────────────────
eq('un camion con placa congela su placa',
  datosDelCamion({ plate: 'A31KM7B', serial: 'X1', companyName: 'GOLDEN TOUCH 1127 CA' }),
  { placa: 'A31KM7B', empresa: 'GOLDEN TOUCH 1127 CA' });

// Cuatro camiones de la flota no tienen placa cargada (177 viajes entre ellos) y
// el cliente pidio que la placa salga en el tique. Con el serial el papel sigue
// identificando la unidad; con una raya no identifica nada.
eq('sin placa cae al serial',
  datosDelCamion({ plate: null, serial: 'G180522096', companyName: 'COSTA BRAVA' }),
  { placa: 'G180522096', empresa: 'COSTA BRAVA' });

eq('sin placa ni serial se congela null, no una raya',
  datosDelCamion({ plate: '', serial: '   ', companyName: 'SAVANNA' }),
  { placa: null, empresa: 'SAVANNA' });

// La empresa sale igual aunque no haya placa: es lo que el cliente dijo que
// basta para saber cual camion es.
ok('la empresa sale aunque no haya placa',
  datosDelCamion({ plate: null, serial: null, companyName: 'SAVANNA' }).empresa === 'SAVANNA');

// Un camion FUERA DE CATALOGO no tiene ficha: solo la sena que anoto el listero.
eq('fuera de catalogo guarda la sena del listero',
  datosDelCamion(null, '  volteo azul sin placa  '),
  { placa: 'volteo azul sin placa', empresa: null });
eq('fuera de catalogo sin sena no inventa nada',
  datosDelCamion(null, ''), { placa: null, empresa: null });

// ── 2) QUE SE IMPRIME ───────────────────────────────────────────────────────
const FICHA = { plate: 'NUEVA123', serial: 'SER9', companyName: 'EMPRESA DE HOY' };

// ⭐ EL GUARDA MAS IMPORTANTE DEL ARCHIVO. El papel que firmo el CDT dice
//    VIEJA999. Si al reimprimirlo saliera NUEVA123 porque alguien corrigio la
//    ficha, los dos papeles no coincidirian y no habria manera de saber cual
//    miente.
eq('manda lo congelado sobre el catalogo',
  placaDeTique({ placa: 'VIEJA999' }, FICHA), 'VIEJA999');
eq('...y tambien con la empresa',
  empresaDeTique({ empresa: 'EMPRESA DE ENTONCES' }, FICHA), 'EMPRESA DE ENTONCES');

// Los viajes anteriores a la tiquetera no congelaron nada: ahi si manda el
// catalogo, que es lo que se hacia siempre.
eq('un viaje viejo se resuelve del catalogo', placaDeTique({}, FICHA), 'NUEVA123');
eq('...y su empresa tambien', empresaDeTique({}, FICHA), 'EMPRESA DE HOY');

eq('sin placa en el catalogo cae al serial',
  placaDeTique({}, { plate: null, serial: 'SER9' }), 'SER9');
eq('y si tampoco, a la sena del listero',
  placaDeTique({ camionRef: 'el amarillo' }, { plate: null, serial: null }), 'el amarillo');
eq('cuando no hay nada, una raya y no un texto inventado',
  placaDeTique({}, null), SIN_DATO);
eq('la empresa igual', empresaDeTique({}, null), SIN_DATO);

// Un texto en blanco no es un dato: tiene que caer al siguiente escalon.
eq('los espacios en blanco no cuentan como placa',
  placaDeTique({ placa: '   ' }, FICHA), 'NUEVA123');

// ── 3) EL FOLIO NO SE INVENTA ───────────────────────────────────────────────
eq('un viaje con folio lo muestra', folioDeTique({ folio: 'CDT-000418' }), 'CDT-000418');
ok('...y se puede imprimir', tieneTique({ folio: 'CDT-000418' }) === true);

// ⚠️ Un viaje en la cola offline todavia NO llego al servidor, y el folio lo pone
//    la base. No hay tique que entregar. Si la pantalla mostrara un numero
//    provisional, alguien lo cantaria por radio y despues no existiria.
eq('un viaje sin folio lo dice, no inventa un numero', folioDeTique({}), SIN_TIQUE);
eq('...ni con folio vacio', folioDeTique({ folio: '  ' }), SIN_TIQUE);
ok('y no se puede imprimir', tieneTique({}) === false);
ok('...ni con folio en blanco', tieneTique({ folio: '' }) === false);

// El folio nunca se calcula en el cliente: si esta libreria supiera armar uno,
// dos listeros que registran en el mismo segundo se llevarian el mismo numero.
const libTique = leer('src/lib/tique.ts');
ok('la libreria NO sabe fabricar folios', !/CDT-\$\{|lpad|padStart/.test(sinComentarios(libTique)));
ok('la libreria es pura: no importa nada', !/^\s*import\s/m.test(sinComentarios(libTique)));

// ── 4) GUARDAS SOBRE EL CODIGO ──────────────────────────────────────────────
const lib = sinComentarios(leer('src/lib/camionViajes.ts'));
const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));

// ⭐ EL FOLIO LO PONE LA BASE. Si la app lo mandara, dos listeros registrando en
//    el mismo segundo se llevarian el mismo numero.
// El guarda mira SOLO el cuerpo de `registrarViaje`: en `mapRow` la palabra
// `folio` sí aparece, y ahí es correcta porque eso es LEER, no escribir.
{
  const i = lib.indexOf('export async function registrarViaje');
  const cuerpo = i >= 0 ? lib.slice(i, lib.indexOf('function porFechaDesc', i)) : '';
  ok('la app NUNCA manda el folio en el insert', cuerpo.length > 0 && !/folio/.test(cuerpo));
}
ok('...pero si manda la placa y la empresa congeladas',
  /placa_snap: params\.placa \?\? null/.test(lib) && /empresa_snap: params\.empresa \?\? null/.test(lib));

// Las tres columnas nuevas se leen, y con su respaldo por si el SQL no se corrio.
ok('se piden las columnas del tique', /COLS_TIQUE = 'folio, placa_snap, empresa_snap'/.test(lib));
ok('hay interruptor propio para la tiquetera', /let hayColumnasDeTique: boolean \| null = null;/.test(lib));
// Dos interruptores y no uno: hubo una base CON obras y SIN tique, y con un
// interruptor unico esa base perderia tambien las obras, que si estan.
ok('...separado del de las obras', /let hayColumnasDeObra: boolean \| null = null;/.test(lib));
ok('la lectura baja un escalon antes de rendirse',
  /selectAllRows\('camion_viajes', `\$\{SELECT_COLS\}, \$\{COLS_OBRA\}`, filtro\)/.test(lib));
ok('la pantalla puede avisar que falta el SQL del tique', /export function faltaCorrerSqlDeTique/.test(lib));

// Los DOS caminos por los que entra un viaje congelan la placa y la empresa. Si
// solo lo hiciera uno, la mitad de los tiques saldria sin placa.
eq('los dos caminos de registro congelan placa y empresa',
  (scr.match(/\.\.\.datosDelCamion\(/g) || []).length, 2);

// La fila del listero muestra lo que va IMPRESO, no lo que diga el catalogo hoy.
ok('la fila muestra la placa y la empresa del tique',
  /Placa \$\{placaDeTique\(row, truck\)\} · \$\{empresaDeTique\(row, truck\)\}/.test(scr));
ok('el folio se ve como pastilla', /tieneTique\(row\) \? <Badge label=\{`🎫 \$\{folioDeTique\(row\)\}`\}/.test(scr));
// Y NO se ve cuando no existe: es la mitad del guarda anterior, y la que duele.
ok('...y NO se ve cuando el viaje no tiene tique', /tieneTique\(row\) \?/.test(scr) && !/folioDeTique\(row\) \|\|/.test(scr));

// Un viaje que sigue en la cola no puede llegar con folio a la pantalla.
ok('los viajes en cola se pintan sin folio', (scr.match(/folio: null,/g) || []).length === 2);

// ── 5) EL MANUAL CUENTA LO MISMO ────────────────────────────────────────────
const md = leer('docs/MANUAL-USUARIO.md');
const ms = leer('src/screens/ManualScreen.tsx');
ok('el manual .md explica el numero de tique', /Cada viaje tiene su número de tique \(12\/09\/2026\)/.test(md));
ok('...y avisa que sin senal no hay numero', /Un viaje sin señal NO tiene número todavía/i.test(md));
ok('...y que los viajes viejos no se numeran', /no tienen número, y no se les va a poner/i.test(md));
ok('el manual en pantalla tambien lo explica', /CADA VIAJE TIENE SU NÚMERO DE TIQUE \(12\/09\/2026\)/.test(ms));
ok('...y dice que la placa y la empresa quedan congeladas', /LA PLACA Y LA EMPRESA QUEDAN CONGELADAS EN EL VIAJE/.test(ms));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-tique · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
