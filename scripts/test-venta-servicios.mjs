/*
 * Test de 🧰 VENTAS DE SERVICIO — la venta atada a una MÁQUINA, con su histórico.
 *
 * Pedido del cliente, textual:
 *   «vuelve esto como ventas, pero sera ventas de servicios, con todo el formato
 *    pero servicio, atado a una maquina, con su historico, con todo»
 *   «cada servicio nuevo se volvera una lista desplegable buscable»
 *
 * LO QUE BLINDA, Y POR QUÉ DUELE SI SE ROMPE:
 *   · ⭐ SE GUARDA EN `sales`, LA MISMA TABLA. Una segunda tabla de ventas sería un
 *     segundo correlativo (dos FAC-0001 el mismo mes), una segunda cuenta por
 *     cobrar del mismo cliente y dos totales que nunca cuadran entre sí.
 *   · ⭐ UNA VENTA MIXTA NO CUENTA ACÁ. Si tiene material, su plata ya se cuenta en
 *     💰 Ventas; contarla otra vez sería facturado inflado en un tablero y no en el
 *     otro.
 *   · LA MÁQUINA ES OBLIGATORIA: un renglón sin máquina no aparece en el histórico
 *     de ninguna, y un servicio que no dice a cuál máquina fue es lo que después no
 *     se puede cobrar ni reclamar.
 *   · EL HISTÓRICO CUADRA: lo de cada máquina suma lo mismo que el total.
 *   · UN RENGLÓN VIEJO SIN `maquina_id` NO SE PIERDE: se agrupa por el nombre.
 *
 * Valores inventados: no hay datos reales en el repositorio (es público).
 *
 *   node scripts/test-venta-servicios.mjs
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
const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond, extra) => eq(name + (extra ? ` [${extra}]` : ''), !!cond, true);

const S = loadTs('src/lib/ventaServicios.ts');

// ── DATOS DE MENTIRA ────────────────────────────────────────────────────────
const srv = (name, qty, price, maq) => ({
  kind: 'servicio', service_id: 's1', name, unit: 'SERV', qty, price,
  maquina_id: maq?.id ?? null, maquina: maq?.nombre ?? null,
  maquina_serial: maq?.serial ?? null, maquina_placa: maq?.placa ?? null,
});
const EX = { id: 'q1', nombre: 'EX-012 · EXCAVADORA CAT 320', serial: 'CAT320D001', placa: 'A12BC3D' };
const VQ = { id: 'q2', nombre: 'VQ-003 · VOLQUETA MACK', serial: 'MACK003', placa: null };

const VENTAS = [
  { id: 'v1', code: 'VTA-0001', doc_kind: 'factura', doc_number: 'FAC-0001', client_id: 'c1',
    client_name: 'COSTA BRAVA', sale_date: '2026-09-10', condicion: 'contado', total: 300, total_bs: 0,
    items: [srv('TRASLADO', 1, 100, EX), srv('MANTENIMIENTO', 1, 200, VQ)] },
  { id: 'v2', code: 'VTA-0002', doc_kind: 'nota_entrega', doc_number: 'NE-0001', client_id: 'c2',
    client_name: 'ALBAMAR', sale_date: '2026-09-15', condicion: 'credito', total: 50, total_bs: 0,
    items: [srv('TRASLADO', 2, 25, EX)] },
  // ⚠️ MIXTA: lleva material. No es una venta de servicio.
  { id: 'v3', code: 'VTA-0003', doc_kind: 'factura', doc_number: 'FAC-0002', client_id: 'c1',
    client_name: 'COSTA BRAVA', sale_date: '2026-09-20', condicion: 'contado', total: 999, total_bs: 0,
    items: [{ kind: 'material', name: 'CEMENTO', qty: 1, price: 9 }, srv('TRASLADO', 1, 990, EX)] },
  // Sin renglones: no es nada.
  { id: 'v4', code: 'VTA-0004', doc_kind: 'factura', doc_number: 'FAC-0003', client_id: 'c1',
    client_name: 'COSTA BRAVA', sale_date: '2026-09-21', condicion: 'contado', total: 0, items: [] },
];

// ── 1) QUÉ ES UNA VENTA DE SERVICIO ─────────────────────────────────────────
{
  eq('la de puros servicios sí', S.esVentaDeServicio(VENTAS[0]), true);
  // ⭐ LA REGLA QUE CUIDA LA PLATA: una venta mixta ya se cuenta en 💰 Ventas.
  eq('⭐ la mixta NO', S.esVentaDeServicio(VENTAS[2]), false);
  eq('la vacía tampoco', S.esVentaDeServicio(VENTAS[3]), false);
  eq('nada no revienta', S.esVentaDeServicio(null), false);
  eq('las que entran al módulo', S.ventasDeServicio(VENTAS).map((v) => v.id), ['v1', 'v2']);
  eq('los renglones de servicio de la mixta se leen igual',
    S.renglonesDeServicio(VENTAS[2]).map((it) => it.name), ['TRASLADO']);
}

// ── 2) LA MÁQUINA ES OBLIGATORIA ────────────────────────────────────────────
{
  eq('sin cliente no se guarda', S.validarVentaServicio({ clientId: '', items: [srv('X', 1, 1, EX)] }),
    'Elige a quién se le factura (cliente o proveedor).');
  eq('sin renglones tampoco', S.validarVentaServicio({ clientId: 'c1', items: [] }),
    'Agrega al menos un servicio.');
  // ⭐ LO QUE SE PIDIÓ: «atado a una maquina».
  eq('⭐ sin máquina NO se guarda',
    S.validarVentaServicio({ clientId: 'c1', items: [srv('TRASLADO', 1, 10, null)] }),
    'Falta la máquina del renglón 1: cada servicio va atado a una máquina.');
  eq('...y dice CUÁL renglón',
    S.validarVentaServicio({ clientId: 'c1', items: [srv('A', 1, 10, EX), srv('B', 1, 10, null)] }),
    'Falta la máquina del renglón 2: cada servicio va atado a una máquina.');
  eq('cantidad en cero no',
    S.validarVentaServicio({ clientId: 'c1', items: [srv('A', 0, 10, EX)] }),
    'La cantidad del renglón 1 tiene que ser mayor que cero.');
  eq('un servicio sin nombre no',
    S.validarVentaServicio({ clientId: 'c1', items: [srv('  ', 1, 10, EX)] }),
    'El renglón 1 no tiene servicio.');
  // ⚠️ Acá NO se vende material: para eso está 💰 Ventas, que descuenta inventario.
  eq('⭐ el material se rebota',
    S.validarVentaServicio({ clientId: 'c1', items: [{ kind: 'material', name: 'CEMENTO', qty: 1, price: 1 }] }),
    'Acá solo se venden servicios. El material se vende en 💰 Ventas.');
  eq('completa sí pasa', S.validarVentaServicio({ clientId: 'c1', items: [srv('A', 1, 10, EX)] }), null);
  // Un precio en 0 es legal: hay servicios de cortesía y se facturan igual.
  eq('precio cero es válido', S.validarVentaServicio({ clientId: 'c1', items: [srv('A', 1, 0, EX)] }), null);
}

// ── 3) EL RENGLÓN NUEVO ─────────────────────────────────────────────────────
{
  const r = S.renglonServicio({ id: 's9', name: 'TRASLADO', price: 120 });
  eq('nace como servicio', [r.kind, r.unit, r.qty], ['servicio', 'SERV', 1]);
  eq('con el precio del catálogo', r.price, 120);
  eq('...y sin máquina todavía', [r.maquina_id, r.maquina], [null, null]);
  eq('sin precio arranca en cero', S.renglonServicio({ id: 's9', name: 'X' }).price, 0);
  eq('un precio basura no se cuela', S.renglonServicio({ id: 's9', name: 'X', price: 'abc' }).price, 0);
  eq('nunca apunta al inventario', S.renglonServicio({ id: 's9', name: 'X' }).item_id, null);
}

// ── 4) EL HISTÓRICO POR MÁQUINA ─────────────────────────────────────────────
{
  const g = S.porMaquina(VENTAS);
  // ⚠️ A→Z por el nombre de la máquina: así se busca una en una lista.
  eq('⭐ A→Z', g.map((x) => x.maquina), ['EX-012 · EXCAVADORA CAT 320', 'VQ-003 · VOLQUETA MACK']);
  eq('la excavadora tiene 2 renglones', g[0].renglones, 2);
  eq('...en 2 ventas', g[0].ventas, 2);
  eq('...por 150', g[0].usd, 150);
  eq('...y su último servicio', g[0].ultima, '2026-09-15');
  eq('con su serial y su placa', [g[0].serial, g[0].placa], ['CAT320D001', 'A12BC3D']);
  eq('la volqueta va sola', [g[1].renglones, g[1].usd], [1, 200]);
  // ⭐ LO QUE TIENE QUE CUADRAR: la suma por máquina = el total del módulo.
  const suma = g.reduce((a, x) => a + x.usd, 0);
  eq('⭐ lo de cada máquina suma el total', suma, S.totalesServicio(VENTAS).usd);
  eq('la mixta no aporta al histórico', g.every((x) => x.usd !== 990), true);
}

// ── 5) UN RENGLÓN VIEJO, SIN `maquina_id` ───────────────────────────────────
{
  // ⚠️ Los renglones viejos —y los de una máquina cargada a mano— solo tienen el
  //    NOMBRE congelado. Dejarlos fuera sería perder ventas ya hechas.
  const viejo = { kind: 'servicio', name: 'TRASLADO', qty: 1, price: 40, maquina: 'EX-999 · VIEJA' };
  eq('se agrupa por el nombre', S.claveMaquina(viejo), 'ex-999 · vieja');
  eq('el id manda cuando está', S.claveMaquina(srv('X', 1, 1, EX)), 'q1');
  eq('sin nada, clave vacía', S.claveMaquina({ kind: 'servicio', name: 'X', qty: 1, price: 1 }), '');
  const g = S.porMaquina([{ id: 'v9', sale_date: '2026-01-01', condicion: 'contado', total: 40, items: [viejo] }]);
  eq('⭐ el renglón viejo NO se pierde', [g.length, g[0].maquina, g[0].usd], [1, 'EX-999 · VIEJA', 40]);
}

// ── 6) POR TIPO DE SERVICIO ─────────────────────────────────────────────────
{
  const t = S.porTipoDeServicio(VENTAS);
  // Acá manda la plata: la pregunta es «¿qué servicio deja más?».
  eq('⭐ de mayor a menor', t.map((x) => x.nombre), ['MANTENIMIENTO', 'TRASLADO']);
  eq('con lo suyo', t.map((x) => x.usd), [200, 150]);
  eq('TRASLADO se hizo 2 veces', t[1].renglones, 2);
  eq('...y la última vez fue', t[1].ultima, '2026-09-15');
}

// ── 7) LOS FILTROS ──────────────────────────────────────────────────────────
{
  const f = (o) => S.filtrarVentasServicio(VENTAS, o).map((v) => v.id);
  eq('sin filtro, las de servicio', f({}), ['v1', 'v2']);
  eq('por fecha', f({ desde: '2026-09-12' }), ['v2']);
  eq('hasta', f({ hasta: '2026-09-12' }), ['v1']);
  // ⚠️ Quien escribe las fechas no tiene por qué acordarse de cuál va primero.
  eq('las fechas al revés se ordenan solas', f({ desde: '2026-09-16', hasta: '2026-09-09' }), ['v1', 'v2']);
  eq('por cliente', f({ clientId: 'c2' }), ['v2']);
  eq('por condición', f({ condicion: 'credito' }), ['v2']);
  // ⭐ EL FILTRO DEL HISTÓRICO: solo lo de ESTA máquina.
  eq('⭐ por máquina', f({ maquina: 'q2' }), ['v1']);
  eq('la excavadora sale en las dos', f({ maquina: 'q1' }), ['v1', 'v2']);
  // Se busca por TODO, incluida la máquina, el serial y la placa.
  eq('busca por el nombre del servicio', f({ texto: 'mantenimiento' }), ['v1']);
  eq('⭐ busca por la MÁQUINA', f({ texto: 'volqueta' }), ['v1']);
  eq('busca por serial', f({ texto: 'MACK003' }), ['v1']);
  eq('busca por placa', f({ texto: 'a12bc3d' }), ['v1', 'v2']);
  eq('busca por cliente', f({ texto: 'albamar' }), ['v2']);
  eq('busca por documento', f({ texto: 'FAC-0001' }), ['v1']);
  eq('lo que no está no sale', f({ texto: 'zzz' }), []);
}

// ── 8) LOS TOTALES ──────────────────────────────────────────────────────────
{
  const t = S.totalesServicio(VENTAS);
  eq('2 ventas de servicio', t.ventas, 2);
  eq('3 renglones', t.renglones, 3);
  eq('2 máquinas', t.maquinas, 2);
  eq('350 facturados', t.usd, 350);
  eq('50 a crédito', t.credito, 50);
  eq('300 de contado', t.contado, 300);
  // ⭐ La mixta (999) no entra: ya se cuenta en 💰 Ventas.
  ok('⭐ la mixta no infla el total', t.usd === 350);
  eq('sin nada no revienta', S.totalesServicio(null).usd, 0);
}

// ── 9) RENGLÓN POR RENGLÓN ──────────────────────────────────────────────────
{
  const l = S.lineasDeServicio(VENTAS);
  eq('son 3 renglones', l.length, 3);
  // Lo último arriba: el histórico se lee empezando por lo que acaba de pasar.
  eq('⭐ lo más nuevo arriba', l[0].fecha, '2026-09-15');
  eq('cada uno con su total ya hecho', l[0].total, 50);
  eq('...y con la venta de la que salió', l[0].venta.doc_number, 'NE-0001');
}

// ── 10) LA PANTALLA ─────────────────────────────────────────────────────────
{
  const s = sinComentarios(leer('src/components/VentaServiciosTab.tsx'));
  // ⭐ UNA SOLA CONTABILIDAD: se escribe en `sales`, no en una tabla nueva.
  ok('⭐ guarda en `sales`, la misma tabla', /from\('sales'\)\s*\.insert\(payload\)/.test(s));
  ok('⭐ no inventa una tabla de ventas de servicio', !/from\('venta_servicios'\)|from\('sales_service_sales'\)/.test(s));
  // ⚠️ Con RLS un «no tienes permiso» llega como 0 filas y SIN error.
  ok('pide la fila de vuelta al guardar', /insert\(payload\)\.select\(\)\.single\(\)/.test(s));
  ok('...y avisa si faltó el permiso', /te falta permiso de escritura en Ventas/.test(s));
  ok('la regla la decide el lib, no la pantalla', /validarVentaServicio\(\{ clientId, items, condicion \}\)/.test(s));
  ok('trae todo el formato de una venta', /DOC_KINDS/.test(s) && /METODOS_PAGO/.test(s) && /IVA_PCT/.test(s));
  ok('...con su equivalente en Bs congelado', /rate_bs: rate \|\| 0/.test(s) && /total_bs: totalBs/.test(s));
  ok('...y su papel imprimible', /ventaDocumentoHtml/.test(s));
  ok('la máquina del renglón se elige con el selector de siempre', /<MaquinaPicker/.test(s));
  ok('el cliente con el selector compartido', /<ContactoPicker/.test(s));
  ok('dice que la máquina es obligatoria', /¿A cuál máquina\? \(obligatorio\)/.test(s));
  ok('tiene el histórico por máquina', /porMaquina\(filtradas\)/.test(s));
  ok('...y por tipo de servicio', /porTipoDeServicio\(filtradas\)/.test(s));
  ok('se puede ver el histórico de UNA máquina', /setMaqFiltro\(g\)/.test(s));
  // ⭐ «cada servicio nuevo se volverá una lista desplegable buscable»
  ok('⭐ el servicio se elige de una lista buscable', /buscarServicios\(servicios, qSrv\)/.test(s));
  ok('⭐ el que se acaba de crear queda en esa lista', /addServicio\(data as SalesService\)/.test(s));
  ok('el catálogo de tipos también es buscable', /buscarServicios\(servicios, q\)/.test(s));
  ok('⭐ NO escribe en el catálogo de equipos',
    !/from\('machinery'\)[\s\S]{0,40}\.(insert|update|delete|upsert)/.test(s));
}

// ── 11) ENGANCHADA EN VENTAS ────────────────────────────────────────────────
{
  const s = sinComentarios(leer('src/screens/VentasScreen.tsx'));
  ok('la pestaña se llama Ventas de servicio', /label: 'Ventas de servicio'/.test(s));
  ok('...y es la nueva', /<VentaServiciosTab canWrite=\{canWrite\} \/>/.test(s));
  ok('la vieja pestaña de catálogo ya no está duplicada', !/function ServiciosVentaTab/.test(s));
}

// ── 12) MANUALES ────────────────────────────────────────────────────────────
{
  ok('manual (md) lo explica', /ventas de servicio \(24\/09\/2026\)/i.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) lo explica', /VENTAS DE SERVICIO \(24\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-venta-servicios · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
