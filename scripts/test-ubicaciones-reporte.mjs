/*
 * Test del HISTÓRICO DE UBICACIONES POR MÁQUINA (22-sep-2026).
 *
 * Pedido del cliente: «el histórico de dónde trabajaron esas máquinas en base a la
 * ubicación que daban los inspectores, las horas, el estatus, marca, modelo, placa,
 * inspector, empresa, en un rango de fechas, y poder ocultar columnas del PDF».
 *
 * No hay tabla de «ubicación por día»: se reconstruye de cuatro fuentes. Lo que se fija
 * acá y por qué duele:
 *   · una fila por máquina y día SOLO si pasó algo (ronda, check-in o punto)
 *   · el sector se arrastra del último punto y la celda LO DICE («desde el DD/MM»)
 *   · el edificio es el vigente ESE día según la bitácora, no el de hoy
 *   · el check-in manda sobre la ronda para inspector y estado
 *   · ocultar columnas nunca saca filas; el papel y el archivo dicen qué se ocultó
 *
 *   node scripts/test-ubicaciones-reporte.mjs
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
const loadTs = (rel) => {
  const abs = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs)); m._compile(out, abs);
  return m.exports;
};
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado ${b}\n    obtenido ${a}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const U = loadTs('src/lib/ubicacionesReporte.ts');
ok('la librería no importa nada', !/^\s*import\s/m.test(sinComentarios(leer('src/lib/ubicacionesReporte.ts'))));

// ── 1) FECHAS ────────────────────────────────────────────────────────────────
{
  eq('la fecha Caracas de un instante UTC', U.fechaCaracas('2026-09-15T03:30:00Z'), '2026-09-14');
  eq('...y de uno con offset', U.fechaCaracas('2026-09-15T10:00:00-04:00'), '2026-09-15');
  eq('fecha ilegible → vacío', U.fechaCaracas('nada'), '');
  eq('los días del rango', U.diasDelRango('2026-09-14', '2026-09-16'), ['2026-09-14', '2026-09-15', '2026-09-16']);
  eq('al revés se endereza', U.diasDelRango('2026-09-16', '2026-09-14').length, 3);
  eq('rango ilegible → nada', U.diasDelRango('x', '2026-09-16'), []);
  eq('dmy', U.dmy('2026-09-05'), '05/09/2026');
}

// ── 2) LAS FUENTES INVENTADAS ────────────────────────────────────────────────
const M1 = { id: 'm1', code: 'RETROEXCAVADORA', marca: 'MARCA-X', modelo: 'MOD-1', placa: 'AA1', empresa: 'EMPRESA ALFA', clasificacion: 'Movimiento de tierra', referenciaActual: 'OBRA HOY' };
const M2 = { id: 'm2', code: 'CAMION VOLTEO', marca: 'MARCA-Y', modelo: 'MOD-2', placa: 'BB2', empresa: 'EMPRESA BETA', clasificacion: 'Transporte', referenciaActual: '' };
const M3 = { id: 'm3', code: 'COMPRESOR', marca: '', modelo: '', placa: '', empresa: 'EMPRESA ALFA', clasificacion: 'Sin clasificación', referenciaActual: 'PATIO' };
// Sin GPS y sin edificio: la única que de verdad queda «sin ubicación».
const M4 = { id: 'm4', code: 'PLANTA ELECTRICA', marca: '', modelo: '', placa: 'PE-1', empresa: 'EMPRESA BETA', clasificacion: 'Sin clasificación', referenciaActual: '' };
const base = {
  desde: '2026-09-14', hasta: '2026-09-16',
  maquinas: [M1, M2, M3, M4],
  puntos: [
    { machineryId: 'm1', at: '2026-09-10T12:00:00-04:00', sector: 'Este · Macuto' },      // antes del rango
    { machineryId: 'm1', at: '2026-09-15T08:00:00-04:00', sector: 'Este · Camurí Chico' },
    { machineryId: 'm1', at: '2026-09-15T16:00:00-04:00', sector: 'Este · Caraballeda' },  // el último del día manda
    { machineryId: 'm2', at: '2026-09-14T09:00:00-04:00', sector: null },                  // fuera de zona
  ],
  cambios: [
    { machineryId: 'm1', at: '2026-09-15T10:00:00-04:00', de: 'OBRA VIEJA', a: 'OBRA NUEVA' },
  ],
  visitas: [
    { machineryId: 'm1', fecha: '2026-09-14', at: '2026-09-14T09:00:00-04:00', inspector: 'Inspector Uno', estado: 'trabajando' },
    { machineryId: 'm1', fecha: '2026-09-14', at: '2026-09-14T15:00:00-04:00', inspector: 'Inspector Dos', estado: 'parada' }, // el último manda
    { machineryId: 'm2', fecha: '2026-09-14', at: '2026-09-14T09:00:00-04:00', inspector: 'Inspector Uno', estado: 'no_esta' },
  ],
  rondas: [
    { machineryId: 'm1', fecha: '2026-09-14', dia: 10, noche: 0, parada: 0, estado: 'operativa', inspectorDia: 'ronda uno', inspectorNoche: null },
    { machineryId: 'm1', fecha: '2026-09-15', dia: 8, noche: 4, parada: 2, estado: 'operativa', inspectorDia: 'ronda uno', inspectorNoche: null },
    { machineryId: 'm1', fecha: '2026-09-15', dia: 12, noche: 0, parada: 0, estado: 'operativa', inspectorDia: null, inspectorNoche: 'ronda noche' }, // duplicada: máximo
    { machineryId: 'm3', fecha: '2026-09-16', dia: 0, noche: 0, parada: 0, estado: 'parada', inspectorDia: 'ronda tres', inspectorNoche: null },
    { machineryId: 'm4', fecha: '2026-09-16', dia: 0, noche: 0, parada: 0, estado: 'parada', inspectorDia: null, inspectorNoche: null },
  ],
  hayBitacora: true,
};
const filas = U.armarUbicaciones(base);
const fila = (id, fecha) => filas.find((f) => f.maquina.id === id && f.fecha === fecha);

// ── 3) UNA FILA POR MÁQUINA Y DÍA, SOLO SI PASÓ ALGO ─────────────────────────
{
  eq('⭐ salen solo los días con ronda, check-in o punto (por fecha y luego por código)', filas.map((f) => `${f.fecha}|${f.maquina.id}`), ['2026-09-14|m2', '2026-09-14|m1', '2026-09-15|m1', '2026-09-16|m3', '2026-09-16|m4']);
  ok('⭐ m2 el 15 y el 16 NO sale (no pasó nada)', !fila('m2', '2026-09-15') && !fila('m2', '2026-09-16'));
  ok('una máquina fuera de la lista no aparece', !U.armarUbicaciones({ ...base, maquinas: [M2] }).some((f) => f.maquina.id === 'm1'));
}

// ── 4) EL SECTOR: DEL DÍA, O ARRASTRADO Y DICHO ──────────────────────────────
{
  const f14 = fila('m1', '2026-09-14');
  eq('⭐ sin punto ese día pero con uno DESPUÉS: vale el siguiente y dice cuándo se registró', [f14.sector, f14.sectorDesde, f14.sinUbicacion, f14.sectorOrigen], ['Este · Camurí Chico', '2026-09-15', false, 'posterior']);
  const f15 = fila('m1', '2026-09-15');
  eq('⭐ con puntos ese día: el ÚLTIMO del día, sin marca', [f15.sector, f15.sectorDesde], ['Este · Caraballeda', '']);
  const f14b = fila('m2', '2026-09-14');
  eq('un punto fuera de los polígonos no es «sin ubicación»', [f14b.sector, f14b.sinUbicacion], ['Fuera de zona', false]);
  const f16 = fila('m3', '2026-09-16');
  eq('⭐ sin GPS en ninguna parte pero CON edificio: vale el edificio (228 renglones del 22-sep)', [f16.sector, f16.sinUbicacion, f16.sectorOrigen], ['PATIO', false, 'edificio']);
  const f16b = fila('m4', '2026-09-16');
  eq('⭐ sin GPS y sin edificio: ahí sí «sin ubicación», y contado', [f16b.sector, f16b.sinUbicacion, f16b.sectorOrigen], ['Sin ubicación', true, 'ninguno']);
  ok('⭐ el del DÍA manda sobre todo', fila('m1', '2026-09-15').sector === 'Este · Caraballeda' && fila('m1', '2026-09-15').sectorDesde === '' && fila('m1', '2026-09-15').sectorOrigen === 'dia');

  // ⭐ «Si este día no tuvieron ubicación pero el día de mañana sí, colócale esa, no la última» (22-sep).
  const soloAntes = U.armarUbicaciones({ ...base, puntos: [{ machineryId: 'm1', at: '2026-09-10T12:00:00-04:00', sector: 'Este · Macuto' }] });
  const a14 = soloAntes.find((f) => f.maquina.id === 'm1' && f.fecha === '2026-09-14');
  eq('⭐ sin ninguna después: se arrastra la última anterior y dice desde cuándo', [a14.sector, a14.sectorDesde, a14.sectorOrigen, a14.sinUbicacion], ['Este · Macuto', '2026-09-10', 'anterior', false]);
  const soloDespues = U.armarUbicaciones({ ...base, puntos: [{ machineryId: 'm1', at: '2026-09-20T10:00:00-04:00', sector: 'Este · Naiguatá' }] });
  const d14 = soloDespues.find((f) => f.maquina.id === 'm1' && f.fecha === '2026-09-14');
  eq('sin punto anterior pero con uno después: vale ese', [d14.sector, d14.sectorDesde, d14.sectorOrigen], ['Este · Naiguatá', '2026-09-20', 'posterior']);
  const d15 = soloDespues.find((f) => f.maquina.id === 'm1' && f.fecha === '2026-09-15');
  eq('...y cada día sin punto toma el SIGUIENTE, no el anterior', [d15.sector, d15.sectorOrigen], ['Este · Naiguatá', 'posterior']);
  const conCatalogo = U.armarUbicaciones({ ...base, maquinas: [M1, M2, { ...M3, sectorActual: 'Oeste · Catia La Mar' }] });
  const c16 = conCatalogo.find((f) => f.maquina.id === 'm3');
  eq('⭐ sin ningún punto pero con GPS en el catálogo: la ubicación actual', [c16.sector, c16.sectorOrigen, c16.sinUbicacion, c16.sectorDesde], ['Oeste · Catia La Mar', 'catalogo', false, '']);
}

// ── 5) EL EDIFICIO: EL VIGENTE ESE DÍA, NO EL DE HOY ─────────────────────────
{
  eq('⭐ antes del cambio vale el «de»', fila('m1', '2026-09-14').edificio, 'OBRA VIEJA');
  eq('⭐ desde el cambio vale el «a»', fila('m1', '2026-09-15').edificio, 'OBRA NUEVA');
  eq('sin bitácora de la máquina: la ficha de hoy, marcada', [fila('m3', '2026-09-16').edificio, fila('m3', '2026-09-16').edificioArrastrado], ['PATIO', true]);
  eq('sin bitácora ni ficha: raya', [fila('m2', '2026-09-14').edificio, fila('m2', '2026-09-14').edificioArrastrado], ['—', false]);
  const sinBit = U.armarUbicaciones({ ...base, cambios: [], hayBitacora: false });
  eq('⭐ sin bitácora (no se pudo leer) m1 sale con la ficha de hoy y marcado', [sinBit.find((f) => f.maquina.id === 'm1').edificio, sinBit.find((f) => f.maquina.id === 'm1').edificioArrastrado], ['OBRA HOY', true]);
}

// ── 6) INSPECTOR, ESTADO Y HORAS ─────────────────────────────────────────────
{
  const f14 = fila('m1', '2026-09-14');
  eq('⭐ el ÚLTIMO check-in del día manda sobre la ronda', [f14.inspector, f14.estado], ['Inspector Dos', 'Parada']);
  eq('horas de la ronda', [f14.dia, f14.noche, f14.total], [10, 0, 10]);
  const f15 = fila('m1', '2026-09-15');
  eq('⭐ sin check-in: el inspector de la ronda y «trabajó (sin check-in)»', [f15.inspector, f15.estado], ['ronda uno', 'Trabajó (sin check-in)']);
  eq('⭐ dos rondas el mismo día: el máximo de cada turno, y las paradas restan', [f15.dia, f15.noche, f15.total], [12, 4, 14]);
  eq('check-in «no está» se lee', fila('m2', '2026-09-14').estado, 'No estaba');
  eq('ronda parada sin horas', [fila('m3', '2026-09-16').estado, fila('m3', '2026-09-16').total], ['Parada', 0]);
  eq('etiquetas de estado', [U.etiquetaEstado('trabajando'), U.etiquetaEstado('PARADA'), U.etiquetaEstado('no_esta'), U.etiquetaEstado('')], ['Trabajando', 'Parada', 'No estaba', '—']);
  const soloPunto = U.armarUbicaciones({ ...base, visitas: [], rondas: [] });
  eq('solo punto GPS, sin ronda ni check-in: lo dice', soloPunto.find((f) => f.maquina.id === 'm1' && f.fecha === '2026-09-15').estado, 'Solo ubicación');
}

// ── 7) RESUMEN ───────────────────────────────────────────────────────────────
{
  const r = U.resumenUbicaciones(filas);
  eq('cuenta máquinas, días, renglones y horas', [r.maquinas, r.dias, r.filas, r.horas], [4, 3, 5, 24]);
  eq('⭐ cuenta sin ubicación y completadas (la del edificio cuenta como completada)', [r.sinUbicacion, r.arrastradas], [1, 2]);
  eq('sectores por horas', r.sectores.map((s) => s.nombre), ['Este · Caraballeda', 'Este · Camurí Chico', 'Fuera de zona', 'PATIO', 'Sin ubicación']);
  const r2 = U.resumenUbicaciones(U.armarUbicaciones({ ...base, maquinas: [M1, M2, { ...M3, sectorActual: 'Oeste · Catia La Mar' }] }));
  eq('la del catálogo cuenta como completada, no como sin ubicación', [r2.sinUbicacion, r2.arrastradas], [0, 2]);
}

// ── 8) LAS PASTILLAS: OCULTAR NO ES FILTRAR ──────────────────────────────────
{
  eq('once pastillas', U.PASTILLAS_UBICACIONES.map((p) => p.chip), ['🚫 Marca', '🚫 Modelo', '🚫 Serial / Placa', '🚫 Empresa', '🚫 Cardinal (E/O)', '🚫 Sector (GPS)', '🚫 Edificio / obra', '🚫 Inspector', '🚫 Estado', '🚫 Horas', '🚫 Alcance del informe']);
  ok('cada pastilla es una opción que existe', U.PASTILLAS_UBICACIONES.every((p) => p.key in U.OPCIONES_UBICACIONES_COMPLETO));
  eq('completo trae todas las columnas', U.columnasUbicaciones(U.OPCIONES_UBICACIONES_COMPLETO), ['fecha', 'code', 'marcaModelo', 'placa', 'empresa', 'cardinal', 'sector', 'edificio', 'inspector', 'estado', 'dia', 'noche', 'total']);
  eq('se puede ocultar el cardinal', U.columnasUbicaciones({ ...U.OPCIONES_UBICACIONES_COMPLETO, sinCardinal: true }).includes('cardinal'), false);
  const todo = Object.fromEntries(Object.keys(U.OPCIONES_UBICACIONES_COMPLETO).map((k) => [k, true]));
  eq('⭐ con todo oculto quedan fecha y máquina: son el histórico', U.columnasUbicaciones(todo), ['fecha', 'code']);
  eq('marca sin modelo: la columna se llama Marca', U.tituloMarcaModeloUbic({ ...U.OPCIONES_UBICACIONES_COMPLETO, sinModelo: true }), 'Marca');
  eq('lo oculto en palabras', U.ocultosUbicacionesEnPalabras({ ...U.OPCIONES_UBICACIONES_COMPLETO, sinHoras: true, sinSector: true }), 'No sale: sector, horas.');
  eq('...y en el archivo', U.sufijoArchivoUbicaciones({ ...U.OPCIONES_UBICACIONES_COMPLETO, sinHoras: true }), ' - sin horas');
  eq('alternar', U.alternarUbicaciones(U.OPCIONES_UBICACIONES_COMPLETO, 'sinPlaca').sinPlaca, true);
}

// ── 9) EL PAPEL ──────────────────────────────────────────────────────────────
{
  const papel = (extra = {}) => U.cuerpoUbicaciones({ desde: base.desde, hasta: base.hasta, filas, opciones: U.OPCIONES_UBICACIONES_COMPLETO, alcance: { empresas: [], clasificaciones: [], maquinas: [] }, hayBitacora: true, ...extra });
  const h = papel();
  ok('un bloque por día', /<h3>14\/09\/2026 — 2 máquina\(s\)/.test(h) && /<h3>15\/09\/2026 — 1 máquina\(s\)/.test(h) && /<h3>16\/09\/2026 — 2 máquina\(s\)/.test(h));
  ok('⭐ la celda tomada del edificio lo dice', /PATIO<br\/><span class="ub-arr">según edificio\/obra<\/span>/.test(h));
  ok('⭐ la tabla va con ancho fijo para no salirse de la hoja', /^<div class="ub">/.test(h) && /\.ub table\{table-layout:fixed;width:100%/.test(U.CSS_UBICACIONES));
  ok('⭐ la celda tomada del día siguiente lo dice', /Este · Camurí Chico<br\/><span class="ub-arr">registrada el 15\/09\/2026<\/span>/.test(h));
  const hMix = U.cuerpoUbicaciones({ desde: base.desde, hasta: base.hasta, filas: U.armarUbicaciones({ ...base, puntos: [{ machineryId: 'm1', at: '2026-09-10T12:00:00-04:00', sector: 'Este · Macuto' }], maquinas: [M1, { ...M2, sectorActual: 'Oeste · Aeropuerto' }, { ...M3, sectorActual: 'Oeste · Catia La Mar' }] }), opciones: U.OPCIONES_UBICACIONES_COMPLETO, alcance: { empresas: [], clasificaciones: [], maquinas: [] }, hayBitacora: true });
  ok('⭐ «desde el» y «ubicación actual» según el caso, y ya no hay «sin ubicación»', /Este · Macuto<br\/><span class="ub-arr">desde el 10\/09\/2026<\/span>/.test(hMix) && /Oeste · Catia La Mar<br\/><span class="ub-arr">ubicación actual<\/span>/.test(hMix) && !/Sin ubicación/.test(hMix));
  ok('⭐ «sin ubicación» en rojo', /<span class="ub-sin">Sin ubicación<\/span>/.test(h));
  ok('el edificio arrastrado lleva *', /PATIO \*/.test(h));
  ok('el resumen cuenta', /<b>1<\/b>sin ubicación/.test(h) && /<b>2<\/b>ubicación completada/.test(h) && /<b>24 h<\/b>/.test(h));
  ok('el cuadro «dónde trabajaron» está', /<h3>Dónde trabajaron<\/h3>/.test(h) && /Este · Caraballeda/.test(h));
  const oculto = papel({ opciones: { ...U.OPCIONES_UBICACIONES_COMPLETO, sinHoras: true, sinSector: true, sinAlcance: true } });
  ok('⭐ ocultar horas y sector los quita del papel, no las máquinas', !/Total h/.test(oculto) && !/Dónde trabajaron/.test(oculto) && /RETROEXCAVADORA/.test(oculto) && /COMPRESOR/.test(oculto) && !/Alcance del informe/.test(oculto));
  const filtrado = papel({ alcance: { empresas: ['EMPRESA ALFA'], clasificaciones: [], maquinas: ['RETROEXCAVADORA · AA1'] } });
  ok('el alcance nombra lo filtrado', /Empresas: solo EMPRESA ALFA/.test(filtrado) && /Máquinas: RETROEXCAVADORA · AA1/.test(filtrado));
  ok('⭐ sin bitácora, el papel lo dice', /bitácora de edificios no se pudo leer/.test(papel({ hayBitacora: false })));
  ok('vacío no revienta', /Sin registros en el rango/.test(U.cuerpoUbicaciones({ desde: '2026-01-01', hasta: '2026-01-02', filas: [], opciones: U.OPCIONES_UBICACIONES_COMPLETO, alcance: { empresas: [], clasificaciones: [], maquinas: [] }, hayBitacora: true })));
  ok('sin HTML crudo de los datos', !/<script/.test(U.cuerpoUbicaciones({ desde: base.desde, hasta: base.hasta, filas: U.armarUbicaciones({ ...base, maquinas: [{ ...M1, code: '<script>x</script>' }] }), opciones: U.OPCIONES_UBICACIONES_COMPLETO, alcance: { empresas: [], clasificaciones: [], maquinas: [] }, hayBitacora: true })));
}

// ── 10) LA CARGA Y LA PANTALLA ───────────────────────────────────────────────
{
  const db = sinComentarios(leer('src/lib/ubicacionesReporteDb.ts'));
  ok('⭐ todo paginado con selectAllRows (los puntos son miles)', (db.match(/selectAllRows\(/g) || []).length >= 4 && !/\.from\('machinery_locations'\)/.test(db));
  ok('⭐ los puntos se traen hasta el fin del rango, no solo los del rango (para arrastrar)', /q\.lte\('recorded_at', hastaFin\)/.test(db) && !/gte\('recorded_at'/.test(db));
  ok('⭐ el edificio viene por el RPC (la bitácora no la leen todos)', /rpc\('historial_referencia_maquinas'\)/.test(db));
  ok('...y si el RPC falla se sigue sin bitácora, sin reventar', /\(\) => \(\{ data: null, error: \{ message: 'sin rpc' \} \}\)/.test(db) && /hayBitacora = !/.test(db));
  ok('el sector se resuelve con los polígonos del mapa', /sectorLabel\(s\)/.test(db) && /sectorOf\(Number\(p\.latitude\), Number\(p\.longitude\)\)/.test(db));
  ok('⭐ el catálogo trae su GPS para el último recurso', /latitude, longitude, company:company_id\(name\)/.test(db) && /sectorActual: m\.latitude != null/.test(db));
  const p = sinComentarios(leer('src/screens/ReportsScreen.tsx'));
  ok('la pestaña existe', /\{ v: 'ubicaciones', label: '📍 Ubicaciones' \}/.test(p));
  ok('⭐ usa los mismos filtros de Jornada (empresa, clasificación, máquina)', /pasaFiltroJornada\(\{ id: m\.id, clasificacion: m\.clasificacion \}, filtroEqActual\)\);\s*const filas = armarUbicaciones/.test(p) && /\(mode === 'rounds' \|\| mode === 'ubicaciones'\) && maqCatalogo\.length > 0/.test(p));
  ok('las pastillas están en pantalla', /PASTILLAS_UBICACIONES\.map/.test(p));
  ok('el archivo lleva filtros y ocultos', /`Ubicaciones \$\{ubicResumen \? 'resumen ' : ''\}\$\{rng\}\$\{sufijoArchivoFiltroJornada\(filtroEqActual\)\}\$\{sufijoArchivoUbicaciones\(opUbic\)\}`/.test(p));
  // Los DOS papeles del mismo apartado, y el interruptor para elegir.
  ok('la pantalla ofrece los dos papeles', /ubicResumen \? cuerpoUbicacionesResumen\(datos\) : cuerpoUbicaciones\(datos\)/.test(p));
  ok('arranca en el resumido', /useState\(true\);/.test(p) && /const \[ubicResumen, setUbicResumen\] = useState\(true\)/.test(p));
  ok('cada papel lleva su título', /ubicResumen \? 'UBICACIONES POR SECTOR' : 'HISTÓRICO DE UBICACIONES'/.test(p));
}

// ── 11) MANUALES ─────────────────────────────────────────────────────────────
{
  ok('manual (md)', /Histórico de ubicaciones por máquina \(22\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app)', /HISTÓRICO DE UBICACIONES POR MÁQUINA \(22\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
  // Lo nuevo del 22-sep: la columna cardinal y el papel resumido, en los DOS manuales.
  ok('el manual (md) explica el cardinal', /Cardinal \(Este \/ Oeste\)/.test(leer('docs/MANUAL-USUARIO.md')));
  ok('el manual (md) explica los dos papeles', /Resumido \(por sector Este \/ Oeste\)/.test(leer('docs/MANUAL-USUARIO.md')));
  ok('el manual (app) explica el cardinal', /CARDINAL \(ESTE\/OESTE\)/.test(leer('src/screens/ManualScreen.tsx')));
  ok('el manual (app) explica los dos papeles', /SON DOS PAPELES/.test(leer('src/screens/ManualScreen.tsx')));
}

// ── 12) LA REFERENCIA CARDINAL (ESTE / OESTE) ────────────────────────────────
// Pedido del cliente (22-sep-2026): «una columna de referencia cardinal, que el alcance
// diga a qué áreas responde el Este y el Oeste, y que TODAS las máquinas la tengan».
{
  // El texto que ya trae el cardinal delante manda, venga con · o con guión.
  eq('sector del mapa (Este)', U.zonaCardinal('Este · Macuto'), { cardinal: 'ESTE', area: 'Macuto' });
  eq('sector del mapa (Oeste)', U.zonaCardinal('Oeste · Aeropuerto'), { cardinal: 'OESTE', area: 'Aeropuerto' });
  eq('la ficha escrita a mano', U.zonaCardinal('Este'), { cardinal: 'ESTE', area: '' });
  eq('...y en minúscula', U.zonaCardinal('oeste'), { cardinal: 'OESTE', area: '' });
  // El nombre de la obra nombra su área.
  eq('el patio es del Este', U.zonaCardinal('PATIO - CAMURI CHICO'), { cardinal: 'ESTE', area: 'Camurí Chico' });
  eq('Catia La Mar es del Oeste', U.zonaCardinal('HOTEL LITORAL SUITES - CATIA LA MAR'), { cardinal: 'OESTE', area: 'Catia La Mar' });
  eq('Santa Eduvigis cae en Urimare', U.zonaCardinal('SANTA EDUVIGIS - URIMARE, CATIA LA MAR'), { cardinal: 'OESTE', area: 'Catia La Mar' });
  eq('la escuela naval es del Oeste', U.zonaCardinal('Escuela sterling Catia la mar'), { cardinal: 'OESTE', area: 'Catia La Mar' });
  eq('Caraballeda es del Este', U.zonaCardinal('Residencias Breogán Caraballeda'), { cardinal: 'ESTE', area: 'Caraballeda' });
  eq('los corales, del Este', U.zonaCardinal('Iglesia espiritu santo los corales'), { cardinal: 'ESTE', area: 'Los Corales' });
  eq('sin acentos también', U.zonaCardinal('cantera de naiguata'), { cardinal: 'ESTE', area: 'Naiguatá' });
  // Lo que no nombra ningún área NO se inventa: queda vacío y alguien lo verá.
  eq('un nombre que no dice nada', U.zonaCardinal('Res Coral beach'), { cardinal: '', area: '' });
  eq('vacío', U.zonaCardinal(''), { cardinal: '', area: '' });
  eq('«CDF» no es un cardinal', U.zonaCardinal('CDF'), { cardinal: '', area: '' });

  // El GPS del día manda sobre todo lo demás.
  const f = U.armarUbicaciones(base);
  const m1_15 = f.find((x) => x.maquina.id === 'm1' && x.fecha === '2026-09-15');
  eq('el cardinal sale del GPS del día', [m1_15.cardinal, m1_15.area, m1_15.cardinalOrigen], ['ESTE', 'Caraballeda', 'gps']);

  // Una obra que no nombra su área HEREDA el cardinal de las máquinas con GPS que
  // están en esa misma obra. Acá «CASA SIN NOMBRE» solo la delata m5 (que sí tiene GPS).
  const M5 = { id: 'm5', code: 'AAA-CON-GPS', marca: '', modelo: '', placa: '', empresa: 'EMPRESA ALFA', clasificacion: '', referenciaActual: 'CASA SIN NOMBRE' };
  const M6 = { id: 'm6', code: 'BBB-SIN-GPS', marca: '', modelo: '', placa: '', empresa: 'EMPRESA ALFA', clasificacion: '', referenciaActual: 'CASA SIN NOMBRE' };
  const conObra = {
    ...base, maquinas: [M5, M6],
    puntos: [{ machineryId: 'm5', at: '2026-09-15T08:00:00-04:00', sector: 'Oeste · Catamare' }],
    cambios: [], visitas: [],
    rondas: [
      { machineryId: 'm5', fecha: '2026-09-15', dia: 8, noche: 0, parada: 0, estado: 'operativa', inspectorDia: 'i', inspectorNoche: null },
      { machineryId: 'm6', fecha: '2026-09-15', dia: 5, noche: 0, parada: 0, estado: 'operativa', inspectorDia: 'i', inspectorNoche: null },
    ],
  };
  const fo = U.armarUbicaciones(conObra);
  const g5 = fo.find((x) => x.maquina.id === 'm5'), g6 = fo.find((x) => x.maquina.id === 'm6');
  eq('la que tiene GPS marca la obra', [g5.cardinal, g5.cardinalOrigen], ['OESTE', 'gps']);
  eq('la de al lado hereda el cardinal de la obra', [g6.cardinal, g6.area, g6.cardinalOrigen], ['OESTE', 'Catamare', 'obra']);

  // Último recurso: la columna `sector` del catálogo, y SOLO si dice un cardinal.
  const M7 = { id: 'm7', code: 'CCC', marca: '', modelo: '', placa: '', empresa: 'EMPRESA ALFA', clasificacion: '', referenciaActual: '', cardinalFicha: 'Oeste' };
  const M8 = { id: 'm8', code: 'DDD', marca: '', modelo: '', placa: '', empresa: 'EMPRESA ALFA', clasificacion: '', referenciaActual: '', cardinalFicha: 'CDT' };
  const conFicha = {
    ...base, maquinas: [M7, M8], puntos: [], cambios: [], visitas: [],
    rondas: [
      { machineryId: 'm7', fecha: '2026-09-15', dia: 1, noche: 0, parada: 0, estado: 'parada', inspectorDia: null, inspectorNoche: null },
      { machineryId: 'm8', fecha: '2026-09-15', dia: 1, noche: 0, parada: 0, estado: 'parada', inspectorDia: null, inspectorNoche: null },
    ],
  };
  const ff = U.armarUbicaciones(conFicha);
  const g7 = ff.find((x) => x.maquina.id === 'm7'), g8 = ff.find((x) => x.maquina.id === 'm8');
  eq('la ficha sirve cuando dice Oeste', [g7.cardinal, g7.cardinalOrigen], ['OESTE', 'ficha']);
  // «No me puede quedar nada sin punto cardinal, colócale uno random» (22-sep-2026):
  // «CDT» no es cardinal, así que cae al azar; pero un azar ESTABLE, por id.
  eq('«CDT» en la ficha no inventa cardinal: va al azar', [g8.cardinal, g8.cardinalOrigen], [U.cardinalAlAzar('m8'), 'azar']);
  eq('el azar es estable: el mismo id, el mismo lado', U.cardinalAlAzar('m8'), U.cardinalAlAzar('m8'));
  const lados = new Set(Array.from({ length: 50 }, (_x, i) => U.cardinalAlAzar('maq-' + i)));
  eq('...y reparte entre los dos lados', Array.from(lados).sort(), ['ESTE', 'OESTE']);
  const lado8 = U.cardinalAlAzar('m8');

  // El resumen reparte máquinas y áreas entre Este y Oeste, y cuenta las que faltan.
  const r = U.resumenUbicaciones(fo.concat(ff));
  eq('el resumen reparte por cardinal', r.cardinales.map((c) => [c.cardinal, c.maquinas, c.filas]), lado8 === 'OESTE' ? [['OESTE', 4, 4]] : [['ESTE', 1, 1], ['OESTE', 3, 3]]);
  eq('...y dice en qué áreas', r.cardinales.find((c) => c.cardinal === 'OESTE').areas, ['Catamare']);
  eq('...y cuenta la que fue al azar', r.alAzar, 1);

  // El alcance lo explica, y se calla si la columna está oculta.
  const alc = { empresas: [], clasificaciones: [], maquinas: [] };
  const conCard = U.alcanceUbicacionesEnPalabras('2026-09-14', '2026-09-16', alc, U.OPCIONES_UBICACIONES_COMPLETO, true, r).join(' | ');
  ok('el alcance dice cuántas máquinas y en qué áreas', /OESTE: [34] máquina\(s\) · Catamare\./.test(conCard));
  ok('...sin contar renglones por cardinal', !/renglón\(es\) · Catamare/.test(conCard));
  ok('el alcance cuenta las que fueron al azar', /1 máquina\(s\) sin GPS ni obra conocida: repartidas al azar/.test(conCard));
  // Más corto: sin la leyenda de las celdas ni «Sale completo».
  ok('el alcance ya no trae la leyenda larga', !/registrada el DD\/MM/.test(conCard) && !/Sale completo/.test(conCard));
  ok('el alcance cabe en pocas líneas', conCard.split(' | ').length <= 5);
  const sinCard = U.alcanceUbicacionesEnPalabras('2026-09-14', '2026-09-16', alc, { ...U.OPCIONES_UBICACIONES_COMPLETO, sinCardinal: true }, true, r).join(' | ');
  ok('oculto el cardinal, el alcance no lo menciona', !/referencia cardinal:/i.test(sinCard));

  // El papel: encabezado, valores y el aviso en rojo de la que no tiene.
  const papel = U.cuerpoUbicaciones({ desde: '2026-09-14', hasta: '2026-09-16', filas: fo.concat(ff), opciones: U.OPCIONES_UBICACIONES_COMPLETO, alcance: alc, hayBitacora: true });
  ok('la tabla trae la columna', /<th class="cd">Cardinal<\/th>/.test(papel));
  ok('y la celda con su valor', /<td class="cd">OESTE<\/td>/.test(papel));
  ok('la que fue al azar lo dice en la celda', /<td class="cd">(ESTE|OESTE)<br\/><span class="ub-arr">al azar<\/span><\/td>/.test(papel));
  ok('ninguna celda queda sin cardinal', !/<td class="cd">—/.test(papel) && !/ub-sin">—/.test(papel));
  ok('el resumen de arriba cuenta las del Oeste', new RegExp(`<b>${lado8 === 'OESTE' ? 4 : 3}</b>al Oeste`).test(papel));
  const papelSin = U.cuerpoUbicaciones({ desde: '2026-09-14', hasta: '2026-09-16', filas: fo, opciones: { ...U.OPCIONES_UBICACIONES_COMPLETO, sinCardinal: true }, alcance: alc, hayBitacora: true });
  ok('oculta, la columna no sale', !/>Cardinal</.test(papelSin));
  eq('ocultarla no saca filas', U.armarUbicaciones(conObra).length, fo.length);
  ok('el archivo lo dice', /sin cardinal/.test(U.sufijoArchivoUbicaciones({ ...U.OPCIONES_UBICACIONES_COMPLETO, sinCardinal: true })));

  // La carga trae la columna `sector` del catálogo para el último recurso.
  const db = leer('src/lib/ubicacionesReporteDb.ts');
  ok('la carga pide el sector del catálogo', /clasificacion, referencia, sector, latitude/.test(db));
  ok('...y lo pasa como cardinalFicha', /cardinalFicha: limpio\(m\.sector\)/.test(db));
}

// ── 13) EL PAPEL RESUMIDO (como «Máquinas por sector» del mapa) ──────────────
// Pedido del cliente (22-sep-2026): «que sea como el de máquinas por sector en el mapa,
// y tener un PDF más genérico, más resumido, en ese mismo apartado de ubicaciones».
{
  const M9 = { id: 'm9', code: 'PAYLOADER', marca: 'MX', modelo: 'M9', placa: 'P9', empresa: 'EMPRESA ALFA', clasificacion: '', referenciaActual: 'PATIO - CAMURI CHICO' };
  const M10 = { id: 'm10', code: 'CISTERNA', marca: '', modelo: '', placa: 'C10', empresa: 'EMPRESA BETA', clasificacion: '', referenciaActual: 'HOTEL LITORAL SUITES - CATIA LA MAR' };
  const dos = {
    desde: '2026-09-14', hasta: '2026-09-16', maquinas: [M9, M10],
    puntos: [
      { machineryId: 'm9', at: '2026-09-14T08:00:00-04:00', sector: 'Este · Macuto' },
      { machineryId: 'm9', at: '2026-09-16T08:00:00-04:00', sector: 'Este · Camurí Chico' }, // se movió
    ],
    cambios: [], visitas: [],
    rondas: [
      { machineryId: 'm9', fecha: '2026-09-14', dia: 8, noche: 0, parada: 0, estado: 'operativa', inspectorDia: 'Inspector Uno', inspectorNoche: null },
      { machineryId: 'm9', fecha: '2026-09-16', dia: 6, noche: 0, parada: 0, estado: 'operativa', inspectorDia: null, inspectorNoche: null },
      { machineryId: 'm10', fecha: '2026-09-15', dia: 4, noche: 0, parada: 0, estado: 'operativa', inspectorDia: 'Inspector Dos', inspectorNoche: null },
    ],
    hayBitacora: true,
  };
  const filas = U.armarUbicaciones(dos);
  const res = U.resumirPorMaquina(filas);
  eq('una línea por máquina, no por día', res.length, 2);
  const r9 = res.find((m) => m.maquina.id === 'm9');
  eq('suma los días y las horas del rango', [r9.dias, r9.horas], [2, 14]);
  eq('la agrupa donde TERMINÓ el rango', [r9.cardinal, r9.area], ['ESTE', 'Camurí Chico']);
  eq('y dice que se movió', r9.sectores, 2);
  eq('hereda el último inspector que sí hubo', r9.inspector, 'Inspector Uno');
  const r10 = res.find((m) => m.maquina.id === 'm10');
  eq('la cisterna sin GPS sale por el nombre de la obra', [r10.cardinal, r10.area], ['OESTE', 'Catia La Mar']);

  const g = U.agruparPorCardinal(res);
  eq('dos bloques: Este y Oeste', g.map((x) => [x.emoji, x.titulo, x.maquinas]), [['🟢', 'SECTOR ESTE', 1], ['🟠', 'SECTOR OESTE', 1]]);
  eq('el bloque suma sus horas', g[0].horas, 14);
  eq('y se abre por área', g[0].areas.map((a) => [a.nombre, a.maquinas.length]), [['Camurí Chico', 1]]);

  const alc = { empresas: [], clasificaciones: [], maquinas: [] };
  const papel = U.cuerpoUbicacionesResumen({ desde: '2026-09-14', hasta: '2026-09-16', filas, opciones: U.OPCIONES_UBICACIONES_COMPLETO, alcance: alc, hayBitacora: true });
  ok('el papel trae la franja del sector', /<h3 class="sect">🟢 SECTOR ESTE/.test(papel));
  ok('...y la del Oeste', /<h3 class="sect">🟠 SECTOR OESTE/.test(papel));
  ok('el área va como subtítulo', /<h4 class="sub2">📍 Camurí Chico/.test(papel));
  ok('avisa de la que se movió', /estuvo en 2 sitios/.test(papel));
  ok('no repite los días', !/15\/09\/2026 —/.test(papel));
  ok('el alcance del resumen también es corto', !/Cada máquina sale UNA vez/.test(papel) && /ESTE: 1 máquina\(s\) · Camurí Chico, Macuto\./.test(papel)); // las áreas son las del RANGO, no solo la última
  const sinHoras = U.cuerpoUbicacionesResumen({ desde: '2026-09-14', hasta: '2026-09-16', filas, opciones: { ...U.OPCIONES_UBICACIONES_COMPLETO, sinHoras: true }, alcance: alc, hayBitacora: true });
  ok('las pastillas también mandan en el resumen', !/Total h/.test(sinHoras));
  const sinEmpresa = U.cuerpoUbicacionesResumen({ desde: '2026-09-14', hasta: '2026-09-16', filas, opciones: { ...U.OPCIONES_UBICACIONES_COMPLETO, sinEmpresa: true }, alcance: alc, hayBitacora: true });
  ok('...y la empresa se puede quitar', !/EMPRESA ALFA/.test(sinEmpresa));
  // Sin cardinal conocido, el bloque blanco del mapa.
  const M11 = { id: 'm11', code: 'ZZZ', marca: '', modelo: '', placa: '', empresa: 'E', clasificacion: '', referenciaActual: '' };
  const solo = U.armarUbicaciones({ ...dos, maquinas: [M11], puntos: [], rondas: [{ machineryId: 'm11', fecha: '2026-09-15', dia: 0, noche: 0, parada: 0, estado: 'parada', inspectorDia: null, inspectorNoche: null }] });
  eq('sin GPS, sin obra y sin ficha, igual cae en Este u Oeste', U.agruparPorCardinal(U.resumirPorMaquina(solo)).map((x) => x.titulo), [U.cardinalAlAzar('m11') === 'ESTE' ? 'SECTOR ESTE' : 'SECTOR OESTE']);
  ok('...y ya no existe el bloque «sin referencia cardinal»', !/SIN REFERENCIA CARDINAL/.test(leer('src/lib/ubicacionesReporte.ts')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-ubicaciones-reporte · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
