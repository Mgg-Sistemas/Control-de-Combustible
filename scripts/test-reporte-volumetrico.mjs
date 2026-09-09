/*
 * Test del REPORTE «Análisis Técnico y Capacidad Volumétrica de Flota»
 * (09-sep-2026).
 *
 * El cliente mandó dos PDF de muestra y pidió que el reporte del cubicaje
 * saliera así. Este archivo fija el documento contra ESAS muestras, unidad por
 * unidad: las once filas de sus tablas, con sus medidas y su clasificación.
 *
 * ⚠️ TRES DE SUS VOLÚMENES NO CUADRAN CON SUS PROPIAS MEDIDAS. Están anotados
 *    abajo con la cuenta hecha. El sistema imprime el resultado correcto de
 *    alto × largo × ancho, no el número del PDF de muestra: se cobra por m³ y
 *    copiar un error para que "coincida" sería el peor de los dos caminos.
 *
 * Lo demás que fija:
 *   · las secciones se numeran en el orden en que SALEN (1,2,3,4,5)
 *   · un identificador con `<` no puede romper ni reescribir el documento
 *   · las unidades sin medir no entran, y con cero unidades no revienta
 *   · el bloque del histórico solo aparece si hay algo guardado
 *
 *   node scripts/test-reporte-volumetrico.mjs
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

function cargar(rel, deps = {}) {
  const p = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const mod = new Module(p);
  mod.filename = p;
  mod.paths = Module._nodeModulePaths(path.dirname(p));
  const req = (id) => (deps[id] ? deps[id] : require(id));
  new Function('exports', 'module', 'require', out)(mod.exports, mod, req);
  return mod.exports;
}

const cub = cargar('src/lib/cubicaje.ts');
const rep = cargar('src/lib/reporteVolumetrico.ts', { './cubicaje': cub });

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const U = (ident, alto, largo, ancho) => ({
  ident, alto, largo, ancho,
  m3: cub.volumen(alto, largo, ancho),
  segmento: cub.segmentoDe(ident),
});

// ── LAS ONCE UNIDADES DE LOS PDF DEL CLIENTE, CON SUS MEDIDAS EXACTAS ───────
const FLOTA = [
  U('Volteo Toronto Iveco Trakker', 1.16, 5.91, 2.31),
  U('Volteo Fiat', 1.32, 4.65, 2.27),
  U('Volteo Iveco Eurotech', 1.30, 5.30, 2.34),
  U('Volteo Mitsubishi', 1.30, 4.65, 2.28),
  U('Volteo Renault Ikemaz', 1.30, 5.90, 2.30),
  U('Volteo Freightliner', 1.20, 5.10, 2.30),
  U('Chuto con Volqueta Iveco Trakker', 1.25, 7.30, 2.40),
  U('Chuto Volqueta Doble Tolva MAX-400', 1.10, 9.15, 2.38),
  U('Volqueta Iveco Eurotech Doble Cajón', 1.20, 4.30, 2.40),
  U('Volqueta Iveco Telescópica Eurotech', 1.40, 7.30, 2.40),
  U('Carbozulia Sinotruk (HOWO)', 1.70, 6.29, 2.54),
];

// Ocho coinciden EXACTAMENTE con el número impreso en los PDF del cliente.
eq('Toronto Trakker · 1.16 × 5.91 × 2.31', FLOTA[0].m3, 15.84);
eq('Fiat · 1.32 × 4.65 × 2.27', FLOTA[1].m3, 13.93);
eq('Renault Ikemaz · 1.30 × 5.90 × 2.30', FLOTA[4].m3, 17.64);
eq('Freightliner · 1.20 × 5.10 × 2.30', FLOTA[5].m3, 14.08);
eq('Chuto Trakker · 1.25 × 7.30 × 2.40', FLOTA[6].m3, 21.90);
eq('Doble Cajón · 1.20 × 4.30 × 2.40', FLOTA[8].m3, 12.38);
eq('Telescópica Eurotech · 1.40 × 7.30 × 2.40', FLOTA[9].m3, 24.53);
eq('Sinotruk HOWO · 1.70 × 6.29 × 2.54', FLOTA[10].m3, 27.16);

// ⚠️ LOS TRES QUE NO. La cuenta está hecha al lado; el PDF de muestra trae otro
//    número. Se fija el CORRECTO a propósito: si mañana alguien "arregla" esto
//    para que cuadre con la muestra, este test se lo dice.
eq('Iveco Eurotech · 1.30 × 5.30 × 2.34 = 16.1226 (el PDF dice 16.15)', FLOTA[2].m3, 16.12);
eq('Mitsubishi · 1.30 × 4.65 × 2.28 = 13.7826 (el PDF dice 13.80)', FLOTA[3].m3, 13.78);
eq('Doble Tolva MAX-400 · 1.10 × 9.15 × 2.38 = 23.9547 (el PDF dice 23.96)', FLOTA[7].m3, 23.95);

// ── LA SEGMENTACIÓN, COMO EN EL ÚLTIMO PDF ─────────────────────────────────
eq('seis volteos rígidos', FLOTA.filter((u) => u.segmento === 'volteo').length, 7);
eq('cuatro volquetas y chutos', FLOTA.filter((u) => u.segmento === 'volqueta').length, 4);

// ── LAS TARJETAS ────────────────────────────────────────────────────────────
const sinCarbo = FLOTA.filter((u) => !/sinotruk|howo/i.test(u.ident));
const t = rep.tarjetas(sinCarbo);
eq('la tarjeta mayor', t[0].valor, '24.53 m³');
eq('la tarjeta menor', t[1].valor, '12.38 m³');
// El nombre entre paréntesis: sin él, tres números sueltos obligan a bajar a la
// tabla a buscar cuál es cuál.
ok('la tarjeta mayor dice de qué unidad es', /TELESC/.test(t[0].titulo));
ok('y la menor también', /DOBLE/.test(t[1].titulo));
// Un nombre largo parte la tarjeta en tres líneas y desalinea el bloque.
ok('un nombre largo se recorta', rep.tarjetas([
  U('Volqueta Iveco Telescópica Eurotech Doble Tolva Reforzada MAX', 1.4, 7.3, 2.4),
])[0].titulo.length <= 60);
// Con toda la flota sin medir no puede reventar: tiene que decir que no sabe.
eq('sin ninguna unidad medida, rayas', rep.tarjetas([]).map((x) => x.valor), ['—', '—', '—']);

// ── EL DOCUMENTO ────────────────────────────────────────────────────────────
const html = rep.reporteVolumetricoHtml({
  fechaEmision: '09-09-2026',
  configuracion: 'Flota Segmentada por Tipo de Equipo (Sin Carbozulia)',
  unidades: sinCarbo,
  segmentado: true,
  excluidas: ['Carbozulia Sinotruk (HOWO)'],
  cargas: null,
});

ok('lleva el título del cliente', html.includes('Análisis Técnico y Capacidad Volumétrica de Flota'));
ok('las dos tablas segmentadas', html.includes('1. Tabla de Unidades de Volteo') && html.includes('2. Tabla de Unidades de Volqueta'));
// ⭐ Salía "1, 2, 5, 3, 4" porque las secciones se numeraban en el orden en que
//    se CALCULAN y no en el que se imprimen. El lector cree que faltan hojas.
const nums = (html.match(/<h2[^>]*>(\d+)\./g) ?? []).map((x) => Number(x.match(/(\d+)\./)[1]));
eq('las secciones van 1, 2, 3… en el orden en que SALEN', nums, nums.slice().sort((a, b) => a - b));
ok('sin repetir ningún número', new Set(nums).size === nums.length);

ok('las pastillas de color', html.includes('MEDIA CAPACIDAD') && html.includes('TORONTO') && html.includes('COMPACTO'));
ok('el análisis logístico', html.includes('Análisis Logístico'));
ok('las recomendaciones', html.includes('Recomendaciones Operativas'));
ok('la nota técnica del copamiento', html.includes('capacidad geométrica rasa'));
// Un reporte que excluye algo sin decirlo miente por omisión.
ok('nombra lo que dejó fuera', html.includes('Carbozulia Sinotruk (HOWO)') && html.includes('Nota operativa'));
ok('y aclara que esos viajes se siguen contando', html.includes('se siguen registrando y contando'));

const unaTabla = rep.reporteVolumetricoHtml({
  fechaEmision: '01-09-2026', configuracion: 'Flota completa', unidades: FLOTA,
  segmentado: false, excluidas: [], cargas: null,
});
ok('sin segmentar, una sola tabla comparativa', unaTabla.includes('Tabla Comparativa de Dimensiones y Volumen'));
ok('...y ahí sí sale el Sinotruk', unaTabla.includes('Carbozulia Sinotruk (HOWO)'));
ok('sin exclusiones no hay nota operativa', !unaTabla.includes('Nota operativa'));

// ── EL HISTÓRICO, QUE ES LO QUE LAS MUESTRAS NO TRAÍAN ─────────────────────
const HIST = [
  { machinery_id: 'a', machine_code: 'FIAT', jornada: '2026-09-08', m3: 83.58, viajes: 6 },
  { machinery_id: 'b', machine_code: 'TRAKKER', jornada: '2026-09-08', m3: 87.60, viajes: 4 },
  { machinery_id: 'a', machine_code: 'FIAT', jornada: '2026-09-07', m3: 55.72, viajes: 4 },
];
const conHist = rep.reporteVolumetricoHtml({
  fechaEmision: '09-09-2026', configuracion: 'x', unidades: sinCarbo, segmentado: true, excluidas: [],
  cargas: { eje: 'dia', grupos: cub.cargasPorDia(HIST), total: cub.totalCargas(HIST), rango: 'del 07/09/2026 al 08/09/2026' },
});
ok('el bloque de m³ cargados', conHist.includes('Metros Cúbicos Cargados'));
ok('las fechas se escriben día/mes/año', conHist.includes('08/09/2026'));
ok('el total del período', conHist.includes('226.90'));
// El corte por jornada hay que decirlo: si no, alguien compara estas cifras
// contra un conteo hecho por calendario y no le cuadran.
ok('dice que el día se cuenta por jornada de 7am a 7am', conHist.includes('jornada de 7am a 7am'));
ok('sin histórico, el bloque no aparece', !html.includes('Metros Cúbicos Cargados'));

const porMes = rep.reporteVolumetricoHtml({
  fechaEmision: '09-09-2026', configuracion: 'x', unidades: sinCarbo, segmentado: true, excluidas: [],
  cargas: { eje: 'mes', grupos: cub.cargasPorMes(HIST), total: cub.totalCargas(HIST), rango: 'septiembre' },
});
ok('por mes, el nombre del mes', porMes.includes('septiembre 2026'));
ok('y el título cambia', porMes.includes('Consolidado Mensual'));

// ── LO QUE TECLEA LA GENTE NO PUEDE ROMPER EL DOCUMENTO ────────────────────
// Los identificadores los escribe una persona. Un `<` suelto no rompe el PDF:
// lo reescribe.
const malicioso = rep.reporteVolumetricoHtml({
  fechaEmision: '09-09-2026',
  configuracion: '<script>alert(1)</script>',
  unidades: [U('<script>alert("x")</script>', 2, 5, 2)],
  segmentado: false, excluidas: ['<img onerror=1>'], cargas: null,
});
ok('no queda ni una etiqueta script viva', !/<script>/.test(malicioso));
ok('el texto se escapa y se sigue leyendo', malicioso.includes('&lt;script&gt;'));
eq('esc() escapa las cinco', rep.esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');

// ── SIN DATOS NO REVIENTA ───────────────────────────────────────────────────
const vacio = rep.reporteVolumetricoHtml({
  fechaEmision: '09-09-2026', configuracion: 'x', unidades: [], segmentado: true, excluidas: [], cargas: null,
});
ok('sin unidades sigue siendo un documento válido', vacio.includes('</html>'));
// Una tabla vacía con su encabezado se lee como «esta familia no cargó nada».
ok('...y no pinta tablas vacías', !vacio.includes('Tabla de Unidades de Volteo'));
eq('sin unidades no hay hallazgos', rep.hallazgos([]).length, 0);
eq('ni recomendaciones', rep.recomendaciones([]).length, 0);

// Los hallazgos NO son texto fijo: un párrafo escrito a mano que diga «entre
// 13,80 y 17,64 m³» queda mintiendo en cuanto se mida otra unidad.
const h = rep.hallazgos(sinCarbo);
eq('un hallazgo por familia', h.length, 2);
ok('el rango sale de los propios números', h[0].texto.includes('13.78') && h[0].texto.includes('17.64'));
ok('y nombra la unidad más grande de su familia', h[1].texto.includes('24.53'));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-reporte-volumetrico · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
