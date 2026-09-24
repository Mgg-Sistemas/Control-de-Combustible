/*
 * Test de 🧰 SERVICIOS EN VENTAS · CLIENTE O PROVEEDOR + MÁQUINA (23-sep-2026).
 *
 * Pedido del cliente, textual:
 *   «en servicios en ventas, que se pueda escoger el cliente o proveedor, y que se
 *    coloque la maquina, si es una empresa interna se muestra la lista, si es
 *    externa se agrega la maquina sin que afecte el catalogo. y ademas, estas
 *    listas vuelvelas buscable»
 *
 * LO QUE BLINDA, Y POR QUÉ DUELE SI SE ROMPE:
 *   · ⭐ LA EMPRESA INTERNA SE ELIGE DESDE LA VENTA. Proponerle a alguien las
 *     máquinas de su empresa solo funciona si antes alguien dijo DE CUÁL empresa
 *     es. Ese enlace vivía únicamente en la ficha completa del contacto: al vender
 *     un servicio el desplegable salía vacío y para arreglarlo había que abandonar
 *     la venta a medias y volver a empezarla.
 *   · ⭐ ENLAZAR NO TOCA EL CATÁLOGO DE EQUIPOS. Se escribe en `contactos`, no en
 *     `machinery`: decir de quién es un contacto no le quita ni le pone una máquina
 *     a nadie.
 *   · SI ES EXTERNA, la máquina se carga a mano y va SOLO a `contacto_maquinas`.
 *   · LAS LISTAS SON BUSCABLES: la de contactos (con filtro cliente/proveedor), la
 *     de empresas (por nombre y RIF) y la de máquinas (por todas sus características).
 *   · LAS EMPRESAS CON MÁQUINAS VAN PRIMERO: quien enlaza para verle las máquinas a
 *     alguien no quiere buscar entre veinte empresas que no tienen ninguna.
 *
 * Valores inventados: no hay datos reales en el repositorio (es público).
 *
 *   node scripts/test-ventas-servicio-maquina.mjs
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

const M = loadTs('src/lib/contactoMaquinas.ts');
const C = loadTs('src/lib/contactos.ts');

// ── DATOS DE MENTIRA ────────────────────────────────────────────────────────
const EMPRESAS = [
  { id: 'e1', name: 'COSTA BRAVA', rif: 'J-401112223', hidden: false },
  { id: 'e2', name: 'ALBAMAR', rif: 'J-409998887', hidden: false },
  { id: 'e3', name: 'ZETA FINAL', rif: null, hidden: false },
  { id: 'e4', name: 'VIEJA OCULTA', rif: 'J-400000001', hidden: true },
];
const MACHINERY = [
  { id: 'm1', code: 'EX-012', description: 'Excavadora', marca: 'Caterpillar', modelo: '320D',
    serial: 'CAT320D001', plate: 'A12BC3D', encargado: 'Luis Rojas', company_id: 'e1', active: true },
  { id: 'm2', code: 'VQ-003', description: 'Volqueta', marca: 'Mack', serial: 'MACK003',
    plate: 'X99YZ1', encargado: 'Ana Perez', company_id: 'e1', active: true },
  { id: 'm3', code: 'RE-001', description: 'Retroexcavadora', marca: 'JCB', company_id: 'e2', active: true },
  { id: 'm4', code: 'RETIRADA', description: 'Fuera de servicio', company_id: 'e2', active: false },
  { id: 'm5', code: 'SIN-EMPRESA', description: 'Sin dueño', company_id: null, active: true },
  { id: 'm6', code: 'OCULTA-1', description: 'De la oculta', company_id: 'e4', active: true },
];

// ── 1) CUÁNTAS MÁQUINAS TIENE CADA EMPRESA ──────────────────────────────────
{
  const c = M.maquinasPorEmpresa(MACHINERY);
  eq('COSTA BRAVA tiene 2', c.e1, 2);
  // ⚠️ Una máquina RETIRADA no se le propone a nadie: proponerla es ofrecerle al
  //    cliente un equipo que ya no existe.
  eq('⭐ las retiradas no cuentan', c.e2, 1);
  eq('sin empresa no cuenta para nadie', c[''] ?? c['null'] ?? 0, 0);
  eq('una empresa sin máquinas ni aparece', c.e3, undefined);
  eq('nada no revienta', M.maquinasPorEmpresa(null), {});
}

// ── 2) LA EMPRESA SE BUSCA POR NOMBRE Y POR RIF ─────────────────────────────
{
  eq('busca por nombre', M.empresasConMaquinas(EMPRESAS, MACHINERY, 'costa').map((x) => x.empresa.id), ['e1']);
  eq('busca sin acentos ni mayúsculas', M.empresasConMaquinas(EMPRESAS, MACHINERY, 'ALBAMAR').map((x) => x.empresa.id), ['e2']);
  eq('busca por RIF', M.empresasConMaquinas(EMPRESAS, MACHINERY, '409998887').map((x) => x.empresa.id), ['e2']);
  eq('busca por un pedazo del RIF', M.empresasConMaquinas(EMPRESAS, MACHINERY, 'J-40111').map((x) => x.empresa.id), ['e1']);
  eq('lo que no está no sale', M.empresasConMaquinas(EMPRESAS, MACHINERY, 'zzz'), []);
  ok('el RIF vacío no rompe la búsqueda', M.empresaHaystack({ id: 'x', name: 'SOLA' }) === 'sola');
}

// ── 3) ORDEN: PRIMERO LAS QUE TIENEN MÁQUINAS ───────────────────────────────
{
  const todas = M.empresasConMaquinas(EMPRESAS, MACHINERY);
  eq('⭐ arriba la que más máquinas tiene', todas.map((x) => x.empresa.id), ['e1', 'e2', 'e3']);
  eq('...con su cuenta al lado', todas.map((x) => x.maquinas), [2, 1, 0]);
  // ⚠️ Una empresa OCULTA no sale: si no aparece en ningún otro selector, aparecer
  //    aquí solo sirve para enlazar un contacto a algo que ya nadie usa.
  ok('⭐ la empresa oculta no se ofrece', !todas.some((x) => x.empresa.id === 'e4'));
  // Una empresa sin máquinas IGUAL se puede enlazar: enlazarla no está prohibido.
  ok('la que no tiene máquinas igual se puede elegir', todas.some((x) => x.empresa.id === 'e3'));
  eq('sin empresas no revienta', M.empresasConMaquinas(null, MACHINERY), []);
  eq('sin catálogo de equipos tampoco', M.empresasConMaquinas(EMPRESAS, null).map((x) => x.maquinas), [0, 0, 0]);
}

// ── 4) LAS MÁQUINAS DE LA EMPRESA INTERNA ───────────────────────────────────
{
  const suyas = M.proponerMaquinas(MACHINERY, { companyId: 'e1' });
  eq('⭐ enlazada la empresa, salen SUS máquinas', suyas.map((m) => m.id), ['m1', 'm2']);
  // ⚠️ Sin enlazar NO sale la lista de una empresa: sale el catálogo completo para
  //    poder buscar por encargado. Lo que no puede pasar es mostrarle a un cliente
  //    las máquinas de otro como si fueran suyas.
  const sinEnlazar = M.proponerMaquinas(MACHINERY, { companyId: null, texto: 'luis rojas' });
  eq('sin empresa se busca por encargado en todo el catálogo', sinEnlazar.map((m) => m.id), ['m1']);
  eq('la de otra empresa no se cuela', M.proponerMaquinas(MACHINERY, { companyId: 'e2' }).map((m) => m.id), ['m3']);
}

// ── 5) SI ES EXTERNA, SE CARGA A MANO ───────────────────────────────────────
{
  // «si es externa se agrega la maquina sin que afecte el catalogo»: basta con un
  // dato que la identifique, y lo que sale es una fila de `contacto_maquinas`.
  eq('con solo la placa alcanza', M.validarMaquina({ placa: 'A12BC3D' }), null);
  eq('vacía no', typeof M.validarMaquina({}), 'string');
  const fila = M.filaMaquina({ codigo: 'part-1', descripcion: 'grúa de afuera' }, 'c1');
  eq('la externa queda marcada como cargada a mano', fila.origen, 'manual');
  eq('...sin apuntar a ninguna del catálogo de equipos', fila.machinery_id, null);
  eq('...y es del contacto', fila.contacto_id, 'c1');
  eq('se guarda en mayúsculas, como el catálogo', fila.descripcion, 'GRÚA DE AFUERA');
}

// ── 6) LA LISTA DE CONTACTOS: CLIENTE **O** PROVEEDOR, BUSCABLE ─────────────
{
  const CONTACTOS = [
    { id: 'c1', name: 'JUAN PEREZ', doc_letter: 'V', doc_number: '12345678', es_cliente: true, es_proveedor: false, active: true },
    { id: 'c2', name: 'FERRETERIA ALBAMAR', doc_letter: 'J', doc_number: '409998887', es_cliente: false, es_proveedor: true, active: true },
    { id: 'c3', name: 'COSTA BRAVA', doc_letter: 'J', doc_number: '401112223', es_cliente: true, es_proveedor: true, active: true },
    { id: 'c4', name: 'VIEJO INACTIVO', doc_letter: 'V', doc_number: '99999999', es_cliente: true, es_proveedor: false, active: false },
  ];
  eq('todos (sin los deshabilitados)', C.filtrarContactos(CONTACTOS, 'todos').map((c) => c.id), ['c1', 'c2', 'c3']);
  eq('solo clientes', C.filtrarContactos(CONTACTOS, 'clientes').map((c) => c.id), ['c1', 'c3']);
  eq('solo proveedores', C.filtrarContactos(CONTACTOS, 'proveedores').map((c) => c.id), ['c2', 'c3']);
  // ⭐ Al que se le vende Y se le compra sale en las DOS pastillas: es UN contacto
  //    con dos marcas, no dos fichas con la cuenta partida en dos.
  ok('⭐ el que es las dos cosas sale en las dos', C.filtrarContactos(CONTACTOS, 'clientes').some((c) => c.id === 'c3')
    && C.filtrarContactos(CONTACTOS, 'proveedores').some((c) => c.id === 'c3'));
  eq('se rotula como las dos cosas', C.rolesDe(CONTACTOS[2]), '👤 Cliente · 🏭 Proveedor');
  eq('la pastilla trae su cuenta', C.conteoContactos(CONTACTOS).proveedores, 2);
  // Buscar y filtrar se combinan: es lo que hace la pantalla.
  eq('busca dentro del rol elegido',
    C.buscarContactos(C.filtrarContactos(CONTACTOS, 'proveedores'), 'costa').map((c) => c.id), ['c3']);
  eq('un proveedor no aparece buscando entre clientes... si no lo es',
    C.buscarContactos(C.filtrarContactos(CONTACTOS, 'clientes'), 'albamar'), []);
}

// ── 7) LA PANTALLA · SELECTOR DE MÁQUINA ────────────────────────────────────
{
  const s = sinComentarios(leer('src/components/MaquinaPicker.tsx'));
  ok('tiene la lista buscable de empresas internas', /empresasConMaquinas\(companies, machinery, buscaEmp\)/.test(s));
  ok('muestra cuántas máquinas tiene cada empresa', /maquinasPorEmpresa/.test(s));
  // ⭐ LO QUE PIDIÓ EL CLIENTE: enlazar escribe en `contactos`, NUNCA en `machinery`.
  ok('⭐ enlazar escribe en contactos', /from\('contactos'\)\s*\.update\(\{ company_id: id \}\)/.test(s));
  ok('⭐ el catálogo de equipos NO se escribe desde aquí',
    !/from\('machinery'\)[\s\S]{0,40}\.(insert|update|delete|upsert)/.test(s));
  ok('solo se escribe en el catálogo propio del contacto', /from\('contacto_maquinas'\)\s*\.insert/.test(s));
  // ⚠️ Con RLS un «no tienes permiso» llega como 0 filas y SIN error: sin .select()
  //    la pantalla diría «listo» a algo que no se guardó.
  ok('el enlace se pide de vuelta para saber si de verdad se guardó', /update\(\{ company_id: id \}\)[\s\S]{0,120}\.select\(\)/.test(s));
  ok('...y avisa si faltó el permiso', /te falta permiso de escritura en Contactos/.test(s));
  ok('sigue estando «una máquina que no está»', /Registrar una máquina que no está/.test(s));
}

// ── 8) LA PANTALLA · VENTAS ─────────────────────────────────────────────────
{
  const s = sinComentarios(leer('src/screens/VentasScreen.tsx'));
  ok('el rótulo dice cliente O proveedor', /Cliente o proveedor/.test(s));
  ok('el buscador también', /Busca el cliente o proveedor/.test(s));
  // ⭐ El selector es UN SOLO componente, compartido con 🧰 Ventas de servicio: dos
  //    selectores parecidos se desincronizan —a uno le agregan las empresas y al
  //    otro no— y el mismo cliente termina escrito de dos maneras distintas.
  ok('⭐ usa el selector compartido', /<ContactoPicker/.test(s));
  ok('le pasa las empresas al selector de máquinas', /companies=\{empresas as any\}/.test(s));
  ok('...y relee los contactos al enlazar', /onEmpresaEnlazada=\{refetchClientes\}/.test(s));
  ok('la máquina sigue siendo solo de los renglones de servicio', /it\.kind === 'servicio' \?/.test(s));
  ok('⭐ desde ventas NO se escribe en el catálogo de equipos',
    !/from\('machinery'\)[\s\S]{0,40}\.(insert|update|delete|upsert)/.test(s));
}

// ── 9) LA PANTALLA · CONTACTOS ──────────────────────────────────────────────
{
  const s = sinComentarios(leer('src/screens/ContactosScreen.tsx'));
  ok('el módulo también puede enlazar la empresa', /onEmpresaEnlazada=\{refetch\}/.test(s));
  // ⚠️ El contacto guardado en el estado se queda VIEJO al enlazar: hay que leer la
  //    ficha viva o el selector seguiría diciendo «sin empresa» hasta cerrar.
  ok('⭐ usa la ficha viva, no la copia vieja del estado', /companyId=\{\(maqContacto as any\)\?\.company_id/.test(s));
}

// ── 10) EL PAPEL ────────────────────────────────────────────────────────────
{
  const s = leer('src/lib/ventaDocumento.ts');
  ok('la máquina sale impresa en la factura', /🚜 \$\{esc\(it\.maquina\)\}/.test(s));
  ok('...con serial y placa', /Serial \$\{esc\(it\.maquina_serial\)\}/.test(s) && /Placa \$\{esc\(it\.maquina_placa\)\}/.test(s));
}

// ── 11) MANUALES ────────────────────────────────────────────────────────────
{
  ok('manual (md) lo explica', /cliente o proveedor y su máquina \(23\/09\/2026\)/i.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) lo explica', /cliente o proveedor y su máquina \(23\/09\/2026\)/i.test(leer('src/screens/ManualScreen.tsx')));
  ok('manual (md) explica la pastilla de empresas', /Empresas del catálogo, con su encargado/i.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) explica la pastilla de empresas', /LAS EMPRESAS DEL CATÁLOGO, CON SU ENCARGADO, EN LA VENTA \(23\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
}

// ── 12) 🏢 LAS EMPRESAS DEL CATÁLOGO, CON SU ENCARGADO ──────────────────────
//
// «coloca la opcion en ventas, de colocar el nombre de las empresas que se tiene
//  en catalogo con su encargado».
{
  const CONTACTOS = [
    { id: 'k1', name: 'COSTA BRAVA', doc_letter: 'J', doc_number: '401112223', es_cliente: true, active: true, company_id: 'e1' },
    { id: 'k2', name: 'FERRETERIA ALBAMAR', doc_letter: 'J', doc_number: '409998887', es_cliente: false, es_proveedor: true, active: true, company_id: null },
    { id: 'k3', name: 'ZETA FINAL', doc_letter: null, doc_number: null, es_cliente: true, active: true, company_id: null },
  ];

  // EL ENCARGADO, que es lo que se pidió mostrar.
  eq('el encargado sale de sus máquinas', M.encargadosDeEmpresa(MACHINERY, 'e1'), ['ANA PEREZ', 'LUIS ROJAS']);
  eq('una empresa sin máquinas no tiene encargado', M.encargadosDeEmpresa(MACHINERY, 'e3'), []);
  // ⚠️ Una máquina RETIRADA no dice quién la atiende hoy.
  eq('⭐ la retirada no aporta encargado', M.encargadosDeEmpresa(MACHINERY, 'e2'), []);
  eq('sin empresa no hay encargado', M.encargadosDeEmpresa(MACHINERY, null), []);

  const lista = M.empresasParaVenta(EMPRESAS, MACHINERY, CONTACTOS);
  // ⚠️ A→Z: acá se busca un NOMBRE para facturarle. (El enlazador ordena por
  //    máquinas, que es otra pregunta: «¿cuál tiene equipos?».)
  eq('⭐ van A→Z', lista.map((x) => x.empresa.name), ['ALBAMAR', 'COSTA BRAVA', 'ZETA FINAL']);
  eq('cada una con su encargado', lista[1].encargados, ['ANA PEREZ', 'LUIS ROJAS']);
  eq('...y con cuántas máquinas tiene', lista[1].maquinas, 2);
  ok('dice cuál YA está registrada como contacto', lista[1].contacto && lista[1].contacto.id === 'k1');
  ok('...y cuál no', lista[0].contacto === null);
  ok('la oculta no se ofrece para facturarle', !lista.some((x) => x.empresa.id === 'e4'));

  // BUSCABLE por nombre, RIF **y encargado**.
  eq('busca por nombre', M.empresasParaVenta(EMPRESAS, MACHINERY, CONTACTOS, 'zeta').map((x) => x.empresa.id), ['e3']);
  eq('busca por RIF', M.empresasParaVenta(EMPRESAS, MACHINERY, CONTACTOS, '401112223').map((x) => x.empresa.id), ['e1']);
  eq('⭐ busca por ENCARGADO', M.empresasParaVenta(EMPRESAS, MACHINERY, CONTACTOS, 'luis rojas').map((x) => x.empresa.id), ['e1']);
  eq('el encargado de otra no la trae', M.empresasParaVenta(EMPRESAS, MACHINERY, CONTACTOS, 'nadie'), []);
  eq('sin empresas no revienta', M.empresasParaVenta(null, MACHINERY, CONTACTOS), []);

  // ⭐ RESOLVER A QUÉ CONTACTO CORRESPONDE. Crear uno cada vez sería la cuenta por
  //    cobrar de la misma empresa partida en dos fichas.
  const d1 = M.contactoParaEmpresa(EMPRESAS[0], CONTACTOS);
  eq('la que ya tiene contacto enlazado se usa', [d1.accion, d1.contacto.id], ['usar', 'k1']);
  const d2 = M.contactoParaEmpresa(EMPRESAS[1], CONTACTOS);
  eq('⭐ mismo RIF = el mismo, solo le faltaba el enlace', [d2.accion, d2.contacto.id, d2.motivo], ['enlazar', 'k2', 'rif']);
  const d3 = M.contactoParaEmpresa(EMPRESAS[2], CONTACTOS);
  eq('mismo nombre también', [d3.accion, d3.contacto.id, d3.motivo], ['enlazar', 'k3', 'nombre']);
  const d4 = M.contactoParaEmpresa({ id: 'e9', name: 'NUEVA SRL', rif: 'J-405556667' }, CONTACTOS);
  eq('la que no está se crea', d4.accion, 'crear');
  eq('...ya enlazada a la empresa', d4.fila.company_id, 'e9');
  eq('...como cliente', d4.fila.es_cliente, true);
  eq('...con su RIF partido bien', [d4.fila.doc_letter, d4.fila.doc_number], ['J', '405556667']);
  eq('...y su razón social', [d4.fila.name, d4.fila.razon_social], ['NUEVA SRL', 'NUEVA SRL']);
  eq('...sin nombre ni apellido, que es una empresa', [d4.fila.first_name, d4.fila.last_name], [null, null]);
  const dG = M.contactoParaEmpresa({ id: 'e8', name: 'ENTE PUBLICO', rif: 'G-200001112' }, CONTACTOS);
  eq('respeta el RIF de gobierno', dG.fila.doc_letter, 'G');
  const dSin = M.contactoParaEmpresa({ id: 'e7', name: 'SIN RIF CA', rif: null }, CONTACTOS);
  eq('sin RIF se crea igual, con el documento vacío', [dSin.accion, dSin.fila.doc_number], ['crear', null]);
  // ⚠️ Un contacto DESHABILITADO no se resucita solo: la pantalla avisa a quién habilitar.
  const dOff = M.contactoParaEmpresa(EMPRESAS[0], [{ ...CONTACTOS[0], active: false }]);
  eq('⭐ avisa si el contacto está deshabilitado', [dOff.accion, dOff.deshabilitado], ['usar', true]);
}

// ── 13) EL SELECTOR COMPARTIDO · LA PASTILLA DE EMPRESAS ────────────────────
{
  const s = sinComentarios(leer('src/components/ContactoPicker.tsx'));
  ok('tiene las pastillas para filtrar por rol', /setRol\(p\.key\)/.test(s) && /🏭 Proveedores/.test(s));
  ok('la lista se filtra por rol Y por texto', /buscarContactos\(filtrarContactos\(contactos, rol === 'empresas' \? 'todos' : rol\), q\)/.test(s));
  ok('tiene la pastilla de empresas del catálogo', /🏢 Empresas del catálogo/.test(s));
  ok('con su encargado en la línea', /x\.encargados\.slice\(0, 3\)\.join/.test(s));
  ok('la lista sale de la regla, no de la pantalla', /empresasParaVenta\(empresas as any, machinery as any, contactos as any, q\)/.test(s));
  ok('⭐ resuelve el contacto en vez de crear uno cada vez', /contactoParaEmpresa\(x\.empresa, contactos as any\)/.test(s));
  ok('avisa si el contacto está deshabilitado', /está deshabilitado\. Habilítalo en 📇 Contactos/.test(s));
  ok('el buscador dice que también busca por encargado', /Busca la empresa por nombre, RIF o encargado/.test(s));
  // ⚠️ Con RLS un «no tienes permiso» llega como 0 filas y SIN error.
  ok('pide la fila de vuelta al enlazar', /update\(\{ company_id: x\.empresa\.id, es_cliente: true \}\)[\s\S]{0,80}\.select\(\)/.test(s));
  ok('...y al crear', /insert\(\{ \.\.\.d\.fila, created_by[\s\S]{0,60}\.select\(\)/.test(s));
  ok('⭐ elegir una empresa NO escribe en el catálogo de empresas',
    !/from\('companies'\)[\s\S]{0,40}\.(insert|update|delete|upsert)/.test(s));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-ventas-servicio-maquina · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
