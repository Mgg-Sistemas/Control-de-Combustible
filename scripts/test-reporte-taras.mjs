/*
 * ════════════════════════════════════════════════════════════════════════════
 * ⚖️ REPORTE DE TARAS POR CAMIÓN — 06-oct-2026.
 *
 * Pedido del cliente: un reporte de los camiones que ya tienen la tara cargada
 * («hasta ahora tenemos 40»), como el de m³ que ya no usan, y poder quitar el
 * nombre de las empresas: «no pueden aparecer por ningún lado, solo Jhenzaen».
 *
 * ── LO QUE FIJA ────────────────────────────────────────────────────────────
 * ⭐ «X DE N»: el resumen se cuenta sobre la flota entera aunque la tabla
 *    muestre solo los que tienen tara.
 * ⭐ EXENTO MANDA: un camión que no pasa por romana no cuenta como «con tara»
 *    aunque tenga una guardada en espera.
 * ⚠️ SIN EMPRESA ES SIN EMPRESA: apagada la opción, el nombre no aparece en
 *    NINGÚN lado del HTML ni del nombre del archivo.
 *
 *   node scripts/test-reporte-taras.mjs
 * ════════════════════════════════════════════════════════════════════════════
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
function cargarAbs(abs) {
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
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return cargarAbs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}
const cargar = (rel) => cargarAbs(path.join(ROOT, rel));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const R = cargar('src/lib/reporteTaras.ts');
const {
  filasDeTaras, resumenTaras, cuerpoReporteTaras, OPCIONES_TARAS_POR_DEFECTO,
  nombreArchivoTaras, fechaCaracas, pesoTexto, subtituloReporteTaras,
} = R;

const cam = (id, code, plate, empresa) => ({ id, code, plate, serial: null, marca: 'Mack', modelo: 'Granite', companyName: empresa });
const CAMIONES = [
  cam('a', 'Camion Volteo Toronto', 'A10BB2C', 'Transportes Pérez C.A'),
  cam('b', 'Camion Volteo Toronto', 'A05XX1Z', 'Inversiones El Sol'),
  cam('c', 'Volqueta 12', 'B77CC3D', 'Transportes Pérez C.A'),
  cam('d', 'Volqueta 14', null, 'Inversiones El Sol'),
];
const tara = (kg, extra = {}) => ({ pesoTaraKg: kg, updatedAt: '2026-10-06T14:00:00Z', updatedByNombre: 'María', exentoRomana: false, ...extra });
const TARAS = new Map([
  ['a', tara(11340)],
  ['b', tara(12000)],
  ['c', tara(9000, { exentoRomana: true })], // exento con tara en espera
]);

// ── 1) Filas y orden ────────────────────────────────────────────────────────
eq('⭐ por defecto salen solo los que tienen tara',
  filasDeTaras(CAMIONES, TARAS).map((f) => f.camion.id), ['b', 'a']);
eq('mismo código: ordena por placa', filasDeTaras(CAMIONES, TARAS).map((f) => f.camion.plate), ['A05XX1Z', 'A10BB2C']);
eq('toda la flota: con tara primero, luego sin tara, luego exentos',
  filasDeTaras(CAMIONES, TARAS, 'todos').map((f) => `${f.camion.id}:${f.estado}`),
  ['b:conTara', 'a:conTara', 'd:sinTara', 'c:exento']);
eq('⭐ el exento NO cuenta como con tara aunque tenga una guardada',
  filasDeTaras(CAMIONES, TARAS, 'todos').find((f) => f.camion.id === 'c').estado, 'exento');
eq('una tara en cero o negativa es «sin tara»',
  filasDeTaras([cam('z', 'X', null, null)], new Map([['z', tara(0)]]), 'todos')[0].estado, 'sinTara');

// ── 2) Resumen sobre la flota entera ────────────────────────────────────────
eq('⭐ resumen: X de N', resumenTaras(CAMIONES, TARAS),
  { flota: 4, conTara: 2, sinTara: 1, exentos: 1, mayorKg: 12000, menorKg: 11340, promedioKg: 11670 });
eq('sin taras: mayor/menor/promedio quedan en null (raya, no cero)',
  resumenTaras(CAMIONES, new Map()), { flota: 4, conTara: 0, sinTara: 4, exentos: 0, mayorKg: null, menorKg: null, promedioKg: null });
eq('subtítulo', subtituloReporteTaras(resumenTaras(CAMIONES, TARAS), 'conTara'), '2 camión(es) con tara cargada de 4 en la flota');

// ── 3) Unidades y fechas ────────────────────────────────────────────────────
// ⭐ CAMBIÓ EL REQUISITO (07-oct-2026, en tres mensajes del mismo día:
//    «redondea la cifra» → «que sea un solo decimal» → «déjale un solo decimal
//    como el ejemplo»). Este papel salía con DOS decimales en Kg y dos en Ton;
//    ahora lleva UNO, sea cual sea la unidad.
eq('⭐ kg del papel, con un decimal', pesoTexto(11340, 'kg'), '11.340,0 Kg');
eq('⭐ toneladas del papel, con UN decimal', pesoTexto(11345, 't'), '11,3 Ton');
// ⚠️ Kilos enteros y toneladas con uno: una tonelada son mil kilos y «11,34 →
//    11» borra 340 kg de una tara; un kilo con decimales es relleno.
ok('⚠️ las toneladas llevan UNO, no dos', /,\d\s*Ton/.test(pesoTexto(11345, 't')) && !/,\d\d/.test(pesoTexto(11345, 't')));
ok('⚠️ los kilos llevan UNO, no dos', /,\d\s*Kg/.test(pesoTexto(11340, 'kg')) && !/,\d\d/.test(pesoTexto(11340, 'kg')));
ok('⚠️ no queda una coma huérfana ni un «undefined» donde iban los decimales',
  !/,\s*(Kg|Ton)|undefined/.test([pesoTexto(11340, 'kg'), pesoTexto(11345, 't'), pesoTexto(0, 'kg')].join(' ')));
eq('sin peso = raya', pesoTexto(null, 'kg'), '—');
eq('fecha en hora de Caracas (02:00Z del 07 es el 06 en Caracas)', fechaCaracas('2026-10-07T02:00:00Z'), '06/10/2026');
eq('fecha inválida = vacío', fechaCaracas('basura'), '');

// ── 4) Sin empresa es sin empresa ───────────────────────────────────────────
const conEmpresa = cuerpoReporteTaras(CAMIONES, TARAS, { ...OPCIONES_TARAS_POR_DEFECTO, alcance: 'todos' });
ok('con la opción encendida, la empresa sale', conEmpresa.includes('Inversiones El Sol') && conEmpresa.includes('<th>Empresa</th>'));
const sinEmpresa = cuerpoReporteTaras(CAMIONES, TARAS, { ...OPCIONES_TARAS_POR_DEFECTO, alcance: 'todos', empresa: false });
ok('⚠️ apagada: ningún nombre de empresa en el HTML',
  !sinEmpresa.includes('Inversiones El Sol') && !sinEmpresa.includes('Pérez') && !sinEmpresa.includes('P&eacute;rez'));
ok('⚠️ apagada: tampoco el encabezado ni «Sin empresa»', !/empresa/i.test(sinEmpresa));
ok('⚠️ el nombre del archivo nunca lleva empresa',
  !/P[ée]rez|Sol/.test(nombreArchivoTaras('todos', '2026-10-06')));
eq('nombre del archivo', nombreArchivoTaras('conTara', '2026-10-06'), 'Reporte de taras 06-10-2026');
eq('nombre del archivo, flota completa', nombreArchivoTaras('todos', '2026-10-06'), 'Reporte de taras (flota completa) 06-10-2026');

// ── 5) Columnas opcionales y escape ─────────────────────────────────────────
const sinExtras = cuerpoReporteTaras(CAMIONES, TARAS, { ...OPCIONES_TARAS_POR_DEFECTO, marcaModelo: false, cargadaPor: false });
ok('sin marca/modelo ni quién', !sinExtras.includes('Marca / modelo') && !sinExtras.includes('Cargada por') && !sinExtras.includes('Mack'));
ok('solo con tara: no sale la columna Estado', !sinExtras.includes('<th>Estado</th>'));
ok('con tara: sale quién la cargó', cuerpoReporteTaras(CAMIONES, TARAS, OPCIONES_TARAS_POR_DEFECTO).includes('María · 06/10/2026'));
ok('el HTML se escapa', cuerpoReporteTaras([cam('x', '<b>X</b>', null, null)], new Map([['x', tara(5000)]]), OPCIONES_TARAS_POR_DEFECTO).includes('&lt;b&gt;X&lt;/b&gt;'));
ok('vacío: lo dice en vez de una tabla en blanco', cuerpoReporteTaras(CAMIONES, new Map(), OPCIONES_TARAS_POR_DEFECTO).includes('Todavía no hay camiones con tara cargada'));

// ── LAS TARJETAS DE ARRIBA (07-oct-2026) ────────────────────────────────────
// Pedido textual: «quítame esto, solo coloca el total de camiones y los totales
// de las taras». Se fueron «N de M con tara cargada», «sin tara» y «no pasan por
// romana»: eran el estado de la carga del dato, no el dato.
{
  const kpis = (op) => {
    const html = cuerpoReporteTaras(CAMIONES, TARAS, { ...OPCIONES_TARAS_POR_DEFECTO, ...op });
    return [...html.matchAll(/<div class="kpi"><div class="v">(.*?)<\/div><div class="t">(.*?)<\/div>/g)]
      .map((m) => [m[1], m[2]]);
  };
  const soloConTara = kpis({});
  eq('⭐ quedan CUATRO tarjetas: el total y las tres taras',
    soloConTara.map((k) => k[1]), ['CAMIONES', 'TARA PROMEDIO', 'TARA MAYOR', 'TARA MENOR']);
  // ⚠️ El total tiene que cuadrar con la lista que va debajo, o manda a recontar
  //    a mano: con «solo con tara» son 2 (a y b), no los 4 de la flota.
  eq('⭐ el total es el de las filas que SALEN, no el de la flota', soloConTara[0][0], '2');
  eq('⭐ con la flota completa, el total es el de la flota', kpis({ alcance: 'todos' })[0][0], '4');
  eq('las taras siguen saliendo, ya redondeadas', soloConTara.slice(1).map((k) => k[0]),
    ['11.670,0 Kg', '12.000,0 Kg', '11.340,0 Kg']);
  eq('un solo camión se dice en singular',
    cuerpoReporteTaras([CAMIONES[0]], new Map([['a', tara(11340)]]), OPCIONES_TARAS_POR_DEFECTO)
      .includes('<div class="t">CAMIÓN</div>'), true);
  // ⚠️ Lo que se quitó no puede volver por ningún lado del papel.
  const todo = cuerpoReporteTaras(CAMIONES, TARAS, { ...OPCIONES_TARAS_POR_DEFECTO, alcance: 'todos' });
  ok('⚠️ ya no sale «CAMIONES CON TARA CARGADA»', !todo.includes('CAMIONES CON TARA CARGADA'));
  ok('⚠️ ni la tarjeta «SIN TARA»', !/<div class="t">SIN TARA<\/div>/.test(todo));
  ok('⚠️ ni «NO PASAN POR ROMANA»', !todo.includes('NO PASAN POR ROMANA'));
  // Pero el DATO sigue estando donde se puede leer camión por camión.
  ok('el estado se sigue viendo en la columna Estado', todo.includes('<th>Estado</th>') && todo.includes('No pasa por romana'));
}

// ── Opciones nuevas del 19-oct-2026 (como frentes y obras/ubicaciones) ──────
{
  const { sufijoArchivoTaras } = R;
  const camsClasif = CAMIONES.map((c) => ({ ...c, clasificacion: c.id === 'a' ? 'GRAN CAPACIDAD' : null }));
  const OP = OPCIONES_TARAS_POR_DEFECTO;
  const base = cuerpoReporteTaras(camsClasif, TARAS, OP);
  ok('el papel de siempre: con N°, placa, resumen y nota', /N°/.test(base) && /Placa \/ serial/.test(base) && /class="kpis"/.test(base) && /nota-t/.test(base));
  ok('…y la clasificación NO sale (nace apagada)', !base.includes('Clasificación') && !base.includes('GRAN CAPACIDAD'));
  const sinNum = cuerpoReporteTaras(camsClasif, TARAS, { ...OP, numeracion: false });
  ok('⭐ sin numeración: ni la columna ni rastro', !/<th class="n">N°<\/th>/.test(sinNum));
  const sinPlaca = cuerpoReporteTaras(camsClasif, TARAS, { ...OP, placa: false });
  ok('⭐ sin placa: la placa no sale por ningún lado', !sinPlaca.includes('A10BB2C') && !sinPlaca.includes('Placa / serial'));
  const conClasif = cuerpoReporteTaras(camsClasif, TARAS, { ...OP, clasificacion: true });
  ok('⭐ con clasificación: columna y dato (— si no tiene)', conClasif.includes('<th>Clasificación</th>') && conClasif.includes('GRAN CAPACIDAD'));
  // 👤 Columna Chofer (19-oct-2026): sale de «Choferes por camión» (día/noche).
  const camsChofer = CAMIONES.map((c) => (
    c.id === 'a' ? { ...c, choferDia: 'Juan Pérez', choferNoche: 'Luis Mora' }
    : c.id === 'b' ? { ...c, choferDia: 'Ana Gil', choferNoche: 'Ana Gil' }
    : c));
  ok('⭐ la columna Chofer NO sale por defecto', !cuerpoReporteTaras(camsChofer, TARAS, OP).includes('<th>Chofer</th>'));
  const conChofer = cuerpoReporteTaras(camsChofer, TARAS, { ...OP, chofer: true });
  ok('⭐ encendida: columna y nombres', conChofer.includes('<th>Chofer</th>') && conChofer.includes('Juan Pérez'));
  ok('⭐ día y noche distintos: salen los dos con ☀️/🌙', /☀️ Juan Pérez · 🌙 Luis Mora/.test(conChofer));
  ok('⭐ el mismo en los dos turnos: el nombre solo, sin iconos', /<td>Ana Gil<\/td>/.test(conChofer));
  ok('el camión sin chofer sale con guion', cuerpoReporteTaras([{ ...CAMIONES[0], choferDia: null, choferNoche: null }], new Map([['a', tara(1000)]]), { ...OP, chofer: true }).includes('<td>—</td>'));
  ok('⭐ el sufijo del archivo dice «con chofer»', /con chofer/.test(sufijoArchivoTaras({ ...OP, chofer: true })));

  const sinKpis = cuerpoReporteTaras(camsClasif, TARAS, { ...OP, kpis: false });
  ok('⭐ sin resumen: las tarjetas no salen', !/class="kpis"/.test(sinKpis) && !sinKpis.includes('TARA PROMEDIO'));
  const sinNota = cuerpoReporteTaras(camsClasif, TARAS, { ...OP, notaPie: false });
  ok('⭐ sin nota al pie: desaparece entera', !/nota-t/.test(sinNota) && !sinNota.includes('peso del camión vacío'));
  const sinEstado = cuerpoReporteTaras(camsClasif, TARAS, { ...OP, alcance: 'todos', estado: false });
  ok('⭐ sin estado (flota completa): la columna no sale', !sinEstado.includes('<th>Estado</th>') && !sinEstado.includes('No pasa por romana'));
  const unica = cuerpoReporteTaras(camsClasif, TARAS, { ...OP, empresaUnica: 'Jhenzaen 2.012 C.A' });
  ok('⭐ empresa única: todos a nombre de ella y las reales NO salen',
    unica.includes('Jhenzaen 2.012 C.A') && !unica.includes('Transportes Pérez') && !/Inversiones El Sol/.test(unica));
  ok('⭐ …pero solo en el papel: sin empresaUnica vuelven las reales', base.includes('Transportes Pérez C.A'));
  // Opciones viejas guardadas (sin las claves nuevas): el papel sale como siempre.
  const viejo = cuerpoReporteTaras(camsClasif, TARAS, { alcance: 'conTara', unidad: 'kg', empresa: true, marcaModelo: true, cargadaPor: true });
  ok('⭐ opciones guardadas de antes del 19-oct siguen valiendo (todo lo de siempre sale)',
    /N°/.test(viejo) && /Placa \/ serial/.test(viejo) && /class="kpis"/.test(viejo) && /nota-t/.test(viejo) && !viejo.includes('Clasificación'));
  // El nombre del archivo dice lo cambiado; nunca el nombre de la empresa.
  eq('el archivo de siempre no lleva sufijo', sufijoArchivoTaras(OP), '');
  ok('⭐ el sufijo nombra lo cambiado', /sin numeración/.test(sufijoArchivoTaras({ ...OP, numeracion: false })) && /con clasificación/.test(sufijoArchivoTaras({ ...OP, clasificacion: true })));
  ok('⭐ la empresa única va al archivo SIN el nombre', sufijoArchivoTaras({ ...OP, empresaUnica: 'Jhenzaen 2.012 C.A' }) === ' (a nombre de una empresa)');
  ok('nombreArchivoTaras acepta las opciones y mantiene la fecha',
    nombreArchivoTaras('conTara', '2026-10-19', { ...OP, placa: false }).includes('19-10-2026') && nombreArchivoTaras('conTara', '2026-10-19', { ...OP, placa: false }).includes('sin placa'));
  // La pantalla pinta los toggles nuevos y pasa las opciones al nombre del archivo.
  const comp = fs.readFileSync(path.join(ROOT, 'src/components/ReporteTarasBox.tsx'), 'utf8');
  ok('⭐ la pantalla tiene los toggles nuevos', /Numeración/.test(comp) && /Clasificación por capacidad/.test(comp) && /una sola empresa/.test(comp) && /Nota al pie/.test(comp) && /label="👤 Chofer"/.test(comp) && /label="⛽ Combustible \(L\)"/.test(comp));
  ok('⭐ …y los choferes se leen solo si la columna está encendida', /op\.chofer === true\) \{[\s\S]*listOperatorAssignments\(\)/.test(comp));
  ok('⭐ …y el nombre del archivo lleva las opciones', /nombreArchivoTaras\(op\.alcance, caracasBusinessToday\(\), op\)/.test(comp));

  // ⛽ Columna Combustible (L) y total por día
  const { litrosTexto, resumenCombustibleTaras } = R;
  eq('litrosTexto formatea enteros y decimales', [litrosTexto(120), litrosTexto(125.5), litrosTexto(1250), litrosTexto(null), litrosTexto(0)], ['120 L', '125,5 L', '1.250 L', '—', '—']);
  const tarasConFuel = new Map([
    ['a', tara(11340, { combustibleLitros: 150 })],
    ['b', tara(12000, { combustibleLitros: 80.5 })],
  ]);
  eq('resumenCombustibleTaras suma litros de las filas', resumenCombustibleTaras(CAMIONES, tarasConFuel, 'conTara'), { conCombustible: 2, totalLitros: 230.5 });
  const htmlConFuel = cuerpoReporteTaras(CAMIONES, tarasConFuel, OP);
  ok('⭐ columna Combustible (L) sale en la tabla con cada equipo y el total', htmlConFuel.includes('<th class="r">Combustible (L)</th>') && htmlConFuel.includes('150 L') && htmlConFuel.includes('80,5 L') && htmlConFuel.includes('230,5 L') && htmlConFuel.includes('TOTAL COMBUSTIBLE'));
  const htmlSinFuelCol = cuerpoReporteTaras(CAMIONES, tarasConFuel, { ...OP, combustible: false });
  ok('⭐ apagada la columna Combustible, no sale en la tabla ni en las tarjetas', !htmlSinFuelCol.includes('Combustible (L)') && !htmlSinFuelCol.includes('150 L') && !htmlSinFuelCol.includes('TOTAL COMBUSTIBLE'));
  ok('⭐ el sufijo del archivo indica «sin combustible» cuando se apaga', /sin combustible/.test(sufijoArchivoTaras({ ...OP, combustible: false })));
}

if (fail) {
  console.error(failures.join('\n'));
  console.error(`\n✗ reporte de taras: ${fail} fallo(s), ${pass} ok`);
  process.exit(1);
}
console.log(`✓ reporte de taras: ${pass} pruebas ok`);
