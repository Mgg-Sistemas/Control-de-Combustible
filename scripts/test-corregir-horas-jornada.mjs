/*
 * 🕐 CORREGIR LA HORA DE INICIO / FIN DE UNA JORNADA YA FINALIZADA (28-oct-2026).
 *
 * El inspector corrige, desde el teléfono, el inicio y el fin del tramo que ÉL
 * finalizó (hoy o ayer). De esas horas sale lo que se PAGA, así que se fija:
 *  · solo lo suyo, de hoy/ayer, de su máquina en ese turno;
 *  · lo que Control ajustó (o anuló por NO TRABAJÓ) no se toca;
 *  · inicio < fin, dentro del turno (la noche cruza la medianoche), nunca en el
 *    futuro, máximo 12 h, sin pisar otros tramos;
 *  · la ronda se mueve solo por la DIFERENCIA, con tope 0..12;
 *  · la traza se agrega a las notas, nunca las reemplaza.
 *
 *   node scripts/test-corregir-horas-jornada.mjs
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
  // './supabase' de mentira: horaFinJornada → jornada → supabase (react-native).
  if (parent && String(parent.filename || '').endsWith('.ts') && (req === './supabase' || req.endsWith('/supabase'))) {
    return { supabase: {}, selectAllRows: async () => [] };
  }
  if (req.startsWith('.') && parent && String(parent.filename || '').endsWith('.ts')) {
    const cand = path.resolve(path.dirname(parent.filename), req);
    for (const p of [cand, cand + '.ts', path.join(cand, 'index.ts')]) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return compilar(p);
    }
  }
  return realLoad.apply(this, arguments);
};

const L = compilar(path.join(ROOT, 'src/lib/corregirHorasJornada.ts'));
const { puedeCorregirHoras, validarCorreccionHoras, nuevasHorasRonda, trazaCorreccion, notasConTraza, horaDelTurnoMs, ventanaTurno } = L;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const CCS = (iso) => new Date(iso + '-04:00').getTime();
const ISO = (iso) => new Date(CCS(iso)).toISOString();
const UID = 'insp-1';
const HOY = '2026-10-28';
const AYER = '2026-10-27';

// Tramo de DÍA de hoy: 08:00 → 17:00 (9 h), cerrado por el inspector.
const DIA = { id: 's1', shift: 'day', source: 'manual_finish_early', started_at: ISO('2026-10-28T08:00:00'), ended_at: ISO('2026-10-28T17:00:00'), hours: 9, recorded_by: UID, notes: null, close_reason: 'se fue el operador' };
// Tramo de NOCHE de ayer: 19:30 → 06:00 de hoy (10.5 h).
const NOCHE = { id: 's2', shift: 'night', source: 'manual_finish', started_at: ISO('2026-10-27T19:30:00'), ended_at: ISO('2026-10-28T06:00:00'), hours: 10.5, recorded_by: UID };
const AHORA = CCS('2026-10-28T18:30:00');

const permiso = (over = {}) => puedeCorregirHoras({ tramo: DIA, uid: UID, roundDate: HOY, today: HOY, yesterday: AYER, asignadoEnTurno: true, tramosDelTurno: [DIA], ...over });
const valida = (over = {}) => validarCorreccionHoras({ roundDate: HOY, shift: 'day', inicioTexto: '07:30', finTexto: '17:00', motivo: 'llegó antes', tramo: DIA, tramosDelTurno: [DIA], nowMs: AHORA, ...over });

// ── Permisos ───────────────────────────────────────────────────────────────
eq('1. lo suyo, de hoy → puede', permiso(), { ok: true });
ok('2. de ayer también (noche) → puede', puedeCorregirHoras({ tramo: NOCHE, uid: UID, roundDate: AYER, today: HOY, yesterday: AYER, asignadoEnTurno: true, tramosDelTurno: [NOCHE] }).ok);
ok('3. anteayer → fuera de plazo', !permiso({ roundDate: '2026-10-26' }).ok && /plazo/.test(permiso({ roundDate: '2026-10-26' }).error));
ok('4. lo finalizó otro → no', !permiso({ uid: 'otro' }).ok);
ok('5. un cierre automático no es suyo para corregir', !permiso({ tramo: { ...DIA, source: 'auto_close' } }).ok);
const ctrl = permiso({ tramosDelTurno: [DIA, { id: 'a1', shift: 'day', source: 'ajuste_manual', started_at: ISO('2026-10-28T18:00:00'), ended_at: ISO('2026-10-28T18:00:00'), hours: -1, recorded_by: 'control' }] });
eq('6. Control ya ajustó el turno → «Corregido por Control»', [ctrl.ok, ctrl.porControl, ctrl.error], [false, true, 'Corregido por Control: pídeselo a Control.']);
ok('7. un ajuste de Control del OTRO turno no bloquea', permiso({ tramosDelTurno: [DIA, { id: 'a2', shift: 'night', source: 'ajuste_manual', started_at: DIA.started_at, ended_at: DIA.started_at, hours: 2, recorded_by: 'c' }] }).ok);
ok('8. turno anulado por NO TRABAJÓ → no', !permiso({ tramosDelTurno: [DIA, { id: 'n1', shift: 'day', source: 'no_trabajo_correction', started_at: DIA.ended_at, ended_at: DIA.ended_at, hours: -9, recorded_by: UID }] }).ok);
ok('9. máquina que no es suya en ese turno → no', !permiso({ asignadoEnTurno: false }).ok);

// ── Validación de horas ───────────────────────────────────────────────────
eq('10. día 07:30–17:00 → 9.5 h, diferencia +0.5', (({ ok, horasNuevas, horasViejas, diferencia }) => ({ ok, horasNuevas, horasViejas, diferencia }))(valida()), { ok: true, horasNuevas: 9.5, horasViejas: 9, diferencia: 0.5 });
eq('11. 08:30–15:00 (6.5 h) → diferencia −2.5', valida({ inicioTexto: '08:30', finTexto: '15:00' }).diferencia, -2.5);
ok('12. inicio ≥ fin → error', !valida({ inicioTexto: '17:00', finTexto: '17:00' }).ok && !valida({ inicioTexto: '18:00', finTexto: '09:00' }).ok);
ok('13. inicio antes de las 7:00 (día) → fuera del turno', /fuera del turno/.test(valida({ inicioTexto: '06:30' }).error));
ok('14. fin después de las 19:00 (día) → fuera del turno', /fuera del turno/.test(valida({ finTexto: '19:30', nowMs: CCS('2026-10-28T20:00:00') }).error));
ok('15. fin en el futuro → error', /futuro/.test(valida({ finTexto: '18:50' }).error));
ok('16. motivo vacío → error', /MOTIVO/.test(valida({ motivo: '   ' }).error));
ok('17. hora mal escrita → error', !valida({ inicioTexto: '7.30' }).ok && !valida({ finTexto: '25:00' }).ok);
ok('18. sin cambios → error', /No cambiaste/.test(valida({ inicioTexto: '08:00', finTexto: '17:00' }).error));
// Noche que cruza la medianoche: 19:00 → 07:00 = 12 h (el máximo exacto vale).
const vn = validarCorreccionHoras({ roundDate: AYER, shift: 'night', inicioTexto: '19:00', finTexto: '07:00', motivo: 'arrancó a la hora', tramo: NOCHE, tramosDelTurno: [NOCHE], nowMs: AHORA });
eq('19. noche 19:00→07:00 cruza medianoche: 12 h, +1.5', [vn.ok, vn.horasNuevas, vn.diferencia], [true, 12, 1.5]);
const vn2 = validarCorreccionHoras({ roundDate: AYER, shift: 'night', inicioTexto: '22:15', finTexto: '03:45', motivo: 'x', tramo: NOCHE, tramosDelTurno: [NOCHE], nowMs: AHORA });
eq('20. noche 22:15→03:45 (del día siguiente) = 5.5 h', [vn2.ok, vn2.horasNuevas, vn2.endMs === CCS('2026-10-28T03:45:00')], [true, 5.5, true]);
ok('21. noche: 08:00 está fuera del turno', /fuera del turno/.test(validarCorreccionHoras({ roundDate: AYER, shift: 'night', inicioTexto: '19:30', finTexto: '08:00', motivo: 'x', tramo: NOCHE, tramosDelTurno: [NOCHE], nowMs: AHORA }).error));
ok('22. noche de HOY aún no terminada: fin 02:00 está en el futuro', /futuro/.test(validarCorreccionHoras({ roundDate: HOY, shift: 'night', inicioTexto: '19:00', finTexto: '02:00', motivo: 'x', tramo: { ...NOCHE, started_at: ISO('2026-10-28T19:00:00'), ended_at: ISO('2026-10-28T19:20:00') }, tramosDelTurno: [], nowMs: CCS('2026-10-28T21:00:00') }).error));
// Solape con una parada del mismo turno (07:00–08:00 trabajó y paró).
const PARADA = { id: 'p1', shift: 'day', source: 'parada_no_trabajo', started_at: ISO('2026-10-28T07:00:00'), ended_at: ISO('2026-10-28T08:00:00'), hours: 1, recorded_by: UID };
ok('23. pisa la parada 07:00–08:00 → error', /pisan otro tramo del turno \(07:00–08:00\)/.test(valida({ inicioTexto: '07:30', tramosDelTurno: [DIA, PARADA] }).error));
ok('24. justo a continuación de la parada (08:00) no pisa', valida({ inicioTexto: '08:00', finTexto: '16:00', tramosDelTurno: [DIA, PARADA] }).ok);
ok('25. un ajuste de un instante no cuenta como solape', valida({ tramosDelTurno: [DIA, { id: 'z', shift: 'day', source: 'ajuste_manual', started_at: ISO('2026-10-28T10:00:00'), ended_at: ISO('2026-10-28T10:00:00'), hours: 1, recorded_by: 'c' }] }).ok);
ok('26. un tramo del OTRO turno no cuenta como solape', valida({ tramosDelTurno: [DIA, { ...PARADA, shift: 'night' }] }).ok);

// ── Ronda: la diferencia, tope 0..12 ──────────────────────────────────────
eq('27. ronda 9 + 0.5 = 9.5', nuevasHorasRonda(9, 0.5), { ok: true, horas: 9.5 });
eq('28. ronda 9 − 2.5 = 6.5', nuevasHorasRonda(9, -2.5), { ok: true, horas: 6.5 });
eq('29. nunca baja de 0', nuevasHorasRonda(1, -3), { ok: true, horas: 0 });
ok('30. subir por encima de 12 → error (no recorta en silencio)', !nuevasHorasRonda(11, 2).ok);
eq('31. justo 12 vale', nuevasHorasRonda(10.5, 1.5), { ok: true, horas: 12 });
eq('32. dato viejo por encima de 12 que baja: no se recorta de más', nuevasHorasRonda(13, -0.5), { ok: true, horas: 12.5 });

// ── Traza ─────────────────────────────────────────────────────────────────
const tz = trazaCorreccion({ nowMs: AHORA, tramo: DIA, motivo: '  llegó antes ' });
eq('33. traza con fecha, horas viejas y motivo', tz, 'Corregido por inspector el 28/10 18:30: antes 08:00–17:00 (9 h) · motivo: llegó antes');
eq('34. la traza se AGREGA a las notas previas', notasConTraza('nota vieja', 'T'), 'nota vieja\nT');
eq('35. sin notas previas queda solo la traza', notasConTraza(null, 'T'), 'T');

// ── Ventana ───────────────────────────────────────────────────────────────
eq('36. ventana de noche: 19:00 → 07:00 del día siguiente', ventanaTurno(AYER, 'night'), { inicioMs: CCS('2026-10-27T19:00:00'), finMs: CCS('2026-10-28T07:00:00') });
eq('37. hora de noche 23:59 cae el mismo día', horaDelTurnoMs(AYER, 'night', '23:59'), CCS('2026-10-27T23:59:00'));

console.log(`\ncorregir-horas-jornada: ${pass} ok, ${fail} fallas`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
