// 💰 REPORTE CONSOLIDADO DE PAGOS + receta de jornadas (19-oct-2026).
//
// Dos libs puras bajo prueba:
//  · src/lib/pagoJornadas.ts — el CALCO de la receta de Control de Pagos.
//  · src/lib/reporteConsolidado.ts — juntar, sumar, resumen ejecutivo y papel.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');
const cacheTs = new Map();
function cargarAbs(p) {
  if (cacheTs.has(p)) return cacheTs.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cacheTs.set(p, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id.startsWith('.')) {
      const abs = path.resolve(path.dirname(p), id);
      for (const c of [abs + '.ts', abs + '.tsx']) if (fs.existsSync(c)) return cargarAbs(c);
    }
    return orig(id);
  };
  m._compile(js, p);
  cacheTs.set(p, m.exports);
  return m.exports;
}
const cargar = (rel) => cargarAbs(path.join(ROOT, rel));
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

console.log('\n💰 REPORTE CONSOLIDADO DE PAGOS\n');

// ═══ 1) pagoJornadas: el calco de Control de Pagos ═══════════════════════════
const J = cargar('src/lib/pagoJornadas.ts');

eq('el primer cierre es uno solo (26-jun→05-jul)', [J.periodStartISO('2026-06-28'), J.periodEndISO(J.periodStartISO('2026-06-28'))], ['2026-06-26', '2026-07-05']);
eq('después, semanas de lunes a domingo', [J.periodStartISO('2026-10-14'), J.periodEndISO('2026-10-12')], ['2026-10-12', '2026-10-18']);
eq('un día de puras horas extra vale $0 (como Pagos)', J.horasCobrables({ day: 0, night: 0, stopped: 0, overtime: 3 }), 0);
eq('horas cobrables = día+noche−parada+extras', J.horasCobrables({ day: 10, night: 0, stopped: 2, overtime: 1 }), 9);

const maq = (id, code, precio, empresa = 'ALFA C.A') => ({ id, code, serial: null, plate: `P-${id}`, price_per_hour: precio, company: { id: `c-${empresa}`, name: empresa } });
const ronda = (m, fecha, extra = {}) => ({ round_date: fecha, day_hours: 12, night_hours: 0, hours_stopped: 0, overtime_hours: 0, frozen_price: null, machinery: m, ...extra });

{
  // 12 h a $3.600/jornada = $3.600; dos días = $7.200.
  const filas = J.montosJornadaPorMaquina({ rounds: [ronda(maq('m1', 'JUMBO', 3600), '2026-10-13'), ronda(maq('m1', 'JUMBO', 3600), '2026-10-14')], hist: new Map(), desde: '2026-10-12', hasta: '2026-10-18' });
  eq('⭐ monto = precio × horas/12 (12 h = 1 jornada)', [filas[0].horas, filas[0].monto], [24, 7200]);
}
{
  // Varias rondas el mismo día → el MÁXIMO de cada campo, no la suma.
  const filas = J.montosJornadaPorMaquina({
    rounds: [ronda(maq('m1', 'JUMBO', 1200), '2026-10-13', { day_hours: 8 }), ronda(maq('m1', 'JUMBO', 1200), '2026-10-13', { day_hours: 12, round_no: 2 })],
    hist: new Map(), desde: '2026-10-12', hasta: '2026-10-18',
  });
  eq('⭐ dos rondas el mismo día: gana el máximo (12 h, no 20)', [filas[0].horas, filas[0].monto], [12, 1200]);
}
{
  // frozen_price manda para TODA la semana (priceRango), aunque el actual sea otro.
  const filas = J.montosJornadaPorMaquina({
    rounds: [ronda(maq('m1', 'JUMBO', 9999), '2026-10-13', { frozen_price: 1200 }), ronda(maq('m1', 'JUMBO', 9999), '2026-10-14')],
    hist: new Map(), desde: '2026-10-12', hasta: '2026-10-18',
  });
  eq('⭐ el precio congelado de la semana manda sobre el actual (2 días × $1.200)', filas[0].monto, 2400);
}
{
  // Sin precio: $0 con bandera, no se inventa nada.
  const filas = J.montosJornadaPorMaquina({ rounds: [ronda(maq('m1', 'JUMBO', null), '2026-10-13')], hist: new Map(), desde: '2026-10-12', hasta: '2026-10-18' });
  eq('⭐ sin precio: $0 y bandera (no se inventa)', [filas[0].monto, filas[0].sinPrecio], [0, true]);
}
{
  // El historial: cada día con el precio que regía ESE día.
  const hist = new Map([['m1', [{ desde: '2026-10-14', anterior: 1200, at: 'x' }]]]); // antes del 14 valía 1200; desde el 14, el actual (2400)
  const filas = J.montosJornadaPorMaquina({
    rounds: [ronda(maq('m1', 'JUMBO', 2400), '2026-10-13'), ronda(maq('m1', 'JUMBO', 2400), '2026-10-14')],
    hist, desde: '2026-10-12', hasta: '2026-10-18',
  });
  eq('⭐ cada día se cobra con el precio que regía ese día (1200 + 2400)', filas[0].monto, 3600);
}
{
  const filas = J.montosJornadaPorMaquina({ rounds: [ronda(maq('m1', 'JUMBO', 1200), '2026-06-20')], hist: new Map(), desde: '2026-06-01', hasta: '2026-06-30' });
  eq('las rondas antes del 26-jun no se cobran (piso de Pagos)', filas.length, 0);
}

// ═══ 2) reporteConsolidado: juntar, sumar y el papel ═════════════════════════
const C = cargar('src/lib/reporteConsolidado.ts');
// 🤖 21-oct-2026: nació la SELECCIÓN AUTOMÁTICA (jornada y horómetro son uno u
// otro por máquina; manda el horómetro) y viene PRENDIDA por defecto. Los
// candados históricos de abajo prueban la MECÁNICA CRUDA de sumar fuentes
// (fixtures con jornada+horómetro en la misma fila), así que la apagan a
// propósito; la regla nueva tiene su propia sección al final.
// 🏗️🚛 22-oct-2026: el papel nace en DOS columnas (Maquinaria y Acarreo). Estos
// candados prueban la mecánica FUENTE POR FUENTE (tarjeta «fuente_viajes», el
// respaldo «36 h» de la jornada sola…), así que fijan una columna por fuente;
// lo agrupado tiene su propia sección al final.
const OP = { ...C.OPCIONES_CONSOLIDADO_POR_DEFECTO, seleccionAutomatica: false, columnasPorGrupo: false };
const F = [
  { id: 'a', code: 'JUMBO 320', placa: 'AA11', empresa: 'ALFA C.A', montos: { jornadas: 1000, horometros: 500 } },
  { id: 'b', code: 'VOLTEO 1', placa: 'BB22', empresa: 'BETA C.A', montos: { viajes: 300, peso: 200 } },
  { id: 'c', code: 'VOLTEO 2', placa: 'CC33', empresa: 'BETA C.A', montos: { viajes: 150 } },
];
const D = { filas: F, desde: '2026-10-12', hasta: '2026-10-18' };

{
  const t = C.totalesConsolidado(F, OP);
  eq('⭐ total general = suma de todo lo que suma', t.total, 2150);
  eq('⭐ subtotales por fuente', t.porFuente, { jornadas: 1000, horometros: 500, viajes: 450, peso: 200 });
  eq('máquinas y empresas contadas', [t.maquinas, t.empresas], [3, 2]);
}
{
  const op = { ...OP, fuentes: { ...OP.fuentes, peso: 'muestra' } };
  eq('⭐ una fuente «sin sumar» se ve pero NO entra al total', C.totalesConsolidado(F, op).total, 1950);
  ok('…y el papel la marca (ref) sin sumarla', C.cuerpoConsolidado(D, op).includes('(ref)'));
  const op2 = { ...OP, fuentes: { ...OP.fuentes, peso: 'oculta' } };
  const html2 = C.cuerpoConsolidado(D, op2);
  ok('⭐ una fuente oculta no deja rastro', !html2.includes('⚖️ Peso') && C.totalesConsolidado(F, op2).total === 1950);
}
{
  const s = C.solapesConsolidado(F, OP);
  eq('⭐ marca los que cobran por DOS fuentes (a: jornada+horómetro, b: viaje+peso)', s.map((x) => x.fila.id).sort(), ['a', 'b']);
  const sinPeso = C.solapesConsolidado(F, { ...OP, fuentes: { ...OP.fuentes, peso: 'oculta' } });
  eq('…y si apago una fuente, ese solape desaparece', sinPeso.map((x) => x.fila.id), ['a']);
}
{
  const e = C.porEmpresaConsolidado(F, OP);
  eq('⭐ por empresa, de mayor a menor', e.map((x) => [x.empresa, x.total]), [['ALFA C.A', 1500], ['BETA C.A', 650]]);
  eq('top de máquinas más costosas', C.topMaquinas(F, OP, 2).map((x) => x.fila.id), ['a', 'b']);
}
{
  const r = C.resumenConsolidado({ ...D, filasAnterior: [{ id: 'a', code: 'J', placa: '', empresa: 'ALFA C.A', montos: { jornadas: 1000 } }] }, OP);
  ok('⭐ el resumen trae el total, las fuentes con su %, y la comparación',
    r.tarjetas.some((x) => x.k === 'total' && x.valor.includes('2.150'))
    && r.tarjetas.some((x) => x.k === 'fuente_viajes' && /% del total/.test(x.nota ?? ''))
    && r.tarjetas.some((x) => x.k === 'comparacion' && x.valor === '+115%'));
  ok('…con el cuadro por empresa, el top 5 y los solapes', ['por_empresa', 'top5', 'solapes'].every((k) => r.cuadros.some((c) => c.k === k)));
  ok('promedio por día del rango (7 días)', r.tarjetas.some((x) => x.k === 'promedio_dia' && (x.nota ?? '').includes('7 día(s)')));
}
{
  const html = C.cuerpoConsolidado(D, { ...OP, sinEmpresas: true });
  ok('⭐ sin empresas: el nombre no sale por ninguna parte', !html.includes('ALFA') && !html.includes('BETA'));
  const filtrado = C.filasElegidas(F, { ...OP, soloMaquinas: ['a'] });
  eq('⭐ el selector de máquinas SÍ saca filas (total cambia)', [filtrado.length, C.totalesConsolidado(F, { ...OP, soloMaquinas: ['a'] }).total], [1, 1500]);
  ok('…y el subtítulo lo dice FILTRADO', /FILTRADO/.test(C.subtituloConsolidado(D, OP, true)));
}
{
  // El resumen editable de frentes aplica tal cual: ocultar y tarjetas propias.
  const html = C.cuerpoConsolidado(D, OP, { ocultos: ['total'], propias: [{ titulo: 'Menos anticipo', valor: '-$2.000' }] });
  ok('⭐ la edición del resumen funciona (ocultar total, tarjeta propia)', !html.includes('TOTAL GENERAL del rango') && html.includes('Menos anticipo'));
}
{
  ok('el sufijo del archivo nombra lo cambiado', /sin peso/.test(C.sufijoArchivoConsolidado({ ...OP, fuentes: { ...OP.fuentes, peso: 'oculta' } }))
    && /por máquina/.test(C.sufijoArchivoConsolidado({ ...OP, agruparPor: 'maquina' }))
    // Con TODO por defecto (selección automática prendida) el nombre va limpio;
    // apagarla cambia la plata y por eso el OP de esta suite (apagada) lo nombra.
    && C.sufijoArchivoConsolidado(C.OPCIONES_CONSOLIDADO_POR_DEFECTO) === ''
    // (21-oct tarde: apagada también re-suma el peso con viajes/jornada, así
    //  que el nombre dice «sumando todas las fuentes».)
    && /sumando todas las fuentes/.test(C.sufijoArchivoConsolidado(OP)));
  ok('texto escapado en el papel', !C.cuerpoConsolidado({ ...D, filas: [{ ...F[0], code: '<script>x</script>' }] }, OP).includes('<script>'));
}

// ═══ 2b) Lo que RESPALDA cada monto: horas, viajes y toneladas ═══════════════
const FC = [
  { id: 'a', code: 'JUMBO 320', placa: 'AA11', empresa: 'ALFA C.A', montos: { jornadas: 1000, horometros: 500 }, cant: { jornadas: 36, horometros: 10.5 } },
  { id: 'b', code: 'VOLTEO 1', placa: 'BB22', empresa: 'BETA C.A', montos: { viajes: 300, peso: 200 }, cant: { viajes: 12, peso: 48500 } },
];
const DC = { filas: FC, desde: '2026-10-12', hasta: '2026-10-18' };
{
  eq('⭐ cantTexto habla en la unidad de cada fuente', [C.cantTexto('jornadas', 36), C.cantTexto('viajes', 1), C.cantTexto('viajes', 12), C.cantTexto('peso', 48500)], ['36 h', '1 viaje', '12 viajes', '48,50 t']);
  eq('cantTexto en cero o vacío no dice nada', [C.cantTexto('jornadas', 0), C.cantTexto('peso', null)], ['', '']);
  const t = C.totalesConsolidado(FC, OP);
  eq('⭐ los totales traen el respaldo por fuente (horas/viajes/kg)', t.cantPorFuente, { jornadas: 36, horometros: 10.5, viajes: 12, peso: 48500 });
  const html = C.cuerpoConsolidado(DC, OP);
  ok('⭐ el papel muestra el respaldo debajo del monto (36 h, 12 viajes, 48,50 t)', html.includes('36 h') && html.includes('12 viajes') && html.includes('48,50 t'));
  ok('⭐ el cuadro por empresa sale COMPLETO: fuente por fuente, % del total y máquinas', html.includes('% del total') && /<th>Empresa<\/th><th class="r">Máquinas<\/th>/.test(html));
  ok('el papel se parte en secciones (resumen ejecutivo y detalle)', html.includes('📊 Resumen ejecutivo') && /📑 Detalle/.test(html));
  const sin = C.cuerpoConsolidado(DC, { ...OP, sinCantidades: true });
  ok('⭐ apagar las cantidades las quita sin dejar rastro', !sin.includes('36 h') && !sin.includes('48,50 t') && !sin.includes('12 viajes'));
  ok('…y el nombre del archivo lo dice', /sin cantidades/.test(C.sufijoArchivoConsolidado({ ...OP, sinCantidades: true })));
  const viejas = C.cuerpoConsolidado(D, OP);
  ok('una fila sin cantidades sigue valiendo (solo montos)', viejas.includes('TOTAL GENERAL'));
}
{
  // El desglose del solape: cuánto cobra por CADA fuente, no solo los íconos.
  const r = C.resumenConsolidado(DC, OP);
  const solapes = r.cuadros.find((c) => c.k === 'solapes');
  ok('⭐ el solape dice cuánto cobra por cada fuente', solapes.filas.every((f) => /\$/.test(f.clave)));
  const top = r.cuadros.find((c) => c.k === 'top5');
  ok('el top 5 trae el % del total de cada máquina', top.filas.every((f) => /% del total/.test(f.clave)));
  const tarjeta = r.tarjetas.find((x) => x.k === 'fuente_jornadas');
  ok('⭐ la tarjeta por fuente trae su respaldo (36 h)', /36 h/.test(tarjeta.nota ?? ''));
  const rSin = C.resumenConsolidado(DC, { ...OP, sinCantidades: true });
  ok('…y con cantidades apagadas, la tarjeta no lo trae', !/36 h/.test(rSin.tarjetas.find((x) => x.k === 'fuente_jornadas').nota ?? ''));
}
{
  // 🏢 Solo una (o varias) empresas (19-oct-2026, a pedido: «para una sola empresa»).
  const soloBeta = { ...OP, soloEmpresas: ['BETA C.A'] };
  eq('⭐ el filtro por empresa saca las demás y el total cambia',
    [C.filasElegidas(F, soloBeta).length, C.totalesConsolidado(F, soloBeta).total], [2, 650]);
  ok('…sin distinguir mayúsculas ni espacios', C.totalesConsolidado(F, { ...OP, soloEmpresas: ['  beta c.a '] }).total === 650);
  ok('…y el nombre del archivo dice CUÁL empresa', /solo BETA C\.A/.test(C.sufijoArchivoConsolidado(soloBeta))
    && /solo 2 empresas/.test(C.sufijoArchivoConsolidado({ ...OP, soloEmpresas: ['A', 'B'] })));
  ok('el papel filtrado no nombra a las otras empresas', !C.cuerpoConsolidado({ ...D, filas: F }, soloBeta).includes('ALFA'));
  const card = leer('src/components/ReporteConsolidadoCard.tsx');
  ok('⭐ la pantalla tiene las pastillas de empresas y marca FILTRADO',
    /soloEmpresas/.test(card) && /\(op\.soloEmpresas \?\? \[\]\)\.length > 0/.test(card));
}
// ═══ 2c) Orden alfabético, categoría y frente (20-oct-2026, a pedido) ════════
const FG = [
  { id: 'a', code: 'ZANJADORA 9', placa: 'Z9', empresa: 'BETA C.A', categoria: 'REMOCIÓN Y EXCAVACIÓN', frente: 'FRENTE NORTE', montos: { jornadas: 100 } },
  { id: 'b', code: 'ALMEJA 1', placa: 'A1', empresa: 'ALFA C.A', categoria: 'MANEJO DE CARGA', frente: 'FRENTE NORTE', montos: { horometros: 200 } },
  { id: 'c', code: 'MARTILLO 2', placa: 'M2', empresa: 'BETA C.A', categoria: 'REMOCIÓN Y EXCAVACIÓN', frente: null, montos: { viajes: 300 } },
];
const DG = { filas: FG, desde: '2026-10-12', hasta: '2026-10-18' };
{
  eq('⭐ el listado va en ORDEN ALFABÉTICO por código, agrupe como agrupe',
    C.filasElegidas(FG, OP).map((f) => f.code), ['ALMEJA 1', 'MARTILLO 2', 'ZANJADORA 9']);
  const soloCat = { ...OP, soloCategorias: ['remoción y excavación'] };
  eq('⭐ el filtro por CATEGORÍA saca las demás (sin distinguir mayúsculas)',
    [C.filasElegidas(FG, soloCat).length, C.totalesConsolidado(FG, soloCat).total], [2, 400]);
  ok('…y el archivo dice cuál', /solo remoción y excavación/.test(C.sufijoArchivoConsolidado(soloCat))
    && /solo 2 categorías/.test(C.sufijoArchivoConsolidado({ ...OP, soloCategorias: ['A', 'B'] })));
  const porCat = C.cuerpoConsolidado(DG, { ...OP, agruparPor: 'categoria' });
  ok('⭐ agrupar por CATEGORÍA parte el papel en bloques con subtotal',
    porCat.includes('📑 Detalle por categoría') && porCat.includes('🏷️ MANEJO DE CARGA')
    && porCat.includes('Subtotal REMOCIÓN Y EXCAVACIÓN') && porCat.includes('TOTAL GENERAL'));
  const porFrente = C.cuerpoConsolidado(DG, { ...OP, agruparPor: 'frente' });
  ok('⭐ agrupar por FRENTE usa el vigente, y sin asignación cae en «Sin frente»',
    porFrente.includes('📑 Detalle por frente de trabajo') && porFrente.includes('⛏️ FRENTE NORTE')
    && porFrente.includes('Subtotal Sin frente'));
  ok('…los bloques salen A→Z (FRENTE NORTE antes que Sin frente)',
    porFrente.indexOf('⛏️ FRENTE NORTE') < porFrente.indexOf('⛏️ Sin frente'));
  ok('el sufijo nombra la agrupación nueva', /por categoría/.test(C.sufijoArchivoConsolidado({ ...OP, agruparPor: 'categoria' }))
    && /por frente/.test(C.sufijoArchivoConsolidado({ ...OP, agruparPor: 'frente' })));
  ok('una fila vieja sin categoría ni frente sigue valiendo',
    C.cuerpoConsolidado(D, { ...OP, agruparPor: 'categoria' }).includes('Subtotal Sin clasificación'));
  const card = leer('src/components/ReporteConsolidadoCard.tsx');
  ok('⭐ la pantalla carga la clasificación del catálogo y el frente VIGENTE al final del rango',
    /selectAllRows\('machinery', 'id, clasificacion'\)/.test(card)
    && /listAsignacionesHasta\(hasta, FRENTES_MAQUINARIA\)/.test(card)
    && /vigentesAlDia\(\(asigsFrente as any\)\.asignaciones \?\? \[\], hasta\)/.test(card));
  // ⛏️🚛 20-oct-2026 (2.ª vuelta): los CAMIONES se asignan en el módulo de
  // viajes (diario), y ese histórico también alimenta el frente del consolidado.
  // La asignación de maquinaria (Reportes → ⛏️ Frentes) manda si hay choque.
  ok('⭐ …y también la asignación de VIAJES para los camiones (sincronizadas)',
    /listAsignacionesHasta\(hasta, FRENTES_VIAJES\)/.test(card)
    && /vigentesAlDia\(\(asigsFrenteViajes as any\)\.asignaciones \?\? \[\], hasta\)/.test(card)
    && /if \(!frentePorId\.get\(id\)\) frentePorId\.set\(id,/.test(card));
  ok('…con sus pastillas de agrupar y el filtro por categoría',
    /🏷️ Por categoría/.test(card) && /⛏️ Por frente/.test(card) && /soloCategorias/.test(card));

  // ⛏️ El filtro por FRENTE (20-oct, mismo día: «poder seleccionar un frente o varios»).
  const soloFrente = { ...OP, soloFrentes: ['frente norte'] };
  eq('⭐ el filtro por FRENTE saca los demás (sin distinguir mayúsculas)',
    [C.filasElegidas(FG, soloFrente).map((f) => f.id).sort().join(','), C.totalesConsolidado(FG, soloFrente).total],
    ['a,b', 300]);
  eq('…y «Sin frente» también se puede marcar (los sin asignación)',
    C.filasElegidas(FG, { ...OP, soloFrentes: ['Sin frente'] }).map((f) => f.id), ['c']);
  ok('…el archivo dice cuál frente', /solo FRENTE NORTE/.test(C.sufijoArchivoConsolidado({ ...OP, soloFrentes: ['FRENTE NORTE'] }))
    && /solo 2 frentes/.test(C.sufijoArchivoConsolidado({ ...OP, soloFrentes: ['A', 'B'] })));
  ok('…y la pantalla tiene sus pastillas (con FILTRADO)',
    /SOLO ESTOS FRENTES/.test(card) && /soloFrentes/.test(card)
    && /\(op\.soloFrentes \?\? \[\]\)\.length > 0/.test(card));
}

{
  // La pantalla CARGA el respaldo de los cuatro motores.
  const card = leer('src/components/ReporteConsolidadoCard.tsx');
  ok('⭐ la pantalla pasa horas de jornadas, horas de horómetro, viajes pagados y kg',
    /'jornadas', j\.monto, j\.horas/.test(card) && /'horometros', h\.monto, h\.horas/.test(card)
    && /'viajes', c\.monto, c\.pagados/.test(card) && /'peso', r\.monto, r\.kg/.test(card));
  ok('…y tiene el interruptor de cantidades', /sinCantidades/.test(card));
}

// ═══ 3) Candados de pantalla ═════════════════════════════════════════════════
{
  const card = leer('src/components/ReporteConsolidadoCard.tsx');
  ok('⭐ la tarjeta exige el permiso de control_pagos', /moduleLevel\('control_pagos'\)/.test(card) && /levelMeets/.test(card));
  ok('⭐ jornadas usa pagoJornadas (el calco de Pagos), no un cálculo propio', /montosJornadaPorMaquina/.test(card));
  ok('⭐ horómetros entra CON cierres (lo cerrado sale de la foto)', /cierres: cierres\.cierres/.test(card));
  const screen = leer('src/screens/ReportsScreen.tsx');
  ok('⭐ ReportsScreen solo monta la tarjeta (sin nombrar pagoViajes)', /ReporteConsolidadoCard/.test(screen) && !/pagoViajes|PagoViajes/.test(screen));
  ok('…y el botón genérico de generar no aplica al consolidado', /mode !== 'consolidado'/.test(screen));
}

// ═══ 🤖 LA SELECCIÓN AUTOMÁTICA EN TODO EL PAPEL (21-oct-2026, decisión) ═════
// «La idea es que haga la selección automática en ese reporte»: jornada y
// horómetro son uno u otro POR MÁQUINA en el total, las tarjetas y los cuadros.
{
  const AUTO = C.OPCIONES_CONSOLIDADO_POR_DEFECTO; // nace PRENDIDA
  const FA = [
    // jornada 1200 + horómetro 1150 sumando → se factura el horómetro.
    { id: 'a', code: 'JUMBO 320', placa: 'AA11', empresa: 'ALFA C.A', montos: { jornadas: 1200, horometros: 1150 }, cant: { jornadas: 12, horometros: 11.5 } },
    // solo jornada → la jornada se queda.
    { id: 'b', code: 'PAYLOADER 1', placa: 'BB22', empresa: 'ALFA C.A', montos: { jornadas: 800 }, cant: { jornadas: 8 } },
    // horómetro con HORAS pero SIN PLATA → la jornada NO se descarta (borde).
    { id: 'c', code: 'JUMBO 330', placa: 'CC33', empresa: 'ALFA C.A', montos: { jornadas: 500, horometros: 0 }, cant: { jornadas: 5, horometros: 4 } },
  ];
  const DA = { filas: FA, desde: '2026-10-19', hasta: '2026-10-21' };
  const t = C.totalesConsolidado(FA, AUTO);
  eq('⭐ el TOTAL factura uno u otro: 1150 + 800 + 500 (nunca 1200+1150)', t.total, 2450);
  eq('⭐ la fuente jornadas pierde SOLO la descartada (queda 800+500)', [t.porFuente.jornadas, t.porFuente.horometros], [1300, 1150]);
  // Las horas del horómetro SIN plata (fila c: 4 h, $0) siguen de respaldo — son
  // horas reales registradas; lo que no existe es el monto.
  eq('* y sus horas de respaldo acompañan (8+5 jornada; 11,5+4 horómetro)', [t.cantPorFuente.jornadas, t.cantPorFuente.horometros], [13, 15.5]);
  // El cuadro de transparencia: quién y cuánto quedó descartado.
  const res = C.resumenConsolidado(DA, AUTO);
  const cu = res.cuadros.find((x) => x.k === 'auto_horometro');
  ok('⭐ el resumen dice QUÉ se descartó (JUMBO 320, $1.200)', !!cu && cu.filas.length === 1 && /JUMBO 320/.test(cu.filas[0].clave) && cu.filas[0].n === 1200);
  // 🧹 21-oct (tarde): la nota introductoria del papel SE QUITÓ a pedido («eso
  // no hace falta») — la regla no se anuncia; el desglose vive solo en el cuadro.
  ok('* el papel NO trae la nota introductoria (ni fecha repetida ni anuncio del 🤖)',
    !/no inventa nada/.test(C.cuerpoConsolidado(DA, AUTO)) && !/mandó el horómetro \(el exacto\)/.test(C.cuerpoConsolidado(DA, AUTO)));
  // Con horómetro de REFERENCIA (no suma) la jornada se queda: nadie factura cero.
  const ref = { ...AUTO, fuentes: { ...AUTO.fuentes, horometros: 'muestra' } };
  eq('⭐ horómetro en referencia NO descarta la jornada (nadie factura cero)', C.totalesConsolidado(FA, ref).total, 2500);
  // Apagada, vuelve la suma cruda y el archivo lo nombra.
  const off = { ...AUTO, seleccionAutomatica: false };
  eq('* apagada vuelve la suma cruda (1200+1150+800+500)', C.totalesConsolidado(FA, off).total, 3650);
  ok('* …y el nombre del archivo lo dice', /sumando todas las fuentes/.test(C.sufijoArchivoConsolidado(off)));
  // Con la selección puesta, jornada+horómetro YA no es pago doble (se resolvió).
  ok('* el ⚠️ de solapes ya no marca jornada+horómetro (quedó resuelto)',
    !C.solapesConsolidado(FA, AUTO).some((x) => x.fuentes.includes('jornadas') && x.fuentes.includes('horometros')));
  // 🧾 SIN EL DESGLOSE (21-oct, a pedido: «que tome lo del horómetro pero que
  // no me salga esa información si no quiero»): la regla SIGUE aplicando, solo
  // deja de imprimirse el cuadro y la cola «sin toneladas».
  const sinDesglose = { ...AUTO, desgloseAutomatico: false };
  eq('⭐ sin desglose el TOTAL sigue siendo uno-u-otro (la regla no se apaga)', C.totalesConsolidado(FA, sinDesglose).total, 2450);
  ok('⭐ …pero el cuadro «Mandó el horómetro» ya no sale',
    !C.resumenConsolidado(DA, sinDesglose).cuadros.some((x) => x.k === 'auto_horometro'));
  ok('* y sin desglose tampoco hay rastro en el cuerpo',
    !/el detalle está en el resumen/.test(C.cuerpoConsolidado(DA, sinDesglose)));
  // La cola «fuera del cuadro: … sin toneladas» del ⚖️ también se apaga.
  const FT = [
    { id: 'a', code: 'M1', placa: '', empresa: 'A', frente: 'TFI', montos: { jornadas: 1000 }, cant: { jornadas: 10 } },
    { id: 'b', code: 'M2', placa: '', empresa: 'A', frente: 'CET', montos: { jornadas: 600 }, cant: { jornadas: 6 } },
  ];
  const DT = { filas: FT, desde: '2026-10-19', hasta: '2026-10-21', viajesTon: [{ frente_nombre: 'TFI', peso_neto_kg: 500000 }] };
  ok('* con desglose, la cola «sin toneladas» sale en el título del ⚖️',
    /fuera del cuadro: CET/.test(C.resumenConsolidado(DT, AUTO).cuadros.find((x) => x.k === 'ton_frente').titulo));
  ok('⭐ sin desglose, el título del ⚖️ queda limpio',
    !/fuera del cuadro/.test(C.resumenConsolidado(DT, sinDesglose).cuadros.find((x) => x.k === 'ton_frente').titulo));

  // La pantalla ofrece los interruptores.
  const card = leer('src/components/ReporteConsolidadoCard.tsx');
  ok('* la pantalla tiene su pastilla 🤖', /🤖 Selección automática \(⚖️ el peso manda en el camión/.test(card));
  ok('* y la del desglose, solo visible con la selección prendida',
    /desgloseAutomatico: !p\.desgloseAutomatico/.test(card) && /op\.seleccionAutomatica \? \(/.test(card));
}

// ═══ ⚖️ EL PESO MANDA EN EL CAMIÓN (21-oct-2026, tarde, a pedido) ════════════
// «Si tiene peso, se toma como prioridad el peso — eso es para la categoría de
// remoción de escombros, que serían los camiones; y hay varios de esa categoría
// que solo trabajarían por jornada.»
{
  const AUTO = C.OPCIONES_CONSOLIDADO_POR_DEFECTO;
  const FP = [
    // Camión con romana: facturó peso, y además traía viajes y jornada → manda el peso.
    { id: 'c1', code: 'CAMION VOLTEO 7', placa: 'AA33', empresa: 'ALFA C.A', montos: { peso: 500, viajes: 300, jornadas: 200 }, cant: { peso: 48500, viajes: 12, jornadas: 12 } },
    // Camión SIN romana que vive de sus viajes → igual que siempre.
    { id: 'c2', code: 'CAMION VOLTEO 9', placa: 'BB44', empresa: 'ALFA C.A', montos: { viajes: 400 }, cant: { viajes: 10 } },
    // Camión de los que «solo trabajarían por jornada» → su jornada se queda.
    { id: 'c3', code: 'CHUTO CON LOWBOY', placa: 'CC55', empresa: 'ALFA C.A', montos: { jornadas: 350 }, cant: { jornadas: 12 } },
    // Una MÁQUINA con jornada y horómetro → la regla vieja intacta (horómetro).
    { id: 'm1', code: 'JUMBO 320', placa: 'DD66', empresa: 'ALFA C.A', montos: { jornadas: 1200, horometros: 1150 }, cant: { jornadas: 12, horometros: 11.5 } },
  ];
  const DP = { filas: FP, desde: '2026-10-19', hasta: '2026-10-21' };
  const t = C.totalesConsolidado(FP, AUTO);
  eq('⭐⭐ el camión con romana factura SOLO el peso (500, no 1000)',
    [t.porFuente.peso, t.porFuente.viajes, t.porFuente.jornadas, t.porFuente.horometros],
    [500, 400, 350, 1150]);
  eq('⭐ total general: peso + viajes del otro + jornada del tercero + horómetro', t.total, 2400);
  // El ⚠️ de solapes ya no marca viaje+peso: quedó resuelto por la selección.
  ok('⭐ el ⚠️ ya no marca viaje+peso (la selección lo resolvió)',
    !C.solapesConsolidado(FP, AUTO).some((x) => x.fuentes.includes('viajes') && x.fuentes.includes('peso')));
  // El cuadro de transparencia: qué facturó y qué quedó fuera.
  const res = C.resumenConsolidado(DP, AUTO);
  const cu = res.cuadros.find((x) => x.k === 'auto_peso');
  ok('⭐⭐ el resumen dice QUÉ descartó el peso (viajes $300 + jornada $200)',
    !!cu && cu.filas.length === 1 && /CAMION VOLTEO 7/.test(cu.filas[0].clave)
    // (el desglose sale en el orden de las fuentes: jornadas antes que viajes)
    && /🕐 \$200,00 \+ 🚛 \$300,00/.test(cu.filas[0].clave) && cu.filas[0].n === 500);
  ok('⭐ sin el desglose, el cuadro no sale (la regla sigue aplicando)',
    !C.resumenConsolidado(DP, { ...AUTO, desgloseAutomatico: false }).cuadros.some((x) => x.k === 'auto_peso')
    && C.totalesConsolidado(FP, { ...AUTO, desgloseAutomatico: false }).total === 2400);
  // Peso de referencia u oculto → nadie factura cero: todo vuelve a sumar.
  eq('⭐ con el peso en referencia el camión vuelve a sus viajes y jornada',
    C.totalesConsolidado(FP, { ...AUTO, fuentes: { ...AUTO.fuentes, peso: 'muestra' } }).total, 2400 - 500 + 300 + 200);
  // Apagada la selección, la suma cruda (y el archivo lo dice).
  eq('* apagada: suma cruda', C.totalesConsolidado(FP, { ...AUTO, seleccionAutomatica: false }).total, 500 + 300 + 200 + 400 + 350 + 1200 + 1150);
  // 📅 El día por día OBEDECE la decisión del rango: el día que el camión hizo
  // viajes pero no pesó, esos viajes igual no se suman (el rango dijo peso).
  const DIAS = [
    { jornada: '2026-10-19', filas: [{ ...FP[0], montos: { viajes: 300, jornadas: 200 }, cant: { viajes: 12, jornadas: 12 } }], viajes: [] },
    { jornada: '2026-10-20', filas: [{ ...FP[0], montos: { peso: 500 }, cant: { peso: 48500 } }], viajes: [] },
  ];
  const ds = C.diasConsolidados(DIAS, AUTO, FP);
  eq('⭐⭐ el día por día congela TAMBIÉN la decisión del peso (0 + 500 = 500)',
    [ds.length, Math.round(ds.reduce((a, x) => a + x.total, 0) * 100) / 100,
      C.totalesConsolidado([FP[0]], AUTO).total],
    [1, 500, 500]);
}

// ═══ ⛏️ EL MISMO NOMBRE = EL MISMO FRENTE (21-oct-2026, pregunta directa) ═════
// Los frentes viven en DOS catálogos escritos a mano (viajes y maquinaria):
// «¿si los nombres son iguales se agrupan?» — SÍ, y sin que una mayúscula o un
// acento los parta en dos. Vale para el bloque del detalle, el filtro y el ⚖️.
{
  const OPF = { ...C.OPCIONES_CONSOLIDADO_POR_DEFECTO, agruparPor: 'frente' };
  const FF = [
    { id: 'a', code: 'JUMBO 1', placa: '', empresa: 'ALFA C.A', frente: 'Túnel', montos: { jornadas: 1000 }, cant: { jornadas: 10 } },
    { id: 'b', code: 'CAMION VOLTEO TORONTO', placa: '', empresa: 'ALFA C.A', frente: 'TUNEL', montos: { viajes: 300 }, cant: { viajes: 3 } },
  ];
  const DF = { filas: FF, desde: '2026-10-19', hasta: '2026-10-21' };
  const cuerpo = C.cuerpoConsolidado(DF, OPF);
  // UN solo bloque (no «Túnel» y «TUNEL» por separado), con la máquina y el camión juntos.
  eq('⭐ «Túnel» y «TUNEL» son UN bloque en el detalle', (cuerpo.match(/⛏️ /g) || []).length, 1);
  ok('* …con la máquina y el camión adentro', /JUMBO 1/.test(cuerpo) && /CAMION VOLTEO TORONTO/.test(cuerpo));
  // El filtro tampoco distingue: marcar «tunel» (sin acento) trae a los dos.
  eq('⭐ el filtro «solo este frente» junta sin mayúsculas ni acentos',
    // (el orden es el A→Z por código: CAMION antes que JUMBO)
    C.filasElegidas(FF, { ...OPF, soloFrentes: ['tunel'] }).map((f) => f.id), ['b', 'a']);
  // Y el ⚖️ costo por tonelada cruza el viaje «túnel» con la máquina «TUNEL».
  const ct = C.costoPorTonelada(
    [{ id: 'a', code: 'JUMBO 1', placa: '', empresa: 'A', frente: 'TUNEL', montos: { jornadas: 1000 }, cant: { jornadas: 10 } }],
    C.OPCIONES_CONSOLIDADO_POR_DEFECTO,
    [{ frente_nombre: 'Túnel', peso_neto_kg: 500000 }],
  );
  eq('⭐ el ⚖️ por frente también cruza sin acentos (un solo frente, $2/t)',
    [ct.porFrente.length, ct.porFrente[0].usdPorTon], [1, 2]);
}

// ═══ 📅 LA OPERACIÓN DÍA POR DÍA (21-oct-2026, a pedido) ═════════════════════
// «Para ese reporte consolidado, que tenga una tabla operativa diaria con un
// desglose o del estilo del de viajes de camiones, y la gráfica también.»
{
  const AUTO = C.OPCIONES_CONSOLIDADO_POR_DEFECTO; // tabla y gráfico nacen prendidos
  // La misma máquina los dos días; el horómetro solo apareció el segundo día.
  const diaUno = { id: 'a', code: 'JUMBO 320', placa: 'AA11', empresa: 'ALFA C.A', frente: 'TFI', montos: { jornadas: 1200 }, cant: { jornadas: 12 } };
  const diaDos = { id: 'a', code: 'JUMBO 320', placa: 'AA11', empresa: 'ALFA C.A', frente: 'TFI', montos: { jornadas: 1200, horometros: 1150 }, cant: { jornadas: 12, horometros: 11.5 } };
  const RANGO = [{ id: 'a', code: 'JUMBO 320', placa: 'AA11', empresa: 'ALFA C.A', frente: 'TFI', montos: { jornadas: 2400, horometros: 1150 }, cant: { jornadas: 24, horometros: 11.5 } }];
  const DIAS = [
    { jornada: '2026-10-19', filas: [diaUno], viajes: [{ frente_nombre: 'TFI', peso_neto_kg: 100000 }] },
    { jornada: '2026-10-20', filas: [diaDos], viajes: [{ frente_nombre: 'TFI', peso_neto_kg: 50000 }, { frente_nombre: 'TFI', peso_neto_kg: null }] },
  ];
  const DDIA = { filas: RANGO, desde: '2026-10-19', hasta: '2026-10-20', viajesTon: [{ frente_nombre: 'TFI', peso_neto_kg: 150000 }], dias: DIAS };

  const ds = C.diasConsolidados(DIAS, AUTO, RANGO);
  eq('⭐⭐ los días van en orden y con su día de la semana (12-oct-2026 fue lunes)',
    ds.map((x) => [x.jornada, x.diaSemana]), [['2026-10-19', 'Lunes'], ['2026-10-20', 'Martes']]);
  // ⭐ EL CANDADO MÁS IMPORTANTE: la decisión 🤖 se congela con el RANGO. La
  //    máquina trajo horómetro un solo día, así que su jornada NO se cobra
  //    NINGÚN día — si el día por día volviera a decidir, el lunes cobraría
  //    jornada ($1.200) y la tabla no sumaría el TOTAL del papel.
  eq('⭐⭐ la suma del día por día = el TOTAL GENERAL del papel (decisión congelada)',
    [Math.round(ds.reduce((s, x) => s + x.total, 0) * 100) / 100, C.totalesConsolidado(RANGO, AUTO).total],
    [1150, 1150]);
  eq('⭐ el lunes quedó sin maquinaria facturando, pero su acarreo sí sale (100 t)',
    [ds[0].total, ds[0].maquinas, ds[0].toneladas, ds[1].total], [0, 0, 100, 1150]);
  eq('⭐ el viaje sin pesar cuenta como viaje y suma 0 t (regla del informe operativo)',
    [ds[1].viajes, ds[1].sinPeso, ds[1].toneladas], [2, 1, 50]);
  eq('⭐ el $/t del día usa SOLO la maquinaria de ese día ($1.150 ÷ 50 t)', ds[1].usdPorTon, 23);
  // Apagada la selección automática, cada día cobra las dos fuentes… y sigue cuadrando.
  const off = { ...AUTO, seleccionAutomatica: false };
  eq('⭐ con la selección apagada el día por día también cuadra (1200 + 2350)',
    [Math.round(C.diasConsolidados(DIAS, off, RANGO).reduce((s, x) => s + x.total, 0) * 100) / 100, C.totalesConsolidado(RANGO, off).total],
    [3550, 3550]);
  // Un día sin nada (ni plata ni viajes) no arrastra una fila de ceros.
  eq('⭐ el día sin operación NO sale (nada de filas de ceros)',
    C.diasConsolidados([...DIAS, { jornada: '2026-10-21', filas: [], viajes: [] }], AUTO, RANGO).length, 2);

  const papel = C.cuerpoConsolidado(DDIA, AUTO);
  ok('⭐ el papel trae la sección, la tabla con su fila TOTAL / PROM. y el gráfico',
    /📅 Operación día por día/.test(papel) && /TOTAL \/ PROM\. · 2 día\(s\) con operación/.test(papel) && /<svg viewBox="0 0 900 260"/.test(papel));
  ok('⭐ la tabla dice la fecha, el día, las máquinas, las toneladas y el $/t',
    /19\/10\/2026/.test(papel) && /Lunes/.test(papel) && /🚜 Máquinas/.test(papel) && /⚖️ Toneladas/.test(papel) && /\$\/t del día/.test(papel));
  ok('* las máquinas del pie son el MÁXIMO del día más cargado, no la suma', /1 \(máx\)/.test(papel));
  ok('* y avisa del viaje sin romana', /1 viaje\(s\) del rango no tienen peso de romana/.test(papel));
  // Sin los datos del día por día (una llamada vieja), la sección no sale.
  ok('⭐ sin días no hay sección (compatibilidad con el papel de antes)',
    !/📅 Operación día por día/.test(C.cuerpoConsolidado({ filas: RANGO, desde: '2026-10-19', hasta: '2026-10-20' }, AUTO)));
  // Las pastillas: cada pieza y cada columna se apaga sin dejar rastro.
  const sinTabla = C.cuerpoConsolidado(DDIA, { ...AUTO, tablaDiaria: false });
  ok('⭐ apagar la tabla deja el gráfico (y no queda ni la fila TOTAL)',
    !/TOTAL \/ PROM\./.test(sinTabla) && /<svg/.test(sinTabla));
  const sinGraf = C.cuerpoConsolidado(DDIA, { ...AUTO, graficoDiario: false });
  ok('⭐ apagar el gráfico deja la tabla', !/<svg/.test(sinGraf) && /TOTAL \/ PROM\./.test(sinGraf));
  ok('⭐ apagar las dos cosas no deja ni el título',
    !/📅 Operación día por día/.test(C.cuerpoConsolidado(DDIA, { ...AUTO, tablaDiaria: false, graficoDiario: false })));
  // (la columna se busca por su <th>: «🚜 Máquinas» también es una tarjeta del resumen)
  ok('⭐ las columnas se apagan una por una, sin rastro',
    !/Lunes/.test(C.cuerpoConsolidado(DDIA, { ...AUTO, sinDiaSemana: true }))
    && !/<th class="r">🚜 Máquinas<\/th>/.test(C.cuerpoConsolidado(DDIA, { ...AUTO, sinMaquinasDia: true }))
    && !/<th class="r">⚖️ Toneladas<\/th>/.test(C.cuerpoConsolidado(DDIA, { ...AUTO, sinToneladasDia: true }))
    && !/\$\/t del día/.test(C.cuerpoConsolidado(DDIA, { ...AUTO, sinCostoTonDia: true })));
  ok('⭐ lo apagado va al NOMBRE del archivo (regla de la casa), no al papel',
    /sin tabla diaria/.test(C.sufijoArchivoConsolidado({ ...AUTO, tablaDiaria: false }))
    && /sin gráfico/.test(C.sufijoArchivoConsolidado({ ...AUTO, graficoDiario: false }))
    && /sin toneladas por día/.test(C.sufijoArchivoConsolidado({ ...AUTO, sinToneladasDia: true }))
    && /sin \$\/t por día/.test(C.sufijoArchivoConsolidado({ ...AUTO, sinCostoTonDia: true }))
    // con la tabla apagada no se nombran sus columnas (no hay qué quitar)
    && !/sin día de la semana/.test(C.sufijoArchivoConsolidado({ ...AUTO, tablaDiaria: false, sinDiaSemana: true })));
  // ⚠️ EL CUADRE SE DICE: si la suma de los días no da el total, el papel lo canta.
  const descuadre = C.cuerpoConsolidado({
    filas: [{ id: 'a', code: 'M1', placa: '', empresa: 'A', montos: { jornadas: 1000 }, cant: { jornadas: 10 } }],
    desde: '2026-10-19', hasta: '2026-10-19',
    dias: [{ jornada: '2026-10-19', filas: [{ id: 'a', code: 'M1', placa: '', empresa: 'A', montos: { jornadas: 900 }, cant: { jornadas: 9 } }], viajes: [] }],
  }, AUTO);
  ok('⭐⭐ un descuadre entre el día por día y el TOTAL se DICE con la diferencia exacta',
    /El día por día suma \$900,00 y el TOTAL GENERAL del papel es \$1\.000,00 \(faltan \$100,00\)/.test(descuadre)
    && /Manda el TOTAL GENERAL/.test(descuadre));

  // El gráfico: barras (plata) + línea (toneladas), con su tope de días.
  eq('el tope del gráfico son 62 días', C.MAX_DIAS_GRAFICO_CONSOLIDADO, 62);
  const svg = C.graficoDiarioConsolidadoSvg(ds, AUTO);
  ok('⭐ el gráfico pinta una barra por día, la línea del acarreo y su leyenda',
    (svg.match(/<rect /g) || []).length === 2 && /<polyline points="/.test(svg)
    && /■ Barra: lo facturado del día · ● Línea: toneladas del acarreo/.test(svg));
  // Sin una sola tonelada (o con las toneladas apagadas) la línea cuenta máquinas.
  const sinTon = C.graficoDiarioConsolidadoSvg(C.diasConsolidados([{ jornada: '2026-10-20', filas: [diaDos], viajes: [] }], AUTO, RANGO), AUTO);
  ok('⭐ sin acarreo la línea cuenta máquinas (no se dibuja un cero inventado)',
    /● Línea: máquinas que facturaron/.test(sinTon));
  const largo = Array.from({ length: 63 }, (_, i) => ({ ...ds[1], jornada: `2026-08-${String((i % 28) + 1).padStart(2, '0')}` }));
  eq('⭐ con más de 62 días el gráfico no sale (serían barras ilegibles)', C.graficoDiarioConsolidadoSvg(largo, AUTO), '');
  ok('…y el papel dice por qué y qué hacer',
    /El gráfico no sale con más de 62 días/.test(C.cuerpoConsolidado({ ...DDIA, dias: largo.map((x) => ({ jornada: x.jornada, filas: [diaDos], viajes: [] })) }, AUTO)));

  // La pantalla: arma el día por día con LOS MISMOS motores (nada nuevo se consulta).
  const card = leer('src/components/ReporteConsolidadoCard.tsx');
  ok('⭐⭐ la pantalla corre la MISMA `armar` con el rango de un solo día', /filas: armar\(dd, dd\)/.test(card));
  ok('* …y le pasa los días al papel', /dias: porDia/.test(card));
  ok('* con rangos largos avisa en vez de congelarse', /dias <= MAX_DIAS_GRAFICO_CONSOLIDADO/.test(card));
  ok('* la pantalla tiene las pastillas de la tabla y del gráfico',
    /📅 Tabla operativa diaria/.test(card) && /📈 Gráfico del día por día/.test(card));
}

// ═══ 🏗️🚛 COLUMNAS MAQUINARIA · ACARREO (22-oct-2026, a pedido) ══════════════
// «que a la hora de sacar el reporte solo estén las columnas de maquinaria y
// acarreo… y aun así que yo pueda activar y desactivar las subopciones».
{
  const OPG = { ...OP, columnasPorGrupo: true };
  ok('⭐ nace AGRUPADO (es el pedido)', C.OPCIONES_CONSOLIDADO_POR_DEFECTO.columnasPorGrupo === true);
  const html = C.cuerpoConsolidado(DC, OPG);
  ok('⭐⭐ el papel trae SOLO las columnas Maquinaria y Acarreo',
    html.includes('<th class="r">🏗️ Maquinaria</th>') && html.includes('<th class="r">🚛 Acarreo</th>')
    && !/<th class="r">(🕐 Jornadas|⚙️ Horómetros|🚛 Viajes|⚖️ Peso)/.test(html));
  const cols = C.columnasPapel(OPG);
  const t = C.totalesConsolidado(F, OPG);
  eq('⭐ Maquinaria = jornadas + horómetros; Acarreo = viajes + peso', cols.map((c) => [c.k, C.montoColumna(c, t.porFuente)]), [['maquinaria', 1500], ['acarreo', 650]]);
  eq('⭐ el TOTAL no cambia ni un centavo', t.total, 2150);
  eq('⭐ el respaldo junta las horas y deja viajes y toneladas aparte',
    cols.map((c) => C.cantColumna(c, C.totalesConsolidado(FC, OPG).cantPorFuente)), ['46,5 h', '12 viajes · 48,50 t']);
  // Las subopciones siguen mandando.
  const horoRef = { ...OPG, fuentes: { ...OPG.fuentes, horometros: 'muestra' } };
  const cR = C.columnasPapel(horoRef);
  eq('⭐ horómetro «sin sumar»: Maquinaria suma solo la jornada', C.montoColumna(cR[0], t.porFuente), 1000);
  ok('…y lo «sin sumar» se dice debajo, sin entrar al monto', C.cuerpoConsolidado(D, horoRef).includes('ref, no suma: ⚙️ $500,00'));
  const sinMaq = { ...OPG, fuentes: { ...OPG.fuentes, jornadas: 'oculta', horometros: 'oculta' } };
  ok('⭐ jornadas y horómetros ocultos: la columna Maquinaria no sale', !C.cuerpoConsolidado(D, sinMaq).includes('🏗️ Maquinaria') && C.columnasPapel(sinMaq).length === 1);
  const acaRef = { ...OPG, fuentes: { ...OPG.fuentes, viajes: 'muestra', peso: 'muestra' } };
  ok('⭐ todo el acarreo «sin sumar»: la columna sale (ref)', C.cuerpoConsolidado(D, acaRef).includes('🚛 Acarreo (ref)') && C.totalesConsolidado(F, acaRef).total === 1500);
  const r = C.resumenConsolidado(D, OPG);
  ok('⭐ las tarjetas del resumen también son Maquinaria y Acarreo',
    r.tarjetas.some((x) => x.k === 'grupo_maquinaria') && r.tarjetas.some((x) => x.k === 'grupo_acarreo') && !r.tarjetas.some((x) => /^fuente_/.test(x.k)));
  ok('el membrete habla de maquinaria + acarreo', /maquinaria \+ acarreo/.test(C.subtituloConsolidado(D, OPG, false)));
  ok('⭐ apagado vuelve a una columna por fuente (y va al nombre del archivo)',
    C.cuerpoConsolidado(D, OP).includes('<th class="r">🕐 Jornadas</th>') && /columnas por fuente/.test(C.sufijoArchivoConsolidado(OP))
    && !/columnas por fuente/.test(C.sufijoArchivoConsolidado(OPG)));
  // Encabezado y filas cuadran: el mismo nº de celdas en cada fila de la matriz.
  const matriz = html.slice(html.indexOf('📑 Detalle'));
  const tablas = matriz.split('<table>').slice(1);
  ok('* cada tabla del detalle cuadra (th = td por fila)', tablas.every((tb) => {
    const nTh = (tb.match(/<th[ >]/g) || []).length;
    const filas = tb.split('<tr').slice(1).filter((x) => !/<th/.test(x) && !/colspan/.test(x));
    return filas.every((f) => (f.match(/<td[ >]/g) || []).length === nTh || nTh === 0);
  }));
  const card = leer('src/components/ReporteConsolidadoCard.tsx');
  ok('* la pantalla tiene su interruptor y conserva las 4 pastillas de fuentes',
    /columnasPorGrupo: !p\.columnasPorGrupo/.test(card) && /FUENTES_ORDEN\.map\(\(k\) =>/.test(card));
}

// ═══ ⚖️ COSTO POR TONELADA SOBRE TODO EL ACARREO (22-oct-2026, a pedido) ══════
// «en vez de darme el desglose por lo que acarreó cada frente, que en base a la
// sumatoria de todo lo acarreado en el rango haga las cuentas».
{
  const FT = [
    { id: 'x', code: 'EXCAVADORA 1', placa: '', empresa: 'A', frente: 'CANTERA NORTE', montos: { horometros: 1000 }, cant: { horometros: 10 } },
    { id: 'y', code: 'EXCAVADORA 2', placa: '', empresa: 'A', frente: 'MUELLE SUR', montos: { horometros: 500 }, cant: { horometros: 5 } },
    { id: 'z', code: 'EXCAVADORA 3', placa: '', empresa: 'A', frente: 'PATIO OESTE', montos: { horometros: 300 }, cant: { horometros: 3 } },
  ];
  const VT = [
    { frente_nombre: 'CANTERA NORTE', peso_neto_kg: 600000 },
    { frente_nombre: 'MUELLE SUR', peso_neto_kg: 400000 },
  ];
  const DT = { filas: FT, desde: '2026-10-19', hasta: '2026-10-20', viajesTon: VT };
  const AUTO = C.OPCIONES_CONSOLIDADO_POR_DEFECTO;
  ok('⭐ nace prendido', AUTO.costoTonAcarreoTotal === true);
  const r = C.resumenConsolidado(DT, AUTO);
  const cq = r.cuadros.find((c) => c.k === 'ton_acarreo_total');
  // 1.000 t en total: $1.000 ÷ 1.000 = 1,00 · $500 ÷ 1.000 = 0,50 · $300 ÷ 1.000 = 0,30 · TOTAL $1.800 ÷ 1.000 = 1,80
  eq('⭐⭐ cada frente divide SU maquinaria entre TODO el acarreo, y cierra con el TOTAL', cq?.filas.map((f) => f.n), [1, 0.5, 0.3, 1.8]);
  ok('⭐ el frente con maquinaria y sin toneladas propias SÍ entra (el divisor es el de todos)', cq?.filas.some((f) => /PATIO OESTE/.test(f.clave)));
  ok('⭐ la fila TOTAL es la misma cifra de la tarjeta ⚖️', r.tarjetas.find((x) => x.k === 'costo_ton')?.valor.startsWith('$1,80'));
  ok('* el cuadro frente por frente de antes sigue igual, arriba del nuevo',
    r.cuadros.findIndex((c) => c.k === 'ton_frente') >= 0 && r.cuadros.findIndex((c) => c.k === 'ton_frente') < r.cuadros.findIndex((c) => c.k === 'ton_acarreo_total'));
  const html = C.cuerpoConsolidado(DT, AUTO);
  ok('⭐ en el papel: su título con las toneladas y la fila TOTAL resaltada',
    /Costo por tonelada sobre todo el acarreo del rango \(1\.000,00 t\)/.test(html) && /<tr class="tot"><td>TOTAL — \$1\.800,00 de maquinaria ÷ 1\.000,00 t<\/td>/.test(html));
  ok('⭐ se apaga sola, sin tocar el cuadro de antes',
    !C.resumenConsolidado(DT, { ...AUTO, costoTonAcarreoTotal: false }).cuadros.some((c) => c.k === 'ton_acarreo_total')
    && C.resumenConsolidado(DT, { ...AUTO, costoTonAcarreoTotal: false }).cuadros.some((c) => c.k === 'ton_frente'));
  ok('* sin toneladas en el rango no divide (no inventa)', !C.resumenConsolidado({ ...DT, viajesTon: [] }, AUTO).cuadros.some((c) => c.k === 'ton_acarreo_total'));
  ok('* la pantalla tiene su interruptor', /costoTonAcarreoTotal: !p\.costoTonAcarreoTotal/.test(leer('src/components/ReporteConsolidadoCard.tsx')));
}

if (fail) {
  console.error(failures.join('\n'));
  console.error(`\n✗ reporte consolidado: ${fail} fallo(s), ${pass} ok`);
  process.exit(1);
}
console.log(`✓ reporte consolidado: ${pass} pruebas ok`);
