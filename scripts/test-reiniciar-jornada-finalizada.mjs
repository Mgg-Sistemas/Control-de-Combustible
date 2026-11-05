// 🔁 VOLVER A INICIAR JORNADA YA FINALIZADA EN EL MISMO TURNO (05-nov-2026).
//
// Regla de negocio:
//  - Cuando un inspector o un coordinador de inspectores finaliza una jornada en
//    su turno (día 7am–7pm / noche 7pm–7am) por error o porque la máquina paró y
//    después volvió a trabajar en esa misma jornada, PUEDE volver a iniciarla.
//  - Las horas del nuevo tramo se SUMAN a las ya registradas en el turno
//    (`machine_rounds.day_hours` / `night_hours` y un nuevo tramo en
//    `machine_work_segments`) sin perder el tramo anterior ni contar dos veces
//    el mismo tiempo (anti-solape con `ultimoFinMs`).
//  - El coordinador de inspectores (`puedeCoordinar`) también puede iniciar /
//    reiniciar la jornada y corregir las horas finalizadas en `panelCorregirHoras`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const cache = new Map();
function loadTs(abs) {
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => {
    if (id === './supabase' || id.endsWith('/supabase')) return { supabase: {}, selectAllRows: async () => [] };
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

const { puedeCorregirHoras } = loadTs(path.join(ROOT, 'src/lib/corregirHorasJornada.ts'));
const { horasVivasTurno } = loadTs(path.join(ROOT, 'src/lib/hours.ts'));

let ok = 0, fail = 0;
function check(cond, msg) {
  if (cond) { ok++; }
  else { fail++; console.error('❌ FALLO:', msg); }
}

const supRaw = fs.readFileSync(path.join(ROOT, 'src/screens/SupervisorScreen.tsx'), 'utf8');
const sup = supRaw.replace(/\/\/[^\n]*/g, '');

// 1. `iniciarJornada` ya NO bloquea cuando `shiftClosed` es true.
check(
  !/if\s*\(\s*shiftClosed\s*&&\s*!jornadaStart\s*\)/.test(sup),
  'iniciarJornada NO debe bloquear con `if (shiftClosed && !jornadaStart)`'
);

// 2. Tanto la rama `shiftClosed` como la rama normal muestran `{panelIniciarJornada}`.
const iAbierta = supRaw.indexOf(') : jornadaStart ? (');
const iCerrada = supRaw.indexOf(') : shiftClosed ? (', iAbierta);
const iIniciar = supRaw.indexOf(') : (', iCerrada);
const ramaCerrada = supRaw.slice(iCerrada, iIniciar);
const ramaIniciar = supRaw.slice(iIniciar, iIniciar + 2000);

check(iAbierta > 0 && iCerrada > iAbierta && iIniciar > iCerrada, 'SupervisorScreen conserva las 3 ramas del modal (abierta / cerrada / iniciar)');
check(ramaCerrada.includes('{panelIniciarJornada}'), 'Rama shiftClosed muestra {panelIniciarJornada} para poder volver a iniciar la jornada');
check(ramaIniciar.includes('{panelIniciarJornada}'), 'Rama !shiftClosed muestra {panelIniciarJornada}');
check(supRaw.includes('🟢 VOLVER A INICIAR JORNADA'), 'Botón muestra "🟢 VOLVER A INICIAR JORNADA" cuando el turno ya tenía cierre');

// 3. Anti-solape: `ultimoCierreById` + `ultimoFinMs` impide iniciar antes del fin del tramo anterior,
//    y si es en el mismo minuto clampa `startIsoEff` al `ultimoFinMs` exacto.
check(
  /setUltimoCierreById\(uMap\)/.test(sup) && /ultimoFinMs/.test(sup),
  'Registra ultimoCierreById y calcula ultimoFinMs del turno para evitar solapes al reiniciar'
);
check(
  /new Date\(startIsoEff\)\.getTime\(\) < ultimoFinMs/.test(sup) && /La jornada anterior cerr/.test(sup),
  'Rechaza reiniciar con una hora anterior al cierre del tramo previo en el mismo turno'
);
check(
  /rawStartMs >= Math\.floor\(ultimoFinMs \/ 60000\) \* 60000 && rawStartMs < ultimoFinMs/.test(sup),
  'Si se reinicia en el mismo minuto del cierre, ajusta startIsoEff al milisegundo exacto del cierre previo'
);

// 4. Conserva el primer horómetro inicial del turno al reiniciar un segundo tramo.
check(
  /const yaTieneHoroIniTurno = horoEditables\.some/.test(sup) && /hiHas && !yaTieneHoroIniTurno/.test(sup),
  'Conserva el primer horómetro inicial del turno cuando se reinicia un segundo tramo'
);

// 5. Al finalizar un tramo actualiza `curRoundHours` y al reiniciar carga las horas acumuladas.
check(
  /setCurRoundHours\(\(h\) => \(\{ \.\.\.h, \[jornadaShift === 'night' \? 'night' : 'day'\]: totalTurno \}\)\)/.test(sup),
  'finalizarJornada actualiza curRoundHours con totalTurno para que el acumulado quede al día'
);

// 6. Coordinador de inspectores: `hoursMine` y `shiftClosed` usan `shiftOfMine(id) ?? nowShift`
//    para evaluar el turno actual y no mezclar día con noche.
check(
  /const hoursMine = \(id: string\): boolean => \{[\s\S]{0,160}const sh = shiftOfMine\(id\) \?\? nowShift;/.test(sup),
  'hoursMine usa shiftOfMine(id) ?? nowShift para que el coordinador evalúe el turno actual'
);
check(
  /const shiftClosed = useMemo\(\(\) => \{[\s\S]{0,300}const sh = shiftOfMine\(ci\.id\) \?\? nowShift;/.test(sup),
  'shiftClosed usa shiftOfMine(ci.id) ?? nowShift para que el coordinador evalúe el turno actual'
);

// 7. Coordinador de inspectores puede ver y corregir horas de jornadas finalizadas en `panelCorregirHoras`.
check(
  /t\.recorded_by === uid \|\| puedeCoordinar/.test(sup),
  'tramosMios incluye los tramos cuando el usuario es coordinador (puedeCoordinar)'
);
const tramoOtro = {
  id: 't1', shift: 'day', source: 'manual_finish',
  started_at: '2026-11-05T11:00:00.000Z', ended_at: '2026-11-05T15:00:00.000Z',
  hours: 4, recorded_by: 'insp-1',
};
check(
  puedeCorregirHoras({
    tramo: tramoOtro, uid: 'coord-1', roundDate: '2026-11-05',
    today: '2026-11-05', yesterday: '2026-11-04',
    asignadoEnTurno: true, puedeCoordinar: true, tramosDelTurno: [tramoOtro],
  }).ok === true,
  'puedeCorregirHoras permite al coordinador de inspectores corregir un tramo finalizado por otro inspector'
);
check(
  puedeCorregirHoras({
    tramo: tramoOtro, uid: 'insp-2', roundDate: '2026-11-05',
    today: '2026-11-05', yesterday: '2026-11-04',
    asignadoEnTurno: true, puedeCoordinar: false, tramosDelTurno: [tramoOtro],
  }).ok === false,
  'puedeCorregirHoras sigue bloqueando a otro inspector que no sea coordinador'
);

// 8. Suma de horas al finalizar → volver a iniciar → volver a finalizar en la misma jornada:
//    Tramo 1: 07:00 a 11:00 = 4.00 h bancadas.
//    Tramo 2: vuelve a iniciar a las 13:00 y a las 16:30 lleva 3.50 h en curso → total vivo 7.50 h.
const t13 = new Date('2026-11-05T13:00:00-04:00').getTime();
const t1630 = new Date('2026-11-05T16:30:00-04:00').getTime();
const vivas = horasVivasTurno({ bancado: 4, startMs: t13, shift: 'day', nowMs: t1630 });
check(vivas === 7.5, `horasVivasTurno suma las 4 h finalizadas + 3.5 h del nuevo tramo = 7.5 h (dio ${vivas})`);

if (fail > 0) {
  console.error(`\n❌ ${fail} fallo(s) · ${ok} ok`);
  process.exit(1);
}
console.log(`✅ test-reiniciar-jornada-finalizada: ${ok} ok, 0 fallas`);
