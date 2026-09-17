/*
 * Test del PAGO DE VIAJES DE CAMIONES (15-sep-2026).
 *
 * Pedido del cliente: desde el 15-sep-2026 los camiones se le pagan a su empresa por
 * viaje, con la tarifa de su zona. Precios editables como en jornada (general desde una
 * fecha, o blindado a un rango); cada camión con su modo, que se pone y se quita; y
 * cada viaje se paga salvo que lo marquen «no facturó».
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · vive SOLO en Viajes de camiones: jornadas y Control de Pagos no se tocan
 *   · un camión sin asignar no entra al pago por viaje (no cambia nada solo)
 *   · la tarifa blindada manda sobre la general en su rango, y no fuera de él
 *   · la jornada corta a las 7am de Caracas: un viaje a las 6:50am es del día anterior
 *   · la empresa que cobra es la GUARDADA en el viaje
 *   · un viaje sin zona, sin tarifa o sin empresa no suma, pero no desaparece
 *   · «no facturó» se puede poner y quitar: manda la última marca
 *
 * Sin framework (el repo no tiene): transpila el .ts en memoria con `typescript`.
 *
 *   node scripts/test-pago-viajes.mjs
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

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function cargar(rel) {
  const p = path.join(ROOT, rel);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  m._compile(js, p);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; failures.push(`✗ ${name}\n    obtenido: ${JSON.stringify(got)}\n    esperado: ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const L = cargar('src/lib/pagoViajes.ts');
ok('la librería no importa nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/pagoViajes.ts'))));
eq('arranca el 14-sep-2026 (pedido del 17-sep)', L.INICIO_PAGO_VIAJES, '2026-09-14');

// ── 1) JORNADA ──────────────────────────────────────────────────────────────
eq('8am Caracas es de ese día', L.jornadaDeInstante('2026-09-15T08:00:00-04:00'), '2026-09-15');
eq('6:59am Caracas es del día anterior', L.jornadaDeInstante('2026-09-16T06:59:00-04:00'), '2026-09-15');
eq('7:00am en punto ya es el día nuevo', L.jornadaDeInstante('2026-09-16T07:00:00-04:00'), '2026-09-16');
eq('11pm de noche sigue siendo ese día', L.jornadaDeInstante('2026-09-15T23:00:00-04:00'), '2026-09-15');
eq('en UTC también', L.jornadaDeInstante('2026-09-16T10:30:00Z'), '2026-09-15');
eq('sin fecha: vacío', L.jornadaDeInstante(null), '');

// ── 2) MODO DE PAGO ─────────────────────────────────────────────────────────
const modos = L.indexarModos([
  { machinery_id: 'A', modo: 'viaje', desde: '2026-09-15', created_at: '2026-09-15T12:00:00Z' },
  { machinery_id: 'A', modo: 'jornada', desde: '2026-09-20', created_at: '2026-09-15T13:00:00Z' },
  // chuto: lo pusieron y lo quitaron el MISMO día → manda la última
  // (llegan en orden INVERSO a propósito: el desempate tiene que ser por hora de guardado)
  { machinery_id: 'CH', modo: 'jornada', desde: '2026-09-15', created_at: '2026-09-15T14:00:00Z' },
  { machinery_id: 'CH', modo: 'viaje', desde: '2026-09-15', created_at: '2026-09-15T12:00:00Z' },
  { machinery_id: 'MAL', modo: 'hora', desde: '2026-09-15' },
]);
eq('sin fila: jornada', L.modoPagoEn(modos, 'Z', '2026-09-16'), 'jornada');
eq('antes de su fecha: jornada', L.modoPagoEn(modos, 'A', '2026-09-14'), 'jornada');
eq('desde su fecha: viaje', L.modoPagoEn(modos, 'A', '2026-09-15'), 'viaje');
eq('mientras dura: viaje', L.modoPagoEn(modos, 'A', '2026-09-19'), 'viaje');
eq('lo regresaron a jornada el 20', L.modoPagoEn(modos, 'A', '2026-09-20'), 'jornada');
eq('puesto y quitado el mismo día: manda el último', L.modoPagoEn(modos, 'CH', '2026-09-16'), 'jornada');
eq('un modo inventado no cuenta', L.modoPagoEn(modos, 'MAL', '2026-09-16'), 'jornada');
eq('sin máquina: jornada', L.modoPagoEn(modos, null, '2026-09-16'), 'jornada');

// ── 3) TARIFAS ──────────────────────────────────────────────────────────────
const tarifas = [
  { id: 'eGen', zona: 'este', precio: '21', desde: '2026-09-15', created_at: '2026-09-15T12:00:00Z' },
  { id: 'oGen', zona: 'oeste', precio: 43, desde: '2026-09-15', created_at: '2026-09-15T12:00:00Z' },
  { id: 'eOct', zona: 'este', precio: 26, desde: '2026-10-01', created_at: '2026-09-15T12:05:00Z' },
  // corrección hacia atrás guardada DESPUÉS de la de octubre: no debe pisar octubre
  { id: 'eCorr', zona: 'este', precio: 23, desde: '2026-09-20', created_at: '2026-09-16T09:00:00Z' },
  // blindadas
  { id: 'eB1', zona: 'este', precio: 19, desde: '2026-09-22', hasta: '2026-09-24', created_at: '2026-09-15T12:10:00Z' },
  { id: 'eB2', zona: 'este', precio: 20, desde: '2026-09-23', hasta: '2026-09-23', created_at: '2026-09-15T12:20:00Z' },
  { id: 'eX', zona: 'este', precio: 99, desde: '2026-09-15', created_at: '2026-09-17T00:00:00Z', anulada_at: '2026-09-17T00:01:00Z' },
  { id: 'e0', zona: 'este', precio: 0, desde: '2026-09-15', created_at: '2026-09-18T00:00:00Z' },
];
const t = (zona, fecha) => L.tarifaViajeEn(tarifas, zona, fecha)?.id ?? null;
eq('antes del inicio: sin tarifa', t('este', '2026-09-14'), null);
eq('Este el 15: la general', t('este', '2026-09-15'), 'eGen');
eq('Oeste el 15: la general', t('oeste', '2026-09-15'), 'oGen');
eq('Este el 21: la corrección desde el 20', t('este', '2026-09-21'), 'eCorr');
eq('blindada 22–24 manda sobre la general', t('este', '2026-09-22'), 'eB1');
eq('dos blindadas el 23: la última guardada', t('este', '2026-09-23'), 'eB2');
eq('el día después de la blindada vuelve la general', t('este', '2026-09-25'), 'eCorr');
eq('octubre: la de octubre aunque la del 20 se guardó después', t('este', '2026-10-02'), 'eOct');
eq('la anulada no cuenta', t('este', '2026-09-16'), 'eGen');
eq('zona inventada: sin tarifa', t('norte', '2026-09-16'), null);
eq('mayúsculas en la zona', t('OESTE', '2026-09-16'), 'oGen');

// ── 3b) TARIFAS ESPECIALES: empresa, grupo, camión; zona o ambas ────────────
const T2 = [
  { id: 'gE', zona: 'este', precio: 21, desde: '2026-09-15', created_at: '2026-09-15T12:00:00Z' },
  { id: 'emp', alcance: 'empresa', company_id: 'EMPA', zona: null, precio: 25, desde: '2026-09-15', created_at: '2026-09-15T12:01:00Z' },
  { id: 'grp', alcance: 'grupo', grupo_nombre: 'Chutos', machinery_ids: ['CH', 'CH2'], zona: 'este', precio: 32, desde: '2026-09-15', created_at: '2026-09-15T12:02:00Z' },
  { id: 'cam', alcance: 'camion', machinery_ids: ['CH'], zona: null, precio: 40, desde: '2026-09-20', created_at: '2026-09-15T12:03:00Z' },
  { id: 'gBl', zona: 'este', precio: 15, desde: '2026-09-22', hasta: '2026-09-22', created_at: '2026-09-15T12:04:00Z' },
  { id: 'empBl', alcance: 'empresa', company_id: 'EMPA', zona: 'este', precio: 18, desde: '2026-09-23', hasta: '2026-09-23', created_at: '2026-09-15T12:05:00Z' },
  { id: 'camVacio', alcance: 'camion', machinery_ids: [], zona: 'este', precio: 99, desde: '2026-09-15', created_at: '2026-09-15T13:00:00Z' },
  { id: 'rara', alcance: 'flota', zona: 'este', precio: 77, desde: '2026-09-15', created_at: '2026-09-15T13:01:00Z' },
  { id: 'empB', alcance: 'empresa', company_id: 'EMPB', zona: 'oeste', precio: 47, desde: '2026-09-15', created_at: '2026-09-15T13:02:00Z' },
  { id: 'camAn', alcance: 'camion', machinery_ids: ['A'], zona: 'este', precio: 88, desde: '2026-09-15', created_at: '2026-09-15T13:03:00Z', anulada_at: '2026-09-15T13:04:00Z' },
];
const t2 = (zona, fecha, ctx) => L.tarifaViajeEn(T2, zona, fecha, ctx)?.id ?? null;
const A_ = { companyId: 'EMPA', machineryId: 'A' };
const CH_ = { companyId: 'EMPA', machineryId: 'CH' };
const CH2_ = { companyId: 'EMPA', machineryId: 'CH2' };
eq('sin contexto: solo la de todos', t2('este', '2026-09-16'), 'gE');
eq('camión de otra empresa sin especial: la de todos', t2('este', '2026-09-16', { companyId: 'EMPC', machineryId: 'Z' }), 'gE');
eq('⭐ camión sin camiones y alcance inventado no aplican a nadie', t2('este', '2026-09-16', { companyId: 'EMPC', machineryId: 'Z' }), 'gE');
eq('empresa en ambas zonas: Este', t2('este', '2026-09-16', A_), 'emp');
eq('empresa en ambas zonas: Oeste', t2('oeste', '2026-09-16', A_), 'emp');
eq('la anulada del camión no cuenta', t2('este', '2026-09-16', A_), 'emp');
eq('⭐ grupo gana a empresa', t2('este', '2026-09-16', CH_), 'grp');
eq('grupo solo Este: en Oeste cae a la de la empresa', t2('oeste', '2026-09-16', CH_), 'emp');
eq('⭐ camión gana a grupo desde su fecha', t2('este', '2026-09-20', CH_), 'cam');
eq('antes de la fecha del camión, el grupo', t2('este', '2026-09-19', CH_), 'grp');
eq('otro camión del mismo grupo no toma la del camión', t2('este', '2026-09-20', CH2_), 'grp');
eq('⭐ la blindada de todos no pisa la de la empresa', t2('este', '2026-09-22', A_), 'emp');
eq('la blindada de todos sí aplica a quien no tiene especial', t2('este', '2026-09-22', { companyId: 'EMPC', machineryId: 'Z' }), 'gBl');
eq('blindada de empresa manda sobre la de la empresa en su día', t2('este', '2026-09-23', A_), 'empBl');
eq('el grupo sigue ganando a la blindada de empresa', t2('este', '2026-09-23', CH2_), 'grp');
eq('empresa Oeste: en Oeste la suya', t2('oeste', '2026-09-16', { companyId: 'EMPB', machineryId: 'B' }), 'empB');
eq('empresa Oeste: en Este la de todos', t2('este', '2026-09-16', { companyId: 'EMPB', machineryId: 'B' }), 'gE');
eq('viaje sin empresa guardada: no toma la de ninguna empresa', t2('oeste', '2026-09-16', { companyId: null, machineryId: 'B' }), null);
eq('una tarifa de alcance inventado, sola, no aplica a nadie',
  L.tarifaViajeEn(T2.filter((x) => x.id === 'rara'), 'este', '2026-09-16', { companyId: 'EMPA', machineryId: 'A' }), null);
{
  const gemela = { zona: 'este', precio: 5, desde: '2026-09-15', created_at: '2026-09-15T12:00:00Z' };
  eq('empate total: se queda la primera leída (no cambia de una carga a otra)',
    L.tarifaViajeEn([{ id: 'x1', ...gemela }, { id: 'x2', ...gemela }], 'este', '2026-09-16')?.id, 'x1');
}
eq('alcances', [L.alcanceTarifa({}), L.alcanceTarifa({ alcance: 'EMPRESA' }), L.alcanceTarifa({ alcance: 'flota' })], ['general', 'empresa', null]);
eq('zona de la tarifa', [L.etiquetaZonaTarifa({ zona: 'este' }), L.etiquetaZonaTarifa({ zona: 'oeste' }), L.etiquetaZonaTarifa({ zona: null })], ['Este', 'Oeste', 'Ambas zonas']);
eq('etiqueta corta', T2.slice(0, 4).map(L.etiquetaAlcanceCorta), ['', 'tarifa de la empresa', 'tarifa del grupo «Chutos»', 'tarifa del camión']);

const base = { zona: 'este', precio: '21', desde: '2026-09-15' };
eq('ambas zonas vale', L.validarTarifa({ ...base, zona: 'ambas' }), null);
ok('empresa sin elegir', L.validarTarifa({ ...base, alcance: 'empresa' }));
eq('empresa elegida', L.validarTarifa({ ...base, alcance: 'empresa', companyId: 'EMPA' }), null);
ok('un camión sin elegir', L.validarTarifa({ ...base, alcance: 'camion', camiones: [] }));
ok('dos camiones en «un camión»', L.validarTarifa({ ...base, alcance: 'camion', camiones: ['A', 'B'] }));
eq('un camión elegido', L.validarTarifa({ ...base, alcance: 'camion', camiones: ['A', 'A'] }), null);
ok('grupo sin camiones', L.validarTarifa({ ...base, alcance: 'grupo', camiones: [], grupoNombre: 'Chutos' }));
ok('grupo sin nombre', L.validarTarifa({ ...base, alcance: 'grupo', camiones: ['A'], grupoNombre: ' ' }));
eq('grupo completo', L.validarTarifa({ ...base, alcance: 'grupo', camiones: ['A', 'CH'], grupoNombre: 'Chutos' }), null);
ok('alcance inventado', L.validarTarifa({ ...base, alcance: 'flota' }));

eq('tarifa válida', L.validarTarifa({ zona: 'este', precio: '21', desde: '2026-09-15' }), null);
eq('tarifa con coma', L.validarTarifa({ zona: 'oeste', precio: '47,5', desde: '2026-09-15', hasta: '2026-09-20' }), null);
ok('sin zona', L.validarTarifa({ zona: '', precio: '21', desde: '2026-09-15' }));
ok('precio 0', L.validarTarifa({ zona: 'este', precio: '0', desde: '2026-09-15' }));
ok('sin fecha', L.validarTarifa({ zona: 'este', precio: '21', desde: '' }));
ok('rango al revés', L.validarTarifa({ zona: 'este', precio: '21', desde: '2026-09-20', hasta: '2026-09-10' }));

// ── 4) MARCAS ───────────────────────────────────────────────────────────────
const marcas = L.indexarMarcas([
  { viaje_id: 'v2', facturable: false, motivo: 'volteo vacío', created_at: '2026-09-15T15:00:00Z' },
  { viaje_id: 'v3', facturable: false, created_at: '2026-09-15T15:00:00Z' },
  { viaje_id: 'v3', facturable: true, created_at: '2026-09-15T16:00:00Z' },
]);
ok('sin marca: facturó', L.viajeFacturable(marcas, 'v1'));
ok('marcado no facturó', !L.viajeFacturable(marcas, 'v2'));
ok('le quitaron la marca: facturó', L.viajeFacturable(marcas, 'v3'));

// ── 5) EL CÁLCULO ───────────────────────────────────────────────────────────
const semanaDe = (j) => (j <= '2026-09-20' ? '2026-09-14' : '2026-09-21');
const V = (id, extra) => ({ id, machinery_id: 'A', machine_code: 'TORONTO 1', company_id: 'EMPA', zona_pago: 'este', registered_at: '2026-09-15T09:00:00-04:00', estado_maquina: 'operativa', ...extra });
const viajes = [
  V('v1'),
  V('v2'), // no facturó
  V('v3'), // le quitaron la marca
  V('v4', { zona_pago: 'oeste', registered_at: '2026-09-16T06:30:00-04:00', estado_maquina: 'averiada' }), // madrugada del 16 = jornada 15; averiado igual se paga
  V('v5', { zona_pago: null }), // sin zona
  V('v6', { registered_at: '2026-09-14T06:00:00-04:00' }), // jornada 13: antes del inicio (14-sep)
  V('v7', { machinery_id: 'Z', machine_code: 'TORONTO 9' }), // camión por jornada: no entra
  V('v8', { registered_at: '2026-09-21T10:00:00-04:00', company_id: 'EMPA' }), // A ya está por jornada el 21
  V('v9', { machinery_id: 'CH', machine_code: 'CHUTO 1' }), // chuto quitado: no entra
  V('v10', { machinery_id: null, machine_code: 'CAMION X', fuera_catalogo: true, company_id: null }), // fuera de catálogo
  V('v11', { machinery_id: 'B', machine_code: 'TORONTO 2', company_id: 'EMPB', registered_at: '2026-09-17T10:00:00-04:00' }),
];
const modos2 = L.indexarModos([
  { machinery_id: 'A', modo: 'viaje', desde: '2026-09-15', created_at: '1' },
  { machinery_id: 'A', modo: 'jornada', desde: '2026-09-21', created_at: '2' },
  { machinery_id: 'B', modo: 'viaje', desde: '2026-09-15', created_at: '1' },
  { machinery_id: 'CH', modo: 'viaje', desde: '2026-09-15', created_at: '1' },
  { machinery_id: 'CH', modo: 'jornada', desde: '2026-09-15', created_at: '2' },
]);
const grupos = L.calcularPagoViajes({ viajes, modos: modos2, tarifas, marcas, semanaDe });

const sav = grupos.get('EMPA|2026-09-14');
ok('hay grupo de EMPRESA A semana del 14', sav);
eq('EMPRESA A: viajes que entran', sav.lineas.map((l) => l.viaje.id), ['v1', 'v2', 'v3', 'v5', 'v4']);
eq('EMPRESA A: 21 + 21 + 43 = 85 (v2 no facturó, v5 sin zona)', sav.montoUSD, 85);
eq('EMPRESA A: 3 pagados, 1 no facturó, 1 pendiente', [sav.pagados, sav.noFacturados, sav.pendientes], [3, 1, 1]);
eq('el viaje de la madrugada es de la jornada 15', sav.lineas.find((l) => l.viaje.id === 'v4').jornada, '2026-09-15');
eq('⭐ el averiado se paga igual', sav.lineas.find((l) => l.viaje.id === 'v4').monto, 43);
eq('motivo del no facturado', sav.lineas.find((l) => l.viaje.id === 'v2').motivoSinPago, 'no_facturo');
eq('motivo del sin zona', sav.lineas.find((l) => l.viaje.id === 'v5').motivoSinPago, 'sin_zona');
eq('por camión: 3 pagados (2 Este, 1 Oeste), 1 no facturó, 1 pendiente, 85 $',
  sav.porCamion.map((c) => [c.code, c.viajes, c.pagados, c.este, c.oeste, c.noFacturados, c.pendientes, c.monto]),
  [['TORONTO 1', 5, 3, 2, 1, 1, 1, 85]]);
ok('antes del inicio (14) no entra', !Array.from(grupos.values()).some((g) => g.lineas.some((l) => l.viaje.id === 'v6')));
ok('⭐ camión por jornada no entra al pago por viaje', !Array.from(grupos.values()).some((g) => g.lineas.some((l) => l.viaje.id === 'v7')));
ok('⭐ regresado a jornada el 21: ese viaje no entra', !grupos.has('EMPA|2026-09-21'));
ok('chuto quitado no entra', !Array.from(grupos.values()).some((g) => g.lineas.some((l) => l.viaje.id === 'v9')));
const sinEmp = grupos.get('|2026-09-14');
eq('fuera de catálogo: aparece, pendiente, 0 $ y lo dice', [sinEmp?.viajes, sinEmp?.pendientes, sinEmp?.montoUSD, sinEmp?.lineas[0].motivoSinPago], [1, 1, 0, 'fuera_catalogo']);
eq('otra empresa, otro grupo', grupos.get('EMPB|2026-09-14')?.montoUSD, 21);

// Un camión puesto por viaje ANTES del 14: lo anterior al inicio igual no se paga por viaje
const previo = L.calcularPagoViajes({
  viajes: [V('p1', { registered_at: '2026-09-13T10:00:00-04:00' }), V('p2', { registered_at: '2026-09-15T10:00:00-04:00' })],
  modos: L.indexarModos([{ machinery_id: 'A', modo: 'viaje', desde: '2026-09-01', created_at: '1' }]),
  tarifas, marcas: L.indexarMarcas([]), semanaDe,
});
eq('⭐ antes del 14 no entra aunque el camión ya estuviera por viaje', Array.from(previo.values()).flatMap((g) => g.lineas.map((l) => l.viaje.id)), ['p2']);

// Una tarifa blindada cambia solo su rango
const conBlindada = L.calcularPagoViajes({
  viajes: [V('b1', { registered_at: '2026-09-22T10:00:00-04:00' }), V('b2', { registered_at: '2026-09-25T10:00:00-04:00' })],
  modos: L.indexarModos([{ machinery_id: 'A', modo: 'viaje', desde: '2026-09-15', created_at: '1' }]),
  tarifas, marcas: L.indexarMarcas([]), semanaDe,
});
eq('blindada el 22, general corregida el 25', conBlindada.get('EMPA|2026-09-21').lineas.map((l) => l.monto), [19, 23]);

// El cálculo usa la tarifa especial que le toca a cada viaje (camión y empresa GUARDADA)
const conEspeciales = L.calcularPagoViajes({
  viajes: [
    V('s1'),
    V('s2', { machinery_id: 'CH', machine_code: 'CHUTO 1' }),
    V('s3', { machinery_id: 'B', machine_code: 'TORONTO 2', company_id: 'EMPB', zona_pago: 'oeste' }),
    V('s4', { machinery_id: 'CH', machine_code: 'CHUTO 1', company_id: 'EMPB', zona_pago: 'oeste' }), // el chuto con viaje guardado a otra empresa
  ],
  modos: L.indexarModos(['A', 'CH', 'B'].map((m) => ({ machinery_id: m, modo: 'viaje', desde: '2026-09-15', created_at: '1' }))),
  tarifas: T2, marcas: L.indexarMarcas([]), semanaDe,
});
eq('⭐ empresa A: la de la empresa (25) y la del grupo del chuto (32)', conEspeciales.get('EMPA|2026-09-14').lineas.map((l) => [l.viaje.id, l.monto]), [['s1', 25], ['s2', 32]]);
eq('⭐ empresa B en Oeste: la suya (47), también para el chuto cuyo viaje guardó esa empresa', conEspeciales.get('EMPB|2026-09-14').lineas.map((l) => [l.viaje.id, l.monto]), [['s3', 47], ['s4', 47]]);

// Renglones para los informes: solo lo pagado, por camión, zona y precio
eq('renglones de EMPRESA A: 2 en Este, 1 en Oeste', L.itemsViajePagados(sav.lineas),
  [{ code: 'TORONTO 1', zona: 'este', precio: 21, viajes: 2 }, { code: 'TORONTO 1', zona: 'oeste', precio: 43, viajes: 1 }]);
eq('renglones sin líneas: vacío', L.itemsViajePagados(null), []);
eq('viajes del 15 al 16 por jornada (la madrugada del 16 es del 15)',
  L.viajesEnRango(viajes, '2026-09-15', '2026-09-15').map((v) => v.id).sort(),
  ['v1', 'v10', 'v11', 'v2', 'v3', 'v4', 'v5', 'v7', 'v9'].filter((id) => id !== 'v11').sort());
eq('rango vacío fuera de fechas', L.viajesEnRango(viajes, '2026-10-01', '2026-10-02'), []);

eq('etiquetas de motivo', ['no_facturo', 'sin_zona', 'sin_tarifa', 'sin_empresa', 'fuera_catalogo', null].map(L.etiquetaMotivoSinPago), ['No facturó', 'Sin zona', 'Sin tarifa', 'Sin empresa', 'Camión fuera del catálogo', '']);

// ── 6) LA BASE ──────────────────────────────────────────────────────────────
const db = sinComentarios(leer('src/lib/pagoViajesDb.ts'));
ok('las lecturas no se tragan errores', !/catch/.test(db));
ok('los viajes se leen desde las 7am del inicio', /gte\('registered_at', `\$\{desdeJornada\}T07:00:00-04:00`\)/.test(db));
eq('las 3 escrituras directas piden filas de vuelta', (db.match(/\.select\('id'\);/g) || []).length, 3);
eq('...y avisan si la base las rechazó', (db.match(/if \(!data\?\.length\)/g) || []).length, 3);
ok('⭐ la tarifa y sus camiones se crean juntos (una transacción)', /rpc\('crear_tarifa_viaje'/.test(db) && !/from\('viaje_tarifa_camiones'\)\.insert/.test(db));
ok('...y avisa si no volvió nada', /if \(!data\) return \{ error: SIN_PERMISO_PAGO \}/.test(db));
ok('las tarifas se leen con sus camiones', /camiones:viaje_tarifa_camiones\(machinery_id\)/.test(db));
ok('el modo nunca pisa: agrega filas', /from\('machinery_modo_pago'\)\.insert\(/.test(db) && !/from\('machinery_modo_pago'\)\.(update|delete|upsert)/.test(db));
ok('la tarifa se anula, no se borra', /anulada_at: new Date\(\)\.toISOString\(\)/.test(db) && !/from\('viaje_tarifas'\)\.delete/.test(db));

// ── 7) VIVE EN VIAJES DE CAMIONES, NO EN JORNADA ────────────────────────────
const vc = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
const res = sinComentarios(leer('src/components/PagoViajesResumen.tsx'));
ok('la tarjeta está en el panel de Viajes de camiones, con permiso completo', /<PagoViajesResumen canEdit=\{canFull\}/.test(vc));
ok('el resumen cuenta los viajes del rango por jornada', /viajesEnRango\(datos\.viajes, desde, hasta\)/.test(res));
ok('el resumen nombra la empresa guardada en el viaje', /datos\.empresas\.get\(g\.companyId\)/.test(res));
ok('abre tarifas y camiones', /<PagoViajesPanel/.test(res));
const panel = sinComentarios(leer('src/components/PagoViajesPanel.tsx'));
const tar = sinComentarios(leer('src/components/PagoViajesTarifas.tsx'));
ok('la ventana usa la pestaña de tarifas', /<PagoViajesTarifas[\s>]/.test(panel));
ok('la pestaña ofrece los cuatro alcances', ["key: 'general'", "key: 'empresa'", "key: 'grupo'", "key: 'camion'"].every((k) => tar.includes(k)));
ok('...zona Este, Oeste o ambas', /key: 'ambas'/.test(tar) && /zona === 'ambas' \? null : zona/.test(tar));
ok('...atajo para elegir solo los chutos', /esChuto/.test(tar) && /Solo chutos/.test(tar));
ok('...valida antes de guardar', /validarTarifa\(\{ zona, precio, desde, hasta: conHasta \? hasta : null, alcance, companyId, camiones: elegidos, grupoNombre \}\)/.test(tar));
ok('el detalle dice cuando el viaje usó una tarifa especial', /etiquetaAlcanceCorta\(l\.tarifa\)/.test(sinComentarios(leer('src/components/PagoViajesDetalle.tsx'))));
ok('muestra el detalle con «facturó»', /<PagoViajesDetalle grupo=\{g\}/.test(res));
ok('si la lectura falla, lo dice y no muestra montos', /catch \(e: any\) \{\s*setError\(/.test(res) && /if \(!datos \|\| error\) return/.test(res));
ok('saca PDF del rango', /exportPdf\(html/.test(res));
for (const [nombre, archivo] of [['Control de Pagos', 'src/screens/ControlPagosScreen.tsx'], ['Informe por jornada', 'src/screens/ReportsScreen.tsx'], ['Control de Maquinaria', 'src/screens/ControlMaquinariaScreen.tsx']]) {
  ok(`⭐ ${nombre} no se toca`, !/pagoViajes|PagoViajes/.test(leer(archivo)));
}

// ── 8) AUDITORÍA Y MANUAL ───────────────────────────────────────────────────
const aud = leer('src/lib/auditModulos.ts');
ok('las tres tablas nuevas salen en Auditoría como Viajes', /viaje_tarifas: 'viajes', machinery_modo_pago: 'viajes', viaje_pago_marcas: 'viajes'/.test(aud));
const md = leer('docs/MANUAL-USUARIO.md');
ok('el manual .md lo explica', /Pago de viajes de camiones \(15\/09\/2026\)/.test(md));
ok('...en Viajes de camiones, no en Control de Pagos', /panel de información → tarjeta \*\*"💰 Pago de viajes"\*\*/.test(md) && !/Control de Pagos → botón \*\*"🚛 Pago de viajes/.test(md));
ok('el manual en pantalla también', /💰 PAGO DE VIAJES DE CAMIONES \(15\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
ok('los dos manuales dicen que arranca el 14/09', /Arranca el 14\/09\/2026/.test(md) && /ARRANCA EL 14\/09\/2026/.test(leer('src/screens/ManualScreen.tsx')));
ok('la tarjeta toma la fecha de arranque de la regla, no escrita a mano', /arranca el \{dmy\(INICIO_PAGO_VIAJES\)\}/.test(leer('src/components/PagoViajesResumen.tsx')));
ok('los dos manuales explican las tarifas especiales', /Tarifas especiales/.test(md) && /TARIFAS ESPECIALES/.test(leer('src/screens/ManualScreen.tsx')));

// ── 9) REVISIÓN DEL 16-SEP-2026 ─────────────────────────────────────────────
// Lo que encontró la auditoría: los chutos no se podían administrar, los viajes de un
// camión fuera del pago desaparecían, y algunos desempates dependían del orden de lectura.

// 9a) Qué máquina puede entrar al pago (más ancha que la lista del listero).
const EQ = cargar('src/lib/equipos.ts');
eq('camiones del pago: volteos, volquetas, toronto Y chutos',
  ['CAMION VOLTEO 1', 'CHUTO CON VOLQUETA 3', 'TORONTO 5', 'CHUTO CON BATEA 2', 'CHUTO CON LOWBOY 1', 'CHUTO 7'].map(EQ.esCamionDeViajes),
  [true, true, true, true, true, true]);
eq('...pero no el resto de la maquinaria', ['EXCAVADORA 1', 'PAYLOADER 2', 'JUMBO 3'].map(EQ.esCamionDeViajes), [false, false, false]);
eq('⭐ la lista del listero NO cambia (sigue angosta)', ['CHUTO CON BATEA 2', 'CHUTO CON LOWBOY 1'].map(EQ.isVolteoVolqueta), [false, false]);

// 9b) Camiones con viajes que no entran al pago: ya no desaparecen.
const fueraPago = L.viajesFueraDelPago({ viajes, modos: modos2 });
eq('salen los que registraron viajes sin estar en el pago',
  fueraPago.map((c) => [c.code, c.viajes, c.sinConfigurar]),
  [['CHUTO 1', 1, false], ['TORONTO 1', 1, false], ['TORONTO 9', 1, true]]);
// De TORONTO 1 solo cuenta el viaje del 21, cuando ya lo habían regresado a jornada:
// sus 5 viajes de la semana del 14 sí están en el pago y no se repiten acá.
eq('⭐ del camión que está por viaje solo salen los viajes de cuando ya no lo estaba',
  fueraPago.find((c) => c.code === 'TORONTO 1')?.viajes, 1);
eq('el de fuera del catálogo tampoco: ese ya sale en el pago', fueraPago.filter((c) => c.code === 'CAMION X'), []);
eq('sin viajes: lista vacía', L.viajesFueraDelPago({ viajes: [], modos: modos2 }), []);

// 9c) La marca a mano manda sobre el resto de los motivos.
const sinEmpNoFact = L.calcularPagoViajes({
  viajes: [V('n1', { company_id: null })],
  modos: modos2,
  tarifas,
  marcas: L.indexarMarcas([{ id: 'm1', viaje_id: 'n1', facturable: false, created_at: '2026-09-15T15:00:00Z' }]),
  semanaDe,
});
const gNoFact = Array.from(sinEmpNoFact.values())[0];
eq('⭐ marcado «no facturó» y sin empresa: manda la marca',
  [gNoFact.lineas[0].motivoSinPago, gNoFact.noFacturados, gNoFact.pendientes], ['no_facturo', 1, 0]);

// 9d) Desempates que antes dependían del orden en que la base devolviera las filas.
const dosMarcas = [
  { id: 'm-a', viaje_id: 'x1', facturable: true, created_at: '2026-09-15T15:00:00Z' },
  { id: 'm-b', viaje_id: 'x1', facturable: false, created_at: '2026-09-15T15:00:00Z' },
];
eq('⭐ dos marcas a la misma hora: el mismo resultado en cualquier orden',
  [L.viajeFacturable(L.indexarMarcas(dosMarcas), 'x1'), L.viajeFacturable(L.indexarMarcas([...dosMarcas].reverse()), 'x1')],
  [false, false]);
const dosModos = [
  { id: 'f-a', machinery_id: 'D', modo: 'viaje', desde: '2026-09-15', created_at: '2026-09-15T12:00:00Z' },
  { id: 'f-b', machinery_id: 'D', modo: 'jornada', desde: '2026-09-15', created_at: '2026-09-15T12:00:00Z' },
];
eq('⭐ dos modos del mismo día y hora: el mismo resultado en cualquier orden',
  [L.modoPagoEn(L.indexarModos(dosModos), 'D', '2026-09-16'), L.modoPagoEn(L.indexarModos([...dosModos].reverse()), 'D', '2026-09-16')],
  ['jornada', 'jornada']);

// 9e) El desglose del PDF agrupa por máquina, no por código repetido.
const mismoCodigo = L.calcularPagoViajes({
  viajes: [V('c1', { machinery_id: 'A', machine_code: 'TORONTO 1' }), V('c2', { machinery_id: 'B', machine_code: 'TORONTO 1' })],
  modos: modos2, tarifas, marcas: L.indexarMarcas([]), semanaDe,
});
eq('⭐ dos camiones con el mismo código son dos renglones, no uno',
  L.itemsViajePagados(Array.from(mismoCodigo.values())[0].lineas).map((i) => [i.code, i.viajes]),
  [['TORONTO 1', 1], ['TORONTO 1', 1]]);

// 9f) Las pantallas.
ok('la pestaña Camiones usa la regla ancha (chutos incluidos)', /esCamionDeViajes\(m\.code\)/.test(panel) && !/isVolteoVolqueta/.test(panel));
ok('...y deja quitar del pago a una máquina dada de baja que ya tenía historial', /m\.activa \|\| \(idxModos\.get\(m\.id\)\?\.length \?\? 0\) > 0/.test(panel));
ok('el buscador de tarifas también ve los chutos', /m\.activa && \(esCamionDeViajes\(m\.code\)/.test(tar) && !/isVolteoVolqueta/.test(tar));
ok('la ayuda del alcance «un camión» explica lo de ambas zonas', /Ambas zonas.*sin tocar el de las zonas/.test(tar));
ok('el catálogo del pago trae también las inactivas, marcadas', /activa: m\.active !== false/.test(db) && !/q\.eq\('active', true\)/.test(db));
ok('el resumen muestra los camiones que no entran al pago', /viajesFueraDelPago\(\{ viajes: viajesEnRango/.test(res) && /no entran al pago/.test(res));
ok('...y el PDF también', /Camiones que no entran al pago/.test(res));
ok('el resumen desglosa por qué quedaron sin pagar', /etiquetaMotivoSinPago\(m\)\.toLowerCase\(\)/.test(res));
ok('un rango anterior al arranque lo dice claro', /rangoAntesDelInicio/.test(res));

ok('el manual .md explica la revisión', /Chutos y camiones que no entran al pago \(16\/09\/2026\)/.test(md));
ok('el manual en pantalla también', /CHUTOS Y CAMIONES QUE NO ENTRAN AL PAGO \(16\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-pago-viajes · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
