/*
 * ════════════════════════════════════════════════════════════════════════════
 * ⚖️ TARIFA DE VIAJE POR TONELADA — 07-oct-2026.
 *
 * Pedido del cliente, textual: «acá ahora permite colocar una tarifa por TON,
 * este será 2$, este y oeste 3$, oeste 2$; permite ahora que sea así, y que se
 * multiplique por las ton obtenidas; esto se hará solo si seleccionan la
 * opción».
 *
 * ── LO QUE FIJA ────────────────────────────────────────────────────────────
 * ⭐ SOLO SI SELECCIONAN LA OPCIÓN. Un tipo nace 'viaje' y los 5.562 viajes ya
 *    registrados tienen la columna en NULL: TODOS se siguen pagando igual que
 *    ayer, al céntimo. Una opción nueva que le cambie el resultado a quien no
 *    la usó es una regresión disfrazada de función.
 *
 * ⭐ LA UNIDAD SE CONGELA EN EL VIAJE, como el nombre y el precio. Pasar un
 *    tipo a 'ton' mañana no puede reescribir lo ya cobrado.
 *
 * ⚠️ POR TONELADA SIN PESO NO SE PAGA, Y SE DICE. No cae a la tarifa por viaje
 *    ni a la de zona ni se paga en cero callado: sale «tarifa por tonelada sin
 *    peso». Adivinarle el peso a un viaje es inventar plata.
 *
 * ⚠️ EL REDONDEO ES DEL PAPEL, NO DE LA CUENTA: se multiplica con las
 *    toneladas exactas y se redondea AL FINAL, a céntimos.
 *
 *   node scripts/test-tarifa-por-tonelada.mjs
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
  m.require = (id) => {
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx']) if (fs.existsSync(c)) return cargarAbs(c);
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
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const U = cargar('src/lib/tarifaViajeUnidad.ts');
const P = cargar('src/lib/pagoViajes.ts');
const REP = cargar('src/lib/pagoViajesReporte.ts');

// ── 1) LEER LA UNIDAD ───────────────────────────────────────────────────────
eq('⭐ «ton» es por tonelada', U.unidadTarifa('ton'), 'ton');
eq('⭐ «viaje» es por viaje', U.unidadTarifa('viaje'), 'viaje');
// ⚠️⚠️ LO MÁS IMPORTANTE DE ESTE ARCHIVO. Los 5.562 viajes ya guardados tienen
//      la columna en NULL. Si un null se leyera como «por tonelada», medio año
//      de viajes pasaría a pagarse en cero de un día para otro.
eq('⚠️ null, vacío y basura son POR VIAJE, nunca por tonelada',
  [U.unidadTarifa(null), U.unidadTarifa(undefined), U.unidadTarifa(''), U.unidadTarifa('TONELADA'), U.unidadTarifa(0), U.unidadTarifa('x')],
  ['viaje', 'viaje', 'viaje', 'viaje', 'viaje', 'viaje']);
eq('mayúsculas y espacios no estorban', [U.unidadTarifa(' TON '), U.unidadTarifa('Ton')], ['ton', 'ton']);

// ── 2) LAS TONELADAS ────────────────────────────────────────────────────────
eq('kilos a toneladas', U.toneladasDe(22580), 22.58);
eq('⚠️ sin peso no hay toneladas (y no es cero: es «no se sabe»)',
  [U.toneladasDe(null), U.toneladasDe(undefined), U.toneladasDe(0), U.toneladasDe(-5), U.toneladasDe('x')],
  [null, null, null, null, null]);

// ── 3) LA CUENTA ────────────────────────────────────────────────────────────
// Las tres tarifas que pidió el cliente: Este $2, Este→Oeste $3, Oeste $2.
eq('⭐ Este · $2/Ton × 22,58 Ton', U.cuentaDelTipo(2, 'ton', 22580).monto, 45.16);
eq('⭐ Este → Oeste · $3/Ton × 22,58 Ton', U.cuentaDelTipo(3, 'ton', 22580).monto, 67.74);
eq('⭐ Oeste · $2/Ton × 38,30 Ton', U.cuentaDelTipo(2, 'ton', 38300).monto, 76.6);
eq('…y devuelve las toneladas que usó, para que el papel las pueda escribir',
  U.cuentaDelTipo(2, 'ton', 22580).toneladas, 22.58);
// ⚠️ Redondear las toneladas ANTES de multiplicar da otro número: 22,6 × $3
//    son $67,80 y lo correcto son $67,74. Seis céntimos por viaje, por mil
//    viajes al mes, los nota el que cobra.
eq('⚠️ multiplica con las toneladas EXACTAS y redondea al final',
  U.cuentaDelTipo(3, 'ton', 22580).monto, 67.74);
eq('⚠️ y el resultado llega hasta el céntimo, no más', U.cuentaDelTipo(2.345, 'ton', 7777).monto, 18.24);

eq('⭐ por viaje el peso ni se mira', [U.cuentaDelTipo(30, 'viaje', 22580).monto, U.cuentaDelTipo(30, 'viaje', null).monto], [30, 30]);
eq('…y no reporta toneladas, porque no las usó', U.cuentaDelTipo(30, 'viaje', 22580).toneladas, null);

// ⚠️ LAS DOS FORMAS DE NO PODER PAGAR, cada una con su nombre.
eq('⚠️ por tonelada SIN PESO: no se paga y se dice cuál es la falta',
  [U.cuentaDelTipo(2, 'ton', null).monto, U.cuentaDelTipo(2, 'ton', null).falta], [0, 'peso']);
eq('⚠️ sin tarifa: tampoco, y la falta es otra',
  [U.cuentaDelTipo(null, 'ton', 22580).falta, U.cuentaDelTipo(0, 'viaje').falta], ['tarifa', 'tarifa']);
eq('⚠️ sin tarifa Y sin peso manda la TARIFA (es lo que arregla la oficina en un minuto)',
  U.cuentaDelTipo(null, 'ton', null).falta, 'tarifa');
ok('⚠️ nunca devuelve NaN ni negativos',
  [U.cuentaDelTipo('x', 'ton', 'y'), U.cuentaDelTipo(-3, 'ton', 1000), U.cuentaDelTipo(2, 'ton', -5)]
    .every((c) => Number.isFinite(c.monto) && c.monto >= 0));

// ── 4) CÓMO SE ESCRIBE ──────────────────────────────────────────────────────
// ⭐ La unidad va PEGADA al precio: un «$2» suelto al lado de un «$30» se lee
//    como un tipo baratísimo, cuando es el precio de UNA de sus veinte toneladas.
eq('⭐ el precio dice su unidad', [U.tarifaTexto(2, 'ton'), U.tarifaTexto(30, 'viaje')], ['$2 / Ton', '$30']);
eq('sin precio lo dice en palabras', U.tarifaTexto(null, 'ton'), 'sin tarifa');
eq('el rótulo corto', [U.unidadTexto('ton'), U.unidadTexto('viaje')], ['por tonelada', 'por viaje']);

// ── 5) EL PAGO, DE PUNTA A PUNTA ────────────────────────────────────────────
{
  const JORNADA = '2026-10-06T14:00:00Z'; // dentro de la jornada 2026-10-06
  const base = {
    machinery_id: 'cam-1', machine_code: 'VOLTEO 1', company_id: 'emp-1',
    zona_pago: 'este', registered_at: JORNADA, placa_snap: 'A10BB2C',
  };
  const correr = (viajes) => P.calcularPagoViajes({
    viajes,
    tarifas: [{ id: 't1', zona: 'este', precio: 25, desde: '2026-09-14', hasta: null, alcance: 'general' }],
    modos: P.indexarModos([{ machinery_id: 'cam-1', modo: 'viaje', desde: '2026-09-14', created_at: '1' }]),
    marcas: P.indexarMarcas([]),
    semanaDe: () => '2026-W41',
  });
  const lineas = (g) => Array.from(g.values())[0]?.lineas ?? [];

  // ⭐ POR TONELADA: paga tarifa × toneladas, no la tarifa pelada.
  const porTon = lineas(correr([{ ...base, id: 'v1', tipo_viaje_nombre: 'Este · por tonelada', tipo_viaje_tarifa: 2, tipo_viaje_unidad: 'ton', peso_neto_kg: 22580 }]));
  eq('⭐ el viaje por tonelada paga tarifa × toneladas', porTon[0].monto, 45.16);
  eq('…y la línea lleva su unidad y sus toneladas, para el papel', [porTon[0].unidad, porTon[0].toneladas], ['ton', 22.58]);
  eq('…el «precio» de la línea sigue siendo el del catálogo (el de UNA tonelada)', porTon[0].precio, 2);
  eq('…y se paga, no queda pendiente', porTon[0].motivoSinPago, null);

  // ⚠️ POR TONELADA SIN PESO: ni la tarifa por viaje ni la de zona. Visible.
  const sinPeso = lineas(correr([{ ...base, id: 'v2', tipo_viaje_nombre: 'Este · por tonelada', tipo_viaje_tarifa: 2, tipo_viaje_unidad: 'ton', peso_neto_kg: null }]));
  eq('⚠️ por tonelada sin peso NO se paga', sinPeso[0].monto, 0);
  eq('⚠️ y se dice por qué', sinPeso[0].motivoSinPago, 'tipo_sin_peso');
  eq('⚠️ el motivo tiene nombre en cristiano', P.etiquetaMotivoSinPago('tipo_sin_peso'), 'Tarifa por tonelada sin peso cargado');
  // ⚠️⚠️ Lo que NO puede pasar: cobrarle $2 el viaje entero, ni $25 de la zona.
  ok('⚠️ no cae a la tarifa por viaje ni a la de zona', sinPeso[0].monto !== 2 && sinPeso[0].monto !== 25);

  // ⭐ TODO LO DE SIEMPRE, IGUAL QUE AYER.
  const normal = lineas(correr([{ ...base, id: 'v3' }]));
  eq('⭐ un viaje sin tipo sigue pagando la tarifa de su zona', [normal[0].monto, normal[0].unidad, normal[0].toneladas], [25, 'viaje', null]);
  const tipoViejo = lineas(correr([{ ...base, id: 'v4', tipo_viaje_nombre: 'este', tipo_viaje_tarifa: 30, peso_neto_kg: 22580 }]));
  eq('⚠️ un tipo SIN unidad (los 5.562 viajes de antes) paga por viaje, no por tonelada',
    [tipoViejo[0].monto, tipoViejo[0].unidad], [30, 'viaje']);
  const sinTarifa = lineas(correr([{ ...base, id: 'v5', tipo_viaje_nombre: 'Este · por tonelada', tipo_viaje_tarifa: null, tipo_viaje_unidad: 'ton', peso_neto_kg: 22580 }]));
  eq('un tipo por tonelada sin precio sigue saliendo «tipo sin tarifa»', sinTarifa[0].motivoSinPago, 'tipo_sin_tarifa');
}

// ── 6) EL PAPEL MULTIPLICA SOLO ─────────────────────────────────────────────
// ⭐ Con una tarifa por tonelada, un «$2» pelado al lado de un monto de $45,16
//    se lee como un error de suma. La celda escribe la cuenta entera.
eq('⭐ la celda de tarifa escribe la cuenta completa',
  REP.precioTexto({ precio: 2, unidad: 'ton', toneladas: 22.58 }), '$2,00 / Ton × 22,6 Ton');
eq('⭐ por viaje la celda queda EXACTAMENTE como siempre',
  REP.precioTexto({ precio: 30, unidad: 'viaje', toneladas: 0 }), '$30,00');
eq('sin toneladas no se inventa el «× »', REP.precioTexto({ precio: 2, unidad: 'ton', toneladas: 0 }), '$2,00 / Ton');

// ── 7) LA UNIDAD VIAJA Y SE CONGELA ─────────────────────────────────────────
{
  const cv = sinComentarios(leer('src/lib/camionViajes.ts'));
  ok('⭐ el catálogo de tipos lee su unidad', /tarifa_usd, tarifa_unidad, activo/.test(cv) && /unidad: unidadTarifa\(r\.tarifa_unidad\)/.test(cv));
  ok('⭐ el viaje CONGELA la unidad al registrarse', /tipo_viaje_unidad: params\.tipoViajeId \|\| params\.tipoViajeNombre \? unidadTarifa\(params\.tipoViajeUnidad\) : null/.test(cv));
  ok('⭐ y la relee de la fila', /tipoViajeUnidad: unidadTarifa\(r\.tipo_viaje_unidad\)/.test(cv));
  ok('⭐ la columna viaja en el SELECT', /tipo_viaje_tarifa, tipo_viaje_unidad/.test(cv));
  // ⚠️ Corregirle el tipo a un viaje tiene que re-congelar TAMBIÉN la unidad.
  ok('⚠️ corregir el tipo re-congela la unidad', /patch\.tipo_viaje_unidad = cambios\.tipoViaje\.nombre \? unidadTarifa\(cambios\.tipoViaje\.unidad\) : null/.test(cv));
  // ⚠️ Sin las dos columnas en el SELECT del pago, el papel pagaría por viaje
  //    lo que es por tonelada — y en silencio, porque null se lee 'viaje'.
  const db = sinComentarios(leer('src/lib/pagoViajesDb.ts'));
  ok('⚠️ el pago pide la unidad Y el peso', /tipo_viaje_unidad, peso_neto_kg/.test(db));
}

// ── 8) LA PANTALLA ──────────────────────────────────────────────────────────
{
  const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
  ok('⭐ el registro del patio congela la unidad del tipo', /tipoViajeUnidad: tipoElegido\?\.unidad \?\? null/.test(scr));
  ok('⭐ la carga a mano también', /tipoViajeUnidad: cargaTipo\?\.unidad \?\? null/.test(scr));
  // ⚠️ La cola sin conexión guarda el payload entero: si perdiera la unidad, un
  //    viaje registrado sin señal se pagaría por viaje al subir.
  ok('⚠️ la cola sin conexión no pierde la unidad', (scr.match(/tipoViajeUnidad: unidadTarifa\(q\.payload\.tipoViajeUnidad\)/g) || []).length === 2);
  ok('⭐ la pastilla del tipo muestra el precio CON su unidad', /tarifaTexto\(t\.tarifaUsd, t\.unidad\)/.test(scr));
  // ⚠️ Se le avisa al listero ANTES de registrar: todavía está frente a la
  //    romana. Descubrirlo en el papel de pago es tarde.
  ok('⚠️ avisa en el patio que esa tarifa es por tonelada', /Esta tarifa es POR TONELADA/.test(scr));
  ok('⚠️ …y que sin peso no se puede pagar', /SIN PESO CARGADO NO SE PUEDE PAGAR/.test(scr));
  ok('⭐ se puede crear un tipo por tonelada', /crearTipoViaje\(nuevoTipoNombre, tarifa, uid \|\| null, listeroName \|\| null, nuevoTipoUnidad\)/.test(scr));
  ok('⚠️ el tipo nuevo nace POR VIAJE (nadie estrena cobro sin pedirlo)', /useState<UnidadTarifaViaje>\('viaje'\)/.test(scr));
  ok('⭐ y se le puede cambiar la unidad a uno existente', /editarTipoViaje\(t\.id, \{ unidad: aTon \? 'ton' : 'viaje' \}/.test(scr));
  ok('⚠️ cambiarla PREGUNTA antes (multiplica o divide lo que cobra ese tipo)', /cambiarUnidadTipo = async[\s\S]{0,900}await confirm\(/.test(scr));
}

console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('La tarifa por tonelada multiplica por el peso, se congela en el viaje, y sin peso se dice en vez de pagarse mal.');
