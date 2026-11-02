// 🗂️ Combustible (02-nov-2026): consumos viejos con tanque asignado SIN descontar
// del stock (dispatches.sin_descuento). El trigger del tanque los salta; la
// Conciliación y el desglose no los cuentan como salida del tanque.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comb-sd-'));
fs.writeFileSync(path.join(tmp, 'jornada.mjs'), 'export function caracasParts(d) { return { iso: d.toISOString().slice(0, 10), hour: 12, minute: 0 }; }');
fs.writeFileSync(path.join(tmp, 'supabase.mjs'), 'export const supabase = {}; export async function selectAllRows() { return []; }');
for (const f of ['combustibleDesglose', 'fuelRules', 'combustibleHorometro']) {
  const src = fs.readFileSync(path.join(raiz, 'src/lib', `${f}.ts`), 'utf8');
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
  js = js.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  js = js.replace(/import \{[^}]*\} from 'react-native';/, "const Linking = {}; const Platform = { OS: 'web' };");
  fs.writeFileSync(path.join(tmp, `${f}.mjs`), js);
}
const D = await import(pathToFileURL(path.join(tmp, 'combustibleDesglose.mjs')).href);

const r = D.armarDesgloseRango({
  dispatches: [
    { id: 'a', dispatch_date: '2026-01-05', liters: 100, machinery_id: 'm1', tank_id: 't1' },
    { id: 'b', dispatch_date: '2026-01-05', liters: 40, machinery_id: 'm1', tank_id: 't1', sin_descuento: true },
  ],
  intakes: [], maquinas: [{ id: 'm1', code: 'EQ-01' }], vehiculos: [], tanques: [{ id: 't1', name: 'Tanque 1' }],
  horometros: new Map(), desde: '2026-01-05', hasta: '2026-01-05',
});
ok('el registro viejo sale en el listado', r.consumos.length === 2 && r.consumos.find((c) => c.id === 'b').sinDescuento === true);
ok('pero no cuenta como salida del tanque', r.porTanque[0].salio === 100);
ok('el equipo sí suma todo lo que se le surtió', r.porEquipo[0].litros === 140);

const pil = fs.readFileSync(path.join(raiz, 'src/screens/redesign/DispatchesPilot.tsx'), 'utf8');
const con = fs.readFileSync(path.join(raiz, 'src/screens/redesign/ConciliacionTab.tsx'), 'utf8');
ok('auto-asignar tiene la opción sin descontar', pil.includes('autoAsignarTanques(shown, true)') && pil.includes("{ tank_id: matched.id, sin_descuento: true }"));
ok('asignar uno a uno también', pil.includes('asignarUnConsumo(d.id, suggestedTank.id, true)'));
ok('las asignaciones comprueban que la base guardó', (pil.match(/\.select\('id'\);/g) || []).length >= 2);
ok('la tarjeta avisa que es registro viejo', pil.includes('Registro viejo: lleva su tanque pero no descontó del stock'));
ok('la Conciliación no los cuenta como despacho', con.includes('!esRegistroAjusteTanque(d) && !d.sin_descuento'));

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
