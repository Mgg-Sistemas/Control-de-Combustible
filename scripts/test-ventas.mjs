/*
 * Test del MÓDULO DE VENTAS (`src/lib/ventas.ts`) — 22-sep-2026.
 *
 * QUÉ PEDIDO CUBRE (textual del cliente):
 *   «Los materiales salen del inventario con el precio referencial, pero el usuario
 *    podrá modificarlos, indicará el método de pago... Tendrá su equivalente, si de $
 *    a bs y viceversa... se manejará una factura y una nota de entrega que lleva
 *    PRECIO... ventas a crédito, estas generan una cuenta por cobrar... un catálogo de
 *    clientes o proveedores, amarrado a la CEDULA O RIF. No se puede ingresar una
 *    cedula 2 veces como registro nuevo... se generará un historial (que será filtrable
 *    por fechas y por todas las características posibles)»
 *
 * LO QUE BLINDA:
 *   · La CUENTA: renglón = cantidad × precio redondeado UNA vez; el IVA es opcional
 *     por venta (apagado = el precio es el total) y nunca se calcula "por si acaso".
 *   · La CONVERSIÓN $ ↔ Bs, incluida la tasa 0 (dividir entre 0 no es "gratis").
 *   · La CÉDULA/RIF: "V-12.345.678" y "V12345678" son LA MISMA persona, así que el
 *     duplicado se detecta aunque se escriba con puntos, guiones o espacios. Al
 *     EDITAR, el propio registro no se denuncia a sí mismo.
 *   · El HISTORIAL: rango de fechas inclusivo, tolerante a fechas al revés, y
 *     búsqueda por TODAS las características (cliente, documento, método, renglones).
 *
 * No usa framework (el repo no tiene): transpila el .ts en memoria con el
 * `typescript` ya instalado.
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
  m.require = (id) => (id.startsWith('.') ? loadTs(path.join(path.dirname(srcPath), `${id}.ts`)) : origRequire(id));
  m._compile(out, m.filename);
  cache.set(srcPath, m.exports);
  return m.exports;
};

const V = loadTs(path.join(ROOT, 'src/lib/ventas.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    got : ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ── 1) La cuenta: renglones, subtotal, IVA opcional ─────────────────────────
eq('renglon: cantidad × precio', V.lineaTotal({ qty: 3, price: 2.5 }), 7.5);
eq('renglon: redondea a 2 decimales', V.lineaTotal({ qty: 3, price: 0.335 }), 1.01);
eq('renglon: basura = 0', V.lineaTotal({ qty: null, price: 'x' }), 0);
eq('renglon: cantidad decimal (kg, litros)', V.lineaTotal({ qty: 2.5, price: 4 }), 10);

const ITEMS = [
  { kind: 'material', item_id: 'i1', name: 'Filtro', unit: 'UND', qty: 2, price: 12.5 },
  { kind: 'material', item_id: 'i2', name: 'Aceite', unit: 'LT', qty: 4, price: 6.25 },
  { kind: 'servicio', service_id: 's1', name: 'Cambio de aceite', qty: 1, price: 30 },
];
eq('subtotal suma los renglones', V.subtotalDe(ITEMS), 80);
eq('subtotal de lista vacia', V.subtotalDe([]), 0);
eq('subtotal de null no revienta', V.subtotalDe(null), 0);

// ⭐ El IVA es OPCIONAL por venta (decision del cliente, 22-sep-2026).
eq('SIN IVA: el precio es el total', V.ivaDe(80, false), 0);
eq('CON IVA 16%', V.ivaDe(80, true), 12.8);
eq('CON IVA a otro %', V.ivaDe(80, true, 8), 6.4);
eq('cuenta sin IVA', V.cuentaDe(ITEMS, false), { subtotal: 80, iva: 0, total: 80 });
eq('cuenta con IVA', V.cuentaDe(ITEMS, true), { subtotal: 80, iva: 12.8, total: 92.8 });
eq('⭐ el IVA no se cuela cuando esta apagado', V.cuentaDe(ITEMS, false).total, V.subtotalDe(ITEMS));

// Centavos: tres renglones que redondean hacia arriba no se pierden.
const CENT = [
  { kind: 'material', name: 'a', qty: 1, price: 0.005 },
  { kind: 'material', name: 'b', qty: 1, price: 0.005 },
  { kind: 'material', name: 'c', qty: 1, price: 0.005 },
];
eq('⭐ centavos: cada renglon redondea una vez', V.subtotalDe(CENT), 0.03);

// ── 2) Conversión $ ↔ Bs ────────────────────────────────────────────────────
eq('$ a Bs', V.bsDeUsd(80, 36.5), 2920);
eq('Bs a $', V.usdDeBs(2920, 36.5), 80);
eq('⭐ sin tasa, Bs a $ da 0 (no Infinity)', V.usdDeBs(2920, 0), 0);
eq('sin tasa, $ a Bs da 0', V.bsDeUsd(80, 0), 0);
eq('ida y vuelta conserva el monto', V.usdDeBs(V.bsDeUsd(123.45, 36.5), 36.5), 123.45);

// ── 3) Cédula / RIF ─────────────────────────────────────────────────────────
eq('digitos: quita puntos, guiones y espacios', V.docDigitos('V-12.345.678'), '12345678');
eq('canonico', V.docCanonico('v', '12.345.678'), 'V-12345678');
ok('J y G son RIF', V.esRif('J') && V.esRif('G'));
ok('V, E y P son cedula', !V.esRif('V') && !V.esRif('E') && !V.esRif('P'));
eq('rotulo del documento', [V.docTipoLabel('V'), V.docTipoLabel('J')], ['Cédula', 'RIF']);
ok('documento valido', V.docValido('V', '12345678'));
ok('letra invalida no pasa', !V.docValido('X', '12345678'));
ok('muy corto no pasa', !V.docValido('V', '123'));

const CLIENTES = [
  { id: 'c1', name: 'Ferretería El Tornillo', doc_letter: 'J', doc_number: '409876543', phone: '0212-5551234', email: 'ventas@tornillo.com', address: 'Maiquetía' },
  { id: 'c2', name: 'Pedro Pérez', doc_letter: 'V', doc_number: '12345678', phone: '0414-1112233', email: null, address: 'Caraballeda' },
];
// ⭐ EL PUNTO DEL PEDIDO: la misma cédula escrita distinto ES la misma.
ok('⭐ duplicado aunque se escriba con puntos', !!V.docDuplicado(CLIENTES, 'V', '12.345.678'));
ok('⭐ duplicado aunque se escriba con guion', !!V.docDuplicado(CLIENTES, 'V', 'V-12345678'));
ok('⭐ duplicado de RIF', !!V.docDuplicado(CLIENTES, 'J', '40.987.654-3'));
ok('otra letra con los mismos digitos NO es duplicado', !V.docDuplicado(CLIENTES, 'E', '12345678'));
ok('documento nuevo no es duplicado', !V.docDuplicado(CLIENTES, 'V', '99999999'));
ok('⭐ al EDITAR, el propio registro no se denuncia', !V.docDuplicado(CLIENTES, 'V', '12345678', 'c2'));
ok('al editar, OTRO con ese documento si se denuncia', !!V.docDuplicado(CLIENTES, 'V', '12345678', 'c1'));
eq('duplicado devuelve a QUIEN choca', V.docDuplicado(CLIENTES, 'V', '12345678')?.name, 'Pedro Pérez');

// Buscador de clientes por TODAS las características.
eq('buscar por nombre', V.buscarClientes(CLIENTES, 'tornillo').map((c) => c.id), ['c1']);
eq('buscar por documento con guion', V.buscarClientes(CLIENTES, 'V-12345678').map((c) => c.id), ['c2']);
eq('buscar por telefono', V.buscarClientes(CLIENTES, '0414').map((c) => c.id), ['c2']);
eq('buscar por correo', V.buscarClientes(CLIENTES, 'ventas@').map((c) => c.id), ['c1']);
eq('buscar por direccion', V.buscarClientes(CLIENTES, 'caraballeda').map((c) => c.id), ['c2']);
eq('buscar sin acentos ni mayusculas', V.buscarClientes(CLIENTES, 'PEREZ').map((c) => c.id), ['c2']);
eq('sin texto: salen todos', V.buscarClientes(CLIENTES, '').length, 2);

// ── 4) Catálogo de servicios buscable ───────────────────────────────────────
const SERVICIOS = [
  { id: 's1', name: 'Cambio de aceite', description: 'Maquinaria pesada', price: 30 },
  { id: 's2', name: 'Soldadura', description: 'Estructura metálica', price: 55 },
];
eq('servicio por nombre', V.buscarServicios(SERVICIOS, 'soldadura').map((s) => s.id), ['s2']);
eq('servicio por descripcion', V.buscarServicios(SERVICIOS, 'pesada').map((s) => s.id), ['s1']);
eq('servicio por precio', V.buscarServicios(SERVICIOS, '55').map((s) => s.id), ['s2']);

// ── 5) Historial: fechas y todas las características ────────────────────────
const venta = (o) => ({
  doc_kind: 'factura', condicion: 'contado', payment_method: 'zelle',
  client_name: 'Pedro Pérez', client_doc: 'V-12345678', sale_date: '2026-09-10',
  total: 100, total_bs: 3650, items: [], ...o,
});
const VENTAS = [
  venta({ id: 'v1', code: 'VTA-0001', doc_number: 'FAC-0001', sale_date: '2026-09-01', client_id: 'c2', total: 100 }),
  venta({ id: 'v2', code: 'VTA-0002', doc_number: 'NE-0001', doc_kind: 'nota_entrega', sale_date: '2026-09-10', client_id: 'c1', client_name: 'Ferretería El Tornillo', client_doc: 'J-409876543', condicion: 'credito', payment_method: null, total: 250 }),
  venta({ id: 'v3', code: 'VTA-0003', doc_number: 'FAC-0002', sale_date: '2026-09-20', client_id: 'c2', payment_method: 'pago_movil', total: 50, items: [{ kind: 'material', name: 'Filtro de aire', qty: 1, price: 50 }] }),
];

eq('sin filtro salen todas', V.filtrarVentas(VENTAS, {}).length, 3);
eq('desde', V.filtrarVentas(VENTAS, { desde: '2026-09-10' }).map((v) => v.id), ['v2', 'v3']);
eq('hasta', V.filtrarVentas(VENTAS, { hasta: '2026-09-10' }).map((v) => v.id), ['v1', 'v2']);
eq('⭐ el rango incluye los dos extremos', V.filtrarVentas(VENTAS, { desde: '2026-09-01', hasta: '2026-09-20' }).length, 3);
eq('⭐ fechas al reves se ordenan solas', V.filtrarVentas(VENTAS, { desde: '2026-09-20', hasta: '2026-09-01' }).length, 3);
eq('por tipo de documento', V.filtrarVentas(VENTAS, { docKind: 'nota_entrega' }).map((v) => v.id), ['v2']);
eq('por condicion (credito)', V.filtrarVentas(VENTAS, { condicion: 'credito' }).map((v) => v.id), ['v2']);
eq('por metodo de pago', V.filtrarVentas(VENTAS, { metodo: 'pago_movil' }).map((v) => v.id), ['v3']);
eq('por cliente', V.filtrarVentas(VENTAS, { clientId: 'c2' }).map((v) => v.id), ['v1', 'v3']);
eq('"todas"/"todos" no filtran', V.filtrarVentas(VENTAS, { docKind: 'todas', condicion: 'todas', metodo: 'todos' }).length, 3);

// Búsqueda libre por TODAS las características.
eq('texto: por numero de documento', V.filtrarVentas(VENTAS, { texto: 'FAC-0002' }).map((v) => v.id), ['v3']);
eq('texto: por codigo', V.filtrarVentas(VENTAS, { texto: 'VTA-0001' }).map((v) => v.id), ['v1']);
eq('texto: por cliente', V.filtrarVentas(VENTAS, { texto: 'tornillo' }).map((v) => v.id), ['v2']);
eq('texto: por documento del cliente', V.filtrarVentas(VENTAS, { texto: 'J-409876543' }).map((v) => v.id), ['v2']);
eq('⭐ texto: por el RENGLON vendido', V.filtrarVentas(VENTAS, { texto: 'filtro de aire' }).map((v) => v.id), ['v3']);
eq('texto: por metodo de pago en criollo', V.filtrarVentas(VENTAS, { texto: 'pago movil' }).map((v) => v.id), ['v3']);
eq('texto y fecha se combinan', V.filtrarVentas(VENTAS, { texto: 'perez', desde: '2026-09-15' }).map((v) => v.id), ['v3']);

// Totales y agrupación por cliente.
eq('totales', V.totalesVentas(VENTAS), { ventas: 3, usd: 400, bs: 10950, credito: 250, contado: 150 });
eq('totales de lista vacia', V.totalesVentas([]), { ventas: 0, usd: 0, bs: 0, credito: 0, contado: 0 });
const PC = V.porCliente(VENTAS);
eq('agrupa por cliente, el que mas compro primero', PC.map((g) => g.name), ['Ferretería El Tornillo', 'Pedro Pérez']);
eq('suma lo vendido a cada cliente', PC.map((g) => g.usd), [250, 150]);
eq('marca cuanto de eso es credito', PC.map((g) => g.credito), [250, 0]);

// ── 7) Basura ───────────────────────────────────────────────────────────────
eq('filtrar null no revienta', V.filtrarVentas(null, { texto: 'x' }), []);
eq('buscar clientes en null no revienta', V.buscarClientes(null, 'x'), []);
eq('porCliente de null no revienta', V.porCliente(null), []);
eq('cuenta de items nulos', V.cuentaDe(null, true), { subtotal: 0, iva: 0, total: 0 });

// ── Resultado ───────────────────────────────────────────────────────────────
console.log('\nVENTAS — cuenta, documento, cédula/RIF e historial\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-ventas · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
