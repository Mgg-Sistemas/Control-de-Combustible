/*
 * Test del FRENTE QUE SE TOMA SOLO (`src/lib/frentesAuto.ts`) — 29-sep-2026.
 *
 * QUÉ PEDIDO CUBRE, textual
 *   «los frentes asignados para un día deben tomarlo automáticamente los viajes
 *   de ese día, estén registrados o no estén registrados; si los frentes se
 *   asignan para ciertas máquinas el día xx, todas las máquinas que tengan
 *   asignados esos frentes lo tomarán automáticamente para ese día esos frentes».
 *
 * LO QUE BLINDA — y por qué cada cosa
 *   · ⭐ HACIA ATRÁS TAMBIÉN. La asignación se hace en la oficina, muchas veces
 *     DESPUÉS de que el listero registró; si solo valiera para lo que viene, los
 *     viajes de la mañana seguirían saliendo «sin frente» y habría que entrar a
 *     ✏️ Editar uno por uno. Ese era justo el reclamo.
 *   · ⭐ LO CONGELADO MANDA. Solo se completa el frente VACÍO. Un camión que
 *     cambió de frente a mediodía tiene que conservar los viajes de la mañana en
 *     su frente, y una corrección hecha a mano no puede borrarse al recargar.
 *   · ⭐ NO TOCA LA BASE. Se resuelve al LEER: ningún UPDATE masivo que nadie
 *     pueda deshacer, y si mañana se corrige la asignación los reportes se
 *     corrigen solos.
 *   · LOS DOS PAPELES DICEN LO MISMO. La lista completa y el reporte de pago
 *     usan la MISMA función, cada uno con su forma de fila (camelCase y
 *     snake_case). Si solo uno la usara, el mismo viaje saldría con frente en un
 *     PDF y sin frente en el otro.
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

const cargar = (rel) => {
  const srcPath = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  m._compile(out, m.filename);
  return m.exports;
};

const {
  claveAsignacion, mapaAsignaciones, completarFrentes, rangoJornadas,
  CAMPOS_VIAJE_ROW, CAMPOS_VIAJE_PAGO,
} = cargar('src/lib/frentesAuto.ts');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); } };
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// La jornada de negocio va de 7am a 7am: un viaje de la madrugada pertenece al
// día ANTERIOR. Acá se simula con la misma regla, sin importar caracasDay (este
// archivo tiene que poder probarse solo).
const jornadaDe = (iso) => {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const base = new Date(d.getTime() - (h < 11 ? 24 * 3600 * 1000 : 0));
  return base.toISOString().slice(0, 10);
};

// ── 1) El mapa ──────────────────────────────────────────────────────────────
eq('la clave es jornada + camión', claveAsignacion('2026-09-29', 'cam-1'), '2026-09-29|cam-1');
eq('una fecha con hora se recorta al día', claveAsignacion('2026-09-29T07:00:00-04:00', 'cam-1'), '2026-09-29|cam-1');

const ASIGS = [
  { jornada: '2026-09-29', machineryId: 'cam-1', frenteId: 'f1', frenteNombre: 'RES. CORAL' },
  { jornada: '2026-09-29', machineryId: 'cam-2', frenteId: 'f2', frenteNombre: 'CANTERA DE NAIGUATA' },
  { jornada: '2026-09-28', machineryId: 'cam-1', frenteId: 'f2', frenteNombre: 'CANTERA DE NAIGUATA' },
];
const MAPA = mapaAsignaciones(ASIGS);
eq('el mapa tiene una entrada por jornada+camión', MAPA.size, 3);
eq('una asignación sin frente no entra al mapa',
  mapaAsignaciones([{ jornada: '2026-09-29', machineryId: 'cam-1', frenteId: '', frenteNombre: '' }]).size, 0);

// ── 2) ⭐ LOS VIAJES YA REGISTRADOS TOMAN EL FRENTE ──────────────────────────
const VIAJES = [
  // sin frente, camión con asignación ese día → lo toma
  { id: 'v1', machineryId: 'cam-1', registeredAt: '2026-09-29T14:00:00.000Z', frenteId: null, frenteNombre: null },
  // ya trae el suyo congelado → NO se toca
  { id: 'v2', machineryId: 'cam-1', registeredAt: '2026-09-29T15:00:00.000Z', frenteId: 'f9', frenteNombre: 'FRENTE VIEJO' },
  // camión sin asignación ese día → se queda sin frente
  { id: 'v3', machineryId: 'cam-9', registeredAt: '2026-09-29T14:00:00.000Z', frenteId: null, frenteNombre: null },
  // fuera del catálogo (sin machineryId) → no hay a qué asignarle
  { id: 'v4', machineryId: null, registeredAt: '2026-09-29T14:00:00.000Z', frenteId: null, frenteNombre: null },
  // otro día: toma el frente de SU día, no el de hoy
  { id: 'v5', machineryId: 'cam-1', registeredAt: '2026-09-28T14:00:00.000Z', frenteId: null, frenteNombre: null },
];
const r1 = completarFrentes(VIAJES, MAPA, jornadaDe, CAMPOS_VIAJE_ROW);
eq('⭐ el viaje ya registrado sin frente TOMA el asignado ese día',
  r1.filas.find((v) => v.id === 'v1').frenteNombre, 'RES. CORAL');
eq('…con su id, no solo el nombre', r1.filas.find((v) => v.id === 'v1').frenteId, 'f1');
eq('⭐ el que ya traía frente propio se queda con el suyo',
  r1.filas.find((v) => v.id === 'v2').frenteNombre, 'FRENTE VIEJO');
eq('un camión sin asignación ese día sigue sin frente',
  r1.filas.find((v) => v.id === 'v3').frenteNombre, null);
eq('un viaje fuera del catálogo no se inventa frente',
  r1.filas.find((v) => v.id === 'v4').frenteNombre, null);
eq('⭐ cada viaje toma el frente de SU jornada, no el de hoy',
  r1.filas.find((v) => v.id === 'v5').frenteNombre, 'CANTERA DE NAIGUATA');
eq('dice cuántos completó', r1.completados, 2);

// La madrugada pertenece a la jornada anterior (7am→7am).
const madrugada = completarFrentes(
  [{ id: 'm1', machineryId: 'cam-1', registeredAt: '2026-09-30T05:00:00.000Z', frenteId: null, frenteNombre: null }],
  MAPA, jornadaDe, CAMPOS_VIAJE_ROW);
eq('⭐ un viaje de la madrugada toma el frente de la jornada que empezó ayer',
  madrugada.filas[0].frenteNombre, 'RES. CORAL');

// ⭐ NO MUTA lo que entra: la pantalla guarda esas filas en su estado.
ok('⭐ no muta las filas originales', VIAJES[0].frenteNombre === null);
ok('sin asignaciones no hace nada (y devuelve las mismas filas)',
  completarFrentes(VIAJES, new Map(), jornadaDe, CAMPOS_VIAJE_ROW).filas === VIAJES);
eq('sin viajes, cero', completarFrentes([], MAPA, jornadaDe, CAMPOS_VIAJE_ROW).completados, 0);

// Un frente que se puso a mano en ✏️ Editar cuenta como propio, aunque no
// tenga id (viajes viejos importados).
eq('un frente puesto a mano sin id también manda',
  completarFrentes([{ machineryId: 'cam-1', registeredAt: '2026-09-29T14:00:00.000Z', frenteId: null, frenteNombre: 'A MANO' }],
    MAPA, jornadaDe, CAMPOS_VIAJE_ROW).completados, 0);

// ── 3) La MISMA regla en la fila cruda del pago ──────────────────────────────
const PAGO = [
  { id: 'p1', machinery_id: 'cam-2', registered_at: '2026-09-29T14:00:00.000Z', frente_nombre: null },
  { id: 'p2', machinery_id: 'cam-2', registered_at: '2026-09-29T15:00:00.000Z', frente_nombre: 'YA TENIA' },
];
const r2 = completarFrentes(PAGO, MAPA, jornadaDe, CAMPOS_VIAJE_PAGO);
eq('⭐ el reporte de pago completa igual el frente vacío',
  r2.filas.find((v) => v.id === 'p1').frente_nombre, 'CANTERA DE NAIGUATA');
eq('…y respeta igual el que ya venía', r2.filas.find((v) => v.id === 'p2').frente_nombre, 'YA TENIA');

// ── 4) El rango que se le pide a la base ────────────────────────────────────
eq('el rango va del día más viejo al más nuevo',
  rangoJornadas(['2026-09-29', '2026-09-01', '2026-09-15']), { desde: '2026-09-01', hasta: '2026-09-29' });
eq('⭐ sin nada que completar NO hay rango (y entonces no hay consulta)', rangoJornadas([]), null);
eq('la basura no arma un rango', rangoJornadas(['ayer', '']), null);
eq('un solo día es un rango de un día', rangoJornadas(['2026-09-29']), { desde: '2026-09-29', hasta: '2026-09-29' });

// ── 5) Candados de cómo está conectado ──────────────────────────────────────
{
  // ⭐ PURO: si este archivo tocara Supabase, no se podría probar solo, y el
  //    frente dejaría de ser una regla y pasaría a ser una consulta.
  const auto = leer('src/lib/frentesAuto.ts');
  ok('⭐ frentesAuto no habla con la base ni con React',
    !/from '\.\/supabase'|from 'react/.test(auto));
  ok('⭐ y no escribe NADA (se resuelve al leer)', !/\.update\(|\.upsert\(|\.insert\(/.test(auto));

  const cv = sinComentarios(leer('src/lib/camionViajes.ts'));
  ok('la lista completa de viajes completa el frente del día',
    /return \{ rows: await conFrenteDelDia\(data\.map\(mapRow\)\.sort\(porFechaDesc\)\), missing: false \}/.test(cv));
  eq('…en los DOS lectores de viajes (los míos de hoy y todos)',
    (cv.match(/await conFrenteDelDia\(/g) || []).length, 2);
  ok('pide las asignaciones por rango de jornadas', /listAsignacionesFrenteRango\(rango\.desde, rango\.hasta\)/.test(cv));
  ok('⭐ y si todos los viajes ya traen frente, no consulta nada',
    /if \(!rango\) return rows;/.test(cv));

  const pg = sinComentarios(leer('src/lib/pagoViajesDb.ts'));
  ok('⭐ el reporte de pago usa la misma función', /await conFrenteDelDia\(viajes as ViajePago\[\]\)/.test(pg));
  ok('…con los campos de la fila cruda', /CAMPOS_VIAJE_PAGO/.test(pg));
}

console.log('\nEL FRENTE DEL DÍA SE TOMA SOLO — hacia atrás y hacia adelante\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-frentes-auto · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
