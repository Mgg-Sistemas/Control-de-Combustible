// 🛠️ Pruebas del REPORTE PERSONALIZADO DE MAQUINARIA (09-oct-2026).
//
// La regla de oro de este papel: RECIBE información del sistema pero NO ENVÍA
// nada. Los candados de abajo vigilan que la tarjeta no tenga ni un
// insert/update/delete/rpc, que la librería sea pura y que todo sea editable.
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
function loadTs(abs) {
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
      for (const c of [p + '.ts', p + '.tsx', path.join(p, 'index.ts')]) if (fs.existsSync(c)) return loadTs(c);
    }
    return orig(id);
  };
  m._compile(out, m.filename);
  cache.set(abs, m.exports);
  return m.exports;
}

const L = loadTs(path.join(ROOT, 'src/lib/reporteMaquinariaPersonalizado.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ——— 1. Fechas ———
eq('dmy: 2026-10-09 → 09/10/2026', L.dmyPersonalizado('2026-10-09'), '09/10/2026');
eq('dmy: basura → vacío', L.dmyPersonalizado('hoy'), '');
eq('emitida: 2026-10-09 → 09 oct. 2026', L.emitidaTexto('2026-10-09'), '09 oct. 2026');
eq('emitida: 2026-01-03 → 03 ene. 2026', L.emitidaTexto('2026-01-03'), '03 ene. 2026');
eq('emitida: basura → vacío (la tarjeta deja la fecha real)', L.emitidaTexto('ayer'), '');
eq('emitida: mes 13 → vacío', L.emitidaTexto('2026-13-01'), '');

// ——— 2. Fila vacía y resumen ———
const fv = L.filaVacia('manual-1');
eq('fila vacía: id puesto y todo lo demás en blanco', [fv.id, fv.code, fv.estado, fv.nota], ['manual-1', '', '', '']);
const filas = [
  { ...L.filaVacia('a'), code: 'M-1', empresa: 'Savanna', estado: 'Operativa' },
  { ...L.filaVacia('b'), code: 'M-2', empresa: 'savanna', estado: 'operativa' },
  { ...L.filaVacia('c'), code: 'M-3', empresa: '', estado: 'Averiada', serial: 'S<script>' },
  { ...L.filaVacia('d'), code: 'M-4', empresa: 'Costa', estado: '' },
];
const r = L.resumenPersonalizado(filas);
eq('resumen: total', r.total, 4);
eq('resumen: agrupa el estado sin mirar mayúsculas', r.porEstado[0], ['Operativa', 2]);
ok('resumen: estado vacío cuenta como «Sin estado»', r.porEstado.some(([l, n]) => l === 'Sin estado' && n === 1));

// ——— 3. El papel con las opciones de nacimiento ———
const html = L.cuerpoReportePersonalizado({ filas, opciones: L.OPCIONES_PERSONALIZADO_INICIAL, nota: 'Nota de prueba' });
ok('salen los cuadros del resumen', html.includes('class="tiles"') && html.includes('Equipos en el reporte'));
ok('sale la tabla con el código', html.includes('<th>Código</th>') && html.includes('M-1'));
ok('⭐ encargado/horómetro/peso/medidas/notas NACEN ocultos', !html.includes('<th>Encargado</th>') && !html.includes('<th>Horómetro</th>') && !html.includes('<th>Peso</th>') && !html.includes('<th>Medidas</th>') && !html.includes('<th>Notas</th>'));
ok('el cuadro por empresa NACE oculto', !html.includes('Equipos por empresa'));
ok('fila TOTAL al pie', html.includes('TOTAL: 4 equipo(s)'));
ok('lo vacío sale como «—»', html.includes('>—<'));
ok('⭐ el HTML se escapa (nada de <script> crudo)', !html.includes('<script>') && html.includes('&lt;script&gt;'));
ok('la nota del encabezado sale', html.includes('Nota de prueba'));
ok('⭐⭐ NI UN SIGNO DE DINERO en el papel', !/\$|USD|[Mm]onto|[Tt]arifa|factur/.test(html));

// ——— 4. Las opciones mandan ———
const o = (cambios) => ({ ...L.OPCIONES_PERSONALIZADO_INICIAL, ...cambios });
ok('sinResumen apaga los cuadros', !L.cuerpoReportePersonalizado({ filas, opciones: o({ sinResumen: true }) }).includes('class="tiles"'));
ok('sinTabla deja solo el resumen', !L.cuerpoReportePersonalizado({ filas, opciones: o({ sinTabla: true }) }).includes('<table'));
ok('sinSerial quita la columna', !L.cuerpoReportePersonalizado({ filas, opciones: o({ sinSerial: true }) }).includes('<th>Serial</th>'));
const conEmp = L.cuerpoReportePersonalizado({ filas, opciones: o({ sinPorEmpresa: false }) });
ok('encender el cuadro por empresa lo trae, con «Sin empresa» para las vacías', conEmp.includes('Equipos por empresa') && conEmp.includes('Sin empresa'));
const conExtra = L.cuerpoReportePersonalizado({ filas, opciones: o({ sinEncargado: false, sinNotas: false }) });
ok('encender encargado y notas las trae', conExtra.includes('<th>Encargado</th>') && conExtra.includes('<th>Notas</th>'));
ok('sin nota del encabezado no sale el párrafo', !L.cuerpoReportePersonalizado({ filas, opciones: L.OPCIONES_PERSONALIZADO_INICIAL }).includes('class="n"'));

// ——— 5. Pastillas, palabras y archivo ———
eq('cada opción tiene su pastilla (ni una más, ni una menos)',
  L.PASTILLAS_PERSONALIZADO.map((p) => p.key).sort(), Object.keys(L.OPCIONES_PERSONALIZADO_INICIAL).sort());
eq('sin cambios: el texto de siempre', L.ocultosPersonalizadoEnPalabras(L.OPCIONES_PERSONALIZADO_INICIAL), 'Sale con las columnas de siempre.');
eq('con cambios: los nombra («con» para lo que nace oculto)',
  L.ocultosPersonalizadoEnPalabras(o({ sinEncargado: false, sinSerial: true })), 'Cambiado: sin serial, con encargado.');
eq('alternar cambia solo esa llave', L.alternarPersonalizado(L.OPCIONES_PERSONALIZADO_INICIAL, 'sinSerial').sinSerial, true);
eq('sufijo del archivo: la fecha sola si no hay cambios', L.sufijoArchivoPersonalizado('2026-10-09', L.OPCIONES_PERSONALIZADO_INICIAL), '09/10/2026');
eq('sufijo del archivo: nombra los cambios', L.sufijoArchivoPersonalizado('2026-10-09', o({ sinPorEmpresa: false })), '09/10/2026 · con empresas');
eq('los seis estados sugeridos del sistema (los mismos 6 cubos reales del Catálogo)', [...L.ESTADOS_PERSONALIZADO], ['Operativa', 'Averiada', 'Parada', 'Esperando instrucciones', 'Retirada', 'Transferido a otros']);
eq('nombreEstadoCatalogo normaliza Transferida(s) a otros → Transferido a otros', [
  L.nombreEstadoCatalogo('Transferida a otros'),
  L.nombreEstadoCatalogo('Transferidas a otros'),
  L.nombreEstadoCatalogo('Transferido a otros'),
], ['Transferido a otros', 'Transferido a otros', 'Transferido a otros']);

// ——— 5b. Filtros de catálogo por Empresa, Categoría y Estado Actual ———
const catDemo = [
  { ...L.filaVacia('m1'), code: 'JUMBO 320', plate: 'A11BC2D', clasificacion: 'Remoción y excavación', empresa: 'Savanna', estado: 'Operativa' },
  { ...L.filaVacia('m2'), code: 'PAYLOADER', plate: 'B22CD3E', clasificacion: 'Manejo de carga', empresa: 'Savanna', estado: 'Averiada' },
  { ...L.filaVacia('m3'), code: 'RETROEXCAVADORA', plate: 'C33DE4F', clasificacion: 'Remoción y excavación', empresa: 'Costa Brava', estado: 'Parada' },
  { ...L.filaVacia('veh-v1'), code: 'HILUX', plate: 'D44EF5G', clasificacion: 'Soporte y servicios', empresa: 'Costa Brava', estado: 'Operativa' },
  { ...L.filaVacia('m4'), code: 'MOTONIVELADORA', plate: 'E55FG6H', clasificacion: '', empresa: '', estado: 'Inactiva' },
];
const empCat = L.empresasCatalogoPersonalizado(catDemo, 'todos');
eq('empresas del catálogo: lista ordenada con Sin empresa al final', empCat, [
  { nombre: 'Costa Brava', count: 2 },
  { nombre: 'Savanna', count: 2 },
  { nombre: 'Sin empresa', count: 1 },
]);
const catsCat = L.categoriasCatalogoPersonalizado(catDemo, 'todos');
eq('categorías del catálogo: lista ordenada con Sin categoría al final', catsCat, [
  { nombre: 'Manejo de carga', count: 1 },
  { nombre: 'Remoción y excavación', count: 2 },
  { nombre: 'Soporte y servicios', count: 1 },
  { nombre: 'Sin categoría', count: 1 },
]);
const catsSavanna = L.categoriasCatalogoPersonalizado(catDemo, 'todos', ['Savanna']);
eq('categorías del catálogo filtradas por empresa Savanna', catsSavanna, [
  { nombre: 'Manejo de carga', count: 1 },
  { nombre: 'Remoción y excavación', count: 1 },
]);
const estCatSavanna = L.estadosCatalogoPersonalizado(catDemo, 'todos', ['Savanna']);
eq('estados del catálogo filtrados por Savanna: Operativa=1, Averiada=1', [
  estCatSavanna.find((e) => e.nombre === 'Operativa')?.count,
  estCatSavanna.find((e) => e.nombre === 'Averiada')?.count,
  estCatSavanna.find((e) => e.nombre === 'Parada')?.count,
], [1, 1, 0]);
eq('filtrar por 1 empresa (Savanna)', L.filtrarCatalogoPersonalizado({ catalogo: catDemo, empresasSel: ['Savanna'] }).map((m) => m.id), ['m1', 'm2']);
eq('filtrar por varias empresas (Savanna + Costa Brava) y solo máquinas', L.filtrarCatalogoPersonalizado({ catalogo: catDemo, fuente: 'maq', empresasSel: ['Savanna', 'Costa Brava'] }).map((m) => m.id), ['m1', 'm2', 'm3']);
eq('filtrar por 1 categoría (Remoción y excavación)', L.filtrarCatalogoPersonalizado({ catalogo: catDemo, categoriasSel: ['Remoción y excavación'] }).map((m) => m.id), ['m1', 'm3']);
eq('filtrar por empresa + categoría (Savanna + Manejo de carga)', L.filtrarCatalogoPersonalizado({ catalogo: catDemo, empresasSel: ['Savanna'], categoriasSel: ['Manejo de carga'] }).map((m) => m.id), ['m2']);
eq('filtrar por empresa + estado actual (Savanna + Averiada)', L.filtrarCatalogoPersonalizado({ catalogo: catDemo, empresasSel: ['Savanna'], estadosSel: ['Averiada'] }).map((m) => m.id), ['m2']);
eq('filtrar por varios estados actuales (Operativa + Parada)', L.filtrarCatalogoPersonalizado({ catalogo: catDemo, estadosSel: ['Operativa', 'Parada'] }).map((m) => m.id), ['m1', 'm3', 'veh-v1']);

// ——— 5b. Histórico de reportes personalizados (guardar, reimprimir, reusar y borrar) ———
const reg1 = L.crearRegistroHistorialPersonalizado({
  id: 'hist-1',
  createdAt: '2026-11-02T16:00:00.000Z',
  creadoPorNombre: 'Coordinador',
  origen: 'impresion',
  etiqueta: 'Cierre Savanna',
  titulo: 'Reporte de maquinaria',
  subtitulo: 'Turno día',
  nota: 'Nota congelada 1',
  fechaEmision: '2026-11-02',
  conRango: true,
  desde: '2026-11-01',
  hasta: '2026-11-02',
  opciones: { ...L.OPCIONES_PERSONALIZADO_INICIAL, sinConsumo: false },
  filas: [
    { ...catDemo[0], litros: '120' },
    { ...catDemo[1], litros: '80' },
  ],
  filtros: { fuente: 'maq', empresasSel: ['Savanna'], categoriasSel: ['Remoción y excavación'], estadosSel: ['Operativa'], busca: '' },
  editadosManual: ['m1|litros'],
  manuales: 1,
});
eq('histórico: guarda las filas congeladas exactas y sus litros', reg1.filas.map((f) => [f.id, f.litros]), [['m1', '120'], ['m2', '80']]);
ok('histórico: la vista previa de equipos incluye SIEMPRE Código y Placa', reg1.resumen.previewEquipos.includes('JUMBO 320 · Placa: A11BC2D') && reg1.resumen.previewEquipos.includes('PAYLOADER · Placa: B22CD3E'));
eq('histórico: resume litros y estado', [reg1.resumen.totalLitrosTexto, reg1.resumen.porEstadoTexto], ['200 L', '1 Averiada · 1 Operativa']);

let estHist = L.agregarAlHistorialPersonalizado(L.ESTADO_HISTORIAL_VACIO, reg1);
eq('histórico: agrega el primer reporte', estHist.items.length, 1);

// Si se imprime exactamente el mismo reporte enseguida, no duplica entradas:
const reg1Clon = L.crearRegistroHistorialPersonalizado({
  ...reg1,
  id: 'hist-1-clon',
  createdAt: '2026-11-02T16:01:00.000Z',
});
estHist = L.agregarAlHistorialPersonalizado(estHist, reg1Clon);
eq('histórico: imprimir idéntico seguido actualiza el tope sin duplicar basura', estHist.items.length, 1);

// Un segundo reporte con otra selección entra como nueva entrada en el tope:
const reg2 = L.crearRegistroHistorialPersonalizado({
  id: 'hist-2',
  createdAt: '2026-11-02T17:00:00.000Z',
  creadoPorNombre: 'Coordinador',
  origen: 'manual',
  etiqueta: '',
  titulo: 'Reporte Costa Brava',
  subtitulo: 'Reporte personalizado',
  nota: '',
  fechaEmision: '2026-11-02',
  conRango: false,
  desde: '2026-11-02',
  hasta: '2026-11-02',
  opciones: L.OPCIONES_PERSONALIZADO_INICIAL,
  filas: [catDemo[2], catDemo[3]],
  filtros: { fuente: 'todos', empresasSel: ['Costa Brava'], categoriasSel: [], estadosSel: [], busca: '' },
});
estHist = L.agregarAlHistorialPersonalizado(estHist, reg2);
eq('histórico: el más nuevo queda primero (#1)', estHist.items.map((x) => x.id), ['hist-2', 'hist-1']);

// Buscador del histórico (busca por etiqueta, empresa, código o placa):
eq('histórico: buscar por placa de máquina (C33DE4F) encuentra el reporte donde salió', L.filtrarHistorialPersonalizado(estHist.items, 'c33de4f').map((x) => x.id), ['hist-2']);
eq('histórico: buscar por etiqueta (Cierre Savanna)', L.filtrarHistorialPersonalizado(estHist.items, 'cierre savanna').map((x) => x.id), ['hist-1']);

// Renombrar y contar reimpresiones:
estHist = L.renombrarEnHistorialPersonalizado(estHist, 'hist-2', 'Flota Costa Brava Lunes', '2026-11-02T17:05:00.000Z');
estHist = L.marcarReimpresoEnHistorialPersonalizado(estHist, 'hist-2', '2026-11-02T17:06:00.000Z');
eq('histórico: renombrar y contar reimpresión', [estHist.items[0].etiqueta, estHist.items[0].vecesReimpreso], ['Flota Costa Brava Lunes', 1]);

// Borrar un reporte individual y verificar que no resucite al hacer merge con copia remota vieja:
const copiaAntesDeBorrar = JSON.parse(JSON.stringify(estHist));
estHist = L.quitarDelHistorialPuro(estHist, 'hist-1', '2026-11-02T17:10:00.000Z');
eq('histórico: borrar quita el reporte y deja el otro', estHist.items.map((x) => x.id), ['hist-2']);
const fusionado = L.mergeHistorialPersonalizado(estHist, copiaAntesDeBorrar);
eq('histórico: el reporte borrado NO resucita al sincronizar con otro dispositivo', fusionado.items.map((x) => x.id), ['hist-2']);

// Vaciar todo el histórico:
const vaciado = L.vaciarHistorialPuro(fusionado, '2026-11-02T18:00:00.000Z');
eq('histórico: vaciar deja 0 reportes y no resucita al fusionar con antes', L.mergeHistorialPersonalizado(vaciado, copiaAntesDeBorrar).items.length, 0);

// ——— 6. Candados sobre el código fuente ———
const srcLib = fs.readFileSync(path.join(ROOT, 'src/lib/reporteMaquinariaPersonalizado.ts'), 'utf8');
ok('⭐⭐ la librería es PURA (sin imports): se prueba sola', !/^\s*import\s/m.test(srcLib));
ok('⭐⭐ la librería no consulta nada (ni supabase ni fetch)', !/supabase\.|fetch\(|selectAllRows/.test(srcLib));

const srcCard = fs.readFileSync(path.join(ROOT, 'src/components/ReporteMaquinariaPersonalizadoCard.tsx'), 'utf8');
ok('⭐⭐⭐ RECIBE PERO NO ENVÍA: ni un insert/update/delete/upsert/rpc en la tarjeta',
  !/\.insert\(|\.upsert\(|\.update\(|\.delete\(|\.rpc\(/.test(srcCard) && !/supabase\s*\.\s*from\(/.test(srcCard));
ok('solo lee con selectAllRows', /import \{ selectAllRows \} from '\.\.\/lib\/supabase';/.test(srcCard));
ok('lee el catálogo (machinery) y las averías pendientes para sugerir el estado',
  /selectAllRows\(\s*'machinery'/.test(srcCard) && /selectAllRows\('maintenance_requests'/.test(srcCard) && /eq\('status', 'pendiente'\)/.test(srcCard));
ok('⭐ usa el clasificador real en vivo del Catálogo (makeLiveStatusOf + estadoConteoDe + transferida)',
  srcCard.includes("from '../lib/machineLiveStatus'") &&
  srcCard.includes('makeLiveStatusOf(') &&
  srcCard.includes('estadoConteoDe(') &&
  srcCard.includes('transferida') &&
  srcCard.includes("'Transferido a otros'"));
ok('⭐ la fecha de emisión elegida viaja al membrete', /emitida: emitidaTexto\(fechaEmision\) \|\| undefined/.test(srcCard));
// 🚗 Vehículos (09-oct-2026, a pedido: «también podría incluir vehículos»):
ok('🚗 los vehículos también entran al taller', /selectAllRows\('vehicles'/.test(srcCard));
ok('🚗 si su select completo falla, se cae a lo básico y luego a nada (no tumba el taller)',
  /selectAllRows\('vehicles', 'id, plate, brand, model, vehicle_type, active'\)\.catch\(\(\) => \[\] as any\[\]\)/.test(srcCard));
ok('🚗 la clave local del vehículo lleva el prefijo veh- (así se pinta el 🚗 sin ensuciar la fila)',
  /id: `veh-\$\{String\(v\.id\)\}`/.test(srcCard) && /startsWith\('veh-'\)/.test(srcCard));
ok('🚗 hay filtro Todos / Máquinas / Vehículos en el buscador',
  srcCard.includes("pastilla('f-maq', '🚜 Máquinas'") && srcCard.includes("pastilla('f-veh', '🚗 Vehículos'"));
ok('🏢 hay filtro por una o varias empresas, categorías de maquinaria y estado actual con selección/des-selección en bloque',
  srcCard.includes('Filtrar por empresa') &&
  srcCard.includes('Filtrar por categoría de la maquinaria') &&
  srcCard.includes('Filtrar por estado actual') &&
  srcCard.includes('Seleccionar las') &&
  srcCard.includes('Des-seleccionar las'));
ok('vaciar el papel pide confirmación (doble toque)', srcCard.includes('¿Seguro? Toca otra vez'));
ok('el estado también se puede escribir libre', srcCard.includes('Estado libre…'));
ok('hay fila manual en blanco', /filaVacia\(`manual-\$\{manuales \+ 1\}`\)/.test(srcCard));
ok('🕒 hay histórico de reportes sacados con Reimprimir como estaba, Reusar y modificar, y Borrar',
  srcCard.includes('Histórico de reportes sacados') &&
  srcCard.includes('Reimprimir como estaba') &&
  srcCard.includes('Reusar y modificar') &&
  srcCard.includes('🗑️ Borrar') &&
  srcCard.includes('Limpiar histórico'));

const srcPdf = fs.readFileSync(path.join(ROOT, 'src/lib/pdf.ts'), 'utf8');
ok('⭐ pdf.ts: sin pasar «emitida», los demás reportes no cambian (nowStamp de siempre)',
  srcPdf.includes('${escTxt(opts.emitida ?? nowStamp())}') && /emitida\?: string/.test(srcPdf));

// 👥 03-nov-2026: el histórico por persona y el de TODOS para el admin.
{
  const srcSt = fs.readFileSync(path.join(ROOT, 'src/lib/reportePersonalizadoStorage.ts'), 'utf8');
  const srcTodos = fs.readFileSync(path.join(ROOT, 'src/components/HistorialTodosPersonalizado.tsx'), 'utf8');
  ok('👥 el histórico va a su tabla, una fila por reporte con su autor',
    /TABLA_HISTORIAL_PERSONALIZADO = 'reportes_personalizados_historial'/.test(srcSt) && /created_by: uid/.test(srcSt));
  ok('👥 ya no se escribe el histórico dentro de la configuración de la tiquetera',
    !/tique_config/.test(srcSt.replace(/^\s*\/\/.*$/gm, '')));
  ok('👥 quitar nunca borra: marca quitado_at, y solo lo MÍO',
    !/\.delete\(/.test(srcSt) && /quitado_at: new Date\(\)/.test(srcSt) && /\.eq\('created_by', uid\)/.test(srcSt));
  ok('👥 la lista de todos es liviana (sin las filas del papel) y el completo se pide aparte',
    /export async function listarHistorialDeTodos/.test(srcSt) && !/select\('id, created_by[^']*registro,/.test(srcSt) && /export async function cargarReporteCompleto/.test(srcSt));
  ok('👥 el apartado de todos solo se monta para el administrador',
    /esAdmin = auth\?\.role === 'admin'/.test(srcCard) && /\{esAdmin \? \(\s*<HistorialTodosPersonalizado/.test(srcCard));
  ok('👥 desde el apartado de todos no se borra nada ni se toca la base directo',
    !/supabase|\.delete\(|\.update\(/.test(srcTodos) && srcTodos.includes('Reimprimir como estaba') && srcTodos.includes('Reusar y modificar') && srcTodos.includes('¿De quién?'));
  ok('👥 reusar desde todos reemplaza el taller solo con un segundo toque',
    /hayPapelCargado && confirmaReusar !== r\.id/.test(srcTodos) && /reusarDelHistorico\(reg, true\)/.test(srcCard));
}
const srcPantalla = fs.readFileSync(path.join(ROOT, 'src/screens/ReportsScreen.tsx'), 'utf8');
ok('la pestaña «Personalizado» está montada en Reportes', /<ReporteMaquinariaPersonalizadoCard \/>/.test(srcPantalla) && srcPantalla.includes("{ v: 'personalizado', label: '🛠️ Personalizado' }"));
ok('el botón genérico de generar no aplica en la pestaña nueva', srcPantalla.includes("mode !== 'frentes' && mode !== 'personalizado'"));

// ——— Cierre ———
console.log(`\n🛠️ Reporte personalizado: ${pass} OK · ${fail} FALLO(S)`);
if (fail) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('   Recibe pero no envía: el taller de papel no toca la base.');
