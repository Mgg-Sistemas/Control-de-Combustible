/*
 * Test del RESUMEN GLOBALIZADO de viajes de camiones (20-ago-2026).
 *
 * Pedido del cliente: el reporte de viajes no siempre debe salir desglosado viaje
 * por viaje. Debe poder pedirse "camión X → N viajes", con varios camiones a la
 * vez, y al filtrar por empresa deben salir TODOS sus camiones, el número global
 * de viajes de la empresa y su desglose.
 *
 * Fija lo que no se puede romper:
 *   · el TOTAL GENERAL siempre cuadra con la cantidad de viajes recibidos
 *   · el total de cada empresa cuadra con la suma de sus camiones
 *   · la placa sale del camión, con el serial como respaldo
 *   · un viaje de un camión que ya no está en el catálogo NO se pierde
 *   · el orden es de más viajes a menos, tanto empresas como camiones
 *
 * Sin framework (el repo no tiene): transpila el .ts en memoria con `typescript`.
 *
 *   npm run test:viajes   (o: node scripts/test-viajes-resumen.mjs)
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

const srcPath = path.join(ROOT, 'src/lib/viajesResumen.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const { resumirViajes, SIN_EMPRESA } = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── Catálogo de camiones, con los casos reales del sistema ──────────────────
const CAMIONES = {
  t1: { companyId: 'beraca', companyName: 'INVERSIONES BERACA 2021 CA', plate: 'A98AJ0G', serial: null },
  t2: { companyId: 'beraca', companyName: 'INVERSIONES BERACA 2021 CA', plate: null, serial: '251619' }, // sin placa → serial
  t3: { companyId: 'costa',  companyName: 'INGENIERIA & LOGISTICA COSTA BRAVA, C.A', plate: null, serial: null }, // ni placa ni serial
  t4: { companyId: null,     companyName: '', plate: 'A15AW5I', serial: null }, // camión sin empresa asignada
};
const cat = (id) => CAMIONES[id];
const viaje = (id, code) => ({ machineryId: id, machineCode: code });

// ── 1) EL CASO DE USO: varios camiones de varias empresas ───────────────────
const rows = [
  ...Array.from({ length: 5 }, () => viaje('t1', 'CAMION VOLTEO TORONTO')),
  ...Array.from({ length: 3 }, () => viaje('t2', 'GRÚAS TELESCÓPICAS 30 TON')),
  ...Array.from({ length: 9 }, () => viaje('t3', 'CHUTO CON VOLQUETA')),
];
const r = resumirViajes(rows, cat);

eq('el total general cuadra con los viajes recibidos', r.total, 17);
eq('cuenta los camiones distintos', r.totalCamiones, 3);
eq('la empresa con más viajes va primero', r.empresas[0].name, 'INGENIERIA & LOGISTICA COSTA BRAVA, C.A');
eq('total de la empresa líder', r.empresas[0].total, 9);
eq('total de la segunda empresa (5 + 3)', r.empresas[1].total, 8);

// El total de cada empresa SIEMPRE es la suma de sus camiones: si esto se rompe,
// el reporte muestra un global que no cuadra con su propio desglose.
r.empresas.forEach((e) => {
  eq(`total de "${e.name}" = suma de su desglose`, e.camiones.reduce((s, c) => s + c.viajes, 0), e.total);
});
eq('la suma de las empresas es el total general', r.empresas.reduce((s, e) => s + e.total, 0), r.total);

// ── 2) DENTRO DE LA EMPRESA: de más viajes a menos ──────────────────────────
const beraca = r.empresas.find((e) => e.key === 'beraca');
eq('los camiones de la empresa van de más a menos viajes',
  beraca.camiones.map((c) => c.viajes), [5, 3]);
eq('el camión con más viajes de BERACA', beraca.camiones[0].code, 'CAMION VOLTEO TORONTO');

// ── 3) LA PLACA: la del camión, con el serial de respaldo ───────────────────
eq('usa la placa cuando existe', beraca.camiones[0].placa, 'A98AJ0G');
eq('cae al serial cuando no hay placa', beraca.camiones[1].placa, '251619');
eq('sin placa ni serial muestra guion',
  r.empresas.find((e) => e.key === 'costa').camiones[0].placa, '—');

// ── 4) UN SOLO CAMIÓN (el caso "camión X → cuántos viajes") ─────────────────
const uno = resumirViajes(Array.from({ length: 12 }, () => viaje('t1', 'CAMION VOLTEO TORONTO')), cat);
eq('un solo camión: total', uno.total, 12);
eq('un solo camión: una empresa', uno.empresas.length, 1);
eq('un solo camión: sin desglosar viaje por viaje', uno.empresas[0].camiones.length, 1);
eq('un solo camión: su cantidad de viajes', uno.empresas[0].camiones[0].viajes, 12);

// ── 5) CAMIÓN SIN EMPRESA y CAMIÓN QUE YA NO ESTÁ EN EL CATÁLOGO ────────────
const sueltos = resumirViajes(
  [viaje('t4', 'CHUTO CON VOLQUETA'), viaje('borrado', 'CAMION VIEJO'), viaje('t1', 'CAMION VOLTEO TORONTO')],
  cat
);
eq('total con camiones sin empresa / desconocidos', sueltos.total, 3);
const sin = sueltos.empresas.find((e) => e.key === SIN_EMPRESA);
ok('los que no tienen empresa caen en una sola cubeta', !!sin);
eq('la cubeta "Sin empresa" junta al sin-empresa y al desconocido', sin.total, 2);
eq('el camión borrado del catálogo NO se pierde',
  sin.camiones.some((c) => c.code === 'CAMION VIEJO'), true);
eq('nada se pierde: la suma sigue cuadrando',
  sueltos.empresas.reduce((s, e) => s + e.total, 0), sueltos.total);

// ── 6) SIN VIAJES ──────────────────────────────────────────────────────────
const vacio = resumirViajes([], cat);
eq('sin viajes: total 0', vacio.total, 0);
eq('sin viajes: sin empresas', vacio.empresas.length, 0);
eq('sin viajes: sin camiones', vacio.totalCamiones, 0);

// ── 7) NO MUTA LO QUE RECIBE ───────────────────────────────────────────────
const original = [viaje('t1', 'A'), viaje('t2', 'B')];
const copia = JSON.stringify(original);
resumirViajes(original, cat);
eq('no modifica las filas que recibe', JSON.stringify(original), copia);

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-resumen · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
