// 🏭 CENTRO DE OPERACIONES — PRUEBAS DE LAS SALIDAS DEL 📅 PARTE DIARIO (24-oct-2026).
//
// Dos partes:
//   (1) la lógica pura (src/components/centroOperaciones/salidasParteDiario.ts): la
//       conversión m³ ↔ t ↔ kg con el factor del material, los km congelados, el
//       vehículo nuestro/externo, el acero que espera pesaje y «Completar toneladas»,
//       el aluminio y plástico, de qué bloque es cada salida y cómo se ve en la lista;
//   (2) candados sobre la pantalla (BloqueSalidas.tsx): solo habla con la capa de
//       datos, 🗑️ solo Full y con confirmación, un guardado a la vez y lo escrito no
//       se pierde si la base rechaza.
//
// ⭐ Todos los datos son SINTÉTICOS (el repositorio es público).
//
//   node scripts/test-centro-operaciones-salidas.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

// El mismo cargador de scripts/test-centro-operaciones-carga.mjs: transpila el .ts a
// CommonJS y resuelve los imports relativos a otros .ts.
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

console.log('🏭 CENTRO DE OPERACIONES · 📅 SALIDAS DEL PARTE DIARIO\n');

const DIR = 'src/components/centroOperaciones';
const RUTA_LIB = `${DIR}/salidasParteDiario.ts`;
ok('(0) existe la lógica pura de las salidas', existe(RUTA_LIB));
const lib0 = leer(RUTA_LIB);
let S = {};
try { S = existe(RUTA_LIB) ? loadTs(path.join(ROOT, RUTA_LIB)) : {}; } catch (e) { ok('(0) la lógica carga sin errores', false, String(e?.message ?? e)); }
const fn = (nombre) => (typeof S[nombre] === 'function' ? S[nombre] : () => { throw new Error(`falta ${nombre}`); });
/** Corre `f` y devuelve su resultado, o el error como texto (la prueba sigue). */
const intenta = (f) => { try { return f(); } catch (e) { return `ERROR: ${e?.message ?? e}`; } };

// ── Datos sintéticos ──────────────────────────────────────────────────────
const SITIO = 'sitio-1';
const FECHA = '2026-10-24';
const item = (id, clase, nombre, extra = {}) => ({
  id, sitioId: SITIO, clase, nombre, activo: true, lat: null, lng: null, km: null, factorTM3: null, diasDisponible: null, ...extra,
});
const listas = [
  item('m1', 'material', 'Triturado mixto'),
  item('m2', 'material', 'Arrocillo', { factorTM3: 1.5 }),
  item('m3', 'material', 'Polvillo', { factorTM3: 0 }),
  item('m4', 'material', 'Acero'),
  item('m5', 'material', 'Aluminio'),
  item('m6', 'material', 'Bloques', { diasDisponible: 7 }),
  item('m7', 'material', 'Material viejo', { activo: false }),
  item('m8', 'material', 'Cartón'),
  item('d1', 'destino', 'Planta Uno', { km: 12.5 }),
  item('d2', 'destino', 'Obra Dos'),
  item('t1', 'transportista', 'Transportes Delta'),
];
const unidad = (id, codigo, placa, chofer, extra = {}) => ({
  id, sitioId: SITIO, origen: 'propia', machineryId: null, codigo, descripcion: null, placa, serial: null, marca: null, modelo: null,
  dueno: null, capacidadM3: 12, activo: true, nota: null, estado: 'disponible', estadoNota: null, estadoAt: null, chofer, ...extra,
});
const unidades = [
  unidad('u1', 'V-01', 'ab 123 cd', 'Chofer Uno'),
  unidad('u2', 'V-02', 'XY999ZZ', null),
  unidad('u3', 'V-03', 'CC333CC', 'Chofer Tres'),
];
const mov = (id, extra = {}) => ({
  id, sitioId: SITIO, fecha: FECHA, hora: null, tipo: 'salida', unidadId: null, unidadTexto: '', placa: null,
  transportista: null, transportistaId: null, origen: null, origenId: null, destino: null, destinoId: null,
  material: null, materialId: null, capacidadM3: null, viajes: 1, toneladas: null, m3: null, estado: 'confirmado',
  observacion: null, chofer: null, km: null, vehiculo: null, cantidad: null, unidadIngresada: null, disponibleDesde: null,
  creadoPor: null, creadoAt: null, editadoPor: null, editadoAt: null, ...extra,
});
const L = (texto, listaId = null) => ({ texto, listaId });
/** Quién se lleva el acero en las pruebas: un nombre SINTÉTICO (lote 5 B19). */
const ACERIA = 'Acería Uno';
/** Lo que se guardaría, como renglón (para preguntarle de qué bloque es). */
const comoRenglon = (id, datos) => mov(id, datos);

// ═══════════════════════ (1) LA LÓGICA PURA ═══════════════════════

// ── 1.1 Conversión en vivo de los agregados ──
{
  const base = { ...fn('formAgregadoNuevo')(), material: L('Triturado mixto', 'm1') };
  eq('⭐ 1.1 10 m³ de un material sin factor → 12 t (factor 1,2) y 12.000 kg',
    intenta(() => fn('cantidadesAgregado')({ ...base, cantidad: '10', unidad: 'm3' }, listas)), { m3: 10, t: 12, kg: 12000 });
  eq('⭐ 1.1 6 t → 5 m³ y 6.000 kg',
    intenta(() => fn('cantidadesAgregado')({ ...base, cantidad: '6', unidad: 't' }, listas)), { m3: 5, t: 6, kg: 6000 });
  eq('1.1 14400 kg → 14,4 t y 12 m³',
    intenta(() => fn('cantidadesAgregado')({ ...base, cantidad: '14400', unidad: 'kg' }, listas)), { m3: 12, t: 14.4, kg: 14400 });
  eq('⭐ 1.1 el texto en vivo: «12,00 m³ · 14,40 t · 14.400 kg»',
    intenta(() => fn('textoEnVivoAgregado')({ ...base, cantidad: '12', unidad: 'm3' }, listas)), '12,00 m³ · 14,40 t · 14.400 kg');
  eq('1.1 con coma: «12,5» m³ → 15 t',
    intenta(() => fn('cantidadesAgregado')({ ...base, cantidad: '12,5', unidad: 'm3' }, listas)).t, 15);
  eq('1.1 campo vacío → nada en vivo (sin dato, no 0)',
    intenta(() => fn('textoEnVivoAgregado')({ ...base, cantidad: '', unidad: 'm3' }, listas)), '');
  eq('⭐ 1.1 el material con SU factor (Arrocillo 1,5): 3 m³ → 4,5 t',
    intenta(() => fn('cantidadesAgregado')({ ...base, material: L('arrocillo'), cantidad: '3', unidad: 'm3' }, listas)), { m3: 3, t: 4.5, kg: 4500 });
  eq('1.1 factor de Arrocillo sale de la lista', intenta(() => fn('factorDeMaterial')(L('Arrocillo', 'm2'), listas)), { factor: 1.5, deLista: true });
  eq('1.1 factor 0 en la lista (Polvillo) = sin factor → 1,2', intenta(() => fn('factorDeMaterial')(L('Polvillo', 'm3'), listas)), { factor: 1.2, deLista: false });
  eq('1.1 material que no está en la lista → 1,2', intenta(() => fn('factorDeMaterial')(L('Granzón'), listas)), { factor: 1.2, deLista: false });
  eq('1.1 un id de lista viejo con otro nombre no manda: vale el nombre escrito',
    intenta(() => fn('factorDeMaterial')(L('Triturado mixto', 'm2'), listas)), { factor: 1.2, deLista: false });
}

// ── 1.2 Vehículo: elegir y soltar una unidad nuestra ──
{
  const f0 = fn('formAgregadoNuevo')();
  const conU1 = intenta(() => fn('elegirUnidadSalida')(f0, unidades[0], unidades));
  eq('⭐ 1.2 elegir la unidad copia nombre, placa y chofer', [conU1.vehiculo, conU1.unidadId, conU1.unidadTexto, conU1.placa, conU1.chofer],
    ['propio', 'u1', 'V-01', 'ab 123 cd', 'Chofer Uno']);
  const aU2 = intenta(() => fn('elegirUnidadSalida')(conU1, unidades[1], unidades));
  eq('1.2 cambiar a una unidad SIN chofer: el de la anterior se va (era de otro camión)', [aU2.unidadId, aU2.chofer], ['u2', '']);
  const aU3 = intenta(() => fn('elegirUnidadSalida')(conU1, unidades[2], unidades));
  eq('1.2 cambiar a otra con chofer: sale el suyo', aU3.chofer, 'Chofer Tres');
  const aMano = intenta(() => fn('elegirUnidadSalida')({ ...f0, chofer: 'Suplente' }, unidades[1], unidades));
  eq('1.2 el chofer escrito a mano se respeta si la unidad no trae uno', aMano.chofer, 'Suplente');
  const corregido = intenta(() => fn('elegirUnidadSalida')({ ...conU1, chofer: 'Suplente' }, unidades[1], unidades));
  eq('1.2 * también después de corregir el chofer de la unidad anterior', corregido.chofer, 'Suplente');
  const suelto = intenta(() => fn('soltarUnidadSalida')(conU1, unidades));
  eq('1.2 «Cambiar» suelta la unidad, su placa y su chofer', [suelto.unidadId, suelto.unidadTexto, suelto.placa, suelto.chofer], [null, '', '', '']);
  const sueltoMano = intenta(() => fn('soltarUnidadSalida')({ ...conU1, chofer: 'Suplente' }, unidades));
  eq('1.2 * pero un chofer escrito a mano se queda', sueltoMano.chofer, 'Suplente');
}

// ── 1.3 Agregados: lo que se guarda ──
{
  const propio = {
    ...intenta(() => fn('elegirUnidadSalida')(fn('formAgregadoNuevo')(), unidades[0], unidades)),
    material: L('Triturado mixto', 'm1'), cantidad: '10', unidad: 'm3', destino: L('planta uno'), viajes: '1', observacion: '  ',
  };
  const r = intenta(() => fn('validarAgregado')(propio, FECHA, listas, null));
  eq('1.3 sin errores', r.errores, []);
  const d = r.datos ?? {};
  eq('⭐ 1.3 salida confirmada con m³ Y toneladas calculadas (10 m³ → 12 t) y la unidad escrita',
    [d.tipo, d.estado, d.fecha, d.m3, d.toneladas, d.unidadIngresada], ['salida', 'confirmado', FECHA, 10, 12, 'm3']);
  eq('⭐ 1.3 nuestro: unidad, placa en mayúsculas y chofer; sin empresa',
    [d.vehiculo, d.unidadId, d.unidadTexto, d.placa, d.chofer, d.transportista, d.transportistaId], ['propio', 'u1', 'V-01', 'AB 123 CD', 'Chofer Uno', null, null]);
  eq('⭐ 1.3 el destino escrito igual se vincula a su lista y CONGELA sus km', [d.destino, d.destinoId, d.km], ['planta uno', 'd1', 12.5]);
  eq('1.3 material vinculado, viajes 1, observación en blanco = null', [d.material, d.materialId, d.viajes, d.observacion], ['Triturado mixto', 'm1', 1, null]);
  ok('1.3 lo que el formulario no escribe NO viaja (hora, origen, capacidad, cantidad)',
    !('hora' in d) && !('origen' in d) && !('capacidadM3' in d) && !('cantidad' in d) && !('sitioId' in d) && !('id' in d), Object.keys(d).join(','));

  const externo = { ...propio, vehiculo: 'externo', empresa: L('Transportes Delta', 't1') };
  const e = intenta(() => fn('validarAgregado')(externo, FECHA, listas, null));
  eq('1.3 externo: sin errores', e.errores, []);
  eq('⭐ 1.3 externo: SOLO la compañía (sin unidad, placa ni chofer aunque se hubieran elegido)',
    [e.datos?.vehiculo, e.datos?.transportista, e.datos?.transportistaId, e.datos?.unidadId, e.datos?.unidadTexto, e.datos?.placa, e.datos?.chofer],
    ['externo', 'Transportes Delta', 't1', null, '', null, null]);
  ok('⭐ 1.3 externo sin compañía → error', intenta(() => fn('validarAgregado')({ ...externo, empresa: L('  ') }, FECHA, listas, null)).errores.some((x) => /compañía/.test(x)));
  ok('1.3 nuestro sin unidad ni placa → error', intenta(() => fn('validarAgregado')({ ...propio, unidadId: null, unidadTexto: '', placa: '' }, FECHA, listas, null)).errores.some((x) => /unidad/.test(x)));
  eq('1.3 nuestro sin flota pero con la placa escrita → vale', intenta(() => fn('validarAgregado')({ ...propio, unidadId: null, unidadTexto: '', placa: 'zz-1' }, FECHA, listas, null)).datos?.placa, 'ZZ-1');
  const errores = (cambio) => intenta(() => fn('validarAgregado')({ ...propio, ...cambio }, FECHA, listas, null)).errores ?? [];
  ok('1.3 sin material → error', errores({ material: L('') }).some((x) => /material/.test(x)));
  ok('1.3 «Acero» en agregados → va a su bloque', errores({ material: L('acero') }).some((x) => /Acero/.test(x)));
  ok('1.3 «Plástico» en agregados → va a su bloque', errores({ material: L('Plastico') }).some((x) => /plástico/.test(x)));
  ok('1.3 «Bloques» en agregados → va a la cantera', errores({ material: L('Bloques') }).some((x) => /bloques/i.test(x)));
  ok('1.3 cantidad vacía → error', errores({ cantidad: '' }).some((x) => /cantidad/i.test(x)));
  ok('1.3 cantidad 0 → error', errores({ cantidad: '0' }).some((x) => /mayor que cero/.test(x)));
  ok('1.3 cantidad negativa → error', errores({ cantidad: '-3' }).some((x) => /negativa/.test(x)));
  ok('1.3 sin destino → error', errores({ destino: L('') }).some((x) => /destino/.test(x)));
  ok('1.3 viajes 0 → error', errores({ viajes: '0' }).some((x) => /viajes/i.test(x)));
  ok('1.3 viajes 1,5 → error', errores({ viajes: '1,5' }).some((x) => /entero/.test(x)));
  ok('1.3 unidad desconocida → error', errores({ unidad: 'litros' }).some((x) => /unidad/.test(x)));
  ok('1.3 fecha inválida → error', intenta(() => fn('validarAgregado')(propio, '2026-02-30', listas, null)).errores.some((x) => /fecha/.test(x)));
  eq('1.3 destino que no está en la lista: queda escrito, sin id y sin km',
    [errores({ destino: L('Obra nueva') }).length, intenta(() => fn('validarAgregado')({ ...propio, destino: L('Obra nueva') }, FECHA, listas, null)).datos?.km],
    [0, null]);

  // Editar: la fecha y los km congelados.
  const vieja = mov('a1', { fecha: '2026-10-20', destino: 'Planta Uno', destinoId: 'd1', km: 10 });
  const ed = intenta(() => fn('validarAgregado')({ ...propio, destino: L('Planta Uno', 'd1') }, FECHA, listas, vieja));
  eq('⭐ 1.3 editar NO muda la salida de día (la fecha es la suya)', ed.datos?.fecha, '2026-10-20');
  eq('⭐ 1.3 editar sin cambiar el destino deja los km CONGELADOS (10, aunque la lista diga 12,5)', ed.datos?.km, 10);
  eq('1.3 editar cambiando el destino toma los km del nuevo (Obra Dos: sin km)',
    intenta(() => fn('validarAgregado')({ ...propio, destino: L('Obra Dos', 'd2') }, FECHA, listas, vieja)).datos?.km, null);
  eq('1.3 editar una que no tenía km: toma los de ahora',
    intenta(() => fn('validarAgregado')({ ...propio, destino: L('Planta Uno', 'd1') }, FECHA, listas, { ...vieja, km: null })).datos?.km, 12.5);

  // Formulario desde un renglón guardado.
  const enKg = mov('a2', { material: 'Arrocillo', materialId: 'm2', m3: 9.6, toneladas: 14.4, unidadIngresada: 'kg', destino: 'Planta Uno', destinoId: 'd1',
    vehiculo: 'externo', transportista: 'Transportes Delta', transportistaId: 't1', viajes: 2 });
  const fd = intenta(() => fn('formAgregadoDesde')(enKg));
  eq('1.3 ✏️ vuelve en la unidad en que se escribió (14,4 t escritas en kg → «14400» kg)',
    [fd.cantidad, fd.unidad, fd.vehiculo, fd.empresa?.texto, fd.viajes, fd.material?.listaId], ['14400', 'kg', 'externo', 'Transportes Delta', '2', 'm2']);
  const deCargaLibre = intenta(() => fn('formAgregadoDesde')(mov('a3', { material: 'Arrocillo', m3: 7, placa: 'AB1', unidadIngresada: null })));
  eq('1.3 ✏️ de una salida de ✍️ Carga libre (sin unidad escrita ni vehículo): m³ y nuestro', [deCargaLibre.unidad, deCargaLibre.cantidad, deCargaLibre.vehiculo], ['m3', '7', 'propio']);
  eq('1.3 ✏️ ida y vuelta: el formulario de un renglón guardado da los mismos m³ y t',
    (() => { const r2 = intenta(() => fn('validarAgregado')(fd, FECHA, listas, enKg)); return [r2.errores?.length, r2.datos?.m3, r2.datos?.toneladas, r2.datos?.km]; })(),
    [0, 9.6, 14.4, 12.5]); // no tenía km guardados: toma los de su destino ahora

  // ⭐ Revisión final A#3: editar una salida vieja NO le recalcula las toneladas con el factor
  //    de HOY. Se anotó 10 m³ de Arrocillo cuando su factor era 1,2 (12 t); después el factor
  //    pasó a 1,5 en ⚙️ Ajustes. Corregir solo la observación deja 10 m³ y 12 t (antes: 15 t).
  //    Como los km (`kmCongelado`): lo guardado se queda mientras no cambien el material, la
  //    cifra ni la unidad; si cambian, es una conversión nueva y va con el factor de ahora.
  const vieja12 = mov('a4', { material: 'Arrocillo', materialId: 'm2', m3: 10, toneladas: 12, unidadIngresada: 'm3',
    destino: 'Planta Uno', destinoId: 'd1', km: 12.5, vehiculo: 'propio', unidadId: 'u1', unidadTexto: 'V-01', placa: 'AB123CD', chofer: 'Chofer Uno' });
  const f12 = intenta(() => fn('formAgregadoDesde')(vieja12));
  const guarda = (cambio) => intenta(() => fn('validarAgregado')({ ...f12, ...cambio }, FECHA, listas, vieja12)).datos ?? {};
  eq('⭐ 1.3 A#3 corregir solo la observación conserva 10 m³ y 12 t (no 15 t con el factor de hoy)', [guarda({ observacion: 'Nota' }).m3, guarda({ observacion: 'Nota' }).toneladas], [10, 12]);
  eq('⭐ 1.3 A#3 lo que se ve en vivo al editarla es lo guardado (10 m³ · 12 t · 12.000 kg)', intenta(() => fn('cantidadesAgregado')(f12, listas)), { m3: 10, t: 12, kg: 12000 });
  eq('1.3 A#3 la misma cifra escrita de otra forma («10,0») sigue siendo la misma', [guarda({ cantidad: '10,0' }).m3, guarda({ cantidad: '10,0' }).toneladas], [10, 12]);
  eq('⭐ 1.3 A#3 si cambia la cifra, es una conversión nueva: 11 m³ con el factor de ahora (1,5) → 16,5 t', [guarda({ cantidad: '11' }).m3, guarda({ cantidad: '11' }).toneladas], [11, 16.5]);
  eq('1.3 A#3 si cambia la unidad (12 t), también: 12 t ÷ 1,5 = 8 m³', [guarda({ cantidad: '12', unidad: 't' }).m3, guarda({ cantidad: '12', unidad: 't' }).toneladas], [8, 12]);
  eq('1.3 A#3 si cambia el material (Triturado mixto, sin factor → 1,2): 10 m³ → 12 t, calculado de nuevo',
    [guarda({ material: L('Triturado mixto', 'm1') }).m3, guarda({ material: L('Triturado mixto', 'm1') }).toneladas], [10, 12]);
  eq('1.3 A#3 volver a escribir la cifra original deja otra vez lo guardado', [guarda({ cantidad: '10' }).m3, guarda({ cantidad: '10' }).toneladas], [10, 12]);
  // En kg: 14.400 kg de Arrocillo anotados con factor 1,2 (12 m³); hoy 1,5 daría 9,6 m³.
  const viejaKg = mov('a5', { material: 'Arrocillo', materialId: 'm2', m3: 12, toneladas: 14.4, unidadIngresada: 'kg', destino: 'Planta Uno', destinoId: 'd1', km: 12.5, vehiculo: 'externo', transportista: 'Transportes Delta' });
  const fKg = intenta(() => fn('formAgregadoDesde')(viejaKg));
  const dKg = intenta(() => fn('validarAgregado')({ ...fKg, viajes: '2' }, FECHA, listas, viejaKg)).datos ?? {};
  eq('⭐ 1.3 A#3 en kg: corregir los viajes conserva 12 m³ y 14,4 t', [dKg.m3, dKg.toneladas, dKg.unidadIngresada], [12, 14.4, 'kg']);
  eq('1.3 A#3 * y en vivo dice 12 m³ · 14,4 t · 14.400 kg', intenta(() => fn('cantidadesAgregado')(fKg, listas)), { m3: 12, t: 14.4, kg: 14400 });
  // Una salida NUEVA nunca usa lo guardado de otra (aunque el formulario lo traiga pegado).
  const nueva = intenta(() => fn('validarAgregado')({ ...f12, observacion: 'otra' }, FECHA, listas, null)).datos ?? {};
  eq('⭐ 1.3 A#3 una salida NUEVA convierte con el factor de ahora (10 m³ → 15 t)', [nueva.m3, nueva.toneladas], [10, 15]);
  // M4 (pendiente de F2a): la línea «Factor …» al editar dice el de ESA salida (t ÷ m³), no el de hoy.
  {
    const fd = (f) => intenta(() => fn('factorDelFormulario')(f, listas));
    eq('⭐ 1.3 M4 al editar sin tocar material, cifra ni unidad, el factor que se ve es el GUARDADO (12 t ÷ 10 m³ = 1,2), no el de hoy (1,5)',
      fd(f12), { factor: 1.2, deLista: false, guardado: true });
    eq('1.3 M4 * en kg también (14,4 t ÷ 12 m³ = 1,2)', fd(fKg).factor, 1.2);
    eq('1.3 M4 * si cambia la cifra, el de ahora (de la lista)', fd({ ...f12, cantidad: '11' }), { factor: 1.5, deLista: true, guardado: false });
    eq('1.3 M4 * si cambia la unidad, el de ahora', fd({ ...f12, cantidad: '12', unidad: 't' }).guardado, false);
    eq('1.3 M4 * si cambia el material (sin factor en la lista), el de ahora: 1,2 «sin factor»', fd({ ...f12, material: L('Triturado mixto', 'm1') }), { factor: 1.2, deLista: false, guardado: false });
    eq('1.3 M4 * una salida NUEVA, el del material ahora', fd({ ...intenta(() => fn('formAgregadoNuevo')()), material: L('Arrocillo', 'm2'), cantidad: '10' }), { factor: 1.5, deLista: true, guardado: false });
  }
}

// ── 1.4 Acero ──
{
  const f0 = fn('formAceroNuevo')();
  eq('1.4 nace externo, sin toneladas y con 1 viaje', [f0.vehiculo, f0.toneladas, f0.viajes], ['externo', '', '1']);
  const otraEmpresa = { ...intenta(() => fn('elegirQuienAcero')(f0, L(ACERIA))), unidadTexto: ' Camión azul ', m3: '8' };
  ok('⭐ 1.4 B19: ningún nombre de empresa fijo en la lógica (las pastillas salen de la lista del sitio)', S.CSN === undefined && !/export const CSN/.test(lib0));
  const r = intenta(() => fn('validarAcero')(otraEmpresa, FECHA, listas, null));
  eq('1.4 sin errores', r.errores, []);
  const d = r.datos ?? {};
  eq('⭐ 1.4 acero: m³ al salir, toneladas VACÍAS y «esperando pesaje»',
    [d.tipo, d.material, d.materialId, d.m3, d.toneladas, d.estado, d.unidadIngresada], ['salida', 'Acero', 'm4', 8, null, 'esperando_pesaje', 'm3']);
  eq('1.4 se lo lleva otra empresa: externo, con el camión escrito', [d.vehiculo, d.transportista, d.unidadTexto, d.unidadId, d.placa, d.chofer],
    ['externo', ACERIA, 'Camión azul', null, null, null]);

  const nos = intenta(() => fn('elegirQuienAcero')(f0, L(S.NOSOTROS)));
  eq('1.4 «Nosotros» → vehículo nuestro', nos.vehiculo, 'propio');
  const nosU1 = { ...intenta(() => fn('elegirUnidadSalida')(nos, unidades[0], unidades)), m3: '6,5' };
  const rn = intenta(() => fn('validarAcero')(nosU1, FECHA, listas, null));
  eq('⭐ 1.4 nosotros con nuestra unidad: unidad, placa, chofer y la empresa «Nosotros»',
    [rn.errores.length, rn.datos?.vehiculo, rn.datos?.unidadId, rn.datos?.placa, rn.datos?.chofer, rn.datos?.transportista, rn.datos?.m3],
    [0, 'propio', 'u1', 'AB 123 CD', 'Chofer Uno', 'Nosotros', 6.5]);
  const deVuelta = intenta(() => fn('elegirQuienAcero')(nosU1, L(ACERIA)));
  eq('1.4 pasar de nosotros a otra empresa vacía el camión (una unidad nuestra no es el camión de otro)',
    [deVuelta.vehiculo, deVuelta.unidadId, deVuelta.unidadTexto, deVuelta.placa, deVuelta.chofer], ['externo', null, '', '', '']);
  eq('1.4 cambiar de empresa externa a otra externa no vacía el camión', intenta(() => fn('elegirQuienAcero')(otraEmpresa, L('Otra Empresa'))).unidadTexto, ' Camión azul ');

  const err = (cambio) => intenta(() => fn('validarAcero')({ ...otraEmpresa, ...cambio }, FECHA, listas, null)).errores ?? [];
  ok('1.4 sin quién se lo lleva → error', err({ quien: L('') }).some((x) => /quién/.test(x)));
  ok('1.4 externo sin camión → error', err({ unidadTexto: '' }).some((x) => /camión/.test(x)));
  ok('1.4 nosotros sin unidad → error', intenta(() => fn('validarAcero')({ ...nos, m3: '3' }, FECHA, listas, null)).errores.some((x) => /unidad/.test(x)));
  ok('1.4 sin m³ → error', err({ m3: '' }).some((x) => /m³/.test(x)));
  ok('1.4 m³ 0 → error', err({ m3: '0' }).some((x) => /mayor que cero/.test(x)));

  // Editar.
  const pendiente = mov('ac1', { material: 'Acero', m3: 8, estado: 'esperando_pesaje', transportista: ACERIA, vehiculo: 'externo', unidadTexto: 'Camión azul', unidadIngresada: 'm3' });
  const fp = intenta(() => fn('formAceroDesde')(pendiente));
  eq('1.4 ✏️ de una pendiente: quién, camión, m³ y toneladas vacías', [fp.quien?.texto, fp.vehiculo, fp.unidadTexto, fp.m3, fp.toneladas], [ACERIA, 'externo', 'Camión azul', '8', '']);
  const corrige = intenta(() => fn('validarAcero')({ ...fp, m3: '9' }, FECHA, listas, pendiente)).datos ?? {};
  ok('⭐ 1.4 corregir una pendiente SIN toneladas no toca el pesaje (no viajan estado ni toneladas)',
    !('estado' in corrige) && !('toneladas' in corrige) && corrige.m3 === 9, JSON.stringify(corrige));
  const conPeso = intenta(() => fn('validarAcero')({ ...fp, toneladas: '20' }, FECHA, listas, pendiente)).datos ?? {};
  eq('1.4 escribir las toneladas al editar → confirmada', [conPeso.toneladas, conPeso.estado], [20, 'confirmado']);
  const confirmada = { ...pendiente, toneladas: 20, estado: 'confirmado' };
  eq('1.4 ✏️ de una confirmada trae sus toneladas', intenta(() => fn('formAceroDesde')(confirmada)).toneladas, '20');
  const vaciada = intenta(() => fn('validarAcero')({ ...fn('formAceroDesde')(confirmada), toneladas: '' }, FECHA, listas, confirmada)).datos ?? {};
  eq('1.4 vaciar las toneladas de una confirmada la devuelve a pendiente', [vaciada.toneladas, vaciada.estado], [null, 'esperando_pesaje']);
  eq('1.4 ✏️ de un acero nuestro vuelve con «Nosotros»', intenta(() => fn('formAceroDesde')(mov('ac2', { material: 'Acero', vehiculo: 'propio', unidadId: 'u1', transportista: 'Nosotros' }))).quien?.texto, 'Nosotros');

  // Completar toneladas.
  eq('⭐ 1.4 «Completar toneladas»: SOLO toneladas y estado (pendiente → confirmado)',
    intenta(() => fn('completarPesaje')(pendiente, '21,5')), { error: null, cambio: { id: 'ac1', toneladas: 21.5, estado: 'confirmado' } });
  eq('1.4 * con miles: «1.234,5» → 1234,5', intenta(() => fn('completarPesaje')(pendiente, '1.234,5')).cambio?.toneladas, 1234.5);
  ok('1.4 * vacío → pide las toneladas', /Escribe/.test(intenta(() => fn('completarPesaje')(pendiente, '  ')).error ?? ''));
  ok('1.4 * 0 → error', /mayor que cero/.test(intenta(() => fn('completarPesaje')(pendiente, '0')).error ?? ''));
  ok('1.4 * negativa → error', /negativa/.test(intenta(() => fn('completarPesaje')(pendiente, '-2')).error ?? ''));
  eq('1.4 * sin cambio cuando hay error', intenta(() => fn('completarPesaje')(pendiente, '')).cambio, null);
}

// ── 1.5 Pendientes de pesaje (todas las fechas, este sitio) ──
{
  const lista = [
    mov('p3', { fecha: '2026-10-22', material: 'Acero', estado: 'esperando_pesaje' }),
    mov('p1', { fecha: '2026-10-20', material: ' acero ', estado: 'esperando_pesaje' }),
    mov('x1', { fecha: '2026-10-19', material: 'Acero', estado: 'confirmado', toneladas: 10 }),
    mov('x2', { fecha: '2026-10-19', material: 'Arrocillo', estado: 'esperando_pesaje' }),
    mov('x3', { fecha: '2026-10-19', tipo: 'entrada', material: 'Acero', estado: 'esperando_pesaje' }),
    mov('x4', { fecha: '2026-10-19', sitioId: 'otro-sitio', material: 'Acero', estado: 'esperando_pesaje' }),
    mov('p2', { fecha: '2026-10-21', material: 'ACERO', estado: 'esperando_pesaje', hora: '05:00' }),
  ];
  eq('⭐ 1.5 solo acero de salida esperando pesaje de ESTE sitio, de cualquier fecha, el más viejo primero',
    intenta(() => fn('pendientesDePesaje')(lista, SITIO).map((m) => m.id)), ['p1', 'p2', 'p3']);
  eq('1.5 al completarlo deja de estar pendiente',
    intenta(() => fn('pendientesDePesaje')(lista.map((m) => (m.id === 'p1' ? { ...m, estado: 'confirmado', toneladas: 9 } : m)), SITIO).map((m) => m.id)), ['p2', 'p3']);
  eq('1.5 lista vacía o nula → ninguna', [intenta(() => fn('pendientesDePesaje')([], SITIO).length), intenta(() => fn('pendientesDePesaje')(null, SITIO).length)], [0, 0]);
}

// ── 1.6 Aluminio y plástico ──
{
  const f = { ...fn('formAluminioNuevo')(), material: L('Aluminio', 'm5'), cantidad: '2500', unidad: 'kg', empresa: L('Recicladora Sur'), destino: L('Obra Dos', 'd2') };
  eq('1.6 nace en toneladas con 1 viaje', [fn('formAluminioNuevo')().unidad, fn('formAluminioNuevo')().viajes], ['t', '1']);
  eq('⭐ 1.6 2500 kg → 2,5 t', intenta(() => fn('toneladasAluminio')(f)), 2.5);
  const r = intenta(() => fn('validarAluminio')(f, FECHA, listas, null));
  eq('1.6 sin errores', r.errores, []);
  const d = r.datos ?? {};
  eq('⭐ 1.6 se guardan las toneladas (de kg) y SIN m³, con la unidad escrita',
    [d.tipo, d.estado, d.material, d.materialId, d.toneladas, d.m3, d.unidadIngresada], ['salida', 'confirmado', 'Aluminio', 'm5', 2.5, null, 'kg']);
  eq('1.6 la empresa (otra) → externo; destino con su id y sin km', [d.transportista, d.vehiculo, d.destino, d.destinoId, d.km], ['Recicladora Sur', 'externo', 'Obra Dos', 'd2', null]);
  eq('1.6 en t: 3 t → 3', intenta(() => fn('validarAluminio')({ ...f, unidad: 't', cantidad: '3' }, FECHA, listas, null)).datos?.toneladas, 3);
  eq('1.6 «Nosotros» → nuestro', intenta(() => fn('validarAluminio')({ ...f, empresa: L(' nosotros ') }, FECHA, listas, null)).datos?.vehiculo, 'propio');
  eq('1.6 destino opcional: sin destino no hay km', (() => { const x = intenta(() => fn('validarAluminio')({ ...f, destino: L('') }, FECHA, listas, null)); return [x.errores.length, x.datos?.destino, x.datos?.km]; })(), [0, null, null]);
  eq('1.6 plástico con destino de la lista: km congelados', intenta(() => fn('validarAluminio')({ ...f, material: L('Plástico'), destino: L('Planta Uno') }, FECHA, listas, null)).datos?.km, 12.5);
  const err = (c) => intenta(() => fn('validarAluminio')({ ...f, ...c }, FECHA, listas, null)).errores ?? [];
  ok('1.6 sin empresa → error', err({ empresa: L('') }).some((x) => /empresa/.test(x)));
  ok('1.6 sin material → error', err({ material: L('') }).some((x) => /material/.test(x)));
  ok('1.6 acero acá → va a su bloque', err({ material: L('Acero') }).some((x) => /Acero/.test(x)));
  ok('1.6 cantidad vacía → error', err({ cantidad: '' }).some((x) => /cantidad/i.test(x)));
  ok('1.6 unidad m³ no vale acá', err({ unidad: 'm3' }).some((x) => /unidad/.test(x)));
  const fd = intenta(() => fn('formAluminioDesde')(comoRenglon('al1', d)));
  eq('1.6 ✏️ vuelve en kg («2500»)', [fd.cantidad, fd.unidad, fd.empresa?.texto, fd.destino?.listaId], ['2500', 'kg', 'Recicladora Sur', 'd2']);
}

// ── 1.7 De qué bloque es cada salida ──
{
  const clase = fn('claseDeSalida');
  const agregado = intenta(() => fn('validarAgregado')({ ...fn('formAgregadoNuevo')(), material: L('Arrocillo'), cantidad: '6', unidad: 't', destino: L('Planta Uno'), vehiculo: 'externo', empresa: L('Transportes Delta') }, FECHA, listas, null)).datos;
  const acero = intenta(() => fn('validarAcero')({ ...fn('formAceroNuevo')(), quien: L(ACERIA), unidadTexto: 'Camión', m3: '5' }, FECHA, listas, null)).datos;
  const carton = intenta(() => fn('validarAluminio')({ ...fn('formAluminioNuevo')(), material: L('Cartón'), cantidad: '1', unidad: 't', empresa: L('Recicladora Sur') }, FECHA, listas, null)).datos;
  eq('⭐ 1.7 lo guardado por cada bloque vuelve a su bloque (agregado en t, acero, «otro» de aluminio)',
    [clase(comoRenglon('c1', agregado)), clase(comoRenglon('c2', acero)), clase(comoRenglon('c3', carton))], ['agregados', 'acero', 'aluminioPlastico']);
  eq('1.7 aluminio y plástico por su nombre', [clase(mov('c4', { material: 'aluminio', m3: 3 })), clase(mov('c5', { material: 'PLÁSTICO' }))], ['aluminioPlastico', 'aluminioPlastico']);
  eq('1.7 una salida de ✍️ Carga libre (sin unidad escrita) es de agregados: no queda sin verse',
    [clase(mov('c6', { material: 'Arrocillo' })), clase(mov('c7', { material: null, toneladas: 4 }))], ['agregados', 'agregados']);
  eq('1.7 bloques, entradas, internos y producción no son de estos bloques',
    [clase(mov('c8', { material: 'Bloques', cantidad: 50, unidadIngresada: 'u', viajes: null })), clase(mov('c9', { tipo: 'entrada', material: 'Acero' })),
      clase(mov('c10', { tipo: 'interno' })), clase(mov('c11', { tipo: 'produccion', material: 'Bloques' }))], [null, null, null, null]);
  const delDia = [
    mov('d2', { material: 'Arrocillo', m3: 1, hora: '14:00' }),
    mov('d1', { material: 'Arrocillo', m3: 1, hora: '08:00' }),
    mov('d3', { material: 'Acero' }),
    mov('d4', { material: 'Arrocillo', m3: 1, hora: '02:00' }),
  ];
  eq('1.7 las del día de un bloque, en el orden de la jornada (la madrugada al final)',
    intenta(() => fn('salidasDeClase')(delDia, 'agregados').map((m) => m.id)), ['d1', 'd2', 'd4']);
}

// ── 1.8 Los materiales que ofrece cada bloque ──
{
  eq('⭐ 1.8 agregados: los activos de la lista, sin acero, aluminio, plástico ni bloques, A→Z',
    intenta(() => fn('materialesPara')(listas, 'agregados')), ['Arrocillo', 'Cartón', 'Polvillo', 'Triturado mixto']);
  eq('1.8 aluminio y plástico: los dos primero (sin repetir el de la lista) y los demás, sin acero ni bloques',
    intenta(() => fn('materialesPara')(listas, 'aluminioPlastico')), ['Aluminio', 'Plástico', 'Arrocillo', 'Cartón', 'Polvillo', 'Triturado mixto']);
}

// ── 1.9 Cómo se ve en la lista ──
{
  const l1 = intenta(() => fn('lineasSalida')(mov('v1', { material: 'Triturado mixto', m3: 10, toneladas: 12, unidadIngresada: 'm3', destino: 'Planta Uno', km: 12.5,
    vehiculo: 'propio', unidadId: 'u1', unidadTexto: 'V-01', placa: 'AB 123 CD', chofer: 'Chofer Uno' })));
  eq('⭐ 1.9 agregado nuestro', l1, {
    titulo: 'Triturado mixto', cifras: '10,00 m³ · 12,00 t · 12.000 kg · 1 viaje', destino: 'Planta Uno · 12,5 km', vehiculo: '🚛 V-01 · AB 123 CD · 👷 Chofer Uno', estado: '',
  });
  const l2 = intenta(() => fn('lineasSalida')(mov('v2', { material: 'Acero', m3: 8, estado: 'esperando_pesaje', vehiculo: 'externo', transportista: ACERIA, unidadTexto: 'Camión azul', viajes: 2 })));
  eq('1.9 acero pendiente: m³ y «toneladas pendientes»; externo con su camión (el estado ya va en las cifras)',
    [l2.cifras, l2.vehiculo, l2.destino, l2.estado], ['8,00 m³ · ⚖️ toneladas pendientes · 2 viajes', `🏢 ${ACERIA} · camión Camión azul`, '', '']);
  const l3 = intenta(() => fn('lineasSalida')(mov('v3', { material: 'Acero', m3: 8, toneladas: 21.5, estado: 'confirmado', vehiculo: 'externo', transportista: 'Otra' })));
  eq('1.9 acero confirmado: m³ y sus toneladas', l3.cifras, '8,00 m³ · 21,50 t · 21.500 kg · 1 viaje');
  const l4 = intenta(() => fn('lineasSalida')(mov('v4', { material: 'Plástico', toneladas: 2.5, unidadIngresada: 'kg', transportista: 'Recicladora Sur', vehiculo: 'externo', destino: 'Obra Dos' })));
  eq('1.9 plástico: t y kg, sin m³; destino sin km', [l4.cifras, l4.destino, l4.vehiculo], ['2,50 t · 2.500 kg · 1 viaje', 'Obra Dos (sin km)', '🏢 Recicladora Sur']);
}

// ── 1.10 Lote 5 A3: una cantidad > 0 nunca se guarda en 0, y los kg con decimales avisan ──
{
  const base = { ...intenta(() => fn('elegirUnidadSalida')(fn('formAgregadoNuevo')(), unidades[0], unidades)),
    material: L('Triturado mixto', 'm1'), destino: L('Planta Uno', 'd1'), viajes: '1' };
  const r = (c) => intenta(() => fn('validarAgregado')({ ...base, ...c }, FECHA, listas, null));
  ok('⭐ 1.10 A3: «1,5» kg de agregado (1,5 kg) da 0 m³: NO se guarda, se dice por qué',
    (r({ cantidad: '1,5', unidad: 'kg' }).errores ?? []).some((x) => /da 0/.test(x)), JSON.stringify(r({ cantidad: '1,5', unidad: 'kg' }).errores));
  ok('1.10 * «0,004» m³ también (0 m³ al redondear)', (r({ cantidad: '0,004', unidad: 'm3' }).errores ?? []).some((x) => /da 0/.test(x)));
  const r1500 = r({ cantidad: '1500', unidad: 'kg' });
  eq('1.10 * 1500 kg sí vale (1,5 t · 1,25 m³)', [r1500.errores, r1500.datos?.toneladas, r1500.datos?.m3], [[], 1.5, 1.25]);
  const alu = { ...fn('formAluminioNuevo')(), material: L('Aluminio', 'm5'), empresa: L('Recicladora Sur'), viajes: '1' };
  const ra = (c) => intenta(() => fn('validarAluminio')({ ...alu, ...c }, FECHA, listas, null));
  ok('⭐ 1.10 A3: aluminio «0,4» kg da 0 t → no se guarda', (ra({ cantidad: '0,4', unidad: 'kg' }).errores ?? []).some((x) => /da 0/.test(x)));
  eq('⭐ 1.10 A3: aluminio 1.234 kg se guarda 1,234 t (no 1,23)', ra({ cantidad: '1234', unidad: 'kg' }).datos?.toneladas, 1.234);
  eq('1.10 * y ✏️ vuelve con los mismos 1234 kg', intenta(() => fn('formAluminioDesde')(comoRenglon('al9', ra({ cantidad: '1234', unidad: 'kg' }).datos))).cantidad, '1234');
  const aviso = (txt, u) => intenta(() => fn('avisoKg')(txt, u));
  ok('⭐ 1.10 A3: «12.500» kg se lee 12,5 kg y el aviso EN VIVO lo dice (y cómo escribir 12500)',
    typeof aviso('12.500', 'kg') === 'string' && aviso('12.500', 'kg').includes('12,5 kg') && aviso('12.500', 'kg').includes('12500'), String(aviso('12.500', 'kg')));
  ok('1.10 * «1,5» kg también avisa (en kg va un número entero)', typeof aviso('1,5', 'kg') === 'string' && aviso('1,5', 'kg').includes('1,5 kg'), String(aviso('1,5', 'kg')));
  eq('1.10 * sin aviso: 12500 kg, 12,5 t, 12,5 m³, vacío o ilegible', [aviso('12500', 'kg'), aviso('12,5', 't'), aviso('12,5', 'm3'), aviso('', 'kg'), aviso('abc', 'kg')], [null, null, null, null, null]);
}

// ── 1.11 Lote 5 A7: UNA regla de «es bloques» (el material de 🧱, aunque no se llame «Bloques») ──
{
  const conBloqueDeOtroNombre = [
    item('m1', 'material', 'Triturado mixto'),
    item('mb', 'material', 'Bloque de concreto', { diasDisponible: 7 }),
    item('d1', 'destino', 'Planta Uno', { km: 12.5 }),
  ];
  eq('⭐ 1.11 A7: agregados no ofrece el material de los bloques aunque no se llame «Bloques»',
    intenta(() => fn('materialesPara')(conBloqueDeOtroNombre, 'agregados')), ['Triturado mixto']);
  eq('1.11 * aluminio y plástico tampoco', intenta(() => fn('materialesPara')(conBloqueDeOtroNombre, 'aluminioPlastico')), ['Aluminio', 'Plástico', 'Triturado mixto']);
  const ag = { ...intenta(() => fn('elegirUnidadSalida')(fn('formAgregadoNuevo')(), unidades[0], unidades)),
    material: L('Bloque de concreto', 'mb'), cantidad: '10', unidad: 'm3', destino: L('Planta Uno', 'd1'), viajes: '1' };
  ok('⭐ 1.11 A7: «Bloque de concreto, 10 m³» en agregados → se anota en 🧱 Bloques',
    (intenta(() => fn('validarAgregado')(ag, FECHA, conBloqueDeOtroNombre, null)).errores ?? []).some((x) => /bloques/i.test(x)));
  ok('1.11 * y en aluminio y plástico igual',
    (intenta(() => fn('validarAluminio')({ ...fn('formAluminioNuevo')(), material: L('bloque de concreto'), cantidad: '1', unidad: 't', empresa: L('X') }, FECHA, conBloqueDeOtroNombre, null)).errores ?? []).some((x) => /bloques/i.test(x)));
  eq('1.11 * sin material de bloques en la lista, «Bloques» por su nombre sigue siendo de 🧱', intenta(() => fn('materialesPara')([item('mx', 'material', 'bloques ')], 'agregados')), []);
}

// ── 1.12 Lote 5 B3: escribir la placa en «Vehículo nuestro» vincula la unidad (la regla de ✍️ Carga libre) ──
{
  const f0 = fn('formAgregadoNuevo')();
  const conU4 = [...unidades, unidad('u4', 'V-04', null, 'Chofer Cuatro')];
  const escribe = (f, placa, us = conU4) => intenta(() => fn('escribirPlacaSalida')(f, placa, us));
  const a = escribe(f0, 'AB-123-CD');
  eq('⭐ 1.12 B3: la placa de UNA unidad activa la vincula y trae su chofer (lo tecleado queda)',
    [a.vehiculo, a.unidadId, a.unidadTexto, a.placa, a.chofer], ['propio', 'u1', 'V-01', 'AB-123-CD', 'Chofer Uno']);
  const b = escribe(a, 'AB-123-C');
  eq('⭐ 1.12 B3: corregir la placa de la unidad vinculada la suelta (con su chofer), sin vaciar lo tecleado',
    [b.unidadId, b.unidadTexto, b.placa, b.chofer], [null, '', 'AB-123-C', '']);
  eq('1.12 * un chofer escrito a mano se queda al soltar', escribe({ ...a, chofer: 'Suplente' }, 'AB-123-C').chofer, 'Suplente');
  const c = escribe(intenta(() => fn('elegirUnidadSalida')(f0, unidades[1], unidades)), 'cc333cc');
  eq('1.12 * la placa de OTRA unidad cambia a esa (y su chofer)', [c.unidadId, c.chofer], ['u3', 'Chofer Tres']);
  const sinPlaca = intenta(() => fn('elegirUnidadSalida')(f0, conU4[3], conU4));
  eq('1.12 * una unidad elegida que no tiene placa no se suelta al escribirle una', [escribe(sinPlaca, 'ZZ1').unidadId, escribe(sinPlaca, 'ZZ1').placa], ['u4', 'ZZ1']);
  eq('1.12 * una placa que no es de nadie, sin unidad elegida: solo queda escrita', [escribe(f0, 'QQ111').unidadId, escribe(f0, 'QQ111').placa], [null, 'QQ111']);
  const dosIguales = [...unidades, unidad('u5', 'V-05', 'AB123CD', null)];
  eq('1.12 * dos unidades activas con la misma placa: no se adivina', escribe(f0, 'AB123CD', dosIguales).unidadId, null);
  eq('1.12 * la misma unidad: no cambia nada más que la placa escrita', [escribe(a, 'ab 123 cd').unidadId, escribe(a, 'ab 123 cd').placa], ['u1', 'ab 123 cd']);
}

// ── 1.13 Lote 5 B4 + R1: lo que viene de ✍️ Carga libre (sin vehículo guardado) ──
{
  const veh = fn('vehiculoDe');
  eq('⭐ 1.13 B4: placa + transportista (sin vehículo guardado) es EXTERNO (la placa no decide)',
    intenta(() => veh(mov('cl1', { placa: 'AB1', transportista: 'Transportes Delta' }))), 'externo');
  eq('1.13 * unidad + transportista también es externo', intenta(() => veh(mov('cl2', { unidadId: 'u1', unidadTexto: 'V-01', transportista: 'Transportes Delta' }))), 'externo');
  eq('1.13 * con «Nosotros» de transportista es nuestro', intenta(() => veh(mov('cl3', { placa: 'AB1', transportista: ' nosotros ' }))), 'propio');
  eq('1.13 * sin transportista es nuestro (como antes)', intenta(() => [veh(mov('cl4', { placa: 'AB1' })), veh(mov('cl5', {}))]), ['propio', 'propio']);
  eq('1.13 * el vehículo guardado manda', intenta(() => [veh(mov('cl6', { vehiculo: 'propio', transportista: 'X' })), veh(mov('cl7', { vehiculo: 'externo', placa: 'P' }))]), ['propio', 'externo']);
  const editable = fn('editableEnParteDiario');
  eq('⭐ 1.13 B4/R1: ✏️ solo para lo que escribió el Parte diario (vehículo guardado); lo de ✍️ Carga libre se corrige allí',
    intenta(() => [editable(mov('e1', { vehiculo: 'propio' })), editable(mov('e2', { vehiculo: 'externo' })), editable(mov('e3', { vehiculo: null })), editable(mov('e4', {}))]),
    [true, true, false, false]);
  const lc = intenta(() => fn('lineasSalida')(mov('cl8', { material: 'Arrocillo', m3: 7, placa: 'AB1', unidadTexto: 'Volteo 9', transportista: 'Transportes Delta' })));
  eq('⭐ 1.13 B4: en la lista se ve la EMPRESA además del camión y la placa', lc.vehiculo, '🏢 Transportes Delta · camión Volteo 9 · AB1');
  const pc = intenta(() => fn('lineasSalida')(mov('cl9', { material: 'Arrocillo', m3: 7, viajes: null, estado: 'por_confirmar' })));
  eq('⭐ 1.13 R1: una salida «por confirmar» lo dice en la lista', pc.estado, '❓ Por confirmar (no suma)');
  eq('1.13 * una que no es acero «esperando pesaje» también', intenta(() => fn('lineasSalida')(mov('cl10', { material: 'Arrocillo', m3: 7, estado: 'esperando_pesaje' }))).estado, '⚖️ Esperando pesaje');
}

// ── 1.14 Lote 5 B19: las pastillas de «quién se lo lleva» salen de la lista del sitio ──
{
  const ls = [
    item('t1', 'transportista', 'Transportes Delta'),
    item('t2', 'transportista', 'Acería Uno', { sitioId: null }),
    item('t3', 'transportista', 'Beta Cargas'),
    item('t4', 'transportista', 'Gamma Fletes'),
    item('t5', 'transportista', 'Épsilon Viejo', { activo: false }),
    item('t6', 'transportista', 'Otro Sitio SA', { sitioId: 'otro-sitio' }),
    item('t7', 'transportista', 'nosotros'),
    item('t8', 'transportista', 'Zeta Rutas'),
    item('m1', 'material', 'Triturado mixto'),
  ];
  const past = (usados = [], max) => intenta(() => fn('pastillasQuienAcero')(ls, SITIO, usados, max));
  eq('⭐ 1.14 B19: las activas de la lista del sitio (y las generales), A→Z, hasta 4; sin «Nosotros» (tiene su pastilla)',
    past(), ['Acería Uno', 'Beta Cargas', 'Gamma Fletes', 'Transportes Delta']);
  eq('⭐ 1.14 * primero las que ya se llevaron acero (las más usadas), después A→Z',
    past(['Zeta Rutas', 'zeta rutas ', 'Gamma Fletes', 'Alguien Fuera De La Lista']), ['Zeta Rutas', 'Gamma Fletes', 'Acería Uno', 'Beta Cargas']);
  eq('1.14 * con otro tope', past([], 2), ['Acería Uno', 'Beta Cargas']);
  eq('1.14 * sin transportistas en la lista: ninguna (queda «Nosotros» y el campo)', intenta(() => fn('pastillasQuienAcero')([], SITIO, [])), []);
}

// ── 1.15 Lote 5 B10: lo que dice el encabezado plegado ──
{
  const delDia = [mov('r1', { material: 'Arrocillo', m3: 1 }), mov('r2', { material: 'Arrocillo', m3: 2 }), mov('r3', { material: 'Acero' })];
  const pend = [mov('p1', { material: 'Acero', estado: 'esperando_pesaje', fecha: '2026-10-20' }), mov('p2', { material: 'Acero', estado: 'esperando_pesaje' }), mov('p3', { material: 'Acero', estado: 'esperando_pesaje', sitioId: 'otro' })];
  const res = (clase, p = pend) => intenta(() => fn('resumenSalidas')(delDia, p, clase, SITIO));
  eq('⭐ 1.15 B10: acero dice cuántas esperan pesaje (de cualquier día, de este sitio), en tono de aviso',
    res('acero'), { texto: '1 salida ese día · ⚖️ 2 pendientes de pesaje', alerta: true });
  eq('1.15 * sin pendientes, sin aviso', res('acero', []), { texto: '1 salida ese día · sin pendientes de pesaje', alerta: false });
  eq('1.15 * agregados: cuántas ese día', res('agregados'), { texto: '2 salidas ese día', alerta: false });
  eq('1.15 * ninguna', res('aluminioPlastico'), { texto: 'Ninguna salida ese día', alerta: false });
  const igual = fn('mismoFormulario');
  eq('1.15 * «sin guardar» = el formulario no es el de partida',
    intenta(() => [igual(fn('formAgregadoNuevo')(), fn('formAgregadoNuevo')()), igual({ ...fn('formAgregadoNuevo')(), cantidad: '3' }, fn('formAgregadoNuevo')())]), [true, false]);
}

// ── 1.16 Revisión final A#1 (+ B-M3): cada renglón se corrige DONDE NACIÓ ──
// Una salida del 📅 Parte diario (con `vehiculo`) NO se corrige con ✏️ en ✍️ Carga libre ni
// en 📋 Registros: su formulario no sabe de la unidad escrita (m³/t/kg), del chofer ni del
// vehículo, y corregir ahí el m³ dejaba «20 m³ · 12 t». Es el espejo de B4/R1 (el Parte
// diario no edita lo de Carga libre) y de los bloques (`avisoEdicionBloques`).
{
  const donde = (m) => intenta(() => fn('dondeSeCorrige')(m));
  const ag = mov('w1', { material: 'Arrocillo', m3: 10, toneladas: 12, unidadIngresada: 'm3', vehiculo: 'propio', destino: 'Planta Uno' });
  const ac = mov('w2', { material: 'Acero', m3: 8, estado: 'esperando_pesaje', unidadIngresada: 'm3', vehiculo: 'externo', transportista: ACERIA });
  const al = mov('w3', { material: 'Cartón', toneladas: 2, unidadIngresada: 't', vehiculo: 'externo', transportista: 'Transportes Delta' });
  ok('⭐ 1.16 A#1 una salida de agregados del Parte diario: se corrige en 📅 Parte diario → 🚚 Salidas de agregados',
    /📅 Parte diario/.test(String(donde(ag))) && /🚚 Salidas de agregados/.test(String(donde(ag))) && /se corrige allá/.test(String(donde(ag))), String(donde(ag)));
  ok('1.16 A#1 * una de acero: → 🔩 Acero', /📅 Parte diario/.test(String(donde(ac))) && /🔩 Acero/.test(String(donde(ac))), String(donde(ac)));
  ok('1.16 A#1 * una de aluminio, plástico u otros (t/kg): → ♻️ Aluminio y plástico', /♻️ Aluminio y plástico/.test(String(donde(al))), String(donde(al)));
  ok('⭐ 1.16 A#1 * la producción y las ventas de bloques siguen diciendo 🧱 Bloques',
    /🧱 Bloques/.test(String(donde(mov('w4', { tipo: 'produccion', cantidad: 120, viajes: null })))) && /🧱 Bloques/.test(String(donde(mov('w5', { material: 'Bloques', cantidad: 40, viajes: null, unidadIngresada: 'u' })))));
  eq('⭐ 1.16 A#1 lo de ✍️ Carga libre (sin vehículo) sí se corrige allí: null',
    [donde(mov('w6', { material: 'Arrocillo', m3: 7 })), donde(mov('w7', { tipo: 'entrada', viajes: 3 })), donde(mov('w8', { tipo: 'interno', viajes: 1 }))], [null, null, null]);
  eq('1.16 A#1 * y es el espejo exacto de editableEnParteDiario (salvo los bloques)',
    [ag, ac, al, mov('w6', { material: 'Arrocillo', m3: 7 })].map((m) => (donde(m) !== null) === fn('editableEnParteDiario')(m)), [true, true, true, true]);
  eq('1.16 A#1 * sin renglón no revienta', donde(null), null);
}

// ═══════════════════════ (2) CANDADOS SOBRE LA PANTALLA ═══════════════════════

const RUTA_PANTALLA = `${DIR}/BloqueSalidas.tsx`;
const pantalla = leer(RUTA_PANTALLA);
const lib = leer(RUTA_LIB);
const db = leer('src/lib/centroOperacionesDb.ts');
ok('(2) existe BloqueSalidas.tsx', !!pantalla);
{
  for (const nombre of ['BloqueSalidas', 'BloqueAgregados', 'BloqueAcero', 'BloqueAluminioPlastico']) {
    ok(`⭐ 2.1 exporta ${nombre}({ sitio, nivel, fecha })`, new RegExp(`export function ${nombre}\\(\\{ sitio, nivel, fecha \\}: Props\\)`).test(pantalla));
  }
  ok('2.1 Props = { sitio: Sitio; nivel: PermLevel; fecha: string }', /type Props = \{ sitio: Sitio; nivel: PermLevel; fecha: string \}/.test(pantalla));

  // Solo la capa de datos habla con la base.
  ok('⭐ 2.2 la pantalla no importa supabase ni arma consultas', !/supabase/.test(pantalla.replace(/centroOperacionesDb/g, '')) && !/\.from\(\s*['"`]/.test(pantalla) && !/selectAllRows|\.rpc\(/.test(pantalla));
  ok('⭐ 2.2 la lógica pura no importa React, Supabase ni usa require()', !/from 'react|supabase|require\(/.test(lib));
  ok('2.2 la pantalla guarda con guardarMovimiento y borra con borrarMovimiento', /guardarMovimiento\(/.test(pantalla) && /borrarMovimiento\(/.test(pantalla));

  // 🗑️ solo Full, con confirmación.
  const usosBorrar = [...pantalla.matchAll(/borrarMovimiento\(/g)].length;
  ok('2.3 borrarMovimiento se llama en un solo lugar', usosBorrar === 1, `usos ${usosBorrar}`);
  const fnBorrar = /const borrar = async \(m: Movimiento\) => \{([\s\S]*?)\n  \};/.exec(pantalla)?.[1] ?? '';
  ok("⭐ 2.3 borrar se corta sin nivel === 'full'", /if \(enVuelo\.current \|\| nivel !== 'full'\) return;/.test(fnBorrar));
  ok('⭐ 2.3 * y pide confirmación (danger) antes de borrar', /await confirm\(\{[\s\S]*danger: true[\s\S]*\}\);[\s\S]*borrarMovimiento\(/.test(fnBorrar));
  ok("2.3 el 🗑️ solo se ofrece con esFull (= nivel === 'full')", /const esFull = nivel === 'full';/.test(pantalla) && /onBorrar=\{!s\.guardando && s\.esFull \?/.test(pantalla));
  ok("2.3 ✏️ y anotar piden 'escritura'", /levelMeets\(nivel, 'escritura'\)/.test(pantalla) && /onEditar=\{!s\.guardando && s\.puedeEscribir && editableEnParteDiario\(m\) \?/.test(pantalla));
  ok('⭐ 2.3 B4/R1: ✏️ apagado en lo de ✍️ Carga libre, con el aviso de dónde se corrige',
    /editableEnParteDiario\(m\)/.test(pantalla) && /se corrige en ✍️ Carga libre/.test(pantalla));

  // Un guardado a la vez; lo escrito no se pierde.
  const fnGuardar = /const guardar = async \(\) => \{([\s\S]*?)\n  \};/.exec(pantalla)?.[1] ?? '';
  ok('⭐ 2.4 guardar: candado contra el doble toque (enVuelo) y permiso', /if \(enVuelo\.current \|\| !puedeEscribir\) return;/.test(fnGuardar) && /enVuelo\.current = true;/.test(fnGuardar));
  ok('⭐ 2.4 guardar fija el renglón que se edita ANTES de esperar a la base', /const ed = editandoRef\.current;[\s\S]*await guardarMovimiento\(ed \? \{ \.\.\.d, id: ed\.id \} : \{ \.\.\.d, sitioId \}\)/.test(fnGuardar));
  const bloqueCatch = /catch \(e: any\) \{([\s\S]*?)return;\n    \}/.exec(fnGuardar)?.[1] ?? '';
  ok('⭐ 2.4 si la base rechaza, el formulario NO se borra (y se avisa y se recarga)', !!bloqueCatch && !/setForm\(/.test(bloqueCatch) && /toast\.error/.test(bloqueCatch) && /setError\(/.test(bloqueCatch) && /datos\.recargar\(\)/.test(bloqueCatch));
  ok('2.4 el botón se apaga mientras guarda', /disabled=\{s\.guardando\}/.test(pantalla));
  ok('2.4 ✏️ no hace nada mientras viaja un guardado (ni sobre lo de ✍️ Carga libre)', /const editar = \(m: Movimiento\) => \{\n    if \(enVuelo\.current \|\| !puedeEscribir \|\| !editableEnParteDiario\(m\)\) return;/.test(pantalla));
  ok('⭐ 2.4 B6: sin las listas y la flota cargadas no se guarda, y se dice por qué',
    /if \(!datos\.listasCargadas\) \{/.test(fnGuardar) && /toca 🔄 Actualizar antes de anotar/.test(pantalla) && /listasCargadas/.test(pantalla));
  ok('2.4 * y el aviso ya no invita a escribir igual', !/se puede escribir igual/.test(pantalla));
  ok('2.4 «Completar toneladas» también tiene su candado y no pisa un renglón en edición',
    /const completar = async \(m: Movimiento\) => \{\n    if \(enVuelo\.current \|\| !s\.puedeEscribir\) return;/.test(pantalla) && /editandoEsta/.test(pantalla));

  // Refresco y respuestas viejas.
  ok('2.5 refresca al enfocarse y cuando cambian el sitio o el día', /useFocusEffect\(useCallback\(\(\) => \{ recargar\(\); \}, \[recargar\]\)\)/.test(pantalla) && /\}, \[sitio, fecha\]\);/.test(pantalla));
  ok('2.5 una respuesta vieja no pisa a la nueva (secuenciaDePedidos)', /secuenciaDePedidos\(\)/.test(pantalla) && /if \(!pedidos\.vigente\(n\)\) return;/.test(pantalla));
  ok('2.5 cambiar de sitio deja todo en blanco', /sitioPrevio\.current = sitio\.id;/.test(pantalla));
  ok('⭐ 2.5 B8: cambiar de día con una salida editada y CON cambios pregunta (descartar o seguir editando)',
    /mismoFormulario\(form, desde\(ed\)\)/.test(pantalla) && /cancelText: 'Seguir editando'/.test(pantalla) && !/Se canceló la edición: cambiaste de día\./.test(pantalla));

  // B11: una sola carga de datos para los tres bloques del Parte diario.
  ok('⭐ 2.5b B11: useDatosSalidas se exporta (el Parte diario lo llama UNA vez) y las secciones reciben los datos',
    /export function useDatosSalidas\(/.test(pantalla) && ['SalidasAgregados', 'SalidasAcero', 'SalidasAluminioPlastico'].every((n) => new RegExp(`export function ${n}\\(`).test(pantalla)));
  ok('2.5b * un solo toast por error de carga (el de useDatosSalidas)', [...pantalla.matchAll(/No se pudieron cargar las salidas/g)].length === 1);
  // B12: reintentar junto al error.
  ok('⭐ 2.5c B12: el error de carga trae «🔄 Reintentar» y dice cómo en el teléfono',
    /🔄 Reintentar/.test(pantalla) && /toca Reintentar \(o desliza hacia abajo en el teléfono\)/.test(pantalla));
  // B9: Lectura no ve formularios.
  ok('⭐ 2.5d B9: Lectura no ve los formularios (cada sección los envuelve en s.puedeEscribir)',
    [...pantalla.matchAll(/\{s\.puedeEscribir \? \(/g)].length >= 3);
  // B18: sin tarjeta dentro de tarjeta.
  ok('⭐ 2.5e B18: dentro del Parte diario las secciones van sin tarjeta propia (incrustado)', /incrustado \? View : Card/.test(pantalla));
  // B3, B19, A3, B10.
  ok('⭐ 2.5f B3: el campo PLACA vincula la unidad con escribirPlacaSalida', /escribirPlacaSalida\(f, v, datos\.unidades\)/.test(pantalla));
  ok('⭐ 2.5f B19: las pastillas de quién se lleva el acero salen de la lista (pastillasQuienAcero), sin nombres fijos',
    /pastillasQuienAcero\(/.test(pantalla) && !/\bCSN\b/.test(pantalla));
  ok('⭐ 2.5f A3: el aviso en vivo de los kg con decimales (avisoKg) en agregados y en aluminio', [...pantalla.matchAll(/avisoKg\(s\.form\.cantidad, s\.form\.unidad\)/g)].length === 2);
  ok('2.5f B10: cada sección dice si quedó algo sin guardar (alSinGuardar)', /alSinGuardar/.test(pantalla) && /mismoFormulario\(/.test(pantalla));

  // Los pendientes de pesaje se leen solos, sin traer todo el historial.
  const fnPend = /export async function cargarSalidasEsperandoPesaje\(sitioId: string\)[\s\S]*?\n\}/.exec(db)?.[0] ?? '';
  ok("⭐ 2.6 la capa de datos lee SOLO las salidas esperando pesaje del sitio",
    /\.eq\('sitio_id', sitioId\)/.test(fnPend) && /\.eq\('tipo', 'salida'\)/.test(fnPend) && /\.eq\('estado', 'esperando_pesaje'\)/.test(fnPend) && /selectAllRows\('cop_movimientos'/.test(fnPend));
  ok('2.6 la pantalla la usa y filtra el acero con la lógica pura', /cargarSalidasEsperandoPesaje\(sitio\.id\)/.test(pantalla) && /pendientesDePesaje\(datos\.pendientes, sitio\.id\)/.test(pantalla));

  // M4 · mesa de maquinaria M8: el 🔧 del selector de unidad sale del estado EFECTIVO (el bloque 🚜, con inspección).
  {
    const sinCom = pantalla.replace(/\/\/[^\n]*/g, '');
    ok('⭐ 2.8 M8 el 🔧 del selector sale de averiadaEnSalidas (el grupo efectivo), nunca de la marca guardada',
      [...sinCom.matchAll(/averiadaEnSalidas\((elegida|u), grupos\)/g)].length === 2 && !/\.estado === 'averiada'/.test(sinCom)
      && /import \{[^}]*\baveriadaEnSalidas\b[^}]*\} from '\.\/pantallaParteDiario'/.test(pantalla));
    ok('2.8 * las secciones con vehículo reciben gruposUnidades y lo pasan al selector',
      /gruposUnidades\?: Record<string, GrupoSitio> \| null;/.test(pantalla) && [...sinCom.matchAll(/<VehiculoNuestro s=\{s\} datos=\{datos\} grupos=\{gruposUnidades\} \/>/g)].length === 2 && /grupos=\{grupos\}/.test(sinCom));
    ok('⭐ 2.8 M4 la línea «Factor …» sale de factorDelFormulario (al editar, el GUARDADO de esa salida)',
      /const factor = factorDelFormulario\(s\.form, listas\);/.test(sinCom) && /factor\.guardado \?/.test(sinCom) && !/factorDeMaterial\(/.test(sinCom));
  }

  // Nada de datos reales: solo nombres genéricos en la pantalla y la lógica.
  ok('2.7 las reglas viven en la lógica pura (la pantalla no convierte por su cuenta)', !/\*\s*1\.2|\/\s*1\.2|\*\s*1000/.test(pantalla));
}

console.log(`${fail === 0 ? '✅' : '❌'} test-centro-operaciones-salidas · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('Salidas: 10 m³ son 12 t, 6 t son 5 m³, el acero espera su pesaje y solo Full borra.');
