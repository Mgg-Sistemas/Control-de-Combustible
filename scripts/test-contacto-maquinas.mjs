/*
 * Test de 🚜 LAS MÁQUINAS DE UN CONTACTO — catálogo propio (23-sep-2026).
 *
 * Pedido del cliente, textual:
 *   «si el cliente, proveedor o empresa es una empresa ya registrada, que se muestre
 *    las maquinarias mediante un buscable desplegable, buscable por todas sus
 *    características. Mostrando todos los datos de la maquinaria, esto también
 *    aplícalo para servicios desde ventas. Que se busque un encargado o una empresa
 *    y me salga las máquinas registradas. También permite la opción de una máquina
 *    que no exista. Y se carguen los datos y se guarden en este catálogo sin que
 *    afecte el catálogo de maquinarias que se tiene, que sea independiente»
 *
 * LO QUE BLINDA, Y POR QUÉ DUELE SI SE ROMPE:
 *   · ⭐ INDEPENDIENTE DE VERDAD: aquí se COPIA, no se apunta. `machinery` se lee
 *     para proponer y NUNCA se escribe. Una máquina que hoy es de una empresa
 *     mañana se le alquila a otra o se retira; si la venta apuntara a la ficha
 *     viva, un papel firmado el mes pasado cambiaría solo porque alguien corrigió
 *     el catálogo.
 *   · SE BUSCA POR TODO: código, descripción, tipo, marca, modelo, serial, placa,
 *     encargado, zona… incluido buscar por ENCARGADO, que es lo que se pidió.
 *   · UNA MÁQUINA QUE NO EXISTE se puede cargar pidiendo MUY POCO. Una pantalla que
 *     exige diez campos termina con diez campos llenos de «X», que es peor que
 *     tenerlos vacíos porque la «X» no se nota.
 *   · LA MISMA MÁQUINA NO SE PROPONE DOS VECES al mismo contacto.
 *
 * Valores inventados: no hay datos reales en el repositorio (es público).
 *
 *   node scripts/test-contacto-maquinas.mjs
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

// ── DATOS DE MENTIRA (del catálogo de equipos) ──────────────────────────────
const MACHINERY = [
  { id: 'm1', code: 'EX-012', description: 'Excavadora', machinery_type: 'EXCAVADORA', tipo: 'EXCAVADORA',
    marca: 'Caterpillar', modelo: '320D', serial: 'CAT320D001', plate: 'A12BC3D', identifier: 'ID-1',
    referencia: 'REF-1', encargado: 'Luis Rojas', zona: 'ESTE', sector: 'MAIQUETIA', location: 'Patio 1',
    last_horometro: 1234.5, price_per_hour: 45, company_id: 'e1', active: true },
  { id: 'm2', code: 'VQ-003', description: 'Volqueta', tipo: 'VOLTEO', marca: 'Mack', modelo: 'Granite',
    serial: 'MACK003', plate: 'X99YZ1', encargado: 'Ana Pérez', zona: 'OESTE',
    company_id: 'e1', active: true },
  { id: 'm3', code: 'RT-007', description: 'Retroexcavadora', marca: 'JCB', encargado: 'Luis Rojas',
    company_id: 'e2', active: true },
  { id: 'm4', code: 'VIEJA-1', description: 'Retirada', company_id: 'e1', active: false },
];

// ── 1) ⭐ COPIAR, NO APUNTAR ────────────────────────────────────────────────
{
  const c = M.desdeMachinery(MACHINERY[0], 'c1');
  eq('se copia el código', c.codigo, 'EX-012');
  eq('la descripción', c.descripcion, 'EXCAVADORA');
  eq('la marca y el modelo', [c.marca, c.modelo], ['CATERPILLAR', '320D']);
  eq('el serial y la placa', [c.serial, c.placa], ['CAT320D001', 'A12BC3D']);
  eq('el encargado', c.encargado, 'LUIS ROJAS');
  eq('la zona, el sector y la ubicación', [c.zona, c.sector, c.ubicacion], ['ESTE', 'MAIQUETIA', 'PATIO 1']);
  eq('el horómetro y el precio, como números', [c.horometro, c.precio_hora], [1234.5, 45]);
  eq('queda a nombre del contacto', c.contacto_id, 'c1');
  // ⭐ Se guarda de DÓNDE salió, pero los datos ya son suyos: si allá la retiran o
  //    le cambian el encargado, esta copia no se mueve.
  eq('⭐ se anota de cuál máquina se copió', c.machinery_id, 'm1');
  eq('...y que vino del catálogo', c.origen, 'catalogo');

  // `tipo` y `machinery_type` conviven en el catálogo de equipos.
  eq('el tipo sale del campo que tenga algo', M.desdeMachinery(MACHINERY[1]).tipo, 'VOLTEO');
  eq('...y si solo está machinery_type, ese',
    M.desdeMachinery({ id: 'x', machinery_type: 'GRUA' }).tipo, 'GRUA');
  // Lo que no está queda en null, no en cadena vacía ni en «undefined».
  eq('lo que falta queda en null', M.desdeMachinery({ id: 'x' }).marca, null);
  eq('copiar de null no revienta', M.desdeMachinery(null).machinery_id, null);
  eq('un horómetro vacío no se vuelve 0', M.desdeMachinery({ id: 'x', last_horometro: '' }).horometro, null);
}

// ── 2) UNA MÁQUINA QUE NO EXISTE ────────────────────────────────────────────
{
  // ⭐ Basta con UNA cosa que la identifique: era el pedido «permite la opción de
  //    una máquina que no exista», no «llena doce campos».
  eq('con solo el código pasa', M.validarMaquina({ codigo: 'X-1' }), null);
  eq('con solo la descripción también', M.validarMaquina({ descripcion: 'EXCAVADORA' }), null);
  eq('con solo el serial', M.validarMaquina({ serial: 'ABC123' }), null);
  eq('con solo la placa', M.validarMaquina({ placa: 'A12BC3D' }), null);
  ok('⭐ pero vacía no pasa', /al menos el código/.test(M.validarMaquina({}) ?? ''));
  ok('...ni con puros espacios', /al menos el código/.test(M.validarMaquina({ codigo: '   ' }) ?? ''));
  ok('un horómetro que no es número no pasa', /horómetro/.test(M.validarMaquina({ codigo: 'X', horometro: 'abc' }) ?? ''));
  ok('un precio que no es número tampoco', /precio/.test(M.validarMaquina({ codigo: 'X', precio_hora: 'abc' }) ?? ''));
  eq('un horómetro vacío sí pasa (es opcional)', M.validarMaquina({ codigo: 'X', horometro: '' }), null);

  const f = M.filaMaquina({ codigo: ' ex-99 ', descripcion: 'pala', horometro: '1.234,5', precio_hora: '45,50' }, 'c1');
  eq('se guarda en mayúsculas y sin espacios de más', [f.codigo, f.descripcion], ['EX-99', 'PALA']);
  // La coma decimal de acá: «45,50» tiene que entrar como 45.5.
  eq('la coma decimal entra bien', f.precio_hora, 45.5);
  eq('⭐ sin machinery_id, el origen es «manual»', f.origen, 'manual');
  eq('queda a nombre del contacto', f.contacto_id, 'c1');
}

// ── 3) ⭐ BUSCAR POR TODAS LAS CARACTERÍSTICAS ──────────────────────────────
{
  const PROPIAS = [
    M.filaMaquina(M.desdeMachinery(MACHINERY[0], 'c1'), 'c1'),
    M.filaMaquina(M.desdeMachinery(MACHINERY[1], 'c1'), 'c1'),
    { ...M.filaMaquina({ codigo: 'OTRA-1', descripcion: 'GRUA' }, 'c1'), active: false },
  ];
  eq('por código', M.buscarMaquinas(PROPIAS, 'EX-012').map((m) => m.codigo), ['EX-012']);
  eq('por descripción', M.buscarMaquinas(PROPIAS, 'volqueta').map((m) => m.codigo), ['VQ-003']);
  eq('por marca', M.buscarMaquinas(PROPIAS, 'caterpillar').map((m) => m.codigo), ['EX-012']);
  eq('por modelo', M.buscarMaquinas(PROPIAS, '320d').map((m) => m.codigo), ['EX-012']);
  eq('por serial', M.buscarMaquinas(PROPIAS, 'MACK003').map((m) => m.codigo), ['VQ-003']);
  eq('por placa', M.buscarMaquinas(PROPIAS, 'a12bc3d').map((m) => m.codigo), ['EX-012']);
  // ⭐ «que se busque un encargado […] y me salga las máquinas registradas»
  eq('⭐ por ENCARGADO', M.buscarMaquinas(PROPIAS, 'luis rojas').map((m) => m.codigo), ['EX-012']);
  eq('por zona', M.buscarMaquinas(PROPIAS, 'oeste').map((m) => m.codigo), ['VQ-003']);
  eq('sin acentos ni mayúsculas', M.buscarMaquinas(PROPIAS, 'PÉREZ').map((m) => m.codigo), ['VQ-003']);
  // Una máquina quitada de la lista no se ofrece para una venta nueva.
  eq('⭐ las desactivadas no salen', M.buscarMaquinas(PROPIAS, '').map((m) => m.codigo), ['EX-012', 'VQ-003']);
  eq('buscar en null no revienta', M.buscarMaquinas(null, 'x'), []);
}

// ── 4) QUÉ SE LE PROPONE A UN CONTACTO ──────────────────────────────────────
{
  // Si es una empresa registrada, las suyas.
  eq('las de su empresa', M.proponerMaquinas(MACHINERY, { companyId: 'e1' }).map((m) => m.id), ['m1', 'm2']);
  eq('las de la otra empresa', M.proponerMaquinas(MACHINERY, { companyId: 'e2' }).map((m) => m.id), ['m3']);
  // ⭐ Sin empresa enlazada se busca en TODO: así se encuentra la máquina de un
  //    encargado aunque no se sepa de qué empresa es.
  eq('⭐ sin empresa, busca en todo el catálogo por encargado',
    M.proponerMaquinas(MACHINERY, { texto: 'luis rojas' }).map((m) => m.id), ['m1', 'm3']);
  eq('empresa Y texto se cruzan',
    M.proponerMaquinas(MACHINERY, { companyId: 'e1', texto: 'luis' }).map((m) => m.id), ['m1']);
  // ⭐ Proponer otra vez una ya copiada es invitar a tenerla dos veces en la venta.
  eq('⭐ las ya copiadas NO se vuelven a proponer',
    M.proponerMaquinas(MACHINERY, { companyId: 'e1', yaCopiadas: ['m1'] }).map((m) => m.id), ['m2']);
  eq('una máquina retirada no se propone', M.proponerMaquinas(MACHINERY, { companyId: 'e1' }).some((m) => m.id === 'm4'), false);
  eq('proponer de null no revienta', M.proponerMaquinas(null, {}), []);
  eq('los encargados que existen, A→Z', M.encargadosDe(MACHINERY), ['ANA PÉREZ', 'LUIS ROJAS']);
}

// ── 5) CÓMO SE MUESTRA Y CÓMO SE IMPRIME ────────────────────────────────────
{
  const m = M.desdeMachinery(MACHINERY[0], 'c1');
  eq('la etiqueta de una línea', M.etiquetaMaquina(m), 'EX-012 · EXCAVADORA CATERPILLAR 320D');
  eq('sin código, se usa lo que identifique', M.etiquetaMaquina({ placa: 'A12BC3D', descripcion: 'PALA' }), 'A12BC3D · PALA');
  eq('sin nada, no queda en blanco', M.etiquetaMaquina({}), 'Máquina sin identificar');
  eq('de null tampoco', M.etiquetaMaquina(null), 'Máquina sin identificar');

  // «Mostrando todos los datos de la maquinaria».
  const datos = M.datosMaquina(m);
  ok('⭐ muestra todos los datos que tiene', datos.length >= 13, String(datos.length));
  ok('...con su rótulo en criollo', datos.some((d) => d.rotulo === 'Encargado' && d.valor === 'LUIS ROJAS'));
  ok('...y el precio con su signo', datos.some((d) => d.rotulo === 'Precio por hora' && d.valor === '$45'));
  // ⚠️ Una ficha con ocho «—» no deja ver los tres datos que sí están.
  eq('⭐ lo vacío NO se muestra', M.datosMaquina({ codigo: 'X-1' }).map((d) => d.rotulo), ['Código']);
  eq('de null no revienta', M.datosMaquina(null), []);

  // Lo que viaja al renglón de la venta: el nombre CONGELADO.
  const r = M.maquinaDeRenglon({ ...m, id: 'cm1' });
  eq('⭐ el renglón guarda el nombre ya armado, no solo el id', r?.maquina, 'EX-012 · EXCAVADORA CATERPILLAR 320D');
  eq('...con su serial y su placa', [r?.maquina_serial, r?.maquina_placa], ['CAT320D001', 'A12BC3D']);
  eq('sin máquina, null', M.maquinaDeRenglon(null), null);
}

// ── 6) LA PANTALLA Y EL DESPLEGABLE ─────────────────────────────────────────
{
  const pick = sinComentarios(leer('src/components/MaquinaPicker.tsx'));
  ok('busca por todas las características', /buscarMaquinas\(maquinas, q\)/.test(pick));
  ok('propone las del catálogo de equipos', /proponerMaquinas\(machinery/.test(pick));
  ok('⭐ deja registrar una que no existe', /Registrar una máquina que no está/.test(pick));
  ok('muestra TODOS los datos', /datosMaquina\(m\)/.test(pick) && /Ver todos los datos/.test(pick));
  ok('propone los encargados para buscar por ellos', /encargadosDe\(machinery\)/.test(pick));
  // ⭐ LO MÁS IMPORTANTE: escribe en su catálogo, NUNCA en el de equipos.
  ok('⭐ escribe SOLO en el catálogo propio', /from\('contacto_maquinas'\)/.test(pick));
  ok('⭐ y NUNCA en el catálogo de equipos', !/from\('machinery'\)/.test(pick));
  ok('...y lo dice en pantalla', /No se agrega al catálogo de equipos/.test(pick));
  // ⚠️ Con RLS, un «no tienes permiso» llega como 0 filas y SIN error.
  ok('pide la fila de vuelta al guardar', /\.select\(\)\.single\(\)/.test(pick));
  ok('avisa si falta el SQL', /contacto_maquinas\.sql/.test(pick));

  const ventas = sinComentarios(leer('src/screens/VentasScreen.tsx'));
  ok('⭐ la venta pregunta a cuál máquina, en los SERVICIOS', /it\.kind === 'servicio' \?/.test(ventas) && /¿A cuál máquina\?/.test(ventas));
  ok('...y solo después de elegir el cliente', /las máquinas son suyas/.test(ventas));
  ok('la máquina se puede quitar del renglón', /maquina_id: null, maquina: null/.test(ventas));
  ok('usa el mismo desplegable', /<MaquinaPicker/.test(ventas));

  const cont = sinComentarios(leer('src/screens/ContactosScreen.tsx'));
  ok('desde el módulo se administran las máquinas de un contacto', /<MaquinaPicker/.test(cont));

  const form = sinComentarios(leer('src/components/ContactoForm.tsx'));
  ok('⭐ se puede enlazar el contacto con una empresa registrada', /company_id: companyId/.test(form));
  ok('...y es opcional', /déjalo vacío si no es ninguna/.test(form));

  const doc = sinComentarios(leer('src/lib/ventaDocumento.ts'));
  ok('⭐ la máquina sale en el papel', /it\.maquina \?/.test(doc) && /🚜/.test(doc));

  const lib = sinComentarios(leer('src/lib/ventas.ts'));
  ok('el renglón de la venta lleva la máquina congelada', /maquina_serial\?: string \| null;/.test(lib));
}

// ── 7) EL SQL ───────────────────────────────────────────────────────────────
{
  const sql = leer('supabase/contacto_maquinas.sql');
  ok('crea el catálogo propio', /create table if not exists public\.contacto_maquinas/.test(sql));
  ok('el contacto puede apuntar a una empresa registrada', /add column if not exists company_id uuid/.test(sql));
  // ⭐ Si borran la máquina del catálogo de equipos, la copia se queda COMPLETA.
  ok('⭐ la copia sobrevive a que borren el original', /machinery_id uuid references public\.machinery\(id\) on delete set null/.test(sql));
  ok('la misma máquina no se copia dos veces al mismo contacto', /contacto_maquinas_uk/.test(sql));
  // ⭐ LO QUE PIDIÓ EL CLIENTE: que no afecte el catálogo de maquinarias.
  ok('⭐ NO escribe en el catálogo de equipos', !/insert into public\.machinery/i.test(sql) && !/update public\.machinery/i.test(sql));
  ok('...ni lo borra', !/drop table[^\n]*machinery/i.test(sql) && !/delete from public\.machinery/i.test(sql));
  ok('trae su verificación', /✅/.test(sql) && /este script NO lo toca/.test(sql));
  ok('enlaza por nombre exacto, sin adivinar', /upper\(btrim\(c\.name\)\) = upper\(btrim\(e\.name\)\)/.test(sql));
}

// ── 8) MANUALES ─────────────────────────────────────────────────────────────
{
  ok('manual (md) lo explica', /máquinas de un contacto \(23\/09\/2026\)/i.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) lo explica', /máquinas de un contacto \(23\/09\/2026\)/i.test(leer('src/screens/ManualScreen.tsx')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-contacto-maquinas · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
