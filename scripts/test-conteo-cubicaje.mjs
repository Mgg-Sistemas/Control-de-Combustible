/*
 * Test del PDF DE ESTE CONTEO con medidas de tolva (09-sep-2026).
 *
 * Pedido del cliente: que el PDF del conteo por tipo salga con el mismo membrete
 * que el de Ubicaciones, que se le puedan quitar columnas y cuadros, y que traiga
 * el alto, el largo, el ancho y el volumen ya llenos para las unidades de la hoja
 * que entregó, en blanco para las demás, y SIN columna de clasificación.
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · el reporte POR DEFECTO trae TODAS las columnas: quien no toque nada saca
 *     el papel completo
 *   · el listado NO tiene columna de clasificación (lo pidió expresamente)
 *   · las medidas se reconocen de la MÁS ESPECÍFICA a la MENOS: un «doble cajón»
 *     no se puede llevar las medidas del volteo Eurotech
 *   · lo que no se reconoce queda EN BLANCO, nunca en cero
 *   · apagar los tres cuadros y el listado a la vez bloquea el reporte
 *
 *   node scripts/test-conteo-cubicaje.mjs
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

const cargar = (rel) => {
  const p = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  m._compile(out, m.filename);
  return m.exports;
};

const med = cargar('src/lib/medidasFlota.ts');
const op = cargar('src/lib/conteoTipoOpciones.ts');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ── 1) LAS MEDIDAS DE LA HOJA DEL CLIENTE ───────────────────────────────────
const m = (...t) => med.medidaConocida(...t);

eq('reconoce el Toronto por su código', m('CAMION VOLTEO TORONTO'), { nombre: 'Volteo Toronto Iveco Trakker', alto: 1.16, largo: 5.91, ancho: 2.31 });
eq('reconoce el Fiat', m('VOLTEO FIAT').largo, 4.65);
eq('reconoce el Mitsubishi', m('CAMION VOLTEO MITSUBISHI').ancho, 2.28);
eq('reconoce el Freightliner', m('VOLTEO FREIGHTLINER').alto, 1.20);
eq('reconoce el Renault por la marca', m('CAMION VOLTEO', 'RENAULT').largo, 5.90);
eq('...y también por el Ikemaz', m('VOLTEO IKEMAZ').largo, 5.90);
eq('reconoce el Sinotruk', m('CARBOZULIA SINOTRUK').alto, 1.70);
eq('...y por HOWO', m('CAMION HOWO 380').alto, 1.70);

// ⭐ EL ORDEN ES LA REGLA. Estas tres comparten la palabra «eurotech» y miden
//    distinto: si la genérica se probara primero, un doble cajón saldría con
//    16,12 m³ donde son 12,38 y el reporte cobraría de más.
eq('el volteo Eurotech, a secas', m('CAMION VOLTEO IVECO EUROTECH').largo, 5.30);
eq('la volqueta Eurotech DOBLE CAJÓN gana sobre la genérica', m('VOLQUETA IVECO EUROTECH DOBLE CAJON').largo, 4.30);
eq('la TELESCÓPICA Eurotech también', m('VOLQUETA IVECO TELESCOPICA EUROTECH').largo, 7.30);
eq('el chuto Trakker no se confunde con el volteo Trakker', m('CHUTO CON VOLQUETA IVECO TRAKKER').largo, 7.30);
eq('el volteo Trakker (Toronto) mantiene lo suyo', m('VOLTEO TORONTO IVECO TRAKKER').largo, 5.91);
eq('la doble tolva MAX-400', m('CHUTO VOLQUETA DOBLE TOLVA MAX-400').largo, 9.15);

// Sin acentos, en minúsculas y con espacios de más: es como lo teclea la gente.
eq('no le importan acentos ni mayúsculas', m('volqueta iveco telescópica eurotech').alto, 1.40);
eq('ni los espacios de más', m('  CAMION   VOLTEO   FIAT  ').alto, 1.32);

// ⚠️ Lo que no está en la hoja queda EN BLANCO. Rellenar con un promedio sería
//    inventar el número por el que se cobra.
eq('una excavadora no tiene medida de tolva', m('EXCAVADORA CAT 320'), null);
eq('una retroexcavadora tampoco', m('RETROEXCAVADORA JCB'), null);
eq('sin texto, nada', m(''), null);
eq('con nulos, nada', m(null, undefined), null);

eq('la hoja trae 11 unidades distintas', med.UNIDADES_EN_LA_HOJA, 11);
ok('la nota explica de dónde salen las medidas', /Cubicaje y volumen/.test(med.NOTA_ORIGEN) && /quedan en blanco/.test(med.NOTA_ORIGEN));

// ── 2) QUÉ COLUMNAS LLEVA EL LISTADO ────────────────────────────────────────
const D = op.OPCIONES_CONTEO_COMPLETO;

// ⭐ Por defecto sale TODO: quien no toque nada tiene el papel completo.
eq('por defecto no se oculta nada', Object.values(D).filter(Boolean).length, 0);
eq('por defecto van las nueve columnas',
  op.columnasConteo(D), ['n', 'equipo', 'marcaModelo', 'placa', 'encargado', 'alto', 'largo', 'ancho', 'm3']);

// ⚠️ El cliente dijo «omite lo de la clasificación» del listado. El CUADRO de
//    cantidad por clasificación sí sigue, pero la COLUMNA no existe.
ok('el listado NO tiene columna de clasificación', !op.columnasConteo(D).includes('clas'));
ok('...con ninguna combinación de pastillas',
  !op.columnasConteo({ ...D, sinCubicaje: true, sinPlaca: true }).includes('clas'));

eq('apagar los m³ quita las cuatro columnas de cubicaje',
  op.columnasConteo({ ...D, sinCubicaje: true }), ['n', 'equipo', 'marcaModelo', 'placa', 'encargado']);
eq('apagar la marca deja el modelo', op.tituloMarcaModeloConteo({ ...D, sinMarca: true }), 'Modelo');
eq('apagar el modelo deja la marca', op.tituloMarcaModeloConteo({ ...D, sinModelo: true }), 'Marca');
eq('apagando las dos, no va la columna', op.tituloMarcaModeloConteo({ ...D, sinMarca: true, sinModelo: true }), null);
ok('...y desaparece del listado', !op.columnasConteo({ ...D, sinMarca: true, sinModelo: true }).includes('marcaModelo'));

eq('el texto de marca y modelo se arma con lo visible',
  op.marcaModeloConteo({ marca: 'Iveco', modelo: 'Trakker' }, D), 'Iveco Trakker');
eq('...solo el modelo si la marca está oculta',
  op.marcaModeloConteo({ marca: 'Iveco', modelo: 'Trakker' }, { ...D, sinMarca: true }), 'Trakker');
eq('sin datos, cadena vacía', op.marcaModeloConteo({}, D), '');

// El equipo y el número no se pueden quitar: sin ellos la fila no identifica nada.
const nada = Object.fromEntries(Object.keys(D).map((k) => [k, true]));
eq('ninguna pastilla puede dejar la fila sin identidad', op.columnasConteo(nada), ['n', 'equipo']);

// Las columnas numéricas van a la derecha; un m³ alineado a la izquierda no se
// puede comparar de un vistazo entre filas.
ok('las cuatro de cubicaje son numéricas',
  ['alto', 'largo', 'ancho', 'm3'].every((c) => op.COLUMNA_NUMERICA[c] === true));
ok('el equipo no', op.COLUMNA_NUMERICA.equipo === false);
ok('toda columna tiene título', op.columnasConteo(D).every((c) => !!op.TITULO_COLUMNA[c]));

// ── 3) UN REPORTE SIN NADA NO SE EMITE ──────────────────────────────────────
ok('sin listado y sin los dos cuadros, se bloquea',
  op.conteoSinContenido({ ...D, sinListado: true, sinTipos: true, sinClasificacion: true }));
ok('con el listado encendido, no', !op.conteoSinContenido({ ...D, sinTipos: true, sinClasificacion: true }));
ok('con un cuadro encendido, tampoco', !op.conteoSinContenido({ ...D, sinListado: true, sinTipos: true }));
ok('el papel completo nunca se bloquea', !op.conteoSinContenido(D));

// ── 4) LO QUE SE DICE EN PANTALLA Y EN EL NOMBRE DEL ARCHIVO ────────────────
eq('sin nada oculto lo dice', op.ocultosConteoEnPalabras(D), 'Sale completo.');
ok('con algo oculto lo enumera y aclara que los totales no cambian',
  /Se oculta: marca · alto\/largo\/ancho y m³\. Los totales no cambian\./
    .test(op.ocultosConteoEnPalabras({ ...D, sinMarca: true, sinCubicaje: true })));
// Dos PDF con el mismo nombre se pisan en la carpeta de descargas.
eq('el nombre del archivo dice qué se ocultó', op.sufijoArchivoConteo({ ...D, sinCubicaje: true }), ' sin cubicaje');
eq('sin nada oculto, sin sufijo', op.sufijoArchivoConteo(D), '');
ok('ningún sufijo lleva barra (rompe el nombre del archivo)',
  op.PASTILLAS_CONTEO.every((p) => !p.archivo.includes('/')));
ok('las pastillas cubren todas las opciones',
  op.PASTILLAS_CONTEO.length === Object.keys(D).length);

// ── 5) GUARDAS SOBRE EL CÓDIGO ──────────────────────────────────────────────
const scr = sinComentarios(leer('src/screens/ReportsScreen.tsx'));

// El PDF del conteo tiene que usar el membrete del Plan, igual que Ubicaciones.
ok('el PDF del conteo usa el membrete del Plan',
  /renaceShell\('CONTEO DE EQUIPOS'/.test(scr));
// El encabezado y las filas se arman con LA MISMA lista: un <th> sin su <td>
// corre la tabla entera y el serial sale debajo de «Marca».
ok('las columnas salen de columnasConteo', /const cols = columnasConteo\(o\)/.test(scr));
ok('el encabezado recorre esa lista', /cols\.map\(\(c\) => `<th/.test(scr));
ok('y las filas también', /cols\.map\(\(c\) => `<td/.test(scr));

// Lo medido en el sistema manda sobre la hoja: si no, corregir una medida en
// Cubicaje no cambiaría este reporte y los dos papeles dirían cosas distintas.
ok('lo medido gana sobre la hoja',
  /const guardada = m\.id \? medidasPorId\.get\(m\.id\) : undefined;[\s\S]{0,120}?if \(guardada\) return/.test(scr));
ok('y la hoja es el respaldo', /medidaConocida\(m\.code, m\.marca, m\.modelo\)/.test(scr));

// Las empresas marcadas se aplican sobre el universo, antes del alcance: si no,
// el papel diría «6 empresas» arriba y listaría 2.
ok('las empresas escogidas se aplican antes de repartir por alcance',
  /const universoEmp = empresasSel\.size[\s\S]{0,160}?repartirPorAlcance\(universoEmp/.test(scr));
ok('y también acotan el conteo en pantalla',
  /empresasSel\.size \? porEstado\.filter\(\(m\) => empresasSel\.has\(m\.company\)\)/.test(scr));
ok('vacío significa TODAS', /empresasSel\.size \?/.test(scr));

// El botón no puede emitir una hoja vacía.
ok('el botón se apaga si el reporte queda sin nada',
  /disabled=\{conteoSinContenido\(conteoOpciones\)\}/.test(scr));

// MachineDetail necesita el id para cruzar con la medida guardada.
ok('MachineDetail lleva id y marca', /type MachineDetail = \{ id: string;[\s\S]{0,200}?marca: string \| null;/.test(scr));
ok('la consulta del conteo trae la marca',
  /selectAllRows\('machinery', 'id, code, tipo, marca, serial/.test(scr));


// ── 6) AGRUPAR POR CATEGORÍA ────────────────────────────────────
// Pedido del cliente: «poder sacar por categoría, que si remoción de escombros».
ok('hay un eje de agrupación', /useState<'empresa' \| 'clasificacion'>\('empresa'\)/.test(scr));
ok('abre por empresa, como siempre', /conteoEje, setConteoEje\] = useState<'empresa' \| 'clasificacion'>\('empresa'\)/.test(scr));
// ⭐ AGRUPAR NO FILTRA. Los dos ejes reparten LOS MISMOS equipos: el total tiene
//    que ser idéntico. Por eso el eje se decide en UN solo punto y de ahí para
//    abajo el código es el mismo.
ok('el eje se decide en un solo punto', /const ejeDe = \(it: MachineDetail\) => \(conteoEje === 'clasificacion'/.test(scr));
ok('...y el agrupado usa esa función', /const k = ejeDe\(it\)/.test(scr));
ok('el total sale de las filas, no de los grupos', /total: match\.length/.test(scr));
// El filtro por categoría es aparte del eje: uno reparte, el otro saca.
ok('se puede filtrar por categoría', /clasSel\.size \? porEmpresa\.filter\(\(m\) => clasSel\.has\(m\.clas\)\)/.test(scr));
ok('vacío significa todas las categorías', /clasSel\.size \?/.test(scr));
// El papel tiene que DECIR por dónde se partió: dos PDF del mismo conteo con
// distinto eje se ven casi iguales y se confunden.
ok('el subtítulo del PDF dice el eje', /por \$\{porCategoria \? 'categoría' : 'empresa'\}/.test(scr));
ok('y el nombre del archivo también', /porCategoria \? ' por categoria' : ''/.test(scr));
ok('el listado cambia de título', /tituloListado = porCategoria \? 'Listado por categoría'/.test(scr));

// ── 7) LA HOJA SE VE EN CUBICAJE Y VOLUMEN ─────────────────────────
// Pedido del cliente: «los que ya cargaste, que se vean reflejados en el
// apartado nuevo». La MISMA precedencia que el conteo: base → dispositivo →
// hoja. Si acá fuera otra, los dos papeles dirían cosas distintas.
const tab = sinComentarios(leer('src/components/CubicajeTab.tsx'));
ok('Cubicaje cae a la hoja cuando no hay medida', /medidaConocida\(t\.code, t\.marca, t\.modelo\)/.test(tab));
ok('la de la base gana sobre la del dispositivo', /locales\.filter\(\(m\) => !m\.truckId \|\| !ids\.has\(m\.truckId\)\)/.test(tab));
ok('y la hoja solo entra si no hay ninguna otra NI se apartó', /if \(yaTiene\.has\(t\.id\) \|\| fuera\.has\(t\.id\)\) continue;/.test(tab));
// ⚠️ Un número deducido de un nombre parecido no vale lo mismo que uno tomado
//    con cinta: hay que poder distinguirlos en pantalla.
ok('se marcan como venidas de la hoja', /deLaHoja: true/.test(tab));
ok('...y la pantalla lo dice', /de la hoja, sin confirmar/.test(leer('src/components/CubicajeTab.tsx')));
ok('el botón invita a confirmarla', /Confirmar esta medida/.test(leer('src/components/CubicajeTab.tsx')));
// Una medida de la hoja NO es una fila guardada: al guardar se crea, no se
// actualiza una que no existe.
ok('confirmar crea la fila, no actualiza uno inexistente', /setEditId\(ya && !ya\.deLaHoja \? ya\.id : null\)/.test(tab));

// El conteo NO edita medidas: se manejan en Viajes de camiones, y lo dice.
ok('el conteo manda a Cubicaje para cambiar las medidas',
  /Viajes de camiones/.test(leer('src/screens/ReportsScreen.tsx')));


// ── 8) ORDEN ALFABÉTICO Y PROMEDIO ───────────────────────────────
// Sin nombres de empresa, `flatMap` conservaba el orden de los GRUPOS: la lista
// salía a saltos (tres Toronto, dos Fiat, otra vez Toronto) y sin la cabecera de
// empresa nada explicaba por qué.
ok('sin empresas, el listado se reordena entero',
  /flatMap\(\(e\) => e\.items\)\.slice\(\)[\s\S]{0,60}?\.sort\(\(a, b\) => cmpText\(a\.code, b\.code\)/.test(scr));
// El serial desempata: dos equipos del mismo modelo tienen que salir en el mismo
// orden entre una impresión y la siguiente.
ok('...y el serial desempata',
  /cmpText\(a\.serial \|\| a\.plate \|\| '', b\.serial \|\| b\.plate \|\| ''\)/.test(scr));

// El promedio de lo seleccionado, en el papel y en pantalla.
ok('el PDF trae total, promedio, mayor y menor',
  /VOLUMEN TOTAL/.test(scr) && /PROMEDIO POR UNIDAD/.test(scr) && /MAYOR/.test(scr) && /MENOR/.test(scr));
ok('la pantalla calcula lo mismo, de las mismas filas', /const volumenSeleccion = useMemo/.test(scr));
// ⚠️ Contar como cero las no medidas hundiría el promedio y diría que la flota
//    carga menos de lo que carga.
ok('solo promedia lo MEDIDO', /\.filter\(\(x\) => x > 0\)/.test(scr));
ok('...y dice sobre cuántas unidades', /unidad\(es\) con medida/.test(scr));
// El pie de la tabla tiene que cuadrar con la tarjeta de arriba.
ok('el pie del listado suma el volumen', /sumaM3\.toFixed\(2\)/.test(scr));
ok('sin cubicaje no hay tarjetas de volumen', /o\.sinCubicaje \|\| !volumenes\.length \? '' :/.test(scr));


// ── 9) EL REPORTE VOLUMÉTRICO: LOGOS Y SOLO ACTIVAS ───────────────────
const tabRaw = leer('src/components/CubicajeTab.tsx');
ok('el reporte volumétrico lleva los dos logos',
  /logos: \{ renace: RENACE_LOGO_DATA_URI, goldenTouch: GOLDEN_TOUCH_LOGO_DATA_URI \}/.test(tabRaw));
// ⚠️ Una unidad retirada o en espera NO describe la capacidad con la que se
//    cuenta hoy: inflaba el total y el promedio de un papel que se entrega para
//    planificar acarreo.
ok('solo entran las unidades activas',
  /activoPorId\.get\(m\.truckId\) !== false/.test(tabRaw));
ok('...y el papel dice que son solo activas', /Solo unidades activas/.test(tabRaw));
ok('...y cuántas quedaron fuera', /inactiva\(s\) fuera/.test(tabRaw));
// Lo medido a mano no tiene ficha ni estado que consultar: entra igual.
ok('lo medido a mano no se descarta por estado', /!m\.truckId \|\|/.test(tabRaw));

// Los logos NO se importan en la librería del reporte: son cientos de KB de
// base64 y ese archivo se transpila entero en cada corrida de las pruebas.
const volLib = leer('src/lib/reporteVolumetrico.ts');
ok('la librería del reporte no importa los logos', !/logoRenaceData|logoGoldenTouchData/.test(volLib));
ok('los recibe por parámetro', /logos\?: \{ renace\?: string; goldenTouch\?: string \}/.test(volLib));
// ⚠️ Un comentario de JSX dentro de un literal de HTML se IMPRIME tal cual.
//    Ya pasó una vez en este mismo archivo.
ok('no hay comentarios de JSX dentro del HTML', !/\{\/\*/.test(volLib));


// ── 10) LAS MEDIDAS SE PUEDEN CORREGIR ───────────────────────────
// ⚠️ La lista «Unidades medidas» solo tenía papelera: para corregir un número
//    había que volver al buscador y encontrar el camión otra vez, y con treinta
//    camiones que se llaman igual eso es rendirse. El cliente lo reportó como
//    que el apartado «no deja editar las medidas».
ok('hay una función para editar una medida ya hecha', /const editar = \(m: Medida\) =>/.test(tabRaw));
ok('la fila entera abre el formulario', /onPress=\{\(\) => editar\(m\)\} style=\{\{ flex: 1 \}\}/.test(tabRaw));
ok('...y hay un lápiz aparte', /onPress=\{\(\) => editar\(m\)\} style=\{\{ padding: 4 \}\}/.test(tabRaw));
ok('la fila lo dice, para que se sepa que se puede', /Toca para corregirla/.test(tabRaw));
ok('el formulario avisa que está corrigiendo', /Corrigiendo:/.test(tabRaw));
// Una medida de la hoja no es una fila guardada: al guardar se CREA.
ok('editar una de la hoja crea la fila, no actualiza una inexistente',
  /setEditId\(m\.deLaHoja \? null : m\.id\)/.test(tabRaw));
// Y la papelera sigue estando, aparte del lápiz.
ok('la papelera sigue', /onPress=\{\(\) => borrarMedidaDe\(m\)\}/.test(tabRaw));
// Para medir algo que no es volteo ni volqueta hay que poder ver el resto.
ok('se puede apagar el filtro de solo camiones', /setSoloCamiones\(!soloCamiones\)/.test(tabRaw));


// ── 11) CORREGIR SIN SUBIR OCHENTA FILAS ─────────────────────────
// ⚠️ Tocar la fila llenaba el formulario de ARRIBA, a ochenta filas de
//    distancia, y la pantalla no se movía: desde abajo no pasaba nada visible.
//    El cliente lo reportó DOS veces como que «no deja cambiar». El editor
//    tiene que abrirse donde se tocó.
ok('hay una fila abierta y se sabe cuál', /const \[abierta, setAbierta\] = useState<string \| null>\(null\)/.test(tabRaw));
ok('el mismo toque abre y cierra', /setAbierta\(\(prev\) => \(prev === m\.id \? null : m\.id\)\)/.test(tabRaw));
ok('la fila abierta se reconoce', /const editando = abierta === m\.id/.test(tabRaw));
// Los tres campos, dentro de la fila y no en el formulario de arriba.
const bloqueFila = tabRaw.slice(tabRaw.indexOf('const editando = abierta === m.id'));
ok('los tres campos se abren en la fila', /editando \? \([\s\S]{0,900}?\[\['Alto \(m\)', alto, setAlto\], \['Largo \(m\)', largo, setLargo\], \['Ancho \(m\)', ancho, setAncho\]\]/.test(bloqueFila));
ok('y guardan con el mismo guardar de siempre', /onPress=\{guardar\} disabled=\{!puedeGuardar\}/.test(bloqueFila));
ok('cancelar cierra la fila', /const limpiar = \(\) => \{\n    setSel\(''\); setEditId\(null\); setAbierta\(null\);/.test(tabRaw));

// ── 12) QUIÉN ES CADA FILA ───────────────────────────────────
// ⚠️ Una medida sacada de la hoja trae como identificador el nombre de la
//    TOLVA, no el del camión. Con ochenta y nueve unidades del mismo modelo la
//    lista salía ochenta y nueve veces igual y sin placa. El título de la fila
//    tiene que ser el CAMIÓN.
ok('la lista tiene la ficha del catálogo a mano', /const fichaPorId = useMemo\(\(\) => new Map\(trucks\.map\(\(t\) => \[t\.id, t\]\)\), \[trucks\]\)/.test(tabRaw));
ok('el título de la fila es el camión, por la regla única', /const quien = t \? nombreCamion\(t\) : m\.ident/.test(tabRaw));
ok('...y se pinta ese, no el de la tolva', /\{m\.truckId \? '\u{1F69B}' : '\u270d\ufe0f'\} \{quien\}/u.test(tabRaw));
ok('el nombre de la tolva baja al renglón de abajo', /\{m\.ident\} · \{dimsTexto\(m\)\} m/.test(tabRaw));

// ── 13) BUSCAR DENTRO DE LA LISTA ─────────────────────────────
ok('la lista de medidas tiene su propio buscador', /const \[buscaMedida, setBuscaMedida\] = useState\(''\)/.test(tabRaw));
ok('busca por código, placa y serial del camión', /\$\{t\?\.code \?\? ''\} \$\{t\?\.plate \?\? ''\} \$\{t\?\.serial \?\? ''\}/.test(tabRaw));
ok('se pinta la lista filtrada', /\{medidasEnLista\.map\(\(m\) => \{/.test(tabRaw));
// ⭐ Y el buscador NO puede cambiar los indicadores ni el reporte: filtrar la
//    vista no es sacar camiones de la flota.
ok('los indicadores siguen sobre la flota entera', /kpis\(medidasVistas\.map\(volumenDe\)\)/.test(tabRaw));
ok('el reporte también', /medidasVistas\s*\n?\s*\.filter\(\(m\) => !m\.truckId \|\| activoPorId/.test(tabRaw));


// ── 14) LA PLACA, EN TODO EL APARTADO ──────────────────────────
// ⚠️ El `ident` de una medida describe la TOLVA —«Volteo Toronto Iveco
//    Trakker»—, no al camión. Cuatro sitios lo usaban para NOMBRAR al camión, y
//    con casi toda la flota del mismo modelo eso dejaba renglones idénticos y
//    sin una sola placa: la lista de medidas, los totales a mano, el histórico
//    y el buscador del catálogo.
ok('hay UNA regla para nombrar a un camión', /const nombreCamion = \(t: CamionCubicaje\) =>/.test(tabRaw));
ok('es código, placa y, si no hay placa, serial',
  /const nombreCamion[\s\S]{0,120}?`\$\{t\.code\}\$\{t\.plate \? ` · \$\{t\.plate\}` : t\.serial \? ` · \$\{t\.serial\}` : ''\}`/.test(tabRaw));

// ⭐ Y NADIE vuelve a nombrar un camión con el identificador de la medida.
//    Se cuenta a mano: la única vez que `?.ident` puede nombrar es como respaldo
//    de un camión que YA NO ESTÁ en el catálogo (`nombreDe`), donde no queda
//    otra cosa con qué nombrarlo.
{
  const limpio = sinComentarios(tabRaw);
  const usos = (limpio.match(/porTruck\.get\([^)]*\)\?\.ident/g) || []).length;
  // Quedan DOS, y los dos están justificados: el respaldo de `nombreDe` para
  // un camión que ya no está en el catálogo, y la etiqueta de la TOLVA de los
  // totales a mano — que describe qué carga, no quién es.
  ok(`el ident de la medida ya no nombra camiones (quedan ${usos}: el respaldo y la tolva)`, usos === 2);
  ok('...y ninguno de los dos rellena un campo `nombre`',
    !/nombre: [^\n]*porTruck\.get\([^)]*\)\?\.ident/.test(limpio));
  ok('...y ese uso es el respaldo de nombreDe',
    /return t \? nombreCamion\(t\) : \(cub\.porTruck\.get\(id\)\?\.ident \|\| id\)/.test(tabRaw));
  // Ninguno de los cuatro sitios puede volver a armar el nombre a mano.
  ok('nadie vuelve a pegar código y placa por su cuenta',
    (limpio.match(/\$\{t\.code\}\$\{t\.plate/g) || []).length === 1);
}

ok('los totales a mano nombran al camión', /nombre: nombreCamion\(t\),/.test(tabRaw));
ok('...y la tolva baja de renglón, no desaparece', /tolva: cub\.porTruck\.get\(t\.id\)\?\.ident \?\? '',/.test(tabRaw));
ok('...y se pinta', /\{a\.tolva \? `\$\{a\.tolva\} · ` : ''\}\{a\.viajes\} viaje\(s\)/.test(tabRaw));

ok('el histórico prefiere el nombre del catálogo',
  /machine_code: \(\(\) => \{ const t = fichaPorId\.get\(c\.machinery_id\); return t \? nombreCamion\(t\) : c\.machine_code; \}\)\(\)/.test(tabRaw));
// ⭐ Pero la foto guardada NO se borra: es lo único que queda de un camión que
//    ya salió del catálogo, y para eso se tomó.
ok('...sin perder la foto guardada del que ya no está', /: c\.machine_code; \}\)\(\)/.test(tabRaw));

ok('el buscador del catálogo usa la misma regla', /\u{1F69B} \{nombreCamion\(t\)\}/u.test(tabRaw));
ok('y al medir una unidad nueva también', /setIdent\(ya\?\.ident \|\| nombreCamion\(t\)\)/.test(tabRaw));

// ⭐ La placa tiene que LLEGAR: si el catálogo no la trajera, no habría nada
//    que mostrar por más que la pantalla la pida.
{
  const pantalla = leer('src/screens/ViajesCamionesScreen.tsx');
  ok('el catálogo trae la placa de la base', /selectAllRows\('machinery', 'id, code, plate, serial/.test(pantalla));
  ok('...y llega hasta el cubicaje', /id: t\.id, code: t\.code, plate: t\.plate, serial: t\.serial,/.test(pantalla));
}


// ── 15) BORRAR UNA MEDIDA DE LA HOJA ───────────────────────────
// ⚠️ Una medida DE LA HOJA no es una fila: se DEDUCE del texto del equipo cada
//    vez que se pinta la pantalla. Borrarla lanzaba un DELETE de una fila que no
//    existía —que no falla, simplemente no borra nada— y al releer, la hoja la
//    volvía a deducir. El aviso decía «Medida borrada» y la unidad seguía ahí.
//    Reportado como «no me deja eliminar las unidades de medidas que ya están».
ok('una medida de la hoja se APARTA, no se borra',
  /if \(m\.deLaHoja\) \{\s*\n\s*if \(m\.truckId\) setApartadas/.test(tabRaw));
ok('...y sale ANTES de tocar la base', (() => {
  const i = tabRaw.indexOf('const borrar = useCallback');
  const hoja = tabRaw.indexOf('if (m.deLaHoja) {', i);
  const del = tabRaw.indexOf('await borrarMedida(m.truckId)', i);
  return hoja > 0 && del > 0 && hoja < del;
})());
ok('la hoja no vuelve a deducir lo apartado', /if \(yaTiene\.has\(t\.id\) \|\| fuera\.has\(t\.id\)\) continue;/.test(tabRaw));
ok('...y «fuera» son las apartadas', /const fuera = new Set\(apartadas\);/.test(tabRaw));
ok('la lista se rehace cuando cambian las apartadas', /\}, \[deLaBase, locales, flota, apartadas\]\);/.test(tabRaw));

// ⭐ Borrar la medida GUARDADA de un camión que la hoja reconoce también aparta:
//    si no, la de la hoja ocupaba su lugar en el acto y el borrado se veía como
//    que no ocurrió — el mismo síntoma, por el otro camino.
ok('borrar la guardada también aparta la de la hoja',
  /if \(!r\.error\) \{ setApartadas\(\(p\) => \(p\.includes\(m\.truckId!\) \? p : \[\.\.\.p, m\.truckId!\]\)\); await recargarMedidas\(true\); return; \}/.test(tabRaw));
// ⭐ Y guardarla la trae de vuelta: confirmar una medida no puede dejarla apartada.
ok('confirmar una medida la desaparta', /setApartadas\(\(p\) => p\.filter\(\(x\) => x !== m\.truckId\)\)/.test(tabRaw));

// ⭐ Se puede deshacer. Un filtro que no se puede quitar es indistinguible de un
//    dato perdido — la misma regla del interruptor de Carbozulia.
ok('se pueden traer de vuelta', /const restaurarApartadas = useCallback\(\(\) => setApartadas\(\[\]\), \[\]\)/.test(tabRaw));
ok('...y el aviso lo ofrece en la lista', /Toca para traerlas de vuelta/.test(tabRaw));
ok('...solo cuando hay alguna apartada', /\{cub\.apartadas\.length > 0 \? \(/.test(tabRaw));
// ⭐ Y el aviso NO puede decir que se le quita a todo el mundo: es este equipo.
ok('el aviso no miente sobre el alcance', /SOLO EN ESTE DISPOSITIVO/.test(tabRaw));
ok('...y el botón dice apartar, no borrar', /confirmText: m\.deLaHoja \? 'Apartarla' : 'Borrar la medida'/.test(tabRaw));

// ── 16) GUARDAR NO PUEDE TUMBAR LA PANTALLA ─────────────────────
// ⚠️ Toda la sub-pestaña se cambia por un spinner mientras `cargando` esté
//    arriba. Releer después de guardar encogía la pantalla entera y la volvía a
//    crecer, devolviendo al principio a quien estaba corrigiendo la fila ochenta.
//    Corregir un alto y aparecer arriba se lee como que no se guardó nada:
//    reportado como «tampoco me deja modificarlas».
ok('recargar puede ser silencioso', /const recargarMedidas = useCallback\(async \(silencioso = false\) => \{\s*\n\s*if \(!silencioso\) setCargando\(true\);/.test(tabRaw));
ok('...y no baja la bandera que no subió', /if \(!silencioso\) setCargando\(false\);/.test(tabRaw));
{
  // La PRIMERA carga sí muestra el spinner: ahí no hay sitio que perder.
  ok('la primera carga sí lo muestra', /useEffect\(\(\) => \{ recargarMedidas\(\); \}, \[recargarMedidas\]\);/.test(tabRaw));
  // Y guardar y borrar NO.
  const limpio2 = sinComentarios(tabRaw);
  const ruidosas = (limpio2.match(/await recargarMedidas\(\)/g) || []).length;
  ok(`solo la primera carga tumba la pantalla (quedan ${ruidosas} recargas ruidosas con await)`, ruidosas === 0);
}


// ── 17) LEER LAS MEDIDAS GUARDADAS ───────────────────────────
// ⚠️ LA CAUSA DE «CADA QUE LO CAMBIO REGRESA A COMO ESTABA».
//
//    `selectAllRows` pagina ordenando por `id`, y `camion_cubicaje` NO TIENE
//    columna `id`: su clave es el camión, una tolva por camión. La consulta
//    reventaba entera, el error se tiraba a la basura y la pantalla se quedaba
//    con CERO medidas guardadas — indistinguible de «todavía no hay ninguna».
//    Guardar SÍ funcionaba: las filas estaban en la base todo el tiempo. Al
//    releer, la hoja volvía a deducir la medida vieja y la corrección se veía
//    deshecha sola.
const datosRaw = leer('src/lib/cubicajeDatos.ts');
const supaRaw = leer('src/lib/supabase.ts');

ok('se puede paginar por otra columna', /orderBy: string = 'id'/.test(supaRaw));
ok('...y se usa la que se pidió', /q\.order\(orderBy, \{ ascending: true \}\)/.test(supaRaw));
// ⭐ Y el valor por defecto sigue siendo `id`: las otras once tablas que lo
//    usan sí tienen esa columna y no se pueden tocar.
ok('por defecto no cambia nada para el resto', /orderBy: string = 'id'/.test(supaRaw) && !/q\.order\('id'/.test(supaRaw));

ok('las medidas se paginan por machinery_id',
  /selectAllRows\(\s*\n\s*TABLA_MEDIDAS,[\s\S]{0,200}?'machinery_id',\s*\n\s*\)/.test(datosRaw));

// ⭐ Y EL ERROR DE LECTURA DEJA DE TIRARSE A LA BASURA. Es lo que convirtió un
//    fallo de una línea en tres reportes seguidos de «no me deja editar»:
//    mirando la pantalla no había forma de saberlo.
ok('recargar se queda con el error', /const \{ rows, missing, error \} = await listarMedidas\(\);/.test(tabRaw));
ok('...y lo guarda', /setFalloLeer\(error\);/.test(tabRaw));
ok('...y lo dice en pantalla', /No se pudieron leer las medidas guardadas/.test(tabRaw));
// Y avisa de lo único que importa: no se está perdiendo nada, solo no se ve.
ok('el aviso dice que guardar sí funciona', /Guardar sí funciona: los datos no se están perdiendo/.test(tabRaw));
ok('...y que lo de abajo sale de la hoja', /sale de la hoja de cubicaje, no de lo guardado/.test(tabRaw));
ok('el estado del fallo viaja en el hook', /falloLeer: string \| null;/.test(tabRaw));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-conteo-cubicaje · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
