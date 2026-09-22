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
const base = {
  desde: '2026-09-14', hasta: '2026-09-16',
  maquinas: [M1, M2, M3],
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
  ],
  hayBitacora: true,
};
const filas = U.armarUbicaciones(base);
const fila = (id, fecha) => filas.find((f) => f.maquina.id === id && f.fecha === fecha);

// ── 3) UNA FILA POR MÁQUINA Y DÍA, SOLO SI PASÓ ALGO ─────────────────────────
{
  eq('⭐ salen solo los días con ronda, check-in o punto (por fecha y luego por código)', filas.map((f) => `${f.fecha}|${f.maquina.id}`), ['2026-09-14|m2', '2026-09-14|m1', '2026-09-15|m1', '2026-09-16|m3']);
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
  eq('⭐ sin ningún punto nunca (ni catálogo): sin ubicación, y contado', [f16.sector, f16.sinUbicacion, f16.sectorOrigen], ['Sin ubicación', true, 'ninguno']);
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
  eq('cuenta máquinas, días, renglones y horas', [r.maquinas, r.dias, r.filas, r.horas], [3, 3, 4, 24]);
  eq('⭐ cuenta sin ubicación y arrastradas', [r.sinUbicacion, r.arrastradas], [1, 1]);
  eq('sectores por horas', r.sectores.map((s) => s.nombre), ['Este · Caraballeda', 'Este · Camurí Chico', 'Fuera de zona', 'Sin ubicación']);
  const r2 = U.resumenUbicaciones(U.armarUbicaciones({ ...base, maquinas: [M1, M2, { ...M3, sectorActual: 'Oeste · Catia La Mar' }] }));
  eq('la del catálogo cuenta como completada, no como sin ubicación', [r2.sinUbicacion, r2.arrastradas], [0, 2]);
}

// ── 8) LAS PASTILLAS: OCULTAR NO ES FILTRAR ──────────────────────────────────
{
  eq('diez pastillas', U.PASTILLAS_UBICACIONES.map((p) => p.chip), ['🚫 Marca', '🚫 Modelo', '🚫 Serial / Placa', '🚫 Empresa', '🚫 Sector (GPS)', '🚫 Edificio / obra', '🚫 Inspector', '🚫 Estado', '🚫 Horas', '🚫 Alcance del informe']);
  ok('cada pastilla es una opción que existe', U.PASTILLAS_UBICACIONES.every((p) => p.key in U.OPCIONES_UBICACIONES_COMPLETO));
  eq('completo trae todas las columnas', U.columnasUbicaciones(U.OPCIONES_UBICACIONES_COMPLETO), ['fecha', 'code', 'marcaModelo', 'placa', 'empresa', 'sector', 'edificio', 'inspector', 'estado', 'dia', 'noche', 'total']);
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
  ok('un bloque por día', /<h3>14\/09\/2026 — 2 máquina\(s\)/.test(h) && /<h3>15\/09\/2026 — 1 máquina\(s\)/.test(h) && /<h3>16\/09\/2026/.test(h));
  ok('⭐ la celda tomada del día siguiente lo dice', /Este · Camurí Chico<br\/><span class="ub-arr">registrada el 15\/09\/2026<\/span>/.test(h));
  const hMix = U.cuerpoUbicaciones({ desde: base.desde, hasta: base.hasta, filas: U.armarUbicaciones({ ...base, puntos: [{ machineryId: 'm1', at: '2026-09-10T12:00:00-04:00', sector: 'Este · Macuto' }], maquinas: [M1, { ...M2, sectorActual: 'Oeste · Aeropuerto' }, { ...M3, sectorActual: 'Oeste · Catia La Mar' }] }), opciones: U.OPCIONES_UBICACIONES_COMPLETO, alcance: { empresas: [], clasificaciones: [], maquinas: [] }, hayBitacora: true });
  ok('⭐ «desde el» y «ubicación actual» según el caso, y ya no hay «sin ubicación»', /Este · Macuto<br\/><span class="ub-arr">desde el 10\/09\/2026<\/span>/.test(hMix) && /Oeste · Catia La Mar<br\/><span class="ub-arr">ubicación actual<\/span>/.test(hMix) && !/Sin ubicación/.test(hMix));
  ok('⭐ «sin ubicación» en rojo', /<span class="ub-sin">Sin ubicación<\/span>/.test(h));
  ok('el edificio arrastrado lleva *', /PATIO \*/.test(h));
  ok('el resumen cuenta', /<b>1<\/b>sin ubicación/.test(h) && /<b>1<\/b>ubicación completada/.test(h) && /<b>24 h<\/b>/.test(h));
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
  ok('el archivo lleva filtros y ocultos', /`Ubicaciones \$\{rng\}\$\{sufijoArchivoFiltroJornada\(filtroEqActual\)\}\$\{sufijoArchivoUbicaciones\(opUbic\)\}`/.test(p));
}

// ── 11) MANUALES ─────────────────────────────────────────────────────────────
{
  ok('manual (md)', /Histórico de ubicaciones por máquina \(22\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
  ok('manual (app)', /HISTÓRICO DE UBICACIONES POR MÁQUINA \(22\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-ubicaciones-reporte · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
