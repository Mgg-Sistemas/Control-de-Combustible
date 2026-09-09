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

console.log(`\n${fail === 0 ? '✅' : '❌'} test-conteo-cubicaje · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
