/*
 * QUE SE OCULTA EN EL INVENTARIO DE MAQUINARIA (06-sep-2026).
 *
 * Pedido del cliente, textual: «necesito unos botones en ese apartado de conteo
 * de equipos por si quiero que en ese reporte no salga marca, no quiero que
 * salga el modelo, y si no quiero que salgan las ubicaciones, ni que salga si
 * es este u oeste». Y el logo de Golden Touch en el membrete.
 *
 * Lo que fijan estos casos:
 *   - que por defecto NO se oculte nada: el papel de siempre sigue saliendo igual;
 *   - que cada pastilla oculte lo suyo y nada mas, y que se puedan combinar;
 *   - LA INVARIANTE QUE MAS IMPORTA: encabezado y filas salen de LA MISMA lista
 *     de columnas, para cualquier combinacion, con y sin personal. Un <th> sin
 *     su <td> corre toda la tabla y nadie lo nota leyendo el codigo;
 *   - que ocultar la zona no INVENTE una ubicacion (una maquina del Oeste no
 *     puede aparecer en el patio de Camuri Chico por esconder la palabra Oeste);
 *   - que lo oculto quede ESCRITO en el nombre del archivo, en el subtitulo y en
 *     el cuadro de alcance: un papel recortado no se puede confundir con el completo;
 *   - y que el membrete lleve el logo de Golden Touch SIN quitar el del Plan.
 *
 *   node scripts/test-reporte-tactico-opciones.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

const cargar = (rel) => {
  const mod = { exports: {} };
  new Function('exports', 'module', ts.transpileModule(
    fs.readFileSync(path.join(ROOT, rel), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } },
  ).outputText)(mod.exports, mod);
  return mod.exports;
};

const {
  OPCIONES_TACTICO_COMPLETO, PASTILLAS_OCULTAR, UBICACION_POR_DEFECTO,
  alternarOcultar, hayAlgoOculto, ocultosLista, ocultosEnPalabras,
  sufijoArchivoOcultos, sufijoSubtituloOcultos, tituloMarcaModelo, marcaModeloDe,
  columnasMaquinaria, ubicacionEnPalabras,
} = cargar('src/lib/tacticoOpciones.ts');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? '  -> ' + extra : ''}`); } };

const COMPLETO = OPCIONES_TACTICO_COMPLETO;
const con = (...keys) => keys.reduce((o, k) => alternarOcultar(o, k), COMPLETO);
// Las 16 combinaciones posibles de las cuatro pastillas.
const KEYS = ['sinMarca', 'sinModelo', 'sinUbicaciones', 'sinZona'];
const TODAS = Array.from({ length: 16 }, (_, i) => con(...KEYS.filter((_, j) => (i >> j) & 1)));

console.log('QUE SE OCULTA EN EL INVENTARIO DE MAQUINARIA\n');

// ── 1) POR DEFECTO NO SE OCULTA NADA ──────────────────────────────────────
{
  eq('el papel de siempre: nada oculto', COMPLETO, { sinMarca: false, sinModelo: false, sinUbicaciones: false, sinZona: false });
  ok('* y la pantalla lo sabe', hayAlgoOculto(COMPLETO) === false);
  eq('* y lo dice en criollo', ocultosEnPalabras(COMPLETO), 'Sale completo.');
  eq('* sin sufijo en el archivo', sufijoArchivoOcultos(COMPLETO), '');
  eq('* ni en el subtitulo', sufijoSubtituloOcultos(COMPLETO), '');
  eq('* la columna se titula como siempre', tituloMarcaModelo(COMPLETO), 'Marca / Modelo');
  eq('* y las columnas son las seis de siempre', columnasMaquinaria(COMPLETO, false), ['n', 'equipo', 'marcaModelo', 'placa', 'ubicacion', 'estado']);
}

// ── 2) LAS PASTILLAS ───────────────────────────────────────────────────────
{
  eq('son cuatro', PASTILLAS_OCULTAR.length, 4);
  eq('* con las cuatro llaves, en este orden', PASTILLAS_OCULTAR.map((p) => p.key), KEYS);
  ok('* cada una con su texto de pastilla', PASTILLAS_OCULTAR.every((p) => p.chip && p.largo && p.archivo));
  ok('* ninguna repite el texto', new Set(PASTILLAS_OCULTAR.map((p) => p.chip)).size === 4);

  const a = alternarOcultar(COMPLETO, 'sinMarca');
  eq('encender una la enciende', a.sinMarca, true);
  eq('* y no toca las otras', [a.sinModelo, a.sinUbicaciones, a.sinZona], [false, false, false]);
  eq('* el original no cambia (es un objeto nuevo)', COMPLETO.sinMarca, false);
  eq('* dos toques la apagan', alternarOcultar(a, 'sinMarca'), COMPLETO);
  ok('* se pueden encender varias', hayAlgoOculto(con('sinMarca', 'sinZona')) && con('sinMarca', 'sinZona').sinZona);
}

// ── 3) MARCA Y MODELO ──────────────────────────────────────────────────────
{
  const m = { marca: ' CAT ', modelo: '320' };
  eq('completo: "CAT 320"', marcaModeloDe(m, COMPLETO), 'CAT 320');
  eq('⭐ sin marca: solo el modelo', marcaModeloDe(m, con('sinMarca')), '320');
  eq('⭐ sin modelo: solo la marca', marcaModeloDe(m, con('sinModelo')), 'CAT');
  eq('⭐ sin las dos: nada', marcaModeloDe(m, con('sinMarca', 'sinModelo')), '');
  eq('sin datos cargados: nada (la pantalla pone el guion)', marcaModeloDe({}, COMPLETO), '');
  eq('* null y espacios tampoco cuentan', marcaModeloDe({ marca: null, modelo: '  ' }, COMPLETO), '');
  eq('* una maquina sin ficha no revienta', marcaModeloDe(undefined, COMPLETO), '');

  eq('⭐ la columna se retitula: sin marca -> "Modelo"', tituloMarcaModelo(con('sinMarca')), 'Modelo');
  eq('⭐ sin modelo -> "Marca"', tituloMarcaModelo(con('sinModelo')), 'Marca');
  eq('⭐ sin las dos -> la columna NO va', tituloMarcaModelo(con('sinMarca', 'sinModelo')), null);
}

// ── 4) ⭐⭐ LAS COLUMNAS: ENCABEZADO Y FILA SALEN DE LA MISMA LISTA ──────────
{
  eq('con personal entran los dos operadores antes del estado',
    columnasMaquinaria(COMPLETO, true), ['n', 'equipo', 'marcaModelo', 'placa', 'ubicacion', 'opDia', 'opNoche', 'estado']);
  eq('⭐ sin ubicaciones se cae la columna Ubicacion',
    columnasMaquinaria(con('sinUbicaciones'), false), ['n', 'equipo', 'marcaModelo', 'placa', 'estado']);
  eq('⭐ sin marca ni modelo se cae la columna Marca / Modelo',
    columnasMaquinaria(con('sinMarca', 'sinModelo'), false), ['n', 'equipo', 'placa', 'ubicacion', 'estado']);
  eq('* con solo una de las dos, la columna SIGUE (retitulada)',
    columnasMaquinaria(con('sinMarca'), false).includes('marcaModelo'), true);
  eq('⭐ todo oculto, con personal: queda lo minimo para identificar la maquina',
    columnasMaquinaria(con(...KEYS), true), ['n', 'equipo', 'placa', 'opDia', 'opNoche', 'estado']);
  ok('⭐ Este/Oeste NO quita columnas del listado (solo el prefijo del texto)',
    JSON.stringify(columnasMaquinaria(con('sinZona'), false)) === JSON.stringify(columnasMaquinaria(COMPLETO, false)));

  // Para las 16 combinaciones x con/sin personal: siempre hay N, equipo, placa y
  // estado (sin eso la fila no identifica nada), N va primero, estado de ultimo,
  // y ninguna columna se repite.
  let bien = 0;
  for (const o of TODAS) for (const p of [false, true]) {
    const c = columnasMaquinaria(o, p);
    const base = c[0] === 'n' && c[c.length - 1] === 'estado' && c.includes('equipo') && c.includes('placa');
    const unicas = new Set(c).size === c.length;
    const personal = p ? (c.includes('opDia') && c.includes('opNoche')) : (!c.includes('opDia') && !c.includes('opNoche'));
    if (base && unicas && personal) bien++;
  }
  eq('⭐⭐ las 32 variantes (16 combinaciones x con/sin personal) tienen forma valida', bien, 32);
}

// ── 5) LA UBICACION EN PALABRAS ────────────────────────────────────────────
{
  const p = { macro: 'Este', sub: 'Macuto', ref: 'Edificio Sur' };
  eq('completa: "Este · Macuto · Edificio Sur"', ubicacionEnPalabras(p, COMPLETO), 'Este · Macuto · Edificio Sur');
  eq('⭐ sin Este/Oeste se cae solo el prefijo', ubicacionEnPalabras(p, con('sinZona')), 'Macuto · Edificio Sur');
  eq('* y sin referencia', ubicacionEnPalabras({ macro: 'Oeste', sub: 'Catia La Mar' }, con('sinZona')), 'Catia La Mar');
  eq('sin nada: el patio por defecto, en el Este', ubicacionEnPalabras({}, COMPLETO), 'Este · ' + UBICACION_POR_DEFECTO);
  eq('* sin nada y sin zona: el patio, sin decir Este', ubicacionEnPalabras({}, con('sinZona')), UBICACION_POR_DEFECTO);
  // ⭐⭐ Una maquina que SI tenia zona (Oeste) y nada mas: esconder la palabra
  //     no la puede mandar al patio de Camuri Chico, que esta en el ESTE.
  const soloOeste = ubicacionEnPalabras({ macro: 'Oeste' }, con('sinZona'));
  ok('⭐⭐ ocultar la zona no inventa una ubicacion', soloOeste === '—', soloOeste);
  ok('* ni la manda al patio', !soloOeste.includes('Camuri'));
  eq('* con la zona visible si sale la zona', ubicacionEnPalabras({ macro: 'Oeste' }, COMPLETO), 'Oeste');
  eq('espacios y nulos se limpian', ubicacionEnPalabras({ macro: '  ', sub: null, ref: ' Ref ' }, COMPLETO), 'Ref');
  eq('* sin objeto no revienta', ubicacionEnPalabras(undefined, COMPLETO), 'Este · ' + UBICACION_POR_DEFECTO);
  ok('* el default no lleva Este/Oeste adentro (si no, sinZona no lo podria quitar)', !/este|oeste/i.test(UBICACION_POR_DEFECTO));
}

// ── 6) LO OCULTO QUEDA ESCRITO: archivo, subtitulo y cuadro de alcance ─────
{
  const o = con('sinMarca', 'sinZona');
  eq('la lista, en el orden de las pastillas', ocultosLista(o), ['marca', 'Este/Oeste']);
  eq('* en criollo para la pantalla', ocultosEnPalabras(o), 'Se oculta: marca · Este/Oeste.');
  eq('⭐ en el nombre del archivo', sufijoArchivoOcultos(o), ' sin marca, sin Este-Oeste');
  eq('⭐ en el subtitulo', sufijoSubtituloOcultos(o), ' · Sin marca · Sin Este/Oeste');
  eq('con todo oculto, el archivo lo dice completo', sufijoArchivoOcultos(con(...KEYS)), ' sin marca, sin modelo, sin ubicaciones, sin Este-Oeste');
  // Un nombre de archivo con "/" o ":" no se guarda (o se guarda en otra carpeta).
  const malos = TODAS.map((x) => sufijoArchivoOcultos(x)).filter((s) => /[\\/:*?"<>|]/.test(s));
  eq('⭐ ningun sufijo de archivo lleva caracteres prohibidos', malos, []);
  ok('* distintas combinaciones dan distintos nombres', new Set(TODAS.map((x) => sufijoArchivoOcultos(x))).size === 16);
}

// ── 7) LA PANTALLA OBEDECE ─────────────────────────────────────────────────
{
  const crudo = fs.readFileSync(path.join(ROOT, 'src/screens/ReportsScreen.tsx'), 'utf8');
  const vivo = crudo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const desde = vivo.indexOf('const downloadTacticalPdf');
  const hasta = vivo.indexOf('\n  };', desde);
  const bloque = desde >= 0 && hasta > desde ? vivo.slice(desde, hasta) : '';
  ok('la funcion del reporte existe', bloque.length > 3000);
  ok('* y recibe las opciones', /downloadTacticalPdf = async \([^)]*opciones/.test(bloque));

  // ⚠️ Cada guardia va ANCLADA al argumento `opciones` y al interruptor. Un
  //    revisor demostro que con `/ubicacionEnPalabras\(/` a secas, cambiar el
  //    argumento por OPCIONES_TACTICO_COMPLETO (o sea: ignorar las pastillas)
  //    dejaba las 3 suites en verde. Diez mutaciones asi sobrevivian.
  //
  // El encabezado y las filas del listado se arman con la MISMA lista de columnas.
  ok('⭐ el listado le pregunta a la libreria que columnas van, con lo oculto y si va con personal',
    /const cols = columnasMaquinaria\(opciones, conPersonal\)/.test(bloque));
  ok('⭐⭐ el encabezado recorre la lista', /<thead><tr>\$\{cols\.map\(\(c\) => thDe\[c\]\)\.join\(''\)\}<\/tr><\/thead>/.test(bloque));
  ok('⭐⭐ y la fila recorre LA MISMA lista (con su propio diccionario)', /<tr>\$\{cols\.map\(\(c\) => tdDe\[c\]\)\.join\(''\)\}<\/tr>/.test(bloque));
  ok('* el encabezado ya no esta escrito a mano', !/<th>Equipo \/ Tipo<\/th><th/.test(bloque));
  ok('* la marca/modelo sale de la libreria, con las opciones', /marcaModelo: `<td>\$\{esc\(marcaModeloDe\(m, opciones\)/.test(bloque));
  ok('* el titulo de esa columna tambien', /marcaModelo: `<th[^>]*>\$\{tituloMarcaModelo\(opciones\)/.test(bloque));
  ok('* la ubicacion en palabras sale de la libreria, con las opciones', /return ubicacionEnPalabras\(\{ macro, sub, ref \}, opciones\)/.test(bloque));
  // Este/Oeste: las dos tablas de arriba, sus titulos y la nota de pernocta obedecen a sinZona.
  ok('⭐ las columnas de zona (encabezado) dependen de sinZona', /const zonaTh = \(ancho: number\) => opciones\.sinZona \? ''/.test(bloque));
  ok('⭐ y las celdas tambien', /const zonaTd = [^\n]* => opciones\.sinZona \? ''/.test(bloque));
  ok('* el colspan de "Sin equipos" tambien', /const colspanZona = opciones\.sinZona \? 2 : 4/.test(bloque));
  ok('* el titulo del resumen por tipo tambien', /Total por tipo de maquinaria\$\{opciones\.sinZona \? '' : ' · 🟢 Este \/ 🟠 Oeste'\}/.test(bloque));
  ok('* y la nota de pernocta en Camuri Chico (ESTE)', /\$\{opciones\.sinZona \? '' : `\s*<div[^\n]*🌙 Las <b>VOLQUETAS<\/b>/.test(bloque));
  ok('* con personal, la tabla de coordinadores/inspectores tambien', /const zonaPersonalHtml = !conPersonal\s*\? ''\s*: opciones\.sinZona\s*\?/.test(bloque));
  ok('* y su titulo', /Coordinadores e inspectores\$\{opciones\.sinZona \? '' : ' por zona'\}/.test(bloque));
  ok('* lo oculto va al nombre del archivo', /sufijoArchivoOcultos\(opciones\)/.test(bloque));
  ok('* y al subtitulo', /sufijoSubtituloOcultos\(opciones\)/.test(bloque));
  ok('* y al cuadro de alcance, solo si hay algo oculto', /\$\{ocultosLista\(opciones\)\.length \? `<div class="kv"><b>Campos ocultos:<\/b> \$\{esc\(ocultosLista\(opciones\)\.join\(' · '\)\)\}/.test(bloque));

  // La UI: cuatro pastillas, cada una enciende LA SUYA, y los DOS botones (real
  // y simulado) mandan las opciones.
  ok('la pantalla pinta las pastillas', /PASTILLAS_OCULTAR\.map\(/.test(vivo));
  ok('* cada pastilla pinta la suya', /const on = tacOpciones\[p\.key\]/.test(vivo));
  ok('* y enciende/apaga LA SUYA con la libreria', /setTacOpciones\(\(o\) => alternarOcultar\(o, p\.key\)\)/.test(vivo));
  const llamadas = vivo.match(/downloadTacticalPdf\(tacConPersonal, (false|true), tacAlcance, tacOpciones\)/g) || [];
  eq('⭐ el boton real y el SIMULADO mandan las opciones', llamadas.length, 2);
  ok('* y dice en criollo que se oculta antes de descargar', /ocultosEnPalabras\(tacOpciones\)/.test(vivo));

  // El membrete: Golden Touch a la izquierda del titulo, DENTRO del encabezado,
  // y el Plan sigue. Se recorta solo el div del encabezado antes de buscar: con
  // `class="hd"[\s\S]*` el logo podia estar en cualquier punto de abajo.
  const shell = (vivo.match(/function renaceShell[\s\S]*?\n}/) || [])[0] || '';
  ok('el membrete del Plan existe', shell.length > 500);
  const hd = (shell.match(/<div class="hd">[\s\S]*?<div class="rule">/) || [''])[0];
  ok('* el encabezado existe', hd.length > 100);
  ok('⭐ lleva el logo de Golden Touch a la izquierda del titulo, en el encabezado',
    /<div class="tit"><img class="gt" src="\$\{GOLDEN_TOUCH_LOGO_DATA_URI\}"\/><span>\$\{title\}<\/span><\/div>/.test(hd));
  ok('⭐ y SIGUE llevando el del Plan (ola y logotipo) en el encabezado', /class="wave" src="\$\{RENACE_WAVE_DATA_URI\}"/.test(hd) && /class="mark" src="\$\{RENACE_LOGO_DATA_URI\}"/.test(hd));
  ok('* la marca de agua sigue siendo la del Plan', /<img class="wm" src="\$\{RENACE_LOGO_DATA_URI\}"\/>/.test(shell));
  ok('* y Golden Touch no se cuela debajo del encabezado', !/GOLDEN_TOUCH/.test(shell.slice(shell.indexOf('<div class="rule">'))));
  ok('* el titulo lleva halo blanco para ganarle a las franjas de la ola', /\.hd \.tit span\{text-shadow:[^}]*#fff/.test(shell));
  const logoTs = fs.readFileSync(path.join(ROOT, 'src/lib/logoGoldenTouchData.ts'), 'utf8');
  ok('* el logo esta incrustado (data URI, no URL)', /export const GOLDEN_TOUCH_LOGO_DATA_URI = 'data:image\/jpeg;base64,/.test(logoTs));
  ok('* y pesa poco (cabe en el PDF sin engordarlo)', logoTs.length < 40000, String(logoTs.length));
}

// ── 8) LA LIBRERIA ES PURA ─────────────────────────────────────────────────
{
  const crudo = fs.readFileSync(path.join(ROOT, 'src/lib/tacticoOpciones.ts'), 'utf8');
  const vivo = crudo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok('no habla con Supabase', !/supabase|\.from\(/.test(vivo));
  ok('no importa React', !/from 'react/.test(vivo));
  // Sin regex con escapes: la herramienta de edicion ya convirtio un escape en un
  // byte de verdad una vez, y la prueba que vigilaba eso fue la que lo trajo.
  const ctrl = Array.from(crudo).some((ch) => { const c = ch.charCodeAt(0); return c < 32 && c !== 9 && c !== 10 && c !== 13; });
  ok('no trae bytes de control', !ctrl);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-reporte-tactico-opciones · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Las pastillas ocultan columnas, nunca maquinas; y lo oculto queda escrito en el papel.');
