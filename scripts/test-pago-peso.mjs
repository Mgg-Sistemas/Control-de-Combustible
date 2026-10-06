/*
 * Test del PAGO POR PESO de los viajes de camiones (`src/lib/pagoPeso.ts`) — 03-oct-2026.
 *
 * QUÉ PEDIDO CUBRE, textual
 *   «hay que gestionar el pago de los pesajes de la romana, los pesos de viajes de
 *   camiones (…) un histórico (…) ver por empresa, por máquina (…) resumen
 *   ejecutivo, todas las opciones (…) precio por tonelada, por kg, por máquina,
 *   por empresa» y «hagamos un reporte aparte del de viajes (…) de normal se
 *   paga por peso que cargue el camión».
 *
 * LO QUE BLINDA — y por qué cada cosa
 *   · ⭐ ES UN APARTADO APARTE: tabla propia, no toca las tarifas ni los modos del
 *     pago por viaje. TODO camión entra: no hay modo.
 *   · ⭐ SE PAGA EL NETO × EL PRECIO QUE REGÍA ESE DÍA, en $/kg aunque la tarifa
 *     se guarde por tonelada. Manda la tarifa más específica; la blindada manda
 *     sobre la abierta; las anuladas no cuentan.
 *   · ⭐ NADA SE INVENTA: sin peso = $0 «sin peso»; sin tarifa = $0 «sin tarifa».
 *   · ⭐ El «no facturó» del pago por viaje se respeta (es un hecho del viaje).
 *   · ⭐ El papel NO recalcula: filtra, agrupa y pinta las mismas líneas. Cambiar
 *     el eje no mueve un centavo. Lo oculto no deja rastro en el papel.
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

const srcPath = path.join(ROOT, 'src/lib/pagoPeso.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const P = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); } };
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── 1) PRECIO POR KILO Y NETO ────────────────────────────────────────────────
const tar = (id, precio, unidad, desde, extra = {}) => ({ id, precio, unidad, desde, created_at: `2026-09-01T00:00:0${id.length}Z`, ...extra });
eq('⭐ $12 por tonelada son $0,012 por kilo', P.precioPorKg(tar('a', 12, 'ton', '2026-09-01')), 0.012);
eq('$0,02 por kilo se queda igual', P.precioPorKg(tar('a', 0.02, 'kg', '2026-09-01')), 0.02);
eq('unidad rara = tonelada (lo normal)', P.unidadTarifaPeso({ unidad: 'x' }), 'ton');
eq('precio 0 o nada = 0', [P.precioPorKg(tar('a', 0, 'ton', '2026-09-01')), P.precioPorKg(null)], [0, 0]);
eq('el neto guardado manda', P.netoKgDeViaje({ peso_neto_kg: '12500', peso_bruto_kg: 1, peso_tara_kg: 1 }), 12500);
eq('sin neto guardado, bruto − tara', P.netoKgDeViaje({ peso_bruto_kg: 30000, peso_tara_kg: 12000 }), 18000);
eq('bruto ≤ tara, o faltante, o neto ≤ 0 = sin peso', [
  P.netoKgDeViaje({ peso_bruto_kg: 10, peso_tara_kg: 12 }), P.netoKgDeViaje({ peso_bruto_kg: 10 }), P.netoKgDeViaje({ peso_neto_kg: -5 }), P.netoKgDeViaje(null),
], [0, 0, 0, 0]);

// ── 2) QUÉ TARIFA RIGE ───────────────────────────────────────────────────────
const TARIFAS = [
  tar('g', 10, 'ton', '2026-09-14'),                                        // general, ambas zonas
  tar('gg', 12, 'ton', '2026-09-20'),                                       // general sube el 20
  tar('ggg', 20, 'ton', '2026-09-22', { hasta: '2026-09-23' }),             // blindada 22–23
  tar('e', 15, 'ton', '2026-09-14', { alcance: 'empresa', company_id: 'E1' }),
  tar('c', 0.03, 'kg', '2026-09-14', { alcance: 'camion', machinery_ids: ['M1'] }),
  tar('zz', 9, 'ton', '2026-09-14', { zona: 'oeste' }),                     // general solo oeste (guardada después)
  tar('an', 99, 'ton', '2026-09-14', { anulada_at: '2026-09-15T00:00:00Z' }),
];
const t = (zona, fecha, ctx) => P.tarifaPesoEn(TARIFAS, zona, fecha, ctx)?.id ?? null;
eq('antes de la primera tarifa no hay', t('este', '2026-09-13', {}), null);
eq('general rige desde su fecha', t('este', '2026-09-14', {}), 'g');
eq('⭐ el día anterior al cambio sigue la vieja; el cambio rige desde su fecha', [t('este', '2026-09-19', {}), t('este', '2026-09-20', {})], ['g', 'gg']);
eq('⭐ la BLINDADA manda dentro de su rango y luego vuelve la abierta', [t('este', '2026-09-22', {}), t('este', '2026-09-23', {}), t('este', '2026-09-24', {})], ['ggg', 'ggg', 'gg']);
eq('⭐ la de la EMPRESA manda sobre la general', t('este', '2026-09-22', { companyId: 'E1' }), 'e');
eq('⭐ la del CAMIÓN manda sobre la de la empresa', t('este', '2026-09-22', { companyId: 'E1', machineryId: 'M1' }), 'c');
eq('una tarifa de empresa no le toca a otra empresa', t('este', '2026-09-15', { companyId: 'E2' }), 'g');
eq('⭐ la ANULADA no cuenta', t('este', '2026-09-14', {}) !== 'an', true);
eq('la de zona oeste solo paga oeste; entre dos generales del mismo nivel y sin blindar, la de desde más reciente', [t('oeste', '2026-09-15', {}), t('este', '2026-09-15', {})], ['zz', 'g']);
eq('⭐ un viaje SIN zona sí tiene tarifa: la que no exige zona', t(null, '2026-09-15', {}), 'g');
eq('…pero la de una zona no le toca al viaje sin zona', P.tarifaPesoEn([tar('z', 9, 'ton', '2026-09-14', { zona: 'oeste' })], null, '2026-09-15', {}), null);
eq('nada no revienta', P.tarifaPesoEn(null, 'este', '2026-09-15', null), null);

// Validación.
eq('tarifa válida pasa', P.validarTarifaPeso({ unidad: 'ton', zona: 'ambas', precio: '12,5', desde: '2026-10-01', alcance: 'general' }), null);
ok('sin unidad no pasa', /tonelada o por kilo/.test(P.validarTarifaPeso({ unidad: '', zona: 'ambas', precio: 1, desde: '2026-10-01' })));
ok('precio 0 no pasa', /mayor que 0/.test(P.validarTarifaPeso({ unidad: 'kg', zona: 'ambas', precio: '0', desde: '2026-10-01' })));
ok('hasta antes de desde no pasa', /anterior/.test(P.validarTarifaPeso({ unidad: 'kg', zona: 'este', precio: 1, desde: '2026-10-05', hasta: '2026-10-01' })));
ok('empresa sin empresa no pasa', /Elige la empresa/.test(P.validarTarifaPeso({ unidad: 'kg', zona: 'ambas', precio: 1, desde: '2026-10-01', alcance: 'empresa' })));
ok('camión con dos camiones no pasa', /Elige el camión/.test(P.validarTarifaPeso({ unidad: 'kg', zona: 'ambas', precio: 1, desde: '2026-10-01', alcance: 'camion', camiones: ['a', 'b'] })));
ok('grupo sin nombre no pasa', /nombre al grupo/.test(P.validarTarifaPeso({ unidad: 'kg', zona: 'ambas', precio: 1, desde: '2026-10-01', alcance: 'grupo', camiones: ['a'], grupoNombre: 'x' })));
eq('texto del precio', [P.textoPrecioPeso(tar('a', 12, 'ton', '')), P.textoPrecioPeso(tar('a', 0.0125, 'kg', '')), P.textoPrecioPeso(null)], ['$12,00 / Ton', '$0,0125 / Kg', '—']);

// ── 3) EL CÁLCULO ────────────────────────────────────────────────────────────
const viaje = (id, maq, emp, zona, iso, neto, extra = {}) => ({
  id, machinery_id: maq, machine_code: `CAMION ${maq}`, company_id: emp, zona_pago: zona, registered_at: iso, peso_neto_kg: neto, folio: id, ...extra,
});
const VIAJES = [
  viaje('v1', 'M2', 'E2', 'este', '2026-09-15T12:00:00Z', 20000),            // general $10/t → $200
  viaje('v2', 'M2', 'E2', 'este', '2026-09-16T02:00:00Z', 10000),            // 15-sep 10pm Caracas → jornada 15 → $100
  viaje('v3', 'M3', 'E1', 'oeste', '2026-09-15T12:00:00Z', 30000),           // empresa $15/t → $450
  viaje('v4', 'M1', 'E1', 'este', '2026-09-15T12:00:00Z', 25000),            // camión $0,03/kg → $750
  viaje('v5', 'M2', 'E2', 'este', '2026-09-15T13:00:00Z', null),             // sin peso
  viaje('v6', 'M2', 'E2', 'este', '2026-09-15T14:00:00Z', 5000),             // no facturó
  viaje('v7', null, null, 'este', '2026-09-15T15:00:00Z', 5000, { fuera_catalogo: true, machine_code: 'FUERA' }),
  viaje('v8', 'M4', null, 'este', '2026-09-15T15:00:00Z', 5000),             // sin empresa
  viaje('v9', 'M2', 'E2', 'este', '2026-09-10T12:00:00Z', 5000),             // antes de toda tarifa → sin tarifa
  viaje('v10', 'M2', 'E2', null, '2026-09-15T16:00:00Z', 1000),              // sin zona: paga con la general → $10
];
const marcas = P.indexarMarcasPeso([{ viaje_id: 'v6', facturable: false, created_at: '2026-09-16T00:00:00Z' }, { viaje_id: 'v6', facturable: true, created_at: '2026-09-15T00:00:00Z' }]);
const lineas = P.calcularPagoPeso({ viajes: VIAJES, tarifas: TARIFAS, marcas });
const L = Object.fromEntries(lineas.map((l) => [l.viaje.id, l]));
eq('jornada 7am→7am: las 10pm del 15 son jornada del 15', [L.v2.jornada, L.v1.jornada], ['2026-09-15', '2026-09-15']);
eq('⭐ general: 20 t × $10 = $200', [L.v1.monto, L.v1.precioKg, L.v1.kg], [200, 0.01, 20000]);
eq('⭐ empresa: 30 t × $15 = $450', L.v3.monto, 450);
eq('⭐ camión por kilo: 25.000 kg × $0,03 = $750', L.v4.monto, 750);
eq('⭐ SIN PESO: $0 y motivo «sin peso» (no se inventa)', [L.v5.monto, L.v5.motivoSinPago, L.v5.kg], [0, 'sin_peso', 0]);
eq('⭐ NO FACTURÓ (última marca) manda', [L.v6.monto, L.v6.motivoSinPago, L.v6.facturable], [0, 'no_facturo', false]);
eq('fuera del catálogo se ve y no se paga', [L.v7.monto, L.v7.motivoSinPago], [0, 'fuera_catalogo']);
eq('sin empresa no se paga', [L.v8.monto, L.v8.motivoSinPago], [0, 'sin_empresa']);
eq('⭐ sin tarifa ese día = $0 «sin tarifa», no se cae a otra', [L.v9.monto, L.v9.motivoSinPago], [0, 'sin_tarifa']);
eq('⭐ sin zona se paga con la tarifa que no exige zona', [L.v10.monto, L.v10.motivoSinPago], [10, null]);
eq('las líneas salen por hora', lineas.map((l) => l.viaje.id), ['v9', 'v1', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v10', 'v2']);
const tot = P.totalPeso(lineas);
eq('⭐ el total: 5 pagados, 1 no facturó, 4 sin pagar, kg pagados y pesados', tot, { viajes: 10, pagados: 5, noFacturados: 1, pendientes: 4, kg: 86000, kgTotal: 106000, monto: 1510 });
eq('monto con centavos redondeado', P.calcularPagoPeso({ viajes: [viaje('x', 'M2', 'E2', 'este', '2026-09-15T12:00:00Z', 12345)], tarifas: TARIFAS })[0].monto, 123.45);
eq('nada no revienta', P.calcularPagoPeso({ viajes: null, tarifas: null }), []);
eq('viajesPesoEnRango corta por jornada', P.viajesPesoEnRango(VIAJES, '2026-09-15', '2026-09-15').length, 9);

// Resumen ejecutivo.
const tj = P.tarjetasResumenPeso(tot, 'ton');
eq('⭐ tarjetas del resumen ejecutivo (toneladas)', tj.map((x) => [x.k, x.valor]), [
  ['monto', '$1.510,00'], ['peso', '86,00 Ton'], ['promedio', '17,20 Ton'], ['precio', '$17,56'], ['viajes', '10'],
]);
eq('…y en kilos', P.tarjetasResumenPeso(tot, 'kg').map((x) => x.valor), ['$1.510,00', '86.000,00 Kg', '17.200,00 Kg', '$0,0176', '10']);
eq('la tarjeta de peso dice cuántos se pesaron de más', tj[1].nota, 'de 106,00 Ton pesadas');
eq('pesoTexto y usd sin depender del idioma', [P.pesoTexto(32540, 'kg'), P.pesoTexto(32540, 'ton'), P.usd(1234.5), P.usd(0.0125, 4)], ['32.540,00 Kg', '32,54 Ton', '$1.234,50', '$0,0125']);

// ── 4) FILTROS, BLOQUES Y RENGLONES ──────────────────────────────────────────
const nombres = new Map([['E1', 'Empresa Uno'], ['E2', 'Empresa Dos']]);
const suma = (bs) => Math.round(bs.reduce((a, b) => a + b.total.monto, 0) * 100) / 100;
for (const eje of ['empresa', 'obra', 'frente', 'maquina']) {
  const bs = P.bloquesPeso(lineas, eje, nombres);
  eq(`⭐ agrupar por ${eje} no mueve un centavo`, [suma(bs), bs.reduce((a, b) => a + b.lineas.length, 0)], [1510, 10]);
}
const porEmpresa = P.bloquesPeso(lineas, 'empresa', nombres);
eq('por empresa: con nombre, y «sin empresa» al final', porEmpresa.map((b) => b.nombre), ['Empresa Dos', 'Empresa Uno', 'Sin empresa (fuera del catálogo)']);
eq('sin nombres de empresas: numeradas en el mismo orden', P.bloquesPeso(lineas, 'empresa', nombres, { sinEmpresas: true }).map((b) => b.nombre), ['Empresa 1', 'Empresa 2', 'Empresa 3']);
eq('por camión: el código con su placa', P.bloquesPeso([{ ...L.v1, viaje: { ...L.v1.viaje, placa_snap: 'A1' } }], 'maquina', nombres)[0].nombre, 'CAMION M2 · A1');
const F = { ...P.FILTRO_PESO_TODO, empresas: ['E1'] };
eq('filtrar por empresa deja solo las suyas', P.filtrarLineasPeso(lineas, F).map((l) => l.viaje.id), ['v3', 'v4']);
eq('filtrar por camión', P.filtrarLineasPeso(lineas, { ...P.FILTRO_PESO_TODO, maquinas: ['M1'] }).map((l) => l.viaje.id), ['v4']);
eq('filtro vacío = todo', P.filtrarLineasPeso(lineas, P.FILTRO_PESO_TODO).length, 10);
eq('acotar quita lo que ya no existe', P.acotarFiltroPeso({ empresas: ['E1', 'ZZ'], obras: ['x'], maquinas: [], frentes: ['f'] }, { empresas: ['E1'], obras: [], maquinas: [], frentes: ['f'] }), { empresas: ['E1'], obras: [], maquinas: [], frentes: ['f'] });
eq('filtroPesoActivo', [P.filtroPesoActivo(P.FILTRO_PESO_TODO), P.filtroPesoActivo(F)], [false, true]);
eq('empresas disponibles con sus viajes', P.empresasDisponiblesPeso(lineas, nombres).map((e) => [e.name, e.viajes]), [['Empresa Dos', 6], ['Empresa Uno', 2], ['Sin empresa (fuera del catálogo)', 2]]);
eq('obras disponibles: «Sin obra» al final', P.obrasDisponiblesPeso([{ ...L.v1, viaje: { ...L.v1.viaje, ubicacion_nombre: 'CDT A' } }, L.v2]).map((o) => o.id), ['CDT A', 'Sin obra']);
eq('máquinas disponibles con placa de ficha', P.maquinasDisponiblesPeso([L.v4], new Map([['M1', { placa: 'PL-1' }]]), nombres)[0], { id: 'M1', code: 'CAMION M1', placa: 'PL-1', empresa: 'Empresa Uno', viajes: 1 });
const rs = P.renglonesPorCamionPeso(porEmpresa[0].lineas, new Map([['M2', { marca: 'MACK', modelo: 'GRANITE', placa: 'PL-2', encargado: 'Encargado' }]]), nombres);
eq('⭐ renglón por camión: pagados de N, kg pagados, tarifa, monto', rs.map((r) => [r.code, r.pagados, r.viajes, r.kg, r.monto, r.tarifa, r.noFacturados, r.pendientes]),
  [['CAMION M2', 3, 6, 31000, 310, '$10,00 / Ton', 1, 2]]);
eq('…con la ficha del catálogo', [rs[0].marca, rs[0].modelo, rs[0].placa, rs[0].encargado, rs[0].empresa], ['MACK', 'GRANITE', 'PL-2', 'Encargado', 'Empresa Dos']);
// 🏷️ MOSTRAR LOS DOS PRECIOS EN VEZ DE «VARIAS» (05-oct-2026, a pedido).
eq('⭐ dos tarifas distintas del mismo camión: los dos precios, de menor a mayor', P.renglonesPorCamionPeso([L.v1, { ...L.v1, viaje: { ...L.v1.viaje, id: 'z' }, tarifa: TARIFAS[1] }], null, nombres)[0].tarifa, '$10,00 / $12,00 / Ton');
eq('una sola tarifa sale como siempre', P.textoTarifasPeso([tar('a', 2, 'ton', '')]), '$2,00 / Ton');
eq('⭐ el caso real del cliente: Este $2 y Oeste $3 → «$2,00 / $3,00 / Ton»', P.textoTarifasPeso([tar('a', 3, 'ton', ''), tar('b', 2, 'ton', '')]), '$2,00 / $3,00 / Ton');
eq('dos iguales (mismo precio y unidad, p. ej. dos zonas a $2) cuentan una', P.textoTarifasPeso([tar('a', 2, 'ton', ''), tar('b', 2, 'ton', '')]), '$2,00 / Ton');
eq('⭐ unidades DISTINTAS no se funden: cada una completa', P.textoTarifasPeso([tar('a', 2, 'ton', ''), tar('b', 0.003, 'kg', '')]), '$2,00 / Ton · $0,0030 / Kg');
eq('sin tarifas o con precio 0 = raya', [P.textoTarifasPeso([]), P.textoTarifasPeso(null), P.textoTarifasPeso([tar('a', 0, 'ton', ''), null])], ['—', '—', '—']);
eq('conteo por zona', P.conteoPorZonaPeso(lineas).map((c) => [c.clave, c.viajes, c.pagados, c.monto]), [['Este', 8, 3, 1050], ['Oeste', 1, 1, 450], ['Sin zona', 1, 1, 10]]);
eq('conteo por día (histórico)', P.conteoPorDiaPeso(lineas).map((c) => [c.clave, c.viajes]), [['2026-09-10', 1], ['2026-09-15', 9]]);

// ── 5) EL PAPEL ──────────────────────────────────────────────────────────────
const datos = (op = {}, extra = {}) => ({
  lineas, eje: 'empresa', filtro: P.FILTRO_PESO_TODO, opciones: { ...P.OPCIONES_PESO_POR_DEFECTO, ...op }, unidad: 'ton', nombresEmpresa: nombres,
  fichas: new Map([['M2', { placa: 'PL-2', marca: 'MACK', modelo: 'GRANITE', encargado: 'Encargado X' }]]), ...extra,
});
const html = P.cuerpoPagoPeso(datos());
ok('⭐ el papel por defecto trae resumen ejecutivo, totales por empresa y camión por camión',
  html.includes('Total a pagar') && html.includes('TOTAL A PAGAR') && html.includes('$1.510,00') && html.includes('Empresa Dos') && html.includes('CAMION M2'));
ok('⭐ lo nuevo entra apagado: sin viaje por viaje, sin marca/modelo/encargado, sin cuadros por tipo/zona/día ni alcance', [
  !html.includes('Folio'), !html.includes('MACK'), !html.includes('Encargado X'), !html.includes('Cantidad por tipo'), !html.includes('Cantidad por zona'), !html.includes('Día por día'), !html.includes('Alcance del informe'),
].every(Boolean));
ok('la placa sale por defecto', html.includes('PL-2'));
ok('los que no entran al total se explican por bloque', /2 viaje\(s\) no entran al total: 1 sin (peso|tarifa) · 1 sin (tarifa|peso)/.test(html) && /1 viaje\(s\) marcados «no facturó»/.test(html));
// ⭐ «PAGADO» ES SOLO LA CONSTANCIA (06-oct-2026, a pedido: «¿cómo salen pagados
//    si nadie les ha colocado pagados? En ese módulo no se pagan, solo se lleva
//    el registro de cuánto hay que pagar»). El papel dice «a pagar», nunca
//    «pagados», para los viajes que apenas tienen tarifa.
ok('⭐ el papel dice «Con tarifa», NO «Viajes pagados»', html.includes('>Con tarifa<') && !html.includes('Viajes pagados') && !html.includes('Viajes a pagar'));
ok('⭐ la columna de los que no se cobran dice «Sin cobrar», no «Sin pagar»', html.includes('>Sin cobrar<') && !html.includes('>Sin pagar<') && !html.includes('>Pendientes<'));
const completo = P.cuerpoPagoPeso(datos(Object.fromEntries(P.PASTILLAS_PESO.map((p) => [p.key, false]))));
ok('⭐ con todo encendido: viaje por viaje con bruto/tara, cuadros, alcance', [
  completo.includes('Folio'), completo.includes('Bruto Ton'), completo.includes('MACK GRANITE'), completo.includes('Encargado X'), completo.includes('Cantidad por tipo de equipo'),
  completo.includes('Cantidad por zona'), completo.includes('Día por día'), completo.includes('Alcance del informe'), completo.includes('Sin peso'),
].every(Boolean));
ok('en kilos las columnas dicen Kg', P.cuerpoPagoPeso(datos({}, { unidad: 'kg' })).includes('>Kg<') && P.cuerpoPagoPeso(datos({}, { unidad: 'kg' })).includes('86.000,00 Kg'));
// ⭐ LO OCULTO NO DEJA RASTRO.
for (const p of P.PASTILLAS_PESO) {
  const h = P.cuerpoPagoPeso(datos({ [p.key]: true }));
  ok(`oculto «${p.largo}» no deja rastro`, !h.includes('No sale') && !h.includes('oculto') && !h.includes('(sin '));
}
ok('sin nombres de empresas: ni en bloques ni en columna', !P.cuerpoPagoPeso(datos({ sinEmpresas: true })).includes('Empresa Dos'));
ok('sin viaje por viaje pero con bruto/tara encendido no se cuela nada', !P.cuerpoPagoPeso(datos({ sinViajes: true, sinBrutoTara: false })).includes('Bruto'));
ok('sin camión por camión ni viaje por viaje: solo los totales', !P.cuerpoPagoPeso(datos({ sinListado: true, sinViajes: true })).includes('CAMION M2'));
ok('⭐ el papel FILTRADO lo dice en el alcance', P.alcancePesoEnPalabras(F, 'empresa', P.OPCIONES_PESO_POR_DEFECTO, nombres).some((s) => /FILTRADO/.test(s))
  && P.alcancePesoEnPalabras(F, 'empresa', P.OPCIONES_PESO_POR_DEFECTO, nombres).includes('Empresas: solo Empresa Uno.'));
ok('con los nombres ocultos, el alcance tampoco los suelta', P.alcancePesoEnPalabras(F, 'empresa', { ...P.OPCIONES_PESO_POR_DEFECTO, sinEmpresas: true }, nombres).includes('Empresas: solo 1 elegida(s).'));
ok('sin filtro no se avisa', !P.alcancePesoEnPalabras(P.FILTRO_PESO_TODO, 'maquina', P.OPCIONES_PESO_POR_DEFECTO, nombres).some((s) => /FILTRADO/.test(s)));
eq('sufijo del archivo: eje, filtros y lo que cambió de las pastillas', P.sufijoArchivoPeso({ ...F, maquinas: ['M1'] }, 'maquina', { ...P.OPCIONES_PESO_POR_DEFECTO, sinViajes: false, sinPlaca: true }), ' (por camion, 1 empresa(s), 1 camion(es), con viajes, sin placa)');
eq('sufijo vacío cuando no cambia nada', P.sufijoArchivoPeso(P.FILTRO_PESO_TODO, 'empresa', P.OPCIONES_PESO_POR_DEFECTO), '');
eq('ocultos en palabras (solo pantalla)', P.ocultosPesoEnPalabras({ ...P.OPCIONES_PESO_POR_DEFECTO, ...Object.fromEntries(P.PASTILLAS_PESO.map((p) => [p.key, false])), sinDias: true }), 'No sale: cuadro por día.');
eq('alternar', P.alternarPeso(P.OPCIONES_PESO_POR_DEFECTO, 'sinViajes').sinViajes, false);
ok('el papel vacío lo dice', P.cuerpoPagoPeso(datos({}, { lineas: [] })).includes('Sin viajes con ese filtro'));
ok('escapa HTML', P.cuerpoPagoPeso(datos({}, { nombresEmpresa: new Map([['E2', '<b>X</b>']]) })).includes('&lt;b&gt;X&lt;/b&gt;'));

// ── 6) CANDADOS ──────────────────────────────────────────────────────────────
{
  const lib = sinComentarios(leer('src/lib/pagoPeso.ts'));
  ok('⭐ la librería es PURA (sin imports)', !/^\s*import\s/m.test(lib));
  const db = sinComentarios(leer('src/lib/pagoPesoDb.ts'));
  ok('⭐ tabla PROPIA: no escribe en viaje_tarifas ni en machinery_modo_pago', /from\('viaje_tarifas_peso'\)/.test(db) && !/from\('viaje_tarifas'\)/.test(db) && !/machinery_modo_pago/.test(db));
  ok('⭐ el «no facturó» se LEE del pago por viaje y no se escribe', /selectAllRows\('viaje_pago_marcas'/.test(db) && !/from\('viaje_pago_marcas'\)/.test(db));
  ok('⭐ nada se borra: se anula', !/\.delete\(/.test(db) && /anularTarifaPeso/.test(db));
  ok('las escrituras piden select(id)', (db.match(/\.select\('id'\)/g) ?? []).length >= 2);
  ok('si falta el SQL, lo dice en vez de reventar', /faltaSql: true/.test(db));
  ok('el pago trae los pesos del viaje', /peso_bruto_kg, peso_tara_kg, peso_neto_kg/.test(db));
  for (const f of ['src/components/PagoPesoResumen.tsx', 'src/components/PagoPesoPanel.tsx']) {
    if (!fs.existsSync(path.join(ROOT, f))) { ok(`existe ${f}`, false); continue; }
    const c = sinComentarios(leer(f));
    ok(`${f}: sin la marca BCV/SOS en el pie (regla del módulo)`, !/marcaTexto: true/.test(c) && (f.includes('Panel') || /marcaTexto: false/.test(c)));
  }
  const pantalla = leer('src/screens/ViajesCamionesScreen.tsx');
  ok('⭐ el apartado está montado en Viajes de camiones, aparte del pago por viaje', /<PagoPesoResumen canEdit=\{canFull\}/.test(pantalla) && /<PagoViajesResumen canEdit=\{canFull\}/.test(pantalla));
}

console.log('\nPAGO POR PESO — el neto de la romana por el precio del día, aparte del pago por viaje\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-pago-peso · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
