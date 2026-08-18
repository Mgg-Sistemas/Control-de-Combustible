/*
 * IDENTIDAD VISIBLE DE UNA MÁQUINA.
 *
 * Blinda `src/lib/machineLabel.ts`. El caso real (18-ago-2026): hay TRES máquinas
 * llamadas `RETROEXCAVADORA` (identificadores 008, 053 y 073). El cliente comparó
 * dos reportes, vio una averiada y otra con 9.34 h trabajadas, y creyó que el
 * sistema se contradecía — eran dos máquinas distintas con el mismo nombre.
 *
 * Regla del cliente: distinguirlas por PLACA (es lo que usan para asignar), y si
 * no hay, por serial o identificador.
 *
 *   npm run test:maquina   (o: node scripts/test-machine-label.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

// machineLabel.ts es PURO (sin imports) → transpila y evalúa directo.
const src = fs.readFileSync(path.join(ROOT, 'src/lib/machineLabel.ts'), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'module', js)(mod.exports, mod);
const { machineLabel, machineDiscriminante, machineFileLabel, machineMatches } = mod.exports;

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? `  → ${extra}` : '')); }
};

// Las tres RETROEXCAVADORAS reales de la flota.
const R008 = { code: 'RETROEXCAVADORA', identifier: '008', serial: '92543.0', plate: null };
const R053 = { code: 'RETROEXCAVADORA', identifier: '053', serial: '5YN02894', plate: 'SLP214TSWE0471955' };
const R073 = { code: 'RETROEXCAVADORA', identifier: '073', serial: 'CLW009LDHSH002268', plate: null };

console.log('IDENTIDAD DE MÁQUINA — las tres RETROEXCAVADORAS\n');

// ── 1) Lo esencial: las tres se distinguen ─────────────────────────────────
{
  const etiquetas = [machineLabel(R008), machineLabel(R053), machineLabel(R073)];
  ok('⭐ las tres etiquetas son DISTINTAS entre sí', new Set(etiquetas).size === 3, etiquetas.join(' | '));
  ok('todas conservan el nombre', etiquetas.every((e) => e.startsWith('RETROEXCAVADORA')));
}

// ── 2) La PLACA manda, porque es lo que usan para asignar ─────────────────
{
  ok('con placa → se muestra la PLACA, no el serial',
    machineLabel(R053) === 'RETROEXCAVADORA · SLP214TSWE0471955', machineLabel(R053));
  ok('sin placa → cae al SERIAL',
    machineLabel(R008) === 'RETROEXCAVADORA · 92543.0', machineLabel(R008));
  const soloIdent = { code: 'VOLTEO', identifier: '141', serial: null, plate: null };
  ok('sin placa ni serial → cae al IDENTIFICADOR',
    machineLabel(soloIdent) === 'VOLTEO · 141', machineLabel(soloIdent));
}

// ── 3) No inventa nada ni deja basura colgando ────────────────────────────
{
  ok('sin ningún discriminante → solo el nombre, sin separador suelto',
    machineLabel({ code: 'GRÚA' }) === 'GRÚA', machineLabel({ code: 'GRÚA' }));
  ok('campos vacíos se ignoran (no cuentan como discriminante)',
    machineLabel({ code: 'GRÚA', plate: '   ', serial: '' }) === 'GRÚA',
    machineLabel({ code: 'GRÚA', plate: '   ', serial: '' }));
  ok('nunca aparece "undefined" ni "null"',
    !/undefined|null/.test(machineLabel({ code: 'GRÚA', plate: undefined, serial: null })));
  ok('máquina nula no rompe', machineLabel(null) === '' && machineDiscriminante(null) === null);
  ok('sin nombre pero con placa → muestra la placa',
    machineLabel({ plate: 'AB123CD' }) === 'AB123CD', machineLabel({ plate: 'AB123CD' }));
}

// ── 4) Nombre de archivo: tres PDF que ya no se pisan ─────────────────────
{
  const archivos = [machineFileLabel(R008), machineFileLabel(R053), machineFileLabel(R073)];
  ok('⭐ los tres nombres de archivo son distintos', new Set(archivos).size === 3, archivos.join(' | '));
  const feo = { code: 'RETRO/EXC*', plate: 'A:B?C' };
  ok('quita los caracteres que Windows rechaza',
    !/[\\/:*?"<>|]/.test(machineFileLabel(feo)), machineFileLabel(feo));
}

// ── 5) Buscar por placa o serial, no solo por nombre ──────────────────────
{
  ok('encuentra por PLACA', machineMatches(R053, 'SLP214'));
  ok('encuentra por SERIAL', machineMatches(R073, 'CLW009'));
  ok('encuentra por IDENTIFICADOR', machineMatches(R008, '008'));
  ok('encuentra por NOMBRE', machineMatches(R008, 'retro'));
  ok('no distingue mayúsculas', machineMatches(R053, 'slp214'));
  ok('el serial de una NO encuentra a la otra', !machineMatches(R008, 'CLW009'));
  ok('búsqueda vacía deja pasar todo', machineMatches(R008, '   '));
}

// ── 6) El separador se puede cambiar sin romper nada ──────────────────────
{
  ok('separador personalizado', machineLabel(R053, ' — ') === 'RETROEXCAVADORA — SLP214TSWE0471955');
}

if (fail) {
  console.log(`✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nLas tres RETROEXCAVADORAS ya no se confunden: cada una muestra su placa o su serial.`);
