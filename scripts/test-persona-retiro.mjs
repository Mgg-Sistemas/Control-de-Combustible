// 👤 Retiro de almacén (02-nov-2026): quién retira sale de la nómina o de los
// choferes/operadores, o se escribe a mano SOLO para ese retiro. Antes la lista
// de nómina pedía ordenar por `name` (no existe) y llegaba vacía. Transpila la lib REAL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retiro-'));
const tr = (rel, out) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(raiz, rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
  fs.writeFileSync(path.join(tmp, out), js);
  return import(pathToFileURL(path.join(tmp, out)).href);
};
const P = await tr('src/lib/personaRetiro.ts', 'persona.mjs');

// Datos sintéticos.
const emp = [
  { id: 'e1', first_name: 'GREGORY', last_name: 'CAMACHO', cedula: '11222333', cargo: 'MOTORIZADO DE COMPRAS', status: 'activo' },
  { id: 'e2', first_name: 'Ana', last_name: 'Pérez', cedula: 'V-9.876.543', cargo: 'Mecánico', status: 'inactivo' },
];
const ope = [
  { machinery_id: 'm1', employee_id: 'e1', operator_name: 'GREGORY CAMACHO', cedula: '11222333', active: true },
  { machinery_id: 'm2', employee_id: null, operator_name: 'Luis Rojas', cedula: '15000111', active: true },
  { machinery_id: 'm3', employee_id: null, operator_name: 'Viejo Chofer', cedula: '1', active: false },
];
const lista = P.personasParaRetiro(emp, ope, (id) => ({ m1: 'JUMBO 320', m2: 'VOLTEO 7' }[id] ?? ''));
ok('nómina + operadores, sin repetir al que está en los dos', lista.length === 3);
const greg = lista.find((p) => p.employeeId === 'e1');
ok('el de nómina lleva su ficha y la máquina del operador', greg && greg.fuente === 'nomina' && greg.machineryId === 'm1' && greg.maquina === 'JUMBO 320');
const luis = lista.find((p) => p.nombre === 'Luis Rojas');
ok('el chofer fuera de nómina sale sin ficha', luis && luis.fuente === 'operador' && luis.employeeId === null && luis.machineryId === 'm2');
ok('el operador inactivo no se ofrece', !lista.some((p) => p.nombre === 'Viejo Chofer'));
ok('busca «gregory»', P.buscarPersonasRetiro(lista, 'gregory').length === 1);
ok('busca sin acentos ni mayúsculas', P.buscarPersonasRetiro(lista, 'perez').length === 1);
ok('busca por cédula con puntos', P.buscarPersonasRetiro(lista, '9876').some((p) => p.nombre === 'Ana Pérez'));
ok('busca por máquina', P.buscarPersonasRetiro(lista, 'volteo').some((p) => p.nombre === 'Luis Rojas'));
ok('busca por varias palabras', P.buscarPersonasRetiro(lista, 'camacho motorizado').length === 1);
ok('vacío no lista a nadie', P.buscarPersonasRetiro(lista, '  ').length === 0);
ok('los activos van primero', P.buscarPersonasRetiro(P.personasParaRetiro([
  { id: 'a', first_name: 'Zoe', last_name: 'Mora', status: 'activo' },
  { id: 'b', first_name: 'Ana', last_name: 'Mora', status: 'inactivo' },
], []), 'mora')[0].nombre === 'Zoe Mora');
ok('listas que fallan (null) no revientan', P.personasParaRetiro(null, undefined).length === 0);

// La etiqueta del retiro: un «|» o «]» escrito a mano no la parte.
fs.writeFileSync(path.join(tmp, 'pdfExport.mjs'), 'export const pdfDocument = () => ""; export const exportPdf = async () => {};');
let E = null;
try {
  let src = fs.readFileSync(path.join(raiz, 'src/lib/requerimientoExpediente.ts'), 'utf8');
  src = src.replace(/^import .*$/gm, '');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
  fs.writeFileSync(path.join(tmp, 'exp.mjs'), js);
  E = await import(pathToFileURL(path.join(tmp, 'exp.mjs')).href);
} catch { E = null; }
if (E?.inyectarDespachoEnObservaciones && E?.extraerDespacho) {
  const obs = E.inyectarDespachoEnObservaciones('nota previa', { estado: 'retirado', retiradoPor: 'Juan | Pérez]', retiradoCedula: 'V-1', retiradoCargo: 'Chofer', retiradoEmployeeId: null, despachadoPor: 'Almacén', fecha: '2026-11-02T10:00:00Z', nota: 'a|b', maquinariaCodigo: 'JUMBO 320', maquinariaPlaca: 'XX' });
  const d = E.extraerDespacho({ observaciones: obs });
  ok('con «|» en el nombre se sigue leyendo bien', d.estado === 'retirado' && d.retiradoPor === 'Juan / Pérez)' && d.maquinariaCodigo === 'JUMBO 320' && d.nota === 'a/b');
  ok('lo de antes en observaciones se conserva', obs.startsWith('nota previa'));
  ok('sin ficha de nómina queda vacío el vínculo', d.retiradoEmployeeId === null);
} else {
  ok('se pudo cargar requerimientoExpediente para probar la etiqueta', false);
}

// Las dos pantallas usan el MISMO selector y ya no piden la nómina por `name`.
for (const rel of ['src/screens/RequerimientoTab.tsx', 'src/screens/SolicitudesCompraTab.tsx']) {
  const s = fs.readFileSync(path.join(raiz, rel), 'utf8');
  ok(`${rel}: usa PersonaRetiroPicker`, s.includes('<PersonaRetiroPicker'));
  ok(`${rel}: ya no ordena employees por name`, !s.includes("useTable<Employee>('employees', { orderBy: 'name' })"));
  ok(`${rel}: el guardado comprueba que sí se guardó`, /update\(\{ observaciones: nuevaObs \}\)\s*\.eq\('id', despachoTarget\.id\)\s*\.select\('id'\)/.test(s));
}
const comp = fs.readFileSync(path.join(raiz, 'src/components/PersonaRetiroPicker.tsx'), 'utf8');
ok('el selector solo LEE la nómina (nada de insert/update/upsert)', !/\.(insert|update|upsert|delete)\(/.test(comp));
ok('el selector no pide sueldos', !/base_salary|precio_hora|bank_/.test(comp));

if (fail) {
  console.error(failures.map((f) => `✗ ${f}`).join('\n'));
  console.error(`\n✗ persona que retira: ${fail} fallo(s), ${pass} ok`);
  process.exit(1);
}
console.log(`✓ persona que retira: ${pass} pruebas ok`);
