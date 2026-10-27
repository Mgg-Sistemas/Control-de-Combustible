// 🏭 Pruebas del CENTRO DE OPERACIONES (23-oct-2026).
//
// Este archivo crece por BLOQUES NUMERADOS, uno por tarea del plan:
//   · Bloques 1-10  → la librería pura de cálculo (src/lib/centroOperaciones.ts).
//   · Las tareas siguientes agregan sus bloques ANTES del «Cierre» del final.
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

const SRC_LIB = path.join(ROOT, 'src/lib/centroOperaciones.ts');
const L = loadTs(SRC_LIB);

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
/** ¿Hay algún NaN / Infinity escondido en cualquier parte del valor? (JSON.stringify los disfraza de null). */
const hayNaN = (v) => {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (Array.isArray(v)) return v.some(hayNaN);
  if (v && typeof v === 'object') return Object.values(v).some(hayNaN);
  return false;
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

// Entradas: tres escrituras del mismo nombre → dos transportistas.
const ENTRADAS = [
  mov({ transportista: 'Transportista A', origen: 'Frente 1', viajes: 3, toneladas: 70.5, fecha: '2026-10-06' }),
  mov({ transportista: 'Transportista B', origen: 'Frente 1', viajes: 3, toneladas: 66, fecha: '2026-10-06' }),
  mov({ transportista: 'Transportista A', origen: 'Frente 2', viajes: 2, toneladas: 45, fecha: '2026-10-07' }),
  mov({ transportista: ' transportista a ', origen: 'FRENTE 2 ', viajes: 1, toneladas: 23, fecha: '2026-10-08' }),
];
// Internos de otra unidad: dos renglones, mismo recorrido y misma capacidad.
const INTERNOS = [
  mov({ tipo: 'interno', unidadId: 'u2', unidadTexto: 'Camión 2', origen: 'Terraza 1', destino: 'Terraza 2', capacidadM3: 18, viajes: 4, fecha: '2026-10-06' }),
  mov({ tipo: 'interno', unidadId: 'u2', unidadTexto: 'Camión 2', origen: 'Terraza 1', destino: 'Terraza 2', capacidadM3: 18, viajes: 2, fecha: '2026-10-07' }),
];
// Salidas del sitio.
const SALIDAS = [
  mov({ tipo: 'salida', material: 'Triturado', destino: 'Destino X', capacidadM3: 18, viajes: 2, fecha: '2026-10-07' }),
  mov({ tipo: 'salida', material: 'Triturado', destino: 'Destino X', capacidadM3: 24, viajes: 3, fecha: '2026-10-08' }),
  mov({ tipo: 'salida', material: 'Acero', destino: 'Destino Y', capacidadM3: 24, viajes: 1, estado: 'esperando_pesaje', fecha: '2026-10-08' }),
];
// La unidad «U-1»: internos 06→08 (5, 0, 3), una salida el 07 (2), un por_confirmar
// SIN número el 08 y otro CON 4 viajes el 09 (los dos son salidas a «Destino Z»).
const U1 = { unidadId: 'u1', unidadTexto: 'U-1', placa: 'TST-001' };
const U1_MOVS = [
  mov({ ...U1, tipo: 'interno', origen: 'Terraza 3', destino: 'Terraza 4', capacidadM3: 24, viajes: 5, fecha: '2026-10-06' }),
  mov({ ...U1, tipo: 'interno', origen: 'Terraza 3', destino: 'Terraza 4', capacidadM3: 24, viajes: 0, fecha: '2026-10-07' }),
  mov({ ...U1, tipo: 'interno', origen: 'Terraza 3', destino: 'Terraza 4', capacidadM3: 24, viajes: 3, fecha: '2026-10-08', observacion: 'Lluvia por la tarde' }),
  mov({ ...U1, tipo: 'salida', material: 'Triturado', destino: 'Destino Z', capacidadM3: 24, viajes: 2, fecha: '2026-10-07' }),
  mov({ ...U1, tipo: 'salida', material: 'Triturado', destino: 'Destino Z', capacidadM3: 24, viajes: null, estado: 'por_confirmar', fecha: '2026-10-08', observacion: 'Lluvia por la tarde' }),
  mov({ ...U1, tipo: 'salida', material: 'Triturado', destino: 'Destino Z', capacidadM3: 24, viajes: 4, estado: 'por_confirmar', fecha: '2026-10-09' }),
];
const MOVS = [...ENTRADAS, ...INTERNOS, ...SALIDAS, ...U1_MOVS];
// Internos de U-1 por confirmar (NO están en MOVS): uno sin número el 06 y otro con 3 viajes el 07.
const INTERNOS_PEND = [
  mov({ ...U1, tipo: 'interno', origen: 'Terraza 3', destino: 'Terraza 4', capacidadM3: 24, viajes: null, estado: 'por_confirmar', fecha: '2026-10-06' }),
  mov({ ...U1, tipo: 'interno', origen: 'Terraza 3', destino: 'Terraza 4', capacidadM3: 24, viajes: 3, estado: 'por_confirmar', fecha: '2026-10-07' }),
];
const RANGO = { desde: '2026-10-06', hasta: '2026-10-09' };
const OP_CORTE = { columnasPorDestino: true, diasSinAnotacion: 'cero' };

// ——— 1. Leer una cifra escrita a mano ———
eq('cifra: «12,34» → 12.34', L.numeroDeCampo('12,34'), 12.34);
eq('cifra: «4.321,09» → 4321.09', L.numeroDeCampo('4.321,09'), 4321.09);
eq('cifra: «4,321.09» (a la gringa) → 4321.09', L.numeroDeCampo('4,321.09'), 4321.09);
eq('cifra: «12» → 12', L.numeroDeCampo('12'), 12);
eq('cifra: campo con espacios → null (sin dato, no 0)', L.numeroDeCampo('  '), null);
eq('cifra: campo vacío → null', L.numeroDeCampo(''), null);
eq('cifra: un «0» escrito SÍ es un dato → 0', L.numeroDeCampo('0'), 0);
eq('cifra: texto sin ningún dígito → null (no se disfraza de 0)', L.numeroDeCampo('abc'), null);

// ——— 2. El momento real y el rango con corte ———
eq('momento: 06:30 es del día siguiente (jornada de 7am a 7am)', L.momentoReal('2026-10-22', '06:30'), '2026-10-23T06:30');
eq('momento: 18:00 es del mismo día', L.momentoReal('2026-10-22', '18:00'), '2026-10-22T18:00');
eq('momento: justo las 07:00 ya es del mismo día', L.momentoReal('2026-10-22', '07:00'), '2026-10-22T07:00');
eq('momento: 06:59 todavía es del día siguiente', L.momentoReal('2026-10-22', '06:59'), '2026-10-23T06:59');
eq('momento: sin hora → null', L.momentoReal('2026-10-22', null), null);
eq('momento: la hora de Postgres con segundos («18:00:00») también vale', L.momentoReal('2026-10-22', '18:00:00'), '2026-10-22T18:00');
eq('momento: cambio de mes (31 oct 05:00 → 1 nov)', L.momentoReal('2026-10-31', '05:00'), '2026-11-01T05:00');
eq('momento: cambio de año (31 dic 03:00 → 1 ene)', L.momentoReal('2026-12-31', '03:00'), '2027-01-01T03:00');
eq('momento: hora basura → null (sin NaN)', L.momentoReal('2026-10-22', 'tarde'), null);
eq('momento: fecha basura → null', L.momentoReal('ayer', '18:00'), null);

const CORTE = { desde: '2026-10-20', hasta: '2026-10-22', corteHora: '18:30' };
const enR = (o, r) => L.enRango(mov(o), r);
ok('corte 18:30: el 22 a las 18:00 ENTRA', enR({ fecha: '2026-10-22', hora: '18:00' }, CORTE));
ok('corte 18:30: el 22 a las 19:00 NO entra', !enR({ fecha: '2026-10-22', hora: '19:00' }, CORTE));
ok('corte 18:30: el 22 a las 06:00 NO entra (es el 23 a las 6)', !enR({ fecha: '2026-10-22', hora: '06:00' }, CORTE));
ok('corte 18:30: el 22 sin hora ENTRA (su fecha está en el rango)', enR({ fecha: '2026-10-22', hora: null }, CORTE));
ok('corte 18:30: el 23 NO entra', !enR({ fecha: '2026-10-23', hora: null }, CORTE));
ok('corte 18:30: el 21 a las 23:00 entra (días anteriores no se cortan)', enR({ fecha: '2026-10-21', hora: '23:00' }, CORTE));
ok('corte 18:30: el 19 NO entra (antes del desde)', !enR({ fecha: '2026-10-19', hora: null }, CORTE));
ok('corte 18:30: justo a las 18:30 ENTRA', enR({ fecha: '2026-10-22', hora: '18:30' }, CORTE));
ok('sin corte: el 22 a las 23:00 entra (solo cuenta la fecha)', enR({ fecha: '2026-10-22', hora: '23:00' }, { desde: '2026-10-20', hasta: '2026-10-22' }));
ok('sin corte: corteHora vacío no corta nada', enR({ fecha: '2026-10-22', hora: '23:00' }, { desde: '2026-10-20', hasta: '2026-10-22', corteHora: '' }));
ok('sin corte: corteHora null no corta nada', enR({ fecha: '2026-10-22', hora: '23:00' }, { desde: '2026-10-20', hasta: '2026-10-22', corteHora: null }));
ok('corte de madrugada (05:00): el 22 a las 04:00 entra, a las 06:00 no',
  enR({ fecha: '2026-10-22', hora: '04:00' }, { desde: '2026-10-20', hasta: '2026-10-22', corteHora: '05:00' })
  && !enR({ fecha: '2026-10-22', hora: '06:00' }, { desde: '2026-10-20', hasta: '2026-10-22', corteHora: '05:00' }));

// ⭐ R33 (revisión final A#2, 25-oct-2026): EL INSTANTE DE UN CORTE. Un renglón anotado a las
//    07:00 en punto ABRE su jornada (`momentoReal`, arriba); un CORTE a las 07:00 en punto la
//    CIERRA (es el día siguiente a las 07:00), igual que el Reporte General (R28).
eq('⭐ R33 momentoDelCorte: 07:00 en punto cierra la jornada → día siguiente', L.momentoDelCorte?.('2026-10-22', '07:00'), '2026-10-23T07:00');
eq('R33 momentoDelCorte: 07:00:00 (Postgres) igual', L.momentoDelCorte?.('2026-10-22', '07:00:00'), '2026-10-23T07:00');
eq('R33 momentoDelCorte: 06:59 → día siguiente (como siempre)', L.momentoDelCorte?.('2026-10-22', '06:59'), '2026-10-23T06:59');
eq('R33 momentoDelCorte: 07:01 → el mismo día', L.momentoDelCorte?.('2026-10-22', '07:01'), '2026-10-22T07:01');
eq('R33 momentoDelCorte: 19:00 → el mismo día', L.momentoDelCorte?.('2026-10-22', '19:00'), '2026-10-22T19:00');
eq('R33 momentoDelCorte: 31-dic 07:00 → 1-ene', L.momentoDelCorte?.('2026-12-31', '07:00'), '2027-01-01T07:00');
eq('R33 momentoDelCorte: sin hora, hora basura o fecha basura → null', [L.momentoDelCorte?.('2026-10-22', null), L.momentoDelCorte?.('2026-10-22', '25:00'), L.momentoDelCorte?.('ayer', '07:00')], [null, null, null]);
eq('R33: el RENGLÓN de las 07:00 sigue abriendo su jornada (momentoReal no cambia)', L.momentoReal('2026-10-22', '07:00'), '2026-10-22T07:00');
{
  const SIETE = { desde: '2026-10-20', hasta: '2026-10-22', corteHora: '07:00' };
  ok('⭐ R33 enRango con corte 07:00: entra TODA la jornada del 22 (las 10:00, las 05:00 de la madrugada y sin hora)',
    enR({ fecha: '2026-10-22', hora: '10:00' }, SIETE) && enR({ fecha: '2026-10-22', hora: '05:00' }, SIETE) && enR({ fecha: '2026-10-22', hora: '06:59' }, SIETE)
    && enR({ fecha: '2026-10-22', hora: '07:00' }, SIETE) && enR({ fecha: '2026-10-22', hora: null }, SIETE));
  ok('R33 enRango con corte 07:00: la jornada del 23 no entra', !enR({ fecha: '2026-10-23', hora: '07:00' }, SIETE) && !enR({ fecha: '2026-10-23', hora: null }, SIETE));
  // El escenario de la revisión: 50 viajes por patio (sin hora) y dos de ✍️ Carga libre (10:00 y 05:00).
  const J = [mov({ fecha: '2026-10-22', hora: null, viajes: 50 }), mov({ fecha: '2026-10-22', hora: '10:00', viajes: 3 }), mov({ fecha: '2026-10-22', hora: '05:00', viajes: 2 })];
  const viajes = (corteHora) => L.totalesDe(L.filtrarMovimientos(J, { desde: '2026-10-22', hasta: '2026-10-22', corteHora })).viajes;
  eq('⭐ R33: 06:59 y 07:00 ya no difieren en 24 horas (55 contra 55; antes 55 contra 50)', [viajes('06:59'), viajes('07:00')], [55, 55]);
  eq('R33: con 07:01 el corte es el 22 a las 07:01 (recién empieza esa jornada): solo los 50 sin hora', viajes('07:01'), 50);
}

// B3: un renglón sin fecha —o con una que no es fecha— no entra en NINGÚN período
// (antes entraba en todos: `null < '2026-…'` y `null > '2026-…'` dan los dos false).
const ENERO = { desde: '2026-01-01', hasta: '2026-01-31' };
const FEBRERO = { desde: '2026-02-01', hasta: '2026-02-28' };
eq('rango: un renglón con fecha null no entra ni en enero ni en febrero', [enR({ fecha: null }, ENERO), enR({ fecha: null }, FEBRERO)], [false, false]);
eq('rango: fecha undefined tampoco entra', enR({ fecha: undefined }, RANGO), false);
eq('rango: una fecha con un espacio al final no es una fecha', enR({ fecha: '2026-10-07 ' }, RANGO), false);
eq('rango: el listado de enero y el de febrero no cuentan el renglón sin fecha', [ENERO, FEBRERO].map((r) => L.filtrarMovimientos([mov({ fecha: null, viajes: 5 })], r).length), [0, 0]);
// …pero el RANGO no se valida: los centinelas de «sin principio» y «sin fin» siguen sirviendo en el listado.
ok('rango: «desde» vacío y «hasta» 9999-12-31 siguen trayendo los renglones', enR({ fecha: '2026-10-07' }, { desde: '', hasta: '9999-12-31' }));

// B7: el año de una fecha va de 2000 a 2100 (un 9999 hacía caer la pantalla).
eq('fecha: un año fuera de 2000–2100 no se entiende (momento null)',
  [L.momentoReal('9999-12-31', '05:00'), L.momentoReal('1999-12-31', '18:00'), L.momentoReal('2101-01-01', '18:00')], [null, null, null]);
eq('fecha: los bordes 2000 y 2100 sí valen', [L.momentoReal('2000-01-01', '18:00'), L.momentoReal('2100-12-31', '18:00')], ['2000-01-01T18:00', '2100-12-31T18:00']);
eq('rango: un renglón del año 1999 o del 2101 no entra aunque el rango sea abierto',
  [enR({ fecha: '1999-12-31' }, { desde: '', hasta: '9999-12-31' }), enR({ fecha: '2101-01-01' }, { desde: '', hasta: '9999-12-31' })], [false, false]);

// ——— 3. Los m³ de un renglón ———
eq('m³: el m3 escrito manda', L.m3De(mov({ m3: 50, viajes: 2, capacidadM3: 18 })), 50);
eq('m³: sin m3 → viajes × capacidad', L.m3De(mov({ m3: null, viajes: 2, capacidadM3: 18 })), 36);
eq('m³: sin capacidad → null', L.m3De(mov({ m3: null, viajes: 2, capacidadM3: null })), null);
eq('m³: sin viajes → null', L.m3De(mov({ m3: null, viajes: null, capacidadM3: 18 })), null);
eq('m³: un m3 escrito en 0 es un dato (no se pisa con viajes × capacidad)', L.m3De(mov({ m3: 0, viajes: 2, capacidadM3: 18 })), 0);
eq('m³: viajes 0 × capacidad = 0', L.m3De(mov({ m3: null, viajes: 0, capacidadM3: 18 })), 0);
ok('m³: NO se redondea por renglón (21.999, no 22; se redondea al final)', Math.abs(L.m3De(mov({ m3: null, viajes: 3, capacidadM3: 7.333 })) - 21.999) < 1e-9);

// ——— 4. Filtros ———
const ids = (arr) => arr.map((m) => m.id);
const F = (f, r = RANGO) => L.filtrarMovimientos(MOVS, r, f);
eq('filtrar: sin filtros devuelve todo lo del rango, en el mismo orden', ids(L.filtrarMovimientos(MOVS, RANGO)), ids(MOVS));
eq('filtrar: el rango recorta por fecha (solo los 4 renglones del 06)', ids(L.filtrarMovimientos(MOVS, { desde: '2026-10-06', hasta: '2026-10-06' })), ids([ENTRADAS[0], ENTRADAS[1], INTERNOS[0], U1_MOVS[0]]));
eq('filtrar: rango sin ningún renglón → vacío', L.filtrarMovimientos(MOVS, { desde: '2026-01-01', hasta: '2026-01-31' }), []);
eq('filtrar: por tipo entrada', F({ tipos: ['entrada'] }).length, 4);
eq('filtrar: por dos tipos (5 internos + 6 salidas)', F({ tipos: ['interno', 'salida'] }).length, 11);
eq('filtrar: por estado por_confirmar', F({ estados: ['por_confirmar'] }).length, 2);
eq('filtrar: por transportista sin mirar mayúsculas ni espacios', F({ transportistas: ['TRANSPORTISTA a'] }).length, 3);
eq('filtrar: por origen sin mirar mayúsculas', F({ origenes: ['frente 2'] }).length, 2);
eq('filtrar: por destino', F({ destinos: ['destino x'] }).length, 2);
eq('filtrar: por material sin tildes ni mayúsculas', F({ materiales: ['TRITURADO'] }).length, 2 + 3);
eq('filtrar: por unidad (id)', F({ unidadIds: ['u1'] }).length, 6);
eq('filtrar: una lista vacía no filtra nada', F({ tipos: [], unidadIds: [], transportistas: [] }).length, MOVS.length);
eq('filtrar: texto busca en destino/material sin tildes', F({ texto: 'ACERO' }).length, 1);
eq('filtrar: texto busca en la observación', F({ texto: 'lluvia' }).length, 2);
eq('filtrar: texto con varias palabras (todas deben estar)', [F({ texto: 'acero destino y' }).length, F({ texto: 'acero destino x' }).length], [1, 0]);
eq('filtrar: texto que no está en ninguna parte → vacío', F({ texto: 'inexistente' }), []);
eq('filtrar: los filtros se suman (Y)', F({ tipos: ['salida'], estados: ['por_confirmar'] }).length, 2);
eq('filtrar: no toca el arreglo de entrada', (() => { L.filtrarMovimientos(MOVS, RANGO, { tipos: ['salida'] }); return ids(MOVS); })(), ids([...ENTRADAS, ...INTERNOS, ...SALIDAS, ...U1_MOVS]));
// B4: «Sin destino» (o «Sin transportista»…) escrito a mano y el campo en blanco son lo MISMO,
// también al filtrar: ofrecer «Sin destino» como opción no puede salir vacío.
const EN_BLANCO = [
  mov({ tipo: 'salida', destino: null, transportista: null, origen: null, material: null, viajes: 2 }),
  mov({ tipo: 'salida', destino: 'Sin destino', transportista: 'sin transportista', origen: 'SIN ORIGEN', material: 'Sin material', viajes: 3 }),
  mov({ tipo: 'salida', destino: 'Destino Z', transportista: 'Alfa', origen: 'Frente 1', material: 'Arena', viajes: 1 }),
];
eq('filtrar: «Sin destino» trae el destino en blanco y el escrito así', ids(L.filtrarMovimientos(EN_BLANCO, RANGO, { destinos: ['Sin destino'] })), ids(EN_BLANCO.slice(0, 2)));
eq('filtrar: igual con transportista, origen y material',
  [{ transportistas: ['Sin transportista'] }, { origenes: ['sin origen'] }, { materiales: ['SIN MATERIAL'] }].map((f) => L.filtrarMovimientos(EN_BLANCO, RANGO, f).length), [2, 2, 2]);
eq('filtrar: un nombre de verdad no trae los en blanco', L.filtrarMovimientos(EN_BLANCO, RANGO, { destinos: ['Destino Z'] }).length, 1);

// ——— 5. Totales y el texto «N (+M …)» ———
const tEnt = L.totalesDe(MOVS.filter((m) => m.tipo === 'entrada'));
eq('totales de las entradas: viajes 9', tEnt.viajes, 9);
eq('totales de las entradas: toneladas 204.5', tEnt.toneladas, 204.5);
eq('totales de las entradas: promedio ≈ 22.72 t/viaje', tEnt.promedioTonViaje, 22.72);
eq('totales de las entradas: 4 renglones, sin pendientes', [tEnt.renglones, tEnt.pendientesSinNumero, tEnt.porConfirmarViajes], [4, 0, 0]);
eq('totales: m³ de entradas sin capacidad = 0 (no NaN)', tEnt.m3, 0);

const tSal = L.totalesDe(MOVS.filter((m) => m.tipo === 'salida'));
eq('totales de las salidas: por_confirmar NO suma (2 + 3 + 1 + 2 = 8 viajes)', tSal.viajes, 8);
eq('totales de las salidas: pendientes sin número = 1', tSal.pendientesSinNumero, 1);
eq('totales de las salidas: por confirmar con número = 4 viajes', tSal.porConfirmarViajes, 4);
eq('totales de las salidas: m³ = 2×18 + 3×24 + 1×24 + 2×24', tSal.m3, 36 + 72 + 24 + 48);
eq('totales de las salidas: sin toneladas anotadas → 0', tSal.toneladas, 0);
eq('totales de las salidas: sin entradas no hay promedio (null, no 0)', tSal.promedioTonViaje, null);
eq('totales: cuenta todos los renglones, también los por confirmar', tSal.renglones, 3 + 3);

// Un por_confirmar NUNCA suma a viajes/toneladas/m³ (ni siquiera con todos los datos).
const tPorConf = L.totalesDe([
  ...ENTRADAS,
  mov({ tipo: 'entrada', transportista: 'Transportista C', viajes: 10, toneladas: 500, m3: 700, estado: 'por_confirmar' }),
]);
eq('por_confirmar con todo cargado sigue sin sumar', [tPorConf.viajes, tPorConf.toneladas, tPorConf.m3], [9, 204.5, 0]);
eq('por_confirmar con 10 viajes se reporta aparte', tPorConf.porConfirmarViajes, 10);
eq('por_confirmar no mueve el promedio', tPorConf.promedioTonViaje, 22.72);

// esperando_pesaje: suma viajes y m³, pero no entra al promedio.
const tEsp = L.totalesDe([
  mov({ transportista: 'Transportista A', viajes: 2, toneladas: 40 }),
  mov({ transportista: 'Transportista A', viajes: 4, capacidadM3: 20, toneladas: 100, estado: 'esperando_pesaje' }),
]);
eq('esperando_pesaje suma sus viajes', tEsp.viajes, 6);
eq('esperando_pesaje suma sus m³', tEsp.m3, 80);
eq('esperando_pesaje no suma toneladas (aún sin peso neto: aunque traiga una cifra)', tEsp.toneladas, 40);
eq('esperando_pesaje queda fuera del promedio (40 t / 2 viajes = 20)', tEsp.promedioTonViaje, 20);
eq('solo esperando_pesaje → sin promedio', L.totalesDe([mov({ viajes: 4, estado: 'esperando_pesaje' })]).promedioTonViaje, null);
eq('promedio: una entrada sin toneladas no diluye el promedio', L.totalesDe([mov({ viajes: 2, toneladas: 40 }), mov({ viajes: 5, toneladas: null })]).promedioTonViaje, 20);
eq('promedio: solo cuenta las ENTRADAS (una salida con toneladas no entra)', L.totalesDe([mov({ tipo: 'salida', viajes: 2, toneladas: 40 })]).promedioTonViaje, null);
eq('totales: el redondeo es al final (0.1 + 0.2 t = 0.3 exacto)', L.totalesDe([mov({ toneladas: 0.1 }), mov({ toneladas: 0.2 })]).toneladas, 0.3);
eq('totales: toneladas a 2 decimales', L.totalesDe([mov({ toneladas: 1.005 }), mov({ toneladas: 1.0049 })]).toneladas, 2.01);

// El texto «N (+M …)»: R1 — sirve para Totales y para cualquier objeto con los tres campos.
eq('texto viajes: solo el número', L.textoViajes({ viajes: 2, pendientesSinNumero: 0, porConfirmarViajes: 0 }), '2');
eq('texto viajes: un pendiente sin número', L.textoViajes({ viajes: 2, pendientesSinNumero: 1, porConfirmarViajes: 0 }), '2 (+1 pendiente)');
eq('texto viajes: por confirmar con número', L.textoViajes({ viajes: 2, pendientesSinNumero: 0, porConfirmarViajes: 4 }), '2 (+4 por confirmar)');
eq('texto viajes: de los dos', L.textoViajes({ viajes: 2, pendientesSinNumero: 1, porConfirmarViajes: 4 }), '2 (+1 pendiente, +4 por confirmar)');
eq('texto viajes: varios pendientes van en plural', L.textoViajes({ viajes: 7, pendientesSinNumero: 3, porConfirmarViajes: 0 }), '7 (+3 pendientes)');
eq('texto viajes: con un Totales completo', L.textoViajes(tSal), '8 (+1 pendiente, +4 por confirmar)');
eq('texto viajes: cero viajes sin nada pendiente', L.textoViajes(L.totalesDe([])), '0');

// ——— 6. Tablas por eje ———
const tTransp = L.tablaPor(MOVS.filter((m) => m.tipo === 'entrada'), 'transportista', 'cantidad');
eq('por transportista: 2 filas (la misma empresa escrita distinto agrupa)', tTransp.length, 2);
eq('por transportista: la primera es la de más viajes, con su primera forma escrita',
  { clave: tTransp[0].clave, viajes: tTransp[0].viajes, toneladas: tTransp[0].toneladas },
  { clave: 'Transportista A', viajes: 6, toneladas: 138.5 });
eq('por transportista: la segunda', { clave: tTransp[1].clave, viajes: tTransp[1].viajes, toneladas: tTransp[1].toneladas },
  { clave: 'Transportista B', viajes: 3, toneladas: 66 });
ok('por transportista: la participación suma 100 ± 0.1', Math.abs(tTransp.reduce((a, f) => a + f.pct, 0) - 100) <= 0.1);
eq('por transportista: pct a un decimal (6/9 = 66.7, 3/9 = 33.3)', tTransp.map((f) => f.pct), [66.7, 33.3]);
eq('por transportista: m³ sin capacidad = 0', tTransp.map((f) => f.m3), [0, 0]);

const tOrigen = L.tablaPor(MOVS.filter((m) => m.tipo === 'entrada'), 'origen', 'cantidad');
eq('por origen: «FRENTE 2 » y «Frente 2» son uno solo', tOrigen.length, 2);
eq('por origen: Frente 1 (3 + 3 viajes, 136.5 t) va primero por cantidad', { c: tOrigen[0].clave, v: tOrigen[0].viajes, t: tOrigen[0].toneladas }, { c: 'Frente 1', v: 6, t: 136.5 });
eq('por origen: Frente 2 conserva la PRIMERA forma escrita, sin espacios sobrantes', { c: tOrigen[1].clave, v: tOrigen[1].viajes, t: tOrigen[1].toneladas }, { c: 'Frente 2', v: 3, t: 68 });

const entradasOrdenInverso = [
  mov({ transportista: 'Zeta', viajes: 9 }), mov({ transportista: 'Álamo', viajes: 1 }), mov({ transportista: 'beta', viajes: 5 }),
];
eq('orden A→Z: sin tildes ni mayúsculas', L.tablaPor(entradasOrdenInverso, 'transportista', 'az').map((f) => f.clave), ['Álamo', 'beta', 'Zeta']);
eq('orden por cantidad: más viajes primero', L.tablaPor(entradasOrdenInverso, 'transportista', 'cantidad').map((f) => f.clave), ['Zeta', 'beta', 'Álamo']);
eq('orden por cantidad: el empate se desempata A→Z', L.tablaPor([mov({ transportista: 'Beta', viajes: 2 }), mov({ transportista: 'Alfa', viajes: 2 })], 'transportista', 'cantidad').map((f) => f.clave), ['Alfa', 'Beta']);

const conVacios = L.tablaPor([mov({ transportista: 'Alfa', viajes: 1 }), mov({ transportista: null, viajes: 9 }), mov({ transportista: '   ', viajes: 2 })], 'transportista', 'cantidad');
eq('lo escrito en blanco se junta en «Sin transportista» y va al final', conVacios.map((f) => [f.clave, f.viajes]), [['Alfa', 1], ['Sin transportista', 11]]);
eq('lo escrito en blanco también va al final en A→Z', L.tablaPor([mov({ transportista: null }), mov({ transportista: 'Zeta' })], 'transportista', 'az').map((f) => f.clave), ['Zeta', 'Sin transportista']);
// B4: «Sin transportista» escrito a mano y el campo en blanco son UNA sola fila (no dos con el mismo rótulo).
eq('«Sin transportista» escrito y uno en blanco: una sola fila, al final',
  L.tablaPor([mov({ transportista: 'Alfa', viajes: 1 }), mov({ transportista: 'sin transportista', viajes: 2 }), mov({ transportista: null, viajes: 3 })], 'transportista', 'cantidad').map((f) => [f.clave, f.viajes]),
  [['Alfa', 1], ['Sin transportista', 5]]);
eq('igual por destino, origen y material', ['destino', 'origen', 'material'].map((eje) => L.tablaPor(EN_BLANCO, eje, 'cantidad').map((f) => f.viajes)), [[1, 5], [1, 5], [1, 5]]);
eq('por unidad: sin texto ni placa y «Sin unidad» escrito son una sola fila',
  L.tablaPor([mov({ unidadTexto: '', viajes: 2 }), mov({ unidadTexto: 'Sin unidad', viajes: 3 }), mov({ unidadTexto: 'Volteo', viajes: 1 })], 'unidad', 'cantidad').map((f) => [f.clave, f.viajes]),
  [['Volteo', 1], ['Sin unidad', 5]]);

eq('por destino', L.tablaPor(MOVS.filter((m) => m.tipo === 'salida'), 'destino', 'cantidad').map((f) => [f.clave, f.viajes]), [['Destino X', 5], ['Destino Z', 2], ['Destino Y', 1]]);
eq('por material: los por_confirmar no aparecen ni crean filas', L.tablaPor(MOVS.filter((m) => m.tipo === 'salida'), 'material', 'cantidad').map((f) => [f.clave, f.viajes, f.m3]), [['Triturado', 7, 36 + 72 + 48], ['Acero', 1, 24]]);
eq('por unidad: agrupa por el id, con el texto congelado',
  L.tablaPor(MOVS.filter((m) => m.tipo === 'interno'), 'unidad', 'cantidad').map((f) => [f.clave, f.viajes, f.m3]),
  [['U-1', 8, 192], ['Camión 2', 6, 108]]);
eq('por unidad: un renglón sin unidad vinculada se agrupa por su placa', L.tablaPor([mov({ placa: 'XX-9', unidadTexto: 'Volteo', viajes: 2 }), mov({ placa: ' xx-9', unidadTexto: 'otro nombre', viajes: 1 })], 'unidad', 'cantidad').map((f) => [f.clave, f.viajes]), [['Volteo', 3]]);
eq('tabla: lo que espera pesaje suma viajes y m³, pero no toneladas',
  L.tablaPor([mov({ viajes: 2, toneladas: 40, transportista: 'Alfa' }), mov({ viajes: 4, toneladas: 100, capacidadM3: 20, estado: 'esperando_pesaje', transportista: 'alfa' })], 'transportista', 'az').map((f) => [f.viajes, f.toneladas, f.m3]),
  [[6, 40, 80]]);
const tresMilesimas = [0.004, 0.004, 0.004].map((x) => mov({ transportista: 'Alfa', viajes: 1, toneladas: x, m3: x }));
eq('redondeo al final: 3 renglones de 0.004 suman 0.01 (no 0)', [L.totalesDe(tresMilesimas).toneladas, L.totalesDe(tresMilesimas).m3], [0.01, 0.01]);
eq('redondeo al final también en las tablas', L.tablaPor(tresMilesimas, 'transportista', 'az').map((f) => [f.toneladas, f.m3]), [[0.01, 0.01]]);
eq('tabla vacía: sin filas', L.tablaPor([], 'transportista', 'cantidad'), []);
const todoCero = L.tablaPor([mov({ transportista: 'Alfa', viajes: 0 }), mov({ transportista: 'Beta', viajes: 0 })], 'transportista', 'az');
eq('tabla con 0 viajes en total: pct 0, sin dividir entre cero', todoCero.map((f) => f.pct), [0, 0]);
ok('tabla con 0 viajes: sin NaN', !hayNaN(todoCero));

// ——— 7. El consolidado del sitio (papel A) ———
const C = L.consolidadoSitio(MOVS, 'cantidad');
eq('consolidado: los totales son los de lo RECIBIDO (entradas)', [C.totales.viajes, C.totales.toneladas, C.totales.promedioTonViaje], [9, 204.5, 22.72]);
eq('consolidado: por transportista', C.porTransportista.map((f) => [f.clave, f.viajes]), [['Transportista A', 6], ['Transportista B', 3]]);
eq('consolidado: por origen', C.porOrigen.map((f) => [f.clave, f.viajes]), [['Frente 1', 6], ['Frente 2', 3]]);
eq('consolidado: internos por recorrido y capacidad',
  C.internos.map((i) => [i.origen, i.destino, i.capacidadM3, i.viajes, i.m3]),
  [['Terraza 3', 'Terraza 4', 24, 8, 192], ['Terraza 1', 'Terraza 2', 18, 6, 108]]);
eq('consolidado: salidas por material, destino, capacidad y estado (sin los por_confirmar)',
  C.salidas.map((s) => [s.material, s.destino, s.capacidadM3, s.estado, s.viajes, s.m3]),
  [
    ['Triturado', 'Destino X', 24, 'confirmado', 3, 72],
    ['Triturado', 'Destino X', 18, 'confirmado', 2, 36],
    ['Triturado', 'Destino Z', 24, 'confirmado', 2, 48],
    ['Acero', 'Destino Y', 24, 'esperando_pesaje', 1, 24],
  ]);
const acero = C.salidas.find((s) => s.material === 'Acero');
eq('consolidado: el acero sale con estado esperando_pesaje', acero.estado, 'esperando_pesaje');
eq('consolidado: …y sus viajes cuentan', acero.viajes, 1);
eq('consolidado: …y queda fuera del promedio (que es solo de entradas pesadas)', C.totales.promedioTonViaje, 22.72);
ok('consolidado: textoSalidas[0] menciona 5 viajes del triturado', C.textoSalidas[0].includes('5 viajes'));
ok('consolidado: textoSalidas[0] menciona 108 m³ (2×18 + 3×24)', C.textoSalidas[0].includes('108 m³'));
ok('consolidado: textoSalidas[0] es del triturado hacia Destino X', C.textoSalidas[0].startsWith('Triturado → Destino X'));
eq('consolidado: una línea de texto por material y destino', C.textoSalidas.length, 3);
ok('consolidado: el acero avisa que espera pesaje', C.textoSalidas.some((t) => t.startsWith('Acero') && t.includes('esperando pesaje') && t.includes('1 viaje') && !t.includes('1 viajes')));
eq('consolidado: el texto del triturado, exacto', C.textoSalidas[0], 'Triturado → Destino X: 5 viajes (2 de 18 m³ y 3 de 24 m³) = 108 m³');
eq('consolidado: el texto del acero, exacto', C.textoSalidas[2], 'Acero → Destino Y: 1 viaje de 24 m³ = 24 m³ (esperando pesaje)');
const CT = L.consolidadoSitio([
  mov({ tipo: 'salida', material: 'Arena', destino: 'Destino W', capacidadM3: 20, viajes: 2, toneladas: 41.5 }),
  mov({ tipo: 'salida', material: 'arena', destino: 'destino w', capacidadM3: 20, viajes: 1, toneladas: 33, estado: 'esperando_pesaje' }),
], 'cantidad');
eq('consolidado: salidas con toneladas (el que espera pesaje no las suma)', CT.salidas.map((x) => [x.estado, x.viajes, x.toneladas, x.m3]), [['confirmado', 2, 41.5, 40], ['esperando_pesaje', 1, 0, 20]]);
eq('consolidado: texto con una parte esperando pesaje', CT.textoSalidas, ['Arena → Destino W: 3 viajes de 20 m³ = 60 m³ (1 esperando pesaje)']);
// A8 (2): con tres capacidades, comas y una sola «y» al final.
eq('consolidado: tres capacidades se unen con comas y una sola «y»',
  L.consolidadoSitio([12, 18, 24].map((c, i) => mov({ tipo: 'salida', material: 'Triturado', destino: 'Destino X', capacidadM3: c, viajes: i + 1 })), 'cantidad').textoSalidas,
  ['Triturado → Destino X: 6 viajes (1 de 12 m³, 2 de 18 m³ y 3 de 24 m³) = 120 m³']);
// R4: con m³ escritos a mano que no son viajes × capacidad, el texto no escribe una cuenta que no cuadra.
eq('consolidado: m³ escritos a mano (50 con 2 × 18) → sin la cuenta «de 18 m³ =»',
  L.consolidadoSitio([mov({ tipo: 'salida', material: 'Arena', destino: 'Destino W', capacidadM3: 18, viajes: 2, m3: 50 })], 'cantidad').textoSalidas,
  ['Arena → Destino W: 2 viajes · 50 m³']);
eq('consolidado: m³ a mano con dos capacidades → sin el desglose',
  L.consolidadoSitio([
    mov({ tipo: 'salida', material: 'Arena', destino: 'Destino W', capacidadM3: 18, viajes: 2 }),
    mov({ tipo: 'salida', material: 'Arena', destino: 'Destino W', capacidadM3: 24, viajes: 1, m3: 30, estado: 'esperando_pesaje' }),
  ], 'cantidad').textoSalidas,
  ['Arena → Destino W: 3 viajes · 66 m³ (1 esperando pesaje)']);
eq('consolidado: m³ a mano que SÍ cuadran (36 = 2 × 18) dejan la cuenta como siempre',
  L.consolidadoSitio([mov({ tipo: 'salida', material: 'Arena', destino: 'Destino W', capacidadM3: 18, viajes: 2, m3: 36 })], 'cantidad').textoSalidas,
  ['Arena → Destino W: 2 viajes de 18 m³ = 36 m³']);
// B4: «Sin destino» escrito y el destino en blanco son el MISMO grupo (en internos, salidas y el texto).
const CB = L.consolidadoSitio([
  mov({ tipo: 'interno', origen: null, destino: 'Terraza 2', capacidadM3: 18, viajes: 2 }),
  mov({ tipo: 'interno', origen: 'Sin origen', destino: 'Terraza 2', capacidadM3: 18, viajes: 1 }),
  mov({ tipo: 'salida', material: 'Arena', destino: null, capacidadM3: 20, viajes: 2 }),
  mov({ tipo: 'salida', material: 'arena', destino: 'sin destino', capacidadM3: 20, viajes: 3 }),
  mov({ tipo: 'salida', material: null, destino: 'Destino W', capacidadM3: 20, viajes: 1 }),
  mov({ tipo: 'salida', material: 'Sin material', destino: 'Destino W', capacidadM3: 20, viajes: 1 }),
], 'cantidad');
eq('consolidado: internos con el origen en blanco y «Sin origen» escrito → una fila', CB.internos.map((i) => [i.origen, i.destino, i.viajes]), [['Sin origen', 'Terraza 2', 3]]);
eq('consolidado: salidas con el destino (o el material) en blanco y escrito «Sin …» → una fila cada uno',
  CB.salidas.map((s) => [s.material, s.destino, s.viajes]), [['Arena', 'Sin destino', 5], ['Sin material', 'Destino W', 2]]);
eq('consolidado: el texto de salidas tampoco repite la línea', CB.textoSalidas.length, 2);
eq('consolidado: no está vacío', C.vacio, false);
ok('consolidado: sin NaN', !hayNaN(C));
// R9: los por confirmar se avisan aparte, uno para los internos y otro para las salidas.
const SIN_PEND = { pendientesSinNumero: 0, porConfirmarViajes: 0 };
eq('consolidado: pendientes de las salidas (U-1: 1 sin número y 4 por confirmar)', C.pendientesSalidas, { pendientesSinNumero: 1, porConfirmarViajes: 4 });
eq('consolidado: sin internos por confirmar → pendientes de internos en cero', C.pendientesInternos, SIN_PEND);
const CPend = L.consolidadoSitio([...MOVS, ...INTERNOS_PEND], 'cantidad');
eq('consolidado: los internos por confirmar se avisan aparte (1 sin número, 3 por confirmar)', CPend.pendientesInternos, { pendientesSinNumero: 1, porConfirmarViajes: 3 });
eq('consolidado: …sin tocar los pendientes de las salidas', CPend.pendientesSalidas, { pendientesSinNumero: 1, porConfirmarViajes: 4 });
eq('consolidado: …ni la tabla de internos (no suman)', CPend.internos, C.internos);
const CEntPend = L.consolidadoSitio([...MOVS, mov({ tipo: 'entrada', transportista: 'Transportista C', viajes: 5, estado: 'por_confirmar' })], 'cantidad');
eq('consolidado: una entrada por confirmar no cae en los pendientes de internos ni de salidas', [CEntPend.pendientesInternos, CEntPend.pendientesSalidas], [SIN_PEND, { pendientesSinNumero: 1, porConfirmarViajes: 4 }]);
eq('consolidado: …sino en las tarjetas de lo recibido (5 por confirmar)', [CEntPend.totales.porConfirmarViajes, L.textoViajes(CEntPend.totales)], [5, '9 (+5 por confirmar)']);
const CAz = L.consolidadoSitio(MOVS, 'az');
eq('consolidado A→Z: transportistas', CAz.porTransportista.map((f) => f.clave), ['Transportista A', 'Transportista B']);
eq('consolidado A→Z: internos por origen', CAz.internos.map((i) => i.origen), ['Terraza 1', 'Terraza 3']);
eq('consolidado A→Z: salidas por material', CAz.salidas.map((s) => s.material), ['Acero', 'Triturado', 'Triturado', 'Triturado']);
ok('consolidado A→Z: el texto del acero va primero', CAz.textoSalidas[0].startsWith('Acero'));

// ——— 8. El corte por unidad (papel B) ———
const K = L.cortePorUnidad(MOVS, RANGO, 'u1', OP_CORTE);
eq('corte U-1: 4 días', K.dias.length, 4);
eq('corte U-1: 4 días evaluados', K.diasEvaluados, 4);
eq('corte U-1: una columna por destino → [Destino Z]', K.destinos, ['Destino Z']);
eq('corte U-1: el 08 está pendiente', K.dias.find((d) => d.fecha === '2026-10-08').pendiente, true);
eq('corte U-1: internos totales = 8 (5 + 0 + 3)', K.totales.internos, 8);
eq('corte U-1: la unidad lleva su texto congelado y su placa', [K.unidad, K.placa], ['U-1', 'TST-001']);
eq('corte U-1: los días van en orden', K.dias.map((d) => d.fecha), ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
eq('corte U-1: internos por día', K.dias.map((d) => d.internos), [5, 0, 3, 0]);
eq('corte U-1: salidas por destino y día', K.dias.map((d) => d.salidas), [{ 'Destino Z': 0 }, { 'Destino Z': 2 }, { 'Destino Z': 0 }, { 'Destino Z': 0 }]);
eq('corte U-1: pendiente por día', K.dias.map((d) => d.pendiente), [false, false, true, true]);
eq('corte U-1: la observación se anota en su día (una sola vez aunque se repita)', K.dias.map((d) => d.observaciones), [[], [], ['Lluvia por la tarde'], []]);
eq('corte U-1: salidas totales = 2 (el por confirmar no suma)', K.totales.salidas, 2);
eq('corte U-1: total = internos + salidas', K.totales.total, 10);
eq('corte U-1: 1 pendiente sin número y 4 viajes por confirmar', [K.totales.pendientesSinNumero, K.totales.porConfirmarViajes], [1, 4]);
eq('corte U-1: textoViajes de sus salidas (R1)', L.textoViajes({ viajes: K.totales.salidas, pendientesSinNumero: K.totales.pendientesSinNumero, porConfirmarViajes: K.totales.porConfirmarViajes }), '2 (+1 pendiente, +4 por confirmar)');
const K0608 = L.cortePorUnidad(MOVS, { desde: '2026-10-06', hasta: '2026-10-08' }, 'u1', OP_CORTE);
eq('corte U-1 del 06 al 08: solo el pendiente sin número → «2 (+1 pendiente)»',
  L.textoViajes({ viajes: K0608.totales.salidas, pendientesSinNumero: K0608.totales.pendientesSinNumero, porConfirmarViajes: K0608.totales.porConfirmarViajes }), '2 (+1 pendiente)');
// A3: cada día dice CUÁNTO está por confirmar y DE QUÉ (internos o salidas), para pintarlo en su columna.
eq('corte U-1: por confirmar de las salidas, por día (08 sin número; 09 con 4)', K.dias.map((d) => d.pendienteSalidas),
  [SIN_PEND, SIN_PEND, { pendientesSinNumero: 1, porConfirmarViajes: 0 }, { pendientesSinNumero: 0, porConfirmarViajes: 4 }]);
eq('corte U-1: sin internos por confirmar → en cero todos los días', K.dias.map((d) => d.pendienteInternos), [SIN_PEND, SIN_PEND, SIN_PEND, SIN_PEND]);
eq('corte U-1: no está vacío', K.vacio, false);
ok('corte U-1: sin NaN', !hayNaN(K));

const KsolaCol = L.cortePorUnidad(MOVS, RANGO, 'u1', { columnasPorDestino: false, diasSinAnotacion: 'cero' });
eq('corte con una sola columna «Salidas»', KsolaCol.destinos, ['Salidas']);
eq('corte con una sola columna: las salidas del 07 caen ahí', KsolaCol.dias.map((d) => d.salidas), [{ Salidas: 0 }, { Salidas: 2 }, { Salidas: 0 }, { Salidas: 0 }]);
eq('corte con una sola columna: los totales no cambian', [KsolaCol.totales.internos, KsolaCol.totales.salidas, KsolaCol.totales.total], [8, 2, 10]);

// Días sin anotación: como cero o escondidos. Rango ampliado: el 05 y el 10 no tienen nada.
const RANGO_AMPLIO = { desde: '2026-10-05', hasta: '2026-10-10' };
const Kcero = L.cortePorUnidad(MOVS, RANGO_AMPLIO, 'u1', OP_CORTE);
const Koculta = L.cortePorUnidad(MOVS, RANGO_AMPLIO, 'u1', { columnasPorDestino: true, diasSinAnotacion: 'ocultar' });
eq('días sin anotación como 0: salen los 6 días', [Kcero.dias.length, Kcero.diasEvaluados], [6, 6]);
eq('días sin anotación como 0: el 05 sale en cero', Kcero.dias[0], { fecha: '2026-10-05', internos: 0, salidas: { 'Destino Z': 0 }, pendiente: false, pendienteInternos: SIN_PEND, pendienteSalidas: SIN_PEND, observaciones: [] });
eq('días sin anotación escondidos: solo los 4 con renglones', Koculta.dias.map((d) => d.fecha), ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
eq('días sin anotación escondidos: los días evaluados son los que se ven (lo oculto no deja rastro)', Koculta.diasEvaluados, 4);
eq('días escondidos o en cero: los totales son los mismos', Kcero.totales, Koculta.totales);
ok('el día 07 con un renglón en 0 SÍ cuenta como anotado (sigue visible al esconder)', Koculta.dias.some((d) => d.fecha === '2026-10-07'));

// El corte con hora de corte recorta por momento real.
const MOVS_HORA = [
  mov({ ...U1, tipo: 'interno', fecha: '2026-10-07', hora: '10:00', viajes: 2 }),
  mov({ ...U1, tipo: 'interno', fecha: '2026-10-07', hora: '19:30', viajes: 4 }),
  mov({ ...U1, tipo: 'interno', fecha: '2026-10-07', hora: '03:00', viajes: 8 }),
];
eq('corte con hora: solo entra lo anterior al corte (10:00; no 19:30 ni el de las 3am del 08)',
  L.cortePorUnidad(MOVS_HORA, { desde: '2026-10-07', hasta: '2026-10-07', corteHora: '18:30' }, 'u1', OP_CORTE).totales.internos, 2);
eq('corte sin hora de corte: entra todo el día', L.cortePorUnidad(MOVS_HORA, { desde: '2026-10-07', hasta: '2026-10-07' }, 'u1', OP_CORTE).totales.internos, 14);

// Otros tipos y otras unidades no se mezclan.
const MEZCLA = [
  ...U1_MOVS,
  mov({ ...U1, tipo: 'entrada', fecha: '2026-10-06', viajes: 50 }),
  mov({ ...U1, tipo: 'otro', fecha: '2026-10-06', viajes: 60 }),
  mov({ unidadId: 'u9', unidadTexto: 'U-9', placa: 'TST-009', tipo: 'interno', fecha: '2026-10-06', viajes: 70 }),
];
eq('corte: las entradas, «otro» y las demás unidades no se mezclan', L.cortePorUnidad(MEZCLA, RANGO, 'u1', OP_CORTE).totales, K.totales);

// Los pendientes del corte son los de las SALIDAS (la tarjeta de externos): un interno
// por confirmar no los cambia, pero sí marca su día como «Por confirmar».
const KintPend = L.cortePorUnidad([...MOVS, ...INTERNOS_PEND], RANGO, 'u1', OP_CORTE);
eq('corte: un interno por confirmar NO cambia los pendientes (son de las salidas)', [KintPend.totales.pendientesSinNumero, KintPend.totales.porConfirmarViajes], [1, 4]);
eq('corte: …pero su día sí queda pendiente (06 y 07)', KintPend.dias.map((d) => d.pendiente), [true, true, true, true]);
eq('corte: …y no suma a los internos ni al total', [KintPend.totales.internos, KintPend.totales.total], [8, 10]);
eq('corte: solo internos por confirmar → pendientes en cero, día marcado', (() => {
  const k = L.cortePorUnidad(INTERNOS_PEND, RANGO, 'u1', OP_CORTE);
  return [k.totales.pendientesSinNumero, k.totales.porConfirmarViajes, k.dias.map((d) => d.pendiente)];
})(), [0, 0, [true, true, false, false]]);
// A3: el día dice de QUÉ es lo pendiente: un interno por confirmar va en los internos, no en las salidas.
eq('corte: el interno por confirmar del 06 (sin número) y del 07 (3) van en pendienteInternos',
  KintPend.dias.map((d) => d.pendienteInternos), [{ pendientesSinNumero: 1, porConfirmarViajes: 0 }, { pendientesSinNumero: 0, porConfirmarViajes: 3 }, SIN_PEND, SIN_PEND]);
eq('corte: …y no tocan pendienteSalidas de esos días', KintPend.dias.slice(0, 2).map((d) => d.pendienteSalidas), [SIN_PEND, SIN_PEND]);

// A4 (4) + B4: una salida sin destino tiene su columna «Sin destino», AL FINAL; y «Sin destino»
// escrito a mano cae en esa MISMA columna (antes salían dos columnas iguales con la cifra repetida).
const SIN_DESTINO_U1 = [
  mov({ ...U1, tipo: 'salida', destino: 'Destino Z', viajes: 2, fecha: '2026-10-06' }),
  mov({ ...U1, tipo: 'salida', destino: null, viajes: 5, fecha: '2026-10-07' }),
  mov({ ...U1, tipo: 'salida', destino: 'sin destino', viajes: 1, fecha: '2026-10-07' }),
  mov({ ...U1, tipo: 'salida', destino: 'Destino A', viajes: 1, fecha: '2026-10-08' }),
];
const KsinDest = L.cortePorUnidad(SIN_DESTINO_U1, RANGO, 'u1', OP_CORTE);
eq('corte: la columna «Sin destino» es una sola y va al final', KsinDest.destinos, ['Destino A', 'Destino Z', 'Sin destino']);
eq('corte: el blanco y el escrito «sin destino» suman en la misma columna', KsinDest.dias[1].salidas, { 'Destino A': 0, 'Destino Z': 0, 'Sin destino': 6 });
eq('corte: la suma de las columnas es igual al total de salidas',
  [KsinDest.dias.reduce((s, d) => s + Object.values(d.salidas).reduce((a, b) => a + b, 0), 0), KsinDest.totales.salidas], [9, 9]);
const KsoloSinDest = L.cortePorUnidad([SIN_DESTINO_U1[2], SIN_DESTINO_U1[1]], RANGO, 'u1', OP_CORTE);
eq('corte: con el escrito «sin destino» primero, la columna se llama igual («Sin destino») y es una sola', [KsoloSinDest.destinos, KsoloSinDest.dias[1].salidas], [['Sin destino'], { 'Sin destino': 6 }]);

// B3: un renglón de la unidad con la fecha mala no infla los totales del corte (cuadran con los días).
const KfechaMala = L.cortePorUnidad([...U1_MOVS, mov({ ...U1, tipo: 'interno', fecha: null, viajes: 5 }), mov({ ...U1, tipo: 'interno', fecha: '2026-10-07 ', viajes: 4 })], RANGO, 'u1', OP_CORTE);
eq('corte: los renglones sin fecha válida no entran (los totales cuadran con los días)',
  [KfechaMala.totales.internos, KfechaMala.dias.reduce((s, d) => s + d.internos, 0)], [8, 8]);

// B7: un «hasta» del año 9999 (el centinela de «sin fin») ya no revienta ni recorre millones de días.
const corte9999 = (() => {
  try {
    const k = L.cortePorUnidad(MOVS, { desde: '2026-10-06', hasta: '9999-12-31' }, 'u1', { columnasPorDestino: true, diasSinAnotacion: 'ocultar' });
    return ['sin excepción', k.dias.length];
  } catch (e) { return [String(e && e.message)]; }
})();
eq('corte hasta 9999-12-31: sin excepción y sin días (el corte no admite centinelas)', corte9999, ['sin excepción', 0]);
eq('corte con un año fuera de 2000–2100: sin días', [L.cortePorUnidad(MOVS, { desde: '2101-01-01', hasta: '2101-01-03' }, 'u1', OP_CORTE).dias.length, L.cortePorUnidad(MOVS, { desde: '1999-12-30', hasta: '1999-12-31' }, 'u1', OP_CORTE).dias.length], [0, 0]);

// R2: la ficha de la unidad (de la flota) es la preferida para el encabezado del corte, y la
// única que hay cuando la unidad no trabajó en el período (antes salía el id crudo).
const FICHA_U1 = { unidad: 'U-1', placa: 'TST-001' };
eq('corte vacío con ficha: el encabezado es el de la ficha, no la clave', (() => { const k = L.cortePorUnidad([], RANGO, 'u1', OP_CORTE, FICHA_U1); return [k.unidad, k.placa, k.vacio]; })(), ['U-1', 'TST-001', true]);
eq('corte vacío sin ficha: igual que antes (la clave y sin placa)', (() => { const k = L.cortePorUnidad([], RANGO, 'u1', OP_CORTE); return [k.unidad, k.placa]; })(), ['u1', null]);
eq('corte con ficha: la ficha manda aunque el primer renglón sea uno escrito a mano',
  (() => { const k = L.cortePorUnidad([mov({ unidadId: null, unidadTexto: 'u-1 (a mano)', placa: ' tst-001 ', tipo: 'interno', viajes: 1 }), ...U1_MOVS], RANGO, 'u1', OP_CORTE, FICHA_U1); return [k.unidad, k.placa, k.totales.internos]; })(),
  ['U-1', 'TST-001', 9]);
eq('corte con ficha sin placa: la placa sale de los renglones', (() => { const k = L.cortePorUnidad(U1_MOVS, RANGO, 'u1', OP_CORTE, { unidad: 'U-1', placa: null }); return [k.unidad, k.placa]; })(), ['U-1', 'TST-001']);
eq('corte con la ficha en blanco: el encabezado sale de los renglones', (() => { const k = L.cortePorUnidad(U1_MOVS, RANGO, 'u1', OP_CORTE, { unidad: '  ', placa: '' }); return [k.unidad, k.placa]; })(), ['U-1', 'TST-001']);

// ——— 9. Unidad dada de baja o renglón sin unidad vinculada (Review Focus 4) ———
// Un renglón de U-1 SIN unidad vinculada pero con la misma placa entra en el mismo corte.
const HUERFANO = mov({ unidadId: null, unidadTexto: 'u-1 (escrita a mano)', placa: ' tst-001 ', tipo: 'interno', fecha: '2026-10-06', viajes: 7, origen: 'Terraza 3', destino: 'Terraza 4' });
const conHuerfano = [...MOVS, HUERFANO];
eq('claveUnidadDe: con unidad vinculada es el id', L.claveUnidadDe(U1_MOVS[0]), 'u1');
// A3 (lote 2): la placa se normaliza con `clavePlaca` (sin guiones ni espacios): «tst001».
eq('claveUnidadDe: sin unidad es la placa normalizada', L.claveUnidadDe(HUERFANO), 'tst001');
eq('claveUnidadDe: sin unidad ni placa es el texto normalizado', L.claveUnidadDe(mov({ unidadTexto: 'Camión  Sin Placa ' })), 'camion sin placa');
eq('claveUnidadDe: placa en blanco no tapa el texto', L.claveUnidadDe(mov({ placa: '   ', unidadTexto: 'Volteo 5' })), 'volteo 5');
const KconHuerfano = L.cortePorUnidad(conHuerfano, RANGO, 'u1', OP_CORTE);
eq('un renglón sin vincular con la misma placa entra al corte de U-1', KconHuerfano.totales.internos, 8 + 7);
eq('…y cae en su día', KconHuerfano.dias[0].internos, 5 + 7);
eq('el corte de U-1 NO se queda con los de otra placa', L.cortePorUnidad([...MOVS, mov({ placa: 'TST-777', unidadTexto: 'Otra', tipo: 'interno', viajes: 99 })], RANGO, 'u1', OP_CORTE).totales.internos, 8);
eq('el corte por la clave del renglón sin vincular también lo encuentra', L.cortePorUnidad([HUERFANO], RANGO, L.claveUnidadDe(HUERFANO), OP_CORTE).totales.internos, 7);

// UNA sola regla de pertenencia: el listado, la tabla por unidad y el corte cuentan lo mismo.
const unidadDe = L.unidadDeLosRenglones(conHuerfano);
eq('pertenencia: un renglón vinculado es de su id', unidadDe(U1_MOVS[0]), 'u1');
eq('pertenencia: el renglón sin vincular con la placa de U-1 es de u1', unidadDe(HUERFANO), 'u1');
ok('pertenencia: perteneceAUnidad dice lo mismo', L.perteneceAUnidad(HUERFANO, 'u1', unidadDe));
eq('pertenencia: un renglón de otra unidad no es de u1', L.perteneceAUnidad(INTERNOS[0], 'u1', unidadDe), false);
eq('pertenencia: un renglón sin vincular de placa desconocida conserva su propia clave', L.unidadDeLosRenglones([...conHuerfano, mov({ placa: 'TST-777' })])(mov({ placa: ' tst-777 ' })), 'tst777');
const listadoU1 = L.filtrarMovimientos(conHuerfano, RANGO, { unidadIds: ['u1'] });
const viajesSumados = (arr, tipo) => arr.filter((m) => m.tipo === tipo && m.estado !== 'por_confirmar').reduce((s, m) => s + (m.viajes ?? 0), 0);
eq('listado filtrado por u1: también trae el renglón sin vincular (6 + 1)', listadoU1.length, 7);
eq('listado y corte de u1 cuentan los mismos internos (8 + 7)', [viajesSumados(listadoU1, 'interno'), KconHuerfano.totales.internos], [15, 15]);
eq('listado y corte de u1 cuentan las mismas salidas', [viajesSumados(listadoU1, 'salida'), KconHuerfano.totales.salidas], [2, 2]);
eq('listado y corte de u1: los mismos pendientes de salida', (() => {
  const t = L.totalesDe(listadoU1.filter((m) => m.tipo === 'salida'));
  return [[t.pendientesSinNumero, t.porConfirmarViajes], [KconHuerfano.totales.pendientesSinNumero, KconHuerfano.totales.porConfirmarViajes]];
})(), [[1, 4], [1, 4]]);
eq('tabla por unidad: el renglón sin vincular suma a U-1 (no hace fila aparte)',
  L.tablaPor(conHuerfano.filter((m) => m.tipo === 'interno'), 'unidad', 'cantidad').map((f) => [f.clave, f.viajes]),
  [['U-1', 15], ['Camión 2', 6]]);
// A1: la tabla por unidad puede recibir la regla ARMADA CON LA LISTA BASE: así un subconjunto
// ya filtrado (solo salidas) no le cambia la unidad a nadie. Acá las salidas de U-1 no traen
// placa; la que dice de quién es la placa TST-001 es su interno, que el filtro dejó afuera.
const BASE_A1 = [
  mov({ unidadId: 'u1', unidadTexto: 'U-1', placa: 'TST-001', tipo: 'interno', viajes: 5 }),
  mov({ unidadId: 'u1', unidadTexto: 'U-1', placa: null, tipo: 'salida', viajes: 2 }),
  mov({ unidadId: null, unidadTexto: 'u-1 a mano', placa: 'tst-001', tipo: 'salida', viajes: 3 }),
];
const soloSalidasA1 = L.filtrarMovimientos(BASE_A1, RANGO, { tipos: ['salida'] });
eq('A1: sin la regla de la base, el subconjunto parte a U-1 en dos filas (lo de antes, por defecto)',
  L.tablaPor(soloSalidasA1, 'unidad', 'cantidad').map((f) => [f.clave, f.viajes]), [['u-1 a mano', 3], ['U-1', 2]]);
eq('A1: con la regla de la base, la salida escrita a mano es de U-1 (una sola fila)',
  L.tablaPor(soloSalidasA1, 'unidad', 'cantidad', L.unidadDeLosRenglones(BASE_A1)).map((f) => [f.clave, f.viajes]), [['U-1', 5]]);
eq('A1: …y coincide con el corte y con el listado filtrado por u1',
  [L.cortePorUnidad(BASE_A1, RANGO, 'u1', OP_CORTE).totales.salidas, L.filtrarMovimientos(BASE_A1, RANGO, { tipos: ['salida'], unidadIds: ['u1'] }).length], [5, 2]);
eq('A1: la regla de la base no se usa en los demás ejes', L.tablaPor(soloSalidasA1, 'transportista', 'cantidad', L.unidadDeLosRenglones(BASE_A1)).map((f) => [f.clave, f.viajes]), [['Sin transportista', 5]]);
eq('pertenencia: un renglón es de UNA sola unidad (pedir la clave suelta de su placa ya no lo trae)',
  [L.filtrarMovimientos(conHuerfano, RANGO, { unidadIds: ['tst001'] }).length, L.cortePorUnidad(conHuerfano, RANGO, 'tst001', OP_CORTE).vacio], [0, true]);

// Una placa que llevan DOS unidades vinculadas no se adivina: el renglón sin vincular queda con su clave.
const PLACA_DOBLE = [
  mov({ unidadId: 'u1', unidadTexto: 'U-1', placa: 'TST-050', tipo: 'interno', viajes: 1 }),
  mov({ unidadId: 'u3', unidadTexto: 'U-3', placa: 'tst-050', tipo: 'interno', viajes: 1 }),
  mov({ unidadId: null, unidadTexto: 'a mano', placa: 'TST-050', tipo: 'interno', viajes: 9 }),
];
eq('placa de dos unidades: el renglón sin vincular conserva su propia clave', L.unidadDeLosRenglones(PLACA_DOBLE)(PLACA_DOBLE[2]), 'tst050');
eq('placa de dos unidades: ni el corte de u1 ni el de u3 se lo llevan (no se cuenta dos veces)',
  [L.cortePorUnidad(PLACA_DOBLE, RANGO, 'u1', OP_CORTE).totales.internos, L.cortePorUnidad(PLACA_DOBLE, RANGO, 'u3', OP_CORTE).totales.internos], [1, 1]);
eq('placa de dos unidades: la tabla por unidad le da su propia fila',
  L.tablaPor(PLACA_DOBLE, 'unidad', 'cantidad').map((f) => [f.clave, f.viajes]), [['a mano', 9], ['U-1', 1], ['U-3', 1]]);

// Unidad dada de baja: el lib no sabe de altas/bajas, así que sus renglones siguen saliendo con su texto.
const DE_BAJA = [
  mov({ unidadId: 'u-baja', unidadTexto: 'U-5 (vendida)', placa: 'TST-005', tipo: 'interno', viajes: 3, fecha: '2026-10-08', origen: 'Terraza 1', destino: 'Terraza 2' }),
  mov({ unidadId: null, unidadTexto: 'Camión sin placa', placa: null, tipo: 'salida', viajes: 2, fecha: '2026-10-08', destino: 'Destino Q' }),
];
eq('listado: los renglones de una unidad dada de baja siguen saliendo', L.filtrarMovimientos(DE_BAJA, RANGO).length, 2);
eq('corte: una unidad dada de baja sigue con su texto congelado', (() => { const k = L.cortePorUnidad(DE_BAJA, RANGO, 'u-baja', OP_CORTE); return [k.unidad, k.placa, k.totales.internos]; })(), ['U-5 (vendida)', 'TST-005', 3]);
eq('corte: un renglón sin unidad ni placa se corta por su texto', (() => { const k = L.cortePorUnidad(DE_BAJA, RANGO, L.claveUnidadDe(DE_BAJA[1]), OP_CORTE); return [k.unidad, k.placa, k.destinos, k.totales.salidas]; })(), ['Camión sin placa', null, ['Destino Q'], 2]);
eq('tabla por unidad: la unidad de baja y la sin vincular salen con su texto', L.tablaPor(DE_BAJA, 'unidad', 'cantidad').map((f) => f.clave), ['U-5 (vendida)', 'Camión sin placa']);

// ——— 10. Período sin registros (Review Focus 3) y mismo nombre escrito distinto (Review Focus 5) ———
const CV = L.consolidadoSitio([], 'cantidad');
eq('consolidado vacío: vacio = true', CV.vacio, true);
eq('consolidado vacío: promedio null (no 0, no NaN)', CV.totales.promedioTonViaje, null);
eq('consolidado vacío: totales en cero', [CV.totales.viajes, CV.totales.toneladas, CV.totales.m3, CV.totales.renglones, CV.totales.pendientesSinNumero, CV.totales.porConfirmarViajes], [0, 0, 0, 0, 0, 0]);
eq('consolidado vacío: tablas y textos vacíos', [CV.porTransportista, CV.porOrigen, CV.internos, CV.salidas, CV.textoSalidas], [[], [], [], [], []]);
eq('consolidado vacío: pendientes de internos y de salidas en cero', [CV.pendientesInternos, CV.pendientesSalidas], [SIN_PEND, SIN_PEND]);
ok('consolidado vacío: sin NaN en ningún campo', !hayNaN(CV));
eq('consolidado de puros «otro»: también vacío (nada que mostrar)', L.consolidadoSitio([mov({ tipo: 'otro' })], 'az').vacio, true);
eq('consolidado de un solo interno: ya no está vacío', L.consolidadoSitio(INTERNOS, 'az').vacio, false);
const TV = L.totalesDe([]);
ok('totales vacíos: sin NaN y promedio null', !hayNaN(TV) && TV.promedioTonViaje === null);
const KV = L.cortePorUnidad([], RANGO, 'u1', OP_CORTE);
eq('corte vacío: vacio = true, pero los días salen en cero', [KV.vacio, KV.dias.length, KV.diasEvaluados], [true, 4, 4]);
eq('corte vacío: totales en cero y sin destinos', [KV.totales, KV.destinos], [{ internos: 0, salidas: 0, total: 0, pendientesSinNumero: 0, porConfirmarViajes: 0 }, []]);
eq('corte vacío: la unidad lleva al menos la clave pedida', [KV.unidad, KV.placa], ['u1', null]);
ok('corte vacío: sin NaN', !hayNaN(KV));
eq('corte vacío escondiendo días: ni una fila', L.cortePorUnidad([], RANGO, 'u1', { columnasPorDestino: true, diasSinAnotacion: 'ocultar' }).dias, []);
eq('corte con rango al revés: sin días, sin romperse', L.cortePorUnidad(MOVS, { desde: '2026-10-09', hasta: '2026-10-06' }, 'u1', OP_CORTE).dias, []);
eq('corte con fechas basura: sin días, sin romperse', L.cortePorUnidad(MOVS, { desde: 'hoy', hasta: 'mañana' }, 'u1', OP_CORTE).dias, []);

// El mismo nombre escrito distinto se junta, con la primera forma escrita.
const primeraForma = L.tablaPor([mov({ transportista: ' transportista a ' }), mov({ transportista: 'Transportista A' })], 'transportista', 'az');
eq('mismo nombre escrito distinto: una sola fila con la primera forma (limpia de espacios)', primeraForma.map((f) => [f.clave, f.viajes]), [['transportista a', 2]]);
eq('mismo nombre, con tilde y mayúsculas distintas', L.tablaPor([mov({ origen: 'Frente Río' }), mov({ origen: 'FRENTE RIO' })], 'origen', 'az').length, 1);
eq('mismo nombre con espacios dobles por dentro', L.tablaPor([mov({ origen: 'Frente  Norte' }), mov({ origen: 'frente norte' })], 'origen', 'az').length, 1);

// ——— 10b. Lo que la librería les da a los papeles (auditoría de los papeles, lote 3) ———
// A2 = B1: el corte de madrugada. «05:00» del 22 es el 23 a las 05:00 (la jornada va de
// 7am a 7am): el rótulo dice el día REAL, el mismo instante que suma `enRango`.
const MADRUGADA = { desde: '2026-10-20', hasta: '2026-10-22', corteHora: '05:00' };
eq('⭐ A2: corteCop con 05:00 dice el día real (el siguiente al «hasta»)', L.corteCop?.(MADRUGADA), '23/10/2026, 05:00 a. m.');
eq('A2: corteCop con 06:59 también es del día siguiente', L.corteCop?.({ ...MADRUGADA, corteHora: '06:59' }), '23/10/2026, 06:59 a. m.');
// ⭐ R33 (revisión final, 25-oct-2026; antes esta prueba fijaba lo contrario): un corte a las
//    07:00 EN PUNTO CIERRA la jornada «hasta» (como el Reporte General, R28): es el día
//    siguiente a las 07:00. Antes decía el 22 y sumaba otra cosa: un minuto (06:59 contra
//    07:00) movía el papel 24 horas.
eq('⭐ R33: corteCop con 07:00 cierra la jornada «hasta»: es el día siguiente', L.corteCop?.({ ...MADRUGADA, corteHora: '07:00' }), '23/10/2026, 07:00 a. m.');
eq('R33: corteCop con 07:00:00 (como Postgres) también', L.corteCop?.({ ...MADRUGADA, corteHora: '07:00:00' }), '23/10/2026, 07:00 a. m.');
eq('R33: corteCop con 07:01 ya es del mismo «hasta» (la jornada siguiente empezó)', L.corteCop?.({ ...MADRUGADA, corteHora: '07:01' }), '22/10/2026, 07:01 a. m.');
eq('A2: corteCop con 19:00 (como Postgres: «19:00:00»)', L.corteCop?.({ ...RANGO, corteHora: '19:00:00' }), '09/10/2026, 07:00 p. m.');
eq('A2: corteCop a mediodía y a medianoche', [L.corteCop?.({ ...RANGO, corteHora: '12:30' }), L.corteCop?.({ ...RANGO, corteHora: '00:15' })], ['09/10/2026, 12:30 p. m.', '10/10/2026, 12:15 a. m.']);
eq('A2: corteCop sin hora (o con una que no se entiende): la jornada «hasta»', [L.corteCop?.(RANGO), L.corteCop?.({ ...RANGO, corteHora: '25:00' })], ['09/10/2026', '09/10/2026']);
ok('A2: lo que el rótulo dice es lo que se sumó (el 22 a las 04:30 entra; el 23 a las 05:30 no)',
  L.enRango(mov({ fecha: '2026-10-22', hora: '04:30' }), MADRUGADA) && !L.enRango(mov({ fecha: '2026-10-23', hora: '05:30' }), MADRUGADA));

// A1 = B11 = B12: lo oculto no deja rastro. Con una columna apagada, el papel pide a la
// librería el texto de salidas sin ese dato y las filas JUNTADAS por lo que se ve (si no,
// dos filas «Arena · Destino Y» iguales a la vista parecen un viaje contado dos veces).
const A1_MOVS = [
  mov({ tipo: 'interno', origen: 'Terraza 1', destino: 'Terraza 2', capacidadM3: 18, viajes: 5 }),
  mov({ tipo: 'interno', origen: 'Terraza 1', destino: 'Terraza 2', capacidadM3: 24, viajes: 3 }),
  mov({ tipo: 'salida', material: 'Arena', destino: 'Destino Y', capacidadM3: 18, viajes: 3, toneladas: 60 }),
  mov({ tipo: 'salida', material: 'Arena', destino: 'Destino Y', capacidadM3: 18, viajes: 2, estado: 'esperando_pesaje' }),
  mov({ tipo: 'salida', material: 'Triturado', destino: 'Destino X', capacidadM3: 18, viajes: 2 }),
  mov({ tipo: 'salida', material: 'Triturado', destino: 'Destino X', capacidadM3: 24, viajes: 3 }),
];
const A1C = L.consolidadoSitio(A1_MOVS, 'cantidad');
eq('A1: el texto de salidas con todo a la vista', A1C.textoSalidas,
  ['Arena → Destino Y: 5 viajes de 18 m³ = 90 m³ (2 esperando pesaje)', 'Triturado → Destino X: 5 viajes (2 de 18 m³ y 3 de 24 m³) = 108 m³']);
eq('A1: textoSalidasDe con todo a la vista es el mismo del modelo', L.textoSalidasDe?.(A1C.salidas, 'cantidad'), A1C.textoSalidas);
eq('⭐ A1: sin m³, el texto no dice m³ despachados (la capacidad sigue: es otra columna)', L.textoSalidasDe?.(A1C.salidas, 'cantidad', { m3: false }),
  ['Arena → Destino Y: 5 viajes de 18 m³ (2 esperando pesaje)', 'Triturado → Destino X: 5 viajes (2 de 18 m³ y 3 de 24 m³)']);
eq('⭐ A1: sin capacidad, sin el desglose «de 18 m³» (los m³ sin cuenta)', L.textoSalidasDe?.(A1C.salidas, 'cantidad', { capacidad: false }),
  ['Arena → Destino Y: 5 viajes · 90 m³ (2 esperando pesaje)', 'Triturado → Destino X: 5 viajes · 108 m³']);
eq('⭐ A1: sin estado, sin «(esperando pesaje)»', L.textoSalidasDe?.(A1C.salidas, 'cantidad', { estado: false }),
  ['Arena → Destino Y: 5 viajes de 18 m³ = 90 m³', 'Triturado → Destino X: 5 viajes (2 de 18 m³ y 3 de 24 m³) = 108 m³']);
eq('A1: sin las tres, solo los viajes', L.textoSalidasDe?.(A1C.salidas, 'cantidad', { m3: false, capacidad: false, estado: false }),
  ['Arena → Destino Y: 5 viajes', 'Triturado → Destino X: 5 viajes']);
eq('A1: textoSalidasDe en orden A→Z', L.textoSalidasDe?.(A1C.salidas.slice().reverse(), 'az', { m3: false, capacidad: false, estado: false }),
  ['Arena → Destino Y: 5 viajes', 'Triturado → Destino X: 5 viajes']);
const juntar = (ver) => L.juntarFilasVisibles?.(A1C, 'cantidad', ver) || { internos: [], salidas: [] };
eq('A1: juntarFilasVisibles con todo a la vista deja las filas como están', juntar({}), { internos: A1C.internos, salidas: A1C.salidas });
eq('⭐ A1: sin capacidad, el mismo recorrido es UNA fila (con la suma)', juntar({ capacidad: false }).internos,
  [{ origen: 'Terraza 1', destino: 'Terraza 2', capacidadM3: null, viajes: 8, m3: 162 }]);
eq('⭐ A1: sin capacidad, las salidas se juntan por material, destino y estado', juntar({ capacidad: false }).salidas.map((s) => [s.material, s.estado, s.viajes, s.capacidadM3, s.m3]),
  [['Triturado', 'confirmado', 5, null, 108], ['Arena', 'confirmado', 3, 18, 54], ['Arena', 'esperando_pesaje', 2, 18, 36]]);
eq('⭐ A1: sin estado, confirmada + esperando pesaje del mismo material, destino y capacidad son UNA fila (confirmada; toneladas solo de lo pesado)',
  juntar({ estado: false }).salidas.map((s) => [s.material, s.estado, s.viajes, s.capacidadM3, s.toneladas]),
  [['Arena', 'confirmado', 5, 18, 60], ['Triturado', 'confirmado', 3, 24, 0], ['Triturado', 'confirmado', 2, 18, 0]]);
eq('A1: sin capacidad ni estado, una fila por material y destino', juntar({ capacidad: false, estado: false }).salidas.map((s) => [s.material, s.viajes]), [['Arena', 5], ['Triturado', 5]]);
// A8: el corte RECIBE la regla de pertenencia armada con la lista base (dentro de su op),
// igual que la tabla y el listado: así se le pueden pasar renglones ya filtrados.
const BASE_A8 = [
  mov({ ...U1, tipo: 'interno', fecha: '2026-10-06', viajes: 5 }),
  mov({ unidadId: null, unidadTexto: 'u-1 a mano', placa: 'tst-001', tipo: 'salida', fecha: '2026-10-06', destino: 'Destino Z', viajes: 3 }),
];
const SOLO_SALIDAS_A8 = BASE_A8.filter((m) => m.tipo === 'salida');
eq('A8: sin la regla, el corte armado con un subconjunto no ve de quién es la placa (lo de siempre, por defecto)', L.cortePorUnidad(SOLO_SALIDAS_A8, RANGO, 'u1', OP_CORTE).totales.salidas, 0);
eq('⭐ A8: con `unidadDe` (armada con la base) en el op, la salida escrita a mano es de u1, como en el listado',
  L.cortePorUnidad(SOLO_SALIDAS_A8, RANGO, 'u1', { ...OP_CORTE, unidadDe: L.unidadDeLosRenglones(BASE_A8) }).totales.salidas, 3);
eq('A8: con la base completa da lo mismo con o sin la regla', [L.cortePorUnidad(BASE_A8, RANGO, 'u1', OP_CORTE).totales, L.cortePorUnidad(BASE_A8, RANGO, 'u1', { ...OP_CORTE, unidadDe: L.unidadDeLosRenglones(BASE_A8) }).totales].map((t) => t.total), [8, 8]);

// R2: la hoja de una unidad suelta que solo trae placa se llama por lo que ella ESCRIBIÓ (la
// placa), no por la clave normalizada (en minúsculas).
const SOLO_PLACA = [mov({ unidadId: null, unidadTexto: '', placa: 'TST-009', tipo: 'interno', fecha: '2026-10-06', viajes: 2 })];
const K_SOLO_PLACA = L.cortePorUnidad(SOLO_PLACA, RANGO, L.unidadDeLosRenglones(SOLO_PLACA)(SOLO_PLACA[0]), OP_CORTE);
eq('⭐ R2: la hoja de una unidad con solo placa se llama por la placa escrita', [K_SOLO_PLACA.unidad, K_SOLO_PLACA.placa], ['TST-009', 'TST-009']);
eq('R2: con texto, la hoja sigue llamándose por el texto', L.cortePorUnidad(MOVS, RANGO, 'u1', OP_CORTE).unidad, 'U-1');

// R1: el modelo del corte dice si sus salidas van por destino (el papel arma el encabezado con eso).
eq('R1: ModeloCorte.porDestino sigue al op con que se armó', [L.cortePorUnidad(MOVS, RANGO, 'u1', OP_CORTE).porDestino, L.cortePorUnidad(MOVS, RANGO, 'u1', { columnasPorDestino: false, diasSinAnotacion: 'cero' }).porDestino], [true, false]);
eq('A1: lo juntado solo de lo que espera pesaje sigue «esperando pesaje»',
  L.juntarFilasVisibles?.(L.consolidadoSitio([mov({ tipo: 'salida', material: 'Arena', capacidadM3: 18, viajes: 1, estado: 'esperando_pesaje' }), mov({ tipo: 'salida', material: 'Arena', capacidadM3: 24, viajes: 1, estado: 'esperando_pesaje' })], 'az'), 'az', { capacidad: false })?.salidas.map((s) => s.estado), ['esperando_pesaje']);

// ——— 11. La librería es PURA ———
const srcLib = fs.readFileSync(SRC_LIB, 'utf8');
const importos = [...srcLib.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((x) => x[1]);
ok('pura: solo importa de ./text y ./numeros', importos.length > 0 && importos.every((i) => i === './text' || i === './numeros'));
ok('pura: ni supabase, ni react, ni AsyncStorage', !/supabase|react|AsyncStorage|from\s+['"]expo/i.test(importos.join(' ')));
ok('pura: sin require() escondidos', !/require\(/.test(srcLib));
ok('pura: no escribe en ninguna base (sin insert/update/delete/rpc)', !/\.(insert|update|delete|upsert|rpc)\(/.test(srcLib));
ok('pura: no usa la hora del equipo (new Date() sin argumentos ni Date.now)', !/new Date\(\s*\)|Date\.now\(/.test(srcLib));

// ——— 12. La auditoría de pantallas y datos (lote 2) ———
// A3: UNA sola regla para comparar placas. La carga (placa que se vincula sola), la
// pertenencia a la unidad y la placa repetida de 🚛 Flota usan TODAS `clavePlaca`.
eq('⭐ A3: clavePlaca: sin tildes, mayúsculas, espacios, guiones, puntos ni barras',
  ['A12-BC', ' a12 bc ', 'A12/BC', 'Á12.BC', 'a12bc'].map((p) => L.clavePlaca?.(p)), ['a12bc', 'a12bc', 'a12bc', 'a12bc', 'a12bc']);
eq('A3: clavePlaca: vacío, null o puros signos → «»', [' - ', '', null, undefined].map((p) => L.clavePlaca?.(p)), ['', '', '', '']);
eq('A3: clavePlaca: la ñ es una letra (no se pierde)', L.clavePlaca?.('Ñ-01'), 'ñ01');
// El caso del auditor: un renglón vinculado a u2 con «A12BC» y otro suelto con «A12-BC».
const A3_BASE = [
  mov({ unidadId: 'u2', unidadTexto: 'V-01', placa: 'A12BC', tipo: 'interno' }),
  mov({ unidadId: null, unidadTexto: 'a mano', placa: 'A12-BC', tipo: 'interno' }),
];
eq('⭐ A3: el suelto «A12-BC» es de la unidad vinculada con «A12BC» (antes salía como otra unidad)',
  L.unidadDeLosRenglones(A3_BASE)(A3_BASE[1]), 'u2');
const A3_REVES = [
  mov({ unidadId: 'u2', unidadTexto: 'V-01', placa: 'A12-BC', tipo: 'interno' }),
  mov({ unidadId: null, unidadTexto: 'a mano', placa: ' a12 bc ', tipo: 'interno' }),
];
eq('⭐ A3: …y al revés (vinculado «A12-BC», suelto « a12 bc »)', L.unidadDeLosRenglones(A3_REVES)(A3_REVES[1]), 'u2');
eq('A3: el filtro por u2 trae a los dos renglones', L.filtrarMovimientos(A3_BASE, RANGO, { unidadIds: ['u2'] }).length, 2);
eq('A3: el corte de u2 cuenta a los dos', L.cortePorUnidad(A3_BASE, RANGO, 'u2', OP_CORTE).totales.internos, 2);
eq('A3: la clave propia de un suelto usa la misma regla', L.claveUnidadDe(mov({ placa: ' A12-BC ', unidadTexto: 'x' })), 'a12bc');

// A11: el orden de una lista respeta la JORNADA de 7am a 7am: la madrugada (antes de las
// 07:00) va DESPUÉS de las 23:00 de su fecha; lo que no tiene hora va al final de su jornada
// (entre ellos, por el momento en que se cargó).
{
  const j = (id, fecha, hora, creadoAt = null) => mov({ id, fecha, hora, creadoAt });
  const lista = [
    j('sinHora2', '2026-10-06', null, '2026-10-06T15:00:00Z'),
    j('h0500', '2026-10-06', '05:00:00'),
    j('dia7', '2026-10-07', '08:00'),
    j('h2300', '2026-10-06', '23:00'),
    j('sinHora1', '2026-10-06', null, '2026-10-06T09:00:00Z'),
    j('h0800', '2026-10-06', '08:00'),
    j('dia5', '2026-10-05', '06:59'),
  ];
  const orden = typeof L.cmpMovimientoJornada === 'function' ? [...lista].sort(L.cmpMovimientoJornada).map((m) => m.id) : 'falta cmpMovimientoJornada';
  eq('⭐ A11: orden de jornada: 08:00, 23:00, la madrugada 05:00 y al final lo sin hora (por carga)', orden,
    ['dia5', 'h0800', 'h2300', 'h0500', 'sinHora1', 'sinHora2', 'dia7']);
  eq('A11: es un orden total y estable (empate → por id)', typeof L.cmpMovimientoJornada === 'function'
    ? [L.cmpMovimientoJornada(j('x', '2026-10-06', null), j('y', '2026-10-06', null)) < 0, L.cmpMovimientoJornada(j('x', '2026-10-06', '08:00'), j('x', '2026-10-06', '08:00'))]
    : 'falta', [true, 0]);
}

// ——— PD1. La PRODUCCIÓN (bloques de la cantera) no suma a viajes, toneladas ni m³ ———
// Un renglón tipo 'produccion' se cuenta en PIEZAS (`cantidad`), aparte. Aunque traiga
// viajes, toneladas o m³ escritos (no debería), ningún total, tabla, consolidado ni
// corte los suma: los papeles de entradas y salidas quedan IGUAL con o sin producción.
{
  const PROD = [
    mov({ tipo: 'produccion', material: 'Bloques', cantidad: 120, viajes: 5, toneladas: 30, m3: 12, capacidadM3: 6,
      ...U1, transportista: 'Transportista A', origen: 'Frente 1', destino: 'Destino X', fecha: '2026-10-07',
      disponibleDesde: '2026-10-14', unidadIngresada: 'u' }),
    mov({ tipo: 'produccion', material: 'Bloques', cantidad: 80, viajes: null, fecha: '2026-10-08' }),
    mov({ tipo: 'produccion', material: 'Bloques', cantidad: null, viajes: 2, estado: 'por_confirmar', fecha: '2026-10-08' }),
  ];
  const CON_PROD = [...MOVS, ...PROD];
  const cifras = (t) => [t.viajes, t.toneladas, t.m3, t.promedioTonViaje, t.pendientesSinNumero, t.porConfirmarViajes];
  eq('⭐ PD1: totalesDe no suma viajes, toneladas ni m³ de la producción (ni sus «por confirmar»)',
    cifras(L.totalesDe(CON_PROD)), cifras(L.totalesDe(MOVS)));
  eq('PD1: …pero sus renglones sí se cuentan (salen en el listado)', L.totalesDe(CON_PROD).renglones, MOVS.length + PROD.length);
  eq('PD1: solo producción → todo en cero, sin promedio', cifras(L.totalesDe(PROD)), [0, 0, 0, null, 0, 0]);
  for (const eje of ['transportista', 'origen', 'destino', 'material', 'unidad']) {
    eq(`⭐ PD1: tablaPor(«${eje}») no muestra la producción`, L.tablaPor(CON_PROD, eje, 'az'), L.tablaPor(MOVS, eje, 'az'));
  }
  eq('PD1: tablaPor de pura producción → sin filas', L.tablaPor(PROD, 'material', 'cantidad'), []);
  eq('⭐ PD1: el consolidado del sitio sale igual con o sin producción',
    L.consolidadoSitio(CON_PROD, 'cantidad'), L.consolidadoSitio(MOVS, 'cantidad'));
  eq('PD1: pura producción → el consolidado está vacío («Sin registros»)', L.consolidadoSitio(PROD, 'cantidad').vacio, true);
  eq('⭐ PD1: el corte de U-1 no cuenta su producción',
    L.cortePorUnidad(CON_PROD, RANGO, 'u1', OP_CORTE), L.cortePorUnidad(MOVS, RANGO, 'u1', OP_CORTE));
  eq('PD1: …tampoco con los días vacíos escondidos (el día de la producción no aparece)',
    L.cortePorUnidad(CON_PROD, RANGO, 'u1', { ...OP_CORTE, diasSinAnotacion: 'ocultar' }),
    L.cortePorUnidad(MOVS, RANGO, 'u1', { ...OP_CORTE, diasSinAnotacion: 'ocultar' }));
  eq('PD1: el filtro por tipo sí la encuentra (para el listado y los bloques)',
    L.filtrarMovimientos(CON_PROD, RANGO, { tipos: ['produccion'] }).length, PROD.length);
}

// ——— PD5b (auditoría del lote 5, A4). Las VENTAS EN PIEZAS (bloques) no son viajes ———
// Una venta de bloques es una salida con `cantidad` (piezas) y SIN viajes. El consolidado
// del sitio no la mete en su tabla de viajes («Bloques → Cliente X: 0 viajes»): va en la
// sección 7 del 📄 Reporte completo. Una salida con viajes sigue siendo un viaje.
{
  const VENTAS = [
    mov({ tipo: 'salida', material: 'Bloques', cantidad: 40, viajes: null, unidadIngresada: 'u', destino: 'Cliente Prueba', fecha: '2026-10-07' }),
    // Una venta vieja sin cantidad, pero escrita en piezas: tampoco es un viaje.
    mov({ tipo: 'salida', material: 'Bloques', cantidad: null, viajes: null, unidadIngresada: 'u', fecha: '2026-10-08' }),
  ];
  ok('⭐ PD5b: exporta esVentaEnPiezas()', typeof L.esVentaEnPiezas === 'function');
  const esVenta = (m) => (typeof L.esVentaEnPiezas === 'function' ? L.esVentaEnPiezas(m) : null);
  eq('PD5b: la venta de bloques (cantidad, sin viajes) es una venta en piezas', VENTAS.map(esVenta), [true, true]);
  eq('PD5b: una salida con viajes NO lo es (aunque traiga cantidad); tampoco un por confirmar sin número ni una producción', [
    esVenta(mov({ tipo: 'salida', material: 'Bloques', cantidad: 40, viajes: 1, unidadIngresada: 'u' })),
    esVenta(mov({ tipo: 'salida', material: 'Triturado', viajes: null, estado: 'por_confirmar' })),
    esVenta(mov({ tipo: 'produccion', material: 'Bloques', cantidad: 40, viajes: null, unidadIngresada: 'u' })),
    esVenta(mov({ tipo: 'entrada', cantidad: 3, viajes: null })),
  ], [false, false, false, false]);
  const CON_VENTAS = [...MOVS, ...VENTAS];
  eq('⭐ PD5b: el consolidado del sitio sale IGUAL con o sin ventas de bloques (ni «Bloques → …: 0 viajes»)',
    L.consolidadoSitio(CON_VENTAS, 'cantidad'), L.consolidadoSitio(MOVS, 'cantidad'));
  const soloVentas = L.consolidadoSitio(VENTAS, 'cantidad');
  eq('PD5b: puras ventas de bloques → sin salidas de viajes, sin pendientes y vacío', [soloVentas.salidas.length, soloVentas.textoSalidas.length, soloVentas.pendientesSalidas, soloVentas.vacio],
    [0, 0, { pendientesSinNumero: 0, porConfirmarViajes: 0 }, true]);
  eq('PD5b: una venta por confirmar sin viajes tampoco se avisa como viaje pendiente',
    L.consolidadoSitio([mov({ tipo: 'salida', material: 'Bloques', cantidad: 5, viajes: null, unidadIngresada: 'u', estado: 'por_confirmar' })], 'cantidad').pendientesSalidas,
    { pendientesSinNumero: 0, porConfirmarViajes: 0 });
}

// ——— L5-A1. LA regla de «fila de patio» (una sola: la usan la Db, la pantalla y el Reporte completo) ———
{
  const patio = (o = {}) => mov({ destino: 'Patio A', destinoId: 'pa', viajes: 12, ...o });
  ok('⭐ L5-A1: una entrada pelada hacia un patio es fila de patio', L.esRenglonDePatio(patio()) === true);
  ok('L5-A1: * con la unidad en blanco o con espacios también (se recorta)', L.esRenglonDePatio(patio({ unidadTexto: '   ' })) === true);
  ok('L5-A1: * con viajes por confirmar también', L.esRenglonDePatio(patio({ viajes: null, estado: 'por_confirmar' })) === true);
  for (const [nombre, o] of [
    ['transportista', { transportista: 'Transportista Uno' }],
    ['origen', { origen: 'Frente Norte' }],
    ['unidad vinculada', { unidadId: 'u1' }],
    ['⭐ unidad escrita a mano (Carga libre)', { unidadTexto: 'U-07' }],
    ['placa', { placa: 'AA000AA' }],
    ['material', { material: 'Material X' }],
    ['⭐ toneladas (una pesada)', { toneladas: 14 }],
    ['m³', { m3: 10 }],
    ['hora', { hora: '08:15' }],
    ['observación', { observacion: 'Nota sintética' }],
    ['capacidad', { capacidadM3: 12 }],
  ]) ok(`L5-A1: con ${nombre} ya NO es fila de patio (es de ✍️ Carga libre)`, L.esRenglonDePatio(patio(o)) === false);
  ok('L5-A1: una salida no es fila de patio', L.esRenglonDePatio(patio({ tipo: 'salida' })) === false);
  ok('L5-A1: una producción tampoco', L.esRenglonDePatio(patio({ tipo: 'produccion' })) === false);
  ok('L5-A1: sin renglón no revienta', L.esRenglonDePatio(null) === false && L.esRenglonDePatio(undefined) === false);
}

// ——— Cierre ———
// (las tareas siguientes agregan sus bloques numerados justo ARRIBA de esta línea)
console.log(`\n${fail === 0 ? '✅' : '❌'} test-centro-operaciones · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.map((f) => `  ✗ ${f}`).join('\n')); process.exit(1); }
