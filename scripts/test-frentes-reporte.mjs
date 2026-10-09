/*
 * Test del PDF DE FRENTES DEL DÍA (`src/lib/frentesReporte.ts`) — 29-sep-2026.
 *
 * QUÉ PEDIDO CUBRE
 *   «agrégame un reporte para los frentes, un PDF que me dé los frentes
 *   registrados para ese día» + «ese reporte no es necesario que tenga
 *   toneladas, ni nada de eso».
 *
 * LO QUE BLINDA
 *   · ⭐ NI UNA CIFRA DE OPERACIÓN: sin viajes, sin peso, sin m³. Es la hoja de
 *     asignación, y meterle cantidades sería justo lo que el cliente descartó.
 *   · LOS FRENTES VACÍOS SALEN IGUAL: el papel sirve para ver qué quedó SIN
 *     asignar; un frente que desaparece se lee como «no existe».
 *   · EL ESCAPE: nombres de frentes y camiones los escribe el usuario.
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

const srcPath = path.join(ROOT, 'src/lib/frentesReporte.ts');
const out = ts.transpileModule(fs.readFileSync(srcPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const m = new Module(srcPath);
m.filename = srcPath;
m.paths = Module._nodeModulePaths(path.dirname(srcPath));
m._compile(out, m.filename);
const {
  frentesDelDia, totalesFrentes, cuerpoFrentesDelDia, nombreArchivoFrentes,
  frentesParaReporte, historialFrentes,
  FRENTES_POR_DEFECTO, LOGOS_FRENTES_POR_DEFECTO,
} = m.exports;

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    obtenido: ${g}\n    esperado: ${w}`); }
};
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}${extra ? `\n    ${extra}` : ''}`); } };
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const cam = (code, placa, empresa) => ({ code, placa, empresa });
const ASIG = [
  { frenteNombre: 'RES. CORAL', camion: cam('CHUTO CON VOLQUETA', 'A28CI3K', 'GOLDEN TOUCH') },
  { frenteNombre: 'CANTERA DE NAIGUATA', camion: cam('CAMION VOLTEO TORONTO', 'A41AH7D', 'SAVANNA') },
  { frenteNombre: 'RES. CORAL', camion: cam('CAMION VOLTEO TORONTO', 'A25EB0P', 'SAVANNA') },
];

// ── 1) Agrupar ──────────────────────────────────────────────────────────────
const g = frentesDelDia(ASIG);
eq('agrupa por frente, alfabéticamente', g.map((x) => x.nombre), ['CANTERA DE NAIGUATA', 'RES. CORAL']);
eq('y dentro, los camiones por código', g[1].camiones.map((c) => c.code), ['CAMION VOLTEO TORONTO', 'CHUTO CON VOLQUETA']);
eq('los totales cuadran', totalesFrentes(g), { frentes: 2, frentesConCamiones: 2, camiones: 3 });

// ⭐ Un frente ACTIVO sin camiones ese día SALE IGUAL, con su cero.
const conVacio = frentesDelDia(ASIG, ['CANTERA DE NAIGUATA', 'RES. CORAL', 'FRENTE NUEVO']);
eq('⭐ el frente sin asignar también sale', conVacio.map((x) => x.nombre), ['CANTERA DE NAIGUATA', 'FRENTE NUEVO', 'RES. CORAL']);
eq('…con cero camiones', conVacio.find((x) => x.nombre === 'FRENTE NUEVO').camiones.length, 0);
eq('y los totales lo distinguen', totalesFrentes(conVacio), { frentes: 3, frentesConCamiones: 2, camiones: 3 });
eq('sin nada, no inventa grupos', frentesDelDia([], []), []);

// ── 2) El papel ─────────────────────────────────────────────────────────────
const html = cuerpoFrentesDelDia(conVacio);
ok('trae cada frente con su nombre y su conteo',
  html.includes('CANTERA DE NAIGUATA') && html.includes('RES. CORAL') && html.includes('2 camión(es)'));
ok('y los camiones con su placa y empresa',
  html.includes('A28CI3K') && html.includes('GOLDEN TOUCH') && html.includes('CAMION VOLTEO TORONTO'));
ok('el frente vacío lo dice, no se lo salta',
  html.includes('FRENTE NUEVO') && html.includes('Sin camiones asignados este día'));
ok('el encabezado resume cuántos camiones y frentes', html.includes('3 camión(es) asignados') && html.includes('2 de 3 frente(s)'));

// ⭐⭐ NI UNA CIFRA DE OPERACIÓN (el pedido textual del cliente).
ok('⭐ el papel NO habla de toneladas, kilos, m³ ni viajes',
  !/Ton\b|\bKg\b|m³|tonelaje|viaje\(s\) realizados|Peso/i.test(html),
  html.slice(0, 200));
ok('…y su CSS tampoco mete columnas de cifras', !/pesoNeto|m3Texto/.test(leer('src/lib/frentesReporte.ts')));

// Sin nada asignado, el papel lo dice en vez de salir en blanco.
ok('sin nada asignado, lo dice', cuerpoFrentesDelDia([]).includes('ningún camión asignado'));

// ⭐ Escape: los nombres los escribe el usuario.
const raro = cuerpoFrentesDelDia(frentesDelDia([
  { frenteNombre: '<script>alert(1)</script>', camion: cam('<b>x</b>', '<i>p</i>', '&') },
]));
ok('⭐ el texto del usuario va escapado', !raro.includes('<script>') && !raro.includes('<b>x</b>'));

eq('el nombre del archivo lleva la fecha', nombreArchivoFrentes('2026-09-29'), 'Frentes de trabajo 2026-09-29');

// ── 3) La pantalla ──────────────────────────────────────────────────────────
const comp = leer('src/components/FrentesTrabajo.tsx');
ok('el botón «📄 PDF del día» está en la subsección de frentes',
  /📄 PDF del día/.test(comp) && /onPress=\{exportarPdf\}/.test(comp));
// El 2º argumento entró el 06-oct-2026: son las opciones, para que el nombre del
// archivo diga si la hoja salió por unos frentes elegidos. La fecha sigue siendo
// la elegida en pantalla, que es lo que esta guarda vigila.
ok('usa la fecha elegida, no «hoy» a la fuerza', /nombreArchivoFrentes\(fecha(, opPapel)?\)/.test(comp));
ok('⭐ el papel sale sin la marca en texto, como los demás de viajes', /marcaTexto: false/.test(comp));
ok('y ofrece también los frentes activos sin asignación',
  /activos\.map\(\(f\) => f\.nombre\)/.test(comp));

// ── 4) 🖨️ LOS CHECKS Y LOS LOGOS (29-sep-2026) ──────────────────────────────
//
// Pedido: «falta que pueda quitar o colocar información con los checks, además
// de quitar y colocar los logos, quita para el reporte lo del Banco Central de
// Venezuela y SOS La Guaira en el pie de página» + «me deben salir SOLO los
// frentes para ese día asignados».
{
  // ⭐⭐ LA REGLA QUE PIDIÓ: por defecto, SOLO los frentes con camiones.
  const soloAsignados = frentesParaReporte(ASIG, ['CANTERA DE NAIGUATA', 'RES. CORAL', 'FRENTE NUEVO']);
  eq('⭐ por defecto salen SOLO los frentes asignados ese día',
    soloAsignados.map((x) => x.nombre), ['CANTERA DE NAIGUATA', 'RES. CORAL']);
  eq('…y el check los vuelve a traer',
    frentesParaReporte(ASIG, ['CANTERA DE NAIGUATA', 'RES. CORAL', 'FRENTE NUEVO'], { ...FRENTES_POR_DEFECTO, sinCamiones: true })
      .map((x) => x.nombre), ['CANTERA DE NAIGUATA', 'FRENTE NUEVO', 'RES. CORAL']);
  ok('⭐ el interruptor de los frentes vacíos nace APAGADO', FRENTES_POR_DEFECTO.sinCamiones === false);

  // ⭐⭐ EL MEMBRETE NACE SIN BCV NI SOS: «guarda en memoria que ya no va».
  eq('⭐ esta hoja nace SIN ningún logo',
    LOGOS_FRENTES_POR_DEFECTO, { bcv: false, sos: false, golden: false, renace: false, jhenzaen: false });
  ok('⭐ y la pantalla apaga la marca en texto del pie', /marcaTexto: false/.test(leer('src/components/FrentesTrabajo.tsx')));
  ok('⭐ los logos que elija el usuario viajan al membrete', /logos,/.test(leer('src/components/FrentesTrabajo.tsx')));

  // Cada check quita de verdad su columna (y no se lleva las otras).
  const todo = cuerpoFrentesDelDia(soloAsignados, FRENTES_POR_DEFECTO);
  ok('con todo encendido están placa, empresa, Nº y totales',
    todo.includes('Placa / Serial') && todo.includes('Empresa') && todo.includes('>Nº<') && todo.includes('camión(es) asignados'));
  ok('sin placa, se va la columna de placa y nada más',
    !cuerpoFrentesDelDia(soloAsignados, { ...FRENTES_POR_DEFECTO, placa: false }).includes('Placa / Serial')
    && cuerpoFrentesDelDia(soloAsignados, { ...FRENTES_POR_DEFECTO, placa: false }).includes('Empresa'));
  ok('sin empresa, se va la de empresa',
    !cuerpoFrentesDelDia(soloAsignados, { ...FRENTES_POR_DEFECTO, empresa: false }).includes('Empresa'));
  ok('sin numeración, se va la columna Nº',
    !cuerpoFrentesDelDia(soloAsignados, { ...FRENTES_POR_DEFECTO, numeracion: false }).includes('>Nº<'));
  ok('sin totales, se va la línea de arriba',
    !cuerpoFrentesDelDia(soloAsignados, { ...FRENTES_POR_DEFECTO, totales: false }).includes('camión(es) asignados'));
  ok('sin contador, se va el «N camión(es)» del encabezado del frente',
    !cuerpoFrentesDelDia(soloAsignados, { ...FRENTES_POR_DEFECTO, contador: false }).includes('2 camión(es)'));
  // La marca/modelo nace apagada y se puede encender.
  ok('⭐ marca y modelo nace APAGADA', FRENTES_POR_DEFECTO.marcaModelo === false);
  const conMarca = cuerpoFrentesDelDia(
    frentesDelDia([{ frenteNombre: 'RES. CORAL', camion: { code: 'X', placa: 'P', empresa: 'E', marcaModelo: 'VOLVO FM 440' } }]),
    { ...FRENTES_POR_DEFECTO, marcaModelo: true });
  ok('…y encendida sale', conMarca.includes('Marca / Modelo') && conMarca.includes('VOLVO FM 440'));

  // 🏢 UNA SOLA EMPRESA PARA TODOS (03-oct-2026, a pedido: «que todas las
  //    máquinas salgan para Golden Touch (…) o que yo pueda elegir el nombre
  //    de la empresa que va a salir toda la maquinaria»).
  {
    const { EMPRESA_UNICA_SUGERIDA, empresaImpresa } = m.exports;
    ok('⭐ nace APAGADA: por defecto cada equipo sale con su empresa', FRENTES_POR_DEFECTO.empresaUnica === '');
    ok('la sugerencia de entrada es Golden Touch', EMPRESA_UNICA_SUGERIDA === 'Golden Touch');
    const dos = frentesDelDia([
      { frenteNombre: 'RES. CORAL', camion: cam('A', 'P1', 'EMPRESA UNO') },
      { frenteNombre: 'RES. CORAL', camion: cam('B', 'P2', 'EMPRESA DOS') },
      { frenteNombre: 'CANTERA', camion: cam('C', 'P3', null) },
    ]);
    const unica = cuerpoFrentesDelDia(dos, { ...FRENTES_POR_DEFECTO, empresaUnica: 'Golden Touch' });
    ok('⭐ con nombre, TODOS los equipos salen con ese nombre, incluso el que no tiene empresa',
      (unica.match(/<td>Golden Touch<\/td>/g) ?? []).length === 3 && !unica.includes('EMPRESA UNO') && !unica.includes('EMPRESA DOS'));
    const propia = cuerpoFrentesDelDia(dos, { ...FRENTES_POR_DEFECTO, empresaUnica: '   ' });
    ok('en blanco (o solo espacios) cada uno sale con la suya', propia.includes('EMPRESA UNO') && propia.includes('EMPRESA DOS') && !propia.includes('Golden Touch'));
    ok('sin la columna de empresa, el nombre único no se cuela por ningún lado',
      !cuerpoFrentesDelDia(dos, { ...FRENTES_POR_DEFECTO, empresa: false, empresaUnica: 'Golden Touch' }).includes('Golden Touch'));
    eq('empresaImpresa: la única manda, limpia de espacios', empresaImpresa({ empresa: 'X' }, { empresaUnica: '  Golden   Touch ' }), 'Golden Touch');
    eq('empresaImpresa: sin única, la propia; sin ninguna, raya', [empresaImpresa({ empresa: 'X' }, { empresaUnica: '' }), empresaImpresa({ empresa: null }, {})], ['X', '—']);
    const comp = leer('src/components/FrentesTrabajo.tsx');
    ok('⭐ la pantalla la ofrece como interruptor APAGADO y el papel recibe opPapel',
      /useState\(false\);\s*\n\s*const \[empresaUnica, setEmpresaUnica\] = useState\(EMPRESA_UNICA_SUGERIDA\)/.test(comp)
      && /cuerpoFrentesDelDia\(grupos, opPapel, E/.test(comp) && /empresaUnica: empresaUnicaOn \? empresaUnica : ''/.test(comp));
  }

  // ⭐⭐ LO QUE SE APAGA NO DEJA RASTRO EN EL PAPEL (29-sep-2026, corregido a
  //     pedido: «que no salga esa información, y guarda en memoria que si activo
  //     o desactivo un check, no me salga esa información en el PDF»). Es la
  //     regla de la casa desde el 25-sep y el subtítulo la estaba rompiendo:
  //     decía «… · sin placa, empresa, numeración».
  const rep = leer('src/lib/frentesReporte.ts');
  const compS = leer('src/components/FrentesTrabajo.tsx');
  ok('⭐ ya no existe la etiqueta que delataba lo apagado', !/export function etiquetaOpcionesFrentes/.test(rep));
  // 02-oct-2026: el subtítulo depende del tipo (camiones / máquinas), pero ninguno dice qué se ocultó.
  ok('⭐ el subtítulo del PDF NO dice qué se ocultó',
    /subtitle: esMaq \? `Asignación del \$\{dmy\(fecha\)\} · frente de trabajo de cada equipo` : `Asignación del \$\{dmy\(fecha\)\} · de dónde recoge cada camión`/.test(compS));
  // Sin los comentarios: en ellos SÍ se nombra la etiqueta vieja, justamente
  // para explicar por qué no puede volver.
  const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('…y no quedó ningún «sin placa/empresa/numeración» en el papel',
    !/sin \$\{|· sin placa|· sin empresa|\(oculto\)/.test(sinCom(rep) + sinCom(compS)));
  // Y el papel apagado no deja hueco: ni celda vacía ni encabezado suelto.
  const soloCamion = cuerpoFrentesDelDia(soloAsignados,
    { numeracion: false, placa: false, empresa: false, marcaModelo: false, contador: false, totales: false, sinCamiones: false });
  ok('⭐ con todo apagado queda SOLO la columna Camión, sin celdas en blanco',
    (soloCamion.match(/<th>/g) || []).length === 2 && !/<td><\/td>/.test(soloCamion));

  // ⭐ NI CON LOS CHECKS SE CUELA UNA CIFRA DE OPERACIÓN.
  const todos = cuerpoFrentesDelDia(soloAsignados, { numeracion: true, placa: true, empresa: true, marcaModelo: true, contador: true, totales: true, sinCamiones: true });
  ok('⭐ con TODO encendido sigue sin toneladas, kilos, m³ ni peso',
    !/Ton\b|\bKg\b|m³|tonelaje|Peso/i.test(todos));
}

// ── 5) 🕘 EL HISTORIAL (29-sep-2026) ────────────────────────────────────────
// Pedido: «que haya un historial de frentes de trabajo ahí mismo en ese apartado».
{
  const h = historialFrentes([
    { jornada: '2026-09-27', frenteNombre: 'RES. CORAL' },
    { jornada: '2026-09-29', frenteNombre: 'RES. CORAL' },
    { jornada: '2026-09-29', frenteNombre: 'RES. CORAL' },
    { jornada: '2026-09-29', frenteNombre: 'CANTERA DE NAIGUATA' },
    { jornada: '2026-09-28', frenteNombre: '' },
  ]);
  eq('⭐ el historial va del día más reciente al más viejo', h.map((d) => d.jornada), ['2026-09-29', '2026-09-28', '2026-09-27']);
  eq('cuenta los camiones de cada día', h[0].camiones, 3);
  eq('y dentro del día, el frente con más camiones primero',
    h[0].frentes.map((f) => `${f.nombre}:${f.camiones}`), ['RES. CORAL:2', 'CANTERA DE NAIGUATA:1']);
  eq('una asignación sin nombre de frente no se pierde: la rotula', h[1].frentes[0].nombre, 'Sin frente');
  eq('sin nada, historial vacío (no inventa días)', historialFrentes([]), []);
  eq('una jornada con basura se ignora en vez de romper el listado',
    historialFrentes([{ jornada: 'ayer', frenteNombre: 'X' }]), []);
  const comp2 = leer('src/components/FrentesTrabajo.tsx');
  ok('⭐ el historial está en el MISMO apartado de frentes',
    /Historial de frentes de trabajo/.test(comp2) && /historialFrentes\(/.test(comp2));
  ok('y tocar un día lo abre arriba para verlo e imprimirlo', /onPress=\{\(\) => setFecha\(d\.jornada\)\}/.test(comp2));
}

// ── 6) ⛏️ FRENTES DE MAQUINARIA EN REPORTES (02-oct-2026) ────────────────────
// Pedido: «una cosa son las ubicaciones y otra los frentes; un apartado en
// Reportes para frentes, como el de viajes de camiones, que no choque ni rompa
// nada». Es el MISMO componente con `tipo="maquinas"`, acotado a su lista.
{
  const { ETIQUETA_CAMION, ETIQUETA_EQUIPO } = m.exports;
  const g = frentesDelDia([{ frenteNombre: 'CANTERA', camion: cam('RETRO-01', 'S-1', 'ALFA') }]);
  const papelEq = cuerpoFrentesDelDia(g, FRENTES_POR_DEFECTO, ETIQUETA_EQUIPO);
  ok('⭐ con etiqueta de equipo, el papel habla de equipos, no de camiones',
    /<th>Equipo<\/th>/.test(papelEq) && /1 equipo\(s\) asignados/.test(papelEq) && !/camión/i.test(papelEq));
  ok('⭐ sin etiqueta sale como siempre (camión)', /<th>Camión<\/th>/.test(cuerpoFrentesDelDia(g)) && /camión\(es\)/.test(cuerpoFrentesDelDia(g)));
  eq('la etiqueta por defecto es la de camión', ETIQUETA_CAMION.columna, 'Camión');
  ok('sin nada asignado habla del equipo', /ningún equipo asignado/.test(cuerpoFrentesDelDia([], FRENTES_POR_DEFECTO, ETIQUETA_EQUIPO)));

  const compM = leer('src/components/FrentesTrabajo.tsx');
  ok('⭐ el componente tiene `tipo` y arranca como camiones', /tipo\?: 'camiones' \| 'maquinas'/.test(compM) && /tipo = 'camiones'/.test(compM));
  ok('⭐ las asignaciones y el historial se ACOTAN a la lista que recibe (ninguno pisa al otro)',
    /setAsignaciones\(r\.asignaciones\.filter\(\(a\) => idsLista\.has\(a\.machineryId\)\)\)/.test(compM)
    && compM.includes('const mias = r.asignaciones.filter((a) => idsLista.has(a.machineryId))')
    && compM.includes('historialFrentes(mias)') && compM.includes('setAsigRango(mias)'));
  ok('el buscador de viajes sigue diciendo camión', /Buscar camión: placa, código, serial, empresa/.test(compM));
  ok('en máquinas no promete lo de los viajes (que toman el frente solos)', /const auto = esMaq\s*\?\s*''/.test(compM));

  const card = leer('src/components/FrentesReportesCard.tsx');
  ok('⭐ Reportes monta el mismo apartado con TODAS las máquinas, en modo máquinas',
    /tipo="maquinas"/.test(card) && /selectAllRows\('machinery'/.test(card) && /<FrentesTrabajo/.test(card));
  ok('⭐ asigna quien tiene el permiso «Frentes de maquinaria» (Reportes está abierto y no sirve de candado)', /levelMeets\(moduleLevel\('frentes_maquinaria'\), 'escritura'\)/.test(card));
  // ⭐ «SIN VIAJES»: tablas PROPIAS. Ni la lista de frentes ni las asignaciones se comparten.
  ok('⭐ la maquinaria usa SUS tablas (fuente propia), no las de viajes', /fuente=\{FRENTES_MAQUINARIA\}/.test(card) && /listFrentes\(FRENTES_MAQUINARIA\)/.test(card));
  const lib = leer('src/lib/camionViajes.ts');
  ok('⭐ la fuente de maquinaria apunta a maquinaria_frentes / maquinaria_frente_asignaciones',
    /FRENTES_MAQUINARIA: FuenteFrentes = \{ frentes: 'maquinaria_frentes', asignaciones: 'maquinaria_frente_asignaciones' \}/.test(lib));
  ok('⭐ y la de viajes sigue en sus tablas de siempre', /FRENTES_VIAJES: FuenteFrentes = \{ frentes: 'viaje_frentes', asignaciones: 'viaje_frente_asignaciones' \}/.test(lib));
  ok('⭐ cada función de frentes recibe la fuente, con viajes por defecto', (lib.match(/fuente: FuenteFrentes = FRENTES_VIAJES/g) || []).length >= 10);
  ok('⭐ el componente pasa la fuente a TODAS sus llamadas', (compM.match(/, fuente\)/g) || []).length >= 9 && /fuente = FRENTES_VIAJES, datosDelDia \}: Props/.test(compM));
  ok('⭐ el auto-frente de los viajes sigue leyendo las asignaciones de VIAJES', /listAsignacionesFrenteRango\(rango\.desde, rango\.hasta\)/.test(lib.replace(/\/\/.*$/gm, '')));
  ok('y deja claro que NO es la ubicación', /No es la ubicación/.test(card));

  const rep = leer('src/screens/ReportsScreen.tsx');
  ok('⭐ Reportes tiene la pestaña ⛏️ Frentes', /\{ v: 'frentes', label: '⛏️ Frentes' \}/.test(rep) && /mode === 'frentes' \? \(\s*<FrentesReportesCard \/>/.test(rep));
  // 09-oct-2026: la pestaña «Personalizado» también esconde el botón genérico.
  ok('⭐ el botón «Generar» genérico no sale en esa pestaña', /\{mode !== 'frentes' && mode !== 'personalizado' \? \(/.test(rep));
  const viajes = leer('src/screens/ViajesCamionesScreen.tsx');
  ok('⭐ viajes sigue montando el apartado SIN tipo (camiones, como siempre)', /<FrentesTrabajo\s*\n\s*frentes=\{frentes\}/.test(viajes) && !/tipo="maquinas"/.test(viajes));
}

// ── LAS OPCIONES DE LA LISTA COMPLETA, EN ESTA HOJA (03-oct-2026, a pedido:
//    «para el reporte frentes de trabajo faltan las opciones: marca y modelo,
//    alto/largo/ancho, clasificación por capacidad, empresa, obra/ubicación,
//    frente de trabajo, placa/serial, chofer, turno, estado de la máquina,
//    resumen ejecutivo (…) completo de las máquinas o viajes, un dashboard») ──
{
  const { resumenFrentes, necesitaDatosDelDia, ETIQUETA_EQUIPO } = m.exports;
  const NUEVAS = ['medidas', 'clasificacion', 'obra', 'frente', 'chofer', 'turno', 'estado', 'resumen'];
  ok('⭐ lo nuevo entra APAGADO: las 8 opciones nacen en false', NUEVAS.every((k) => FRENTES_POR_DEFECTO[k] === false));
  const eq1 = { id: 'a', code: 'VOLTEO', placa: 'P1', empresa: 'EMP UNO', medidas: '2,40 × 6,00 × 2,50 m', clasificacion: 'Media capacidad', obra: 'CDT A', chofer: 'CHOFER UNO', turno: 'Día', estado: 'Operativa', viajes: 4 };
  const eq2 = { id: 'b', code: 'CHUTO', placa: 'P2', empresa: 'EMP DOS', medidas: null, clasificacion: null, obra: null, chofer: null, turno: 'Noche', estado: 'En espera', viajes: 0 };
  const g = frentesDelDia([
    { frenteNombre: 'CANTERA', camion: eq1 }, { frenteNombre: 'CANTERA', camion: eq2 }, { frenteNombre: 'RES. CORAL', camion: eq1 },
  ]);
  const base = cuerpoFrentesDelDia(g, FRENTES_POR_DEFECTO);
  ok('⭐ con todo apagado la hoja sale IGUAL que antes: ni columnas nuevas ni tablero', [
    'Alto × largo × ancho', 'Clasificación', 'Obra / ubicación', '<th>Frente</th>', 'Chofer', 'Turno', '<th>Estado</th>', 'fr-tj', 'CHOFER UNO', 'CDT A', 'Operativa',
  ].every((s) => !base.includes(s)));
  const col = (k) => cuerpoFrentesDelDia(g, { ...FRENTES_POR_DEFECTO, [k]: true });
  ok('medidas: su columna y su dato; el que no tiene sale con raya', col('medidas').includes('Alto × largo × ancho') && col('medidas').includes('2,40 × 6,00 × 2,50 m'));
  ok('clasificación', col('clasificacion').includes('<th>Clasificación</th>') && col('clasificacion').includes('Media capacidad'));
  ok('obra / ubicación', col('obra').includes('<th>Obra / ubicación</th>') && col('obra').includes('CDT A'));
  ok('frente en cada fila', col('frente').includes('<th>Frente</th>') && (col('frente').match(/<td>CANTERA<\/td>/g) ?? []).length === 2);
  ok('chofer', col('chofer').includes('<th>Chofer</th>') && col('chofer').includes('CHOFER UNO'));
  ok('⭐ en la hoja de maquinaria se llama Operador', cuerpoFrentesDelDia(g, { ...FRENTES_POR_DEFECTO, chofer: true }, ETIQUETA_EQUIPO).includes('<th>Operador</th>'));
  ok('turno', col('turno').includes('<th>Turno</th>') && col('turno').includes('Noche'));
  ok('estado', col('estado').includes('<th>Estado</th>') && col('estado').includes('En espera'));
  ok('⭐ cada check enciende SOLO lo suyo', !col('chofer').includes('Turno') && !col('turno').includes('Chofer') && !col('estado').includes('fr-tj'));

  // El tablero.
  const r = resumenFrentes(g, { ...FRENTES_POR_DEFECTO, estado: true, turno: true, clasificacion: true, obra: true });
  eq('⭐ cuenta EQUIPOS, no filas: uno en dos frentes es un equipo', r.tarjetas[0], { k: 'equipos', titulo: 'Camiones asignados', valor: '2', nota: '3 asignaciones (hay camiones en más de un frente)' });
  eq('⭐ cada tarjeta y cuadro lleva su clave estable, para poder editarlos',
    [r.tarjetas.map((x) => x.k), r.cuadros.map((q) => q.k)],
    [['equipos', 'frentes', 'promedio', 'mayor', 'empresas', 'viajes'], ['porFrente', 'porTipo', 'porEmpresa', 'porEstado', 'porClasificacion', 'porTurno', 'porObra']]);
  eq('frentes en uso, promedio y el de más carga', r.tarjetas.slice(1, 4).map((x) => [x.titulo, x.valor]), [['Frentes en uso', '2'], ['Promedio por frente', '1,5'], ['Frente con más carga', 'CANTERA']]);
  eq('empresas y viajes del día', r.tarjetas.slice(4).map((x) => [x.titulo, x.valor, x.nota]), [['Empresas', '2', undefined], ['Viajes del día', '4', '1 de 2 camiones con viajes']]);
  eq('cuadros: por frente, tipo, empresa y los encendidos', r.cuadros.map((q) => q.titulo), ['Camión(es) por frente', 'Por tipo de equipo', 'Por empresa', 'Por estado', 'Por clasificación', 'Por turno', 'Por obra / ubicación']);
  eq('por estado', r.cuadros.find((q) => q.titulo === 'Por estado').filas, [{ clave: 'En espera', n: 1 }, { clave: 'Operativa', n: 1 }]);
  const soloBase = resumenFrentes(g, FRENTES_POR_DEFECTO);
  eq('⭐ los cuadros siguen a su interruptor: apagado, su cuadro no sale', soloBase.cuadros.map((q) => q.titulo), ['Camión(es) por frente', 'Por tipo de equipo', 'Por empresa']);
  ok('sin la columna empresa: ni tarjeta ni cuadro de empresas', (() => { const x = resumenFrentes(g, { ...FRENTES_POR_DEFECTO, empresa: false }); return !x.tarjetas.some((y) => y.titulo === 'Empresas') && !x.cuadros.some((q) => q.titulo === 'Por empresa'); })());
  eq('⭐ con empresa única, el tablero cuenta UNA empresa', resumenFrentes(g, { ...FRENTES_POR_DEFECTO, empresaUnica: 'Golden Touch' }).cuadros.find((q) => q.titulo === 'Por empresa').filas, [{ clave: 'Golden Touch', n: 2 }]);
  ok('la maquinaria no tiene tarjeta de viajes', !resumenFrentes(frentesDelDia([{ frenteNombre: 'F', camion: { id: 'x', code: 'JUMBO', viajes: null } }]), FRENTES_POR_DEFECTO, ETIQUETA_EQUIPO).tarjetas.some((x) => /Viajes/.test(x.titulo)));
  const conTablero = cuerpoFrentesDelDia(g, { ...FRENTES_POR_DEFECTO, resumen: true });
  ok('⭐ el tablero sale ARRIBA del listado', conTablero.includes('fr-tj') && conTablero.indexOf('fr-tj') < conTablero.indexOf('fr-g'));
  eq('necesitaDatosDelDia: solo con obra, chofer, turno, estado o resumen', [
    necesitaDatosDelDia(FRENTES_POR_DEFECTO), necesitaDatosDelDia({ ...FRENTES_POR_DEFECTO, medidas: true, clasificacion: true, frente: true }),
    ...['obra', 'chofer', 'turno', 'estado', 'resumen'].map((k) => necesitaDatosDelDia({ ...FRENTES_POR_DEFECTO, [k]: true })),
  ], [false, false, true, true, true, true, true]);

  // Candados de las pantallas.
  const comp = leer('src/components/FrentesTrabajo.tsx');
  ok('⭐ lo del día se lee SOLO si alguna opción lo pide', /datosDelDia && necesitaDatosDelDia\(opPapel\) \? await datosDelDia\(fecha\)/.test(comp));
  ok('⭐ el operador escrito a mano MANDA sobre el automático', /operadores\[claveOperador\(a\.machineryId\)\][^\n]*\|\| d\?\.chofer \|\| null/.test(comp) && /placeholder="automático"/.test(comp));
  ok('los 8 checks nuevos están en la pantalla', NUEVAS.every((k) => new RegExp("\\{ k: '" + k + "'").test(comp)));
  const card = leer('src/components/FrentesReportesCard.tsx');
  ok('⭐ la maquinaria sigue SIN viajes: su operador y turno salen de la jornada', /machine_rounds/.test(card) && !/camion_viajes|listTodosLosViajes/.test(card) && /datosDelDia=\{datosDelDiaMaquinas\}/.test(card));
  ok('…y solo LEE la jornada', !/\.(insert|update|delete|upsert)\(/.test(card));
  const pant = leer('src/screens/ViajesCamionesScreen.tsx');
  ok('⭐ viajes le pasa medidas/capacidad de Cubicaje y lo del día desde sus viajes', /camiones=\{camionesFrentes\}/.test(pant) && /datosDelDia=\{datosDelDiaFrentes\}/.test(pant) && /listTodosLosViajes\(jornadaWindowISO\(jornadaISO\)\)/.test(pant));
}

// ── ✏️ EL TABLERO ES EDITABLE (03-oct-2026, a pedido: «que el resumen ejecutivo
//    de ese reporte sea editable») ──────────────────────────────────────────────
{
  const { aplicarEdicionResumen, resumenFrentes, resumenEditado, cuentaEdicionResumen, EDICION_RESUMEN_VACIA } = m.exports;
  const ETIQUETA_CAMION_T = m.exports.ETIQUETA_CAMION;
  const g2 = frentesDelDia([
    { frenteNombre: 'CANTERA', camion: { id: 'a', code: 'VOLTEO', placa: 'P1', empresa: 'EMP UNO', viajes: 3 } },
    { frenteNombre: 'RES. CORAL', camion: { id: 'b', code: 'CHUTO', placa: 'P2', empresa: 'EMP DOS', viajes: 1 } },
  ]);
  const base = resumenFrentes(g2, FRENTES_POR_DEFECTO);

  eq('sin edición, el tablero sale tal cual', aplicarEdicionResumen(base, EDICION_RESUMEN_VACIA), base);
  eq('sin edición ninguna (null/undefined) tampoco revienta', [aplicarEdicionResumen(base, null).tarjetas.length, aplicarEdicionResumen(base, undefined).cuadros.length], [base.tarjetas.length, base.cuadros.length]);

  // Ocultar.
  const sinDos = aplicarEdicionResumen(base, { ocultos: ['promedio', 'porTipo'] });
  ok('⭐ ocultar quita esa tarjeta y ese cuadro, y nada más',
    !sinDos.tarjetas.some((x) => x.k === 'promedio') && !sinDos.cuadros.some((q) => q.k === 'porTipo')
    && sinDos.tarjetas.length === base.tarjetas.length - 1 && sinDos.cuadros.length === base.cuadros.length - 1);
  ok('una clave que no existe no hace nada', aplicarEdicionResumen(base, { ocultos: ['inventada'] }).tarjetas.length === base.tarjetas.length);

  // Cambiar el texto.
  const cambiado = aplicarEdicionResumen(base, {
    titulos: { equipos: '  Unidades   en  obra ', frentes: '' },
    valores: { equipos: '99', promedio: '   ' },
    notas: { frentes: 'contadas a mano' },
  });
  const tj = (k) => cambiado.tarjetas.find((x) => x.k === k);
  eq('⭐ el título y el valor escritos MANDAN, limpios de espacios', [tj('equipos').titulo, tj('equipos').valor], ['Unidades en obra', '99']);
  eq('⭐ lo que se deja EN BLANCO vuelve al automático (una casilla vacía no borra nada)',
    [tj('frentes').titulo, tj('promedio').valor], [base.tarjetas.find((x) => x.k === 'frentes').titulo, base.tarjetas.find((x) => x.k === 'promedio').valor]);
  eq('la nota escrita manda; y la automática se queda si no se escribe', [tj('frentes').nota, tj('equipos').nota], ['contadas a mano', base.tarjetas.find((x) => x.k === 'equipos').nota]);
  ok('⭐ editar NO recalcula: el valor es TEXTO, no una cuenta', tj('equipos').valor === '99' && base.tarjetas.find((x) => x.k === 'equipos').valor === '2');
  eq('el título de un cuadro también se cambia', aplicarEdicionResumen(base, { titulos: { porFrente: 'Reparto del día' } }).cuadros[0].titulo, 'Reparto del día');
  ok('cambiar un cuadro no le inventa valor ni nota', (() => { const q = aplicarEdicionResumen(base, { titulos: { porFrente: 'X' }, valores: { porFrente: '7' } }).cuadros[0]; return q.valor === undefined && q.nota === undefined; })());

  // Tarjetas propias.
  const propias = aplicarEdicionResumen(base, { propias: [{ titulo: 'Gandolas prestadas', valor: '3', nota: 'de la contrata' }, { titulo: '', valor: '' }, { titulo: 'Sin valor', valor: '' }, { titulo: '', valor: '5' }] });
  eq('⭐ las propias van AL FINAL y en su orden; las vacías no entran',
    propias.tarjetas.slice(base.tarjetas.length).map((x) => [x.k, x.titulo, x.valor, x.nota]),
    [['propia1', 'Gandolas prestadas', '3', 'de la contrata'], ['propia3', 'Sin valor', '—', null], ['propia4', 'Dato', '5', null]]);
  ok('una propia no pisa las de casa', propias.tarjetas.filter((x) => x.k === 'equipos').length === 1);

  // Avisos de la pantalla.
  eq('resumenEditado: solo cuando de verdad hay algo', [
    resumenEditado(null), resumenEditado(EDICION_RESUMEN_VACIA), resumenEditado({ titulos: { equipos: '   ' } }), resumenEditado({ propias: [{ titulo: '', valor: '' }] }),
    resumenEditado({ ocultos: ['equipos'] }), resumenEditado({ valores: { equipos: '1' } }), resumenEditado({ propias: [{ titulo: 'X', valor: '' }] }),
  ], [false, false, false, false, true, true, true]);
  eq('cuentaEdicionResumen cuenta claves tocadas, no casillas',
    cuentaEdicionResumen({ ocultos: ['promedio'], titulos: { equipos: 'A', frentes: '  ' }, valores: { equipos: '9' }, propias: [{ titulo: 'X', valor: '1' }, { titulo: '', valor: '' }] }),
    { ocultos: 1, cambiados: 1, propias: 1 });

  // En el papel.
  const html = (ed) => cuerpoFrentesDelDia(g2, { ...FRENTES_POR_DEFECTO, resumen: true }, ETIQUETA_CAMION_T, ed);
  ok('⭐ el papel sale con lo editado y SIN lo original', html({ titulos: { equipos: 'Unidades en obra' }, valores: { equipos: '99' } }).includes('Unidades en obra'));
  ok('⭐ lo oculto NO deja rastro en el papel (ni el título, ni «oculto»)', (() => {
    const h = html({ ocultos: ['porFrente', 'equipos'] });
    return !h.includes('Camión(es) por frente') && !h.includes('Camiones asignados') && !h.includes('oculto') && !h.includes('No sale');
  })());
  ok('⭐ ocultar TODO no deja un hueco vacío en el papel', (() => {
    const todas = [...base.tarjetas.map((x) => x.k), ...base.cuadros.map((q) => q.k)];
    const h = html({ ocultos: todas });
    return !h.includes('fr-tj') && !h.includes('fr-cq') && h.includes('fr-g');
  })());
  ok('una propia sale en el papel, escapada', html({ propias: [{ titulo: '<b>X</b>', valor: '1' }] }).includes('&lt;b&gt;X&lt;/b&gt;'));
  ok('con el resumen APAGADO, lo editado no se cuela', !cuerpoFrentesDelDia(g2, FRENTES_POR_DEFECTO, ETIQUETA_CAMION_T, { propias: [{ titulo: 'ZZZ', valor: '1' }] }).includes('ZZZ'));

  // La pantalla.
  const comp = leer('src/components/FrentesTrabajo.tsx');
  ok('⭐ la pantalla le pasa la edición al papel', /cuerpoFrentesDelDia\(grupos, opPapel, E, edicionResumen\)/.test(comp));
  ok('⭐ se puede dejar como estaba', /EDICION_RESUMEN_VACIA/.test(comp));
  ok('⭐ editar es del PAPEL: no se guarda en la base', !/guardarEdicionResumen|edicion_resumen/.test(comp));
  ok('la sección de edición sale SOLO con el resumen encendido', /\{op\.resumen \? \(/.test(comp) && /Ajustar el resumen ejecutivo/.test(comp));
  ok('cada tarjeta se esconde, se renombra, se le cambia el valor y la nota',
    ['titulos', 'valores', 'notas'].every((k) => new RegExp("edicionResumen\\." + k + "\\?\\.\\[").test(comp.replace(/\?\.\[/g, '?.[')))
    && /alternarOcultoResumen/.test(comp) && /escribirResumen/.test(comp));
  ok('se agregan tarjetas propias con tope y se pueden quitar',
    /MAX_TARJETAS_PROPIAS = 6/.test(comp) && /agregarTarjetaPropia/.test(comp) && /quitarTarjetaPropia/.test(comp)
    && /disabled=\{propias\.length >= MAX_TARJETAS_PROPIAS\}/.test(comp));
  ok('⭐ las casillas muestran en gris lo automático (placeholder), no el dato ya escrito',
    /placeholder=\{x\.titulo\}/.test(comp) && /placeholder=\{x\.valor\}/.test(comp));

  // ⚠️ LAS CIFRAS A MANO NO CRUZAN DE DÍA (03-oct-2026).
  const { edicionAlCambiarDeDia } = m.exports;
  const llena = { ocultos: ['promedio'], titulos: { equipos: 'Unidades' }, notas: { equipos: 'a mano' }, valores: { equipos: '99' }, propias: [{ titulo: 'X', valor: '3' }] };
  eq('⭐ al cambiar de día se van las CIFRAS y se queda la FORMA',
    edicionAlCambiarDeDia(llena), { ocultos: ['promedio'], titulos: { equipos: 'Unidades' }, notas: { equipos: 'a mano' } });
  eq('…y no revienta sin nada', edicionAlCambiarDeDia(null), { ocultos: [], titulos: {}, notas: {} });
  ok('⭐ el valor de ayer no puede salir en el papel de hoy', !resumenEditado({ valores: {}, propias: [] }) && aplicarEdicionResumen(base, edicionAlCambiarDeDia(llena)).tarjetas.every((x) => x.valor !== '99'));
  ok('⭐ la pantalla lo aplica cuando cambia la fecha', /diaEditado\.current = fecha;\s*\n\s*setEdicionResumen\(\(p\) => edicionAlCambiarDeDia\(p\)\)/.test(comp));

  // 🔢 ORDENAR «… POR FRENTE» POR NÚMERO (05-oct-2026, a pedido: «que se
  //    organicen en vez de por cantidad, por el número de la ubicación»).
  const { numeroDeFrente } = m.exports;
  eq('numeroDeFrente lee el número del nombre, aunque lleve espacios o ceros',
    ['3) RESIDENCIAS BAHIA', '08) COSTA BRAVA', '1 ) RESIDENCIAS CORAL', 'CANTERA SIN NUMERO'].map(numeroDeFrente),
    [3, 8, 1, null]); // Infinity → JSON.stringify lo vuelve null
  const gNum = frentesDelDia([
    { frenteNombre: '9) BREOGAN', camion: { id: 'a', code: 'JUMBO' } },
    { frenteNombre: '9) BREOGAN', camion: { id: 'b', code: 'JUMBO' } },
    { frenteNombre: '9) BREOGAN', camion: { id: 'c', code: 'JUMBO' } },
    { frenteNombre: '1) CORAL', camion: { id: 'd', code: 'JUMBO' } },
    { frenteNombre: '08) COSTA BRAVA', camion: { id: 'e', code: 'JUMBO' } },
    { frenteNombre: '08) COSTA BRAVA', camion: { id: 'f', code: 'JUMBO' } },
  ]);
  const porFrente = (orden) => resumenFrentes(gNum, FRENTES_POR_DEFECTO, ETIQUETA_CAMION_T, orden).cuadros.find((q) => q.k === 'porFrente').filas.map((f) => f.clave);
  eq('⭐ por CANTIDAD (de siempre): el que más equipos tiene, primero', porFrente('cantidad'), ['9) BREOGAN', '08) COSTA BRAVA', '1) CORAL']);
  eq('⭐ por NÚMERO: 1, luego 8, luego 9 — sin importar la cantidad', porFrente('numero'), ['1) CORAL', '08) COSTA BRAVA', '9) BREOGAN']);
  eq('sin decir el orden, sigue siendo por cantidad', resumenFrentes(gNum, FRENTES_POR_DEFECTO, ETIQUETA_CAMION_T).cuadros.find((q) => q.k === 'porFrente').filas.map((f) => f.clave), ['9) BREOGAN', '08) COSTA BRAVA', '1) CORAL']);
  eq('⭐ el orden solo toca «por frente», no «por tipo»',
    resumenFrentes(gNum, FRENTES_POR_DEFECTO, ETIQUETA_CAMION_T, 'numero').cuadros.find((q) => q.k === 'porTipo').filas.map((f) => f.clave), ['JUMBO']);
  const frenteSinNum = frentesDelDia([{ frenteNombre: 'CANTERA', camion: { id: 'a', code: 'X' } }, { frenteNombre: '2) CORAL', camion: { id: 'b', code: 'X' } }]);
  eq('un frente sin número va AL FINAL al ordenar por número (no se pierde)',
    resumenFrentes(frenteSinNum, FRENTES_POR_DEFECTO, ETIQUETA_CAMION_T, 'numero').cuadros.find((q) => q.k === 'porFrente').filas.map((f) => f.clave), ['2) CORAL', 'CANTERA']);
  // El orden se guarda en la edición y VIAJA al papel; es forma, se queda al cambiar de día.
  eq('⭐ el orden es FORMA: se queda al cambiar de día', edicionAlCambiarDeDia({ ordenFrentes: 'numero' }).ordenFrentes, 'numero');
  ok('⭐ el papel sale con el orden elegido', (() => {
    const htmlNum = cuerpoFrentesDelDia(gNum, { ...FRENTES_POR_DEFECTO, resumen: true }, ETIQUETA_CAMION_T, { ordenFrentes: 'numero' });
    // Dentro del CUADRO «… por frente» (no en la tarjeta «más carga»): 1 antes que 9.
    const caja = htmlNum.slice(htmlNum.indexOf('por frente</div>'));
    return caja.indexOf('1) CORAL') < caja.indexOf('9) BREOGAN') && caja.indexOf('1) CORAL') >= 0;
  })());
  ok('⭐ la pantalla ofrece ordenar por cantidad o por número', /ordenFrentes: k/.test(comp) && /🔢 Número del frente/.test(comp) && /resumenFrentes\(grupos, opPapel, E, edicionResumen\.ordenFrentes/.test(comp));

}

// ── 📋 REPETIR LOS FRENTES DE OTRO DÍA (03-oct-2026, a pedido: «dame la opción
//    de repetir los frentes de días anteriores, por si quiero repetir los
//    frentes para otro día») ───────────────────────────────────────────────────
{
  const { planRepetirFrentes, textoPlanRepetir } = m.exports;
  const par = (machineryId, frenteId, frenteNombre) => ({ machineryId, frenteId, frenteNombre });
  const EQUIPOS = ['m1', 'm2', 'm3'];
  const FRENTES = ['f1', 'f2'];
  const plan = (origen, destino = [], equipos = EQUIPOS, frentes = FRENTES) =>
    planRepetirFrentes({ origen, destino, equipos, frentes });

  // Lo normal: el día viejo se copia tal cual.
  const p1 = plan([par('m1', 'f1'), par('m2', 'f1'), par('m3', 'f2')]);
  eq('⭐ copia todo el día, agrupado por frente', p1.porFrente, [{ frenteId: 'f1', machineryIds: ['m1', 'm2'] }, { frenteId: 'f2', machineryIds: ['m3'] }]);
  eq('…y dice cuántas asignaciones son', [p1.copiar, p1.yaEstaban, p1.equiposFuera, p1.frentesFuera], [3, 0, [], []]);

  // ⭐ COPIAR SUMA, NO PISA.
  const p2 = plan([par('m1', 'f1'), par('m2', 'f1')], [par('m1', 'f1'), par('m3', 'f2')]);
  eq('⭐ lo que el destino YA tenía igual no se duplica, y lo demás se suma', [p2.copiar, p2.yaEstaban, p2.porFrente], [1, 1, [{ frenteId: 'f1', machineryIds: ['m2'] }]]);
  ok('⭐ lo que el destino tiene y el origen no, NO se toca (esto solo agrega)', !JSON.stringify(p2.porFrente).includes('m3'));

  // El mismo par repetido en el origen (dos filas iguales) es uno.
  eq('un par repetido en el día viejo cuenta una vez', plan([par('m1', 'f1'), par('m1', 'f1')]).copiar, 1);

  // ⭐ NO SE INVENTA NADA: lo que ya no existe se dice y no se copia.
  const p3 = plan([par('m1', 'f1'), par('zz', 'f1'), par('m2', 'fBorrado', 'CANTERA VIEJA')]);
  eq('⭐ un equipo que ya no está en la lista no se copia y se dice', [p3.equiposFuera, p3.copiar], [['zz'], 1]);
  eq('⭐ un frente que ya no se puede usar no se copia y se dice POR SU NOMBRE', p3.frentesFuera, ['CANTERA VIEJA']);
  eq('sin nombre, el frente se dice por su id (mejor eso que nada)', plan([par('m1', 'fX')]).frentesFuera, ['fX']);
  eq('un par con el equipo Y el frente fuera cuenta en los dos motivos',
    (() => { const x = plan([par('zz', 'fX', 'VIEJO')]); return [x.equiposFuera, x.frentesFuera, x.copiar]; })(), [['zz'], ['VIEJO'], 0]);
  eq('filas basura (sin equipo o sin frente) se ignoran', plan([{ machineryId: '', frenteId: 'f1' }, { machineryId: 'm1', frenteId: '' }]).copiar, 0);
  eq('nada no revienta', [plan(null).copiar, planRepetirFrentes({ origen: null, destino: null, equipos: [], frentes: [] }).copiar], [0, 0]);

  // El aviso de los varios frentes (desde el 30-sep un camión puede tener más de uno).
  eq('⭐ avisa quién queda con VARIOS frentes ese día (sus viajes ya no lo toman solos)',
    plan([par('m1', 'f2')], [par('m1', 'f1')]).conVariosFrentes, ['m1']);
  eq('…también si los dos frentes vienen del día copiado', plan([par('m1', 'f1'), par('m1', 'f2')]).conVariosFrentes, ['m1']);
  eq('con un solo frente no avisa nada', plan([par('m1', 'f1')]).conVariosFrentes, []);

  // La frase de la confirmación.
  ok('la frase dice cuántas y en cuántos frentes', /3 asignación\(es\) en 2 frente\(s\)/.test(textoPlanRepetir(p1, 'camión(es)')));
  ok('…y lo que no se copia', /1 ya estaban/.test(textoPlanRepetir(p2, 'camión(es)')));
  ok('…y los equipos y frentes que quedaron fuera', (() => { const s = textoPlanRepetir(p3, 'camión(es)'); return /1 camión\(es\) de ese día ya no están/.test(s) && /CANTERA VIEJA/.test(s); })());
  eq('si ya está todo puesto, lo dice en vez de ofrecer copiar nada',
    textoPlanRepetir(plan([par('m1', 'f1')], [par('m1', 'f1')]), 'camión(es)'), 'Ese día no agrega nada: las 1 asignación(es) ya están puestas.');
  eq('un día sin nada que repetir también lo dice', textoPlanRepetir(plan([]), 'equipo(s)'), 'Ese día no tiene nada que se pueda repetir.');

  // La pantalla.
  const comp = leer('src/components/FrentesTrabajo.tsx');
  ok('⭐ la pantalla ofrece repetir un día del historial en el día elegido', /planRepetirFrentes\(\{/.test(comp) && /Repetir/.test(comp));
  ok('⭐ guarda las asignaciones del rango para armar el plan sin otra consulta', /setAsigRango/.test(comp));
  ok('⭐ el plan se calcula contra el día DESTINO y la lista de hoy',
    /destino: asignaciones/.test(comp) && /equipos: idsLista/.test(comp) && /frentes: activos\.map/.test(comp));
  ok('⭐ pide confirmación ANTES de escribir (y en línea, no con confirm())',
    /setRepetir\(\{ origen:/.test(comp) && /repetirDia/.test(comp) && !/window\.confirm/.test(comp));
  ok('⭐ reusa asignarFrente (que ya suma sin pisar y revisa permisos), no un insert propio',
    /asignarFrente\(fecha, x\.machineryIds, x\.frenteId/.test(comp));
  ok('⭐ solo con permiso completo', /canFull/.test(comp));
}

console.log('\nPDF DE FRENTES DEL DÍA — la hoja de asignación, sin cifras\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-frentes-reporte · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
