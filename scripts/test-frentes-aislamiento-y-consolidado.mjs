/**
 * Pruebas de regresión — Aislamiento de Reportes → Frentes y Sincronización SOLO en Reporte Consolidado (26-nov-2026).
 *
 * Verifica los 3 requisitos del usuario:
 *  1) Reportes → ⛏️ Frentes muestra SOLO lo que se coloque ahí (NO trae camiones ni viajes de 🚛 Viajes).
 *  2) 🚛 Viajes de camiones sigue trabajando intacto (unirAsignacionesConViajes en rama !esMaq).
 *  3) Reportes → 💰 Consolidado sincroniza ambos (maquinaria de Reportes → Frentes + camiones de Viajes
 *     emparejados por frente normalizado, sin duplicar camiones, preservando camiones a jornada /
 *     camionesPorJornada y respetando incluirCamionesAcarreo incluso en soloEstados).
 */

import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import assert from 'node:assert/strict';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')), '..');

function loadTs(relPath, stubs = {}) {
  const full = path.join(ROOT, relPath);
  const src = fs.readFileSync(full, 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
    fileName: full,
  });
  const mod = new Module(full);
  mod.filename = full;
  mod.paths = Module._nodeModulePaths(path.dirname(full));
  const origReq = mod.require.bind(mod);
  mod.require = (req) => {
    for (const [k, v] of Object.entries(stubs)) {
      if (req === k || req.endsWith('/' + k) || req.endsWith('\\' + k)) return v;
    }
    if (req.startsWith('.')) {
      const base = path.resolve(path.dirname(full), req);
      if (fs.existsSync(base + '.ts')) return loadTs(path.relative(ROOT, base + '.ts'), stubs);
      if (fs.existsSync(base + '.tsx')) return loadTs(path.relative(ROOT, base + '.tsx'), stubs);
    }
    return origReq(req);
  };
  mod._compile(outputText, full);
  return mod.exports;
}

const frentesRep = loadTs('src/lib/frentesReporte.ts');
const consolidado = loadTs('src/lib/reporteConsolidado.ts');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    console.error(`  ❌ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

console.log('🧪 test-frentes-aislamiento-y-consolidado.mjs');

// ── 1) Reportes → Frentes aislado de Viajes de Camiones ────────────────────────
test('1a. FrentesTrabajo (esMaq) NO consulta camion_viajes ni mezcla camiones de Viajes', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/FrentesTrabajo.tsx'), 'utf8');
  const m = src.match(/if \(esMaq\) \{([\s\S]*?)\} else \{/);
  assert.ok(m, 'Debe existir la rama if (esMaq) en FrentesTrabajo.tsx');
  const ramaMaq = m[1];
  assert.doesNotMatch(ramaMaq, /listAsignacionesDesdeViajesRango/, 'Reportes → Frentes NO debe leer camion_viajes');
  assert.doesNotMatch(ramaMaq, /combinarMaquinariaConViajesCamiones/, 'Reportes → Frentes NO debe mezclar camiones de Viajes');
  assert.match(ramaMaq, /listAsignacionesHasta\(fecha, fuente\)/, 'Debe leer solo FRENTES_MAQUINARIA');
  assert.match(ramaMaq, /setViajesPorCamionFrente\(new Map\(\)\)/, 'Debe dejar viajes por frente vacío en modo maquinaria');
  assert.match(src, /if \(!esMaq && \(opPapel\.viajesPorFrente \|\| opPapel\.resumen\)\)/, 'PDF de maquinaria no debe consultar viajes');
});

test('1b. Viajes de camiones (!esMaq) sigue uniendo oficina + viajes reales intacto', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/FrentesTrabajo.tsx'), 'utf8');
  const m = src.match(/\} else \{\s*\/\/ 🚛 VIAJES([\s\S]*?)return \(\) => \{ vivo = false; \};/);
  assert.ok(m, 'Debe existir la rama else (!esMaq) de Viajes');
  assert.match(m[1], /listAsignacionesFrente\(fecha, fuente\)/);
  assert.match(m[1], /listAsignacionesDesdeViajesRango\(fecha, fecha\)/);
  assert.match(m[1], /unirAsignacionesConViajes\(ofiConFecha, deViajes\)/);
});

test('1c. Solo equipos colocados explícitamente en Reportes → Frentes salen en su hoja PDF', () => {
  const vigentes = frentesRep.vigentesAlDia([
    { jornada: '2026-11-25', machineryId: 'exc-1', frenteId: 'f1', frenteNombre: 'CAMURI CHICO' },
    { jornada: '2026-11-25', machineryId: 'cam-manual', frenteId: 'f1', frenteNombre: 'CAMURI CHICO' },
  ], '2026-11-26');
  assert.equal(vigentes.length, 2, 'Salen la excavadora y el camión asignado a mano');
  assert.equal(vigentes.some((a) => a.machineryId === 'cam-solo-viajes'), false, 'Camión no puesto en Reportes → Frentes no entra');
});

const BASE_OP = consolidado.OPCIONES_CONSOLIDADO_POR_DEFECTO ?? {
  fuentes: { jornadas: 'suma', horometros: 'suma', viajes: 'suma', peso: 'suma' },
  seleccionAutomatica: true,
  agruparPor: 'ninguno',
};

// ── 2) Reporte Consolidado sincroniza Maquinaria + Camiones por frente ─────────
test('2a. Consolidado une maquinaria de Reportes→Frentes + camiones de Viajes por frente normalizado sin duplicar', () => {
  const filas = [
    {
      id: 'exc-1', code: 'JUMBO 320', placa: 'CAT01', empresa: 'AJJE',
      frente: 'RESIDENCIAS CAMURÍ CHICO', estado: 'Operativa',
      montos: { jornadas: 600 }, cant: { jornadas: 12 },
    },
    {
      id: 'cam-1', code: 'CAMION VOLTEO TORONTO', placa: 'A06CW8J', empresa: 'GOLDEN TOUCH',
      frente: 'res. camuri chico', estado: 'Operativa',
      montos: { peso: 240 }, cant: { peso: 80000 },
      acarreoPorFrente: { 'res. camuri chico': { peso: 240, pesoKg: 80000, viajesCant: 4 } },
    },
  ];
  const op = {
    ...BASE_OP,
    agruparPor: 'frente',
    soloFrentes: ['RESIDENCIAS CAMURÍ CHICO'],
    catalogoFrentes: ['RESIDENCIAS CAMURÍ CHICO', 'res. camuri chico'],
  };
  const elegidas = consolidado.filasElegidas(filas, op);
  assert.equal(elegidas.length, 2, 'Deben aparecer juntos la maquinaria y el camión en el mismo frente');
  const tot = consolidado.totalesConsolidado(elegidas, op);
  assert.equal(tot.maquinas, 2, 'Sin duplicar equipos');
  assert.equal(tot.total, 840, 'Suma exacta $600 maq + $240 acarreo');

  const html = consolidado.cuerpoConsolidado({ filas: elegidas, desde: '2026-11-25', hasta: '2026-11-26' }, op);
  assert.match(html, /JUMBO 320/);
  assert.match(html, /CAMION VOLTEO TORONTO/);
});

test('2b. Camión pasado a camionesPorJornada sigue apareciendo al filtrar por el frente donde acarreó', () => {
  const filas = [
    {
      id: 'cam-jor', code: 'CAMION VOLTEO TORONTO', placa: 'A90BJ5R', empresa: 'GOLDEN TOUCH',
      frente: 'OTRO FRENTE VIEJO', estado: 'Operativa',
      montos: { jornadas: 180, peso: 220 }, cant: { jornadas: 10, peso: 60000 },
      acarreoPorFrente: { 'PALMA REAL': { peso: 220, pesoKg: 60000, viajesCant: 3 } },
    },
  ];
  const op = {
    ...BASE_OP,
    soloFrentes: ['PALMA REAL'],
    camionesPorJornada: ['cam-jor'],
    catalogoFrentes: ['PALMA REAL', 'OTRO FRENTE VIEJO'],
  };
  const elegidas = consolidado.filasElegidas(filas, op);
  assert.equal(elegidas.length, 1, 'El camión a jornada no debe desaparecer del frente donde acarreó');
  assert.equal(elegidas[0].montos.jornadas, 180);
  assert.equal(elegidas[0].montos.peso ?? 0, 0, 'Peso descartado por jornada');
});

test('2c. incluirCamionesAcarreo también respeta soloEstados junto con soloEmpresas', () => {
  const filas = [
    {
      id: 'exc-1', code: 'RETROEXCAVADORA', placa: 'RET01', empresa: 'AJJE',
      frente: 'PALMA REAL', estado: 'Operativa',
      montos: { jornadas: 400 }, cant: { jornadas: 8 },
    },
    {
      id: 'cam-1', code: 'CAMION VOLTEO TORONTO', placa: 'A13AG9D', empresa: 'GOLDEN TOUCH',
      frente: 'PALMA REAL', estado: 'Inoperativa / Parada',
      montos: { peso: 150 }, cant: { peso: 50000 },
      acarreoPorFrente: { 'PALMA REAL': { peso: 150, pesoKg: 50000, viajesCant: 2 } },
    },
  ];
  const op = {
    ...BASE_OP,
    soloFrentes: ['PALMA REAL'],
    soloEmpresas: ['AJJE'],
    soloEstados: ['Operativa'],
    incluirCamionesAcarreo: true,
    catalogoFrentes: ['PALMA REAL'],
  };
  const elegidas = consolidado.filasElegidas(filas, op);
  assert.equal(elegidas.length, 2, 'El camión de acarreo del frente sigue incluido aunque tenga otro estado/empresa');
});

test('2d. Candados en ReporteConsolidadoCard: prioridad Viajes para camiones, fallback de viajesTon y aviso UX', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/ReporteConsolidadoCard.tsx'), 'utf8');
  assert.match(src, /if \(esCamionDeViajes\(code\) \|\| !frentePorId\.get\(id\)\) frentePorId\.set\(id, nom\)/);
  assert.match(src, /frente: frentePorId\.get\(f\.id\) \|\| frenteAcarreoPrincipal \|\| null/);
  assert.match(src, /const frenteDeViaje = \(v: any\)/);
  assert.match(src, /Une automáticamente la maquinaria de Reportes → ⛏️ Frentes con los camiones/);
});

if (process.exitCode) {
  console.error(`\n❌ Fallaron pruebas (${passed} pasaron).`);
} else {
  console.log(`\n🎉 Todas las pruebas pasaron (${passed}/${passed}).`);
}
