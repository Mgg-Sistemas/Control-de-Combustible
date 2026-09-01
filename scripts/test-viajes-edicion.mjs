/*
 * EDICION DE VIAJES POR LA JEFA (31-ago-2026).
 *
 * Pedido del cliente: quien tenga permiso "full" tiene que poder arreglar
 * cualquier dato de cualquier camion para un dia en especifico -- hora, cuantos
 * viajes (poner y quitar) y el chofer/responsable.
 *
 * Lo que fijan estos casos:
 *   - que cargar N viajes NO los apile todos en el mismo minuto (si se apilan,
 *     no hay manera de corregirle la hora a uno solo despues);
 *   - que pasarse de la medianoche los deja en la MISMA jornada, porque el
 *     corte del negocio son las 7am y no las 12;
 *   - que no se pueden cargar viajes con fecha futura (contarian como trabajo
 *     hecho en los reportes);
 *   - que los avisos de "esto se te va a mudar de dia / de turno" salen en los
 *     dos cruces (7am y 7pm) y NO salen cuando no hay cruce;
 *   - que un viaje cargado a mano queda marcado y se puede distinguir de uno
 *     que un listero toco en el patio.
 *
 *   node scripts/test-viajes-edicion.mjs
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

const E = compilar(path.join(ROOT, 'src/lib/viajesEdicion.ts'));
const {
  normalizarHora, isoDeFechaHora, horariosDeCarga, turnoParaGuardar, turnosDeCarga,
  avisosDeCambio, validarCargaManual, notaCargaManual, esCargaManual,
  MAX_CARGA, SEPARACION_MIN, MARCA_CARGA_MANUAL,
} = E;
const { jornadaDeFecha } = compilar(path.join(ROOT, 'src/lib/caracasDay.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

/** Un instante en hora de Venezuela (UTC-4 fijo, sin horario de verano). */
const enCaracas = (iso, hh, mm = 0) =>
  `${iso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-04:00`;

// -- 1) LA HORA QUE SE TECLEA -----------------------------------------------
eq('una hora normal pasa tal cual', normalizarHora('14', '35'), { hh: 14, mm: 35 });
eq('con cero adelante tambien', normalizarHora('07', '05'), { hh: 7, mm: 5 });
eq('acepta numeros, no solo texto', normalizarHora(9, 3), { hh: 9, mm: 3 });
eq('* una hora imposible se acota, no se rechaza', normalizarHora('25', '99'), { hh: 23, mm: 59 });
eq('* los negativos se acotan a cero', normalizarHora('-4', '-1'), { hh: 0, mm: 0 });
eq('* lo que no es numero vale cero (caja vacia)', normalizarHora('', 'abc'), { hh: 0, mm: 0 });
eq('* y null/undefined tampoco revientan', normalizarHora(null, undefined), { hh: 0, mm: 0 });

// -- 2) EL INSTANTE SE ARMA EN HORA DE CARACAS -------------------------------
eq('la hora se arma con el desfase de Venezuela',
  isoDeFechaHora('2026-08-20', 7, 5), '2026-08-20T07:05:00-04:00');
eq('* rellena con cero a la izquierda', isoDeFechaHora('2026-08-20', 3, 0), '2026-08-20T03:00:00-04:00');
// El que separa "UTC" de "hora de Caracas": 5am de Caracas son las 9am UTC.
eq('* NO se arma en UTC', new Date(isoDeFechaHora('2026-08-20', 5, 0)).toISOString(),
  '2026-08-20T09:00:00.000Z');

// -- 3) CARGAR VARIOS VIAJES DE UNA VEZ --------------------------------------
eq('uno solo cae exactamente en la hora pedida',
  horariosDeCarga('2026-08-20', 8, 0, 1),
  ['2026-08-20T12:00:00.000Z']);
eq('* tres viajes salen SEPARADOS, no apilados en el mismo minuto',
  horariosDeCarga('2026-08-20', 8, 0, 3),
  ['2026-08-20T12:00:00.000Z', '2026-08-20T12:05:00.000Z', '2026-08-20T12:10:00.000Z']);
// Guardia contra la regresion mas facil de introducir: devolver N veces la
// misma hora. Si alguien "simplifica" el bucle, esto lo agarra.
{
  const horas = horariosDeCarga('2026-08-20', 8, 0, 5);
  eq('* las 5 horas son todas distintas', new Set(horas).size, 5);
  eq('* y van en orden ascendente', horas.slice().sort().join('|'), horas.join('|'));
  const separacion = (new Date(horas[1]) - new Date(horas[0])) / 60000;
  eq('* separadas por lo que dice SEPARACION_MIN', separacion, SEPARACION_MIN);
}
eq('la separacion se puede cambiar', horariosDeCarga('2026-08-20', 8, 0, 2, 30),
  ['2026-08-20T12:00:00.000Z', '2026-08-20T12:30:00.000Z']);
eq('cantidad cero no carga nada', horariosDeCarga('2026-08-20', 8, 0, 0), []);
eq('* una cantidad negativa tampoco (no cuelga el bucle)', horariosDeCarga('2026-08-20', 8, 0, -3), []);

// -- 4) PASARSE DE LA MEDIANOCHE ---------------------------------------------
// Este es el caso que rompe si alguien arma las horas pegando texto en vez de
// sumar minutos de verdad: daria las "24:00" y "24:05", que no existen.
{
  const horas = horariosDeCarga('2026-08-20', 23, 50, 3);
  eq('* cruzar la medianoche sigue de largo al dia siguiente',
    horas, ['2026-08-21T03:50:00.000Z', '2026-08-21T03:55:00.000Z', '2026-08-21T04:00:00.000Z']);
  // Y lo que de verdad importa: siguen contando para el MISMO dia de trabajo.
  eq('* pero los tres quedan en la MISMA jornada (el corte son las 7am)',
    horas.map((h) => jornadaDeFecha(new Date(h))),
    ['2026-08-20', '2026-08-20', '2026-08-20']);
}

// -- 5) EL TURNO QUE SE GUARDA COINCIDE CON LA HORA --------------------------
eq('7am es dia', turnoParaGuardar(enCaracas('2026-08-20', 7)), 'day');
eq('7pm es noche', turnoParaGuardar(enCaracas('2026-08-20', 19)), 'night');
eq('* la madrugada es noche', turnoParaGuardar(enCaracas('2026-08-21', 3)), 'night');

// -- 6) LOS AVISOS ANTES DE GUARDAR ------------------------------------------
eq('mover la hora dentro del mismo turno no avisa nada',
  avisosDeCambio(enCaracas('2026-08-20', 9), enCaracas('2026-08-20', 11)), []);
{
  // 8am -> 5am: se muda de jornada Y de turno. Los dos avisos.
  const a = avisosDeCambio(enCaracas('2026-08-20', 8), enCaracas('2026-08-20', 5));
  eq('* bajar de 8am a 5am avisa DOS cosas', a.length, 2);
  ok('* dice a que jornada se va', a[0].includes('2026-08-19'));
  ok('* y que cambia de turno', a[1].toLowerCase().includes('turno'));
}
{
  // 6:50pm -> 7:10pm: NO cambia de jornada, pero si de turno.
  const a = avisosDeCambio(enCaracas('2026-08-20', 18, 50), enCaracas('2026-08-20', 19, 10));
  eq('* cruzar las 7pm avisa SOLO por el turno', a.length, 1);
  ok('* y nombra el turno, no la jornada', a[0].toLowerCase().includes('turno'));
}
{
  // Lo nuevo: cambiar la FECHA, que antes no se podia.
  const a = avisosDeCambio(enCaracas('2026-08-20', 10), enCaracas('2026-08-14', 10));
  eq('* mudar el viaje a otra fecha avisa', a.length, 1);
  ok('* y dice el dia nuevo', a[0].includes('2026-08-14'));
}

// -- 7) QUE SE PUEDE CARGAR Y QUE NO -----------------------------------------
const HOY = '2026-08-20';
const base = { machineryId: 'm1', fechaISO: '2026-08-18', hh: 9, mm: 0, cantidad: 1 };
eq('un formulario completo pasa', validarCargaManual(base, HOY), null);
ok('sin camion no se puede', !!validarCargaManual({ ...base, machineryId: null }, HOY));
ok('una fecha con formato raro se rechaza', !!validarCargaManual({ ...base, fechaISO: '18/08/2026' }, HOY));
ok('y una fecha vacia tambien', !!validarCargaManual({ ...base, fechaISO: '' }, HOY));
eq('cargar en el dia de hoy si se puede', validarCargaManual({ ...base, fechaISO: HOY }, HOY), null);
ok('* pero NO a futuro', !!validarCargaManual({ ...base, fechaISO: '2026-08-21' }, HOY));
ok('cantidad cero se rechaza', !!validarCargaManual({ ...base, cantidad: 0 }, HOY));
ok('* y una cantidad negativa tambien', !!validarCargaManual({ ...base, cantidad: -2 }, HOY));
eq('el tope exacto se acepta', validarCargaManual({ ...base, cantidad: MAX_CARGA }, HOY), null);
ok('* uno mas que el tope se rechaza', !!validarCargaManual({ ...base, cantidad: MAX_CARGA + 1 }, HOY));

// -- 8) LA MARCA DE "ESTO LO CARGO LA OFICINA" -------------------------------
eq('la nota lleva el nombre de quien lo cargo',
  notaCargaManual('Ana Perez'), `${MARCA_CARGA_MANUAL} por Ana Perez`);
eq('sin nombre queda solo la marca', notaCargaManual(''), MARCA_CARGA_MANUAL);
eq('* un nombre con espacios de sobra no ensucia la nota',
  notaCargaManual('   '), MARCA_CARGA_MANUAL);
ok('* un viaje cargado a mano se reconoce', esCargaManual(notaCargaManual('Ana Perez')));
ok('* uno registrado en campo (note null) NO', !esCargaManual(null));
ok('* ni uno con una nota cualquiera', !esCargaManual('Se le pincho un caucho'));

// -- 9) LA PANTALLA USA ESTA LIBRERIA (no una copia suya) --------------------
// El modulo ya tuvo el problema de la logica duplicada: si la pantalla arma las
// horas por su cuenta, todo lo de arriba deja de proteger nada.
{
  const src = fs.readFileSync(path.join(ROOT, 'src/screens/ViajesCamionesScreen.tsx'), 'utf8');
  ok('* la pantalla importa viajesEdicion', src.includes("from '../lib/viajesEdicion'"));
  ok('* y valida la carga con la libreria', src.includes('validarCargaManual('));
  ok('* y arma las horas con la libreria', src.includes('horariosDeCarga('));
  // Sin comentarios, para que un `//` no haga pasar la guardia por casualidad.
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok('* arma el instante con la libreria', codigo.includes('isoDeJornadaHora('));
  // Guardia estrecha: la que se quito es la de saveEdit, que pegaba la hora a
  // mano. Las dos de `currentJornadaWindow` (7am/7pm) son otra cosa y siguen.
  ok('* y saveEdit ya no lo pega a mano', !codigo.includes('pad2(mm)}:00-04:00'));
}
{
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/camionViajes.ts'), 'utf8');
  ok('* la capa de datos sabe editar chofer y listero', src.includes('patch.chofer_name'));
  ok('* y reasigna el listero con NOMBRE e id juntos', src.includes('patch.listero_name'));
  // Una sola puerta a la tabla: `editarHoraViaje` se quito al abrir la edicion
  // completa. Si vuelve a aparecer, hay dos caminos que se desincronizan.
  ok('* hay UNA sola funcion de edicion', !src.includes('export async function editarHoraViaje'));
  ok('* y es editarViaje', src.includes('export async function editarViaje'));
}

// -- 10) EL DIA QUE SE ELIGE ES UNA JORNADA, NO UNA FECHA DE CALENDARIO ------
// El bug: "dia 20" + 2 de la madrugada caia en la jornada del 19, o sea NO en
// el dia que se eligio. Y la madrugada de la jornada en curso era incargable,
// porque habria que elegir la fecha de calendario de manana y el selector no
// deja pasar de hoy.
{
  const { isoDeJornadaHora, mismoMinuto, jornadasDeCarga } = E;
  eq('* la madrugada de la jornada 20 cae en el CALENDARIO del 21',
    isoDeJornadaHora('2026-08-20', 2, 0), '2026-08-21T02:00:00-04:00');
  eq('* y despues de las 7am es el mismo dia del calendario',
    isoDeJornadaHora('2026-08-20', 8, 0), '2026-08-20T08:00:00-04:00');
  eq('* las 7 en punto ya es el dia de la jornada',
    isoDeJornadaHora('2026-08-20', 7, 0), '2026-08-20T07:00:00-04:00');
  eq('* 6:59 todavia es la madrugada del dia siguiente del calendario',
    isoDeJornadaHora('2026-08-20', 6, 59), '2026-08-21T06:59:00-04:00');
  // Lo que de verdad importa: el viaje cae en el dia que se pidio.
  for (const h of [0, 3, 6, 7, 12, 19, 23]) {
    eq(`* jornada 20 + ${h}h queda en la jornada 20`,
      jornadaDeFecha(new Date(isoDeJornadaHora('2026-08-20', h, 0))), '2026-08-20');
  }
  // Cruzar el fin de mes, que es donde fallan las cuentas de fechas a mano.
  eq('* fin de mes: jornada 31-ago + 2am cae el 1-sep',
    isoDeJornadaHora('2026-08-31', 2, 0), '2026-09-01T02:00:00-04:00');
  eq('* y sigue siendo la jornada del 31',
    jornadaDeFecha(new Date(isoDeJornadaHora('2026-08-31', 2, 0))), '2026-08-31');

  // -- La tanda que se desborda a la jornada siguiente --
  eq('una tanda normal cae toda en un solo dia',
    jornadasDeCarga(horariosDeCarga('2026-08-20', 8, 0, 4)), ['2026-08-20']);
  eq('* empezar 6:50am y cargar cuatro CRUZA las 7 y toca dos jornadas',
    jornadasDeCarga(horariosDeCarga('2026-08-20', 6, 50, 4)), ['2026-08-20', '2026-08-21']);

  // -- Abrir "Editar" y guardar sin tocar nada NO puede mover el viaje --
  // El viaje de campo trae segundos y milisegundos; el formulario solo llega al
  // minuto. Comparar los instantes pelados daba "cambio" SIEMPRE.
  const deCampo = '2026-08-20T14:23:47.123Z';
  const rearmado = new Date('2026-08-20T14:23:00.000Z').toISOString();
  ok('* un viaje con segundos y su rearmado son el MISMO minuto', mismoMinuto(deCampo, rearmado));
  ok('* pero un minuto distinto si se nota', !mismoMinuto(deCampo, '2026-08-20T14:24:00.000Z'));
  ok('* y no se compara por texto', mismoMinuto('2026-08-20T14:23:00-04:00', '2026-08-20T18:23:59.999Z'));
}

// -- 11) NI POR LA EDICION SE MANDA UN VIAJE AL FUTURO -----------------------
// La carga manual lo prohibia y la edicion no: se prohibia por una puerta y se
// permitia por la otra. Un viaje futuro envenena la alerta de "camion sin
// viaje" (horas negativas) y ese camion no vuelve a salir en la lista.
{
  const src = fs.readFileSync(path.join(ROOT, 'src/screens/ViajesCamionesScreen.tsx'), 'utf8');
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok('* saveEdit corta las fechas futuras', /jornada > caracasBusinessToday\(\)/.test(codigo));
  ok('* y el selector de la edicion tampoco las ofrece',
    (codigo.match(/maxISO=\{caracasBusinessToday\(\)\}/g) || []).length >= 2);
  // El guard de doble toque tiene que tomarse ANTES del confirm: mientras el
  // modal se monta el boton sigue habilitado, y ahi dos toques son dos tandas.
  const carga = codigo.slice(codigo.indexOf('const doCargarViajes'));
  const posGuard = carga.indexOf('cargaBusyRef.current = true');
  const posConfirm = carga.indexOf('await confirm(');
  ok('* el guard de doble toque se toma antes del confirm', posGuard > 0 && posGuard < posConfirm);
}

// ── SELECTOR DE TURNO EN LA CARGA A MANO (31-ago-2026) ─────────────────────
// Pedido del cliente: «que tenga la opción de que yo coloque si es para el
// turno de día o turno de noche». Como el turno se DEDUCE de la hora, el
// selector pone la hora de arranque del turno — no guarda un campo aparte.
{
  const J = '2026-08-20';
  // Una tanda que arranca de día y no llega a las 7pm: un solo turno.
  eq('tanda diurna, un solo turno', turnosDeCarga(horariosDeCarga(J, 8, 0, 4)), ['day']);
  // Una tanda que arranca a las 7pm: toda de noche.
  eq('tanda nocturna, un solo turno', turnosDeCarga(horariosDeCarga(J, 19, 0, 4)), ['night']);
  // ⭐ La que cruza las 7pm parte en dos, y en ORDEN: primero el que arranca.
  eq('* la tanda que cruza las 7pm parte en dos',
    turnosDeCarga(horariosDeCarga(J, 18, 50, 4)), ['day', 'night']);
  // La madrugada de la jornada sigue siendo NOCHE (no se "reinicia" a las 00:00).
  eq('la madrugada de la jornada es noche', turnosDeCarga(horariosDeCarga(J, 2, 0, 2)), ['night']);
  // ⭐ Y cruzar las 7am cambia de jornada Y de turno a la vez.
  eq('* cruzar las 7am tambien cambia de turno',
    turnosDeCarga(horariosDeCarga(J, 6, 50, 4)), ['night', 'day']);
  // Un solo viaje nunca puede estar en dos turnos.
  eq('un solo viaje, un solo turno', turnosDeCarga(horariosDeCarga(J, 12, 0, 1)).length, 1);
  eq('cero viajes, ningun turno', turnosDeCarga(horariosDeCarga(J, 12, 0, 0)), []);
  // El turno que se guarda coincide con el que reporta la tanda.
  const h = horariosDeCarga(J, 19, 30, 1);
  eq('turnoParaGuardar coincide con turnosDeCarga', turnoParaGuardar(h[0]), turnosDeCarga(h)[0]);
}

// Guardas sobre la pantalla: que el selector sea un ATAJO de hora y no un campo
// paralelo, y que el aviso de cruce de turno llegue antes de guardar.
{
  const src = fs.readFileSync(path.join(ROOT, 'src/screens/ViajesCamionesScreen.tsx'), 'utf8');
  ok('el selector de turno pone la hora de arranque',
    /HORA_INICIO_TURNO\[t\]\.hh/.test(src) && /setCargaHH\(pad2\(HORA_INICIO_TURNO/.test(src));
  ok('el turno marcado se DEDUCE de la hora escrita',
    /turnoDeHora\(normalizarHora\(cargaHH, cargaMM\)\.hh\)/.test(src));
  ok('no se guarda un campo de turno aparte', !/const \[cargaTurno/.test(src));
  ok('avisa cuando la tanda cruza de turno',
    /turnosDeCarga\(horarios\)/.test(src) && /cruza las 7pm/.test(src));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-edicion · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
