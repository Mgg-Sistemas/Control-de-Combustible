/*
 * 🔎 BUSCAR EN AUDITORÍA POR UN NOMBRE QUE YA NO EXISTE (24-oct-2026).
 *
 * Pedido del cliente, textual: «si yo busco APP26 en auditoría me debería salir
 * la última vez que tenía ese nombre o el día que le cambiaron el nombre».
 *
 * El caso real: a un PAYLOADER le corrigieron el serial (APP26 → 76J8591, con su
 * marca y modelo) el 20/08/2026. El buscador resolvía el texto SOLO contra la ficha
 * de HOY (código, placa, serial…), así que «APP26» no encontraba nada: el dato vivía
 * únicamente dentro del antes/después del cambio, y ahí no se buscaba.
 *
 * Lo que fijan estos casos:
 *   - el filtro mira el valor de ANTES («de») y el de DESPUÉS («a») de los mismos
 *     campos con los que el buscador ya reconoce una máquina hoy;
 *   - el texto entra tal cual al ilike (el saneo de coma/paréntesis/% lo hace la
 *     pantalla, igual que para el resto de la búsqueda);
 *   - mezclar no repite filas, queda de la más nueva a la más vieja y respeta el tope;
 *   - la pantalla usa la regla, sobre máquinas/vehículos y SOLO acciones de tabla,
 *     y suma esas filas aunque caigan fuera del rango de fechas visible.
 *
 *   node scripts/test-auditoria-nombres-anteriores.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const mod = { exports: {} };
new Function('exports', 'module', ts.transpileModule(
  leer('src/lib/auditNombresAnteriores.ts'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } },
).outputText)(mod.exports, mod);
const { CAMPOS_DE_IDENTIDAD, filtroNombresAnteriores, mezclarPorFecha } = mod.exports;

let pass = 0, fail = 0;
const ok = (msg, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}${extra ? ` — ${extra}` : ''}`); }
};

console.log('\n1) Los campos con los que se reconoce una máquina');
{
  const esperados = ['code', 'plate', 'serial', 'identifier', 'encargado', 'tipo', 'clasificacion', 'referencia'];
  ok('son los mismos que usa el buscador para la ficha de hoy', JSON.stringify([...CAMPOS_DE_IDENTIDAD]) === JSON.stringify(esperados),
    JSON.stringify(CAMPOS_DE_IDENTIDAD));
  const sinImports = !/^\s*import\s/m.test(leer('src/lib/auditNombresAnteriores.ts'));
  ok('la regla es pura: sin imports (se prueba sola, no toca la base)', sinImports);
}

console.log('\n2) El filtro mira el antes Y el después de cada campo');
{
  const f = filtroNombresAnteriores('APP26');
  const partes = f.split(',');
  ok('dos condiciones por campo (de y a)', partes.length === CAMPOS_DE_IDENTIDAD.length * 2, `${partes.length}`);
  ok('⭐ el serial viejo entra: changes->serial->>de.ilike.%APP26%', partes.includes('changes->serial->>de.ilike.%APP26%'));
  ok('el serial nuevo también: changes->serial->>a.ilike.%APP26%', partes.includes('changes->serial->>a.ilike.%APP26%'));
  ok('el código viejo entra', partes.includes('changes->code->>de.ilike.%APP26%'));
  ok('la placa vieja entra', partes.includes('changes->plate->>de.ilike.%APP26%'));
  ok('el texto vacío no arma filtro (no hay nada que buscar)', filtroNombresAnteriores('   ') === '');
  ok('se recorta el texto antes de buscar', filtroNombresAnteriores('  APP26 ').includes('ilike.%APP26%,'));
}

console.log('\n3) Mezclar: sin repetidas, de la más nueva a la más vieja, con tope');
{
  const a = [{ id: '1', at: '2026-10-20T10:00:00Z' }, { id: '2', at: '2026-10-19T10:00:00Z' }];
  const b = [{ id: '2', at: '2026-10-19T10:00:00Z' }, { id: '3', at: '2026-08-20T16:32:17Z' }];
  const m = mezclarPorFecha(a, b, 10);
  ok('no repite la fila que estaba en las dos listas', m.length === 3, JSON.stringify(m.map((x) => x.id)));
  ok('ordena de la más nueva a la más vieja', m.map((x) => x.id).join() === '1,2,3');
  ok('respeta el tope', mezclarPorFecha(a, b, 2).length === 2);
  ok('con una lista vacía devuelve la otra', mezclarPorFecha([], b, 10).length === 2 && mezclarPorFecha(a, [], 10).length === 2);
}

console.log('\n4) La pantalla de Auditoría la usa bien');
{
  const s = leer('src/screens/AuditScreen.tsx');
  ok('importa la regla', /from '\.\.\/lib\/auditNombresAnteriores'/.test(s));
  ok('busca los cambios con filtroNombresAnteriores(safe)', /filtroNombresAnteriores\(safe\)/.test(s));
  ok('⭐ acota a máquinas y vehículos (índice por tabla: no escanea la bitácora entera)',
    /\.in\('table_name', TABLAS_CON_ESTADO/.test(s));
  ok('⭐ solo acciones de tabla (los eventos de jornada nunca traen cambios)', /\.in\('action', ACCIONES_DE_TABLA\)/.test(s));
  ok('suma la máquina encontrada a la búsqueda por id (trae también su historia del rango)', /idsNombresAnteriores/.test(s));
  ok('⭐ mezcla esas filas aunque caigan fuera del rango de fechas', /mezclarPorFecha\(/.test(s));
  ok('si esa consulta falla, la búsqueda normal sigue (no tumba la pantalla)', /nombresAnteriores\.error|historicos\s*=\s*\(?\s*nombresAnteriores\.data/.test(s));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-auditoria-nombres-anteriores · ${pass} ok · ${fail} fallando`);
if (fail) process.exit(1);
