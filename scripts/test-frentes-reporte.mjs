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
ok('usa la fecha elegida, no «hoy» a la fuerza', /nombreArchivoFrentes\(fecha\)/.test(comp));
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
    && /historialFrentes\(r\.asignaciones\.filter\(\(a\) => idsLista\.has\(a\.machineryId\)\)\)/.test(compM));
  ok('el buscador de viajes sigue diciendo camión', /Buscar camión: placa, código, serial, empresa/.test(compM));
  ok('en máquinas no promete lo de los viajes (que toman el frente solos)', /const auto = esMaq\s*\?\s*''/.test(compM));

  const card = leer('src/components/FrentesReportesCard.tsx');
  ok('⭐ Reportes monta el mismo apartado con TODAS las máquinas, en modo máquinas',
    /tipo="maquinas"/.test(card) && /selectAllRows\('machinery'/.test(card) && /<FrentesTrabajo/.test(card));
  ok('⭐ asigna quien tiene Reportes completo o Viajes completo', /levelMeets\(moduleLevel\('reportes'\), 'full'\) \|\| levelMeets\(moduleLevel\('viajes_camiones'\), 'full'\)/.test(card));
  ok('y deja claro que NO es la ubicación', /No es la ubicación/.test(card));

  const rep = leer('src/screens/ReportsScreen.tsx');
  ok('⭐ Reportes tiene la pestaña ⛏️ Frentes', /\{ v: 'frentes', label: '⛏️ Frentes' \}/.test(rep) && /mode === 'frentes' \? \(\s*<FrentesReportesCard \/>/.test(rep));
  ok('⭐ el botón «Generar» genérico no sale en esa pestaña', /\{mode !== 'frentes' \? \(/.test(rep));
  const viajes = leer('src/screens/ViajesCamionesScreen.tsx');
  ok('⭐ viajes sigue montando el apartado SIN tipo (camiones, como siempre)', /<FrentesTrabajo\s*\n\s*frentes=\{frentes\}/.test(viajes) && !/tipo="maquinas"/.test(viajes));
}

console.log('\nPDF DE FRENTES DEL DÍA — la hoja de asignación, sin cifras\n');
if (failures.length) console.log(failures.join('\n'));
console.log(`\n${failures.length ? '❌' : '✅'} test-frentes-reporte · ${pass} ok · ${fail} fallando\n`);
if (fail) process.exit(1);
