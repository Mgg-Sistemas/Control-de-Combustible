/*
 * 🕐 CORREGIR LA HORA DE INICIO DE UNA JORNADA QUE SIGUE ABIERTA (28-oct-2026).
 *
 * El inspector se equivocó al tocar «Iniciar» y la jornada sigue EN CURSO. Solo se
 * mueve `jornada_start_at`; de ahí salen las horas en vivo y el FINALIZAR. Se fija:
 *  · su máquina en su turno (o coordina), jornada abierta, de hoy o de ayer;
 *  · el inicio nuevo dentro del turno (la noche cruza la medianoche), nunca en el
 *    futuro, distinto del actual, con el MISMO anclaje que el inicio normal;
 *  · no queda antes del fin de otro tramo del turno, ni cruza una avería/parada
 *    marcada entre el inicio viejo y el nuevo;
 *  · `jornada_marked_at` no se toca; candado sobre el inicio leído; traza agregada.
 *
 *   node scripts/test-corregir-inicio-abierta.mjs
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
  // './supabase' de mentira: corregirHorasJornada → jornada → supabase (react-native).
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
const J = compilar(path.join(ROOT, 'src/lib/jornada.ts'));
const { puedeCorregirInicioAbierta, validarCorreccionInicioAbierta, trazaInicioAbierta, notasConTraza } = L;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const CCS = (iso) => new Date(iso + '-04:00').getTime();
const ISO = (iso) => new Date(CCS(iso)).toISOString();
const HOY = '2026-10-28';
const AYER = '2026-10-27';
const ANTEAYER = '2026-10-26';

// Jornada de DÍA abierta hoy desde las 09:00; son las 11:00.
const AHORA = CCS('2026-10-28T11:00:00');
const valida = (over = {}) => validarCorreccionInicioAbierta({
  roundDate: HOY, shift: 'day', inicioActualIso: ISO('2026-10-28T09:00:00'), inicioTexto: '07:30',
  motivo: 'marqué tarde', tramosDelTurno: [], marcas: [], nowMs: AHORA, ...over,
});

// ── Permiso ───────────────────────────────────────────────────────────────
const perm = (over = {}) => puedeCorregirInicioAbierta({ abierta: true, roundDate: HOY, today: HOY, yesterday: AYER, asignadoEnTurno: true, ...over });
ok('1. su máquina, su turno, jornada abierta de hoy → puede', perm().ok);
ok('2. la noche de AYER que sigue abierta → puede', perm({ roundDate: AYER }).ok);
ok('3. jornada ya cerrada → no', /ya no está abierta/.test(perm({ abierta: false }).error));
ok('4. máquina de OTRO en ese turno → no', /no es tuya/.test(perm({ asignadoEnTurno: false }).error));
ok('5. jornada de hace días → no (Control)', /hace días/.test(perm({ roundDate: ANTEAYER }).error));

// ── Dentro / fuera del turno de DÍA ───────────────────────────────────────
const v1 = valida();
eq('6. día: 09:00 → 07:30 (90 min antes)', [v1.ok, v1.startMs === CCS('2026-10-28T07:30:00'), v1.diferenciaMin], [true, true, -90]);
const v2 = valida({ inicioTexto: '09:45' });
eq('7. día: 09:00 → 09:45 (hacia adelante)', [v2.ok, v2.diferenciaMin], [true, 45]);
ok('8. día: 06:30 está fuera del turno (07:00 a 19:00)', /fuera del turno/.test(valida({ inicioTexto: '06:30' }).error));
ok('9. día: 19:00 está fuera (el fin del turno no cuenta)', /fuera del turno/.test(valida({ inicioTexto: '19:00', nowMs: CCS('2026-10-28T19:30:00') }).error));
ok('10. día: 07:00 en punto vale', valida({ inicioTexto: '07:00' }).ok);

// ── Futuro, igual, motivo, formato ────────────────────────────────────────
ok('11. 11:30 con las 11:00 → en el futuro', /futuro/.test(valida({ inicioTexto: '11:30' }).error));
ok('12. 11:00 justo ahora vale (gracia de un minuto)', valida({ inicioTexto: '11:00' }).ok);
ok('13. la MISMA hora → «no cambiaste»', /no cambiaste/.test(valida({ inicioTexto: '09:00' }).error));
ok('14. mismo minuto aunque el inicio tenga segundos (QR) → «no cambiaste»', /no cambiaste/.test(valida({ inicioTexto: '09:00', inicioActualIso: ISO('2026-10-28T09:00:34') }).error));
ok('15. sin motivo → error', /MOTIVO/.test(valida({ motivo: '   ' }).error));
ok('16. «25:00» no es hora', /no es una hora válida/.test(valida({ inicioTexto: '25:00' }).error));
ok('17. «abc» no es hora', /no es una hora válida/.test(valida({ inicioTexto: 'abc' }).error));

// ── Noche que cruza la medianoche ─────────────────────────────────────────
const nocheAbierta = (over = {}) => validarCorreccionInicioAbierta({
  roundDate: AYER, shift: 'night', inicioActualIso: ISO('2026-10-27T21:00:00'), inicioTexto: '19:30',
  motivo: 'x', tramosDelTurno: [], marcas: [], nowMs: CCS('2026-10-28T02:00:00'), ...over,
});
const n1 = nocheAbierta();
eq('18. noche: 21:00 → 19:30 del mismo día', [n1.ok, n1.startMs === CCS('2026-10-27T19:30:00')], [true, true]);
const n2 = nocheAbierta({ inicioTexto: '01:30' });
eq('19. noche: 01:30 cae en el día SIGUIENTE (misma jornada)', [n2.ok, n2.startMs === CCS('2026-10-28T01:30:00')], [true, true]);
ok('20. noche: 03:00 con las 02:00 → en el futuro', /futuro/.test(nocheAbierta({ inicioTexto: '03:00' }).error));
ok('21. noche: 18:30 está fuera (19:00 a 07:00)', /fuera del turno/.test(nocheAbierta({ inicioTexto: '18:30' }).error));
ok('22. noche: 07:00 está fuera (ya es el turno de día)', /fuera del turno/.test(nocheAbierta({ inicioTexto: '07:00', nowMs: CCS('2026-10-28T08:00:00') }).error));
ok('23. noche: 06:59 vale (último minuto de la noche)', nocheAbierta({ inicioTexto: '06:59', nowMs: CCS('2026-10-28T07:30:00') }).ok);

// ── No pisa tramos del turno ──────────────────────────────────────────────
// Trabajó 07:00–08:30:20, se marcó parada (cerró el tramo), y se re-inició a las 09:00.
const TRAMO = { id: 't1', shift: 'day', source: 'parada_averia', started_at: ISO('2026-10-28T07:00:00'), ended_at: ISO('2026-10-28T08:30:20'), hours: 1.51, recorded_by: 'u' };
ok('24. 08:00 pisa el tramo 07:00–08:30 → error, «antes de las 08:31»', /antes de las 08:31.*07:00–08:30/.test(valida({ inicioTexto: '08:00', tramosDelTurno: [TRAMO] }).error));
ok('25. 08:31 justo después del tramo → vale', valida({ inicioTexto: '08:31', tramosDelTurno: [TRAMO] }).ok);
ok('26. jornada anterior finalizada 07:00–10:00 bloquea 09:30', /antes de las 10:00/.test(valida({ inicioActualIso: ISO('2026-10-28T10:30:00'), inicioTexto: '09:30', tramosDelTurno: [{ ...TRAMO, source: 'manual_finish', ended_at: ISO('2026-10-28T10:00:00') }] }).error));
ok('27. una marca de un instante de Control (ajuste) no bloquea', valida({ tramosDelTurno: [{ id: 'z', shift: 'day', source: 'ajuste_manual', started_at: ISO('2026-10-28T10:00:00'), ended_at: ISO('2026-10-28T10:00:00'), hours: 3, recorded_by: 'c' }] }).ok);
ok('28. un tramo del OTRO turno no bloquea', valida({ tramosDelTurno: [{ ...TRAMO, shift: 'night' }] }).ok);

// ── No cruza averías/paradas marcadas entre el inicio viejo y el nuevo ────
const PARADA = (hora, status) => ({ id: 'm1', material: 'MÁQUINA PARADA', status, created_at: ISO(`2026-10-28T${hora}`) });
ok('29. hacia atrás sobre una parada RESUELTA de las 08:00 → error', /08:00 se marcó una parada/.test(valida({ marcas: [PARADA('08:00:00', 'realizado')] }).error));
ok('30. hacia atrás sobre una avería pendiente → error «una avería»', /se marcó una avería/.test(valida({ marcas: [{ material: 'caucho', status: 'pendiente', created_at: ISO('2026-10-28T08:15:00') }] }).error));
ok('31. hacia adelante sobre una parada PENDIENTE de las 09:10 → error', /09:10 se marcó una parada/.test(valida({ inicioTexto: '09:30', marcas: [PARADA('09:10:00', 'pendiente')] }).error));
ok('32. hacia adelante sobre una parada YA RESUELTA → vale', valida({ inicioTexto: '09:30', marcas: [PARADA('09:00:31', 'realizado')] }).ok);
ok('33. una parada ANTES del inicio nuevo no cuenta', valida({ marcas: [PARADA('07:10:00', 'pendiente')] }).ok);
ok('34. parada justo en el inicio nuevo (07:30) → error (intervalo [nuevo, viejo))', !valida({ marcas: [PARADA('07:30:00', 'realizado')] }).ok);
ok('35. parada justo en el inicio viejo (09:00) hacia atrás → vale', valida({ marcas: [PARADA('09:00:00', 'realizado')] }).ok);

// ── Anclaje: el MISMO que el inicio normal ────────────────────────────────
const ref = J.calcularInicioJornada({ declaredIso: ISO('2026-10-28T09:15:00'), shift: 'day', now: new Date(AHORA) });
const va = valida({ inicioActualIso: ISO('2026-10-28T10:00:00'), inicioTexto: '09:15' });
eq('36. anclaje = calcularInicioJornada (hoy NO ancla: 09:15 queda 09:15)', [va.ok, va.startMs === new Date(ref.startIso).getTime(), ref.anclada, va.startMs === CCS('2026-10-28T09:15:00')], [true, true, false, true]);

// ── Traza ─────────────────────────────────────────────────────────────────
const tz = trazaInicioAbierta({ nowMs: AHORA, anteriorMs: CCS('2026-10-28T09:00:00'), nuevoMs: CCS('2026-10-28T07:30:00'), motivo: '  marqué tarde ' });
eq('37. traza con fecha, antes → después y motivo', tz, 'Inicio de jornada corregido por inspector el 28/10 11:00: 09:00 → 07:30 · motivo: marqué tarde');
eq('38. la traza se AGREGA a las notas de la ronda', notasConTraza('nota vieja', tz), `nota vieja\n${tz}`);

// ── El cableado (fuente): candado, sin marked_at, modal al final, inicio refrescado ──
const modal = fs.readFileSync(path.join(ROOT, 'src/components/CorregirInicioJornadaAbiertaModal.tsx'), 'utf8');
const pant = fs.readFileSync(path.join(ROOT, 'src/screens/SupervisorScreen.tsx'), 'utf8');
ok('39. candado: .eq(jornada_start_at, lo leído) + .select(id) + exige 1 fila', modal.includes(".eq('jornada_start_at', r.jornada_start_at)") && modal.includes(".select('id')") && modal.includes('upd.length !== 1'));
ok('40. el modal NO escribe jornada_marked_at ni horas', !/jornada_marked_at\s*:/.test(modal) && !/(day|night)_hours\s*:/.test(modal) && !modal.includes('upsertMachineRound('));
ok('41. vuelve a leer la ronda y aborta si el inicio cambió', modal.includes('el inicio de la jornada cambió mientras corregías'));
const iMount = pant.indexOf('<CorregirInicioJornadaAbiertaModal');
ok('42. el modal se monta al FINAL del árbol (después del último </Modal>)', iMount > pant.lastIndexOf('</Modal>'));
ok('43. al guardar, la pantalla toma el inicio nuevo (horas en vivo y FINALIZAR)', /onSaved=\{\(nuevoInicio, aviso\) => \{ setJornadaStart\(nuevoInicio\)/.test(pant));
ok('44. el botón usa la misma regla asignadoEnTurnoDe', /asignadoEnTurnoDe\(jornadaShift\) \? \(\s*<TouchableOpacity onPress=\{\(\) => setInicioAbiertaEdit\(true\)\}/.test(pant));

console.log(`\ncorregir-inicio-abierta: ${pass} ok, ${fail} fallas`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
