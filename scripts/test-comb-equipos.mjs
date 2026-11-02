// 🚜 Combustible (02-nov-2026): elegir uno o varios equipos (máquinas, camiones,
// vehículos, apoyo) o tanques en Consumos, Ingresos, Conciliación y el parte
// diario del Surtidor. Transpila la lib REAL con datos sintéticos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comb-eq-'));
fs.writeFileSync(path.join(tmp, 'text.mjs'), "export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');");
const src = fs.readFileSync(path.join(raiz, 'src/lib/combustibleEquipos.ts'), 'utf8');
let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
fs.writeFileSync(path.join(tmp, 'combustibleEquipos.mjs'), js);
const E = await import(pathToFileURL(path.join(tmp, 'combustibleEquipos.mjs')).href);

const maquinas = [{ id: 'm1', code: 'EQ-01', plate: 'AAA000', serial: 'S1', tipo: 'Retro' }, { id: 'm2', code: 'EQ-02' }];
const vehiculos = [{ id: 'v1', plate: 'CAM-01', name: 'Camión prueba' }];
const despachos = [
  { id: 'd1', machinery_id: 'm1', tank_id: 't1', liters: 10 },
  { id: 'd2', vehicle_id: 'v1', tank_id: 't2', liters: 20 },
  { id: 'd3', apoyo_nombre: 'Grúa de apoyo', apoyo_placa: 'ZZ-1', tank_id: 't1', liters: 5 },
  { id: 'd4', machinery_id: 'm2', tank_id: 't2', liters: 7 },
];
ok('clave de máquina, vehículo y apoyo', E.claveEquipo(despachos[0]) === 'm:m1' && E.claveEquipo(despachos[1]) === 'v:v1' && E.claveEquipo(despachos[2]).startsWith('a:'));
const ops = E.opcionesEquipos(maquinas, vehiculos, despachos);
ok('opciones: catálogo + apoyo', ops.length === 4 && ops.some((o) => o.label.includes('Grúa de apoyo')));
ok('se busca por placa', E.buscarOpciones(ops, 'aaa000').length === 1 && E.buscarOpciones(ops, 'aaa000')[0].key === 'm:m1');
ok('se busca por serial', E.buscarOpciones(ops, 's1')[0].key === 'm:m1');
ok('se busca sin acentos', E.buscarOpciones(ops, 'camion').some((o) => o.key === 'v:v1'));
ok('nada elegido = todos', E.filtrarPorEquipos(despachos, []).length === 4);
ok('uno', E.filtrarPorEquipos(despachos, ['v:v1']).map((d) => d.id).join() === 'd2');
ok('varios', E.filtrarPorEquipos(despachos, ['m:m1', E.claveEquipo(despachos[2])]).map((d) => d.id).join() === 'd1,d3');
ok('tanques: uno', E.filtrarPorTanques(despachos, ['t2']).length === 2);
ok('tanques: nada elegido = todos', E.filtrarPorTanques(despachos, null).length === 4);
ok('opciones de tanques', E.opcionesTanques([{ id: 't1', name: 'Tanque 1', responsable: 'Persona' }])[0].sub.includes('Persona'));

const leer = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');
const pil = leer('src/screens/redesign/DispatchesPilot.tsx');
const ing = leer('src/screens/redesign/IntakesPilot.tsx');
const con = leer('src/screens/redesign/ConciliacionTab.tsx');
const sur = leer('src/components/combustible/SurtidorMovil.tsx');
const mod = leer('src/components/combustible/OpcionesReporteCombustibleModal.tsx');
const rl = leer('src/components/redesign/RList.tsx');
ok('Consumos: selector en la lista y en el reporte', pil.includes('<SelectorMultiple titulo="🚜 Equipos"') && pil.includes("seleccion={{ titulo: '🚜 Equipos'") && pil.includes('filtrarPorEquipos(filtrarConsumos('));
ok('Ingresos: por tanque en la lista y en el reporte', ing.includes('<SelectorMultiple titulo="🛢 Tanques"') && ing.includes('filtrarPorTanques(filtrarEntradas('));
ok('Conciliación: tanques en la tabla y equipos en el desglose', con.includes('selTanques.includes(t.id)') && con.includes('filtrarPorEquipos(filtrarPorTanques(dispatches'));
ok('Surtidor: parte diario por equipos', sur.includes('filtrarPorEquipos([d], reportEquipos)'));
ok('el reporte recibe lo elegido', mod.includes('seleccion: elegidos'));
ok('con un filtro de afuera la lista no se limita a HOY', rl.includes('!nq && !filtroActivo'));

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
