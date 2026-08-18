/*
 * AUDITORÍA — nombres legibles de columnas y resumen de cambios.
 *
 * Blinda `src/lib/auditLabels.ts`, lo que hace que la bitácora diga
 * "En espera: no → sí" en vez de "en_espera: false → true". El caso que motivó
 * esto (18-ago-2026): no se veía quién retiraba una máquina ni quién la ponía
 * en espera, porque la pantalla mostraba el nombre crudo de la columna.
 *
 *   npm run test:auditoria   (o: node scripts/test-auditoria-labels.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

// auditLabels.ts es PURO (sin imports) → transpila y evalúa directo.
const src = fs.readFileSync(path.join(ROOT, 'src/lib/auditLabels.ts'), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'module', js)(mod.exports, mod);
const { fieldLabel, changesSummary, RESUMEN_MAX_CAMPOS } = mod.exports;

// Formateador equivalente al fmtVal de AuditScreen para lo que se prueba acá
// (booleano → sí/no, vacío → ∅). El de la pantalla además formatea fechas, pero
// eso es suyo: changesSummary lo recibe como parámetro justamente para no
// depender de zonas horarias.
const fmt = (x) => {
  if (x === null || x === undefined || x === '') return '∅';
  if (typeof x === 'boolean') return x ? 'sí' : 'no';
  return String(x);
};
const cambio = (de, a) => ({ de, a });

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? `  → ${extra}` : '')); }
};

console.log('AUDITORÍA — etiquetas legibles y resumen de cambios\n');

// ── 1) Los dos casos que pidió el cliente ───────────────────────────────────
{
  const espera = changesSummary('UPDATE', { en_espera: cambio(false, true) }, fmt);
  ok('poner EN ESPERA se lee en cristiano', espera === 'En espera: no → sí', espera);

  const quitar = changesSummary('UPDATE', { en_espera: cambio(true, false) }, fmt);
  ok('quitar de EN ESPERA se lee en cristiano', quitar === 'En espera: sí → no', quitar);

  const retiro = changesSummary('UPDATE', { active: cambio(true, false) }, fmt);
  ok('RETIRAR una máquina se lee en cristiano', retiro === 'Activa: sí → no', retiro);
}

// ── 2) Ninguna etiqueta se queda en el nombre crudo de la columna ────────────
{
  const claves = ['en_espera', 'active', 'operational', 'exit_date', 'entry_date',
    'inactivated_at', 'inactivated_by', 'reactivated_at', 'reactivated_by', 'qr_blocked'];
  const crudas = claves.filter((k) => fieldLabel(k) === k);
  ok('todas las columnas de estado de máquina están traducidas', crudas.length === 0, crudas.join(', '));
  ok('ninguna etiqueta lleva guion bajo', !claves.some((k) => fieldLabel(k).includes('_')));
}

// ── 3) Una columna que no está en el mapa NO rompe: cae a su nombre ──────────
{
  ok('columna desconocida cae a su nombre original', fieldLabel('columna_nueva_2027') === 'columna_nueva_2027');
  const s = changesSummary('UPDATE', { columna_nueva_2027: cambio(1, 2) }, fmt);
  ok('y aun así se resume sin fallar', s === 'columna_nueva_2027: 1 → 2', s);
}

// ── 4) El corte a dos campos, y el "+N más" ─────────────────────────────────
{
  ok('el tope declarado sigue siendo 2', RESUMEN_MAX_CAMPOS === 2);

  const dos = changesSummary('UPDATE', { en_espera: cambio(false, true), active: cambio(true, false) }, fmt);
  ok('con 2 campos NO aparece el "+N más"', dos === 'En espera: no → sí  ·  Activa: sí → no', dos);

  const cuatro = changesSummary('UPDATE', {
    en_espera: cambio(false, true), active: cambio(true, false),
    zona: cambio('A', 'B'), notes: cambio('x', 'y'),
  }, fmt);
  ok('con 4 campos se cortan 2 y avisa "+2 más"', cuatro.endsWith('+2 más'), cuatro);
  ok('y el corte respeta el orden de llegada', cuatro.startsWith('En espera: no → sí'), cuatro);
}

// ── 5) Valores vacíos / nulos no ensucian la línea ──────────────────────────
{
  const s = changesSummary('UPDATE', { exit_date: cambio(null, '2026-08-18') }, fmt);
  ok('un valor nulo se muestra como ∅, no como "null"', s === 'Fecha de salida: ∅ → 2026-08-18', s);
}

// ── 6) Solo resume UPDATE: crear/borrar traen la fila entera, no un antes→después ──
{
  ok('INSERT no genera resumen', changesSummary('INSERT', { code: 'X' }, fmt) === null);
  ok('DELETE no genera resumen', changesSummary('DELETE', { code: 'X' }, fmt) === null);
  ok('sin changes no genera resumen', changesSummary('UPDATE', null, fmt) === null);
  ok('changes vacío no genera resumen', changesSummary('UPDATE', {}, fmt) === null);
  ok('un evento de app (SCAN) no genera resumen', changesSummary('SCAN', { a: 1 }, fmt) === null);
}

if (fail) {
  console.log(`\n✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nLa bitácora muestra "En espera: no → sí", no "en_espera: false → true".`);
