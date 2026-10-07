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
eq('kg con formato del papel', pesoTexto(11340, 'kg'), '11.340,00 Kg');
eq('toneladas con DOS decimales', pesoTexto(11345, 't'), '11,35 Ton');
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
  eq('las taras siguen saliendo', soloConTara.slice(1).map((k) => k[0]),
    ['11.670,00 Kg', '12.000,00 Kg', '11.340,00 Kg']);
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

if (fail) {
  console.error(failures.join('\n'));
  console.error(`\n✗ reporte de taras: ${fail} fallo(s), ${pass} ok`);
  process.exit(1);
}
console.log(`✓ reporte de taras: ${pass} pruebas ok`);
