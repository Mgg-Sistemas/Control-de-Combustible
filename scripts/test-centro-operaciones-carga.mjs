// 🏭 CENTRO DE OPERACIONES — PRUEBAS DE ✍️ CARGAR Y 📋 REGISTROS (24-oct-2026).
//
// Dos partes:
//   (1) la librería pura de la carga (src/lib/centroOperacionesCarga.ts): qué se
//       sugiere en origen y destino según el tipo, la placa que se vincula sola,
//       la lectura de la hora, los viajes y las cifras, «Guardar y otro», el
//       rango rápido, las opciones de los filtros y las filas del Excel;
//   (2) candados sobre las pantallas (CargarTab, RegistrosTab, CampoSugerido):
//       el borrador en el equipo, los permisos de ✏️ y 🗑️ y que la pertenencia a
//       una unidad la decida SOLO la librería.
//
// ⭐ Todos los datos son SINTÉTICOS (el repositorio es público).
//
//   node scripts/test-centro-operaciones-carga.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

// El mismo cargador de scripts/test-reporte-personalizado.mjs: transpila el .ts
// a CommonJS y resuelve los imports relativos a otros .ts.
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
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? '  -> ' + extra : ''}`); }
};

const leer = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), 'utf8') : '');
const existe = (r) => fs.existsSync(path.join(ROOT, r));

console.log('🏭 CENTRO DE OPERACIONES · ✍️ CARGAR Y 📋 REGISTROS\n');

const RUTA_LIB = 'src/lib/centroOperacionesCarga.ts';
ok('(0) existe la librería de la carga', existe(RUTA_LIB));
let C = {};
try { C = existe(RUTA_LIB) ? loadTs(path.join(ROOT, RUTA_LIB)) : {}; } catch (e) { ok('(0) la librería carga sin errores', false, String(e?.message ?? e)); }
const fn = (nombre) => (typeof C[nombre] === 'function' ? C[nombre] : () => { throw new Error(`falta ${nombre}`); });
/** Corre `f` y devuelve su resultado, o el error como texto (la prueba sigue). */
const intenta = (f) => { try { return f(); } catch (e) { return `ERROR: ${e?.message ?? e}`; } };

// ── Datos sintéticos ──────────────────────────────────────────────────────
const S = 'sitio-1';
const item = (id, clase, nombre, activo = true, sitioId = S) => ({ id, sitioId, clase, nombre, activo });
const listas = [
  item('l1', 'origen', 'Frente Norte'),
  item('l2', 'origen', 'Cantera B', true, null), // general: para todos los sitios
  item('l3', 'terraza', 'Terraza 2'),
  item('l4', 'terraza', 'Terraza 10'),
  item('l5', 'destino', 'Destino Externo X'),
  item('l6', 'origen', 'Origen Viejo', false), // inactivo: no se sugiere
  item('l7', 'transportista', 'Transportista A'),
  item('l8', 'material', 'Material Z'),
  item('l9', 'terraza', 'Terraza Cerrada', false),
];
// Un frente del sistema escrito distinto al de la lista: sale UNA vez, con la forma de la lista.
const frentes = [' frente norte ', 'Frente Sur'];

const unidad = (id, o = {}) => ({
  id, sitioId: S, origen: 'propia', machineryId: null, codigo: `U-${id}`, descripcion: null,
  placa: null, serial: null, marca: null, modelo: null, dueno: null, capacidadM3: null, activo: true, nota: null, ...o,
});
const unidades = [
  unidad('u1', { placa: 'A12-BC', activo: false, codigo: 'V-00' }), // dada de baja con la misma placa
  unidad('u2', { placa: 'A12BC', codigo: 'V-01', capacidadM3: 14 }),
  unidad('u3', { placa: 'ZZ99', codigo: 'V-03' }),
  unidad('u4', { placa: 'zz-99', codigo: 'V-04' }), // dos ACTIVAS con la misma placa: no se adivina
  unidad('u5', { placa: null, codigo: 'V-05' }),
  unidad('u6', { placa: 'B 77 CD', codigo: 'V-06', capacidadM3: 18 }),
];

const mov = (o = {}) => ({
  id: 'm', sitioId: S, fecha: '2026-10-22', hora: null, tipo: 'entrada', unidadId: null, unidadTexto: '', placa: null,
  transportista: null, transportistaId: null, origen: null, origenId: null, destino: null, destinoId: null,
  material: null, materialId: null, capacidadM3: null, viajes: 1, toneladas: null, m3: null, estado: 'confirmado',
  observacion: null, creadoPor: null, creadoAt: null, editadoPor: null, editadoAt: null, ...o,
});

// ═══════════════════ (1) LA LIBRERÍA PURA ═══════════════════

// ── 1.1 Lo que se sugiere en origen y destino según el tipo ──
{
  const s = (tipo) => intenta(() => fn('sugerenciasOrigenDestino')(tipo, listas, frentes));
  eq('⭐ 1.1 entrada: origen = frentes + lista «origen» (A→Z, sin repetir, sin inactivos)', s('entrada').origen,
    ['Cantera B', 'Frente Norte', 'Frente Sur']);
  eq('⭐ 1.1 entrada: destino = las terrazas (orden natural)', s('entrada').destino, ['Terraza 2', 'Terraza 10']);
  eq('⭐ 1.1 interno: terraza → terraza (origen)', s('interno').origen, ['Terraza 2', 'Terraza 10']);
  eq('⭐ 1.1 interno: terraza → terraza (destino)', s('interno').destino, ['Terraza 2', 'Terraza 10']);
  eq('⭐ 1.1 salida: origen = las terrazas', s('salida').origen, ['Terraza 2', 'Terraza 10']);
  eq('⭐ 1.1 salida: destino = la lista «destino»', s('salida').destino, ['Destino Externo X']);
  eq('1.1 otro: origen = todo lo que puede ser origen', s('otro').origen,
    ['Cantera B', 'Frente Norte', 'Frente Sur', 'Terraza 2', 'Terraza 10']);
  eq('1.1 otro: destino = terrazas + destinos', s('otro').destino, ['Destino Externo X', 'Terraza 2', 'Terraza 10']);
  eq('1.1 sin listas ni frentes → listas vacías (no revienta)', intenta(() => fn('sugerenciasOrigenDestino')('entrada', [], [])),
    { origen: [], destino: [] });
  eq('1.1 lista de una clase: transportistas activos + extras, sin repetir', intenta(() => fn('sugerenciasDeLista')(listas, ['transportista'], [' transportista a ', 'Transportista B'])),
    ['Transportista A', 'Transportista B']);
  eq('1.1 itemDeLista: escrito igual (otras mayúsculas/espacios) → el de la lista', intenta(() => fn('itemDeLista')('  terraza 2 ', listas)?.id), 'l3');
  eq('1.1 itemDeLista: un inactivo no se vincula', intenta(() => fn('itemDeLista')('Origen Viejo', listas)), null);
  eq('1.1 itemDeLista: vacío → null', intenta(() => fn('itemDeLista')('  ', listas)), null);
  // L5-A8: el mismo nombre «para todos los sitios» y del sitio → manda el del SITIO (sus km, su
  // factor), en cualquier orden: antes decidía el orden en que llegaba de la base.
  const dup = [item('g1', 'destino', 'Destino Norte', true, null), item('s1', 'destino', ' destino norte ')];
  eq('⭐ 1.1 L5-A8 itemDeLista: mismo nombre general y del sitio → el del SITIO', intenta(() => fn('itemDeLista')('Destino Norte', dup)?.id), 's1');
  eq('1.1 L5-A8 * también si el del sitio llega primero', intenta(() => fn('itemDeLista')('Destino Norte', [...dup].reverse())?.id), 's1');
  eq('1.1 L5-A8 * un general solo sigue vinculándose', intenta(() => fn('itemDeLista')('Cantera B', listas)?.id), 'l2');
  eq('1.1 L5-A8 * el del sitio desactivado no le gana al general activo',
    intenta(() => fn('itemDeLista')('Destino Norte', [item('s2', 'destino', 'Destino Norte', false), dup[0]])?.id), 'g1');
}

// ── 1.2 La placa que se vincula sola ──
{
  const u = (p, lista = unidades) => intenta(() => fn('unidadPorPlaca')(p, lista));
  eq('⭐ 1.2 « a12-bc » encuentra la activa con placa A12BC (espacios y guiones no cuentan)', u(' a12-bc ')?.id, 'u2');
  eq('⭐ 1.2 * e ignora la dada de baja con la misma placa', u('A12BC', [unidades[0]]), null);
  eq('1.2 la placa guardada con espacios también coincide («B 77 CD» = «b77cd»)', u('b77cd')?.id, 'u6');
  eq('1.2 dos activas con la misma placa → no se adivina (null)', u('ZZ 99'), null);
  eq('1.2 placa vacía → null', u('   '), null);
  eq('1.2 solo guiones → null', u(' - '), null);
  eq('1.2 placa que no está → null', u('Q1'), null);
  // A8 (lote 2): la placa repetida de 🚛 Flota (al guardar y al REACTIVAR) es una sola función.
  const otra = (p, excepto, lista = unidades) => intenta(() => fn('otraActivaConPlaca')(p, lista, excepto)?.id ?? null);
  eq('⭐ 1.2 A8: reactivar u1 (placa A12-BC) choca con u2, activa con la misma placa', otra('A12-BC', 'u1'), 'u2');
  eq('1.2 A8: la propia unidad no choca consigo misma', otra('A12BC', 'u2'), null);
  eq('1.2 A8: una dada de baja no choca', otra('A12BC', 'nueva', [unidades[0]]), null);
  eq('1.2 A8: sin placa no hay choque', [otra('', 'u5'), otra(' - ', 'u5'), otra(null, 'u5')], [null, null, null]);
  eq('1.2 A8: dos activas con la misma placa: la otra aparece (u3 ve a u4)', otra('ZZ99', 'u3'), 'u4');
  // A3 (lote 2): UNA sola regla de placa, la de la librería (`clavePlaca`): la carga ya no
  // tiene la suya. Barras y tildes tampoco cuentan, igual que en la pertenencia y en Flota.
  eq('⭐ 1.2 A3: «A12/BC» y «Á12BC» también encuentran la activa A12BC (la misma regla que la pertenencia)',
    [u('A12/BC')?.id, u('Á12BC')?.id], ['u2', 'u2']);
  eq('1.2 normalizarPlaca es la regla de la librería (clavePlaca)', intenta(() => fn('normalizarPlaca')(' a12-bc. ')), 'a12bc');
  {
    const L = loadTs(path.join(ROOT, 'src/lib/centroOperaciones.ts'));
    const pares = [['A12-BC', 'a12bc'], ['A12/BC', 'A12BC'], ['Á12BC', 'A12BC'], ['B 77 CD', 'b77cd'], ['A12BC', 'A12BD']];
    eq('⭐ 1.2 A3: la carga y la pertenencia dicen lo mismo de cada pareja de placas',
      pares.map(([a, b]) => intenta(() => fn('normalizarPlaca')(a) === fn('normalizarPlaca')(b))),
      pares.map(([a, b]) => typeof L.clavePlaca === 'function' && L.clavePlaca(a) === L.clavePlaca(b)));
  }
}

// ── 1.3 Hora, viajes y cifras escritas a mano ──
{
  const h = (t) => intenta(() => fn('horaDeCampo')(t));
  eq('1.3 hora vacía → sin dato, sin error', h(''), { valor: null, error: null });
  eq('1.3 hora 07:30', h('07:30'), { valor: '07:30', error: null });
  eq('1.3 hora 7:05 → 07:05', h(' 7:05 '), { valor: '07:05', error: null });
  eq('1.3 hora 00:00 vale', h('00:00').valor, '00:00');
  eq('1.3 hora 23:59 vale', h('23:59').valor, '23:59');
  eq('1.3 hora como la devuelve Postgres (06:30:00) → 06:30', h('06:30:00').valor, '06:30');
  ok('⭐ 1.3 hora 24:00 → error', h('24:00').error && h('24:00').valor === null);
  ok('1.3 hora 12:60 → error', !!h('12:60').error);
  ok('1.3 hora «7» → error', !!h('7').error);
  ok('1.3 hora «ab» → error', !!h('ab').error);

  const v = (t) => intenta(() => fn('viajesDeCampo')(t));
  eq('1.3 viajes vacío → sin dato', v(''), { valor: null, error: null });
  eq('1.3 viajes 3', v('3'), { valor: 3, error: null });
  eq('1.3 viajes 0 es una cifra (no «sin dato»)', v('0'), { valor: 0, error: null });
  ok('⭐ 1.3 viajes 2,5 → error (tiene que ser entero)', !!v('2,5').error && v('2,5').valor === null);
  ok('1.3 viajes «1.500» se lee 1,5 → error (se ve antes de guardar)', !!v('1.500').error);
  ok('1.3 viajes negativos → error', !!v('-1').error);

  const c = (t, o) => intenta(() => fn('cifraDeCampo')(t, o));
  eq('1.3 cifra con coma 42,5', c('42,5'), { valor: 42.5, error: null });
  eq('1.3 cifra con miles 1.234,5', c('1.234,5').valor, 1234.5);
  eq('1.3 cifra vacía → sin dato', c('  '), { valor: null, error: null });
  ok('1.3 cifra negativa → error', !!c('-2').error);
  ok('1.3 capacidad 0 → error (tiene que ser mayor que cero)', !!c('0', { mayorQueCero: true }).error);
  eq('1.3 toneladas 0 sí vale', c('0').valor, 0);
}

// ── 1.4 El formulario: nuevo, validar, «Guardar y otro», editar ──
{
  const f0 = intenta(() => fn('formularioNuevo')('2026-10-22'));
  eq('1.4 formulario nuevo: entrada, viajes «1», confirmado, la fecha pedida', [f0.tipo, f0.viajes, f0.estado, f0.fecha, f0.hora],
    ['entrada', '1', 'confirmado', '2026-10-22', '']);

  const f1 = {
    ...f0, hora: '6:30', unidadTexto: ' V-01 ', placa: ' a12bc ',
    transportista: { texto: ' Transportista A ', listaId: 'l7' },
    origen: { texto: 'Frente Sur', listaId: null },
    destino: { texto: 'Terraza 2', listaId: 'l3' },
    material: { texto: '  ', listaId: 'l8' }, // en blanco: ni texto ni id
    capacidad: '14', viajes: '3', toneladas: '42,5', m3: '', observacion: '  ',
  };
  const r = intenta(() => fn('validarCarga')(f1));
  eq('⭐ 1.4 validarCarga: sin errores', r.errores, []);
  eq('⭐ 1.4 validarCarga: los datos listos para guardar', r.datos, {
    fecha: '2026-10-22', hora: '06:30', tipo: 'entrada', unidadId: null, unidadTexto: 'V-01', placa: 'A12BC',
    transportista: 'Transportista A', transportistaId: 'l7', origen: 'Frente Sur', origenId: null,
    destino: 'Terraza 2', destinoId: 'l3', material: null, materialId: null,
    capacidadM3: 14, viajes: 3, toneladas: 42.5, m3: null, estado: 'confirmado', observacion: null,
  });

  const err = (o) => intenta(() => fn('validarCarga')({ ...f1, ...o }).errores.join(' | '));
  ok('⭐ 1.4 viajes vacío y confirmado → error', /viajes/i.test(err({ viajes: '' })), err({ viajes: '' }));
  eq('⭐ 1.4 viajes vacío y POR CONFIRMAR → vale, viajes null', intenta(() => {
    const x = fn('validarCarga')({ ...f1, viajes: '', estado: 'por_confirmar' });
    return [x.errores, x.datos.viajes];
  }), [[], null]);
  ok('1.4 viajes 2,5 → error', /entero/i.test(err({ viajes: '2,5' })), err({ viajes: '2,5' }));
  ok('1.4 hora 24:00 → error', /hora/i.test(err({ hora: '24:00' })), err({ hora: '24:00' }));
  ok('1.4 toneladas negativas → error', /tonelada/i.test(err({ toneladas: '-1' })), err({ toneladas: '-1' }));
  ok('1.4 m³ negativos → error', /m³/i.test(err({ m3: '-1' })), err({ m3: '-1' }));
  ok('1.4 capacidad 0 → error', /capacidad/i.test(err({ capacidad: '0' })), err({ capacidad: '0' }));
  ok('1.4 fecha que no se entiende → error', /fecha/i.test(err({ fecha: 'ayer' })), err({ fecha: 'ayer' }));
  // B4 (lote 3): la fecha solo se acepta con año entre 2000 y 2100, la MISMA cota de la
  // librería (un renglón con otro año no entraría en ningún rango: se perdería de vista).
  ok('⭐ 1.4 B4 (lote 3): año 9999 → error de fecha', /fecha/i.test(err({ fecha: '9999-12-31' })), err({ fecha: '9999-12-31' }));
  ok('⭐ 1.4 B4 (lote 3): año 1999 → error de fecha', /fecha/i.test(err({ fecha: '1999-12-31' })), err({ fecha: '1999-12-31' }));
  ok('1.4 B4 (lote 3): año 2101 → error de fecha', /fecha/i.test(err({ fecha: '2101-01-01' })), err({ fecha: '2101-01-01' }));
  eq('1.4 B4 (lote 3): los bordes 2000-01-01 y 2100-12-31 sí valen', [err({ fecha: '2000-01-01' }), err({ fecha: '2100-12-31' })], ['', '']);

  // El aviso de pesaje (decisión de la auditoría).
  const p = (o) => intenta(() => fn('avisoPesaje')({ ...f0, ...o }));
  eq('⭐ 1.4 toneladas con «esperando pesaje» → avisa', p({ estado: 'esperando_pesaje', toneladas: '12' }), true);
  eq('1.4 * sin toneladas → no avisa', p({ estado: 'esperando_pesaje', toneladas: '' }), false);
  eq('1.4 * confirmado → no avisa', p({ estado: 'confirmado', toneladas: '12' }), false);

  // «Guardar y otro»: todo se queda menos viajes, toneladas, m³ y observación.
  const otro = intenta(() => fn('formularioParaOtro')({ ...f1, observacion: 'algo' }));
  eq('⭐ 1.4 «Guardar y otro» conserva todo menos viajes, toneladas, m³ y observación', otro,
    { ...f1, viajes: '1', toneladas: '', m3: '', observacion: '' });

  // B1 (lote 2): después de guardar, el formulario siguiente sale de LO QUE SE GUARDÓ, y
  // nunca queda en «editando»: un ✏️ tocado durante el guardado no deja «Editando X» con
  // los datos de otro renglón (que el siguiente «Guardar cambios» escribiría sobre X).
  const tras = (eraEdicion, otro2) => intenta(() => fn('formularioTrasGuardar')({ ...f1, observacion: 'algo' }, eraEdicion, otro2));
  eq('⭐ 1.4 B1: renglón nuevo + «Guardar y otro» → la serie sigue (formularioParaOtro de lo guardado)', tras(false, true),
    { ...f1, viajes: '1', toneladas: '', m3: '', observacion: '' });
  eq('1.4 B1: renglón nuevo + «Guardar» → formulario en blanco del mismo día', tras(false, false), fn('formularioNuevo')(f1.fecha));
  eq('1.4 B1: una edición guardada → formulario en blanco del mismo día (sin «Guardar y otro»)', tras(true, true), fn('formularioNuevo')(f1.fecha));

  // A14 (lote 2): el aviso de un guardado fallido no puede mentir: si el borrador NO se
  // pudo dejar en el equipo (ventana privada, equipo lleno), no dice que quedó.
  const aviso = (eraEd, quedo) => intenta(() => fn('avisoFalloGuardar')('No se guardó: se perdió la conexión.', eraEd, quedo));
  eq('⭐ 1.4 A14: renglón nuevo y el borrador SÍ quedó → lo dice', aviso(false, true),
    'No se guardó: se perdió la conexión. Lo escrito quedó como borrador en este equipo.');
  ok('⭐ 1.4 A14: renglón nuevo y el borrador NO quedó → no dice que quedó, y pide no cerrar',
    !/quedó como borrador/.test(aviso(false, false)) && /no cierres/i.test(aviso(false, false)), aviso(false, false));
  eq('1.4 A14: una edición fallida no habla de borradores (lo escrito sigue en pantalla)', aviso(true, false), 'No se guardó: se perdió la conexión.');

  // Editar: del renglón al formulario y de vuelta, sin perder nada.
  const m = mov({
    id: 'mx', fecha: '2026-10-21', hora: '05:10:00', tipo: 'salida', unidadId: 'u2', unidadTexto: 'V-01', placa: 'A12BC',
    transportista: 'Transportista A', transportistaId: 'l7', origen: 'Terraza 2', origenId: 'l3', destino: 'Destino Externo X',
    destinoId: 'l5', material: 'Material Z', materialId: 'l8', capacidadM3: 14, viajes: 2, toneladas: 30.25, m3: 26,
    estado: 'esperando_pesaje', observacion: 'Nota <b>&</b>',
  });
  const fm = intenta(() => fn('formularioDesdeMovimiento')(m));
  eq('1.4 formulario desde un renglón: la hora sin segundos y las cifras como texto', [fm.hora, fm.capacidad, fm.viajes, fm.toneladas, fm.m3],
    ['05:10', '14', '2', '30.25', '26']);
  const vuelta = intenta(() => fn('validarCarga')(fm).datos);
  eq('⭐ 1.4 ida y vuelta renglón → formulario → datos: nada cambia', vuelta, {
    fecha: m.fecha, hora: '05:10', tipo: m.tipo, unidadId: m.unidadId, unidadTexto: m.unidadTexto, placa: m.placa,
    transportista: m.transportista, transportistaId: m.transportistaId, origen: m.origen, origenId: m.origenId,
    destino: m.destino, destinoId: m.destinoId, material: m.material, materialId: m.materialId,
    capacidadM3: m.capacidadM3, viajes: m.viajes, toneladas: m.toneladas, m3: m.m3, estado: m.estado, observacion: m.observacion,
  });
  const fNulos = intenta(() => fn('formularioDesdeMovimiento')(mov({ viajes: null })));
  eq('1.4 renglón con todo en null → campos vacíos (nunca «null»)', [fNulos.hora, fNulos.placa, fNulos.viajes, fNulos.transportista?.texto],
    ['', '', '', '']);

  // m³ calculado cuando se deja vacío (la regla es m3De de la librería).
  eq('1.4 m³ calculado: 3 viajes × 14 m³ = 42', intenta(() => fn('m3Calculado')({ ...f1, m3: '' })), 42);
  eq('1.4 m³ calculado: sin capacidad → null', intenta(() => fn('m3Calculado')({ ...f1, capacidad: '' })), null);
  eq('1.4 m³ escrito manda sobre el calculado', intenta(() => fn('m3Calculado')({ ...f1, m3: '40' })), 40);
}

// ── 1.5 La unidad: elegirla de la flota o escribir su placa ──
{
  const f0 = intenta(() => fn('formularioNuevo')('2026-10-22'));
  const e = intenta(() => fn('elegirUnidad')(f0, unidades[1]));
  eq('⭐ 1.5 elegir de la flota: vincula, copia el texto, la placa y la capacidad', [e.unidadId, e.unidadTexto, e.placa, e.capacidad],
    ['u2', 'V-01', 'A12BC', '14']);
  const sinCap = intenta(() => fn('elegirUnidad')({ ...f0, capacidad: '9' }, unidades[2]));
  eq('1.5 una unidad sin capacidad no borra la escrita', sinCap.capacidad, '9');
  const des = intenta(() => fn('elegirUnidad')(e, null));
  eq('1.5 desvincular: queda el texto, se va el id', [des.unidadId, des.unidadTexto, des.placa], [null, 'V-01', 'A12BC']);

  const p1 = intenta(() => fn('escribirPlaca')(f0, ' a12-bc ', unidades));
  eq('⭐ 1.5 escribir una placa de la flota la vincula sola (y llena lo vacío)', [p1.unidadId, p1.placa, p1.unidadTexto, p1.capacidad],
    ['u2', ' a12-bc ', 'V-01', '14']);
  const p2 = intenta(() => fn('escribirPlaca')(p1, 'b77cd', unidades));
  eq('1.5 cambiar a la placa de OTRA unidad: cambia el vínculo y lo que venía de la anterior', [p2.unidadId, p2.unidadTexto, p2.capacidad],
    ['u6', 'V-06', '18']);
  const p3 = intenta(() => fn('escribirPlaca')(p2, 'Q1', unidades));
  eq('1.5 una placa que no está desvincula y limpia lo que venía de la unidad', [p3.unidadId, p3.unidadTexto, p3.capacidad], [null, '', '']);
  const p4 = intenta(() => fn('escribirPlaca')({ ...f0, unidadTexto: 'Volteo prestado', capacidad: '12' }, 'A12BC', unidades));
  eq('1.5 lo que ella escribió a mano no se pisa al vincular', [p4.unidadId, p4.unidadTexto, p4.capacidad], ['u2', 'Volteo prestado', '12']);
  const p5 = intenta(() => fn('escribirPlaca')(f0, 'A12BC', [unidades[0]]));
  eq('1.5 la placa de una dada de baja NO se vincula', p5.unidadId, null);

  // A2 (lote 2): escribir en PLACA solo desvincula cuando el vínculo vino de ESA placa (la
  // unidad está activa, tiene placa y la placa escrita era la suya). Si no, lo elegido se queda.
  const pala = unidad('u7', { placa: null, codigo: 'PALA-3', capacidadM3: 8 });
  const deBaja = unidad('u8', { placa: 'Q-77', codigo: 'V-08', capacidadM3: 10, activo: false });
  const flotaA2 = [...unidades, pala, deBaja];
  const elegida = intenta(() => fn('elegirUnidad')(f0, pala));
  const a2 = intenta(() => fn('escribirPlaca')(elegida, 'X', flotaA2));
  eq('⭐ 1.5 A2: elegir «PALA-3» (sin placa) y escribir una letra en PLACA NO pierde la unidad ni su capacidad',
    [a2.unidadId, a2.unidadTexto, a2.capacidad, a2.placa], ['u7', 'PALA-3', '8', 'X']);
  const a2b = intenta(() => fn('escribirPlaca')(a2, 'b77cd', flotaA2));
  eq('1.5 A2: …pero escribir la placa de OTRA unidad activa sí cambia el vínculo', [a2b.unidadId, a2b.unidadTexto, a2b.capacidad], ['u6', 'V-06', '18']);
  // Agravante del refutador: editar un renglón de una unidad DADA DE BAJA y retocar su placa.
  const renglonDeBaja = intenta(() => fn('formularioDesdeMovimiento')(mov({ unidadId: 'u8', unidadTexto: 'V-08', placa: 'Q-77', capacidadM3: 10 })));
  const borraUna = intenta(() => fn('escribirPlaca')(renglonDeBaja, 'Q-7', flotaA2));
  const laVuelve = intenta(() => fn('escribirPlaca')(borraUna, 'Q-77', flotaA2));
  eq('⭐ 1.5 A2: renglón de una unidad dada de baja: borrar un carácter de la placa NO vacía la unidad ni quita el vínculo',
    [borraUna.unidadId, borraUna.unidadTexto, borraUna.capacidad], ['u8', 'V-08', '10']);
  eq('⭐ 1.5 A2: …y volver a escribirlo tampoco', [laVuelve.unidadId, laVuelve.unidadTexto, laVuelve.capacidad, laVuelve.placa], ['u8', 'V-08', '10', 'Q-77']);
  // Un renglón viejo cuya unidad cambió de placa en la flota: el vínculo no vino de esta placa.
  const viejo = intenta(() => fn('formularioDesdeMovimiento')(mov({ unidadId: 'u6', unidadTexto: 'V-06', placa: 'OLD-1', capacidadM3: 18 })));
  const tocaViejo = intenta(() => fn('escribirPlaca')(viejo, 'OLD-', flotaA2));
  eq('1.5 A2: renglón viejo de una unidad que cambió de placa: retocar la placa conserva el vínculo',
    [tocaViejo.unidadId, tocaViejo.unidadTexto, tocaViejo.capacidad], ['u6', 'V-06', '18']);
  // Sin la flota cargada todavía (la unidad no se encuentra), tampoco se desvincula.
  const sinFlota = intenta(() => fn('escribirPlaca')(renglonDeBaja, 'Q-7', []));
  eq('1.5 A2: si la flota no llegó (no se encuentra la unidad), el vínculo se queda', [sinFlota.unidadId, sinFlota.unidadTexto], ['u8', 'V-08']);
  eq('1.5 textoDeUnidad: código; sin código, la descripción; sin nada, la placa',
    intenta(() => [fn('textoDeUnidad')(unidades[1]), fn('textoDeUnidad')(unidad('x', { codigo: '', descripcion: 'Volteo', placa: 'P1' })), fn('textoDeUnidad')(unidad('y', { codigo: '', placa: 'P1' }))]),
    ['V-01', 'Volteo', 'P1']);
}

// ── 1.6 El rango rápido (jornada de hoy, semana desde el lunes, mes desde el día 1) ──
{
  const r = (q, hoy) => intenta(() => fn('rangoRapido')(q, hoy));
  eq('1.6 hoy', r('hoy', '2026-10-22'), { desde: '2026-10-22', hasta: '2026-10-22' });
  eq('1.6 semana (jueves) → desde el lunes', r('semana', '2026-10-22'), { desde: '2026-10-19', hasta: '2026-10-22' });
  eq('1.6 semana (domingo) → desde el lunes anterior', r('semana', '2026-10-25'), { desde: '2026-10-19', hasta: '2026-10-25' });
  eq('1.6 semana (lunes) → ese mismo lunes', r('semana', '2026-10-19'), { desde: '2026-10-19', hasta: '2026-10-19' });
  eq('1.6 mes → desde el día 1', r('mes', '2026-10-22'), { desde: '2026-10-01', hasta: '2026-10-22' });
  eq('1.6 semana que cruza el mes', r('semana', '2026-11-01'), { desde: '2026-10-26', hasta: '2026-11-01' });
}

// ── 1.7 Opciones de los filtros (la MISMA regla de unidad que el corte) ──
{
  const base = [
    mov({ id: 'a', unidadId: 'u2', unidadTexto: 'V-01', placa: 'A12BC', transportista: 'Transportista A' }),
    mov({ id: 'b', unidadId: null, unidadTexto: 'Volteo a mano', placa: 'a12bc', transportista: ' transportista a ' }), // misma placa: es de u2
    mov({ id: 'c', unidadId: null, unidadTexto: 'Prestado', placa: 'P9', transportista: 'Transportista B' }),
    mov({ id: 'd', unidadId: null, unidadTexto: '', placa: null, transportista: '' }), // sin unidad ni transportista
  ];
  const ops = intenta(() => fn('opcionesUnidad')(base, unidades));
  eq('⭐ 1.7 opciones de unidad: el renglón suelto con la placa de una vinculada cae en ella', Array.isArray(ops) ? ops.map((o) => o.clave) : ops,
    ['p9', 'u2']);
  eq('1.7 * las etiquetas: la de la flota (código · placa) y la del texto congelado', Array.isArray(ops) ? ops.map((o) => o.etiqueta) : ops,
    ['Prestado · P9', 'V-01 · A12BC']);
  eq('1.7 opciones de texto: lo escrito distinto es una sola opción (la primera forma), A→Z, sin vacíos',
    intenta(() => fn('opcionesTexto')(base, 'transportista')), ['Transportista A', 'Transportista B']);
  // A3 (lote 2): el renglón suelto «A12-BC» con un vinculado «A12BC» NO es otra unidad.
  const conGuion = [
    mov({ id: 'v', unidadId: 'u2', unidadTexto: 'V-01', placa: 'A12BC' }),
    mov({ id: 's', unidadId: null, unidadTexto: 'Volteo a mano', placa: 'A12-BC' }),
  ];
  const opsG = intenta(() => fn('opcionesUnidad')(conGuion, unidades));
  eq('⭐ 1.7 A3: «A12-BC» suelto y «A12BC» vinculado son UNA sola unidad en el filtro', Array.isArray(opsG) ? opsG.map((o) => o.clave) : opsG, ['u2']);
}

// ── 1.7b «Vincular a unidad»: lo que avisa antes de confirmar (A9/B3, lote 2) ──
{
  const base = [
    mov({ id: 'a', unidadId: null, placa: 'P1' }),
    mov({ id: 'b', unidadId: 'u3', unidadTexto: 'V-03', placa: 'ZZ99' }), // ya es de OTRA unidad
    mov({ id: 'c', unidadId: 'u2', unidadTexto: 'V-01' }),                 // ya es de la elegida
    mov({ id: 'd', unidadId: 'u4', unidadTexto: 'V-04' }),                 // de otra unidad y además oculto
  ];
  const filtrados = base.slice(0, 3); // «d» quedó fuera del filtro de ahora
  const r = intenta(() => fn('resumenVincular')(['a', 'b', 'c', 'd'], base, filtrados, 'u2'));
  eq('⭐ 1.7b cuenta los ya vinculados a OTRA unidad y los que el filtro no muestra', r, { total: 4, deOtraUnidad: 2, ocultos: 1 });
  const msg = intenta(() => fn('mensajeVincular')(r, 'V-01 (A12BC)'));
  ok('⭐ 1.7b el aviso dice cuántos cambian de unidad', /2 ya están vinculados a otra unidad/.test(msg), msg);
  ok('⭐ 1.7b el aviso dice cuántos no se ven con los filtros', /1 no se ve con los filtros/.test(msg), msg);
  ok('1.7b el aviso sigue diciendo cuántos y a cuál', /¿Vincular 4 renglones a V-01 \(A12BC\)\?/.test(msg), msg);
  const limpio = intenta(() => fn('mensajeVincular')(fn('resumenVincular')(['a'], base, filtrados, 'u2'), 'V-01'));
  ok('1.7b sin nada raro, sin avisos de más', /^¿Vincular 1 renglón a V-01\?/.test(limpio) && !/⚠️/.test(limpio), limpio);
}

// ── 1.7c B7 (lote 2): una respuesta vieja no pisa a la nueva ──
{
  const r = intenta(() => {
    const s = fn('secuenciaDePedidos')();
    const hoy = s.nuevo();     // «Hoy» sale primero…
    const mes = s.nuevo();     // …y enseguida «Este mes»
    const otra = fn('secuenciaDePedidos')(); // otra lista lleva su propia cuenta
    otra.nuevo();
    return [s.vigente(hoy), s.vigente(mes), otra.vigente(1), s.vigente(mes)];
  });
  eq('⭐ 1.7c B7: solo el ÚLTIMO pedido está vigente (la respuesta de «Hoy» que llega tarde se descarta)', r, [false, true, true, true]);
}

// ── 1.7d R2 (lote 2): el sitio activo no cambia solo ──
{
  const s = (id, nombre) => ({ id, nombre, nota: null, activo: true, ubicacionId: null });
  const antes = [s('b', 'CDT Bravo')];
  const despues = [s('a', 'Almacén Alfa'), s('b', 'CDT Bravo')]; // aparece uno que ordena antes
  const el = (actual, lista) => intenta(() => fn('sitioElegido')(actual, lista));
  eq('⭐ 1.7d R2: aparece un sitio nuevo que ordena antes → el elegido sigue siendo el mismo', el(el(null, antes), despues), 'b');
  eq('1.7d R2: sin elegir todavía → el primero (A→Z)', el(null, despues), 'a');
  eq('1.7d R2: el elegido se desactivó (ya no está) → el primero que queda', el('x', despues), 'a');
  eq('1.7d R2: sin sitios activos → ninguno', el('b', []), null);
}

// ── 1.7e Revisión final B-M8: ✍️ Carga libre tampoco anota en una jornada futura ──
{
  const base = { ...fn('formularioNuevo')('2026-10-22'), viajes: '1' };
  const err = (fecha, hoy) => intenta(() => fn('validarCarga')({ ...base, fecha }, hoy).errores.join(' | '));
  ok('⭐ 1.7e B-M8 una jornada posterior a hoy → error (como el 📅 Parte diario)', /todavía no empieza/.test(err('2026-10-23', '2026-10-22')), err('2026-10-23', '2026-10-22'));
  eq('1.7e B-M8 hoy y días anteriores valen', [err('2026-10-22', '2026-10-22'), err('2026-10-01', '2026-10-22')], ['', '']);
  eq('1.7e B-M8 sin «hoy» (quien no lo pasa) no cambia nada', err('2030-01-01'), '');
}

// ── 1.7f Revisión final B-M2: ¿quedó algo escrito sin guardar? (antes de tirarlo, se pregunta) ──
{
  const f0 = fn('formularioNuevo')('2026-10-22');
  const sin = (f, partida, editando) => intenta(() => fn('formularioSinGuardar')(f, partida, editando));
  eq('⭐ 1.7f B-M2 el formulario de partida no tiene nada sin guardar', sin(f0, f0, false), false);
  eq('⭐ 1.7f B-M2 con algo escrito, sí', [sin({ ...f0, toneladas: '12' }, f0, false), sin({ ...f0, destino: { texto: 'Terraza 2', listaId: 'l3' } }, f0, false)], [true, true]);
  eq('1.7f B-M2 en un renglón NUEVO, cambiar solo el día no es «escrito» (la lista del día cambia con él)', sin({ ...f0, fecha: '2026-10-21' }, f0, false), false);
  eq('1.7f B-M2 al EDITAR, cambiar el día sí lo es', sin({ ...f0, fecha: '2026-10-21' }, f0, true), true);
  eq('1.7f B-M2 tras «Guardar y otro» lo que quedó puesto es la partida, no algo sin guardar', intenta(() => {
    const serie = fn('formularioTrasGuardar')({ ...f0, transportista: { texto: 'Transportista A', listaId: 'l7' }, toneladas: '9' }, false, true);
    return [fn('formularioSinGuardar')(serie, serie, false), fn('formularioSinGuardar')({ ...serie, viajes: '2' }, serie, false)];
  }), [false, true]);
  eq('1.7f B-M2 el mismo texto de lista con otro id también cuenta', sin({ ...f0, material: { texto: '', listaId: 'l8' } }, f0, false), true);
}

// ── 1.7g Revisión final B-I3: 📋 Registros solo muestra (y exporta) la base del rango pedido ──
{
  const lista = (b, rango, error = null) => intenta(() => fn('baseLista')(b, rango, error));
  const HOY = { desde: '2026-10-24', hasta: '2026-10-24' };
  const MES = { desde: '2026-10-01', hasta: '2026-10-24' };
  const deHoy = { desde: '2026-10-24', hasta: '2026-10-24', movs: [mov()] };
  eq('⭐ 1.7g B-I3 la base cargada es del rango pedido → lista', lista(deHoy, HOY), true);
  eq('⭐ 1.7g B-I3 tocó «Este mes» y la base todavía es la de hoy → NO lista (ni totales ni Excel)', lista(deHoy, MES), false);
  eq('⭐ 1.7g B-I3 la carga falló → NO lista (aunque la base vieja sea del mismo rango)', lista(deHoy, HOY, 'No se pudieron cargar los registros.'), false);
  eq('1.7g B-I3 todavía no cargó nada → NO lista', lista(null, HOY), false);
}

// ── 1.8 Las filas del Excel ──
{
  const base = [
    mov({ id: 'a', fecha: '2026-10-22', hora: '06:30:00', unidadTexto: 'V-01', placa: 'A12BC', viajes: 3, capacidadM3: 14, toneladas: 42.5,
      transportista: 'Transportista A', origen: 'Frente Sur', destino: 'Terraza 2', observacion: '<b>&</b>' }),
    mov({ id: 'b', tipo: 'salida', estado: 'por_confirmar', viajes: null, unidadTexto: 'Prestado' }),
  ];
  const filas = intenta(() => fn('filasExcel')(base));
  ok('1.8 encabezado + una fila por renglón + total', Array.isArray(filas) && filas.length === 4, JSON.stringify(filas).slice(0, 200));
  if (Array.isArray(filas)) {
    eq('1.8 encabezado', filas[0], ['Fecha', 'Hora', 'Tipo', 'Unidad', 'Placa', 'Transportista', 'Origen', 'Destino', 'Material',
      'Capacidad (m³)', 'Viajes', 'Toneladas', 'm³', 'Bloques', 'Estado', 'Observación', 'Cargó', 'Editó']);
    eq('1.8 la fila: fecha dd/mm/aaaa, cifras como NÚMERO, m³ calculado, texto literal', filas[1],
      ['22/10/2026', '06:30', 'Entrada', 'V-01', 'A12BC', 'Transportista A', 'Frente Sur', 'Terraza 2', '', 14, 3, 42.5, 42, '', 'Confirmado', '<b>&</b>', '', '']);
    eq('1.8 lo vacío sale vacío (nunca «null» ni NaN)', filas[2].slice(9, 15), ['', '', '', '', '', 'Por confirmar']);
    eq('1.8 la fila de total usa totalesDe y textoViajes', filas[3].slice(0, 1).concat(filas[3].slice(10, 13)), ['TOTAL', '3 (+1 pendiente)', 42.5, 42]);
  }
  // ⭐ Revisión final A#4: las celdas siguen LA regla del 📋 Listado y del TOTAL. Toneladas
  //    solo si está confirmado (lo que espera pesaje no tiene peso neto); m³ vacío si está
  //    por confirmar (no suma). Así quien suma la columna en Excel llega al TOTAL.
  const conPendientes = intenta(() => fn('filasExcel')([
    mov({ id: 'e', tipo: 'salida', estado: 'esperando_pesaje', viajes: 1, m3: 8, toneladas: 12 }),
    mov({ id: 'c', tipo: 'salida', estado: 'por_confirmar', viajes: 2, capacidadM3: 10, toneladas: 5 }),
    mov({ id: 'k', tipo: 'salida', estado: 'confirmado', viajes: 1, capacidadM3: 10, toneladas: 13 }),
  ]));
  if (Array.isArray(conPendientes)) {
    eq('⭐ 1.8 A#4 «esperando pesaje»: sin toneladas en la celda (el TOTAL tampoco las cuenta), sus m³ sí', [conPendientes[1][11], conPendientes[1][12]], ['', 8]);
    eq('⭐ 1.8 A#4 «por confirmar»: sin m³ ni toneladas en la celda (no suman), sus viajes sí se ven', [conPendientes[2][10], conPendientes[2][11], conPendientes[2][12]], [2, '', '']);
    eq('1.8 A#4 confirmado: sus toneladas y sus m³ (viajes × capacidad)', [conPendientes[3][11], conPendientes[3][12]], [13, 10]);
    const sumaCol = (i) => conPendientes.slice(1, -1).reduce((s, f) => s + (typeof f[i] === 'number' ? f[i] : 0), 0);
    eq('⭐ 1.8 A#4 la columna sumada da el TOTAL (toneladas y m³)', [sumaCol(11), sumaCol(12)], [conPendientes[4][11], conPendientes[4][12]]);
  } else ok('1.8 A#4 filasExcel con pendientes', false, String(conPendientes));
  // L5-A4: la producción y la venta de bloques salen legibles y con sus piezas.
  const conBloques = intenta(() => fn('filasExcel')([
    mov({ id: 'p', tipo: 'produccion', material: 'Bloques', cantidad: 120, viajes: null, unidadIngresada: 'u' }),
    mov({ id: 'v', tipo: 'salida', material: 'Bloques', cantidad: 40, viajes: null, destino: 'Cliente X', unidadIngresada: 'u' }),
  ]));
  if (Array.isArray(conBloques)) {
    eq('⭐ 1.8 L5-A4 la producción sale «Producción» con sus 120 bloques (y sin viajes)', [conBloques[1][2], conBloques[1][10], conBloques[1][13]], ['Producción', '', 120]);
    eq('1.8 L5-A4 * la venta de bloques, con sus 40', [conBloques[2][2], conBloques[2][13]], ['Salida', 40]);
  } else ok('1.8 L5-A4 filasExcel con bloques', false, String(conBloques));
}

// ── 1.10 L5-A4: la producción y las ventas de bloques en las pestañas que ya existían ──
{
  eq('⭐ 1.10 L5-A4 etiquetaTipo: la producción se lee «Producción» (no la clave cruda)', intenta(() => fn('etiquetaTipo')('produccion')), 'Producción');
  ok('1.10 * con su ícono 🧱 en el catálogo de etiquetas (ETIQUETAS_TIPO)', C.ETIQUETAS_TIPO?.find?.((t) => t.key === 'produccion')?.ico === '🧱');
  ok('⭐ 1.10 * pero NO es una pastilla de ✍️ Carga libre (TIPOS_MOV sigue con cuatro)',
    Array.isArray(C.TIPOS_MOV) && C.TIPOS_MOV.length === 4 && !C.TIPOS_MOV.some((t) => t.key === 'produccion'));
  ok('1.10 * el filtro de 📋 Registros sí la ofrece (TIPOS_FILTRO)', C.TIPOS_FILTRO?.some?.((t) => t.key === 'produccion'));
  eq('1.10 los demás tipos siguen igual', ['entrada', 'interno', 'salida', 'otro'].map((t) => intenta(() => fn('etiquetaTipo')(t))), ['Entrada', 'Interno', 'Salida', 'Otro']);
  eq('1.10 textoBloques', [1, 120, 1500].map((n) => intenta(() => fn('textoBloques')(n))), ['1 bloque', '120 bloques', '1.500 bloques']);
  eq('⭐ 1.10 textoViajesRenglon: «viajes por confirmar» SOLO si el renglón está por confirmar',
    [mov({ viajes: null, estado: 'por_confirmar' }), mov({ tipo: 'produccion', viajes: null, cantidad: 120 }), mov({ viajes: 3 }), mov({ viajes: 1 })]
      .map((m) => intenta(() => fn('textoViajesRenglon')(m))),
    ['viajes por confirmar', '', '3 viajes', '1 viaje']);
  eq('1.10 bloquesDe: suma las piezas de lo que las trae (producción y ventas)', intenta(() => fn('bloquesDe')([
    mov({ tipo: 'produccion', cantidad: 120, viajes: null }), mov({ tipo: 'salida', cantidad: 40, viajes: null }), mov({ viajes: 2 }),
  ])), 160);
  const aviso = (m) => intenta(() => fn('avisoEdicionBloques')(m));
  ok('⭐ 1.10 avisoEdicionBloques: una producción NO se edita en Carga libre (dice dónde)', /📅 Parte diario/.test(String(aviso(mov({ tipo: 'produccion', cantidad: 120, viajes: null })))) && /🧱 Bloques/.test(String(aviso(mov({ tipo: 'produccion', cantidad: 120, viajes: null })))));
  ok('⭐ 1.10 * una venta de bloques (salida con piezas) tampoco', typeof aviso(mov({ tipo: 'salida', cantidad: 40, viajes: null })) === 'string');
  eq('1.10 * una salida o una entrada normal sí (null)', [aviso(mov({ tipo: 'salida', viajes: 2 })), aviso(mov({ viajes: 1 }))], [null, null]);
}

// ── 1.11 L5-B17: pegar «lat, lng» como lo copia Google Maps se reparte en los dos campos ──
{
  const par = (t) => intenta(() => fn('parDeCoordenadas')(t));
  eq('⭐ 1.11 L5-B17 «10.6012, -66.9301» (coma + espacio)', par('10.6012, -66.9301'), { lat: '10.6012', lng: '-66.9301' });
  eq('1.11 * con coma decimal y punto y coma', par(' 10,6012; -66,9301 '), { lat: '10,6012', lng: '-66,9301' });
  eq('1.11 * con coma decimal y coma + espacio', par('10,6012, -66,9301'), { lat: '10,6012', lng: '-66,9301' });
  eq('1.11 * con espacios de más', par('10.6012 ,   -66.9301'), { lat: '10.6012', lng: '-66.9301' });
  eq('⭐ 1.11 * una sola cifra con coma decimal NO es un par', par('10,6012'), null);
  eq('1.11 * una sola cifra con punto tampoco', par('-66.9301'), null);
  eq('1.11 * vacío o basura → null', [par(''), par('hola, mundo'), par('1, 2, 3')], [null, null, null]);
}

// ── 1.9 La librería es pura: solo importa ./centroOperaciones y ./text ──
{
  const src = leer(RUTA_LIB);
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((x) => x[1]);
  ok('⭐ 1.9 importa solo ./centroOperaciones y ./text', imports.length > 0 && imports.every((i) => ['./centroOperaciones', './text'].includes(i)), imports.join(', '));
  ok('1.9 sin require() ni React ni Supabase', !/require\(|from 'react|supabase/.test(src));
}

// ═══════════════════ (2) CANDADOS SOBRE LAS PANTALLAS ═══════════════════

const DIR = 'src/components/centroOperaciones';
const cargar = leer(`${DIR}/CargarTab.tsx`);
const registros = leer(`${DIR}/RegistrosTab.tsx`);
const campo = leer(`${DIR}/CampoSugerido.tsx`);
const pantalla = leer('src/screens/CentroOperacionesScreen.tsx');

ok('(2) existen CargarTab, RegistrosTab y CampoSugerido', !!cargar && !!registros && !!campo);

/** ¿Cada aparición de `patron` está dentro de un `try {` todavía sin cerrar por su `catch`? */
function dentroDeTry(src, patron) {
  const usos = [...src.matchAll(patron)];
  if (!usos.length) return false;
  return usos.every((u) => {
    const antes = src.slice(0, u.index);
    const t = antes.lastIndexOf('try {');
    return t >= 0 && !/\bcatch\b/.test(antes.slice(t));
  });
}

// ── 2.1 El borrador en el equipo ──
{
  ok('⭐ 2.1 CargarTab guarda el borrador con la clave cop_borrador_<sitioId>', /`cop_borrador_\$\{sitio\.id\}`/.test(cargar));
  ok('2.1 * con el almacenamiento del equipo (AsyncStorage)', /from '@react-native-async-storage\/async-storage'/.test(cargar));
  ok('⭐ 2.1 todo setItem / getItem / removeItem va dentro de try/catch',
    dentroDeTry(cargar, /AsyncStorage\.setItem\(/g) && dentroDeTry(cargar, /AsyncStorage\.getItem\(/g) && dentroDeTry(cargar, /AsyncStorage\.removeItem\(/g));
  const removes = [...cargar.matchAll(/AsyncStorage\.removeItem\(/g)].length;
  ok('2.1 removeItem aparece una sola vez (en borrarBorrador)', removes === 1, `veces ${removes}`);
  const llamadas = [...cargar.matchAll(/await borrarBorrador\(\)/g)];
  const guardado = cargar.indexOf('await guardarMovimiento(');
  ok('⭐ 2.1 el borrador se borra SOLO después de guardar con éxito (una sola llamada, después de guardarMovimiento)',
    llamadas.length === 1 && guardado > 0 && llamadas[0].index > guardado, `llamadas ${llamadas.length}`);
  if (llamadas.length === 1 && guardado > 0) {
    const entre = cargar.slice(guardado, llamadas[0].index);
    // Entre guardar y borrar hay un catch que SALE (return): borrar no está en el catch.
    ok('2.1 * y no dentro del catch del guardado (el catch termina con return)', /catch[\s\S]*?return;[\s\S]*?\}/.test(entre));
  }
  ok('2.1 si falla el guardado, lo escrito queda como borrador', /guardarBorrador\(/.test(cargar));
  // A14 (lote 2): (1) guardarBorrador dice si quedó, y el aviso depende de eso;
  // (2) el borrador se borra SOLO si lo que se guardó con éxito ES el borrador (el formulario
  // que falló o el recuperado), no cualquier renglón nuevo guardado después de un ✏️.
  const gb = cuerpoDe(cargar, 'guardarBorrador');
  ok('⭐ 2.1 A14: guardarBorrador devuelve si quedó (true / false)', /Promise<boolean>/.test(gb) && /return true;/.test(gb) && /return false;/.test(gb), gb.trim().slice(0, 160));
  ok('⭐ 2.1 A14: el aviso del fallo sale de avisoFalloGuardar con lo que devolvió guardarBorrador', /avisoFalloGuardar\(\s*msg\s*,\s*!!editando\s*,\s*quedo\s*\)/.test(cargar));
  ok('2.1 A14: existe la marca formEsBorrador (useRef)', /const formEsBorrador = useRef\(false\)/.test(cargar));
  ok('⭐ 2.1 A14: el borrador se borra solo si el formulario guardado era el borrador', /if \(!editando && formEsBorrador\.current\) await borrarBorrador\(\)/.test(cargar));
  ok('2.1 A14: la marca se prende al fallar un renglón nuevo y al recuperar el borrador', (cargar.match(/formEsBorrador\.current = true/g) || []).length >= 2);
  // B6 (lote 2, la parte barata): un guardado «fallido» que sí entró no se duplica sin que
  // se vea: tras el fallo se recarga lo del día, y el aviso del borrador recuperado pide
  // revisar lo cargado ese día antes de guardarlo.
  {
    const g = cuerpoDe(cargar, 'guardar');
    const catchG = /catch\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/.exec(g)?.[1] ?? '';
    ok('⭐ 2.1 B6: tras un guardado fallido se recarga lo del día (recargarDia() en el catch)', /\brecargarDia\(\)/.test(catchG), catchG.trim().slice(0, 160));
    ok('⭐ 2.1 B6: el aviso del borrador recuperado pide revisar lo cargado ese día antes de guardarlo',
      /Se recuperó lo que no se pudo guardar[^<]*revisa lo cargado ese día[^<]*antes de guardarlo/i.test(cargar));
  }
  ok('2.1 A14: …y se apaga con ✏️ y con Cancelar', /formEsBorrador\.current = false/.test(cuerpoDe(cargar, 'editarDelDia')) && /formEsBorrador\.current = false/.test(cuerpoDe(cargar, 'cancelarEdicion')));
}

// ── 2.1b B1 (lote 2): mientras se guarda, ✏️ y 🗑️ de la lista del día no hacen nada ──
{
  // Lo PRIMERO que hacen (antes de cualquier otra cosa; los comentarios no cuentan).
  const primero = (nombre) => /=>\s*\{\s*(?:\/\/[^\n]*\n\s*)*if \(guardando[^)]*\) return;/.test(cuerpoDe(cargar, nombre));
  ok('⭐ 2.1b B1: editarDelDia no hace nada mientras se guarda', primero('editarDelDia'), cuerpoDe(cargar, 'editarDelDia').trim().slice(0, 160));
  ok('⭐ 2.1b B1: borrar tampoco', primero('borrar'));
  ok('⭐ 2.1b B1: los ✏️/🗑️ de la lista del día se apagan mientras se guarda',
    /onEditar=\{!guardando && /.test(cargar) && /onBorrar=\{!guardando && /.test(cargar));
  const g = cuerpoDe(cargar, 'guardar');
  ok('⭐ 2.1b B1: al guardar con éxito SIEMPRE se sale de «editando» y el siguiente formulario sale de lo guardado',
    /setEditando\(null\);\s*\n\s*setForm\(formularioTrasGuardar\(form, !!editando, otro\)\)/.test(g), g.slice(-400));
}

// ── 2.2 Cargar ──
{
  ok('2.2 CargarTab acepta movimientoAEditar?: Movimiento', /movimientoAEditar\?:\s*Movimiento/.test(cargar));
  ok('2.2 el día por defecto es caracasBusinessToday()', /caracasBusinessToday\(\)/.test(cargar));
  ok('2.2 la fecha se elige con DateField', /from '\.\.\/DateField'/.test(cargar) && /<DateField/.test(cargar));
  ok('2.2 valida y arma el renglón con validarCarga', /validarCarga\(/.test(cargar));
  ok('2.2 la placa se vincula sola (escribirPlaca)', /escribirPlaca\(/.test(cargar));
  // (B1, lote 2: ahora pasa por formularioTrasGuardar, que usa formularioParaOtro — 1.4 B1.)
  ok('2.2 «Guardar y otro» usa formularioParaOtro (vía formularioTrasGuardar)', /formularioTrasGuardar\(/.test(cargar) && /Guardar y otro/.test(cargar)
    && /formularioParaOtro\(guardado\)/.test(leer(RUTA_LIB)));
  ok('2.2 avisa las toneladas con «esperando pesaje» y ofrece confirmar', /avisoPesaje\(/.test(cargar) && /confirmado/.test(cargar));
  ok('2.2 los errores van al toast (useToast)', /useToast\(\)/.test(cargar) && /toast\.error\(/.test(cargar));
  ok('2.2 origen y destino sugieren según el tipo', /sugerenciasOrigenDestino\(/.test(cargar));
  // A11 (lote 2): lo cargado ese día va en el orden de la JORNADA (la madrugada al final).
  ok('⭐ 2.2 A11: la lista del día se ordena con cmpMovimientoJornada', /\.sort\(cmpMovimientoJornada\)/.test(cargar));
  ok('2.2 usa CampoSugerido para transportista, origen, destino y material', (cargar.match(/<CampoSugerido/g) || []).length >= 4);
  // A12/B13 (lote 2): Cargar solo usa frentes y obras: no baja el catálogo de máquinas.
  {
    const llamadas = [...cargar.matchAll(/sugerenciasDelSistema\(([^)]*)\)/g)].map((x) => x[1]);
    ok('⭐ 2.2 A12: Cargar pide las sugerencias SIN el catálogo de máquinas ({ maquinas: false })',
      llamadas.length > 0 && llamadas.every((a) => /maquinas:\s*false/.test(a)), llamadas.join(' | '));
  }
}

/** El texto de `const <nombre> = …` hasta la siguiente constante del componente. */
function cuerpoDe(src, nombre) {
  const i = src.search(new RegExp(`\\n  const ${nombre} = `));
  if (i < 0) return '';
  const j = src.slice(i + 1).search(/\n  const \w+ = |\n  \/\/ ── /);
  return j < 0 ? src.slice(i) : src.slice(i, i + 1 + j);
}

// ── 2.3 Permisos de ✏️ y 🗑️ ──
for (const [nombre, src, recarga] of [['CargarTab', cargar, 'recargarDia'], ['RegistrosTab', registros, 'recargar']]) {
  // A15/B5 (lote 2): si el borrado falla (el renglón ya no existe), la lista se refresca:
  // si no, el renglón fantasma sigue ahí y el error se repite.
  const catchBorrar = /catch\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/.exec(cuerpoDe(src, 'borrar'))?.[1] ?? '';
  ok(`⭐ 2.3 A15 ${nombre}: si 🗑️ falla, la lista se vuelve a cargar (${recarga}() en el catch)`, new RegExp(`\\b${recarga}\\(\\)`).test(catchBorrar), catchBorrar.trim().slice(0, 120));
  ok(`⭐ 2.3 ${nombre}: 🗑️ solo con nivel === 'full'`, /nivel === 'full'/.test(src) && /borrarMovimiento\(/.test(src));
  ok(`2.3 ${nombre}: borrar pide confirmación (useConfirm)`, /useConfirm\(\)/.test(src) && /await confirm\(/.test(src));
  ok(`2.3 ${nombre}: editar pide escritura (levelMeets … 'escritura')`, /levelMeets\(nivel, 'escritura'\)/.test(src));
}

// ── 2.4 Registros ──
{
  // A5 (lote 2): UNA sola base. Los totales salen de LA MISMA lista que se pinta (los
  // filtrados), y el filtro y las opciones de unidad reciben la base del período entera.
  ok('⭐ 2.4 filtra la base del período (filtrarMovimientos(base, …))', /filtrarMovimientos\(\s*base\s*,/.test(registros));
  ok('⭐ 2.4 A5: los totales salen de lo filtrado (totalesDe(filtrados)), la misma lista que se pinta',
    /totalesDe\(\s*filtrados\s*\)/.test(registros) && !/totalesDe\(\s*base\s*\)/.test(registros) && /textoViajes\(/.test(registros));
  ok('⭐ 2.4 A5: las opciones de unidad salen de la base entera (opcionesUnidad(base, …))', /opcionesUnidad\(\s*base\s*,/.test(registros));
  ok('2.4 A5: lo que se pinta y lo que se exporta son los filtrados', /\[\.\.\.filtrados\]/.test(registros) && /filasExcel\(\s*filtrados\s*\)/.test(registros));
  ok('⭐ 2.4 no inventa su propia regla de pertenencia a una unidad', !/\.unidadId\s*===|===\s*\w+\.unidadId/.test(registros));
  ok('2.4 rango con pastillas y DateField', /rangoRapido\(/.test(registros) && /<DateField/.test(registros));
  // A11 (lote 2): la base va en el orden de la jornada (así sale el Excel) y la lista la
  // muestra al revés (lo más reciente arriba: la madrugada encima de las 23:00).
  ok('⭐ 2.4 A11: la base se ordena con cmpMovimientoJornada', /\.sort\(cmpMovimientoJornada\)/.test(registros));
  ok('2.4 A11: …y la lista la pinta al revés', /\[\.\.\.filtrados\]\.reverse\(\)/.test(registros));
  ok('2.4 ✏️ abre Cargar con movimientoAEditar', /<CargarTab[\s\S]*?movimientoAEditar=/.test(registros));
  ok('2.4 selección múltiple + «Vincular a unidad»', /vincularUnidad\(/.test(registros) && /Vincular a unidad/.test(registros));
  // B4 (lote 2): si vincular queda a medias, la lista se refresca (se ve el 🔗 de los que sí
  // quedaron) y, si entraron menos de los pedidos, se dice «n de N».
  {
    const v = cuerpoDe(registros, 'vincular');
    const catchV = /catch\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/.exec(v)?.[1] ?? '';
    ok('⭐ 2.4 B4: si vincular falla, la lista se vuelve a cargar (recargar() en el catch)', /\brecargar\(\)/.test(catchV), catchV.trim().slice(0, 120));
    ok('2.4 B4: si quedaron menos de los pedidos, el aviso dice «n de N»', /\$\{n\} de \$\{/.test(v));
    // A9/B3 (lote 2): el aviso antes de vincular sale de la librería (cuenta los que cambian
    // de unidad y los que el filtro no muestra) con la MISMA base y los filtrados que se ven.
    ok('⭐ 2.4 B3: el confirm de vincular usa resumenVincular(seleccion, base, filtrados, …) y mensajeVincular',
      /resumenVincular\(\s*seleccion\s*,\s*base\s*,\s*filtrados\s*,/.test(v) && /mensajeVincular\(/.test(v));
  }
  ok('2.4 Excel con buildXlsx y la copia local de downloadBytes', /buildXlsx\(/.test(registros) && /function downloadBytes\(/.test(registros) && /filasExcel\(/.test(registros));
  ok('2.4 A→Z con cmpText', /cmpText/.test(registros) || /cmpText/.test(leer(RUTA_LIB)));
}

// ── 2.4b Lote 5 (F1a): A4 y B15 en ✍️ Carga libre y 📋 Registros ──
{
  const fila = (() => {
    const i = cargar.indexOf('export function FilaMovimiento');
    const j = cargar.indexOf('export function CargarTab');
    return i >= 0 && j > i ? cargar.slice(i, j) : '';
  })();
  ok('⭐ 2.4b L5-A4 la fila pinta el tipo con el catálogo de etiquetas (🧱 Producción incluida)', /ETIQUETAS_TIPO\.find\(/.test(fila) && !/TIPOS_MOV\.find\(/.test(fila));
  ok('⭐ 2.4b L5-A4 * los viajes con textoViajesRenglon («por confirmar» solo si lo está) y las piezas con textoBloques',
    /textoViajesRenglon\(m\)/.test(fila) && /textoBloques\(/.test(fila) && !/m\.viajes === null \? 'viajes por confirmar'/.test(fila));
  // Revisión final A#1: el aviso sale de `dondeSeCorrige` (bloques Y salidas del 📅 Parte diario).
  ok('⭐ 2.4b L5-A4 + A#1 * producción, ventas de bloques y salidas del Parte diario: sin ✏️, con el aviso de dónde se corrigen (dondeSeCorrige)',
    /dondeSeCorrige\(m\)/.test(fila) && /onEditar && !dondeCorregir/.test(fila) && /onEditar && dondeCorregir \?/.test(fila));
  const e = cuerpoDe(cargar, 'editarDelDia');
  ok('2.4b L5-A4 + A#1 * y editarDelDia tampoco abre uno que se corrige en el Parte diario', /if \(dondeSeCorrige\(m\)\) return;/.test(e), e.trim().slice(0, 200));
  ok('2.4b L5-A4 + A#1 Registros: ✏️ no abre un renglón que se corrige en el Parte diario (la fila dice dónde)',
    /if \(dondeSeCorrige\(m\)\) return;/.test(cuerpoDe(registros, 'editar')) && /setEditando\(m\);/.test(cuerpoDe(registros, 'editar')) && /onEditar=\{levelMeets\(nivel, 'escritura'\) \? \(\) => editar\(m\)/.test(registros));
  ok('⭐ 2.4b A#1 Carga libre y Registros toman LA regla de salidasParteDiario (sin copia)',
    /import \{[^}]*\bdondeSeCorrige\b[^}]*\} from '\.\/salidasParteDiario'/.test(cargar) && /import \{[^}]*\bdondeSeCorrige\b[^}]*\} from '\.\/salidasParteDiario'/.test(registros)
    && !/avisoEdicionBloques/.test(cargar) && !/avisoEdicionBloques/.test(registros));
  ok('⭐ 2.4b L5-A4 Registros: el filtro y el resumen por tipo incluyen 🧱 Producción (TIPOS_FILTRO)',
    /TIPOS_FILTRO\.map\(\(t\) => \(\{ clave: t\.key/.test(registros) && /TIPOS_FILTRO\.map\(\(t\) => \(\{ t, tot:/.test(registros) && !/TIPOS_MOV\.map/.test(registros));
  ok('2.4b L5-A4 Registros: el resumen dice las piezas (bloquesDe), no «0 viajes» para la producción', /bloquesDe\(/.test(registros) && /textoBloques\(/.test(registros));
  ok('⭐ 2.4b L5-B15 Carga libre dice «Patio» (ya no «Terraza») en origen y destino', !/'Terraza'/.test(cargar) && (cargar.match(/'Patio'/g) || []).length >= 2);
}

// ── 2.5 CampoSugerido devuelve { texto, listaId } ──
{
  ok('2.5 CampoSugerido devuelve { texto, listaId }', /listaId/.test(campo) && /texto/.test(campo) && /itemDeLista\(/.test(campo));
  ok('2.5 la sugerencia se toma con onPressIn (en web el blur gana al click)', /onPressIn=/.test(campo));
  // Revisión final B-M6: en el teléfono, deslizar la página con el dedo sobre una sugerencia
  // la elegía (onPressIn en el primer contacto). En nativo se elige con onPress (un
  // desplazamiento lo cancela); onPressIn queda SOLO para la web.
  ok('⭐ 2.5 B-M6 onPressIn solo en la web; en nativo, onPress', /const enWeb = Platform\.OS === 'web'/.test(campo)
    && /onPressIn=\{enWeb \? /.test(campo) && /onPress=\{enWeb \? undefined : /.test(campo));
  // A13 (lote 2): con onPressIn, el primer toque para desplazar ya elige. Con 5 opciones
  // (unos 170 px) caben en la caja de 180 px sin desplazar: nada se elige por error.
  const max = Number(/const MAX_SUGERENCIAS = (\d+)/.exec(campo)?.[1]);
  ok('⭐ 2.5 A13: se muestran a lo más 5 sugerencias (caben sin desplazar)', max === 5, `MAX_SUGERENCIAS = ${max}`);
}

// ── 2.5b Revisión final: B-M8, B-M1, B-M2 y B-I3 en las pantallas ──
{
  // B-M8: Carga libre no anota en una jornada futura (el calendario no deja y validarCarga tampoco).
  ok('⭐ 2.5b B-M8 el calendario de Carga libre no pasa de hoy (maxISO)', /<DateField value=\{form\.fecha\}.*maxISO=\{caracasBusinessToday\(\)\}/.test(cargar));
  ok('⭐ 2.5b B-M8 * y validarCarga recibe la jornada de hoy', /validarCarga\(form, caracasBusinessToday\(\)\)/.test(cuerpoDe(cargar, 'guardar')));
  // B-M1: «Lo cargado el …» nunca muestra los renglones de otro día (ni si la carga falla).
  const rd = cuerpoDe(cargar, 'recargarDia');
  ok('⭐ 2.5b B-M1 lo del día se guarda con SU fecha ({ fecha, movs })', /setDelDia\(\{ fecha, movs: /.test(rd), rd.slice(0, 300));
  ok('⭐ 2.5b B-M1 * y solo se muestra si es la del formulario y no hubo error', /delDia\.fecha === form\.fecha && !errorDia/.test(cargar));
  ok('2.5b B-M1 * el error de la carga queda escrito en la tarjeta (no solo en el toast)', /setErrorDia\(msg\)/.test(rd) && /No se pudo cargar lo del \{dmy\(form\.fecha\)\}/.test(cargar));
  // B-M2: ✏️, «Cancelar» y «← Volver» no tiran lo escrito sin preguntar.
  ok('⭐ 2.5b B-M2 ✏️ en otro renglón pregunta antes de descartar lo escrito', /formularioSinGuardar\(form, partida\.current, !!editando\) && !\(await confirm\(DESCARTAR\)\)\) return;/.test(cuerpoDe(cargar, 'editarDelDia')));
  ok('2.5b B-M2 * «Cancelar» también', /formularioSinGuardar\(form, partida\.current, !!editando\) && !\(await confirm\(DESCARTAR\)\)\) return;/.test(cuerpoDe(cargar, 'cancelarEdicion')));
  ok('2.5b B-M2 * la partida se fija con cada formulario nuevo (✏️, cancelar, guardar, borrar el que se editaba)', (cargar.match(/partida\.current = /g) || []).length >= 4);
  ok('⭐ 2.5b B-M2 Registros: «← Volver a los registros» pregunta si quedó algo sin guardar', /alSinGuardar=\{marcarEdicion\}/.test(registros)
    && /edicionSucia\.current && !\(await confirm\(/.test(cuerpoDe(registros, 'volver')) && /onPress=\{volver\}/.test(registros));
  // B-I3: Registros no muestra ni exporta la base de otro rango.
  ok('⭐ 2.5b B-I3 Registros guarda de QUÉ rango es lo cargado y usa baseLista', /setDelRango\(\{ desde, hasta, movs: /.test(cuerpoDe(registros, 'recargar')) && /baseLista\(delRango, rango, error\)/.test(registros));
  ok('⭐ 2.5b B-I3 * el 📥 Excel espera a la base del rango', /if \(!listo \|\| cargando\)/.test(cuerpoDe(registros, 'exportar')) && /Espera a que carguen los registros del rango/.test(registros));
  ok('2.5b B-I3 * vincular también espera', /if \(!listo\)/.test(cuerpoDe(registros, 'vincular')));
  ok('2.5b B-I3 * los totales se apagan mientras tanto («—»)', /listo \? textoViajes\(totales\) : '—'/.test(registros));
}

// ── 2.6 Aislamiento: las pantallas no hablan con Supabase ──
for (const [nombre, src] of [['CargarTab', cargar], ['RegistrosTab', registros], ['CampoSugerido', campo]]) {
  ok(`⭐ 2.6 ${nombre} no importa supabase ni llama .from(`, !/supabase/.test(src) && !/\.from\(/.test(src));
}

// ── 2.6b A1 + A5 parte 2 (lote 2): Cargar y Registros refrescan al enfocar y al deslizar ──
// El spec §8: «refresca al entrar y al deslizar». Igual que Flota y Ajustes: las cargas
// dependen del OBJETO `sitio` (la pantalla lo vuelve a crear en cada recarga: al entrar y
// al deslizar) y corren con useFocusEffect.
for (const [nombre, src, cargas] of [
  ['CargarTab', cargar, [['cargarDatos', /\}, \[sitio\]\);/], ['recargarDia', /\}, \[sitio, form\.fecha, incrustado\]\);/]]],
  ['RegistrosTab', registros, [['recargar', /\}, \[sitio, rango\.desde, rango\.hasta\]\);/]]],
]) {
  ok(`⭐ 2.6b A1 ${nombre}: refresca al enfocarse (useFocusEffect)`, /useFocusEffect\(/.test(src) && /from '@react-navigation\/native'/.test(src));
  ok(`⭐ 2.6b A1 ${nombre}: ninguna carga depende solo de sitio.id (el deslizar recrea el objeto sitio)`, !/\[sitio\.id[\],]/.test(src));
  for (const [fnNombre, deps] of cargas) {
    ok(`2.6b A1 ${nombre}: ${fnNombre} depende del objeto sitio y corre al enfocarse`,
      deps.test(cuerpoDe(src, fnNombre)) && new RegExp(`useFocusEffect\\(useCallback\\(\\(\\) => \\{ ${fnNombre}\\(\\); \\}, \\[${fnNombre}\\]\\)\\)`).test(src),
      cuerpoDe(src, fnNombre).slice(-80));
  }
}
ok('2.6b A1: la pantalla ya no se presenta como «esqueleto»', !/esqueleto/.test(pantalla));

// ── 2.6d R2 (lote 2): el sitio se fija al recargar y Cargar dice en cuál se escribe ──
ok('⭐ 2.6d R2: la pantalla fija el sitio al recargar (setSitioId((id) => sitioElegido(id, …)))',
  /setSitioId\(\(id\) => sitioElegido\(id, /.test(cuerpoDe(pantalla, 'recargar')), cuerpoDe(pantalla, 'recargar').slice(0, 200));
ok('⭐ 2.6d R2: la cabecera de ✍️ Cargar nombra el sitio («✍️ Nuevo renglón · 📍 …»)', /✍️ Nuevo renglón · 📍 \{sitio\.nombre\}/.test(cargar));

// ── 2.6c B7 (lote 2): con más recargas (A1), una respuesta vieja no pisa a la nueva ──
for (const [nombre, src, fnNombre, pone] of [
  // (Revisión final B-I3: lo cargado se guarda con su rango, `setDelRango`.)
  ['RegistrosTab', registros, 'recargar', 'setDelRango('],
  ['CargarTab', cargar, 'recargarDia', 'setDelDia('],
  ['CargarTab', cargar, 'cargarDatos', 'setUnidades('],
]) {
  const c = cuerpoDe(src, fnNombre);
  const i = c.indexOf(pone);
  ok(`⭐ 2.6c B7 ${nombre}.${fnNombre}: pide un número (secuenciaDePedidos) y descarta la respuesta que ya no es la última`,
    /secuenciaDePedidos\(\)/.test(src) && /\.nuevo\(\)/.test(c) && i > 0 && /if \(!\w+\.vigente\(n\)\) return;/.test(c.slice(0, i)), c.slice(0, 220));
  ok(`2.6c B7 ${nombre}.${fnNombre}: …también en el error`, /catch[\s\S]*?if \(!\w+\.vigente\(n\)\) return;/.test(c));
}

// ── 2.7 La pantalla usa las pestañas de verdad ──
{
  // R1 (lote 2): en el teléfono, el ScrollView de `Screen` (defecto 'never') se tragaba el
  // primer toque sobre una sugerencia (cerraba el teclado y la lista se iba). `Screen` gana
  // un prop OPCIONAL, sin defecto nuevo (ninguna otra pantalla cambia), y esta lo usa.
  const ui = leer('src/components/ui.tsx');
  ok('⭐ 2.7 R1: Screen acepta keyboardShouldPersistTaps opcional', /keyboardShouldPersistTaps\?:\s*'always'\s*\|\s*'never'\s*\|\s*'handled'/.test(ui));
  ok('2.7 R1: …sin defecto nuevo (solo se pasa al ScrollView si llegó)', !/keyboardShouldPersistTaps\s*=\s*['"]/.test(ui)
    && /\.\.\.\(keyboardShouldPersistTaps \? \{ keyboardShouldPersistTaps \} : null\)/.test(ui));
  ok('⭐ 2.7 R1: la pantalla del módulo pasa keyboardShouldPersistTaps="handled"', /<Screen\b[^>]*keyboardShouldPersistTaps="handled"/.test(pantalla));
  ok('2.7 la pantalla importa CargarTab y RegistrosTab de components/centroOperaciones',
    /from '\.\.\/components\/centroOperaciones\/CargarTab'/.test(pantalla) && /from '\.\.\/components\/centroOperaciones\/RegistrosTab'/.test(pantalla));
  ok('2.7 * y ya no tiene sus marcadores «En construcción»', !/function CargarTab\(/.test(pantalla) && !/function RegistrosTab\(/.test(pantalla));
}

console.log(`${fail === 0 ? '✅' : '❌'} test-centro-operaciones-carga · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Cargar y Registros cumplen: sugerencias por tipo, placa que se vincula sola, borrador seguro y permisos.');
