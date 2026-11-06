// ⛽ Combustible (02-nov-2026): reportes personalizables de Consumos y Entradas.
// Transpila src/lib/combustibleReportes.ts (y fuelRules.ts) con TypeScript y
// prueba la lógica pura con datos SINTÉTICOS; luego revisa el código fuente.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comb-rep-'));
for (const f of ['combustibleReportes', 'fuelRules']) {
  const src = fs.readFileSync(path.join(raiz, 'src/lib', `${f}.ts`), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  // fuelRules usa react-native solo para abrir enlaces: se cambia por un sustituto.
  js = js.replace(/import \{[^}]*\} from 'react-native';/, "const Linking = {}; const Platform = { OS: 'web' };");
  fs.writeFileSync(path.join(tmp, `${f}.mjs`), js);
}
const R = await import(pathToFileURL(path.join(tmp, 'combustibleReportes.mjs')).href);

// ── Rango ──
ok('enRango día', R.enRango('2026-01-05', '2026-01-05'));
ok('enRango fuera', !R.enRango('2026-01-06', '2026-01-05'));
ok('enRango rango', R.enRango('2026-01-06T10:00:00', '2026-01-05', '2026-01-07'));
ok('enRango invertido', R.enRango('2026-01-06', '2026-01-07', '2026-01-05'));
ok('enRango vacío', !R.enRango(null, '2026-01-05'));

// ── Consumos sintéticos ──
const consumos = [
  { id: 1, dispatch_date: '2026-01-05', created_at: '2026-01-05T12:00:00Z', liters: 100, machinery_id: 'm1', machine: { code: 'EQ-01', plate: 'AAA000', serial: 'S1' }, total_amount: 50 },
  { id: 2, dispatch_date: '2026-01-05', created_at: '2026-01-05T11:00:00Z', liters: 40.5, machinery_id: 'm1', machine: { code: 'EQ-01', plate: 'AAA000', serial: 'S1' } },
  { id: 3, dispatch_date: '2026-01-05', liters: 30, vehicle_id: 'v1', vehicle: { plate: 'BBB111', name: 'Camioneta prueba' } },
  { id: 4, dispatch_date: '2026-01-05', liters: 20, apoyo_nombre: 'Grúa de apoyo' },
  { id: 5, dispatch_date: '2026-01-05', liters: 999, driver_operator: '[AJUSTE_TANQUE_OCULTO] Ajuste de nivel' },
  { id: 6, dispatch_date: '2026-01-06', liters: 10, machinery_id: 'm2', machine: { code: 'EQ-02' } },
];
const dia5 = R.filtrarConsumos(consumos, '2026-01-05');
ok('filtra día y quita ajustes', dia5.length === 4 && !dia5.some((d) => d.id === 5 || d.id === 6));
ok('ordena por hora', dia5.findIndex((d) => d.id === 2) < dia5.findIndex((d) => d.id === 1));
ok('rango incluye el 6', R.filtrarConsumos(consumos, '2026-01-05', '2026-01-06').length === 5);

const apoyo = R.equipoDeConsumo(consumos[3]);
ok('apoyo sale con 🆘', apoyo.tipo === 'apoyo' && apoyo.nombre === '🆘 Grúa de apoyo');
ok('maquinaria con placa y serial', R.equipoDeConsumo(consumos[0]).placa === 'AAA000' && R.equipoDeConsumo(consumos[0]).serial === 'S1');
ok('vehículo', R.equipoDeConsumo(consumos[2]).tipo === 'vehiculo');
ok('máquina gana a apoyo', R.equipoDeConsumo({ machinery_id: 'x', apoyo_nombre: 'Otro' }).tipo === 'maquinaria');

const tot = R.totalesPorEquipo(dia5);
ok('totales por equipo', tot.length === 3 && tot[0].nombre === 'EQ-01' && tot[0].litros === 140.5 && tot[0].surtidos === 2 && tot[0].monto === 50);
const s = R.seriesConsumos(dia5);
ok('serie por día', s.porDia.length === 1 && s.porDia[0].value === 190.5);
ok('serie por equipo ordenada', s.porEquipo[0].label === 'EQ-01' && s.porEquipo.some((b) => b.label === '🆘 Grúa de apoyo'));
ok('total consumos', s.total === 190.5);

// ── Entradas sintéticas ──
const entradas = [
  { id: 'a', intake_date: '2026-01-05', liters: 1000, tank_id: 't1', supplier: 'Proveedor A', total_cost: 500 },
  { id: 'b', intake_date: '2026-01-05', liters: 500, tank_id: 't2', supplier: '' },
  { id: 'c', intake_date: '2026-01-05', liters: 50, tank_id: 't1', supplier: '[AJUSTE_TANQUE_OCULTO] Ajuste de nivel en tanque' },
  { id: 'd', intake_date: '2026-01-07', liters: 70, tank_id: 't1', supplier: 'Proveedor A' },
];
const e5 = R.filtrarEntradas(entradas, '2026-01-05');
ok('entradas sin ajuste', e5.length === 2);
const se = R.seriesEntradas(e5, (id) => ({ t1: 'Tanque Uno', t2: 'Tanque Dos' }[id] || ''));
ok('por tanque', se.porTanque[0].label === 'Tanque Uno' && se.porTanque[0].value === 1000);
ok('sin proveedor', se.porProveedor.some((b) => b.label === 'Sin proveedor'));
ok('total y costo', se.total === 1500 && se.costo === 500);

// ── Opciones ──
const m = R.mezclarOpciones(R.OPCIONES_REPORTE_CONSUMOS, { graficas: false, raro: true, placa: 'si' });
ok('guardada se respeta', m.graficas === false);
ok('basura ignorada', !('raro' in m) && m.placa === true);
ok('sin guardadas = fábrica', R.mezclarOpciones(R.OPCIONES_REPORTE_ENTRADAS, null).tabla === true);
for (const k of ['graficas', 'tabla', 'placa', 'serial', 'horometro', 'contador', 'tanque', 'operador', 'monto', 'nota', 'totales']) {
  ok(`opción consumos ${k}`, R.OPCIONES_REPORTE_CONSUMOS.some((o) => o.key === k));
}
for (const k of ['graficas', 'tabla', 'proveedor', 'factura', 'tanque', 'costoUnitario', 'costoTotal', 'nota', 'totales']) {
  ok(`opción entradas ${k}`, R.OPCIONES_REPORTE_ENTRADAS.some((o) => o.key === k));
}
for (const k of ['resumen', 'hora', 'placa', 'serial', 'tanque', 'contador', 'horometro', 'autorizado', 'nota', 'totalesEquipo', 'firmas', 'marcaTexto']) {
  ok(`opción parte diario ${k}`, R.OPCIONES_REPORTE_PARTE_DIARIO.some((o) => o.key === k));
}
for (const k of ['kpis', 'graficas', 'totales', 'tabla', 'hora', 'placa', 'serial', 'empresa', 'tanque', 'contador', 'horometro', 'operador', 'monto', 'nota', 'firmas', 'marcaTexto']) {
  ok(`opción apoyo ${k}`, R.OPCIONES_REPORTE_APOYO.some((o) => o.key === k));
}
for (const k of ['meta', 'tipoCombustible', 'saldoInicial', 'entradas', 'despachos', 'traslados', 'saldoTeorico', 'saldoFisico', 'diferencia', 'observaciones', 'firmas', 'marcaTexto']) {
  ok(`opción conciliación ${k}`, R.OPCIONES_REPORTE_CONCILIACION.some((o) => o.key === k));
}
for (const k of ['fecha', 'activo', 'placa', 'serial', 'tipo', 'empresa', 'tanque', 'litros', 'estado', 'solicita', 'motivo', 'totales', 'firmas', 'marcaTexto']) {
  ok(`opción solicitudes ${k}`, R.OPCIONES_REPORTE_SOLICITUDES.some((o) => o.key === k));
}
ok('catálogo 5 logos membrete', R.LOGOS_COMBUSTIBLE_CATALOGO.length === 5 && R.LOGOS_COMBUSTIBLE_CATALOGO.some((l) => l.key === 'jhenzaen'));
const logosMezcla = R.mezclarLogosCombustible({ bcv: false, golden: true, raro: true });
ok('mezclarLogosCombustible respeta e ignora basura', logosMezcla.bcv === false && logosMezcla.golden === true && logosMezcla.sos === true && !('raro' in logosMezcla));
const soloApoyo = R.filtrarConsumosApoyo(consumos, '2026-01-05');
ok('filtrarConsumosApoyo deja solo máquinas de apoyo', soloApoyo.length === 1 && soloApoyo[0].apoyo_nombre === 'Grúa de apoyo');
const totApoyo = R.totalesPorMaquinaApoyo(soloApoyo);
ok('totalesPorMaquinaApoyo agrupa y suma', totApoyo.length === 1 && totApoyo[0].litros === 20 && totApoyo[0].surtidos === 1);
const serApoyo = R.seriesApoyo(soloApoyo);
ok('seriesApoyo calcula porEquipo y total', serApoyo.total === 20 && serApoyo.porEquipo.length === 1 && serApoyo.porEquipo[0].label.includes('Grúa de apoyo'));
ok('diaAnterior', R.diaAnterior('2026-03-01') === '2026-02-28');
ok('fecha válida', R.esFechaValida('2026-01-05') && !R.esFechaValida('05/01/2026'));

// ── Fuente ──
const leer = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');
const pdf = leer('src/lib/combustibleReportesPdf.ts');
const disp = leer('src/screens/redesign/DispatchesPilot.tsx');
const intk = leer('src/screens/redesign/IntakesPilot.tsx');
const modal = leer('src/components/combustible/OpcionesReporteCombustibleModal.tsx');
ok('pdf usa exportPdf', /exportPdf\(/.test(pdf));
ok('pdf no anuncia lo oculto', !/oculto/i.test(pdf));
ok('pdf horómetro por jornada', /jornadaDeDespacho/.test(pdf) && /claveHorometro/.test(pdf));
ok('consumos: botón y modal', /🖨️ Reporte/.test(disp) && /OpcionesReporteCombustibleModal/.test(disp));
ok('consumos: horómetro solo lectura', /cargarHorometros/.test(disp) && !/machine_rounds/.test(disp));
ok('consumos: no nombra apoyo_ en select', !/select[^\n]*apoyo_/.test(disp) && !/apoyo_nombre[^\n]*\.(insert|update|eq)\(/.test(disp));
ok('entradas: botón y modal', /🖨️ Reporte/.test(intk) && /OpcionesReporteCombustibleModal/.test(intk));
ok('modal: AsyncStorage con try', /AsyncStorage/.test(modal) && /try\s*\{/.test(modal));
ok('modal: zIndex 9999 y maxWidth', /zIndex: 9999/.test(modal) && /maxWidth: 520/.test(modal));
ok('modal al final (consumos)', disp.lastIndexOf('<OpcionesReporteCombustibleModal') > disp.lastIndexOf('</RList>') || disp.lastIndexOf('<OpcionesReporteCombustibleModal') > disp.indexOf('renderItem'));
ok('manual md', /reportes de Consumos y de Entradas/.test(leer('docs/MANUAL-USUARIO.md')));
ok('manual pantalla', /REPORTES DE CONSUMOS Y DE ENTRADAS/.test(leer('src/screens/ManualScreen.tsx')));

fs.rmSync(tmp, { recursive: true, force: true });
if (failures.length) console.log('Fallas:\n - ' + failures.join('\n - '));
console.log(`${pass} ok, ${fail} fallas`);
process.exit(fail ? 1 : 0);
