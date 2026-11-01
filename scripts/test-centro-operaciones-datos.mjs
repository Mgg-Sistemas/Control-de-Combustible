// 🏭 Pruebas de la CAPA DE DATOS del Centro de Operaciones (23-oct-2026).
//
// `src/lib/centroOperacionesDb.ts` es el ÚNICO archivo del módulo que habla con
// Supabase, y solo puede ESCRIBIR en tablas `cop_*`. Acá se prueba:
//   · Bloque 1 → las traducciones fila ↔ objeto (ida y vuelta, sin sello).
//   · Bloque 2 → ⭐ el candado estático: qué tablas toca y con qué verbo.
//   · Bloque 3 → el comportamiento de cada función contra un Supabase FALSO que
//     anota cada llamada (nada sale a la red: el `./supabase` de verdad necesita
//     React Native y las variables de entorno, así que el cargador lo cambia por
//     el falso de abajo).
//
// ⭐ Todos los datos son SINTÉTICOS: nada de empresas, placas ni cifras reales
//    (el repositorio es público).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

// ═══════════════════ El Supabase FALSO (anota, no envía) ═══════════════════
// Cada `supabase.from(t)` crea un registro { tabla, ops: [[verbo, args], …] } y
// devuelve un constructor que acepta CUALQUIER verbo encadenado. Al esperarlo
// (`await`) contesta lo que diga `responder(registro)`. `selectAllRows` anota la
// tabla, las columnas, los filtros que le aplicó el `filter` y el orden.
const registros = [];
const lecturas = [];
let responder = () => ({ data: [], error: null });
let responderLectura = () => [];

const anotador = (ll) => {
  const b = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') {
        return (res, rej) => {
          let r;
          try { r = responder(ll); } catch (e) { return Promise.reject(e).then(res, rej); }
          return Promise.resolve(r).then(res, rej);
        };
      }
      return (...args) => { ll.ops.push([String(prop), args]); return b; };
    },
  });
  return b;
};
const anotadorFiltro = (ll) => {
  const b = new Proxy({}, { get(_, prop) { return (...args) => { ll.ops.push([String(prop), args]); return b; }; } });
  return b;
};
const SUPABASE_FALSO = {
  isSupabaseConfigured: true,
  supabase: {
    from(tabla) { const ll = { tabla, ops: [] }; registros.push(ll); return anotador(ll); },
    rpc() { throw new Error('rpc prohibido en el Centro de Operaciones'); },
  },
  async selectAllRows(tabla, columnas, filter, orderBy = 'id') {
    const ll = { tabla, columnas, orderBy, ops: [] };
    lecturas.push(ll);
    if (filter) filter(anotadorFiltro(ll));
    return responderLectura(ll);
  },
};
const reiniciar = () => {
  registros.length = 0;
  lecturas.length = 0;
  responder = () => ({ data: [], error: null });
  responderLectura = () => [];
};

// ═══════════════════ Cargador de TypeScript (con ./supabase falso) ═══════════════════
const SUPABASE_REAL = path.join(ROOT, 'src', 'lib', 'supabase');
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
      if (p === SUPABASE_REAL) return SUPABASE_FALSO;
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
/** Igual que JSON, pero las llaves de cada objeto en orden: {a,b} = {b,a}.
 *  Las listas sí conservan su orden (el A→Z se prueba de verdad). */
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
};
const eq = (name, got, want) => {
  const g = JSON.stringify(canon(got)), w = JSON.stringify(canon(want));
  if (g === w) pass++; else { fail++; failures.push(`${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const cerrar = () => {
  console.log(`\n${fail === 0 ? '✅' : '❌'} test-centro-operaciones-datos · ${pass} ok · ${fail} fallando`);
  if (fail) { console.log('\n' + failures.map((f) => `  ✗ ${f}`).join('\n')); process.exit(1); }
};

const SRC_DB = path.join(ROOT, 'src/lib/centroOperacionesDb.ts');
let D;
try {
  D = loadTs(SRC_DB);
} catch (e) {
  ok(`centroOperacionesDb.ts carga (${String(e?.message ?? e).split('\n')[0]})`, false);
  cerrar();
}

/** Los argumentos del primer verbo `nombre` del registro (o undefined). */
const argsDe = (ll, nombre) => ll?.ops.find(([v]) => v === nombre)?.[1];
const verbos = (ll) => (ll?.ops ?? []).map(([v]) => v);
/** Espera que la promesa FALLE y devuelve el error (o null si no falló). */
const fallo = async (p) => { try { await p; return null; } catch (e) { return e; } };

const SELLO_FILA = ['created_by', 'created_by_nombre', 'created_at', 'updated_by_nombre', 'updated_at'];
const SELLO_OBJ = ['creadoPor', 'creadoAt', 'editadoPor', 'editadoAt'];
const NO_SE_GUARDO = 'No se guardó: no tienes permiso o se perdió la conexión.';

// Ids sintéticos con forma de uuid.
const SITIO = '00000000-0000-4000-8000-000000000001';
const SITIO_2 = '00000000-0000-4000-8000-000000000002';
const UNIDAD = '00000000-0000-4000-8000-0000000000a1';
const MOV_1 = '00000000-0000-4000-8000-0000000000b1';
const MOV_2 = '00000000-0000-4000-8000-0000000000b2';
const LISTA_T = '00000000-0000-4000-8000-0000000000c1';
const LISTA_O = '00000000-0000-4000-8000-0000000000c2';
const LISTA_D = '00000000-0000-4000-8000-0000000000c3';
const LISTA_M = '00000000-0000-4000-8000-0000000000c4';

// ——— 1. Traducciones fila ↔ objeto ———
const movCompleto = {
  id: MOV_1,
  sitioId: SITIO,
  fecha: '2026-01-15',
  hora: '06:30:00',
  tipo: 'entrada',
  unidadId: UNIDAD,
  unidadTexto: 'U-01',
  placa: 'AAA00A',
  transportista: 'Transportista A',
  transportistaId: LISTA_T,
  origen: 'Frente Norte',
  origenId: LISTA_O,
  destino: 'Terraza 1',
  destinoId: LISTA_D,
  material: 'Material X',
  materialId: LISTA_M,
  capacidadM3: 12.5,
  viajes: 3,
  toneladas: 41.25,
  m3: 37.5,
  estado: 'esperando_pesaje',
  observacion: 'Nota con <ángulos> & "comillas"',
  chofer: 'Chofer Sintético',
  km: 37.4,
  vehiculo: 'propio',
  cantidad: 15,
  unidadIngresada: 'm3',
  disponibleDesde: '2026-01-22',
  creadoPor: 'Persona Uno',
  creadoAt: '2026-01-15T10:00:00Z',
  editadoPor: 'Persona Dos',
  editadoAt: '2026-01-15T11:00:00Z',
};
const fila = D.movimientoAFila(movCompleto);
const vuelta = D.filaAMovimiento(fila);
const camposNoSello = Object.keys(movCompleto).filter((k) => !SELLO_OBJ.includes(k));
for (const k of camposNoSello) eq(`ida y vuelta conserva «${k}»`, vuelta[k], movCompleto[k]);
ok('⭐ movimientoAFila NO lleva columnas de sello (las pone la base)', SELLO_FILA.every((c) => !(c in fila)));
eq('ida y vuelta: el sello vuelve vacío (no viajó)', SELLO_OBJ.map((k) => vuelta[k]), [null, null, null, null]);
eq('movimientoAFila usa las columnas reales de cop_movimientos (con las del Parte diario)', Object.keys(fila).sort(), [
  'cantidad', 'capacidad_m3', 'chofer', 'destino', 'destino_lista_id', 'disponible_desde', 'estado', 'fecha', 'hora', 'id', 'km',
  'm3', 'material', 'material_lista_id', 'observacion', 'origen', 'origen_lista_id', 'placa', 'sitio_id', 'tipo', 'toneladas',
  'transportista', 'transportista_lista_id', 'unidad_id', 'unidad_ingresada', 'unidad_texto', 'vehiculo', 'viajes',
]);
eq('PD1: las columnas del Parte diario viajan con su nombre de la base',
  [fila.chofer, fila.km, fila.vehiculo, fila.cantidad, fila.unidad_ingresada, fila.disponible_desde],
  ['Chofer Sintético', 37.4, 'propio', 15, 'm3', '2026-01-22']);

const movNulos = {
  id: MOV_2, sitioId: SITIO, fecha: '2026-01-16', hora: null, tipo: 'salida', unidadId: null, unidadTexto: 'Sin alta',
  placa: null, transportista: null, transportistaId: null, origen: null, origenId: null, destino: null, destinoId: null,
  material: null, materialId: null, capacidadM3: null, viajes: null, toneladas: null, m3: null, estado: 'por_confirmar',
  observacion: null, chofer: null, km: null, vehiculo: null, cantidad: null, unidadIngresada: null, disponibleDesde: null,
};
const vueltaNulos = D.filaAMovimiento(D.movimientoAFila(movNulos));
ok('ida y vuelta con todo lo opcional en null', Object.keys(movNulos).every((k) => vueltaNulos[k] === movNulos[k]));

eq('Partial: solo viaja lo que se pasó (no borra otras columnas)', D.movimientoAFila({ estado: 'confirmado' }), { estado: 'confirmado' });
eq('Partial: el sello se ignora aunque venga', D.movimientoAFila({ creadoPor: 'X', editadoAt: 'Y', observacion: 'ok' }), { observacion: 'ok' });
eq('PD1: producción: tipo «produccion», sin viajes y con cantidad viaja tal cual',
  D.movimientoAFila({ tipo: 'produccion', viajes: null, cantidad: 120, unidadIngresada: 'u', disponibleDesde: '2026-01-22' }),
  { tipo: 'produccion', viajes: null, cantidad: 120, unidad_ingresada: 'u', disponible_desde: '2026-01-22' });
eq('PD1: vehículo, unidad escrita, fecha disponible y chofer en blanco → null (los checks de la base no aceptan «»)',
  D.movimientoAFila({ vehiculo: '', unidadIngresada: ' ', disponibleDesde: '', chofer: '  ' }),
  { vehiculo: null, unidad_ingresada: null, disponible_desde: null, chofer: null });
eq('hora y uuids en blanco → null (la base no acepta «»)',
  D.movimientoAFila({ hora: '', unidadId: ' ', transportistaId: '', origenId: '', destinoId: '', materialId: '' }),
  { hora: null, unidad_id: null, transportista_lista_id: null, origen_lista_id: null, destino_lista_id: null, material_lista_id: null });

const deLaBase = D.filaAMovimiento({
  id: MOV_1, sitio_id: SITIO, fecha: '2026-01-15', hora: '08:00:00', tipo: 'interno', unidad_id: null, unidad_texto: 'U-02',
  placa: null, transportista: null, transportista_lista_id: null, origen: 'Terraza 1', origen_lista_id: null,
  destino: 'Terraza 2', destino_lista_id: null, material: null, material_lista_id: null,
  capacidad_m3: '14.00', viajes: 2, toneladas: 'basura', m3: null, estado: 'confirmado', observacion: null,
  chofer: 'Chofer Sintético', km: '12.50', vehiculo: 'externo', cantidad: '3', unidad_ingresada: 't', disponible_desde: '2026-01-20',
  created_by: '00000000-0000-4000-8000-0000000000ff', created_by_nombre: 'Persona Uno', created_at: '2026-01-15T12:00:00Z',
  updated_by_nombre: 'Persona Dos', updated_at: '2026-01-15T13:00:00Z',
});
eq('de la base: el sello se lee (creadoPor/creadoAt/editadoPor/editadoAt)',
  [deLaBase.creadoPor, deLaBase.creadoAt, deLaBase.editadoPor, deLaBase.editadoAt],
  ['Persona Uno', '2026-01-15T12:00:00Z', 'Persona Dos', '2026-01-15T13:00:00Z']);
eq('de la base: numeric que llega como texto «14.00» → 14', deLaBase.capacidadM3, 14);
eq('de la base: cifra ilegible → null, nunca NaN', deLaBase.toneladas, null);
eq('de la base: m3 null sigue null (lo calcula la librería)', deLaBase.m3, null);
eq('PD1: de la base: km y cantidad que llegan como texto → número; el resto tal cual',
  [deLaBase.chofer, deLaBase.km, deLaBase.vehiculo, deLaBase.cantidad, deLaBase.unidadIngresada, deLaBase.disponibleDesde],
  ['Chofer Sintético', 12.5, 'externo', 3, 't', '2026-01-20']);
ok('PD1: una fila vieja sin las columnas nuevas → todas null (nunca undefined ni NaN)',
  ['chofer', 'km', 'vehiculo', 'cantidad', 'unidadIngresada', 'disponibleDesde'].every((k) => D.filaAMovimiento({ id: MOV_1 })[k] === null));

// Sitio, unidad e ítem de lista: ida y vuelta con sus columnas reales.
const sitio = { id: SITIO, nombre: 'Sitio de prueba', nota: 'n', activo: true, ubicacionId: SITIO_2, lat: 10.123456, lng: -66.654321 };
eq('sitio: ida y vuelta (con su GPS)', D.filaASitio(D.sitioAFila(sitio)), sitio);
eq('sitio: columnas reales', Object.keys(D.sitioAFila(sitio)).sort(), ['activo', 'id', 'lat', 'lng', 'nombre', 'nota', 'ubicacion_id']);
eq('PD1: sitio sin GPS → lat y lng null', [D.filaASitio({ id: SITIO, nombre: 'x' }).lat, D.filaASitio({ id: SITIO, nombre: 'x' }).lng], [null, null]);
const unidad = {
  id: UNIDAD, sitioId: SITIO, origen: 'catalogo', machineryId: SITIO_2, codigo: 'U-01', descripcion: 'Volteo',
  placa: 'AAA00A', serial: 'S-0001', marca: 'Marca X', modelo: 'Modelo Y', dueno: 'Transportista A',
  capacidadM3: 12, activo: true, nota: null,
  estado: 'averiada', estadoNota: 'Caucho espichado', estadoAt: '2026-01-15T14:00:00Z', chofer: 'Chofer Sintético',
};
eq('unidad: ida y vuelta (estadoAt NO viaja: lo pone la base)', D.filaAUnidad(D.unidadAFila(unidad)), { ...unidad, estadoAt: null });
eq('unidad: columnas reales (sin estado_at)', Object.keys(D.unidadAFila(unidad)).sort(), [
  'activo', 'capacidad_m3', 'chofer', 'codigo', 'descripcion', 'dueno', 'estado', 'estado_nota', 'id', 'machinery_id', 'marca',
  'modelo', 'nota', 'origen', 'placa', 'serial', 'sitio_id',
]);
ok('⭐ PD1: unidadAFila nunca manda estado_at (lo pone el trigger al cambiar el estado)', !('estado_at' in D.unidadAFila({ id: UNIDAD, estadoAt: 'X' })));
eq('PD1: de la base: estado_at se LEE', D.filaAUnidad({ ...D.unidadAFila(unidad), estado_at: '2026-01-16T08:00:00Z' }).estadoAt, '2026-01-16T08:00:00Z');
// ⭐ M3 (mesa de maquinaria): sin estado es «SIN MARCA» (null): en una vinculada manda
//    inspección. Antes se inventaba 'disponible' y tapaba las averías de inspección.
eq('⭐ M3: una unidad sin estado es «sin marca» (null), NUNCA «disponible»',
  [D.filaAUnidad({ id: UNIDAD, codigo: 'U-01' }).estado, D.filaAUnidad({ id: UNIDAD, codigo: 'U-01', estado: null }).estado,
    D.filaAUnidad({ id: UNIDAD, codigo: 'U-01', estado: '  ' }).estado], [null, null, null]);
eq('M3: un estado que no es una marca conocida tampoco se inventa (null); las dos marcas pasan',
  [D.filaAUnidad({ estado: 'en_reparacion' }).estado, D.filaAUnidad({ estado: 'averiada' }).estado, D.filaAUnidad({ estado: 'disponible' }).estado],
  [null, 'averiada', 'disponible']);
eq('M3: unidadAFila con estado null lo manda null (soltar la marca / reactivar una vinculada)', D.unidadAFila({ estado: null, estadoNota: null }), { estado: null, estado_nota: null });
const item = { id: LISTA_T, sitioId: null, clase: 'transportista', nombre: 'Transportista A', activo: true, lat: null, lng: null, km: null, factorTM3: null, diasDisponible: null };
eq('ítem de lista general (sitio null): ida y vuelta', D.filaAItemLista(D.itemListaAFila(item)), item);
eq('ítem de lista: columnas reales', Object.keys(D.itemListaAFila(item)).sort(), ['activo', 'clase', 'dias_disponible', 'factor_t_m3', 'id', 'km', 'lat', 'lng', 'nombre', 'sitio_id']);
const destinoGps = { id: LISTA_D, sitioId: SITIO, clase: 'destino', nombre: 'Destino X', activo: true, lat: 10.5, lng: -66.9, km: 42.3, factorTM3: null, diasDisponible: null };
eq('PD1: destino con GPS y km: ida y vuelta', D.filaAItemLista(D.itemListaAFila(destinoGps)), destinoGps);
const materialFactor = { id: LISTA_M, sitioId: SITIO, clase: 'material', nombre: 'Bloques', activo: true, lat: null, lng: null, km: null, factorTM3: 1.2, diasDisponible: 7 };
eq('PD1: material con factor y días: ida y vuelta', D.filaAItemLista(D.itemListaAFila(materialFactor)), materialFactor);
eq('PD1: de la base: factor y km como texto → número', [D.filaAItemLista({ factor_t_m3: '1.20', km: '42.30', dias_disponible: 7 }).factorTM3,
  D.filaAItemLista({ factor_t_m3: '1.20', km: '42.30', dias_disponible: 7 }).km, D.filaAItemLista({ dias_disponible: 7 }).diasDisponible], [1.2, 42.3, 7]);

// ——— 2. ⭐ Candado estático: solo se escribe en cop_*, sin rpc ———
const srcCrudo = fs.readFileSync(SRC_DB, 'utf8');
// Sin comentarios, para que una explicación no dispare (ni esconda) el candado.
const src = srcCrudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const AJENAS_PERMITIDAS = ['machinery', 'companies', 'viaje_frentes', 'ubicaciones_obra'];
const ESCRITURA = /\.(insert|update|upsert|delete)\(/;

// (`Array.from(` no es una consulta: se descuenta.)
const usosFrom = [...src.matchAll(/(?<!Array)\.from\(/g)];
const fromLiterales = [...src.matchAll(/\.from\(\s*'([^']+)'\s*\)/g)];
ok('⭐ todo .from( nombra su tabla con un texto fijo (nada de variables)', usosFrom.length > 0 && usosFrom.length === fromLiterales.length);
const cadenas = fromLiterales.map((x) => {
  const resto = src.slice(x.index);
  const fin = resto.indexOf(';');
  return { tabla: x[1], cadena: fin === -1 ? resto : resto.slice(0, fin) };
});
const escrituras = cadenas.filter((c) => ESCRITURA.test(c.cadena));
ok('hay escrituras que revisar (el candado no está vacío)', escrituras.length >= 4);
ok('⭐ cada .from(…) con insert/update/upsert/delete es una tabla cop_*',
  escrituras.every((c) => c.tabla.startsWith('cop_')));
ok('⭐ toda escritura termina en .select(\'id\') (la RLS rechaza sin error y con 0 filas)',
  escrituras.every((c) => c.cadena.includes(".select('id')")));
ok('⭐ no aparece .rpc(', !/\.rpc\(/.test(src));
const ajenasFrom = cadenas.filter((c) => !c.tabla.startsWith('cop_'));
ok('⭐ las únicas tablas ajenas en .from( son machinery, companies, viaje_frentes y ubicaciones_obra',
  ajenasFrom.every((c) => AJENAS_PERMITIDAS.includes(c.tabla)));
ok('⭐ y a esas ajenas solo se les hace .select(', ajenasFrom.every((c) => c.cadena.includes('.select(') && !ESCRITURA.test(c.cadena)));
const usosSAR = [...src.matchAll(/selectAllRows\(/g)].length;
const sarLiterales = [...src.matchAll(/selectAllRows\(\s*'([^']+)'/g)].map((x) => x[1]);
ok('⭐ todo selectAllRows( nombra su tabla con un texto fijo', usosSAR > 0 && usosSAR === sarLiterales.length);
ok('⭐ selectAllRows solo lee cop_* o las cuatro ajenas permitidas',
  sarLiterales.every((t) => t.startsWith('cop_') || AJENAS_PERMITIDAS.includes(t)));
const importos = [...src.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((x) => x[1]);
// ⭐ M3 (mesa de maquinaria §7): la lista cerrada suma SOLO ./machineLiveStatus (la regla única
//    del estado de inspección), con los nombres exactos de abajo.
ok('importa solo ./supabase, ./centroOperaciones, ./text, el TIPO del Reporte General y ./machineLiveStatus (ni react ni AsyncStorage)',
  importos.includes('./supabase') && importos.every((i) => ['./supabase', './centroOperaciones', './text', './centroOperacionesReporteGeneral', './machineLiveStatus'].includes(i)));
{
  // Lote 6 A1: también el margen de «hora futura» de la lib (la devolución a servicio se aplaza con la misma regla).
  const NOMBRES_LIB = ['fetchAveriaCat', 'fetchJornadaCat', 'fetchInspByShift', 'fetchNovedadesInspeccion', 'makeLiveStatusOf', 'estadoConteoDe', 'ESTADO_CONTEO_INFO', 'MARGEN_HORA_FUTURA_MS'];
  const deLaLib = [...src.matchAll(/^\s*import\s+(type\s+)?\{([^}]*)\}\s*from\s+['"]\.\/machineLiveStatus['"]/gm)];
  const porValor = deLaLib.filter((x) => !x[1]).flatMap((x) => x[2].split(',').map((n) => n.trim()).filter(Boolean));
  const deTipo = deLaLib.filter((x) => x[1]).flatMap((x) => x[2].split(',').map((n) => n.trim()).filter(Boolean));
  eq('⭐ M3: de ./machineLiveStatus importa por valor EXACTAMENTE las 8 piezas permitidas', [...porValor].sort(), [...NOMBRES_LIB].sort());
  eq('M3: * y por tipo solo EstadoConteo y NovedadInspeccion', [...deTipo].sort(), ['EstadoConteo', 'NovedadInspeccion']);
  eq('M3: * en un solo import de valor y uno de tipo (nada escondido)', [deLaLib.length, importos.filter((i) => i === './machineLiveStatus').length], [2, 2]);
  ok('⭐ M3: AJENAS_PERMITIDAS sigue en cuatro (lo de inspección se lee por la librería, no con .from)', AJENAS_PERMITIDAS.length === 4);
}
ok('PD1: de ./centroOperacionesReporteGeneral solo se importa el TIPO (import type: no carga el lector)',
  [...src.matchAll(/^\s*import\s([^;]*?)from\s+['"]\.\/centroOperacionesReporteGeneral['"]/gm)].every((x) => /^type\s/.test(x[1])));
ok('PD1: las escrituras nuevas están en el candado (cop_reportes_generales y cop_unidades)',
  escrituras.filter((c) => c.tabla === 'cop_reportes_generales').length >= 3 && escrituras.filter((c) => c.tabla === 'cop_unidades').length >= 3);
ok('sin require() escondidos', !/require\(/.test(src));

// ——— 3. Comportamiento contra el Supabase falso ———
const run = async () => {
  // 3.1 guardarMovimiento: nuevo → insert, sin id ni sello, con .select('id').
  reiniciar();
  responder = () => ({ data: [{ id: MOV_1 }], error: null });
  const nuevo = { ...movCompleto };
  delete nuevo.id;
  const idNuevo = await D.guardarMovimiento(nuevo);
  let ll = registros[0];
  eq('guardarMovimiento nuevo: devuelve el id que dio la base', idNuevo, MOV_1);
  eq('guardarMovimiento nuevo: va a cop_movimientos con insert y .select(\'id\')', [ll?.tabla, verbos(ll)], ['cop_movimientos', ['insert', 'select']]);
  eq('guardarMovimiento nuevo: pide solo el id', argsDe(ll, 'select'), ['id']);
  const insertado = argsDe(ll, 'insert')?.[0] ?? {};
  ok('⭐ guardarMovimiento nuevo: no manda sello ni id', [...SELLO_FILA, 'id'].every((c) => !(c in insertado)));
  eq('guardarMovimiento nuevo: manda los datos con sus columnas', [insertado.sitio_id, insertado.unidad_texto, insertado.viajes, insertado.estado], [SITIO, 'U-01', 3, 'esperando_pesaje']);

  // 3.2 guardarMovimiento con id → update + eq('id').
  reiniciar();
  responder = () => ({ data: [{ id: MOV_1 }], error: null });
  await D.guardarMovimiento({ id: MOV_1, estado: 'confirmado', toneladas: 40, editadoPor: 'X' });
  ll = registros[0];
  eq('guardarMovimiento existente: update + eq(id) + select', verbos(ll), ['update', 'eq', 'select']);
  eq('guardarMovimiento existente: filtra por su id', argsDe(ll, 'eq'), ['id', MOV_1]);
  eq('guardarMovimiento existente: manda solo lo que cambió, sin id ni sello', argsDe(ll, 'update')?.[0], { estado: 'confirmado', toneladas: 40 });

  // 3.3 0 filas → error exacto; error de la base → Error en español.
  reiniciar();
  responder = () => ({ data: [], error: null });
  let e = await fallo(D.guardarMovimiento({ id: MOV_1, estado: 'confirmado' }));
  eq('⭐ 0 filas (la RLS rechazó callada) → el mensaje exacto', e?.message, NO_SE_GUARDO);
  ok('0 filas → es un Error de verdad', e instanceof Error);
  reiniciar();
  responder = () => ({ data: null, error: null });
  e = await fallo(D.guardarMovimiento({ sitioId: SITIO, fecha: '2026-01-15', tipo: 'entrada', unidadTexto: 'U-01' }));
  eq('data null también es 0 filas', e?.message, NO_SE_GUARDO);
  reiniciar();
  responder = () => ({ data: null, error: { code: '23514', message: 'new row for relation "cop_movimientos" violates check constraint' } });
  e = await fallo(D.guardarMovimiento({ sitioId: SITIO, fecha: '2026-01-15', tipo: 'entrada', unidadTexto: 'U-01', viajes: null }));
  ok('error de la base → Error en español (no el texto en inglés solo)', e instanceof Error && /^No se/.test(e.message));
  reiniciar();
  responder = () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "cop_movimientos"' } });
  e = await fallo(D.guardarMovimiento({ sitioId: SITIO, fecha: '2026-01-15', tipo: 'entrada', unidadTexto: 'U-01' }));
  eq('rechazo de la RLS con error (insert) → el mismo mensaje de permiso', e?.message, NO_SE_GUARDO);
  reiniciar();
  e = await fallo(D.guardarMovimiento({ id: MOV_1 }));
  ok('con id y sin nada que cambiar → falla sin ir a la base', e instanceof Error && registros.length === 0);

  // 3.4 borrarMovimiento.
  reiniciar();
  responder = () => ({ data: [{ id: MOV_1 }], error: null });
  await D.borrarMovimiento(MOV_1);
  ll = registros[0];
  eq('borrarMovimiento: cop_movimientos con delete + eq(id) + select(id)', [ll?.tabla, verbos(ll), argsDe(ll, 'eq'), argsDe(ll, 'select')], ['cop_movimientos', ['delete', 'eq', 'select'], ['id', MOV_1], ['id']]);
  // A15/B5 (lote 2): borrar con 0 filas tiene su PROPIO mensaje (no «No se guardó…»): para
  // quien tiene Full, 0 filas casi siempre es que el renglón ya no existe.
  const NO_SE_BORRO = 'No se borró: no tienes permiso o el renglón ya no existe (actualiza la lista).';
  reiniciar();
  e = await fallo(D.borrarMovimiento(MOV_1));
  eq('⭐ A15: borrarMovimiento: 0 filas → «No se borró…» (su mensaje propio)', e?.message, NO_SE_BORRO);
  eq('A15: …y la capa lo exporta para quien lo necesite', D.NO_SE_BORRO, NO_SE_BORRO);
  reiniciar();
  responder = () => ({ data: null, error: { code: '42501', message: 'permission denied for table cop_movimientos' } });
  e = await fallo(D.borrarMovimiento(MOV_1));
  eq('A15: borrar rechazado por permiso (42501) → también «No se borró…»', e?.message, NO_SE_BORRO);
  reiniciar();
  responder = () => ({ data: null, error: { code: 'PGRST000', message: 'Failed to fetch' } });
  e = await fallo(D.borrarMovimiento(MOV_1));
  ok('A15: sin conexión al borrar → «No se borró el renglón: se perdió la conexión.»', /^No se borró el renglón: se perdió la conexión/.test(e?.message ?? ''));

  // 3.5 vincularUnidad.
  reiniciar();
  responder = (l) => ({ data: (argsDe(l, 'in')?.[1] ?? []).map((id) => ({ id })), error: null });
  const n = await D.vincularUnidad([MOV_1, MOV_2, MOV_1], UNIDAD);
  ll = registros[0];
  eq('vincularUnidad: cuenta los renglones vinculados (sin repetidos)', n, 2);
  eq('vincularUnidad: solo cambia unidad_id (el texto congelado no se toca)', argsDe(ll, 'update')?.[0], { unidad_id: UNIDAD });
  eq('vincularUnidad: in(id, …) sin repetidos y con select(id)', [argsDe(ll, 'in'), argsDe(ll, 'select'), ll?.tabla], [['id', [MOV_1, MOV_2]], ['id'], 'cop_movimientos']);
  reiniciar();
  eq('vincularUnidad sin ids → 0 sin ir a la base', [await D.vincularUnidad([], UNIDAD), registros.length], [0, 0]);
  reiniciar();
  e = await fallo(D.vincularUnidad([MOV_1], UNIDAD));
  eq('vincularUnidad: 0 filas → el mensaje exacto', e?.message, NO_SE_GUARDO);

  // B4 (lote 2): vincular va en lotes de 100. Si un lote falla después de que otro entró,
  // el aviso dice CUÁNTOS quedaron vinculados (no un «No se guardó» a secas).
  const MUCHOS = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
  reiniciar();
  let lote = 0;
  responder = (l) => (lote++ === 0
    ? { data: (argsDe(l, 'in')?.[1] ?? []).map((id) => ({ id })), error: null }
    : { data: null, error: { code: 'PGRST000', message: 'Failed to fetch' } });
  e = await fallo(D.vincularUnidad(MUCHOS, UNIDAD));
  ok('⭐ B4: lote 2 falla tras entrar el 1 → «Se vincularon 100 de 150…»', /Se vincularon 100 de 150/.test(e?.message ?? ''));
  ok('B4: …y dice por qué no entró el resto', /se perdió la conexión/.test(e?.message ?? ''));
  eq('B4: fueron dos lotes (100 + 50)', registros.map((l) => (argsDe(l, 'in')?.[1] ?? []).length), [100, 50]);
  reiniciar();
  responder = () => ({ data: null, error: { code: 'PGRST000', message: 'Failed to fetch' } });
  e = await fallo(D.vincularUnidad(MUCHOS, UNIDAD));
  ok('B4: si el PRIMER lote falla, nada quedó: el aviso de siempre («No se guardó el vínculo…»)', /^No se guardó el vínculo: se perdió la conexión/.test(e?.message ?? ''));

  // 3.6 guardarSitio / guardarUnidad / guardarItemLista.
  reiniciar();
  responder = () => ({ data: [{ id: SITIO }], error: null });
  eq('guardarSitio nuevo: devuelve el id', await D.guardarSitio({ nombre: 'Sitio de prueba', activo: true }), SITIO);
  ll = registros[0];
  eq('guardarSitio nuevo: insert en cop_sitios con sus columnas', [ll?.tabla, verbos(ll), argsDe(ll, 'insert')?.[0]], ['cop_sitios', ['insert', 'select'], { nombre: 'Sitio de prueba', activo: true }]);
  reiniciar();
  responder = () => ({ data: [{ id: SITIO }], error: null });
  await D.guardarSitio({ id: SITIO, activo: false });
  ll = registros[0];
  eq('guardarSitio existente: desactivar = update activo:false (nunca delete)', [verbos(ll), argsDe(ll, 'update')?.[0]], [['update', 'eq', 'select'], { activo: false }]);
  reiniciar();
  responder = () => ({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
  e = await fallo(D.guardarSitio({ nombre: 'Repetido' }));
  ok('guardarSitio: nombre repetido → «Ya existe…» en español', e instanceof Error && /Ya existe/.test(e.message));
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  await D.guardarUnidad({ sitioId: SITIO, origen: 'propia', codigo: 'U-09', capacidadM3: 10 });
  ll = registros[0];
  // ⭐ M3 (D6): una unidad del sitio nace ✅ Disponible (la base exige estado sin vínculo).
  eq('⭐ guardarUnidad nueva del sitio: insert en cop_unidades con estado «disponible» (D6)', [ll?.tabla, argsDe(ll, 'insert')?.[0]],
    ['cop_unidades', { sitio_id: SITIO, origen: 'propia', codigo: 'U-09', capacidad_m3: 10, estado: 'disponible' }]);
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  await D.guardarUnidad({ sitioId: SITIO, origen: 'propia', codigo: 'U-10', estado: 'averiada', estadoNota: 'Sin frenos' });
  eq('M3: * si la del sitio ya trae su marca, va esa', argsDe(registros[0], 'insert')?.[0]?.estado, 'averiada');
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  await D.guardarUnidad({ sitioId: SITIO, origen: 'catalogo', machineryId: SITIO_2, codigo: 'V-01', activo: true });
  ok('⭐ M3: una VINCULADA nace SIN marca (no manda estado: manda inspección)', !('estado' in (argsDe(registros[0], 'insert')?.[0] ?? { estado: 'x' })));
  for (const [nombre, cambio] of [
    ['machineryId', { id: UNIDAD, machineryId: SITIO_2 }],
    ['machineryId null (desvincular)', { id: UNIDAD, machineryId: null, codigo: 'U-01' }],
    ['origen', { id: UNIDAD, origen: 'propia' }],
  ]) {
    reiniciar();
    responder = () => ({ data: [{ id: UNIDAD }], error: null });
    const err = await fallo(D.guardarUnidad(cambio));
    ok(`⭐ M3 (D8): editar con ${nombre} → falla en español SIN ir a la base`, err instanceof Error && /vínculo con el catálogo no se cambia/.test(err.message) && registros.length === 0);
  }
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  await D.guardarUnidad({ id: UNIDAD, activo: true, estado: null, estadoNota: null });
  eq('M3: reactivar una vinculada (cambioAlReactivar) = update de activo y la marca a null', argsDe(registros[0], 'update')?.[0], { activo: true, estado: null, estado_nota: null });
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  await D.guardarUnidad({ id: UNIDAD, codigo: 'U-01', placa: 'AAA00A' });
  eq('M3: editar los datos de una existente NO agrega estado', argsDe(registros[0], 'update')?.[0], { codigo: 'U-01', placa: 'AAA00A' });
  reiniciar();
  e = await fallo(D.guardarUnidad({ id: UNIDAD, activo: false }));
  eq('guardarUnidad: 0 filas (sin full) → el mensaje exacto', e?.message, NO_SE_GUARDO);
  reiniciar();
  responder = () => ({ data: [{ id: LISTA_T }], error: null });
  await D.guardarItemLista({ sitioId: null, clase: 'transportista', nombre: 'Transportista A' });
  ll = registros[0];
  eq('guardarItemLista general: insert con sitio_id null', [ll?.tabla, argsDe(ll, 'insert')?.[0]], ['cop_listas', { sitio_id: null, clase: 'transportista', nombre: 'Transportista A' }]);

  // 3.7 Ajustes: actualizar si existe; si no, insertar. null = general.
  reiniciar();
  responder = (l) => (verbos(l)[0] === 'select' ? { data: [{ id: 'aj-1' }], error: null } : { data: [{ id: 'aj-1' }], error: null });
  await D.guardarAjuste(SITIO, 'presentacion', { texto: 'Hola' });
  eq('guardarAjuste existente: primero busca, luego update', registros.map((l) => [l.tabla, verbos(l)[0]]), [['cop_ajustes', 'select'], ['cop_ajustes', 'update']]);
  ok('guardarAjuste: busca por clave y por sitio', registros[0].ops.some(([v, a]) => v === 'eq' && a[0] === 'clave' && a[1] === 'presentacion') && registros[0].ops.some(([v, a]) => v === 'eq' && a[0] === 'sitio_id' && a[1] === SITIO));
  eq('guardarAjuste existente: update del valor por su id, con select(id)', [argsDe(registros[1], 'update')?.[0], argsDe(registros[1], 'eq'), argsDe(registros[1], 'select')], [{ valor: { texto: 'Hola' } }, ['id', 'aj-1'], ['id']]);
  reiniciar();
  responder = (l) => (verbos(l)[0] === 'select' ? { data: [], error: null } : { data: [{ id: 'aj-2' }], error: null });
  await D.guardarAjuste(null, 'logos', { golden: true });
  eq('guardarAjuste general nuevo: busca con sitio_id IS NULL', registros[0].ops.some(([v, a]) => v === 'is' && a[0] === 'sitio_id' && a[1] === null), true);
  eq('guardarAjuste general nuevo: insert con sitio_id null', [verbos(registros[1])[0], argsDe(registros[1], 'insert')?.[0]], ['insert', { sitio_id: null, clave: 'logos', valor: { golden: true } }]);
  reiniciar();
  responder = (l) => (verbos(l)[0] === 'select' ? { data: [], error: null } : { data: [], error: null });
  e = await fallo(D.guardarAjuste(SITIO, 'titulo_corte', 'Corte'));
  eq('guardarAjuste: 0 filas → el mensaje exacto', e?.message, NO_SE_GUARDO);
  // Dos equipos a la vez: entre buscar e insertar, el otro lo creó → el único
  // rechaza el insert (23505) y se actualiza el que quedó.
  reiniciar();
  let busquedas = 0;
  responder = (l) => {
    const v = verbos(l)[0];
    if (v === 'select') return { data: busquedas++ === 0 ? [] : [{ id: 'aj-9' }], error: null };
    if (v === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
    return { data: [{ id: 'aj-9' }], error: null };
  };
  e = await fallo(D.guardarAjuste(SITIO, 'consideraciones', 'Texto'));
  eq('guardarAjuste: si otro lo creó en el mismo instante, actualiza ese (sin error)',
    [e, registros.map((l) => verbos(l)[0]), argsDe(registros[3], 'eq')], [null, ['select', 'insert', 'select', 'update'], ['id', 'aj-9']]);

  // 3.8 Lecturas.
  reiniciar();
  responderLectura = (l) => (l.tabla === 'cop_ajustes'
    ? [
      { id: 'a1', sitio_id: null, clave: 'presentacion', valor: 'general' },
      { id: 'a2', sitio_id: null, clave: 'logos', valor: { golden: true } },
      { id: 'a3', sitio_id: SITIO, clave: 'presentacion', valor: 'del sitio' },
    ]
    : []);
  eq('cargarAjustes(sitio): lo del sitio pisa a lo general', await D.cargarAjustes(SITIO), { presentacion: 'del sitio', logos: { golden: true } });
  ok('cargarAjustes(sitio): pide el sitio y los generales', lecturas[0]?.tabla === 'cop_ajustes' && verbos(lecturas[0]).includes('or'));
  reiniciar();
  responderLectura = () => [{ id: 'a1', sitio_id: null, clave: 'presentacion', valor: 'general' }];
  eq('cargarAjustes(null): solo los generales', await D.cargarAjustes(null), { presentacion: 'general' });
  ok('cargarAjustes(null): filtra sitio_id IS NULL', lecturas[0]?.ops.some(([v, a]) => v === 'is' && a[0] === 'sitio_id' && a[1] === null));

  reiniciar();
  responderLectura = () => [
    { ...D.movimientoAFila(movCompleto), created_by_nombre: 'Persona Uno', created_at: '2026-01-15T10:00:00Z', updated_by_nombre: null, updated_at: '2026-01-15T10:00:00Z' },
  ];
  const movs = await D.cargarMovimientos(SITIO, '2026-01-01', '2026-01-31');
  ll = lecturas[0];
  eq('cargarMovimientos: lee cop_movimientos con selectAllRows', ll?.tabla, 'cop_movimientos');
  eq('cargarMovimientos: filtra por sitio y por fecha de jornada', ll?.ops.filter(([v]) => ['eq', 'gte', 'lte'].includes(v)), [['eq', ['sitio_id', SITIO]], ['gte', ['fecha', '2026-01-01']], ['lte', ['fecha', '2026-01-31']]]);
  eq('cargarMovimientos: ordenado por fecha, hora, created_at', ll?.ops.filter(([v]) => v === 'order').map(([, a]) => a[0]), ['fecha', 'hora', 'created_at']);
  ok('cargarMovimientos: pide las columnas de sello para mostrarlas', /created_by_nombre/.test(ll?.columnas ?? '') && /updated_at/.test(ll?.columnas ?? ''));
  eq('cargarMovimientos: devuelve Movimiento en camelCase', [movs.length, movs[0]?.unidadTexto, movs[0]?.creadoPor, movs[0]?.capacidadM3], [1, 'U-01', 'Persona Uno', 12.5]);
  reiniciar();
  responderLectura = () => { throw { code: 'PGRST000', message: 'Failed to fetch' }; };
  e = await fallo(D.cargarMovimientos(SITIO, '2026-01-01', '2026-01-31'));
  ok('cargarMovimientos: si la lectura falla → Error en español', e instanceof Error && /^No se/.test(e.message));

  reiniciar();
  responderLectura = () => [
    { id: SITIO_2, nombre: 'zeta', nota: null, activo: true, ubicacion_id: null },
    { id: SITIO, nombre: 'Álamo', nota: null, activo: false, ubicacion_id: null },
  ];
  eq('cargarSitios: A→Z sin mirar tildes (también los inactivos)', (await D.cargarSitios()).map((s) => s.nombre), ['Álamo', 'zeta']);
  reiniciar();
  responderLectura = () => [
    { ...D.unidadAFila({ ...unidad, codigo: 'U-10' }) },
    { ...D.unidadAFila({ ...unidad, id: SITIO_2, codigo: 'U-2' }) },
  ];
  const us = await D.cargarUnidades(SITIO);
  eq('cargarUnidades: A→Z natural por código (U-2 antes que U-10)', us.map((u) => u.codigo), ['U-2', 'U-10']);
  eq('cargarUnidades: filtra por sitio', lecturas[0]?.ops.find(([v]) => v === 'eq')?.[1], ['sitio_id', SITIO]);
  ok('PD1: cargarUnidades pide estado, estado_nota, estado_at y chofer', ['estado', 'estado_nota', 'estado_at', 'chofer'].every((c) => (lecturas[0]?.columnas ?? '').split(', ').includes(c)));
  reiniciar();
  responderLectura = () => [
    { id: LISTA_O, sitio_id: SITIO, clase: 'origen', nombre: 'Frente Norte', activo: true },
    { id: LISTA_T, sitio_id: null, clase: 'transportista', nombre: 'Transportista B', activo: true },
  ];
  const ls = await D.cargarListas(SITIO);
  eq('cargarListas: trae las del sitio y las generales', ls.map((i) => [i.nombre, i.sitioId]), [['Frente Norte', SITIO], ['Transportista B', null]]);
  ok('cargarListas: or(sitio, generales)', (argsDe(lecturas[0], 'or')?.[0] ?? '').includes(`sitio_id.eq.${SITIO}`) && (argsDe(lecturas[0], 'or')?.[0] ?? '').includes('sitio_id.is.null'));
  e = await fallo(D.cargarListas('x),activo.eq.(true'));
  ok('cargarListas: un id de sitio raro no se cuela en el filtro', e instanceof Error);

  // 3.9 Sugerencias del sistema: cada lectura con su red; nunca revienta.
  reiniciar();
  responderLectura = () => { throw new Error('sin permiso'); };
  eq('sugerenciasDelSistema: si TODO falla, vuelve vacío sin reventar', await D.sugerenciasDelSistema(), { maquinas: [], frentes: [], obras: [] });
  reiniciar();
  const EMPRESA = '00000000-0000-4000-8000-0000000000e1';
  responderLectura = (l) => {
    if (l.tabla === 'machinery') return [
      { id: 'm2', code: 'V-10', plate: ' AAA00A ', serial: null, marca: 'Marca X', modelo: 'Modelo Y', description: 'Volteo', company_id: EMPRESA },
      { id: 'm1', code: 'V-2', plate: null, serial: 'S-1', marca: null, modelo: null, description: null, company_id: null },
    ];
    if (l.tabla === 'companies') throw new Error('sin permiso a empresas');
    if (l.tabla === 'viaje_frentes') return [
      { id: 'f1', nombre: 'Frente Sur', activo: true }, { id: 'f2', nombre: ' frente sur ', activo: true },
      { id: 'f3', nombre: 'Frente Viejo', activo: false }, { id: 'f4', nombre: 'Frente Este', activo: true },
    ];
    if (l.tabla === 'ubicaciones_obra') return [{ id: 'o1', nombre: 'Obra Uno', active: true }, { id: 'o2', nombre: 'Obra Cerrada', active: false }];
    return [];
  };
  const sug = await D.sugerenciasDelSistema();
  eq('sugerencias: las tablas que lee', lecturas.map((l) => l.tabla).sort(), ['companies', 'machinery', 'ubicaciones_obra', 'viaje_frentes']);
  eq('sugerencias: máquinas A→Z natural, con placa limpia', sug.maquinas.map((m) => [m.codigo, m.placa]), [['V-2', null], ['V-10', 'AAA00A']]);
  eq('sugerencias: si empresas falla, la máquina sale igual con empresa null', sug.maquinas[1], { id: 'm2', codigo: 'V-10', placa: 'AAA00A', serial: null, marca: 'Marca X', modelo: 'Modelo Y', empresa: null, descripcion: 'Volteo' });
  eq('sugerencias: frentes activos, sin repetidos, A→Z', sug.frentes, ['Frente Este', 'Frente Sur']);
  eq('sugerencias: obras activas', sug.obras, [{ id: 'o1', nombre: 'Obra Uno' }]);
  reiniciar();
  responderLectura = (l) => {
    if (l.tabla === 'machinery') return [{ id: 'm2', code: 'V-10', plate: null, serial: null, marca: null, modelo: null, description: null, company_id: EMPRESA }];
    if (l.tabla === 'companies') return [{ id: EMPRESA, name: 'Empresa Sintética' }];
    return [];
  };
  eq('sugerencias: la empresa sale de companies por company_id', (await D.sugerenciasDelSistema()).maquinas[0]?.empresa, 'Empresa Sintética');

  // A12/B13 (lote 2): ✍️ Cargar solo usa frentes y obras: con { maquinas: false } no se
  // baja el catálogo de máquinas ni las empresas (cada entrada a ✍️ lo bajaba entero).
  reiniciar();
  responderLectura = (l) => {
    if (l.tabla === 'viaje_frentes') return [{ id: 'f1', nombre: 'Frente Sur', activo: true }];
    if (l.tabla === 'ubicaciones_obra') return [{ id: 'o1', nombre: 'Obra Uno', active: true }];
    return [{ id: 'm9', code: 'NO-DEBERIA', plate: null, serial: null, marca: null, modelo: null, description: null, company_id: null }];
  };
  const sinMaquinas = await D.sugerenciasDelSistema({ maquinas: false });
  eq('⭐ A12: sugerenciasDelSistema({ maquinas: false }) no lee machinery ni companies', lecturas.map((l) => l.tabla).sort(), ['ubicaciones_obra', 'viaje_frentes']);
  eq('A12: …y devuelve igual los frentes y las obras, con las máquinas vacías', sinMaquinas, { maquinas: [], frentes: ['Frente Sur'], obras: [{ id: 'o1', nombre: 'Obra Uno' }] });
  reiniciar();
  await D.sugerenciasDelSistema();
  eq('A12: sin parámetro sigue leyendo todo (Flota necesita el catálogo)', lecturas.map((l) => l.tabla).sort(), ['companies', 'machinery', 'ubicaciones_obra', 'viaje_frentes']);

  // ═══════════════ PD1 — 📅 Parte diario (24-oct-2026) ═══════════════
  const REP = '00000000-0000-4000-8000-0000000000d1';
  const REP_2 = '00000000-0000-4000-8000-0000000000d2';
  const NO_SE_BORRO_PD = 'No se borró: no tienes permiso o el renglón ya no existe (actualiza la lista).';
  /** Un ReporteGeneral leído (sintético): corte 07:00 del 06 → jornada del 05 (R28). */
  const leido = {
    titulo: 'REPORTE DE PRUEBA', sitioTexto: 'CDT X', fecha: '2026-01-06', horaCorte: '07:00', jornada: '2026-01-05',
    viajesTotal: 12, toneladasTotal: 280.5,
    empresas: [{ nombre: 'Transportista A', viajes: 7, toneladas: 160.25, extra: 'no viaja' }, { nombre: 'Transportista B', viajes: 5, toneladas: 120.25 }],
    frentes: [{ nombre: 'Frente Norte', viajes: 12, toneladas: 280.5 }],
    avisos: ['Un aviso sintético.'], lineasNoLeidas: ['una línea que no se entendió'],
  };
  const TEXTO = 'REPORTE DE PRUEBA\nFecha de corte: 06/01/2026 (7:00 AM)\n…';

  // P1. guardarReporteGeneral: no hay uno ese día → busca y luego inserta.
  reiniciar();
  responder = (l) => (verbos(l)[0] === 'select' ? { data: [], error: null } : { data: [{ id: REP }], error: null });
  eq('⭐ guardarReporteGeneral nuevo: devuelve el id', await D.guardarReporteGeneral(SITIO, leido, TEXTO), REP);
  eq('guardarReporteGeneral nuevo: primero busca, luego insert', registros.map((l) => [l.tabla, verbos(l)[0]]),
    [['cop_reportes_generales', 'select'], ['cop_reportes_generales', 'insert']]);
  ok('⭐ guardarReporteGeneral: busca por sitio y por la JORNADA (no por la fecha escrita)',
    registros[0].ops.some(([v, a]) => v === 'eq' && a[0] === 'sitio_id' && a[1] === SITIO)
    && registros[0].ops.some(([v, a]) => v === 'eq' && a[0] === 'fecha' && a[1] === '2026-01-05'));
  let insertadoRep = argsDe(registros[1], 'insert')?.[0] ?? {};
  eq('⭐ guardarReporteGeneral nuevo: las columnas de la base, fecha = jornada, sin sello ni id', insertadoRep, {
    sitio_id: SITIO, fecha: '2026-01-05', hora_corte: '07:00', viajes_total: 12, toneladas_total: 280.5,
    empresas: [{ nombre: 'Transportista A', viajes: 7, toneladas: 160.25 }, { nombre: 'Transportista B', viajes: 5, toneladas: 120.25 }],
    frentes: [{ nombre: 'Frente Norte', viajes: 12, toneladas: 280.5 }],
    avisos: ['Un aviso sintético.'], texto_original: TEXTO,
  });
  eq('guardarReporteGeneral nuevo: insert con .select(\'id\')', argsDe(registros[1], 'select'), ['id']);

  // P2. Ya hay uno ese día → se REEMPLAZA (update de ese id), sin cambiar sitio ni fecha.
  reiniciar();
  responder = () => ({ data: [{ id: REP_2 }], error: null });
  eq('⭐ guardarReporteGeneral existente: devuelve el id del que ya estaba', await D.guardarReporteGeneral(SITIO, leido, TEXTO), REP_2);
  eq('guardarReporteGeneral existente: busca y hace update (no insert)', registros.map((l) => verbos(l)[0]), ['select', 'update']);
  eq('guardarReporteGeneral existente: update por su id con .select(\'id\')', [argsDe(registros[1], 'eq'), argsDe(registros[1], 'select')], [['id', REP_2], ['id']]);
  const actualizadoRep = argsDe(registros[1], 'update')?.[0] ?? {};
  ok('guardarReporteGeneral existente: manda los datos nuevos, sin sello', actualizadoRep.viajes_total === 12 && actualizadoRep.texto_original === TEXTO
    && SELLO_FILA.every((c) => !(c in actualizadoRep)) && !('id' in actualizadoRep));

  // P3. Otro equipo lo creó en el mismo instante → el único (sitio, fecha) rechaza el insert → update del que quedó.
  reiniciar();
  let buscadas = 0;
  responder = (l) => {
    const v = verbos(l)[0];
    if (v === 'select') return { data: buscadas++ === 0 ? [] : [{ id: REP_2 }], error: null };
    if (v === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "cop_reportes_generales_dia"' } };
    return { data: [{ id: REP_2 }], error: null };
  };
  e = await fallo(D.guardarReporteGeneral(SITIO, leido, TEXTO));
  eq('guardarReporteGeneral: si otro lo creó en el mismo instante, reemplaza ese (sin error)',
    [e, registros.map((l) => verbos(l)[0]), argsDe(registros[3], 'eq')], [null, ['select', 'insert', 'select', 'update'], ['id', REP_2]]);

  // P4. 0 filas, sin jornada, sin sitio, texto ausente.
  reiniciar();
  responder = (l) => (verbos(l)[0] === 'select' ? { data: [{ id: REP }], error: null } : { data: [], error: null });
  e = await fallo(D.guardarReporteGeneral(SITIO, leido, TEXTO));
  eq('⭐ guardarReporteGeneral: update con 0 filas (la RLS) → el mensaje exacto', e?.message, NO_SE_GUARDO);
  reiniciar();
  responder = (l) => (verbos(l)[0] === 'select' ? { data: [], error: null } : { data: [], error: null });
  e = await fallo(D.guardarReporteGeneral(SITIO, leido, TEXTO));
  eq('guardarReporteGeneral: insert con 0 filas → el mensaje exacto', e?.message, NO_SE_GUARDO);
  reiniciar();
  e = await fallo(D.guardarReporteGeneral(SITIO, { ...leido, fecha: null, jornada: null }, TEXTO));
  ok('guardarReporteGeneral sin jornada (sin fecha de corte) → falla en español sin ir a la base',
    e instanceof Error && /^No se guardó el Reporte General/.test(e.message) && /fecha/.test(e.message) && registros.length === 0);
  reiniciar();
  e = await fallo(D.guardarReporteGeneral('  ', leido, TEXTO));
  ok('guardarReporteGeneral sin sitio → falla sin ir a la base', e instanceof Error && registros.length === 0);
  reiniciar();
  responder = (l) => (verbos(l)[0] === 'select' ? { data: [], error: null } : { data: [{ id: REP }], error: null });
  await D.guardarReporteGeneral(SITIO, { ...leido, horaCorte: null, viajesTotal: null, toneladasTotal: null, empresas: [], frentes: [], avisos: [] }, undefined);
  eq('guardarReporteGeneral: sin hora ni totales → null; listas vacías; texto ausente → «»',
    argsDe(registros[1], 'insert')?.[0], { sitio_id: SITIO, fecha: '2026-01-05', hora_corte: null, viajes_total: null, toneladas_total: null, empresas: [], frentes: [], avisos: [], texto_original: '' });
  reiniciar();
  responder = (l) => (verbos(l)[0] === 'select' ? { data: [], error: null } : { data: null, error: { code: '23514', message: 'violates check constraint "cop_reportes_generales_viajes_total_check"' } });
  e = await fallo(D.guardarReporteGeneral(SITIO, leido, TEXTO));
  ok('guardarReporteGeneral: rechazo de la base → en español', e instanceof Error && /^No se guardó el Reporte General/.test(e.message));

  // P5. cargarReportesGenerales: por sitio y por jornada, limpio y A→Z por fecha.
  reiniciar();
  responderLectura = () => [
    { id: REP_2, sitio_id: SITIO, fecha: '2026-01-07', hora_corte: '19:00:00', viajes_total: 3, toneladas_total: '70.50',
      empresas: [{ nombre: 'Transportista A', viajes: '3', toneladas: '70.5' }, null, { viajes: 1 }, 'basura'],
      frentes: 'no es una lista', avisos: ['Aviso uno.', 42, null], texto_original: 'texto',
      created_by_nombre: 'Persona Uno', created_at: '2026-01-07T23:10:00Z', updated_by_nombre: null, updated_at: '2026-01-07T23:10:00Z' },
    { id: REP, sitio_id: SITIO, fecha: '2026-01-05', hora_corte: null, viajes_total: null, toneladas_total: null,
      empresas: [], frentes: [], avisos: [], texto_original: null },
  ];
  const reps = await D.cargarReportesGenerales(SITIO, '2026-01-01', '2026-01-31');
  ll = lecturas[0];
  eq('cargarReportesGenerales: lee cop_reportes_generales con selectAllRows', ll?.tabla, 'cop_reportes_generales');
  eq('cargarReportesGenerales: filtra por sitio y por fecha de jornada', ll?.ops.filter(([v]) => ['eq', 'gte', 'lte'].includes(v)),
    [['eq', ['sitio_id', SITIO]], ['gte', ['fecha', '2026-01-01']], ['lte', ['fecha', '2026-01-31']]]);
  ok('cargarReportesGenerales: pide las columnas de la tabla y el sello', ['sitio_id', 'fecha', 'hora_corte', 'viajes_total', 'toneladas_total',
    'empresas', 'frentes', 'avisos', 'texto_original', 'created_by_nombre', 'updated_at'].every((c) => (ll?.columnas ?? '').split(', ').includes(c)));
  eq('cargarReportesGenerales: ordenados por fecha', reps.map((r) => r.fecha), ['2026-01-05', '2026-01-07']);
  eq('⭐ cargarReportesGenerales: camelCase, hora «HH:MM», cifras como número, jsonb limpio (lo raro se descarta)', reps[1], {
    id: REP_2, sitioId: SITIO, fecha: '2026-01-07', horaCorte: '19:00', viajesTotal: 3, toneladasTotal: 70.5,
    empresas: [{ nombre: 'Transportista A', viajes: 3, toneladas: 70.5 }], frentes: [], avisos: ['Aviso uno.'], textoOriginal: 'texto',
    creadoPor: 'Persona Uno', creadoAt: '2026-01-07T23:10:00Z', editadoPor: null, editadoAt: '2026-01-07T23:10:00Z',
  });
  eq('cargarReportesGenerales: lo vacío sale null / [] / «» (nunca undefined)', [reps[0].horaCorte, reps[0].viajesTotal, reps[0].toneladasTotal, reps[0].empresas, reps[0].textoOriginal],
    [null, null, null, [], '']);
  reiniciar();
  responderLectura = () => { throw { code: 'PGRST000', message: 'Failed to fetch' }; };
  e = await fallo(D.cargarReportesGenerales(SITIO, '2026-01-01', '2026-01-31'));
  ok('cargarReportesGenerales: si la lectura falla → Error en español', e instanceof Error && /^No se pudieron cargar/.test(e.message));

  // P6. borrarReporteGeneral.
  reiniciar();
  responder = () => ({ data: [{ id: REP }], error: null });
  await D.borrarReporteGeneral(REP);
  ll = registros[0];
  eq('borrarReporteGeneral: delete + eq(id) + select(id) en cop_reportes_generales',
    [ll?.tabla, verbos(ll), argsDe(ll, 'eq'), argsDe(ll, 'select')], ['cop_reportes_generales', ['delete', 'eq', 'select'], ['id', REP], ['id']]);
  reiniciar();
  e = await fallo(D.borrarReporteGeneral(REP));
  eq('⭐ borrarReporteGeneral: 0 filas (sin Full) → «No se borró…»', e?.message, NO_SE_BORRO_PD);
  reiniciar();
  e = await fallo(D.borrarReporteGeneral(' '));
  ok('borrarReporteGeneral sin id → falla sin ir a la base', e instanceof Error && registros.length === 0);

  // P7. ⭐ M3 (mesa de maquinaria): UNA PUERTA POR INTENCIÓN. guardarEstadoUnidad ya no existe.
  ok('⭐ M3: guardarEstadoUnidad desapareció (una sola puerta por intención)', !('guardarEstadoUnidad' in D) && !/guardarEstadoUnidad/.test(src));
  // guardarMarcaUnidad: una marca NUEVA → solo estado y nota (estado_at lo sella la base).
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  await D.guardarMarcaUnidad(UNIDAD, { estado: 'averiada', nota: '  Caucho espichado  ' });
  ll = registros[0];
  eq('⭐ guardarMarcaUnidad: update de cop_unidades por id con .select(\'id\')', [ll?.tabla, verbos(ll), argsDe(ll, 'eq'), argsDe(ll, 'select')],
    ['cop_unidades', ['update', 'eq', 'select'], ['id', UNIDAD], ['id']]);
  eq('⭐ guardarMarcaUnidad: manda SOLO estado y estado_nota (sin estado_at: lo sella la base)', argsDe(ll, 'update')?.[0], { estado: 'averiada', estado_nota: 'Caucho espichado' });
  eq('guardarMarcaUnidad: sin guardia no lee nada antes de escribir', [registros.length, lecturas.length], [1, 0]);
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  await D.guardarMarcaUnidad(UNIDAD, { estado: 'disponible', nota: '' });
  eq('guardarMarcaUnidad: nota en blanco → null', argsDe(registros[0], 'update')?.[0], { estado: 'disponible', estado_nota: null });
  for (const [nombre, estado] of [['otro estado', 'en_reparacion'], ['null (soltar va por soltarMarcaUnidad)', null]]) {
    reiniciar();
    e = await fallo(D.guardarMarcaUnidad(UNIDAD, { estado, nota: null }));
    ok(`guardarMarcaUnidad con ${nombre} → falla sin ir a la base`, e instanceof Error && /^No se guardó el estado/.test(e.message) && registros.length === 0);
  }
  reiniciar();
  e = await fallo(D.guardarMarcaUnidad('', { estado: 'averiada', nota: null }));
  ok('guardarMarcaUnidad sin unidad → falla sin ir a la base', e instanceof Error && registros.length === 0);
  reiniciar();
  e = await fallo(D.guardarMarcaUnidad(UNIDAD, { estado: 'averiada', nota: null }));
  eq('⭐ guardarMarcaUnidad: 0 filas (la RLS de cop_unidades pide Full) → el mensaje exacto', e?.message, NO_SE_GUARDO);

  // guardarNotaMarca: SOLO la nota (no sella, no revive una marca superada).
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  await D.guardarNotaMarca(UNIDAD, '  revisar luces ');
  ll = registros[0];
  eq('⭐ guardarNotaMarca: manda SOLO estado_nota, por id, con .select(\'id\')', [ll?.tabla, verbos(ll), argsDe(ll, 'update')?.[0], argsDe(ll, 'eq'), argsDe(ll, 'select')],
    ['cop_unidades', ['update', 'eq', 'select'], { estado_nota: 'revisar luces' }, ['id', UNIDAD], ['id']]);
  reiniciar();
  e = await fallo(D.guardarNotaMarca(UNIDAD, 'x'));
  eq('guardarNotaMarca: 0 filas → el mensaje exacto', e?.message, NO_SE_GUARDO);
  reiniciar();
  e = await fallo(D.guardarNotaMarca(' ', 'x'));
  ok('guardarNotaMarca sin unidad → falla sin ir a la base', e instanceof Error && registros.length === 0);

  // soltarMarcaUnidad: «↩️ Que mande inspección» → estado y nota a null.
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  await D.soltarMarcaUnidad(UNIDAD);
  ll = registros[0];
  eq('⭐ soltarMarcaUnidad: manda estado y estado_nota en null, por id, con .select(\'id\')', [ll?.tabla, verbos(ll), argsDe(ll, 'update')?.[0], argsDe(ll, 'eq'), argsDe(ll, 'select')],
    ['cop_unidades', ['update', 'eq', 'select'], { estado: null, estado_nota: null }, ['id', UNIDAD], ['id']]);
  reiniciar();
  e = await fallo(D.soltarMarcaUnidad(UNIDAD));
  eq('soltarMarcaUnidad: 0 filas → el mensaje exacto', e?.message, NO_SE_GUARDO);
  reiniciar();
  responder = () => ({ data: null, error: { code: '23514', message: 'new row for relation "cop_unidades" violates check constraint "cop_unidades_estado_propia_chk"' } });
  e = await fallo(D.soltarMarcaUnidad(UNIDAD));
  ok('⭐ soltarMarcaUnidad en una unidad del sitio (el CHECK la rechaza) → lo dice en español', e instanceof Error && /siempre tiene su estado/.test(e.message));

  // ⭐ La GUARDIA (D2): antes de guardar sobre una vinculada, ¿inspección registró algo después
  //    de leerse la pantalla? Lee SOLO esa máquina, desde leidaAt, y nunca los marcadores.
  const MAQ = '00000000-0000-4000-8000-00000000aa01';
  const LEIDA = '2026-10-20T12:00:00.000Z'; // 08:00 a. m. en Caracas
  const guardia = { machineryId: MAQ, leidaAt: LEIDA };
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  responderLectura = (l) => (l.tabla === 'machine_rounds' ? [{ machinery_id: MAQ, jornada_marked_at: '2026-10-20T13:00:00.000Z' }] : []);
  e = await fallo(D.guardarMarcaUnidad(UNIDAD, { estado: 'disponible', nota: 'ya sirve' }, guardia));
  ok('⭐ D2: hubo una jornada después de leer la pantalla → NO escribe', registros.length === 0);
  ok('⭐ D2: * y avisa en español con la hora del hecho', e instanceof Error && /^Inspección registró una jornada el 20\/10 a las 09:00 a\. m\., después de que abriste la pantalla/.test(e.message), e?.message);
  ok('D2: * el aviso se reconoce (esCambioDeInspeccion) y trae el hecho', D.esCambioDeInspeccion(e) && e.novedad?.que === 'jornada' && !D.esCambioDeInspeccion(new Error('x')));
  eq('⭐ D2: la guardia lee SOLO esa máquina, desde leidaAt (selectAllRows, solo lectura)', lecturas.map((l) => [l.tabla, argsDe(l, 'in'), argsDe(l, 'gt')]), [
    ['maintenance_requests', ['machinery_id', [MAQ]], ['created_at', LEIDA]],
    ['maintenance_requests', ['machinery_id', [MAQ]], ['resolved_at', LEIDA]],
    ['machine_rounds', ['machinery_id', [MAQ]], ['jornada_marked_at', LEIDA]],
  ]);
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  responderLectura = (l) => (l.tabla === 'maintenance_requests' && argsDe(l, 'gt')?.[0] === 'created_at'
    ? [{ machinery_id: MAQ, material: 'FRENOS', notes: 'falla', created_at: '2026-10-20T14:30:00.000Z' }] : []);
  e = await fallo(D.guardarMarcaUnidad(UNIDAD, { estado: 'disponible', nota: null }, guardia));
  ok('D2: una avería real creada después también frena la marca', registros.length === 0 && /reportó una avería/.test(e?.message ?? ''));
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  responderLectura = () => [];
  await D.guardarMarcaUnidad(UNIDAD, { estado: 'averiada', nota: 'motor' }, guardia);
  eq('⭐ D2: sin hechos nuevos → guarda (lee 3, escribe 1)', [lecturas.length, registros.length, argsDe(registros[0], 'update')?.[0]], [3, 1, { estado: 'averiada', estado_nota: 'motor' }]);
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  responderLectura = () => { throw { code: 'PGRST000', message: 'Failed to fetch' }; };
  e = await fallo(D.guardarMarcaUnidad(UNIDAD, { estado: 'averiada', nota: 'motor' }, guardia));
  ok('⭐ D2: si la pregunta de la guardia falla (sin señal) → guarda igual', e === null && registros.length === 1 && argsDe(registros[0], 'update')?.[0]?.estado === 'averiada');
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  await D.guardarMarcaUnidad(UNIDAD, { estado: 'averiada', nota: null }, { machineryId: MAQ, leidaAt: '' });
  ok('D2: sin leidaAt (inspección sin leer) no hay guardia: escribe sin leer', lecturas.length === 0 && registros.length === 1);
  ok('⭐ D2: la guardia nunca escribe fuera de cop_unidades', registros.every((l) => l.tabla === 'cop_unidades'));
  // ⭐ B1 (lote 6): el texto del aviso dice de dónde salió la referencia (la pantalla, su marca anterior o
  //    el hecho que ya le mostró la guardia); el hecho viaja igual (la pantalla guarda su hora como «visto hasta»).
  const conJornada = (l) => (l.tabla === 'machine_rounds' ? [{ machinery_id: MAQ, jornada_marked_at: '2026-10-20T13:00:00.000Z' }] : []);
  for (const [motivo, re] of [['marca', /, después de tu marca anterior: tu marca no se guardó/], ['visto', /: otro hecho más, después del que ya viste; tu marca no se guardó/], [undefined, /, después de que abriste la pantalla: tu marca no se guardó/]]) {
    reiniciar();
    responder = () => ({ data: [{ id: UNIDAD }], error: null });
    responderLectura = conJornada;
    e = await fallo(D.guardarMarcaUnidad(UNIDAD, { estado: 'disponible', nota: null }, { ...guardia, motivo }));
    ok(`⭐ B1: la guardia con motivo «${motivo ?? 'pantalla'}» frena con su texto y trae el hecho`, registros.length === 0 && D.esCambioDeInspeccion(e) && e.novedad?.ms === Date.parse('2026-10-20T13:00:00.000Z') && re.test(e.message), e?.message);
  }
  // ⭐ R2 (lote 6): si la consulta de la guardia se CUELGA (no falla: no vuelve), no se queda en «Guardando…»:
  //    pasado el tope guarda igual (D2).
  reiniciar();
  responder = () => ({ data: [{ id: UNIDAD }], error: null });
  responderLectura = () => new Promise(() => {});
  const t0 = Date.now();
  e = await fallo(D.guardarMarcaUnidad(UNIDAD, { estado: 'averiada', nota: 'motor' }, { ...guardia, topeMs: 30 }));
  ok('⭐ R2: la guardia colgada vence por tope y guarda igual', e === null && registros.length === 1 && argsDe(registros[0], 'update')?.[0]?.estado === 'averiada' && Date.now() - t0 < 5000);
  ok('R2: el tope por defecto es de 8 s (TOPE_GUARDIA_MS)', D.TOPE_GUARDIA_MS === 8000);

  // P8. guardarPatiosDelDia: una fila por patio y día; se reemplaza sin tocar las demás entradas.
  const PATIO_A = '00000000-0000-4000-8000-0000000000f1';
  const PATIO_B = '00000000-0000-4000-8000-0000000000f2';
  const PATIO_C = '00000000-0000-4000-8000-0000000000f3';
  const FILA_A = '00000000-0000-4000-8000-0000000001a1';
  const FILA_A2 = '00000000-0000-4000-8000-0000000001a2';
  const FILA_B = '00000000-0000-4000-8000-0000000001b1';
  const FILA_VIEJA = '00000000-0000-4000-8000-0000000001c1';
  /** Contesta la búsqueda con `existentes` (entradas, como las trae la base: unidad_texto ''
   *  y lo demás vacío salvo lo que se diga); insert → un id nuevo; update → los ids pedidos
   *  (`ponerCeroDevuelve` = lo que contesta el update de los repetidos a 0). */
  const responderPatios = (existentes, { ponerCeroDevuelve } = {}) => (l) => {
    const v = verbos(l)[0];
    if (v === 'select') return { data: existentes.map((r) => ({ tipo: 'entrada', unidad_texto: '', ...r })), error: null };
    if (v === 'insert') return { data: [{ id: 'nuevo' }], error: null };
    const ids = argsDe(l, 'in')?.[1];
    if (ids) return { data: ponerCeroDevuelve ?? ids.map((id) => ({ id })), error: null };
    return { data: [{ id: argsDe(l, 'eq')?.[1] }], error: null };
  };
  reiniciar();
  responder = responderPatios([
    { id: FILA_A, destino: 'Patio A', destino_lista_id: PATIO_A, viajes: 4 },
    { id: FILA_VIEJA, destino: 'Patio Viejo', destino_lista_id: null, viajes: 2 },
  ]);
  await D.guardarPatiosDelDia(SITIO, '2026-01-05', [
    { patio: 'Patio A', patioListaId: PATIO_A, viajes: 9 },
    { patio: 'Patio B', patioListaId: PATIO_B, viajes: 3 },
    { patio: 'Patio C', patioListaId: PATIO_C, viajes: 0 },
  ]);
  const busqueda = registros[0];
  eq('⭐ guardarPatiosDelDia: primero busca las filas de patio de ESE día en cop_movimientos', [busqueda?.tabla, verbos(busqueda)[0]], ['cop_movimientos', 'select']);
  eq('⭐ guardarPatiosDelDia: fila de patio = entrada del sitio y día, sin transportista, origen, unidad ni placa',
    busqueda?.ops.filter(([v]) => v === 'eq' || v === 'is').map(([v, a]) => [v, ...a]),
    [['eq', 'sitio_id', SITIO], ['eq', 'fecha', '2026-01-05'], ['eq', 'tipo', 'entrada'], ['is', 'transportista', null], ['is', 'origen', null], ['is', 'unidad_id', null], ['is', 'placa', null]]);
  const escrPatios = registros.slice(1);
  eq('guardarPatiosDelDia: A se actualiza, B se inserta, C (0 y sin fila) no escribe, el «Patio Viejo» no se toca',
    escrPatios.map((l) => [l.tabla, verbos(l)[0]]), [['cop_movimientos', 'update'], ['cop_movimientos', 'insert']]);
  eq('⭐ guardarPatiosDelDia: update de A por su id, con .select(\'id\')', [argsDe(escrPatios[0], 'eq'), argsDe(escrPatios[0], 'select')], [['id', FILA_A], ['id']]);
  eq('guardarPatiosDelDia: el update lleva patio, su id de lista, viajes y confirmado', argsDe(escrPatios[0], 'update')?.[0],
    { destino: 'Patio A', destino_lista_id: PATIO_A, viajes: 9, estado: 'confirmado' });
  eq('⭐ guardarPatiosDelDia: el insert es una entrada sin unidad, con el patio como destino', argsDe(escrPatios[1], 'insert')?.[0],
    { sitio_id: SITIO, fecha: '2026-01-05', tipo: 'entrada', unidad_texto: '', destino: 'Patio B', destino_lista_id: PATIO_B, viajes: 3, estado: 'confirmado' });
  eq('guardarPatiosDelDia: el insert con .select(\'id\')', argsDe(escrPatios[1], 'select'), ['id']);
  ok('guardarPatiosDelDia: ninguna escritura toca la fila del «Patio Viejo»',
    !escrPatios.some((l) => JSON.stringify(l.ops).includes(FILA_VIEJA)));

  // Por nombre (sin id de lista), con otra escritura; 0 con fila → la fila queda en 0 (no se borra: borrar pide Full).
  reiniciar();
  responder = responderPatios([
    { id: FILA_A, destino: ' patio a ', destino_lista_id: null, viajes: 4 },
    { id: FILA_B, destino: 'Patio B', destino_lista_id: PATIO_B, viajes: 2 },
  ]);
  await D.guardarPatiosDelDia(SITIO, '2026-01-05', [
    { patio: 'Patio A', patioListaId: PATIO_A, viajes: 5 },
    { patio: 'Patio B', patioListaId: PATIO_B, viajes: 0 },
  ]);
  eq('guardarPatiosDelDia: sin id de lista coincide por el nombre (sin mayúsculas ni espacios) y le pone el id',
    [argsDe(registros[1], 'eq'), argsDe(registros[1], 'update')?.[0]], [['id', FILA_A], { destino: 'Patio A', destino_lista_id: PATIO_A, viajes: 5, estado: 'confirmado' }]);
  eq('guardarPatiosDelDia: un patio en 0 que ya tenía fila → la fila queda en 0 (update, no delete)',
    [verbos(registros[2])[0], argsDe(registros[2], 'eq'), argsDe(registros[2], 'update')?.[0]?.viajes], ['update', ['id', FILA_B], 0]);
  // Un patio renombrado en la lista: mismo id → se actualiza el nombre.
  reiniciar();
  responder = responderPatios([{ id: FILA_A, destino: 'Patio Uno', destino_lista_id: PATIO_A, viajes: 4 }]);
  await D.guardarPatiosDelDia(SITIO, '2026-01-05', [{ patio: 'Patio Norte', patioListaId: PATIO_A, viajes: 6 }]);
  eq('guardarPatiosDelDia: el mismo id de lista con otro nombre (renombrado) es la misma fila',
    [verbos(registros[1])[0], argsDe(registros[1], 'eq'), argsDe(registros[1], 'update')?.[0]?.destino], ['update', ['id', FILA_A], 'Patio Norte']);
  // Mismo nombre pero OTRO id de lista: no es la misma fila.
  reiniciar();
  responder = responderPatios([{ id: FILA_A, destino: 'Patio A', destino_lista_id: PATIO_C, viajes: 4 }]);
  await D.guardarPatiosDelDia(SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: PATIO_A, viajes: 6 }]);
  eq('guardarPatiosDelDia: mismo nombre con otro id de lista no se pisa (se inserta la suya)', registros.slice(1).map((l) => verbos(l)[0]), ['insert']);
  // ⭐ Revisión final A#5: dos ítems de la lista con el MISMO nombre (uno «para todos los
  //    sitios» y otro del sitio; el índice único de cop_listas lo permite) son dos patios
  //    distintos: se guardan juntos, cada uno en su fila. Antes se rechazaba todo con
  //    «está repetido» aunque los ids de lista eran distintos.
  reiniciar();
  responder = responderPatios([
    { id: FILA_A, destino: 'Patio A', destino_lista_id: PATIO_A, viajes: 4 },
    { id: FILA_B, destino: 'Patio A', destino_lista_id: PATIO_C, viajes: 1 },
  ]);
  e = await fallo(D.guardarPatiosDelDia(SITIO, '2026-01-05', [
    { patio: 'Patio A', patioListaId: PATIO_A, viajes: 6 },
    { patio: 'Patio A', patioListaId: PATIO_C, viajes: 2 },
  ]));
  ok('⭐ guardarPatiosDelDia A#5: el mismo nombre con DOS ids de lista distintos no es «repetido»', e === null || e === undefined || !(e instanceof Error), String(e?.message ?? e));
  eq('⭐ guardarPatiosDelDia A#5: cada uno actualiza SU fila (por id de lista)', registros.slice(1).map((l) => [verbos(l)[0], argsDe(l, 'eq'), argsDe(l, 'update')?.[0]?.viajes]),
    [['update', ['id', FILA_A], 6], ['update', ['id', FILA_B], 2]]);
  // ⭐ L5-A1: dos filas del mismo patio ese día: la primera queda con lo escrito y las demás
  //    se ponen en 0 (UPDATE, que Escritura sí puede): NUNCA un delete en este camino.
  reiniciar();
  responder = responderPatios([
    { id: FILA_A, destino: 'Patio A', destino_lista_id: PATIO_A, viajes: 4 },
    { id: FILA_A2, destino: 'Patio A', destino_lista_id: PATIO_A, viajes: 1 },
  ]);
  await D.guardarPatiosDelDia(SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: PATIO_A, viajes: 7 }]);
  eq('⭐ guardarPatiosDelDia: fila repetida → update de la primera y la otra a 0 con update (con .select(\'id\')), sin delete',
    registros.slice(1).map((l) => [verbos(l)[0], argsDe(l, 'eq') ?? argsDe(l, 'in'), argsDe(l, 'select')]),
    [['update', ['id', FILA_A], ['id']], ['update', ['id', [FILA_A2]], ['id']]]);
  eq('guardarPatiosDelDia: la repetida queda en 0 viajes, confirmada', argsDe(registros[2], 'update')?.[0], { viajes: 0, estado: 'confirmado' });
  ok('⭐ guardarPatiosDelDia: ningún delete', !registros.some((l) => verbos(l).includes('delete')));
  reiniciar();
  responder = responderPatios([
    { id: FILA_A, destino: 'Patio A', destino_lista_id: PATIO_A, viajes: 7, estado: 'confirmado' },
    { id: FILA_A2, destino: 'Patio A', destino_lista_id: PATIO_A, viajes: 0, estado: 'confirmado' },
  ]);
  await D.guardarPatiosDelDia(SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: PATIO_A, viajes: 8 }]);
  eq('guardarPatiosDelDia: un repetido que ya quedó en 0 no se vuelve a escribir', registros.slice(1).map((l) => [verbos(l)[0], argsDe(l, 'eq') ?? argsDe(l, 'in')]),
    [['update', ['id', FILA_A]]]);
  ok('guardarPatiosDelDia: la búsqueda va en orden de carga (la primera es la más vieja)', registros[0].ops.some(([v, a]) => v === 'order' && a[0] === 'created_at'));
  reiniciar();
  responder = responderPatios([
    { id: FILA_A, destino: 'Patio A', destino_lista_id: PATIO_A, viajes: 4 },
    { id: FILA_A2, destino: 'Patio A', destino_lista_id: PATIO_A, viajes: 1 },
  ], { ponerCeroDevuelve: [] });
  e = await fallo(D.guardarPatiosDelDia(SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: PATIO_A, viajes: 7 }]));
  ok('guardarPatiosDelDia: si la fila repetida no se pudo poner en 0 → lo dice, nombrando el patio',
    e instanceof Error && /Patio A/.test(e.message) && /repetid/.test(e.message) && /en 0/.test(e.message));
  ok('guardarPatiosDelDia: * y no dice «no se guardó» del patio que sí quedó escrito', e instanceof Error && /se guardó/.test(e.message) && !/^No se guard/.test(e.message));

  // ⭐ L5-A1: una entrada de ✍️ Carga libre hacia el patio (unidad escrita, toneladas, material,
  //    hora, nota, m³ o capacidad) NO es la fila del patio: ni se pisa ni se pone en 0.
  const CL = (n) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
  const deCargaLibre = [
    { id: CL(1), destino: 'Patio A', destino_lista_id: PATIO_A, unidad_texto: 'U-07', toneladas: 14, viajes: 1 },
    { id: CL(2), destino: 'Patio A', destino_lista_id: PATIO_A, material: 'Material X', viajes: 1 },
    { id: CL(3), destino: 'Patio A', destino_lista_id: PATIO_A, hora: '08:15:00', viajes: 1 },
    { id: CL(4), destino: 'Patio A', destino_lista_id: PATIO_A, observacion: 'Nota sintética', viajes: 1 },
    { id: CL(5), destino: 'Patio A', destino_lista_id: PATIO_A, m3: '10.00', viajes: 1 },
    { id: CL(6), destino: 'Patio A', destino_lista_id: PATIO_A, capacidad_m3: '12.00', viajes: 1 },
  ];
  reiniciar();
  responder = responderPatios([...deCargaLibre, { id: FILA_A, destino: 'Patio A', destino_lista_id: PATIO_A, viajes: 4 }]);
  await D.guardarPatiosDelDia(SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: PATIO_A, viajes: 9 }]);
  eq('⭐ L5-A1 guardarPatiosDelDia: con renglones de Carga libre hacia el patio, SOLO se actualiza la fila del patio',
    registros.slice(1).map((l) => [verbos(l)[0], argsDe(l, 'eq') ?? argsDe(l, 'in')]), [['update', ['id', FILA_A]]]);
  ok('L5-A1 guardarPatiosDelDia: * ninguna escritura nombra un renglón de Carga libre',
    !registros.slice(1).some((l) => deCargaLibre.some((r) => JSON.stringify(l.ops).includes(r.id))));
  const columnas = String(argsDe(registros[0], 'select')?.[0] ?? '');
  ok('L5-A1 guardarPatiosDelDia: la búsqueda trae lo que mira la regla (unidad_texto, material, toneladas, m3, hora, capacidad, observación)',
    ['tipo', 'unidad_texto', 'material', 'toneladas', 'm3', 'hora', 'capacidad_m3', 'observacion'].every((c) => new RegExp(`\\b${c}\\b`).test(columnas)));
  reiniciar();
  responder = responderPatios(deCargaLibre);
  await D.guardarPatiosDelDia(SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: PATIO_A, viajes: 9 }]);
  eq('⭐ L5-A1 guardarPatiosDelDia: si el patio solo tiene renglones de Carga libre, se crea SU fila (no se pisa una pesada)',
    registros.slice(1).map((l) => verbos(l)[0]), ['insert']);
  reiniciar();
  responder = responderPatios([{ id: FILA_A, destino: 'Patio A', destino_lista_id: PATIO_A, unidad_texto: '  ', viajes: 4 }]);
  await D.guardarPatiosDelDia(SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: PATIO_A, viajes: 9 }]);
  eq('L5-A1 guardarPatiosDelDia: una unidad «en blanco con espacios» sigue siendo la fila del patio',
    registros.slice(1).map((l) => [verbos(l)[0], argsDe(l, 'eq')]), [['update', ['id', FILA_A]]]);
  {
    const desde = src.indexOf('export async function guardarPatiosDelDia');
    const resto = desde >= 0 ? src.slice(desde) : '';
    const fin = resto.indexOf('\n}');
    const cuerpo = fin >= 0 ? resto.slice(0, fin + 2) : resto;
    ok('⭐ L5-A1 guardarPatiosDelDia no tiene ningún .delete( (los repetidos van a 0)', cuerpo.length > 0 && !/\.delete\(/.test(cuerpo));
    ok('L5-A1 guardarPatiosDelDia usa LA regla de la librería (esRenglonDePatio)', /esRenglonDePatio/.test(cuerpo));
  }

  // ⭐ L5-A5: guardados a medias → dice cuántos patios SÍ se guardaron y cuáles no.
  reiniciar();
  responder = (l) => {
    const v = verbos(l)[0];
    if (v === 'select') return { data: [{ id: FILA_A, tipo: 'entrada', unidad_texto: '', destino: 'Patio A', destino_lista_id: PATIO_A, viajes: 4 }], error: null };
    if (v === 'update') return { data: [{ id: FILA_A }], error: null };
    return { data: null, error: { code: 'PGRST000', message: 'Failed to fetch' } }; // los insert fallan
  };
  e = await fallo(D.guardarPatiosDelDia(SITIO, '2026-01-05', [
    { patio: 'Patio A', patioListaId: PATIO_A, viajes: 9 },
    { patio: 'Patio B', patioListaId: PATIO_B, viajes: 3 },
    { patio: 'Patio C', patioListaId: PATIO_C, viajes: 2 },
  ]));
  eq('⭐ L5-A5 guardarPatiosDelDia: a medias → cuántos sí, cuáles no y por qué', e?.message,
    'Se guardó 1 de 3 patios («Patio A»); «Patio B» y «Patio C» no: se perdió la conexión.');
  ok('L5-A5 * nunca empieza con «No se guardaron los patios» si alguno entró', e instanceof Error && !/^No se guardaron/.test(e.message));
  // 0 filas al actualizar → el mensaje exacto.
  reiniciar();
  responder = (l) => (verbos(l)[0] === 'select' ? { data: [{ id: FILA_A, tipo: 'entrada', unidad_texto: '', destino: 'Patio A', destino_lista_id: PATIO_A }], error: null } : { data: [], error: null });
  e = await fallo(D.guardarPatiosDelDia(SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: PATIO_A, viajes: 7 }]));
  eq('⭐ guardarPatiosDelDia: update con 0 filas → el mensaje exacto', e?.message, NO_SE_GUARDO);
  reiniciar();
  responder = (l) => (verbos(l)[0] === 'select' ? { data: [], error: null } : { data: [], error: null });
  e = await fallo(D.guardarPatiosDelDia(SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: null, viajes: 7 }]));
  eq('guardarPatiosDelDia: insert con 0 filas → el mensaje exacto', e?.message, NO_SE_GUARDO);
  reiniciar();
  responder = () => ({ data: null, error: { code: 'PGRST000', message: 'Failed to fetch' } });
  e = await fallo(D.guardarPatiosDelDia(SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: null, viajes: 7 }]));
  ok('guardarPatiosDelDia: si la búsqueda falla → en español y sin escribir', e instanceof Error && /^No se guardaron los patios/.test(e.message) && registros.length === 1);
  // Lo que no cuadra no va a la base.
  for (const [nombre, sitio, fecha, patios] of [
    ['viajes negativos', SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: null, viajes: -1 }]],
    ['viajes con decimales', SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: null, viajes: 2.5 }]],
    ['viajes que no son número', SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: null, viajes: NaN }]],
    ['patio sin nombre', SITIO, '2026-01-05', [{ patio: '  ', patioListaId: null, viajes: 2 }]],
    ['patio repetido (otra escritura)', SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: null, viajes: 2 }, { patio: ' patio a', patioListaId: null, viajes: 1 }]],
    ['patio repetido (mismo id de lista)', SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: PATIO_A, viajes: 2 }, { patio: 'Patio Uno', patioListaId: PATIO_A, viajes: 1 }]],
    ['patio repetido (el mismo nombre, uno sin id de lista)', SITIO, '2026-01-05', [{ patio: 'Patio A', patioListaId: PATIO_A, viajes: 2 }, { patio: 'patio a', patioListaId: null, viajes: 1 }]],
    ['fecha que no existe', SITIO, '2026-02-30', [{ patio: 'Patio A', patioListaId: null, viajes: 2 }]],
    ['sin sitio', '', '2026-01-05', [{ patio: 'Patio A', patioListaId: null, viajes: 2 }]],
  ]) {
    reiniciar();
    e = await fallo(D.guardarPatiosDelDia(sitio, fecha, patios));
    ok(`guardarPatiosDelDia: ${nombre} → falla en español sin ir a la base`, e instanceof Error && /^No se guardaron los patios/.test(e.message) && registros.length === 0);
  }
  reiniciar();
  await D.guardarPatiosDelDia(SITIO, '2026-01-05', []);
  eq('guardarPatiosDelDia sin patios → no hace nada (ni busca)', registros.length, 0);
  // ═══════════════ M3 — Lo que dice INSPECCIÓN (mesa de maquinaria, 26-oct-2026) ═══════════════
  // Una base FALSA que contesta como PostgREST (filtra, ordena) para la librería compartida, y
  // un reloj FIJO (lunes 20/10/2026, 11:00 a. m. en Caracas: turno de día) para que la regla del
  // sistema dé siempre lo mismo. ⭐ Datos SINTÉTICOS.
  const RealDate = Date;
  const FIJO = RealDate.parse('2026-10-20T15:00:00.000Z');
  class DateFijo extends RealDate {
    constructor(...a) { if (a.length === 0) super(FIJO); else super(...a); }
    static now() { return FIJO; }
  }
  const conRelojFijo = async (fn) => { globalThis.Date = DateFijo; try { return await fn(); } finally { globalThis.Date = RealDate; } };
  const compara = (a, b) => {
    const fa = typeof a === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(a), fb = typeof b === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(b);
    if (fa && fb) return RealDate.parse(a) - RealDate.parse(b);
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  };
  const FILTRO = {
    eq: (f, [c, v]) => f[c] != null && f[c] === v,
    neq: (f, [c, v]) => f[c] != null && f[c] !== v,
    in: (f, [c, vs]) => f[c] != null && vs.includes(f[c]),
    gt: (f, [c, v]) => f[c] != null && compara(f[c], v) > 0,
    not: (f, [c, op, v]) => { if (op === 'is' && v === null) return f[c] != null; throw new Error(`not(${c}, ${op}) desconocido`); },
  };
  // `.or('and(c.op.v,c.op."v"),…')` como PostgREST: alguna rama entera se cumple (lote 6, A2).
  const ramasDe = (txt) => {
    const out = [];
    let dep = 0, comillas = false, cur = '';
    for (const ch of txt) {
      if (ch === '"') comillas = !comillas;
      if (!comillas) {
        if (ch === '(') dep++;
        else if (ch === ')') dep--;
        else if (ch === ',' && dep === 0) { out.push(cur); cur = ''; continue; }
      }
      cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  };
  const cumpleFiltro = (f, exp) => {
    const and = /^and\((.*)\)$/s.exec(exp);
    if (and) return ramasDe(and[1]).every((x) => cumpleFiltro(f, x));
    const or = /^or\((.*)\)$/s.exec(exp);
    if (or) return ramasDe(or[1]).some((x) => cumpleFiltro(f, x));
    const m = /^(\w+)\.(\w+)\.(.*)$/s.exec(exp);
    if (!m || !FILTRO[m[2]]) throw new Error(`la base falsa no entiende el filtro «${exp}»`);
    const v = m[3].startsWith('"') && m[3].endsWith('"') ? m[3].slice(1, -1) : m[3];
    return FILTRO[m[2]](f, [m[1], v]);
  };
  FILTRO.or = (f, [txt]) => ramasDe(txt).some((x) => cumpleFiltro(f, x));
  /** Filas de `tablas[ll.tabla]` filtradas y ordenadas por las operaciones anotadas. */
  const filasDe = (tablas, ll) => {
    let filas = (tablas[ll.tabla] ?? []).map((f) => ({ ...f }));
    let orden = null;
    for (const [v, a] of ll.ops) {
      if (v === 'select' || v === 'range' || v === 'limit') continue;
      if (v === 'order') { orden = a; continue; }
      if (!FILTRO[v]) throw new Error(`la base falsa no conoce «${v}»`);
      filas = filas.filter((f) => FILTRO[v](f, a));
    }
    if (orden) {
      const [c, o] = orden;
      const asc = o?.ascending !== false;
      filas.sort((x, y) => (asc ? 1 : -1) * compara(x[c], y[c]));
    }
    return filas;
  };
  /** Contesta los .from() y los selectAllRows con `tablas`; `fallaEn(tabla)` = esa tabla falla. */
  const usarBase = (tablas, fallaEn = () => false) => {
    responder = (l) => (fallaEn(l.tabla) ? { data: null, error: { code: 'PGRST000', message: 'Failed to fetch' } } : { data: filasDe(tablas, l), error: null });
    responderLectura = (l) => { if (fallaEn(l.tabla)) throw { code: 'PGRST000', message: 'Failed to fetch' }; return filasDe(tablas, l); };
  };

  const PARADA = 'MÁQUINA PARADA';
  const id = (n) => `00000000-0000-4000-8000-0000000c${String(n).padStart(4, '0')}`;
  const M = {
    OPE: id(1), HOY: id(2), ARR: id(3), REA: id(4), PAR: id(5), SIEMPRE: id(6), ESP: id(7), RET: id(8), TRA: id(9),
    FUERA: id(10), BORRADA: id(11), MARC: id(12), OTRA: id(99),
  };
  const ficha = (mid, o = {}) => ({ id: mid, active: true, operational: true, en_espera: false, transferida: false, reactivated_at: null, ...o });
  const ticket = (mid, material, created_at, o = {}) => ({ machinery_id: mid, material, notes: `nota ${material}`, status: 'pendiente', created_at, resolved_at: null, ...o });
  const TABLAS = {
    machinery: [
      ficha(M.OPE), ficha(M.HOY), ficha(M.ARR), ficha(M.REA, { reactivated_at: '2026-10-01T12:00:00.000Z' }), ficha(M.PAR), ficha(M.SIEMPRE),
      ficha(M.ESP, { en_espera: true }), ficha(M.RET, { operational: false }), ficha(M.TRA, { operational: false, transferida: true }),
      ficha(M.FUERA, { active: false }), ficha(M.MARC), ficha(M.OTRA),
    ],
    maintenance_requests: [
      ticket(M.HOY, 'MOTOR', '2026-10-20T12:00:00.000Z'),                     // avería real de hoy, 08:00
      ticket(M.ARR, 'HIDRÁULICO', '2026-10-15T12:00:00.000Z'),                // arrastrada: sin trabajo después
      ticket(M.REA, 'FRENOS', '2026-10-19T12:00:00.000Z'),                    // ayer; hoy inició jornada → reactivada
      ticket(M.PAR, PARADA, '2026-10-20T13:00:00.000Z'),                      // marcador de hoy → parada
      ticket(M.SIEMPRE, 'CAUCHO', '2026-10-20T12:30:00.000Z'),                // inspector «siempre activo» → no cuenta
      ticket(M.ESP, 'LUCES', '2026-10-20T12:30:00.000Z'),                     // en espera manda la oficina
      ticket(M.OTRA, 'MOTOR', '2026-10-20T12:00:00.000Z'),                    // de otra máquina: no se lee
      ticket(M.OPE, 'VIEJA', '2026-10-10T12:00:00.000Z', { status: 'realizado', resolved_at: '2026-10-11T12:00:00.000Z' }),
      // A7: SOLO marcadores después de la marca de las 08:00 (creado 09:00 y resuelto 10:00; otro reabierto 09:30): nunca son hecho.
      ticket(M.MARC, PARADA, '2026-10-20T13:00:00.000Z', { status: 'realizado', resolved_at: '2026-10-20T14:00:00.000Z' }),
      ticket(M.MARC, PARADA, '2026-10-20T13:30:00.000Z'),
    ],
    machine_rounds: [
      { machinery_id: M.REA, round_date: '2026-10-20', day_hours: 0, night_hours: 0, jornada_start_at: '2026-10-20T11:00:00.000Z', jornada_marked_at: '2026-10-20T14:00:00.000Z', jornada_shift: 'day' },
      { machinery_id: M.OPE, round_date: '2026-10-20', day_hours: 2, night_hours: 0, jornada_start_at: null, jornada_marked_at: null, jornada_shift: null },
      { machinery_id: M.OTRA, round_date: '2026-10-20', day_hours: 5, night_hours: 0, jornada_start_at: null, jornada_marked_at: null, jornada_shift: null },
    ],
    machine_inspectors: [
      { id: 'a1', machinery_id: M.SIEMPRE, inspector_id: 'p1', inspector_name: 'Inspector SOS La Guaira', shift: 'day', assigned_at: '2026-10-01T00:00:00Z', active: true },
      { id: 'a2', machinery_id: M.HOY, inspector_id: 'p2', inspector_name: 'Inspector Sintético', shift: 'day', assigned_at: '2026-10-01T00:00:00Z', active: true },
    ],
    profiles: [{ id: 'p2', full_name: 'Inspector Sintético' }],
  };
  const EN_EL_SITIO = [M.OPE, M.HOY, M.ARR, M.REA, M.PAR, M.SIEMPRE, M.ESP, M.RET, M.TRA, M.FUERA, M.BORRADA];
  const sinMarca = (mid) => ({ machineryId: mid, estadoAt: null, conMarca: false });

  // 1) Sin vinculadas → CERO consultas.
  reiniciar();
  usarBase(TABLAS);
  const vacio = await D.cargarEstadoInspeccion([]);
  eq('⭐ M3: sin vinculadas no consulta NADA', [registros.length, lecturas.length, vacio.porMaquina], [0, 0, {}]);
  ok('M3: * y aun así dice cuándo (leidaAt ISO)', typeof vacio.leidaAt === 'string' && !Number.isNaN(Date.parse(vacio.leidaAt)));
  reiniciar();
  eq('M3: ids en blanco tampoco consultan', [(await D.cargarEstadoInspeccion([sinMarca(' '), sinMarca('')])).porMaquina, registros.length], [{}, 0]);

  // 2) ⭐ EQUIVALENCIA (A2): lo que entrega el módulo = la regla del sistema SIN filtrar, recortada.
  const L = loadTs(path.join(ROOT, 'src/lib/machineLiveStatus.ts'));
  reiniciar();
  usarBase(TABLAS);
  const leidoInsp = await conRelojFijo(() => D.cargarEstadoInspeccion([...EN_EL_SITIO.map(sinMarca), sinMarca(M.OPE)]));
  const consultas = [...registros];
  const lecturasInsp = [...lecturas];
  reiniciar();
  usarBase(TABLAS);
  const esperado = await conRelojFijo(async () => {
    const [averiaCat, jornadaCat, inspByShift] = await Promise.all([L.fetchAveriaCat(), L.fetchJornadaCat(new Date()), L.fetchInspByShift()]);
    const retiredIds = new Set(TABLAS.machinery.filter((m) => m.operational === false).map((m) => m.id));
    const statusOf = L.makeLiveStatusOf({ jornadaCat, averiaCat, inspByShift, retiredIds, nowTick: Date.now() });
    const out = {};
    for (const m of TABLAS.machinery) if (m.active !== false) out[m.id] = L.estadoConteoDe(m, statusOf(m.id).estado);
    return out;
  });
  const dentro = EN_EL_SITIO.filter((mid) => leidoInsp.porMaquina[mid]?.encontrada);
  eq('⭐ M3 (A2) EQUIVALENCIA: el estado de cada vinculada = estadoConteoDe(m, makeLiveStatusOf(…)(id).estado) leyendo TODO',
    Object.fromEntries(dentro.map((mid) => [mid, leidoInsp.porMaquina[mid].estado])), Object.fromEntries(dentro.map((mid) => [mid, esperado[mid]])));
  eq('⭐ M3: los 6 estados del sistema, cada uno donde corresponde (avería de hoy, arrastrada, reactivada por jornada, parada, «siempre activo», espera, retirada, transferida)',
    [M.OPE, M.HOY, M.ARR, M.REA, M.PAR, M.SIEMPRE, M.ESP, M.RET, M.TRA].map((mid) => leidoInsp.porMaquina[mid]?.estado),
    ['operativa', 'averiada', 'averiada', 'operativa', 'parada', 'operativa', 'espera', 'retirada', 'transferida']);
  eq('M3: rótulo e ícono exactos de ESTADO_CONTEO_INFO', [M.HOY, M.PAR, M.ESP].map((mid) => [leidoInsp.porMaquina[mid].etiqueta, leidoInsp.porMaquina[mid].icono]),
    [[L.ESTADO_CONTEO_INFO.averiada.label, L.ESTADO_CONTEO_INFO.averiada.icon], [L.ESTADO_CONTEO_INFO.parada.label, L.ESTADO_CONTEO_INFO.parada.icon], [L.ESTADO_CONTEO_INFO.espera.label, L.ESTADO_CONTEO_INFO.espera.icon]]);
  eq('M3: motivo y «desde» solo en avería o parada', [leidoInsp.porMaquina[M.HOY].motivo, leidoInsp.porMaquina[M.HOY].desdeMs, leidoInsp.porMaquina[M.PAR].motivo, leidoInsp.porMaquina[M.ESP].motivo, leidoInsp.porMaquina[M.ESP].desdeMs],
    ['nota MOTOR', RealDate.parse('2026-10-20T12:00:00.000Z'), `nota ${PARADA}`, null, null]);
  eq('M3: la pista en vivo sin horas (trabajando / trabajó hoy), solo si está operativa', [M.REA, M.OPE, M.HOY, M.RET].map((mid) => leidoInsp.porMaquina[mid].enVivo),
    ['trabajando', 'trabajo_hoy', null, null]);
  eq('⭐ M3: inactiva o borrada del catálogo → encontrada: false (nunca «Operativa»)', [M.FUERA, M.BORRADA].map((mid) => [leidoInsp.porMaquina[mid]?.encontrada, leidoInsp.porMaquina[mid]?.estado]),
    [[false, null], [false, null]]);
  eq('M3: devuelta a servicio (reactivated_at) viaja en ms; sin marca no hay novedad', [leidoInsp.porMaquina[M.REA].reactivadaMs, leidoInsp.porMaquina[M.REA].novedad],
    [RealDate.parse('2026-10-01T12:00:00.000Z'), null]);
  ok('⭐ M3: SIN marcas no se buscan hechos (fetchNovedadesInspeccion no corre)', lecturasInsp.length === 0);

  // 3) ⭐ CANDADO DINÁMICO (A3): todo lo que hizo fue LEER, de las tablas esperadas, filtrado por SUS máquinas.
  const tablasLeidas = [...new Set([...consultas, ...lecturasInsp].map((l) => l.tabla))].sort();
  // (Sin contar lo EMBEBIDO: `listInspectorAssignments` trae la ficha de cada máquina y su empresa dentro de la
  //  consulta a machine_inspectors, de TODA la flota y sin paginar: riesgo 8 de la conclusión, A3 del lote 6.)
  eq('⭐ M3 candado dinámico: las tablas leídas son exactamente machinery, maintenance_requests, machine_rounds, machine_inspectors y profiles (sin contar lo embebido)',
    tablasLeidas, ['machine_inspectors', 'machine_rounds', 'machinery', 'maintenance_requests', 'profiles']);
  ok('⭐ M3 candado dinámico: cada consulta EMPIEZA con select y no escribe (sin insert/update/upsert/delete/rpc)',
    consultas.every((l) => verbos(l)[0] === 'select' && !verbos(l).some((v) => ['insert', 'update', 'upsert', 'delete', 'rpc'].includes(v))));
  const filtrosIn = consultas.filter((l) => l.tabla !== 'machine_inspectors' && l.tabla !== 'profiles').map((l) => argsDe(l, 'in'));
  ok('⭐ M3 (D10): machinery, averías y jornadas van SIEMPRE filtradas por las máquinas del sitio', filtrosIn.length >= 5 && filtrosIn.every((a) => Array.isArray(a?.[1])));
  ok('M3 (D10): * nunca piden una máquina de afuera ni repiten ids', filtrosIn.every((a) => Array.isArray(a?.[1]) && a[1].every((x) => EN_EL_SITIO.includes(x)) && new Set(a[1]).size === a[1].length));
  ok('M3: la ficha pide reactivated_at (reserva A2)', /reactivated_at/.test(argsDe(consultas.find((l) => l.tabla === 'machinery'), 'select')?.[0] ?? ''));

  // 4) Con marcas: los hechos desde la marca de CADA una (A2), solo de las que tienen marca.
  reiniciar();
  usarBase(TABLAS);
  const conMarcas = await conRelojFijo(() => D.cargarEstadoInspeccion([
    { machineryId: M.REA, estadoAt: '2026-10-20T12:00:00.000Z', conMarca: true },   // marca 08:00; jornada 10:00 después
    { machineryId: M.HOY, estadoAt: '2026-10-20T11:30:00.000Z', conMarca: true },   // marca 07:30; avería 08:00 después
    { machineryId: M.MARC, estadoAt: '2026-10-20T12:00:00.000Z', conMarca: true },  // marca 08:00; SOLO marcadores después (A7)
    { machineryId: M.OPE, estadoAt: null, conMarca: false },
  ]));
  const ventanaDe = (l) => argsDe(l, 'or')?.[0] ?? null;
  eq('⭐ M3 (A2): los hechos se buscan desde la marca de CADA una (ventana por máquina en el .or, sin .gt común), solo de las que tienen marca',
    lecturas.map((l) => [l.tabla, argsDe(l, 'in')?.[1], argsDe(l, 'gt') ?? null, ventanaDe(l)]), [
      ['maintenance_requests', [M.REA, M.HOY, M.MARC], null, `and(machinery_id.eq.${M.REA},created_at.gt."2026-10-20T12:00:00.000Z"),and(machinery_id.eq.${M.HOY},created_at.gt."2026-10-20T11:30:00.000Z"),and(machinery_id.eq.${M.MARC},created_at.gt."2026-10-20T12:00:00.000Z")`],
      ['maintenance_requests', [M.REA, M.HOY, M.MARC], null, `and(machinery_id.eq.${M.REA},resolved_at.gt."2026-10-20T12:00:00.000Z"),and(machinery_id.eq.${M.HOY},resolved_at.gt."2026-10-20T11:30:00.000Z"),and(machinery_id.eq.${M.MARC},resolved_at.gt."2026-10-20T12:00:00.000Z")`],
      ['machine_rounds', [M.REA, M.HOY, M.MARC], null, `and(machinery_id.eq.${M.REA},jornada_marked_at.gt."2026-10-20T12:00:00.000Z"),and(machinery_id.eq.${M.HOY},jornada_marked_at.gt."2026-10-20T11:30:00.000Z"),and(machinery_id.eq.${M.MARC},jornada_marked_at.gt."2026-10-20T12:00:00.000Z")`],
    ]);
  eq('M3: la novedad de cada una (jornada por persona; avería real creada), por separado de reactivadaMs',
    [conMarcas.porMaquina[M.REA].novedad, conMarcas.porMaquina[M.HOY].novedad?.que, conMarcas.porMaquina[M.OPE].novedad],
    [{ ms: RealDate.parse('2026-10-20T14:00:00.000Z'), que: 'jornada', motivo: null }, 'averia_creada', null]);
  ok('M3: con marcas, los hechos también son solo lectura', lecturas.every((l) => ['maintenance_requests', 'machine_rounds'].includes(l.tabla)));
  // ⭐ A7, de punta a punta: un marcador de parada creado, resuelto o reabierto DESPUÉS de la marca no es
  //    hecho (la cadena real lo deja fuera con neq('material', 'MÁQUINA PARADA'); se afirma la cadena, no
  //    se depende de que la base falsa lo aplique).
  const PM = loadTs(path.join(ROOT, 'src/lib/centroOperacionesMaquinariaBloques.ts'));
  const uniMarc = { id: 'U-MARC', sitioId: SITIO, origen: 'catalogo', machineryId: M.MARC, codigo: 'MARC', descripcion: null, placa: null, serial: null, marca: null,
    modelo: null, dueno: null, capacidadM3: null, activo: true, nota: null, estado: 'averiada', estadoNota: null, estadoAt: '2026-10-20T12:00:00.000Z', chofer: null };
  eq('⭐ M3 (A7): SOLO marcadores después de la marca → sin novedad, inspección dice Parada y la marca sigue VIGENTE',
    [conMarcas.porMaquina[M.MARC].novedad, conMarcas.porMaquina[M.MARC].estado, PM.estadoDelSitio(uniMarc, conMarcas, FIJO).marcaEstado, PM.estadoDelSitio(uniMarc, conMarcas, FIJO).fuente],
    [null, 'parada', 'vigente', 'sitio']);
  ok('⭐ M3 (A7): * las dos lecturas de tickets de la cadena GRABADA llevan neq(material, MÁQUINA PARADA)',
    lecturas.filter((l) => l.tabla === 'maintenance_requests').length === 2
    && lecturas.filter((l) => l.tabla === 'maintenance_requests').every((l) => JSON.stringify(argsDe(l, 'neq')) === JSON.stringify(['material', PARADA])));
  // Dos unidades del sitio vinculadas a la MISMA máquina con marcas distintas → la ventana es la más vieja.
  reiniciar();
  usarBase(TABLAS);
  await conRelojFijo(() => D.cargarEstadoInspeccion([
    { machineryId: M.REA, estadoAt: '2026-10-20T13:00:00.000Z', conMarca: true },
    { machineryId: M.REA, estadoAt: '2026-10-20T12:00:00.000Z', conMarca: true },
  ]));
  const columnaDe = (l) => (l.tabla === 'machine_rounds' ? 'jornada_marked_at' : /resolved_at/.test(l.columnas) ? 'resolved_at' : 'created_at');
  ok('M3 (A2): la misma máquina dos veces con marcas distintas → una sola ventana, la de la marca más vieja',
    lecturas.length === 3 && lecturas.every((l) => ventanaDe(l) === `and(machinery_id.eq.${M.REA},${columnaDe(l)}.gt."2026-10-20T12:00:00.000Z")`));
  // ⭐ A1: una devolución a servicio con hora FUTURA (reloj adelantado) se aplaza: reactivadaMs null.
  reiniciar();
  usarBase({ ...TABLAS, machinery: [ficha(M.REA, { reactivated_at: '2026-10-21T12:00:00.000Z' }), ficha(M.OPE, { reactivated_at: '2026-10-20T15:05:00.000Z' })] });
  const futuras = await conRelojFijo(() => D.cargarEstadoInspeccion([sinMarca(M.REA), sinMarca(M.OPE)]));
  eq('⭐ M3 (A1): reactivated_at de mañana → se aplaza (null); a 5 min del reloj → cuenta',
    [futuras.porMaquina[M.REA].reactivadaMs, futuras.porMaquina[M.OPE].reactivadaMs], [null, RealDate.parse('2026-10-20T15:05:00.000Z')]);

  // 5) TODO O NADA: si cualquiera de las lecturas falla, lanza en español (nunca «Operativa»).
  // Sin marcas (solo las lecturas ESTRICTAS de averías y jornadas) y con una marca (también los hechos).
  for (const [como, vinc] of [
    ['sin marcas', [sinMarca(M.OPE), sinMarca(M.HOY)]],
    ['con una marca', [sinMarca(M.OPE), { machineryId: M.HOY, estadoAt: '2026-10-20T11:30:00.000Z', conMarca: true }]],
  ]) {
    for (const tabla of ['machinery', 'maintenance_requests', 'machine_rounds']) {
      reiniciar();
      usarBase(TABLAS, (t) => t === tabla);
      const err = await fallo(conRelojFijo(() => D.cargarEstadoInspeccion(vinc)));
      ok(`⭐ M3: ${como}, si falla ${tabla} → lanza «No se pudo leer el estado de inspección…» (y no devuelve nada)`,
        err instanceof Error && /^No se pudo leer el estado de inspección/.test(err.message), err?.message);
      ok(`M3: * sin perder el error original (${como}, ${tabla})`, !!err?.cause);
    }
  }
  reiniciar();
  usarBase(TABLAS, (t) => t === 'maintenance_requests');
  ok('M3: * sin señal se dice «se perdió la conexión»', /se perdió la conexión/.test((await fallo(D.cargarEstadoInspeccion([sinMarca(M.OPE)])))?.message ?? ''));

  // 6) Lotes de 100: 150 vinculadas → dos consultas por tabla, sin perder ninguna.
  const MUCHAS = Array.from({ length: 150 }, (_, i) => id(1000 + i));
  reiniciar();
  usarBase({ machinery: MUCHAS.map((mid) => ficha(mid)) });
  const porLotes = await conRelojFijo(() => D.cargarEstadoInspeccion(MUCHAS.map(sinMarca)));
  eq('M3: en lotes de 100 (la lista viaja en la dirección)', registros.filter((l) => l.tabla === 'machinery').map((l) => argsDe(l, 'in')?.[1].length), [100, 50]);
  eq('M3: * y entrega las 150, operativas', [Object.keys(porLotes.porMaquina).length, Object.values(porLotes.porMaquina).every((x) => x.estado === 'operativa')], [150, true]);
  reiniciar();
  usarBase({ machinery: MUCHAS.map((mid) => ficha(mid)) });
  await conRelojFijo(() => D.cargarEstadoInspeccion(MUCHAS.map((mid) => ({ machineryId: mid, estadoAt: '2026-10-20T12:00:00.000Z', conMarca: true }))));
  eq('M3 (A2): los hechos van en lotes de 50 (cada máquina lleva su ventana en la dirección)', lecturas.filter((l) => l.tabla === 'machine_rounds').map((l) => argsDe(l, 'in')?.[1].length), [50, 50, 50]);

  // 7) Los íconos de los subconteos de la librería pura son los del sistema.
  const P = loadTs(path.join(ROOT, 'src/lib/centroOperacionesMaquinariaBloques.ts'));
  eq('M3: SUB_SITIO_INFO usa los íconos de ESTADO_CONTEO_INFO (parada, espera, retirada, transferida)',
    ['parada', 'espera', 'retirada', 'transferida'].map((k) => P.SUB_SITIO_INFO[k].icono), ['parada', 'espera', 'retirada', 'transferida'].map((k) => L.ESTADO_CONTEO_INFO[k].icon));
  // 8) De punta a punta: lo leído → estadoDelSitio (la pura) sin pasar por la pantalla.
  const uni = (o) => ({ id: 'U', sitioId: SITIO, origen: 'catalogo', machineryId: null, codigo: 'U', descripcion: null, placa: null, serial: null, marca: null,
    modelo: null, dueno: null, capacidadM3: null, activo: true, nota: null, estado: null, estadoNota: null, estadoAt: null, chofer: null, ...o });
  const ahora = FIJO;
  eq('M3 punta a punta: sin marca manda inspección; con marca anterior a la jornada → superada; con marca posterior a la avería → manda ella',
    [
      P.estadoDelSitio(uni({ machineryId: M.HOY }), leidoInsp, ahora).grupo,
      P.estadoDelSitio(uni({ machineryId: M.REA, estado: 'averiada', estadoAt: '2026-10-20T12:00:00.000Z' }), conMarcas, ahora).marcaEstado,
      P.estadoDelSitio(uni({ machineryId: M.HOY, estado: 'disponible', estadoAt: '2026-10-20T12:10:00.000Z' }), conMarcas, ahora).fuente,
    ],
    ['averiada', 'superada', 'sitio']);
};

run()
  .catch((e) => { ok(`las pruebas de comportamiento corren sin reventar (${String(e?.stack ?? e).split('\n').slice(0, 2).join(' | ')})`, false); })
  .finally(cerrar);
