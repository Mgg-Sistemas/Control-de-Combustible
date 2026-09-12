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
  [OPCIONES_POR_DEFECTO.m3, OPCIONES_POR_DEFECTO.marcaModelo, OPCIONES_POR_DEFECTO.dimensiones,
    OPCIONES_POR_DEFECTO.clasificacion, OPCIONES_POR_DEFECTO.ubicacion],
  [false, false, false, false, false]);
// La EMPRESA es la excepción, y a propósito: el detallado YA la traía y no se
// podía quitar. Apagarla por defecto le quitaría una columna al reporte de
// siempre, que es justo lo que esta sección existe para impedir.
eq('la empresa arranca ENCENDIDA porque ya estaba', OPCIONES_POR_DEFECTO.empresa, true);

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

// Se arman DESDE las claves reales, no con una lista escrita a mano: un
// interruptor nuevo que no se agregara aquí quedaría `undefined` —o sea
// apagado— y estas cuentas dirían que todo está encendido cuando no lo está.
// Pasó justo al sumar Empresa y Obra (12-sep-2026).
const todasLasClaves = Object.keys(OPCIONES_POR_DEFECTO);
const todo = Object.fromEntries(todasLasClaves.map((k) => [k, true]));
const nada = Object.fromEntries(todasLasClaves.map((k) => [k, false]));
eq('hay 12 interruptores', todasLasClaves.length, 12);
eq('con todo encendido, el detallado lleva 14 columnas', columnasDetalle(todo).length, 14);
eq('y el resumido 10', columnasResumen(todo, 'listero').length, 10);
// Fecha, hora y camión no se pueden quitar: sin ellas la línea no identifica
// nada. Ningún interruptor debe poder dejar la tabla sin identidad. La EMPRESA
// salió de este mínimo el 12-sep-2026, a pedido del cliente: se puede ocultar.
eq('ningún interruptor puede dejar el detallado sin identificar la línea',
  columnasDetalle(nada).map((c) => c.key), ['fecha', 'hora', 'camion']);
eq('ni el resumido sin decir de qué camión habla', columnasResumen(nada).map((c) => c.key), ['camion']);

// ── 7b) LA COLUMNA DEL EJE NO SE REPITE EN CADA FILA ───────────────────────
// Su valor ya está en el encabezado del grupo. Es lo que hace que agrupando por
// empresa —que es como se abre— el resumido salga idéntico a como salía antes.
ok('agrupando por empresa, el resumido no repite la empresa',
  !columnasResumen(OPCIONES_POR_DEFECTO, 'empresa').some((c) => c.key === 'empresa'));
ok('agrupando por listero, el resumido SÍ dice de qué empresa es cada camión',
  columnasResumen(OPCIONES_POR_DEFECTO, 'listero').some((c) => c.key === 'empresa'));
ok('agrupando por obra, también', columnasResumen(OPCIONES_POR_DEFECTO, 'ubicacion').some((c) => c.key === 'empresa'));
// ⚠️ En el RESUMIDO cada fila es un CAMIÓN, y el mismo camión pudo trabajar en
//    dos obras dentro del rango: una sola columna de obra tendría que elegir
//    cuál, y cualquier elección sería falsa la mitad de las veces. Por eso la
//    obra solo existe en el detallado, donde cada fila ES un viaje.
ok('el resumido NUNCA lleva columna de obra, ni encendiéndola',
  !columnasResumen({ ...OPCIONES_POR_DEFECTO, ubicacion: true }, 'listero').some((c) => c.key === 'ubicacion'));
ok('el detallado sí la lleva al encenderla',
  columnasDetalle({ ...OPCIONES_POR_DEFECTO, ubicacion: true }, 'listero').some((c) => c.key === 'ubicacion'));
ok('y no la repite cuando se agrupa por obra',
  !columnasDetalle({ ...OPCIONES_POR_DEFECTO, ubicacion: true }, 'ubicacion').some((c) => c.key === 'ubicacion'));
// La empresa se puede apagar, que es lo que se pidió.
ok('apagar la empresa la quita del detallado',
  !columnasDetalle({ ...OPCIONES_POR_DEFECTO, empresa: false }).some((c) => c.key === 'empresa'));

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

// ⭐ LA REGLA DE AISLAMIENTO. Desde que hay histórico, el cubicaje SÍ escribe
//    —pero SOLO en sus dos tablas nuevas. El catálogo de vehículos se lee y
//    nada más: ni una columna nueva, ni una fila tocada.
const datos = leer('src/lib/cubicajeDatos.ts');
const datosS = sinComentarios(datos);
ok('la sub-pestaña no habla con supabase directamente', !/from '\.\.\/lib\/supabase'/.test(tabS));
ok('el acceso a datos solo conoce sus dos tablas', /TABLA_MEDIDAS = 'camion_cubicaje'/.test(datosS) && /TABLA_CARGAS = 'camion_cubicaje_carga'/.test(datosS));
// ⚠️ EL GUARDA QUE PROTEGE EL CATÁLOGO. Si alguien escribe machinery acá, esto
//    falla. Es la promesa que se le hizo al cliente, hecha ejecutable.
ok('NADIE escribe en el catálogo de vehículos', !/from\('machinery'\)/.test(datosS) && !/from\('machinery'\)/.test(tabS));
ok('el componente lo dice en su cabecera', /EL CATÁLOGO DE VEHÍCULOS SE LEE Y NADA MÁS/.test(tab));
ok('la librería pura sigue sin tocar la base', /NO TOCA LA BASE DE DATOS/.test(lib));

// Sin el SQL corrido todo tiene que seguir funcionando, y decirlo.
ok('sin las tablas se cae al dispositivo y se avisa', /sinTabla/.test(tabS) && /AVISO_SIN_SQL/.test(tabS));
ok('el aviso nombra el SQL que falta', /03_cubicaje_camiones\.sql/.test(datos));
ok('reconoce «esa tabla no existe» por sus tres formas',
  /42p01/.test(datosS) && /pgrst205/.test(datosS) && /does not exist/.test(datosS));

// Las medidas a mano no tienen ficha: no pueden guardarse contra un camion.
ok('las unidades medidas a mano se quedan en el dispositivo', /solo en este dispositivo/.test(tab));

// El upsert por (camion, jornada) es lo que impide el volumen duplicado.
ok('las cargas se guardan con upsert por camión y jornada', /onConflict: 'machinery_id,jornada'/.test(datosS));
ok('y las medidas por camión', /onConflict: 'machinery_id'/.test(datosS));
// Un rango de un mes con 30 camiones son 900 filas: se manda en tandas.
ok('las cargas se mandan en tandas', /const TANDA = \d+/.test(datosS));

// ⭐ EL DOBLE CONTEO. Agrupando por listero un mismo camión sale bajo cada uno.
ok('el m³ del resumido es por-viaje × sus viajes', /m3Fila\s*=\s*\(key: string, viajes: number\)\s*=>\s*redondear\(porViajeDe\(key\) \* viajes\)/.test(scrS));
ok('...y el PDF usa esa cuenta, no el total del camión', /m3:\s*m3Texto\(m3Fila\(c\.key, c\.viajes\)\)/.test(scrS));
ok('...y la vista previa usa la MISMA', /volumenPorCamion\.get\(c\.key\)\?\.porViaje/.test(scrS));

// El reporte se arma desde las columnas: si alguien vuelve a escribir los <th> a
// mano, encabezado y celdas se desalinean sin que nada avise.
ok('el PDF arma sus columnas con columnasDetalle', /columnasDetalle\(op, resumenEje\)/.test(scrS));
ok('y con columnasResumen', /columnasResumen\(op, resumenEje\)/.test(scrS));
// Desde el 12-sep-2026 las columnas dependen también del EJE: la del eje no se
// repite en cada fila porque ya está en el encabezado del grupo. Si el PDF
// dejara de pasarlo, el resumido por empresa volvería a traer la empresa en
// cada línea y el papel se ensancharía sin motivo.
ok('...y les pasa el eje, no solo las opciones',
  /columnasDetalle\(op, resumenEje\)/.test(scrS) && /columnasResumen\(op, resumenEje\)/.test(scrS));
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


// ── 12) LO GUARDADO MANDA SOBRE LO CALCULADO ────────────────────────────────
const {
  volumenConGuardado, claveCarga, filasParaGuardar, totalCargas,
  cargasPorDia, cargasPorMes, cargasPorCamion, agruparHistorico,
  segmentoDe, pastillaClase, fechaCorta, mesLargo,
} = m.exports;

const PV = new Map([['t1', 10], ['t2', 5]]);
const DIAS = new Map([
  ['t1', new Map([['2026-09-01', 3], ['2026-09-02', 2]])],
  ['t2', new Map([['2026-09-01', 4]])],
]);

const sinGuardar = volumenConGuardado(PV, DIAS, new Map());
eq('sin nada guardado, todo se calcula', sinGuardar.get('t1'),
  { total: 50, porViaje: 10, guardados: 0, calculados: 2, desactualizados: 0 });

// ⭐ Un reporte de un mes viejo tiene que salir HOY con los mismos números que
//    salió aquel día. Si mandara el cálculo, corregir una medida reescribiría
//    el pasado en silencio.
const conGuardado = volumenConGuardado(PV, DIAS, new Map([
  [claveCarga('t1', '2026-09-01'), { m3: 99, viajes: 3 }],
]));
eq('la jornada guardada MANDA sobre la calculada', conGuardado.get('t1').total, 119);
eq('...y dice cuántas vinieron de cada sitio',
  [conGuardado.get('t1').guardados, conGuardado.get('t1').calculados], [1, 1]);
eq('el camión sin nada guardado no cambia', conGuardado.get('t2').total, 20);
// Corregir el guardado en silencio cambiaría un número por el que ya se cobró:
// se avisa, no se arregla solo.
const desfasado = volumenConGuardado(PV, DIAS, new Map([
  [claveCarga('t1', '2026-09-01'), { m3: 99, viajes: 7 }],
]));
eq('avisa si hoy hay otros viajes que cuando se guardó', desfasado.get('t1').desactualizados, 1);
eq('...y aun así sale el guardado, no el recalculado', desfasado.get('t1').total, 119);

const guardables = filasParaGuardar(PV, DIAS);
eq('se guarda una fila por camión y JORNADA, no una por rango', guardables.length, 3);
eq('...ordenadas por fecha', guardables.map((f) => f.jornada), ['2026-09-01', '2026-09-01', '2026-09-02']);
eq('cada fila lleva su m³ y sus viajes',
  guardables.find((f) => f.machinery_id === 't1' && f.jornada === '2026-09-02'),
  { machinery_id: 't1', jornada: '2026-09-02', m3: 20, viajes: 2 });
// Una fila en cero dice «ese día cargó nada»; lo cierto es que no trabajó.
eq('las jornadas sin viajes NO se guardan',
  filasParaGuardar(new Map([['t9', 5]]), new Map([['t9', new Map([['2026-09-01', 0]])]])).length, 0);

// ── 13) BUSCAR EL HISTÓRICO: POR DÍA, POR MES Y POR CAMIÓN ──────────────────
const HIST = [
  { machinery_id: 'a', machine_code: 'FIAT', jornada: '2026-09-01', m3: 60, viajes: 4 },
  { machinery_id: 'b', machine_code: 'TORONTO', jornada: '2026-09-01', m3: 40, viajes: 2 },
  { machinery_id: 'a', machine_code: 'FIAT', jornada: '2026-09-02', m3: 30, viajes: 2 },
  { machinery_id: 'a', machine_code: 'FIAT', jornada: '2026-08-30', m3: 15, viajes: 1 },
];
eq('el total del histórico', totalCargas(HIST), { m3: 145, viajes: 9, dias: 3, camiones: 2 });
// Los tres cortes salen de LA MISMA lista: por eso no pueden dejar de cuadrar.
eq('por día, por mes y por camión suman lo mismo',
  [cargasPorDia(HIST), cargasPorMes(HIST), cargasPorCamion(HIST)]
    .map((g) => g.reduce((a, x) => a + x.m3, 0)), [145, 145, 145]);
eq('por día, el más reciente arriba', cargasPorDia(HIST).map((g) => g.key),
  ['2026-09-02', '2026-09-01', '2026-08-30']);
eq('un día suma sus camiones', cargasPorDia(HIST)[1], { key: '2026-09-01', label: '2026-09-01', m3: 100, viajes: 6, n: 2 });
eq('por mes agrupa bien', cargasPorMes(HIST).map((g) => [g.key, g.m3]), [['2026-09', 130], ['2026-08', 15]]);
eq('por camión, el de más volumen primero', cargasPorCamion(HIST)[0], { key: 'a', label: 'FIAT', m3: 105, viajes: 7, n: 3 });
eq('el eje se elige por nombre', agruparHistorico(HIST, 'mes').length, 2);
eq('la fecha se escribe como se lee acá', fechaCorta('2026-09-03'), '03/09/2026');
eq('y el mes con su nombre', mesLargo('2026-09'), 'septiembre 2026');

// ── 14) SEGMENTAR LA FLOTA ──────────────────────────────────────────────────
eq('un volteo rígido es volteo', segmentoDe('Volteo Toronto Iveco Trakker'), 'volteo');
eq('un chuto es volqueta', segmentoDe('Chuto con Volqueta Iveco Trakker'), 'volqueta');
// "Chuto con Volqueta Iveco Trakker" y "Volteo Toronto Iveco Trakker" comparten
// marca y modelo: lo que decide es el chuto. Si mandara "volteo", un chuto de
// 21,90 m³ le subiría el máximo a una familia que no llega ahí.
eq('cuando el texto dice las dos cosas, manda volqueta', segmentoDe('Volteo con Volqueta'), 'volqueta');
eq('lo que no se reconoce cae en volteo', segmentoDe('Camion X'), 'volteo');

// Las pastillas, contra lo que dicen los PDF que mandó el cliente.
eq('27.16 es gran capacidad', pastillaClase(27.16, 'Carbozulia Sinotruk (HOWO)', 'volteo').texto, 'GRAN CAPACIDAD');
eq('21.90 es media capacidad', pastillaClase(21.90, 'Chuto Trakker', 'volqueta').texto, 'MEDIA CAPACIDAD');
eq('un Toronto lleva su propia etiqueta', pastillaClase(15.84, 'Volteo Toronto Iveco Trakker', 'volteo').texto, 'TORONTO');
// El mismo número dice cosas distintas según con quién se compare: entre los
// volteos rígidos 13,93 es lo normal; una volqueta de 12,38 sí es chica.
eq('bajo 18, un volteo es ESTÁNDAR', pastillaClase(13.93, 'Volteo Fiat', 'volteo').texto, 'ESTÁNDAR');
eq('bajo 18, una volqueta es COMPACTO', pastillaClase(12.38, 'Volqueta Doble Cajón', 'volqueta').texto, 'COMPACTO');
eq('sin medir no se clasifica', pastillaClase(0, 'X', 'volteo').texto, 'SIN MEDIR');

console.log(`\n${fail === 0 ? '✅' : '❌'} test-cubicaje · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
