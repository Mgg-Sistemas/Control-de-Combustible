// 🏭 Pruebas de los PAPELES del CENTRO DE OPERACIONES (23-oct-2026).
//
// src/lib/centroOperacionesPapel.ts convierte los modelos de cálculo
// (src/lib/centroOperaciones.ts) en el cuerpo HTML de los tres PDF:
//   · el consolidado del sitio (papel A),
//   · el corte de viajes por unidad (papel B),
//   · el listado detallado.
//
// Las reglas que vigilan estos candados:
//   · Todo texto escrito por el usuario sale LITERAL (escapado), nunca como HTML.
//   · Lo oculto no deja rastro: ni título, ni columna vacía, ni aviso en el papel.
//   · Las opciones y los filtros solo se nombran en el NOMBRE DEL ARCHIVO.
//   · Un período vacío sale con ceros y «Sin registros en el período», sin NaN.
//   · Flechas como carácter (→), nunca código crudo; ni un signo de dinero.
//
// ⭐ Todos los datos de abajo son SINTÉTICOS: nada de empresas, placas ni cifras
//    reales (el repositorio es público).
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
function loadTs(abs) {
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

const SRC_PAPEL = path.join(ROOT, 'src/lib/centroOperacionesPapel.ts');
const L = loadTs(path.join(ROOT, 'src/lib/centroOperaciones.ts'));
const P = fs.existsSync(SRC_PAPEL) ? loadTs(SRC_PAPEL) : {};

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
/** Corre `fn` y, si revienta (p. ej. la función todavía no existe), cuenta la falla en vez de abortar. */
const intenta = (name, fn) => {
  try { return fn(); } catch (e) { fail++; failures.push(`${name}\n    reventó: ${e && e.message}`); return ''; }
};

// ——— Datos sintéticos ———————————————————————————————————————————————————————
let seq = 0;
/** Un renglón con todo en blanco salvo lo que se le pase. */
const mov = (o = {}) => ({
  id: `m${++seq}`, sitioId: 's1', fecha: '2026-10-06', hora: null, tipo: 'entrada',
  unidadId: null, unidadTexto: '', placa: null,
  transportista: null, transportistaId: null, origen: null, origenId: null,
  destino: null, destinoId: null, material: null, materialId: null,
  capacidadM3: null, viajes: 1, toneladas: null, m3: null, estado: 'confirmado',
  observacion: null, creadoPor: null, creadoAt: null, editadoPor: null, editadoAt: null,
  ...o,
});

const OBS = '<b>x</b> & "y"';
const OBS_ESCAPADA = '&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;';
const U1 = { unidadId: 'u1', unidadTexto: 'Volteo U-1', placa: 'TST-001' };
const U2 = { unidadId: 'u2', unidadTexto: 'Volteo U-2', placa: 'TST-002' };

const MOVS = [
  // Entradas: 10 viajes, 208,6 t pesadas (la de Transportista C espera pesaje).
  mov({ fecha: '2026-10-06', hora: '08:10', transportista: 'Transportista A', origen: 'Frente 1', viajes: 4, toneladas: 92.4 }),
  mov({ fecha: '2026-10-06', hora: '09:00', transportista: 'Transportista B', origen: 'Frente 2', viajes: 3, toneladas: 70.2 }),
  mov({ fecha: '2026-10-07', transportista: 'Transportista A', origen: 'Frente 2', viajes: 2, toneladas: 46 }),
  mov({ fecha: '2026-10-07', transportista: 'Transportista C', origen: 'Frente 1', viajes: 1, toneladas: null, estado: 'esperando_pesaje' }),
  // Internos: 8 de Terraza 1 → Terraza 2 (U-1) y 2 de Terraza 2 → Terraza 3 (U-2), más uno por confirmar.
  mov({ ...U1, tipo: 'interno', fecha: '2026-10-06', origen: 'Terraza 1', destino: 'Terraza 2', capacidadM3: 18, viajes: 5 }),
  mov({ ...U1, tipo: 'interno', fecha: '2026-10-08', origen: 'Terraza 1', destino: 'Terraza 2', capacidadM3: 18, viajes: 3 }),
  mov({ ...U2, tipo: 'interno', fecha: '2026-10-07', origen: 'Terraza 2', destino: 'Terraza 3', capacidadM3: 24, viajes: 2 }),
  mov({ ...U2, tipo: 'interno', fecha: '2026-10-08', origen: 'Terraza 2', destino: 'Terraza 3', capacidadM3: 24, viajes: null, estado: 'por_confirmar' }),
  // Salidas: 2 confirmadas (U-1), 3 esperando pesaje (U-2) y una por confirmar sin número (U-1).
  mov({ ...U1, tipo: 'salida', fecha: '2026-10-07', material: 'Triturado', destino: 'Destino X', capacidadM3: 18, viajes: 2, observacion: OBS }),
  mov({ ...U1, tipo: 'salida', fecha: '2026-10-08', material: 'Triturado', destino: 'Destino X', capacidadM3: 18, viajes: null, estado: 'por_confirmar', observacion: 'Esperando la guía' }),
  mov({ ...U2, tipo: 'salida', fecha: '2026-10-09', material: 'Arena', destino: 'Destino Y', capacidadM3: 24, viajes: 3, estado: 'esperando_pesaje' }),
];
const RANGO = { desde: '2026-10-06', hasta: '2026-10-09' };
const CAB = { sitio: 'Sitio 1', corte: '09/10/2026, 07:00 p. m.' };

const DEF = P.OPCIONES_PAPEL_POR_DEFECTO || {};
const op = (cambios = {}) => ({ ...DEF, ...cambios });
const OP_OCULTOS = op({ ocultosSecciones: ['transportistas'], ocultosColumnas: ['pct'] });

const C = L.consolidadoSitio(MOVS, 'cantidad');
const C_VACIO = L.consolidadoSitio([], 'cantidad');
const K = L.cortePorUnidad(MOVS, RANGO, 'u1', { columnasPorDestino: true, diasSinAnotacion: 'cero' });
const K_VACIO = L.cortePorUnidad([], RANGO, 'u9', { columnasPorDestino: true, diasSinAnotacion: 'cero' });
const PERIODO = 'del 06/10/2026 al 09/10/2026';

const consolidado = (o = op(), ed = null, m = C, cab = CAB) => intenta('cuerpoConsolidado', () => P.cuerpoConsolidado(m, o, ed, cab));
const corte = (o = op(), ed = null, c = K, periodo = PERIODO) => intenta('cuerpoCorte', () => P.cuerpoCorte(c, o, ed, periodo));
const listado = (o = op(), movs = MOVS) => intenta('cuerpoListado', () => P.cuerpoListado(movs, o));

// ——— 1. Las piezas existen ———
for (const nombre of ['escaparHtml', 'resumenConsolidado', 'resumenCorte', 'cuerpoConsolidado', 'cuerpoCorte', 'cuerpoListado', 'nombreArchivoCop', 'tituloCop', 'subtituloCop', 'periodoCop']) {
  ok(`exporta ${nombre}()`, typeof P[nombre] === 'function');
}
ok('exporta CSS_COP (texto)', typeof P.CSS_COP === 'string' && P.CSS_COP.length > 0);

// ——— 2. Las opciones de nacimiento ———
eq('por defecto: logos de la casa (solo Golden Touch)', DEF.logos, { bcv: false, sos: false, golden: true, renace: false, jhenzaen: false });
eq('por defecto: nada oculto', [DEF.ocultosSecciones, DEF.ocultosColumnas], [[], []]);
eq('por defecto: orden, columnas por destino, días vacíos en cero, listado por día',
  [DEF.orden, DEF.columnasPorDestino, DEF.diasSinAnotacion, DEF.agruparListado], ['cantidad', true, 'cero', 'dia']);
eq('por defecto: los textos nacen en blanco (vuelven al automático)', [DEF.titulo, DEF.subtitulo, DEF.presentacion, DEF.consideraciones, DEF.emitida], ['', '', '', '', '']);

// ——— 3. Escapar (Review Focus 1) ———
eq('escaparHtml: < > & " salen literales', intenta('escaparHtml', () => P.escaparHtml(OBS)), OBS_ESCAPADA);
eq('escaparHtml: el apóstrofo también', intenta('escaparHtml', () => P.escaparHtml("d'Ávila")), 'd&#39;Ávila');
eq('escaparHtml: null y undefined → vacío', intenta('escaparHtml', () => [P.escaparHtml(null), P.escaparHtml(undefined)]), ['', '']);
eq('escaparHtml: un número se vuelve texto', intenta('escaparHtml', () => P.escaparHtml(12)), '12');

// ——— 4. El resumen del consolidado (tarjetas con clave estable) ———
const RC = intenta('resumenConsolidado', () => P.resumenConsolidado(C)) || { tarjetas: [], cuadros: [] };
eq('resumen: claves estables viajes, toneladas, promedio', RC.tarjetas.map((t) => t.k), ['viajes', 'toneladas', 'promedio']);
eq('resumen: valores con el formateador de la casa', RC.tarjetas.map((t) => t.valor), ['10', '208,60', '23,18']);
eq('resumen: sin cuadros (las tablas ya los cubren)', RC.cuadros, []);
const RV = intenta('resumenConsolidado vacío', () => P.resumenConsolidado(C_VACIO)) || { tarjetas: [] };
ok('resumen vacío: ceros y ni un NaN', RV.tarjetas.length === 3 && RV.tarjetas[0].valor === '0' && RV.tarjetas[1].valor === '0,00' && !JSON.stringify(RV).includes('NaN'));

// ——— 5. El consolidado con todo encendido ———
const H = consolidado();
ok('consolidado: membrete neutro con el sitio y el corte', H.includes('Sitio 1') && H.includes('09/10/2026, 07:00 p. m.'));
ok('consolidado: las tarjetas salen', H.includes('Viajes recibidos') && H.includes('208,60') && H.includes('23,18'));
ok('consolidado: «Recepción por empresa transportista» con sus empresas', H.includes('Recepción por empresa transportista') && H.includes('Transportista A') && H.includes('Transportista C'));
ok('consolidado: participación con un decimal y la fila de totales en 100 %', H.includes('Participación') && H.includes('60,0 %') && H.includes('100 %'));
ok('consolidado: el más viajes va primero (A antes que B y C)', H.indexOf('Transportista A') < H.indexOf('Transportista B') && H.indexOf('Transportista B') < H.indexOf('Transportista C'));
ok('consolidado: el interno se imprime con la flecha de verdad', H.includes('Terraza 1 → Terraza 2'));
// A6 (2): el pendiente va DEBAJO del número del total (en chico), como en el corte: «10 (+1
// pendiente)» en negrita y sin cortes ensanchaba la columna y la tabla se salía de la hoja.
ok('consolidado: los internos llevan su pendiente en el total (el número y, abajo, el aviso)', H.includes('<td class="n">10<small class="cop-pend">+1 pendiente</small></td>'));
ok('consolidado: las salidas llevan su pendiente en el total (el número y, abajo, el aviso)', H.includes('<td class="n">5<small class="cop-pend">+1 pendiente</small></td>'));
ok('consolidado: el resumen en texto sigue diciendo los viajes con su pendiente', H.includes('Viajes: 5 (+1 pendiente)'));
ok('consolidado: la salida que espera pesaje lo dice', H.includes('Esperando pesaje'));
ok('consolidado: el desglose por origen', H.includes('Frente 1') && H.includes('Frente 2') && H.includes('50,0 %'));
ok('consolidado: el resumen de salidas en texto, con la flecha', H.includes('Triturado → Destino X'));
ok('consolidado: el total de m³ despachados (36 + 72 = 108)', H.includes('108,00 m³'));
ok('consolidado: la presentación automática (sin texto propio)', H.includes('class="cop-pres"'));
ok('consolidado: sin la leyenda de vacío', !H.includes('Sin registros en el período'));
ok('consolidado: la presentación automática no cierra con doble punto («p. m..»)', !H.includes('p. m..'));

// ——— 6. Lo oculto no deja rastro ———
const HT = consolidado(op({ ocultosSecciones: ['transportistas'] }));
ok('⭐ sin transportistas: ni el título', !HT.includes('Recepción por empresa transportista'));
ok('⭐ sin transportistas: ni el nombre de ninguno', !/Transportista [ABC]/.test(HT));
const HP = consolidado(op({ ocultosColumnas: ['pct'] }));
ok('⭐ sin %: ni un «%» en el papel', !HP.includes('%'));
ok('⭐ sin %: ni «Participación»', !HP.includes('Participación'));
ok('sin %: las tablas siguen saliendo', HP.includes('Transportista A') && HP.includes('Frente 1'));
const SECCIONES = {
  presentacion: 'class="cop-pres"',
  tarjetas: 'Viajes recibidos',
  internos: 'Movimientos internos',
  salidas: 'Salidas / despacho',
  origenes: 'Recepción por frente u obra de origen',
  textoSalidas: 'Resumen de salidas',
};
for (const [sec, marca] of Object.entries(SECCIONES)) {
  ok(`sección «${sec}»: sale encendida`, H.includes(marca));
  ok(`⭐ sección «${sec}»: apagada no deja rastro`, !consolidado(op({ ocultosSecciones: [sec] })).includes(marca));
}
const HC = consolidado(op({ ocultosColumnas: ['toneladas', 'm3', 'capacidad', 'estado'] }));
ok('⭐ columnas apagadas: ni su encabezado', !/<th[^>]*>(Toneladas|m³|Capacidad|Estado)<\/th>/.test(HC));
// A9 (3): en TODO el papel, no solo en las celdas (el resumen en texto también lo decía).
ok('⭐ columnas apagadas: sin estado no se ve «esperando pesaje» en ninguna parte del papel', /esperando pesaje/i.test(H) && !/esperando pesaje/i.test(HC));
ok('⭐ ni encabezados ni celdas vacías de relleno', !/<th[^>]*><\/th>/.test(HC) && !/<th[^>]*><\/th>/.test(H));
const TODAS = Object.keys(SECCIONES).concat('transportistas');
const HN = consolidado(op({ ocultosSecciones: TODAS }));
ok('todo apagado: no queda un <div> vacío que deje página en blanco', !/<div[^>]*>\s*<\/div>/.test(HN) && !/<div[^>]*>\s*<\/div>/.test(H));

// ——— 7. El resumen ejecutivo editable (EdicionResumen) ———
const HE = consolidado(op(), { ocultos: ['toneladas'], titulos: { viajes: 'Viajes del período' }, valores: { promedio: '23,5' }, propias: [{ titulo: 'Clima', valor: 'Seco' }] });
ok('edición: la tarjeta escondida no sale', H.includes('Toneladas netas') && !HE.includes('Toneladas netas'));
ok('edición: renombrar y valor a mano', HE.includes('Viajes del período') && HE.includes('23,5'));
ok('edición: la tarjeta propia al final', HE.includes('Clima') && HE.includes('Seco'));

// ——— 8. Texto del usuario escapado en todos los papeles (Review Focus 1) ———
const CE = L.consolidadoSitio([mov({ transportista: '<i>T</i> & "Q"', origen: 'O<1>', viajes: 2, toneladas: 40 })], 'cantidad');
const HX = consolidado(op({ presentacion: 'Hola <script>x</script>' }), null, CE, { sitio: 'Sitio <b>', corte: '"hoy"' });
ok('⭐ consolidado: nombres, presentación y cabecera escapados', HX.includes('&lt;i&gt;T&lt;/i&gt; &amp; &quot;Q&quot;') && HX.includes('O&lt;1&gt;') && HX.includes('&lt;script&gt;') && HX.includes('Sitio &lt;b&gt;') && HX.includes('&quot;hoy&quot;'));
ok('⭐ consolidado: ni una etiqueta del usuario cruda', !HX.includes('<i>T</i>') && !HX.includes('<script>') && !HX.includes('Sitio <b>'));
const HK = corte(op({ consideraciones: 'Pago <u>sujeto</u> a guía' }));
ok('⭐ corte: la observación sale literal', HK.includes(OBS_ESCAPADA) && !HK.includes('<b>x</b>'));
ok('⭐ corte: las consideraciones salen literales', HK.includes('Pago &lt;u&gt;sujeto&lt;/u&gt; a guía') && !HK.includes('<u>'));
const HL = listado();
ok('⭐ listado: la observación sale literal', HL.includes(OBS_ESCAPADA) && !HL.includes('<b>x</b>'));

// ——— 9. Ni código crudo ni dinero ———
const PAPELES = { consolidado: H, corte: HK, listado: HL };
for (const [n, html] of Object.entries(PAPELES)) {
  ok(`${n}: sin «\\rightarrow» ni «$»`, html.length > 0 && !html.includes('\\rightarrow') && !html.includes('$'));
  ok(`${n}: sin NaN, undefined ni null impresos`, !/NaN|undefined|>null</.test(html));
}
ok('CSS_COP: sin «$» ni «\\rightarrow»', typeof P.CSS_COP === 'string' && !P.CSS_COP.includes('$') && !P.CSS_COP.includes('\\rightarrow'));
ok('CSS_COP: las filas no se parten entre hojas', /tr\{[^}]*page-break-inside:avoid/.test(P.CSS_COP || ''));
ok('CSS_COP: en el listado las cifras largas pueden partirse (no aplastan el recorrido)', /\.cop-listado td\.n\{[^}]*white-space:normal/.test(P.CSS_COP || ''));
ok('CSS_COP: las hojas del corte se separan con salto de página', /\.cop-hoja\+\.cop-hoja\{[^}]*page-break-before:always/.test(P.CSS_COP || ''));

// ——— 10. Período vacío (Review Focus 3) ———
const HV = consolidado(op(), null, C_VACIO);
ok('⭐ consolidado vacío: «Sin registros en el período»', HV.includes('Sin registros en el período'));
ok('⭐ consolidado vacío: ni una NaN', !HV.includes('NaN') && !HV.includes('Infinity'));
ok('consolidado vacío: las tarjetas salen en cero', HV.includes('Viajes recibidos') && HV.includes('>0<') && HV.includes('0,00'));
const KV = corte(op(), null, K_VACIO);
ok('⭐ corte vacío: «Sin registros en el período», sin NaN', KV.includes('Sin registros en el período') && !KV.includes('NaN'));
const LV = listado(op(), []);
ok('⭐ listado vacío: «Sin registros en el período», sin NaN, con total en cero', LV.includes('Sin registros en el período') && !LV.includes('NaN') && LV.includes('0,00'));

// ——— 11. El corte por unidad (papel B) ———
ok('corte: la ficha con la unidad, su placa y el período', HK.includes('Volteo U-1') && HK.includes('TST-001') && HK.includes(PERIODO));
const RK = intenta('resumenCorte', () => P.resumenCorte(K)) || { tarjetas: [] };
eq('corte: tarjetas con claves estables (R2)', RK.tarjetas.map((t) => t.k), ['internos', 'salidas', 'total']);
eq('⭐ corte: la tarjeta de salidas dice «2 (+1 pendiente)»', (RK.tarjetas.find((t) => t.k === 'salidas') || {}).valor, '2 (+1 pendiente)');
ok('corte: la tarjeta sale en el papel', HK.includes('2 (+1 pendiente)'));
ok('⭐ corte: la celda del día pendiente dice «Por confirmar»', /<td[^>]*>Por confirmar<\/td>/.test(HK));
ok('corte: cuatro días evaluados', HK.includes('4 días evaluados'));
ok('corte: una columna por destino', HK.includes('Destino X'));
ok('corte: las fechas en dd/mm/aaaa', HK.includes('06/10/2026') && HK.includes('09/10/2026'));
ok('corte: las consideraciones con su título', HK.includes('Consideraciones'));
ok('corte: sin consideraciones escritas, ni el título', !corte(op()).includes('Consideraciones'));
const HKE = corte(op(), { valores: { salidas: '99 a mano' }, ocultos: ['total'] });
ok('corte: la edición se aplica (valor a mano y tarjeta escondida)', HKE.includes('99 a mano') && HK.includes('Total de viajes') && !HKE.includes('Total de viajes'));
const K1 = L.cortePorUnidad(MOVS, RANGO, 'u1', { columnasPorDestino: false, diasSinAnotacion: 'ocultar' });
const HK1 = corte(op({ columnasPorDestino: false, diasSinAnotacion: 'ocultar' }), null, K1);
ok('corte: una sola columna «Salidas» y los días vacíos escondidos', HK1.includes('Salidas') && !HK1.includes('Destino X') && HK1.includes('3 días evaluados'));
const HKP = corte(op({ ocultosColumnas: ['placa', 'observaciones'] }));
ok('⭐ corte: sin placa ni observaciones no quedan ni sus datos', !HKP.includes('TST-001') && !HKP.includes('Observaciones') && !HKP.includes('Esperando la guía'));
ok('corte: va en su hoja (para unir varias unidades con salto de página)', HK.startsWith('<section class="cop-hoja">') && HK.endsWith('</section>'));
ok('corte: sin tarjetas apagadas no salen', !corte(op({ ocultosSecciones: ['tarjetas'] })).includes('Viajes internos'));
const K2 = L.cortePorUnidad(MOVS.concat(mov({ ...U1, tipo: 'salida', fecha: '2026-10-09', material: 'Arena', destino: 'Destino W', viajes: 2 })), RANGO, 'u1', { columnasPorDestino: true, diasSinAnotacion: 'cero' });
const HK2 = corte(op({ ocultosSecciones: ['tarjetas'] }), null, K2);
ok('corte con varios destinos: una columna por destino, en orden A→Z', HK2.indexOf('Destino W') > 0 && HK2.indexOf('Destino W') < HK2.indexOf('Destino X'));
ok('corte con varios destinos: el pendiente de las salidas no se pierde aunque no haya tarjetas', HK2.includes('Salidas: 4 (+1 pendiente)'));
ok('corte con un solo destino: el pendiente ya va en la fila de totales (no se repite abajo)', !HK.includes('Salidas: 2 (+1 pendiente)'));

// ——— 12. El listado detallado ———
ok('listado: por día, los días en orden', HL.indexOf('06/10/2026') < HL.indexOf('07/10/2026') && HL.indexOf('07/10/2026') < HL.indexOf('08/10/2026'));
ok('listado: sale cada renglón (las tres empresas y las dos unidades)', /Transportista A/.test(HL) && /Transportista C/.test(HL) && HL.includes('Volteo U-1') && HL.includes('Volteo U-2'));
ok('listado: el recorrido con la flecha', HL.includes('Terraza 1 → Terraza 2'));
ok('listado: el por confirmar lo dice en sus viajes', HL.includes('Por confirmar'));
ok('listado: el total al final con viajes y pendientes', HL.includes('25 (+2 pendientes)'));
ok('listado: el pendiente del grupo va junto a su título (la fila de subtotal lleva solo el número y no ensancha la tabla)', /<span>3 renglones · \+2 pendientes<\/span>/.test(HL) && !/<tr class="cop-total">((?!<\/tr>).)*pendiente/.test(HL));
const HLU = listado(op({ agruparListado: 'unidad' }));
ok('listado por unidad: un grupo por unidad (U-1 antes que U-2 por más viajes)', HLU.indexOf('Volteo U-1') < HLU.indexOf('Volteo U-2') && HLU.includes('Sin unidad'));
const HLT = listado(op({ agruparListado: 'tipo' }));
ok('listado por tipo: entradas, internos y salidas en ese orden', HLT.indexOf('Entradas') < HLT.indexOf('Movimientos internos') && HLT.indexOf('Movimientos internos') < HLT.indexOf('Salidas'));
ok('listado por día: la fecha ya va en el título del grupo, la columna es solo la hora', HL.includes('<th>Hora</th>') && HL.includes('>08:10<') && !HL.includes('Jornada / hora'));
// R4: la fecha de cada renglón es la de su JORNADA (7am a 7am), con la hora de reloj: la columna
// se llama «Jornada / hora» (un viaje del 06 a las 04:30 ocurrió el 07 de madrugada).
ok('⭐ R4: listado por unidad: la unidad va en el título del grupo, y cada renglón dice su jornada y su hora («Jornada / hora»)', !/<th[^>]*>Unidad<\/th>/.test(HLU) && HLU.includes('<th>Jornada / hora</th>') && !HLU.includes('Fecha / hora') && HLU.includes('06/10/2026 08:10'));
ok('R4: …y lo mismo por tipo', HLT.includes('<th>Jornada / hora</th>') && !HLT.includes('Fecha / hora'));
ok('listado por tipo: el tipo va en el título del grupo (sin columna repetida)', !/<th[^>]*>Tipo<\/th>/.test(HLT) && /<th[^>]*>Unidad \/ placa<\/th>/.test(HLT));
const HLO = listado(op({ ocultosColumnas: ['placa', 'transportista', 'observaciones', 'toneladas', 'm3', 'capacidad', 'estado'] }));
ok('⭐ listado: columnas apagadas sin rastro (ni encabezado ni dato)', !HLO.includes('TST-001') && !/Transportista [ABC]/.test(HLO) && !HLO.includes(OBS_ESCAPADA) && !/<th[^>]*>(Unidad \/ placa|Placa|Transportista|Observaciones|Ton\.|m³|Cap\. m³|Estado)<\/th>/.test(HLO) && /<th[^>]*>Unidad<\/th>/.test(HLO));
ok('listado: unidad y placa en una sola columna (así caben las columnas en la hoja)', /<th[^>]*>Unidad \/ placa<\/th>/.test(HL) && HL.includes('Volteo U-1<br/><small>TST-001</small>') && /<th[^>]*>Ton\.<\/th>/.test(HL));
ok('listado por unidad: la placa queda en su propia columna', /<th[^>]*>Placa<\/th>/.test(HLU) && !/<th[^>]*>Unidad \/ placa<\/th>/.test(HLU));
ok('listado: sin toneladas, ni su total', !HLO.includes('92,40') && !HLO.includes('208,60'));

// ——— 13. El nombre del archivo: el ÚNICO lugar que nombra opciones y filtros ———
const nombre = (papel, o, f) => intenta('nombreArchivoCop', () => P.nombreArchivoCop(papel, 'Sitio 1', RANGO, o, f));
const NO = nombre('consolidado', OP_OCULTOS);
ok('⭐ nombre: «sin transportistas» y «sin %»', NO.includes('sin transportistas') && NO.includes('sin %'));
ok('nombre: con lo de siempre no dice «sin »', !nombre('consolidado', op()).includes('sin '));
ok('nombre: lleva el papel, el sitio y el rango', /Consolidado/.test(NO) && NO.includes('Sitio 1') && NO.includes('2026-10-06') && NO.includes('2026-10-09'));
ok('nombre: la hora de corte sin «:» (prohibido en archivos)', intenta('nombre con corte', () => P.nombreArchivoCop('consolidado', 'Sitio 1', { ...RANGO, corteHora: '19:00' }, op())).includes('19-00'));
const NF = nombre('listado', op(), { tipos: ['entrada'], transportistas: ['Transportista A'] });
ok('nombre: los filtros se nombran con «solo»', NF.includes('solo entradas') && NF.includes('Transportista A'));
ok('nombre: ni un carácter prohibido en Windows', !/[\\/:*?"<>|]/.test(nombre('corte', OP_OCULTOS, { texto: 'a/b:c' })));
ok('nombre: lo oculto que no es de ese papel no se nombra', !nombre('listado', op({ ocultosSecciones: ['transportistas'] })).includes('sin transportistas'));
ok('nombre: el corte nombra sus columnas apagadas', nombre('corte', op({ ocultosColumnas: ['placa'] })).includes('sin placa'));

// ——— 14. Título y subtítulo: neutros siempre ———
for (const papel of ['consolidado', 'corte', 'listado']) {
  const sub = intenta('subtituloCop', () => P.subtituloCop(papel, 'Sitio 1', RANGO, OP_OCULTOS));
  ok(`⭐ subtítulo del ${papel}: no nombra opciones ni filtros`, sub.length > 0 && !/sin |solo |filtrado/i.test(sub));
  ok(`subtítulo del ${papel}: lleva el sitio`, sub.includes('Sitio 1'));
  ok(`título del ${papel}: tiene uno por defecto`, intenta('tituloCop', () => P.tituloCop(papel, op())).length > 0);
}
eq('título escrito: se usa y sale escapado (va directo al membrete)', intenta('tituloCop', () => P.tituloCop('consolidado', op({ titulo: 'Mi <b>papel</b>' }))), 'Mi &lt;b&gt;papel&lt;/b&gt;');
eq('subtítulo escrito: se usa y sale escapado', intenta('subtituloCop', () => P.subtituloCop('corte', 'Sitio 1', RANGO, op({ subtitulo: 'A & B' }))), 'A &amp; B');
eq('periodoCop: un día', intenta('periodoCop', () => P.periodoCop({ desde: '2026-10-09', hasta: '2026-10-09' })), '09/10/2026');
eq('periodoCop: un rango', intenta('periodoCop', () => P.periodoCop(RANGO)), 'del 06/10/2026 al 09/10/2026');
eq('periodoCop: con hora de corte', intenta('periodoCop', () => P.periodoCop({ ...RANGO, corteHora: '19:00' })), 'del 06/10/2026 al 09/10/2026, corte a las 07:00 p. m.');

// ——— 15. Lo que pidió la auditoría de la librería (A1, A3, B4, R2) ———
const OPK = { columnasPorDestino: true, diasSinAnotacion: 'cero' };
/** La fila del día `fecha` («dd/mm/aaaa») del detalle diario del corte, y sus celdas. */
const filaDe = (html, fecha) => (new RegExp(`<tr><td>${fecha}[\\s\\S]*?</tr>`).exec(html) || [''])[0];
const celdas = (fila) => [...fila.matchAll(/<td[^>]*>[\s\S]*?<\/td>/g)].map((x) => x[0]);
/** Los títulos de los grupos del listado (o de las secciones de un papel). */
const titulosDe = (html) => [...html.matchAll(/<div class="fr-h cop-h">([^<]*)/g)].map((x) => x[1]);
/** La fila de SUBTOTAL del grupo `titulo` del listado: { encabezado de la columna → su celda }. */
const subtotalDe = (html, titulo) => {
  const i = html.indexOf(`<div class="fr-h cop-h">${titulo}<`);
  if (i < 0) return {};
  const sec = html.slice(i, html.indexOf('</table>', i));
  const ths = [...sec.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((x) => x[1]);
  const pie = (/<tr class="cop-total">([\s\S]*?)<\/tr>/.exec(sec) || [])[1] || '';
  const celdasPie = [];
  for (const [, attrs, txt] of pie.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)) {
    const n = Number((/colspan="(\d+)"/.exec(attrs) || [])[1] || 1);
    for (let k = 0; k < n; k++) celdasPie.push(txt);
  }
  return Object.fromEntries(ths.map((t, k) => [t, celdasPie[k]]));
};

// A1: el listado agrupado por unidad recibe la regla ARMADA CON LA LISTA BASE (la misma
// que el corte). Acá la salida escrita a mano lleva la placa de U-1, pero el renglón que
// dice de quién es esa placa es un interno que el filtro «solo salidas» dejó afuera.
const BASE_A1 = [
  mov({ ...U1, tipo: 'interno', fecha: '2026-10-06', origen: 'Terraza 1', destino: 'Terraza 2', viajes: 5 }),
  mov({ unidadId: 'u1', unidadTexto: 'Volteo U-1', placa: null, tipo: 'salida', fecha: '2026-10-07', material: 'Arena', destino: 'Destino Z', viajes: 2 }),
  mov({ unidadId: null, unidadTexto: 'u-1 a mano', placa: 'tst-001', tipo: 'salida', fecha: '2026-10-06', material: 'Arena', destino: 'Destino Z', viajes: 3 }),
];
const SOLO_SALIDAS_A1 = L.filtrarMovimientos(BASE_A1, RANGO, { tipos: ['salida'] });
const OPU = op({ agruparListado: 'unidad' });
const HA1_SIN = intenta('cuerpoListado A1 sin regla', () => P.cuerpoListado(SOLO_SALIDAS_A1, OPU));
const HA1 = intenta('cuerpoListado A1 con regla', () => P.cuerpoListado(SOLO_SALIDAS_A1, OPU, L.unidadDeLosRenglones(BASE_A1)));
eq('A1: sin la regla de la base, el subconjunto parte a U-1 en dos grupos (lo de antes, por defecto)', titulosDe(HA1_SIN).length, 2);
eq('⭐ A1: con la regla de la base, la salida escrita a mano es de U-1 (un solo grupo, con el nombre de la unidad vinculada)', titulosDe(HA1), ['Volteo U-1']);
// A9 (2): se lee el SUBTOTAL del grupo (no el total general del listado, que pasaba aunque el grupo sumara otra cosa).
eq('A1: …y el grupo suma lo mismo que el corte de u1 (5 viajes de salida)',
  [subtotalDe(HA1, 'Volteo U-1').Viajes, L.cortePorUnidad(BASE_A1, RANGO, 'u1', OPK).totales.salidas], ['5', 5]);
ok('A1: la regla no cambia el listado agrupado por día', intenta('cuerpoListado A1 por día', () => P.cuerpoListado(SOLO_SALIDAS_A1, op(), L.unidadDeLosRenglones(BASE_A1))) === listado(op(), SOLO_SALIDAS_A1));

// A3: «Por confirmar» va en la columna DE SU TIPO. Un interno por confirmar no pinta nada
// en las salidas (la tarjeta de salidas no lo cuenta), y viceversa.
const K_U2 = L.cortePorUnidad(MOVS, RANGO, 'u2', OPK); // el 08: un interno por confirmar sin número, sin salidas
const HU2 = corte(op(), null, K_U2);
const f08 = celdas(filaDe(HU2, '08/10/2026'));
ok('⭐ A3: el interno por confirmar dice «Por confirmar» en la columna de internos', /Por confirmar/.test(f08[1] || ''));
eq('⭐ A3: …y la columna de salidas de ese día queda en 0 (no dice «Por confirmar»)', f08[2], '<td class="n">0</td>');
ok('A3: …ni la fecha lo marca (ya está en su columna)', !/Por confirmar/.test(f08[0] || ''));
ok('A3: la tarjeta de salidas de U-2 no tiene pendientes', HU2.includes('<b>3</b>') && !HU2.includes('3 (+'));

const PEND_A3 = [
  // 06: 5 internos confirmados y 3 más por confirmar.
  mov({ ...U1, tipo: 'interno', fecha: '2026-10-06', viajes: 5 }),
  mov({ ...U1, tipo: 'interno', fecha: '2026-10-06', viajes: 3, estado: 'por_confirmar' }),
  // 07: ninguna salida confirmada y 4 por confirmar (con número).
  mov({ ...U1, tipo: 'salida', fecha: '2026-10-07', destino: 'Destino X', viajes: 4, estado: 'por_confirmar' }),
  // 08: 2 salidas confirmadas y una más por confirmar sin número.
  mov({ ...U1, tipo: 'salida', fecha: '2026-10-08', destino: 'Destino X', viajes: 2 }),
  mov({ ...U1, tipo: 'salida', fecha: '2026-10-08', destino: 'Destino X', viajes: null, estado: 'por_confirmar' }),
];
const HP3 = corte(op(), null, L.cortePorUnidad(PEND_A3, RANGO, 'u1', OPK));
const p06 = celdas(filaDe(HP3, '06/10/2026'));
const p07 = celdas(filaDe(HP3, '07/10/2026'));
const p08 = celdas(filaDe(HP3, '08/10/2026'));
ok('A3: internos confirmados y por confirmar el mismo día: el número y, abajo, «+3 por confirmar»', /^<td class="n">5<small class="cop-pend">\+3 por confirmar<\/small><\/td>$/.test(p06[1] || ''));
eq('A3: …y las salidas de ese día siguen en 0', p06[2], '<td class="n">0</td>');
ok('⭐ A3: salidas por confirmar CON número en un día sin salidas: «4 por confirmar» en la columna de salidas', /^<td class="cop-pc"[^>]*>4 por confirmar<\/td>$/.test(p07[2] || ''));
ok('A3: …y los internos de ese día en 0', p07[1] === '<td class="n">0</td>');
ok('A3: salidas confirmadas y una por confirmar el mismo día: el número y, abajo, «+1 pendiente»', /^<td class="n">2<small class="cop-pend">\+1 pendiente<\/small><\/td>$/.test(p08[2] || ''));
ok('A3: …y la fecha no lo repite', !/pendiente|Por confirmar/.test(p08[0] || ''));
const PEND_A3_DOS = PEND_A3.concat(mov({ ...U1, tipo: 'salida', fecha: '2026-10-08', destino: 'Destino A', viajes: 1 }));
const HP3D = corte(op(), null, L.cortePorUnidad(PEND_A3_DOS, RANGO, 'u1', OPK));
const d08 = celdas(filaDe(HP3D, '08/10/2026'));
ok('A3: con varios destinos (no se sabe de cuál es lo pendiente) se dice junto a la fecha, nombrando las salidas', /<small class="cop-pend">Salidas: \+1 pendiente<\/small>/.test(d08[0] || ''));
eq('A3: …y las columnas de los destinos llevan solo sus números', d08.slice(2, 4), ['<td class="n">1</td>', '<td class="n">2</td>']);
ok('A3: sin nada por confirmar, ni una marca', !/cop-pend|cop-pc/.test(filaDe(HP3D, '09/10/2026')));

// B4: «Sin destino» escrito a mano y el destino en blanco son UNA columna: la cifra no se imprime dos veces.
const K_SD = L.cortePorUnidad([
  mov({ ...U1, tipo: 'salida', fecha: '2026-10-06', destino: null, viajes: 5 }),
  mov({ ...U1, tipo: 'salida', fecha: '2026-10-07', destino: 'sin destino', viajes: 1 }),
  mov({ ...U1, tipo: 'salida', fecha: '2026-10-08', destino: 'Destino A', viajes: 1 }),
], RANGO, 'u1', OPK);
const HSD = corte(op(), null, K_SD);
eq('B4: el corte tiene UNA columna «Sin destino», al final', [...HSD.matchAll(/<th class="n">([^<]*)<\/th>/g)].map((x) => x[1]), ['Destino A', 'Sin destino']);
ok('B4: la fila de totales suma lo mismo que el total de salidas (1 + 6 = 7)', /<tr class="cop-total"><td>TOTALES<\/td><td class="n">0<\/td><td class="n">1<\/td><td class="n">6<\/td>/.test(HSD) && K_SD.totales.salidas === 7);
const HSDC = consolidado(op(), null, L.consolidadoSitio([
  mov({ tipo: 'salida', material: 'Arena', destino: null, capacidadM3: 20, viajes: 2 }),
  mov({ tipo: 'salida', material: 'Arena', destino: 'Sin destino', capacidadM3: 20, viajes: 3 }),
], 'cantidad'));
eq('B4: el consolidado tiene UNA fila «Sin destino» en las salidas y una línea en el texto', (HSDC.match(/Sin destino/g) || []).length, 2);

// R2: la hoja de una unidad elegida que no trabajó en el período lleva su ficha, no su id.
const UUID = '3f2a9c1e-0000-4000-8000-000000000001';
const HF = corte(op(), null, L.cortePorUnidad(MOVS, RANGO, UUID, OPK, { unidad: 'Volteo U-7', placa: 'TST-007' }));
ok('⭐ R2: la ficha de la hoja dice la unidad y su placa, nunca el id crudo', HF.includes('Volteo U-7') && HF.includes('TST-007') && !HF.includes(UUID));
ok('R2: …y el período sin registros lo dice', HF.includes('Sin registros en el período'));

// B11 (aviso para la T2): material y destino con «<», «&» y comillas salen literales en el
// texto de salidas, en la tabla y en la columna del corte.
const HM = consolidado(op(), null, L.consolidadoSitio([mov({ tipo: 'salida', material: '<b>M</b>', destino: '&"D"', capacidadM3: 18, viajes: 2 })], 'cantidad'));
ok('⭐ consolidado: el texto de salidas con material y destino escapados', HM.includes('&lt;b&gt;M&lt;/b&gt; → &amp;&quot;D&quot;: 2 viajes') && !HM.includes('<b>M</b>'));
const HKM = corte(op(), null, L.cortePorUnidad([mov({ ...U1, tipo: 'salida', destino: '<i>D</i>', viajes: 1 })], RANGO, 'u1', OPK));
ok('⭐ corte: el destino de la columna sale escapado', HKM.includes('<th class="n">&lt;i&gt;D&lt;/i&gt;</th>') && !HKM.includes('<i>D</i>'));

// ——— 17. La auditoría de los papeles (lote 3) ———
// A2 = B1: corte de madrugada. «05:00» del 22 es el 23 a las 05:00: el papel dice ese día.
const MADRUGADA = { desde: '2026-10-20', hasta: '2026-10-22', corteHora: '05:00' };
eq('⭐ A2: periodoCop con 05:00 nombra el día real del corte', intenta('periodoCop', () => P.periodoCop(MADRUGADA)), 'del 20/10/2026 al 22/10/2026, corte el 23/10/2026 a las 05:00 a. m.');
eq('A2: periodoCop de un solo día con 05:00', intenta('periodoCop', () => P.periodoCop({ desde: '2026-10-01', hasta: '2026-10-01', corteHora: '05:00' })), '01/10/2026, corte el 02/10/2026 a las 05:00 a. m.');
// ⭐ R33 (revisión final A#2, 25-oct-2026; antes esta prueba fijaba lo contrario): un corte a
//    las 07:00 EN PUNTO cierra la jornada «hasta» (como el Reporte General, R28): el papel
//    nombra el día real, el siguiente. Con 07:01 ya es del mismo «hasta».
eq('⭐ R33: periodoCop con 07:00 nombra el día real del corte (el siguiente al «hasta»)', intenta('periodoCop', () => P.periodoCop({ ...MADRUGADA, corteHora: '07:00' })), 'del 20/10/2026 al 22/10/2026, corte el 23/10/2026 a las 07:00 a. m.');
eq('R33: periodoCop con 07:01 sigue diciendo «a las» (es el mismo día)', intenta('periodoCop', () => P.periodoCop({ ...MADRUGADA, corteHora: '07:01' })), 'del 20/10/2026 al 22/10/2026, corte a las 07:01 a. m.');
ok('⭐ R33: el nombre del archivo con 07:00 lleva el día real del corte', intenta('nombre 07', () => P.nombreArchivoCop('consolidado', 'Sitio 1', { ...MADRUGADA, corteHora: '07:00' }, op())).endsWith('2026-10-20 al 2026-10-22 corte 2026-10-23 07-00'));
eq('R33: el período del papel y corteCop de la librería dicen el mismo instante con 07:00',
  [P.periodoCop?.({ ...MADRUGADA, corteHora: '07:00' }).includes('23/10/2026'), (L.corteCop?.({ ...MADRUGADA, corteHora: '07:00' }) || '').startsWith('23/10/2026')], [true, true]);
eq('⭐ A2: el subtítulo automático también', intenta('subtituloCop', () => P.subtituloCop('consolidado', 'Sitio 1', MADRUGADA, op())), 'Sitio 1 · del 20/10/2026 al 22/10/2026, corte el 23/10/2026 a las 05:00 a. m.');
const NMAD = intenta('nombreArchivoCop', () => P.nombreArchivoCop('consolidado', 'Sitio 1', MADRUGADA, op()));
ok('⭐ A2: el nombre del archivo lleva el día real del corte', NMAD.endsWith('2026-10-20 al 2026-10-22 corte 2026-10-23 05-00'));
ok('A2: con 19:00 el nombre sigue igual (solo la hora)', intenta('nombre 19', () => P.nombreArchivoCop('consolidado', 'Sitio 1', { ...RANGO, corteHora: '19:00' }, op())).endsWith('2026-10-06 al 2026-10-09 corte 19-00'));
eq('A2: el período del papel y corteCop de la librería dicen el mismo instante', [P.periodoCop?.(MADRUGADA).includes('23/10/2026'), (L.corteCop?.(MADRUGADA) || '').startsWith('23/10/2026')], [true, true]);

// A1 = B11 = B12: una columna apagada no sale por otro lado (tarjetas, texto ni filas partidas).
const A1_MOVS = [
  mov({ tipo: 'entrada', transportista: 'Transportista A', viajes: 4, toneladas: 92.4 }),
  mov({ tipo: 'interno', origen: 'Terraza 1', destino: 'Terraza 2', capacidadM3: 18, viajes: 5 }),
  mov({ tipo: 'interno', origen: 'Terraza 1', destino: 'Terraza 2', capacidadM3: 24, viajes: 3 }),
  mov({ tipo: 'salida', material: 'Arena', destino: 'Destino Y', capacidadM3: 18, viajes: 3, toneladas: 61.5 }),
  mov({ tipo: 'salida', material: 'Arena', destino: 'Destino Y', capacidadM3: 18, viajes: 2, estado: 'esperando_pesaje' }),
  mov({ tipo: 'salida', material: 'Triturado', destino: 'Destino X', capacidadM3: 18, viajes: 2, toneladas: 40 }),
  mov({ tipo: 'salida', material: 'Triturado', destino: 'Destino X', capacidadM3: 24, viajes: 3, toneladas: 70 }),
];
const A1C = L.consolidadoSitio(A1_MOVS, 'cantidad');
const conOcultas = (cols) => consolidado(op({ ocultosColumnas: cols }), null, A1C);
const A1_TODO = conOcultas([]);
ok('A1: con todo a la vista salen las tarjetas de toneladas y promedio', A1_TODO.includes('Toneladas netas') && A1_TODO.includes('Promedio t/viaje') && A1_TODO.includes('92,40') && A1_TODO.includes('23,10'));
const A1_TON = conOcultas(['toneladas']);
ok('⭐ A1: sin toneladas, ni la tarjeta de toneladas ni la del promedio (ni sus cifras)', !A1_TON.includes('Toneladas netas') && !A1_TON.includes('Promedio t/viaje') && !A1_TON.includes('92,40') && !A1_TON.includes('23,10'));
ok('A1: …la de viajes sigue', A1_TON.includes('Viajes recibidos'));
eq('A1: resumenConsolidado con el op sin toneladas da solo «viajes»', intenta('resumenConsolidado op', () => P.resumenConsolidado(A1C, op({ ocultosColumnas: ['toneladas'] })).tarjetas.map((t) => t.k)), ['viajes']);
eq('A1: resumenConsolidado sin op: las tres de siempre', intenta('resumenConsolidado', () => P.resumenConsolidado(A1C).tarjetas.map((t) => t.k)), ['viajes', 'toneladas', 'promedio']);
const A1_M3 = conOcultas(['m3']);
ok('⭐ A1: sin m³, el resumen en texto no dice los m³ despachados', A1_TODO.includes('= 108 m³') && !A1_M3.includes('= 108') && !A1_M3.includes('= 90') && !A1_M3.includes('Total despachado: 198'));
ok('A1: sin m³, el total del resumen dice solo los viajes', A1_M3.includes('Total despachado: Viajes: 10'));
ok('⭐ A1: sin m³ ni capacidad, ni un «m³» en el papel', !conOcultas(['m3', 'capacidad']).includes('m³'));
const A1_CAP = conOcultas(['capacidad']);
eq('⭐ A1: sin capacidad, el mismo recorrido es UNA fila (antes dos filas iguales a la vista)', [(A1_TODO.match(/Terraza 1 → Terraza 2/g) || []).length, (A1_CAP.match(/Terraza 1 → Terraza 2/g) || []).length], [2, 1]);
ok('A1: …con la suma de los dos (8 viajes)', /Terraza 1 → Terraza 2<\/td><td class="n">8<\/td>/.test(A1_CAP));
ok('⭐ A1: sin capacidad, el texto no dice «de 18 m³»', A1_TODO.includes('de 18 m³') && !/de \d+ m³/.test(A1_CAP));
eq('⭐ A1: sin capacidad, Triturado → Destino X es UNA fila de salidas', (A1_CAP.match(/<td>Triturado<\/td><td>Destino X<\/td>/g) || []).length, 1);
const A1_EST = conOcultas(['estado']);
ok('⭐ A1: sin estado, ni «esperando pesaje» en ninguna parte del papel', /esperando pesaje/i.test(A1_TODO) && !/esperando pesaje/i.test(A1_EST));
eq('⭐ A1: sin estado, Arena → Destino Y es UNA fila (antes dos iguales a la vista: parecía un viaje contado dos veces)',
  [(A1_TODO.match(/<td>Arena<\/td><td>Destino Y<\/td>/g) || []).length, (A1_EST.match(/<td>Arena<\/td><td>Destino Y<\/td>/g) || []).length], [2, 1]);
ok('A1: …con sus 5 viajes y solo las toneladas pesadas', /<td>Arena<\/td><td>Destino Y<\/td><td class="n">18 m³<\/td><td class="n">5<\/td><td class="n">61,50<\/td>/.test(A1_EST));

// A3 = B5: el listado por unidad nunca saca dos grupos con el MISMO título (se juntan en el papel).
const A3_MOVS = [
  mov({ tipo: 'interno', fecha: '2026-10-07', unidadTexto: '', placa: null, viajes: 2 }),
  mov({ tipo: 'interno', fecha: '2026-10-06', unidadTexto: 'Volteo', placa: null, viajes: 1 }),
  mov({ tipo: 'interno', fecha: '2026-10-06', unidadTexto: 'Sin unidad', placa: null, viajes: 3 }),
];
const HA3 = listado(OPU, A3_MOVS);
eq('⭐ A3: el renglón en blanco y el escrito «Sin unidad» son UN grupo, al final', titulosDe(HA3), ['Volteo', 'Sin unidad']);
eq('A3: …que suma los dos (2 + 3)', subtotalDe(HA3, 'Sin unidad').Viajes, '5');
ok('A3: …con sus renglones en orden de jornada (el del 06 antes que el del 07)', (() => {
  const sec = HA3.slice(HA3.indexOf('<div class="fr-h cop-h">Sin unidad<'));
  return sec.indexOf('06/10/2026') >= 0 && sec.indexOf('06/10/2026') < sec.indexOf('07/10/2026');
})());
const A3_GEMELOS = [
  mov({ tipo: 'interno', unidadTexto: 'Volteo', placa: 'TST-101', viajes: 2 }),
  mov({ tipo: 'interno', unidadTexto: 'Volteo', placa: 'TST-102', viajes: 1 }),
];
eq('⭐ A3: con la placa apagada, dos «Volteo» sueltos son UN grupo (dos iguales delataban la placa escondida)',
  titulosDe(listado(op({ agruparListado: 'unidad', ocultosColumnas: ['placa'] }), A3_GEMELOS)), ['Volteo']);
eq('A3: con la placa a la vista siguen siendo dos (el título lleva la placa)', titulosDe(listado(OPU, A3_GEMELOS)), ['Volteo · TST-101', 'Volteo · TST-102']);

// A4 + R1: el corte de una unidad sin salidas en el período no pierde la columna de externos,
// y el encabezado agrupado lo decide el MODELO (`porDestino`), no el op del papel.
const thsDe = (html) => [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((x) => x[1]);
const K_SIN_SALIDAS = L.cortePorUnidad([mov({ ...U1, tipo: 'interno', fecha: '2026-10-06', viajes: 4 })], RANGO, 'u1', OPK);
const HSS = corte(op(), null, K_SIN_SALIDAS);
eq('⭐ A4: una unidad sin salidas conserva su columna de externos (ni «Salidas» sobre «Salidas»)', thsDe(HSS), ['Fecha', 'Internos', 'Salidas', 'Observaciones']);
ok('A4: …y la fila de totales trae las salidas en 0', /<tr class="cop-total"><td>TOTALES<\/td><td class="n">4<\/td><td class="n">0<\/td><td><\/td><\/tr>/.test(HSS));
ok('A4: …y cada día también (el 06: 4 internos, 0 salidas)', /<tr><td>06\/10\/2026<\/td><td class="n">4<\/td><td class="n">0<\/td>/.test(HSS));
const K_UNA_COL = L.cortePorUnidad(MOVS, RANGO, 'u1', { columnasPorDestino: false, diasSinAnotacion: 'cero' });
eq('⭐ R1: modelo con una sola columna y papel con «por destino»: sin el doble encabezado «Salidas/Salidas»',
  thsDe(corte(op({ columnasPorDestino: true }), null, K_UNA_COL)), ['Fecha', 'Internos', 'Salidas', 'Observaciones']);
eq('R1: …y al revés: modelo por destino, con su encabezado de grupo aunque el op diga otra cosa',
  thsDe(corte(op({ columnasPorDestino: false }), null, K)), ['Fecha', 'Internos', 'Salidas', 'Observaciones', 'Destino X']);

// A5: viajes sin una sola pesada no son «0,00» toneladas: es «sin dato» (ningún camión pesa 0).
const A5C = L.consolidadoSitio([
  mov({ tipo: 'entrada', transportista: 'Transportista A', viajes: 2, toneladas: 40 }),
  mov({ tipo: 'entrada', transportista: 'Transportista E', viajes: 1, estado: 'esperando_pesaje' }),
  mov({ tipo: 'salida', material: 'Arena', destino: 'Destino Y', capacidadM3: 18, viajes: 2 }),
], 'cantidad');
const HA5 = consolidado(op(), null, A5C);
ok('⭐ A5: la salida confirmada sin pesar dice «—» en toneladas', /<td>Arena<\/td><td>Destino Y<\/td><td class="n">18 m³<\/td><td class="n">2<\/td><td class="n">—<\/td>/.test(HA5));
ok('A5: …y el total de toneladas de las salidas también', /<tr class="cop-total"><td colspan="3">TOTALES<\/td><td class="n">2<\/td><td class="n">—<\/td>/.test(HA5));
ok('⭐ A5: el transportista con su único viaje esperando pesaje dice «—»', /<td>Transportista E<\/td><td class="n">1<\/td><td class="n">33,3 %<\/td><td class="n">—<\/td>/.test(HA5));
ok('A5: el que sí pesó sigue con su cifra', /<td>Transportista A<\/td><td class="n">2<\/td><td class="n">66,7 %<\/td><td class="n">40,00<\/td>/.test(HA5));
ok('⭐ A5: ni un «0,00» en el papel (suelto: «40,00» sí vale)', HA5.length > 0 && !/(^|[^\d.])0,00/.test(HA5));
const HA5S = consolidado(op(), null, L.consolidadoSitio([mov({ tipo: 'entrada', transportista: 'Transportista E', viajes: 1, estado: 'esperando_pesaje' })], 'cantidad'));
ok('A5: la tarjeta de toneladas sin ninguna pesada dice «—»', /<span>Toneladas netas<\/span><b>—<\/b>/.test(HA5S));
const A5L = listado(op({ agruparListado: 'tipo' }), [mov({ tipo: 'salida', material: 'Arena', viajes: 2 }), mov({ tipo: 'interno', viajes: 3 })]);
eq('⭐ A5: en el listado, el subtotal de un grupo sin pesadas dice «—» (como sus renglones)', [subtotalDe(A5L, 'Salidas')['Ton.'], subtotalDe(A5L, 'Movimientos internos')['Ton.']], ['—', '—']);
ok('A5: …y el total del listado también', A5L.includes('Toneladas: —'));
ok('A5: un período vacío sigue en ceros (no hay viajes: el cero es el dato)', consolidado(op(), null, C_VACIO).includes('0,00') && listado(op(), []).includes('Toneladas: 0,00'));

// A6: la forma del consolidado en la hoja.
ok('⭐ A6: la lista del resumen de salidas y su «Total despachado» van en un bloque que no se parte entre hojas',
  /<div class="cop-junto"><ul class="cop-lista">[\s\S]*?<\/ul><p class="fr-tot">Total despachado:[^<]*<\/p><\/div>/.test(H));
ok('⭐ A6: ese bloque no se parte (CSS)', /\.cop-junto\{[^}]*page-break-inside:avoid[^}]*break-inside:avoid/.test(P.CSS_COP || ''));
ok('⭐ A6: ninguna fila de totales del consolidado lleva «(+…)» pegado al número', /<tr class="cop-total">/.test(H) && !/<tr class="cop-total">((?!<\/tr>).)*\(\+/.test(H));
const HA6 = consolidado(op(), null, L.consolidadoSitio(MOVS.concat(mov({ transportista: 'Transportista A', viajes: 2, estado: 'por_confirmar' })), 'cantidad'));
ok('A6: también el total de la recepción (con entradas por confirmar)', HA6.includes('<td class="n">10<small class="cop-pend">+2 por confirmar</small></td>') && !/<tr class="cop-total">((?!<\/tr>).)*\(\+/.test(HA6));
ok('A6: el aviso de abajo puede partirse en renglones (no ensancha la columna)', /\.cop-pend\{[^}]*white-space:normal/.test(P.CSS_COP || ''));

// B2: «Emitida» también tiene su camino escapado (pdfDocument la pega tal cual en el membrete).
ok('B2: exporta emitidaCop()', typeof P.emitidaCop === 'function');
eq('⭐ B2: emitidaCop escapa lo escrito', intenta('emitidaCop', () => P.emitidaCop(op({ emitida: '<b>24/10</b> & "hoy"' }))), '&lt;b&gt;24/10&lt;/b&gt; &amp; &quot;hoy&quot;');
eq('B2: en blanco (o sin opciones) → undefined, para que pdfDocument ponga la fecha y hora reales',
  intenta('emitidaCop en blanco', () => [P.emitidaCop(op()), P.emitidaCop(op({ emitida: '   ' })), P.emitidaCop(null), P.emitidaCop(undefined)].map((x) => x === undefined)), [true, true, true, true]);
eq('B2: los espacios de más se van', intenta('emitidaCop espacios', () => P.emitidaCop(op({ emitida: '  24/10/2026   10:00 ' }))), '24/10/2026 10:00');

// B13: candado del escapado de las tarjetas EDITADAS (texto libre que llega a terceros):
// títulos, valores y notas a mano, y las tarjetas propias, en el consolidado y en el corte.
const edX = (k) => ({
  titulos: { [k]: '<i>T</i>' }, valores: { [k]: '1 & 2' }, notas: { [k]: '"nota"' },
  propias: [{ titulo: '<u>P</u>', valor: '<s>v</s>', nota: "<b>n</b> d'A" }],
});
for (const [papel, html] of [['consolidado', consolidado(op(), edX('viajes'))], ['corte', corte(op(), edX('salidas'))]]) {
  ok(`⭐ B13: ${papel}: título, valor y nota escritos a mano salen literales`, html.includes('&lt;i&gt;T&lt;/i&gt;') && html.includes('1 &amp; 2') && html.includes('&quot;nota&quot;'));
  ok(`⭐ B13: ${papel}: la tarjeta propia también`, html.includes('&lt;u&gt;P&lt;/u&gt;') && html.includes('&lt;s&gt;v&lt;/s&gt;') && html.includes('&lt;b&gt;n&lt;/b&gt; d&#39;A'));
  ok(`⭐ B13: ${papel}: ni una etiqueta del usuario cruda`, !/<i>T|<u>P|<s>v|<b>n<\/b>|"nota"/.test(html));
}

// B6: el papel no dice «Sin entradas» al lado de una tarjeta que anuncia entradas por confirmar.
const HB6 = consolidado(op(), null, L.consolidadoSitio([
  mov({ tipo: 'entrada', transportista: 'Transportista A', viajes: 3, estado: 'por_confirmar' }),
  mov({ tipo: 'entrada', viajes: null, estado: 'por_confirmar' }),
  mov({ tipo: 'interno', viajes: 2 }),
], 'cantidad'));
ok('B6: la tarjeta anuncia las entradas por confirmar', HB6.includes('0 (+1 pendiente, +3 por confirmar)'));
eq('⭐ B6: …y las dos secciones de recepción dicen «Sin entradas confirmadas», no «Sin entradas»',
  [(HB6.match(/Sin entradas en el período\./g) || []).length, (HB6.match(/Sin entradas confirmadas en el período\./g) || []).length], [0, 2]);
const HB6N = consolidado(op(), null, L.consolidadoSitio([mov({ tipo: 'interno', viajes: 2 })], 'cantidad'));
eq('B6: sin ninguna entrada (ni por confirmar), sigue «Sin entradas en el período.»', (HB6N.match(/Sin entradas en el período\./g) || []).length, 2);

// B7: con un sitio largo el nombre del archivo no pierde lo que nombra lo oculto: se recorta
// el SITIO (con «…»), nunca las marcas, y nunca pasa de 120 (exportPdf corta ahí a ciegas).
const SITIO_LARGO = 'Centro de Disposicion Temporal de Prueba Numero Uno, Frente Norte y Frente Sur del Proyecto Sintetico';
const NB7 = intenta('nombre largo', () => P.nombreArchivoCop('listado', SITIO_LARGO, RANGO, op({ ocultosColumnas: ['placa'] }), { transportistas: ['Transportista A'] }));
ok('⭐ B7: con un sitio de 100 caracteres el nombre no pasa de 120', NB7.length > 0 && NB7.length <= 120);
ok('⭐ B7: …y conserva las marcas de lo oculto y lo filtrado', NB7.endsWith(' - sin placa, solo Transportista A'));
ok('B7: …y el papel y la fecha', NB7.startsWith('Listado Centro de Disposicion') && NB7.includes('2026-10-06 al 2026-10-09'));
ok('B7: …y el sitio recortado lo dice con «…»', /Centro de Disposicion[^-]*… 2026-10-06/.test(NB7));
ok('B7: con el sitio corto no se recorta nada', !nombre('listado', op({ ocultosColumnas: ['placa'] }), { transportistas: ['Transportista A'] }).includes('…'));
const NB7X = intenta('nombre enorme', () => P.nombreArchivoCop('listado', 'S'.repeat(150), MADRUGADA,
  op({ ocultosColumnas: ['placa', 'transportista', 'capacidad', 'toneladas', 'm3', 'estado', 'observaciones'] }),
  { tipos: ['entrada', 'salida'], transportistas: ['Transportista A', 'Transportista B'], materiales: ['Arena'], texto: 'guía' }));
ok('⭐ B7: sitio de 150, siete columnas ocultas y cinco filtros: ≤ 120, con la fecha, el corte y las marcas resumidas',
  NB7X.length <= 120 && NB7X.includes('2026-10-20 al 2026-10-22 corte 2026-10-23 05-00') && NB7X.includes('sin 7 partes') && /solo|filtrado/.test(NB7X));
ok('⭐ B7: ni un carácter de control (Windows los prohíbe)', !/[\x00-\x1F\x7F]/.test(intenta('nombre control', () => P.nombreArchivoCop('consolidado', 'Sitio\x00 1\x1F\x7F', RANGO, op(), { texto: 'a\x01b' }))));

// R3: dos cortes de unidades distintas del mismo período no se pisan en Descargas: el
// nombre lleva las unidades (parámetro opcional al final; la unidad no está oculta: va en la hoja).
const nombreU = (unidades, o = op(), sitio = 'Sitio 1', f = { unidadIds: unidades.map((_, i) => `u${i + 1}`) }) =>
  intenta('nombreArchivoCop con unidades', () => P.nombreArchivoCop('corte', sitio, RANGO, o, f, unidades));
ok('⭐ R3: dos cortes de unidades distintas del mismo período no chocan', nombreU(['Volteo U-1']) !== nombreU(['Volteo U-2']));
eq('R3: la unidad va en el nombre (y ya no hace falta «solo 1 unidad»)', nombreU(['Volteo U-1']), 'Corte por unidad Sitio 1 2026-10-06 al 2026-10-09 - Volteo U-1');
eq('R3: hasta tres, por su nombre', nombreU(['U-1', 'U-2', 'U-3']), 'Corte por unidad Sitio 1 2026-10-06 al 2026-10-09 - U-1, U-2 y U-3');
eq('R3: más de tres, cuántas', nombreU(['U-1', 'U-2', 'U-3', 'U-4', 'U-5']), 'Corte por unidad Sitio 1 2026-10-06 al 2026-10-09 - 5 unidades');
eq('R3: con lo oculto, las unidades antes que las marcas', nombreU(['U-1'], op({ ocultosColumnas: ['placa'] })), 'Corte por unidad Sitio 1 2026-10-06 al 2026-10-09 - U-1 - sin placa');
ok('R3: el nombre de la unidad pasa por el saneo', !/[\\/:*?"<>|\x00-\x1F]/.test(nombreU(['U/1:"x"\x01'])) && nombreU(['U/1:"x"\x01']).includes('U 1 x'));
const NR3 = nombreU(['Unidad con un nombre larguisimo de prueba numero uno', 'Unidad con un nombre larguisimo de prueba numero dos'], op({ ocultosColumnas: ['placa', 'observaciones'] }), SITIO_LARGO);
ok('⭐ R3: sitio largo, unidades largas y marcas: dentro del tope de 120, con las marcas', NR3.length <= 120 && NR3.includes('sin placa') && NR3.includes('2026-10-06 al 2026-10-09'));
ok('R3: sin unidades, como antes («solo 1 unidad»)', nombre('corte', op(), { unidadIds: ['u1'] }).endsWith(' - solo 1 unidad'));

// B16: un texto larguísimo SIN espacios (un código o un enlace pegado) no se sale de la hoja
// del listado: se deja dónde partirlo (<wbr>) cada 20 caracteres. Nada de CSS que parta
// palabras: ese partía las cifras de TODOS los listados («1.638,/25»).
const PEGADO = 'GUIA-' + '0123456789'.repeat(12) + '-FIN';
const HB16 = listado(op(), [mov({ ...U1, tipo: 'salida', material: 'Arena' + 'X'.repeat(30), observacion: `${PEGADO} <b>&</b>`, transportista: 'T'.repeat(25), viajes: 2, toneladas: 1638.25 })]);
ok('⭐ B16: el texto largo sin espacios se parte cada 20 con <wbr>, sin perder un carácter', HB16.includes(PEGADO.match(/.{1,20}/g).join('<wbr>')));
ok('B16: también el material y el transportista', HB16.includes(`Arena${'X'.repeat(15)}<wbr>${'X'.repeat(15)}`) && HB16.includes(`${'T'.repeat(20)}<wbr>TTTTT`));
ok('B16: lo escapado sale entero (cada pedazo se escapa antes de unirlos)', HB16.includes('&lt;b&gt;&amp;&lt;/b&gt;'));
ok('⭐ B16: las cifras NO se parten', HB16.includes('1.638,25') && !/<td class="n">[^<]*<wbr>/.test(HB16));
ok('B16: un listado con textos normales no lleva ni un <wbr>', !listado(op()).includes('<wbr>'));
ok('B16: sin el CSS que parte palabras y cifras', !/overflow-wrap:anywhere|word-break/.test(P.CSS_COP || ''));

// R2: la hoja de una unidad suelta con solo placa nombra lo que se escribió, sin repetir la placa.
const SOLO_PLACA = [mov({ unidadId: null, unidadTexto: '', placa: 'TST-009', tipo: 'interno', fecha: '2026-10-06', viajes: 2 })];
const HR2 = corte(op(), null, L.cortePorUnidad(SOLO_PLACA, RANGO, L.unidadDeLosRenglones(SOLO_PLACA)(SOLO_PLACA[0]), OPK));
ok('⭐ R2: la ficha dice «Unidad: TST-009» (lo escrito), nunca la clave en minúsculas', HR2.includes('<b>Unidad:</b> TST-009') && !/tst-?009/.test(HR2));
ok('⭐ R2: …y no repite la placa', !HR2.includes('Placa:'));
ok('R2: la placa escrita de otra forma («tst 009») tampoco se repite', !corte(op(), null, { ...K, unidad: 'TST-009', placa: 'tst 009' }).includes('Placa:'));
ok('R2: una unidad con nombre y placa distintos sigue con las dos', HK.includes('<b>Unidad:</b> Volteo U-1') && HK.includes('<b>Placa:</b> TST-001'));

// ——— 15b. L4 A1: cada hoja del corte de varias unidades lleva título y emisión ———
// Para repartir las hojas sueltas (una a cada dueño), la hoja 2 en adelante dice qué es
// y cuándo se emitió. Va DENTRO de la <section> (así el salto de página de
// `.cop-hoja+.cop-hoja` sigue casando) y sin logo (los data: URI multiplicarían el HTML).
{
  const ENC = { titulo: 'Corte &amp; despacho', emitida: '24 oct. 2026, 05:00 p. m.' };
  const conEnc = intenta('cuerpoCorte con encabezado', () => P.cuerpoCorte(K, op(), null, PERIODO, ENC), '');
  ok('⭐ L4 A1: el encabezado va DENTRO de la hoja (el salto de página sigue casando)', conEnc.startsWith('<section class="cop-hoja"><div class="cop-hoja-enc">') && conEnc.endsWith('</section>'), conEnc.slice(0, 160));
  ok('⭐ L4 A1: con el título y la emisión, tal como llegan (ya escapados: no se escapan dos veces)', conEnc.includes('Corte &amp; despacho') && !conEnc.includes('&amp;amp;') && conEnc.includes('Emitida:') && conEnc.includes('24 oct. 2026, 05:00 p. m.'));
  ok('L4 A1: …antes de la ficha de la unidad', conEnc.indexOf('cop-hoja-enc') < conEnc.indexOf('cop-ficha'));
  ok('⭐ L4 A1: sin logo por hoja', !/<img/i.test(conEnc));
  eq('L4 A1: sin encabezado, la hoja es la de siempre (parámetro opcional)', corte(), intenta('cuerpoCorte', () => P.cuerpoCorte(K, op(), null, PERIODO, undefined), ''));
  const soloTitulo = intenta('cuerpoCorte solo título', () => P.cuerpoCorte(K, op(), null, PERIODO, { titulo: 'Corte' }), '');
  ok('L4 A1: sin emisión, solo el título (no un «Emitida:» vacío)', soloTitulo.includes('cop-hoja-enc') && !soloTitulo.includes('Emitida:'));
  ok('L4 A1: el CSS del encabezado de hoja está en CSS_COP', /\.cop-hoja-enc\{/.test(P.CSS_COP || ''));
}

// ——— 15c. PD5b: el 📄 Reporte completo es un papel más, y los bloques en los papeles (A4) ———
{
  ok('⭐ PD5b: tabla() se exporta (el Reporte completo la importa en vez de copiarla)', typeof P.tabla === 'function');
  ok('⭐ PD5b: ficha() se exporta (ídem)', typeof P.ficha === 'function');
  eq('PD5b: ficha() con lo vacío fuera y escapada', intenta('ficha', () => P.ficha([['Sitio', 'A & B'], ['Corte', '  ']])),
    '<div class="cop-ficha"><span><b>Sitio:</b> A &amp; B</span></div>');
  eq('PD5b: tabla() sin filas ni totales no dibuja nada', intenta('tabla vacía', () => P.tabla([{ titulo: 'X', celda: (f) => f }], [])), '');
  eq('⭐ PD5b: SECCIONES_COP.completo = las 7 del Reporte completo, en el orden de su hoja', (P.SECCIONES_COP?.completo ?? []).map((s) => s.k),
    ['reporteGeneral', 'patios', 'agregados', 'acero', 'aluminioPlastico', 'maquinaria', 'bloques']);
  eq('PD5b: el Reporte completo no tiene columnas que esconder', P.COLUMNAS_COP?.completo, []);
  eq('PD5b: su título de siempre', intenta('tituloCop completo', () => P.tituloCop('completo', { titulo: '' })), 'Reporte completo');
  eq('⭐ PD5b: el nombre del archivo dice el papel y lo escondido (como los otros papeles)',
    intenta('nombreArchivoCop completo', () => P.nombreArchivoCop('completo', 'Sitio 1', RANGO, op({ ocultosSecciones: ['patios', 'maquinaria'] }))),
    'Reporte completo Sitio 1 2026-10-06 al 2026-10-09 - sin patios, sin maquinaria');
  eq('PD5b: …y sin nada escondido, solo el papel, el sitio y el período',
    intenta('nombreArchivoCop completo limpio', () => P.nombreArchivoCop('completo', 'Sitio 1', { desde: '2026-10-07', hasta: '2026-10-07' }, op())),
    'Reporte completo Sitio 1 2026-10-07');
  ok('⭐ PD5b: el CSS del Reporte completo vive en CSS_COP (un solo CSS para los papeles del módulo)',
    /\.cop-nota\{/.test(P.CSS_COP || '') && /\.cop-pdte\{/.test(P.CSS_COP || '') && /\.cop-completo /.test(P.CSS_COP || ''));

  // A4 · el listado: la columna «Cantidad» solo si algún renglón trae piezas.
  const BLOQ = [
    mov({ tipo: 'produccion', material: 'Bloques', cantidad: 1200, viajes: null, unidadIngresada: 'u', fecha: '2026-10-07' }),
    mov({ tipo: 'salida', material: 'Bloques', cantidad: 40, viajes: null, unidadIngresada: 'u', destino: 'Cliente Prueba', fecha: '2026-10-07' }),
  ];
  const conPiezas = listado(op(), [...MOVS, ...BLOQ]);
  ok('⭐ PD5b A4: con renglones de piezas, el listado trae la columna «Cantidad»', conPiezas.includes('<th class="n">Cantidad</th>'));
  ok('PD5b A4: …con sus cifras (es-VE) en su renglón', conPiezas.includes('<td class="n">1.200</td>') && conPiezas.includes('<td class="n">40</td>'));
  ok('PD5b A4: …y «—» en los renglones sin piezas', /Triturado<\/td>[^]*?<td class="n">—<\/td>/.test(conPiezas));
  ok('⭐ PD5b A4: sin ningún renglón de piezas, la columna no existe (sin rastro)', !listado().includes('Cantidad'));
  ok('PD5b A4: el tipo sale legible («Producción», nunca la clave cruda)', conPiezas.includes('<td>Producción</td>') && !/>produccion</.test(conPiezas));
  const porTipo = listado(op({ agruparListado: 'tipo' }), [...MOVS, ...BLOQ]);
  ok('PD5b A4: agrupado por tipo, el grupo se llama «Producción»', porTipo.includes('>Producción<span>') && !/>produccion</.test(porTipo));
  ok('PD5b A4: la cantidad no se suma en los subtotales (producción y ventas no se mezclan)', !/Subtotal[^]*?1\.240/.test(conPiezas));

  // A4 · el consolidado: la venta de bloques no es un viaje.
  const conVenta = consolidado(op(), null, L.consolidadoSitio([...MOVS, ...BLOQ], 'cantidad'));
  ok('⭐ PD5b A4: el consolidado no imprime la venta de bloques como salida de viajes', !conVenta.includes('Bloques') && !conVenta.includes('Cliente Prueba'));
  eq('PD5b A4: …y sale igual que sin ella', conVenta, consolidado(op(), null, L.consolidadoSitio(MOVS, 'cantidad')));
}

// ——— 16. La librería es PURA ———
const srcPapel = fs.existsSync(SRC_PAPEL) ? fs.readFileSync(SRC_PAPEL, 'utf8') : '';
const importos = [...srcPapel.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((x) => x[1]);
ok('pura: solo importa de ./centroOperaciones y ./frentesReporte', importos.length > 0 && importos.every((i) => i === './centroOperaciones' || i === './frentesReporte'));
ok('pura: sin require() escondidos', srcPapel.length > 0 && !/require\(/.test(srcPapel));
ok('pura: no escribe en ninguna base (sin insert/update/delete/rpc)', srcPapel.length > 0 && !/\.(insert|update|delete|upsert|rpc)\(/.test(srcPapel));
ok('pura: no usa la hora del equipo (new Date() sin argumentos ni Date.now)', srcPapel.length > 0 && !/new Date\(\s*\)|Date\.now\(/.test(srcPapel));

// ——— Cierre ———
console.log(`\n${fail === 0 ? '✅' : '❌'} test-centro-operaciones-papel · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.map((f) => `  ✗ ${f}`).join('\n')); process.exit(1); }
