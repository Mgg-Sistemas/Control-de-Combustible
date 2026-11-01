// 🏭 CENTRO DE OPERACIONES — PRUEBAS DE MAQUINARIA, BLOQUES Y AJUSTES DEL 📅 PARTE DIARIO (PD4, 24-oct-2026).
//
// (1) La librería pura src/lib/centroOperacionesMaquinariaBloques.ts, con cifras exactas:
//     el material de los bloques, el «disponible desde» (lo producido el D se vende desde
//     D + 7), la entrada del inventario y sus avisos (una venta antes del curado avisa),
//     la cantidad escrita, la sugerencia de km EN LÍNEA RECTA, las coordenadas, el conteo
//     de la maquinaria y el «desde» de su estado.
// (1b) ⭐ La TABLA DE VERDAD del estado de cada unidad en el sitio (mesa de maquinaria, M3):
//     `estadoDelSitio`, `ultimoHecho`, `modoAlTocar`, los conteos, el WhatsApp, reactivar y el
//     modelo del papel, con los casos de las reservas A2 (reactivated_at) y A3 (nota o marca).
// (2) Candados ESTÁTICOS sobre el texto de los componentes (sin comentarios):
//     la marca de una unidad SOLO cambia por guardarMarcaUnidad / guardarNotaMarca; ningún archivo nuevo
//     habla con Supabase; solo Escritura/Full cambian; borrar, solo Full con confirmación;
//     ⚙️ Ajustes lleva el GPS del sitio, los km del destino con «Sugerir km en línea recta»,
//     el factor y los días del material, y «Patio» por terraza; 🚛 Flota lleva el chofer.
//
// ⭐ Todos los datos son SINTÉTICOS (el repositorio es público).
//
//   node scripts/test-centro-operaciones-maquinaria-bloques.mjs
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
  let v;
  try { v = typeof got === 'function' ? got() : got; } catch (e) { v = `reventó: ${e.message}`; }
  const g = JSON.stringify(v), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond, extra = '') => {
  let v;
  try { v = typeof cond === 'function' ? cond() : cond; } catch (e) { v = false; extra = `reventó: ${e.message}`; }
  if (v) pass++; else { fail++; failures.push(`✗ ${name}${extra ? '  -> ' + extra : ''}`); }
};

const LIB = path.join(ROOT, 'src/lib/centroOperacionesMaquinariaBloques.ts');
let L = {};
let M = {};
try { L = loadTs(LIB); } catch (e) { fail++; failures.push(`no se pudo cargar la librería: ${e.message}`); }
try { M = loadTs(path.join(ROOT, 'src/lib/centroOperacionesMateriales.ts')); } catch (e) { fail++; failures.push(`no se pudo cargar materiales: ${e.message}`); }
const llamar = (fn, ...args) => {
  if (typeof L[fn] !== 'function') return `«${fn}» no existe`;
  try { return L[fn](...args); } catch (e) { return `«${fn}» lanzó: ${e.message}`; }
};

console.log('🏭 CENTRO DE OPERACIONES · 🚜 MAQUINARIA, 🧱 BLOQUES Y ⚙️ AJUSTES (PD4)\n');

// ——— Fábricas sintéticas ———
const item = (o) => ({ id: 'L-' + (o.nombre ?? 'x'), sitioId: 'S1', clase: 'material', nombre: 'x', activo: true,
  lat: null, lng: null, km: null, factorTM3: null, diasDisponible: null, ...o });
const mov = (o) => ({ id: 'M' + Math.random().toString(36).slice(2, 8), sitioId: 'S1', fecha: '2026-10-20', hora: null, tipo: 'produccion',
  unidadId: null, unidadTexto: '', placa: null, transportista: null, transportistaId: null, origen: null, origenId: null,
  destino: null, destinoId: null, material: 'Bloques', materialId: null, capacidadM3: null, viajes: null, toneladas: null,
  m3: null, estado: 'confirmado', observacion: null, chofer: null, km: null, vehiculo: null, cantidad: null,
  unidadIngresada: 'u', disponibleDesde: null, creadoPor: null, creadoAt: null, editadoPor: null, editadoAt: null, ...o });
const unidad = (o) => ({ id: 'U-' + o.codigo, sitioId: 'S1', origen: 'propia', machineryId: null, codigo: 'X', descripcion: null,
  placa: null, serial: null, marca: null, modelo: null, dueno: null, capacidadM3: null, activo: true, nota: null,
  estado: 'disponible', estadoNota: null, estadoAt: null, chofer: null, ...o });

const leerCrudo = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), 'utf8') : '');

// ═══════════════════════ 1. EL MATERIAL DE LOS BLOQUES ═══════════════════════
{
  eq('1.1 sin lista: «Bloques», sin id, 7 días por defecto', llamar('materialDeBloques', []),
    { nombre: 'Bloques', listaId: null, dias: 7, diasDeLaLista: false });
  eq('1.2 el que se llama « bloques » (sin mayúsculas ni espacios) con sus 5 días',
    llamar('materialDeBloques', [item({ nombre: 'Arrocillo' }), item({ id: 'L-b', nombre: ' bloques ', diasDisponible: 5 })]),
    { nombre: 'bloques', listaId: 'L-b', dias: 5, diasDeLaLista: true });
  eq('1.3 sin «Bloques»: el material marcado con días hasta disponible',
    llamar('materialDeBloques', [item({ nombre: 'Polvillo' }), item({ id: 'L-a', nombre: 'Adoquín', diasDisponible: 3 })]),
    { nombre: 'Adoquín', listaId: 'L-a', dias: 3, diasDeLaLista: true });
  eq('1.4 «Bloques» gana aunque otro esté marcado; sin días propios → 7',
    llamar('materialDeBloques', [item({ id: 'L-a', nombre: 'Adoquín', diasDisponible: 3 }), item({ id: 'L-b', nombre: 'Bloques' })]),
    { nombre: 'Bloques', listaId: 'L-b', dias: 7, diasDeLaLista: false });
  eq('1.5 un «Bloques» desactivado no cuenta; uno de otra clase tampoco',
    llamar('materialDeBloques', [item({ nombre: 'Bloques', activo: false, diasDisponible: 2 }), item({ nombre: 'Bloques', clase: 'destino', diasDisponible: 4 })]),
    { nombre: 'Bloques', listaId: null, dias: 7, diasDeLaLista: false });
  eq('1.6 días 0 valen (se vende el mismo día)', llamar('materialDeBloques', [item({ id: 'L-b', nombre: 'Bloques', diasDisponible: 0 })]).dias, 0);
}

// ═══════════════════════ 2. DISPONIBLE DESDE ═══════════════════════
{
  eq('2.1 ⭐ lo producido el 20/10 se vende desde el 27/10 (7 por defecto)', llamar('disponibleDesde', '2026-10-20'), '2026-10-27');
  eq('2.2 con 7 explícito, igual', llamar('disponibleDesde', '2026-10-20', 7), '2026-10-27');
  eq('2.3 cruza el mes: 28/10 + 7 = 04/11', llamar('disponibleDesde', '2026-10-28', 7), '2026-11-04');
  eq('2.4 cruza el año: 30/12 + 5 = 04/01', llamar('disponibleDesde', '2026-12-30', 5), '2027-01-04');
  eq('2.5 0 días = el mismo día', llamar('disponibleDesde', '2026-10-20', 0), '2026-10-20');
  eq('2.6 días inválidos (−1, 2,5, null) → 7', [llamar('disponibleDesde', '2026-10-20', -1), llamar('disponibleDesde', '2026-10-20', 2.5), llamar('disponibleDesde', '2026-10-20', null)],
    ['2026-10-27', '2026-10-27', '2026-10-27']);
  eq('2.7 fecha imposible → vacío', llamar('disponibleDesde', '2026-02-30', 7), '');
}

// ═══════════════════════ 3. INVENTARIO: ENTRADA Y CIFRAS EXACTAS ═══════════════════════
{
  const mat = llamar('materialDeBloques', []);
  const movs = [
    mov({ fecha: '2026-10-20', tipo: 'produccion', cantidad: 100, disponibleDesde: '2026-10-27' }),
    mov({ fecha: '2026-10-21', tipo: 'produccion', cantidad: 40, disponibleDesde: '2026-10-28' }),
    // Una salida de agregados (no es de bloques) y una entrada: no entran.
    mov({ fecha: '2026-10-21', tipo: 'salida', material: 'Arrocillo', cantidad: null, m3: 10, viajes: 1 }),
    mov({ fecha: '2026-10-21', tipo: 'entrada', material: 'Bloques', cantidad: 9, viajes: 1 }),
  ];
  const e = llamar('entradaInventario', movs, mat);
  eq('3.1 la entrada: solo las producciones de bloques (fecha, cantidad y su liberación guardada)', e.producciones,
    [{ fecha: '2026-10-20', cantidad: 100, libera: '2026-10-27' }, { fecha: '2026-10-21', cantidad: 40, libera: '2026-10-28' }]);
  eq('3.2 * sin salidas y sin avisos', [e.salidas, e.avisos], [[], []]);

  const inv = (alDia, entrada = e) => M.inventarioBloques(entrada.producciones, entrada.salidas, alDia, mat.dias);
  const d26 = inv('2026-10-26');
  eq('3.3 ⭐ el 26/10 (D+6): 0 disponibles, 140 en curado', [d26.disponible, d26.enCurado], [0, 140]);
  eq('3.4 * y se liberan 100 el 27/10 y 40 el 28/10', d26.proximos, [{ fecha: '2026-10-27', cantidad: 100 }, { fecha: '2026-10-28', cantidad: 40 }]);
  const d27 = inv('2026-10-27');
  eq('3.5 ⭐ el 27/10 (D+7): los 100 ya están disponibles; 40 siguen curando', [d27.disponible, d27.enCurado], [100, 40]);

  // Una venta de 30 el 24/10: antes de que terminen de curar → aviso.
  const conVenta = llamar('entradaInventario', [...movs, mov({ fecha: '2026-10-24', tipo: 'salida', cantidad: 30, destino: 'Cliente A' })], mat);
  eq('3.6 la venta de bloques entra como salida', conVenta.salidas, [{ fecha: '2026-10-24', cantidad: 30 }]);
  const v27 = inv('2026-10-27', conVenta);
  ok('3.7 ⭐ una venta antes del curado AVISA con su fecha y lo que faltaba',
    v27.avisos.some((a) => a.includes('24/10/2026') && a.includes('faltaron 30')), JSON.stringify(v27.avisos));
  eq('3.8 * y el 27/10 quedan 70 disponibles y 40 en curado', [v27.disponible, v27.enCurado], [70, 40]);

  // Por el id de la lista, aunque el renglón tenga otro texto congelado.
  const matLista = llamar('materialDeBloques', [item({ id: 'L-b', nombre: 'Bloques de 15', diasDisponible: 7 })]);
  const porId = llamar('entradaInventario', [mov({ material: 'Bloque 15 viejo', materialId: 'L-b', cantidad: 12 })], matLista);
  eq('3.9 un renglón con el id de la lista entra aunque su texto sea otro (sin liberación guardada: fecha + días)', porId.producciones, [{ fecha: '2026-10-20', cantidad: 12, libera: '2026-10-27' }]);
  ok('3.10 por nombre: «Bloques» (el texto de siempre) entra aunque la lista lo llame distinto',
    llamar('esDeBloques', { material: ' BLOQUES ', materialId: null }, matLista) === true);
  ok('3.11 otro material no entra', llamar('esDeBloques', { material: 'Polvillo', materialId: null }, matLista) === false);

  // Sin cantidad: no entra y se avisa con la fecha.
  const sinCant = llamar('entradaInventario', [mov({ fecha: '2026-10-22', tipo: 'salida', cantidad: null, viajes: 1 })], mat);
  eq('3.12 una venta sin cantidad no entra', sinCant.salidas, []);
  ok('3.13 * y avisa con su fecha', sinCant.avisos.length === 1 && sinCant.avisos[0].includes('22/10/2026'), JSON.stringify(sinCant.avisos));

  // Días del material cambiados después de anotar (lote 5 A6): cada producción se libera
  // en SU «disponible desde» guardado, y el aviso solo informa.
  const otros = llamar('entradaInventario', [mov({ fecha: '2026-10-20', cantidad: 5, disponibleDesde: '2026-10-25' })], mat);
  eq('⭐ 3.14 A6: la producción entra con SU «disponible desde» guardado (no con los días de ahora)', otros.producciones, [{ fecha: '2026-10-20', cantidad: 5, libera: '2026-10-25' }]);
  eq('3.14b * así el 25/10 ya está disponible aunque el material diga 7 días',
    M.inventarioBloques(otros.producciones, otros.salidas, '2026-10-25', mat.dias).disponible, 5);
  ok('3.14c * el aviso solo informa: se libera en la fecha que se le puso al anotarla',
    otros.avisos.length === 1 && otros.avisos[0].includes('otros días') && otros.avisos[0].includes('se libera'), JSON.stringify(otros.avisos));
  const ilegible = llamar('entradaInventario', [mov({ fecha: '2026-10-20', cantidad: 5, disponibleDesde: 'basura' })], mat);
  eq('3.14d * un «disponible desde» ilegible no vale: fecha + días, sin aviso', [ilegible.producciones, ilegible.avisos],
    [[{ fecha: '2026-10-20', cantidad: 5, libera: '2026-10-27' }], []]);
  // Revisión final A#6: el saldo ya no baja toda la historia (solo las piezas anteriores + el día).
  ok('3.15 A#6 el inventario ya no carga TODA la historia del sitio (no queda INICIO_HISTORIA_BLOQUES)', !('INICIO_HISTORIA_BLOQUES' in L));
}

// ═══════════════════════ 4. CANTIDAD ESCRITA Y AVISO DE VENTA ═══════════════════════
{
  eq('4.1 «1200» = 1.200 bloques', llamar('cantidadDeCampo', '1200'), { valor: 1200, error: null });
  ok('4.1-A10 el comentario de cantidadDeCampo no promete que «1.200» sea 1200 (un solo punto es decimal)',
    !/«1\.200» = 1200/.test(leerCrudo('src/lib/centroOperacionesMaquinariaBloques.ts')));
  eq('4.1b «1.300,0» (miles y decimal) = 1.300', llamar('cantidadDeCampo', '1.300,0'), { valor: 1300, error: null });
  // La regla de la casa (leerNumero): un solo punto es el DECIMAL. «1.200» se lee 1,2 y NO
  // pasa callado: avisa que los bloques van enteros, mostrando lo que leyó.
  ok('4.1c «1.200» no se guarda callado como 1,2: avisa mostrando lo leído', llamar('cantidadDeCampo', '1.200').error?.includes('1,2'));
  eq('4.2 vacío = sin dato, sin error', llamar('cantidadDeCampo', '  '), { valor: null, error: null });
  ok('4.3 «12,5» no es un entero', llamar('cantidadDeCampo', '12,5').error?.includes('entero'));
  ok('4.4 «0» no vale (mayor que cero)', llamar('cantidadDeCampo', '0').error?.includes('mayor que cero'));
  ok('4.5 «-3» no vale', llamar('cantidadDeCampo', '-3').valor === null && !!llamar('cantidadDeCampo', '-3').error);
  eq('4.5b días hasta disponible: «7» = 7 y «0» = 0 (el mismo día)', [llamar('diasDeCampo', '7').valor, llamar('diasDeCampo', '0').valor], [7, 0]);
  eq('4.5c * vacío = sin dato (usa los 7 por defecto)', llamar('diasDeCampo', ''), { valor: null, error: null });
  ok('4.5d * «2,5» y «-1» no valen', !!llamar('diasDeCampo', '2,5').error && !!llamar('diasDeCampo', '-1').error);
  eq('4.6 vender lo que hay: sin aviso', llamar('avisoVenta', 50, 50, '2026-10-24'), null);
  const a = llamar('avisoVenta', 50, 80, '2026-10-24');
  ok('4.7 ⭐ vender de más avisa: fecha, disponibles, pedidos y cuánto falta',
    typeof a === 'string' && a.includes('24/10/2026') && a.includes('hay 50') && a.includes('80') && a.includes('faltan 30'), String(a));
}

// ═══════════════════════ 5. KM EN LÍNEA RECTA ═══════════════════════
{
  const G = (lat, lng) => ({ lat, lng });
  eq('5.1 ⭐ un grado sobre el ecuador = 111,2 km', llamar('kmSugerido', G(0, 0), G(0, 1)), 111.2);
  eq('5.2 sin GPS del destino → sin dato', llamar('kmSugerido', G(0, 0), G(null, null)), null);
  const t = llamar('textoSugerenciaKm', G(0, 0), G(0, 1));
  ok('5.3 ⭐ el texto dice la cifra y que es EN LÍNEA RECTA', t.includes('111,2 km en línea recta'), t);
  ok('5.4 ⭐ * y que por carretera es más', t.includes('por carretera es más'), t);
  ok('5.5 sin GPS del sitio, lo dice', llamar('textoSugerenciaKm', G(null, 2), G(0, 1)).includes('Falta el GPS del sitio'));
  ok('5.6 sin GPS del destino, lo dice', llamar('textoSugerenciaKm', G(0, 0), G(1, null)).includes('Falta el GPS del destino'));
  ok('5.7 fuera de rango, lo dice (no un número inventado)', llamar('textoSugerenciaKm', G(95, 0), G(0, 1)).includes('no se entiende'));
}

// ═══════════════════════ 6. COORDENADAS ESCRITAS ═══════════════════════
{
  eq('6.1 «10,6012» (coma decimal) = 10.6012', llamar('coordenadaDeCampo', '10,6012', 'lat'), { valor: 10.6012, error: null });
  eq('6.2 «-66.9301» = -66.9301', llamar('coordenadaDeCampo', '-66.9301', 'lng'), { valor: -66.9301, error: null });
  eq('6.3 vacío = sin dato', llamar('coordenadaDeCampo', '', 'lat'), { valor: null, error: null });
  ok('6.4 latitud 91 → error', !!llamar('coordenadaDeCampo', '91', 'lat').error);
  ok('6.5 longitud 181 → error', !!llamar('coordenadaDeCampo', '181', 'lng').error);
  ok('6.6 longitud 180 vale', llamar('coordenadaDeCampo', '180', 'lng').valor === 180);
  ok('6.7 texto colado → error', !!llamar('coordenadaDeCampo', '10,6 N', 'lat').error);
}

// ═══════════════════════ 7. MAQUINARIA ═══════════════════════
{
  const us = [
    unidad({ codigo: 'C-02' }),
    unidad({ codigo: 'C-01', estado: 'averiada' }),
    unidad({ codigo: 'C-03', estado: 'averiada', activo: false }),
    unidad({ codigo: 'A-09' }),
  ];
  eq('7.1 ⭐ conteo: 2 disponibles · 1 averiada (la de baja no cuenta)', llamar('conteoMaquinaria', us), { disponibles: 2, averiadas: 1, total: 3 });
  eq('7.2 las averiadas primero, cada grupo A→Z; sin las de baja', llamar('unidadesDelBloque', us).map((u) => u.codigo), ['C-01', 'A-09', 'C-02']);
  eq('7.3 «desde» en hora de Caracas (19:15 UTC = 03:15 p. m.)', llamar('textoDesde', '2026-10-20T19:15:00Z'), 'desde el 20/10/2026, 03:15 p. m.');
  eq('7.4 * pasada la medianoche UTC sigue siendo el día anterior en Caracas', llamar('textoDesde', '2026-10-21T02:00:00+00:00'), 'desde el 20/10/2026, 10:00 p. m.');
  eq('7.5 sin dato → vacío', [llamar('textoDesde', null), llamar('textoDesde', 'basura')], ['', '']);
  eq('7.6 la clase terraza se llama «Patio» / «Patios»', [llamar('etiquetaClaseLista', 'terraza'), llamar('etiquetaClaseLista', 'terraza', true)], ['Patio', 'Patios']);
}

// ═══════════════════════ 7b. ⭐ TABLA DE VERDAD DEL ESTADO EN EL SITIO (M3, mesa de maquinaria) ═══════════════════════
// Hora fija: lunes 20/10/2026, 11:00 a. m. en Caracas. La marca de referencia es de las 08:00.
{
  const AHORA = Date.parse('2026-10-20T15:00:00.000Z');          // 11:00 a. m.
  const T = (hhmm, dia = '2026-10-20') => `${dia}T${String(Number(hhmm.slice(0, 2)) + 4).padStart(2, '0')}:${hhmm.slice(3, 5)}:00.000Z`;
  const ms = (hhmm, dia) => Date.parse(T(hhmm, dia));
  const INFO = { operativa: ['Operativa', '✅'], averiada: ['Averiada', '🔴'], parada: ['Parada', '🟡'], espera: ['Esperando instrucciones', '⏳'], retirada: ['Retirada', '⬛'], transferida: ['Transferida a otros', '🔁'] };
  const dice = (estado, o = {}) => ({ encontrada: true, estado, etiqueta: INFO[estado][0], icono: INFO[estado][1], motivo: null, desdeMs: null, enVivo: null, novedad: null, reactivadaMs: null, ...o });
  const fuera = (o = {}) => ({ encontrada: false, estado: null, etiqueta: null, icono: null, motivo: null, desdeMs: null, enVivo: null, novedad: null, reactivadaMs: null, ...o });
  const leida = (i, mq = 'MQ-1') => ({ leidaAt: T('10:50'), porMaquina: { [mq]: i } });
  const vin = (o = {}) => unidad({ codigo: 'V-01', origen: 'catalogo', machineryId: 'MQ-1', estado: null, ...o });
  const conMarca = (estado, o = {}) => vin({ estado, estadoAt: T('08:00'), ...o });
  const E = (u, i) => llamar('estadoDelSitio', u, i, AHORA);
  /** Lo esencial de un estado, para comparar en una línea. */
  const corto = (e) => (typeof e === 'string' ? e : [e.grupo, e.sub, e.fuente, e.marcaEstado, e.encendida, e.noCoincide, e.sinVerificar, e.puedeMarcar, e.puedeSoltar]);
  const nov = (que, hhmm, dia) => ({ ms: ms(hhmm, dia), que, motivo: que === 'jornada' ? null : 'nota sintética' });

  // ── Unidades del sitio (sin vínculo) ──
  eq('7b.1 ⭐ del sitio ✅ → Disponible, «propia», pastilla encendida, sin «↩️»', corto(E(unidad({ codigo: 'P-1' }), null)),
    ['disponible', null, 'propia', 'vigente', 'disponible', false, false, true, false]);
  eq('7b.2 del sitio 🔧 → Averiada', corto(E(unidad({ codigo: 'P-2', estado: 'averiada' }), null)),
    ['averiada', null, 'propia', 'vigente', 'averiada', false, false, true, false]);
  eq('7b.3 ⭐ del sitio SIN estado (la base no lo deja; defensivo) → ❔ Sin dato, NUNCA Disponible', corto(E(unidad({ codigo: 'P-3', estado: null }), null)),
    ['sin_dato', null, 'propia', null, null, false, false, true, false]);
  eq('7b.4 del sitio: lo que diga inspección no la toca', corto(E(unidad({ codigo: 'P-4' }), leida(dice('averiada')))),
    ['disponible', null, 'propia', 'vigente', 'disponible', false, false, true, false]);

  // ── Vinculada SIN marca: manda inspección, en cada uno de los 6 estados ──
  eq('7b.5 ⭐ sin marca + Operativa → ✅ según inspección, ninguna pastilla encendida', corto(E(vin(), leida(dice('operativa')))),
    ['disponible', null, 'inspeccion', null, null, false, false, true, false]);
  eq('7b.6 ⭐ sin marca + Averiada → 🔧 según inspección', corto(E(vin(), leida(dice('averiada')))),
    ['averiada', null, 'inspeccion', null, null, false, false, true, false]);
  eq('7b.7 ⭐ sin marca + Parada → ✅ Disponible con 🟡 (D3)', corto(E(vin(), leida(dice('parada')))),
    ['disponible', 'parada', 'inspeccion', null, null, false, false, true, false]);
  const esp = E(vin(), leida(dice('espera')));
  eq('7b.8 ⭐ sin marca + En espera → ⛔ oficina, no se puede marcar (D4/D5)', corto(esp), ['oficina', 'espera', 'inspeccion', null, null, false, false, false, false]);
  ok('7b.8b * y dice por qué: lo maneja la oficina', /oficina/.test(esp.porQueNo ?? ''));
  eq('7b.9 sin marca + Retirada → ⛔ oficina (retirada)', corto(E(vin(), leida(dice('retirada')))), ['oficina', 'retirada', 'inspeccion', null, null, false, false, false, false]);
  eq('7b.10 sin marca + Transferida → ⛔ oficina (transferida)', corto(E(vin(), leida(dice('transferida')))), ['oficina', 'transferida', 'inspeccion', null, null, false, false, false, false]);

  // ── Con marca VIGENTE (posterior a todo hecho) ──
  eq('7b.11 ⭐ marca 🔧 posterior a todo hecho + inspección Operativa → manda ella, ⚠️ no coincide',
    corto(E(conMarca('averiada'), leida(dice('operativa', { novedad: nov('jornada', '07:30') })))),
    ['averiada', null, 'sitio', 'vigente', 'averiada', true, false, true, true]);
  eq('7b.12 marca ✅ + inspección Averiada (avería de antes de su marca) → manda ella, ⚠️',
    corto(E(conMarca('disponible'), leida(dice('averiada', { desdeMs: ms('07:00'), novedad: nov('averia_creada', '07:00') })))),
    ['disponible', null, 'sitio', 'vigente', 'disponible', true, false, true, true]);
  eq('7b.13 ⭐ marca ✅ + inspección Parada → coincide (Disponible = Operativa = Parada)', corto(E(conMarca('disponible'), leida(dice('parada')))),
    ['disponible', null, 'sitio', 'vigente', 'disponible', false, false, true, true]);
  eq('7b.14 marca 🔧 + inspección Averiada → coincide', corto(E(conMarca('averiada'), leida(dice('averiada')))),
    ['averiada', null, 'sitio', 'vigente', 'averiada', false, false, true, true]);

  // ── SUPERADA por un hecho posterior: vuelve a mandar inspección, sola ──
  const sup1 = E(conMarca('averiada'), leida(dice('averiada', { novedad: nov('averia_creada', '09:00') })));
  eq('7b.15 ⭐ avería REAL creada después → superada, manda inspección, ninguna pastilla, «↩️» sigue',
    corto(sup1), ['averiada', null, 'inspeccion', 'superada', null, false, false, true, true]);
  eq('7b.15b * con el hecho', [sup1.superadaPor?.que, sup1.superadaPor?.ms], ['averia_creada', ms('09:00')]);
  eq('7b.15c * y la línea «quedó atrás» (en la jornada en que pasó)', sup1.avisoMarca,
    '↪️ Tu marca 🔧 Averiada de hoy 08:00 a. m. quedó atrás: inspección reportó una avería a las 09:00 a. m.');
  eq('7b.16 avería real RESUELTA después → superada', corto(E(conMarca('averiada'), leida(dice('operativa', { novedad: nov('averia_resuelta', '09:30') })))),
    ['disponible', null, 'inspeccion', 'superada', null, false, false, true, true]);
  const sup3 = E(conMarca('averiada'), leida(dice('operativa', { enVivo: 'trabajando', novedad: nov('jornada', '10:00') })));
  eq('7b.17 ⭐ jornada iniciada por una persona después → superada', corto(sup3), ['disponible', null, 'inspeccion', 'superada', null, false, false, true, true]);
  eq('7b.17b * «inspección registró una jornada a las 10:00 a. m.»', sup3.avisoMarca, '↪️ Tu marca 🔧 Averiada de hoy 08:00 a. m. quedó atrás: inspección registró una jornada a las 10:00 a. m.');
  // Los MARCADORES de parada nunca son hecho (la lib no los entrega como novedad): un «no
  // trabajó» creado, resuelto o reabierto después NO vence la marca (D1, A3-S8).
  eq('7b.18 ⭐ marcador de parada CREADO después (inspección dice Parada, sin novedad) → NO vence',
    corto(E(conMarca('averiada'), leida(dice('parada', { desdeMs: ms('09:00'), motivo: 'no trabajó' })))),
    ['averiada', null, 'sitio', 'vigente', 'averiada', true, false, true, true]);
  eq('7b.19 marcador RESUELTO o REABIERTO después (sin novedad) → NO vence', [
    E(conMarca('averiada'), leida(dice('operativa'))).marcaEstado, E(conMarca('averiada'), leida(dice('parada'))).marcaEstado], ['vigente', 'vigente']);
  eq('7b.20 ⭐ salto de turno sin hechos (mañana de noche) → NO vence', llamar('estadoDelSitio', conMarca('averiada'), leida(dice('operativa')), Date.parse('2026-10-21T02:00:00.000Z')).marcaEstado, 'vigente');
  const supAyer = llamar('estadoDelSitio', conMarca('averiada'), leida(dice('operativa', { novedad: nov('jornada', '09:00') })), Date.parse('2026-10-21T15:00:00.000Z'));
  eq('7b.21 superada en OTRA jornada → sigue superada, pero sin la línea «quedó atrás»', [supAyer.marcaEstado, supAyer.avisoMarca], ['superada', null]);
  eq('7b.22 un hecho a la MISMA hora que la marca no la vence (tiene que ser posterior)',
    E(conMarca('averiada'), leida(dice('operativa', { novedad: nov('jornada', '08:00') }))).marcaEstado, 'vigente');

  // ── Oficina con marca vieja: EN PAUSA ──
  const pausa = E(conMarca('disponible', { estadoAt: T('08:00', '2026-10-15') }), leida(dice('espera')));
  eq('7b.23 ⭐ En espera con marca ✅ → «pausa», manda la oficina, pastillas apagadas, «↩️» sí',
    corto(pausa), ['oficina', 'espera', 'inspeccion', 'pausa', null, false, false, false, true]);
  eq('7b.23b * y lo dice', pausa.avisoMarca, '🏭 Tu marca ✅ del 15/10 está en pausa mientras la oficina la tenga así.');
  eq('7b.24 Retirada y Transferida con marca → pausa', [E(conMarca('averiada'), leida(dice('retirada'))).marcaEstado, E(conMarca('averiada'), leida(dice('transferida'))).marcaEstado], ['pausa', 'pausa']);
  eq('7b.24b un hecho no desaparece: superada antes de la espera sigue superada', E(conMarca('averiada'), leida(dice('espera', { novedad: nov('jornada', '09:00') }))).marcaEstado, 'superada');

  // ── Reserva A2: machinery.reactivated_at ──
  const vieja = { estadoAt: T('08:00', '2026-10-10') };
  const devuelta = E(conMarca('averiada', vieja), leida(dice('operativa', { reactivadaMs: ms('09:00') })));
  eq('7b.25 ⭐ A2: la oficina la devolvió a servicio DESPUÉS de la marca → superada y manda inspección',
    corto(devuelta), ['disponible', null, 'inspeccion', 'superada', null, false, false, true, true]);
  eq('7b.25b * «la oficina la devolvió a servicio el 20/10»', [devuelta.superadaPor?.que, devuelta.avisoMarca],
    ['reactivada', '↪️ Tu marca 🔧 Averiada del 10/10 quedó atrás: la oficina la devolvió a servicio el 20/10.']);
  eq('7b.26 A2: devuelta ANTES de la marca → la marca sigue vigente', E(conMarca('averiada'), leida(dice('operativa', { reactivadaMs: ms('07:00') }))).marcaEstado, 'vigente');
  eq('7b.27 A2: sin reactivated_at → vigente', E(conMarca('averiada', vieja), leida(dice('operativa'))).marcaEstado, 'vigente');
  eq('7b.28 ⭐ A2 (riesgo 6, a propósito): sale de En espera (sin fecha) → la marca vieja VUELVE a mandar',
    corto(E(conMarca('averiada', vieja), leida(dice('operativa')))), ['averiada', null, 'sitio', 'vigente', 'averiada', true, false, true, true]);
  eq('7b.29 ⭐ ultimoHecho elige el MÁS RECIENTE entre la novedad y la devolución a servicio', [
    llamar('ultimoHecho', dice('operativa', { novedad: nov('jornada', '09:00'), reactivadaMs: ms('10:00') }), AHORA)?.que,
    llamar('ultimoHecho', dice('operativa', { novedad: nov('jornada', '10:30'), reactivadaMs: ms('10:00') }), AHORA)?.que,
    llamar('ultimoHecho', dice('operativa', { novedad: nov('jornada', '10:00'), reactivadaMs: ms('10:00') }), AHORA)?.que,
    llamar('ultimoHecho', dice('operativa'), AHORA), llamar('ultimoHecho', null, AHORA)], ['reactivada', 'jornada', 'jornada', null, null]);
  eq('7b.29b * con su frase («hoy» sin fecha; otro día con fecha)', [
    llamar('ultimoHecho', dice('operativa', { novedad: nov('jornada', '09:00') }), AHORA)?.texto,
    llamar('ultimoHecho', dice('operativa', { novedad: nov('averia_resuelta', '09:00', '2026-10-18') }), AHORA)?.texto],
  ['inspección registró una jornada a las 09:00 a. m.', 'inspección resolvió una avería el 18/10 a las 09:00 a. m.']);

  // ── Inspección sin leer y fuera del catálogo ──
  eq('7b.30 ⭐ inspección SIN LEER, vinculada sin marca → ❔ Sin dato (nunca Disponible)', corto(E(vin(), null)),
    ['sin_dato', null, 'inspeccion', null, null, false, false, true, false]);
  eq('7b.31 ⭐ inspección sin leer, con marca → su marca «sin verificar» (sin «no coincide»)', corto(E(conMarca('averiada'), null)),
    ['averiada', null, 'sitio', 'vigente', 'averiada', false, true, true, true]);
  eq('7b.32 leída, pero sin esa máquina (agregada después) → como sin leer', corto(E(conMarca('disponible'), leida(dice('averiada'), 'OTRA'))),
    ['disponible', null, 'sitio', 'vigente', 'disponible', false, true, true, true]);
  const fueraCon = E(conMarca('disponible'), leida(fuera()));
  eq('7b.33 ⭐ ya no está en el catálogo, con marca → como del sitio (su marca), con su aviso', [...corto(fueraCon), fueraCon.fueraDelCatalogo],
    ['disponible', null, 'sitio', 'vigente', 'disponible', false, false, true, true, true]);
  eq('7b.34 fuera del catálogo sin marca → ❔ Sin dato', [...corto(E(vin(), leida(fuera()))), E(vin(), leida(fuera())).fueraDelCatalogo],
    ['sin_dato', null, 'inspeccion', null, null, false, false, true, false, true]);
  eq('7b.35 marca sin fecha (defensivo) → manda, «sin verificar», sin «no coincide»', corto(E(vin({ estado: 'averiada', estadoAt: null }), leida(dice('operativa')))),
    ['averiada', null, 'sitio', 'vigente', 'averiada', false, true, true, true]);

  // ── Reserva A3: ¿nota o marca nueva? Por la marca VIGENTE, nunca por la guardada ──
  const M = (u, i, tocado, soloNota) => llamar('modoAlTocar', llamar('estadoDelSitio', u, i, AHORA), tocado, soloNota);
  eq('7b.36 ⭐ A3: misma pastilla con marca vigente → «nota»', M(conMarca('averiada'), leida(dice('operativa')), 'averiada'), 'nota');
  eq('7b.37 ⭐ A3: misma pastilla con marca SUPERADA → «marca» (el caso que antes fallaba en silencio)',
    M(conMarca('averiada'), leida(dice('operativa', { novedad: nov('jornada', '10:00') })), 'averiada'), 'marca');
  eq('7b.38 A3: misma pastilla con inspección sin leer → «marca»', M(conMarca('averiada'), null, 'averiada'), 'marca');
  eq('7b.39 A3: otra pastilla → «marca»', M(conMarca('averiada'), leida(dice('operativa')), 'disponible'), 'marca');
  eq('7b.40 A3: vinculada sin marca → «marca»', M(vin(), leida(dice('averiada')), 'averiada'), 'marca');
  eq('7b.41 A3: del sitio, misma pastilla → «nota»; la otra → «marca»', [M(unidad({ codigo: 'P' }), null, 'disponible'), M(unidad({ codigo: 'P' }), null, 'averiada')], ['nota', 'marca']);
  eq('7b.42 ⭐ A3: marca en pausa (o sin marca en la oficina) → nada: pastillas apagadas', [M(conMarca('averiada'), leida(dice('espera')), 'averiada'), M(vin(), leida(dice('retirada')), 'disponible')], [null, null]);
  eq('7b.42b ⭐ B1 (lote 6): «📝 nota» (soloNota) en la marca que manda aunque esté sin verificar → «nota»; otra pastilla o sin marca → «marca»; en pausa → nada', [
    M(conMarca('averiada'), null, 'averiada', true), M(vin({ estado: 'averiada', estadoAt: null }), leida(dice('operativa')), 'averiada', true),
    M(conMarca('averiada'), null, 'disponible', true), M(vin(), leida(dice('averiada')), 'averiada', true), M(conMarca('averiada'), leida(dice('espera')), 'averiada', true),
    M(conMarca('averiada'), leida(dice('operativa', { novedad: nov('jornada', '10:00') })), 'averiada', true)],
    ['nota', 'nota', 'marca', 'marca', null, 'marca']);
  eq('7b.43 A3: la pastilla encendida solo con marca vigente o en una del sitio', [
    E(conMarca('averiada'), leida(dice('operativa'))).encendida,
    E(conMarca('averiada'), leida(dice('operativa', { novedad: nov('jornada', '10:00') }))).encendida,
    E(conMarca('averiada'), leida(dice('espera'))).encendida,
    E(vin(), leida(dice('averiada'))).encendida,
    E(unidad({ codigo: 'P', estado: 'averiada' }), null).encendida], ['averiada', null, null, null, 'averiada']);

  // ── Conteos, orden y textos ──
  const FLOTA = [
    unidad({ codigo: 'P-09' }),                                                            // ✅ del sitio
    unidad({ codigo: 'P-01', estado: 'averiada' }),                                        // 🔧 del sitio
    unidad({ codigo: 'P-99', estado: 'averiada', activo: false }),                         // de baja: no cuenta
    vin({ codigo: 'V-05', machineryId: 'A' }),                                             // ✅ operativa
    vin({ codigo: 'V-04', machineryId: 'B' }),                                             // ✅ 🟡 parada
    vin({ codigo: 'V-03', machineryId: 'C', estado: 'averiada', estadoAt: T('08:00'), placa: 'AAA-001', estadoNota: 'caucho espichado' }), // 🔧 ⚠️
    vin({ codigo: 'V-02', machineryId: 'D' }),                                             // 🔧 inspección
    vin({ codigo: 'V-07', machineryId: 'E' }),                                             // ⛔ espera
    vin({ codigo: 'V-08', machineryId: 'F' }),                                             // ❔ sin leer
  ];
  const INSP = { leidaAt: T('10:50'), porMaquina: { A: dice('operativa'), B: dice('parada', { motivo: 'no hay volqueta' }), C: dice('operativa'), D: dice('averiada', { motivo: 'falla hidráulica', desdeMs: ms('08:38', '2026-10-19') }), E: dice('espera') } };
  const filas = llamar('filasDelSitio', FLOTA, INSP, AHORA);
  eq('7b.44 ⭐ orden: 🔧 → ✅ → ⛔ → ❔; dentro, las ⚠️ primero y luego A→Z; sin las de baja', filas.map((f) => f.unidad.codigo),
    ['V-03', 'P-01', 'V-02', 'P-09', 'V-04', 'V-05', 'V-07', 'V-08']);
  eq('7b.44b unidadesDelBloque = el mismo orden', llamar('unidadesDelBloque', FLOTA, INSP, AHORA).map((u) => u.codigo), filas.map((f) => f.unidad.codigo));
  eq('7b.44c sin inspección leída, las vinculadas sin marca van a ❔ (al final)', llamar('unidadesDelBloque', FLOTA).map((u) => u.codigo),
    ['P-01', 'V-03', 'P-09', 'V-02', 'V-04', 'V-05', 'V-07', 'V-08']);
  const c = llamar('conteoDelSitio', filas);
  eq('7b.45 ⭐ conteos: los grupos SUMAN las activas, con subconteos', c, {
    total: 8, disponibles: 3, averiadas: 3, oficina: 1, sinDato: 1, paradas: 1, espera: 1, retiradas: 0, transferidas: 0, noCoinciden: 1, sinVerificar: 0 });
  ok('7b.45b * disponibles + averiadas + oficina + sin dato = total', c.disponibles + c.averiadas + c.oficina + c.sinDato === c.total);
  eq('7b.46 ⭐ la línea del bloque (grupos en 0 no salen)', llamar('textoConteoDelSitio', c),
    '✅ 3 disponibles (🟡 1 parada) · 🔧 3 averiadas · ⛔ 1 no disponible (⏳ 1 en espera) · ❔ 1 sin dato');
  eq('7b.46b el encabezado plegado: «✅ n · 🔧 m» y lo demás solo si hay', [llamar('textoConteoDelSitio', c, 'corto'),
    llamar('textoConteoDelSitio', llamar('conteoDelSitio', llamar('filasDelSitio', [unidad({ codigo: 'P' })], null, AHORA)), 'corto')],
  ['✅ 3 · 🔧 3 · ⛔ 1 · ❔ 1 · ⚠️ 1', '✅ 1 · 🔧 0']);
  eq('7b.46c sin unidades: la línea larga vacía', llamar('textoConteoDelSitio', llamar('conteoDelSitio', [])), '');
  // Lote 6 B3/B9: mientras inspección se lee por primera vez, «sin dato» no es «falló»; y el encabezado
  // plegado dice cuántas marcas no se pudieron comparar.
  const cLeyendo = llamar('conteoDelSitio', llamar('filasDelSitio', [unidad({ codigo: 'P' }), vin({ codigo: 'V1' }), vin({ codigo: 'V2' })], null, AHORA));
  eq('7b.46d ⭐ B3: con inspección leyéndose, la línea larga dice «🔎 2 leyendo inspección» en vez de «❔ 2 sin dato»',
    [llamar('textoConteoDelSitio', cLeyendo, 'largo', { leyendo: true }), llamar('textoConteoDelSitio', cLeyendo, 'largo')], ['✅ 1 disponible · 🔎 2 leyendo inspección', '✅ 1 disponible · ❔ 2 sin dato']);
  const cSinVer = llamar('conteoDelSitio', llamar('filasDelSitio', [conMarca('averiada'), vin({ codigo: 'V2', estado: 'disponible', estadoAt: T('07:00') })], null, AHORA));
  eq('7b.46e ⭐ B9: el encabezado plegado dice «· 🔎 n sin verificar» cuando nada se comparó con inspección',
    [llamar('textoConteoDelSitio', cSinVer, 'corto'), llamar('textoConteoDelSitio', c, 'corto').includes('sin verificar')], ['✅ 1 · 🔧 1 · 🔎 2 sin verificar', false]);
  // Lote 6 A5/B15: qué se le pregunta a inspección, UNA definición (acá), para la pantalla y el papel.
  eq('7b.46f ⭐ A5/B15: vinculadasParaInspeccion vive en la lib pura: activas vinculadas, sin repetir máquina, con su marca por la REGLA',
    llamar('vinculadasParaInspeccion', [unidad({ codigo: 'P' }), vin({ codigo: 'A', machineryId: 'A' }), conMarca('averiada', { codigo: 'B', machineryId: 'B' }), vin({ codigo: 'A2', machineryId: ' A ' }), vin({ codigo: 'C', machineryId: 'C', activo: false }), vin({ codigo: 'D', machineryId: 'D', estado: 'raro', estadoAt: T('07:00') })]),
    [{ machineryId: 'A', estadoAt: null, conMarca: false }, { machineryId: 'B', estadoAt: T('08:00'), conMarca: true }, { machineryId: 'D', estadoAt: T('07:00'), conMarca: false }]);
  eq('7b.46g * sin vinculadas (o basura) → []', [llamar('vinculadasParaInspeccion', [unidad({ codigo: 'P' })]), llamar('vinculadasParaInspeccion', null)], [[], []]);
  eq('7b.47 conteoMaquinaria (de paso hasta M4/M5): una vinculada sin marca NO es disponible', llamar('conteoMaquinaria', [unidad({ codigo: 'P' }), vin()]),
    { disponibles: 1, averiadas: 0, total: 2 });

  // ── 📲 WhatsApp: lo que DICE EL SITIO ──
  const wa = llamar('textoAvisoInspeccion', filas, AHORA, 'Sitio Sintético');
  eq('7b.48 ⭐ WhatsApp: solo las ⚠️, con «dice el sitio», placa, desde, nota y lo que dice inspección', wa, [
    '🏭 Maquinaria de Sitio Sintético · 20/10/2026, 11:00 a. m.',
    'Lo que DICE EL SITIO y no coincide con inspección:',
    '• V-03 (placa AAA-001): en el sitio 🔧 AVERIADA desde hoy 08:00 a. m. — caucho espichado. Inspección: ✅ Operativa.',
  ].join('\n'));
  ok('7b.48b * sin horas trabajadas ni nombres de inspectores', !/\d+(,\d+)?\s*h\b|horas|trabaj|[Ii]nspector\s/.test(wa));
  const dos = [...filas, { unidad: vin({ codigo: 'V-10', machineryId: 'G', estado: 'disponible', estadoAt: T('08:00', '2026-10-18') }), estado: llamar('estadoDelSitio', vin({ codigo: 'V-10', machineryId: 'G', estado: 'disponible', estadoAt: T('08:00', '2026-10-18') }), { leidaAt: '', porMaquina: { G: dice('averiada') } }, AHORA) }];
  const wa2 = llamar('textoAvisoInspeccion', dos, AHORA);
  ok('7b.49 WhatsApp con varias: una línea por cada ⚠️ y «del sitio» sin nombre', wa2.split('\n').length === 4 && wa2.startsWith('🏭 Maquinaria del sitio · ')
    && wa2.includes('• V-10: en el sitio ✅ DISPONIBLE desde el 18/10 08:00 a. m. Inspección: 🔴 Averiada.'), wa2);
  eq('7b.50 WhatsApp sin ninguna que no coincida → vacío', llamar('textoAvisoInspeccion', filas.filter((f) => !f.estado.noCoincide), AHORA), '');

  // ── Reactivar (D7) ──
  eq('7b.51 ⭐ reactivar una vinculada → la marca a null (vuelve a mandar inspección)', llamar('cambioAlReactivar', conMarca('averiada')), { activo: true, estado: null, estadoNota: null });
  eq('7b.52 ⭐ reactivar una del sitio → conserva su marca', llamar('cambioAlReactivar', unidad({ codigo: 'P', estado: 'averiada' })), { activo: true });
  eq('7b.52b * y se le avisa con su «desde» viejo', llamar('avisoAlReactivar', unidad({ codigo: 'UNI-07', estado: 'averiada', estadoAt: '2026-09-12T19:15:00Z' })),
    'UNI-07 reactivada · su último estado: 🔧 Averiada desde el 12/09/2026, 03:15 p. m. — cámbialo en el Parte diario si ya no es así.');
  eq('7b.52c * la vinculada: que vuelve a seguir a inspección', llamar('avisoAlReactivar', conMarca('averiada', { codigo: 'V-09' })), 'V-09 reactivada: su estado vuelve a ser el de inspección.');

  // ── El modelo de la sección 🚜 del papel (P5) ──
  const papel = llamar('modeloMaquinariaPapel', FLOTA, INSP, AHORA);
  eq('7b.53 ⭐ papel: estado AL EMITIR, tarjetas solo con algo y con subconteo', [papel.estadoAl, papel.tarjetas, papel.total], ['20/10/2026, 11:00 a. m.', [
    { grupo: 'disponible', titulo: 'Disponibles', cantidad: 3, detalle: '1 parada' },
    { grupo: 'averiada', titulo: 'Averiadas', cantidad: 3, detalle: null },
    { grupo: 'oficina', titulo: 'No disponibles (oficina)', cantidad: 1, detalle: '1 en espera' },
    { grupo: 'sin_dato', titulo: 'Sin dato', cantidad: 1, detalle: null },
  ], 8]);
  const fila = (cod) => papel.filas.find((f) => f.codigo === cod);
  eq('7b.54 ⭐ papel: Estado (sitio) + Inspección con «≠»', ['V-03', 'V-02', 'V-04', 'P-09', 'V-07', 'V-08'].map((k) => {
    const f = fila(k); return [k, f.estado, f.detalle, f.inspeccion, f.nota, f.noCoincide];
  }), [
    ['V-03', 'Averiada', 'marcado en el sitio, 20/10 08:00 a. m.', 'Operativa', 'caucho espichado', true],
    ['V-02', 'Averiada', 'según inspección', 'Averiada — falla hidráulica · desde 19/10', null, false],
    ['V-04', 'Disponible', 'según inspección', 'Parada — no hay volqueta', null, false],
    ['P-09', 'Disponible', '', '— solo del sitio', null, false],
    ['V-07', 'Esperando instrucciones', '', 'Esperando instrucciones', null, false],
    ['V-08', 'Sin dato', '', 'Sin dato', null, false],
  ]);
  eq('7b.55 papel: la columna Inspección va solo si hay vinculadas; el aviso si no se leyó alguna', [papel.conInspeccion, papel.avisoLectura,
    llamar('modeloMaquinariaPapel', [unidad({ codigo: 'P' })], null, AHORA).conInspeccion, llamar('modeloMaquinariaPapel', [unidad({ codigo: 'P' })], null, AHORA).avisoLectura],
  [true, 'No se pudo leer el estado de inspección al emitir: se imprime lo marcado en el sitio.', false, null]);
  const papelSup = llamar('modeloMaquinariaPapel', [conMarca('averiada', { estadoNota: 'nota vieja' })], leida(dice('operativa', { novedad: nov('jornada', '10:00') })), AHORA);
  eq('7b.56 ⭐ papel: una marca SUPERADA no se imprime como vigente (ni su nota)', [papelSup.filas[0].estado, papelSup.filas[0].detalle, papelSup.filas[0].nota, papelSup.avisoLectura],
    ['Disponible', 'según inspección', null, null]);
  const papelSinLeer = llamar('modeloMaquinariaPapel', [vin(), conMarca('averiada')], null, AHORA);
  eq('7b.57 papel sin leer: la sin marca «Sin dato», la marcada «sin verificar»', papelSinLeer.filas.map((f) => [f.estado, f.detalle]),
    [['Averiada', 'marcado en el sitio, 20/10 08:00 a. m. · sin verificar'], ['Sin dato', '']]);
  ok('7b.58 ⭐ papel sin horas, sin nombres de inspectores ni «trabajando ahora»',
    !/horas|\btrabaj|[Ii]nspector\s/.test(JSON.stringify(llamar('modeloMaquinariaPapel', FLOTA, { ...INSP, porMaquina: { ...INSP.porMaquina, A: dice('operativa', { enVivo: 'trabajando' }) } }, AHORA))));
}

// ═══════════════════════ 8. CANDADOS ESTÁTICOS ═══════════════════════
const existe = (r) => fs.existsSync(path.join(ROOT, r));
const leer = (r) => (existe(r) ? fs.readFileSync(path.join(ROOT, r), 'utf8') : '');

/** El código sin comentarios (respeta las cadenas). */
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

const DIR = 'src/components/centroOperaciones/';
const MAQ = DIR + 'BloqueMaquinaria.tsx';
const BLO = DIR + 'BloqueBloques.tsx';
const AJU = DIR + 'AjustesTab.tsx';
const FLO = DIR + 'FlotaTab.tsx';
const LIBR = 'src/lib/centroOperacionesMaquinariaBloques.ts';
const DB = '../../lib/centroOperacionesDb';
const PURA = '../../lib/centroOperacionesMaquinariaBloques';

ok('8.0 existen BloqueMaquinaria.tsx y BloqueBloques.tsx', existe(MAQ) && existe(BLO));
const maq = sinComentarios(leer(MAQ));
const blo = sinComentarios(leer(BLO));
const aju = sinComentarios(leer(AJU));
const flo = sinComentarios(leer(FLO));
const lib = sinComentarios(leer(LIBR));

// ── (a) Nadie nuevo habla con Supabase ──
for (const [r, code] of [[MAQ, maq], [BLO, blo], [LIBR, lib]]) {
  const n = path.basename(r);
  ok(`⭐ 8.a ${n} no nombra supabase`, code !== '' && !/\bsupabase\b/i.test(code));
  ok(`8.a ${n} no arma consultas (.from('…'), .rpc(, selectAllRows)`, !/\.from\(\s*['"`]|\.rpc\(|selectAllRows/.test(code));
}
ok('8.a la librería es pura: sin React ni react-native', !/from\s+['"]react(-native)?['"]/.test(lib));
// M3: de la capa de datos y de la librería del sistema, la pura solo toma TIPOS (un import por
// valor de centroOperacionesDb traería Supabase por la puerta de atrás, y el (d) no lo vería).
{
  const crudoLib = leerCrudo(LIBR);
  const importsDe = (m) => [...crudoLib.matchAll(new RegExp(`(^|\\n)\\s*import\\s+(type\\s+)?[^;]*?from\\s+['"]\\./${m}['"]`, 'g'))];
  ok('⭐ 8.a M3: la librería pura importa de centroOperacionesDb y machineLiveStatus SOLO con import type',
    importsDe('centroOperacionesDb').length === 1 && importsDe('machineLiveStatus').length === 1
    && [...importsDe('centroOperacionesDb'), ...importsDe('machineLiveStatus')].every((x) => !!x[2]) && !/require\(|import\(/.test(crudoLib));
}
for (const [r, code] of [[MAQ, maq], [BLO, blo]]) {
  ok(`8.a ${path.basename(r)} pide y guarda por centroOperacionesDb`, importadosDe(code, DB).length > 0, importadosDe(code, DB).join(', '));
}

// ── (b) La marca de una unidad SOLO por guardarMarcaUnidad / guardarNotaMarca (M3: una puerta por intención) ──
{
  const delDb = importadosDe(maq, DB);
  ok('⭐ 8.b BloqueMaquinaria cambia la marca con guardarMarcaUnidad y la nota con guardarNotaMarca',
    delDb.includes('guardarMarcaUnidad') && /guardarMarcaUnidad\(/.test(maq) && delDb.includes('guardarNotaMarca') && /guardarNotaMarca\(/.test(maq), delDb.join(', '));
  ok('8.b * y guardarEstadoUnidad ya no existe (ni en el bloque ni en la capa de datos)', !/guardarEstadoUnidad/.test(maq) && !/guardarEstadoUnidad/.test(leer('src/lib/centroOperacionesDb.ts')));
  ok('⭐ 8.b * y no importa guardarUnidad (que podría tocar más columnas)', !delDb.includes('guardarUnidad'));
  const componentes = fs.readdirSync(path.join(ROOT, DIR)).filter((n) => /\.tsx?$/.test(n));
  const conEstado = componentes.filter((n) => /guardarUnidad\(\s*\{[^}]*\bestado(Nota)?\b/.test(sinComentarios(leer(DIR + n)))
    || /unidadAFila\(\s*\{[^}]*\bestado/.test(sinComentarios(leer(DIR + n))));
  ok('⭐ 8.b ningún componente del módulo manda el estado por guardarUnidad', conEstado.length === 0, conEstado.join(', '));
  ok('8.b el formulario de 🚛 Flota no lleva el estado (se cambia en el Parte diario)', !/\bestado(Nota)?:/.test(flo));
  ok('8.b la pista dice que el estado vive solo en el módulo (no toca Control ni el catálogo)',
    /solo en este módulo/i.test(maq) && /Control/.test(maq) && /catálogo/.test(maq));
  // M4: las líneas de cada fila las arma `lineasDeFila` (./pantallaParteDiario), que dice el «desde» de una
  // unidad del sitio con textoDesde(u.estadoAt); los conteos, `conteoDelSitio` + `textoConteoDelSitio`.
  const pant = sinComentarios(leer(DIR + 'pantallaParteDiario.ts'));
  ok('8.b el «desde» sale de estadoAt con textoDesde (en las líneas de la fila, lineasDeFila)',
    /textoDesde\(\s*\w+\.estadoAt\s*\)/.test(pant) && importadosDe(maq, './pantallaParteDiario').includes('lineasDeFila') && /lineasDeFila\(/.test(maq));
  ok('⭐ 8.b M4 los conteos arriba salen de conteoDelSitio y textoConteoDelSitio (ya no de conteoMaquinaria)',
    ['conteoDelSitio', 'textoConteoDelSitio'].every((n) => importadosDe(maq, PURA).includes(n)) && !/conteoMaquinaria/.test(maq));
  ok('8.b la nota opcional viaja a guardarMarcaUnidad (id, { estado, nota })', /guardarMarcaUnidad\(\s*[\w.]+\s*,\s*\{\s*estado:\s*[\w.]+\s*,\s*nota:\s*[\w.]+\s*\}/.test(maq));
}

// ── (b') Lote 6 A5/B15: UNA sola definición de vinculadasParaInspeccion en todo src/ (la lib pura) ──
{
  const archivosSrc = [];
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) recorrer(rel);
      else if (/\.(ts|tsx)$/.test(e.name)) archivosSrc.push(rel);
    }
  };
  recorrer('src');
  const definen = archivosSrc.filter((r) => /function vinculadasParaInspeccion\(/.test(sinComentarios(leer(r))));
  eq('⭐ 8.b\' A5/B15 vinculadasParaInspeccion se define UNA sola vez, en la lib pura', definen, [LIBR]);
  ok('8.b\' * y la usan el bloque (por la lib pura) y el papel (re-exportada de la lib pura)',
    importadosDe(maq, PURA).includes('vinculadasParaInspeccion') && /export \{ vinculadasParaInspeccion \};/.test(leer('src/lib/centroOperacionesReporteCompleto.ts'))
    && /vinculadasParaInspeccion[^;]*from '\.\/centroOperacionesMaquinariaBloques'/.test(leer('src/lib/centroOperacionesReporteCompleto.ts')));
}

// ── (c) Permisos ──
ok("⭐ 8.c BloqueMaquinaria: cambia solo Full, igual que la RLS de cop_unidades (levelMeets(nivel, 'full'))",
  /levelMeets\(\s*nivel\s*,\s*'full'\s*\)/.test(maq) && !/levelMeets\(\s*nivel\s*,\s*'escritura'\s*\)/.test(maq));
ok("⭐ 8.c BloqueBloques: anotan Escritura y Full (levelMeets(nivel, 'escritura'))", /levelMeets\(\s*nivel\s*,\s*'escritura'\s*\)/.test(blo));
ok("⭐ 8.c BloqueBloques: borrar solo Full y con confirmación",
  /borrarMovimiento\(/.test(blo) && /(levelMeets\(\s*nivel\s*,\s*'full'\s*\)|nivel\s*===\s*'full')/.test(blo) && /useConfirm\(\)/.test(blo));
for (const [r, code] of [[MAQ, maq], [BLO, blo]]) {
  const n = path.basename(r);
  ok(`8.c ${n} tiene la forma del contrato: export function …({ sitio, nivel, fecha, … })`,
    new RegExp(`export function ${n.replace('.tsx', '')}\\(\\{\\s*sitio,\\s*nivel,\\s*fecha\\s*[,}]`).test(code));
  // Lote 5 B12: junto al error de carga, «🔄 Reintentar» (en web deslizar no hace nada).
  ok(`⭐ 8.c B12: ${n} ofrece «🔄 Reintentar» junto al error y dice cómo en el teléfono`,
    /🔄 Reintentar/.test(code) && /toca Reintentar \(o desliza hacia abajo en el teléfono\)/.test(code) && !/desliza hacia abajo o vuelve a entrar/.test(code));
  // Lote 5 B18: dentro del Parte diario no va una tarjeta dentro de otra.
  ok(`⭐ 8.c B18: ${n} no abre con su propia tarjeta (va dentro del bloque del Parte diario)`, !/return \(\n    <Card>/.test(code) && !/<View style=\{\{ gap: spacing\.sm \}\}>\n      <Card>/.test(code));
  ok(`8.c ${n} avisa con useToast y muestra e.message`, /useToast\(\)/.test(code) && /e\??\.message/.test(code));
  ok(`8.c ${n} refresca al enfocarse (useFocusEffect)`, /useFocusEffect\(/.test(code));
  ok(`8.c ${n} descarta respuestas viejas (secuenciaDePedidos)`, /secuenciaDePedidos\(/.test(code));
}

// ── (d) Bloques: cómo se guarda ──
{
  ok("⭐ 8.d producción: tipo 'produccion', unidadIngresada 'u', cantidad y disponibleDesde",
    /tipo:\s*'produccion'/.test(blo) && /unidadIngresada:\s*'u'/.test(blo) && /cantidad[,:]/.test(blo) && /disponibleDesde[,:]/.test(blo));
  ok('⭐ 8.d * disponibleDesde sale de la librería (fecha + días del material)', importadosDe(blo, PURA).includes('disponibleDesde') && /disponibleDesde\(\s*fecha\s*,/.test(blo));
  ok("8.d venta: tipo 'salida' con la cantidad", /tipo:\s*'salida'/.test(blo));
  ok('8.d el material sale de materialDeBloques (lista o «Bloques»)', importadosDe(blo, PURA).includes('materialDeBloques'));
  ok('⭐ 8.d la tarjeta de inventario usa inventarioBloques con la entrada de la librería',
    importadosDe(blo, '../../lib/centroOperacionesMateriales').includes('inventarioBloques') && importadosDe(blo, PURA).includes('entradaInventario'));
  ok('8.d A#6 el inventario lee lo acotado: las piezas anteriores + el día (cargarDatosReporteCompleto)', /cargarDatosReporteCompleto\(sitio\.id, fecha, fecha\)/.test(blo));
  ok('8.d la tarjeta muestra disponibles hoy, en curado, próximas liberaciones y avisos',
    /Disponibles/.test(blo) && /curado/i.test(blo) && /proximos/.test(blo) && /avisos/.test(blo));
  ok('8.d la cantidad escrita se lee con cantidadDeCampo (entero > 0)', /cantidadDeCampo\(/.test(blo));
  ok('8.d vender de más pide confirmación (avisoVenta)', /avisoVenta\(/.test(blo));

  // Lote 5 B5: «Anotar venta» y «Anotar producción» con candado de verdad (useRef) puesto
  // ANTES del primer await, y la historia en curso compartida (no se invalida a sí misma).
  const fnVenta = /const anotarVenta = async \(\) => \{([\s\S]*?)\n  \};/.exec(blo)?.[1] ?? '';
  const fnProd = /const anotarProduccion = async \(\) => \{([\s\S]*?)\n  \};/.exec(blo)?.[1] ?? '';
  ok('⭐ 8.d B5: hay un candado enVuelo (useRef) contra el doble toque', /const enVuelo = useRef\(false\)/.test(blo));
  ok('⭐ 8.d B5: anotarVenta se corta si ya hay uno en vuelo y lo pone ANTES del primer await',
    /if \(!puedeAnotar \|\| enVuelo\.current\) return;/.test(fnVenta) && fnVenta.indexOf('enVuelo.current = true') > -1
      && fnVenta.indexOf('enVuelo.current = true') < fnVenta.indexOf('await '), fnVenta.slice(0, 200));
  ok('⭐ 8.d B5: * y el botón dice «Revisando el inventario…» mientras tanto', /Revisando el inventario…/.test(blo) && /setGuardando\(true\)/.test(fnVenta));
  ok('8.d B5: anotarProduccion también tiene el candado', /if \(!puedeAnotar \|\| enVuelo\.current\) return;/.test(fnProd) && /enVuelo\.current = true/.test(fnProd));
  ok('⭐ 8.d B5: la historia que se está bajando se COMPARTE (otra carga no la invalida: sin aviso falso de «Inventario sin calcular»)',
    /historiaEnCurso/.test(blo) && /historiaEnCurso\.current\?\.clave === clave/.test(blo));
  ok('8.d B10: avisa los bloques escritos sin guardar al Parte diario (alSinGuardar)', /alSinGuardar/.test(blo));
}
// Lote 5 B10: la maquinaria le dice al Parte diario sus conteos (el encabezado plegado los muestra).
ok('⭐ 8.d B10: BloqueMaquinaria avisa sus conteos (alConteo con conteoDelSitio)', /alConteo/.test(maq) && /alConteo\?\.\(sinDatos \? null : conteo\)/.test(maq) && /const conteo = useMemo\(\(\) => conteoDelSitio\(filas\)/.test(maq));

// ── (g) M4 · el bloque 🚜 con inspección (mesa de maquinaria §4.1, §7) ──
{
  const crudoMaq = leer(MAQ);
  const delDb = importadosDe(maq, DB);
  const delaPura = importadosDe(maq, PURA);
  const dePantalla = importadosDe(maq, './pantallaParteDiario');
  // §7: la pastilla, el editor y los conteos salen de la regla, NUNCA de la marca guardada a mano.
  ok('⭐ 8.g §7 BloqueMaquinaria usa la regla (filasDelSitio → estadoDelSitio) y modoAlTocar',
    delaPura.includes('filasDelSitio') && /filasDelSitio\(unidades, insp, reloj\)/.test(maq) && delaPura.includes('modoAlTocar') && /modoAlTocar\(/.test(maq));
  ok('⭐ 8.g §7 * y NO compara contra u.estado (adiós a «estado === u.estado» del bloque viejo)',
    !/\b(u|unidad|x)\.estado\b(?!At|Nota)/.test(maq) && !/===\s*u\.estado|u\.estado\s*===/.test(maq));
  ok('⭐ 8.g * la pastilla encendida es la marca que MANDA (estado.encendida) o la elegida en el editor',
    /const on = \(abierta \? abierta\.estado : e\.encendida\) === s;/.test(maq));
  ok('8.g * ya no queda el TODO-M4 ni conteoMaquinaria en el bloque', !/TODO-M4/.test(crudoMaq) && !/conteoMaquinaria/.test(crudoMaq));
  // Carga en dos tiempos: la flota, y después SOLO las vinculadas a inspección.
  ok('⭐ 8.g carga en DOS tiempos: cargarUnidades y después cargarEstadoInspeccion de vinculadasParaInspeccion',
    delDb.includes('cargarUnidades') && delDb.includes('cargarEstadoInspeccion') && delaPura.includes('vinculadasParaInspeccion') && !dePantalla.includes('vinculadasParaInspeccion')
    && /await leerInspeccion\(us\)/.test(maq) && /cargarEstadoInspeccion\(vinculadas\)/.test(maq));
  // Lote 6 R1/B10: la lectura va con tope (conTope, 15 s) y una lectura buena fresca (<10 s) se reutiliza salvo pedido explícito.
  ok('⭐ 8.g R1: la lectura de inspección del bloque lleva tope (conTope + TOPE_LECTURA_BLOQUE_MS) y al vencer cae al catch (error con 🔄 Reintentar)',
    /await conTope\(cargarEstadoInspeccion\(vinculadas\), TOPE_LECTURA_BLOQUE_MS, 'No se pudo leer el estado de inspección: no respondió a tiempo\.'\)/.test(maq)
    && importadosDe(maq, '../../lib/centroOperaciones').includes('conTope') && dePantalla.includes('TOPE_LECTURA_BLOQUE_MS'));
  ok('⭐ 8.g B10: una lectura buena fresca de las mismas vinculadas (o una en vuelo) se reutiliza, salvo `forzar`; ↻ / Reintentar / guardar / soltar fuerzan',
    /if \(!forzar && clave === claveBuena\.current && \(Date\.now\(\) < frescaHasta\.current \|\| inspEnVuelo\.current !== null\)\) return;/.test(maq)
    && /const releerInspeccion = \(\) => \{ leerInspeccion\(unidades, true\); \};/.test(maq) && dePantalla.includes('FRESCURA_LECTURA_MS'));
  ok('⭐ 8.g * sin vinculadas NO consulta (vuelve antes de llamar)',
    /if \(vinculadas\.length === 0\) \{[\s\S]*?return;\s*\}[\s\S]*cargarEstadoInspeccion\(vinculadas\)/.test(maq));
  ok('⭐ 8.g * si la lectura falla, se borra lo leído (❔ Sin dato / sin verificar, nunca un estado supuesto) y hay «🔄 Reintentar»',
    /catch \(e: any\) \{[\s\S]{0,300}setInsp\(null\);[\s\S]{0,200}setLectura\('error'\)/.test(maq) && /onPress=\{releerInspeccion\}/.test(maq));
  ok('8.g * una respuesta vieja de inspección no pisa a la nueva (su propia secuenciaDePedidos)', /pedidosInsp\.vigente\(n\)/.test(maq));
  ok('8.g * sin Realtime (lee al enfocar, al deslizar y con ↻)', !/channel\(|subscribe\(|realtime/i.test(maq));
  // La marca: nota o marca nueva por modoAlTocar, con la guardia en las vinculadas.
  const fnGuardar = /const guardar = async \(\) => \{([\s\S]*?)\n  \};/.exec(maq)?.[1] ?? '';
  ok('⭐ 8.g guardar decide nota o marca con modoAlTocar (la regla de AHORA), no con la marca guardada',
    /modoAlTocar\(f\.estado, ed\.estado, !!ed\.soloNota\)/.test(fnGuardar) && /if \(modo === 'nota'\) await guardarNotaMarca\(/.test(fnGuardar), fnGuardar.slice(0, 200));
  ok('⭐ 8.g B1 * con «📝 nota» abierto, guardar NUNCA pone una marca nueva (si la marca dejó de mandar, se niega)',
    /const modo = ed\.soloNota \? \(modoAlTocar\(f\.estado, ed\.estado, true\) === 'nota' \? 'nota' : null\) : modoAlTocar\(/.test(fnGuardar));
  // Lote 6 B1: la guardia sale de lo último que ella VIO (referenciaDeGuardia), nunca de `insp` a secas; A6: no se marca mientras se lee.
  ok('⭐ 8.g * la marca nueva va con la guardia { machineryId, leidaAt, motivo } desde referenciaDeGuardia (lectura vigente, última buena, visto hasta o marca anterior), no de insp a secas (B1)',
    /referenciaDeGuardia\(f\.unidad, insp, ultimaLeidaBuena\.current, ed\.vistoHasta\)/.test(fnGuardar) && /\{ machineryId, leidaAt: referencia\.leidaAt, motivo: referencia\.motivo \}/.test(fnGuardar)
    && !/leidaAt: insp\.leidaAt/.test(fnGuardar) && dePantalla.includes('referenciaDeGuardia')
    && /guardarMarcaUnidad\(ed\.id, \{ estado: ed\.estado, nota: ed\.nota \}, guardia\)/.test(fnGuardar));
  ok('⭐ 8.g B1 * la última lectura buena se guarda en un ref que una relectura fallida NO borra (solo cambiar de sitio)',
    /ultimaLeidaBuena\.current = r\.leidaAt;/.test(maq) && !/catch \(e: any\) \{[\s\S]{0,400}ultimaLeidaBuena\.current = null/.test(maq) && /\[sitio\.id\]\)/.test(maq)
    && /ultimaLeidaBuena\.current = null; frescaHasta\.current = 0;/.test(maq));
  ok('⭐ 8.g A6 * guardar se niega mientras inspección se lee por primera vez (una vinculada)', /if \(modo === 'marca' && f\.estado\.vinculada && leyendo\) \{[\s\S]{0,160}return;/.test(fnGuardar));
  ok('⭐ 8.g * si inspección registró algo nuevo (esCambioDeInspeccion), relee, el editor queda con la nota y el hecho queda como «visto hasta» (su hora, B1)',
    delDb.includes('esCambioDeInspeccion') && /if \(esCambioDeInspeccion\(e\)\) \{[\s\S]*?const vistoHasta = new Date\(e\.novedad\.ms\)\.toISOString\(\);[\s\S]*?\{ \.\.\.p, vistoHasta \}[\s\S]*?releerInspeccion\(\);/.test(fnGuardar)
    && !/catch \(e: any\) \{[^}]*setEdicion\(null\)/.test(fnGuardar));
  ok('8.g B11 * el toast de éxito sale de textoExitoMarca (manda a 📲 si no coincide)', /textoExitoMarca\(f, ed\.estado\)/.test(fnGuardar) && dePantalla.includes('textoExitoMarca'));
  ok('⭐ 8.g «↩️ Que mande inspección» / «🧹 Quitarla» con soltarMarcaUnidad, solo si puedeSoltar, con el diálogo de dialogoSoltar y confirmación (B5, B8)',
    delDb.includes('soltarMarcaUnidad') && /soltarMarcaUnidad\(f\.unidad\.id\)/.test(maq) && /e\.puedeSoltar/.test(maq) && dePantalla.includes('dialogoSoltar')
    && /const d = dialogoSoltar\(f, reloj\);/.test(maq) && /confirm\(\{ title: d\.titulo, message: d\.mensaje, confirmText: d\.confirmar \}\)/.test(maq) && /\{soltarDlg\.enlace\}/.test(maq) && /useConfirm\(\)/.test(maq));
  ok('8.g B1 * «📝 nota» abre el editor en modo soloNota (también en «sin verificar»)', /modoAlTocar\(e, e\.encendida, true\) === 'nota'/.test(maq) && /abrir\(f, e\.encendida as EstadoUnidad, true\)/.test(maq));
  ok('8.g B6 * el filtro ⚠️ se apaga solo cuando ya no queda ninguna', /useEffect\(\(\) => \{ if \(cuantasNoCoinciden === 0\) setSoloNoCoinciden\(false\); \}, \[cuantasNoCoinciden\]\);/.test(maq));
  ok('8.g B7 * la fila abierta se pinta en el grupo en que se abrió (grupoDeFila)', /visibles\.filter\(\(f\) => grupoDeFila\(f\) === g\)/.test(maq) && /grupo: f\.estado\.grupo/.test(maq));
  ok('8.g B3 * mientras se lee por primera vez, el grupo ❔ se titula «🔎 Leyendo inspección» y la línea de conteo lo dice',
    /leyendo && g === 'sin_dato' \? '🔎 Leyendo inspección'/.test(maq) && /textoConteoDelSitio\(conteo, 'largo', \{ leyendo \}\)/.test(maq) && /const leyendo = lectura === 'cargando' && !insp;/.test(maq));
  ok('8.g B4 * «lo maneja la oficina» no se repite: la línea de salida va sin porQueNo', /\{l\.porQueNo \? <Text[^>]*>Si sigue trabajando en el sitio/.test(maq) && !/\{l\.porQueNo\} Si sigue trabajando/.test(maq));
  ok('8.g B11 * la pista dice que tampoco llega a las horas ni al pago', /ni a las horas ni al pago de los operadores/.test(maq));
  ok('⭐ 8.g «📲 Avisar a inspección» abre WhatsApp con textoAvisoInspeccion (por fila y en lote) y no escribe nada',
    delaPura.includes('textoAvisoInspeccion') && /Linking\.openURL\('https:\/\/wa\.me\/\?text=' \+ encodeURIComponent\(texto\)\)/.test(maq)
    && /avisar\(\[f\]\)/.test(maq) && /avisar\(noCoinciden\)/.test(maq));
  ok('8.g * el filtro «⚠️ n no coinciden» (Ver todas)', /setSoloNoCoinciden/.test(maq) && /no coinciden/.test(maq));
  // Permisos: solo Full marca y suelta; avisar, todos.
  const fnAvisar = /const avisar = async \([^)]*\) => \{([\s\S]*?)\n  \};/.exec(maq)?.[1] ?? '';
  ok("⭐ 8.g permisos: marcar y soltar piden puedeCambiar (Full); 📲 no (Lectura y Escritura también avisan)",
    /if \(!puedeCambiar \|\| enVuelo\.current\) return;/.test(maq) && /if \(!puedeCambiar \|\| enVuelo\.current \|\| !f\.estado\.puedeSoltar/.test(maq)
    && fnAvisar !== '' && !/puedeCambiar/.test(fnAvisar));
  ok('8.g * las pastillas se apagan en espera / retirada / transferida (puedeMarcar) y, en las vinculadas, mientras inspección se lee por primera vez (A6)',
    /const apagada = !puedeCambiar \|\| !e\.puedeMarcar \|\| \(e\.vinculada && leyendo\);/.test(maq));
  // M8: le pasa al Parte diario el grupo efectivo de cada unidad.
  ok('⭐ 8.g M8 avisa el grupo EFECTIVO de cada unidad al Parte diario (alEstados con gruposParaSalidas)',
    dePantalla.includes('gruposParaSalidas') && /alEstados\?\.\(sinUnidades \? null : grupos\)/.test(maq));
}

// ── (e) ⚙️ Ajustes ──
{
  const delDb = importadosDe(aju, DB);
  ok('⭐ 8.e Ajustes guarda el GPS del sitio (guardarSitio({ id, lat, lng }))', /guardarSitio\(\s*\{[^}]*\blat\b[^}]*\blng\b/.test(aju));
  ok('⭐ 8.e Ajustes ofrece «Sugerir km en línea recta»', aju.includes('Sugerir km en línea recta'));
  ok('⭐ 8.e * con la advertencia «en línea recta, por carretera es más»', /en línea recta, por carretera es más/.test(aju));
  ok('8.e * calculada con la librería (kmSugerido / textoSugerenciaKm)', ['kmSugerido', 'textoSugerenciaKm'].every((f) => importadosDe(aju, PURA).includes(f)));
  ok('⭐ 8.e los destinos guardan lat, lng y km (guardarItemLista)', /guardarItemLista\(\s*\{[^}]*\blat\b[^}]*\blng\b[^}]*\bkm\b/.test(aju));
  ok('⭐ 8.e los materiales guardan factorTM3 y diasDisponible (guardarItemLista)', /guardarItemLista\(\s*\{[^}]*\bfactorTM3\b[^}]*\bdiasDisponible\b/.test(aju));
  ok('8.e se ven «Factor t/m³» y «días hasta estar disponible»', /t\/m³/.test(aju) && /días hasta estar disponible/i.test(aju));
  ok('8.e las coordenadas se leen con coordenadaDeCampo', /coordenadaDeCampo\(/.test(aju));
  ok('⭐ 8.e la clase terraza se muestra «Patio»', /Patios?/.test(aju) && !/Terrazas/.test(aju));
  ok("8.e * pero se sigue guardando como 'terraza'", aju.includes("'terraza'"));
  ok('8.e Ajustes sigue sin hablar con supabase', !/\bsupabase\b/i.test(aju) && delDb.length > 0);
}

// ── (f) 🚛 Flota: el chofer ──
ok('⭐ 8.f Flota tiene el campo «Chofer»', /label="CHOFER"|label=\{?['"]Chofer/i.test(flo));
ok('⭐ 8.f * y lo guarda (chofer: en los datos de guardarUnidad)', /\bchofer:\s*form\.chofer/.test(flo));
ok('8.f * y lo muestra en la lista', /u\.chofer/.test(flo));

console.log(`${fail === 0 ? '✅' : '❌'} test-centro-operaciones-maquinaria-bloques · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Maquinaria, bloques y ajustes: el estado solo en el módulo, el inventario con cifras exactas y los km en línea recta dichos como tales.');
