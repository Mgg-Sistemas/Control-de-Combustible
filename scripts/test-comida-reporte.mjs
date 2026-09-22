/*
 * Test del REPORTE DE COMIDAS CON OPCIONES (18-sep-2026).
 *
 * Pedido del cliente: imprimir el PDF para empresa, para personas, para el día
 * que filtre, para un tipo de comida, o varias cosas a la vez; con monto y sin
 * monto; y poder quitarle o ponerle partes al papel con un solo botón, como en
 * reportes/conteo de equipos.
 *
 * Lo que fija, que es donde de verdad se rompe esto:
 *   · una lista de filtro VACÍA significa «todas», no «ninguna»
 *   · las PASTILLAS ocultan columnas y cuadros, y los TOTALES NO CAMBIAN
 *   · los FILTROS sí cambian los totales, y el papel escribe cuáles fueron
 *   · con monto y sin monto: el $ desaparece de TODAS las tablas, no de una
 *   · el precio manda sobre el costo escrito, y lo que no tiene ninguno de los
 *     dos NO suma cero en silencio: cuenta como «sin precio» y se dice
 *   · cabecera y filas tienen SIEMPRE el mismo número de columnas (un <th> sin
 *     su <td> corre la tabla entera y sale la cédula debajo de «Almuerzo»)
 *   · el nombre del archivo no lleva «/» (no se puede guardar)
 *   · la librería de opciones no importa nada (para poder probarla sola)
 *
 * Sin framework (el repo no tiene): transpila los .ts en memoria.
 *
 *   node scripts/test-comida-reporte.mjs
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

// Los .ts se cargan en memoria, y los `import './otro'` entre ellos se resuelven
// solos (con caché, para que dos archivos que importen el mismo tercero compartan
// la misma copia, igual que en la app).
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

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const OPC = loadTs('src/lib/comidaReporteOpciones.ts');
const REP = loadTs('src/lib/comidaReporte.ts');
const HTML = loadTs('src/lib/comidaReporteHtml.ts');

// ── 0) LA LIBRERÍA DE OPCIONES NO IMPORTA NADA ──────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/comidaReporteOpciones.ts'), 'utf8');
  ok('⭐ comidaReporteOpciones.ts no importa nada (se prueba sola)', !/^\s*import\s/m.test(src));
  ok('todas las banderas empiezan por «sin»', Object.keys(OPC.OPCIONES_COMIDA_COMPLETO).every((k) => k.startsWith('sin')));
  ok('cada pastilla tiene key, chip, largo y archivo',
    OPC.PASTILLAS_COMIDA.every((p) => p.key && p.chip && p.largo && p.archivo));
  ok('⭐ hay una pastilla por CADA bandera (ninguna queda sin botón)',
    Object.keys(OPC.OPCIONES_COMIDA_COMPLETO).every((k) => OPC.PASTILLAS_COMIDA.some((p) => p.key === k)));
  ok('⭐ ningún nombre de archivo lleva «/» (no se podría guardar)',
    OPC.PASTILLAS_COMIDA.every((p) => !p.archivo.includes('/')));
  ok('el papel completo no oculta nada', !OPC.hayAlgoOcultoComida(OPC.OPCIONES_COMIDA_COMPLETO));
  eq('y lo dice en criollo', OPC.ocultosComidaEnPalabras(OPC.OPCIONES_COMIDA_COMPLETO), 'Sale completo.');
  eq('sin nada oculto, el archivo no lleva sufijo', OPC.sufijoArchivoComida(OPC.OPCIONES_COMIDA_COMPLETO), '');
}

// ── 1) ALTERNAR ES INMUTABLE ────────────────────────────────────────────────
{
  const a = OPC.OPCIONES_COMIDA_COMPLETO;
  const b = OPC.alternarComida(a, 'sinMontos');
  eq('alternar enciende', b.sinMontos, true);
  eq('...y no toca el original', a.sinMontos, false);
  eq('alternar dos veces vuelve al principio', OPC.alternarComida(b, 'sinMontos').sinMontos, false);
  ok('con algo oculto lo dice', OPC.ocultosComidaEnPalabras(b).includes('los montos en $'));
  ok('...y avisa que los totales no cambian', OPC.ocultosComidaEnPalabras(b).includes('Los totales no cambian'));
  eq('el archivo lleva el sufijo', OPC.sufijoArchivoComida(b), ' sin montos');
}

// ── 2) EL PAPEL «COMO ANTES» ────────────────────────────────────────────────
{
  const o = OPC.OPCIONES_COMIDA_COMO_ANTES;
  ok('⭐ por defecto sale como el reporte viejo: sin montos', o.sinMontos);
  ok('...sin el detalle entrega por entrega', o.sinDetalle);
  ok('...pero CON el cuadro por empresa', !o.sinEmpresas);
  ok('...y CON el cuadro por persona', !o.sinPersonas);
  ok('no queda sin contenido', !OPC.comidaSinContenido(o));
}

// ── 3) EL PAPEL VACÍO SE AVISA ──────────────────────────────────────────────
{
  const o = { ...OPC.OPCIONES_COMIDA_COMPLETO, sinEmpresas: true, sinPersonas: true, sinComidas: true, sinDetalle: true };
  ok('⭐ con los cuatro cuadros apagados, el papel no se emite', OPC.comidaSinContenido(o));
  ok('con tres apagados todavía se emite', !OPC.comidaSinContenido({ ...o, sinDetalle: false }));
}

// ── DATOS DE MENTIRA (empresas y nombres inventados) ────────────────────────
const EMPRESAS = [
  { id: 'e1', nombre: 'EMPRESA UNO' },
  { id: 'e2', nombre: 'EMPRESA DOS' },
];
const entregasEmpresa = [
  { id: 'a1', company_id: 'e1', company_name: 'EMPRESA UNO', meal_type: 'desayuno', meal_date: '2026-09-14', delivered: 10, unit_cost: 0, delivered_at: '2026-09-14T11:00:00Z', created_by_name: 'Cocina 1', note: '' },
  { id: 'a2', company_id: 'e1', company_name: 'EMPRESA UNO', meal_type: 'almuerzo', meal_date: '2026-09-14', delivered: 20, unit_cost: 0, delivered_at: '2026-09-14T16:00:00Z', created_by_name: 'Cocina 1', note: 'tarde' },
  { id: 'a3', company_id: 'e2', company_name: 'EMPRESA DOS', meal_type: 'almuerzo', meal_date: '2026-09-15', delivered: 5, unit_cost: 0, delivered_at: '2026-09-15T16:00:00Z', created_by_name: 'Cocina 2', note: '' },
  // OTROS: no tiene precio de categoría, pero sí costo escrito al registrar.
  { id: 'a4', company_id: 'e2', company_name: 'EMPRESA DOS', meal_type: 'otros', item_label: 'Postre', meal_date: '2026-09-15', delivered: 4, unit_cost: 2, delivered_at: '2026-09-15T17:00:00Z', created_by_name: 'Cocina 2', note: '' },
];
const entregasPersona = [
  { id: 'p1', employee_id: 'x1', employee_name: 'Persona Uno', cedula: '111', meal_type: 'desayuno', distribution_date: '2026-09-14', meals: 1, delivered_at: '2026-09-14T11:05:00Z', created_by_name: 'Cocina 1', note: '' },
  { id: 'p2', employee_id: 'x2', employee_name: 'Persona Dos', cedula: '222', meal_type: 'cena', distribution_date: '2026-09-15', meals: 2, delivered_at: '2026-09-15T23:00:00Z', created_by_name: 'Cocina 2', note: '' },
];
// Precios inventados: los reales NO van al repositorio (es público).
const precios = [
  { id: 'pr1', categoria: 'desayuno', precio: 1, desde: '2026-09-01', hasta: null },
  { id: 'pr2', categoria: 'almuerzo', precio: 2, desde: '2026-09-01', hasta: null },
  // A propósito SIN precio de cena: para probar el «sin precio».
];
const TODO = { ...REP.FILTRO_COMIDA_TODO, desde: '2026-09-14', hasta: '2026-09-15' };
const todas = { empresas: entregasEmpresa, personas: entregasPersona };

// ── 4) LISTA VACÍA = TODAS ──────────────────────────────────────────────────
{
  const r = REP.filtrarComidas(todas, TODO);
  eq('⭐ sin elegir nada entran TODAS las de empresa', r.empresas.length, 4);
  eq('⭐ ...y todas las de persona', r.personas.length, 2);
  ok('no queda vacío', !REP.filtroSinEntregas(r));
}

// ── 5) CADA FILTRO ──────────────────────────────────────────────────────────
{
  eq('por empresa', REP.filtrarComidas(todas, { ...TODO, empresas: ['e2'] }).empresas.map((r) => r.id), ['a3', 'a4']);
  eq('por comida', REP.filtrarComidas(todas, { ...TODO, comidas: ['almuerzo'] }).empresas.map((r) => r.id), ['a2', 'a3']);
  eq('...y la misma comida recorta las personas', REP.filtrarComidas(todas, { ...TODO, comidas: ['almuerzo'] }).personas.length, 0);
  eq('por varias comidas a la vez', REP.filtrarComidas(todas, { ...TODO, comidas: ['desayuno', 'cena'] }).empresas.map((r) => r.id), ['a1']);
  eq('por persona', REP.filtrarComidas(todas, { ...TODO, personas: ['x2'] }).personas.map((r) => r.id), ['p2']);
  eq('por día', REP.filtrarComidas(todas, { ...TODO, desde: '2026-09-14', hasta: '2026-09-14' }).empresas.map((r) => r.id), ['a1', 'a2']);
  eq('solo lo de empresa', REP.filtrarComidas(todas, { ...TODO, conPersonas: false }).personas.length, 0);
  eq('solo lo de carnet', REP.filtrarComidas(todas, { ...TODO, conEmpresas: false }).empresas.length, 0);
  eq('⭐ dos filtros a la vez se cruzan', REP.filtrarComidas(todas, { ...TODO, empresas: ['e1'], comidas: ['almuerzo'] }).empresas.map((r) => r.id), ['a2']);
  ok('⭐ un filtro imposible avisa que no queda nada',
    REP.filtroSinEntregas(REP.filtrarComidas(todas, { ...TODO, empresas: ['no-existe'], conPersonas: false })));
}

// ── 6) LA PLATA ─────────────────────────────────────────────────────────────
{
  const g = REP.agruparEmpresas(entregasEmpresa, precios);
  const uno = g.find((x) => x.clave === 'e1');
  eq('empresa uno: 10 desayunos a 1 + 20 almuerzos a 2 = 50', uno.monto, 50);
  eq('...30 comidas', uno.total, 30);
  eq('...sin nada sin precio', uno.sinPrecio, 0);

  const dos = g.find((x) => x.clave === 'e2');
  // ⭐ 18-sep, decisión del cliente: OTROS se cobra con el costo por plato que
  //    escribió la cocina, IGUAL que la tarjeta de cobro (los dos usan
  //    `precioDeEntrega`). 5 almuerzos × $2 + 4 postres × $2 = 18.
  eq('⭐ OTROS toma el costo por plato de la cocina (igual que la tarjeta)', dos.monto, 18);
  eq('⭐ ...y ya no cuenta como «sin precio»', dos.sinPrecio, 0);

  const gp = REP.agruparPersonas(entregasPersona, precios);
  const p2 = gp.find((x) => x.clave === 'x2');
  eq('⭐ la cena no tiene precio: no suma', p2.monto, 0);
  eq('⭐ ...y se cuenta como «sin precio», no como cero en silencio', p2.sinPrecio, 2);

  const t = REP.totalesDeGrupos(g, gp);
  eq('total de comidas', t.total, 42);
  // 50 (empresa uno) + 18 (empresa dos) + 1 (un desayuno por carnet) = 69.
  eq('total de plata', t.monto, 69);
  // Solo las 2 cenas: OTROS ya tiene su costo.
  eq('total sin precio', t.sinPrecio, 2);
  eq('empresas contadas', t.empresas, 2);
  eq('personas contadas', t.personas, 2);
}

// ── 7) LAS PASTILLAS NO CAMBIAN LOS TOTALES ─────────────────────────────────
{
  const e = REP.filtrarComidas(todas, TODO);
  const gE = REP.agruparEmpresas(e.empresas, precios);
  const gP = REP.agruparPersonas(e.personas, precios);
  const t = REP.totalesDeGrupos(gE, gP);
  const base = {
    filtro: TODO, comidas: [{ key: 'desayuno', label: 'Desayuno' }, { key: 'almuerzo', label: 'Almuerzo' }, { key: 'lunch', label: 'Lunch' }, { key: 'cena', label: 'Cena' }, { key: 'otros', label: 'Otros' }],
    gruposEmpresas: gE, gruposPersonas: gP, cedulas: REP.cedulasPorClave(e.personas),
    lineas: REP.lineasDetalle(e, precios), totales: t, nombres: {},
  };
  const completo = HTML.cuerpoReporteComida({ ...base, opciones: OPC.OPCIONES_COMIDA_COMPLETO });
  ok('⭐ el total sale en el papel completo', completo.includes('>42<') || completo.includes('42'));

  // Se enciende CADA pastilla, una por una, y el total tiene que seguir ahí.
  OPC.PASTILLAS_COMIDA.forEach((p) => {
    const o = OPC.alternarComida(OPC.OPCIONES_COMIDA_COMPLETO, p.key);
    const cuerpo = HTML.cuerpoReporteComida({ ...base, opciones: o });
    ok(`⭐ con «${p.chip}» el total de comidas sigue diciendo 42`, cuerpo.includes('42'));
  });
}

// ── 8) CON MONTO Y SIN MONTO ────────────────────────────────────────────────
{
  const e = REP.filtrarComidas(todas, TODO);
  const gE = REP.agruparEmpresas(e.empresas, precios);
  const gP = REP.agruparPersonas(e.personas, precios);
  const base = {
    filtro: TODO, comidas: [{ key: 'desayuno', label: 'Desayuno' }, { key: 'almuerzo', label: 'Almuerzo' }, { key: 'cena', label: 'Cena' }, { key: 'otros', label: 'Otros' }],
    gruposEmpresas: gE, gruposPersonas: gP, cedulas: REP.cedulasPorClave(e.personas),
    lineas: REP.lineasDetalle(e, precios), totales: REP.totalesDeGrupos(gE, gP), nombres: {},
  };
  const con = HTML.cuerpoReporteComida({ ...base, opciones: OPC.OPCIONES_COMIDA_COMPLETO });
  const sin = HTML.cuerpoReporteComida({ ...base, opciones: { ...OPC.OPCIONES_COMIDA_COMPLETO, sinMontos: true } });
  ok('con monto: hay signos de dólar', con.includes('$'));
  ok('⭐ SIN monto: no queda ni un solo $ en TODO el papel', !sin.includes('$'));
  ok('⭐ sin monto: tampoco el encabezado «Monto ($)»', !sin.includes('Monto'));
  ok('sin monto: las cantidades siguen', sin.includes('42'));
  ok('sin monto: el alcance lo dice', sin.includes('SIN montos'));
}

// ── 9) CABECERA Y FILAS CUADRAN SIEMPRE ─────────────────────────────────────
//
// Es el error que no se ve hasta que el cliente lee el papel: un <th> de más
// corre TODA la tabla y la cédula aparece debajo de «Almuerzo».
{
  const e = REP.filtrarComidas(todas, TODO);
  const gE = REP.agruparEmpresas(e.empresas, precios);
  const gP = REP.agruparPersonas(e.personas, precios);
  const cat = [{ key: 'desayuno', label: 'Desayuno' }, { key: 'almuerzo', label: 'Almuerzo' }, { key: 'cena', label: 'Cena' }, { key: 'otros', label: 'Otros' }];
  const base = {
    filtro: TODO, comidas: cat, gruposEmpresas: gE, gruposPersonas: gP,
    cedulas: REP.cedulasPorClave(e.personas), lineas: REP.lineasDetalle(e, precios),
    totales: REP.totalesDeGrupos(gE, gP), nombres: {},
  };

  // Se prueban TODAS las combinaciones de las pastillas que mueven columnas.
  const mueven = ['sinMontos', 'sinDias', 'sinCedula', 'sinQuien', 'sinHora', 'sinNotas'];
  let combinaciones = 0, descuadres = 0;
  for (let mask = 0; mask < (1 << mueven.length); mask++) {
    const o = { ...OPC.OPCIONES_COMIDA_COMPLETO };
    mueven.forEach((k, i) => { o[k] = !!(mask & (1 << i)); });
    const cuerpo = HTML.cuerpoReporteComida({ ...base, opciones: o });
    combinaciones++;
    // Cada <table>: el nº de <th> tiene que ser el nº de <td> de cada <tr>.
    for (const tabla of cuerpo.split('<table>').slice(1)) {
      const nTh = (tabla.match(/<th /g) ?? []).length;
      for (const tr of tabla.split('<tr').slice(2)) {
        const nTd = (tr.match(/<td /g) ?? []).length;
        if (nTd > 0 && nTd !== nTh) descuadres++;
      }
    }
  }
  eq('se probaron las 64 combinaciones de columnas', combinaciones, 64);
  eq('⭐ NINGUNA fila queda descuadrada con su cabecera', descuadres, 0);
}

// ── 9b) EL PIE DE CADA CUADRO SUMA POR COMIDA ───────────────────────────────
//
// Lo traía el reporte viejo y no se puede perder: el cliente lee esa fila para
// cuadrar cuántos desayunos se entregaron en total.
{
  const e = REP.filtrarComidas(todas, TODO);
  const gE = REP.agruparEmpresas(e.empresas, precios);
  const gP = REP.agruparPersonas(e.personas, precios);
  const cat = [{ key: 'desayuno', label: 'Desayuno' }, { key: 'almuerzo', label: 'Almuerzo' }, { key: 'cena', label: 'Cena' }, { key: 'otros', label: 'Otros' }];
  const cuerpo = HTML.cuerpoReporteComida({
    filtro: TODO, opciones: OPC.OPCIONES_COMIDA_COMPLETO, comidas: cat,
    gruposEmpresas: gE, gruposPersonas: gP, cedulas: REP.cedulasPorClave(e.personas),
    lineas: REP.lineasDetalle(e, precios), totales: REP.totalesDeGrupos(gE, gP), nombres: {},
  });
  const pies = cuerpo.split('tr class="tot"').slice(1);
  ok('⭐ hay un pie de TOTAL en cada cuadro (comidas, empresas y personas)', pies.length >= 3);
  // En el cuadro de personas: 1 desayuno y 2 cenas.
  const piePersonas = pies[pies.length - 1];
  ok('⭐ el pie de personas suma el desayuno', piePersonas.includes('<b>1</b>'));
  ok('⭐ ...y las cenas', piePersonas.includes('<b>2</b>'));
  ok('...y dice TOTAL', piePersonas.includes('TOTAL'));
}

// ── 10) EL CUADRO DE ALCANCE ────────────────────────────────────────────────
{
  const nombres = {
    empresas: new Map(EMPRESAS.map((e) => [e.id, e.nombre])),
    personas: new Map([['x2', 'Persona Dos']]),
    comidas: new Map([['almuerzo', 'Almuerzo']]),
  };
  const todo = REP.alcanceEnPalabras(TODO, nombres);
  ok('sin filtros dice «todas» de empresas', todo.some((l) => l === 'Empresas: todas.'));
  ok('...y de personas', todo.some((l) => l === 'Personas: todas.'));
  ok('...y de comidas', todo.some((l) => l === 'Comidas: todas.'));

  const filtrado = REP.alcanceEnPalabras({ ...TODO, empresas: ['e2'], comidas: ['almuerzo'] }, nombres);
  ok('⭐ con filtro escribe el NOMBRE, no la clave', filtrado.some((l) => l.includes('EMPRESA DOS')));
  ok('...y no la clave cruda', !filtrado.some((l) => l.includes('e2')));
  ok('nombra la comida', filtrado.some((l) => l.includes('Almuerzo')));

  // Desde el 21-sep-2026 son TRES interruptores: el papel sale vacío con los tres apagados.
  const nada = REP.alcanceEnPalabras({ ...TODO, conEmpresas: false, conPersonas: false, conContactos: false }, nombres);
  ok('⭐ sin QR, ni carnet, ni contactos, avisa que el papel sale vacío', nada.some((l) => l.includes('vacío')));
  const soloContactos = REP.alcanceEnPalabras({ ...TODO, conEmpresas: false, conPersonas: false }, nombres);
  ok('⭐ con solo contactos encendido NO dice vacío, dice qué entra', !soloContactos.some((l) => l.includes('vacío')) && soloContactos.some((l) => /SOLO.*contactos de cocina/.test(l)));
  ok('con los tres encendidos dice que entra todo', REP.alcanceEnPalabras(TODO, nombres).some((l) => /Entra todo/.test(l)));
}

// ── 11) EL LISTADO ENTREGA POR ENTREGA ──────────────────────────────────────
{
  const e = REP.filtrarComidas(todas, TODO);
  const l = REP.lineasDetalle(e, precios);
  eq('entran las 6 entregas', l.length, 6);
  ok('⭐ ordenado por día', l.every((x, i) => i === 0 || l[i - 1].fecha <= x.fecha));
  ok('distingue empresa de persona', l.some((x) => x.via === 'empresa') && l.some((x) => x.via === 'persona'));
  const postre = l.find((x) => x.plato === 'Postre');
  ok('el plato de OTROS lleva su nombre', !!postre);
  ok('⭐ ...y sale con el costo por plato de la cocina', postre.conPrecio === true && postre.monto === 8);
  const cena = l.find((x) => x.comida === 'cena');
  ok('⭐ la cena sin precio se marca, no sale en $0,00', cena.conPrecio === false);
}

// ── 12) NOMBRE DEL ARCHIVO ──────────────────────────────────────────────────
{
  const n1 = HTML.nombreArchivoComida({ desde: '2026-09-14', hasta: '2026-09-14' }, '');
  ok('un solo día no repite la fecha', n1 === 'Comidas 14-09-2026');
  const n2 = HTML.nombreArchivoComida({ desde: '2026-09-14', hasta: '2026-09-15' }, ' sin montos');
  ok('rango con sufijo', n2.includes('a 15-09-2026') && n2.endsWith('sin montos'));
  ok('⭐ NUNCA lleva «/» (no se podría guardar el archivo)', !n1.includes('/') && !n2.includes('/'));
  eq('subtítulo de un día', HTML.subtituloReporteComida({ desde: '2026-09-14', hasta: '2026-09-14' }), 'Día 14/09/2026');
  eq('subtítulo de rango', HTML.subtituloReporteComida({ desde: '2026-09-14', hasta: '2026-09-15' }), 'Del 14/09/2026 al 15/09/2026');
}

// ── 13) EL HTML NO SE ROMPE CON & < > ───────────────────────────────────────
//
// Pasó de verdad con «INGENIERIA & LOGISTICA …»: un & sin escapar rompía el
// documento y no descargaba nada.
{
  const sucias = [{ id: 'z', company_id: 'z', company_name: 'UNO & DOS <S.A>', meal_type: 'almuerzo', meal_date: '2026-09-14', delivered: 1, unit_cost: 0, note: 'a<b' }];
  const g = REP.agruparEmpresas(sucias, precios);
  const cuerpo = HTML.cuerpoReporteComida({
    filtro: TODO, opciones: OPC.OPCIONES_COMIDA_COMPLETO, comidas: [{ key: 'almuerzo', label: 'Almuerzo' }],
    gruposEmpresas: g, gruposPersonas: [], lineas: REP.lineasDetalle({ empresas: sucias, personas: [] }, precios),
    totales: REP.totalesDeGrupos(g, []), nombres: {},
  });
  ok('⭐ el & del nombre sale escapado', cuerpo.includes('UNO &amp; DOS &lt;S.A&gt;'));
  ok('...y no crudo', !cuerpo.includes('UNO & DOS'));
}

// ── 14) CLAVES: el id manda, el nombre es el respaldo ───────────────────────
{
  eq('empresa con id usa el id', REP.claveEmpresa({ company_id: 'e9', company_name: 'X' }), 'e9');
  eq('empresa vieja sin id usa el nombre', REP.claveEmpresa({ company_id: null, company_name: 'X' }), 'X');
  eq('persona con ficha usa la ficha', REP.clavePersona({ employee_id: 'x9', cedula: '1', employee_name: 'A' }), 'x9');
  eq('persona sin ficha usa la cédula', REP.clavePersona({ employee_id: null, cedula: '1', employee_name: 'A' }), '1');
  eq('y sin cédula, el nombre', REP.clavePersona({ employee_id: null, cedula: null, employee_name: 'A' }), 'A');
}

// ── 15) LA HORA VA EN CARACAS, NO EN UTC ────────────────────────────────────
{
  // 2026-09-14T15:30:00Z son las 11:30 a. m. en Caracas (UTC−4).
  const h = REP.horaCaracas('2026-09-14T15:30:00Z');
  ok(`⭐ la hora se escribe en Caracas, no en UTC (salió «${h}»)`, h.includes('11:30'));
  eq('una hora inválida no revienta', REP.horaCaracas('nada'), '');
}

// ── 16) EL MODAL NO DEJA AMPLIAR LAS FECHAS ─────────────────────────────────
//
// El modal filtra sobre lo que la pantalla YA cargó. Si dejara ampliar las
// fechas, el papel diría «del 1 al 30» con solo una semana adentro: incompleto y
// sin que nadie lo notara al leerlo. El calendario solo deja achicar.
{
  const modal = fs.readFileSync(path.join(ROOT, 'src/components/ComidaReporteModal.tsx'), 'utf8');
  ok('⭐ «desde» no puede ir antes de lo cargado', /value=\{desde\} onChange=\{setDesde\} minISO=\{desdeInicial\}/.test(modal));
  ok('⭐ «hasta» no puede ir después de lo cargado', /value=\{hasta\}[^\n]*maxISO=\{hastaInicial < hoy \? hastaInicial : hoy\}/.test(modal));
  ok('avisa si los precios no se leyeron', /precios === null/.test(modal));
  // El calendario solo no alcanza: en la PC la fecha se ESCRIBE. El filtro que
  // llega al papel pasa por `acotarFiltro` (probado abajo con datos).
  ok('⭐ el filtro del modal pasa por acotarFiltro', /useMemo\(\(\) => acotarFiltro\(/.test(modal));
  ok('⭐ hereda la empresa elegida en la pantalla', /empresaInicial && empresaInicial !== 'all'/.test(modal));
  ok('⭐ con una empresa de la pantalla, arranca SIN lo de carnet', /setConPersonas\(!unaEmpresa\)/.test(modal));
  ok('⭐ elegir una empresa en el modal apaga lo de carnet', /const alternarEmpresa[\s\S]*?setConPersonas\(false\)/.test(modal));
  ok('las selecciones se limpian al abrir', /setPersonasSel\(new Set\(\)\);\s*setComidasSel\(new Set\(\)\);/.test(modal));
  const scr = fs.readFileSync(path.join(ROOT, 'src/screens/ComidaScreen.tsx'), 'utf8');
  ok('⭐ la pantalla le pasa su filtro de empresa al modal', /empresaInicial=\{companyFilter\}/.test(scr));
}

// ── 17) ACOTAR EL FILTRO A LO CARGADO (con datos, no con regex) ─────────────
//
// Lo encontró la revisión probándolo en Chrome: un <input type=date> con min y
// max deja ESCRIBIR una fecha fuera; el navegador la marca inválida pero la manda.
{
  const cargado = { desde: '2026-09-14', hasta: '2026-09-18', empresas: ['e1', 'e2'], personas: ['x1'] };
  const base = { ...REP.FILTRO_COMIDA_TODO };
  const a1 = REP.acotarFiltro({ ...base, desde: '2026-09-01', hasta: '2026-09-18' }, cargado);
  eq('⭐ una fecha escrita ANTES de lo cargado vuelve al borde', a1.desde, '2026-09-14');
  const a2 = REP.acotarFiltro({ ...base, desde: '2026-09-14', hasta: '2026-12-31' }, cargado);
  eq('⭐ una fecha escrita DESPUÉS de lo cargado vuelve al borde', a2.hasta, '2026-09-18');
  const a3 = REP.acotarFiltro({ ...base, desde: '', hasta: '' }, cargado);
  eq('⭐ fechas vacías (el «Borrar» del selector) valen como los bordes', [a3.desde, a3.hasta], ['2026-09-14', '2026-09-18']);
  const a4 = REP.acotarFiltro({ ...base, desde: '2026-09-15', hasta: '2026-09-16' }, cargado);
  eq('achicar dentro de lo cargado se respeta', [a4.desde, a4.hasta], ['2026-09-15', '2026-09-16']);
  const a5 = REP.acotarFiltro({ ...base, desde: '2026-09-17', hasta: '2026-09-15' }, cargado);
  eq('al revés se ordena', [a5.desde, a5.hasta], ['2026-09-15', '2026-09-17']);
  const a6 = REP.acotarFiltro({ ...base, desde: '2026-09-14', hasta: '2026-09-18', empresas: ['e1', 'vieja'], personas: ['nadie'] }, cargado);
  eq('⭐ una empresa marcada que ya no está en lo cargado se descarta', a6.empresas, ['e1']);
  eq('⭐ lo mismo con las personas (no filtra escondida)', a6.personas, []);
  // Y el subtítulo del papel dice el rango ACOTADO, no el escrito.
  eq('⭐ el papel no puede decir «del 01/09» si solo cargó desde el 14', HTML.subtituloReporteComida(a1), 'Del 14/09/2026 al 18/09/2026');
}

// ── 18) LA MISMA PLATA QUE LA TARJETA DE COBRO ──────────────────────────────
//
// El papel y la tarjeta tienen que dar lo mismo. La tarjeta reparte en «se
// cobra» y «consumo interno»; el papel da el VALOR, que es la suma de las dos.
{
  const COBRO = loadTs('src/lib/cobroComidas.ts');
  const preciosRaros = [
    { id: 'q1', categoria: 'desayuno', precio: 1.005, desde: '2026-09-01', hasta: null },   // se redondea antes
    { id: 'q2', categoria: 'almuerzo', precio: 0, desde: '2026-09-01', hasta: null },       // gratis ≠ sin precio
    { id: 'q3', categoria: 'almuerzo', precio: 3, desde: '2026-09-15', hasta: '2026-09-15' }, // blindado
  ];
  const fichas = new Map([['x1', { companyId: null, companyName: null, departamento: 'COCINA' }], ['x2', { companyId: 'e1', companyName: 'EMPRESA UNO' }]]);
  const cuentas = COBRO.calcularCobroComidas({ empresas: entregasEmpresa, personas: entregasPersona, empresaDePersona: fichas, precios: preciosRaros });
  const tc = COBRO.totalCobroComidas(cuentas);
  const gE = REP.agruparEmpresas(entregasEmpresa, preciosRaros);
  const gP = REP.agruparPersonas(entregasPersona, preciosRaros);
  const tp = REP.totalesDeGrupos(gE, gP);
  eq('⭐ VALOR del papel = lo que se cobra + consumo interno de la tarjeta', tp.monto, Math.round((tc.monto + tc.montoInterno) * 100) / 100);
  eq('⭐ las comidas sin precio cuentan igual en los dos', tp.sinPrecio, tc.sinPrecio);
  eq('⭐ y el total de comidas también', tp.total, tc.comidas);
}

// ── 19) UNA COMIDA FUERA DEL CATÁLOGO TIENE SU COLUMNA ──────────────────────
//
// Una entrega por carnet sin comida marcada suma en el Total de la fila. Sin su
// columna, la fila no cuadraba (3 + 2 + 0 + 0 = 6).
{
  const raras = [{ id: 'r1', employee_id: 'x9', employee_name: 'Persona Rara', cedula: '9', meal_type: null, distribution_date: '2026-09-14', meals: 1 }];
  const gP = REP.agruparPersonas(raras, precios);
  const cuerpo = HTML.cuerpoReporteComida({
    filtro: TODO, opciones: OPC.OPCIONES_COMIDA_COMPLETO,
    comidas: [{ key: 'desayuno', label: 'Desayuno' }], gruposEmpresas: [], gruposPersonas: gP,
    cedulas: REP.cedulasPorClave(raras), lineas: [], totales: REP.totalesDeGrupos([], gP), nombres: {},
  });
  ok('⭐ la comida sin marcar tiene su columna en el cuadro de personas', cuerpo.includes('>Sin comida<'));
}

// ── 20) EL DETALLE TIENE TOPE Y LO DICE ─────────────────────────────────────
{
  const muchas = Array.from({ length: HTML.TOPE_DETALLE + 7 }, (_, i) => ({
    fecha: '2026-09-14', hora: '', quienRecibe: 'P' + i, via: 'persona', comida: 'desayuno', plato: '',
    cantidad: 1, monto: 0, conPrecio: false, quien: '', nota: '',
  }));
  const cuerpo = HTML.cuerpoReporteComida({
    filtro: TODO, opciones: OPC.OPCIONES_COMIDA_COMPLETO, comidas: [{ key: 'desayuno', label: 'Desayuno' }],
    gruposEmpresas: [], gruposPersonas: [], lineas: muchas, totales: REP.totalesDeGrupos([], []), nombres: {},
  });
  // Solo el cuerpo de la tabla: la fila de encabezado no es una entrega.
  const filas = (cuerpo.split('Entrega por entrega')[1].split('<tbody>')[1].match(/<tr>/g) ?? []).length;
  eq('⭐ no pinta más filas que el tope', filas, HTML.TOPE_DETALLE);
  ok('⭐ y dice cuántas quedaron fuera', cuerpo.includes('quedaron fuera 7'));
  ok('el título dice el total real', cuerpo.includes(`Entrega por entrega (${HTML.TOPE_DETALLE + 7})`));
}

// ── 21) LA COLUMNA DICE «VALOR», NO «MONTO» ─────────────────────────────────
//
// Es el valor de lo entregado, no lo que se cobra (la tarjeta separa el consumo
// interno). Llamarlo «Monto» invitaba a cobrarlo tal cual.
{
  ok('las tres tablas titulan «Valor ($)»',
    OPC.TITULO_EMPRESA.monto === 'Valor ($)' && OPC.TITULO_PERSONA.monto === 'Valor ($)' && OPC.TITULO_DETALLE.monto === 'Valor ($)');
}

// ── 20) CONTACTOS DE COCINA EN EL PAPEL (Fase 2, 21-sep-2026) ───────────────
{
  const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const COBRO = loadTs('src/lib/cobroComidas.ts');
  const P2 = [{ id: 'p1', categoria: 'almuerzo', precio: 4, desde: '2026-09-01', hasta: null }];
  const F = { ...REP.FILTRO_COMIDA_TODO, desde: '2026-09-14', hasta: '2026-09-15' };
  const nomina = { id: 'n1', employee_id: 'x1', employee_name: 'Persona Nomina', cedula: '111', meal_type: 'almuerzo', distribution_date: '2026-09-14', meals: 1 };
  const kInd = { id: 'c1', employee_id: null, contacto_id: 'k1', cobrar_a: 'independiente', employee_name: 'Ana Rojas', cedula: 'V-11.111.111', meal_type: 'almuerzo', distribution_date: '2026-09-14', meals: 3 };
  // La misma Ana, otro día, con la cédula escrita distinto: sigue siendo UNA persona.
  const kInd2 = { ...kInd, id: 'c2', cedula: '11111111', distribution_date: '2026-09-15', meals: 2 };
  const kEmp = { id: 'c3', employee_id: null, contacto_id: 'k2', cobrar_a: 'empresa', contacto_company_id: 'e1', contacto_company_nombre: 'EMPRESA UNO', employee_name: 'Beto Mora', cedula: '222', meal_type: 'almuerzo', distribution_date: '2026-09-14', meals: 5 };
  const qr = { id: 'q1', company_id: 'e1', company_name: 'EMPRESA UNO', meal_type: 'almuerzo', meal_date: '2026-09-14', delivered: 10 };
  const todas = [nomina, kInd, kInd2, kEmp];

  eq('⭐ el contacto manda en la clave, antes que la ficha y la cédula', REP.clavePersona({ contacto_id: 'k1', employee_id: 'x9', cedula: '1', employee_name: 'n' }), 'k1');
  eq('una fila de nómina conserva su clave de siempre', REP.clavePersona(nomina), 'x1');
  eq('⭐ la misma persona con la cédula escrita distinto es UN renglón', REP.agruparPersonas([kInd, kInd2], P2).length, 1);

  const claves = (f) => REP.filtrarComidas({ empresas: [qr], personas: todas }, f).personas.map((r) => r.id);
  eq('con todo encendido entran todos', claves(F), ['n1', 'c1', 'c2', 'c3']);
  eq('⭐ sin «carnet» se va la nómina y los contactos SIGUEN', claves({ ...F, conPersonas: false }), ['c1', 'c2', 'c3']);
  eq('⭐ sin «contactos» se van los contactos y la nómina SIGUE', claves({ ...F, conContactos: false }), ['n1']);
  // ⭐ Quien arma un filtro sin conocer el campo nuevo no puede perder a los contactos.
  const viejo = { ...F }; delete viejo.conContactos;
  eq('⭐ un filtro sin el campo nuevo los deja entrar', claves(viejo), ['n1', 'c1', 'c2', 'c3']);

  // LA CUENTA DE UNA PERSONA
  const soloAna = REP.filtrarComidas({ empresas: [qr], personas: todas }, { ...F, conEmpresas: false, conPersonas: false, personas: ['k1'] });
  const cAna = REP.cuentaDeContacto(soloAna);
  eq('⭐ un papel con un solo contacto es SU cuenta', [cAna?.nombre, cAna?.independiente, cAna?.aEmpresa.length], ['Ana Rojas', 5, 0]);
  eq('...y se titula «Cuenta de comidas»', HTML.tituloReporteComida(cAna), '🍽️ Cuenta de comidas · Ana Rojas');
  ok('...y el archivo lleva su nombre', /Ana Rojas/.test(HTML.nombreArchivoComida(F, '', cAna)));
  eq('sin cuenta, el título de siempre', HTML.tituloReporteComida(null), '🍽️ Control de entregas de comida');
  eq('con dos personas no es la cuenta de nadie', REP.cuentaDeContacto({ empresas: [], personas: [kInd, kEmp] }), null);
  eq('con nómina adentro tampoco', REP.cuentaDeContacto({ empresas: [], personas: [kInd, nomina] }), null);
  eq('con algo de empresas tampoco', REP.cuentaDeContacto({ empresas: [qr], personas: [kInd] }), null);

  // ⭐ EL PAPEL NO PUEDE COBRARLE A LA PERSONA LO QUE PAGA SU EMPRESA.
  const cBeto = REP.cuentaDeContacto({ empresas: [], personas: [kEmp, { ...kInd, contacto_id: 'k2', id: 'c9', meals: 1 }] });
  eq('⭐ lo que paga la empresa se cuenta aparte', [cBeto.independiente, cBeto.aEmpresa], [1, [{ empresa: 'EMPRESA UNO', comidas: 5 }]]);
  ok('⭐ ...y entonces el papel NO se llama «Cuenta»', !/Cuenta/.test(HTML.tituloReporteComida(cBeto)) && /Comidas de Beto Mora/.test(HTML.tituloReporteComida(cBeto)));
  const cuerpo = HTML.cuerpoReporteComida({
    filtro: F, opciones: OPC.OPCIONES_COMIDA_COMPLETO, comidas: [{ key: 'almuerzo', label: 'Almuerzo' }],
    gruposEmpresas: [], gruposPersonas: REP.agruparPersonas([kEmp], P2), lineas: [], totales: REP.totalesDeGrupos([], REP.agruparPersonas([kEmp], P2)),
    cuentaContacto: cBeto,
  });
  ok('⭐ ...y el recuadro dice cuántas son de la empresa', /se le cobran a <b>EMPRESA UNO<\/b>/.test(cuerpo) && /<b>5<\/b>/.test(cuerpo));

  // EL PAPEL DE UNA EMPRESA AVISA LO QUE NO TRAE
  eq('⭐ avisa las comidas de contactos cobradas a la empresa elegida', REP.comidasDeContactosACobrarA(todas, { ...F, empresas: ['e1'] }), 5);
  eq('...solo de ESA empresa', REP.comidasDeContactosACobrarA(todas, { ...F, empresas: ['otra'] }), 0);
  eq('...y sin empresa elegida no hay nada que avisar', REP.comidasDeContactosACobrarA(todas, F), 0);

  // ⭐ PARIDAD: el papel y la tarjeta siguen dando lo mismo CON contactos adentro.
  const fichas = new Map([['x1', { companyId: null, companyName: null, departamento: 'COCINA' }]]);
  const tc = COBRO.totalCobroComidas(COBRO.calcularCobroComidas({ empresas: [qr], personas: todas, empresaDePersona: fichas, precios: P2 }));
  const tp = REP.totalesDeGrupos(REP.agruparEmpresas([qr], P2), REP.agruparPersonas(todas, P2));
  eq('⭐ con contactos, VALOR del papel = cobro + interno de la tarjeta', tp.monto, Math.round((tc.monto + tc.montoInterno) * 100) / 100);
  eq('⭐ ...y el total de comidas también', tp.total, tc.comidas);

  const modal = sinComentarios(leer('src/components/ComidaReporteModal.tsx'));
  ok('el modal tiene la tercera casilla', /casilla\('contactos', '📇 Contactos de cocina', conContactos,/.test(modal));
  ok('⭐ arranca encendida, como las otras dos', /const \[conContactos, setConContactos\] = useState\(true\)/.test(modal));
  ok('⭐ con una empresa elegida se apaga junto con el carnet', /setConPersonas\(!unaEmpresa\);\s*setConContactos\(!unaEmpresa\);/.test(modal));
  ok('⭐ con los tres apagados no deja generar', /\(!conEmpresas && !conPersonas && !conContactos\)/.test(modal));
  ok('el filtro lleva el interruptor y el memo se entera', /conEmpresas, conPersonas, conContactos,\s*\}/.test(modal) && /conPersonas, conContactos, desdeInicial/.test(modal));
  ok('solo ofrece personas de los interruptores encendidos', /if \(contacto \? !conContactos : !conPersonas\) return;/.test(modal));
  const pantalla = sinComentarios(leer('src/screens/ComidaScreen.tsx'));
  ok('⭐ la pantalla agrupa igual que el papel', /const k = r\.contacto_id \?\? r\.employee_id \?\? \(r\.cedula \|\| r\.employee_name\);/.test(pantalla) && /const k = r\.contacto_id \?\? r\.employee_id \?\? r\.employee_name;/.test(pantalla));
}

// ── 21) «OTROS» DE UN CONTACTO EN EL PAPEL, SUMADO (22-sep-2026) ─────────────
//
// «Después cuando vaya a sacar el registro en PDF no va a salir sumado, sino como
// nota» (Niliany). Ahora el hielo es un renglón con precio, no una nota.
{
  const COBRO = loadTs('src/lib/cobroComidas.ts');
  const PH = [
    { id: 'a', categoria: 'almuerzo', precio: 5, desde: '2026-09-01', hasta: null },
    { id: 'h', categoria: 'plato_hielo', precio: 2.5, desde: '2026-09-01', hasta: null },
  ];
  const aPrecio = (n) => (String(n ?? '').trim().toLowerCase() === 'bolsa de hielo' ? 'plato_hielo' : null);
  const alm = { id: 'c1', employee_id: null, contacto_id: 'k1', cobrar_a: 'independiente', employee_name: 'Ana Rojas', cedula: '111', meal_type: 'almuerzo', distribution_date: '2026-09-22', meals: 3, delivered_at: '2026-09-22T16:00:00Z' };
  const hie = { ...alm, id: 'c2', meal_type: 'otros', item_label: 'Bolsa de hielo', meals: 4 };
  eq('⭐ el hielo del contacto vale lo del catálogo: 4 × 2,50', REP.montoDePersona(hie, PH, aPrecio), { monto: 10, conPrecio: true, precioUnitario: 2.5 });
  eq('sin catálogo no vale nada (y lo dice)', REP.montoDePersona(hie, PH).conPrecio, false);
  const g = REP.agruparPersonas([alm, hie], PH, aPrecio);
  eq('⭐ un solo renglón para Ana, con 15 + 10 = 25', [g.length, g[0].monto], [1, 25]);
  const l = REP.lineasDetalle({ empresas: [], personas: [alm, hie] }, PH, aPrecio);
  eq('⭐ en el detalle el hielo dice qué fue y cuánto vale', l.find((x) => x.comida === 'otros'), {
    ...l.find((x) => x.comida === 'otros'), plato: 'Bolsa de hielo', cantidad: 4, monto: 10, conPrecio: true,
  });
  eq('...y el almuerzo sigue sin plato', l.find((x) => x.comida === 'almuerzo').plato, '');
  // Paridad con la tarjeta: mismo dinero.
  const tc = COBRO.totalCobroComidas(COBRO.calcularCobroComidas({ empresas: [], personas: [alm, hie], empresaDePersona: new Map(), precios: PH, platoAPrecio: aPrecio }));
  eq('⭐ papel y tarjeta dan lo mismo con hielo adentro', REP.totalesDeGrupos([], g).monto, tc.monto);
  const modal = fs.readFileSync(path.join(ROOT, 'src/components/ComidaReporteModal.tsx'), 'utf8');
  ok('⭐ el modal le pasa el catálogo a las personas, no solo a las empresas', /agruparPersonas\(e\.personas, precios, platoAPrecio\)/.test(modal));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-comida-reporte · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
