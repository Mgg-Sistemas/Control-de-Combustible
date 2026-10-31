// ⛽🧭 Pruebas del REPORTE PERSONALIZADO: rango, consumo de combustible y Este/Oeste
// (30-oct-2026).
//
// Pedido: «que tome información de rango, que se traiga el consumo de combustible
// y la ubicación Este u Oeste, y poder colocarlo o quitarlo del reporte».
//
// Qué se vigila:
//   1. La suma de litros por máquina en el rango (ambos días incluidos) y que sea
//      LA MISMA que da `loadFuelByMachine` (Control de Maquinaria / Supervisión).
//   2. El día: `dispatch_date` es una FECHA sin hora (la jornada que eligió quien
//      registró). Un surtido registrado a las 5am con fecha del día anterior cuenta
//      en ese día anterior; no se re-corta por la hora de registro.
//   3. Columnas que se ponen y se quitan sin dejar rastro, y el total al pie.
//   4. Este/Oeste: la regla de 📍 Ubicaciones, con la ficha como respaldo.
// Datos inventados: el repositorio es público.
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

// `fuelPerMachine.ts` importa el cliente de Supabase: se le pone uno de mentira que
// aplica los mismos filtros que la consulta (asset_kind, gte, lte) sobre filas fijas.
let FILAS_DB = [];
const fakeSupabase = {
  selectAllRows: async (_tabla, _cols, build) => {
    const f = { kind: null, gte: null, lte: null };
    const q = {
      eq(c, v) { if (c === 'asset_kind') f.kind = v; return q; },
      gte(c, v) { if (c === 'dispatch_date') f.gte = v; return q; },
      lte(c, v) { if (c === 'dispatch_date') f.lte = v; return q; },
    };
    if (build) build(q);
    return FILAS_DB.filter((r) => (!f.kind || r.asset_kind === f.kind)
      && (!f.gte || r.dispatch_date >= f.gte) && (!f.lte || r.dispatch_date <= f.lte));
  },
};
cache.set(path.join(ROOT, 'src/lib/supabase.ts'), fakeSupabase);

const L = loadTs(path.join(ROOT, 'src/lib/reporteMaquinariaPersonalizado.ts'));
const U = loadTs(path.join(ROOT, 'src/lib/ubicacionesReporte.ts'));
const F = loadTs(path.join(ROOT, 'src/lib/fuelPerMachine.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ——— 1. Suma de litros por máquina en el rango ———
const despachos = [
  { machinery_id: 'm1', liters: 100, dispatch_date: '2026-10-01', asset_kind: 'maquinaria' },
  { machinery_id: 'm1', liters: '50.5', dispatch_date: '2026-10-03', asset_kind: 'maquinaria' },
  { machinery_id: 'm1', liters: 70, dispatch_date: '2026-10-04', asset_kind: 'maquinaria' }, // fuera (después)
  { machinery_id: 'm2', liters: 200, dispatch_date: '2026-09-30', asset_kind: 'maquinaria' }, // fuera (antes)
  { machinery_id: 'm2', liters: 30, dispatch_date: '2026-10-02', asset_kind: 'maquinaria' },
  { machinery_id: null, liters: 999, dispatch_date: '2026-10-02', asset_kind: 'maquinaria' }, // sin máquina
  { machinery_id: 'm3', liters: 'basura', dispatch_date: '2026-10-02', asset_kind: 'maquinaria' }, // litros ilegibles = 0
];
const suma = L.sumarLitrosPorMaquina(despachos, '2026-10-01', '2026-10-03');
eq('suma por máquina: ambos extremos del rango cuentan', suma, { m1: 150.5, m2: 30, m3: 0 });
eq('rango al revés se endereza', L.sumarLitrosPorMaquina(despachos, '2026-10-03', '2026-10-01'), suma);
eq('rango de un solo día', L.sumarLitrosPorMaquina(despachos, '2026-10-02', '2026-10-02'), { m2: 30, m3: 0 });
eq('rango ilegible → nada', L.sumarLitrosPorMaquina(despachos, 'ayer', 'hoy'), {});
eq('rangoOrdenado: sin «hasta» vale el «desde»', L.rangoOrdenado('2026-10-05', ''), { desde: '2026-10-05', hasta: '2026-10-05' });

// ——— 2. El día del surtido: la fecha guardada, no la hora de registro ———
// Surtido registrado el 02-oct a las 05:00 (Caracas) con fecha de jornada 01-oct:
// la fila trae dispatch_date = 01-oct y así se cuenta — igual que las pantallas de combustible.
const madrugada = [{ machinery_id: 'm9', liters: 40, dispatch_date: '2026-10-01', created_at: '2026-10-02T09:00:00Z' }];
eq('🕖 la madrugada cuenta en la fecha del surtido (jornada anterior)', L.sumarLitrosPorMaquina(madrugada, '2026-10-01', '2026-10-01'), { m9: 40 });
eq('🕖 …y no se cuela en el día calendario del registro', L.sumarLitrosPorMaquina(madrugada, '2026-10-02', '2026-10-02'), {});

// ——— 3. ⭐ Paridad con loadFuelByMachine (la consulta canónica) ———
FILAS_DB = [...despachos.filter((d) => d.machinery_id && d.liters !== 'basura'),
  { machinery_id: 'v1', liters: 80, dispatch_date: '2026-10-02', asset_kind: 'vehiculo' }]; // otro tipo: no entra
const agg = await F.loadFuelByMachine('2026-10-01', '2026-10-03');
const deAgg = Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, v.liters]));
eq('⭐ loadFuelByMachine da lo mismo que la suma pura', deAgg, L.sumarLitrosPorMaquina(FILAS_DB.filter((d) => d.asset_kind === 'maquinaria'), '2026-10-01', '2026-10-03'));

// ——— 4. Formato y lectura de litros (formato venezolano) ———
eq('litrosTexto: miles con punto y decimal con coma', L.litrosTexto(1234.5), '1.234,5');
eq('litrosTexto: entero sin decimales', L.litrosTexto(800), '800');
eq('litrosTexto: cero sale «0» (es un dato)', L.litrosTexto(0), '0');
eq('litrosTexto: sin dato → vacío', L.litrosTexto(null), '');
eq('leerLitros «1.234,5»', L.leerLitros('1.234,5'), 1234.5);
eq('leerLitros «1234.5»', L.leerLitros('1234.5'), 1234.5);
eq('leerLitros «1.234» (miles)', L.leerLitros('1.234'), 1234);
eq('leerLitros «1,5»', L.leerLitros('1,5'), 1.5);
eq('leerLitros «800 L»', L.leerLitros('800 L'), 800);
eq('leerLitros «1,234.5» (al estilo inglés)', L.leerLitros('1,234.5'), 1234.5);
eq('leerLitros vacío o texto → 0', [L.leerLitros(''), L.leerLitros('—'), L.leerLitros('sin dato')], [0, 0, 0]);
eq('ida y vuelta: leer(texto(n)) = n', [0.25, 15, 1500.75, 123456.5].map((n) => L.leerLitros(L.litrosTexto(n))), [0.25, 15, 1500.75, 123456.5]);

// ——— 5. Aplicar los datos del rango a las filas ———
const fila = (id, extra = {}) => ({ ...L.filaVacia(id), code: id.toUpperCase(), ...extra });
const datos = { litros: { m1: 150.5 }, cardinal: { m1: 'Este · Macuto' } };
eq('fila de máquina: recibe litros y cardinal', (() => { const f = L.aplicarDatosDelRango(fila('m1'), datos); return [f.litros, f.cardinal]; })(), ['150,5', 'Este · Macuto']);
eq('máquina sin surtidos en el rango: «0», no hueco', L.aplicarDatosDelRango(fila('m2'), datos).litros, '0');
eq('máquina sin cardinal conocido: vacío (no se inventa)', L.aplicarDatosDelRango(fila('m2'), datos).cardinal, '');
eq('✋ lo corregido a mano NO se pisa', L.aplicarDatosDelRango(fila('m1', { litros: '99' }), datos, new Set(['m1|litros'])).litros, '99');
eq('✋ …pero el otro campo sí se actualiza', L.aplicarDatosDelRango(fila('m1', { litros: '99' }), datos, new Set(['m1|litros'])).cardinal, 'Este · Macuto');
eq('fila manual: no se toca', L.aplicarDatosDelRango(fila('manual-1', { litros: '5' }), datos).litros, '5');
eq('vehículo: no se toca (los despachos son de maquinaria)', L.aplicarDatosDelRango(fila('veh-1'), datos).litros, '');
eq('fuente sin cargar (null): no se toca', L.aplicarDatosDelRango(fila('m1', { cardinal: 'Oeste' }), { litros: null, cardinal: null }).cardinal, 'Oeste');
const igual = fila('m1', { litros: '150,5', cardinal: 'Este · Macuto' });
ok('sin cambios devuelve la MISMA fila (no re-pinta)', L.aplicarDatosDelRango(igual, datos) === igual);
eq('total de litros: suma lo que quedó en el papel', L.totalLitrosPersonalizado([fila('a', { litros: '1.000,5' }), fila('b', { litros: '20' }), fila('c', { litros: '' })]), 1020.5);
eq('cardinalTexto', [L.cardinalTexto('ESTE', 'Macuto'), L.cardinalTexto('OESTE', ''), L.cardinalTexto('', 'Macuto')], ['Este · Macuto', 'Oeste', '']);

// ——— 6. El papel: columnas que se ponen y se quitan ———
const filas = [fila('m1', { litros: '1.000,5', cardinal: 'Este · Macuto' }), fila('m2', { litros: '20', cardinal: 'Oeste · Catia La Mar' })];
const o = (c) => ({ ...L.OPCIONES_PERSONALIZADO_INICIAL, ...c });
const base = L.cuerpoReportePersonalizado({ filas, opciones: L.OPCIONES_PERSONALIZADO_INICIAL });
ok('⭐ nacen apagadas: el papel de siempre no cambia', !base.includes('Combustible (L)') && !base.includes('Este / Oeste') && !base.includes('Litros de combustible'));
ok('⭐ lo apagado no deja rastro (ni «oculto» ni «sin combustible»)', !/ocult|sin combustible|sin este/i.test(base));
eq('usaRango: apagado = no exige rango', L.usaRangoPersonalizado(L.OPCIONES_PERSONALIZADO_INICIAL), false);
const conC = L.cuerpoReportePersonalizado({ filas, opciones: o({ sinConsumo: false }) });
ok('encender consumo trae la columna y los litros', conC.includes('<th>Combustible (L)</th>') && conC.includes('1.000,5'));
ok('…con el total al pie, debajo de su columna', conC.includes('1.020,5 L</td>') && /TOTAL: 2 equipo\(s\)<\/td><td class="c">1\.020,5 L/.test(conC));
ok('…y el cuadro «Litros de combustible» en el resumen', conC.includes('Litros de combustible'));
eq('usaRango: con consumo, el rango sale en el subtítulo', L.usaRangoPersonalizado(o({ sinConsumo: false })), true);
// El pie suma exactamente tantas columnas como la cabecera.
const colsCab = (conC.match(/<th>/g) || []).length;
const pie = conC.slice(conC.indexOf('<tfoot>'));
const colsPie = [...pie.matchAll(/<td(?: colspan="(\d+)")?/g)].reduce((a, m) => a + Number(m[1] || 1), 0);
eq('el pie cuadra con la cabecera (con notas después de litros)', colsPie, colsCab);
const conNotas = L.cuerpoReportePersonalizado({ filas, opciones: o({ sinConsumo: false, sinNotas: false }) });
const pieN = conNotas.slice(conNotas.indexOf('<tfoot>'));
eq('el pie cuadra con la cabecera (con notas)', [...pieN.matchAll(/<td(?: colspan="(\d+)")?/g)].reduce((a, m) => a + Number(m[1] || 1), 0), (conNotas.match(/<th>/g) || []).length);
const sinTot = L.cuerpoReportePersonalizado({ filas, opciones: o({ sinConsumo: false, sinTotalConsumo: true }) });
ok('🚫 Total de litros: la columna sigue, el total no', sinTot.includes('<th>Combustible (L)</th>') && !sinTot.includes('1.020,5') && !sinTot.includes('Litros de combustible'));
const conE = L.cuerpoReportePersonalizado({ filas, opciones: o({ sinCardinal: false }) });
ok('encender Este / Oeste trae la columna', conE.includes('<th>Este / Oeste</th>') && conE.includes('Oeste · Catia La Mar'));
ok('Este / Oeste sin consumo: sin total de litros', !conE.includes('Litros de combustible') && !conE.includes(' L</td>'));
ok('⭐⭐ ni un signo de dinero aun con todo encendido', !/\$|USD|[Mm]onto|[Tt]arifa|factur/.test(L.cuerpoReportePersonalizado({ filas, opciones: o({ sinConsumo: false, sinCardinal: false }) })));
eq('el archivo nombra lo encendido', L.sufijoArchivoPersonalizado('2026-10-30', o({ sinConsumo: false, sinCardinal: false })), '30/10/2026 · con combustible · con este-oeste');

// ——— 7. Este/Oeste: la regla de Ubicaciones con la ficha de respaldo ———
const maq = (id, extra = {}) => ({ id, code: id, marca: '', modelo: '', placa: '', empresa: '', clasificacion: '', referenciaActual: '', ...extra });
const maquinas = [
  maq('a', { referenciaActual: 'Obra de prueba - CATIA LA MAR' }),   // con actividad en el rango
  maq('b', { referenciaActual: 'PATIO - CAMURI CHICO' }),            // sin actividad: su obra
  maq('c', { cardinalFicha: 'Oeste' }),                              // sin actividad: la ficha
  maq('d', { cardinalFicha: 'Escuela de prueba' }),                  // ficha sin cardinal: nada
  maq('e', { sectorActual: 'Este · Macuto', referenciaActual: 'Obra X - CATIA LA MAR' }), // GPS de hoy manda
];
const filasUbic = U.armarUbicaciones({
  desde: '2026-10-01', hasta: '2026-10-02', maquinas,
  puntos: [], cambios: [], visitas: [],
  rondas: [{ machineryId: 'a', fecha: '2026-10-02', dia: 10, noche: 0, parada: 0, estado: null, inspectorDia: null, inspectorNoche: null }],
  hayBitacora: false,
});
const cm = U.cardinalPorMaquina(maquinas, filasUbic);
eq('con actividad: lo mismo que el resumen de Ubicaciones', cm.get('a'), { cardinal: 'OESTE', area: 'Catia La Mar' });
eq('sin actividad: el área de su obra', cm.get('b'), { cardinal: 'ESTE', area: 'Camurí Chico' });
eq('sin actividad: la ficha si dice Este u Oeste', cm.get('c'), { cardinal: 'OESTE', area: '' });
eq('ficha sin cardinal: NO se inventa', cm.has('d'), false);
eq('el GPS de hoy del catálogo gana a la obra', cm.get('e'), { cardinal: 'ESTE', area: 'Macuto' });

// ——— 8. Candados sobre el código ———
const srcCard = fs.readFileSync(path.join(ROOT, 'src/components/ReporteMaquinariaPersonalizadoCard.tsx'), 'utf8');
ok('⭐ los litros salen de loadFuelByMachine (la consulta de Control y Supervisión)', /from '\.\.\/lib\/fuelPerMachine'/.test(srcCard) && /loadFuelByMachine\(rango\.desde, rango\.hasta\)/.test(srcCard));
ok('⭐ el Este/Oeste sale de la regla de Ubicaciones', /cargarDatosUbicaciones\(rango\.desde, rango\.hasta\)/.test(srcCard) && /cardinalPorMaquina\(/.test(srcCard));
ok('solo se consulta con la columna encendida', /if \(opciones\.sinConsumo \|\| !rango\.desde\)/.test(srcCard) && /if \(opciones\.sinCardinal \|\| !rango\.desde\)/.test(srcCard));
ok('una respuesta tardía no pisa un rango más nuevo', /n !== pedidoLitros\.current/.test(srcCard) && /n !== pedidoCardinal\.current/.test(srcCard));
ok('⭐⭐⭐ sigue sin escribir en la base', !/\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(/.test(srcCard) && !/supabase\s*\.\s*from\(/.test(srcCard));
ok('con columnas del rango encendidas, el rango va al subtítulo', /const rangoEnPapel = conRango \|\| usaRango;/.test(srcCard));
const srcFuel = fs.readFileSync(path.join(ROOT, 'src/lib/fuelPerMachine.ts'), 'utf8');
ok('loadFuelByMachine sigue filtrando por dispatch_date (fecha del surtido)', /gte\('dispatch_date', fromDate\)\.lte\('dispatch_date', to\)/.test(srcFuel));

console.log(`\n⛽🧭 Reporte personalizado · combustible y Este/Oeste: ${pass} OK · ${fail} FALLO(S)`);
if (fail) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
