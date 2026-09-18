/*
 * Test de los PLATOS DE «OTROS» CON PRECIO (18-sep-2026).
 *
 * Pedido del cliente: «dame la opción de poder crear un plato, por si yo quiero otra
 * cosa además de desayuno, almuerzo, cena, lunch, y que todos deben tener precio», desde
 * Distribución de comida; también cambiarles el nombre.
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · la categoría de precio de un plato cabe en el CHECK de comida_precios (si no, la base
 *     rechaza el precio y el plato queda creado SIN precio)
 *   · una entrega encuentra su plato aunque la cocina lo escriba con otras mayúsculas o espacios
 *   · el precio del plato manda sobre el costo de la cocina; sin precio, el costo; sin nada, «sin precio»
 *   · la tarjeta de cobro y el PDF dan lo mismo con platos
 *   · un plato quitado de la lista se sigue cobrando en sus entregas viejas
 *   · renombrar corrige también las entregas, y es todo o nada
 *   · nada se borra: los platos se quitan de la lista
 *   · crear un plato exige precio
 *
 * Valores inventados: no hay precios reales en el repositorio (es público).
 *
 *   node scripts/test-comida-platos.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

const cache = new Map();
function loadTs(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (cache.has(abs)) return cache.get(abs);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
  }).outputText;
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  cache.set(abs, m.exports);
  const orig = m.require.bind(m);
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(abs), id) + '.ts') : orig(id));
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const PL = loadTs('src/lib/comidaPlatos.ts');
const COBRO = loadTs('src/lib/cobroComidas.ts');
const REP = loadTs('src/lib/comidaReporte.ts');
const MOV = loadTs('src/lib/comidaMovimientos.ts');

// ── 1) LA CATEGORÍA DE PRECIO CABE EN LA BASE ────────────────────────────────
{
  ok('la librería de platos no importa nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/comidaPlatos.ts'))));
  const id = '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f';
  eq('plato_ + 24 letras del id, sin guiones', PL.categoriaDePlato(id), 'plato_3f2a9c1e7b4d4e8a9c2f1a2b');
  eq('siempre la misma para el mismo plato', PL.categoriaDePlato(id), PL.categoriaDePlato(id.toUpperCase()));
  eq('un id que no sirve no da una categoría a medias', [PL.categoriaDePlato(''), PL.categoriaDePlato(null), PL.categoriaDePlato('abc')], ['', '', '']);
  // ⭐ El CHECK real de comida_precios.categoria. Si no calza, la base rechaza el precio.
  const CHECK = /^[a-z0-9_]{2,30}$/;
  let todas = true;
  for (let i = 0; i < 300; i++) if (!CHECK.test(PL.categoriaDePlato(crypto.randomUUID()))) todas = false;
  ok('⭐ 300 ids al azar: todas caben en el CHECK de comida_precios (^[a-z0-9_]{2,30}$)', todas);
  ok('se reconoce como plato', PL.esCategoriaDePlato(PL.categoriaDePlato(id)) && !PL.esCategoriaDePlato('almuerzo'));
}

// ── 2) DEL NOMBRE ESCRITO AL PLATO ───────────────────────────────────────────
const H = '11111111-1111-4111-8111-111111111111';
const R = '22222222-2222-4222-8222-222222222222';
const J = '33333333-3333-4333-8333-333333333333';
const J2 = '44444444-4444-4444-8444-444444444444';
const platos = [
  { id: H, name: 'Bolsa de hielo', active: true },
  { id: R, name: 'Refresco', active: true },
  { id: J, name: 'Jugo', active: false },
];
const cat = (id) => PL.categoriaDePlato(id);
{
  eq('sin mayúsculas ni espacios de más', PL.normPlato('  BOLSA   de Hielo '), 'bolsa de hielo');
  const res = PL.resolverPlatos(platos);
  eq('⭐ la cocina lo escribe distinto y igual encuentra su plato', res(' bolsa  DE hielo'), cat(H));
  eq('⭐ un plato quitado de la lista SIGUE resolviendo (sus entregas viejas se cobran)', res('jugo'), cat(J));
  eq('un nombre que no es de ningún plato', res('Torta'), null);
  eq('⭐ no es «contiene»: «hielo» no es «Bolsa de hielo»', res('hielo'), null);
  eq('sin catálogo, nada', PL.resolverPlatos(null)('Refresco'), null);
  const dos = [{ id: J, name: 'Jugo', active: false }, { id: J2, name: 'jugo ', active: true }];
  eq('si hubiera dos con el mismo nombre, manda el que está en la lista', PL.resolverPlatos(dos)('JUGO'), cat(J2));
  eq('platoConNombre prefiere el de la lista', PL.platoConNombre(dos, 'jugo')?.id, J2);
  eq('nombre de la categoría, para mostrarla', PL.nombreDeCategoria(platos, cat(R)), 'Refresco');
  eq('una categoría que no es plato no tiene nombre de plato', PL.nombreDeCategoria(platos, 'cena'), null);
  eq('orden: los de la lista A→Z, después los quitados', PL.ordenarPlatos(platos).map((p) => p.name), ['Bolsa de hielo', 'Refresco', 'Jugo']);
}

// ── 3) NOMBRES VÁLIDOS ───────────────────────────────────────────────────────
{
  eq('vacío', PL.validarNombrePlato('   ', platos), 'Escribe el nombre del plato.');
  ok('muy largo', /muy largo/.test(PL.validarNombrePlato('x'.repeat(61), platos) ?? ''));
  ok('⭐ no puede llamarse como una comida del sistema', /comida del sistema/.test(PL.validarNombrePlato('Almuerzo', platos) ?? ''));
  ok('⭐ no se repite un plato de la lista', /Ya hay un plato «Refresco»/.test(PL.validarNombrePlato('refresco', platos) ?? ''));
  ok('...ni uno quitado: se manda a devolverlo', /devuélvelo a la lista/.test(PL.validarNombrePlato('JUGO', platos) ?? ''));
  eq('⭐ renombrar el mismo plato para corregir una mayúscula SÍ se puede', PL.validarNombrePlato('bolsa de Hielo', platos, H), null);
  eq('un nombre nuevo de verdad pasa', PL.validarNombrePlato('Postre', platos), null);
}

// ── 4) «TODOS DEBEN TENER PRECIO»: CUÁLES FALTAN ─────────────────────────────
const precios = [
  { id: 'd', categoria: 'desayuno', precio: 4, desde: '2026-09-01' },
  { id: 'h', categoria: cat(H), precio: 2, desde: '2026-09-18' },
  { id: 'j', categoria: cat(J), precio: 3, desde: '2026-09-01' },
];
{
  const falta = PL.platosSinPrecio(platos, (c) => !!COBRO.precioComidaEn(precios, c, '2026-09-18'));
  eq('⭐ falta el refresco (el jugo tiene, y además está quitado de la lista)', falta.map((p) => p.name), ['Refresco']);
  const antes = PL.platosSinPrecio(platos, (c) => !!COBRO.precioComidaEn(precios, c, '2026-09-17'));
  eq('un precio que empieza mañana no cuenta hoy', antes.map((p) => p.name), ['Bolsa de hielo', 'Refresco']);
}

// ── 5) EL COBRO: PRECIO DEL PLATO, SI NO EL COSTO DE LA COCINA, SI NO NADA ───
const E = (dia, plato, n, costo, extra = {}) => ({
  company_id: 'C', company_name: 'CARBO', meal_type: 'otros', item_label: plato, meal_date: dia, delivered: n, unit_cost: costo, ...extra,
});
const entregas = [
  E('2026-09-17', 'Bolsa de hielo', 3, 1.5),   // el precio del plato empieza el 18: costo de la cocina
  E('2026-09-18', 'Bolsa de hielo', 4, 1.5),   // precio del plato: 2 (no 1,5)
  E('2026-09-18', 'BOLSA DE  HIELO', 1, 0),    // escrito distinto, sin costo: igual precio del plato
  E('2026-09-18', 'Refresco', 2, 1),           // sin precio propio: costo de la cocina
  E('2026-09-18', 'Refresco', 1, 0),           // sin nada: sin precio
  E('2026-09-18', 'Jugo', 2, 0),               // quitado de la lista, pero con precio: se cobra
  { company_id: 'C', company_name: 'CARBO', meal_type: 'desayuno', meal_date: '2026-09-18', delivered: 5, unit_cost: 99 },
];
const platoAPrecio = PL.resolverPlatos(platos);
{
  eq('precio del plato en su fecha', COBRO.precioDeEntrega(precios, 'otros', '2026-09-18', 1.5, cat(H)), { precio: 2, fuente: 'tabla', desde: '2026-09-18' });
  eq('antes de su precio: el costo de la cocina', COBRO.precioDeEntrega(precios, 'otros', '2026-09-17', 1.5, cat(H)), { precio: 1.5, fuente: 'cocina', desde: '' });
  eq('sin precio del plato ni costo: nada', COBRO.precioDeEntrega(precios, 'otros', '2026-09-18', 0, cat(R)), null);
  eq('⭐ a una comida fija no la toca la categoría del plato', COBRO.precioDeEntrega(precios, 'desayuno', '2026-09-18', 99, cat(H)), { precio: 4, fuente: 'tabla', desde: '2026-09-01' });
  const bl = [...precios, { id: 'hb', categoria: cat(H), precio: 5, desde: '2026-09-18', hasta: '2026-09-18' }];
  eq('un precio blindado del plato manda en su rango', COBRO.precioDeEntrega(bl, 'otros', '2026-09-18', 1.5, cat(H))?.precio, 5);

  const [c] = COBRO.calcularCobroComidas({ empresas: entregas, personas: [], empresaDePersona: new Map(), precios, platoAPrecio });
  // 3×1,5 + 5×2 + 2×1 + 2×3 + 5×4 = 4,5 + 10 + 2 + 6 + 20 = 42,5
  eq('⭐ el total junta los cuatro casos', c.monto, 42.5);
  eq('...y el único sin nada queda «sin precio»', c.sinPrecio, 1);
  const hielo = c.items.filter((i) => i.plato === 'Bolsa de hielo');
  eq('⭐ el hielo se parte en su precio (5 × 2) y el costo de la cocina de antes (3 × 1,5)',
    hielo.map((i) => [i.cantidad, i.precio, i.fuente]).sort(), [[3, 1.5, 'cocina'], [5, 2, 'tabla']]);
  const jugo = c.items.find((i) => i.plato === 'Jugo');
  eq('el jugo quitado de la lista se cobra con su precio', [jugo.cantidad, jugo.monto, jugo.fuente], [2, 6, 'tabla']);

  const [sin] = COBRO.calcularCobroComidas({ empresas: entregas, personas: [], empresaDePersona: new Map(), precios });
  eq('sin el catálogo, «Otros» cae al costo de la cocina (lo de antes)', sin.monto, 3 * 1.5 + 4 * 1.5 + 2 * 1 + 20);

  const cfg = COBRO.indexarConfigCuentas([{ tipo: 'empresa', clave: 'C', desde: '2026-09-01', se_cobra: false }]);
  const [int] = COBRO.calcularCobroComidas({ empresas: entregas, personas: [], empresaDePersona: new Map(), precios, platoAPrecio, config: cfg });
  eq('en consumo interno el plato se valora igual y no se cobra', [int.monto, int.montoInterno], [0, 42.5]);
}

// ── 6) LA TARJETA Y EL PDF DAN LO MISMO ──────────────────────────────────────
{
  const [c] = COBRO.calcularCobroComidas({ empresas: entregas, personas: [], empresaDePersona: new Map(), precios, platoAPrecio });
  const g = REP.agruparEmpresas(entregas, precios, platoAPrecio);
  const t = REP.totalesDeGrupos(g, []);
  eq('⭐ VALOR del papel = lo de la tarjeta', t.monto, c.monto + c.montoInterno);
  eq('⭐ «sin precio» igual en los dos', t.sinPrecio, c.sinPrecio);
  const lineas = REP.lineasDetalle({ empresas: entregas, personas: [] }, precios, platoAPrecio);
  eq('el renglón del papel cobra el precio del plato', lineas.find((l) => l.fecha === '2026-09-18' && l.plato === 'Bolsa de hielo').monto, 8);
  const g0 = REP.agruparEmpresas(entregas, precios);
  ok('sin el catálogo el papel daría otra cifra (por eso el PDF lo recibe)', REP.totalesDeGrupos(g0, []).monto !== t.monto);
}

// ── 7) LA BITÁCORA DICE EL NOMBRE DEL PLATO ──────────────────────────────────
{
  const filas = [
    { id: 1, at: '2026-09-18T15:00:00Z', user_name: 'Ana', action: 'INSERT', table_name: 'comida_precios', changes: { categoria: cat(H), precio: 2, desde: '2026-09-18' } },
    { id: 2, at: '2026-09-18T15:01:00Z', user_name: 'Ana', action: 'UPDATE', table_name: 'food_extra_items', changes: { name: { de: 'Bolsa de yelo', a: 'Bolsa de hielo' } } },
    { id: 3, at: '2026-09-18T15:02:00Z', user_name: 'Ana', action: 'UPDATE', table_name: 'food_extra_items', changes: { active: { de: true, a: false } } },
  ];
  const m = MOV.movimientosDeComida(filas, (c) => PL.nombreDeCategoria(platos, c));
  ok('⭐ «Precio de 🧾 Bolsa de hielo», no «plato_1111…»', m.find((x) => x.clave === '1').titulo.includes('🧾 Bolsa de hielo'));
  ok('sin catálogo dice «un plato», nunca el código', MOV.movimientosDeComida(filas).find((x) => x.clave === '1').titulo.includes('un plato'));
  eq('el cambio de nombre se lee', m.find((x) => x.clave === '2').detalle, 'nombre: Bolsa de yelo → Bolsa de hielo');
  eq('quitar de la lista se lee', m.find((x) => x.clave === '3').detalle, 'en la lista de la cocina: sí → no');
}

// ── 8) RENOMBRAR: LAS ENTREGAS QUE SE CORRIGEN ───────────────────────────────
{
  const filas = [
    { id: 'a', meal_type: 'otros', item_label: 'Bolsa de yelo' },
    { id: 'b', meal_type: 'otros', item_label: 'BOLSA DE  YELO ' },
    { id: 'c', meal_type: 'otros', item_label: 'Bolsa de yelo grande' },
    { id: 'd', meal_type: 'almuerzo', item_label: 'Bolsa de yelo' },
  ];
  eq('⭐ las del mismo nombre (escritas como sea), ni una más', PL.entregasDelPlato(filas, 'bolsa de yelo').map((r) => r.id), ['a', 'b']);
  eq('nombre vacío: ninguna', PL.entregasDelPlato(filas, '').length, 0);
}

// ── 9) DÓNDE VIVE Y CÓMO ESCRIBE ─────────────────────────────────────────────
{
  const db = sinComentarios(leer('src/lib/comidaPlatosDb.ts'));
  ok('⭐ nada se borra: ni un .delete( en los platos', !/\.delete\(/.test(db) && !/\.delete\(/.test(sinComentarios(leer('src/components/CobroComidasPlatos.tsx'))));
  eq('cada insert/update de la lista de platos pide filas de vuelta', (db.match(/from\('food_extra_items'\)\.(insert|update)\(/g) || []).length, (db.match(/from\('food_extra_items'\)\.(insert|update)\([^;]*\.select\(/g) || []).length);
  ok('...y las correcciones de entregas también', /\.update\(\{ item_label: nombre \}\)\s*\.in\('id', ids\.slice\(i, i \+ 200\)\)\s*\.select\('id'\)/.test(db));
  ok('⭐ renombrar corrige las entregas ANTES que la lista', db.indexOf('ponerNombreAEntregas(ids, limpio)') < db.indexOf(".update({ name: limpio })"));
  ok('...si no pudo con todas, las devuelve y no toca la lista', /r\.cambiadas\.length < ids\.length\)\s*\{\s*await devolver\(r\.cambiadas\)/.test(db));
  ok('...si la lista falla, las entregas vuelven a su nombre', /if \(error \|\| !data\?\.length\) \{\s*await devolver\(r\.cambiadas\)/.test(db));
  ok('⭐ las entregas se buscan sin ILIKE (el * y el _ del nombre serían comodines)', !/ilike/i.test(db) && /entregasDelPlato\(/.test(db));
  ok('crear no duplica: reusa el de ese nombre', /platoConNombre\(platos, limpio\)/.test(db));

  const ui = sinComentarios(leer('src/components/CobroComidasPlatos.tsx'));
  ok('⭐ crear exige precio ANTES de crear nada', ui.indexOf('validarPrecioComida(') > -1 && ui.indexOf('validarPrecioComida(') < ui.indexOf('crearOReusarPlato('));
  ok('el precio va a comida_precios con la categoría del plato', /crearPrecioComida\(\{\s*categoria: categoriaDePlato\(r\.plato\.id\)/.test(ui));
  ok('renombrar pide un segundo toque que explica lo de las entregas', /if \(!confirmarNombre\) \{ setConfirmarNombre\(true\); return; \}/.test(ui));
  ok('💲 Precio lleva a la pestaña de precios con el plato elegido', /onPonerPrecio\(categoriaDePlato\(p\.id\)\)/.test(ui));

  const precios2 = sinComentarios(leer('src/components/CobroComidasPrecios.tsx'));
  ok('«Precios y cuentas» tiene la pestaña 🧾 Platos', /setPestana\('platos'\)/.test(precios2) && /<CobroComidasPlatos[\s>]/.test(precios2));
  ok('...lee precios y platos juntos', /Promise\.all\(\[cargarPreciosComida\(\), cargarPlatos\(\)\]\)/.test(precios2));
  ok('...acepta precio para cualquier plato', /platos\.map\(\(p\) => categoriaDePlato\(p\.id\)\)/.test(precios2));
  ok('...y muestra los platos en «Precio vigente hoy»', /platosEnLista\.map\(\(pl\) => \{\s*const cat = categoriaDePlato\(pl\.id\);\s*const p = precioComidaEn\(precios, cat, hoy\)/.test(precios2));

  const tarjeta = sinComentarios(leer('src/components/CobroComidasResumen.tsx'));
  ok('⭐ la tarjeta calcula con el catálogo', /platoAPrecio: resolverPlatos\(platos\)/.test(tarjeta) && /cargarPlatos\(\)/.test(tarjeta));
  ok('...y sin el catálogo no muestra montos a medias', /!platos \|\| error\) return \[\]/.test(tarjeta));
  ok('...avisa los platos que se cobran con el costo de la cocina', /it\.fuente === 'cocina'/.test(tarjeta) && /sin precio propio se están cobrando/.test(tarjeta));

  const modal = sinComentarios(leer('src/components/ComidaReporteModal.tsx'));
  ok('⭐ el PDF usa el mismo catálogo', /agruparEmpresas\(e\.empresas, precios, platoAPrecio\)/.test(modal) && /lineasDetalle\(e, precios, platoAPrecio\)/.test(modal));

  const pantalla = sinComentarios(leer('src/screens/ComidaScreen.tsx'));
  ok('⭐ al abrir el reporte se vuelven a leer precios y platos', /const abrirReporte = \(\) => \{\s*cargarPrecios\(\);\s*cargarPlatosCatalogo\(\);/.test(pantalla) && /onPress=\{abrirReporte\}/.test(pantalla));
  ok('la pantalla pasa los platos al PDF, al editor y a la bitácora', /platos=\{platos\}\s*puedeVerMontos/.test(pantalla) && /<ComidaMovimientos desde=\{from\} hasta=\{to\} platos=\{platos\}/.test(pantalla) && /platos=\{platos\}\s*onCambio=/.test(pantalla));

  const editor = sinComentarios(leer('src/components/ComidaEditor.tsx'));
  ok('el editor ofrece los platos de la lista con un toque', /platosEnLista\.map\(\(p\) => pastilla\(/.test(editor));
  ok('...y un plato escrito a mano queda en la lista', /anotarPlatoNuevo\(v\.patch\.plato, platos\)/.test(editor) && /saveExtraItem\(nombre\)/.test(editor));
  // Regresión atrapada al escribirlo: un «const nota» dentro de guardar() tapaba el
  // campo nota del formulario y reventaba al validar (zona muerta de la variable).
  ok('⭐ guardar() no declara otra «nota» que tape la del formulario', !/const nota\s*=/.test(editor));

  ok('⭐ la cocina sigue pudiendo crear platos al registrar (decisión del cliente)', /saveExtraItem\(itemLabel\)/.test(leer('src/screens/FoodCompanyScreen.tsx')));
}

// ── 10) MANUALES ─────────────────────────────────────────────────────────────
{
  ok('manual (md) explica los platos', /🧾 Platos \(18\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) explica los platos', /🧾 PLATOS \(18\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-comida-platos · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
