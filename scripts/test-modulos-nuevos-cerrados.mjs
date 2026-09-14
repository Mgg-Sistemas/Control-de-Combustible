/*
 * Test: los módulos de dinero y control que vienen NACEN CERRADOS (14-sep-2026).
 *
 * `defaultLevel` le da 'escritura' a cualquier módulo que no esté en su lista: un
 * módulo nuevo sin permisos cargados quedaría abierto para todos los usuarios.
 * «Cobro de viajes» y «Horómetros» se agregan a la lista antes de construirlos.
 *
 *   node scripts/test-modulos-nuevos-cerrados.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const p = path.join(ROOT, 'src/lib/permissions.ts');
const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(p);
m.filename = p;
m.paths = Module._nodeModulePaths(path.dirname(p));
m._compile(js, p);
const { defaultLevel } = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  if (got === want) pass++;
  else { fail++; failures.push(`✗ ${name}\n    obtenido: ${got}\n    esperado: ${want}`); }
};

eq('Cobro de viajes nace cerrado', defaultLevel('cobro_viajes'), 'none');
eq('Horómetros nace cerrado', defaultLevel('horometros'), 'none');
eq('los que ya estaban cerrados siguen igual', defaultLevel('control_pagos'), 'none');
eq('...viajes también', defaultLevel('viajes_camiones'), 'none');
eq('un módulo cualquiera sigue abierto como antes', defaultLevel('mapa'), 'escritura');

console.log(`\n${fail === 0 ? '✅' : '❌'} test-modulos-nuevos-cerrados · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
