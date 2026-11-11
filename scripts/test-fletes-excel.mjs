// 📊 FLETES POR EXCEL (11-nov-2026). Fija:
//   · leer la plantilla (o una relación bajada) aunque cambien mayúsculas/acentos o haya un título encima,
//   · validar fila por fila: fecha, viajes, tipo, precio, vehículo del Catálogo, empresa,
//   · ⭐ NO REPETIR: dos veces en el archivo, o ya en el sistema (incluidos los importados de Viajes sin ruta),
//   · la VUELTA COMPLETA: bajar la relación en Excel y volver a subirla → todo sale «repetido», nada se duplica,
//   · que se guarda igual que el formulario (misma nota) y que la pantalla no guarda nada sin confirmar.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const XLSX = require('xlsx-js-style');
const Module = require('module');
const orig = Module._load;
Module._load = function (r) {
  if (r === 'react-native') return { Platform: { OS: 'node' } };
  if (r === './pdf') return { exportPdf: async () => true, nowStamp: () => '11/11/2026' };
  if (r === './logoData') return { LOGO_DATA_URI: '' };
  if (r === './supabase') return {};
  return orig.apply(this, arguments);
};
require.extensions['.ts'] = function (mod, fn) {
  mod._compile(ts.transpileModule(fs.readFileSync(fn, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText, fn);
};
const X = require(path.join(ROOT, 'src/lib/fletesExcel.ts'));
const P = require(path.join(ROOT, 'src/lib/fletePdf.ts'));

let ok = 0; const fallas = [];
const check = (c, m, x) => { if (c) ok++; else fallas.push('  ✗ ' + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const eq = (a, b, m) => check(JSON.stringify(a) === JSON.stringify(b), m, { esperado: b, obtenido: a });
const libro = (aoa) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Fletes'); return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }); };

const VEH = [
  { id: 'm1', code: 'CHUTO CON LOWBOY', plate: 'A22CY0J/LOW123', company_id: 'c1' },
  { id: 'm2', code: 'CHUTO CON VOLQUETA', plate: 'A43AT7M', company_id: 'c2' },
  { id: 'm3', code: 'VOLTEO 01', plate: 'XYZ999', company_id: null },
  { id: 'm4', code: 'VOLTEO 02', plate: 'XYZ999', company_id: 'c1' },
];
const EMP = [{ id: 'c1', name: 'Construcciones Liccione, C.A' }, { id: 'c2', name: 'GOLDEN TOUCH 1127 CA' }];

// ── 1) Leer: encabezados por palabra clave, título encima, fila TOTAL fuera ──
{
  const r = X.leerExcelFletes(libro([
    ['RELACIÓN DE VIAJES'], [],
    ['Fecha', 'Nombre y apellido', 'Vehiculo', 'Equipo', 'Origen', 'Destino', 'Viajes', 'Quien lo autoriza', 'Tipo', 'Precio por viaje ($)', 'Empresa', 'Cliente', 'Nota'],
    ['23/10/2026', 'JOSE GOMEZ', 'A22CY0J', 'JUMBO MARTILLO', 'BARCELONA', 'LA GUAIRA', 1, 'EZEQUIEL GOMEZ', 'POR COBRAR', '150,50', '', 'Obra X', ''],
    [], ['TOTAL', '', '', '', '', '', 1],
  ]));
  eq([r.error, r.filas.length, r.filas[0].n, r.filas[0].chofer, r.filas[0].autoriza, r.filas[0].precio], [null, 1, 4, 'JOSE GOMEZ', 'EZEQUIEL GOMEZ', '150,50'], '⭐ lee la hoja aunque tenga un título encima; salta vacías y la fila TOTAL');
  check(/FECHA y VIAJES/.test(X.leerExcelFletes(libro([['a', 'b'], [1, 2]])).error), 'un Excel que no es la plantilla: lo dice');
  { const r = X.leerExcelFletes(new Uint8Array([1, 2, 3]).buffer); check(r.filas.length === 0 && /No se pudo leer|FECHA y VIAJES/.test(r.error), 'un archivo que no es Excel: lo dice y no carga nada'); }
}
eq([X.fechaDeCelda('23/10/2026'), X.fechaDeCelda('2026-10-23'), X.fechaDeCelda(46318), X.fechaDeCelda('31/02/2026'), X.fechaDeCelda('')], ['2026-10-23', '2026-10-23', '2026-10-23', null, null], 'fechas: dd/mm/aaaa, aaaa-mm-dd y número de Excel; las imposibles no pasan');
eq([X.tipoDeCelda(''), X.tipoDeCelda('Por cobrar'), X.tipoDeCelda('EXENTO'), X.tipoDeCelda('POR_PAGAR'), X.tipoDeCelda('xx')], ['pagar', 'cobrar', 'exento', 'pagar', null], 'tipo: vacío = por pagar (como el formulario)');
eq([X.buscarVehiculo('a22cy0j', VEH).v?.id, X.buscarVehiculo('LOW123', VEH).v?.id, X.buscarVehiculo('chuto con volqueta', VEH).v?.id, X.buscarVehiculo('NOEXISTE', VEH).v], ['m1', 'm1', 'm2', null], 'vehículo por placa, por un pedazo de «CHUTO/LOWBOY» o por código');
check(X.buscarVehiculo('XYZ999', VEH).varios === true, 'dos vehículos con la misma placa: se avisa');

// ── 2) Validar ──
const fila = (o) => ({ n: o.n ?? 2, fecha: '23/10/2026', viajes: 1, tipo: 'POR PAGAR', precio: 100, vehiculo: 'A22CY0J', ...o });
const val = (filas, existentes = []) => X.validarFilasFletes(filas, { vehiculos: VEH, empresas: EMP, existentes });
{
  const [a] = val([fila({ chofer: 'Jose', origen: 'Barcelona', destino: 'La Guaira', equipo: 'Jumbo', autoriza: 'Ezequiel', cliente: 'Obra X' })]);
  eq([a.estado, a.insertar.company_id, a.insertar.machinery_id, a.insertar.code, a.insertar.flete_date, a.insertar.viajes, a.insertar.precio], ['nueva', 'c1', 'm1', 'CHUTO CON LOWBOY', '2026-10-23', 1, 100], '⭐ fila buena → nueva; la empresa sale del vehículo si no se escribe');
  const p = P.parseFleteNote(a.insertar.note);
  eq([p.operacionTipo, p.operacionEstado, p.conductor, p.origen, p.destino, p.equipo, p.autoriza, p.cliente, p.detalle], ['pagar', 'pendiente', 'Jose', 'Barcelona', 'La Guaira', 'Jumbo', 'Ezequiel', 'Obra X', 'Cargado desde Excel'], '⭐ se guarda con la MISMA nota que el formulario (chofer, ruta, equipo, autoriza, cliente)');
  const errs = val([
    fila({ n: 3, fecha: '32/13/2026' }), fila({ n: 4, viajes: 0 }), fila({ n: 5, viajes: '1,5' }), fila({ n: 6, tipo: 'raro' }),
    fila({ n: 7, precio: '' }), fila({ n: 8, vehiculo: 'NOEXISTE' }), fila({ n: 9, vehiculo: '', empresa: '' }), fila({ n: 10, empresa: 'Empresa Fantasma' }),
  ]);
  check(errs.every((e) => e.estado === 'error' && e.insertar === null && e.errores.length > 0), '⭐ fecha mala, viajes 0 o con decimales, tipo raro, sin precio, vehículo fuera del Catálogo, sin empresa o empresa inexistente → ERROR, no se sube', errs.map((e) => [e.n, e.estado]));
  eq(val([fila({ tipo: 'EXENTO', precio: '' })])[0].estado, 'nueva', 'un EXENTO puede ir sin precio');
  const gen = val([fila({ vehiculo: '', empresa: 'golden touch 1127 ca' })])[0];
  eq([gen.estado, gen.insertar.machinery_id, gen.insertar.code, gen.insertar.company_id], ['nueva', null, 'General', 'c2'], 'sin vehículo = «General», con la empresa escrita (sin importar mayúsculas)');
  check(val([fila({ vehiculo: 'XYZ999', empresa: 'Golden Touch 1127 CA' })])[0].avisos.some((x) => /varios vehículos/.test(x)), 'placa repetida en el Catálogo: avisa cuál tomó');
}

// ── 3) ⭐⭐ NO REPETIR ──
{
  const dentro = val([fila({ n: 2, chofer: 'Jose' }), fila({ n: 3, chofer: 'Jose' }), fila({ n: 4, chofer: 'Pedro' })]);
  eq(dentro.map((f) => f.estado), ['nueva', 'repetida_archivo', 'nueva'], '⭐ la misma fila dos veces en el archivo → la segunda «repetida»; otro chofer es otro flete');
  check(/fila 2/.test(dentro[1].avisos[0]), 'dice con cuál fila se repite');
  const existentes = [
    { flete_date: '2026-10-23', machinery_id: 'm1', viajes: 1, note: '[POR_COBRAR|ESTADO:pendiente|CLIENTE:x|VIAJES_IDS:v1|TICKETS:T1] importado' },
  ];
  eq(val([fila({ origen: 'Barcelona', destino: 'La Guaira' })], existentes)[0].estado, 'repetida_sistema', '⭐⭐ ya está en el sistema (aunque el importado de Viajes no tenga ruta) → «repetida», no se sube');
  eq(val([fila({ viajes: 2 })], existentes)[0].estado, 'nueva', 'otro número de viajes ese día: es otro flete');
  eq(val([fila({ fecha: '24/10/2026' })], existentes)[0].estado, 'nueva', 'otro día: nuevo');
  const conRuta = [{ flete_date: '2026-11-01', machinery_id: 'm2', viajes: 1, note: '[EXENTO|ORIGEN:QUINTA YANS|DEST:LA CANTERA] x' }];
  eq([val([fila({ fecha: '01/11/2026', vehiculo: 'A43AT7M', origen: 'Quinta Yans', destino: 'La Cantera' })], conRuta)[0].estado, val([fila({ fecha: '01/11/2026', vehiculo: 'A43AT7M', origen: 'La Cantera', destino: 'Centro de acopio' })], conRuta)[0].estado], ['repetida_sistema', 'nueva'], '⭐ mismo chuto y día pero OTRA ruta = otro viaje (como los dos del 01/11)');
}

// ── 4) ⭐⭐ LA VUELTA COMPLETA: bajar la relación en Excel y volver a subirla ──
{
  const filasXls = [
    { fecha: '2026-10-23', chofer: 'JOSE GOMEZ', vehiculo: 'A22CY0J', equipo: 'JUMBO', origen: 'BARCELONA', destino: 'LA GUAIRA', viajes: 1, autoriza: 'EZEQUIEL', tipo: 'cobrar', precio: 150, empresa: 'Construcciones Liccione, C.A', cliente: 'Obra', nota: 'n1' },
    { fecha: '2026-11-01', chofer: 'LUIS', vehiculo: 'A43AT7M', equipo: 'JUMBO', origen: 'QUINTA YANS', destino: 'LA CANTERA', viajes: 1, autoriza: 'JOEL', tipo: 'exento', precio: 0, empresa: 'GOLDEN TOUCH 1127 CA', cliente: '', nota: '' },
  ];
  const aoa = X.filasRelacionExcel(filasXls);
  eq(aoa[aoa.length - 1].slice(0, 7), ['TOTAL', '', '', '', '', '', 2], 'la relación en Excel termina con TOTAL de viajes');
  const leido = X.leerExcelFletes(libro([[...X.COLUMNAS_FLETES], ...aoa]));
  eq(leido.filas.length, 2, 'al volver a subirla se leen las 2 filas (el TOTAL no)');
  const sinNada = val(leido.filas);
  eq(sinNada.map((f) => f.estado), ['nueva', 'nueva'], 'en un sistema vacío, las dos se cargarían');
  const yaEstan = sinNada.map((f) => ({ flete_date: f.insertar.flete_date, machinery_id: f.insertar.machinery_id, viajes: f.insertar.viajes, note: f.insertar.note }));
  eq(val(leido.filas, yaEstan).map((f) => f.estado), ['repetida_sistema', 'repetida_sistema'], '⭐⭐ si ya están en el sistema, volver a subir la MISMA relación no duplica nada');
}

// ── 5) Cableado de la pantalla ──
{
  const scr = fs.readFileSync(path.join(ROOT, 'src/screens/ServicioFletesScreen.tsx'), 'utf8');
  check(/onPress=\{bajarPlantilla\}/.test(scr) && /onPress=\{subirExcel\}/.test(scr) && /onPress=\{bajarRelacionExcel\}/.test(scr), 'los tres botones: plantilla, subir y relación en Excel');
  check(/setCargaExcel\(\{ filas, incluir: new Set\(filas\.filter\(\(f\) => f\.estado === 'nueva'\)/.test(scr), '⭐ al subir solo se PREPARA la vista previa (marcadas solo las nuevas)');
  check(/\.from\('fletes'\)\.select\('flete_date, machinery_id, viajes, note'\)\.in\('flete_date'/.test(scr) && /No se cargó nada/.test(scr), 'revisa lo que ya existe esas fechas; si no puede, no carga nada');
  check(/f\.insertar && f\.estado !== 'error' && cargaExcel\.incluir\.has\(f\.n\)/.test(scr) && /\.length !== tramo\.length/.test(scr), '⭐ guarda solo lo marcado, sin errores, y verifica que la base lo aceptó todo');
  check(/Cancelar \(no cargar nada\)/.test(scr), 'se puede cancelar sin cargar nada');
  check(/const \{ coName, filas, notas \} = await armarRelacion\(\);/.test(scr) && /const \{ coName, filas \} = await armarRelacion\(\);/.test(scr), 'el PDF y el Excel de la relación salen de los MISMOS datos');
}

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-fletes-excel: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-fletes-excel: ${ok} ok, 0 fallas`);
