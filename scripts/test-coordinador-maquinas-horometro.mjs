// 🧑‍✈️🕐 COORDINADOR DE INSPECTORES CON MÁQUINAS + HORÓMETRO AL MARCAR PARADA
// (06-nov-2026, a pedido):
//  1. «A un coordinador de inspectores se le pueden asignar máquinas, y salen en la
//     gráfica de eficiencia»: ROLES_ASIGNABLES_MAQUINAS agrega 'coordinador_inspectores'
//     SOLO para asignar máquinas (teléfono y gráfica web); guardias y supervisión
//     siguen con la lista de siempre. La gráfica agrupa por el nombre de la asignación,
//     así que el coordinador sale con su % de eficiencia sin tocar nada más.
//  2. «Cuando se coloca averiada o parada por un inspector deben poder cargar el
//     horómetro de ese momento»: campo opcional (con foto, cámara Y galería) en las
//     DOS pestañas del modal de parada. El valor va al texto del ticket (también sin
//     señal), a la lectura FINAL del horómetro de trabajo (modo sombra, no paga) y a
//     machinery.last_horometro — igual que al finalizar jornada.
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
  m._compile(out, abs);
  cache.set(abs, m.exports);
  return m.exports;
}

let ok = 0; const fallas = [];
const check = (cond, msg) => { if (cond) ok++; else fallas.push('  ✗ ' + msg); };

// ── 1. Los roles asignables ──
const PA = loadTs(path.join(ROOT, 'src/lib/personalAsignable.ts'));
check(JSON.stringify(PA.ROLES_ASIGNABLES) === JSON.stringify(['supervisor', 'coordinador_patio']),
  'ROLES_ASIGNABLES (guardias/supervisión) queda EXACTAMENTE como estaba');
check(JSON.stringify(PA.ROLES_ASIGNABLES_MAQUINAS) === JSON.stringify(['supervisor', 'coordinador_patio', 'coordinador_inspectores']),
  '⭐ para MÁQUINAS también entra el coordinador de inspectores');

const sup = fs.readFileSync(path.join(ROOT, 'src/screens/SupervisorScreen.tsx'), 'utf8');
const resumen = fs.readFileSync(path.join(ROOT, 'src/screens/redesign/InspectionsSummary.tsx'), 'utf8');
check(/personalAsignable\('id, full_name, role', ROLES_ASIGNABLES_MAQUINAS\)/.test(sup),
  '⭐ el teléfono ofrece al coordinador al asignar máquinas');
check(/personalAsignable\('id, full_name, role', ROLES_ASIGNABLES_MAQUINAS\)/.test(resumen),
  '⭐ la gráfica de eficiencia (web) también lo ofrece en su desplegable');
const guardias = fs.readFileSync(path.join(ROOT, 'src/screens/DistribucionGuardiasScreen.tsx'), 'utf8');
check(!/ROLES_ASIGNABLES_MAQUINAS/.test(guardias),
  'las guardias NO cambian: siguen con la lista de siempre');
// La gráfica agrupa por el nombre de la asignación (inspector_name), sin filtrar por
// rol: con máquinas asignadas, el coordinador sale solo (misma vara que un inspector).
check(/const nm = a\.inspector_name \|\| '—'/.test(resumen),
  'la gráfica agrupa por el nombre de la asignación: el coordinador sale solo');

// ── 2. Horómetro al marcar avería / parada ──
check(/const \[paHoro, setPaHoro\] = useState\(''\);/.test(sup)
  && /const \[paHoroPhoto, setPaHoroPhoto\] = useState<string \| null>\(null\);/.test(sup),
  'existe el campo de horómetro del momento (y su foto)');
check(/const horoParadaValidado = /.test(sup)
  && /no es un número válido/.test(sup)
  && /no puede ser menor al inicial de la jornada/.test(sup),
  'valida: número válido y nunca menor al inicial de la jornada abierta');
const fAveria = sup.slice(sup.indexOf('const marcarParadaAveria'), sup.indexOf('const marcarParadaNoTrabajo'));
const fNoTrab = sup.slice(sup.indexOf('const marcarParadaNoTrabajo'), sup.indexOf('const volverOperativa'));
check(/horoParadaValidado\(\)/.test(fAveria) && /guardarHoroParada\(hp\.num\)/.test(fAveria),
  'avería: valida el horómetro y lo guarda al confirmar');
check(/horoParadaValidado\(\)/.test(fNoTrab) && /guardarHoroParada\(hp\.num\)/.test(fNoTrab),
  'no trabajó: valida el horómetro y lo guarda al confirmar');
check(/notes: notasParada/.test(fAveria) && !/notes: ciMotivo\.trim\(\) \|\| null/.test(fAveria),
  'avería: el horómetro viaja en el TEXTO del ticket (también en la cola sin señal)');
check((fNoTrab.match(/\$\{hp\.num != null \? ` · Horómetro: \$\{hp\.num\}` : ''\}/g) || []).length === 2,
  'no trabajó: el horómetro va en la nota, con señal y sin señal');
check(/const guardarHoroParada = /.test(sup)
  && /guardarLecturaHorometro\(ci\.id, rd, sh, \{ final: num/.test(sup)
  && /update\(\{ last_horometro: num \}\)/.test(sup),
  'guarda la lectura FINAL (modo sombra) y actualiza last_horometro, como al finalizar');
check((sup.match(/tomarFotoHoroParada\('galeria'\)/g) || []).length === 2
  && (sup.match(/tomarFotoHoroParada\('camara'\)/g) || []).length === 2,
  '⭐ la foto del horómetro ofrece cámara Y galería en LAS DOS pestañas (regla de la casa)');
check((sup.match(/🕐 Horómetro en este momento \(opcional\)/g) || []).length === 2,
  'el campo sale en la pestaña de avería Y en la de no trabajó');
check(/setPaHoro\(''\); setPaHoroPhoto\(null\);\s*\n\s*setNtCoords\(null\); setNtBusy\(false\);/.test(sup),
  'al cambiar de máquina el campo se limpia (no se arrastra a otra ficha)');

if (fallas.length) {
  console.error(fallas.join('\n'));
  console.error(`\n❌ test-coordinador-maquinas-horometro: ${fallas.length} falla(s), ${ok} ok`);
  process.exit(1);
}
console.log(`✅ test-coordinador-maquinas-horometro: ${ok} ok, 0 fallas`);
