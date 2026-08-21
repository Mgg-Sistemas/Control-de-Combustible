/*
 * Test de los ESTADOS de las máquinas que NO trabajaron en el INFORME POR JORNADA
 * (🔴 averiadas · 🟡 paradas · ⏳ esperando instrucciones), 19-ago-2026.
 *
 * QUÉ PEDIDO CUBRE (textual del cliente):
 *   «primero sabes que existen las averiadas y paradas, pero en esos reportes las
 *    engloba en color rojo ambas, pues no lo quiero así, hazme la separación como
 *    corresponde, si es avería o parada, y además que salgan, y que salga también el
 *    esperando instrucciones, que se divida en renglones así como el de por empresa,
 *    además de que se entienda o haya una buena separación o identificación si la
 *    máquina se paró o se averió para el día y para la noche»
 *
 * El informe metía TODO en una sola fila-título roja "🔴 PARADAS/AVERIADAS (N)" y no
 * tenía bloque de "esperando instrucciones". Ahora son tres renglones separados y cada
 * fila dice, POR TURNO (día 7am–7pm · noche), si fue AVERÍA o PARADA y por qué.
 *
 * LO QUE BLINDA (`src/lib/jornadaEstados.ts` → `clasificarNoTrabajaron`):
 *   · Avería REAL (material != 'MÁQUINA PARADA') → Averiadas, nunca Paradas.
 *   · Solo el marcador 'MÁQUINA PARADA' → Paradas, nunca Averiadas.
 *   · Los DOS renglones a la vez (así los guarda el teléfono) → Averiadas y UNA sola vez.
 *   · en_espera = true → bloque de espera, y NO si ya está averiada/parada.
 *   · Ninguna máquina sale en dos bloques.
 *   · Averiada de día + parada de noche → se distingue por turno.
 *   · N_averiadas + N_paradas = el total del bloque único que salía antes.
 *   · No revienta con basura (null, sin material, sin fecha, sin ficha).
 *
 * No usa framework de test (el repo no tiene): transpila los .ts en memoria con el
 * `typescript` ya instalado y stubbea la única dependencia externa de la cadena
 * (`inspectorSiempreActivo`, que arrastra el cliente de Supabase).
 *
 *   npm run test:jornada-estados   (o: node scripts/test-jornada-estados.mjs)
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

// Carga un .ts transpilado, resolviendo también sus imports relativos .ts
// (jornadaEstados importa `paradaShiftOf` de inspectorDaySets — a propósito: NO se
// copia esa función, ya hubo un bug por tener tres copias con umbrales distintos).
const cache = new Map();
const loadTs = (srcPath) => {
  if (cache.has(srcPath)) return cache.get(srcPath);
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  cache.set(srcPath, m.exports);
  const origRequire = m.require.bind(m);
  m.require = (id) => {
    if (id === './machineInspectors') {
      return { inspectorSiempreActivo: (n) => (n || '').trim().toLowerCase() === 'inspector sos la guaira' };
    }
    if (id.startsWith('.')) return loadTs(path.join(path.dirname(srcPath), `${id}.ts`));
    return origRequire(id);
  };
  m._compile(out, m.filename);
  cache.set(srcPath, m.exports);
  return m.exports;
};

const { clasificarNoTrabajaron, MARCADOR_PARADA } = loadTs(path.join(ROOT, 'src/lib/jornadaEstados.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── Datos de prueba ────────────────────────────────────────────────────────
const DIA = '2026-08-19';
// Hora de Caracas (UTC-4) → ISO. Día = 7am–7pm; el resto es noche.
const hora = (h, min = 0) => new Date(`${DIA}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00-04:00`).toISOString();
const ficha = (code, co = 'CONSTRUCTORA X') => ({
  code, tipo: 'CAT 320', clasificacion: 'EXCAVADORA', serial: `S-${code}`, plate: `P-${code}`,
  company: { name: co },
});
const ticket = (id, material, o = {}) => ({
  machinery_id: id,
  material,
  notes: o.notes ?? null,
  created_at: o.at ?? hora(10),
  machinery: o.machinery === undefined ? ficha(o.code ?? id) : o.machinery,
});
const averia = (id, o = {}) => ticket(id, o.material ?? 'BOMBA HIDRÁULICA', o);
const parada = (id, o = {}) => ticket(id, MARCADOR_PARADA, o);
const maquina = (id, o = {}) => ({
  id, code: o.code ?? id, tipo: 'CAT 320', clasificacion: 'EXCAVADORA',
  serial: `S-${id}`, plate: `P-${id}`, en_espera: o.en_espera === undefined ? true : o.en_espera,
  company: { name: o.co ?? 'CONSTRUCTORA X' },
});
const ids = (arr) => arr.map((x) => x.machineryId).sort();

// El marcador tiene que ser EXACTAMENTE el del teléfono (si cambia, todo se rompe).
eq('marcador de parada', MARCADOR_PARADA, 'MÁQUINA PARADA');

// ── 1) AVERÍA REAL → Averiadas, NO Paradas ─────────────────────────────────
{
  const r = clasificarNoTrabajaron({ tickets: [averia('M1', { notes: 'Botó el aceite' })] });
  eq('avería real → averiadas', ids(r.averiadas), ['M1']);
  eq('avería real → paradas vacío', r.paradas.length, 0);
  eq('avería real → espera vacío', r.espera.length, 0);
  eq('motivo = la nota del mecánico', r.averiadas[0].motivo, 'Botó el aceite');
  eq('estado marcado como avería', r.averiadas[0].estado, 'averia');
}
// Avería sin nota: el motivo es el material (el repuesto/falla reportada).
{
  const r = clasificarNoTrabajaron({ tickets: [averia('M1', { material: 'CAUCHO DELANTERO' })] });
  eq('avería sin nota usa el material', r.averiadas[0].motivo, 'CAUCHO DELANTERO');
}

// ── 2) SOLO el marcador MÁQUINA PARADA → Paradas, NO Averiadas ─────────────
{
  const r = clasificarNoTrabajaron({ tickets: [parada('M2', { notes: 'Sin operador' })] });
  eq('marcador → paradas', ids(r.paradas), ['M2']);
  eq('marcador → averiadas vacío', r.averiadas.length, 0);
  eq('motivo de la parada', r.paradas[0].motivo, 'Sin operador');
  eq('estado marcado como parada', r.paradas[0].estado, 'parada');
}
// Parada sin nota: motivo genérico "Parada" (no puede salir vacío en el PDF).
{
  const r = clasificarNoTrabajaron({ tickets: [parada('M2')] });
  eq('parada sin nota → "Parada"', r.paradas[0].motivo, 'Parada');
}

// ── 3) LOS DOS RENGLONES A LA VEZ (así los guarda el teléfono) ─────────────
// El teléfono deja el marcador "MÁQUINA PARADA" Y el ticket de la avería. Manda la
// avería, y la máquina sale UNA sola vez.
{
  const r = clasificarNoTrabajaron({
    tickets: [parada('M3', { at: hora(9), notes: 'Parada' }), averia('M3', { at: hora(9, 30), notes: 'Motor' })],
  });
  eq('parada + avería → averiadas', ids(r.averiadas), ['M3']);
  eq('parada + avería → NO en paradas', r.paradas.length, 0);
  eq('parada + avería → una sola vez', r.averiadas.length, 1);
  eq('gana el motivo de la avería', r.averiadas[0].motivo, 'Motor');
}
// La avería manda aunque la parada sea MÁS RECIENTE (orden de llegada indistinto).
{
  const r = clasificarNoTrabajaron({
    tickets: [averia('M3', { at: hora(8), notes: 'Motor' }), parada('M3', { at: hora(17), notes: 'Parada' })],
  });
  eq('avería vieja gana a parada nueva', ids(r.averiadas), ['M3']);
  eq('avería vieja gana a parada nueva (paradas vacío)', r.paradas.length, 0);
}
// Dos averías: gana la MÁS RECIENTE (el motivo vigente).
{
  const r = clasificarNoTrabajaron({
    tickets: [averia('M4', { at: hora(8), notes: 'Vieja' }), averia('M4', { at: hora(16), notes: 'Nueva' })],
  });
  eq('entre dos averías gana la reciente', r.averiadas[0].motivo, 'Nueva');
  eq('dos averías → una sola fila', r.averiadas.length, 1);
}

// ── 4) ESPERANDO INSTRUCCIONES (en_espera = true) ──────────────────────────
{
  const r = clasificarNoTrabajaron({ tickets: [], espera: [maquina('M5')] });
  eq('en_espera → bloque de espera', ids(r.espera), ['M5']);
  eq('en_espera → no es avería', r.averiadas.length, 0);
  eq('en_espera → no es parada', r.paradas.length, 0);
  eq('motivo de la espera', r.espera[0].motivo, 'Esperando instrucciones');
}
{
  const r = clasificarNoTrabajaron({ tickets: [], espera: [maquina('M6', { en_espera: false }), maquina('M7', { en_espera: null })] });
  eq('en_espera falso/nulo no entra', r.espera.length, 0);
}
// Máquina en espera que ADEMÁS tiene avería pendiente: manda la avería (misma
// prioridad que el reporte por empresa: activa > avería > espera > pendiente).
{
  const r = clasificarNoTrabajaron({ tickets: [averia('M8', { notes: 'Cardán' })], espera: [maquina('M8')] });
  eq('averiada + en espera → averiadas', ids(r.averiadas), ['M8']);
  eq('averiada + en espera → NO en espera', r.espera.length, 0);
}
{
  const r = clasificarNoTrabajaron({ tickets: [parada('M9')], espera: [maquina('M9')] });
  eq('parada + en espera → paradas', ids(r.paradas), ['M9']);
  eq('parada + en espera → NO en espera', r.espera.length, 0);
}
// Fila repetida del catálogo: no puede duplicar el renglón.
{
  const r = clasificarNoTrabajaron({ tickets: [], espera: [maquina('M5'), maquina('M5')] });
  eq('espera repetida no duplica', r.espera.length, 1);
}

// ── 5) NINGUNA MÁQUINA EN DOS BLOQUES + el cuadre del total viejo ──────────
{
  const tickets = [
    averia('A1', { at: hora(8), notes: 'Motor' }),
    parada('A1', { at: hora(9) }),                     // misma máquina, los dos renglones
    parada('A2', { at: hora(10), notes: 'Sin gasoil' }),
    averia('A3', { at: hora(20), notes: 'Tren de rodaje' }),
    parada('A4', { at: hora(21) }),
    averia('A2', { at: hora(23), notes: 'Alternador' }), // A2 pasa a averiada
  ];
  const espera = [maquina('E1'), maquina('E2'), maquina('A4')]; // A4 ya está parada
  const r = clasificarNoTrabajaron({ tickets, espera });
  const todas = [...r.averiadas, ...r.paradas, ...r.espera].map((x) => x.machineryId);
  eq('sin repetidas entre los tres bloques', todas.length, new Set(todas).size);
  eq('averiadas', ids(r.averiadas), ['A1', 'A2', 'A3']);
  eq('paradas', ids(r.paradas), ['A4']);
  eq('espera (A4 ya está parada, no se repite)', ids(r.espera), ['E1', 'E2']);
  // El bloque único de antes contaba las máquinas CON ticket pendiente: 4.
  const totalViejo = new Set(tickets.map((t) => t.machinery_id)).size;
  eq('N_averiadas + N_paradas = total viejo', r.averiadas.length + r.paradas.length, totalViejo);
}

// ── 6) DÍA vs NOCHE: se distingue por turno ────────────────────────────────
// Averiada en el turno de DÍA (10am) y parada en el de NOCHE (9pm).
{
  const r = clasificarNoTrabajaron({
    tickets: [averia('T1', { at: hora(10), notes: 'Manguera' }), parada('T1', { at: hora(21), notes: 'Sin operador' })],
  });
  const m = r.averiadas[0];
  eq('turno día = avería', m.dia, { estado: 'averia', motivo: 'Manguera' });
  eq('turno noche = parada', m.noche, { estado: 'parada', motivo: 'Sin operador' });
  eq('resumen por turno', m.turnoResumen, '☀️ Día: 🔴 AVERÍA · Manguera · 🌙 Noche: 🟡 PARADA · Sin operador');
  eq('sin marca sin turno', m.sinTurno, null);
}
// Solo de noche: el turno de día queda limpio (en el PDF sale "—").
{
  const r = clasificarNoTrabajaron({ tickets: [parada('T2', { at: hora(19), notes: 'Lluvia' })] });
  eq('19:00 ya es NOCHE', r.paradas[0].noche, { estado: 'parada', motivo: 'Lluvia' });
  eq('19:00 no toca el día', r.paradas[0].dia, null);
}
// Frontera del turno de día: 7:00am entra en DÍA, 6:59am es NOCHE.
{
  const r = clasificarNoTrabajaron({ tickets: [parada('T3', { at: hora(7) }), parada('T4', { at: hora(6, 59) })] });
  const porId = Object.fromEntries(r.paradas.map((x) => [x.machineryId, x]));
  ok('7:00am es turno DÍA', porId.T3.dia && !porId.T3.noche);
  ok('6:59am es turno NOCHE', porId.T4.noche && !porId.T4.dia);
}
// Los DOS turnos averiados: el resumen los nombra a los dos.
{
  const r = clasificarNoTrabajaron({
    tickets: [averia('T5', { at: hora(11), notes: 'Frenos' }), averia('T5', { at: hora(22), notes: 'Luces' })],
  });
  eq('avería de día y de noche', r.averiadas[0].turnoResumen, '☀️ Día: 🔴 AVERÍA · Frenos · 🌙 Noche: 🔴 AVERÍA · Luces');
}
// Dentro de UN turno la avería manda sobre la parada (misma escalera de prioridad).
{
  const r = clasificarNoTrabajaron({
    tickets: [parada('T6', { at: hora(13) }), averia('T6', { at: hora(9), notes: 'Turbo' })],
  });
  eq('en el mismo turno manda la avería', r.averiadas[0].dia, { estado: 'averia', motivo: 'Turbo' });
}
// En espera: no tiene turno (está esperando todo el día).
{
  const r = clasificarNoTrabajaron({ tickets: [], espera: [maquina('E9')] });
  eq('espera sin marcas de turno', [r.espera[0].dia, r.espera[0].noche], [null, null]);
  eq('resumen de la espera', r.espera[0].turnoResumen, '⏳ Esperando instrucciones (día y noche)');
}

// ── 7) EXCLUIDAS: ya trabajaron / inspector SIEMPRE ACTIVO ────────────────
{
  const r = clasificarNoTrabajaron({
    tickets: [averia('W1'), parada('W2')],
    espera: [maquina('W3')],
    excluir: (id) => id === 'W1' || id === 'W3',
  });
  eq('excluida no sale como averiada', r.averiadas.length, 0);
  eq('excluida no sale en espera', r.espera.length, 0);
  eq('la que no se excluye sí sale', ids(r.paradas), ['W2']);
}

// ── 8) BASURA: no puede reventar ──────────────────────────────────────────
{
  const r = clasificarNoTrabajaron({
    tickets: [
      null,
      undefined,
      {},                                              // sin nada
      { machinery_id: 'B1' },                          // sin ficha → fuera
      { machinery_id: null, material: 'X', machinery: ficha('B2') }, // sin id → fuera
      { machinery_id: 'B3', material: null, notes: null, created_at: null, machinery: ficha('B3') },
      { machinery_id: 'B4', material: MARCADOR_PARADA, created_at: 'no-es-fecha', machinery: ficha('B4') },
    ],
    espera: [null, {}, { id: 'B5', en_espera: true }],
  });
  eq('basura: solo B3 y B4 clasifican', [ids(r.averiadas), ids(r.paradas)], [['B3'], ['B4']]);
  eq('sin material → avería genérica', r.averiadas[0].motivo, 'Avería');
  eq('sin fecha válida → no se ubica en un turno', [r.averiadas[0].dia, r.averiadas[0].noche], [null, null]);
  eq('sin fecha válida → queda como "sin turno"', r.averiadas[0].sinTurno, { estado: 'averia', motivo: 'Avería' });
  eq('fecha basura → tampoco ubica turno', r.paradas[0].sinTurno, { estado: 'parada', motivo: 'Parada' });
  eq('espera sin ficha → empresa y datos por defecto', [r.espera[0].company, r.espera[0].machine, r.espera[0].clasificacion], ['Sin empresa', '—', 'Sin clasificación']);
}
// Sin parámetros: no revienta y devuelve los tres bloques vacíos.
{
  const r = clasificarNoTrabajaron({});
  eq('sin datos → tres bloques vacíos', [r.averiadas.length, r.paradas.length, r.espera.length], [0, 0, 0]);
  const r2 = clasificarNoTrabajaron({ tickets: null, espera: null });
  eq('nulos → tres bloques vacíos', [r2.averiadas.length, r2.paradas.length, r2.espera.length], [0, 0, 0]);
}

// ── 9) EMPRESA y ficha de catálogo (lo que se imprime en el renglón) ──────
{
  const r = clasificarNoTrabajaron({ tickets: [averia('C1', { machinery: ficha('EXCAVADORA 12', 'GOLDEN TOUCH') })] });
  const m = r.averiadas[0];
  eq('empresa del renglón', m.company, 'GOLDEN TOUCH');
  eq('nombre de la máquina', m.machine, 'EXCAVADORA 12');
  eq('serial y placa', [m.serial, m.plate], ['S-EXCAVADORA 12', 'P-EXCAVADORA 12']);
}

// ── Resultado ─────────────────────────────────────────────────────────────
console.log(`\n🛠️  Estados del informe por jornada (averiadas · paradas · esperando instrucciones)`);
console.log(`   ${pass} OK · ${fail} fallo(s)`);
if (fail) {
  console.log(`\n${failures.join('\n')}\n`);
  process.exit(1);
}
console.log('   ✅ Todo en verde\n');
