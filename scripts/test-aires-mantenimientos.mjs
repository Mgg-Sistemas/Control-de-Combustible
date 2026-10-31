// ❄️ Aires acondicionados (31-oct-2026): el historial muestra solo los mantenimientos
// del aire, crear uno nuevo no reemplaza a otro, la cuenta por pagar se reconoce por el
// código completo y solo se abren adjuntos del Storage del proyecto.
// Corre las funciones REALES de src/lib/airesAcondicionados.ts (transpiladas al vuelo).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

const src = fs.readFileSync('src/lib/airesAcondicionados.ts', 'utf8');
// Saca una función completa por su nombre (cuenta llaves desde la primera «{» del cuerpo).
function sacar(nombre) {
  const i = src.indexOf(`export function ${nombre}`);
  if (i < 0) throw new Error(`No está ${nombre}`);
  // El cuerpo empieza en «) {» o «): Tipo {» al final de la firma (los parámetros
  // pueden traer tipos con llaves, por eso no sirve la primera «{»).
  const re = /\)(?:\s*:\s*[\w<>[\]| .]+)?\s*\{\r?\n/g;
  re.lastIndex = i;
  const m = re.exec(src);
  const j = m.index + m[0].indexOf('{');
  let prof = 0, p = j;
  for (; p < src.length; p++) { if (src[p] === '{') prof++; else if (src[p] === '}') { prof--; if (prof === 0) break; } }
  return src.slice(i, p + 1).replace(/^export /, '');
}
const piezas = ['esRenglonDeAire', 'itemCorrespondeAUnidadAc', 'aplicarFichaUnidadAc', 'cuentaEsDelServicioAc', 'urlAdjuntoAcSegura'].map(sacar).join('\n');
const constante = (src.match(/export const AC_CATEGORIA_SERVICIO = [^;]+;/) || [''])[0].replace(/^export /, '');
// Solo se evalúa código del propio repositorio.
const js = ts.transpileModule(`${constante}\n${piezas}`, { compilerOptions: { target: 'ES2020', module: 'None' } }).outputText;
const L = new Function(`${js}; return { esRenglonDeAire, itemCorrespondeAUnidadAc, aplicarFichaUnidadAc, cuentaEsDelServicioAc, urlAdjuntoAcSegura, AC_CATEGORIA_SERVICIO };`)();

// 1. Historial: un servicio de taller de la MISMA máquina no es del aire.
const aire = { id: 'MAQ-1', code: 'MAQ-1', machinery_id: 'm1' };
const taller = { categoria: 'REPARACION', machinery_id: 'm1', machine_label: 'MAQ-1 · Gato hidráulico', detalle: 'REPARACION DE GATO' };
ok('el servicio de taller de la máquina NO sale en el aire', L.itemCorrespondeAUnidadAc(taller, aire) === false);
const delAire = { categoria: L.AC_CATEGORIA_SERVICIO, ac_unit_code: 'MAQ-1' };
ok('el mantenimiento del aire sí sale', L.itemCorrespondeAUnidadAc(delAire, aire) === true);
ok('el de OTRO aire no sale', L.itemCorrespondeAUnidadAc({ categoria: L.AC_CATEGORIA_SERVICIO, ac_unit_code: 'MAQ-1-2' }, aire) === false);
ok('un mantenimiento viejo de aires sin código sigue cruzando por máquina', L.itemCorrespondeAUnidadAc({ categoria: L.AC_CATEGORIA_SERVICIO, machinery_id: 'm1' }, aire) === true);

// 2. Crear no reemplaza.
const base = [{ id: 'AA-1', code: 'AA-1' }];
const dup = L.aplicarFichaUnidadAc(base, { code: 'aa-1' }, null);
ok('crear con un código ocupado da error y no reemplaza', dup.ok === false);
const nuevo = L.aplicarFichaUnidadAc(base, { code: 'AA-2' }, null);
ok('crear con código libre agrega sin tocar el otro', nuevo.ok && nuevo.unidades.length === 2 && nuevo.unidades[0].code === 'AA-1');
const ed = L.aplicarFichaUnidadAc([...base, { id: 'AA-2', code: 'AA-2', marca: 'X' }], { code: 'AA-2', marca: 'Y' }, 'AA-2');
ok('editar cambia solo la ficha abierta', ed.ok && ed.unidades.length === 2 && ed.unidades[1].marca === 'Y' && ed.unidades[0].code === 'AA-1');
ok('editar no puede tomar el código de otro', L.aplicarFichaUnidadAc([...base, { code: 'AA-2' }], { code: 'AA-1' }, 'AA-2').ok === false);
ok('no se cambia el código de un aire con historial', L.aplicarFichaUnidadAc(base, { code: 'AA-9' }, 'AA-1', 3).ok === false);

// 3. La cuenta del mantenimiento, por código completo.
ok('reconoce la cuenta por documento', L.cuentaEsDelServicioAc({ tipo: 'por_pagar', documento: 'SRV-0031' }, 'SRV-0031'));
ok('reconoce la cuenta por el código en el concepto', L.cuentaEsDelServicioAc({ tipo: 'por_pagar', concepto: 'Mantenimiento SRV-0031 · aire' }, 'SRV-0031'));
ok('SRV-0003 no es la cuenta de SRV-00031', !L.cuentaEsDelServicioAc({ tipo: 'por_pagar', concepto: 'Mantenimiento SRV-00031' }, 'SRV-0003'));
ok('una cuenta por cobrar no cuenta', !L.cuentaEsDelServicioAc({ tipo: 'por_cobrar', documento: 'SRV-0031' }, 'SRV-0031'));

// 4. Adjuntos seguros.
const SB = 'https://proyecto.supabase.co';
ok('abre un adjunto del Storage del proyecto', L.urlAdjuntoAcSegura(`${SB}/storage/v1/object/public/x/a.pdf`, SB) !== null);
ok('bloquea javascript:', L.urlAdjuntoAcSegura('javascript:alert(1)', SB) === null);
ok('bloquea data:', L.urlAdjuntoAcSegura('data:text/html,<b>x</b>', SB) === null);
ok('bloquea otro sitio', L.urlAdjuntoAcSegura('https://otro.example.com/a.pdf', SB) === null);
ok('sin URL del proyecto exige https', L.urlAdjuntoAcSegura('http://x.com/a', null) === null && L.urlAdjuntoAcSegura('https://x.com/a', null) !== null);

// 5. La pantalla usa las funciones nuevas.
const tab = fs.readFileSync('src/screens/AiresAcondicionadosTab.tsx', 'utf8');
ok('la pantalla valida los adjuntos antes de abrirlos', (tab.match(/urlAdjuntoAcSegura\(/g) || []).length >= 2);
ok('la pantalla guarda la ficha sin reemplazar', tab.includes('aplicarFichaUnidadAc('));
ok('la pantalla busca la cuenta por código completo', tab.includes('cuentaEsDelServicioAc('));

console.log(`\n${pass} ok, ${fail} fallas`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
