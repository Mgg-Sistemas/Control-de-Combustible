/*
 * Test del PDF DE FRENTES DEL DÍA (`src/lib/frentesReporte.ts`) — 29-sep-2026.
 *
 * QUÉ PEDIDO CUBRE
 *   «agrégame un reporte para los frentes, un PDF que me dé los frentes
 *   registrados para ese día» + «ese reporte no es necesario que tenga
 *   toneladas, ni nada de eso».
 *
 * LO QUE BLINDA
 *   · ⭐ NI UNA CIFRA DE OPERACIÓN: sin viajes, sin peso, sin m³. Es la hoja de
 *     asignación, y meterle cantidades sería justo lo que el cliente descartó.
 *   · LOS FRENTES VACÍOS SALEN IGUAL: el papel sirve para ver qué quedó SIN
 *     asignar; un frente que desaparece se lee como «no existe».
 *   · EL ESCAPE: nombres de frentes y camiones los escribe el usuario.
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

const srcPath = path.join(ROOT, 'src/lib/frentesReporte.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const { frentesDelDia, totalesFrentes, cuerpoFrentesDelDia, nombreArchivoFrentes } = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); } };
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const cam = (code, placa, empresa) => ({ code, placa, empresa });
const ASIG = [
  { frenteNombre: 'RES. CORAL', camion: cam('CHUTO CON VOLQUETA', 'A28CI3K', 'GOLDEN TOUCH') },
  { frenteNombre: 'CANTERA DE NAIGUATA', camion: cam('CAMION VOLTEO TORONTO', 'A41AH7D', 'SAVANNA') },
  { frenteNombre: 'RES. CORAL', camion: cam('CAMION VOLTEO TORONTO', 'A25EB0P', 'SAVANNA') },
];

// ── 1) Agrupar ──────────────────────────────────────────────────────────────
const g = frentesDelDia(ASIG);
eq('agrupa por frente, alfabéticamente', g.map((x) => x.nombre), ['CANTERA DE NAIGUATA', 'RES. CORAL']);
eq('y dentro, los camiones por código', g[1].camiones.map((c) => c.code), ['CAMION VOLTEO TORONTO', 'CHUTO CON VOLQUETA']);
eq('los totales cuadran', totalesFrentes(g), { frentes: 2, frentesConCamiones: 2, camiones: 3 });

// ⭐ Un frente ACTIVO sin camiones ese día SALE IGUAL, con su cero.
const conVacio = frentesDelDia(ASIG, ['CANTERA DE NAIGUATA', 'RES. CORAL', 'FRENTE NUEVO']);
eq('⭐ el frente sin asignar también sale', conVacio.map((x) => x.nombre), ['CANTERA DE NAIGUATA', 'FRENTE NUEVO', 'RES. CORAL']);
eq('…con cero camiones', conVacio.find((x) => x.nombre === 'FRENTE NUEVO').camiones.length, 0);
eq('y los totales lo distinguen', totalesFrentes(conVacio), { frentes: 3, frentesConCamiones: 2, camiones: 3 });
eq('sin nada, no inventa grupos', frentesDelDia([], []), []);

// ── 2) El papel ─────────────────────────────────────────────────────────────
const html = cuerpoFrentesDelDia(conVacio);
ok('trae cada frente con su nombre y su conteo',
  html.includes('CANTERA DE NAIGUATA') && html.includes('RES. CORAL') && html.includes('2 camión(es)'));
ok('y los camiones con su placa y empresa',
  html.includes('A28CI3K') && html.includes('GOLDEN TOUCH') && html.includes('CAMION VOLTEO TORONTO'));
ok('el frente vacío lo dice, no se lo salta',
  html.includes('FRENTE NUEVO') && html.includes('Sin camiones asignados este día'));
ok('el encabezado resume cuántos camiones y frentes', html.includes('3 camión(es) asignados') && html.includes('2 de 3 frente(s)'));

// ⭐⭐ NI UNA CIFRA DE OPERACIÓN (el pedido textual del cliente).
ok('⭐ el papel NO habla de toneladas, kilos, m³ ni viajes',
  !/Ton\b|\bKg\b|m³|tonelaje|viaje\(s\) realizados|Peso/i.test(html),
  html.slice(0, 200));
ok('…y su CSS tampoco mete columnas de cifras', !/pesoNeto|m3Texto/.test(leer('src/lib/frentesReporte.ts')));

// Sin frentes creados, el papel lo dice en vez de salir en blanco.
ok('sin frentes creados, lo dice', cuerpoFrentesDelDia([]).includes('No hay frentes creados'));

// ⭐ Escape: los nombres los escribe el usuario.
const raro = cuerpoFrentesDelDia(frentesDelDia([
  { frenteNombre: '<script>alert(1)</script>', camion: cam('<b>x</b>', '<i>p</i>', '&') },
]));
ok('⭐ el texto del usuario va escapado', !raro.includes('<script>') && !raro.includes('<b>x</b>'));

eq('el nombre del archivo lleva la fecha', nombreArchivoFrentes('2026-09-29'), 'Frentes de trabajo 2026-09-29');

// ── 3) La pantalla ──────────────────────────────────────────────────────────
const comp = leer('src/components/FrentesTrabajo.tsx');
ok('el botón «📄 PDF del día» está en la subsección de frentes',
  /📄 PDF del día/.test(comp) && /onPress=\{exportarPdf\}/.test(comp));
ok('usa la fecha elegida, no «hoy» a la fuerza', /nombreArchivoFrentes\(fecha\)/.test(comp));
ok('⭐ el papel sale sin la marca en texto, como los demás de viajes', /marcaTexto: false/.test(comp));
ok('y ofrece también los frentes activos sin asignación',
  /activos\.map\(\(f\) => f\.nombre\)/.test(comp));

console.log('\nPDF DE FRENTES DEL DÍA — la hoja de asignación, sin cifras\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-frentes-reporte · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
