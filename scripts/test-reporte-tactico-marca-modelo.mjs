/*
 * MARCA Y MODELO EN EL REPORTE DE UBICACIONES TACTICAS (31-ago-2026).
 *
 * Pedido del cliente, corto y claro: «a ese reporte, anadele marca y modelo a
 * las maquinarias» -- senalando el boton "Ubicaciones tacticas" del Conteo de
 * equipos, que es el que saca el INVENTARIO DE MAQUINARIA en PDF.
 *
 * Habia dos trampas escondidas ahi, y las dos venian de confundir tres campos
 * distintos de la maquina:
 *
 *   - `tipo`   = el tipo de equipo (excavadora, volteo...).
 *   - `marca`  = CAT, Komatsu, Kodiak...
 *   - `modelo` = 320, PC200, D6...
 *
 * El listado de maquinaria mostraba el `tipo` con un emoji de etiqueta, como si
 * fuera la marca. Y la tabla de "desplegadas por todo el territorio" ya tenia
 * una columna que DECIA "Marca/Modelo" pero adentro imprimia el `tipo`. O sea:
 * el reporte oficial que se imprime con membrete rotulaba mal un dato.
 *
 * Lo que fijan estos casos:
 *   - que la consulta TRAIGA marca y modelo (sin eso la columna sale vacia y
 *     nadie se entera: PostgREST no se queja de una columna que no pediste);
 *   - que la maquinaria tenga su columna propia de Marca / Modelo;
 *   - que el encabezado y la fila tengan LA MISMA CANTIDAD DE COLUMNAS, con y
 *     sin personal -- si se agrega un <th> y se olvida el <td>, la tabla se
 *     corre entera y el PDF sale con los datos bajo el titulo equivocado;
 *   - y que ya nadie imprima el `tipo` haciendolo pasar por marca.
 *
 *   node scripts/test-reporte-tactico-marca-modelo.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const fuente = fs.readFileSync(path.join(ROOT, 'src/screens/ReportsScreen.tsx'), 'utf8');
// Ciego a comentarios: un comentario que nombre "marca" no puede hacer pasar
// una prueba que pregunta si el CODIGO la imprime.
const limpio = fuente.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// El pedazo del reporte tactico, de su funcion hasta el resumen por sector.
const desde = limpio.indexOf('const downloadTacticalPdf');
const hasta = limpio.indexOf('const despliegueSectorHtml');
const bloque = desde >= 0 && hasta > desde ? limpio.slice(desde, hasta) : '';

// -- 0) LA REBANADA ES DE VERDAD --------------------------------------------
// Sin esto, un cambio de nombre dejaria el bloque vacio y TODO lo de abajo
// pasaria por casualidad (buscar en "" no encuentra nada malo).
ok('la funcion del reporte existe', desde >= 0);
ok('* y el bloque tiene cuerpo', bloque.length > 3000);
ok('* y es el reporte tactico, no otro', bloque.includes('INVENTARIO') || bloque.includes('class="tac"'));

// -- 1) LA CONSULTA TRAE LOS CAMPOS -----------------------------------------
const consulta = (bloque.match(/selectAllRows\('machinery',\s*'([^']+)'/) || [])[1] || '';
ok('la consulta de maquinaria existe', consulta.length > 0);
const columnas = consulta.split(',').map((c) => c.trim());
ok('* pide marca', columnas.includes('marca'));
ok('* pide modelo', columnas.includes('modelo'));
ok('* y sigue pidiendo tipo (es otro dato, no se toca)', columnas.includes('tipo'));

// -- 2) LA COLUMNA EN EL LISTADO DE MAQUINARIA -------------------------------
const encabezado = (bloque.match(/<table class="tac"><thead><tr><th style="width:30px">N[^<]*<\/th><th>Equipo \/ Tipo<\/th>[\s\S]*?<\/thead>/) || [])[0] || '';
ok('el listado de maquinaria tiene encabezado', encabezado.length > 0);
ok('* con la columna Marca / Modelo', /<th[^>]*>Marca \/ Modelo<\/th>/.test(encabezado));
ok('* y la de Placa / Serial sigue estando', /<th[^>]*>Placa \/ Serial<\/th>/.test(encabezado));

const fila = (bloque.match(/return `<tr><td>\$\{i \+ 1\}<\/td><td><b>\$\{esc\(equipCategory[\s\S]*?<\/tr>`;/) || [])[0] || '';
ok('la fila de maquinaria existe', fila.length > 0);
// El valor se arma unas lineas ANTES del return, asi que se mira el cuerpo del
// map completo; en la fila misma solo se comprueba que lo imprima.
const cuerpoFila = (bloque.match(/const est = estadoOf\(m\);[\s\S]*?<\/tr>`;/) || [])[0] || '';
ok('* el cuerpo de la fila existe', cuerpoFila.length > 0);
ok('* imprime marca y modelo juntos', /\[m\.marca, m\.modelo\]/.test(cuerpoFila));
ok('* y pone un guion cuando la maquina no los tiene cargados', /marcaModelo \|\| '—'/.test(fila));

// -- 3) LA TRAMPA QUE MAS FACIL SE ROMPE: LAS COLUMNAS SE DESALINEAN ---------
// Un <th> de mas sin su <td> corre toda la tabla: el PDF sale con la placa
// debajo de "Marca", la ubicacion debajo de "Placa", y nadie lo nota leyendo
// el codigo. Se cuentan las dos, con y sin la seccion de personal.
const contar = (txt, tag) => (txt.match(new RegExp('<' + tag + '[ >]', 'g')) || []).length;
const ths = contar(encabezado, 'th');
const tds = contar(fila, 'td');
eq('el encabezado y la fila tienen las MISMAS columnas', tds, ths);
eq('* y son 6 (N, equipo, marca/modelo, placa, ubicacion, estado)', ths, 6);

const opHead = (bloque.match(/const opHead = [^;]+;/) || [])[0] || '';
const opCols = (bloque.match(/const opCols = [^;]+;/) || [])[0] || '';
ok('las columnas de personal existen', opHead.length > 0 && opCols.length > 0);
eq('* y tambien cuadran entre si', contar(opCols, 'td'), contar(opHead, 'th'));

// -- 4) YA NADIE HACE PASAR EL `tipo` POR MARCA ------------------------------
ok('la fila ya no rotula el tipo como marca', !/🏷️\s*'\s*\+\s*esc\(marca\)/.test(fila));
ok('* el tipo sigue saliendo, pero como lo que es', /tipoEq/.test(fila));

// La tabla de "desplegadas por todo el territorio" DECIA Marca/Modelo y
// mostraba el tipo. Ahora muestra marca/modelo y usa el tipo solo de respaldo.
const sinUbic = (bloque.match(/const sinUbicHtml = [\s\S]*?: '';/) || [])[0] || '';
ok('la tabla de las desplegadas existe', sinUbic.length > 0);
ok('* dice Marca/Modelo', sinUbic.includes('Marca/Modelo'));
ok('* y ahora SI imprime marca y modelo', /\[m\.marca, m\.modelo\]/.test(sinUbic));

// -- 5) LAS PICK-UP ----------------------------------------------------------
const pick = (bloque.match(/const pickItems = \[[\s\S]*?\]\.sort/) || [])[0] || '';
ok('la lista de pick-up existe', pick.length > 0);
ok('* las de maquinaria muestran marca y modelo', /\[m\.marca, m\.modelo\]/.test(pick));
ok('* con el tipo de respaldo si no los tienen', /m\.tipo \? String\(m\.tipo\)\.trim\(\) : ''/.test(pick));
ok('* y las del modulo de Vehiculos siguen con brand/model', /\[v\.brand, v\.model\]/.test(pick));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-reporte-tactico-marca-modelo · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
