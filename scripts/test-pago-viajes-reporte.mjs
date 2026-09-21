/*
 * Test del PDF DE PAGO DE VIAJES CON OPCIONES (21-sep-2026).
 *
 * Pedido del cliente: «que los pagos de viajes, el pdf, lo pueda sacar por ubicación y
 * obra, también que yo pueda seleccionar la obra y que me salga solo esa obra, que
 * también lo pueda sacar por la empresa o empresas que seleccione, además que para ese
 * pdf pueda ocultarle» las columnas y cuadros, con las pastillas del Conteo de equipos.
 *
 * Lo que fija, y por qué duele si se rompe:
 *   · el papel NO recalcula plata: usa las líneas de la tarjeta (si no, el PDF y la
 *     pantalla pueden dar montos distintos y se discute la factura)
 *   · agrupar por obra o por empresa da el MISMO total (cambiar el eje no mueve un centavo)
 *   · filtrar una obra trae SOLO esa obra; vacío = todas
 *   · OCULTAR no cambia el total; FILTRAR sí, y entonces el papel lo dice siempre
 *   · lo nuevo entra apagado: sin tocar nada sale el papel de siempre
 *   · «sin nombre de empresas» no suelta los nombres ni en el alcance
 *
 * Valores inventados: no hay tarifas, placas ni empresas reales en el repositorio (es público).
 *
 *   node scripts/test-pago-viajes-reporte.mjs
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

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function cargar(rel) {
  const p = path.join(ROOT, rel);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  m._compile(js, p);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; failures.push(`✗ ${name}\n    obtenido: ${JSON.stringify(got)}\n    esperado: ${JSON.stringify(want)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const L = cargar('src/lib/pagoViajes.ts');
const R = cargar('src/lib/pagoViajesReporte.ts');

// ── DATOS INVENTADOS ─────────────────────────────────────────────────────────
// Dos empresas, dos obras, tres camiones. Tarifa este 10, oeste 15.
const viaje = (id, maq, code, emp, zona, obra, hora = '10:00') => ({
  id, machinery_id: maq, machine_code: code, company_id: emp, zona_pago: zona,
  registered_at: `2026-09-15T${hora}:00-04:00`, placa_snap: `PL-${maq}`, ubicacion_nombre: obra,
});
const viajes = [
  viaje('v1', 'm1', 'CAMION VOLTEO', 'EA', 'este', 'Obra Norte'),
  viaje('v2', 'm1', 'CAMION VOLTEO', 'EA', 'este', 'Obra Norte', '11:00'),
  viaje('v3', 'm1', 'CAMION VOLTEO', 'EA', 'oeste', 'Obra Sur', '12:00'),
  viaje('v4', 'm2', 'CHUTO CON VOLQUETA', 'EB', 'este', 'Obra Norte', '13:00'),
  viaje('v5', 'm3', 'CAMION VOLTEO', 'EB', 'oeste', 'Obra Sur', '14:00'),
  viaje('v6', 'm3', 'CAMION VOLTEO', 'EB', 'oeste', null, '15:00'),          // sin obra
  viaje('v7', 'm2', 'CHUTO CON VOLQUETA', 'EB', 'este', 'Obra Norte', '16:00'), // marcado «no facturó»
];
const modos = L.indexarModos(['m1', 'm2', 'm3'].map((m, i) => ({ id: `mo${i}`, machinery_id: m, modo: 'viaje', desde: '2026-09-14', created_at: '2026-09-14T00:00:00Z' })));
const tarifas = [
  { id: 't1', zona: 'este', precio: 10, desde: '2026-09-14', alcance: 'general', created_at: '2026-09-14T00:00:00Z' },
  { id: 't2', zona: 'oeste', precio: 15, desde: '2026-09-14', alcance: 'general', created_at: '2026-09-14T00:00:00Z' },
];
const marcas = L.indexarMarcas([{ id: 'x', viaje_id: 'v7', facturable: false, created_at: '2026-09-15T20:00:00Z' }]);
const grupos = L.calcularPagoViajes({ viajes, modos, tarifas, marcas, semanaDe: () => 'rango' });
const lineas = R.lineasDeGrupos(grupos.values());
const NOMBRES = new Map([['EA', 'EMPRESA ALFA'], ['EB', 'EMPRESA BETA']]);
const totalTarjeta = Array.from(grupos.values()).reduce((a, g) => a + g.montoUSD, 0);

// ── 1) EL PAPEL NO RECALCULA PLATA ───────────────────────────────────────────
{
  const src = sinComentarios(leer('src/lib/pagoViajesReporte.ts'));
  ok('⭐ la librería solo importa TIPOS (no arrastra código ni otro cálculo)', !/^\s*import\s+(?!type\b)/m.test(src));
  ok('⭐ no busca tarifas ni modos por su cuenta', !/tarifaViajeEn|modoPagoEn|calcularPagoViajes/.test(src));
  eq('todas las líneas de todos los grupos', lineas.length, 7);
  eq('⭐ el total del papel = el total de la tarjeta', R.totalDeLineas(lineas).monto, totalTarjeta);
  eq('...desglosado igual', R.totalDeLineas(lineas), { viajes: 7, pagados: 6, noFacturados: 1, pendientes: 0, monto: 75 });
}

// ── 2) POR OBRA Y POR EMPRESA: EL MISMO TOTAL ────────────────────────────────
{
  const porEmpresa = R.bloquesPago(lineas, 'empresa', NOMBRES);
  const porObra = R.bloquesPago(lineas, 'obra', NOMBRES);
  eq('por empresa: una por empresa, A→Z', porEmpresa.map((b) => [b.nombre, b.total.monto]), [['EMPRESA ALFA', 35], ['EMPRESA BETA', 40]]);
  eq('⭐ por obra: una por obra, y «Sin obra» al final', porObra.map((b) => [b.nombre, b.total.monto]), [['Obra Norte', 30], ['Obra Sur', 30], ['Sin obra', 15]]);
  const suma = (bs) => bs.reduce((a, b) => a + b.total.monto, 0);
  eq('⭐ cambiar el eje no mueve un centavo', [suma(porEmpresa), suma(porObra)], [75, 75]);
  eq('⭐ cada viaje va a UN solo bloque', [porEmpresa, porObra].map((bs) => bs.reduce((a, b) => a + b.lineas.length, 0)), [7, 7]);
  eq('el «no facturó» se cuenta en su obra, sin sumar plata', porObra[0].total, { viajes: 4, pagados: 3, noFacturados: 1, pendientes: 0, monto: 30 });
}

// ── 3) FILTRAR: SOLO ESA OBRA, SOLO ESAS EMPRESAS ────────────────────────────
{
  eq('obras que hay, con sus viajes', R.obrasDisponibles(lineas).map((o) => [o.id, o.viajes]), [['Obra Norte', 4], ['Obra Sur', 2], ['Sin obra', 1]]);
  eq('empresas que hay', R.empresasDisponibles(lineas, NOMBRES).map((e) => [e.name, e.viajes]), [['EMPRESA ALFA', 3], ['EMPRESA BETA', 4]]);

  eq('⭐ vacío = todas', R.filtrarLineasPago(lineas, R.FILTRO_PAGO_TODO).length, 7);
  const norte = R.filtrarLineasPago(lineas, { empresas: [], obras: ['Obra Norte'] });
  ok('⭐ eligiendo una obra sale SOLO esa obra', norte.length === 4 && norte.every((l) => l.viaje.ubicacion_nombre === 'Obra Norte'));
  eq('...con su total', R.totalDeLineas(norte).monto, 30);
  eq('dos obras a la vez', R.totalDeLineas(R.filtrarLineasPago(lineas, { empresas: [], obras: ['Obra Norte', 'Obra Sur'] })).monto, 60);
  eq('⭐ «Sin obra» también se puede elegir', R.filtrarLineasPago(lineas, { empresas: [], obras: ['Sin obra'] }).map((l) => l.viaje.id), ['v6']);
  eq('⭐ solo una empresa', R.totalDeLineas(R.filtrarLineasPago(lineas, { empresas: ['EB'], obras: [] })).monto, 40);
  eq('⭐ empresa Y obra a la vez: se cruzan', R.filtrarLineasPago(lineas, { empresas: ['EB'], obras: ['Obra Norte'] }).map((l) => l.viaje.id).sort(), ['v4', 'v7']);

  // Una obra marcada que ya no está en el rango no puede seguir filtrando sin verse.
  eq('⭐ lo que ya no está en el rango deja de filtrar', R.acotarFiltroPago({ empresas: ['EA', 'ZZ'], obras: ['Obra Fantasma'] }, { empresas: ['EA', 'EB'], obras: ['Obra Norte'] }), { empresas: ['EA'], obras: [] });
}

// ── 4) LAS PASTILLAS: OCULTAR NO ES FILTRAR ──────────────────────────────────
{
  eq('las diez pastillas, en el orden del Conteo de equipos', R.PASTILLAS_PAGO.map((p) => p.chip), [
    '🚫 Marca', '🚫 Modelo', '🚫 Serial / Placa', '🚫 Encargado', '🚫 Metros cúbicos', '🚫 Nombre de empresas',
    '🚫 Listado por equipo', '🚫 Cantidad por tipo', '🚫 Cantidad por zona', '🚫 Alcance del informe']);
  ok('cada pastilla es una opción que existe', R.PASTILLAS_PAGO.every((p) => p.key in R.OPCIONES_PAGO_COMPLETO));

  // ⭐ LO NUEVO ENTRA APAGADO: sin tocar nada, las columnas son las de siempre.
  eq('⭐ sin tocar nada, el listado trae las columnas de siempre', R.columnasEquipo(R.OPCIONES_PAGO_COMO_ANTES), ['code', 'zona', 'viajes', 'precio', 'monto']);
  eq('con todo encendido trae todas', R.columnasEquipo(R.OPCIONES_PAGO_COMPLETO), ['code', 'marcaModelo', 'placa', 'encargado', 'zona', 'viajes', 'm3', 'precio', 'monto']);
  const soloMarca = { ...R.OPCIONES_PAGO_COMPLETO, sinModelo: true };
  eq('marca sin modelo: la columna sigue y se llama «Marca»', [R.columnasEquipo(soloMarca).includes('marcaModelo'), R.tituloMarcaModeloPago(soloMarca)], [true, 'Marca']);
  eq('...y no suelta el modelo', R.marcaModeloPago({ marca: 'MARCA-X', modelo: 'MODELO-Y' }, soloMarca), 'MARCA-X');
  eq('sin las dos, la columna se va', R.columnasEquipo({ ...R.OPCIONES_PAGO_COMPLETO, sinMarca: true, sinModelo: true }).includes('marcaModelo'), false);
  eq('alternar enciende y apaga', [R.alternarPago(R.OPCIONES_PAGO_COMPLETO, 'sinPlaca').sinPlaca, R.alternarPago(R.alternarPago(R.OPCIONES_PAGO_COMPLETO, 'sinPlaca'), 'sinPlaca').sinPlaca], [true, false]);
}

// ── 5) EL LISTADO POR EQUIPO ─────────────────────────────────────────────────
{
  const fichas = new Map([['m1', { marca: 'MARCA-X', modelo: 'MODELO-Y', placa: 'CAT-1', encargado: 'Encargado Uno' }]]);
  const m3 = new Map([['m1', 12.5]]);
  const rs = R.renglonesPorEquipo(R.filtrarLineasPago(lineas, { empresas: ['EA'], obras: [] }), fichas, m3);
  eq('un renglón por camión, zona y tarifa', rs.map((r) => [r.code, r.zona, r.viajes, r.precio, r.monto]), [['CAMION VOLTEO', 'Este', 2, 10, 20], ['CAMION VOLTEO', 'Oeste', 1, 15, 15]]);
  eq('⭐ los m³ son los de un viaje × los viajes del renglón', rs.map((r) => r.m3), [25, 12.5]);
  eq('marca, modelo y encargado salen del catálogo', [rs[0].marca, rs[0].modelo, rs[0].encargado], ['MARCA-X', 'MODELO-Y', 'Encargado Uno']);
  eq('⭐ la placa que congeló el VIAJE manda sobre la del catálogo', rs[0].placa, 'PL-m1');
  const sinDatos = R.renglonesPorEquipo(lineas, null, null);
  ok('sin catálogo ni cubicaje no revienta: salen vacíos', sinDatos.every((r) => r.marca === '' && r.m3 === 0));
  ok('⭐ el «no facturó» no sale en el listado de pagados', !sinDatos.some((r) => r.viajes === 0) && sinDatos.reduce((a, r) => a + r.viajes, 0) === 6);
  eq('⭐ el listado suma lo mismo que el total', sinDatos.reduce((a, r) => a + r.monto, 0), 75);
}

// ── 6) POR TIPO Y POR ZONA ───────────────────────────────────────────────────
{
  eq('cantidad por tipo de equipo', R.conteoPorTipo(lineas).map((c) => [c.clave, c.viajes, c.monto]), [['CAMION VOLTEO', 5, 65], ['CHUTO CON VOLQUETA', 2, 10]]);
  eq('cantidad por zona', R.conteoPorZona(lineas).map((c) => [c.clave, c.viajes, c.pagados, c.monto]), [['Este', 4, 3, 30], ['Oeste', 3, 3, 45]]);
  eq('⭐ los dos cuadros suman el mismo total', [R.conteoPorTipo(lineas), R.conteoPorZona(lineas)].map((cs) => cs.reduce((a, c) => a + c.monto, 0)), [75, 75]);
}

// ── 7) EL PAPEL ──────────────────────────────────────────────────────────────
{
  const papel = (extra) => R.cuerpoPagoViajes({
    lineas, eje: 'empresa', filtro: R.FILTRO_PAGO_TODO, opciones: R.OPCIONES_PAGO_COMO_ANTES,
    nombresEmpresa: NOMBRES, etiquetaMotivo: L.etiquetaMotivoSinPago, ...extra,
  });
  const base = papel({});
  ok('el papel de siempre: resumen por empresa y listado', /EMPRESA ALFA/.test(base) && /<th>Camión<\/th>/.test(base) && /TOTAL A PAGAR/.test(base));
  ok('⭐ ...sin nada de lo nuevo', !/Marca|Serial \/ Placa|Encargado|<th class="r">m³|Cantidad por tipo|Cantidad por zona|Alcance del informe/.test(base));

  const completo = papel({ opciones: R.OPCIONES_PAGO_COMPLETO, fichas: new Map([['m1', { marca: 'MARCA-X', modelo: 'MODELO-Y' }]]), m3PorViaje: new Map([['m1', 12.5]]) });
  ok('con todo encendido trae columnas y cuadros nuevos', /Marca \/ Modelo/.test(completo) && /Cantidad por tipo de equipo/.test(completo) && /Cantidad por zona de pago/.test(completo) && /Alcance del informe/.test(completo) && /MARCA-X MODELO-Y/.test(completo));

  const porObra = papel({ eje: 'obra' });
  ok('⭐ por obra, el resumen y los bloques son de obras', /<th>Obra \/ ubicación<\/th>/.test(porObra) && /<h3>Obra Norte — /.test(porObra) && !/<h3>EMPRESA ALFA/.test(porObra));

  // ⭐ OCULTAR NO MUEVE EL TOTAL: el pie dice lo mismo con todo apagado.
  const pie = (h) => (h.match(/TOTAL A PAGAR<\/td>([\s\S]*?)<\/tr>/) || [])[1];
  const todoOculto = Object.fromEntries(Object.keys(R.OPCIONES_PAGO_COMPLETO).map((k) => [k, true]));
  eq('⭐ ocultar todo no cambia el total del papel', pie(papel({ opciones: todoOculto })), pie(base));
  ok('sin listado no hay bloques por equipo', !/<th>Camión<\/th>/.test(papel({ opciones: { ...R.OPCIONES_PAGO_COMO_ANTES, sinListado: true } })));

  // SIN NOMBRE DE EMPRESAS
  const anon = papel({ opciones: { ...R.OPCIONES_PAGO_COMPLETO, sinEmpresas: true }, filtro: { empresas: ['EA'], obras: [] }, lineas: R.filtrarLineasPago(lineas, { empresas: ['EA'], obras: [] }) });
  ok('⭐ sin nombres, las empresas salen numeradas', /Empresa 1/.test(anon));
  ok('⭐ ...y el nombre no se escapa por NINGÚN lado (tampoco por el alcance)', !/EMPRESA ALFA/.test(anon));
  eq('se numeran en el orden de su nombre real (para poder cruzar dos papeles)', R.bloquesPago(lineas, 'empresa', NOMBRES, { sinEmpresas: true }).map((b) => [b.nombre, b.clave]), [['Empresa 1', 'EA'], ['Empresa 2', 'EB']]);

  // ALCANCE
  const alc = R.alcancePagoEnPalabras({ empresas: ['EB'], obras: ['Obra Sur'] }, 'obra', R.OPCIONES_PAGO_COMPLETO, NOMBRES);
  ok('el alcance nombra lo elegido', alc.some((l) => /EMPRESA BETA/.test(l)) && alc.some((l) => /Obra Sur/.test(l)) && alc.some((l) => /por obra/.test(l)));
  ok('⭐ y avisa que un papel filtrado NO es el pago completo', alc.some((l) => /FILTRADO/.test(l)));
  ok('sin filtros no asusta a nadie', !R.alcancePagoEnPalabras(R.FILTRO_PAGO_TODO, 'empresa', R.OPCIONES_PAGO_COMPLETO, NOMBRES).some((l) => /FILTRADO/.test(l)));

  // NOMBRE DEL ARCHIVO: dos papeles distintos no se pisan en Descargas.
  eq('el papel de siempre no lleva sufijo', R.sufijoArchivoPago(R.FILTRO_PAGO_TODO, 'empresa', R.OPCIONES_PAGO_COMO_ANTES), '');
  ok('por obra y de una obra, lo dice', /por obra/.test(R.sufijoArchivoPago({ empresas: [], obras: ['Obra Norte'] }, 'obra', R.OPCIONES_PAGO_COMO_ANTES)) && /Obra Norte/.test(R.sufijoArchivoPago({ empresas: [], obras: ['Obra Norte'] }, 'obra', R.OPCIONES_PAGO_COMO_ANTES)));
  ok('sin caracteres que Windows no acepta', !/[\\/:*?"<>|]/.test(R.sufijoArchivoPago({ empresas: [], obras: ['Obra: A/B'] }, 'obra', R.OPCIONES_PAGO_COMO_ANTES)));
}

// ── 8) LA PANTALLA ───────────────────────────────────────────────────────────
{
  const ui = sinComentarios(leer('src/components/PagoViajesResumen.tsx'));
  ok('⭐ el papel sale de las MISMAS líneas de la tarjeta', /lineasDeGrupos\(empresas\.map\(\(e\) => e\.g\)\)/.test(ui));
  ok('⭐ arranca con el papel de siempre', /useState<OpcionesPagoViajes>\(OPCIONES_PAGO_COMO_ANTES\)/.test(ui));
  ok('⭐ un papel filtrado SIEMPRE lleva el alcance, aunque lo apaguen', /opciones: pdfFiltrado \? \{ \.\.\.opcionesPdf, sinAlcance: false \} : opcionesPdf/.test(ui));
  ok('⭐ el filtro se acota a lo que hay en el rango', /acotarFiltroPago\(/.test(ui));
  ok('sin viajes con ese filtro, el botón no deja', /!lineasPdf\.length\)/.test(ui));
  ok('la lista de «no entran al pago» solo va sin filtrar', /const fuera = !pdfFiltrado && fueraDelPago\.length/.test(ui));
  ok('se puede agrupar por obra', /setEjePdf\('obra'\)/.test(ui));
  ok('el PDF ya no arma su propio cálculo a mano', !/itemsViajePagados/.test(ui));
  ok('la pantalla le pasa los m³ de Cubicaje', /m3PorViaje=\{m3PorViajePago\}/.test(leer('src/screens/ViajesCamionesScreen.tsx')));
  ok('el cargador trae la ficha del camión', /selectAllRows\('machinery', 'id, marca, modelo, plate, serial, encargado'\)/.test(leer('src/lib/pagoViajesDb.ts')));
}

// ── 9) MANUALES ──────────────────────────────────────────────────────────────
{
  ok('manual (md) lo explica', /PDF del pago de viajes: por obra, por empresa y con opciones \(21\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app) también', /PDF DEL PAGO DE VIAJES: POR OBRA, POR EMPRESA Y CON OPCIONES \(21\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-pago-viajes-reporte · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
