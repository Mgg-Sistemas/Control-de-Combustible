/*
 * EL TURNO DE UN VIAJE (23-ago-2026).
 *
 * Dia 7am-7pm, noche 7pm-7am. Es la otra mitad de la regla que ya usa el
 * filtro de fechas: la jornada va de 7am a 7am y adentro caben dos turnos.
 *
 * Lo que fijan estos casos:
 *   - los bordes exactos (7:00, 18:59, 19:00, 6:59) y que la madrugada es NOCHE;
 *   - que el turno se deduce de la HORA y no de la columna `shift`, que es
 *     nullable y que `editarViaje` deja desactualizada;
 *   - que "mixto" no se dispara con un viaje suelto en el otro turno.
 *
 *   node scripts/test-viajes-turno.mjs
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

// Compila .ts en memoria resolviendo los `import './caracasDay'` sin extension.
const cache = new Map();
const compilar = (p) => {
  if (cache.has(p)) return cache.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cache.set(p, m.exports);
  m._compile(js, m.filename);
  cache.set(p, m.exports);
  return m.exports;
};
const realLoad = Module._load;
Module._load = function (req, parent) {
  if (req.startsWith('.') && parent && String(parent.filename || '').endsWith('.ts')) {
    const cand = path.resolve(path.dirname(parent.filename), req);
    for (const p of [cand, cand + '.ts', path.join(cand, 'index.ts')]) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return compilar(p);
    }
  }
  return realLoad.apply(this, arguments);
};

const T = compilar(path.join(ROOT, 'src/lib/viajesTurno.ts'));
const { turnoDeInstante, turnoDeViaje, desacuerdoDeTurno, turnoLabel, turnoLabelConHorario,
        leyendaTurnos, contarTurnos, resumenTurno, perfilDeTurno, PERFIL_LABEL } = T;
// El turno de AHORA, para comprobar que los dos calculos son el mismo.
const { caracasNowShift } = compilar(path.join(ROOT, 'src/lib/caracasDay.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};

/** Un instante en hora de Venezuela (UTC-4 fijo, sin horario de verano). */
const enCaracas = (iso, hh, mm = 0) =>
  new Date(`${iso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-04:00`);
const iso = (d) => d.toISOString();

// -- 1) LOS BORDES ----------------------------------------------------------
eq('6:59am todavia es NOCHE', turnoDeInstante(enCaracas('2026-08-20', 6, 59)), 'night');
eq('* 7:00am en punto arranca el DIA', turnoDeInstante(enCaracas('2026-08-20', 7)), 'day');
eq('mediodia es DIA', turnoDeInstante(enCaracas('2026-08-20', 12)), 'day');
eq('6:59pm todavia es DIA', turnoDeInstante(enCaracas('2026-08-20', 18, 59)), 'day');
eq('* 7:00pm en punto arranca la NOCHE', turnoDeInstante(enCaracas('2026-08-20', 19)), 'night');
eq('11:59pm es NOCHE', turnoDeInstante(enCaracas('2026-08-20', 23, 59)), 'night');
eq('* medianoche pasada sigue siendo NOCHE', turnoDeInstante(enCaracas('2026-08-21', 0, 1)), 'night');
eq('3 de la manana es NOCHE', turnoDeInstante(enCaracas('2026-08-21', 3)), 'night');

// El dia entero, hora por hora: exactamente 12 de dia y 12 de noche.
let dia = 0, noche = 0;
for (let h = 0; h < 24; h++) (turnoDeInstante(enCaracas('2026-08-20', h)) === 'day' ? dia++ : noche++);
eq('* 12 horas de dia y 12 de noche, sin huecos', [dia, noche], [12, 12]);

// -- 2) SE CALCULA EN HORA DE CARACAS, NO EN UTC -----------------------------
// A las 10pm de Caracas son las 2am UTC del dia siguiente. Si el calculo usara
// UTC diria "noche" por casualidad, asi que se prueba el caso que los separa:
// 8pm Caracas = medianoche UTC -> por hora local es NOCHE, y por UTC tambien;
// el que de verdad los separa es 5am Caracas = 9am UTC.
eq('* 5am de Caracas es NOCHE (en UTC serian las 9am, o sea dia)',
  turnoDeInstante(enCaracas('2026-08-21', 5)), 'night');
eq('* 8am de Caracas es DIA (en UTC serian las 12, tambien dia)',
  turnoDeInstante(enCaracas('2026-08-21', 8)), 'day');
// Y el mismo instante escrito en UTC tiene que dar lo mismo.
eq('el mismo instante en notacion UTC da igual',
  turnoDeInstante(new Date('2026-08-21T09:00:00Z')), 'night');

// -- 3) turnoDeViaje toma el ISO tal como viene de la base -------------------
eq('turnoDeViaje con un ISO de la base', turnoDeViaje(iso(enCaracas('2026-08-20', 20))), 'night');
eq('turnoDeViaje al mediodia', turnoDeViaje(iso(enCaracas('2026-08-20', 12))), 'day');
eq('turnoDeViaje y turnoDeInstante son lo mismo',
  turnoDeViaje(iso(enCaracas('2026-08-20', 3))), turnoDeInstante(enCaracas('2026-08-20', 3)));

// Es el MISMO corte que usa la app al registrar (caracasNowShift): si alguien
// cambia uno de los dos y no el otro, este caso lo caza.
eq('* mismo corte que caracasNowShift() usa al registrar',
  turnoDeInstante(new Date()), caracasNowShift());

// -- 4) EL DESACUERDO CON LA COLUMNA `shift` --------------------------------
// Pasa cuando se corrige la hora cruzando las 7pm: `editarViaje` mueve
// `registered_at` pero deja `shift` como estaba.
const seisCincuenta = iso(enCaracas('2026-08-20', 18, 50));
const sieteDiez = iso(enCaracas('2026-08-20', 19, 10));
eq('sin desacuerdo cuando coinciden', desacuerdoDeTurno('day', seisCincuenta), false);
eq('* desacuerdo tras mover la hora de 6:50pm a 7:10pm', desacuerdoDeTurno('day', sieteDiez), true);
eq('* un shift NULO no es un desacuerdo, es una ausencia', desacuerdoDeTurno(null, sieteDiez), false);
eq('undefined tampoco', desacuerdoDeTurno(undefined, sieteDiez), false);
eq('noche marcada de dia tambien se detecta', desacuerdoDeTurno('night', seisCincuenta), true);

// -- 5) CONTAR Y ESCRIBIR ---------------------------------------------------
eq('contar mezcla', contarTurnos(['day', 'night', 'day']), { dia: 2, noche: 1, total: 3 });
eq('contar vacio', contarTurnos([]), { dia: 0, noche: 0, total: 0 });
eq('resumen con los dos turnos', resumenTurno({ dia: 12, noche: 8, total: 20 }), '☀️ 12 · 🌙 8');
// Un «🌙 0» al lado de cada camion diurno es ruido en cada renglon.
eq('* solo de dia no imprime el 0 de la noche', resumenTurno({ dia: 12, noche: 0, total: 12 }), '☀️ 12');
eq('* solo de noche no imprime el 0 del dia', resumenTurno({ dia: 0, noche: 8, total: 8 }), '🌙 8');
eq('sin viajes es una raya', resumenTurno({ dia: 0, noche: 0, total: 0 }), '—');
eq('la etiqueta del turno', [turnoLabel('day'), turnoLabel('night')], ['☀️ Día', '🌙 Noche']);

// -- 6) EL PERFIL DE CADA CAMION --------------------------------------------
eq('todo de dia', perfilDeTurno({ dia: 20, noche: 0, total: 20 }), 'dia');
eq('todo de noche', perfilDeTurno({ dia: 0, noche: 20, total: 20 }), 'noche');
eq('mitad y mitad es mixto', perfilDeTurno({ dia: 10, noche: 10, total: 20 }), 'mixto');
// ⭐ Un camion con 30 de dia y 1 de noche NO es mixto: es uno de dia al que se
// le colo un viaje. Sin el umbral, casi toda la flota saldria «mixto».
eq('* un viaje suelto de noche NO lo vuelve mixto', perfilDeTurno({ dia: 30, noche: 1, total: 31 }), 'dia');
eq('* ni uno suelto de dia en un camion nocturno', perfilDeTurno({ dia: 1, noche: 30, total: 31 }), 'noche');
eq('justo en el umbral del 20% ya es mixto', perfilDeTurno({ dia: 8, noche: 2, total: 10 }), 'mixto');
eq('por debajo del umbral no', perfilDeTurno({ dia: 9, noche: 1, total: 10 }), 'dia');
eq('sin viajes', perfilDeTurno({ dia: 0, noche: 0, total: 0 }), 'ninguno');
eq('el perfil tiene etiqueta para los cuatro casos',
  ['dia', 'noche', 'mixto', 'ninguno'].every((k) => typeof PERFIL_LABEL[k] === 'string' && PERFIL_LABEL[k].length > 0), true);

// -- 7) UN DIA DE TRABAJO COMPLETO, DE PUNTA A PUNTA ------------------------
// La jornada del 20 va de las 7am del 20 a las 7am del 21. Un camion que
// trabajo la noche entera tiene viajes a los dos lados de la medianoche y
// TODOS son del mismo turno.
const laNoche = [
  enCaracas('2026-08-20', 20), enCaracas('2026-08-20', 23, 45),
  enCaracas('2026-08-21', 0, 30), enCaracas('2026-08-21', 5, 15),
];
eq('* la noche entera cuenta como un solo turno',
  contarTurnos(laNoche.map((d) => turnoDeInstante(d))), { dia: 0, noche: 4, total: 4 });
eq('* y ese camion es «trabaja de noche»',
  perfilDeTurno(contarTurnos(laNoche.map((d) => turnoDeInstante(d)))), 'noche');

// -- 8) CONTAR ES ESTRICTO: LO DESCONOCIDO NO ES «DIA» ----------------------
// La version perezosa (`if night ... else dia++`) contaba como DIA cualquier
// cosa, incluido un null. Eso contradice de frente la regla de `resumirViajes`
// («no se le inventa a ninguno de los dos»), y el dia que alguien alimente esto
// desde la columna `shift` —que SI es nullable— todos los viajes viejos
// habrian salido diurnos.
eq('* un null no cuenta como dia', contarTurnos([null]), { dia: 0, noche: 0, total: 0 });
eq('* ni undefined, ni una cadena cualquiera',
  contarTurnos([undefined, 'DIA', '', 'day']), { dia: 1, noche: 0, total: 1 });
eq('* el total solo cuenta lo que reconocio',
  contarTurnos(['day', null, 'night', 'x']), { dia: 1, noche: 1, total: 2 });
eq('lo valido se sigue contando igual', contarTurnos(['day', 'day', 'night']), { dia: 2, noche: 1, total: 3 });

// -- 9) EL HORARIO SE ESCRIBE EN UN SOLO LUGAR ------------------------------
// Estaba literal en dos sitios de la pantalla (el PDF y la leyenda) mientras el
// archivo decia «Como se escribe, en un solo lugar». Ahora si lo es.
eq('la etiqueta con horario del dia', turnoLabelConHorario('day'), '\u2600\ufe0f D\u00eda (7am\u20137pm)');
eq('la etiqueta con horario de la noche', turnoLabelConHorario('night'), '\ud83c\udf19 Noche (7pm\u20137am)');
eq('la leyenda de los dos turnos', leyendaTurnos(),
  '\u2600\ufe0f D\u00eda 7am\u20137pm \u00b7 \ud83c\udf19 Noche 7pm\u20137am');
// Y el horario que anuncia es el mismo que aplica el calculo: corta en 7 y 19.
eq('* la leyenda no miente sobre el corte',
  [turnoDeInstante(enCaracas('2026-08-20', 7)), turnoDeInstante(enCaracas('2026-08-20', 19))], ['day', 'night']);

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-turno · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
