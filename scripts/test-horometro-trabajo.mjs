/*
 * Test del HORÓMETRO DE TRABAJO (23-sep-2026).
 *
 * Pedido del cliente: pagar ciertas máquinas por lo que marca el horómetro (final − inicial
 * del turno) y no por las horas que declara la jornada. Lo que se fija acá y por qué duele:
 *   · la validación es el ESPEJO del disparador de la base: mismas reglas, mismo orden
 *   · modo jornada devuelve exactamente la fórmula de `workedFromShifts`
 *   · modo horómetro NO suma extras ni resta paradas (si no, paga doble)
 *   · un turno con trabajo y sin lectura válida tumba TODO el día a jornada, y lo dice
 *   · el comparativo cuadra con media hora de tolerancia y da por «lista» la máquina con
 *     5 días SEGUIDOS buenos (4 no; una inválida en medio, tampoco)
 *
 *   node scripts/test-horometro-trabajo.mjs
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
const loadTs = (rel) => {
  const abs = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs)); m._compile(out, abs);
  return m.exports;
};
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado ${b}\n    obtenido ${a}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const H = loadTs('src/lib/horometroTrabajo.ts');
ok('la librería no importa nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/horometroTrabajo.ts'))));
eq('el tope del turno es 12,5 h', H.TOPE_HORAS_TURNO, 12.5);

// Fábrica de lecturas inventadas (máquina, fecha, turno, inicial, final, extras).
const L = (machineryId, roundDate, shift, inicial, final, x = {}) => ({
  machineryId, roundDate, shift, inicial, final,
  valida: true, motivoInvalida: null, reinicio: false, origen: 'inspector', ...x,
});
const R = (dia, noche, parada = 0, extras = 0) => ({ dia, noche, parada, extras });

// ── 1) VALIDAR LECTURA (espejo del disparador) ───────────────────────────────
{
  eq('inicial negativa', H.validarLectura({ inicial: -1, final: 5, reinicio: false }, null), { valida: false, motivo: 'lectura negativa' });
  eq('final negativa', H.validarLectura({ inicial: 10, final: -2, reinicio: false }, null), { valida: false, motivo: 'lectura negativa' });
  eq('final menor que inicial', H.validarLectura({ inicial: 1200, final: 1195, reinicio: false }, null), { valida: false, motivo: 'final menor que inicial' });
  eq('inicial menor que la última válida', H.validarLectura({ inicial: 1190, final: 1198, reinicio: false }, 1195), { valida: false, motivo: 'menor que la última lectura válida' });
  eq('...pero el reinicio sienta base nueva', H.validarLectura({ inicial: 10, final: 18, reinicio: true }, 1195), { valida: true, motivo: '' });
  eq('salto mayor a 12,5 h', H.validarLectura({ inicial: 1000, final: 1013, reinicio: false }, null), { valida: false, motivo: 'salto mayor a 12,5 h' });
  eq('salto de exactamente 12,5 h pasa', H.validarLectura({ inicial: 1000, final: 1012.5, reinicio: false }, null), { valida: true, motivo: '' });
  eq('una lectura normal es válida', H.validarLectura({ inicial: 1200, final: 1208.5, reinicio: false }, 1200), { valida: true, motivo: '' });
  eq('inicial igual a la última válida pasa', H.validarLectura({ inicial: 1200, final: 1205, reinicio: false }, 1200), { valida: true, motivo: '' });
  eq('sin final no es inválida (incompleta)', H.validarLectura({ inicial: 1200, final: null, reinicio: false }, 1100), { valida: true, motivo: '' });
  eq('sin inicial no es inválida (incompleta)', H.validarLectura({ inicial: null, final: 1200, reinicio: false }, 1100), { valida: true, motivo: '' });
  eq('el orden manda: negativa gana a final<inicial', H.validarLectura({ inicial: 5, final: -1, reinicio: false }, null).motivo, 'lectura negativa');
  eq('el orden manda: final<inicial gana a última válida', H.validarLectura({ inicial: 50, final: 40, reinicio: false }, 100).motivo, 'final menor que inicial');
}

// ── 2) HORAS DE UNA LECTURA ──────────────────────────────────────────────────
{
  eq('final − inicial a 2 decimales', H.horasDeLectura(L('m1', '2026-09-01', 'day', 1200.1, 1208.437)), 8.34);
  eq('sin final → null', H.horasDeLectura(L('m1', '2026-09-01', 'day', 1200, null)), null);
  eq('sin inicial → null', H.horasDeLectura(L('m1', '2026-09-01', 'day', null, 1208)), null);
  eq('inválida → null aunque tenga las dos', H.horasDeLectura(L('m1', '2026-09-01', 'day', 1200, 1190, { valida: false, motivoInvalida: 'final menor que inicial' })), null);
  eq('cero horas es cero, no null', H.horasDeLectura(L('m1', '2026-09-01', 'day', 1200, 1200)), 0);
}

// ── 3) HORAS DE JORNADA (= workedFromShifts) ─────────────────────────────────
{
  const f = (d, n, p, x) => Math.max(0, Math.max(0, d) + Math.max(0, n) - p) + Math.max(0, x);
  eq('día + noche', H.horasJornada(R(8, 4)), 12);
  eq('resta parada', H.horasJornada(R(8, 4, 3)), f(8, 4, 3, 0));
  eq('suma extras', H.horasJornada(R(8, 0, 0, 2)), 10);
  eq('parada mayor que el trabajo no baja de cero antes de extras', H.horasJornada(R(2, 0, 5, 1)), 1);
  eq('extras negativas no restan', H.horasJornada(R(8, 0, 0, -3)), 8);
  eq('turno negativo cuenta cero', H.horasJornada(R(-4, 6)), 6);
  eq('todo cero es cero', H.horasJornada(R(0, 0)), 0);
}

// ── 4) HORAS PAGABLES: los seis orígenes ─────────────────────────────────────
{
  const lecDia = L('m1', '2026-09-01', 'day', 1000, 1009);
  const lecNoche = L('m1', '2026-09-01', 'night', 1009, 1015.5);
  eq('modo jornada → jornada, con día y noche de la ronda', H.horasPagables(R(8.5, 4, 1, 2), [lecDia, lecNoche], 'jornada'), { horas: 13.5, dia: 8.5, noche: 4, origen: 'jornada' });
  eq('modo viaje también es jornada', H.horasPagables(R(8, 0), [lecDia], 'viaje').origen, 'jornada');
  eq('sin horómetro físico → jornada, sin reclamo', H.horasPagables(R(8, 0), [lecDia], 'horometro', { sinHorometroFisico: true }), { horas: 8, dia: 8, noche: 0, origen: 'sin_horometro_fisico' });
  eq('averiado → jornada, «averiado»', H.horasPagables(R(8, 4), [], 'horometro', { averiado: true }), { horas: 12, dia: 8, noche: 4, origen: 'averiado' });
  eq('sin horómetro físico gana sobre averiado', H.horasPagables(R(8, 0), [], 'horometro', { sinHorometroFisico: true, averiado: true }).origen, 'sin_horometro_fisico');
  eq('horómetro con las dos lecturas → suma de lecturas', H.horasPagables(R(8, 4), [lecDia, lecNoche], 'horometro'), { horas: 15.5, dia: 9, noche: 6.5, origen: 'horometro' });
  eq('horómetro ignora extras y parada', H.horasPagables(R(8, 4, 3, 2), [lecDia, lecNoche], 'horometro').horas, 15.5);
  eq('...mientras la jornada sí las aplica', H.horasPagables(R(8, 4, 3, 2), [lecDia, lecNoche], 'jornada').horas, 11);
  eq('solo turno día con trabajo y lectura → horómetro', H.horasPagables(R(8, 0), [lecDia], 'horometro'), { horas: 9, dia: 9, noche: 0, origen: 'horometro' });
  eq('dos turnos, la noche sin lectura → TODO el día a jornada, «sin lectura»', H.horasPagables(R(8, 4), [lecDia], 'horometro'), { horas: 12, dia: 8, noche: 4, origen: 'sin_lectura' });
  eq('modo horómetro sin ninguna lectura y con ronda → sin lectura', H.horasPagables(R(8, 0, 0, 1), [], 'horometro'), { horas: 9, dia: 8, noche: 0, origen: 'sin_lectura' });
  const invalida = L('m1', '2026-09-01', 'day', 1000, 990, { valida: false, motivoInvalida: 'final menor que inicial' });
  eq('lectura inválida → jornada, «inválida»', H.horasPagables(R(8, 0), [invalida], 'horometro'), { horas: 8, dia: 8, noche: 0, origen: 'invalida' });
  eq('una inválida y otra ausente → «inválida» (hay algo que corregir)', H.horasPagables(R(8, 4), [invalida], 'horometro').origen, 'invalida');
  eq('lectura incompleta con trabajo → «sin lectura», no inválida', H.horasPagables(R(8, 0), [L('m1', '2026-09-01', 'day', 1000, null)], 'horometro').origen, 'sin_lectura');
  eq('día sin ronda y sin lecturas → cero, sin lectura', H.horasPagables(R(0, 0), [], 'horometro'), { horas: 0, dia: 0, noche: 0, origen: 'sin_lectura' });
  eq('turno sin trabajo declarado y sin lectura no tumba el día', H.horasPagables(R(0, 4), [lecNoche], 'horometro'), { horas: 6.5, dia: 0, noche: 6.5, origen: 'horometro' });
  eq('la lectura vale aunque la ronda diga cero (el horómetro manda)', H.horasPagables(R(0, 0), [lecDia], 'horometro'), { horas: 9, dia: 9, noche: 0, origen: 'horometro' });
  eq('la jornada de respaldo no cae de cero en día/noche', H.horasPagables(R(-2, 4), [], 'horometro'), { horas: 4, dia: 0, noche: 4, origen: 'sin_lectura' });
}

// ── 5) ÚLTIMA LECTURA VÁLIDA ─────────────────────────────────────────────────
{
  const hist = [
    L('m1', '2026-09-01', 'day', 1000, 1008),
    L('m1', '2026-09-01', 'night', 1008, 1012),
    L('m1', '2026-09-02', 'day', 1012, 1020),
    L('m1', '2026-09-02', 'night', 1020, 1010, { valida: false, motivoInvalida: 'final menor que inicial' }),
    L('m1', '2026-09-03', 'day', 1030, null),
  ];
  eq('antes del primer turno no hay nada', H.ultimaLecturaValida(hist, { roundDate: '2026-09-01', shift: 'day' }), null);
  eq('la noche ve el final del día', H.ultimaLecturaValida(hist, { roundDate: '2026-09-01', shift: 'night' }), 1008);
  eq('el día siguiente ve el final de la noche', H.ultimaLecturaValida(hist, { roundDate: '2026-09-02', shift: 'day' }), 1012);
  eq('salta la inválida', H.ultimaLecturaValida(hist, { roundDate: '2026-09-03', shift: 'day' }), 1020);
  eq('sin final vale la inicial', H.ultimaLecturaValida(hist, { roundDate: '2026-09-03', shift: 'night' }), 1030);
  eq('el orden de entrada no importa', H.ultimaLecturaValida([...hist].reverse(), { roundDate: '2026-09-03', shift: 'day' }), 1020);
  const conReinicio = [...hist, L('m1', '2026-09-04', 'day', 5, 12, { reinicio: true, origen: 'reinicio' })];
  eq('el reinicio es la base nueva para lo que sigue', H.ultimaLecturaValida(conReinicio, { roundDate: '2026-09-04', shift: 'night' }), 12);
  eq('...y una lectura menor que la vieja pero mayor que el reinicio es válida', H.validarLectura({ inicial: 12, final: 20, reinicio: false }, H.ultimaLecturaValida(conReinicio, { roundDate: '2026-09-04', shift: 'night' })), { valida: true, motivo: '' });
}

// ── 6) COMPARATIVO ───────────────────────────────────────────────────────────
const RONDA = (machineryId, code, fecha, dia, noche, parada = 0, extras = 0, empresa = 'EMPRESA ALFA') => ({ machineryId, code, empresa, fecha, ronda: R(dia, noche, parada, extras) });
{
  const rondas = [
    RONDA('m2', 'VIBRO-02', '2026-09-02', 8, 0),
    RONDA('m1', 'RETRO-01', '2026-09-02', 8, 0),
    RONDA('m1', 'RETRO-01', '2026-09-01', 8, 4, 1, 0),
    RONDA('m3', 'CARG-03', '2026-09-01', 10, 0, 0, 0, 'EMPRESA BETA'),
    RONDA('m4', 'EXC-04', '2026-09-01', 6, 0),
    RONDA('m5', 'GRUA-05', '2026-09-01', 5, 0),
  ];
  const lecturas = [
    L('m1', '2026-09-01', 'day', 100, 108.2), L('m1', '2026-09-01', 'night', 108.2, 111.6), // 11.6 vs 11 → +0.6
    L('m1', '2026-09-02', 'day', 111.6, 119.6), // 8 vs 8 → cuadra
    L('m2', '2026-09-02', 'day', 500, 510),      // 10 vs 8 → horómetro mayor
    L('m3', '2026-09-01', 'day', 700, 705),      // 5 vs 10 → jornada mayor
    L('m4', '2026-09-01', 'day', 800, 790, { valida: false, motivoInvalida: 'final menor que inicial' }),
    L('m5', '2026-09-01', 'day', 900, null),     // incompleta
  ];
  const filas = H.compararJornadaHorometro(rondas, lecturas);
  eq('una fila por ronda, ordenadas por fecha y código', filas.map((f) => `${f.fecha} ${f.code}`), ['2026-09-01 CARG-03', '2026-09-01 EXC-04', '2026-09-01 GRUA-05', '2026-09-01 RETRO-01', '2026-09-02 RETRO-01', '2026-09-02 VIBRO-02']);
  const de = (code, fecha) => filas.find((f) => f.code === code && f.fecha === fecha);
  eq('cuadra dentro de media hora', de('RETRO-01', '2026-09-02').estado, 'cuadra');
  eq('+0,6 ya es horómetro mayor', de('RETRO-01', '2026-09-01'), { machineryId: 'm1', code: 'RETRO-01', empresa: 'EMPRESA ALFA', marca: '', modelo: '', placa: '', fecha: '2026-09-01', horasJornada: 11, horasHorometro: 11.6, diferencia: 0.6, estado: 'horometro_mayor' });
  eq('horómetro mayor', de('VIBRO-02', '2026-09-02').estado, 'horometro_mayor');
  eq('jornada mayor, con la diferencia negativa', [de('CARG-03', '2026-09-01').estado, de('CARG-03', '2026-09-01').diferencia, de('CARG-03', '2026-09-01').empresa], ['jornada_mayor', -5, 'EMPRESA BETA']);
  eq('inválida: sin horas ni diferencia', de('EXC-04', '2026-09-01'), { machineryId: 'm4', code: 'EXC-04', empresa: 'EMPRESA ALFA', marca: '', modelo: '', placa: '', fecha: '2026-09-01', horasJornada: 6, horasHorometro: null, diferencia: null, estado: 'invalida' });
  eq('solo una lectura incompleta cuenta como sin lectura', de('GRUA-05', '2026-09-01').estado, 'sin_lectura');
  eq('ronda sin ninguna lectura → sin lectura', H.compararJornadaHorometro([RONDA('m9', 'MOTO-09', '2026-09-05', 8, 0)], lecturas)[0].estado, 'sin_lectura');
  eq('la jornada del comparativo usa la fórmula completa (resta parada)', de('RETRO-01', '2026-09-01').horasJornada, 11);

  const res = H.resumenComparativo(filas);
  eq('resumen: cuentas', [res.filas, res.maquinas, res.conLectura, res.cuadran, res.horometroMayor, res.jornadaMayor, res.invalidas, res.sinLectura], [6, 5, 4, 1, 2, 1, 1, 1]);
  eq('resumen: horas', [res.horasJornada, res.horasHorometro], [48, 34.6]);
  eq('resumen: nadie lleva 5 días seguidos', res.listas, []);
}

// ── 7) LISTAS PARA ENCENDER (5 días seguidos) ────────────────────────────────
{
  const dias = (machineryId, code, desde, n, horas = 8) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = Date.parse(desde + 'T00:00:00Z') + i * 86400000;
      const fecha = new Date(t).toISOString().slice(0, 10);
      out.push(RONDA(machineryId, code, fecha, horas, 0));
    }
    return out;
  };
  const lectura = (machineryId, fecha, horas) => L(machineryId, fecha, 'day', 100, 100 + horas);
  // RETRO-01: 5 días seguidos cuadrando → lista.
  const r1 = dias('m1', 'RETRO-01', '2026-09-01', 5);
  const l1 = r1.map((r) => lectura('m1', r.fecha, 8));
  eq('5 días seguidos cuadrando → lista', H.resumenComparativo(H.compararJornadaHorometro(r1, l1)).listas, [{ code: 'RETRO-01', dias: 5 }]);
  // 4 días no alcanzan.
  eq('4 días no alcanzan', H.resumenComparativo(H.compararJornadaHorometro(r1.slice(0, 4), l1.slice(0, 4))).listas, []);
  // 5 días con un hueco (falta el 3) tampoco: no son seguidos.
  const r1h = [...dias('m1', 'RETRO-01', '2026-09-01', 2), ...dias('m1', 'RETRO-01', '2026-09-04', 3)];
  eq('5 días con un hueco en medio no son seguidos', H.resumenComparativo(H.compararJornadaHorometro(r1h, r1h.map((r) => lectura('m1', r.fecha, 8)))).listas, []);
  // Con una inválida en medio, la racha se corta.
  const l1i = l1.map((l, i) => (i === 2 ? { ...l, final: l.inicial - 1, valida: false, motivoInvalida: 'final menor que inicial' } : l));
  eq('una inválida en medio corta la racha', H.resumenComparativo(H.compararJornadaHorometro(r1, l1i)).listas, []);
  // Diferencias de hasta 3 h siguen contando; 3,5 no.
  const l1d = r1.map((r, i) => lectura('m1', r.fecha, i === 2 ? 11 : 8));
  eq('hasta 3 h de diferencia todavía cuenta', H.resumenComparativo(H.compararJornadaHorometro(r1, l1d)).listas, [{ code: 'RETRO-01', dias: 5 }]);
  const l1e = r1.map((r, i) => lectura('m1', r.fecha, i === 2 ? 11.5 : 8));
  eq('3,5 h corta la racha', H.resumenComparativo(H.compararJornadaHorometro(r1, l1e)).listas, []);
  // Un día sin lectura también corta.
  eq('un día sin lectura corta la racha', H.resumenComparativo(H.compararJornadaHorometro(r1, l1.filter((_, i) => i !== 2))).listas, []);
  // Racha de 6 en medio de 8 días: reporta los 6 seguidos.
  const r8 = dias('m1', 'RETRO-01', '2026-09-01', 8);
  const l8 = r8.map((r, i) => lectura('m1', r.fecha, i === 0 ? 2 : 8)); // el primero se va por 6 h
  eq('la racha más larga es la que se reporta', H.resumenComparativo(H.compararJornadaHorometro(r8, l8)).listas, [{ code: 'RETRO-01', dias: 7 }]);
  // Dos máquinas, ordenadas por código.
  const r2 = dias('m2', 'CARG-02', '2026-09-01', 5);
  const l2 = r2.map((r) => lectura('m2', r.fecha, 8));
  eq('varias listas salen por código', H.resumenComparativo(H.compararJornadaHorometro([...r1, ...r2], [...l1, ...l2])).listas.map((x) => x.code), ['CARG-02', 'RETRO-01']);
}

// ── 8) PAPEL ─────────────────────────────────────────────────────────────────
{
  ok('el CSS trae las clases del comparativo', ['.hc', '.hc-res', '.hc-ok', '.hc-mas', '.hc-menos', '.hc-sin'].every((c) => H.CSS_COMPARATIVO.includes(c)));
  const rondas = [
    RONDA('m1', 'RETRO-01', '2026-09-01', 8, 0),
    RONDA('m2', 'VIBRO-02', '2026-09-01', 8, 0, 0, 0, 'EMPRESA <BETA> & CIA'),
    RONDA('m3', 'CARG-03', '2026-09-02', 10, 0),
    RONDA('m4', 'EXC-04', '2026-09-02', 6, 0),
    RONDA('m5', 'GRUA-05', '2026-09-02', 6, 0),
  ];
  const lecturas = [
    L('m1', '2026-09-01', 'day', 100, 108.25),
    L('m2', '2026-09-01', 'day', 500, 510),
    L('m3', '2026-09-02', 'day', 700, 705),
    L('m4', '2026-09-02', 'day', 800, 790, { valida: false, motivoInvalida: 'final menor que inicial' }),
  ];
  const filas = H.compararJornadaHorometro(rondas, lecturas);
  const papel = H.cuerpoComparativo({ desde: '2026-09-01', hasta: '2026-09-02', filas });
  ok('el rango va en dd/mm/aaaa', /Del 01\/09\/2026 al 02\/09\/2026/.test(papel));
  ok('una tabla por día, con la fecha en dd/mm/aaaa', /01\/09\/2026 <span>2 máquina\(s\)/.test(papel) && /02\/09\/2026 <span>3 máquina\(s\)/.test(papel));
  ok('la tabla tiene las ocho columnas (con marca/modelo y placa)', /<th>Máquina<\/th><th>Marca \/ Modelo<\/th><th>Serial \/ Placa<\/th><th>Empresa<\/th><th class="r">Jornada h<\/th><th class="r">Horómetro h<\/th><th class="r">Diferencia<\/th><th>Estado<\/th>/.test(papel));
  ok('cuadra va con hc-ok', /<tr class="hc-ok"><td>RETRO-01<\/td>/.test(papel));
  ok('horómetro mayor va con hc-mas y signo +', /<tr class="hc-mas"><td>VIBRO-02<\/td>.*?\+2<\/td><td class="est">Horómetro mayor/.test(papel));
  ok('jornada mayor va con hc-menos', /<tr class="hc-menos"><td>CARG-03<\/td>.*?-5<\/td><td class="est">Jornada mayor/.test(papel));
  ok('inválida va con hc-menos y guion', /<tr class="hc-menos"><td>EXC-04<\/td>.*?—<\/td><td class="est">Inválida/.test(papel));
  ok('sin lectura va con hc-sin', /<tr class="hc-sin"><td>GRUA-05<\/td>.*?Sin lectura/.test(papel));
  ok('las horas van con coma decimal', /8,25<\/td>/.test(papel));
  ok('la empresa se escapa', papel.includes('EMPRESA &lt;BETA&gt; &amp; CIA') && !papel.includes('<BETA>'));
  ok('las cajas de resumen están', /class="hc-res"/.test(papel) && /<b>5<\/b>máquinas<\/div>/.test(papel) && /<b>1<\/b>inválidas<\/div>/.test(papel));
  ok('sin listas lo dice', /Máquinas listas para encender/.test(papel) && /Ninguna todavía/.test(papel));
  // Con una máquina lista, sale la tabla.
  const cinco = [];
  const lecs = [];
  for (let i = 1; i <= 5; i++) { const f = `2026-09-0${i}`; cinco.push(RONDA('m7', 'MOTO-07', f, 8, 0)); lecs.push(L('m7', f, 'day', 10, 18)); }
  const papel2 = H.cuerpoComparativo({ desde: '2026-09-01', hasta: '2026-09-05', filas: H.compararJornadaHorometro(cinco, lecs) });
  ok('la máquina lista sale en su tabla con sus días', /Días seguidos<\/th>/.test(papel2) && /<td>MOTO-07<\/td><td class="r">5<\/td>/.test(papel2));
  ok('sin filas, el papel lo dice y no revienta', /Sin rondas en el rango/.test(H.cuerpoComparativo({ desde: '2026-09-01', hasta: '2026-09-02', filas: [] })));
}

// ── EL FINAL OLVIDADO: cuál lectura puede completar el inspector (24-sep-2026) ──
{
  const HOY = '2026-09-24';
  const sinFinal = L('m1', HOY, 'day', 711.3, null);
  eq('la de hoy con inicial y sin final se puede completar', H.lecturaParaCompletarFinal([sinFinal], HOY), sinFinal);
  eq('sin lecturas no hay nada que completar', H.lecturaParaCompletarFinal([], HOY), null);
  eq('null aguanta', H.lecturaParaCompletarFinal(null, HOY), null);
  eq('la de AYER no: eso es corrección de Control', H.lecturaParaCompletarFinal([L('m1', '2026-09-23', 'day', 711.3, null)], HOY), null);
  eq('la que ya tiene final no se toca', H.lecturaParaCompletarFinal([L('m1', HOY, 'day', 711.3, 720.2)], HOY), null);
  eq('la que no tiene ni inicial tampoco (no hay contra qué restar)', H.lecturaParaCompletarFinal([L('m1', HOY, 'day', null, null)], HOY), null);
  eq('con día y noche a medias, primero el día', H.lecturaParaCompletarFinal([L('m1', HOY, 'night', 800, null), sinFinal], HOY).shift, 'day');
  eq('inicial 0 es un inicial válido (horómetro recién cambiado)', H.lecturaParaCompletarFinal([L('m1', HOY, 'day', 0, null)], HOY).inicial, 0);
}

// ── EL EDITOR DE CONTROL: parsear y validar la correccion (24-sep-2026) ──
{
  eq('numero con coma', H.numeroDeTexto('720,2'), 720.2);
  eq('numero con punto', H.numeroDeTexto('720.2'), 720.2);
  eq('vacio = borrar (null)', [H.numeroDeTexto(''), H.numeroDeTexto('  ')], [null, null]);
  eq('basura = false', [H.numeroDeTexto('abc'), H.numeroDeTexto('7.7.7'), H.numeroDeTexto('-3')], [false, false, false]);
  eq('cero es un numero valido', H.numeroDeTexto('0'), 0);

  const okC = { inicial: '711,3', final: '720,2', motivo: 'foto llego tarde' };
  eq('correccion buena pasa', H.validarCorreccionHorometro(okC), null);
  ok('sin motivo NO pasa', /motivo/i.test(H.validarCorreccionHorometro({ ...okC, motivo: '  ' }) ?? ''));
  ok('inicial basura no pasa', /inicial/.test(H.validarCorreccionHorometro({ ...okC, inicial: 'x' }) ?? ''));
  ok('final basura no pasa', /final/.test(H.validarCorreccionHorometro({ ...okC, final: '-1' }) ?? ''));
  ok('final menor que inicial no pasa', /menor/.test(H.validarCorreccionHorometro({ ...okC, final: '700' }) ?? ''));
  ok('borrar los dos no pasa', /al menos un numero/.test(H.validarCorreccionHorometro({ inicial: '', final: '', motivo: 'm' }) ?? ''));
  eq('borrar solo el final si pasa (lectura queda a medias, la base revalida)', H.validarCorreccionHorometro({ inicial: '711,3', final: '', motivo: 'el final era de otra maquina' }), null);
}

// ── GUARDIAS DEL MODO SOMBRA (23-sep-2026) ───────────────────────────────────
// Lo que hoy paga NO se toca: el horómetro se registra AL LADO, best-effort, y ninguna
// pantalla de dinero llama todavía a horasPagables. Si alguien lo conecta, que sea a
// propósito y cambiando estas guardias.
{
  const sup = leer('src/screens/SupervisorScreen.tsx');
  const qr = leer('src/screens/MachineQuickScreen.tsx');
  const ctl = leer('src/screens/ControlMaquinariaScreen.tsx');
  const rep = leer('src/screens/ReportsScreen.tsx');
  const pag = leer('src/screens/ControlPagosScreen.tsx');
  const db = leer('src/lib/horometroTrabajoDb.ts');
  // El teléfono registra sin esperar ni bloquear: `void guardarLecturaHorometro(...)...catch`.
  eq('el inspector registra al iniciar y al cerrar, best-effort', (sup.match(/void guardarLecturaHorometro\(/g) || []).length, 2);
  ok('...y nunca sin su .catch', /void guardarLecturaHorometro\([\s\S]*?\.catch\(\(\) => \{\}\)/.test(sup));
  eq('el QR del operador también, al iniciar y al cerrar', (qr.match(/void guardarLecturaHorometro\(/g) || []).length, 2);
  ok('el QR sigue escribiendo la jornada como hoy (decisión pendiente del cliente)', /day_hours: hours/.test(qr));
  // Control solo MUESTRA: no hay escritura de lecturas ni cambio de pago.
  ok('la celda sale con lecturas en la semana, o siempre para quien corrige', /lecturasHoro\.length > 0 \|\| puedeCorregirHoro \? \([\s\S]{0,400}?<HorometroTrabajoCelda/.test(ctl));
  // Control corrige SOLO por el modal (24-sep-2026: decision del cliente — solo admins,
  // motivo escrito basta). La pantalla no llama a guardar directo; el modal si, con
  // origen 'control' (la base exige modulo + motivo).
  ok('Control no guarda directo: corrige solo por el modal', !/guardarLecturaHorometro/.test(ctl) && /HorometroCorregirModal/.test(ctl));
  ok('el lapiz solo con el modulo horometros', /puedeCorregirHoro = levelMeets\(moduleLevel\('horometros'\), 'escritura'\)/.test(ctl));
  const modal = leer('src/components/HorometroCorregirModal.tsx');
  ok('el modal corrige con origen control', /origen: 'control'/.test(modal));
  ok('el modal exige el motivo (regla pura compartida)', /validarCorreccionHorometro/.test(modal));
  ok('el modal no toca machine_rounds ni horas', !/from\('machine_rounds'\)|day_hours|night_hours|upsertMachineRound/.test(modal));
  // Ninguna pantalla de dinero usa horasPagables: la fórmula de pago es la de siempre.
  ok('el pago sigue por workedFromShifts en Control', !/horasPagables/.test(ctl) && /workedFromShifts/.test(ctl));
  ok('el pago sigue por workedFromShifts en Reportes', !/horasPagables/.test(rep) && /workedFromShifts/.test(rep));
  ok('el pago sigue por workedFromShifts en Pagos', !/horasPagables/.test(pag) && /workedFromShifts/.test(pag));
  // La capa de datos no lanza: sin tabla, leer da [] y guardar da error legible.
  ok('leer lecturas devuelve [] si la tabla no existe', /catch \{\s*return \[\];/.test(db));
  ok('guardar nunca lanza', /return \{ ok: false, error: String\(e\?\.message \?\? e\) \}/.test(db));
  ok('la pestaña de Reportes dice que es modo sombra', /MODO SOMBRA/.test(rep) && /No cambia ningún pago/.test(rep));
  // El botón del FINAL OLVIDADO (24-sep-2026): completa, nunca pisa; y deja bitácora.
  ok('el botón existe en la pantalla del inspector', /PONER HORÓMETRO FINAL/.test(sup));
  ok('solo completa la lectura de HOY (regla pura compartida)', /lecturaParaCompletarFinal\(/.test(sup));
  ok('guarda por la vía validada con origen inspector', /guardarLecturaHorometro\(ci\.id, finTardia\.roundDate, finTardia\.shift, \{ final: hf,[\s\S]*?origen: 'inspector' \}\)/.test(sup));
  ok('el espejo viejo solo si estaba vacío (nunca pisa un final ya puesto)', /horometro_final == null\) void upsertMachineRound/.test(sup));
  ok('deja constancia en la bitácora de quién y cuándo', /logAudit\('HOROMETRO_FINAL_TARDE'/.test(sup));
  const fnTardio = sup.slice(sup.indexOf('const ponerFinalTardio'), sup.indexOf('\n  };', sup.indexOf('const ponerFinalTardio')));
  ok('no toca las horas pagadas (ni day_hours ni night_hours en el botón)', fnTardio.length > 200 && !/day_hours|night_hours/.test(fnTardio));
  // El CIERRE CONSCIENTE (24-sep-2026): con inicial y sin final, el primer toque avisa.
  ok('el cierre se detiene una vez si falta el final', /if \(!hfValid && \(horoIni \|\| ''\)\.trim\(\) !== '' && !cerrarSinFinal\) \{ setCerrarSinFinal\(true\); return; \}/.test(sup));
  ok('el segundo toque dice lo que hace', /Cerrar SIN horómetro final/.test(sup));
  ok('y queda en la bitácora que cerró sin horómetro', /cerró SIN horómetro final \(avisado\)/.test(sup));
  // El INICIO CONSCIENTE (25-sep-2026): sin horometro inicial, el primer toque avisa.
  ok('el inicio se detiene una vez si falta el horometro', /if \(!hiHas && !iniciarSinHoro\) \{ setIniciarSinHoro\(true\); return; \}/.test(sup));
  ok('el segundo toque dice lo que hace', /Iniciar SIN horómetro/.test(sup));
  ok('y queda en la bitacora que inicio sin horometro', /inició SIN horómetro inicial \(avisado\)/.test(sup));
  ok('el QR ya exige el inicial (no necesita aviso)', /Ingresa el horómetro inicial/.test(qr));
  // Manuales.
  ok('manual (md)', /Horómetro de trabajo \(modo sombra, 23\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app)', /HORÓMETRO DE TRABAJO \(MODO SOMBRA, 23\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
  ok('manual (md) cuenta el final olvidado', /final olvidado/i.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (md) cuenta el cierre consciente', /cierre consciente/i.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (md) cuenta el editor de Control', /Corregir horómetro|Corregir horometro/i.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) cuenta el editor de Control', /CORREGIR HORÓMETRO DESDE CONTROL/.test(leer('src/screens/ManualScreen.tsx')));
  ok('manual (app) cuenta el cierre consciente', /CIERRE CONSCIENTE/.test(leer('src/screens/ManualScreen.tsx')));
  ok('manual (md) cuenta el inicio consciente', /inicio consciente/i.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) cuenta el inicio consciente', /INICIO CONSCIENTE/.test(leer('src/screens/ManualScreen.tsx')));
  ok('manual (app) cuenta el final olvidado', /FINAL OLVIDADO/.test(leer('src/screens/ManualScreen.tsx')));
}

// ── LAS PASTILLAS DEL COMPARATIVO (25-sep-2026): lo oculto no deja rastro ─────
{
  const C = H.OPCIONES_COMPARATIVO_COMPLETO;
  const ronda = (id, code, fecha, dia) => ({ machineryId: id, code, empresa: 'EMPRESA FANTASMA CA', fecha, ronda: R(dia, 0) });
  const filas = H.compararJornadaHorometro(
    [ronda('m1', 'RETRO-01', '2026-09-01', 9.75), ronda('m2', 'GRUA-02', '2026-09-01', 6)],
    [L('m1', '2026-09-01', 'day', 100, 108)],
  );
  const d = { desde: '2026-09-01', hasta: '2026-09-01', filas };
  eq('sin tocar nada, el papel es EXACTAMENTE el de siempre', H.cuerpoComparativo(d), H.cuerpoComparativo(d, C));
  const sinEmp = H.cuerpoComparativo(d, { ...C, sinEmpresa: true });
  ok('sin empresa: ni la columna ni el nombre', !/Empresa/.test(sinEmp) && !sinEmp.includes('EMPRESA FANTASMA'));
  const solo = H.cuerpoComparativo(d, { ...C, sinJornada: true });
  ok('sin jornada: fuera sus horas, diferencia, estado, cuadre y listas',
    !/[Jj]ornada|Diferencia|Estado|[Cc]uadra|hc-ok|hc-mas|hc-menos|listas para encender/.test(solo));
  ok('...y las horas de la jornada no están ni de número', !solo.includes('9,75'));
  ok('...pero el horómetro sí está', /RETRO-01<\/td><td><\/td><td><\/td><td>EMPRESA FANTASMA CA<\/td><td class="r">8<\/td>/.test(solo));
  ok('sin resumen: fuera las cajas', !/hc-res/.test(H.cuerpoComparativo(d, { ...C, sinResumen: true })));
  ok('sin listas: fuera la sección entera', !/listas para encender/.test(H.cuerpoComparativo(d, { ...C, sinListas: true })));
  ok('sin detalle: fuera las tablas por día', !/máquina\(s\)/.test(H.cuerpoComparativo(d, { ...C, sinDetalle: true })));
  const nada = H.cuerpoComparativo(d, { sinMarca: true, sinModelo: true, sinPlaca: true, sinEmpresa: true, sinJornada: true, sinResumen: true, sinListas: true, sinDetalle: true });
  ok('todo apagado: el papel no dice «oculto» por ninguna parte', !/ocult/i.test(nada));
  // La ficha de la máquina (25-sep-2026: «falta marca y modelo, placa»).
  const conFicha = H.compararJornadaHorometro(
    [{ machineryId: 'm3', code: 'EXC-03', empresa: 'ACME', marca: 'CAT', modelo: '320D', placa: 'A7X-123', fecha: '2026-09-02', ronda: R(8, 0) }],
    [L('m3', '2026-09-02', 'day', 50, 58)],
  );
  const dF = { desde: '2026-09-02', hasta: '2026-09-02', filas: conFicha };
  ok('marca, modelo y placa salen por defecto', /<td>CAT \/ 320D<\/td><td>A7X-123<\/td>/.test(H.cuerpoComparativo(dF)));
  const sinMarca = H.cuerpoComparativo(dF, { ...C, sinMarca: true });
  ok('sin marca: queda el modelo, sin rastro de la marca', !/CAT|Marca/.test(sinMarca) && /<th>Modelo<\/th>/.test(sinMarca) && /<td>320D<\/td>/.test(sinMarca));
  ok('sin marca ni modelo: fuera la columna entera', !/CAT|320D|Marca|Modelo/.test(H.cuerpoComparativo(dF, { ...C, sinMarca: true, sinModelo: true })));
  ok('sin placa: ni la columna ni el número', !/Serial|Placa|A7X-123/.test(H.cuerpoComparativo(dF, { ...C, sinPlaca: true })));
  eq('alternar prende y apaga', H.alternarComparativo(C, 'sinEmpresa').sinEmpresa, true);
  ok('en palabras: completo por defecto', /Sale completo/.test(H.ocultosComparativoEnPalabras(C)));
  ok('en palabras: nombra lo apagado', /nombre de empresas/.test(H.ocultosComparativoEnPalabras({ ...C, sinEmpresa: true })));
  eq('sufijo de archivo vacío por defecto', H.sufijoArchivoComparativo(C), '');
  ok('sufijo nombra lo apagado', / - sin empresas/.test(H.sufijoArchivoComparativo({ ...C, sinEmpresa: true })));
  ok('el título se adapta: sin jornada no dice «vs jornada»',
    !/JORNADA/.test(H.tituloComparativo({ ...C, sinJornada: true })) && /VS JORNADA/.test(H.tituloComparativo(C)));
  ok('el subtítulo igual', !/jornada/i.test(H.subtituloComparativo({ ...C, sinJornada: true })));
}

// ── GUARDIAS DEL REPORTE AJUSTABLE (25-sep-2026) ─────────────────────────
{
  const rep = leer('src/screens/ReportsScreen.tsx');
  ok('el reporte de horómetros tiene sus pastillas', /const \[opHoro, setOpHoro\] = useState<OpcionesComparativo>\(OPCIONES_COMPARATIVO_COMPLETO\)/.test(rep));
  ok('...y sus logos propios (BCV + SOS por omisión, como salía)', /useState<ReporteLogos>\(\{ sos: true, golden: false, renace: false, bcv: true \}\)/.test(rep));
  ok('el papel se genera con las opciones', /cuerpoComparativo\(\{ desde: from, hasta: to, filas \}, opHoro\)/.test(rep));
  ok('el membrete recibe los logos y el título se adapta', /pdfShell\(tituloComparativo\(opHoro\), sub, body, horoLogos\)/.test(rep));
  ok('el nombre del archivo cuenta lo apagado', /sufijoArchivoComparativo\(opHoro\)/.test(rep));
  ok('la carga del comparativo trae la ficha (marca, modelo, placa)', /id, code, marca, modelo, plate, serial, clasificacion, company:company_id\(name\)/.test(leer('src/lib/horometroComparativoDb.ts')));
  ok('pdfShell SIN logos sale como siempre (lo comparten ~20 reportes)', /sos: logos\?\.sos \?\? true, golden: logos\?\.golden \?\? false, renace: logos\?\.renace \?\? false, bcv: logos\?\.bcv \?\? true/.test(rep));
  ok('manual (md) cuenta las pastillas del reporte de horómetros', /igual de ajustable que los demás reportes de maquinaria/.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) cuenta las pastillas del reporte de horómetros', /PASTILLAS DEL REPORTE DE HORÓMETROS/.test(leer('src/screens/ManualScreen.tsx')));
}

// ── LAS FOTOS DE LOS TABLEROS (26-sep-2026): un check, nunca predefinido ─────
{
  const C = H.OPCIONES_COMPARATIVO_COMPLETO;
  const ficha = (id) => (id === 'm1' ? { code: 'RETRO-01', empresa: 'ACME CA' } : undefined);
  const lecFoto = { ...L('m1', '2026-09-02', 'day', 100, 108), fotoInicialUrl: 'https://x/ini.jpg', fotoFinalUrl: 'https://x/fin.jpg' };
  const g = H.seccionFotosComparativo([lecFoto, L('m1', '2026-09-01', 'night', 90, 100)], ficha, C);
  ok('cada foto sale con su etiqueta y su numero', /Inicial 100/.test(g) && /Final 108/.test(g));
  ok('la imagen apunta a la URL guardada', /<img src="https:\/\/x\/ini\.jpg"\/>/.test(g));
  ok('lectura sin foto no pinta figuras de mas', (g.match(/<figure>/g) || []).length === 2);
  ok('agrupadas por dia en dd/mm/aaaa', /02\/09\/2026 <span>2 foto\(s\)/.test(g));
  ok('maquina fuera del filtro: su foto tampoco sale', (H.seccionFotosComparativo([{ ...lecFoto, machineryId: 'zz' }], ficha, C).match(/<figure>/g) || []).length === 0);
  ok('sin empresa: la foto no la nombra', !/ACME/.test(H.seccionFotosComparativo([lecFoto], ficha, { ...C, sinEmpresa: true })));
  ok('sin fotos lo dice y no revienta', /Sin fotos en el rango/.test(H.seccionFotosComparativo([], ficha, C)));

  const rep2 = leer('src/screens/ReportsScreen.tsx');
  ok('el check arranca APAGADO (nunca predefinido)', /const \[horoFotos, setHoroFotos\] = useState\(false\)/.test(rep2));
  ok('solo con el check el papel trae la galeria', /const fotos = !horoFotos \? '' : seccionFotosComparativo\(/.test(rep2));
  ok('el nombre del archivo lo cuenta', /\$\{horoFotos \? ' - con fotos' : ''\}/.test(rep2));
  ok('la carga de lecturas trae las dos fotos', /foto_inicial_url, foto_final_url/.test(leer('src/lib/horometroTrabajoDb.ts')));
  ok('manual (md) cuenta el check de fotos', /Traer las fotos de los horómetros/.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) cuenta el check de fotos', /FOTOS DE LOS HORÓMETROS EN EL REPORTE/.test(leer('src/screens/ManualScreen.tsx')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-horometro-trabajo · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
