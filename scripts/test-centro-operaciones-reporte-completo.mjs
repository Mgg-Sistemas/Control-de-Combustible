// 🏭 Pruebas del 📄 REPORTE COMPLETO del CENTRO DE OPERACIONES (PD5a, 25-oct-2026).
//
// src/lib/centroOperacionesReporteCompleto.ts junta todo lo del 📅 Parte diario de un
// sitio en un período (un día o un rango de jornadas) en UN papel de 7 secciones:
//   1) Reporte General desglosado · 2) Entrada por patio · 3) Salida de agregados ·
//   4) Acero · 5) Aluminio y plástico · 6) Maquinaria · 7) Bloques.
// Y `cargarDatosReporteCompleto` (centroOperacionesDb.ts) junta lo que el modelo
// necesita reutilizando las lecturas que ya existen.
//
// Las reglas que vigilan estos candados:
//   · En un rango, el Reporte General es la SUMA de los días (el mismo nombre escrito
//     distinto es UNA fila, con la primera forma escrita) y se nombran las jornadas
//     que no lo tienen.
//   · La entrada por patio se compara con el Reporte General de ESAS jornadas, en tono
//     neutro (nunca «error»); las jornadas con patios y sin reporte se nombran aparte.
//   · Las ventas de bloques NO son salidas de agregados (van en la sección 7).
//   · El acero sin pesar dice «pendiente de pesaje» y su tonelada no suma.
//   · Todo texto del usuario sale LITERAL (escapado), nunca como HTML.
//   · Lo oculto no deja rastro: ni título, ni hueco, ni numeración que delate el salto.
//   · Un período vacío: las 7 secciones con «Sin registros en el período.», sin NaN.
//
// ⭐ Todos los datos de abajo son SINTÉTICOS: nada de empresas, placas ni cifras reales
//    (el repositorio es público).
//
//   node scripts/test-centro-operaciones-reporte-completo.mjs
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
// El mismo de scripts/test-centro-operaciones-datos.mjs: `selectAllRows` anota la
// tabla, las columnas y los filtros; nada sale a la red.
const registros = [];
const lecturas = [];
let responderLectura = () => [];
const anotadorFiltro = (ll) => {
  const b = new Proxy({}, { get(_, prop) { return (...args) => { ll.ops.push([String(prop), args]); return b; }; } });
  return b;
};
const SUPABASE_FALSO = {
  isSupabaseConfigured: true,
  supabase: {
    from(tabla) {
      const ll = { tabla, ops: [] };
      registros.push(ll);
      const b = new Proxy({}, {
        get(_, prop) {
          if (prop === 'then') return (res) => Promise.resolve({ data: [], error: null }).then(res);
          return (...args) => { ll.ops.push([String(prop), args]); return b; };
        },
      });
      return b;
    },
    rpc() { throw new Error('rpc prohibido en el Centro de Operaciones'); },
  },
  async selectAllRows(tabla, columnas, filter, orderBy = 'id') {
    const ll = { tabla, columnas, orderBy, ops: [] };
    lecturas.push(ll);
    if (filter) filter(anotadorFiltro(ll));
    return responderLectura(ll);
  },
};
const reiniciar = () => { registros.length = 0; lecturas.length = 0; responderLectura = () => []; };

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
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
/** Corre `fn` y, si revienta (p. ej. la función todavía no existe), cuenta la falla en vez de abortar. */
const intenta = (name, fn, siFalla = '') => {
  try { return fn(); } catch (e) { fail++; failures.push(`${name}\n    reventó: ${e && e.message}`); return siFalla; }
};
const cuenta = (texto, pedazo) => String(texto).split(pedazo).length - 1;

const SRC_RC = path.join(ROOT, 'src/lib/centroOperacionesReporteCompleto.ts');
const RC = fs.existsSync(SRC_RC) ? intenta('la librería carga', () => loadTs(SRC_RC), {}) : {};
const D = intenta('la capa de datos carga', () => loadTs(path.join(ROOT, 'src/lib/centroOperacionesDb.ts')), {});
const PAPEL = intenta('la librería de papeles carga', () => loadTs(path.join(ROOT, 'src/lib/centroOperacionesPapel.ts')), {});

// ——— Datos sintéticos ———————————————————————————————————————————————————————
let seq = 0;
/** Un renglón con todo en blanco salvo lo que se le pase. */
const mov = (o = {}) => ({
  id: `m${++seq}`, sitioId: 's1', fecha: '2026-10-06', hora: null, tipo: 'entrada',
  unidadId: null, unidadTexto: '', placa: null,
  transportista: null, transportistaId: null, origen: null, origenId: null,
  destino: null, destinoId: null, material: null, materialId: null,
  capacidadM3: null, viajes: 1, toneladas: null, m3: null, estado: 'confirmado',
  observacion: null, chofer: null, km: null, vehiculo: null, cantidad: null,
  unidadIngresada: null, disponibleDesde: null,
  creadoPor: null, creadoAt: null, editadoPor: null, editadoAt: null,
  ...o,
});
const rg = (o = {}) => ({
  id: `r${++seq}`, sitioId: 's1', fecha: '2026-10-06', horaCorte: '19:00', viajesTotal: null, toneladasTotal: null,
  empresas: [], frentes: [], avisos: [], textoOriginal: '', creadoPor: null, creadoAt: null, editadoPor: null, editadoAt: null,
  ...o,
});
const item = (o = {}) => ({
  id: `l${++seq}`, sitioId: 's1', clase: 'material', nombre: 'X', activo: true,
  lat: null, lng: null, km: null, factorTM3: null, diasDisponible: null, ...o,
});
const unidad = (o = {}) => ({
  id: `u${++seq}`, sitioId: 's1', origen: 'propia', machineryId: null, codigo: 'U-0', descripcion: null, placa: null,
  serial: null, marca: null, modelo: null, dueno: null, capacidadM3: null, activo: true, nota: null,
  estado: 'disponible', estadoNota: null, estadoAt: null, chofer: null, ...o,
});

// Tres jornadas: el 06 y el 08 con Reporte General; el 07 SIN él.
const REPORTES = [
  rg({
    fecha: '2026-10-06', viajesTotal: 12, toneladasTotal: 280.5,
    empresas: [{ nombre: 'Transportista Uno', viajes: 7, toneladas: 160.25 }, { nombre: 'Transportista Dos', viajes: 5, toneladas: 120.25 }],
    frentes: [{ nombre: 'Obra Norte', viajes: 6, toneladas: 150 }, { nombre: 'Obra Sur', viajes: 6, toneladas: 130.5 }],
  }),
  rg({
    fecha: '2026-10-08', viajesTotal: 8, toneladasTotal: 190,
    empresas: [{ nombre: ' transportista  UNO ', viajes: 3, toneladas: 70 }, { nombre: 'Transportista Tres', viajes: 5, toneladas: 120 }],
    frentes: [{ nombre: 'OBRA NORTE', viajes: 8, toneladas: 190 }],
  }),
  // Fuera del período: no cuenta.
  rg({ fecha: '2026-10-09', viajesTotal: 99, toneladasTotal: 999, empresas: [{ nombre: 'Transportista Fuera', viajes: 99, toneladas: 999 }] }),
];

const P_A = item({ clase: 'terraza', nombre: 'Patio A' });
const P_B = item({ clase: 'terraza', nombre: 'Patio B' });
const P_C = item({ clase: 'terraza', nombre: 'Patio C', activo: false }); // desactivado después: su historia sigue
const BLOQUES = item({ clase: 'material', nombre: 'Bloques', diasDisponible: 7 });
const LISTAS = [P_A, P_B, P_C, BLOQUES, item({ clase: 'destino', nombre: 'Planta Norte', km: 12.5 })];

const MOVS = [
  // ── Entrada por patio ──
  mov({ fecha: '2026-10-06', destino: 'Patio A', destinoId: P_A.id, viajes: 7 }),
  mov({ fecha: '2026-10-06', destino: 'Patio B', destinoId: P_B.id, viajes: 4 }),
  mov({ fecha: '2026-10-06', destino: 'Terraza Vieja', viajes: 2 }), // suelta: no es un patio de la lista
  mov({ fecha: '2026-10-06', transportista: 'Transportista Uno', origen: 'Obra Norte', destino: 'Patio A', viajes: 9 }), // no es fila de patio
  mov({ fecha: '2026-10-07', destino: 'Patio A', destinoId: P_A.id, viajes: 5 }), // día SIN Reporte General
  mov({ fecha: '2026-10-08', destino: ' patio b ', viajes: 9 }), // por nombre
  mov({ fecha: '2026-10-08', destino: 'Patio C', destinoId: P_C.id, viajes: 1 }),
  // ── Agregados ──
  mov({ fecha: '2026-10-06', tipo: 'salida', material: 'Triturado mixto', m3: 12, toneladas: 14.4, unidadIngresada: 'm3', destino: 'Planta Norte', km: 12.5, vehiculo: 'propio', unidadId: 'u-x', unidadTexto: 'U-1' }),
  mov({ fecha: '2026-10-06', tipo: 'salida', material: ' triturado MIXTO ', m3: 12, toneladas: 14.4, unidadIngresada: 'm3', destino: 'planta NORTE ', km: 12.5, vehiculo: 'propio', unidadId: 'u-x', unidadTexto: 'U-1' }),
  mov({ fecha: '2026-10-07', tipo: 'salida', material: 'Arrocillo', m3: 5, toneladas: 6, unidadIngresada: 't', destino: 'Cantera X', vehiculo: 'externo', transportista: 'Transportes Beta' }),
  // ── Acero ──
  mov({ fecha: '2026-10-06', tipo: 'salida', material: 'Acero', m3: 8, toneladas: null, estado: 'esperando_pesaje', unidadIngresada: 'm3', vehiculo: 'externo', transportista: 'Acería Uno', unidadTexto: 'Camión 7' }),
  mov({ fecha: '2026-10-08', tipo: 'salida', material: 'Acero', m3: 6, toneladas: 7.5, unidadIngresada: 'm3', vehiculo: 'propio', transportista: 'Nosotros', unidadTexto: 'U-2', placa: 'AB12CD' }),
  // ── Aluminio y plástico ──
  mov({ fecha: '2026-10-07', tipo: 'salida', material: 'Aluminio', toneladas: 1.25, unidadIngresada: 't', transportista: 'Recicladora Gamma', vehiculo: 'externo', destino: 'Planta Delta' }),
  mov({ fecha: '2026-10-08', tipo: 'salida', material: 'Plástico', toneladas: 0.8, unidadIngresada: 'kg', transportista: 'nosotros', vehiculo: 'propio' }),
  // ── Bloques: producción y una VENTA (salida «Bloques» sin viajes) ──
  mov({ fecha: '2026-10-06', tipo: 'produccion', material: 'Bloques', materialId: BLOQUES.id, cantidad: 30, viajes: null, unidadIngresada: 'u', disponibleDesde: '2026-10-13' }),
  mov({ fecha: '2026-10-07', tipo: 'salida', material: 'Bloques', materialId: BLOQUES.id, cantidad: 50, viajes: null, unidadIngresada: 'u', destino: 'Cliente Epsilon' }),
  // Fuera del período (llegó de más): no cuenta en ninguna sección.
  mov({ fecha: '2026-10-09', tipo: 'salida', material: 'Triturado mixto', m3: 100, toneladas: 120, destino: 'Planta Norte', km: 12.5, vehiculo: 'propio' }),
];
const ANTERIORES = [
  mov({ fecha: '2026-09-25', tipo: 'produccion', material: 'Bloques', materialId: BLOQUES.id, cantidad: 100, viajes: null, unidadIngresada: 'u', disponibleDesde: '2026-10-02' }),
  mov({ fecha: '2026-10-01', tipo: 'produccion', material: 'Bloques', materialId: BLOQUES.id, cantidad: 40, viajes: null, unidadIngresada: 'u', disponibleDesde: '2026-10-08' }),
];
const UNIDADES = [
  unidad({ codigo: 'U-1', descripcion: 'Volteo', placa: 'AA11BB' }),
  unidad({ codigo: 'U-2', estado: 'averiada', estadoNota: 'Motor <b>fundido</b> & "caja"', estadoAt: '2026-10-07T19:15:00Z' }),
  unidad({ codigo: 'U-3', estado: 'averiada', activo: false }), // dada de baja: no está en el sitio
];

const entrada = (o = {}) => ({
  sitio: 'Sitio Prueba', desde: '2026-10-06', hasta: '2026-10-08', hoy: '2026-10-09',
  reportes: REPORTES, movimientos: MOVS, anteriores: ANTERIORES, unidades: UNIDADES, listas: LISTAS, ...o,
});
const OP = { ocultosSecciones: [] };

console.log('🏭 CENTRO DE OPERACIONES · REPORTE COMPLETO\n');

// ═══════════════════ 0. Lo que exporta ═══════════════════
{
  eq('exporta modeloReporteCompleto', typeof RC.modeloReporteCompleto, 'function');
  eq('exporta cuerpoReporteCompleto', typeof RC.cuerpoReporteCompleto, 'function');
  const S = RC.SECCIONES_COMPLETO ?? [];
  eq('⭐ SECCIONES_COMPLETO: las 7, en el orden de su hoja', S.map((s) => s.k),
    ['reporteGeneral', 'patios', 'agregados', 'acero', 'aluminioPlastico', 'maquinaria', 'bloques']);
  ok('SECCIONES_COMPLETO: cada una con etiqueta y nombre para el archivo', S.length === 7 && S.every((s) => String(s.etiqueta).trim() && String(s.enArchivo).trim()));
  ok('SECCIONES_COMPLETO: los nombres del archivo no se repiten', new Set(S.map((s) => s.enArchivo)).size === S.length);
  ok('SECCIONES_COMPLETO: el nombre del archivo no lleva caracteres prohibidos', S.every((s) => !/[\\/:*?"<>|]/.test(s.enArchivo)));
  eq('TITULO_REPORTE_COMPLETO', RC.TITULO_REPORTE_COMPLETO, 'Reporte completo');
  // PD5b: su CSS vive en CSS_COP (el único de los papeles del módulo; la pestaña tiene un solo pdfDocument).
  ok('⭐ PD5b: el CSS del papel está en CSS_COP (sin un CSS aparte)', !('CSS_REPORTE_COMPLETO' in RC)
    && String(PAPEL.CSS_COP ?? '').includes('.cop-vacio') && String(PAPEL.CSS_COP ?? '').includes('.cop-nota') && String(PAPEL.CSS_COP ?? '').includes('.cop-pdte'));
  ok('⭐ PD5b: SECCIONES_COMPLETO es la MISMA lista que SECCIONES_COP.completo (una sola fuente)', RC.SECCIONES_COMPLETO === PAPEL.SECCIONES_COP?.completo);
}

const M = intenta('modelo del período de prueba', () => RC.modeloReporteCompleto(entrada()), null);
const H = M ? intenta('cuerpo del período de prueba', () => RC.cuerpoReporteCompleto(M, OP)) : '';

// ═══════════════════ 1. Reporte General desglosado ═══════════════════
if (M) {
  const r = M.reporteGeneral;
  eq('RG: el período tiene 3 jornadas y 2 con Reporte General', [M.jornadas, r.jornadasConReporte], [3, 2]);
  eq('⭐ RG: nombra la jornada del período SIN Reporte General', r.jornadasSinReporte, ['2026-10-07']);
  eq('⭐ RG: en un rango, la SUMA de los días; el mismo nombre escrito distinto es UNA fila con la primera forma',
    r.empresas.map((f) => [f.nombre, f.viajes, f.toneladas, f.pct]),
    [['Transportista Uno', 10, 230.25, 50], ['Transportista Dos', 5, 120.25, 25], ['Transportista Tres', 5, 120, 25]]);
  eq('RG: los frentes también se juntan («OBRA NORTE» = «Obra Norte»)',
    r.frentes.map((f) => [f.nombre, f.viajes, f.toneladas, f.pct]), [['Obra Norte', 14, 340, 70], ['Obra Sur', 6, 130.5, 30]]);
  eq('RG: totales del período = suma de los totales de cada reporte (lo de fuera del período no cuenta)',
    [r.viajesTotal, r.toneladasTotal], [20, 470.5]);
  ok('RG: el papel dice la jornada sin reporte', H.includes('Jornadas sin Reporte General: 07/10/2026'));
  ok('RG: el papel trae las empresas con su %', H.includes('Transportista Uno') && H.includes('50,0 %') && H.includes('230,25'));
  ok('RG: el papel trae los totales del período', H.includes('470,50') && /\b20\b/.test(H));
  ok('RG: nada de fuera del período', !H.includes('Transportista Fuera') && !H.includes('999'));
  ok('RG: sin la nota de descuadre cuando las sumas cuadran', !H.includes('no coincide'));
}
{
  // Un rango largo con dos reportes: las jornadas sin reporte salen juntas («del … al …»).
  const m = intenta('RG rango largo', () => RC.modeloReporteCompleto(entrada({
    desde: '2026-10-01', hasta: '2026-10-10', movimientos: [], anteriores: null, unidades: [],
    reportes: [rg({ fecha: '2026-10-01', viajesTotal: 1, toneladasTotal: 1, empresas: [{ nombre: 'E1', viajes: 1, toneladas: 1 }] }),
      rg({ fecha: '2026-10-10', viajesTotal: 1, toneladasTotal: 1, empresas: [{ nombre: 'E1', viajes: 1, toneladas: 1 }] })],
  })), null);
  const h = m ? intenta('RG rango largo (cuerpo)', () => RC.cuerpoReporteCompleto(m, OP)) : '';
  ok('RG: los días seguidos sin reporte se dicen como un tramo', h.includes('Jornadas sin Reporte General: del 02/10/2026 al 09/10/2026'));
  // Un solo día sin reporte: «Sin registros…», sin la línea de jornadas faltantes.
  const m1 = intenta('RG un día sin reporte', () => RC.modeloReporteCompleto(entrada({ desde: '2026-10-07', hasta: '2026-10-07' })), null);
  const h1 = m1 ? intenta('RG un día sin reporte (cuerpo)', () => RC.cuerpoReporteCompleto(m1, { ocultosSecciones: ['patios', 'agregados', 'acero', 'aluminioPlastico', 'maquinaria', 'bloques'] })) : '';
  ok('RG: un día sin Reporte General → «Sin registros en el período.»', cuenta(h1, 'Sin registros en el período.') === 1 && !h1.includes('Jornadas sin Reporte General'));
  // Las sumas no cuadran con el total del reporte: se dice, en tono neutro.
  const m2 = intenta('RG descuadre', () => RC.modeloReporteCompleto(entrada({
    desde: '2026-10-06', hasta: '2026-10-06',
    reportes: [rg({ fecha: '2026-10-06', viajesTotal: 12, toneladasTotal: 300, empresas: [{ nombre: 'E1', viajes: 10, toneladas: 250 }], frentes: [{ nombre: 'F1', viajes: 12, toneladas: 300 }] })],
  })), null);
  const h2 = m2 ? intenta('RG descuadre (cuerpo)', () => RC.cuerpoReporteCompleto(m2, OP)) : '';
  ok('RG: si las empresas no suman el total, una nota neutra (nunca «error»)', h2.includes('no coincide') && !/error|descuadre/i.test(h2));
  // Sin viajes en las filas: el % es 0, nunca NaN.
  const m3 = intenta('RG ceros', () => RC.modeloReporteCompleto(entrada({
    desde: '2026-10-06', hasta: '2026-10-06',
    reportes: [rg({ fecha: '2026-10-06', viajesTotal: 0, toneladasTotal: 0, empresas: [{ nombre: 'E1', viajes: 0, toneladas: 0 }] })],
  })), null);
  eq('RG: filas en cero → % en 0 (sin dividir entre cero)', m3?.reporteGeneral.empresas.map((f) => f.pct), [0]);
  // Toneladas que suman con decimales feos: se redondea al final.
  const m4 = intenta('RG redondeo', () => RC.modeloReporteCompleto(entrada({
    desde: '2026-10-06', hasta: '2026-10-07',
    reportes: [rg({ fecha: '2026-10-06', viajesTotal: 1, toneladasTotal: 0.1, empresas: [{ nombre: 'E1', viajes: 1, toneladas: 0.1 }] }),
      rg({ fecha: '2026-10-07', viajesTotal: 1, toneladasTotal: 0.2, empresas: [{ nombre: 'E1', viajes: 1, toneladas: 0.2 }] })],
  })), null);
  eq('RG: 0,1 + 0,2 = 0,3 (redondeo al final)', [m4?.reporteGeneral.empresas[0]?.toneladas, m4?.reporteGeneral.toneladasTotal], [0.3, 0.3]);
  // Un reporte sin totales: el total del período es «sin dato», no 0.
  const m5 = intenta('RG sin totales', () => RC.modeloReporteCompleto(entrada({
    desde: '2026-10-06', hasta: '2026-10-06', reportes: [rg({ fecha: '2026-10-06', empresas: [{ nombre: 'E1', viajes: 3, toneladas: 30 }] })],
  })), null);
  eq('RG: sin totales escritos → null («sin dato»)', [m5?.reporteGeneral.viajesTotal, m5?.reporteGeneral.toneladasTotal], [null, null]);
}

// ═══════════════════ 2. Entrada por patio ═══════════════════
if (M) {
  const p = M.patios;
  eq('patios: viajes del período por patio (un patio desactivado conserva su historia)', p.filas.map((f) => [f.patio, f.viajes]),
    [['Patio A', 12], ['Patio B', 13], ['Patio C', 1]]);
  eq('patios: la suma', p.suma, 26);
  eq('patios: la entrada suelta (destino que no es un patio) se muestra aparte y no suma', p.otros, [{ destino: 'Terraza Vieja', viajes: 2 }]);
  eq('⭐ patios: las jornadas con patios y SIN Reporte General se nombran', p.jornadasSinReporte, ['2026-10-07']);
  ok('⭐ patios: se compara contra el Reporte General de ESAS jornadas (06: 11 vs 12; 08: 10 vs 8)', String(p.comparacion).includes('Patios 21 · Reporte 20 · diferencia +1'));
  ok('patios: el papel trae la comparación y las jornadas sin reporte', H.includes('Patios 21 · Reporte 20 · diferencia +1') && H.includes('07/10/2026'));
  ok('patios: tono neutro (nunca «error» ni «descuadre»)', !/error|descuadre/i.test(H));
}
{
  const m = intenta('patios un día sin reporte', () => RC.modeloReporteCompleto(entrada({ desde: '2026-10-07', hasta: '2026-10-07' })), null);
  eq('patios: un día con patios y sin Reporte General', m?.patios.comparacion, 'Patios 5 · sin Reporte General de ese día');
  const m2 = intenta('patios un día con reporte', () => RC.modeloReporteCompleto(entrada({ desde: '2026-10-06', hasta: '2026-10-06' })), null);
  eq('patios: un día con los dos datos', m2?.patios.comparacion, 'Patios 11 · Reporte 12 · diferencia −1');
  const m3 = intenta('patios rango sin ningún reporte', () => RC.modeloReporteCompleto(entrada({ reportes: [] })), null);
  ok('patios: rango sin ningún Reporte General → sin comparación, y las jornadas se nombran', m3 && m3.patios.comparacion === null
    && JSON.stringify(m3.patios.jornadasSinReporte) === JSON.stringify(['2026-10-06', '2026-10-07', '2026-10-08']));
}

// ═══════════════════ 3. Salida de agregados ═══════════════════
if (M) {
  const a = M.agregados;
  eq('⭐ agregados: por material, destino, km y vehículo; el mismo material escrito distinto se junta',
    a.filas.map((f) => [f.material, f.destino, f.km, f.vehiculo, f.viajes, f.m3, f.toneladas]),
    [['Arrocillo', 'Cantera X', null, 'Externo: Transportes Beta', 1, 5, 6], ['Triturado mixto', 'Planta Norte', 12.5, 'Propio', 2, 24, 28.8]]);
  ok('⭐ agregados: las VENTAS de bloques no están (van en la sección 7)', !a.filas.some((f) => /bloque/i.test(f.material)));
  eq('agregados: totales (sin bloques, sin acero, sin aluminio)', [a.total.viajes, a.total.m3, a.total.toneladas], [3, 29, 34.8]);
  eq('agregados: por vehículo (propio primero, luego cada empresa externa)', a.porVehiculo.map((v) => [v.vehiculo, v.viajes]),
    [['Propio', 2], ['Externo: Transportes Beta', 1]]);
  ok('agregados: el papel trae los km congelados', H.includes('12,5'));
}
{
  // Una salida sin toneladas pesadas: «sin dato», no 0.
  const m = intenta('agregados sin t', () => RC.modeloReporteCompleto(entrada({
    desde: '2026-10-06', hasta: '2026-10-06', movimientos: [mov({ tipo: 'salida', material: 'Polvillo', m3: 3, destino: 'D', estado: 'esperando_pesaje' })],
  })), null);
  eq('agregados: sin toneladas pesadas → null («sin dato»), no 0', [m?.agregados.filas[0]?.toneladas, m?.agregados.total.toneladas], [null, null]);
}

// ═══════════════════ 4. Acero ═══════════════════
if (M) {
  const a = M.acero;
  eq('acero: una fila por salida, en el orden de la jornada', a.filas.map((f) => [f.fecha, f.quien, f.camion, f.m3, f.toneladas, f.pendiente]),
    [['2026-10-06', 'Acería Uno', 'Camión 7', 8, null, true], ['2026-10-08', 'Nosotros', 'U-2 · AB12CD', 6, 7.5, false]]);
  eq('⭐ acero: la tonelada pendiente no suma; se cuentan los pendientes', [a.total.m3, a.total.toneladas, a.total.pendientes], [14, 7.5, 1]);
  ok('⭐ acero: el papel dice «pendiente de pesaje»', H.includes('pendiente de pesaje'));
  eq('acero: por quién se lo lleva (con dos o más)', a.porQuien.map((q) => [q.quien, q.salidas, q.m3, q.toneladas, q.pendientes]),
    [['Acería Uno', 1, 8, null, 1], ['Nosotros', 1, 6, 7.5, 0]]);
}

// ═══════════════════ 5. Aluminio y plástico ═══════════════════
if (M) {
  const a = M.aluminioPlastico;
  eq('aluminio y plástico: t, empresa y destino («nosotros» = «Nosotros»)', a.filas.map((f) => [f.material, f.empresa, f.destino, f.toneladas]),
    [['Aluminio', 'Recicladora Gamma', 'Planta Delta', 1.25], ['Plástico', 'Nosotros', 'Sin destino', 0.8]]);
  eq('aluminio y plástico: el total', a.total.toneladas, 2.05);
}

// ═══════════════════ 6. Maquinaria ═══════════════════
if (M) {
  const q = M.maquinaria;
  eq('maquinaria: conteo de las ACTIVAS (la dada de baja no está en el sitio)', [q.conteo?.disponibles, q.conteo?.averiadas, q.total], [1, 1, 2]);
  eq('maquinaria: las averiadas primero, con su nota y su «desde» (M5: el modelo de la regla única)', (q.filas ?? []).map((f) => [f.codigo, f.descripcion, f.estado, f.detalle, f.nota]),
    [['U-2', null, 'Averiada', 'desde 07/10', 'Motor <b>fundido</b> & "caja"'], ['U-1', 'Volteo', 'Disponible', '', null]]);
  ok('M5 maquinaria: sin vinculadas, sin la columna Inspección ni aviso de lectura', q.conInspeccion === false && q.avisoLectura === null && !H.includes('>Inspección<'));
  ok('M5 maquinaria: la dada de baja no sale', !H.includes('U-3'));
  ok('⭐ maquinaria: si el período no termina hoy, el papel dice que el estado es el de ahora', !!q.notaAhora && H.includes(q.notaAhora));
  // ⭐ PD5b (auditoría del lote 5, A11): el estado vive en la flota, sin historia por jornada.
  //    El papel SIEMPRE dice que es el del momento de emitir (también si el período termina hoy).
  eq('⭐ PD5b A11: el período no termina hoy → «el del momento de emitir» y de qué día no es', q.notaAhora,
    'El estado de las máquinas es el del momento de emitir este papel (jornada del 09/10/2026), no el del 08/10/2026.');
  const m = intenta('maquinaria hoy', () => RC.modeloReporteCompleto(entrada({ hasta: '2026-10-09', hoy: '2026-10-09' })), null);
  eq('⭐ PD5b A11: un rango que termina hoy → no es el de cada jornada del período', m?.maquinaria.notaAhora,
    'El estado de las máquinas es el del momento de emitir este papel, no el de cada jornada del período.');
  const m1 = intenta('maquinaria un día hoy', () => RC.modeloReporteCompleto(entrada({ desde: '2026-10-09', hasta: '2026-10-09', hoy: '2026-10-09' })), null);
  eq('PD5b A11: un solo día, hoy → el estado al emitir', m1?.maquinaria.notaAhora, 'Estado de las máquinas al momento de emitir este papel.');
  const mx = intenta('maquinaria sin hoy', () => RC.modeloReporteCompleto(entrada({ hoy: 'basura' })), null);
  eq('PD5b A11: sin saber qué día es hoy → igual lo dice', mx?.maquinaria.notaAhora, 'El estado de las máquinas es el del momento de emitir este papel.');
  const hm1 = m1 ? intenta('maquinaria un día hoy (cuerpo)', () => RC.cuerpoReporteCompleto(m1, OP)) : '';
  ok('PD5b A11: …y el papel lo imprime dentro de la sección 6', hm1.includes('Estado de las máquinas al momento de emitir este papel.')
    && hm1.indexOf('Estado de las máquinas al momento') > hm1.indexOf('6. Maquinaria') && hm1.indexOf('Estado de las máquinas al momento') < hm1.indexOf('7. Bloques'));
}

// ═══════════════════ 6b. Maquinaria según inspección (M5, mesa de maquinaria §4.3) ═══════════════════
// Todo inventado: códigos, placas, motivos y horas. La hora de Caracas es UTC−4.
const AHORA_M5 = Date.parse('2026-10-25T10:45:00.000Z'); // 25/10/2026, 06:45 a. m.
const T5 = (hhmm, dia = '2026-10-25') => `${dia}T${String(Number(hhmm.slice(0, 2)) + 4).padStart(2, '0')}:${hhmm.slice(3, 5)}:00.000Z`;
const INFO5 = { operativa: ['Operativa', '✅'], averiada: ['Averiada', '🔴'], parada: ['Parada', '🟡'], espera: ['Esperando instrucciones', '⏳'], retirada: ['Retirada', '⬛'], transferida: ['Transferida a otros', '🔁'] };
const dice5 = (estado, o = {}) => ({ encontrada: true, estado, etiqueta: INFO5[estado][0], icono: INFO5[estado][1], motivo: null, desdeMs: null, enVivo: null, novedad: null, reactivadaMs: null, ...o });
const vin5 = (codigo, machineryId, o = {}) => unidad({ codigo, origen: 'catalogo', machineryId, estado: null, ...o });
const FLOTA5 = [
  vin5('UNI-03', 'MQ-3', { placa: 'AAA-001', estado: 'averiada', estadoAt: T5('06:10'), estadoNota: 'caucho espichado' }),
  vin5('UNI-07', 'MQ-7', { placa: 'AAA-002' }),
  vin5('UNI-02', 'MQ-2'),
  unidad({ codigo: 'PROP-1', placa: 'AAA-003', estado: 'disponible', estadoAt: T5('17:30', '2026-10-22') }),
  vin5('UNI-09', 'MQ-9', { estado: 'disponible', estadoAt: T5('09:00', '2026-10-15'), estadoNota: 'nota en pausa' }),
  vin5('UNI-05', 'MQ-5', { estado: 'averiada', estadoAt: T5('06:00'), estadoNota: 'nota superada' }),
  vin5('UNI-11', 'MQ-11'),
  vin5('UNI-12', 'MQ-12', { activo: false, estado: 'averiada', estadoAt: T5('05:00') }), // dada de baja
];
const INSP5 = {
  leidaAt: T5('06:44'),
  porMaquina: {
    'MQ-3': dice5('operativa'),
    'MQ-7': dice5('averiada', { motivo: 'falla <b>hidráulica</b>', desdeMs: Date.parse(T5('08:38', '2026-10-20')) }),
    'MQ-2': dice5('parada', { motivo: 'no hay volqueta' }),
    'MQ-9': dice5('espera'),
    'MQ-5': dice5('operativa', { novedad: { ms: Date.parse(T5('06:30')), que: 'jornada', motivo: null } }),
    'MQ-11': dice5('operativa', { enVivo: 'trabajando' }),
  },
};
/** El texto de la fila (`<tr>…</tr>`) de una unidad en el papel. */
const filaDe = (html, codigo) => (String(html).match(/<tr>(?:(?!<\/tr>).)*<\/tr>/gs) ?? []).find((tr) => tr.includes(`>${codigo}`)) ?? '';
/** El HTML de la sección 6 (de su título hasta el de la 7). */
const sec6 = (html) => { const s = String(html); const i = s.indexOf('6. Maquinaria'); const j = s.indexOf('7. Bloques'); return i >= 0 ? s.slice(i, j > i ? j : undefined) : ''; };
{
  const m = intenta('M5 modelo con inspección', () => RC.modeloReporteCompleto(entrada({ unidades: FLOTA5, inspeccion: INSP5, emitidoMs: AHORA_M5, hasta: '2026-10-25', desde: '2026-10-25', hoy: '2026-10-25' })), null);
  const h = m ? intenta('M5 cuerpo con inspección', () => RC.cuerpoReporteCompleto(m, OP)) : '';
  const s6 = sec6(h);
  const q = m?.maquinaria ?? {};
  ok('⭐ M5.1 el estado es el del momento de EMITIR, con fecha y hora, en el título de la sección', s6.includes('Estado al emitir: 25/10/2026, 06:45 a. m.') && s6.indexOf('Estado al emitir') < s6.indexOf('<table'), s6.slice(0, 300));
  ok('M5.1 * y conserva la nota A11 (no es el de cada jornada)', s6.includes('Estado de las máquinas al momento de emitir este papel.'));
  ok('⭐ M5.2 columnas Estado (sitio) e Inspección (hay vinculadas)', s6.includes('>Estado (sitio)<') && s6.includes('>Inspección<') && q.conInspeccion === true);
  ok('⭐ M5.3 tarjetas por grupo con sus subconteos y el total (la de baja no cuenta)',
    s6.includes('<span>Disponibles</span><b>4</b><small>1 parada</small>') && s6.includes('<span>Averiadas</span><b>2</b>')
    && s6.includes('<span>No disponibles (oficina)</span><b>1</b><small>1 en espera</small>') && s6.includes('<span>Total</span><b>7</b>') && !s6.includes('<span>Sin dato</span>'), s6);
  const r03 = filaDe(s6, 'UNI-03');
  ok('⭐ M5.4 «≠» donde la marca del sitio no coincide con inspección', r03.includes('Averiada') && r03.includes('≠') && r03.includes('marcado en el sitio, 25/10 06:10 a. m.') && r03.includes('Operativa') && r03.includes('caucho espichado'), r03);
  ok('M5.4 * y en ninguna otra fila', ['UNI-07', 'UNI-02', 'PROP-1', 'UNI-09', 'UNI-05', 'UNI-11'].every((c) => !filaDe(s6, c).includes('≠')));
  ok('M5.4 * con su leyenda (una sola vez)', cuenta(s6, 'no coincide con inspección') === 1);
  const r07 = filaDe(s6, 'UNI-07');
  ok('⭐ M5.5 vinculada sin marca: manda inspección («según inspección»), con motivo y «desde» sin hora', r07.includes('Averiada') && r07.includes('según inspección') && r07.includes('Averiada — falla &lt;b&gt;hidráulica&lt;/b&gt; · desde 20/10') && !r07.includes('08:38'), r07);
  const r02 = filaDe(s6, 'UNI-02');
  ok('M5.5 * una parada cuenta como Disponible y la columna Inspección dice «Parada»', r02.includes('Disponible') && r02.includes('Parada — no hay volqueta'), r02);
  const rP = filaDe(s6, 'PROP-1');
  ok('⭐ M5.6 la unidad del sitio: «— solo del sitio» y su «desde»', rP.includes('Disponible') && rP.includes('desde 22/10') && rP.includes('— solo del sitio') && rP.includes('AAA-003'), rP);
  const r09 = filaDe(s6, 'UNI-09');
  ok('M5.7 en espera: la palabra del sistema y la marca vieja en pausa no se imprime', r09.includes('Esperando instrucciones') && !r09.includes('nota en pausa') && !s6.includes('nota en pausa'), r09);
  const r05 = filaDe(s6, 'UNI-05');
  ok('⭐ M5.8 una marca SUPERADA no sale como vigente (ni su nota)', r05.includes('Disponible') && r05.includes('según inspección') && !r05.includes('Averiada') && !s6.includes('nota superada'), r05);
  ok('⭐ M5.9 sin horas trabajadas, sin inspectores, sin «trabajando ahora»', !/trabaj|horas|inspector/i.test(s6.replace(/Inspección/g, '')), s6);
  ok('M5.9 * la que trabaja ahora sale Disponible, sin la pista en vivo', filaDe(s6, 'UNI-11').includes('Disponible'));
  ok('M5.10 la dada de baja no sale', !s6.includes('UNI-12'));
  ok('M5.10 * ni aviso de lectura (se leyó)', !s6.includes('No se pudo leer'));
  ok('M5.11 orden del papel: averiadas, disponibles, no disponibles', s6.indexOf('UNI-03') < s6.indexOf('UNI-07') && s6.indexOf('UNI-07') < s6.indexOf('UNI-02') && s6.indexOf('UNI-11') < s6.indexOf('UNI-09'));
  ok('M5.11 * sin NaN ni undefined', !/NaN|undefined|Infinity/.test(s6));

  // ── Inspección NO se pudo leer al emitir ──
  const ms = intenta('M5 modelo sin leer', () => RC.modeloReporteCompleto(entrada({ unidades: FLOTA5, inspeccion: null, emitidoMs: AHORA_M5, desde: '2026-10-25', hasta: '2026-10-25', hoy: '2026-10-25' })), null);
  const hs = ms ? intenta('M5 cuerpo sin leer', () => RC.cuerpoReporteCompleto(ms, OP)) : '';
  const ss = sec6(hs);
  ok('⭐ M5.12 sin leer: el aviso arriba de la tabla', ss.includes('No se pudo leer el estado de inspección al emitir: se imprime lo marcado en el sitio.') && ss.indexOf('No se pudo leer') < ss.indexOf('<table'), ss.slice(0, 400));
  ok('⭐ M5.12 * las vinculadas SIN marca salen «Sin dato», NUNCA «Disponible» (el arreglo de M5)',
    ['UNI-07', 'UNI-02', 'UNI-11'].every((c) => { const r = filaDe(ss, c); return r.includes('Sin dato') && !r.includes('Disponible') && !r.includes('Averiada'); }), ['UNI-07', 'UNI-02', 'UNI-11'].map((c) => filaDe(ss, c)).join('\n'));
  ok('M5.12 * las marcadas salen con su marca «sin verificar» y sin «≠»', filaDe(ss, 'UNI-03').includes('sin verificar') && !ss.includes('≠'));
  ok('M5.12 * la tarjeta «Sin dato» las cuenta', ss.includes('<span>Sin dato</span><b>3</b>'), ss);
  ok('M5.12 * y la unidad del sitio sigue igual', filaDe(ss, 'PROP-1').includes('— solo del sitio'));

  // ── Antes de M5 una vinculada sin marca salía «Disponible» en el papel: nunca más ──
  const viejo = intenta('M5 sin pasar inspección', () => RC.modeloReporteCompleto(entrada({ unidades: [vin5('UNI-20', 'MQ-20')] })), null);
  eq('⭐ M5.13 sin inspección (no se pasó), una vinculada sin marca es «Sin dato»', viejo?.maquinaria.filas?.map((f) => [f.codigo, f.estado]), [['UNI-20', 'Sin dato']]);

  // ── Ya no está en el catálogo ──
  const mf = intenta('M5 fuera del catálogo', () => RC.modeloReporteCompleto(entrada({
    unidades: [vin5('UNI-30', 'MQ-30')], inspeccion: { leidaAt: T5('06:44'), porMaquina: { 'MQ-30': { ...dice5('operativa'), encontrada: false, estado: null, etiqueta: null, icono: null } } }, emitidoMs: AHORA_M5,
  })), null);
  const hf = mf ? intenta('M5 fuera del catálogo (cuerpo)', () => RC.cuerpoReporteCompleto(mf, OP)) : '';
  ok('M5.14 vinculada que ya no está en el catálogo: lo dice, sin inventar estado', filaDe(hf, 'UNI-30').includes('Ya no está en el catálogo del sistema') && filaDe(hf, 'UNI-30').includes('Sin dato'));

  // ── Lo oculto no deja rastro ──
  const ho = m ? intenta('M5 oculta', () => RC.cuerpoReporteCompleto(m, { ocultosSecciones: ['maquinaria'] })) : '';
  ok('⭐ M5.15 maquinaria oculta: ni título, ni hora de emisión, ni columnas, ni aviso', ho.length > 0 && !ho.includes('Maquinaria') && !ho.includes('Estado al emitir') && !ho.includes('Inspección') && !ho.includes('≠') && !ho.includes('UNI-03'));
  ok('M5.15 * y las opciones no se anuncian', !/oculto|apagad/i.test(ho));

  // ── Sin la hora de emisión (la pantalla arma el modelo sin ella) ──
  const mn = intenta('M5 sin emitidoMs', () => RC.modeloReporteCompleto(entrada({ unidades: FLOTA5, inspeccion: INSP5 })), null);
  const hn = mn ? intenta('M5 sin emitidoMs (cuerpo)', () => RC.cuerpoReporteCompleto(mn, OP)) : '';
  ok('M5.16 sin la hora de emisión: sin «Estado al emitir» y sin NaN', !hn.includes('Estado al emitir') && !/NaN|undefined/.test(sec6(hn)));

  // ── Escapado de lo que viene de inspección y del sitio ──
  const malo = '<script>x</script>';
  const me = intenta('M5 escapado', () => RC.modeloReporteCompleto(entrada({
    unidades: [vin5(malo, 'MQ-E', { placa: malo, descripcion: malo, estado: 'averiada', estadoAt: T5('06:10'), estadoNota: malo })],
    inspeccion: { leidaAt: T5('06:44'), porMaquina: { 'MQ-E': dice5('averiada', { motivo: malo, desdeMs: Date.parse(T5('05:00')) }) } }, emitidoMs: AHORA_M5,
  })), null);
  const he = me ? intenta('M5 escapado (cuerpo)', () => RC.cuerpoReporteCompleto(me, OP)) : '';
  ok('⭐ M5.17 todo texto (código, placa, nota, motivo de inspección) sale escapado', he.includes('&lt;script&gt;x&lt;/script&gt;') && !he.includes('<script'));
}

// ═══════════════════ 6c. Leer inspección al emitir (M5) ═══════════════════
{
  eq('M5.20 exporta vinculadasParaInspeccion', typeof RC.vinculadasParaInspeccion, 'function');
  eq('M5.20 exporta leerInspeccionAlEmitir', typeof RC.leerInspeccionAlEmitir, 'function');
  const vs = intenta('vinculadasParaInspeccion', () => RC.vinculadasParaInspeccion(FLOTA5), []);
  eq('⭐ M5.21 solo las vinculadas ACTIVAS del sitio, con su marca y su hora', vs, [
    { machineryId: 'MQ-3', estadoAt: T5('06:10'), conMarca: true },
    { machineryId: 'MQ-7', estadoAt: null, conMarca: false },
    { machineryId: 'MQ-2', estadoAt: null, conMarca: false },
    { machineryId: 'MQ-9', estadoAt: T5('09:00', '2026-10-15'), conMarca: true },
    { machineryId: 'MQ-5', estadoAt: T5('06:00'), conMarca: true },
    { machineryId: 'MQ-11', estadoAt: null, conMarca: false },
  ]);
  eq('M5.21 * sin vinculadas, ninguna', intenta('sin vinculadas', () => RC.vinculadasParaInspeccion(UNIDADES), null), []);
  eq('M5.21 * basura o nada, ninguna', intenta('basura', () => RC.vinculadasParaInspeccion(null), null), []);

  if (typeof RC.leerInspeccionAlEmitir === 'function') {
    const llamadas = [];
    const leerBien = async (v) => { llamadas.push(v); return INSP5; };
    const r1 = await RC.leerInspeccionAlEmitir({ unidades: UNIDADES, ocultosSecciones: [] }, leerBien);
    eq('⭐ M5.22 sin vinculadas NO se consulta nada', [llamadas.length, r1.inspeccion, r1.error, r1.consulto], [0, null, null, false]);
    const r2 = await RC.leerInspeccionAlEmitir({ unidades: FLOTA5, ocultosSecciones: ['maquinaria'] }, leerBien);
    eq('⭐ M5.22 con la sección oculta tampoco (lo oculto no se lee)', [llamadas.length, r2.consulto], [0, false]);
    const r3 = await RC.leerInspeccionAlEmitir({ unidades: FLOTA5, ocultosSecciones: ['patios'] }, leerBien);
    eq('⭐ M5.23 con vinculadas: UNA lectura, de esas', [llamadas.length, llamadas[0]?.length, r3.inspeccion === INSP5, r3.error, r3.consulto], [1, 6, true, null, true]);
    ok('M5.23 * con la hora de la lectura', typeof r3.ms === 'number' && Number.isFinite(r3.ms));
    const r4 = await RC.leerInspeccionAlEmitir({ unidades: FLOTA5 }, async () => { throw new Error('No se pudo leer el estado de inspección: se perdió la conexión.'); });
    eq('⭐ M5.24 si la lectura falla NO lanza: el papel sale igual (inspección null + el aviso)', [r4.inspeccion, r4.error, r4.consulto], [null, 'No se pudo leer el estado de inspección: se perdió la conexión.', true]);
    const r5 = await RC.leerInspeccionAlEmitir({ unidades: FLOTA5 }, () => new Promise(() => {}), 30);
    ok('⭐ M5.25 si inspección no responde, no bloquea el PDF: se corta con su aviso', r5.inspeccion === null && /No se pudo leer el estado de inspección/.test(r5.error ?? ''), r5.error);
    const r6 = await RC.leerInspeccionAlEmitir({ unidades: FLOTA5 }, async () => { throw 'raro'; });
    ok('M5.24 * un error sin mensaje también se dice en español', r6.inspeccion === null && /No se pudo leer el estado de inspección/.test(r6.error ?? ''));
    // Lo leído entra al papel tal cual.
    const m = intenta('M5 lectura → papel', () => RC.modeloReporteCompleto(entrada({ unidades: FLOTA5, inspeccion: r4.inspeccion, emitidoMs: r4.ms })), null);
    ok('M5.26 lectura fallida → el papel lleva el aviso', m?.maquinaria.avisoLectura === 'No se pudo leer el estado de inspección al emitir: se imprime lo marcado en el sitio.');
  }
}

// ═══════════════════ 7. Bloques ═══════════════════
if (M) {
  const b = M.bloques;
  eq('bloques: producción y ventas del PERÍODO', [b.producido, b.vendido], [30, 50]);
  eq('⭐ bloques: disponibles al corte (hasta) con la historia anterior; en curado y cuándo se liberan',
    [b.alDia, b.disponible, b.enCurado, b.proximos], ['2026-10-08', 90, 30, [{ fecha: '2026-10-13', cantidad: 30 }]]);
  ok('bloques: el papel trae la fecha de liberación', H.includes('13/10/2026'));
  const m = intenta('bloques sin producción en el período', () => RC.modeloReporteCompleto(entrada({ movimientos: [] })), null);
  eq('bloques: sin producción ni ventas en el período → «sin dato», pero con su inventario al corte',
    [m?.bloques.producido, m?.bloques.vendido, m?.bloques.disponible, m?.bloques.vacio], [null, null, 140, false]);
  const sinVenta = MOVS.filter((x) => !(x.tipo === 'salida' && x.material === 'Bloques'));
  const m2 = intenta('bloques sin anteriores', () => RC.modeloReporteCompleto(entrada({ anteriores: null, movimientos: sinVenta })), null);
  eq('bloques: sin historia anterior cargada (null) cuenta solo lo del período', [m2?.bloques.disponible, m2?.bloques.enCurado], [0, 30]);
}

// ═══════════════════ Casos de borde ═══════════════════
{
  // Un rango donde una jornada con patios tiene Reporte General SIN el total de viajes.
  const m = intenta('patios sin total', () => RC.modeloReporteCompleto(entrada({
    reportes: [rg({ fecha: '2026-10-06', viajesTotal: 12, toneladasTotal: 280.5 }), rg({ fecha: '2026-10-08', empresas: [{ nombre: 'E1', viajes: 3, toneladas: 30 }] })],
  })), null);
  eq('patios: la jornada cuyo reporte no trae el total se nombra aparte y no se compara',
    [m?.patios.jornadasSinTotal, m?.patios.jornadasSinReporte], [['2026-10-08'], ['2026-10-07']]);
  ok('patios: y la comparación es solo la del 06', String(m?.patios.comparacion).includes('1 jornada con los dos datos: Patios 11 · Reporte 12 · diferencia −1'));
  const h = m ? intenta('patios sin total (cuerpo)', () => RC.cuerpoReporteCompleto(m, OP)) : '';
  ok('patios: el papel lo dice', h.includes('no trae el total de viajes (no entran en la comparación): 08/10/2026'));

  // Acero por confirmar (✍️ Carga libre): no suma y su fila lo dice.
  const m2 = intenta('acero por confirmar', () => RC.modeloReporteCompleto(entrada({
    desde: '2026-10-06', hasta: '2026-10-06',
    movimientos: [mov({ tipo: 'salida', material: 'Acero', m3: 4, viajes: null, estado: 'por_confirmar', transportista: 'Acería Uno' })],
  })), null);
  const h2 = m2 ? intenta('acero por confirmar (cuerpo)', () => RC.cuerpoReporteCompleto(m2, OP)) : '';
  eq('acero por confirmar: no suma m³ ni viajes; se avisa como pendiente', [m2?.acero.total.m3, m2?.acero.total.viajes, m2?.acero.total.pendientesSinNumero], [null, 0, 1]);
  ok('acero por confirmar: la fila dice «Por confirmar»', h2.includes('Por confirmar'));

  // El material de los bloques con otro nombre (marcado con días): su venta tampoco es un agregado.
  const ADOQ = item({ clase: 'material', nombre: 'Adoquines', diasDisponible: 5 });
  const m3 = intenta('bloques con otro nombre', () => RC.modeloReporteCompleto(entrada({
    listas: [ADOQ], anteriores: [],
    movimientos: [
      mov({ tipo: 'produccion', material: 'Adoquines', materialId: ADOQ.id, cantidad: 20, viajes: null, unidadIngresada: 'u' }),
      mov({ fecha: '2026-10-08', tipo: 'salida', material: 'Adoquines', materialId: ADOQ.id, cantidad: 5, viajes: null, unidadIngresada: 'u' }),
    ],
  })), null);
  const h3 = m3 ? intenta('bloques con otro nombre (cuerpo)', () => RC.cuerpoReporteCompleto(m3, OP)) : '';
  eq('bloques con otro nombre: producción, venta y saldo con SUS días (5)', [m3?.bloques.producido, m3?.bloques.vendido, m3?.bloques.enCurado, m3?.bloques.proximos],
    [20, 5, 15, [{ fecha: '2026-10-11', cantidad: 15 }]]);
  ok('bloques con otro nombre: su venta NO es una salida de agregados', m3?.agregados.vacio === true);
  ok('bloques con otro nombre: el papel nombra el material', h3.includes('Material: Adoquines'));
}

// ═══════════════════ Escapado ═══════════════════
{
  const malo = '<script>alert(1)</script>';
  const m = intenta('escapado', () => RC.modeloReporteCompleto(entrada({
    sitio: `Sitio ${malo}`,
    reportes: [rg({ fecha: '2026-10-06', viajesTotal: 2, toneladasTotal: 2, empresas: [{ nombre: malo, viajes: 2, toneladas: 2 }], frentes: [{ nombre: '<b>&"', viajes: 2, toneladas: 2 }] })],
    listas: [item({ clase: 'terraza', nombre: `Patio ${malo}` })],
    movimientos: [
      mov({ destino: `Patio ${malo}`, viajes: 2 }),
      mov({ tipo: 'salida', material: malo, m3: 1, toneladas: 1.2, destino: '<i>D</i>', vehiculo: 'externo', transportista: '"E&F"' }),
      mov({ tipo: 'salida', material: 'Acero', m3: 1, estado: 'esperando_pesaje', transportista: malo, unidadTexto: '<u>C</u>' }),
      mov({ tipo: 'salida', material: 'Aluminio', toneladas: 1, unidadIngresada: 't', transportista: malo, destino: malo }),
    ],
    unidades: [unidad({ codigo: malo, estado: 'averiada', estadoNota: malo })],
  })), null);
  const h = m ? intenta('escapado (cuerpo)', () => RC.cuerpoReporteCompleto(m, OP)) : '';
  ok('⭐ escapado: ningún <script> pasa al papel', h.length > 0 && !h.includes('<script'));
  ok('⭐ escapado: sale literal (&lt;script&gt;)', h.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  ok('escapado: <b>&" sale literal', h.includes('&lt;b&gt;&amp;&quot;'));
  ok('escapado: ni <i>, ni <u> del usuario', !h.includes('<i>D</i>') && !h.includes('<u>C</u>'));
}
if (H) {
  ok('escapado: la nota de la máquina sale literal', H.includes('Motor &lt;b&gt;fundido&lt;/b&gt; &amp; &quot;caja&quot;'));
}

// ═══════════════════ Lo oculto no deja rastro ═══════════════════
if (M) {
  const h = intenta('oculto', () => RC.cuerpoReporteCompleto(M, { ocultosSecciones: ['patios'] }));
  ok('⭐ oculto: sin el título de la sección', !h.includes('Entrada por patio'));
  ok('⭐ oculto: ni sus datos', !h.includes('Patios 21') && !h.includes('Terraza Vieja'));
  ok('⭐ oculto: la numeración sigue sin hueco (la 3.ª visible es la 2)', h.includes('1. Reporte General desglosado') && h.includes('2. Salida de agregados') && !h.includes('3. Salida de agregados'));
  ok('oculto: las opciones no se anuncian en el papel', !/oculto|sin patios/i.test(h));
  const completo = intenta('completo', () => RC.cuerpoReporteCompleto(M, OP));
  ok('completo: las 7 numeradas 1 a 7', ['1. Reporte General desglosado', '2. Entrada por patio', '3. Salida de agregados', '4. Acero', '5. Aluminio y plástico', '6. Maquinaria', '7. Bloques'].every((t) => completo.includes(t)));
  const todoOculto = intenta('todo oculto', () => RC.cuerpoReporteCompleto(M, { ocultosSecciones: (RC.SECCIONES_COMPLETO ?? []).map((s) => s.k) }));
  ok('todo oculto: ninguna sección ni leyenda', !/\d\. /.test(todoOculto.replace(/<[^>]*>/g, ' ').replace(/\d{2}\/\d{2}\/\d{4}/g, '')) && !todoOculto.includes('Sin registros'));
  ok('oculto: op sin ocultosSecciones = todo a la vista', intenta('op vacío', () => RC.cuerpoReporteCompleto(M, {})).includes('7. Bloques'));
}

// ═══════════════════ Período vacío ═══════════════════
{
  const m = intenta('vacío', () => RC.modeloReporteCompleto({
    sitio: 'Sitio Vacío', desde: '2026-10-06', hasta: '2026-10-08', hoy: '2026-10-08',
    reportes: [], movimientos: [], anteriores: null, unidades: [], listas: [],
  }), null);
  const h = m ? intenta('vacío (cuerpo)', () => RC.cuerpoReporteCompleto(m, OP)) : '';
  eq('⭐ vacío: las 7 secciones con «Sin registros en el período.»', cuenta(h, 'Sin registros en el período.'), 7);
  ok('⭐ vacío: sin NaN, Infinity ni undefined', h.length > 0 && !/NaN|Infinity|undefined|null/.test(h));
  ok('vacío: cada sección conserva su título', ['Reporte General desglosado', 'Entrada por patio', 'Salida de agregados', 'Acero', 'Aluminio y plástico', 'Maquinaria', 'Bloques'].every((t) => h.includes(t)));
  ok('vacío: el modelo marca las 7 vacías', m && ['reporteGeneral', 'patios', 'agregados', 'acero', 'aluminioPlastico', 'maquinaria', 'bloques'].every((k) => m[k].vacio === true));
  const mal = intenta('período al revés', () => RC.modeloReporteCompleto({
    sitio: '', desde: '2026-10-08', hasta: '2026-10-06', hoy: 'basura', reportes: REPORTES, movimientos: MOVS, anteriores: null, unidades: [], listas: [],
  }), null);
  const hm = mal ? intenta('período al revés (cuerpo)', () => RC.cuerpoReporteCompleto(mal, OP)) : '';
  ok('período al revés o basura: no revienta ni imprime NaN', hm.length > 0 && !/NaN|Infinity|undefined/.test(hm));
}

// ═══════════════════ cargarDatosReporteCompleto (capa de datos) ═══════════════════
const SITIO = '00000000-0000-4000-8000-000000000001';
const filaLista = (o) => ({ id: 'l-1', sitio_id: SITIO, clase: 'material', nombre: 'X', activo: true, lat: null, lng: null, km: null, factor_t_m3: null, dias_disponible: null, ...o });
const filaMov = (o) => ({ id: `fm${++seq}`, sitio_id: SITIO, fecha: '2026-10-06', hora: null, tipo: 'entrada', unidad_texto: '', viajes: 1, estado: 'confirmado', ...o });
const filtros = (ll) => ll.ops.filter(([v]) => ['eq', 'gte', 'lte'].includes(v));
const fallo = async (p) => { try { await p; return null; } catch (e) { return e; } };

if (typeof D.cargarDatosReporteCompleto !== 'function') {
  ok('exporta cargarDatosReporteCompleto (centroOperacionesDb.ts)', false);
} else {
  const esAnterior = (ll) => ll.tabla === 'cop_movimientos' && ll.ops.some(([v]) => v === 'lt');
  reiniciar();
  responderLectura = (ll) => {
    if (ll.tabla === 'cop_listas') return [filaLista({ id: 'l-b', nombre: 'Bloques', dias_disponible: 7 })];
    if (esAnterior(ll)) return [filaMov({ fecha: '2026-09-25', tipo: 'produccion', material: 'Bloques', cantidad: 100, viajes: null })];
    if (ll.tabla === 'cop_movimientos') return [filaMov({ destino: 'Patio A' }), filaMov({ tipo: 'produccion', material: 'Bloques', cantidad: 30, viajes: null })];
    if (ll.tabla === 'cop_reportes_generales') return [{ id: 'r-1', sitio_id: SITIO, fecha: '2026-10-06', empresas: [], frentes: [], avisos: [] }];
    if (ll.tabla === 'cop_unidades') return [{ id: 'u-1', sitio_id: SITIO, origen: 'propia', codigo: 'U-1', activo: true }];
    return [];
  };
  const d = await D.cargarDatosReporteCompleto(SITIO, '2026-10-06', '2026-10-08');
  eq('datos: lee reportes, unidades y listas una vez, y cop_movimientos dos (el período y lo anterior con piezas)',
    lecturas.map((l) => l.tabla).sort(), ['cop_listas', 'cop_movimientos', 'cop_movimientos', 'cop_reportes_generales', 'cop_unidades']);
  const periodo = lecturas.find((l) => l.tabla === 'cop_movimientos' && !esAnterior(l));
  const anterior = lecturas.find(esAnterior);
  eq('datos: los movimientos del período (la lectura de siempre)', filtros(periodo ?? { ops: [] }),
    [['eq', ['sitio_id', SITIO]], ['gte', ['fecha', '2026-10-06']], ['lte', ['fecha', '2026-10-08']]]);
  eq('datos: los reportes del período', filtros(lecturas.find((l) => l.tabla === 'cop_reportes_generales') ?? { ops: [] }),
    [['eq', ['sitio_id', SITIO]], ['gte', ['fecha', '2026-10-06']], ['lte', ['fecha', '2026-10-08']]]);
  eq('⭐ datos: lo ANTERIOR al período son solo producciones y ventas con piezas (sin repetir el período)',
    (anterior?.ops ?? []).filter(([v]) => ['eq', 'lt', 'in', 'not', 'gte', 'lte'].includes(v)),
    [['eq', ['sitio_id', SITIO]], ['lt', ['fecha', '2026-10-06']], ['in', ['tipo', ['produccion', 'salida']]], ['not', ['cantidad', 'is', null]]]);
  ok('datos: lo anterior pide las mismas columnas que los movimientos', !!anterior && anterior.columnas === periodo?.columnas);
  eq('datos: devuelve lo leído ya traducido', [d.reportes.length, d.movimientos.length, d.movimientos[0]?.destino, d.anteriores?.[0]?.fecha, d.unidades[0]?.codigo, d.listas[0]?.nombre],
    [1, 2, 'Patio A', '2026-09-25', 'U-1', 'Bloques']);
  eq('datos: no escribe nada', registros.length, 0);
  const m = RC.modeloReporteCompleto ? intenta('modelo con lo cargado', () => RC.modeloReporteCompleto({ ...d, sitio: 'S', desde: '2026-10-06', hasta: '2026-10-08', hoy: '2026-10-08' }), null) : null;
  eq('⭐ datos → modelo: el inventario de bloques usa lo anterior al período', [m?.bloques.disponible, m?.bloques.enCurado], [100, 30]);

  // Período inválido: se dice en español, sin ir a la base.
  reiniciar();
  const e = await fallo(D.cargarDatosReporteCompleto(SITIO, '2026-10-08', '2026-10-06'));
  ok('datos: período al revés → error en español, sin leer nada', !!e && /período/.test(e.message) && lecturas.length === 0);
  const e2 = await fallo(D.cargarDatosReporteCompleto(SITIO, 'basura', '2026-10-06'));
  ok('datos: fecha basura → error en español', !!e2 && /período/.test(e2.message));
  // Una lectura que falla: el error de la lectura, en español.
  reiniciar();
  responderLectura = (ll) => { if (ll.tabla === 'cop_unidades') throw new Error('Failed to fetch'); return []; };
  const e3 = await fallo(D.cargarDatosReporteCompleto(SITIO, '2026-10-06', '2026-10-08'));
  ok('datos: si una lectura falla, el error dice qué no cargó', !!e3 && /unidades/.test(e3.message) && /conexión/.test(e3.message));
}

// ═══════════════════ Nada real en el código ═══════════════════
{
  const src = fs.existsSync(SRC_RC) ? fs.readFileSync(SRC_RC, 'utf8') : '';
  ok('la librería existe', src.length > 0);
  ok('la librería es PURA: no importa supabase ni React', !/from\s+['"][^'"]*supabase['"]/.test(src) && !/from\s+['"]react/.test(src) && !/selectAllRows|\.rpc\(/.test(src));
  ok('la librería no copia escaparHtml (lo importa del papel)', !/function\s+escaparHtml/.test(src) && /escaparHtml/.test(src));
  // PD5b: las piezas del HTML son las del papel (antes eran copias privadas).
  ok('⭐ PD5b: no copia tabla() ni ficha(): las importa del papel', !/function\s+(tabla|ficha)\s*[<(]/.test(src)
    && /import\s*\{[^}]*\btabla\b[^}]*\}\s*from\s*'\.\/centroOperacionesPapel'/.test(src) && /import\s*\{[^}]*\bficha\b[^}]*\}\s*from\s*'\.\/centroOperacionesPapel'/.test(src));
  ok('PD5b: ni su propio CSS (vive en CSS_COP)', !/CSS_REPORTE_COMPLETO/.test(src));
}

console.log(`${fail === 0 ? '✅' : '❌'} test-centro-operaciones-reporte-completo · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.map((f) => `  ✗ ${f}`).join('\n')); process.exit(1); }
