/*
 * SEPARACIÓN de AVERIADAS y PARADAS en el REPORTE DEL DÍA POR EMPRESA + identificación
 * del TURNO (día / noche) en que la máquina se averió o se paró.
 *
 * QUÉ PIDIÓ EL CLIENTE (20-ago-2026, textual): «sabes que existen las averiadas y
 * paradas, pero en esos reportes las engloba en color rojo ambas, pues no lo quiero
 * así, hazme la separación como corresponde, si es avería o parada... y que salga
 * también el esperando instrucciones, que se divida en renglones... además de que se
 * entienda o haya una buena separación o identificación si la máquina se paró o se
 * averió para el día y para la noche».
 *
 * LO QUE BLINDA ESTE TEST (src/lib/porEmpresaReport.ts):
 *   · El viejo bloque único «🔴 AVERIADAS / PARADAS» quedó dividido en dos:
 *     «🔴 Averiadas» (avería REAL) y «🟡 Paradas» (solo el marcador MÁQUINA PARADA).
 *   · La regla NO se inventó acá: avería real = maintenance_requests.material distinto
 *     de 'MÁQUINA PARADA'; parada = ese marcador genérico; la avería MANDA sobre la
 *     parada. Es la misma de src/lib/machineLiveStatus.ts (fetchAveriaCat) y
 *     src/lib/controlEstado.ts (computeControlAveriadas).
 *   · El teléfono guarda las DOS filas juntas cuando hay avería real → esa máquina va
 *     a Averiadas UNA sola vez, nunca a los dos bloques.
 *   · Cada columna de turno dice si eso fue 🔴 AVERÍA o 🟡 PARADA: una máquina averiada
 *     de día y parada de noche se distingue turno por turno.
 *   · Siguen saliendo «⏳ Esperando instrucciones» y «⏳ Pendientes por iniciar», y la
 *     SUMA de todos los bloques = el total de máquinas listadas de la empresa.
 *
 * No usa framework (el repo no tiene): transpila los .ts en memoria y stubbea la capa
 * de red/PDF. Mismo patrón que scripts/test-empresa-sync.mjs.
 *
 *   npm run test:empresa-estados   (o: node scripts/test-por-empresa-estados.mjs)
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

// ── Cargador recursivo de .ts, con stubs por NOMBRE de módulo ───────────────
const stubs = {};
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
    const base = id.split('/').pop();
    if (stubs[base]) return stubs[base];
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      const cand = [p + '.ts', p + '.tsx', path.join(p, 'index.ts')].find(fs.existsSync);
      if (cand) return loadTs(cand);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

// ── Escenario: una empresa con una máquina en cada estado que importa ────────
const DATE = '2026-08-18';           // día PASADO → sin cálculo EN VIVO (determinista)
const at = (h) => `${DATE}T${String(h).padStart(2, '0')}:00:00-04:00`;

// m1: avería REAL (falla eléctrica), 0 h            → 🔴 Averiadas
// m2: SOLO el marcador MÁQUINA PARADA, 0 h          → 🟡 Paradas
// m3: LOS DOS renglones (así los guarda el teléfono) → 🔴 Averiadas, UNA sola vez
// m4: avería de DÍA + parada de NOCHE               → 🔴 Averiadas (la avería manda),
//     pero la columna DÍA dice AVERÍA y la de NOCHE dice PARADA
// m5: en_espera, sin nada más                        → ⏳ Esperando instrucciones
// m6: trabajó 12 h de día                            → ✅ Activas
// m7: sin actividad, sin ticket, sin declarar        → ⏳ Pendientes por iniciar
// m8: trabajó 8 h y LUEGO se paró (sin avería)       → ✅ Activas, con "🟡 PARADA 2:00pm"
const mach = (id, code) => ({
  id, code, serial: `S-${id}`, plate: null, tipo: 'MARCA', encargado: null,
  active: true, operational: true, en_espera: id === 'm5', company_id: 'c1', company: { name: 'EMPRESA X' },
});
const MACHS = [
  mach('m1', 'EXCA AVERIADA'),
  mach('m2', 'PALA PARADA'),
  mach('m3', 'JUMBO AVERIA Y PARADA'),
  mach('m4', 'MIXTA DIA NOCHE'),
  mach('m5', 'GRUA EN ESPERA'),
  mach('m6', 'RETRO TRABAJO'),
  mach('m7', 'VOLQUETA PENDIENTE'),
  mach('m8', 'PAYLOADER TRABAJO Y PARO'),
];
const ronda = (id, dayH, extra = {}) => ({
  machinery_id: id, day_hours: dayH, night_hours: 0, hours_stopped: 0, overtime_hours: 0,
  jornada_start_at: null, jornada_shift: null, declared_day: null, declared_night: null,
  jornada_marked_by: null, ...extra,
});
const ROUNDS = [
  ronda('m6', 12, { jornada_shift: 'day', declared_day: true }),
  ronda('m8', 8, { jornada_shift: 'day', declared_day: true }),
];
const MR = [
  // m1: avería REAL sola (sin marcador). Material distinto de 'MÁQUINA PARADA'.
  { machinery_id: 'm1', material: 'FALLA ELÉCTRICA', notes: 'FALLA ELÉCTRICA', created_at: at(8), status: 'pendiente', resolved_at: null },
  // m2: SOLO el marcador genérico → parada, no avería.
  { machinery_id: 'm2', material: 'MÁQUINA PARADA', notes: 'NO TRABAJÓ · sin operador', created_at: at(9), status: 'pendiente', resolved_at: null },
  // m3: los DOS renglones del mismo evento (el teléfono los inserta juntos) → AVERIADA.
  { machinery_id: 'm3', material: 'MÁQUINA PARADA', notes: 'AVERIADA POR MECÁNICA', created_at: at(10), status: 'pendiente', resolved_at: null },
  { machinery_id: 'm3', material: 'AVERIADA POR MECÁNICA', notes: 'AVERIADA POR MECÁNICA', created_at: at(10), status: 'pendiente', resolved_at: null },
  // m4: avería de DÍA (8am) + parada de NOCHE (9pm) → cada turno con su rótulo.
  { machinery_id: 'm4', material: 'FALLA HIDRÁULICA', notes: 'FALLA HIDRÁULICA', created_at: at(8), status: 'pendiente', resolved_at: null },
  { machinery_id: 'm4', material: 'MÁQUINA PARADA', notes: 'NO TRABAJÓ · sin operador', created_at: at(21), status: 'pendiente', resolved_at: null },
  // m8: trabajó y a las 2pm se paró (marcador solo, sin avería real).
  { machinery_id: 'm8', material: 'MÁQUINA PARADA', notes: 'NO TRABAJÓ · falta de material', created_at: at(14), status: 'pendiente', resolved_at: null },
];

// supabase: `from(t)` devuelve una cadena thenable; `selectAllRows` sirve las tablas.
const makeChain = (data) => {
  const o = {};
  ['select', 'in', 'lte', 'gte', 'or', 'eq', 'order', 'not'].forEach((k) => (o[k] = () => o));
  o.then = (res) => res({ data });
  return o;
};
let roundsCall = 0;
stubs['supabase'] = {
  supabase: { from: (t) => makeChain(t === 'maintenance_requests' ? MR : []) },
  selectAllRows: async (table) => {
    if (table === 'machinery') return MACHS;
    if (table === 'machine_rounds') { roundsCall += 1; return roundsCall === 1 ? ROUNDS : []; }
    if (table === 'machine_work_segments') return [];
    return [];
  },
};
let captured = [];
stubs['pdf'] = {
  pdfDocument: ({ body }) => body,
  exportPdf: async (html) => { captured.push(html); return true; },
  nowStamp: () => '18 AGO 2026, 07:47 P. M.',
};
stubs['machineInspectors'] = {
  listInspectorAssignments: async () => ({ rows: MACHS.map((m) => ({
    machinery_id: m.id, inspector_name: 'PEPE PÉREZ', shift: 'day', code: m.code, serial: m.serial, plate: null,
    tipo: m.tipo, companyName: 'EMPRESA X', sector: 'ESTE', referencia: '', latitude: null, longitude: null, encargado: null,
  })) }),
  inspectorSiempreActivo: () => false,
};

const rep = loadTs(path.join(ROOT, 'src/lib/porEmpresaReport.ts'));
await rep.generateEmpresaDiaReport({ date: DATE, companyIds: ['c1'] });
const html = captured[0] || '';

// ── Helpers de aserción (mismo estilo que scripts/test-staff-pay-estado.mjs) ─
let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// Corta el HTML en BLOQUES (encabezado "<div class='grp ...'>✅ Activas · 3</div>" +
// su tabla, hasta el próximo encabezado o la próxima empresa).
const bloques = (() => {
  const re = /<div class="grp [^"]*">([^<]+)<\/div>/g;
  const heads = [];
  let m;
  while ((m = re.exec(html))) heads.push({ titulo: m[1].trim(), ini: m.index, fin: m.index + m[0].length });
  return heads.map((h, i) => {
    const corte = i + 1 < heads.length ? heads[i + 1].ini : html.length;
    const sig = html.slice(h.fin, corte).indexOf('<h3>');
    return { titulo: h.titulo, cuerpo: html.slice(h.fin, sig >= 0 ? h.fin + sig : corte) };
  });
})();
const bloque = (label) => bloques.find((b) => b.titulo.startsWith(label));
const cuenta = (label) => { const b = bloque(label); if (!b) return null; const m = b.titulo.match(/· (\d+)$/); return m ? Number(m[1]) : null; };
const enBloque = (label, code) => { const b = bloque(label); return !!b && b.cuerpo.includes(`<b>${code}</b>`); };
// Celdas de turno (DÍA y NOCHE) de la fila de una máquina.
const turnosDe = (code) => {
  const m = html.match(new RegExp(`<tr[^>]*>\\s*<td>\\d+</td><td><b>${code}</b>[\\s\\S]*?</tr>`));
  if (!m) return { dia: '', noche: '' };
  const celdas = m[0].split('</td>');
  return { dia: celdas[5] || '', noche: celdas[6] || '' };
};

ok('el reporte se generó', html.length > 0);

// ── 1) EL PEDIDO: ya no hay un bloque rojo que englobe las dos cosas ─────────
ok('ya NO existe el bloque único "Averiadas / Paradas"', !html.includes('Averiadas / Paradas'));
ok('existe el bloque 🔴 Averiadas', !!bloque('🔴 Averiadas'));
ok('existe el bloque 🟡 Paradas', !!bloque('🟡 Paradas'));

// ── 2) QUIÉN CAE EN CADA BLOQUE (regla: material != 'MÁQUINA PARADA' = avería) ─
eq('averiadas = 3 (avería real, avería+marcador, y la mixta día/noche)', cuenta('🔴 Averiadas'), 3);
eq('paradas = 1 (solo el marcador MÁQUINA PARADA)', cuenta('🟡 Paradas'), 1);
ok('avería real → en Averiadas', enBloque('🔴 Averiadas', 'EXCA AVERIADA'));
ok('avería real → NO en Paradas', !enBloque('🟡 Paradas', 'EXCA AVERIADA'));
ok('solo marcador → en Paradas', enBloque('🟡 Paradas', 'PALA PARADA'));
ok('solo marcador → NO en Averiadas', !enBloque('🔴 Averiadas', 'PALA PARADA'));

// ── 3) LOS DOS RENGLONES JUNTOS (como los guarda el teléfono): manda la avería ─
ok('avería + marcador → en Averiadas', enBloque('🔴 Averiadas', 'JUMBO AVERIA Y PARADA'));
ok('avería + marcador → NO en Paradas', !enBloque('🟡 Paradas', 'JUMBO AVERIA Y PARADA'));
eq('avería + marcador aparece UNA sola vez en todo el reporte',
  (html.match(/<b>JUMBO AVERIA Y PARADA<\/b>/g) || []).length, 1);

// ── 4) NINGUNA MÁQUINA EN DOS BLOQUES A LA VEZ ──────────────────────────────
MACHS.forEach((m) => {
  const veces = bloques.filter((b) => b.cuerpo.includes(`<b>${m.code}</b>`)).length;
  eq(`${m.code} sale en 1 solo bloque`, veces, 1);
});

// ── 5) DÍA vs NOCHE: se entiende en cuál turno se averió y en cuál se paró ───
const mixta = turnosDe('MIXTA DIA NOCHE');
ok('mixta · el turno DÍA se identifica como AVERÍA', /🔴 AVER[IÍ]A/.test(mixta.dia));
ok('mixta · el turno DÍA NO dice PARADA', !/PARADA/.test(mixta.dia));
ok('mixta · el turno NOCHE se identifica como PARADA', /🟡 PARADA/.test(mixta.noche));
ok('mixta · el turno NOCHE NO dice AVERÍA', !/AVER[IÍ]A/.test(mixta.noche));
ok('mixta · el turno DÍA conserva su motivo', /HIDR[AÁ]ULICA/.test(mixta.dia));
// La averiada "simple" solo tiene rótulo en el turno donde se marcó (día); la noche, "—".
const soloDia = turnosDe('EXCA AVERIADA');
ok('avería de día · rótulo AVERÍA en la columna DÍA', /🔴 AVER[IÍ]A/.test(soloDia.dia));
ok('avería de día · la columna NOCHE no inventa nada', !/AVER[IÍ]A|PARADA/.test(soloDia.noche));
// Trabajó y LUEGO se paró: la celda muestra las horas + "🟡 PARADA <hora>" (no AVERÍA).
const trabajoYParo = turnosDe('PAYLOADER TRABAJO Y PARO');
ok('trabajó-y-paró · la columna DÍA dice PARADA', /🟡 PARADA/.test(trabajoYParo.dia));
ok('trabajó-y-paró · la columna DÍA NO dice AVERÍA', !/AVER[IÍ]A/.test(trabajoYParo.dia));
ok('trabajó-y-paró · conserva sus 8 h trabajadas', /8 h/.test(trabajoYParo.dia));
ok('trabajó-y-paró · sigue contando como ACTIVA', enBloque('✅ Activas', 'PAYLOADER TRABAJO Y PARO'));

// ── 6) LOS OTROS RENGLONES SIGUEN SALIENDO ──────────────────────────────────
eq('esperando instrucciones = 1', cuenta('⏳ Esperando instrucciones'), 1);
ok('la de en_espera está en Esperando instrucciones', enBloque('⏳ Esperando instrucciones', 'GRUA EN ESPERA'));
eq('pendientes por iniciar = 1', cuenta('⏳ Pendientes por iniciar'), 1);
ok('la sin actividad está en Pendientes', enBloque('⏳ Pendientes por iniciar', 'VOLQUETA PENDIENTE'));
eq('activas = 2 (la que trabajó 12 h + la que trabajó y luego paró)', cuenta('✅ Activas'), 2);

// ── 7) CUADRE: la suma de los bloques = el total de máquinas de la empresa ───
const totalEmpresa = (() => { const m = html.match(/· (\d+) máquina\(s\)/); return m ? Number(m[1]) : null; })();
const sumaBloques = bloques.reduce((s, b) => { const m = b.titulo.match(/· (\d+)$/); return s + (m ? Number(m[1]) : 0); }, 0);
eq('el encabezado de la empresa lista las 8 máquinas', totalEmpresa, MACHS.length);
eq('la suma de los bloques cuadra con el total de la empresa', sumaBloques, totalEmpresa);

console.log(`\n  Activas: ${cuenta('✅ Activas')} · Averiadas: ${cuenta('🔴 Averiadas')} · Paradas: ${cuenta('🟡 Paradas')}`
  + ` · Esperando: ${cuenta('⏳ Esperando instrucciones')} · Pendientes: ${cuenta('⏳ Pendientes por iniciar')}`);
if (fail) {
  console.log(`\n✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`\n${pass} OK · 0 FALLO(S)\nReporte por empresa: 🔴 Averiadas y 🟡 Paradas en bloques separados, con el turno identificado.`);
