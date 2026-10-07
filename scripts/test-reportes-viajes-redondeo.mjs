/*
 * ════════════════════════════════════════════════════════════════════════════
 * 🔢 LOS PESOS Y LOS M³ DE LOS REPORTES DE VIAJES, REDONDEADOS — 07-oct-2026.
 *
 * Pedido del cliente, textual: «en los reportes de viajes redondea la cifra».
 * Preguntado cuál de las cifras, eligió dos: LOS PESOS (Kg / Ton) y LOS M³.
 * Y acto seguido, con la foto de otro sistema y una celda señalada: «que sea
 * un solo decimal», «ese 22,56 debería ser 22,6».
 *
 * ── POR QUÉ ────────────────────────────────────────────────────────────────
 * Una romana canta kilos enteros y un camión no se cubica al centímetro: el
 * «,00» de cada celda era relleno que solo ensanchaba la columna.
 *
 * ── CUÁNTOS DECIMALES, Y POR QUÉ NO SON LOS MISMOS ─────────────────────────
 * ⭐ KILOS: ENTEROS. La romana canta kilos enteros; un «,0» ahí es relleno.
 * ⭐ TONELADAS Y M³: UNO. Una tonelada son MIL kilos: se probó con cero el
 *    mismo día y el cliente lo devolvió en el acto, porque «38,30 → 38» borra
 *    300 kg de la vista en una columna con la que se cobra.
 *
 * ── LA REGLA QUE ORDENA TODO (y lo que esta suite cuida de verdad) ──────────
 * ⭐ REDONDEA LA CIFRA QUE SE LEE. Totales, promedios y columnas de los papeles
 *    de viajes: peso a pagar, bruto, tara, taras del catálogo, m³ cargados.
 *
 * ⚠️ NO REDONDEA LO QUE EL PAPEL MULTIPLICA. En el pago POR PESO la columna de
 *    toneladas va pegada a su Tarifa y a su Monto: con «33 Ton × $5,00» el
 *    lector espera $165 y lee $162,70. Un papel que no multiplica bien manda a
 *    recontar a mano, y eso es peor que un decimal de más.
 *
 * ⚠️ NO REDONDEA LO QUE SE MIDIÓ CON CINTA. En el reporte volumétrico la
 *    capacidad sale al lado de su alto × largo × ancho: un «14 m³» junto a
 *    «2.50 × 5.00 × 1.10» se lee como una cuenta mal hecha.
 *
 * ⚠️ NO TOCA EL TIQUETE. Se firma en el CDT; ahí 5 kg importan. Por eso el
 *    redondeo entró como PARÁMETRO de los formateadores y NO como cambio del
 *    valor por defecto. El día que alguien «simplifique» poniendo 0 de fábrica,
 *    esta suite y la de viajes-peso se caen juntas.
 *
 *   node scripts/test-reportes-viajes-redondeo.mjs
 * ════════════════════════════════════════════════════════════════════════════
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
function cargarAbs(abs) {
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  // ⚠️ Sin esto, un import relativo a otro .ts explota: el loader de Node no
  //    sabe de TypeScript. Con caché, porque las libs se importan en cadena.
  m.require = (id) => {
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return cargarAbs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}
const cargar = (rel) => cargarAbs(path.join(ROOT, rel));
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const P = cargar('src/lib/viajesPeso.ts');
const C = cargar('src/lib/cubicaje.ts');
const T = cargar('src/lib/reporteTaras.ts');

// ── 1) LOS FORMATEADORES: EL REDONDEO ES UN PARÁMETRO ───────────────────────
eq('⭐ los kilos del papel salen enteros', P.kgTexto(32540, 0), '32.540 Kg');
eq('⭐ las toneladas del papel salen con un decimal', P.tonTexto(32545, 1), '32,5 Ton');
eq('⭐ los m³ del papel salen con un decimal', C.m3Texto(18.55, 1), '18.6');
// ⭐ EL CASO QUE SEÑALÓ EL CLIENTE, con la celda encerrada en verde.
eq('⭐ «22,58» se escribe «22,6»', P.tonTexto(22580, 1), '22,6 Ton');
// ⚠️ El decimal en cero NO se cae: «28,0» dice que se midió y dio redondo.
eq('⚠️ el decimal se escribe aunque sea cero', [P.tonTexto(28000, 1), C.m3Texto(12, 1)], ['28,0 Ton', '12.0']);
// ⚠️ Redondea al más cercano; no corta. Cortar siempre favorece a una de las
//    dos partes, y el papel lo lee la contrata.
eq('⚠️ redondea al más cercano, no trunca',
  [P.kgTexto(11340.6, 0), P.kgTexto(11340.4, 0), P.tonTexto(22580, 1), P.tonTexto(22540, 1), C.m3Texto(7.66, 1), C.m3Texto(7.64, 1)],
  ['11.341 Kg', '11.340 Kg', '22,6 Ton', '22,5 Ton', '7.7', '7.6']);
// ⚠️ Con 0 decimales `toFixed` no deja parte decimal: sin guarda salía
//    «11.340,undefined Kg». Pasó de verdad al escribir esto.
  ok('⚠️ no queda ni coma huérfana ni «undefined» donde iban los decimales',
  !/undefined|,\s*(Kg|Ton)/.test([
    P.kgTexto(11340, 0), P.kgTexto(0, 0), P.kgTexto(NaN, 0),
    P.tonTexto(32540, 1), P.tonTexto(0, 1), P.tonTexto(NaN, 1), P.tonTexto(0, 0),
  ].join(' ')));
// ⚠️⚠️ EL DEFECTO NO CAMBIÓ. Es lo que protege al tiquete de este pedido.
eq('⚠️ sin pedirlo, los defectos siguen siendo los del tiquete (Kg 2 · Ton 3 · m³ 2)',
  [P.kgTexto(32540), P.tonTexto(32545), C.m3Texto(18.5)],
  ['32.540,00 Kg', '32,545 Ton', '18.50']);
eq('⚠️ y el tiquete, que no pide decimales, los sigue imprimiendo',
  P.pesosParaTique({ pesoBrutoKg: 32540, pesoTaraKg: 11340, pesoNetoKg: 21200 }),
  { pesoBruto: '32.540,00 Kg', pesoTara: '11.340,00 Kg', pesoNeto: '21.200,00 Kg' });

// ── 2) EL PAPEL DE TARAS, DE PUNTA A PUNTA ──────────────────────────────────
{
  const cam = (id, code, plate) => ({ id, code, plate, serial: null, marca: 'Mack', modelo: 'Granite', companyName: 'Transportes X' });
  const CAMIONES = [cam('a', 'Volteo 1', 'A10BB2C'), cam('b', 'Volteo 2', 'A05XX1Z')];
  const TARAS = new Map([
    ['a', { pesoTaraKg: 11340, updatedAt: '2026-10-06T14:00:00Z', updatedByNombre: 'María', exentoRomana: false }],
    ['b', { pesoTaraKg: 12000.6, updatedAt: '2026-10-06T14:00:00Z', updatedByNombre: 'María', exentoRomana: false }],
  ]);
  const kg = T.cuerpoReporteTaras(CAMIONES, TARAS, T.OPCIONES_TARAS_POR_DEFECTO);
  ok('⭐ el papel de taras no trae UN solo decimal de relleno', !/,\d\d\s*Kg/.test(kg));
  ok('…y las taras siguen ahí, redondeadas', kg.includes('11.340 Kg') && kg.includes('12.001 Kg'));
  const ton = T.cuerpoReporteTaras(CAMIONES, TARAS, { ...T.OPCIONES_TARAS_POR_DEFECTO, unidad: 't' });
  ok('⭐ en toneladas va con UN decimal, ni cero ni dos',
    ton.includes('11,3 Ton') && /,\d\s*Ton/.test(ton) && !/,\d\d\s*Ton/.test(ton));
  // ⚠️ El redondeo es del TEXTO: lo guardado sigue en kilos con su decimal.
  eq('⚠️ redondear el papel no toca el dato', T.resumenTaras(CAMIONES, TARAS).mayorKg, 12000.6);
}

// ── 3) EL PAPEL DE VIAJES: TODOS SUS M³ Y SUS PESOS ─────────────────────────
{
  const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
  ok('⭐ los pesos del papel: toneladas con uno, kilos enteros',
    /tonTextoOpcional\(n, 1\) : kgTextoOpcional\(n, 0\)/.test(scr)
    && /tonTexto\(n, 1\) : kgTexto\(n, 0\)/.test(scr));
  ok('⭐ y la tarjeta del resumen dice el MISMO peso que la tabla de abajo',
    /pesoUnidadRep === 't' \? tonTexto\(kg, 1\) : kgTexto\(kg, 0\)/.test(scr));

  // ⭐⭐ LA PRUEBA QUE IMPORTA: no hay UN m³ del papel que se quedara sin
  //     redondear. Se cuentan todas las llamadas y se exige que la única sin
  //     «, 0» sea la del TIQUETE. Una celda olvidada en «7.55» al lado de un
  //     total en «248» es exactamente lo que el cliente mandó a arreglar.
  const llamadas = scr.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => l.includes('m3Texto(') && !/^\s*(import|\s*valoresEnOrden)/.test(l));
  const sinRedondear = llamadas.filter(([, l]) => !l.includes(', 1)'));
  eq('⭐ ninguna llamada del papel se quedó sin redondear (solo la del tiquete)',
    sinRedondear.map(([n, l]) => (/m3: vol > 0/.test(l) ? 'tiquete' : `línea ${n}: ${l.trim().slice(0, 60)}`)),
    ['tiquete']);
  ok('…y son unas cuantas, no una (si esto baja, alguien borró columnas)', llamadas.length >= 10);
  // ⚠️ LA VISTA PREVIA ENSEÑA LO MISMO QUE EL PDF: si redondeara solo el papel,
  //    quien compara pantalla contra PDF concluye que uno de los dos miente.
  ok('⚠️ la vista previa redondea igual que el papel',
    /m3Texto\(sumaVolumen\(volumenPorCamion\), 1\)/.test(scr));
  // ⚠️ LAS MEDIDAS NO SE REDONDEAN: son una cinta métrica, no una cifra.
  ok('⚠️ el alto × largo × ancho conserva sus decimales', /dimsTexto\(md\)\} m/.test(scr) && !/dimsTexto\([^)]*, 0\)/.test(scr));
}

// ── 4) LA FRONTERA: DÓNDE NO SE REDONDEA ────────────────────────────────────
{
  const pagoViajes = sinComentarios(leer('src/lib/pagoViajesReporte.ts'));
  ok('⭐ el m³ del papel de pago por viaje va con un decimal (es informativo)',
    /maximumFractionDigits: 1 \}\)\} m³/.test(pagoViajes));
  // ⚠️ LA PLATA NO SE REDONDEA. El m³ de ese papel no multiplica a nadie; el
  //    monto y la tarifa SÍ son el resultado, y ahí el centavo es plata.
  ok('⚠️ pero el monto y la tarifa conservan sus dos decimales',
    /minimumFractionDigits: 2, maximumFractionDigits: 2/.test(pagoViajes));

  // ⚠️⚠️ EL PAGO POR PESO SE QUEDA CON SUS DECIMALES, A PROPÓSITO: su columna
  //      de toneladas va pegada a Tarifa y Monto y el papel tiene que
  //      multiplicar bien. Si algún día se redondea acá, hay que redondear la
  //      plata con ella — y eso es una decisión del cliente, no una de formato.
  const pagoPeso = sinComentarios(leer('src/lib/pagoPeso.ts'));
  ok('⚠️ el pago POR PESO conserva los decimales de su columna (el papel multiplica)',
    /fijo\(u === 'kg' \? r\.kg : r\.kg \/ 1000, 2\)/.test(pagoPeso));
  ok('⚠️ …y su texto de peso también', /fijo\(n \/ 1000, 2\)\} Ton/.test(pagoPeso));

  // ⚠️ El reporte TÁCTICO de maquinaria no es un reporte de viajes: su columna
  //    de m³ es la capacidad de la tolva, medida, y no se tocó.
  const reports = sinComentarios(leer('src/screens/ReportsScreen.tsx'));
  ok('⚠️ el reporte táctico sigue con la capacidad medida, sin redondear',
    /m3Texto\(volumenTolva\(med\.alto, med\.largo, med\.ancho\)\)/.test(reports));
}

// ── 5) EL VOLUMÉTRICO: CARGADO SÍ, CAPACIDAD NO ─────────────────────────────
{
  const vol = sinComentarios(leer('src/lib/reporteVolumetrico.ts'));
  ok('⭐ los m³ CARGADOS del histórico van con un decimal',
    /m3Texto\(g\.m3, 1\)/.test(vol) && /m3Texto\(c\.total\.m3, 1\)/.test(vol));
  ok('⭐ y el m³ por viaje del histórico también', /redondear\(g\.m3 \/ g\.viajes\) : 0, 1\)/.test(vol));
  // ⚠️ La CAPACIDAD de cada unidad, no: sale al lado de su propia medida.
  ok('⚠️ la capacidad de cada unidad conserva sus dos decimales', /m3Texto\(u\.m3\)\} m³/.test(vol));
  ok('⚠️ y las tarjetas de capacidad también', /k\.mayor\.toFixed\(2\)\} m³/.test(vol));
}

console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Los papeles de viajes dicen la cifra redondeada; el tiquete, la plata y las medidas, intactos.');
