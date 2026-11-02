// 🧾 Combustible (02-nov-2026): desglose del rango en Conciliación (consumos +
// entradas) y horómetro de los inspectores. Transpila las libs REALES y las prueba
// con datos SINTÉTICOS; luego revisa el código fuente.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comb-conc-'));
const CARACAS = [
  'export function caracasParts(d) {',
  "  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Caracas', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })",
  '    .formatToParts(d).reduce((a, x) => { a[x.type] = x.value; return a; }, {});',
  "  return { iso: p.year + '-' + p.month + '-' + p.day, hour: Number(p.hour) % 24, minute: Number(p.minute) };",
  '}',
].join('\n');
fs.writeFileSync(path.join(tmp, 'jornada.mjs'), CARACAS);
fs.writeFileSync(path.join(tmp, 'supabase.mjs'), 'export const supabase = {}; export async function selectAllRows() { return []; }');
for (const f of ['combustibleDesglose', 'fuelRules', 'combustibleHorometro']) {
  const src = fs.readFileSync(path.join(raiz, 'src/lib', `${f}.ts`), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  js = js.replace(/import \{[^}]*\} from 'react-native';/, "const Linking = {}; const Platform = { OS: 'web' };");
  fs.writeFileSync(path.join(tmp, `${f}.mjs`), js);
}
const D = await import(pathToFileURL(path.join(tmp, 'combustibleDesglose.mjs')).href);
const H = await import(pathToFileURL(path.join(tmp, 'combustibleHorometro.mjs')).href);

// ── Horómetro de los inspectores ──
const rondas = [
  { machinery_id: 'm1', round_date: '2026-01-05', horometro_inicial: 100, horometro_final: 108 },
  { machinery_id: 'm1', round_date: '2026-01-05', horometro_inicial: 108, horometro_final: 112 },
  { machinery_id: 'm2', round_date: '2026-01-05', horometro_inicial: 0, horometro_final: null },
];
const mapa = H.agruparRondas(rondas);
const h1 = mapa.get(H.claveHorometro('m1', '2026-01-05'));
ok('inicial = el más bajo, final = el más alto', h1.inicial === 100 && h1.final === 112 && h1.fuente === 'inspector');
ok('horas del día', H.horasHorometro(h1) === 12);
ok('ceros no cuentan como lectura', mapa.get(H.claveHorometro('m2', '2026-01-05')).fuente === 'ninguno');
const conAjuste = H.aplicarAjustes(mapa, [{ machinery_id: 'm1', fecha: '2026-01-05', horometro_inicial: null, horometro_final: 110, nota: 'corrige' }]);
const h1b = conAjuste.get(H.claveHorometro('m1', '2026-01-05'));
ok('la corrección gana campo por campo y conserva lo del inspector', h1b.inicial === 100 && h1b.final === 110 && h1b.fuente === 'ajuste' && h1b.inspFinal === 112);
ok('la corrección no toca el mapa original', mapa.get(H.claveHorometro('m1', '2026-01-05')).final === 112);
ok('surtido de madrugada es de la jornada anterior', H.jornadaDeDespacho({ dispatch_date: '2026-01-06', created_at: '2026-01-06T07:00:00Z' }) === '2026-01-05');
ok('surtido de día es de su fecha', H.jornadaDeDespacho({ dispatch_date: '2026-01-06', created_at: '2026-01-06T15:00:00Z' }) === '2026-01-06');

// ── Desglose del rango ──
const dispatches = [
  { id: 'd1', dispatch_date: '2026-01-05', created_at: '2026-01-05T14:00:00Z', liters: 100, machinery_id: 'm1', tank_id: 't1', fuel_start: 10, fuel_end: 110, driver_operator: 'Persona A' },
  { id: 'd2', dispatch_date: '2026-01-05', created_at: '2026-01-05T18:00:00Z', liters: 50.5, machinery_id: 'm1', tank_id: 't1' },
  { id: 'd3', dispatch_date: '2026-01-06', created_at: '2026-01-06T15:00:00Z', liters: 30, vehicle_id: 'v1', tank_id: 't2' },
  { id: 'd4', dispatch_date: '2026-01-06', created_at: '2026-01-06T16:00:00Z', liters: 20, apoyo_nombre: 'Equipo de apoyo X', apoyo_placa: 'ZZ0', tank_id: 't1' },
  { id: 'd5', dispatch_date: '2026-01-05', liters: 999, tank_id: 't1', driver_operator: '[AJUSTE_TANQUE_OCULTO] ajuste' },
  { id: 'd6', dispatch_date: '2026-01-09', liters: 7, machinery_id: 'm1', tank_id: 't1' },
];
const intakes = [
  { id: 'i1', intake_date: '2026-01-05', liters: 1000, tank_id: 't1', supplier: 'Proveedor A', unit_cost: 0.5 },
  { id: 'i2', intake_date: '2026-01-08', liters: 500, tank_id: 't1' },
];
const r = D.armarDesgloseRango({
  dispatches, intakes,
  maquinas: [{ id: 'm1', code: 'EQ-01', plate: 'AAA000', serial: 'S1' }],
  vehiculos: [{ id: 'v1', name: 'Camioneta', plate: 'BBB111' }],
  tanques: [{ id: 't1', name: 'Tanque 1' }, { id: 't2', name: 'Tanque 2' }],
  horometros: mapa, desde: '2026-01-05', hasta: '2026-01-06',
});
ok('consumos del rango sin ajustes ni fuera de rango', r.consumos.length === 4 && !r.consumos.some((c) => c.id === 'd5' || c.id === 'd6'));
ok('entradas del rango', r.entradas.length === 1 && r.entradas[0].id === 'i1');
ok('costo total calculado desde el unitario', r.entradas[0].costoTotal === 500);
ok('total consumido', r.totalConsumido === 200.5);
const t1 = r.porTanque.find((t) => t.tanque === 'Tanque 1');
ok('totales por tanque', t1.salio === 170.5 && t1.entro === 1000);
const eq1 = r.porEquipo.find((e) => e.equipo === 'EQ-01');
ok('por equipo: litros y surtidos', eq1.litros === 150.5 && eq1.surtidos === 2);
ok('horas de la máquina una sola vez por jornada', eq1.horas === 12);
ok('horómetro del inspector en la fila', r.consumos.find((c) => c.id === 'd1').horometroIni === 100);
const ap = r.consumos.find((c) => c.id === 'd4');
ok('la máquina de apoyo sale con su nombre y sin horómetro', ap.esApoyo && ap.equipo.includes('Equipo de apoyo X') && ap.horometroIni === null);
ok('opciones guardadas raras no rompen', D.normalizarOpcionesDesglose({ placa: 'si', serial: false }).placa === true && D.normalizarOpcionesDesglose(null).consumos === true);

// ── Fuentes ──
const tab = fs.readFileSync(path.join(raiz, 'src/screens/redesign/ConciliacionTab.tsx'), 'utf8');
const pdf = fs.readFileSync(path.join(raiz, 'src/lib/combustiblePdf.ts'), 'utf8');
const lib = fs.readFileSync(path.join(raiz, 'src/lib/combustibleHorometro.ts'), 'utf8');
ok('corregir el horómetro exige full y el interruptor', tab.includes("HOROMETRO_AJUSTES_ACTIVOS && levelMeets(moduleLevel('consumos'), 'full')"));
ok('Conciliación conserva su PDF de siempre', tab.includes('exportarConciliacionPdf('));
ok('el desglose tiene su PDF', pdf.includes('export async function exportarDesgloseRangoPdf'));
ok('el horómetro jamás se escribe en machine_rounds', !/from\('machine_rounds'\)\s*\.(update|insert|upsert|delete)/.test(lib + tab));
ok('el modal del horómetro se monta al final', tab.lastIndexOf('<HorometroCombustibleModal') > tab.lastIndexOf('<ScrollView'));

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
