/*
 * ⚖️ COSTO DE MAQUINARIA POR TONELADA Y HORA PROMEDIO (21-oct-2026, a pedido).
 *
 * Pedido del jefe, con su ejemplo textual: «yo agarro 25 máquinas que tuve en
 * los cinco frentes… $25.000 entre 2.000 toneladas que movió el acarreo, me
 * salió a $12,5 la tonelada puesta en el CET». Y la hora: «fueron 280 horas,
 * la hora me salió a 89, no a 100».
 *
 * LO QUE FIJA, Y POR QUÉ DUELE SI SE ROMPE (este número decide si la operación
 * se sostiene o asusta — palabras del jefe):
 *  · EL COSTO ES LA MAQUINARIA (jornadas + horómetros); los viajes y el peso
 *    son el ACARREO: el divisor, nunca el dividendo. Mezclar lados infla o
 *    desinfla el $/t sin que nadie lo note.
 *  · LAS TONELADAS SON LAS DEL PESO DE ROMANA de TODOS los viajes del rango —
 *    la misma regla del informe operativo: el viaje sin pesar cuenta, suma 0 t
 *    y se dice cuántos fueron. Inventarle carga a un viaje sin romana es
 *    inventar plata por tonelada.
 *  · POR FRENTE: el costo va por el frente vigente de la MÁQUINA y las
 *    toneladas por el frente congelado del VIAJE, cruzados por nombre SIN
 *    distinguir mayúsculas (un lado viene del catálogo, el otro quedó escrito).
 *  · SIN DIVISIÓN NO HAY NÚMERO: 0 toneladas → null (se dice), nunca un $0 ni
 *    un infinito.
 *
 *   node scripts/test-costo-por-tonelada.mjs
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
const compilar = (p) => {
  if (cache.has(p)) return cache.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cache.set(p, m.exports);
  m._compile(js, m.filename);
  cache.set(p, m.exports);
  return m.exports;
};
const realLoad = Module._load;
Module._load = function (req, parent) {
  if (req.startsWith('.') && parent && String(parent.filename || '').endsWith('.ts')) {
    const cand = path.resolve(path.dirname(parent.filename), req);
    for (const p of [cand, cand + '.ts', path.join(cand, 'index.ts')]) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return compilar(p);
    }
  }
  return realLoad.apply(this, arguments);
};

const C = compilar(path.join(ROOT, 'src/lib/reporteConsolidado.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const OP = C.OPCIONES_CONSOLIDADO_POR_DEFECTO;

// ── 1) EL EJEMPLO DEL JEFE, TAL CUAL ─────────────────────────────────────────
// $25.000 de maquinaria (jornadas+horómetros) y 2.000 t del acarreo → $12,50/t.
// Las 280 h → $89,29/h (y no los $100 del 100% teórico).
{
  const filas = [
    { id: 'a', code: 'JUMBO 1', placa: '', empresa: 'ALFA', frente: 'TFI', montos: { jornadas: 15000 }, cant: { jornadas: 170 } },
    { id: 'b', code: 'PAYLOADER 1', placa: '', empresa: 'ALFA', frente: 'CET', montos: { horometros: 10000 }, cant: { horometros: 110 } },
  ];
  const viajes = [
    { frente_nombre: 'TFI', peso_neto_kg: 1200000 },
    { frente_nombre: 'CET', peso_neto_kg: 800000 },
  ];
  const r = C.costoPorTonelada(filas, OP, viajes);
  eq('⭐ el ejemplo del jefe: $25.000 ÷ 2.000 t = $12,50/t', r.usdPorTon, 12.5);
  eq('⭐ y la hora: $25.000 ÷ 280 h = $89,29/h', r.usdPorHora, 89.29);
  eq('* el costo es SOLO maquinaria', r.costo, 25000);
  eq('* las toneladas son las de romana', r.toneladas, 2000);
  eq('* los viajes contados', [r.viajes, r.sinPeso], [2, 0]);
}

// ── 2) EL ACARREO NO ES COSTO; LO OCULTO NO EXISTE ───────────────────────────
{
  const filas = [
    { id: 'a', code: 'M', placa: '', empresa: 'A', montos: { jornadas: 1000, viajes: 999, peso: 999 }, cant: { jornadas: 10, viajes: 5, peso: 7000 } },
  ];
  const r = C.costoPorTonelada(filas, OP, [{ peso_neto_kg: 100000 }]);
  eq('⭐ viajes y peso NO entran al costo (son el acarreo)', r.costo, 1000);
  eq('* ni sus cantidades a las horas', r.horas, 10);
  // Fuente de maquinaria OCULTA: no existe (regla de la casa) → cae a la jornada.
  const opSinHoro = { ...OP, fuentes: { ...OP.fuentes, horometros: 'oculta' } };
  const filas2 = [
    { id: 'a', code: 'M', placa: '', empresa: 'A', montos: { jornadas: 1000, horometros: 500 }, cant: { jornadas: 10, horometros: 5 } },
  ];
  const r2 = C.costoPorTonelada(filas2, opSinHoro, [{ peso_neto_kg: 100000 }]);
  eq('⭐ con horómetros OCULTOS la máquina vale por su jornada', [r2.costo, r2.horas], [1000, 10]);
}

// ── 2b) UNO U OTRO, NUNCA LA SUMA (aclaración del jefe, 21-oct) ──────────────
// «Jornada dice 12, horómetro dice 11,5: el sistema toma el horómetro, que es
// el confiable; si no tiene horómetro, toma la jornada.»
{
  const conAmbos = [
    { id: 'a', code: 'JUMBO 1', placa: '', empresa: 'A', montos: { jornadas: 1200, horometros: 1150 }, cant: { jornadas: 12, horometros: 11.5 } },
  ];
  const r = C.costoPorTonelada(conAmbos, OP, [{ peso_neto_kg: 100000 }]);
  eq('⭐ con AMBOS manda el horómetro (nunca 1200+1150)', [r.costo, r.horas], [1150, 11.5]);
  // En «muestra» (ref) el horómetro se ve → sigue mandando (visible = existe).
  const opRef = { ...OP, fuentes: { ...OP.fuentes, horometros: 'muestra' } };
  const r2 = C.costoPorTonelada(conAmbos, opRef, [{ peso_neto_kg: 100000 }]);
  eq('* en «muestra» el horómetro sigue mandando', [r2.costo, r2.horas], [1150, 11.5]);
  // Sin horómetro, vale la jornada — cada máquina decide por SU información.
  const mixtas = [
    { id: 'a', code: 'JUMBO 1', placa: '', empresa: 'A', montos: { jornadas: 1200, horometros: 1150 }, cant: { jornadas: 12, horometros: 11.5 } },
    { id: 'b', code: 'PAYLOADER 2', placa: '', empresa: 'A', montos: { jornadas: 800 }, cant: { jornadas: 8 } },
  ];
  const r3 = C.costoPorTonelada(mixtas, OP, [{ peso_neto_kg: 100000 }]);
  eq('⭐ cada máquina decide por su información (1150 + 800, no 3150)', [r3.costo, r3.horas], [1950, 19.5]);
}

// ── 2c) EL CAMIÓN A JORNADA ES ACARREO, NO MAQUINARIA ────────────────────────
// «Algunos camiones no los llevan ni por peso ni por viajes, tienen jornadas…
// sería la jornada de acarreo»: su plata NO infla el costo por tonelada, pero
// se cuenta y se dice aparte.
{
  const filas = [
    { id: 'a', code: 'JUMBO 1', placa: '', empresa: 'A', montos: { jornadas: 1000 }, cant: { jornadas: 10 } },
    { id: 'b', code: 'CAMION VOLTEO TORONTO', placa: '', empresa: 'A', montos: { jornadas: 700 }, cant: { jornadas: 7 } },
    { id: 'c', code: 'CHUTO CON VOLQUETA', placa: '', empresa: 'A', montos: { jornadas: 300 }, cant: { jornadas: 3 } },
  ];
  const r = C.costoPorTonelada(filas, OP, [{ peso_neto_kg: 1000000 }]);
  eq('⭐ las jornadas de camión NO entran al costo de maquinaria', r.costo, 1000);
  eq('* ni sus horas', r.horas, 10);
  eq('⭐ pero se cuentan como jornada de ACARREO, con su plata', [r.camionesJornada, r.acarreoJornada], [2, 1000]);
  eq('* y el $/t sale solo de la maquinaria', r.usdPorTon, 1);
}

// ── 3) VIAJES SIN PESAR: cuentan, suman 0 y se dicen ─────────────────────────
{
  const r = C.costoPorTonelada([], OP, [
    { peso_neto_kg: 48500 },
    { peso_neto_kg: 0 },
    { peso_neto_kg: null },
    { peso_neto_kg: 'basura' },
  ]);
  eq('⭐ el viaje sin pesar cuenta como viaje y suma 0 t', [r.viajes, r.sinPeso, r.toneladas], [4, 3, 48.5]);
}

// ── 4) SIN DIVISIÓN NO HAY NÚMERO ────────────────────────────────────────────
{
  const filas = [{ id: 'a', code: 'M', placa: '', empresa: 'A', montos: { jornadas: 1000 }, cant: { jornadas: 10 } }];
  const r = C.costoPorTonelada(filas, OP, []);
  eq('⭐ 0 toneladas → $/t es null (no $0 ni infinito)', r.usdPorTon, null);
  eq('* pero la hora sí divide', r.usdPorHora, 100);
  const r2 = C.costoPorTonelada([], OP, [{ peso_neto_kg: 1000000 }]);
  eq('* 0 horas → $/h es null', r2.usdPorHora, null);
}

// ── 5) FRENTE POR FRENTE (los «frentes vinculantes») ─────────────────────────
{
  const filas = [
    { id: 'a', code: 'M1', placa: '', empresa: 'A', frente: 'TFI', montos: { jornadas: 1000 }, cant: { jornadas: 10 } },
    { id: 'b', code: 'M2', placa: '', empresa: 'A', frente: 'CET', montos: { horometros: 600 }, cant: { horometros: 6 } },
    { id: 'c', code: 'M3', placa: '', empresa: 'A', montos: { jornadas: 400 }, cant: { jornadas: 4 } }, // sin frente
  ];
  const viajes = [
    // El cruce NO distingue mayúsculas: el viaje dice «tfi», la máquina «TFI».
    { frente_nombre: 'tfi', peso_neto_kg: 500000 },
    { frente_nombre: 'TFI', peso_neto_kg: 500000 },
    { frente_nombre: '', peso_neto_kg: 200000 }, // sin frente
  ];
  const r = C.costoPorTonelada(filas, OP, viajes);
  const tfi = r.porFrente.find((x) => x.frente.toLowerCase() === 'tfi');
  const cet = r.porFrente.find((x) => x.frente === 'CET');
  const sin = r.porFrente.find((x) => x.frente === C.SIN_FRENTE);
  eq('⭐ TFI junta su maquinaria y SUS toneladas (sin distinguir mayúsculas)', [tfi.costo, tfi.toneladas, tfi.usdPorTon], [1000, 1000, 1]);
  eq('⭐ un frente con maquinaria y SIN toneladas no divide (null)', [cet.costo, cet.toneladas, cet.usdPorTon], [600, 0, null]);
  eq('* lo sin frente también se junta (máquina y viaje)', [sin.costo, sin.toneladas, sin.usdPorTon], [400, 200, 2]);
  ok('* los frentes salen A→Z', r.porFrente.findIndex((x) => x.frente === 'CET') < r.porFrente.findIndex((x) => x.frente.toLowerCase() === 'tfi'));
}

// ── 6) LOS FILTROS: frentes cortan toneladas; lo demás solo el costo ─────────
{
  const filas = [
    { id: 'a', code: 'M1', placa: '', empresa: 'ALFA', frente: 'TFI', montos: { jornadas: 1000 }, cant: { jornadas: 10 } },
    { id: 'b', code: 'M2', placa: '', empresa: 'BETA', frente: 'CET', montos: { jornadas: 500 }, cant: { jornadas: 5 } },
  ];
  const viajes = [
    { frente_nombre: 'TFI', peso_neto_kg: 1000000 },
    { frente_nombre: 'CET', peso_neto_kg: 500000 },
  ];
  const soloTfi = { ...OP, soloFrentes: ['tfi'] };
  const r = C.costoPorTonelada(filas, soloTfi, viajes);
  eq('⭐ filtrar por FRENTE corta el costo Y las toneladas', [r.costo, r.toneladas, r.usdPorTon], [1000, 1000, 1]);
  const soloAlfa = { ...OP, soloEmpresas: ['alfa'] };
  const r2 = C.costoPorTonelada(filas, soloAlfa, viajes);
  eq('⭐ filtrar por EMPRESA corta el costo pero NO las toneladas (un viaje no es de esa empresa)', [r2.costo, r2.toneladas], [1000, 1500]);
}

// ── 7) EL RESUMEN EJECUTIVO LO TRAE, REDACTADO ───────────────────────────────
{
  const filas = [
    { id: 'a', code: 'M1', placa: '', empresa: 'ALFA', frente: 'TFI', montos: { jornadas: 15000 }, cant: { jornadas: 170 } },
    { id: 'b', code: 'M2', placa: '', empresa: 'ALFA', frente: 'CET', montos: { horometros: 10000 }, cant: { horometros: 110 } },
  ];
  const viajes = [
    { frente_nombre: 'TFI', peso_neto_kg: 1200000 },
    { frente_nombre: 'CET', peso_neto_kg: 800000 },
    { frente_nombre: 'TFI', peso_neto_kg: 0 },
  ];
  const d = { filas, desde: '2026-10-19', hasta: '2026-10-21', viajesTon: viajes };
  const res = C.resumenConsolidado(d, OP);
  const tj = res.tarjetas.find((x) => x.k === 'costo_ton');
  ok('⭐ la tarjeta ⚖️ existe y dice $12,50 /t', !!tj && /12,50/.test(tj.valor));
  ok('* y la nota cuenta la operación completa (costo ÷ toneladas, viajes y sin pesar)',
    /25\.000,00/.test(tj.nota) && /2\.000,00 t/.test(tj.nota) && /3 viaje/.test(tj.nota) && /1 sin pesar/.test(tj.nota));
  const hp = res.tarjetas.find((x) => x.k === 'hora_prom');
  ok('⭐ la tarjeta 🕐 existe y dice $89,29 /h', !!hp && /89,29/.test(hp.valor));
  const cu = res.cuadros.find((x) => x.k === 'ton_frente');
  ok('⭐ el cuadro frente por frente existe con sus dos frentes', !!cu && cu.filas.length === 2);
  // Apagadas no dejan rastro.
  const resOff = C.resumenConsolidado(d, { ...OP, costoTonelada: false, horaPromedio: false });
  ok('* apagadas, ni tarjetas ni cuadro (lo oculto no deja rastro)',
    !resOff.tarjetas.some((x) => x.k === 'costo_ton' || x.k === 'hora_prom') && !resOff.cuadros.some((x) => x.k === 'ton_frente'));
  // Filtrada por empresa, la tarjeta ADVIERTE que las toneladas son de todo el rango.
  const resFil = C.resumenConsolidado(d, { ...OP, soloEmpresas: ['ALFA'] });
  const tjF = resFil.tarjetas.find((x) => x.k === 'costo_ton');
  ok('* filtrado por empresa, la tarjeta lo advierte', /papel filtrado/.test(tjF.nota));
  // Sin viajes cargados no se inventa nada.
  const resSin = C.resumenConsolidado({ ...d, viajesTon: null }, OP);
  const tjS = resSin.tarjetas.find((x) => x.k === 'costo_ton');
  ok('* sin viajes del rango, la tarjeta dice «—» (no inventa)', tjS.valor === '—');
}

// ── 7b) EL CUADRO QUE SALÍA REPETIDO (21-oct-2026, con la foto del cliente) ──
// «Me salen repetidos, acomoda los nombres para que se junten todos». El frente
// va CONGELADO en cada viaje («RES. BAHIA MAR») y el catálogo de maquinaria lo
// llama de otra forma («RESIDENCIAS BAHIA MAR»): el papel partía el frente en
// dos renglones, uno con la plata y otro con «$0,00 de maquinaria».
{
  // El CATÁLOGO de frentes (los dos, viajes y maquinaria) es lo que deja juntar
  // sin riesgo: un frente que existe nunca se mete dentro de otro parecido.
  const op = {
    ...C.OPCIONES_CONSOLIDADO_POR_DEFECTO,
    catalogoFrentes: [
      'RESIDENCIAS BAHIA MAR', 'RESIDENCIA RITA SOL PALACE', 'RESIDENCIA CORAL GARDEN',
      'RESIDENCIAS CORAL', 'RESIDENCIA CORAL MAR',
    ],
  };
  // Las máquinas traen el nombre del CATÁLOGO…
  const filas = [
    { id: 'm1', code: 'JUMBO 1', placa: '', empresa: 'ALFA', frente: 'RESIDENCIAS BAHIA MAR', montos: { jornadas: 28452.77 }, cant: { jornadas: 100 } },
    { id: 'm2', code: 'JUMBO 2', placa: '', empresa: 'ALFA', frente: 'RESIDENCIA RITA SOL PALACE', montos: { jornadas: 9058.74 }, cant: { jornadas: 30 } },
    { id: 'm3', code: 'JUMBO 3', placa: '', empresa: 'ALFA', frente: 'RESIDENCIA CORAL GARDEN', montos: { jornadas: 4000 }, cant: { jornadas: 20 } },
  ];
  // …y los viajes, el nombre viejo congelado.
  const viajes = [
    { frente_nombre: 'RES. BAHIA MAR', peso_neto_kg: 601940 },
    { frente_nombre: 'RESIDENCIAS BAHIA MAR', peso_neto_kg: 1889800 },
    { frente_nombre: 'res. rita sol', peso_neto_kg: 2128260 },
    { frente_nombre: 'coral garden', peso_neto_kg: 2026020 },
  ];
  const ct = C.costoPorTonelada(filas, op, viajes);
  eq('⭐⭐ los frentes repetidos quedan en UN solo renglón (3, no 6)', ct.porFrente.length, 3);
  eq('⭐⭐ el renglón sale con el nombre MÁS COMPLETO, no con la abreviatura',
    ct.porFrente.map((x) => x.frente).sort(),
    ['RESIDENCIA CORAL GARDEN', 'RESIDENCIA RITA SOL PALACE', 'RESIDENCIAS BAHIA MAR']);
  const bahia = ct.porFrente.find((x) => /BAHIA/.test(x.frente));
  // $28.452,77 ÷ (601,94 + 1.889,80) t = $11,42 — antes salían $15,06 y «$0,00».
  eq('⭐⭐ la plata y las toneladas de los dos nombres se SUMAN en el mismo frente',
    [bahia.costo, bahia.toneladas, bahia.usdPorTon], [28452.77, 2491.74, 11.42]);
  const rita = ct.porFrente.find((x) => /RITA/.test(x.frente));
  ok('⭐ «res. rita sol» entra en «RESIDENCIA RITA SOL PALACE» (le faltaba el apellido)',
    rita.toneladas === 2128.26 && rita.costo === 9058.74);
  const garden = ct.porFrente.find((x) => /GARDEN/.test(x.frente));
  ok('⭐ «coral garden» entra en «RESIDENCIA CORAL GARDEN» (le faltaba el tipo)',
    garden.toneladas === 2026.02 && garden.costo === 4000);
  ok('* ninguna tonelada se perdió por el camino',
    Math.round(ct.toneladas * 100) / 100 === 6646.02);
  // ⚠️ Y LO QUE NO ES EL MISMO FRENTE SIGUE SEPARADO.
  const ct2 = C.costoPorTonelada(
    [{ id: 'm1', code: 'J', placa: '', empresa: 'A', frente: 'RESIDENCIAS CORAL', montos: { jornadas: 1000 }, cant: { jornadas: 10 } }],
    op,  // con «RESIDENCIAS CORAL» y «RESIDENCIA CORAL MAR» en el catálogo
    [{ frente_nombre: 'RESIDENCIA CORAL MAR', peso_neto_kg: 100000 }, { frente_nombre: 'RES. CORAL', peso_neto_kg: 200000 }],
  );
  eq('⭐⭐ «CORAL» y «CORAL MAR» NO se juntan (son frentes distintos)',
    ct2.porFrente.map((x) => [x.frente, x.toneladas]).sort(),
    [['RESIDENCIA CORAL MAR', 100], ['RESIDENCIAS CORAL', 200]]);
  // El filtro «solo este frente» también alcanza a los dos nombres.
  const soloBahia = { ...op, soloFrentes: ['RESIDENCIAS BAHIA MAR'] };
  eq('⭐ marcar el frente en el filtro recoge también sus viajes con el nombre viejo',
    C.costoPorTonelada(filas, soloBahia, viajes).toneladas, 2491.74);
}

// ── 8) LA PANTALLA LO USA (no una copia suya) ────────────────────────────────
{
  const card = fs.readFileSync(path.join(ROOT, 'src/components/ReporteConsolidadoCard.tsx'), 'utf8');
  // (21-oct-2026: la llamada ganó `dias: porDia` con la 📅 tabla operativa
  //  diaria, así que el pin ya no cierra con «viajesTon }» — se pide que
  //  viajesTon siga viajando al papel, no que sea el último argumento.)
  ok('⭐ la pantalla guarda los viajes del rango (frente + peso) y los pasa al PDF',
    card.includes('setViajesTon(viajesEnRango((vDatos as any).viajes, desde, hasta)')
    && /cuerpoConsolidado\(\{ filas, filasAnterior: filasAnt, desde: rangoCalculado\.desde, hasta: rangoCalculado\.hasta, viajesTon[,}]/.test(card));
  ok('* con sus dos pastillas en el resumen', card.includes('⚖️ Costo maquinaria por tonelada (y por frente)') && card.includes('🕐 Hora promedio de maquinaria'));
  ok('* y las tarjetas se pueden ocultar una a una', card.includes("{ k: 'costo_ton', label: '⚖️ Costo por tonelada' }") && card.includes("{ k: 'hora_prom', label: '🕐 Hora promedio' }"));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-costo-por-tonelada · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('   Maquinaria ÷ toneladas del acarreo: $12,50/t como lo calcula el jefe, sin inventar divisiones.');
