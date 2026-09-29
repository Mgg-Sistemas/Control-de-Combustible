/*
 * Test de los FRENTES DE TRABAJO (28-sep-2026).
 *
 * QUÉ PEDIDO CUBRE
 *   «hay que colocar los frentes, que es de donde recogen los camiones lo que
 *   llevan a los CDT o CDF (…) que ellos colocarían diariamente a cada camión
 *   o a un grupo» + «el histórico debería poder agregarle frentes a los que ya
 *   se hicieron, y también poder cargarlos a mano, y la opción de crear nuevos
 *   frentes y tener un buscador para buscar los camiones» + «en esos dos
 *   reportes poder agrupar por frente, y la columna para ocultarlo/mostrarlo».
 *
 * LO QUE BLINDA — y por qué cada cosa
 *   · EL FRENTE ES UNA FOTO. Se congela al registrar (o al corregir), como la
 *     obra y la placa: reasignar el camión mañana no puede mover los viajes de
 *     hoy, o un reporte entregado dejaría de cuadrar.
 *   · LO NUEVO ENTRA APAGADO. La columna del frente nace apagada en los DOS
 *     papeles: quien no toque nada saca el PDF de ayer, byte a byte.
 *   · EL FRENTE NO TOCA UN CENTAVO. En el pago solo agrupa y rotula: el total
 *     con eje frente es el MISMO que con eje empresa.
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

const cargar = (rel) => {
  const srcPath = path.join(ROOT, rel);
  const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(srcPath);
  m.filename = srcPath;
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  m._compile(out, m.filename);
  return m.exports;
};
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); }
};

// ── 1) EL EJE «FRENTE» DEL RESUMEN (viajesResumen.ts) ───────────────────────
const V = cargar('src/lib/viajesResumen.ts');

eq('la clave del frente es su id', V.claveFrenteViaje({ frenteId: 'f1', frenteNombre: 'Norte' }), 'f1');
eq('⭐ sin id, el NOMBRE congelado sirve de repuesto (frente borrado)', V.claveFrenteViaje({ frenteNombre: ' Norte  ' }), 'nombre:norte');
eq('sin nada, la cubeta «sin frente»', V.claveFrenteViaje({}), V.SIN_FRENTE);

const filas = [
  { machineryId: 'm1', machineCode: 'V1', turno: 'day', frenteId: 'f1', frenteNombre: 'Frente norte' },
  { machineryId: 'm1', machineCode: 'V1', turno: 'day', frenteId: 'f1', frenteNombre: 'Frente norte' },
  { machineryId: 'm2', machineCode: 'V2', turno: 'night', frenteId: 'f2', frenteNombre: 'Frente sur' },
  { machineryId: 'm3', machineCode: 'V3', turno: 'day' }, // viejo, sin frente
];
const cat = () => ({ companyId: 'e1', companyName: 'EMPRESA' });
const R = V.resumirViajes(filas, cat, 'frente');
eq('agrupar por frente parte en 3 (norte, sur, sin frente)', R.empresas.length, 3);
eq('el total no se mueve por agrupar distinto', R.total, 4);
ok('el grupo grande es el norte con 2', R.empresas[0].name === 'Frente norte' && R.empresas[0].total === 2);
ok('⭐ los sin frente no se pierden: cubeta «Sin frente»', R.empresas.some((e) => e.name === 'Sin frente' && e.total === 1));
eq('…y agrupando por empresa los mismos 4 viajes', V.resumirViajes(filas, cat, 'empresa').total, 4);

// ── 2) LA COLUMNA EN LA LISTA COMPLETA (cubicaje.ts) ────────────────────────
const C = cargar('src/lib/cubicaje.ts');
ok('⭐ la columna del frente entra APAGADA', C.OPCIONES_POR_DEFECTO.frente === false);
ok('encendida, el detallado la trae', C.columnasDetalle({ ...C.OPCIONES_POR_DEFECTO, frente: true }).some((c) => c.key === 'frente'));
ok('apagada, no está', !C.columnasDetalle(C.OPCIONES_POR_DEFECTO).some((c) => c.key === 'frente'));
ok('⭐ agrupando por frente la columna se omite (ya está en el encabezado)',
  !C.columnasDetalle({ ...C.OPCIONES_POR_DEFECTO, frente: true }, 'frente').some((c) => c.key === 'frente'));
ok('el resumido NO lleva columna de frente (un camión pudo recoger de dos)',
  !C.columnasResumen({ ...C.OPCIONES_POR_DEFECTO, frente: true }, 'empresa').some((c) => c.key === 'frente'));

// ── 3) EL PAGO (pagoViajesReporte.ts): agrupa y rotula, NO toca un centavo ──
const P = cargar('src/lib/pagoViajesReporte.ts');
const linea = (id, frente, monto, zona = 'oeste') => ({
  viaje: { id, machinery_id: 'm1', machine_code: 'V1', company_id: 'e1', zona_pago: zona, registered_at: '2026-09-26T10:00:00-04:00', frente_nombre: frente },
  jornada: '2026-09-26', zona, tarifa: null, precio: 50, monto, facturable: true, marca: null, motivoSinPago: monto > 0 ? null : 'sin_tarifa',
});
const lineas = [linea('a', 'Frente norte', 50), linea('b', 'Frente norte', 50), linea('c', 'Frente sur', 50), linea('d', null, 50)];

const bloquesF = P.bloquesPago(lineas, 'frente', new Map());
eq('bloques por frente: norte, sur y «Sin frente» al final', bloquesF.map((b) => b.nombre), ['Frente norte', 'Frente sur', 'Sin frente']);
eq('⭐ agrupar por frente no mueve un centavo',
  bloquesF.reduce((a, b) => a + b.total.monto, 0),
  P.bloquesPago(lineas, 'empresa', new Map()).reduce((a, b) => a + b.total.monto, 0));

ok('⭐ la pastilla del frente entra APAGADA en el papel de siempre', P.OPCIONES_PAGO_COMO_ANTES.sinFrente === true);
ok('con la pastilla apagada no hay columna', !P.columnasEquipo(P.OPCIONES_PAGO_COMO_ANTES).includes('frente'));
ok('encendida sí', P.columnasEquipo(P.OPCIONES_PAGO_COMPLETO).includes('frente'));
// ⭐ El frente parte los renglones SOLO con su columna encendida: partirlos con
// la columna oculta serían dos renglones idénticos a la vista, sin explicación.
eq('columna apagada: un solo renglón por camión/tarifa', P.renglonesPorEquipo(lineas, null, null, null, false).length, 1);
const conF = P.renglonesPorEquipo(lineas, null, null, null, true);
eq('columna encendida: un renglón por frente', conF.length, 3);
eq('…sin mover el monto total', conF.reduce((a, r) => a + r.monto, 0), 200);
ok('el alcance dice el eje', P.alcancePagoEnPalabras({ empresas: [], obras: [] }, 'frente', P.OPCIONES_PAGO_COMPLETO, null)[0].includes('frente de trabajo'));
ok('el nombre del archivo también', P.sufijoArchivoPago({ empresas: [], obras: [] }, 'frente', P.OPCIONES_PAGO_COMO_ANTES).includes('por frente'));

// ── 4) LA CAPA DE DATOS (camionViajes.ts) ───────────────────────────────────
const lib = sinComentarios(leer('src/lib/camionViajes.ts'));
ok('la fila lee frente_id y frente_nombre', /COLS_FRENTE = 'frente_id, frente_nombre'/.test(lib));
ok('⭐ el insert lleva el frente en su propio peldaño (escalera de 6)',
  /camposFrente = \{\s*frente_id: params\.frenteId \?\? null,\s*frente_nombre: params\.frenteNombre \?\? null,\s*\}/.test(lib));
ok('editarViaje acepta ponerle o quitarle el frente',
  /if \(cambios\.frente !== undefined\) \{\s*patch\.frente_id = cambios\.frente\.id;\s*patch\.frente_nombre = cambios\.frente\.nombre;/.test(lib));
ok('el catálogo tiene crear y apagar (nunca borrar)',
  /export async function crearFrente/.test(lib) && /export async function setActivoFrente/.test(lib)
  && !/from\('viaje_frentes'\)\s*\.delete/.test(lib));
ok('⭐ la asignación es upsert por jornada+camión (reasignar pisa, no duplica)',
  /\.upsert\(filas, \{ onConflict: 'jornada,machinery_id' \}\)/.test(lib));
ok('las escrituras piden filas de vuelta (un rechazo por permisos no pasa callado)',
  /asignarFrente[\s\S]*?\.select\('id'\)/.test(lib));

// ── 5) LA PANTALLA ──────────────────────────────────────────────────────────
const scr = sinComentarios(leer('src/screens/ViajesCamionesScreen.tsx'));
ok('⭐ el registro del listero CONGELA la asignación de HOY',
  /\.\.\.frenteParaGrabar\(esFuera \? null : selectedTruck\.id\)/.test(scr));
ok('la carga manual lleva su frente (elegido o propuesto por la asignación del día)',
  /frenteId: cargaFrenteId,/.test(scr) && /listAsignacionesFrente\(cargaFecha\)/.test(scr));
ok('⭐ ✏️ Editar pone o corrige el frente con rastro en Auditoría',
  /queCambio\.push\(`frente: \$\{row\.frenteNombre \|\| 'sin frente'\} → /.test(scr));
ok('la fila del viaje enseña su frente', /row\.frenteNombre \? ` · ⛏️ \$\{row\.frenteNombre\}` : ''/.test(scr));
ok('el detallado y el resumido ofrecen «Por frente»',
  (scr.match(/\['frente', '⛏️ Frente'\]/g) || []).length >= 2);
const comp = sinComentarios(leer('src/components/FrentesTrabajo.tsx'));
ok('⭐ la subsección vive en Obras y ubicaciones, con buscador de camiones',
  /extra=\{/.test(scr) && /FrentesTrabajo/.test(scr)
  && /Buscar camión: placa, código, serial, empresa/.test(comp));
// ⚠️ CAMBIÓ EL 29-sep-2026, a pedido: «los frentes asignados para un día deben
//    tomarlo automáticamente los viajes de ese día, estén registrados o no».
//    Antes el aviso decía lo contrario («los viajes ya registrados no cambian»)
//    y era cierto; ahora el que no tiene frente propio lo toma solo, así que el
//    aviso tiene que decir ESO o el usuario no entiende lo que acaba de pasar.
ok('⭐ asignar avisa que los viajes de ese día SIN frente lo toman solos',
  /Los viajes de ese día sin frente lo toman automáticamente/.test(comp));
ok('…y lo que se le puso a mano a un viaje sigue mandando',
  /y ese manda|manda sobre la asignación del día/.test(leer('src/components/FrentesTrabajo.tsx')));


// ── 6) LA CASILLA «NO MOSTRAR LOS VIAJES SIN FRENTE» (28-sep-2026) ──────────
// ⭐ Es un FILTRO (saca viajes y mueve el total), no una opción de columna: por
//    eso vive con los filtros y NO en «Qué sale en el reporte», cuya caja
//    promete que el total no se mueve. Y el papel tiene que DECIR que está
//    filtrado, o se lee como el reporte completo del rango.
ok('⭐ la casilla recorta lo que alimenta chips, lista, resumen y PDF',
  /const dateScopedRows = useMemo\(\s*\(\) => \(soloConFrente \? dateScopedRowsConSinFrente\.filter\(tieneFrente\) : dateScopedRowsConSinFrente\)/.test(scr));
ok('⭐ el nombre congelado vale: un frente borrado no devuelve el viaje a «sin frente»',
  /const tieneFrente = \(r: CamionViajeRow\) => !!r\.frenteId \|\| String\(r\.frenteNombre \?\? ''\)\.trim\(\) !== '';/.test(scr));
ok('⭐ el PDF avisa en su encabezado que está filtrado',
  /soloConFrente \? ' · ⛏️ SOLO viajes con frente' : ''/.test(scr));
ok('dice cuántos dejaría fuera ANTES de marcarla',
  /dejarías fuera \$\{viajesSinFrente\} viaje\(s\) que no tienen frente/.test(scr));
ok('«Limpiar filtros» también la apaga (nada de filtros invisibles)',
  /setHoraDesdeTxt\(''\); setHoraHastaTxt\(''\); setSoloConFrente\(false\);/.test(scr));
ok('si vacía la lista, el mensaje la señala a ella',
  /la casilla «⛏️ No mostrar los viajes SIN frente» dejó fuera todos los del rango/.test(scr));
ok('⭐ y NO se coló en la caja de columnas, que promete que el total no se mueve',
  !/soloConFrente/.test(leer('src/components/CubicajeTab.tsx')));


// ── 7) EL FRENTE DE UN VIAJE SE PEGA A LA JORNADA (29-sep-2026) ─────────────
// Pedido: «las máquinas a las que se les coloca un frente para un viaje
// deberían tomarlo para esa fecha, y en los viajes que vienen deberían
// tomarlo». O sea: corregir UN viaje deja asignado el frente a ese camión ESE
// día, y los viajes que se registren después salen con él sin repetir nada.
ok('⭐ ✏️ Editar deja el frente asignado al camión para la jornada DE ESE VIAJE',
  /if \(cambios\.frente\?\.id && row\.machineryId && !row\.fueraCatalogo\) \{[\s\S]*?const jornadaDelViaje = jornadaDeFecha\(new Date\(cambios\.registeredAtISO \?\? row\.registeredAt\)\);[\s\S]*?asignarFrente\(jornadaDelViaje, \[row\.machineryId\], cambios\.frente\.id/.test(scr));
ok('⭐ SOLO al poner, nunca al quitar (quitarlo de un viaje no deja sin frente a los que vienen)',
  /cambios\.frente\?\.id &&/.test(scr) && !/quitarAsignacionFrente\(.*cambios\.frente/.test(scr));
ok('⭐ un camión FUERA DE CATÁLOGO no se asigna (no tiene ficha que asignar)',
  /row\.machineryId && !row\.fueraCatalogo/.test(scr));
ok('si es la jornada de HOY, el teléfono la recarga (o el próximo viaje usaría la vieja)',
  /if \(jornadaDelViaje === caracasBusinessToday\(\)\) setFrentesRecarga/.test(scr));
ok('y el aviso dice qué quedó asignado y para cuándo',
  /queda asignado a \$\{row\.machineCode\} para el \$\{dmy\(jornadaDelViaje\)\}/.test(scr));
ok('si la asignación falla, se DICE (el viaje ya se corrigió: no se esconde)',
  /no se pudo dejar asignado el frente para el/.test(scr));
ok('⭐ la carga a mano hace lo mismo, y solo si de verdad entró algún viaje',
  /if \(cargaFrenteId && hechos > 0\) \{[\s\S]*?asignarFrente\(cargaFecha, \[cargaTruck\.id\], cargaFrenteId/.test(scr));

console.log('\nFRENTES DE TRABAJO — catálogo, asignación diaria, congelado y reportes\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-viajes-frentes · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
