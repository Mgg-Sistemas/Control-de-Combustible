// 🏭 CENTRO DE OPERACIONES — PRUEBAS DE MATERIALES (24-oct-2026).
//
// La librería pura src/lib/centroOperacionesMateriales.ts:
//   (1) convertir una cantidad escrita en m³, t o kg a las otras dos con el
//       factor del material (agregados: 1,2 t por m³; acero/aluminio: sin factor);
//   (2) el texto «12,00 m³ · 14,40 t · 14.400 kg»;
//   (3) sumar días a una fecha sin tropezar con meses, años ni bisiestos;
//   (4) el inventario de bloques: lo producido el día D se vende desde D + 7;
//   (5) los km en línea recta entre el sitio y un destino (haversine).
//
// ⭐ Todos los datos son SINTÉTICOS (el repositorio es público).
//
//   node scripts/test-centro-operaciones-materiales.mjs
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

const LIB = path.join(ROOT, 'src/lib/centroOperacionesMateriales.ts');
let L = {};
let pass = 0, fail = 0;
const failures = [];
try { L = loadTs(LIB); } catch (e) { fail++; failures.push(`no se pudo cargar la librería: ${e.message}`); }

// `got` y `cond` pueden ir envueltos en una función: si revientan (p. ej. porque
// la función de la librería aún no existe) cuentan como fallo, no tumban la prueba.
const eq = (name, got, want) => {
  let v;
  try { v = typeof got === 'function' ? got() : got; } catch (e) { v = `reventó: ${e.message}`; }
  const g = JSON.stringify(v), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, () => !!(typeof cond === 'function' ? cond() : cond), true);
// Llama sin reventar la prueba si la función aún no existe o lanza: lanzar es fallo.
const llamar = (fn, ...args) => {
  if (typeof L[fn] !== 'function') return `«${fn}» no existe`;
  try { return L[fn](...args); } catch (e) { return `«${fn}» lanzó: ${e.message}`; }
};
const C = (m3, t, kg) => ({ m3, t, kg });

// ——— 1. Conversión de cantidades ———
{
  eq('1.1 el factor de los agregados es 1,2 t por m³', L.FACTOR_AGREGADOS, 1.2);
  const F = 1.2;
  eq('1.2 10 m³ → 12 t → 12.000 kg', llamar('convertirCantidad', 10, 'm3', F), C(10, 12, 12000));
  eq('1.3 6 t → 5 m³ (t ÷ 1,2) y 6.000 kg', llamar('convertirCantidad', 6, 't', F), C(5, 6, 6000));
  eq('1.4 14.400 kg → 14,4 t → 12 m³', llamar('convertirCantidad', 14400, 'kg', F), C(12, 14.4, 14400));
  eq('1.5 7 m³ → 8,4 t (sin el 8,3999… del flotante) → 8.400 kg', llamar('convertirCantidad', 7, 'm3', F), C(7, 8.4, 8400));
  eq('1.6 1 t → 0,83 m³ (2 decimales)', llamar('convertirCantidad', 1, 't', F), C(0.83, 1, 1000));
  eq('1.7 1,005 t redondea a 1,01 (mitad hacia arriba, sin el error del flotante)', llamar('convertirCantidad', 1.005, 't', F), C(0.84, 1.01, 1005));
  eq('1.8 12,345 m³ → 12,35 m³ · 14,81 t · 14.814 kg (se redondea al final, no por paso)', llamar('convertirCantidad', 12.345, 'm3', F), C(12.35, 14.81, 14814));
  // Lote 5 A3: lo escrito en kg no pierde kilos → las t van con 3 decimales (1 kg = 0,001 t).
  eq('1.9 los kg salen enteros: 1.234,6 kg → 1.235 kg y 1,235 t (en kg, las t llevan 3 decimales)', llamar('convertirCantidad', 1234.6, 'kg', null), C(null, 1.235, 1235));
  eq('⭐ 1.9b A3: 1.234 kg de aluminio → 1,234 t (no 1,23: no se pierden 4 kg)', llamar('convertirCantidad', 1234, 'kg', null), C(null, 1.234, 1234));
  eq('1.9c A3: en kg con factor, los m³ siguen con 2 decimales (1.234 kg → 1,03 m³ · 1,234 t)', llamar('convertirCantidad', 1234, 'kg', 1.2), C(1.03, 1.234, 1234));
  eq('1.9d A3: escrito en t sigue con 2 decimales (1,2345 t → 1,23 t)', llamar('convertirCantidad', 1.2345, 't', null), C(null, 1.23, 1235));
  eq('1.10 cero es un dato: 0 t → 0 / 0 / 0', llamar('convertirCantidad', 0, 't', F), C(0, 0, 0));

  // Acero / aluminio: no hay factor fijo → solo t ↔ kg; el m³ queda como se escribió o vacío.
  eq('1.11 sin factor: 2,5 t → 2.500 kg y m³ vacío', llamar('convertirCantidad', 2.5, 't', null), C(null, 2.5, 2500));
  eq('1.12 sin factor: 3.500 kg → 3,5 t y m³ vacío', llamar('convertirCantidad', 3500, 'kg', null), C(null, 3.5, 3500));
  eq('1.13 ⭐ sin factor: el acero sale con 18 m³ y las toneladas quedan pendientes', llamar('convertirCantidad', 18, 'm3', null), C(18, null, null));
  eq('1.14 factor 0 se trata como «sin factor»', llamar('convertirCantidad', 10, 'm3', 0), C(10, null, null));
  eq('1.15 factor negativo se trata como «sin factor»', llamar('convertirCantidad', 6, 't', -1.2), C(null, 6, 6000));
  eq('1.16 factor NaN se trata como «sin factor»', llamar('convertirCantidad', 6, 't', NaN), C(null, 6, 6000));
  eq('1.17 otro factor por material: 10 m³ con 1,5 → 15 t', llamar('convertirCantidad', 10, 'm3', 1.5), C(10, 15, 15000));

  // Lo que no se entiende: todo vacío, nunca NaN.
  const vacio = C(null, null, null);
  eq('1.18 null → todo vacío', llamar('convertirCantidad', null, 'm3', F), vacio);
  eq('1.19 negativo → todo vacío', llamar('convertirCantidad', -3, 't', F), vacio);
  eq('1.20 NaN → todo vacío', llamar('convertirCantidad', NaN, 'kg', F), vacio);
  eq('1.21 Infinity → todo vacío', llamar('convertirCantidad', Infinity, 'm3', F), vacio);
  eq('1.22 un texto colado («10») → todo vacío (la pantalla lee con leerNumero antes)', llamar('convertirCantidad', '10', 'm3', F), vacio);
  eq('1.23 una unidad desconocida («lb») → todo vacío', llamar('convertirCantidad', 10, 'lb', F), vacio);
}

// ——— 2. El texto de las cantidades ———
{
  eq('2.1 «12,00 m³ · 14,40 t · 14.400 kg»', llamar('textoCantidades', C(12, 14.4, 14400)), '12,00 m³ · 14,40 t · 14.400 kg');
  eq('2.2 omite lo vacío: «2,50 t · 2.500 kg»', llamar('textoCantidades', C(null, 2.5, 2500)), '2,50 t · 2.500 kg');
  eq('2.3 solo m³: «18,00 m³»', llamar('textoCantidades', C(18, null, null)), '18,00 m³');
  eq('2.4 miles con punto y decimales con coma: «1.234,50 m³»', llamar('textoCantidades', C(1234.5, null, null)), '1.234,50 m³');
  eq('2.5 todo vacío → texto vacío', llamar('textoCantidades', C(null, null, null)), '');
  eq('2.6 un NaN colado se omite, no se imprime', llamar('textoCantidades', C(NaN, 3, 3000)), '3,00 t · 3.000 kg');
  eq('2.7 sin objeto → texto vacío, sin reventar', llamar('textoCantidades', null), '');
  eq('2.8 convertir y escribir en cadena: 10 m³', llamar('textoCantidades', llamar('convertirCantidad', 10, 'm3', 1.2)), '10,00 m³ · 12,00 t · 12.000 kg');
}

// ——— 3. Sumar días a una fecha ———
{
  eq('3.1 2026-10-24 + 7 → 2026-10-31', llamar('sumarDias', '2026-10-24', 7), '2026-10-31');
  eq('3.2 cambio de mes: 2026-10-25 + 7 → 2026-11-01', llamar('sumarDias', '2026-10-25', 7), '2026-11-01');
  eq('3.3 cambio de año: 2026-12-28 + 7 → 2027-01-04', llamar('sumarDias', '2026-12-28', 7), '2027-01-04');
  eq('3.4 bisiesto: 2028-02-25 + 7 → 2028-03-03 (febrero de 29)', llamar('sumarDias', '2028-02-25', 7), '2028-03-03');
  eq('3.5 no bisiesto: 2027-02-25 + 7 → 2027-03-04', llamar('sumarDias', '2027-02-25', 7), '2027-03-04');
  eq('3.6 2028-02-28 + 1 → 2028-02-29', llamar('sumarDias', '2028-02-28', 1), '2028-02-29');
  eq('3.7 2100 no es bisiesto: 2100-02-28 + 1 → 2100-03-01', llamar('sumarDias', '2100-02-28', 1), '2100-03-01');
  eq('3.8 2000 sí es bisiesto: 2000-02-28 + 1 → 2000-02-29', llamar('sumarDias', '2000-02-28', 1), '2000-02-29');
  eq('3.9 hacia atrás: 2026-03-01 − 1 → 2026-02-28', llamar('sumarDias', '2026-03-01', -1), '2026-02-28');
  eq('3.10 cero días → la misma fecha', llamar('sumarDias', '2026-10-24', 0), '2026-10-24');
  eq('3.11 año de dos cifras no se vuelve 19xx: 0026-01-01 + 1 → 0026-01-02', llamar('sumarDias', '0026-01-01', 1), '0026-01-02');
  eq('3.12 espacios alrededor se toleran', llamar('sumarDias', ' 2026-10-24 ', 1), '2026-10-25');
  eq('3.13 fecha imposible (30 de febrero) → vacío', llamar('sumarDias', '2026-02-30', 1), '');
  eq('3.14 texto que no es fecha → vacío', llamar('sumarDias', 'hoy', 1), '');
  eq('3.15 formato dd/mm/aaaa → vacío (solo AAAA-MM-DD)', llamar('sumarDias', '24/10/2026', 1), '');
  eq('3.16 días NaN → vacío', llamar('sumarDias', '2026-10-24', NaN), '');
  eq('3.17 días con decimales → vacío', llamar('sumarDias', '2026-10-24', 1.5), '');
  eq('3.18 sin fecha → vacío, sin reventar', llamar('sumarDias', null, 1), '');
}

// ——— 4. Inventario de bloques ———
const INV = (producido, vendido, disponible, enCurado, proximos, avisos) => ({ producido, vendido, disponible, enCurado, proximos, avisos });
const P = (fecha, cantidad) => ({ fecha, cantidad });
{
  // Producción cruzando el fin de mes (curado de 7 días):
  //   20-oct 500 → libres el 27-oct · 27-oct 300 → 03-nov · 30-oct 200 → 06-nov
  // Salidas: 28-oct 150 · 02-nov 100
  const prods = [P('2026-10-27', 300), P('2026-10-20', 500), P('2026-10-30', 200)]; // desordenadas a propósito
  const sals = [P('2026-11-02', 100), P('2026-10-28', 150)];

  eq('4.1 el 26-oct: los 500 del 20-oct aún curan; lo futuro no cuenta',
    llamar('inventarioBloques', prods, sals, '2026-10-26'),
    INV(500, 0, 0, 500, [P('2026-10-27', 500)], []));
  eq('4.2 ⭐ el día D + 7 es inclusivo: el 27-oct ya se venden los 500',
    llamar('inventarioBloques', prods, sals, '2026-10-27'),
    INV(800, 0, 500, 300, [P('2026-11-03', 300)], []));
  eq('4.3 el 02-nov (cruzando el mes): 500 libres − 250 vendidos = 250; curan 500',
    llamar('inventarioBloques', prods, sals, '2026-11-02'),
    INV(1000, 250, 250, 500, [P('2026-11-03', 300), P('2026-11-06', 200)], []));
  eq('4.4 el 03-nov se liberan los 300 del 27-oct',
    llamar('inventarioBloques', prods, sals, '2026-11-03'),
    INV(1000, 250, 550, 200, [P('2026-11-06', 200)], []));
  eq('4.5 el 10-nov todo curó: 1.000 − 250 = 750 y nada pendiente',
    llamar('inventarioBloques', prods, sals, '2026-11-10'),
    INV(1000, 250, 750, 0, [], []));
  const r = llamar('inventarioBloques', prods, sals, '2026-11-02');
  ok('4.6 producido = disponible + en curado + vendido', () => r.producido === r.disponible + r.enCurado + r.vendido);
  eq('4.7 el curado por defecto es de 7 días (pasar 7 da lo mismo)',
    llamar('inventarioBloques', prods, sals, '2026-11-02', 7), r);

  // Bisiesto: lo del 23-feb-2028 se libera el 01-mar (pasa por el 29-feb).
  const bis = [P('2028-02-23', 100), P('2028-02-24', 40)];
  eq('4.8 bisiesto: el 29-feb-2028 todavía curan; se liberan el 01-mar y el 02-mar',
    llamar('inventarioBloques', bis, [], '2028-02-29'),
    INV(140, 0, 0, 140, [P('2028-03-01', 100), P('2028-03-02', 40)], []));
  eq('4.9 bisiesto: el 01-mar-2028 ya se venden los 100 del 23-feb',
    llamar('inventarioBloques', bis, [], '2028-03-01'),
    INV(140, 0, 100, 40, [P('2028-03-02', 40)], []));

  eq('4.10 dos producciones el mismo día se juntan en «próximos»',
    llamar('inventarioBloques', [P('2026-10-01', 100), P('2026-10-01', 50)], [], '2026-10-03'),
    INV(150, 0, 0, 150, [P('2026-10-08', 150)], []));
  eq('4.11 días de curado propios: con 3, lo del 01-oct se vende el 04-oct',
    llamar('inventarioBloques', [P('2026-10-01', 80)], [], '2026-10-04', 3),
    INV(80, 0, 80, 0, [], []));
  eq('4.12 con 0 días de curado se vende el mismo día',
    llamar('inventarioBloques', [P('2026-10-01', 80)], [P('2026-10-01', 30)], '2026-10-01', 0),
    INV(80, 30, 50, 0, [], []));

  // Lote 5 A6: cada lote puede traer SU fecha de liberación (la `disponible_desde` que se
  // congeló al anotarlo). Si los días del material cambian después, lo viejo no «vuelve a curar».
  const PL = (fecha, cantidad, libera) => ({ fecha, cantidad, libera });
  eq('⭐ 4.13 A6: un lote con su liberación guardada (3 días) se vende desde esa fecha aunque ahora sean 7',
    llamar('inventarioBloques', [PL('2026-10-01', 80, '2026-10-04')], [], '2026-10-04', 7),
    INV(80, 0, 80, 0, [], []));
  eq('4.14 * y uno guardado con MÁS días (10) sigue curando aunque ahora sean 7',
    llamar('inventarioBloques', [PL('2026-10-01', 80, '2026-10-11')], [], '2026-10-08', 7),
    INV(80, 0, 0, 80, [P('2026-10-11', 80)], []));
  eq('4.15 * una venta de lo ya liberado por su fecha guardada no avisa',
    llamar('inventarioBloques', [PL('2026-10-01', 80, '2026-10-04')], [P('2026-10-05', 30)], '2026-10-05', 7),
    INV(80, 30, 50, 0, [], []));
  eq('4.16 * una liberación ilegible o anterior a la producción no vale: fecha + días',
    [llamar('inventarioBloques', [PL('2026-10-01', 80, 'basura')], [], '2026-10-07', 7).disponible,
      llamar('inventarioBloques', [PL('2026-10-01', 80, '2026-09-20')], [], '2026-10-07', 7).disponible,
      llamar('inventarioBloques', [PL('2026-10-01', 80, null)], [], '2026-10-08', 7).disponible],
    [0, 0, 80]);
}

// ——— 5. Inventario: salidas que no cuadran ———
{
  // Venta ANTES de que termine el curado: aviso con la fecha y lo que faltó.
  const prods = [P('2026-10-01', 100)]; // libres el 08-oct
  const r5 = llamar('inventarioBloques', prods, [P('2026-10-05', 30)], '2026-10-05');
  eq('5.1 vendido antes del curado: disponible no baja de 0', r5.disponible, 0);
  ok('5.2 ⭐ aviso con la fecha y lo que faltó', () => Array.isArray(r5.avisos) && r5.avisos.length === 1 && r5.avisos[0].includes('05/10/2026') && r5.avisos[0].includes('faltaron 30'));
  eq('5.3 los 30 salieron del lote en curado: quedan 70 por liberar el 08-oct', [r5.enCurado, r5.proximos], [70, [P('2026-10-08', 70)]]);
  ok('5.4 producido = disponible + en curado + vendido aun con el aviso', () => r5.producido === r5.disponible + r5.enCurado + r5.vendido);

  const r6 = llamar('inventarioBloques', prods, [P('2026-10-05', 30)], '2026-10-10');
  eq('5.5 ya curado: 100 − 30 = 70 disponibles', [r6.disponible, r6.enCurado, r6.proximos], [70, 0, []]);
  ok('5.6 el aviso del 05-oct sigue a la vista (pasó en el período)', () => r6.avisos.length === 1 && r6.avisos[0].includes('05/10/2026'));

  // Dos días seguidos en falta: cada día dice cuánto faltaba ESE día.
  const r7 = llamar('inventarioBloques', prods, [P('2026-10-05', 20), P('2026-10-05', 10), P('2026-10-06', 10)], '2026-10-06');
  ok('5.7 un aviso por día de venta en falta (las del mismo día se suman)', () => r7.avisos.length === 2);
  ok('5.8 05-oct faltaron 30 · 06-oct faltaron 40, en orden de fecha', () =>
    r7.avisos[0].includes('05/10/2026') && r7.avisos[0].includes('faltaron 30') && r7.avisos[1].includes('06/10/2026') && r7.avisos[1].includes('faltaron 40'));

  // Se vendió más de lo que jamás se produjo.
  const r8 = llamar('inventarioBloques', [P('2026-10-01', 50)], [P('2026-10-20', 80)], '2026-10-20');
  eq('5.9 más vendido que producido: todo en 0, nada curando', [r8.producido, r8.vendido, r8.disponible, r8.enCurado, r8.proximos], [50, 80, 0, 0, []]);
  ok('5.10 avisa el día en falta y que se vendió más de lo producido', () =>
    r8.avisos.some((a) => a.includes('20/10/2026') && a.includes('faltaron 30')) && r8.avisos.some((a) => /más de lo producido/.test(a) && a.includes('30')));

  // Lo que no se entiende se ignora con aviso; nunca NaN, nunca lanza.
  const r9 = llamar('inventarioBloques',
    [P('2026-02-30', 10), P('2026-10-01', NaN), P('2026-10-01', -5), P('2026-10-01', 2.5), null, P('2026-10-01', '100'), P('2026-10-01', 100)],
    [P('ayer', 5)],
    '2026-10-10');
  eq('5.11 renglones inválidos ignorados: solo cuentan los 100 buenos', [r9.producido, r9.vendido, r9.disponible, r9.enCurado], [100, 0, 100, 0]);
  eq('5.12 un aviso por renglón ignorado (6 producciones + 1 salida)', () => r9.avisos.length, 7);
  ok('5.13 el aviso dice cuál renglón y qué tenía', () => r9.avisos[0].includes('Producción n.º 1') && r9.avisos[0].includes('2026-02-30') && r9.avisos[6].includes('Salida n.º 1') && r9.avisos[6].includes('ayer'));
  ok('5.14 ninguna cifra es NaN', () => [r9.producido, r9.vendido, r9.disponible, r9.enCurado].every((n) => typeof n === 'number' && isFinite(n)));

  const r10 = llamar('inventarioBloques', [P('2026-10-01', 100)], [], '2026-13-01');
  eq('5.15 fecha de consulta inválida: todo en cero con un aviso', () => [r10.producido, r10.disponible, r10.enCurado, r10.proximos, r10.avisos.length], [0, 0, 0, [], 1]);
  const r11 = llamar('inventarioBloques', null, undefined, '2026-10-10');
  eq('5.16 listas ausentes = vacías, sin reventar', r11, INV(0, 0, 0, 0, [], []));
  const r12 = llamar('inventarioBloques', [P('2026-10-01', 100)], [], '2026-10-08', -1);
  ok('5.17 días de curado inválidos → se usan 7 y se avisa', () => r12.disponible === 100 && r12.avisos.length === 1 && r12.avisos[0].includes('7'));
  const r13 = llamar('inventarioBloques', [P('2026-10-01', 100)], [P('2026-10-09', 0)], '2026-10-09');
  eq('5.18 una salida de 0 bloques no cambia nada ni avisa', [r13.disponible, r13.avisos], [100, []]);
}

// ——— 6. Km en línea recta (haversine) ———
{
  const G = (lat, lng) => ({ lat, lng });
  // Referencia independiente: la ley esférica de los cosenos, con el mismo radio.
  const rad = (d) => (d * Math.PI) / 180;
  const cosenos = (a, b) => 6371 * Math.acos(
    Math.sin(rad(a.lat)) * Math.sin(rad(b.lat)) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng)));

  eq('6.1 un grado sobre el ecuador = 111,2 km', llamar('kmLineaRecta', G(0, 0), G(0, 1)), 111.2);
  eq('6.2 un grado sobre un meridiano = 111,2 km', llamar('kmLineaRecta', G(0, 0), G(1, 0)), 111.2);
  eq('6.3 media vuelta al ecuador = 20.015,1 km', llamar('kmLineaRecta', G(0, 0), G(0, 180)), 20015.1);
  eq('6.4 el mismo punto = 0 km', llamar('kmLineaRecta', G(10.6, -66.93), G(10.6, -66.93)), 0);
  const sitio = G(10.6, -66.93), destino = G(10.48, -66.85);
  const km = llamar('kmLineaRecta', sitio, destino);
  ok('6.5 ⭐ un sitio y un destino cercanos: a 0,1 km de la referencia', () => Math.abs(km - cosenos(sitio, destino)) <= 0.1);
  ok('6.6 sale con 1 decimal', () => Math.round(km * 10) === km * 10);
  eq('6.7 de ida = de vuelta', llamar('kmLineaRecta', destino, sitio), km);
  const lejos = G(8.12, -63.55);
  ok('6.8 un destino lejano: a 0,1 km de la referencia', () => Math.abs(llamar('kmLineaRecta', sitio, lejos) - cosenos(sitio, lejos)) <= 0.1);
  eq('6.9 los bordes valen: longitud −180 y 180 son el mismo meridiano', llamar('kmLineaRecta', G(0, -180), G(0, 180)), 0);

  // Coordenadas que no se entienden: «sin dato» (null), nunca NaN ni 0 engañoso.
  eq('6.10 latitud 91 → sin dato', llamar('kmLineaRecta', G(91, 0), G(0, 0)), null);
  eq('6.11 longitud 181 → sin dato', llamar('kmLineaRecta', G(0, 0), G(0, 181)), null);
  eq('6.12 NaN → sin dato', llamar('kmLineaRecta', G(NaN, 0), G(0, 0)), null);
  eq('6.13 un punto ausente → sin dato, sin reventar', llamar('kmLineaRecta', null, G(0, 0)), null);
  eq('6.14 coordenadas en texto → sin dato', llamar('kmLineaRecta', G('10.6', '-66.93'), G(0, 0)), null);
}

// ——— 7. Casos de borde y avisos ———
{
  eq('7.1 un factor colado como texto («1.2») cuenta como «sin factor»', llamar('convertirCantidad', 6, 't', '1.2'), C(null, 6, 6000));
  const r1 = llamar('inventarioBloques', [null], [], '2026-10-10');
  ok('7.2 el renglón vacío avisa que está vacío', () => r1.avisos.length === 1 && r1.avisos[0].includes('Producción n.º 1') && r1.avisos[0].includes('vacío'));
  eq('7.3 la fecha de consulta con espacios se entiende', () => llamar('inventarioBloques', [P('2026-10-01', 10)], [], ' 2026-10-08 ').disponible, 10);
  const prods = [P('2026-10-01', 100), P('2026-10-12', 999)]; // la del 12-oct es posterior a la consulta
  const sals = [P('2026-10-11', 500)];                          // salida posterior a la consulta
  const r2 = llamar('inventarioBloques', prods, sals, '2026-10-10');
  eq('7.4 lo anotado después de la consulta no cuenta, no cura y no avisa', [r2.producido, r2.vendido, r2.disponible, r2.enCurado, r2.proximos, r2.avisos], [100, 0, 100, 0, [], []]);
  const r3 = llamar('inventarioBloques', [P('2026-10-01', 2000)], [P('ayer', 1), P('2026-10-03', 1500)], '2026-10-03');
  ok('7.5 primero los renglones ignorados, después los días en falta', () => r3.avisos.length === 2 && r3.avisos[0].includes('Salida n.º 1') && r3.avisos[1].includes('03/10/2026'));
  ok('7.6 las cifras de los avisos van con miles: «faltaron 1.500»', () => r3.avisos[1].includes('faltaron 1.500'));
  const r4 = llamar('inventarioBloques', [P('2026-10-01', 100)], [], '2026-10-08', NaN);
  ok('7.7 días de curado NaN → se usan 7 y se avisa', () => r4.disponible === 100 && r4.avisos.length === 1 && r4.avisos[0].includes('se usaron 7'));
  const entradaP = [P('2026-10-01', 100), P('2026-10-01', 50)], entradaS = [P('2026-10-02', 0)];
  const antes = JSON.stringify([entradaP, entradaS]);
  const r5 = llamar('inventarioBloques', entradaP, entradaS, '2026-10-03');
  r5.proximos.forEach((p) => { p.cantidad = -1; });
  eq('7.8 no toca las listas que recibe (ni al calcular ni si alguien cambia el resultado)', JSON.stringify([entradaP, entradaS]), antes);
}

// ——— 8. La librería es pura ———
{
  const src = fs.readFileSync(LIB, 'utf8');
  ok('8.1 sin imports (ni React, ni Supabase, ni otras librerías)', !/^\s*import\s/m.test(src) && !/require\(/.test(src));
  ok('8.2 sin consultas a la base', !/supabase|\.from\(|\.rpc\(/.test(src));
}

// ——— Cierre ———
console.log(`${fail === 0 ? '✅' : '❌'} test-centro-operaciones-materiales · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Materiales: m³ ↔ t ↔ kg con el factor de cada material, bloques con 7 días de curado y km a cada destino.');
