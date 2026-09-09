/*
 * Test del CUBICAJE Y REPORTE VOLUMÉTRICO de «Ruta de viajes de camiones»
 * (09-sep-2026).
 *
 * Pedido del cliente: poder decir cuántos metros cúbicos cargó cada camión en un
 * día o en un rango, y poder quitar y poner columnas del reporte.
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · el reporte POR DEFECTO sale con las columnas de siempre — si esto cambia,
 *     TODOS los reportes del sistema cambian de forma sin que nadie lo pidiera
 *   · el m³ de una línea del resumido es por-viaje × sus viajes, NO el total del
 *     camión: agrupando por listero el mismo camión sale bajo varios, y con el
 *     total entero en cada uno el reporte sumaría el mismo volumen dos veces
 *   · «2,5» con coma se lee como 2,5 y no como cero
 *   · las unidades sin medir NO entran al promedio como 0
 *   · repartir un total entre 0 viajes da 0, no Infinity
 *   · el apartado NO escribe en el catálogo de vehículos
 *
 * Sin framework (el repo no tiene): transpila el .ts en memoria con `typescript`.
 *
 *   node scripts/test-cubicaje.mjs
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

const srcPath = path.join(ROOT, 'src/lib/cubicaje.ts');
const fuente = fs.readFileSync(srcPath, 'utf8');
const out = ts.transpileModule(fuente, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const {
  num, volumen, volumenDe, redondear, clasificar, etiquetaClase, kpis, esUnidadOculta,
  repartirVolumen, sumaVolumen, columnasDetalle, columnasResumen, valoresEnOrden,
  reporteSinCifras, OPCIONES_POR_DEFECTO, dimsTexto, m3Texto, CLASES, MODOS,
} = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Quita comentarios: un guarda que se cumple porque la frase está en un
 *  comentario no está probando el código. */
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ── 1) LEER UN NÚMERO ESCRITO A MANO ────────────────────────────────────────
eq('la coma decimal se lee (acá se escribe 2,5 y no 2.5)', num('2,5'), 2.5);
eq('el punto también', num('2.5'), 2.5);
eq('un número ya numérico pasa igual', num(3), 3);
eq('vacío es cero', num(''), 0);
eq('texto que no es número es cero, no NaN', num('hola'), 0);
eq('null es cero', num(null), 0);
eq('NaN es cero', num(NaN), 0);
eq('espacios alrededor no estorban', num('  4,25  '), 4.25);

// ── 2) EL VOLUMEN ───────────────────────────────────────────────────────────
eq('alto × largo × ancho', volumen(2, 5, 2), 20);
eq('con coma decimal', volumen('2,5', '5', '2,3'), 28.75);
eq('redondea a dos decimales', volumen(1.111, 1.111, 1.111), 1.37);
eq('una medida en cero da cero', volumen(0, 5, 2), 0);
// Dos negativos multiplicados dan un positivo perfectamente creíble: sin este
// corte, medir «-2 × -5 × 2» imprimía 20 m³ en el reporte.
eq('una medida negativa da cero, no un positivo creíble', volumen(-2, -5, 2), 0);
eq('sin medidas, cero', volumen('', '', ''), 0);
eq('volumenDe lee el objeto', volumenDe({ alto: 3, largo: 6, ancho: 2.5 }), 45);
eq('redondear no revienta con infinito', redondear(Infinity), 0);

// ── 3) CLASIFICACIÓN: los bordes son los que se equivocan ───────────────────
eq('menos de 18 es compacto', clasificar(17.99), 'compacto');
eq('18 exacto es MEDIA, no compacto', clasificar(18), 'media');
eq('en medio del rango, media', clasificar(21), 'media');
eq('25 exacto es MEDIA, no gran', clasificar(25), 'media');
eq('más de 25 es gran capacidad', clasificar(25.01), 'gran');
// Pintar «Compacto» con 0 m³ diría que la volqueta es chiquita, cuando lo
// cierto es que nadie la ha medido.
eq('sin medir NO es compacto: es null', clasificar(0), null);
eq('un negativo tampoco clasifica', clasificar(-5), null);
eq('la etiqueta de lo no medido lo dice', etiquetaClase(0), 'Sin medir');
ok('la etiqueta de lo medido nombra su clase', etiquetaClase(30).includes('Gran capacidad'));
eq('hay exactamente tres clases', CLASES.length, 3);
eq('y los cortes son los que dio el cliente', CLASES.map((c) => [c.desde, c.hasta]), [[0, 18], [18, 25], [25, null]]);

// ── 4) LOS INDICADORES DE LA FLOTA ──────────────────────────────────────────
eq('mayor, menor y promedio', kpis([10, 20, 30]), { n: 3, mayor: 30, menor: 10, promedio: 20 });
// Un solo camión sin medir arrastraría el «menor» a 0 y hundiría el promedio:
// el panel diría que la flota carga la mitad de lo que carga.
eq('las unidades SIN MEDIR quedan fuera del cálculo, no cuentan como 0',
  kpis([10, 20, 30, 0, 0]), { n: 3, mayor: 30, menor: 10, promedio: 20 });
eq('sin ninguna medida, todo en cero y sin reventar', kpis([]), { n: 0, mayor: 0, menor: 0, promedio: 0 });
eq('una sola unidad: es el mayor, el menor y el promedio', kpis([18.5]), { n: 1, mayor: 18.5, menor: 18.5, promedio: 18.5 });
eq('el promedio se redondea a dos decimales', kpis([10, 11]).promedio, 10.5);

// ── 5) LA UNIDAD APARTADA ───────────────────────────────────────────────────
ok('reconoce el Sinotruk', esUnidadOculta('CARBOZULIA SINOTRUK', null, null));
ok('reconoce el HOWO', esUnidadOculta('Camion', 'Sinotruk', 'HOWO 380'));
ok('no le importan las mayúsculas', esUnidadOculta('howo'));
ok('un camión cualquiera NO queda apartado', !esUnidadOculta('CAMION VOLTEO TORONTO', 'Mack', 'Granite'));
ok('nulos y vacíos no apartan a nadie', !esUnidadOculta(null, undefined, ''));

// ── 6) CÓMO SE REPARTE EL VOLUMEN ───────────────────────────────────────────
const FILAS = [
  { key: 'A', viajes: 3, m3Tolva: 18, manual: 40 },
  { key: 'B', viajes: 1, m3Tolva: 22, manual: 0 },
];

const tolva = repartirVolumen('tolva', FILAS);
eq('tolva · total = viajes × m³ de su tolva', tolva.get('A'), { total: 54, porViaje: 18 });
eq('tolva · el otro camión', tolva.get('B'), { total: 22, porViaje: 22 });
eq('tolva · un camión SIN MEDIR queda en cero, no se le inventa volumen',
  repartirVolumen('tolva', [{ key: 'C', viajes: 5, m3Tolva: 0 }]).get('C'), { total: 0, porViaje: 0 });

const prop = repartirVolumen('proporcional', FILAS, 100);
// 3 de 4 viajes son de A: se lleva 75 de los 100. Si esto se repartiera en
// partes iguales por camión, el camión que hizo un viaje cobraría lo mismo que
// el que hizo tres.
eq('proporcional · reparte POR VIAJES, no por camión', prop.get('A'), { total: 75, porViaje: 25 });
eq('proporcional · el resto va al otro', prop.get('B'), { total: 25, porViaje: 25 });
eq('proporcional · lo repartido suma el total dado', sumaVolumen(prop), 100);
eq('proporcional · con 0 viajes NO divide entre cero',
  repartirVolumen('proporcional', [{ key: 'X', viajes: 0, m3Tolva: 10 }], 500).get('X'), { total: 0, porViaje: 0 });
eq('proporcional · acepta el total escrito con coma',
  sumaVolumen(repartirVolumen('proporcional', FILAS, '50,5')), 50.5);
// 50,5 entre 3 y 1 viajes da 37,875 y 12,625; redondeados suman 50,51. El
// reporte diría que se repartió UN total y cerraría con otro, y quien lo lea va
// a pensar que la cuenta está mal, no que sobró un céntimo del redondeo.
const resto = repartirVolumen('proporcional', FILAS, 50.5);
eq('proporcional · lo repartido cierra EXACTO con el total escrito', sumaVolumen(resto), 50.5);
eq('proporcional · el céntimo que sobra va al camión de más viajes', resto.get('A').total, 37.87);
eq('proporcional · y al otro no se le toca su parte', resto.get('B').total, 12.63);
eq('proporcional · el por-viaje se recalcula sobre el total corregido', resto.get('A').porViaje, 12.62);
// Con un solo camión no hay a quién darle el resto y tampoco hace falta.
eq('proporcional · un solo camión se lleva el total entero',
  repartirVolumen('proporcional', [{ key: 'U', viajes: 7, m3Tolva: 0 }], 33.33).get('U').total, 33.33);
// El ajuste es SOLO del reparto: en tolva y a mano no hay ningún total que cerrar.
eq('el ajuste del redondeo no se mete en el modo tolva', sumaVolumen(repartirVolumen('tolva', FILAS, 999)), 76);

const man = repartirVolumen('manual', FILAS);
eq('manual · manda lo escrito, y el por-viaje se deduce', man.get('A'), { total: 40, porViaje: 13.33 });
// «Escrito a mano» significa que manda la mano: caer a la tolva cuando no se
// escribió nada haría aparecer volumen que nadie autorizó.
eq('manual · sin nada escrito queda en cero, NO cae a la tolva', man.get('B'), { total: 0, porViaje: 0 });

eq('el modo se respeta: los tres dan totales distintos con las mismas filas',
  [sumaVolumen(tolva), sumaVolumen(prop), sumaVolumen(man)], [76, 100, 40]);
eq('hay exactamente tres modos', MODOS.map((x) => x.key), ['tolva', 'proporcional', 'manual']);

// ── 7) LAS COLUMNAS DEL REPORTE ─────────────────────────────────────────────
// ⭐ EL GUARDA MÁS IMPORTANTE DE ESTE ARCHIVO. Si lo nuevo entrara encendido,
//    todos los reportes de viajes del sistema cambiarían de forma sin que nadie
//    lo pidiera, y el primero en enterarse sería el cliente.
eq('POR DEFECTO el detallado saca EXACTAMENTE las columnas de siempre',
  columnasDetalle(OPCIONES_POR_DEFECTO).map((c) => c.head),
  ['Fecha', 'Hora', 'Empresa', 'Camión', 'Placa / Serial', 'Chofer', 'Listero', 'Turno', 'Estado']);
eq('POR DEFECTO el resumido también',
  columnasResumen(OPCIONES_POR_DEFECTO).map((c) => c.head),
  ['Camión', 'Placa / Serial', '☀️ Día', '🌙 Noche', 'Viajes']);
eq('lo nuevo entra APAGADO',
  [OPCIONES_POR_DEFECTO.m3, OPCIONES_POR_DEFECTO.marcaModelo, OPCIONES_POR_DEFECTO.dimensiones, OPCIONES_POR_DEFECTO.clasificacion],
  [false, false, false, false]);

const conM3 = { ...OPCIONES_POR_DEFECTO, m3: true };
ok('encender m³ agrega su columna al detallado', columnasDetalle(conM3).some((c) => c.key === 'm3'));
ok('y al resumido', columnasResumen(conM3).some((c) => c.key === 'm3'));
ok('la columna de m³ va alineada a la derecha (es un número)',
  columnasDetalle(conM3).find((c) => c.key === 'm3').num === true);

const sinPlaca = { ...OPCIONES_POR_DEFECTO, placa: false };
ok('apagar la placa la quita', !columnasDetalle(sinPlaca).some((c) => c.key === 'placa'));
ok('...y no se lleva nada más por delante', columnasDetalle(sinPlaca).length === 8);

const soloVolumen = { ...OPCIONES_POR_DEFECTO, m3: true, viajes: false, placa: false };
eq('reporte puramente volumétrico: camión y m³',
  columnasResumen(soloVolumen).map((c) => c.key), ['camion', 'm3']);
ok('apagar el conteo quita Día, Noche y Viajes del resumido',
  !columnasResumen(soloVolumen).some((c) => ['dia', 'noche', 'viajes'].includes(c.key)));
// En el detallado cada línea ES un viaje: apagar «conteo de viajes» no puede
// borrarle la fecha ni el camión, o el reporte dejaría de identificar nada.
eq('apagar el conteo NO desarma el detallado',
  columnasDetalle({ ...OPCIONES_POR_DEFECTO, viajes: false }).length,
  columnasDetalle(OPCIONES_POR_DEFECTO).length);

const todo = { m3: true, viajes: true, marcaModelo: true, dimensiones: true, clasificacion: true, placa: true, chofer: true, listero: true, turno: true, estado: true };
eq('con todo encendido, el detallado lleva 13 columnas', columnasDetalle(todo).length, 13);
eq('y el resumido 9', columnasResumen(todo).length, 9);
// Fecha, hora, empresa y camión no se pueden quitar: sin ellas la línea no
// identifica nada. Ningún interruptor debe poder dejar la tabla sin identidad.
const nada = { m3: false, viajes: false, marcaModelo: false, dimensiones: false, clasificacion: false, placa: false, chofer: false, listero: false, turno: false, estado: false };
eq('ningún interruptor puede dejar el detallado sin identificar la línea',
  columnasDetalle(nada).map((c) => c.key), ['fecha', 'hora', 'empresa', 'camion']);
eq('ni el resumido sin decir de qué camión habla', columnasResumen(nada).map((c) => c.key), ['camion']);

// ── 8) LOS VALORES SALEN EN EL ORDEN DE LAS COLUMNAS ────────────────────────
const cols = columnasDetalle(conM3);
const fila = valoresEnOrden(cols, {
  fecha: '09/09/2026', hora: '08:15', empresa: 'BERACA', camion: 'VOLTEO', placa: 'A98AJ0G',
  m3: '18.00', chofer: 'PÉREZ', listero: 'ANA', turno: 'Día', estado: 'Operativa',
});
eq('los valores salen en el mismo orden que los encabezados', fila.length, cols.length);
eq('y cada uno en su sitio', fila[fila.length - 1], 'Operativa');
eq('el m³ cae donde va su columna', fila[cols.findIndex((c) => c.key === 'm3')], '18.00');
// Una celda sin valor tiene que salir como raya: `undefined` impreso en un PDF
// es lo que ve el cliente.
eq('una celda sin valor sale como raya, nunca «undefined»',
  valoresEnOrden([{ key: 'chofer', head: 'Chofer' }], {}), ['—']);

// ── 9) UN REPORTE SIN NINGUNA CIFRA NO SE EMITE ─────────────────────────────
ok('resumido sin viajes y sin m³: se bloquea', reporteSinCifras({ ...nada }, true));
ok('con m³ encendido ya dice algo', !reporteSinCifras({ ...nada, m3: true }, true));
ok('con el conteo encendido también', !reporteSinCifras({ ...nada, viajes: true }, true));
// El detallado NUNCA se bloquea: cada línea es un viaje, así que siempre cuenta
// algo aunque todos los interruptores estén abajo.
ok('el detallado nunca se bloquea', !reporteSinCifras({ ...nada }, false));

// ── 10) TEXTOS PARA IMPRIMIR ────────────────────────────────────────────────
eq('las dimensiones se imprimen con dos decimales', dimsTexto({ alto: 2.5, largo: 5, ancho: 2.3 }), '2.50 × 5.00 × 2.30');
eq('sin medir, no se inventa una medida', dimsTexto({ alto: 0, largo: 5, ancho: 2 }), '');
eq('sin objeto tampoco', dimsTexto(null), '');
// Un «0.00» en la columna de volumen se lee como «cargó nada», y lo cierto es
// que no está medido.
eq('el cero se imprime como raya, no como 0.00', m3Texto(0), '—');
eq('un volumen real se imprime con dos decimales', m3Texto(18.5), '18.50');

// ── 11) GUARDAS SOBRE EL CÓDIGO ─────────────────────────────────────────────
const lib = leer('src/lib/cubicaje.ts');
const tab = leer('src/components/CubicajeTab.tsx');
const scr = leer('src/screens/ViajesCamionesScreen.tsx');
const libS = sinComentarios(lib);
const tabS = sinComentarios(tab);
const scrS = sinComentarios(scr);

// La librería es pura: se transpila y se corre sola en este test. Un import
// suelto (React, supabase) la rompería acá y en cualquier otro llamador.
ok('la librería del cubicaje NO importa nada', !/^\s*import\s/m.test(libS));

// ⭐ LA REGLA DE AISLAMIENTO. El catálogo se lee y nada más.
ok('la sub-pestaña no habla con supabase', !/supabase/i.test(tabS));
ok('...ni inserta, actualiza o borra nada', !/\.(insert|update|upsert|delete)\s*\(/.test(tabS));
ok('el componente dice que no toca el catálogo', /NO ESCRIBE NADA EN LA BASE/.test(tab));
ok('la librería lo dice también', /NO TOCA LA BASE DE DATOS/.test(lib));

// Las medidas se guardan en el teléfono, y eso hay que decirlo en pantalla: es
// la diferencia entre «se me perdió» y «esto es por dispositivo».
ok('avisa en pantalla que las medidas son de ese dispositivo', /en este dispositivo/i.test(tab));

// ⭐ EL DOBLE CONTEO. Agrupando por listero un mismo camión sale bajo cada uno.
ok('el m³ del resumido es por-viaje × sus viajes', /m3Fila\s*=\s*\(key: string, viajes: number\)\s*=>\s*redondear\(porViajeDe\(key\) \* viajes\)/.test(scrS));
ok('...y el PDF usa esa cuenta, no el total del camión', /m3:\s*m3Texto\(m3Fila\(c\.key, c\.viajes\)\)/.test(scrS));
ok('...y la vista previa usa la MISMA', /volumenPorCamion\.get\(c\.key\)\?\.porViaje/.test(scrS));

// El reporte se arma desde las columnas: si alguien vuelve a escribir los <th> a
// mano, encabezado y celdas se desalinean sin que nada avise.
ok('el PDF arma sus columnas con columnasDetalle', /columnasDetalle\(op\)/.test(scrS));
ok('y con columnasResumen', /columnasResumen\(op\)/.test(scrS));
ok('las celdas salen con valoresEnOrden', (scrS.match(/valoresEnOrden\(/g) ?? []).length >= 2);

// El volumen se calcula sobre LO FILTRADO: si se calculara sobre el rango sin
// filtrar, el reporte diría un volumen de camiones que no salen en él.
ok('los viajes por camión salen de las filas ya filtradas', /viajesPorCamion[\s\S]{0,300}?filteredRangeRows/.test(scrS));

// La sub-pestaña que abre por defecto es la de siempre.
ok('el panel abre en «viajes», no en el apartado nuevo', /useState<'viajes' \| 'cubicaje'>\('viajes'\)/.test(scrS));

// No se exporta una hoja vacía.
ok('el botón de exportar se apaga cuando no hay ninguna cifra', /disabled=\{shareBusy \|\| !!avisoReporte\}/.test(scrS));
ok('y compartirReporte también lo corta', /reporteSinCifras\(cub\.op, reporteModo === 'resumen'\)/.test(scrS));

// El subtítulo del PDF deja constancia del modo: dos reportes del mismo rango
// pueden traer m³ distintos y muy legales.
ok('el subtítulo del PDF dice con qué modo se calcularon los m³', /subtitle:[\s\S]{0,400}?cub\.modo/.test(scrS));

// El resumen expone la clave del camión: sin ella no hay forma de cruzar la
// línea del reporte con su medida.
const res = leer('src/lib/viajesResumen.ts');
ok('CamionResumen lleva su clave', /export type CamionResumen = \{ key: string;/.test(res));
ok('y se rellena al agrupar', /const cam = g\.camiones\.get\(ck\) \?\? \{\s*\n\s*key: ck,/.test(res));

// El manual tiene que hablar de esto: un módulo que nadie sabe usar es un
// módulo que no existe.
const md = leer('docs/MANUAL-USUARIO.md');
const ms = leer('src/screens/ManualScreen.tsx');
ok('el manual .md explica el cubicaje', /[Cc]ubicaje/.test(md));
ok('...y nombra los tres modos de reparto', /tolva/i.test(md) && /repartir/i.test(md) && /a mano/i.test(md));
ok('...y avisa de que las medidas son por dispositivo', /este dispositivo/i.test(md));
ok('el manual en pantalla también lo explica', /CUBICAJE/.test(ms));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-cubicaje · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
