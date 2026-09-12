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

// ── 5) QUE SALE EN EL TIQUE: LA CONFIGURACION ───────────────────────────────
const {
  CONFIG_POR_DEFECTO, CAMPOS_TIQUE, LOGOS_TIQUE, PAPELES, CAMPO_FIJO,
  normalizarConfig, cambiosRespectoAlDefecto, resumenConfig,
} = cargar('src/lib/tiqueConfig.ts');

// Los seis que el cliente pidio, y NADA mas. Si esto cambia, el papel de todos
// cambia de forma sin que nadie lo haya pedido.
eq('de fabrica salen encendidos exactamente seis datos',
  Object.keys(CONFIG_POR_DEFECTO.campos).filter((k) => CONFIG_POR_DEFECTO.campos[k]).sort(),
  ['cdt', 'empresa', 'fecha', 'folio', 'hora', 'placa']);
eq('y dos logos', Object.keys(CONFIG_POR_DEFECTO.logos).filter((k) => CONFIG_POR_DEFECTO.logos[k]).sort(),
  ['goldenTouch', 'sos']);
eq('un tique por hoja carta', CONFIG_POR_DEFECTO.papel, 'carta1');
eq('sin tocar nada, cero cambios', cambiosRespectoAlDefecto(CONFIG_POR_DEFECTO), 0);

// La pantalla y el papel tienen que ofrecer lo MISMO: un campo que salga en la
// lista y no en la configuracion es un interruptor que no existe.
eq('la lista de campos cubre todas las claves',
  CAMPOS_TIQUE.map((c) => c.k).sort(), Object.keys(CONFIG_POR_DEFECTO.campos).sort());
eq('y la de logos tambien',
  LOGOS_TIQUE.map((l) => l.k).sort(), Object.keys(CONFIG_POR_DEFECTO.logos).sort());
ok('estan los seis papeles, con rollo y con hoja',
  PAPELES.length === 6 && PAPELES.some((p) => p.k === 'rollo80') && PAPELES.some((p) => p.k === 'carta6'));

// ⭐ EL TROPIEZO QUE YA COSTO UNA PRUEBA EN EL CUBICAJE. Una fila guardada ANTES
//    de que existiera un campo no trae esa clave. Leerla cruda da `undefined`,
//    que en un `if` parece apagado pero en un interruptor se ve como una casilla
//    rota. Tiene que entrar con su valor de fabrica sin pisar lo ya marcado.
{
  const vieja = normalizarConfig({ campos: { folio: true, fecha: false }, logos: { sos: false }, papel: 'rollo80' });
  eq('un campo que no estaba entra con su valor de fabrica', vieja.campos.jornada, false);
  eq('...y lo que el admin ya habia marcado no se pisa', vieja.campos.fecha, false);
  eq('...ni sus logos', vieja.logos.sos, false);
  eq('...ni su papel', vieja.papel, 'rollo80');
  eq('los logos que no venian toman el de fabrica', vieja.logos.goldenTouch, true);
}

// ⚠️ EL FOLIO NO SE PUEDE APAGAR. Un tique sin numero no identifica nada y no se
//    puede reclamar. Ni desde la pantalla ni escribiendo en la tabla a mano.
eq('el campo fijo es el folio', CAMPO_FIJO, 'folio');
eq('apagar el folio en la base no apaga el folio',
  normalizarConfig({ campos: { folio: false } }).campos.folio, true);

// Basura en la tabla no puede dejar la pantalla en blanco.
eq('sin nada guardado se usa lo de fabrica', normalizarConfig(null), CONFIG_POR_DEFECTO);
eq('un papel inventado cae al de fabrica', normalizarConfig({ papel: 'papiro' }).papel, 'carta1');
eq('un campo que no es booleano se ignora', normalizarConfig({ campos: { fecha: 'si' } }).campos.fecha, true);

// El encabezado plegado tiene que decir que hay dentro sin abrirlo.
ok('el resumen dice datos, logos y papel',
  /6 dato\(s\) · 2 logo\(s\) · 1 por hoja/.test(resumenConfig(CONFIG_POR_DEFECTO)));

// Guardas sobre la pantalla de configuracion.
const card = sinComentarios(leer('src/components/TiqueConfigCard.tsx'));
ok('la configuracion se guarda en la BASE, no en el telefono',
  /guardarConfigTique\(config, uid\)/.test(card) && !/AsyncStorage|localStorage/.test(card));
// Guardar en cada clic manda quince escrituras mientras alguien decide, y deja
// el formato a medio cambiar si se cae la senal en el medio.
ok('se guarda al tocar Guardar, no a cada clic', /onPress=\{guardar\}/.test(card));
ok('...y avisa mientras hay cambios sin guardar', /Tienes cambios sin guardar/.test(card));
ok('la vista previa se arma de la MISMA config', /CAMPOS_TIQUE\.filter\(\(c\) => config\.campos\[c\.k\]\)/.test(card));
ok('el folio se ve pero no se deja tocar', /c\.k === CAMPO_FIJO \?/.test(card));
ok('avisa si falta correr el SQL', /Falta correr el SQL de la tiquetera/.test(card));
ok('y ahi el boton de guardar se apaga', /disabled=\{!sucio \|\| ocupado \|\| sinTabla\}/.test(card));
ok('la tarjeta esta montada en el panel', /<TiqueConfigCard uid=\{uid\} \/>/.test(scr));

// ⭐ LAS REGLAS SON PURAS Y EL ACCESO A DATOS VA APARTE, igual que el cubicaje.
//    Si tiqueConfig.ts importara supabase, esta prueba no podria correrlo y las
//    reglas del papel se quedarian sin red.
const libConfig = leer('src/lib/tiqueConfig.ts');
ok('las reglas del tique NO importan nada', !/^\s*import\s/m.test(sinComentarios(libConfig)));
const datosConfig = sinComentarios(leer('src/lib/tiqueConfigDatos.ts'));
ok('el acceso a datos solo conoce su tabla', /const TABLA = 'tique_config'/.test(datosConfig));
ok('...y no escribe en camion_viajes ni en machinery',
  !/from\('camion_viajes'\)/.test(datosConfig) && !/from\('machinery'\)/.test(datosConfig));
// Guardar normaliza otra vez: asi el folio no se puede apagar ni mandando la
// fila a mano desde otro sitio.
ok('al guardar se vuelve a normalizar', /const limpia = normalizarConfig\(c\);/.test(datosConfig));
ok('reconoce «esa tabla no existe» por sus tres formas',
  /42p01/.test(datosConfig) && /pgrst205/.test(datosConfig) && /does not exist/.test(datosConfig));

// ── 6) BORRAR UN VIAJE ──────────────────────────────────────────────────────
// Pedido del cliente: «no me deja eliminar los viajes, admins deberian poder».
// El tacho estaba SOLO en la lista completa, asi que quien registraba un viaje
// de prueba no tenia como quitarlo desde donde lo veia.
ok('con full se puede borrar desde Mis viajes',
  /canDelete: canFull && !row\.queued,/.test(scr));
// ⚠️ Y para el listero sigue apagado: si el pudiera borrar los suyos, podria
//    sacar trabajo de la jornada que le estan revisando.
ok('...pero un viaje en cola no, porque todavia no existe en el servidor',
  /canDelete: canFull && !row\.queued,/.test(scr));
ok('la lista completa sigue permitiendo borrar',
  /canEdit: true, canDelete: true, showListero: true/.test(scr));

// ── 7) EL MANUAL CUENTA LO MISMO ────────────────────────────────────────────
const md = leer('docs/MANUAL-USUARIO.md');
const ms = leer('src/screens/ManualScreen.tsx');
ok('el manual .md explica el numero de tique', /Cada viaje tiene su número de tique \(12\/09\/2026\)/.test(md));
ok('...y avisa que sin senal no hay numero', /Un viaje sin señal NO tiene número todavía/i.test(md));
ok('...y que los viajes viejos no se numeran', /no tienen número, y no se les va a poner/i.test(md));
ok('el manual en pantalla tambien lo explica', /CADA VIAJE TIENE SU NÚMERO DE TIQUE \(12\/09\/2026\)/.test(ms));
ok('...y dice que la placa y la empresa quedan congeladas', /LA PLACA Y LA EMPRESA QUEDAN CONGELADAS EN EL VIAJE/.test(ms));
ok('el manual .md explica el configurador', /Tú decides qué sale en el tique \(12\/09\/2026\)/.test(md));
ok('...y avisa que el folio no se quita', /El número del tique no se puede quitar/i.test(md));
ok('...y que vale para todos, no por telefono', /No es una preferencia de tu teléfono/i.test(md));
ok('el manual .md explica el borrado desde Mis viajes', /Borrar un viaje desde «Mis viajes» \(12\/09\/2026\)/.test(md));
ok('...y que para el listero sigue apagado', /Para el listero sigue apagado/i.test(md));
ok('el manual en pantalla explica el configurador', /TÚ DECIDES QUÉ SALE EN EL TIQUE \(12\/09\/2026\)/.test(ms));
ok('...y el borrado', /BORRAR UN VIAJE DESDE "MIS VIAJES" \(12\/09\/2026\)/.test(ms));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-tique · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
