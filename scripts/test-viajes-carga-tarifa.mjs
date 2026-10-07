/*
 * ════════════════════════════════════════════════════════════════════════════
 * 🧾 LA TARIFA Y EL «SOLO POR VIAJE» EN LA CARGA MANUAL — 07-oct-2026.
 *
 * Pedido del cliente, textual:
 *   «Cuando registro un viaje a mano en el módulo de viajes de camiones, ya que
 *    hay camiones que solo cobran por viaje, necesito la opción de colocarle si
 *    es solo por viaje, además de que poder seleccionar las tarifas porque ya no
 *    lo veo o no está en la parte de registrar viajes a mano, y la idea es que
 *    pueda registrarle una tarifa ya sea las tarifas por nombre o tarifas
 *    generales»
 *
 * ── QUÉ FALTABA ────────────────────────────────────────────────────────────
 * El registro del PATIO tiene el 🧾 Tipo de viaje —la tarifa CON NOMBRE— desde
 * el 26-sep. La CARGA MANUAL nunca lo tuvo: un viaje cargado por la oficina no
 * podía llevar su tarifa con nombre y se pagaba con la de zona, sin que nadie
 * pudiera elegirlo. Y el modo «por viaje» solo se podía poner yendo al apartado
 * de pagos, aparte.
 *
 * ── LO QUE FIJA ────────────────────────────────────────────────────────────
 * ⭐ DOS CAMINOS, UNO SOLO DE DATOS. «Tarifa general» = los tres campos del tipo
 *    van en NULL y el viaje se paga con la tarifa que le toque por zona,
 *    empresa, grupo o camión. Con un tipo elegido, el viaje CONGELA esa tarifa,
 *    exactamente como la congela el registro del patio.
 *
 * ⭐ EL «SOLO POR VIAJE» NO ES DEL VIAJE, ES DEL CAMIÓN. Escribe en
 *    `machinery_modo_pago` y vale DESDE esa fecha para TODO lo que ese camión
 *    cobre. Por eso: nace apagado, solo se aplica si de verdad entró algún
 *    viaje, y si falla NO se pierde la carga — el viaje ya está, esto es el
 *    extra, y se dice en vez de esconderlo.
 *
 * ⚠️ SI NO SE TOCA NADA, LA CARGA ES LA DE SIEMPRE: tipo en null y sin tocar el
 *    modo de pago. Una opción nueva que le cambia el resultado al que no la usó
 *    es una regresión disfrazada de función.
 *
 *   node scripts/test-viajes-carga-tarifa.mjs
 * ════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
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

const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
const db = sinComentarios(leer('src/lib/pagoViajesDb.ts'));

// ── 1) LA TARIFA CON NOMBRE VIAJA EN LA CARGA MANUAL ────────────────────────
ok('⭐ la carga manual tiene su propio tipo elegido',
  /cargaTipoId, setCargaTipoId\] = useState<string \| null>\(null\)/.test(scr));
ok('⭐ nace en «tarifa general» (null), no en un tipo cualquiera',
  /setCargaTipoId\] = useState<string \| null>\(null\)/.test(scr));
ok('⭐ el tipo elegido sale de los tipos ACTIVOS',
  /const cargaTipo = cargaTipoId \? \(tiposActivos\.find\(\(t\) => t\.id === cargaTipoId\) \?\? null\) : null/.test(scr));
// ⚠️ Los TRES campos, no uno: el nombre y la tarifa son los que se congelan; el
//    id solo dice de cuál salió. Con uno suelto el viaje queda a medio congelar.
ok('⭐ el viaje cargado congela id, nombre Y tarifa',
  /tipoViajeId: cargaTipo\?\.id \?\? null,\s*tipoViajeNombre: cargaTipo\?\.nombre \?\? null,\s*tipoViajeTarifa: cargaTipo\?\.tarifaUsd \?\? null,/.test(scr));
// ⭐ «Tarifa general» = los tres en null. Es lo que hace que el viaje se pague
//    con la tarifa por zona/empresa/grupo/camión en vez de con una congelada.
ok('⭐ sin tipo elegido los tres quedan en null (= tarifa general)',
  /cargaTipo\?\.id \?\? null/.test(scr) && /cargaTipo\?\.tarifaUsd \?\? null/.test(scr));

// La pantalla: el selector y sus dos caminos.
ok('⭐ hay un selector «TARIFA DEL VIAJE»', /🧾 TARIFA DEL VIAJE/.test(scr));
ok('⭐ la primera opción es la tarifa general', /nombre: 'Tarifa general'/.test(scr));
ok('...y se ve como tal', /💲 Tarifa general/.test(scr));
ok('cada tipo muestra su precio', /\$\$\{t\.tarifaUsd\}/.test(scr));
ok('⚠️ avisa si el tipo elegido todavía no tiene tarifa',
  /tipo sin tarifa.*hasta que le pongan precio/s.test(scr));

// ── 2) «SOLO POR VIAJE» ─────────────────────────────────────────────────────
ok('⭐ hay una casilla «solo por viaje»',
  /cargaSoloPorViaje, setCargaSoloPorViaje\] = useState\(false\)/.test(scr));
ok('⚠️ nace APAGADA (cambia lo que cobra el camión, no solo esta tanda)',
  /setCargaSoloPorViaje\] = useState\(false\)/.test(scr));
ok('⭐ se ve en pantalla', /Este camión cobra SOLO POR VIAJE/.test(scr));
ok('⭐ escribe el modo de pago del camión desde la fecha de la carga',
  /asignarModoPago\(\[cargaTruck\.id\], 'viaje', cargaFecha/.test(scr));
// ⚠️ Solo si entró algún viaje: dejar el camión «por viaje» por una tanda que
//    no entró le cambia lo que cobra sin que se haya cargado nada.
ok('⚠️ solo se aplica si de verdad entró algún viaje',
  /if \(cargaSoloPorViaje && hechos > 0\)/.test(scr));
// ⚠️ Si falla NO se pierde la carga: el viaje ya está, esto es el extra.
ok('⚠️ si falla, se dice y NO se pierde la carga',
  /NO se pudo dejarlo «solo por viaje»/.test(scr));
ok('...y cuando sale bien, también se dice', /queda «solo por viaje» desde el/.test(scr));
ok('se desmarca sola al aplicarse (no se queda pegada para el próximo camión)',
  /if \(!r\.error\) setCargaSoloPorViaje\(false\)/.test(scr));

// ── 3) LO QUE NO PUEDE CAMBIAR ──────────────────────────────────────────────
// ⚠️ `asignarModoPago` AGREGA al historial, nunca lo pisa: así se sabe desde
//    cuándo cobra de cada forma, y un cambio de hoy no reescribe lo ya pagado.
ok('⚠️ el modo de pago agrega al historial, no lo pisa',
  /from\('machinery_modo_pago'\)\.insert\(filas\)/.test(db) && !/from\('machinery_modo_pago'\)\.upsert/.test(db));
ok('⚠️ y pide filas de vuelta: un rechazo por permisos no pasa callado',
  /machinery_modo_pago'\)\.insert\(filas\)\.select\('id'\)/.test(db));
// ⚠️ El registro del PATIO no se tocó: sigue con su propio tipoSel.
ok('⚠️ el registro del patio sigue con su propio tipo',
  /const tipoElegido = tipoSel \? \(tiposActivos\.find\(\(t\) => t\.id === tipoSel\) \?\? null\) : null/.test(scr));

console.log(`\n${pass} OK · ${fail} FALLO(S)`);
if (failures.length) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('La carga a mano ya puede llevar su tarifa —con nombre o la general— y dejar al camión cobrando por viaje.');
