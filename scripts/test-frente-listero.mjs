// Prueba determinista sin red para el selector de frentes del listero (21-nov-2026).
// Verifica que la elección del listero siempre mande sobre la oficina, que Realtime
// no pise su selección y que reportes + tickets respeten el frente elegido.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const cacheTs = new Map();
function cargar(rel) {
  const p = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (cacheTs.has(p)) return cacheTs.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cacheTs.set(p, m.exports);
  m.require = (spec) => {
    if (spec.startsWith('.')) {
      const base = path.resolve(path.dirname(p), spec);
      for (const cand of [base + '.ts', base + '.tsx', path.join(base, 'index.ts')]) {
        if (fs.existsSync(cand)) return cargar(cand);
      }
    }
    return require(spec);
  };
  m._compile(js, p);
  cacheTs.set(p, m.exports);
  return m.exports;
}

const {
  resolverFrenteParaViaje,
  preseleccionarFrenteListero,
  unirAsignacionesConViajes,
  completarFrentes,
  mapaAsignaciones,
  CAMPOS_VIAJE_ROW,
  CAMPOS_VIAJE_PAGO,
} = cargar('src/lib/frentesAuto.ts');
const { resumirViajes } = cargar('src/lib/viajesResumen.ts');
const { renglonesDelTique } = cargar('src/lib/tiqueDocumento.ts');
const { CONFIG_POR_DEFECTO } = cargar('src/lib/tiqueConfig.ts');
const {
  cuerpoFrentesDelDia,
  nombreArchivoFrentes,
  historialFrentes,
  resumenFrentes,
  FRENTES_POR_DEFECTO,
} = cargar('src/lib/frentesReporte.ts');

const catalogo = [
  { id: 'f-a', nombre: 'PORTO FINO', activo: true },
  { id: 'f-b', nombre: 'VENLIV', activo: true },
  { id: 'f-c', nombre: 'EL MAMON', activo: true },
];

const asigsOficina = [
  { jornada: '2026-11-21', machineryId: 'm1', frenteId: 'f-a', frenteNombre: 'PORTO FINO', creadoAt: '2026-11-21T08:00:00-04:00' },
  { jornada: '2026-11-21', machineryId: 'm1', frenteId: 'f-b', frenteNombre: 'VENLIV', creadoAt: '2026-11-21T10:00:00-04:00' },
];

// 1. Elección explícita del listero SIEMPRE gana sobre la planificación de oficina
const r1 = resolverFrenteParaViaje({
  frenteElegidoId: 'f-c',
  frenteElegidoNombre: 'EL MAMON',
  machineryId: 'm1',
  asignacionesCamion: asigsOficina,
  frentesCatalogo: catalogo,
});
assert.deepEqual(r1, { frenteId: 'f-c', frenteNombre: 'EL MAMON' });

// 2. Elección del listero sobrevive aunque el catálogo aún no haya cargado (offline / red lenta)
const r2 = resolverFrenteParaViaje({
  frenteElegidoId: 'f-c',
  frenteElegidoNombre: 'EL MAMON',
  machineryId: 'm1',
  asignacionesCamion: asigsOficina,
  frentesCatalogo: [],
});
assert.deepEqual(r2, { frenteId: 'f-c', frenteNombre: 'EL MAMON' });

// 3. Camión fuera de catálogo con elección manual del listero conserva su frente
const r3 = resolverFrenteParaViaje({
  frenteElegidoId: 'f-b',
  frenteElegidoNombre: 'VENLIV',
  machineryId: null,
  asignacionesCamion: [],
  frentesCatalogo: catalogo,
});
assert.deepEqual(r3, { frenteId: 'f-b', frenteNombre: 'VENLIV' });

// 4. Sin elección del listero, toma el frente de oficina más reciente por creadoAt
const r4 = resolverFrenteParaViaje({
  frenteElegidoId: null,
  machineryId: 'm1',
  asignacionesCamion: asigsOficina,
  frentesCatalogo: catalogo,
});
assert.deepEqual(r4, { frenteId: 'f-b', frenteNombre: 'VENLIV' });

// 5. Sin elección del listero y con 2 frentes SIN creadoAt, no adivina (devuelve null)
const r5 = resolverFrenteParaViaje({
  frenteElegidoId: null,
  machineryId: 'm1',
  asignacionesCamion: [
    { jornada: '2026-11-21', machineryId: 'm1', frenteId: 'f-a', frenteNombre: 'PORTO FINO', creadoAt: null },
    { jornada: '2026-11-21', machineryId: 'm1', frenteId: 'f-b', frenteNombre: 'VENLIV', creadoAt: null },
  ],
  frentesCatalogo: catalogo,
});
assert.deepEqual(r5, { frenteId: null, frenteNombre: null });

// 6. preseleccionarFrenteListero: un refresco Realtime de oficina NUNCA pisa la selección manual
const p1 = preseleccionarFrenteListero({
  seleccionManual: { frenteId: 'f-c', frenteNombre: 'EL MAMON' },
  machineryId: 'm1',
  asignacionesCamion: asigsOficina,
  frentesCatalogo: catalogo,
});
assert.equal(p1.origen, 'listero');
assert.equal(p1.frenteId, 'f-c');
assert.equal(p1.frenteNombre, 'EL MAMON');
assert.equal(p1.oficinaFrenteId, 'f-b');

// 7. preseleccionarFrenteListero sin selección manual muestra oficina (o ambiguo si falta hora)
const p2 = preseleccionarFrenteListero({
  seleccionManual: null,
  machineryId: 'm1',
  asignacionesCamion: asigsOficina,
  frentesCatalogo: catalogo,
});
assert.equal(p2.origen, 'oficina');
assert.equal(p2.frenteId, 'f-b');

const p3 = preseleccionarFrenteListero({
  seleccionManual: null,
  machineryId: 'm1',
  asignacionesCamion: [
    { jornada: '2026-11-21', machineryId: 'm1', frenteId: 'f-a', frenteNombre: 'PORTO FINO', creadoAt: null },
    { jornada: '2026-11-21', machineryId: 'm1', frenteId: 'f-b', frenteNombre: 'VENLIV', creadoAt: null },
  ],
  frentesCatalogo: catalogo,
});
assert.equal(p3.origen, 'ninguno');
assert.equal(p3.ambiguoOficina, true);

// 8. completarFrentes (pantalla y pago) jamás pisa el frente elegido por el listero
const mapaOfi = mapaAsignaciones([
  { jornada: '2026-11-21', machineryId: 'm1', frenteId: 'f-a', frenteNombre: 'PORTO FINO', creadoAt: '2026-11-21T08:00:00-04:00' },
]);
const viajeRow = {
  id: 'v1',
  machineryId: 'm1',
  registeredAt: '2026-11-21T14:00:00-04:00',
  frenteId: 'f-c',
  frenteNombre: 'EL MAMON',
  listeroId: 'u1',
  listeroName: 'Listero 1',
};
const { filas: filasRow } = completarFrentes([viajeRow], mapaOfi, () => '2026-11-21', CAMPOS_VIAJE_ROW);
assert.equal(filasRow[0].frenteId, 'f-c');
assert.equal(filasRow[0].frenteNombre, 'EL MAMON');

const viajePago = {
  id: 'v1',
  machinery_id: 'm1',
  registered_at: '2026-11-21T14:00:00-04:00',
  frente_nombre: 'EL MAMON',
};
const { filas: filasPago } = completarFrentes([viajePago], mapaOfi, () => '2026-11-21', CAMPOS_VIAJE_PAGO);
assert.equal(filasPago[0].frente_nombre, 'EL MAMON');

// 9. Resumen por frente agrupa bajo el frente elegido por el listero
const res = resumirViajes(filasRow, () => ({ id: 'm1', code: 'VOL-01', companyId: 'c1', companyName: 'GT' }), 'frente');
assert.equal(res.empresas.length, 1);
assert.equal(res.empresas[0].name, 'EL MAMON');
assert.equal(res.empresas[0].total, 1);

// 10. Ticket impreso muestra el frente elegido por el listero
const renglones = renglonesDelTique(
  {
    folio: '001',
    fechaHora: '21/11/2026 02:00 PM',
    camion: 'VOL-01',
    placa: 'A36AD7J',
    frente: 'EL MAMON',
  },
  CONFIG_POR_DEFECTO,
);
assert(renglones.some((x) => x.k === 'Frente' && x.v === 'EL MAMON'));

// 11. unirAsignacionesConViajes: el Tablero, PDF e Historial reflejan TODOS los frentes donde hubo viajes
const ofiDia = [
  { jornada: '2026-11-21', machineryId: 'm1', frenteId: 'f-a', frenteNombre: 'PORTO FINO', creadoAt: '2026-11-21T07:30:00-04:00' },
];
const viajesDia = [
  { jornada: '2026-11-21', machineryId: 'm1', frenteId: 'f-a', frenteNombre: 'PORTO FINO', creadoAt: '2026-11-21T08:10:00-04:00' },
  { jornada: '2026-11-21', machineryId: 'm1', frenteId: 'f-c', frenteNombre: 'EL MAMON', creadoAt: '2026-11-21T13:15:00-04:00' },
  { jornada: '2026-11-21', machineryId: 'm2', frenteId: 'f-b', frenteNombre: 'VENLIV', creadoAt: '2026-11-21T09:00:00-04:00' },
];
const unidas = unirAsignacionesConViajes(ofiDia, viajesDia);
assert.equal(unidas.length, 3);
const m1A = unidas.find((x) => x.machineryId === 'm1' && x.frenteId === 'f-a');
const m1C = unidas.find((x) => x.machineryId === 'm1' && x.frenteId === 'f-c');
assert.equal(m1A.desdeViajes, true);
assert.equal(m1A.soloViajes, false);
assert.equal(m1C.desdeViajes, true);
assert.equal(m1C.soloViajes, true);
const hist = historialFrentes(unidas);
assert.equal(hist.length, 1);
assert.equal(hist[0].camiones, 2);
assert.equal(hist[0].frentes.length, 3);

// 12. Opción viajesPorFrente en PDF de frentes: apagada no deja rastro; encendida muestra viajes y va al nombre del archivo
const gruposPdf = [
  { nombre: 'PORTO FINO', camiones: [{ id: 'm1', code: 'VOL-01', placa: 'A36AD7J', empresa: 'GT', viajesEnFrente: 3 }] },
  { nombre: 'EL MAMON', camiones: [{ id: 'm1', code: 'VOL-01', placa: 'A36AD7J', empresa: 'GT', viajesEnFrente: 2 }] },
];
const htmlSinViajes = cuerpoFrentesDelDia(gruposPdf, { ...FRENTES_POR_DEFECTO, viajesPorFrente: false });
assert(!htmlSinViajes.includes('<th>Viajes</th>'), 'Con viajesPorFrente apagado no debe salir columna Viajes');
assert(!nombreArchivoFrentes('2026-11-21', { ...FRENTES_POR_DEFECTO, viajesPorFrente: false }).includes('con viajes'));

const htmlConViajes = cuerpoFrentesDelDia(gruposPdf, { ...FRENTES_POR_DEFECTO, viajesPorFrente: true });
assert(htmlConViajes.includes('<th>Viajes</th>'), 'Con viajesPorFrente encendido debe salir columna Viajes');
assert(htmlConViajes.includes('<td>3</td>') && htmlConViajes.includes('<td>2</td>'), 'Debe mostrar los viajes exactos en cada frente');
assert(nombreArchivoFrentes('2026-11-21', { ...FRENTES_POR_DEFECTO, viajesPorFrente: true }).includes('con viajes'));

// 13. resumenFrentes con soloFrentes suma SOLO viajesEnFrente del frente filtrado (sin duplicar otros frentes)
const resSoloA = resumenFrentes(
  [{ nombre: 'PORTO FINO', camiones: [{ id: 'm1', code: 'VOL-01', placa: 'A36AD7J', empresa: 'GT', viajes: 8, viajesEnFrente: 3 }] }],
  { ...FRENTES_POR_DEFECTO, resumen: true, soloFrentes: ['PORTO FINO'] },
);
const tjViajes = resSoloA.tarjetas.find((t) => t.k === 'viajes');
assert.equal(tjViajes?.valor, '3', 'Filtrado por soloFrentes debe contar 3 viajes en ese frente, no los 8 totales del camión');

// 14. Blindajes de auditoría: fallback '—' sin viajesEnFrente, FK 23503 en registrarViaje y !soloViajes en FrentesTrabajo
const htmlSinDatoViaje = cuerpoFrentesDelDia(
  [{ nombre: 'PORTO FINO', camiones: [{ id: 'm1', code: 'VOL-01', placa: 'A36AD7J', empresa: 'GT', viajes: 8, viajesEnFrente: null }] }],
  { ...FRENTES_POR_DEFECTO, viajesPorFrente: true },
);
assert(htmlSinDatoViaje.includes('<td>—</td>'), 'Sin viajesEnFrente debe caer a — y no repetir total diario');
const camionViajesSrc = fs.readFileSync(path.join(ROOT, 'src/lib/camionViajes.ts'), 'utf8');
assert(camionViajesSrc.includes("r.error.code === '23503'") && camionViajesSrc.includes('frente_id: null'), 'registrarViaje debe recuperar FK 23503 de frente borrado');
const frentesTrabajoSrc = fs.readFileSync(path.join(ROOT, 'src/components/FrentesTrabajo.tsx'), 'utf8');
assert(frentesTrabajoSrc.includes('asignaciones.filter((a) => !a.soloViajes)'), 'mover y pedirRepetir deben excluir filas soloViajes');

console.log('✅ test-frente-listero: todas las pruebas pasaron (14/14).');
