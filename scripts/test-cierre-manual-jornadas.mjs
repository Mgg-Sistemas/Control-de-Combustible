/*
 * CIERRE MANUAL DE JORNADAS (26-sep-2026).
 *
 * Pedido del cliente: «las máquinas no se cierren automáticamente al finalizar la
 * jornada; los inspectores deben cerrarlas — pero que no haya choque entre
 * maquinarias y jornadas». Lo que se fija acá y por qué duele si se rompe:
 *   · el barredor del servidor quedó APAGADO por switch: cerrar es del inspector
 *   · cerrar TARDE banca solo hasta el fin NOMINAL del turno (7pm/7am) — sin este
 *     tope, cerrar a las 9pm regalaría 2 horas que antes el barredor no pagaba
 *   · el SEGMENTO que escribe el cierre lleva las MISMAS horas topadas: el
 *     reconciliador (cada 10 min) solo SUBE horas desde los segmentos, y un
 *     segmento crudo re-inflaría lo que la ronda bancó topado
 *   · al INICIAR una jornada nueva se liquidan las viejas abiertas (cierre
 *     rezagado), hasta su fin nominal, nunca más — ahí vive el anti-choque
 *
 *   node scripts/test-cierre-manual-jornadas.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}`); } };

const sup = leer('src/screens/SupervisorScreen.tsx');
const lib = leer('src/lib/machineRounds.ts');

// ── El cierre manual banca hasta el fin NOMINAL ──────────────────────────────
ok('el cierre calcula el fin nominal del turno (7pm día / 7am noche)',
  /const nominalEndMs = jornadaShift === 'night'\s*\n\s*\? new Date\(roundDate \+ 'T07:00:00-04:00'\)\.getTime\(\) \+ 86400000\s*\n\s*: new Date\(roundDate \+ 'T19:00:00-04:00'\)\.getTime\(\);/.test(sup));
ok('el cierre efectivo nunca pasa del nominal', /const cierreEfectivoMs = Math\.min\(Date\.now\(\), nominalEndMs\);/.test(sup));
ok('las horas salen del cierre efectivo, no de ahora', /const ms = cierreEfectivoMs - new Date\(jornadaStart\)\.getTime\(\);/.test(sup));
ok('el tope físico también usa el cierre efectivo', /\(cierreEfectivoMs - shiftStartMs\) \/ 3600000/.test(sup));
ok('el SEGMENTO termina en el cierre efectivo (el reconciliador lo suma tal cual)',
  /started_at: jornadaStart, ended_at: new Date\(cierreEfectivoMs\)\.toISOString\(\), hours: horas,/.test(sup));
ok('la bitácora dice cuando cerró tarde', /cerró tarde \(bancó hasta el fin del turno\)/.test(sup));

// ── El anti-choque: liquidar rezagadas al iniciar ────────────────────────────
ok('iniciar jornada liquida las rezagadas de esa máquina', /await cerrarJornadasRezagadas\(ci\.id, today, uid \|\| null\)/.test(sup));
ok('...sin que un fallo bloquee el inicio (try/catch)', /try \{\s*\n\s*const rez = await cerrarJornadasRezagadas/.test(sup));
ok('...y cada liquidación queda en la bitácora', /cierre rezagado \$\{c\.shift === 'night'/.test(sup) && /liquidada al iniciar la siguiente/.test(sup));
ok('la pantalla ya no promete el barredor de las 7', !/la cierra sola a las|auto-cierre del servidor la cierra/.test(sup));

// ── El liquidador (lib): solo viejas, hasta el nominal, tope 12 ──────────────
ok('solo toca jornadas de días ANTERIORES', /\.lt\('round_date', antesDeISO\)/.test(lib));
ok('solo las que siguen abiertas', /\.not\('jornada_start_at', 'is', null\)/.test(lib));
ok('una jornada cuyo turno aún corre no es rezago', /if \(Date\.now\(\) < finNominalMs\) continue;/.test(lib));
ok('banca hasta el fin nominal con tope 12', /Math\.min\(12, Math\.max\(0, Math\.round\(\(\(finNominalMs - startMs\) \/ 3600000\)/.test(lib));
ok('la suma con lo ya bancado también topa en 12', /const total = Math\.min\(12, Math\.round\(\(base \+ horas\)/.test(lib));
ok('el segmento del rezago termina en el fin nominal', /ended_at: new Date\(finNominalMs\)\.toISOString\(\)/.test(lib));
ok('el segmento usa un source que el reconciliador SÍ suma', /source: 'manual_finish', recorded_by: recordedBy/.test(lib));
ok('y dice por qué existe', /close_reason: 'cierre rezagado: liquidada al iniciar la siguiente jornada'/.test(lib));
ok('nunca lanza: todo envuelto en try/catch', /catch \{\}\s*\n\s*return \{ cerradas \};/.test(lib));

// ── Manuales ─────────────────────────────────────────────────────────────────
ok('manual (md) cuenta el cierre manual', /CIERRE MANUAL DE JORNADAS \(26\/09\/2026/.test(leer('docs/MANUAL-USUARIO.md')));
ok('manual (md) advierte que cerrar tarde no regala horas', /Cerrar tarde no regala horas/.test(leer('docs/MANUAL-USUARIO.md')));
ok('manual (app) cuenta el cierre manual', /CIERRE MANUAL DE JORNADAS \(26\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-cierre-manual-jornadas · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
