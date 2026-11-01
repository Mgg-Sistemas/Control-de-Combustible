// 🔁 Candado: el inspector puede volver a poner a trabajar una máquina que se PARÓ en su
// turno (30-oct-2026). Antes, al parar se guardaban las horas y la pantalla daba el turno
// por «cerrado» («Podrás iniciar otra mañana»). La nueva jornada no puede empezar antes
// de la parada (esas horas ya están guardadas y se contarían dos veces).
import fs from 'node:fs';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };
const s = fs.readFileSync('src/screens/SupervisorScreen.tsx', 'utf8').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

ok('se calcula si el último tramo del turno fue una parada', /setParadaCierreById\(pMap\)/.test(s) && /x\.src === 'parada_averia' \|\| x\.src === 'parada_no_trabajo'/.test(s));
ok('una parada no deja el turno «cerrado»', /const shiftClosed = useMemo\(\(\) => \{[\s\S]{0,400}paradaCierreById\[ci\.id\][\s\S]{0,120}return false;[\s\S]{0,40}return hoursMine\(ci\.id\);/.test(s));
ok('la nueva jornada no puede empezar antes de la parada', /new Date\(startIso\)\.getTime\(\) < paradaMs/.test(s));
ok('el turno cerrado de verdad sigue cerrado', /return hoursMine\(ci\.id\);/.test(s));

console.log(failures.map((f) => '  ✗ ' + f).join('\n'));
console.log(`🔁 Reiniciar tras parada: ${pass} OK · ${fail} FALLO(S)`);
process.exit(fail ? 1 : 0);
