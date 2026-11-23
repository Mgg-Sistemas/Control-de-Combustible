/*
 * RESPONSABLES EN LOS REPORTES HERMANOS (23-nov-2026).
 *
 * La Lista completa ya tiene el eje `responsable`. Este archivo fija que el
 * mismo filtro —con la MISMA semántica— llegue a los otros papeles del módulo:
 *
 *  · Informe operativo, Pago por viajes y Pago por peso → responsable CONGELADO
 *    en cada viaje (reasignar hoy no reescribe el pasado);
 *  · Lista de máquinas, metas y Reporte de taras → responsable VIGENTE.
 *
 * También cuida la compatibilidad: los llamadores viejos que no mandan
 * `responsables` siguen recibiendo EXACTAMENTE el objeto de siempre, y sin el
 * SQL de responsables los archivos siguen saliendo.
 *
 *   node scripts/test-responsables-reportes-hermanos.mjs
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

function load(rel) {
  const srcPath = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  m._compile(out, m.filename);
  return m.exports;
}

const OP = load('src/lib/informeOperativo.ts');
const PV = load('src/lib/pagoViajesReporte.ts');
const PP = load('src/lib/pagoPeso.ts');
const RESP = load('src/lib/camionResponsables.ts');

const {
  claveResponsableOp, SIN_RESPONSABLE_OP, filtrarViajesOperativo, acotarFiltroOperativo,
  FILTRO_OPERATIVO_TODO, OPCIONES_OPERATIVO_INICIAL, resumenOperativo, cuerpoInformeOperativo,
} = OP;
const {
  claveResponsableLinea, SIN_RESPONSABLE_PAGO, filtrarLineasPago, acotarFiltroPago,
  FILTRO_PAGO_TODO, OPCIONES_PAGO_COMO_ANTES, alcancePagoEnPalabras, sufijoArchivoPago,
} = PV;
const {
  claveResponsableLineaPeso, SIN_RESPONSABLE_PESO, filtrarLineasPeso, acotarFiltroPeso,
  FILTRO_PESO_TODO, OPCIONES_PESO_POR_DEFECTO, alcancePesoEnPalabras, sufijoArchivoPeso,
  filtroPesoActivo,
} = PP;
const { SIN_RESPONSABLE, pasaFiltroResponsables } = RESP;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

eq('la cubeta es LA MISMA en los cuatro módulos', [SIN_RESPONSABLE_OP, SIN_RESPONSABLE_PAGO, SIN_RESPONSABLE_PESO, SIN_RESPONSABLE], Array(4).fill('__sin_responsable__'));

// ── 1) INFORME OPERATIVO: foto del viaje ─────────────────────────────────────
{
  const viaje = (id, extra = {}) => ({
    id, machinery_id: `M${id}`, machine_code: `VOLTEO ${id}`, company_id: 'E1',
    registered_at: '2026-10-06T10:00:00-04:00', peso_neto_kg: 10000,
    ubicacion_nombre: 'Obra A', listero_name: 'L1', frente_nombre: 'F1',
    formato_nombre: 'Principal', zona_pago: 'este', ...extra,
  });
  const viajes = [
    viaje('a', { responsable_id: 'r1' }),
    viaje('b', { responsable_id: 'r2', responsable_nombre: 'Nombre Viejo' }),
    viaje('c', { responsable_nombre: '  José   Pérez ' }),
    viaje('d'),
  ];
  eq('id manda sobre el nombre', claveResponsableOp(viajes[1]), 'r2');
  eq('sin id, el nombre se normaliza', claveResponsableOp(viajes[2]), 'nombre:jose perez');
  eq('sin foto, cubeta de «Sin responsable»', claveResponsableOp(viajes[3]), SIN_RESPONSABLE);
  eq('también entiende el camelCase del array de la pantalla', claveResponsableOp({ responsableId: 'r9' }), 'r9');

  const filtro = (responsables) => ({ ...FILTRO_OPERATIVO_TODO, responsables });
  eq('vacío = todos', filtrarViajesOperativo(viajes, filtro([])).length, 4);
  eq('OR dentro del eje', filtrarViajesOperativo(viajes, filtro(['r1', 'r2'])).map((v) => v.id), ['a', 'b']);
  eq('«Sin responsable» se puede elegir', filtrarViajesOperativo(viajes, filtro([SIN_RESPONSABLE])).map((v) => v.id), ['d']);
  eq('Y entre ejes', filtrarViajesOperativo(viajes, { ...filtro(['r1', 'r2']), camiones: ['Ma'] }).map((v) => v.id), ['a']);
  eq('un filtro viejo sin responsables no filtra nada', filtrarViajesOperativo(viajes, { empresas: [], obras: [] }).length, 4);

  eq('acotar conserva lo vigente y quita el fantasma', acotarFiltroOperativo(
    { ...filtro(['r1', 'FANTASMA']), empresas: [], zonas: [] },
    { empresas: [], obras: [], zonas: [], camiones: [], responsables: ['r1'] },
  ).responsables, ['r1']);
  eq('⭐ llamador viejo: objeto EXACTAMENTE igual', acotarFiltroOperativo(
    { empresas: ['E1', 'FANTASMA'], obras: [], zonas: ['Este'], camiones: ['C9'] },
    { empresas: ['E1', 'E2'], obras: [], zonas: ['Este', 'Oeste'], camiones: ['C1'] },
  ), { empresas: ['E1'], obras: [], zonas: ['Este'], camiones: [] });

  const base = {
    resumen: resumenOperativo(viajes, '2026-10-06', '2026-10-06'),
    viajes, desde: '2026-10-06', hasta: '2026-10-06',
    opciones: { ...OPCIONES_OPERATIVO_INICIAL }, filtro: filtro(['r1']),
    nombresEmpresa: new Map([['E1', 'EMPRESA UNO']]),
  };
  const html = cuerpoInformeOperativo({ ...base, opciones: { ...base.opciones, sinAlcance: false }, etiquetaResponsable: 'Responsable: Juan' });
  ok('el papel dice el responsable filtrado', html.includes('Responsable: Juan.') && html.includes('FILTRADO: este papel NO es toda la operación.'));
  ok('sin etiqueta, el alcance sigue como siempre', !cuerpoInformeOperativo({ ...base, opciones: { ...base.opciones, sinAlcance: false } }).includes('Responsable: Juan'));
}

// ── 2) PAGO POR VIAJES: la plata NO se recalcula, solo se acota ───────────────
{
  const linea = (id, responsable_id, responsable_nombre = null) => ({ viaje: {
    id, company_id: 'EA', ubicacion_nombre: 'Obra A', machinery_id: 'M1',
    zona_pago: 'este', registered_at: '2026-10-06T10:00:00-04:00',
    responsable_id, responsable_nombre,
  } });
  const lineas = [linea('a', 'r1'), linea('b', 'r2'), linea('c', null, 'José Pérez'), linea('d', null, null)];
  eq('id manda', claveResponsableLinea(lineas[1]), 'r2');
  eq('nombre normalizado', claveResponsableLinea(lineas[2]), 'nombre:jose perez');
  eq('sin foto', claveResponsableLinea(lineas[3]), SIN_RESPONSABLE);
  eq('vacío = todas las líneas', filtrarLineasPago(lineas, FILTRO_PAGO_TODO).length, 4);
  eq('OR dentro del responsable', filtrarLineasPago(lineas, { ...FILTRO_PAGO_TODO, responsables: ['r1', 'r2'] }).map((l) => l.viaje.id), ['a', 'b']);
  eq('se puede pedir solo «Sin responsable»', filtrarLineasPago(lineas, { ...FILTRO_PAGO_TODO, responsables: [SIN_RESPONSABLE] }).map((l) => l.viaje.id), ['d']);
  eq('Y con otro eje', filtrarLineasPago(lineas, { ...FILTRO_PAGO_TODO, responsables: ['r1', 'r2'], obras: ['Obra A'], empresas: ['EA'] }).length, 2);
  eq('llamador viejo', filtrarLineasPago(lineas, { empresas: [], obras: [], maquinas: [] }).length, 4);
  eq('acotar conserva responsables', acotarFiltroPago(
    { empresas: [], obras: [], maquinas: [], responsables: ['r1', 'ZZ'] },
    { empresas: [], obras: [], responsables: ['r1'] },
  ).responsables, ['r1']);
  eq('⭐ acotar viejo: objeto exacto', acotarFiltroPago(
    { empresas: ['EA', 'ZZ'], obras: [], maquinas: [] },
    { empresas: ['EA'], obras: [] },
  ), { empresas: ['EA'], obras: [], maquinas: [], zonas: [] });

  const alc = alcancePagoEnPalabras({ ...FILTRO_PAGO_TODO, responsables: ['r1'] }, 'empresa', OPCIONES_PAGO_COMO_ANTES, new Map(), 'Responsable: Juan');
  ok('el alcance del PDF nombra al responsable y avisa del filtro', alc.includes('Responsable: Juan') && alc.some((s) => /FILTRADO/.test(s)));
  eq('el sufijo lo distingue sin caracteres de archivo raros', sufijoArchivoPago({ ...FILTRO_PAGO_TODO, responsables: [SIN_RESPONSABLE] }, 'empresa', OPCIONES_PAGO_COMO_ANTES).includes('sin responsable'), true);
  eq('dos responsables → sufijo corto', sufijoArchivoPago({ ...FILTRO_PAGO_TODO, responsables: ['r1', 'r2'] }, 'empresa', OPCIONES_PAGO_COMO_ANTES).includes('resp-2'), true);
  eq('sin selección, el sufijo sigue vacío', sufijoArchivoPago(FILTRO_PAGO_TODO, 'empresa', OPCIONES_PAGO_COMO_ANTES), '');
}

// ── 3) PAGO POR PESO: misma semántica, tabla distinta ────────────────────────
{
  const linea = (id, responsable_id, responsable_nombre = null) => ({ viaje: {
    id, company_id: 'EA', ubicacion_nombre: 'Obra A', frente_nombre: 'F1',
    machinery_id: 'M1', zona_pago: 'este', registered_at: '2026-10-06T10:00:00-04:00',
    responsable_id, responsable_nombre,
  } });
  const lineas = [linea('a', 'r1'), linea('b', 'r2'), linea('c', null, 'José Pérez'), linea('d')];
  eq('clave de peso coherente con la de viajes', [claveResponsableLineaPeso(lineas[0]), claveResponsableLineaPeso(lineas[2]), claveResponsableLineaPeso(lineas[3])], ['r1', 'nombre:jose perez', SIN_RESPONSABLE]);
  eq('vacío = todas', filtrarLineasPeso(lineas, FILTRO_PESO_TODO).length, 4);
  eq('OR y cubeta', filtrarLineasPeso(lineas, { ...FILTRO_PESO_TODO, responsables: ['r1', SIN_RESPONSABLE] }).map((l) => l.viaje.id), ['a', 'd']);
  eq('Y con otro eje', filtrarLineasPeso(lineas, { ...FILTRO_PESO_TODO, responsables: ['r1', 'r2'], frentes: ['F1'] }).length, 2);
  eq('llamador viejo', filtrarLineasPeso(lineas, { empresas: [], obras: [], maquinas: [], frentes: [] }).length, 4);
  eq('acotar conserva responsables', acotarFiltroPeso(
    { empresas: [], obras: [], maquinas: [], frentes: [], responsables: ['r1', 'ZZ'] },
    { empresas: [], obras: [], maquinas: [], frentes: [], responsables: ['r1'] },
  ).responsables, ['r1']);
  eq('⭐ acotar viejo: objeto exacto', acotarFiltroPeso(
    { empresas: ['E1', 'ZZ'], obras: ['x'], maquinas: [], frentes: ['f'] },
    { empresas: ['E1'], obras: [], maquinas: [], frentes: ['f'] },
  ), { empresas: ['E1'], obras: [], maquinas: [], frentes: ['f'] });
  ok('filtro activo lo detecta', filtroPesoActivo({ ...FILTRO_PESO_TODO, responsables: ['r1'] }));
  ok('alcance con etiqueta', alcancePesoEnPalabras({ ...FILTRO_PESO_TODO, responsables: ['r1'] }, 'empresa', OPCIONES_PESO_POR_DEFECTO, new Map(), 'Responsable: Juan').includes('Responsable: Juan'));
  ok('sufijo con cubeta', sufijoArchivoPeso({ ...FILTRO_PESO_TODO, responsables: [SIN_RESPONSABLE] }, 'empresa', OPCIONES_PESO_POR_DEFECTO).includes('sin responsable'));
  eq('sufijo viejo sigue vacío', sufijoArchivoPeso(FILTRO_PESO_TODO, 'empresa', OPCIONES_PESO_POR_DEFECTO), '');
}

// ── 4) REPORTES POR CAMIÓN: manda el VIGENTE ─────────────────────────────────
{
  eq('vacío = todos', pasaFiltroResponsables([], 'r1'), true);
  eq('OR dentro del eje', pasaFiltroResponsables(['r1', 'r2'], 'r2'), true);
  eq('no incluido quita el camión', pasaFiltroResponsables(['r1'], 'r2'), false);
  eq('sin asignación cae en la cubeta', pasaFiltroResponsables([SIN_RESPONSABLE], SIN_RESPONSABLE), true);

  const lista = sinComentarios(leer('src/components/ListaCamionesViajes.tsx'));
  ok('⭐ la lista de máquinas filtra por el VIGENTE', /pasaFiltroResponsables\(responsablesSel, responsableVigenteClave\?\.\[m\.id\] \?\? SIN_RESPONSABLE\)/.test(lista));
  ok('...y sigue pintando «Le trabaja a»', lista.includes('🧑‍🔧 Le trabaja a:'));

  const taras = sinComentarios(leer('src/components/ReporteTarasBox.tsx'));
  ok('⭐ el papel de taras filtra la flota por el VIGENTE', /camiones\.filter\(\(c\) => pasaFiltroResponsables\(responsablesSel, responsableVigenteClave\?\.\[c\.id\] \?\? SIN_RESPONSABLE\)\)/.test(taras));
  ok('...y el PDF lo dice en el subtítulo', /etiquetaResp \? ` · \$\{etiquetaResp\}`/.test(taras));
  ok('...y el nombre del archivo lleva el sufijo', /\$\{nombreBase\}\$\{sResp \?/.test(taras));
  ok('...sin romper el nombre de siempre', taras.includes('nombreArchivoTaras(op.alcance, caracasBusinessToday(), op)'));

  const pantalla = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
  ok('⭐ las metas filtran por el vigente', /camionesEnObra\.filter\(\(t\) => pasaRespVigente\(t\.id\)\)\.map/.test(pantalla));
  ok('...y hay un control para elegirlo', /FILTRAR REPORTES POR CAMIÓN \(RESPONSABLE VIGENTE\)/.test(pantalla));
  ok('...distinto del filtro congelado de los viajes', /const \[filterRespVigenteSel, setFilterRespVigenteSel\]/.test(pantalla));
}

// ── 5) COMPATIBILIDAD: sin SQL, nada se rompe ────────────────────────────────
{
  for (const rel of [
    'src/components/InformeOperativoCard.tsx',
    'src/lib/pagoViajesDb.ts',
    'src/lib/pagoPesoDb.ts',
  ]) {
    const src = sinComentarios(leer(rel));
    ok(`${rel}: pide las columnas nuevas y cae a las viejas`, /responsable_id, responsable_nombre/.test(src) && /\.catch\(\(\) => selectAllRows/.test(src));
  }
  const op = sinComentarios(leer('src/lib/informeOperativo.ts'));
  ok('informeOperativo sigue sin imports (lo exige su suite)', !/^\s*import\s/m.test(op));
}

console.log(`\nRESPONSABLES EN REPORTES HERMANOS: ${pass} OK, ${fail} FAIL`);
if (failures.length) { console.log('\nFallos:'); console.log(failures.join('\n')); }
console.log('');
if (fail) process.exit(1);
