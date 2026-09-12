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

/**
 * Carga un .ts transpilandolo en memoria.
 *
 * ⭐ SIGUE LOS IMPORTS RELATIVOS. Sin esto, una libreria pura que importe otra
 *    libreria pura no se puede probar, y la salida era partir el archivo o
 *    duplicar constantes — que es justo lo que hace que la pantalla y el papel
 *    dejen de coincidir. Lo que NO resuelve es un import de node_modules ni de
 *    './supabase': eso sigue reventando a proposito, para que nadie meta acceso
 *    a la base dentro de una libreria de reglas.
 */
const cacheTs = new Map();
function cargar(rel) {
  const p = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (cacheTs.has(p)) return cacheTs.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  // Se cachea ANTES de compilar: si dos archivos se importan entre si, el
  // segundo encuentra el objeto a medio llenar en vez de entrar en bucle.
  cacheTs.set(p, m.exports);
  m.require = (spec) => {
    if (spec.startsWith('.')) {
      const base = path.resolve(path.dirname(p), spec);
      for (const cand of [base + '.ts', base + '.tsx', path.join(base, 'index.ts')]) {
        if (fs.existsSync(cand)) return cargar(cand);
      }
    }
    return require(spec);
  };
  m._compile(js, p);
  cacheTs.set(p, m.exports);
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
  datosDelCamion({ plate: null, serial: 'X1111X1111', companyName: 'COSTA BRAVA' }),
  { placa: 'X1111X1111', empresa: 'COSTA BRAVA' });

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
// ⭐ LA VISTA PREVIA Y EL PAPEL SE ARMAN CON LA MISMA FUNCION. Si fueran dos
//    listas, el admin marcaria los checks mirando una cosa y saldria impresa
//    otra, y se daria cuenta cuando ya hubiera entregado doscientos tiques.
ok('la vista previa se arma con el MISMO armador que el papel',
  /renglonesDelTique\(EJEMPLO, config\)/.test(card));
ok('...y ya no tiene su propia lista de campos',
  !/CAMPOS_TIQUE\.filter/.test(card));
// El ejemplo guarda VALORES, no etiquetas: las etiquetas salen de CAMPOS_TIQUE,
// las mismas que imprime el papel.
ok('el ejemplo no trae etiquetas propias',
  /const EJEMPLO: Record<ClaveCampo, string>/.test(card));

// ⚠️ EL REPOSITORIO ES PUBLICO. Una placa o un serial de la flota escritos aca
//    como «ejemplo» quedan publicados, y ya paso: dos seriales REALES se
//    colaron en la vista previa y en esta misma prueba, y estuvieron subidos.
//
//    La regla: un serial de ejemplo o es CORTO (hasta 4 caracteres, o sea que
//    no puede ser uno de verdad) o esta escrito con pura X y ceros y unos, que
//    se reconoce de un vistazo. Un serial de la flota —diez caracteres con
//    letras y digitos variados— no pasa ninguna de las dos.
const serialInventado = (v) => v.trim().length <= 4 || /^[A-Z]?[X01]+$/.test(v.trim());
const serialesEscritos = [...(card + leer('scripts/test-tique.mjs')).matchAll(/serial:\s*'([^']*)'/g)]
  .map((m) => m[1]).filter((v) => v.trim().length > 0);
ok('hay seriales de ejemplo que revisar', serialesEscritos.length >= 3);
ok('...y TODOS son inventados, ninguno de la flota', serialesEscritos.every(serialInventado));
// Con la FORMA de uno real (diez caracteres, letras y digitos variados), pero
// inventado a mano: si esta linea pasara, la guarda no estaria mirando nada.
ok('la guarda cazaria uno con forma de serial de verdad', !serialInventado('Q9876Z5432'));
ok('el folio se ve pero no se deja tocar', /c\.k === CAMPO_FIJO \?/.test(card));
ok('avisa si falta correr el SQL', /Falta correr el SQL de la tiquetera/.test(card));
ok('y ahi el boton de guardar se apaga', /disabled=\{!sucio \|\| ocupado \|\| sinTabla\}/.test(card));
ok('la tarjeta esta montada en el panel', /<TiqueConfigCard uid=\{uid\}/.test(scr));
// ⚠️ Al cambiar el formato, la pantalla que IMPRIME tiene que enterarse. Sin
//    este aviso el primer tique despues de guardar sale con el formato viejo y
//    parece que el guardado no funciono.
ok('...y le avisa a la pantalla cuando se guarda',
  /<TiqueConfigCard uid=\{uid\} onGuardado=\{setConfigTique\} \/>/.test(scr));
ok('la tarjeta llama a onGuardado despues de guardar bien',
  /onGuardado\?\.\(config\);/.test(card));

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

// ── 8) EL PAPEL QUE SE IMPRIME ──────────────────────────────────────────────
//
// Pedido del cliente: «cuando marcan el viaje, deben dar el ticket».
const {
  renglonesDelTique, documentoDeTiques, htmlDeUnTique, enHojas, hojasQueSalen,
  medioDeImpresion, nombreArchivoTiques, escapar, MEDIDAS, SIN_DATO_PAPEL,
} = cargar('src/lib/tiqueDocumento.ts');

const cfg = (extra) => normalizarConfig({ ...CONFIG_POR_DEFECTO, ...extra });
const DATOS = {
  folio: 'CDT-000418', fecha: '14/09/2026', hora: '08:42 a. m.',
  placa: 'A31KM7B', empresa: 'GOLDEN TOUCH 1127 CA', cdt: 'CDT Parque del Agua',
  jornada: '14/09/2026', turno: 'Dia', codigo: 'CAMION VOLTEO TORONTO',
  marcaModelo: 'IVECO EUROTRAKKER', serial: 'X0000X0000', chofer: 'Un chofer',
  listero: 'Un listero', m3: '16,82 m3', estado: 'Operativa', nota: 'Sin nota',
};
const APAGADO = (k) => cfg({ campos: { ...CONFIG_POR_DEFECTO.campos, [k]: false } });
const ENCENDIDO = (k) => cfg({ campos: { ...CONFIG_POR_DEFECTO.campos, [k]: true } });

// Los seis de fabrica, en el orden en que estan en CAMPOS_TIQUE.
eq('el papel de fabrica trae los seis campos que pidio el cliente',
  renglonesDelTique(DATOS, CONFIG_POR_DEFECTO).map((r) => r.k),
  ['Tique', 'Fecha', 'Hora', 'Placa', 'Empresa', 'CDT']);

// Apagar un check tiene que quitar el renglon del PAPEL, no solo de la pantalla.
ok('apagar la placa la saca del papel',
  !renglonesDelTique(DATOS, APAGADO('placa')).some((r) => r.k === 'Placa'));
// ⚠️ El folio no se puede apagar ni escribiendo la fila a mano en la base. Lo
//    impide normalizarConfig, que es por donde pasa TODA config antes de
//    llegar al papel: la lee de la base y la vuelve a limpiar al guardarla.
ok('el folio no se puede apagar ni desde la BD',
  renglonesDelTique(DATOS, APAGADO('folio'))[0].k === 'Tique');
ok('...y lo que lo impide es normalizarConfig, no el papel',
  normalizarConfig({ campos: { folio: false } }).campos.folio === true);

// ⚠️ UNA CLAVE QUE NO EXISTE ES UN CAMPO APAGADO, no uno encendido.
//    Una fila guardada ANTES de que se agregara un campo no trae esa clave. Si
//    el papel la tratara como encendida, el dia que se agregue el campo 17
//    todos los tiques ya configurados empezarian a sacar un renglon nuevo con
//    una raya, sin que nadie lo haya pedido. Es el caso normal, no el raro.
eq('una clave que falta no saca renglon',
  renglonesDelTique(DATOS, { campos: { folio: true }, logos: {}, papel: 'carta1' }).map((r) => r.k),
  ['Tique']);

// Encender la jornada la trae al papel: es lo que el cliente pidio agregar.
ok('la jornada se puede encender',
  renglonesDelTique(DATOS, ENCENDIDO('jornada')).some((r) => r.k === 'Jornada'));

// ⚠️ UN CAMPO ENCENDIDO SIN DATO SALE CON RAYA, NO DESAPARECE. Con 2, 4 o 6
//    tiques por hoja los recuadros tienen que medir todos igual, o las lineas
//    de corte dejan de cuadrar entre columnas.
eq('un campo encendido sin dato sale con raya',
  renglonesDelTique({ folio: 'CDT-1' }, CONFIG_POR_DEFECTO).map((r) => r.v),
  ['CDT-1', SIN_DATO_PAPEL, SIN_DATO_PAPEL, SIN_DATO_PAPEL, SIN_DATO_PAPEL, SIN_DATO_PAPEL]);
eq('...y un dato en blanco tambien',
  renglonesDelTique({ folio: 'X', fecha: '   ' }, CONFIG_POR_DEFECTO)[1].v, SIN_DATO_PAPEL);

// La cantidad de renglones NO cambia con los datos: solo con la configuracion.
ok('todos los tiques miden lo mismo aunque falten datos',
  renglonesDelTique({}, CONFIG_POR_DEFECTO).length === renglonesDelTique(DATOS, CONFIG_POR_DEFECTO).length);

// ⭐ LA NOTA Y EL CHOFER LOS ESCRIBE UNA PERSONA EN UN TELEFONO. Un '<' suelto
//    rompe el documento callado y el tique sale a medias o en blanco, y eso no
//    se nota hasta que ya se entrego.
eq('escapa los cinco de siempre',
  escapar('<b>&"' + String.fromCharCode(39)), '&lt;b&gt;&amp;&quot;&#39;');
const conNota = htmlDeUnTique(
  { datos: { ...DATOS, nota: '<script>x</script>' } }, ENCENDIDO('nota'), {});
ok('la nota del listero no puede meter etiquetas en el papel', !/<script>/.test(conNota));
ok('...pero el texto se sigue leyendo', /&lt;script&gt;/.test(conNota));

// ⭐ LA REIMPRESION TIENE QUE SALIR EN EL PAPEL, no solo en la base. Dos papeles
//    con el mismo numero en el patio se cuentan como dos viajes al cobrar, y la
//    base no esta en el patio.
ok('una reimpresion se marca en el papel',
  /Reimpresi/.test(htmlDeUnTique({ datos: DATOS, reimpresion: true }, CONFIG_POR_DEFECTO, {})));
ok('...y la primera impresion NO lleva esa marca',
  !/Reimpresi/.test(htmlDeUnTique({ datos: DATOS }, CONFIG_POR_DEFECTO, {})));

// El numero grande arriba es lo que se canta por radio y lo que se busca en un
// fajo de cincuenta.
ok('el folio sale grande arriba del todo',
  /class="folio">CDT-000418</.test(htmlDeUnTique({ datos: DATOS }, CONFIG_POR_DEFECTO, {})));
ok('y tambien firma el que recibe',
  /Recib/.test(htmlDeUnTique({ datos: DATOS }, CONFIG_POR_DEFECTO, {})));

// ── Los logos ──
const URIS = { sos: 'data:image/png;base64,AAA', goldenTouch: 'data:image/png;base64,BBB', renace: 'data:image/png;base64,CCC' };
const conLogos = htmlDeUnTique({ datos: DATOS }, CONFIG_POR_DEFECTO, URIS);
ok('salen los logos encendidos', (conLogos.match(/<img /g) || []).length === 2);
ok('no sale el que esta apagado', !/CCC/.test(conLogos));
// ⚠️ Un cuadrito con una cruz en un tique oficial hace dudar del tique entero.
ok('un logo encendido sin archivo NO deja un icono roto',
  !/<img /.test(htmlDeUnTique({ datos: DATOS }, CONFIG_POR_DEFECTO, {})));
ok('...y si no hay ninguno, tampoco queda el hueco',
  !/class="logos"/.test(htmlDeUnTique({ datos: DATOS }, CONFIG_POR_DEFECTO, {})));

// ── El papel y cuantos entran ──
eq('rollo: un tique por corte', enHojas([1, 2, 3], 'rollo80').length, 3);
eq('carta1: una hoja cada uno', enHojas([1, 2, 3], 'carta1').length, 3);
eq('carta2: dos por hoja', enHojas([1, 2, 3], 'carta2'), [[1, 2], [3]]);
eq('carta4: cuatro por hoja', enHojas([1, 2, 3, 4, 5], 'carta4'), [[1, 2, 3, 4], [5]]);
eq('carta6: seis por hoja', enHojas([1, 2, 3, 4, 5, 6, 7], 'carta6'), [[1, 2, 3, 4, 5, 6], [7]]);
eq('sin tiques no hay hojas', enHojas([], 'carta6'), []);

// Se le dice ANTES de mandar: nadie quiere enterarse de que eran 60 hojas
// cuando ya estan saliendo.
eq('20 tiques de 6 por hoja son 4 hojas', hojasQueSalen(20, 'carta6'), 4);
eq('12 tiques de 6 por hoja son 2 hojas justas', hojasQueSalen(12, 'carta6'), 2);
eq('ninguno son cero hojas', hojasQueSalen(0, 'carta2'), 0);
eq('uno solo es una hoja', hojasQueSalen(1, 'carta6'), 1);

// «Lo saco la tiquetera en el momento» y «lo sacaron en hoja para repartir
// despues» son dos formas distintas de entregar, y hay que poder distinguirlas.
eq('el rollo se anota como tiquetera', medioDeImpresion('rollo58'), 'tiquetera');
eq('la carta se anota como hoja', medioDeImpresion('carta4'), 'hoja');

// Las opciones que pidio el cliente siguen existiendo.
ok('estan los seis papeles', Object.keys(MEDIDAS).length === 6);
ok('los rollos no tienen alto fijo: el tique termina donde termina',
  MEDIDAS.rollo80.altoMm === null && MEDIDAS.rollo58.altoMm === null);
ok('las hojas si, para que las lineas de corte cuadren',
  MEDIDAS.carta4.altoMm > 0 && MEDIDAS.carta6.altoMm > 0);
// El ancho del rollo es el papel MENOS los margenes: con el ancho completo la
// tiquetera come el borde derecho de cada renglon.
ok('el ancho del rollo descuenta los margenes',
  MEDIDAS.rollo80.anchoMm < 80 && MEDIDAS.rollo58.anchoMm < 58);

// ── El documento entero ──
const tres = [{ datos: DATOS }, { datos: { ...DATOS, folio: 'CDT-2' } }, { datos: { ...DATOS, folio: 'CDT-3' } }];
const docCarta2 = documentoDeTiques(tres, cfg({ papel: 'carta2' }), URIS);
eq('tres tiques de dos por hoja son dos hojas', (docCarta2.match(/class="hoja"/g) || []).length, 2);
eq('...y los tres tiques estan', (docCarta2.match(/class="tq"/g) || []).length, 3);
ok('el documento es uno solo', (docCarta2.match(/<html>/g) || []).length === 1);
// El titulo vacio evita que el navegador imprima su propio encabezado arriba.
ok('el titulo va vacio', /<title><\/title>/.test(docCarta2));

// ⚠️ UN SOLO TAMANO DE PAPEL POR DOCUMENTO: @page no se puede cambiar a mitad.
ok('el rollo de 80 pide 80mm de ancho', /@page\{size:80mm auto/.test(documentoDeTiques(tres, cfg({ papel: 'rollo80' }), {})));
ok('el rollo de 58 pide 58mm', /@page\{size:58mm auto/.test(documentoDeTiques(tres, cfg({ papel: 'rollo58' }), {})));
ok('la hoja pide carta', /@page\{size:letter/.test(documentoDeTiques(tres, cfg({ papel: 'carta4' }), {})));
ok('solo hay UNA regla @page', (documentoDeTiques(tres, cfg({ papel: 'carta4' }), {}).match(/@page\{/g) || []).length === 1);
// En hoja hace falta saber por donde cortar; en rollo corta la maquina.
ok('la hoja lleva linea de corte', /border:1px dashed/.test(documentoDeTiques(tres, cfg({ papel: 'carta4' }), {})));
ok('el rollo no', !/border:1px dashed/.test(documentoDeTiques(tres, cfg({ papel: 'rollo80' }), {})));

eq('un tique suelto lleva su numero en el archivo', nombreArchivoTiques([{ datos: DATOS }]), 'tique-CDT-000418');
eq('un mandado lleva cuantos son', nombreArchivoTiques(tres), 'tiques-3');

// ── 9) GUARDAS SOBRE EL PAPEL Y LA CONSTANCIA ───────────────────────────────
const libDoc = leer('src/lib/tiqueDocumento.ts');
const libDocSC = sinComentarios(libDoc);
// El papel se prueba entero sin red y sin navegador; eso solo se sostiene si no
// importa nada mas que las reglas.
ok('el papel solo importa la configuracion',
  /from '\.\/tiqueConfig'/.test(libDocSC) && !/from '\.\/supabase'/.test(libDocSC) && !/react/i.test(libDocSC));
// TODO dato que entra al documento tiene que pasar por escapar().
ok('ningun dato entra al documento sin escapar',
  !/\$\{(r\.v|r\.k|t\.datos|d\[)/.test(libDocSC));

const libEm = leer('src/lib/tiqueEmisiones.ts');
const libEmSC = sinComentarios(libEm);
ok('la constancia vive en su propia tabla', /const TABLA = 'tique_emisiones'/.test(libEmSC));
// ⭐ ES UN LIBRO, NO UNA TABLA DE TRABAJO. Una constancia que se puede editar
//    despues no es constancia.
ok('nunca se actualiza ni se borra una constancia',
  !/\.update\(/.test(libEmSC) && !/\.delete\(/.test(libEmSC));
// ⚠️ Si la app calculara la reimpresion, dos dispositivos imprimiendo a la vez
//    se declararian los dos «primera vez».
const cuerpoAFila = libEmSC.slice(libEmSC.indexOf('function aFila'), libEmSC.indexOf('function aFila') + 700);
ok('la app NUNCA manda la marca de reimpresion: la pone el trigger',
  cuerpoAFila.length > 100 && !/reimpresion/.test(cuerpoAFila));
ok('la clave de idempotencia si se manda', /client_action_id: e\.clientActionId/.test(libEmSC));
// Una clave duplicada al reintentar NO es un fallo: es lo que la clave tenia
// que provocar.
ok('un reintento repetido se cuenta como subido', /yaEstaba\(error\)/.test(libEmSC));
// Contra una tabla que no existe no se aparta nada: llenaria el telefono de
// basura que nunca va a subir.
ok('sin tabla no se aparta nada en el telefono',
  /if \(faltaLaTabla\(error\)\) \{\s*return \{ guardadas: 0, pendientes: 0, sinTabla: true/.test(libEmSC));

// ── 8b) QUE NO SE CORTE EL PAPEL ────────────────────────────────────────────
//
// ⭐ ESTA SECCION EXISTE POR UN TIQUE CORTADO DE VERDAD. Con los 16 datos
//    encendidos y 4 por hoja, el recuadro se llenaba y el navegador se comia lo
//    que sobraba: se perdian el estado, la nota Y la linea de la firma. Se veia
//    mirando el papel; ninguna prueba de texto lo iba a ver. Ahora la letra se
//    achica sola para que entre, y cuando ni la mas chica alcanza se avisa.
const { altoDelTique, tamanoQueEntra, avisoDeCapacidad, PT_MINIMO, PT_MAXIMO } = cargar('src/lib/tiqueDocumento.ts');
const TODOS = normalizarConfig({
  campos: Object.fromEntries(Object.keys(CONFIG_POR_DEFECTO.campos).map((k) => [k, true])),
  logos: { sos: true },
  papel: 'carta4',
});

// El alto crece con los datos y con la letra. Si no creciera, el calculo no
// estaria midiendo nada.
ok('mas datos ocupan mas papel',
  altoDelTique(10, 16, { logos: true, reimpresion: false, rollo: false })
  > altoDelTique(10, 6, { logos: true, reimpresion: false, rollo: false }));
ok('letra mas grande ocupa mas papel',
  altoDelTique(11, 10, { logos: true, reimpresion: false, rollo: false })
  > altoDelTique(7, 10, { logos: true, reimpresion: false, rollo: false }));
// La caja de REIMPRESION es justo la que desbordaba el recuadro.
ok('la marca de reimpresion ocupa lugar y se cuenta',
  altoDelTique(10, 10, { logos: true, reimpresion: true, rollo: false })
  > altoDelTique(10, 10, { logos: true, reimpresion: false, rollo: false }));
ok('los logos tambien',
  altoDelTique(10, 10, { logos: true, reimpresion: false, rollo: false })
  > altoDelTique(10, 10, { logos: false, reimpresion: false, rollo: false }));

// En rollo no hay fondo de hoja: el tique termina donde termina, asi que no se
// achica nada y va el tamano comodo.
eq('en rollo no hace falta achicar', tamanoQueEntra('rollo80', 16, { logos: true }).pt, PT_MAXIMO);
ok('...y siempre entra', tamanoQueEntra('rollo58', 16, { logos: true }).entra === true);

// ⭐ LO QUE ARREGLA EL BUG: con todo encendido y 4 por hoja tiene que entrar.
const c4 = tamanoQueEntra('carta4', 16, { logos: true, reimpresion: true });
ok('con los 16 datos y 4 por hoja el tique ENTRA', c4.entra === true);
ok('...achicando la letra, no cortando', c4.pt < PT_MAXIMO && c4.pt >= PT_MINIMO);
// El alto calculado con ese tamano tiene que caber de verdad en el recuadro.
ok('y el calculo cuadra con la medida del recuadro',
  altoDelTique(c4.pt, 16, { logos: true, reimpresion: true, rollo: false }) <= MEDIDAS.carta4.altoMm);

// Con pocos datos no hay por que achicar nada.
eq('con los seis de fabrica y una hoja entera va la letra comoda',
  tamanoQueEntra('carta1', 6, { logos: true }).pt, PT_MAXIMO);

// ⚠️ NUNCA por debajo del piso: mas chico no se lee parado en el patio, con sol
//    y con las manos sucias, que es donde se lee de verdad.
ok('nunca baja del piso legible', tamanoQueEntra('carta6', 30, { logos: true, reimpresion: true }).pt >= PT_MINIMO);
ok('...y cuando no entra, lo dice', tamanoQueEntra('carta6', 30, { logos: true, reimpresion: true }).entra === false);

// El aviso: solo cuando de verdad no entra, y con la salida a mano.
eq('con la configuracion de fabrica no hay nada que avisar', avisoDeCapacidad(CONFIG_POR_DEFECTO), null);
eq('...ni con todo encendido en 4 por hoja', avisoDeCapacidad(TODOS), null);
const avisa = avisoDeCapacidad(normalizarConfig({ ...TODOS, papel: 'carta6' }));
ok('con todo encendido y 6 por hoja SI avisa', typeof avisa === 'string');
ok('...y dice cuantos datos son', /16 dato/.test(avisa));
// La pregunta que viene enseguida es «entonces cual uso»: se contesta sola.
ok('...y en que papel si caben', /4 por hoja/.test(avisa));

// El documento elige el tamano para el PEOR tique del mandado: con un tamano por
// tique, dos papeles de la misma hoja saldrian con letras distintas.
const conRei = documentoDeTiques(
  [{ datos: DATOS }, { datos: DATOS, reimpresion: true }],
  normalizarConfig({ ...TODOS, papel: 'carta2' }), {});
const sinRei = documentoDeTiques(
  [{ datos: DATOS }, { datos: DATOS }],
  normalizarConfig({ ...TODOS, papel: 'carta2' }), {});
const ptDe = (html) => Number((html.match(/font-size:([\d.]+)pt;line-height/) || [])[1]);
ok('una reimpresion en el mandado achica TODO el mandado', ptDe(conRei) < ptDe(sinRei));
ok('...y los dos tiques de la hoja llevan el mismo tamano',
  (conRei.match(/font-size:[\d.]+pt;line-height/g) || []).length === 1);

// Guardas sobre el codigo del papel.
ok('el CSS recibe el tamano ya calculado, no lo elige por su cuenta',
  /function cssComun\(papel: PapelTique, base: number\)/.test(libDocSC));
ok('el documento lo calcula antes de armar el CSS',
  /const \{ pt \} = tamanoQueEntra\(c\.papel, renglones/.test(libDocSC));
// La firma tiene que quedar al pie del recuadro, no pegada al ultimo dato.
ok('el cuerpo crece y empuja la firma al pie', /\.cuerpo\{flex:1 1 auto\}/.test(libDocSC));
ok('...y el cuerpo envuelve las filas', /<div class="cuerpo">/.test(libDocSC));

// El aviso llega a los DOS sitios: quien imprime en el CDT no es quien
// configuro el papel, y la tarjeta esta en un panel que el listero no ve.
ok('la tarjeta de configuracion avisa', /avisoDeCapacidad\(config\)/.test(card));
ok('...y se ve desde el encabezado plegado', /No caben todos los datos en ese papel/.test(card));
ok('al imprimir tambien se avisa', /const apretado = avisoDeCapacidad\(configTique\);/.test(scr));

// ── 10) IMPRIMIR Y ENTREGAR, EN LA PANTALLA ─────────────────────────────────
const scrSC = sinComentarios(scr);

// ⭐ EL GUARDA MAS IMPORTANTE DE LA SECCION. Primero se imprime; SOLO si el
//    usuario confirmo en la vista previa se guarda la constancia. Al reves,
//    quedaria anotado como entregado un tique que se cancelo, y ese registro es
//    la unica prueba de que papel salio.
const cuerpoImprimir = scrSC.slice(
  scrSC.indexOf('const imprimirTiques = async'),
  scrSC.indexOf('const renderRow = '),
);
ok('el bloque de imprimir existe', cuerpoImprimir.length > 500);

/**
 * «A pasa ANTES que B», exigiendo que los DOS existan.
 *
 * ⚠️ NO se compara con indexOf pelado. `indexOf` devuelve -1 cuando el texto no
 *    esta, y -1 es menor que cualquier posicion: borrar del todo la llamada
 *    haria PASAR la guarda de orden. Lo cazo una prueba de mutacion.
 */
const antesQue = (texto, a, b) => {
  const ia = texto.indexOf(a);
  const ib = texto.indexOf(b);
  return ia >= 0 && ib >= 0 && ia < ib;
};

ok('primero se imprime y despues se guarda',
  antesQue(cuerpoImprimir, 'await exportPdf(', 'await registrarEmisiones('));
ok('si cancela la vista previa NO se guarda nada',
  antesQue(cuerpoImprimir, 'if (!confirmado) return;', 'registrarEmisiones('));

// ⚠️ Se vuelve a preguntar contra la base: el mapa de la pantalla puede estar
//    viejo, y marcar «primera vez» un papel ya entregado es el error caro.
ok('antes de imprimir se pregunta a la base si ya se entrego',
  antesQue(cuerpoImprimir, 'await contarEmisionesPorFolio(folios)', 'await exportPdf('));
ok('y lo que ya salio se marca como reimpresion en el papel',
  /reimpresion: \(cuenta\.porFolio\.get\(folioDeTique\(r\)\) \?\? 0\) > 0/.test(cuerpoImprimir));
ok('se le avisa ANTES de mandar', /REIMPRESI/.test(cuerpoImprimir));

// Un viaje en cola no tiene folio: no hay tique que entregar.
ok('no se imprime lo que todavia no subio', /tieneTique\(r\) && !r\.queued/.test(cuerpoImprimir));
// Un mandado, un numero de lote: los que salieron juntos se encuentran juntos.
ok('todos los del mandado comparten lote', /const loteId = nuevoUuid\(\);/.test(cuerpoImprimir));
ok('...y cada uno lleva su clave de idempotencia',
  /clientActionId:/.test(cuerpoImprimir) && /loteId\}:\$\{folioDeTique\(r\)\}/.test(cuerpoImprimir));
// El cliente pidio que quede «el CDT en que imprimieron». El del viaje ya esta
// guardado en el viaje; este es el de quien imprime.
ok('se guarda el CDT de quien imprime', /ubicacionId: obraMia\?\.id \?\? null/.test(cuerpoImprimir));
ok('y quien lo entrego', /emitidoPorNombre: listeroName/.test(cuerpoImprimir));

// El papel ya salio: la constancia no se puede perder por falta de senal.
ok('si el guardado falla se avisa y se aparta', /res\.pendientes > 0/.test(cuerpoImprimir));
ok('la pantalla muestra cuantas constancias esperan senal', /tiquesPendientes > 0 \?/.test(scrSC));
ok('...y suben solas al volver la senal',
  /onConnectivityChange\(\(online\) => \{ if \(online\) intentar\(\); \}\)/.test(scrSC));

// El boton va en la fila del viaje: se marca, se imprime, se entrega.
ok('cada viaje con tique tiene su boton de imprimir',
  /onPress=\{\(\) => imprimirTiques\(\[row\], 'uno'\)\}/.test(scrSC));
// ⚠️ Sale para todo el que vea la fila, no solo para quien puede editar: el
//    listero del CDT es justamente quien entrega y no puede corregir nada.
ok('el boton NO depende del permiso de editar ni de borrar',
  /\{tieneTique\(row\) && !row\.queued \?/.test(scrSC));
ok('y dice si es reimpresion', /Reimprimir tique/.test(scrSC));
// La segunda forma que pidio el cliente: un mandado entero para repartir.
ok('se puede imprimir la lista completa de una',
  /onPress=\{\(\) => imprimirTiques\(tiquesDeLaLista, 'lote'\)\}/.test(scrSC));
ok('...y sale de la lista TAL COMO ESTA FILTRADA',
  /const tiquesDeLaLista = useMemo\(\s*\(\) => filteredRangeRows\.filter\(\(r\) => tieneTique\(r\)\)/.test(scrSC));
ok('se explica por que quedan viajes fuera', /no tienen n(ú|u)mero de/.test(scr));

// ⚠️ La consulta de «ya se entrego» tiene tope: la lista del panel puede ser un
//    mes entero y preguntar por miles en cada cambio de filtro tumba el telefono.
ok('la consulta de entregados tiene tope', /TOPE_FOLIOS_A_CONSULTAR/.test(scrSC));
ok('...y por encima del tope no se consulta',
  /foliosVisibles\.length > TOPE_FOLIOS_A_CONSULTAR\) return;/.test(scrSC));
// Sin marca NO significa «no se entrego»: significa que no se pregunto.
ok('sin medir no se pinta la marca',
  /foliosMedidos\.has\(f\) \? \(emisionesPorFolio\.get\(f\) \?\? 0\) : null/.test(scrSC));

// Los logos van incrustados: en la tiquetera del CDT puede no haber internet.
ok('los logos van incrustados, no por URL',
  /sos: LOGO_DATA_URI/.test(scrSC) && !/https?:\/\/[^\s'"]*logo/i.test(scrSC));

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

// El manual tiene que contar lo que se puede hacer HOY, no lo que se podra.
ok('el manual .md explica como imprimir el tique', /Imprimir el tique y entregarlo \(12\/09\/2026\)/.test(md));
ok('...y las dos formas que pidio el cliente',
  /Uno por uno, en el momento/.test(md) && /Toda la tiquetera de una/.test(md));
ok('...y que la reimpresion sale marcada', /sale marcado como REIMPRESI/.test(md));
ok('...y que sin senal el papel sale igual', /Sin señal el papel sale igual/.test(md));
ok('...y que si cancela no se anota nada', /Si cancelas la vista previa no se anota nada/.test(md));
ok('el manual .md explica que la letra se achica sola', /el sistema achica la letra \(12\/09\/2026\)/.test(md));
ok('el manual en pantalla explica como imprimir', /IMPRIMIR EL TIQUE Y ENTREGARLO \(12\/09\/2026\)/.test(ms));
ok('...y que el CDT que se guarda es el de quien imprime', /EL DE QUIEN IMPRIME/.test(ms));
ok('el manual en pantalla explica lo de la letra', /ACHICA LA LETRA \(12\/09\/2026\)/.test(ms));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-tique · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
