/*
 * Test del 📊 INFORME OPERATIVO de transporte y carga (09-oct-2026).
 *
 * Pedido del cliente con un consolidado de otra empresa de muestra: flota,
 * viajes, toneladas y T/viaje por día, con gráfico y logos a elegir.
 *
 * Las tres reglas que NO se pueden aflojar:
 *  1. SIN DINERO: ni montos, ni tarifas, ni «no facturó». Es operación.
 *  2. ENTRAN TODOS LOS VIAJES, sin mirar el modo de pago del camión.
 *  3. NADA SE INVENTA: toneladas solo de viajes CON peso, el papel dice
 *     cuántos quedaron sin pesar, y T/Viaje se calcula sobre los pesados.
 *
 *   node scripts/test-informe-operativo.mjs
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

const L = loadTs(path.join(ROOT, 'src/lib/informeOperativo.ts'));
const PV = loadTs(path.join(ROOT, 'src/lib/pagoViajes.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── 1) LA JORNADA ES LA DE SIEMPRE (paridad con el pago) ───────────────────
for (const iso of ['2026-10-07T06:59:00-04:00', '2026-10-07T07:01:00-04:00', '2026-10-08T02:30:00-04:00', '2026-10-08T12:00:00-04:00']) {
  eq(`jornada igual que el pago · ${iso}`, L.jornadaOperativa(iso), PV.jornadaDeInstante(iso));
}
eq('las 6:59am son la jornada de AYER', L.jornadaOperativa('2026-10-07T06:59:00-04:00'), '2026-10-06');
eq('las 7:01am ya son la jornada de HOY', L.jornadaOperativa('2026-10-07T07:01:00-04:00'), '2026-10-07');

// ── 2) Día de la semana y números a la venezolana ──────────────────────────
eq('07-oct-2026 fue miércoles', L.diaSemanaDe('2026-10-07'), 'Miércoles');
eq('27-sep-2026 fue domingo', L.diaSemanaDe('2026-09-27'), 'Domingo');
eq('miles con punto y decimales con coma', L.nro(18008.86), '18.008,86');
eq('enteros sin decimales', L.nro(1014, 0), '1.014');
eq('un decimal', L.nro(92.18, 1), '92,2');

// ── 3) EL CÁLCULO DIARIO ────────────────────────────────────────────────────
const v = (id, cam, hora, kg, extra = {}) => ({
  id, machinery_id: cam, machine_code: `VOLTEO ${cam}`, company_id: extra.emp ?? 'E1',
  zona_pago: extra.zona ?? 'este', registered_at: hora, peso_neto_kg: kg,
  ubicacion_nombre: extra.obra ?? 'Obra A', placa_snap: extra.placa ?? `PL-${cam}`,
});
const VIAJES = [
  // 06-oct: 2 camiones, 3 viajes, uno SIN peso.
  v('a1', 'C1', '2026-10-06T08:00:00-04:00', 18000),
  v('a2', 'C1', '2026-10-06T10:00:00-04:00', 20000),
  v('a3', 'C2', '2026-10-06T11:00:00-04:00', null, { zona: 'oeste', obra: 'Obra B', emp: 'E2' }),
  // 07-oct: 3 camiones, 3 viajes (uno entró a las 2am del 08 = jornada del 07).
  v('b1', 'C1', '2026-10-07T09:00:00-04:00', 19500),
  v('b2', 'C2', '2026-10-07T12:00:00-04:00', 20500, { zona: 'oeste' }),
  v('b3', 'C3', '2026-10-08T02:00:00-04:00', 16000, { emp: 'E2' }),
  // Fuera del rango pedido: ni se asoma.
  v('z1', 'C9', '2026-10-09T09:00:00-04:00', 99000),
];
const R = L.resumenOperativo(VIAJES, '2026-10-06', '2026-10-07');

eq('dos jornadas con operación', R.dias.map((d) => d.jornada), ['2026-10-06', '2026-10-07']);
eq('flota del 06: C1 y C2 (dos, aunque C1 hizo dos viajes)', R.dias[0].flota, 2);
eq('viajes del 06', R.dias[0].viajes, 3);
eq('⭐ el viaje sin peso cuenta como viaje pero suma 0', [R.dias[0].sinPeso, R.dias[0].toneladas], [1, 38]);
eq('⭐ T/Viaje del 06 = 38 t ÷ 2 pesados (no ÷ 3)', R.dias[0].tPorViaje, 19);
eq('la madrugada del 08 (2am) cae en la jornada del 07', R.dias[1].viajes, 3);
eq('flota del 07: C1, C2 y C3', R.dias[1].flota, 3);
eq('toneladas del 07', R.dias[1].toneladas, 56);
eq('totales: 6 viajes · 94 t · 1 sin peso', [R.viajes, R.toneladas, R.sinPeso], [6, 94, 1]);
eq('flota máxima 3, pico el 07', [R.flotaMax, R.flotaMaxJornadas], [3, ['2026-10-07']]);
eq('flota del rango entero: 3 camiones distintos', R.flotaRango, 3);
eq('promedio de viajes por día', R.viajesPorDiaProm, 3);
eq('⭐ T/Viaje promedio = 94 ÷ 5 pesados', R.tPorViajeProm, 18.8);
eq('el del 09 quedó fuera del rango', R.viajes, 6);
eq('sin viajes: todo en cero y sin reventar', L.resumenOperativo([], '2026-10-01', '2026-10-02'), {
  dias: [], diasRango: 2, toneladas: 0, viajes: 0, conPeso: 0, sinPeso: 0, flotaRango: 0, flotaMax: 0,
  flotaMaxJornadas: [], tPorViajeProm: null, viajesPorDiaProm: 0,
});

// 📆 DÍAS TRANSCURRIDOS (09-oct-2026, a pedido: «le faltó los días transcurridos»).
eq('el rango de la muestra: 27-sep al 07-oct son 11 días', L.resumenOperativo([], '2026-09-27', '2026-10-07').diasRango, 11);
eq('un solo día cuenta 1', L.resumenOperativo([], '2026-10-06', '2026-10-06').diasRango, 1);
eq('cruza de mes sin perderse', L.resumenOperativo([], '2026-09-30', '2026-10-02').diasRango, 3);
eq('el resumen del fixture: 2 días transcurridos y 2 con operación', [R.diasRango, R.dias.length], [2, 2]);
{
  // Empate del pico en dos días → los dos salen.
  const RR = L.resumenOperativo([
    v('x1', 'C1', '2026-10-02T08:00:00-04:00', 1000), v('x2', 'C2', '2026-10-02T09:00:00-04:00', 1000),
    v('x3', 'C1', '2026-10-03T08:00:00-04:00', 1000), v('x4', 'C2', '2026-10-03T09:00:00-04:00', 1000),
  ], '2026-10-01', '2026-10-05');
  eq('pico empatado: salen los dos días', RR.flotaMaxJornadas, ['2026-10-02', '2026-10-03']);
  eq('…y el rótulo los junta por mes', L.textoPicoFlota(RR.flotaMaxJornadas), 'Pico: 02 y 03 de octubre');
}

// ── 4) FILTROS (vacío = todas; se cruzan) ───────────────────────────────────
eq('vacío = todos', L.filtrarViajesOperativo(VIAJES, L.FILTRO_OPERATIVO_TODO).length, 7);
eq('solo Oeste', L.filtrarViajesOperativo(VIAJES, { empresas: [], obras: [], zonas: ['Oeste'], camiones: [] }).map((x) => x.id), ['a3', 'b2']);
eq('zona Y empresa se cruzan', L.filtrarViajesOperativo(VIAJES, { empresas: ['E2'], obras: [], zonas: ['Oeste'], camiones: [] }).map((x) => x.id), ['a3']);
eq('por camión', L.filtrarViajesOperativo(VIAJES, { empresas: [], obras: [], zonas: [], camiones: ['C3'] }).map((x) => x.id), ['b3']);
eq('lo que ya no está deja de filtrar', L.acotarFiltroOperativo(
  { empresas: ['E1', 'FANTASMA'], obras: [], zonas: ['Este'], camiones: ['C9'] },
  { empresas: ['E1', 'E2'], obras: [], zonas: ['Este', 'Oeste'], camiones: ['C1'] },
), { empresas: ['E1'], obras: [], zonas: ['Este'], camiones: [] });
eq('catálogo de camiones con placa y conteo', L.camionesOperativo(VIAJES.slice(0, 3)).map((c) => [c.code, c.viajes]), [['VOLTEO C1', 2], ['VOLTEO C2', 1]]);

// ── 5) EL PAPEL ─────────────────────────────────────────────────────────────
const base = {
  resumen: R, viajes: VIAJES.slice(0, 6), desde: '2026-10-06', hasta: '2026-10-07',
  opciones: { ...L.OPCIONES_OPERATIVO_INICIAL }, filtro: L.FILTRO_OPERATIVO_TODO,
  nombresEmpresa: new Map([['E1', 'EMPRESA UNO'], ['E2', 'EMPRESA DOS']]),
};
const html = L.cuerpoInformeOperativo(base);

ok('⭐⭐ NI UN SIGNO DE DINERO en el papel', !/\$|USD|[Mm]onto|[Tt]arifa|factur/.test(html));
ok('los cuadros grandes salen', /Toneladas totales/.test(html) && /Flota activa máxima/.test(html) && /Eficiencia de carga/.test(html));
ok('⭐ el primer cuadro es Días transcurridos, con los días con operación al lado',
  /Días transcurridos/.test(html) && html.indexOf('Días transcurridos') < html.indexOf('Toneladas totales'));
ok('…y el alcance filtrado también los dice', /día\(s\) transcurridos, 2 con operación/.test(L.cuerpoInformeOperativo({ ...base, filtro: { empresas: [], obras: [], zonas: ['Este'], camiones: [] } })));
ok('la tabla diaria sale con sus columnas', /Tabla operativa diaria/.test(html) && /<th>Día<\/th>/.test(html) && /<th class="r">Flota<\/th>/.test(html) && /T\/Viaje/.test(html));
ok('la fila TOTAL / PROM. cierra la tabla', /TOTAL \/ PROM\./.test(html) && /\(máx\)/.test(html));
ok('⭐ el papel DICE los viajes sin peso', /no tienen peso de romana/.test(html) && /Nada se inventa/.test(html));
ok('el gráfico sale (barras + línea)', /<svg /.test(html) && /<polyline /.test(html) && /Barra: carga/.test(html));
ok('los cuadros extra nacen apagados', !/Totales por empresa/.test(html) && !/Totales por camión/.test(html));
ok('sin filtro, el alcance nace apagado', !/Alcance del informe/.test(html));

const htmlSin = L.cuerpoInformeOperativo({ ...base, opciones: { ...base.opciones, sinKpis: true, sinGrafico: true, sinFlota: true, sinDiaSemana: true, sinTPorViaje: true, sinSinPeso: true } });
ok('sinKpis quita los cuadros grandes', !/Toneladas totales/.test(htmlSin) && !/Días transcurridos/.test(htmlSin));
ok('sinGrafico quita el gráfico', !/<svg /.test(htmlSin));
ok('sinFlota quita SU columna (y las demás quedan)', !/<th class="r">Flota<\/th>/.test(htmlSin) && /<th class="r">Viajes<\/th>/.test(htmlSin));
ok('sinDiaSemana quita el Día', !/<th>Día<\/th>/.test(htmlSin));
ok('sinSinPeso quita la columna Y la nota', !/Sin peso/.test(htmlSin) && !/no tienen peso de romana/.test(htmlSin));

const htmlExtras = L.cuerpoInformeOperativo({ ...base, opciones: { ...base.opciones, sinPorEmpresa: false, sinPorCamion: false } });
ok('los cuadros extra se encienden', /Totales por empresa/.test(htmlExtras) && /Totales por camión/.test(htmlExtras) && /EMPRESA UNO/.test(htmlExtras) && /VOLTEO C1 · PL-C1/.test(htmlExtras));
const htmlAnon = L.cuerpoInformeOperativo({ ...base, opciones: { ...base.opciones, sinPorEmpresa: false, sinEmpresas: true } });
ok('«sin nombres»: Empresa 1, Empresa 2… y el nombre real no sale', /Empresa 1/.test(htmlAnon) && !/EMPRESA UNO/.test(htmlAnon));

const htmlFiltrado = L.cuerpoInformeOperativo({ ...base, filtro: { empresas: [], obras: [], zonas: ['Este'], camiones: [] } });
ok('⭐ FILTRADO: el alcance sale AUNQUE esté apagado, y lo canta', /FILTRADO: este papel NO es toda la operación/.test(htmlFiltrado) && /Solo zona\(s\): Este/.test(htmlFiltrado));

// El gráfico con demasiados días no sale (sería pulpa) y el papel lo dice.
{
  const muchos = Array.from({ length: 70 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + i, 16));
    return v(`m${i}`, 'C1', d.toISOString(), 10000);
  });
  const RM = L.resumenOperativo(muchos, '2026-01-01', '2026-03-30');
  eq('70 días: sin SVG', L.graficoOperativoSvg(RM.dias), '');
  ok('…y el papel explica por qué no hay gráfico', /no sale con más de 62 días/.test(L.cuerpoInformeOperativo({ ...base, resumen: RM })));
}
eq('sin días: sin SVG', L.graficoOperativoSvg([]), '');
ok('un día por barra', (L.graficoOperativoSvg(R.dias).match(/<rect /g) || []).length === R.dias.length);

// ── 6) OPCIONES, PASTILLAS Y NOMBRE DEL ARCHIVO ─────────────────────────────
eq('cada opción tiene su pastilla (ni una más, ni una menos)',
  L.PASTILLAS_OPERATIVO.map((p) => p.key).sort(),
  Object.keys(L.OPCIONES_OPERATIVO_INICIAL).sort());
eq('cómo nace el papel: igual a la muestra, extras apagados', L.OPCIONES_OPERATIVO_INICIAL, {
  sinKpis: false, sinGrafico: false, sinTabla: false,
  sinDiaSemana: false, sinFlota: false, sinSinPeso: false, sinToneladas: false, sinTPorViaje: false,
  sinPorEmpresa: true, sinPorCamion: true, sinEmpresas: false, sinAlcance: true,
});
eq('sin tocar nada, lo dice', L.ocultosOperativoEnPalabras(L.OPCIONES_OPERATIVO_INICIAL), 'Sale como el informe de muestra.');
ok('el nombre del archivo recoge rango y cambios', L.sufijoArchivoOperativo('2026-09-27', '2026-10-07', { ...L.OPCIONES_OPERATIVO_INICIAL, sinFlota: true }, true).includes('filtrado')
  && L.sufijoArchivoOperativo('2026-09-27', '2026-10-07', { ...L.OPCIONES_OPERATIVO_INICIAL, sinFlota: true }, true).includes('sin flota'));

// ── 7) CANDADOS SOBRE EL CÓDIGO ─────────────────────────────────────────────
const srcLib = fs.readFileSync(path.join(ROOT, 'src/lib/informeOperativo.ts'), 'utf8');
ok('⭐⭐ la librería es PURA (sin imports): se prueba sola', !/^\s*import\s/m.test(srcLib));
ok('⭐⭐ no mira modos de pago ni marcas de facturación', !/modoPago|facturable|viaje_pago_marcas|machinery_modo_pago/.test(srcLib));

const srcCard = fs.readFileSync(path.join(ROOT, 'src/components/InformeOperativoCard.tsx'), 'utf8');
ok('⚡ la tarjeta consulta SOLO al abrirse (regla del 06-oct)', /onAbrir=\{\(abierta\) => \{ if \(abierta\) setYaPedido\(true\); \}\}/.test(srcCard));
ok('⭐ la consulta corta por jornada 7am a 7am y solo el rango', /gte\('registered_at', `\$\{desde\}T07:00:00-04:00`\)/.test(srcCard) && /\.lt\('registered_at', `\$\{finExclusivo\}T07:00:00-04:00`\)/.test(srcCard));
ok('🏷️ nace sin logos y sin la marca en texto', /marcaTexto: false/.test(srcCard) && /bcv: false, sos: false, golden: false, renace: false, jhenzaen: false/.test(srcCard));
ok('los cinco logos se pueden encender', ['bcv', 'sos', 'golden', 'renace', 'jhenzaen'].every((k) => srcCard.includes(`{ k: '${k}',`)));
ok('⭐ un papel filtrado SIEMPRE lleva el alcance', /filtrado \? \{ \.\.\.opciones, sinAlcance: false \} : opciones/.test(srcCard));
// (el `.delete(` de los Set de filtros no cuenta: lo que se vigila es la base)
ok('no escribe NADA en la base (puro papel de lectura)',
  !/supabase\s*\.\s*from\(/.test(srcCard) && !/\.insert\(|\.upsert\(|\.rpc\(/.test(srcCard)
  && /import \{ selectAllRows \} from '\.\.\/lib\/supabase';/.test(srcCard));

const srcPantalla = fs.readFileSync(path.join(ROOT, 'src/screens/ViajesCamionesScreen.tsx'), 'utf8');
ok('la tarjeta está montada en Viajes de camiones, solo con nivel full', /<InformeOperativoCard canVer=\{canFull\} \/>/.test(srcPantalla));

console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) {
  console.log('\nFallos:');
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('El informe operativo cuenta la operación sin inventar y sin un centavo.\n');
