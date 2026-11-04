// Prueba de las notas de «por qué no se ha pagado» en Por Pagar (04-nov-2026).
import fs from 'fs';
import path from 'path';
import os from 'os';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, 'src/lib/cuentaNotasEspera.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
const tmp = path.join(os.tmpdir(), `cuentaNotasEspera-${process.pid}.mjs`);
fs.writeFileSync(tmp, js);
const L = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);

let pass = 0, fail = 0; const fallos = [];
const ok = (n, c) => { if (c) pass++; else { fail++; fallos.push(`  ✗ ${n}`); } };
const eq = (n, a, b) => ok(`${n} (obtenido ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));

const N = (id, cuenta, at, anulada = null) => ({ id, cuenta_id: cuenta, texto: `nota ${id}`, created_by: 'u1', autor_nombre: 'Ana', created_at: at, anulada_at: anulada, anulada_por_nombre: null });
const notas = [N('a', 'c1', '2026-11-01T10:00:00Z'), N('b', 'c1', '2026-11-03T10:00:00Z', '2026-11-03T11:00:00Z'), N('c', 'c1', '2026-11-02T10:00:00Z'), N('d', 'c2', '2026-11-01T09:00:00Z')];
const m = L.notasPorCuenta(notas);
eq('agrupa por cuenta, la más nueva primero', m.get('c1').map((n) => n.id), ['b', 'c', 'a']);
eq('la tarjeta muestra la más nueva NO anulada', L.ultimaNotaActiva(m.get('c1')).id, 'c');
eq('sin notas activas no muestra ninguna', L.ultimaNotaActiva([N('x', 'c3', '2026-11-01T00:00:00Z', '2026-11-01T01:00:00Z')]), null);
ok('no se guarda vacía', L.validarNotaEspera('   ') !== null);
ok('no se guarda más larga que el máximo', L.validarNotaEspera('x'.repeat(L.LARGO_MAX_NOTA_ESPERA + 1)) !== null);
eq('una nota normal se puede guardar', L.validarNotaEspera('Esperando transferencia'), null);
eq('la hora sale en Caracas', L.cuandoNotaEspera('2026-11-04T13:15:00Z'), '04/11/2026 9:15 am');
ok('reconoce la tabla faltante', L.esTablaNotasFaltante('relation "public.cuenta_notas_espera" does not exist'));

const comp = fs.readFileSync(path.join(ROOT, 'src/components/NotasEsperaCuenta.tsx'), 'utf8');
const scr = fs.readFileSync(path.join(ROOT, 'src/screens/CuentasScreen.tsx'), 'utf8');
ok('nunca se borra: solo insert y anular', !/\.delete\(/.test(comp) && /\.update\(\{ anulada_at:/.test(comp));
ok('no se manda el autor: lo pone la base', !/autor_nombre:/.test(comp.split('.insert(')[1].split(')')[0]));
ok('se confirma lo escrito (RLS rechaza con 0 filas)', /\.select\('id'\)/.test(comp) && /data\.length === 0/.test(comp));
ok('va en la tarjeta de Por Pagar, sin abrirla', /\{tipo === 'por_pagar' \? \(\s*<NotasEsperaCuenta/.test(scr));
ok('anular lo ajeno solo con permiso de escritura', /puedeAnularTodas=\{canWrite\}/.test(scr));

console.log(`\n📝 Notas de espera en Por Pagar: ${pass} OK · ${fail} FALLO(S)`);
if (fail) { console.error(fallos.join('\n')); process.exit(1); }
