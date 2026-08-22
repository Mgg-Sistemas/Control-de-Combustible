/*
 * Test de los CAMIONES FUERA DE CATÁLOGO en Viajes de camiones (21-ago-2026).
 *
 * QUÉ PEDIDO CUBRE (textual del cliente):
 *   «si no tienen la información del camión por el sistema, puedan tener una
 *    casilla para registrar la información del camión sin que se guarde a nivel
 *    de catálogo ni que afecte al sistema, pero que sí guarde el registro para
 *    ese viaje»
 *
 * LO QUE BLINDA (`src/lib/viajesResumen.ts`):
 *   · ⭐ DOS CAMIONES ANOTADOS A MANO NO SE FUNDEN EN UNO. Es el riesgo real: no
 *     tienen id, y agrupar por `machineryId` los metería a todos en la cubeta
 *     `null`. "VOLTEO 88" y "VOLTEO 99" saldrían sumados como un solo camión y
 *     el reporte mentiría — con viajes que se facturan.
 *   · Un camión de fuera NUNCA se mezcla con uno del catálogo.
 *   · Los totales siguen cuadrando con la cantidad de filas recibidas.
 *   · Se marcan como FUERA DE CATÁLOGO para que quien revisa no los confunda
 *     con flota propia.
 *   · Los camiones normales del catálogo se siguen contando igual que siempre
 *     (regresión: esto ya funcionaba y no se puede romper).
 *
 * No usa framework de test (el repo no tiene): transpila el .ts en memoria con
 * el `typescript` ya instalado.
 *
 *   node scripts/test-viajes-fuera-catalogo.mjs   (o: npm run test:all)
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

const loadTs = (srcPath) => {
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  m._compile(out, m.filename);
  return m.exports;
};

const { resumirViajes, claveCamion, SIN_EMPRESA, FUERA_CATALOGO } = loadTs(path.join(ROOT, 'src/lib/viajesResumen.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// Catálogo de mentira: dos camiones reales de la misma empresa.
const CAT = {
  'id-1': { companyId: 'emp-a', companyName: 'TRANSPORTE A', plate: 'AA111', serial: null },
  'id-2': { companyId: 'emp-a', companyName: 'TRANSPORTE A', plate: 'BB222', serial: null },
};
const buscar = (id) => CAT[id];
const fuera = (code) => ({ machineryId: null, machineCode: code, fueraCatalogo: true });
const dentro = (id, code) => ({ machineryId: id, machineCode: code, fueraCatalogo: false });

// Viajes de un camión dentro de una cubeta. Devuelve 0 si no está, en vez de
// reventar: si el agrupador se rompe y funde camiones, se quiere ver el REPORTE
// de qué falló, no un stack trace que esconde las demás comprobaciones.
const viajesDe = (grupo, code) => (grupo?.camiones ?? []).find((c) => c.code === code)?.viajes ?? 0;

// ── 1) ⭐ DOS CAMIONES DE FUERA NO SE FUNDEN ──────────────────────────────
{
  const r = resumirViajes([fuera('VOLTEO 88'), fuera('VOLTEO 88'), fuera('VOLTEO 99')], buscar);
  const sin = r.empresas.find((e) => e.key === SIN_EMPRESA);
  eq('⭐ salen DOS camiones, no uno', sin.camiones.length, 2);
  eq('el de 2 viajes', viajesDe(sin, 'VOLTEO 88'), 2);
  eq('el de 1 viaje', viajesDe(sin, 'VOLTEO 99'), 1);
  eq('el total de la cubeta cuadra', sin?.total, 3);
  eq('el total general cuadra con las filas', r.total, 3);
  eq('⭐ se cuentan 2 camiones distintos', r.totalCamiones, 2);
}

// ── 2) LA CLAVE: misma escritura = mismo camión ───────────────────────────
{
  eq('mayúsculas y minúsculas son el mismo', claveCamion(fuera('volteo 88')), claveCamion(fuera('VOLTEO 88')));
  eq('espacios de más no cuentan', claveCamion(fuera('  VOLTEO 88  ')), claveCamion(fuera('VOLTEO 88')));
  ok('nombres distintos dan claves distintas', claveCamion(fuera('VOLTEO 88')) !== claveCamion(fuera('VOLTEO 99')));
  ok('la clave de uno de fuera se distingue', claveCamion(fuera('X')).startsWith(FUERA_CATALOGO));
  eq('el del catálogo usa su id', claveCamion(dentro('id-1', 'C1')), 'id-1');
  // ⭐ Un camión de fuera cuyo código coincida con el ID de uno real NO se puede
  // confundir con él: la clave lleva prefijo.
  ok('⭐ no colisiona con un id del catálogo', claveCamion(fuera('id-1')) !== 'id-1');
}

// ── 3) ⭐ NO SE MEZCLAN CON LOS DEL CATÁLOGO ──────────────────────────────
{
  const r = resumirViajes([dentro('id-1', 'CAMION 1'), dentro('id-1', 'CAMION 1'), fuera('CAMION 1')], buscar);
  const empA = r.empresas.find((e) => e.key === 'emp-a');
  const sin = r.empresas.find((e) => e.key === SIN_EMPRESA);
  eq('el del catálogo va con su empresa', viajesDe(empA, 'CAMION 1'), 2);
  eq('la placa del catálogo se respeta', empA.camiones[0].placa, 'AA111');
  ok('⭐ el de fuera va aparte aunque se llame igual', !!sin);
  eq('y con su propio conteo', viajesDe(sin, 'CAMION 1'), 1);
  eq('total general', r.total, 3);
  eq('son 2 camiones', r.totalCamiones, 2);
}

// ── 4) SE MARCA COMO FUERA DE CATÁLOGO ────────────────────────────────────
{
  const r = resumirViajes([fuera('VOLTEO 88')], buscar);
  const cam = r.empresas[0].camiones[0];
  eq('⭐ la placa avisa que es de fuera', cam.placa, 'FUERA DE CATÁLOGO');
  eq('conserva el nombre que escribió el listero', cam.code, 'VOLTEO 88');
  eq('cae en "Sin empresa" (no se le inventa una)', r.empresas[0].name, 'Sin empresa');
}

// ── 5) REGRESIÓN: los del catálogo se cuentan igual que siempre ───────────
{
  const r = resumirViajes(
    [dentro('id-1', 'C1'), dentro('id-1', 'C1'), dentro('id-2', 'C2'), dentro('id-desconocido', 'C9')],
    buscar
  );
  const empA = r.empresas.find((e) => e.key === 'emp-a');
  eq('la empresa suma sus dos camiones', empA.total, 3);
  eq('ordenados de más viajes a menos', empA.camiones.map((c) => c.viajes), [2, 1]);
  // Un camión que ya no está en el catálogo NO se pierde (regla vieja).
  const sin = r.empresas.find((e) => e.key === SIN_EMPRESA);
  eq('el borrado del catálogo sigue apareciendo', sin.camiones[0].code, 'C9');
  eq('⭐ el total general cuadra con las filas', r.total, 4);
}

// ── 6) BASURA: no revienta ────────────────────────────────────────────────
{
  eq('lista vacía', resumirViajes([], buscar).total, 0);
  const r = resumirViajes([{ machineryId: null, machineCode: '', fueraCatalogo: true }], buscar);
  eq('sin nombre no revienta', r.total, 1);
  ok('sin `fueraCatalogo` declarado se trata por el id', claveCamion({ machineryId: 'id-1', machineCode: 'X' }) === 'id-1');
}

// ── Resultado ─────────────────────────────────────────────────────────────
console.log(`\n🚚  Camiones fuera de catálogo (viajes)`);
console.log(`   ${pass} OK · ${fail} fallo(s)`);
if (fail) {
  console.log(`\n${failures.join('\n')}\n`);
  process.exit(1);
}
console.log('   ✅ Todo en verde\n');
