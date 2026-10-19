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
const OP = C.OPCIONES_CONSOLIDADO_POR_DEFECTO;
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
    && C.sufijoArchivoConsolidado(OP) === '');
  ok('texto escapado en el papel', !C.cuerpoConsolidado({ ...D, filas: [{ ...F[0], code: '<script>x</script>' }] }, OP).includes('<script>'));
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

if (fail) {
  console.error(failures.join('\n'));
  console.error(`\n✗ reporte consolidado: ${fail} fallo(s), ${pass} ok`);
  process.exit(1);
}
console.log(`✓ reporte consolidado: ${pass} pruebas ok`);
