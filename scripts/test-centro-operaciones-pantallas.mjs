// 🏭 CENTRO DE OPERACIONES — PRUEBAS DE LAS PANTALLAS Y LOS FLUJOS (revisión final, ola F2b, 25-oct-2026).
//
// Lo que la revisión final (review-final-B / -A) encontró en la pantalla del módulo, el
// 📅 Parte diario, 🚛 Flota y ⚙️ Ajustes, y su arreglo:
//   · B-I1  salir del 📅 Parte diario (otra pestaña u otro sitio) con algo «✏️ sin guardar»
//           PREGUNTA («Descartar» / «Seguir aquí»); no se deja montado y escondido.
//   · B-M7  «sin guardar» cubre también los patios, la nota de la maquinaria y las toneladas
//           escritas en «Pendientes de pesaje».
//   · B-I2  si no se pudieron cargar los sitios: solo el error con «🔄 Reintentar» (nunca
//           «Crea el primer sitio» ni «Todavía no hay sitios»).
//   · B-I4  la jornada del Parte diario pasa sola al nuevo día si ella estaba «en hoy»
//           (una fecha elegida a propósito se respeta; con algo sin guardar, no se muda).
//   · B-M1  🧱 Bloques no muestra los renglones de otro día bajo el título del nuevo.
//   · A#6   el inventario de bloques ya no baja TODA la historia del sitio.
//   · B-M4  🚛 Flota y ⚙️ Ajustes: «🔄 Reintentar» junto al error de carga.
//   · B-M5  los avisos que mandan a ⚙️ Ajustes o a 🚛 Flota dicen «Pídeselo a quien
//           administra el módulo» a quien no tiene Full.
//   · B-M2  (la parte de las salidas del Parte diario) tocar ✏️ en una salida con algo escrito
//           sin guardar pregunta antes de tirarlo.
//
// (1) Lo puro (src/components/centroOperaciones/pantallaParteDiario.ts y
//     src/lib/centroOperacionesMaquinariaBloques.ts) con resultados exactos.
// (2) Candados ESTÁTICOS sobre el texto de las pantallas (sin comentarios).
//
// ⭐ Todos los datos son SINTÉTICOS (el repositorio es público).
//
//   node scripts/test-centro-operaciones-pantallas.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

// El mismo cargador de las demás pruebas del módulo: transpila el .ts a CommonJS y
// resuelve los imports relativos a otros .ts.
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
    if (id.startsWith('.')) {
      const p = path.resolve(path.dirname(abs), id);
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  let v;
  try { v = typeof got === 'function' ? got() : got; } catch (e) { v = `reventó: ${e.message}`; }
  const g = JSON.stringify(v), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond, detalle = '') => {
  let v;
  try { v = !!(typeof cond === 'function' ? cond() : cond); } catch (e) { v = false; detalle = `reventó: ${e.message}`; }
  if (v) pass++; else { fail++; failures.push(`✗ ${name}${detalle ? `\n    ${detalle}` : ''}`); }
};

const DIR = 'src/components/centroOperaciones';
const existe = (r) => fs.existsSync(path.join(ROOT, r));
const leer = (r) => (existe(r) ? fs.readFileSync(path.join(ROOT, r), 'utf8') : '');

/** El código sin comentarios (respeta las cadenas): los candados no se engañan con un comentario. */
function sinComentarios(src) {
  let out = '';
  let i = 0;
  let cadena = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (cadena) {
      out += c;
      if (c === '\\') { out += d ?? ''; i += 2; continue; }
      if (c === cadena) cadena = null;
      i++;
      continue;
    }
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') cadena = c;
    out += c;
    i++;
  }
  return out;
}
/** El cuerpo de `const nombre = …` (dos espacios de sangría) hasta la próxima constante del mismo nivel. */
function cuerpoDe(src, nombre) {
  const i = src.search(new RegExp(`\\n  const ${nombre} = `));
  if (i < 0) return '';
  const j = src.slice(i + 1).search(/\n  const \w+ = |\n  \/\/ ── |\n  return \(/);
  return j < 0 ? src.slice(i) : src.slice(i, i + 1 + j);
}
function importadosDe(code, desde) {
  const re = new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${desde.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"]`, 'g');
  const nombres = [];
  let m;
  while ((m = re.exec(code))) {
    for (const p of m[1].split(',')) {
      const n = p.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (n) nombres.push(n);
    }
  }
  return nombres;
}

console.log('🏭 CENTRO DE OPERACIONES · PANTALLAS Y FLUJOS (revisión final F2b)\n');

// ═══════════════════════════ (1) LO PURO ═══════════════════════════

const RUTA_PURA = `${DIR}/pantallaParteDiario.ts`;
let P = {};
try { P = loadTs(path.join(ROOT, RUTA_PURA)); } catch (e) { fail++; failures.push(`✗ no se pudo cargar ${RUTA_PURA}: ${e.message}`); }
let MB = {};
try { MB = loadTs(path.join(ROOT, 'src/lib/centroOperacionesMaquinariaBloques.ts')); } catch (e) { fail++; failures.push(`✗ no se pudo cargar la librería de maquinaria y bloques: ${e.message}`); }
const llamar = (L, fn, ...args) => {
  if (typeof L[fn] !== 'function') return `«${fn}» no existe`;
  try { return L[fn](...args); } catch (e) { return `«${fn}» lanzó: ${e.message}`; }
};
const p = (fn, ...a) => llamar(P, fn, ...a);

// ——— 1.1 B-I1 / B-M7: qué bloques quedaron con algo sin guardar, en el orden de la hoja ———
{
  eq('⭐ 1.1 B-I1 los bloques sin guardar salen en el ORDEN DE LA HOJA (no en el que se marcaron)',
    p('bloquesSinGuardar', { bloques: true, agregados: true, reporte: true, maquinaria: false }), ['reporte', 'agregados', 'bloques']);
  eq('1.1 * sin nada: ninguno', p('bloquesSinGuardar', {}), []);
  eq('1.1 * null no revienta', p('bloquesSinGuardar', null), []);
  eq('⭐ 1.1 B-M7 los siete, también los patios y la maquinaria',
    p('bloquesSinGuardar', { maquinaria: true, patios: true, aluminio: true, acero: true, agregados: true, reporte: true, bloques: true }),
    ['reporte', 'patios', 'agregados', 'acero', 'aluminio', 'maquinaria', 'bloques']);
  eq('1.1 * los nombres son los títulos de los bloques del Parte diario', P.ETIQUETAS_SIN_GUARDAR, {
    reporte: '1 · 📊 Reporte General', patios: '2 · 🚪 Entrada por patio', agregados: '3 · 🚚 Salidas de agregados',
    acero: '4 · 🔩 Acero', aluminio: '5 · ♻️ Aluminio y plástico', maquinaria: '6 · 🚜 Maquinaria', bloques: '7 · 🧱 Bloques',
  });
  const t = p('textoSalirSinGuardar', ['reporte', 'agregados']);
  ok('⭐ 1.1 B-I1 la pregunta nombra los bloques con algo sin guardar', typeof t === 'string' && t.includes('1 · 📊 Reporte General') && t.includes('3 · 🚚 Salidas de agregados'), t);
  ok('⭐ 1.1 * y dice que si sale, se pierde', typeof t === 'string' && /se pierde/.test(t) && /📅 Parte diario/.test(t), t);
  ok('1.1 * y pregunta si lo descarta', typeof t === 'string' && /¿Descartarlo\?/.test(t), t);
}

// ——— 1.2 B-I4: la jornada al volver (o al pasar el tiempo) ———
{
  const J = (o) => p('jornadaAlVolver', { fecha: '2026-10-24', enHoy: true, hoy: '2026-10-25', sinGuardar: false, ...o });
  const pasa = J();
  eq('⭐ 1.2 B-I4 estaba «en hoy» y cambió el día: pasa SOLA al nuevo hoy', [pasa.accion, pasa.fecha], ['pasar', '2026-10-25']);
  ok('1.2 * y lo dice (con la fecha nueva)', typeof pasa.aviso === 'string' && pasa.aviso.includes('25/10/2026') && /📅 Parte diario/.test(pasa.aviso), pasa.aviso);
  eq('⭐ 1.2 * una fecha elegida a propósito (no «en hoy») se respeta', J({ enHoy: false }), { accion: 'nada' });
  eq('1.2 * el mismo día: nada', J({ fecha: '2026-10-25' }), { accion: 'nada' });
  const queda = J({ sinGuardar: true });
  eq('⭐ 1.2 * con algo sin guardar NO se muda (se anotaría en otro día): se queda en la suya', queda.accion, 'quedarse');
  ok('1.2 * y lo dice: la jornada nueva, en la que sigue y «↩ Volver a hoy»',
    typeof queda.aviso === 'string' && queda.aviso.includes('25/10/2026') && queda.aviso.includes('24/10/2026') && queda.aviso.includes('↩ Volver a hoy'), queda.aviso);
  const futura = J({ fecha: '2026-10-26', enHoy: false, sinGuardar: true });
  eq('⭐ 1.2 * una jornada FUTURA (el reloj del equipo se atrasó) nunca se queda: pasa a hoy (B7)', [futura.accion, futura.fecha], ['pasar', '2026-10-25']);
  eq('1.2 * un «hoy» que no es fecha: nada', J({ hoy: 'basura' }), { accion: 'nada' });
}

// ——— 1.3 B-M5: a quien no tiene Full se le dice que lo pida ———
{
  eq('⭐ 1.3 B-M5 Full no necesita pedirlo', p('pideloAQuienAdministra', 'full'), '');
  eq('1.3 * Escritura y Lectura: «Pídeselo a quien administra el módulo.»', [p('pideloAQuienAdministra', 'escritura'), p('pideloAQuienAdministra', 'lectura')],
    [' Pídeselo a quien administra el módulo.', ' Pídeselo a quien administra el módulo.']);
}

// ——— 1.4 B-M7: los patios escritos en OTRA jornada (no se ven, pero se perderían al salir) ———
{
  eq('⭐ 1.4 B-M7 las otras jornadas con patios escritos, en orden', p('jornadasConPatiosEscritos', {
    '2026-10-24': { pa: '3' }, '2026-10-23': {}, '2026-10-22': { pb: '' }, '2026-10-20': { pa: '7', pb: '1' },
  }, '2026-10-24'), ['2026-10-20', '2026-10-22']);
  eq('1.4 * nada escrito: ninguna', p('jornadasConPatiosEscritos', {}, '2026-10-24'), []);
  eq('1.4 * null no revienta', p('jornadasConPatiosEscritos', null, '2026-10-24'), []);
}

// ——— 1.5 B-M7: la nota (o el estado) de una máquina sin guardar ———
{
  const u = (o) => ({ id: 'U-1', sitioId: 'S1', origen: 'propia', machineryId: null, codigo: 'C-01', descripcion: null, placa: null, serial: null,
    marca: null, modelo: null, dueno: null, capacidadM3: null, activo: true, nota: null, estado: 'disponible', estadoNota: null, estadoAt: null, chofer: null, ...o });
  const us = [u({}), u({ id: 'U-2', codigo: 'C-02', estado: 'averiada', estadoNota: 'Sin frenos' })];
  const sg = (ed) => llamar(MB, 'edicionSinGuardar', ed, us);
  eq('1.5 sin editor abierto: nada', sg(null), false);
  eq('⭐ 1.5 B-M7 abrir «Agregar nota» sin escribir no es «sin guardar»', sg({ id: 'U-1', estado: 'disponible', nota: '  ' }), false);
  eq('1.5 * la nota guardada, tal cual: tampoco', sg({ id: 'U-2', estado: 'averiada', nota: 'Sin frenos ' }), false);
  eq('⭐ 1.5 * una nota escrita sí', sg({ id: 'U-1', estado: 'disponible', nota: 'Revisar luces' }), true);
  eq('⭐ 1.5 * otro estado elegido (aunque sin nota) sí', sg({ id: 'U-2', estado: 'disponible', nota: '' }), true);
  eq('1.5 * una unidad que ya no está: no hay nada que guardar', sg({ id: 'U-9', estado: 'averiada', nota: 'x' }), false);
}
// ——— 1.7 M4 · 🚜 lo que pinta la maquinaria (mesa de maquinaria §4.1), de lo que decide estadoDelSitio ———
{
  // 25/10/2026 10:00 a. m. en Caracas (14:00 UTC).
  const AHORA = Date.parse('2026-10-25T14:00:00Z');
  const u = (o) => ({ id: 'U-' + (o.codigo ?? 'X'), sitioId: 'S1', origen: 'propia', machineryId: null, codigo: 'X', descripcion: null, placa: null, serial: null,
    marca: null, modelo: null, dueno: null, capacidadM3: null, activo: true, nota: null, estado: 'disponible', estadoNota: null, estadoAt: null, chofer: null, ...o });
  const vin = (o) => u({ origen: 'catalogo', machineryId: 'M-' + (o.codigo ?? 'X'), estado: null, ...o });
  const INFO = { operativa: ['Operativa', '✅'], averiada: ['Averiada', '🔴'], parada: ['Parada', '🟡'], espera: ['Esperando instrucciones', '⏳'], retirada: ['Retirada', '⬛'], transferida: ['Transferida a otros', '🔁'] };
  const dice = (estado, o = {}) => ({ encontrada: true, estado, etiqueta: INFO[estado][0], icono: INFO[estado][1], motivo: null, desdeMs: null, enVivo: null, novedad: null, reactivadaMs: null, ...o });
  const leida = (porMaquina) => ({ leidaAt: '2026-10-25T13:00:00.000Z', porMaquina });
  const fila = (un, insp) => ({ unidad: un, estado: llamar(MB, 'estadoDelSitio', un, insp, AHORA) });
  const L = (un, insp, lectura = 'ok') => p('lineasDeFila', fila(un, insp), AHORA, lectura);

  // Qué se le pregunta a inspección: la ÚNICA definición vive en la librería pura (lote 6 A5/B15), no acá.
  eq('⭐ 1.7 M4 se preguntan SOLO las vinculadas activas, con su marca y su hora (sin vinculadas: nada) — desde la librería pura',
    llamar(MB, 'vinculadasParaInspeccion', [u({ codigo: 'P' }), vin({ codigo: 'A' }), vin({ codigo: 'B', estado: 'averiada', estadoAt: '2026-10-25T10:10:00Z' }), vin({ codigo: 'C', activo: false })]),
    [{ machineryId: 'M-A', estadoAt: null, conMarca: false }, { machineryId: 'M-B', estadoAt: '2026-10-25T10:10:00Z', conMarca: true }]);
  eq('1.7 * solo unidades del sitio: no se consulta nada', llamar(MB, 'vinculadasParaInspeccion', [u({ codigo: 'P' }), u({ codigo: 'Q', estado: 'averiada' })]), []);
  ok('⭐ 1.7 A5/B15: pantallaParteDiario ya no define vinculadasParaInspeccion (una sola copia, en la lib pura)', !('vinculadasParaInspeccion' in P));

  // Las líneas de cada fila.
  const propia = L(u({ codigo: 'PROP-1', estado: 'averiada', estadoAt: '2026-10-25T10:10:00Z', estadoNota: 'sin frenos' }), null, 'sin_vinculadas');
  eq('⭐ 1.7 una unidad del sitio: su marca con el «desde», «✍️ solo del sitio» y su nota',
    [propia.origen, propia.estado, propia.inspeccion, propia.nota], ['✍️ solo del sitio', '🔧 Averiada · desde el 25/10/2026, 06:10 a. m.', null, 'sin frenos']);
  const sinLeer = L(vin({ codigo: 'UNI-01' }), null, 'error');
  eq('⭐ 1.7 vinculada sin marca y SIN LEER: «❔ Sin dato», nunca Disponible ni Operativa', [sinLeer.origen, sinLeer.estado], ['📚 catálogo', '❔ Sin dato · no se pudo leer inspección']);
  ok('1.7 * (ninguna palabra de disponible u operativa en sus líneas)', !/Disponible|Operativa/.test(JSON.stringify(sinLeer)), JSON.stringify(sinLeer));
  eq('1.7 * mientras se lee: «🔎 Inspección: cargando…»', L(vin({ codigo: 'UNI-01' }), null, 'cargando').estado, '🔎 Inspección: cargando…');
  eq('⭐ 1.7 manda inspección (averiada): su rótulo, «según inspección», desde y motivo',
    L(vin({ codigo: 'UNI-07' }), leida({ 'M-UNI-07': dice('averiada', { motivo: 'falla hidráulica', desdeMs: Date.parse('2026-10-20T12:38:00Z') }) })).estado,
    '🔴 Averiada · según inspección, desde el 20/10 08:38 a. m. — falla hidráulica');
  eq('1.7 * operativa trabajando: «✅ Disponible · según inspección · 🟢 trabajando ahora» (sin horas)',
    L(vin({ codigo: 'UNI-11' }), leida({ 'M-UNI-11': dice('operativa', { enVivo: 'trabajando' }) })).estado, '✅ Disponible · según inspección · 🟢 trabajando ahora');
  eq('⭐ 1.7 * parada: cuenta como disponible y dice la parada con su motivo',
    L(vin({ codigo: 'UNI-02' }), leida({ 'M-UNI-02': dice('parada', { motivo: 'no hay volqueta', desdeMs: Date.parse('2026-10-25T11:10:00Z') }) })).estado,
    '✅ Disponible · según inspección · 🟡 parada desde hoy 07:10 a. m. — no hay volqueta');
  const marcada = L(vin({ codigo: 'UNI-03', estado: 'averiada', estadoAt: '2026-10-25T10:10:00Z', estadoNota: 'caucho espichado' }), leida({ 'M-UNI-03': dice('operativa') }));
  eq('⭐ 1.7 manda la marca del sitio: «la marcó el sitio hoy…», la línea 🔎 de inspección y la nota',
    [marcada.estado, marcada.inspeccion, marcada.nota], ['🔧 Averiada · la marcó el sitio hoy 06:10 a. m.', '🔎 Inspección: ✅ Operativa · sin jornada hoy', 'caucho espichado']);
  const marcadaSinLeer = L(vin({ codigo: 'UNI-03', estado: 'averiada', estadoAt: '2026-10-25T10:10:00Z' }), null, 'error');
  eq('1.7 * con la marca y sin leer: manda su marca, «sin verificar»', [marcadaSinLeer.estado, marcadaSinLeer.inspeccion],
    ['🔧 Averiada · la marcó el sitio hoy 06:10 a. m.', '🔎 Inspección: no se pudo leer · tu marca, sin verificar']);
  const pausa = L(vin({ codigo: 'UNI-09', estado: 'disponible', estadoAt: '2026-10-15T14:00:00Z', estadoNota: 'vieja' }), leida({ 'M-UNI-09': dice('espera') }));
  eq('⭐ 1.7 en espera con una marca vieja: manda la oficina, la marca en pausa, pastillas apagadas y sin su nota',
    [pausa.estado, pausa.aviso, pausa.porQueNo, pausa.nota],
    ['⏳ Esperando instrucciones — lo maneja la oficina (Control de Maquinaria)', '🏭 Tu marca ✅ del 15/10 está en pausa mientras la oficina la tenga así.', 'Lo maneja la oficina (Control de Maquinaria).', null]);
  const superada = L(vin({ codigo: 'UNI-11', estado: 'averiada', estadoAt: '2026-10-25T10:05:00Z', estadoNota: 'nota vieja' }),
    leida({ 'M-UNI-11': dice('operativa', { enVivo: 'trabajando', novedad: { ms: Date.parse('2026-10-25T11:25:00Z'), que: 'jornada', motivo: null } }) }));
  eq('⭐ 1.7 una marca que quedó atrás: manda inspección y dice por qué (sin la nota vieja)',
    [superada.estado, superada.aviso, superada.nota],
    ['✅ Disponible · según inspección · 🟢 trabajando ahora', '↪️ Tu marca 🔧 Averiada de hoy 06:05 a. m. quedó atrás: inspección registró una jornada a las 07:25 a. m.', null]);
  const fuera = L(vin({ codigo: 'UNI-05' }), leida({ 'M-UNI-05': { encontrada: false, estado: null, etiqueta: null, icono: null, motivo: null, desdeMs: null, enVivo: null, novedad: null, reactivadaMs: null } }));
  eq('1.7 ya no está en el catálogo (sin marca): «❔ Sin dato» y el aviso', [fuera.estado, fuera.inspeccion], ['❔ Sin dato', '⚠️ Ya no está en el catálogo del sistema.']);

  // El editor: nota o marca nueva (modoAlTocar), con su título y su aviso.
  const filaMarcada = fila(vin({ codigo: 'UNI-03', estado: 'averiada', estadoAt: '2026-10-25T10:10:00Z', estadoNota: 'caucho espichado' }), leida({ 'M-UNI-03': dice('operativa') }));
  const ed = (f, est, soloNota) => p('editorDeMarca', f, est, soloNota);
  eq('⭐ 1.7 editor: la misma pastilla con la marca vigente edita SOLO la nota (trae la guardada)',
    [ed(filaMarcada, 'averiada').modo, ed(filaMarcada, 'averiada').titulo, ed(filaMarcada, 'averiada').nota], ['nota', '📝 Nota de UNI-03', 'caucho espichado']);
  eq('1.7 * la otra pastilla es una marca nueva, con la nota en blanco', [ed(filaMarcada, 'disponible').modo, ed(filaMarcada, 'disponible').titulo, ed(filaMarcada, 'disponible').nota],
    ['marca', 'Marcar UNI-03 como ✅ Disponible', '']);
  const filaSuperada = fila(vin({ codigo: 'UNI-11', estado: 'averiada', estadoAt: '2026-10-25T10:05:00Z', estadoNota: 'nota vieja' }),
    leida({ 'M-UNI-11': dice('operativa', { novedad: { ms: Date.parse('2026-10-25T11:25:00Z'), que: 'jornada', motivo: null } }) }));
  eq('⭐ 1.7 * la misma pastilla con la marca que QUEDÓ ATRÁS es una marca nueva (lo dice) y trae la nota vieja de sugerencia; y como 🔧 no coincide con la ✅ de inspección, lo avisa (B11)',
    [ed(filaSuperada, 'averiada').modo, ed(filaSuperada, 'averiada').aviso, ed(filaSuperada, 'averiada').nota],
    ['marca', 'Tu marca anterior quedó atrás: esto la vuelve a poner desde ahora. Inspección la tiene ✅ Operativa: esto no le llega; avísales con 📲.', 'nota vieja']);
  eq('1.7 * una vinculada sin marca: marca nueva que vale hasta el próximo hecho de inspección (coincide: sin aviso de 📲)',
    [ed(fila(vin({ codigo: 'UNI-07' }), leida({ 'M-UNI-07': dice('averiada') })), 'averiada').modo, ed(fila(vin({ codigo: 'UNI-07' }), leida({ 'M-UNI-07': dice('averiada') })), 'averiada').aviso],
    ['marca', 'Vale desde ahora y hasta que inspección registre algo nuevo de esta máquina.']);
  eq('⭐ 1.7 B11: marcar ✅ una que inspección tiene 🔴 Averiada lo dice al decidir (la misma regla del ⚠️)',
    ed(fila(vin({ codigo: 'UNI-07' }), leida({ 'M-UNI-07': dice('averiada') })), 'disponible').aviso,
    'Vale desde ahora y hasta que inspección registre algo nuevo de esta máquina. Inspección la tiene 🔴 Averiada: esto no le llega; avísales con 📲.');
  eq('1.7 B11 * Parada cuenta como disponible: marcar ✅ sobre una 🟡 Parada coincide', [p('noCoincidiria', fila(vin({ codigo: 'X' }), leida({ 'M-X': dice('parada') })).estado, 'disponible'),
    p('noCoincidiria', fila(vin({ codigo: 'X' }), leida({ 'M-X': dice('parada') })).estado, 'averiada'), p('noCoincidiria', fila(u({ codigo: 'P' }), null).estado, 'averiada'), p('noCoincidiria', fila(vin({ codigo: 'X' }), null).estado, 'averiada')],
    [null, '🟡 Parada', null, null]);
  eq('⭐ 1.7 B11 el toast al guardar: con «no coincide» manda a 📲; si coincide, solo la marca',
    [p('textoExitoMarca', fila(vin({ codigo: 'UNI-03' }), leida({ 'M-UNI-03': dice('operativa') })), 'averiada'), p('textoExitoMarca', fila(vin({ codigo: 'UNI-03' }), leida({ 'M-UNI-03': dice('operativa') })), 'disponible'), p('textoExitoMarca', fila(u({ codigo: 'P' }), null), 'averiada')],
    ['UNI-03: 🔧 Averiada · no coincide con inspección: toca 📲 Avisar a inspección.', 'UNI-03: ✅ Disponible.', 'P: 🔧 Averiada.']);
  // B2: una vinculada SIN LEER se marca a ciegas, y el editor lo dice.
  eq('⭐ 1.7 B2 marcar una «❔ Sin dato» (inspección no se pudo leer) dice que es a ciegas',
    ed(fila(vin({ codigo: 'UNI-01' }), null), 'disponible').aviso, 'No se pudo leer inspección: marcas sin saber lo que dice. Vale desde ahora; cuando se lea, si no coincide, lo verás con ⚠️.');
  eq('1.7 B2 * la OTRA pastilla de una marcada sin leer también es a ciegas; la misma, «sin verificar» (como antes)',
    [ed(fila(vin({ codigo: 'UNI-03', estado: 'averiada', estadoAt: '2026-10-25T10:10:00Z' }), null), 'disponible').aviso, ed(fila(vin({ codigo: 'UNI-03', estado: 'averiada', estadoAt: '2026-10-25T10:10:00Z' }), null), 'averiada').aviso],
    ['No se pudo leer inspección: marcas sin saber lo que dice. Vale desde ahora; cuando se lea, si no coincide, lo verás con ⚠️.', 'No se pudo comparar con inspección: esto la vuelve a poner desde ahora.']);
  // B1: «📝 nota» también en «sin verificar» (soloNota): no sella ni revive.
  const filaSinVerificar = fila(vin({ codigo: 'UNI-03', estado: 'averiada', estadoAt: '2026-10-25T10:10:00Z', estadoNota: 'caucho' }), null);
  eq('⭐ 1.7 B1 el enlace «📝 nota» (soloNota) en una marca «sin verificar» edita SOLO la nota (trae la guardada); la pastilla sigue siendo marca nueva',
    [ed(filaSinVerificar, 'averiada', true).modo, ed(filaSinVerificar, 'averiada', true).nota, ed(filaSinVerificar, 'averiada').modo],
    ['nota', 'caucho', 'marca']);
  eq('⭐ 1.7 B1 * «📝 nota» NUNCA se vuelve una marca nueva: si la marca dejó de mandar (quedó atrás, otra pastilla, la oficina), el editor se apaga (modo null) y lo dice',
    [ed(filaSinVerificar, 'disponible', true).modo, ed(filaSuperada, 'averiada', true).modo, ed(filaSuperada, 'averiada', true).aviso, ed(fila(vin({ codigo: 'UNI-09', estado: 'disponible', estadoAt: '2026-10-15T14:00:00Z' }), leida({ 'M-UNI-09': dice('espera') })), 'disponible', true).modo],
    [null, null, 'Tu marca ya no manda (inspección registró algo nuevo, o la oficina la tiene): cierra y, si hace falta, vuelve a marcarla.', null]);
  eq('⭐ 1.7 * en espera (oficina): no se puede (modo null) y dice por qué',
    [ed(fila(vin({ codigo: 'UNI-09' }), leida({ 'M-UNI-09': dice('espera') })), 'averiada').modo, ed(fila(vin({ codigo: 'UNI-09' }), leida({ 'M-UNI-09': dice('espera') })), 'averiada').aviso],
    [null, 'Lo maneja la oficina (Control de Maquinaria).']);
  eq('1.7 * una del sitio: la misma pastilla es la nota', ed(fila(u({ codigo: 'P', estado: 'disponible' }), null), 'disponible').modo, 'nota');

  // B-M2: una nota escrita que se perdería.
  const us = [u({ id: 'U-1', codigo: 'C-01', estadoNota: 'Sin frenos' })];
  const ne = (e2) => p('notaEscritaSinGuardar', e2, us);
  eq('⭐ 1.7 B-M2 pregunta solo si hay una nota ESCRITA distinta de la guardada',
    [ne(null), ne({ id: 'U-1', estado: 'averiada', nota: '   ' }), ne({ id: 'U-1', estado: 'disponible', nota: ' Sin  frenos ' }), ne({ id: 'U-1', estado: 'averiada', nota: 'Caucho' }), ne({ id: 'U-9', estado: 'averiada', nota: 'x' })],
    [false, false, false, true, false]);

  // La hora de la lectura y el cambio de turno.
  eq('1.7 la hora de la lectura (hoy / otro día)', [p('textoInspeccionLeida', '2026-10-25T10:42:00Z', AHORA), p('textoInspeccionLeida', '2026-10-24T22:00:00Z', AHORA), p('textoInspeccionLeida', null, AHORA)],
    ['🔎 Inspección leída a las 06:42 a. m.', '🔎 Inspección leída el 24/10 a las 06:00 p. m.', '']);
  eq('⭐ 1.7 «cambió el turno»: leída 06:42 a. m. y ahora 10:00 a. m. sí; 08:00 → 10:00 no; sin lectura no',
    [p('cambioElTurno', '2026-10-25T10:42:00Z', AHORA), p('cambioElTurno', '2026-10-25T12:00:00Z', AHORA), p('cambioElTurno', null, AHORA)], [true, false, false]);
  eq('1.7 * el turno cambia justo a las 7 (a. m. y p. m.)', [p('turnoDe', Date.parse('2026-10-25T10:59:59Z')) !== p('turnoDe', Date.parse('2026-10-25T11:00:00Z')),
    p('turnoDe', Date.parse('2026-10-25T22:59:59Z')) !== p('turnoDe', Date.parse('2026-10-25T23:00:00Z')), p('turnoDe', Date.parse('2026-10-25T11:00:00Z')) === p('turnoDe', Date.parse('2026-10-25T22:59:59Z'))],
    [true, true, true]);

  // ⭐ B1: la referencia de la guardia = hasta cuándo ella YA VIO lo de inspección (la más nueva).
  const R = (un, insp, buena, visto) => p('referenciaDeGuardia', un, insp, buena, visto);
  const marcada06 = vin({ codigo: 'UNI-03', estado: 'averiada', estadoAt: '2026-10-25T10:00:00Z' });
  eq('⭐ 1.7 B1 con lectura vigente: su hora («después de que abriste la pantalla»)', R(marcada06, { leidaAt: '2026-10-25T12:00:00Z' }, null, null), { leidaAt: '2026-10-25T12:00:00.000Z', motivo: 'pantalla' });
  eq('⭐ 1.7 B1 la relectura falló (insp null): vale la última lectura BUENA, no la marca de las 06:00', R(marcada06, null, '2026-10-25T12:00:00Z', null), { leidaAt: '2026-10-25T12:00:00.000Z', motivo: 'pantalla' });
  eq('⭐ 1.7 B1 nunca se leyó: su marca anterior («después de tu marca anterior»)', R(marcada06, null, null, null), { leidaAt: '2026-10-25T10:00:00.000Z', motivo: 'marca' });
  eq('⭐ 1.7 B1 la guardia ya le mostró un hecho de las 09:25 (vistoHasta = la hora del HECHO): ese ya no frena; gana por ser el más nuevo',
    R(marcada06, { leidaAt: '2026-10-25T12:00:00Z' }, '2026-10-25T12:00:00Z', '2026-10-25T13:25:00Z'), { leidaAt: '2026-10-25T13:25:00.000Z', motivo: 'visto' });
  eq('1.7 B1 * la marca más nueva que la lectura (recién marcada, relectura fallida) → la marca', R(vin({ codigo: 'X', estado: 'disponible', estadoAt: '2026-10-25T13:00:00Z' }), null, '2026-10-25T12:00:00Z', null), { leidaAt: '2026-10-25T13:00:00.000Z', motivo: 'marca' });
  eq('⭐ 1.7 B1 vinculada sin marca que nunca se leyó → sin referencia (se marca a ciegas, B2)', R(vin({ codigo: 'X' }), null, null, null), null);
  eq('1.7 B1 * fechas ilegibles no cuentan', R(vin({ codigo: 'X', estado: 'averiada', estadoAt: 'ayer' }), { leidaAt: '' }, 'x', null), null);

  // ⭐ B5 / B8: qué se dice al soltar la marca según cómo esté.
  const D = (un, insp) => p('dialogoSoltar', fila(un, insp), AHORA);
  const dSup = D(vin({ codigo: 'UNI-11', estado: 'averiada', estadoAt: '2026-10-20T10:05:00Z' }), leida({ 'M-UNI-11': dice('operativa', { novedad: { ms: Date.parse('2026-10-20T11:25:00Z'), que: 'jornada', motivo: null } }) }));
  eq('⭐ 1.7 B5 marca SUPERADA de otra jornada: «ya no cuenta · 🧹 Quitarla», sin prometer que mande inspección (ya manda)',
    [dSup.enlace, dSup.titulo, dSup.confirmar, dSup.mensaje],
    ['Tu marca 🔧 del 20/10 ya no cuenta · 🧹 Quitarla', '🧹 Quitar la marca', '🧹 Quitarla',
      'Tu marca 🔧 Averiada de UNI-11 del 20/10 ya no cuenta: inspección ya manda (inspección registró una jornada el 20/10 a las 07:25 a. m.). Se quita de la lista junto con su nota; no cambia el estado. ¿Seguir?']);
  eq('1.7 B5 * superada hoy: «de hoy 06:05 a. m.»', D(vin({ codigo: 'UNI-11', estado: 'averiada', estadoAt: '2026-10-25T10:05:00Z' }), leida({ 'M-UNI-11': dice('operativa', { novedad: { ms: Date.parse('2026-10-25T11:25:00Z'), que: 'jornada', motivo: null } }) })).enlace,
    'Tu marca 🔧 de hoy 06:05 a. m. ya no cuenta · 🧹 Quitarla');
  const dFuera = D(vin({ codigo: 'UNI-05', estado: 'disponible', estadoAt: '2026-10-25T10:05:00Z' }), leida({ 'M-UNI-05': { encontrada: false, estado: null, etiqueta: null, icono: null, motivo: null, desdeMs: null, enVivo: null, novedad: null, reactivadaMs: null } }));
  eq('⭐ 1.7 B8 fuera del catálogo: se puede soltar (P1), pero el diálogo dice que quedará «❔ Sin dato», no que mande inspección',
    [dFuera.enlace, dFuera.titulo, dFuera.confirmar, /quedará «❔ Sin dato» hasta que la vuelvas a marcar/.test(dFuera.mensaje), /desde ahora su estado es el que registre inspección/.test(dFuera.mensaje)],
    ['↩️ Que mande inspección', '↩️ Quitar tu marca', '↩️ Quitar la marca', true, false]);
  const dVig = D(vin({ codigo: 'UNI-03', estado: 'averiada', estadoAt: '2026-10-25T10:10:00Z' }), leida({ 'M-UNI-03': dice('operativa') }));
  eq('1.7 vigente (y en pausa): «desde ahora su estado es el que registre inspección», como antes',
    [dVig.enlace, dVig.mensaje, D(vin({ codigo: 'UNI-09', estado: 'disponible', estadoAt: '2026-10-15T14:00:00Z' }), leida({ 'M-UNI-09': dice('espera') })).mensaje],
    ['↩️ Que mande inspección', 'Se quita tu marca 🔧 Averiada de UNI-03 (y su nota): desde ahora su estado es el que registre inspección. ¿Seguir?',
      'Se quita tu marca ✅ Disponible de UNI-09 (y su nota): desde ahora su estado es el que registre inspección. ¿Seguir?']);
  eq('1.7 * sin marca no hay nada que soltar', [D(vin({ codigo: 'X' }), null), D(u({ codigo: 'P' }), null)], [null, null]);
  eq('1.7 R1/B10 los topes del bloque: 15 s la lectura; 10 s de frescura', [P.TOPE_LECTURA_BLOQUE_MS, P.FRESCURA_LECTURA_MS], [15000, 10000]);

  // M8: el 🔧 del selector de unidad de las salidas.
  const a = vin({ codigo: 'UNI-07' });
  const grupos = p('gruposParaSalidas', [fila(a, leida({ 'M-UNI-07': dice('averiada') })), fila(u({ codigo: 'P' }), null)]);
  eq('⭐ 1.7 M8 el bloque le pasa a las salidas el grupo EFECTIVO de cada unidad', grupos, { 'U-UNI-07': 'averiada', 'U-P': 'disponible' });
  eq('⭐ 1.7 M8 el 🔧 sale de ese grupo (una vinculada averiada según inspección sí)', p('averiadaEnSalidas', a, grupos), true);
  eq('1.7 * sin ese dato no se supone nada de inspección (la vinculada sin marca no lleva 🔧)', p('averiadaEnSalidas', a, null), false);
  eq('1.7 * sin ese dato, las del sitio y las marcadas 🔧 sí', [p('averiadaEnSalidas', u({ codigo: 'P', estado: 'averiada' }), null), p('averiadaEnSalidas', vin({ codigo: 'B', estado: 'averiada', estadoAt: '2026-10-25T10:10:00Z' }), {})], [true, true]);
  eq('1.7 * con el dato, manda el dato (una marca 🔧 que quedó atrás ya no es averiada)', p('averiadaEnSalidas', u({ id: 'U-P', codigo: 'P', estado: 'averiada' }), { 'U-P': 'disponible' }), false);
}
ok('1.6 A#6 la librería ya no anuncia que el inventario baja TODA la historia (INICIO_HISTORIA_BLOQUES)', !('INICIO_HISTORIA_BLOQUES' in MB));
ok('1.6 el archivo puro no importa React ni la capa de datos', (() => { const s = sinComentarios(leer(RUTA_PURA)); return s !== '' && !/from 'react/.test(s) && !/centroOperacionesDb|supabase/.test(s); })());

// ═══════════════════════════ (2) CANDADOS SOBRE LAS PANTALLAS ═══════════════════════════

const PANTALLA = 'src/screens/CentroOperacionesScreen.tsx';
const pantalla = sinComentarios(leer(PANTALLA));
const tab = sinComentarios(leer(`${DIR}/ParteDiarioTab.tsx`));
const pat = sinComentarios(leer(`${DIR}/BloquePatios.tsx`));
const maq = sinComentarios(leer(`${DIR}/BloqueMaquinaria.tsx`));
const blo = sinComentarios(leer(`${DIR}/BloqueBloques.tsx`));
const sal = sinComentarios(leer(`${DIR}/BloqueSalidas.tsx`));
const flo = sinComentarios(leer(`${DIR}/FlotaTab.tsx`));
const aju = sinComentarios(leer(`${DIR}/AjustesTab.tsx`));
const PURA_DESDE_PANTALLA = '../components/centroOperaciones/pantallaParteDiario';

// ——— 2.1 B-I1: preguntar antes de salir del Parte diario ———
{
  ok('⭐ 2.1 B-I1 la pantalla pregunta con useConfirm (el patrón del módulo: en web gana el último montado)',
    /const confirm = useConfirm\(\);/.test(pantalla) && /from '\.\.\/components\/ConfirmProvider'/.test(pantalla));
  const salir = cuerpoDe(pantalla, 'puedeSalirDelParte');
  ok('⭐ 2.1 * solo pregunta si está en el Parte diario Y quedó algo sin guardar', /activa !== 'parte' \|\| sinGuardarParte\.current\.length === 0/.test(salir), salir.slice(0, 200));
  ok('⭐ 2.1 * «Descartar» / «Seguir aquí», con el texto de textoSalirSinGuardar',
    /confirm\(\{[\s\S]*textoSalirSinGuardar\(sinGuardarParte\.current\)[\s\S]*confirmText: 'Descartar'[\s\S]*cancelText: 'Seguir aquí'/.test(salir)
    && importadosDe(pantalla, PURA_DESDE_PANTALLA).includes('textoSalirSinGuardar'));
  ok('⭐ 2.1 * cambiar de PESTAÑA pasa por la pregunta (irAPestana), no directo',
    /onPress=\{\(\) => irAPestana\(p\.key\)\}/.test(pantalla) && !/onPress=\{\(\) => setPestana\(p\.key\)\}/.test(pantalla)
    && /puedeSalirDelParte\(\)/.test(cuerpoDe(pantalla, 'irAPestana')));
  ok('⭐ 2.1 * cambiar de SITIO también (irASitio)',
    /onPress=\{\(\) => irASitio\(s\.id\)\}/.test(pantalla) && !/onPress=\{\(\) => setSitioId\(s\.id\)\}/.test(pantalla)
    && /puedeSalirDelParte\(\)/.test(cuerpoDe(pantalla, 'irASitio')));
  ok('⭐ 2.1 * NO se deja montado y escondido: el Parte diario se monta solo si es la pestaña activa (lote 5: el refresco al volver de ⚙️ Ajustes)',
    /\{activa === 'parte' \? \(?\s*<ParteDiarioTab\b/.test(pantalla) && !/display:\s*activa/.test(pantalla));
  ok('⭐ 2.1 * el Parte diario le dice a la pantalla qué quedó sin guardar (alSinGuardar={alSinGuardarParte})',
    /<ParteDiarioTab\b[^>]*alSinGuardar=\{alSinGuardarParte\}/.test(pantalla));
  eq('2.1 la pregunta nombra los bloques con los MISMOS títulos de la pestaña (y en su orden)',
    [...tab.matchAll(/<Bloque\s+titulo="([^"]+)"/g)].map((x) => x[1]), Object.values(P.ETIQUETAS_SIN_GUARDAR ?? {}));
  ok('2.1 ParteDiarioTab recibe alSinGuardar y lo avisa con bloquesSinGuardar',
    /alSinGuardar\?: \(claves: ClaveSinGuardar\[\]\) => void/.test(tab) && /bloquesSinGuardar\(sucios\)/.test(tab) && /alSinGuardar\?\.\(/.test(tab));
  ok('⭐ 2.1 * y al desmontarse avisa que ya no hay nada (no queda una pregunta colgada)', /return \(\) => \{ alSinGuardar\?\.\(\[\]\); \};/.test(tab));
}

// ——— 2.2 B-M7: patios, maquinaria y pendientes de pesaje también son «sin guardar» ———
{
  ok('⭐ 2.2 B-M7 el bloque 2 (patios) dice «✏️ sin guardar» y BloquePatios lo avisa',
    /<Bloque titulo="2 · 🚪 Entrada por patio"[^>]*sinGuardar=\{sucios\.patios\}/.test(tab) && /<BloquePatios\b[^>]*alSinGuardar=\{marcar\.patios\}/.test(tab));
  ok('⭐ 2.2 * el bloque 6 (maquinaria) también', /<Bloque titulo="6 · 🚜 Maquinaria"[^>]*sinGuardar=\{sucios\.maquinaria\}/.test(tab) && /<BloqueMaquinaria\b[^>]*alSinGuardar=\{marcar\.maquinaria\}/.test(tab));
  ok('2.2 * los siete bloques marcan con marcar.*', [...tab.matchAll(/alSinGuardar=\{marcar\.\w+\}/g)].length === 7);
  ok('⭐ 2.2 BloquePatios: «sin guardar» = cambios por guardar, campos con error o patios escritos en otra jornada',
    /alSinGuardar\?: \(sinGuardar: boolean\) => void/.test(pat) && /const sinGuardar = hayCambios \|\| conError\.length > 0 \|\| otrasJornadas\.length > 0;/.test(pat)
    && /alSinGuardar\?\.\(sinGuardar\)/.test(pat) && /jornadasConPatiosEscritos\(editados, fecha\)/.test(pat));
  ok('2.2 * los patios escritos en otra jornada se dicen en la tarjeta', /Hay patios escritos sin guardar/.test(pat));
  ok('2.2 * escribir lo mismo que está guardado no deja un «sin guardar» fantasma', /if \(txt === comoGuardado\) delete/.test(pat));
  ok('⭐ 2.2 BloqueMaquinaria: «sin guardar» con edicionSinGuardar (otro estado u otra nota)',
    /alSinGuardar\?: \(sinGuardar: boolean\) => void/.test(maq) && /edicionSinGuardar\(edicion, unidades\)/.test(maq) && /alSinGuardar\?\.\(/.test(maq));
  ok('⭐ 2.2 Acero: las toneladas escritas en «Pendientes de pesaje» también cuentan',
    /alEscribir=\{setPendientesSinGuardar\}/.test(sal) && /s\.sinGuardar \|\| pendientesSinGuardar/.test(sal));
}

// ——— 2.3 B-I2: si no cargaron los sitios, solo el error y «🔄 Reintentar» ———
{
  const iError = pantalla.indexOf('error && sitios.length === 0');
  const iSinSitios = pantalla.indexOf('Crea el primer sitio');
  ok('⭐ 2.3 B-I2 con error y sin sitios se decide ANTES que «Crea el primer sitio» / «Todavía no hay sitios»', iError > 0 && iSinSitios > 0 && iError < iSinSitios, `${iError} / ${iSinSitios}`);
  ok('⭐ 2.3 * el error trae «🔄 Reintentar» que vuelve a cargar los sitios', /🔄 Reintentar/.test(pantalla) && /onPress=\{reintentar\}/.test(pantalla) && /await recargar\(\)/.test(cuerpoDe(pantalla, 'reintentar')));
  ok('2.3 * y dice cómo en el teléfono (en web deslizar no hace nada)', /toca Reintentar \(o desliza hacia abajo en el teléfono\)/.test(pantalla) && !/Desliza hacia abajo para intentar de nuevo/.test(pantalla));
  ok('2.3 sigue: sin sitios (y sin error) Full ve «Crea el primer sitio» y los demás «Todavía no hay sitios»', /Crea el primer sitio/.test(pantalla) && /Todavía no hay sitios/.test(pantalla));
}

// ——— 2.4 B-I4: la jornada que sigue a hoy ———
{
  ok('⭐ 2.4 B-I4 la pantalla recuerda si ella estaba «en hoy» (parteEnHoy) al cambiar la fecha',
    /const parteEnHoy = useRef\(true\);/.test(pantalla) && /parteEnHoy\.current = f === caracasBusinessToday\(\);/.test(cuerpoDe(pantalla, 'cambiarFechaParte')));
  ok('⭐ 2.4 * el Parte diario cambia la fecha por ahí (alCambiarFecha={cambiarFechaParte})', /<ParteDiarioTab\b[^>]*alCambiarFecha=\{cambiarFechaParte\}/.test(pantalla));
  const rev = cuerpoDe(pantalla, 'revisarJornada');
  ok('⭐ 2.4 * revisarJornada decide con jornadaAlVolver (fecha, en hoy, hoy y lo sin guardar)',
    /const hoy = caracasBusinessToday\(\);/.test(rev)
    && /jornadaAlVolver\(\{ fecha: fechaParteRef\.current, enHoy: parteEnHoy\.current, hoy, sinGuardar: sinGuardarParte\.current\.length > 0 \}\)/.test(rev)
    && importadosDe(pantalla, PURA_DESDE_PANTALLA).includes('jornadaAlVolver'), rev.slice(0, 240));
  ok('2.4 * si cambió el día se vuelve a pintar (el ▶, el calendario y «↩ Volver a hoy» de la pestaña calculan su hoy al pintarse)',
    /if \(cambioElDia\) setDiaNuevo\(\(n\) => n \+ 1\);/.test(rev));
  ok('2.4 * y lo dice con un toast (nunca con una pregunta: un temporizador no puede pisar otra confirmación abierta)', /toastRef\.current\.info\(d\.aviso\)/.test(rev) && !/confirm\(/.test(rev));
  ok('⭐ 2.4 * revisa al enfocar la pantalla', /useFocusEffect\(useCallback\(\(\) => \{ recargar\(\); revisarJornada\(\); \}, \[recargar, revisarJornada\]\)\)/.test(pantalla));
  ok('⭐ 2.4 * al volver la app a primer plano (AppState) y cada minuto', /AppState\.addEventListener\('change'/.test(pantalla) && /setInterval\(revisarJornada, 60_000\)/.test(pantalla) && /clearInterval\(/.test(pantalla));
}

// ——— 2.5 B-M1 + A#6: 🧱 Bloques ———
{
  ok('⭐ 2.5 B-M1 lo del día se guarda CON su fecha (como los patios)', /useState<\{ fecha: string; movs: Movimiento\[\] \} \| null>\(null\)/.test(blo) && /setDelDia\(\{ fecha, movs: dia \}\)/.test(blo));
  ok('⭐ 2.5 * y solo se muestra si es la jornada elegida (mientras llega otra, «Cargando…»)', /delDia && delDia\.fecha === fecha \? delDia\.movs : null/.test(blo));
  ok('⭐ 2.5 A#6 el inventario ya no baja toda la historia (sin cargarMovimientos desde el año 2000)',
    !/INICIO_HISTORIA_BLOQUES/.test(blo) && !/cargarMovimientos\([^)]*2000/.test(blo));
  ok('⭐ 2.5 * usa la lectura acotada: las piezas anteriores + el día (cargarDatosReporteCompleto)',
    /cargarDatosReporteCompleto\(sitio\.id, fecha, fecha\)/.test(blo) && /\[\.\.\.d\.anteriores, \.\.\.d\.movimientos\]/.test(blo));
}

// ——— 2.6 B-M4: Flota y Ajustes con «🔄 Reintentar» ———
for (const [n, code] of [['FlotaTab', flo], ['AjustesTab', aju]]) {
  ok(`⭐ 2.6 B-M4 ${n}: junto al error de carga, «🔄 Reintentar» (en web deslizar no hace nada)`, /🔄 Reintentar/.test(code) && /onPress=\{reintentar\}/.test(code));
  ok(`2.6 * ${n}: «toca Reintentar (o desliza hacia abajo en el teléfono)», ya no «vuelve a entrar»`,
    /toca Reintentar \(o desliza hacia abajo en el teléfono\)/.test(code) && !/desliza hacia abajo o vuelve a entrar/.test(code));
  ok(`2.6 * ${n}: reintentar vuelve a cargar`, /await cargar\(\)/.test(cuerpoDe(code, 'reintentar')));
}

// ——— 2.7 B-M5: «Pídeselo a quien administra el módulo» ———
{
  const DESDE = './pantallaParteDiario';
  // M4: BloqueMaquinaria también («Las unidades se agregan en 🚛 Flota»), ahora que se reconstruyó con la inspección.
  for (const [n, code, min] of [['BloqueSalidas', sal, 3], ['BloqueBloques', blo, 1], ['BloquePatios', pat, 1], ['BloqueMaquinaria', maq, 1]]) {
    const usos = [...code.matchAll(/pideloAQuienAdministra\(nivel\)/g)].length;
    ok(`⭐ 2.7 B-M5 ${n}: los avisos que mandan a ⚙️ Ajustes / 🚛 Flota agregan pideloAQuienAdministra(nivel) (${min}+)`,
      usos >= min && importadosDe(code, DESDE).includes('pideloAQuienAdministra'), `usos ${usos}`);
  }
  ok('2.7 * BloquePatios ya no lo arma a mano', !/nivel === 'full' \? '' : ' Pídeselo/.test(pat));
  ok('2.7 * BloqueSalidas: el aviso de km sin lista, la flota vacía y los transportistas', /Los km se ponen en ⚙️ Ajustes\./.test(sal) && /Las unidades se agregan en 🚛 Flota\./.test(sal) && /Se agregan en ⚙️ Ajustes → 📚 Listas\./.test(sal));
}

// ——— 2.8 B-M2 (lo de estos archivos): ✏️ con algo escrito pregunta ———
{
  const editar = /const editar = \(m: Movimiento\) => \{([\s\S]*?)\n  \};/.exec(sal)?.[1] ?? '';
  ok('⭐ 2.8 B-M2 ✏️ en una salida con algo sin guardar pregunta antes de reemplazar lo escrito',
    /if \(!sinGuardar\) \{ abrir\(\); return; \}/.test(editar) && /confirm\(\{[\s\S]*confirmText: 'Descartar'[\s\S]*\}\)\.then\(\(descartar\) => \{ if \(descartar\) abrir\(\); \}\)/.test(editar), editar.slice(0, 300));
  ok('2.8 * tocar ✏️ en la que ya se edita no hace nada', /if \(editandoRef\.current\?\.id === m\.id\) return;/.test(editar));
  ok('2.8 * al descartar se revisa otra vez el candado (un guardado pudo empezar)', /if \(enVuelo\.current \|\| !vivo\.current\) return;/.test(editar));
}

// ——— 2.9 M4 · B-M2 en 🚜 Maquinaria: abrir OTRA máquina o «Cancelar» con una nota escrita pregunta ———
{
  const abrir = /const abrir = \(f: FilaDelSitio, estado: EstadoUnidad, soloNota = false\) => \{([\s\S]*?)\n  \};/.exec(maq)?.[1] ?? '';
  const cancelar = /const cancelar = \(\) => \{([\s\S]*?)\n  \};/.exec(maq)?.[1] ?? '';
  ok('⭐ 2.9 B-M2 abrir OTRA máquina con una nota escrita sin guardar pregunta (Descartar / Seguir escribiendo)',
    /edicion && edicion\.id !== id && notaEscritaSinGuardar\(edicion, unidades\)/.test(abrir) && /preguntarDescartar\([\s\S]*\)\s*\.then\(\(descartar\) => \{ if \(descartar\) poner\(\); \}\)/.test(abrir)
    && /confirmText: 'Descartar'/.test(maq) && /cancelText: 'Seguir escribiendo'/.test(maq) && /useConfirm\(\)/.test(maq), abrir.slice(0, 300));
  ok('⭐ 2.9 * «Cancelar» con una nota escrita también pregunta; sin nota escrita cierra directo',
    /if \(!notaEscritaSinGuardar\(edicion, unidades\)\) \{ cerrar\(\); return; \}/.test(cancelar) && /\.then\(\(descartar\) => \{ if \(descartar\) cerrar\(\); \}\)/.test(cancelar), cancelar.slice(0, 300));
  ok('2.9 * el botón Cancelar pasa por esa pregunta', /onPress=\{cancelar\}/.test(maq));
  ok('2.9 * en la MISMA máquina, cambiar de pastilla no tira la nota escrita', /prev && prev\.id === id && notaEscritaSinGuardar\(prev, unidades\)/.test(abrir));
  ok('2.9 * al descartar se revisa otra vez el candado (un guardado pudo empezar)', /if \(!vivo\.current \|\| enVuelo\.current\) return;/.test(abrir));
  ok('⭐ 2.9 B-M7 sigue: una marca nueva elegida o una nota distinta es «✏️ sin guardar»',
    /const sinGuardar = !!edicion && \(editor\?\.modo === 'marca' \|\| edicionSinGuardar\(edicion, unidades\)\);/.test(maq));
}

console.log(`${fail === 0 ? '✅' : '❌'} test-centro-operaciones-pantallas · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Pantallas: salir con algo sin guardar pregunta, la jornada sigue a hoy, los errores se reintentan y Bloques no baja toda la historia.');
