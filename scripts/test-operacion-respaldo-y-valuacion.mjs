import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const moduleCache = new Map();

function loadTs(relPath) {
  const full = path.resolve(root, relPath);
  if (moduleCache.has(full)) return moduleCache.get(full);
  const src = fs.readFileSync(full, 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: full,
  });
  const mod = { exports: {} };
  moduleCache.set(full, mod.exports);
  const localRequire = (spec) => {
    if (spec.startsWith('.')) {
      const base = path.resolve(path.dirname(full), spec);
      for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          return loadTs(path.relative(root, cand));
        }
      }
    }
    throw new Error(`No se pudo resolver ${spec} desde ${relPath}`);
  };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText);
  fn(mod.exports, localRequire, mod, full, path.dirname(full));
  moduleCache.set(full, mod.exports);
  return mod.exports;
}

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.error(`  ✗ ${label}\n    ${e.message}`);
  }
}

const ub = loadTs('src/lib/ubicacionesObra.ts');
const val = loadTs('src/lib/viajesValuacionPdf.ts');

// 1. Resolución de operación con respaldo en registro de viajes
check('resolverProyectoOperacionDeRegistro existe', () => {
  assert.equal(typeof ub.resolverProyectoOperacionDeRegistro, 'function');
});

check('1) Prioridad 1: respeta la operación elegida explícitamente aunque el respaldo diga otra', () => {
  assert.equal(
    ub.resolverProyectoOperacionDeRegistro({
      elegida: 'tfi',
      obraOperacion: 'miyamoto',
      responsableNombre: 'MIYAMOTO',
      formatoNombre: 'MIYAMOTO',
    }),
    'tfi',
  );
});

check('2) Prioridad 2: usa la operación del CDT si no hay elección explícita', () => {
  assert.equal(
    ub.resolverProyectoOperacionDeRegistro({
      elegida: null,
      obraOperacion: 'tfi',
      responsableNombre: 'MIYAMOTO',
      formatoNombre: 'MIYAMOTO',
    }),
    'tfi',
  );
});

check('3) Prioridad 3: usa el responsable del camión (MIYAMOTO / TFI) cuando el CDT es compartido (null)', () => {
  assert.equal(
    ub.resolverProyectoOperacionDeRegistro({
      elegida: null,
      obraOperacion: null,
      responsableNombre: 'MIYAMOTO',
      formatoNombre: 'Formato Principal',
    }),
    'miyamoto',
  );
  assert.equal(
    ub.resolverProyectoOperacionDeRegistro({
      elegida: null,
      obraOperacion: null,
      responsableNombre: '  tfi ',
      formatoNombre: 'Formato Principal',
    }),
    'tfi',
  );
});

check('4) Prioridad 4: usa el formato de ticket del listero (MIYAMOTO / TFI) si el camión aún no tiene responsable', () => {
  assert.equal(
    ub.resolverProyectoOperacionDeRegistro({
      elegida: null,
      obraOperacion: null,
      responsableNombre: null,
      formatoNombre: 'MIYAMOTO',
    }),
    'miyamoto',
  );
});

check('5) No inventa operación cuando responsable/formato son genéricos (ej. SMK / Formato Principal)', () => {
  assert.equal(
    ub.resolverProyectoOperacionDeRegistro({
      elegida: null,
      obraOperacion: null,
      responsableNombre: 'SMK',
      formatoNombre: 'Formato Principal',
    }),
    null,
  );
});

// 2. Detección de viajes sin operación en Valuación (para nunca ocultarlos en silencio)
check('resumenViajesSinOperacionValuacion existe y detecta los viajes sin proyecto_operacion en el rango', () => {
  assert.equal(typeof val.resumenViajesSinOperacionValuacion, 'function');
  const muestra = [
    { id: '1', folio: 'CDT-006860', registered_at: '2026-11-26T16:12:00Z', placa_snap: 'A01FE8M', peso_neto_kg: 34120, proyecto_operacion: 'miyamoto' },
    { id: '2', folio: 'CDT-006862', registered_at: '2026-11-26T16:18:00Z', placa_snap: 'A06CW9J', peso_neto_kg: 34100, proyecto_operacion: null },
    { id: '3', folio: 'CDT-006864', registered_at: '2026-11-26T16:24:00Z', placa_snap: 'A38CX3J', peso_neto_kg: 33300, proyecto_operacion: '' },
    { id: '4', folio: 'CDT-006865', registered_at: '2026-11-26T16:25:00Z', placa_snap: '69TBA0', peso_neto_kg: 21520, proyecto_operacion: 'tfi' },
    // Fuera de la jornada 2026-11-26 (antes de las 7am Caracas = antes de 11:00Z)
    { id: '5', folio: 'CDT-006700', registered_at: '2026-11-26T09:00:00Z', placa_snap: 'A00AA0A', peso_neto_kg: 20000, proyecto_operacion: null },
  ];
  const r = val.resumenViajesSinOperacionValuacion(muestra, '2026-11-26', '2026-11-26');
  assert.equal(r.cantidad, 2);
  assert.equal(r.totalT, 67.4);
  assert.deepEqual(r.ejemplos, ['CDT-006862 (A06CW9J)', 'CDT-006864 (A38CX3J)']);
});

// 3. Cableado en ViajesCamionesScreen.tsx y ValuacionViajesCard.tsx
const screenSrc = fs.readFileSync(path.resolve(root, 'src/screens/ViajesCamionesScreen.tsx'), 'utf8');
const cardSrc = fs.readFileSync(path.resolve(root, 'src/components/ValuacionViajesCard.tsx'), 'utf8');

check('ViajesCamionesScreen persiste operacionSel en AsyncStorage y usa resolverProyectoOperacionDeRegistro en patio y carga manual', () => {
  assert.match(screenSrc, /viajes_operacion_sel_v1/);
  const ocurrencias = screenSrc.match(/resolverProyectoOperacionDeRegistro\(/g) ?? [];
  assert.ok(ocurrencias.length >= 2, `Se esperaban >=2 usos de resolverProyectoOperacionDeRegistro y hay ${ocurrencias.length}`);
});

check('ValuacionViajesCard muestra advertencia cuando hay viajes sin operación en el período filtrado', () => {
  assert.match(cardSrc, /resumenViajesSinOperacionValuacion/);
  assert.match(cardSrc, /SIN operaci[oó]n asignada/i);
});

console.log(`test-operacion-respaldo-y-valuacion: ${pass} pasaron, ${fail} fallaron.`);
if (fail > 0) process.exit(1);
