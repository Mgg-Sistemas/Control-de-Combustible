/*
 * ESTADO de avería/parada del módulo CONTROL DE MAQUINARIA.
 *
 * Blinda `computeControlAveriadas` (src/lib/controlEstado.ts), la regla que
 * decide qué máquinas salen 🔴/🟡 en Control. Debe cuadrar con el teléfono
 * (`segmentoDe`, fuente de verdad): reactivación por jornada abierta, la
 * ARRASTRADA se suelta si la máquina trabajó hoy (la de HOY se mantiene),
 * SIEMPRE ACTIVO nunca sale, y avería REAL gana sobre "MÁQUINA PARADA".
 *
 *   npm run test:control   (o: node scripts/test-control-estado.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');

// controlEstado.ts es PURO (sin imports) → transpila y evalúa directo.
const src = fs.readFileSync(path.join(ROOT, 'src/lib/controlEstado.ts'), 'utf8');
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const mod = { exports: {} };
new Function('exports', 'module', js)(mod.exports, mod);
const { computeControlAveriadas } = mod.exports;

// ── Escenario determinista ───────────────────────────────────────────────────
const DATE = '2026-08-15';
const dayStartMs = new Date(`${DATE}T00:00:00-04:00`).getTime();
const HOY9 = `${DATE}T09:00:00-04:00`;                 // marca de HOY
const AYER10 = `2026-08-14T10:00:00-04:00`;            // marca ARRASTRADA (ayer)
const openHoy10 = new Date(`${DATE}T10:00:00-04:00`).getTime(); // jornada abierta hoy 10am

const PAR = (id, created) => ({ machinery_id: id, material: 'MÁQUINA PARADA', created_at: created });
const AVE = (id, created) => ({ machinery_id: id, material: 'FALLA ELÉCTRICA', created_at: created });

const run = (over) => computeControlAveriadas({
  tickets: [], sos: new Set(), openStartByMachine: {}, workedTodayByMachine: {}, dayStartMs, ...over,
});

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(name); } };

// 1) Parada de HOY, sin jornada ni horas → 🟡 parada.
{
  const { averiadas, tipo } = run({ tickets: [PAR('m1', HOY9)] });
  ok('parada de HOY → averiada', averiadas.has('m1') && tipo.m1 === 'parada');
}
// 2) Parada ARRASTRADA + trabajó hoy → se suelta (como el teléfono).
{
  const { averiadas } = run({ tickets: [PAR('m2', AYER10)], workedTodayByMachine: { m2: 12 } });
  ok('parada ARRASTRADA + trabajó hoy → NO averiada', !averiadas.has('m2'));
}
// 3) Parada ARRASTRADA + NO trabajó → se mantiene.
{
  const { averiadas } = run({ tickets: [PAR('m3', AYER10)] });
  ok('parada ARRASTRADA sin trabajo → averiada', averiadas.has('m3'));
}
// 4) Parada de HOY pero la jornada reabrió DESPUÉS de la marca → reactivada.
{
  const { averiadas } = run({ tickets: [PAR('m4', HOY9)], openStartByMachine: { m4: openHoy10 } });
  ok('reactivada (jornada abrió después de la marca) → NO averiada', !averiadas.has('m4'));
}
// 5) SIEMPRE ACTIVO (SOS) → nunca sale.
{
  const { averiadas } = run({ tickets: [PAR('m5', HOY9)], sos: new Set(['m5']) });
  ok('SIEMPRE ACTIVO → NO averiada', !averiadas.has('m5'));
}
// 6) Avería REAL de hoy → 🔴 avería.
{
  const { averiadas, tipo } = run({ tickets: [AVE('m6', HOY9)] });
  ok('avería real → averiada tipo avería', averiadas.has('m6') && tipo.m6 === 'averia');
}
// 7) Parada + Avería en la MISMA máquina → gana avería.
{
  const { tipo } = run({ tickets: [PAR('m7', HOY9), AVE('m7', HOY9)] });
  ok('avería gana sobre parada (mismo equipo)', tipo.m7 === 'averia');
  const { tipo: t2 } = run({ tickets: [AVE('m7', HOY9), PAR('m7', HOY9)] });
  ok('avería gana sobre parada (orden inverso)', t2.m7 === 'averia');
}
// 8) Parada de HOY + trabajó hoy → SE MANTIENE (la del día gana sobre las horas).
{
  const { averiadas } = run({ tickets: [PAR('m8', HOY9)], workedTodayByMachine: { m8: 12 } });
  ok('parada de HOY + trabajó → SIGUE averiada (no es arrastrada)', averiadas.has('m8'));
}

// ── 9) ⭐ MARCAR AVERIADO NO ABRE EXPEDIENTE DE TALLER (02-sep-2026) ────────
//
// Durante dos semanas, cada "⚠️ Marcar equipo averiado" desde Control insertaba
// un `machinery_repairs` correctivo en estado 'en_reparacion'. El comentario
// decía «para que Mantenimiento la gestione», pero eso dejó de ser cierto el
// 17-ago-2026, cuando se quitó la pestaña "🔧 En reparación" de Servicio:
// Mantenimiento solo lista preventivos, Servicio ya no dibuja los correctivos, y
// `openReturn` —la única forma de cerrarlos— vivía dentro de esa pestaña. El
// resultado eran expedientes invisibles, imposibles de cerrar, que además dejaban
// a la máquina bloqueada para mantenimiento preventivo para siempre.
//
// LA REGLA: marcar una máquina averiada es una decisión sobre LA MÁQUINA, no
// sobre EL TALLER. El expediente nace cuando el taller RECIBE la máquina.
{
  const scr = fs.readFileSync(path.join(ROOT, 'src/screens/ControlMaquinariaScreen.tsx'), 'utf8');
  // Sin comentarios: nombrar la tabla en una explicación no es escribirla.
  const vivo = scr.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  ok('⭐⭐ Control NO abre expedientes de taller',
    !/from\(\s*'machinery_repairs'\s*\)[\s\S]{0,200}\.insert\(/.test(vivo));
  ok('⭐ y no toca `machinery_repairs` de ninguna forma',
    !/from\(\s*'machinery_repairs'\s*\)/.test(vivo));

  // Lo que SÍ tiene que seguir haciendo: el reporte y el marcador de parada. Sin
  // estos dos la máquina dejaría de verse averiada y detenida en todo el sistema,
  // que sería cambiar un problema por otro mucho peor.
  ok('⭐ pero SIGUE creando la avería real', /material:\s*'otro'/.test(vivo));
  ok('⭐ y SIGUE dejando el marcador de parada', /material:\s*'MÁQUINA PARADA'/.test(vivo));
}

if (fail) {
  console.log(`\n✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`\n${pass} OK · 0 FALLO(S)\nControl clasifica avería/parada igual que el teléfono (segmentoDe).`);
