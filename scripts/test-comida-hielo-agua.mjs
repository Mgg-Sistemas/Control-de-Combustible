/*
 * Test de HIELO Y AGUA EN «OTROS» (23-sep-2026).
 *
 * Pedido del cliente, textual:
 *
 *   «en el módulo de distribución de comidas, necesito que ahora el segmento que se
 *    llama OTROS, sea HIELO, AGUA, y coloca un + para agregar otras opciones. Esto
 *    llevará un costo que colocará el usuario, en la factura se debe reflejar como
 *    AGUA, Hielo. Desde el módulo en pc como en el TLF»
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · ⭐ EN LA FACTURA EL RENGLÓN SE LLAMA POR SU OPCIÓN (AGUA, HIELO), no «Otros».
 *     Es literalmente lo que pidió el cliente: se le cobra agua, no «otros».
 *   · el cuadro «Cantidad por comida» abre «Otros» en una fila por opción, Y ESAS
 *     FILAS SUMAN EL MISMO TOTAL. Un cuadro desglosado que no cuadra con su propio
 *     total es peor que uno sin desglosar: el que lo revisa deja de creerle.
 *   · si el papel sale SIN detalle, NO se desglosa: se deja la fila «Otros» de
 *     siempre en vez de inventar un desglose a medias.
 *   · una entrega de «Otros» sin nombre (las viejas) sigue diciendo «Otros»: mejor
 *     eso que un renglón en blanco al que nadie le puede reclamar nada.
 *   · el ➕ crea una OPCIÓN de la lista, nunca una entrega: si escribir registrara
 *     entregas, volverían «yelo» y «hielo» con dos precios en la misma factura.
 *   · una entrega de «Otros» no se puede guardar sin decir qué fue.
 *   · el SQL siembra HIELO y AGUA sin duplicar ni borrar nada.
 *
 * Valores inventados: no hay precios reales en el repositorio (es público).
 *
 *   node scripts/test-comida-hielo-agua.mjs
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

const PL = loadTs('src/lib/comidaPlatos.ts');
const REP = loadTs('src/lib/comidaReporte.ts');
const HTML = loadTs('src/lib/comidaReporteHtml.ts');
const OPC = loadTs('src/lib/comidaReporteOpciones.ts');

// ── 1) CÓMO SE LLAMA UN RENGLÓN ─────────────────────────────────────────────
{
  eq('un «Otros» se llama por su opción', PL.nombreDeOpcion('otros', 'HIELO'), 'HIELO');
  eq('se le quitan los espacios de más', PL.nombreDeOpcion('otros', '  AGUA  '), 'AGUA');
  eq('y los de en medio', PL.nombreDeOpcion('otros', 'Bolsa   de   hielo'), 'Bolsa de hielo');
  // ⭐ El nombre se RESPETA tal cual: el cliente pidió «AGUA, Hielo» y así sale.
  eq('⭐ no se le cambian las mayúsculas', PL.nombreDeOpcion('otros', 'Hielo'), 'Hielo');
  eq('un «Otros» sin nombre no tiene nombre propio', PL.nombreDeOpcion('otros', ''), null);
  eq('...ni con espacios en blanco', PL.nombreDeOpcion('otros', '   '), null);
  eq('...ni con null', PL.nombreDeOpcion('otros', null), null);
  eq('«OTROS» en mayúsculas es lo mismo', PL.nombreDeOpcion('OTROS', 'AGUA'), 'AGUA');
  eq('...y con espacios alrededor también', PL.nombreDeOpcion(' otros ', 'AGUA'), 'AGUA');
  // ⭐ Un almuerzo NUNCA se llama por un plato, aunque la fila traiga uno pegado:
  //    pasó de verdad con filas de empresa a las que les quedó el item_label viejo.
  eq('⭐ un almuerzo no se llama por un plato', PL.nombreDeOpcion('almuerzo', 'HIELO'), null);
  eq('ni un desayuno', PL.nombreDeOpcion('desayuno', 'AGUA'), null);
  eq('una comida vacía tampoco', PL.nombreDeOpcion('', 'AGUA'), null);
  eq('ni null', PL.nombreDeOpcion(null, 'AGUA'), null);
  eq('las dos opciones base son HIELO y AGUA', [...PL.OPCIONES_BASE], ['HIELO', 'AGUA']);
  eq('la comida en la base se sigue llamando «otros»', PL.COMIDA_OTROS, 'otros');
  ok('la librería de platos sigue sin importar nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/comidaPlatos.ts'))));
}

// ── DATOS DE MENTIRA ────────────────────────────────────────────────────────
const entregasEmpresa = [
  { id: 'a1', company_id: 'e1', company_name: 'EMPRESA UNO', meal_type: 'almuerzo', meal_date: '2026-09-22', delivered: 20, unit_cost: 0, delivered_at: '2026-09-22T16:00:00Z', created_by_name: 'Cocina 1', note: '' },
  { id: 'a2', company_id: 'e1', company_name: 'EMPRESA UNO', meal_type: 'otros', item_label: 'HIELO', meal_date: '2026-09-22', delivered: 6, unit_cost: 1, delivered_at: '2026-09-22T17:00:00Z', created_by_name: 'Cocina 1', note: '' },
  { id: 'a3', company_id: 'e1', company_name: 'EMPRESA UNO', meal_type: 'otros', item_label: 'AGUA', meal_date: '2026-09-22', delivered: 4, unit_cost: 2, delivered_at: '2026-09-22T17:05:00Z', created_by_name: 'Cocina 1', note: '' },
  // La misma opción otro día: tiene que SUMARSE, no abrir una segunda fila.
  { id: 'a4', company_id: 'e2', company_name: 'EMPRESA DOS', meal_type: 'otros', item_label: 'HIELO', meal_date: '2026-09-23', delivered: 3, unit_cost: 1, delivered_at: '2026-09-23T17:00:00Z', created_by_name: 'Cocina 2', note: '' },
  // Una vieja, de antes de que hubiera lista: sin nombre.
  { id: 'a5', company_id: 'e2', company_name: 'EMPRESA DOS', meal_type: 'otros', item_label: null, meal_date: '2026-09-23', delivered: 2, unit_cost: 1, delivered_at: '2026-09-23T18:00:00Z', created_by_name: 'Cocina 2', note: '' },
];
const entregasPersona = [
  { id: 'p1', contacto_id: 'c1', employee_name: 'Contacto Uno', cedula: '111', meal_type: 'otros', item_label: 'AGUA', distribution_date: '2026-09-22', meals: 5, delivered_at: '2026-09-22T12:00:00Z', created_by_name: 'Cocina 1', note: '' },
];
const precios = [{ id: 'pr1', categoria: 'almuerzo', precio: 2, desde: '2026-09-01', hasta: null }];
const TODO = { ...REP.FILTRO_COMIDA_TODO, desde: '2026-09-22', hasta: '2026-09-23' };
const todas = { empresas: entregasEmpresa, personas: entregasPersona };

const armar = (opciones, lineas) => {
  const e = REP.filtrarComidas(todas, TODO);
  const gE = REP.agruparEmpresas(e.empresas, precios);
  const gP = REP.agruparPersonas(e.personas, precios);
  return HTML.cuerpoReporteComida({
    filtro: TODO, opciones,
    comidas: [{ key: 'desayuno', label: 'Desayuno' }, { key: 'almuerzo', label: 'Almuerzo' }, { key: 'lunch', label: 'Lunch' }, { key: 'cena', label: 'Cena' }, { key: 'otros', label: 'Otros' }],
    gruposEmpresas: gE, gruposPersonas: gP, cedulas: REP.cedulasPorClave(e.personas),
    lineas: lineas === undefined ? REP.lineasDetalle(e, precios) : lineas,
    totales: REP.totalesDeGrupos(gE, gP), nombres: {},
  });
};

// ── 2) EL CUADRO POR COMIDA DICE AGUA Y HIELO ───────────────────────────────
{
  const papel = armar(OPC.OPCIONES_COMIDA_COMPLETO);
  const cuadro = papel.slice(papel.indexOf('Cantidad por comida'), papel.indexOf('Entregas por empresa'));
  ok('⭐ el cuadro por comida nombra HIELO', cuadro.includes('>HIELO<'));
  ok('⭐ ...y AGUA', cuadro.includes('>AGUA<'));
  ok('⭐ y ya NO dice «Otros» a secas', !/>Otros</.test(cuadro));
  ok('una entrega vieja sin nombre se nombra igual, avisando', cuadro.includes('>Otros (sin nombre)<'));
  // HIELO = 6 + 3 = 9 (dos empresas, dos días). AGUA = 4 + 5 (la del contacto).
  ok('⭐ la misma opción de días distintos se SUMA en una sola fila', />HIELO<\/td><td[^>]*>9</.test(cuadro), cuadro);
  ok('⭐ el agua del contacto entra en la misma fila que la de la empresa', />AGUA<\/td><td[^>]*>9</.test(cuadro), cuadro);
  ok('la vieja sin nombre lleva su cantidad', />Otros \(sin nombre\)<\/td><td[^>]*>2</.test(cuadro), cuadro);
  // ⭐ 20 almuerzos + 9 hielo + 9 agua + 2 sin nombre = 40.
  ok('⭐ el TOTAL del cuadro sigue cuadrando', cuadro.includes('<b>40</b>'), cuadro);
  ok('las comidas fijas no se tocan', />Almuerzo<\/td><td[^>]*>20</.test(cuadro));
}

// ── 3) SIN DETALLE NO SE INVENTA UN DESGLOSE ────────────────────────────────
//
// El papel «como antes» sale sin el listado entrega por entrega, y es de ahí de
// donde salen los nombres. Sin él, la fila vuelve a ser «Otros» con su total: un
// desglose que no suma su propio total es peor que uno menos detallado.
{
  const papel = armar({ ...OPC.OPCIONES_COMIDA_COMPLETO, sinDetalle: true }, []);
  const cuadro = papel.slice(papel.indexOf('Cantidad por comida'), papel.indexOf('Entregas por empresa'));
  ok('⭐ sin detalle, la fila vuelve a ser «Otros»', cuadro.includes('>Otros<'), cuadro);
  ok('...con TODO lo de Otros junto (9 + 9 + 2 = 20)', />Otros<\/td><td[^>]*>20</.test(cuadro), cuadro);
  ok('...y el total sigue en 40', cuadro.includes('<b>40</b>'));
  ok('...sin nombrar ninguna opción', !cuadro.includes('HIELO') && !cuadro.includes('AGUA'));
}

// ── 4) EL DETALLE NOMBRA LA ENTREGA POR SU OPCIÓN ───────────────────────────
{
  const papel = armar(OPC.OPCIONES_COMIDA_COMPLETO);
  const detalle = papel.slice(papel.indexOf('Entrega por entrega'));
  ok('⭐ el renglón dice «HIELO»', detalle.includes('>HIELO<'));
  ok('⭐ y NO «Otros · HIELO»', !detalle.includes('Otros · HIELO') && !detalle.includes('Otros · AGUA'));
  ok('la entrega vieja sin nombre sigue diciendo «Otros»', detalle.includes('>Otros<'));
  ok('el almuerzo se sigue llamando almuerzo', detalle.includes('>Almuerzo<'));
}

// ── 5) LA TARJETA Y EL PDF DEL COBRO (LA FACTURA) ───────────────────────────
{
  const res = sinComentarios(leer('src/components/CobroComidasResumen.tsx'));
  ok('⭐ el renglón de la factura se llama por su opción', /const opcion = nombreDeOpcion\(it\.categoria, it\.plato\);/.test(res));
  ok('⭐ ...y solo cae en «Otros» si la entrega no trae nombre', /return opcion \? `\$\{OTROS_MEAL\.icon\} \$\{opcion\}` : etiqueta\(it\.categoria\);/.test(res));
  // La MISMA función arma la tarjeta y el PDF: dos maneras de nombrar la misma
  // entrega es como se termina discutiendo una factura.
  ok('⭐ la tarjeta y el PDF usan la misma etiqueta', (res.match(/etiquetaItem\(it\)/g) ?? []).length >= 2, res.match(/etiquetaItem\(it\)/g)?.length);
}

// ── 6) EL ➕ AGREGA OPCIONES, NO ENTREGAS ───────────────────────────────────
{
  // TELÉFONO · por empresa (QR de la empresa).
  const emp = sinComentarios(leer('src/screens/FoodCompanyScreen.tsx'));
  ok('TLF empresa: hay un ➕ para agregar otra opción', /➕ Otra opción/.test(emp));
  ok('TLF empresa: el campo de texto sale SOLO con el ➕', /\{nuevaOpcion \? \(/.test(emp));
  ok('TLF empresa: elegir una opción cierra el ➕', /setItemLabel\(name\);\s*setNuevaOpcion\(false\);/.test(emp));
  // ⭐ Un «Otros» sin nombre es un renglón de factura que no dice qué fue.
  ok('⭐ TLF empresa: no se guarda un «Otros» sin decir qué fue',
    /if \(mealFor === 'otros' && !itemLabel\.trim\(\)\) \{/.test(emp));
  ok('TLF empresa: la opción escrita queda en la lista', /saveExtraItem\(itemLabel\)/.test(emp));

  // TELÉFONO · cocina (carnet / contacto). El resto de sus guards vive en
  // test-comida-contactos.mjs, que es donde nació «Otros» para contactos.
  const coc = sinComentarios(leer('src/screens/CocinaScreen.tsx'));
  ok('TLF cocina: hay un ➕ para agregar otra opción', /➕ Agregar otra opción/.test(coc));
  ok('⭐ TLF cocina: el ➕ escribe en el CATÁLOGO, no una entrega', /crearOReusarPlato\(nombreOpcion, platos\)/.test(coc));
  ok('TLF cocina: la opción nueva avisa que nace sin precio', /Ponle su precio/.test(coc));

  // PC · el editor de «Agregar o corregir».
  const ed = sinComentarios(leer('src/components/ComidaEditor.tsx'));
  ok('PC: hay un ➕ para agregar otra opción', /pastilla\('➕ Otra opción', nuevaOpcion,/.test(ed));
  ok('PC: el campo de texto sale solo cuando hace falta', /const mostrarCampoPlato =/.test(ed));
  ok('⭐ PC: una entrega vieja con un nombre fuera de la lista se puede seguir corrigiendo', /platoFueraDeLista/.test(ed));
  ok('⭐ PC: lo escrito a mano queda en la lista, también para un contacto',
    /const avisoPlatoP = await anotarPlatoNuevo\(v\.patch\.itemLabel, platos\);/.test(ed));

  // PC · donde se le pone el PRECIO (que es lo que manda en la factura).
  const platos = sinComentarios(leer('src/components/CobroComidasPlatos.tsx'));
  ok('PC: «🧾 Platos» sigue siendo donde se crea con precio obligatorio', /➕ Crear plato/.test(platos));
}

// ── 7) EL SEGMENTO SE LLAMA POR LO QUE LLEVA ────────────────────────────────
{
  // Se lee el archivo en vez de cargarlo: `foodCompanyMeals.ts` habla con Supabase, y
  // eso arrastra react-native, que no corre fuera de la app. Lo que interesa acá son
  // los tres textos, y esos se ven leyendo.
  const fcm = sinComentarios(leer('src/lib/foodCompanyMeals.ts'));
  ok('el segmento se llama «Hielo, agua y otros»', /export const OTROS_TITULO = 'Hielo, agua y otros';/.test(fcm));
  // ⚠️ La etiqueta CORTA se queda: es la que va en las columnas de los papeles, donde
  //    un título de tres palabras corre el ancho de la tabla entera.
  ok('...pero la etiqueta corta de las tablas sigue siendo «Otros»', /\{ key: 'otros', label: 'Otros', icon: '🧾'/.test(fcm));
  const usa = (rel) => /OTROS_TITULO/.test(sinComentarios(leer(rel)));
  ok('lo usa la pantalla por empresa (TLF)', usa('src/screens/FoodCompanyScreen.tsx'));
  ok('lo usa la cocina (TLF)', usa('src/screens/CocinaScreen.tsx'));
  ok('lo usa el editor (PC)', usa('src/components/ComidaEditor.tsx'));
}

// ── 8) EL SQL QUE SIEMBRA HIELO Y AGUA ──────────────────────────────────────
{
  const sql = leer('supabase/comida_hielo_agua.sql');
  ok('siembra HIELO', /\('HIELO'\)/.test(sql));
  ok('siembra AGUA', /\('AGUA'\)/.test(sql));
  // ⭐ Idempotente: el cliente corre los SQL a mano y los repite sin pensarlo.
  ok('⭐ correrlo dos veces no duplica nada', /where not exists \(\s*select 1 from public\.food_extra_items f where lower\(f\.name\) = lower\(v\.name\)/.test(sql));
  ok('si estaban quitadas de la lista, vuelven', /set active = true/.test(sql));
  // ⭐ Nada de borrar: una opción borrada se lleva el nombre de sus entregas viejas.
  ok('⭐ el SQL no borra ni una fila', !/\bdelete\s+from\b|\bdrop\s+table\b|\btruncate\b/i.test(sql));
  ok('...ni le cambia el nombre a las entregas ya registradas', !/update public\.food_company_meals/i.test(sql));
  ok('trae su verificación', /✅/.test(sql) && /food_company_meals where meal_type = 'otros'/.test(sql));
  ok('dice que el precio lo pone el usuario', /costo lo pone el usuario/i.test(sql));
}

// ── 9) MANUALES ─────────────────────────────────────────────────────────────
{
  ok('manual (md) lo explica', /hielo y agua \(23\/09\/2026\)/i.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) lo explica', /hielo y agua \(23\/09\/2026\)/i.test(leer('src/screens/ManualScreen.tsx')));
  ok('el manual (md) dice que en la factura sale por su nombre', /se debe reflejar como AGUA|sale como «AGUA»|sale por su nombre/i.test(leer('docs/MANUAL-USUARIO.md')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-comida-hielo-agua · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
