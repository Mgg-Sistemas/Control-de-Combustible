// 🏭 CENTRO DE OPERACIONES — LEER EL «REPORTE GENERAL» PEGADO DE WHATSAPP (24-oct-2026).
//
// Todos los días llega por WhatsApp un texto con los viajes y el tonelaje del
// CDT: título, fecha de corte, totales y dos secciones («Por Empresa» y «Por
// Frente»). La encargada lo pega en el sistema y la librería lo reconoce, en vez
// de teclear renglón por renglón. Estas pruebas vigilan que lo lea bien con todo
// lo que hacen WhatsApp y la gente: negritas, emojis, viñetas, CRLF, «4.321,09»,
// «1 viaje», totales que faltan, nombres repetidos, cortes de madrugada…
//
// ⚠️ Repositorio PÚBLICO: aquí solo hay nombres y cifras INVENTADOS. Nunca se
//    pega un reporte real en este archivo.
//
//   node scripts/test-centro-operaciones-reporte-general.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');

// El mismo cargador de scripts/test-reporte-personalizado.mjs: transpila el .ts
// a CommonJS y resuelve los imports relativos a otros .ts.
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

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond, detalle = '') => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}${detalle ? `\n    ${detalle}` : ''}`); }
};

const LIB = path.join(ROOT, 'src/lib/centroOperacionesReporteGeneral.ts');
let L = null;
try { L = loadTs(LIB); } catch (e) { ok('la librería existe y carga', false, String(e && e.message)); }

if (L) {
  const leer = L.leerReporteGeneral;
  const cuadra = L.reporteCuadra;
  const fila = (nombre, viajes, toneladas) => ({ nombre, viajes, toneladas });

  // ——— 0. La librería es PURA ———
  {
    const src = fs.readFileSync(LIB, 'utf8');
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
    eq('0.1 solo importa ./numeros y ./text', imports, ['./numeros', './text']);
    ok('0.2 sin supabase, sin fetch, sin React', !/supabase|fetch\(|react/i.test(src.replace(/\/\/.*$/gm, '')));
    ok('0.3 no nombra tablas del módulo (candado de aislamiento)', !/(?<![a-z0-9])cop_/i.test(src));
  }

  // ——— 1. La estructura de siempre ———
  const BASE = [
    'REPORTE DE VIAJES Y TONELAJE - CDT SITIO EJEMPLO - ZONA',
    'Fecha de corte: 05/10/2026 (7:00 PM)',
    'Viajes Totales: 12',
    'Total Neto: 280.50 TNS',
    '',
    'Por Empresa:',
    'TRANSPORTISTA UNO: 7 viajes | 160.25 TNS',
    'TRANSPORTISTA DOS: 5 viajes | 120.25 TNS',
    '',
    'Por Frente:',
    'OBRA NORTE: 6 viajes | 150.00 TNS',
    'RESIDENCIAS SUR 2: 5 viajes | 110.30 TNS',
    'QTA EJEMPLO: 1 viaje | 20.20 TNS',
  ].join('\n');
  {
    const r = leer(BASE);
    eq('1.1 título', r.titulo, 'REPORTE DE VIAJES Y TONELAJE - CDT SITIO EJEMPLO - ZONA');
    eq('1.2 sitio = lo que va después de «TONELAJE -»', r.sitioTexto, 'CDT SITIO EJEMPLO - ZONA');
    eq('1.3 fecha de corte', r.fecha, '2026-10-05');
    eq('1.4 hora de corte en 24 h', r.horaCorte, '19:00');
    eq('1.5 jornada: corte a las 7 pm = el mismo día', r.jornada, '2026-10-05');
    eq('1.6 viajes totales', r.viajesTotal, 12);
    eq('1.7 toneladas totales', r.toneladasTotal, 280.5);
    eq('1.8 empresas', r.empresas, [fila('TRANSPORTISTA UNO', 7, 160.25), fila('TRANSPORTISTA DOS', 5, 120.25)]);
    eq('1.9 frentes (el nombre con dígito y «1 viaje»)', r.frentes,
      [fila('OBRA NORTE', 6, 150), fila('RESIDENCIAS SUR 2', 5, 110.3), fila('QTA EJEMPLO', 1, 20.2)]);
    eq('1.10 sin avisos', r.avisos, []);
    eq('1.11 nada sin leer', r.lineasNoLeidas, []);
    eq('1.12 cuadra', cuadra(r), true);
  }

  // ——— 2. Lo que hace WhatsApp: negritas, emojis, viñetas, CRLF, «4.321,09» ———
  {
    const WA = [
      '*📊 REPORTE DE VIAJES Y TONELAJE - CDT PRUEBA ESTE*',
      '📅 _Fecha de corte:_ 6-10-2026 (7:00\u202Fp.\u00A0m.)',
      '',
      '🚛 *Total viajes:* 1.240',
      '⚖️ *Toneladas totales:* 4.321,09 Ton',
      '━━━━━━━━━━━━',
      '*POR EMPRESAS*',
      '• R&X:   700 viajes | 3.300,00 TNS',
      '▪️ DELL\'X: 540 V / 1.021,09 t',
      '',
      '➡️ *Frentes de trabajo:*',
      '1. LOMA AZUL 2: 1.000 viajes | 3.321,09 TN',
      '2. Quinta Él Ñandú - 240 viajes - 1.000 toneladas',
      '',
    ].join('\r\n');
    const r = leer(WA);
    eq('2.1 título sin emoji ni asteriscos', r.titulo, 'REPORTE DE VIAJES Y TONELAJE - CDT PRUEBA ESTE');
    eq('2.2 sitio', r.sitioTexto, 'CDT PRUEBA ESTE');
    eq('2.3 fecha con guiones', r.fecha, '2026-10-06');
    eq('2.4 «7:00 p. m.» con espacios raros de WhatsApp', r.horaCorte, '19:00');
    eq('2.5 «Total viajes: 1.240» = mil doscientos cuarenta', r.viajesTotal, 1240);
    eq('2.6 «Toneladas totales: 4.321,09»', r.toneladasTotal, 4321.09);
    eq('2.7 empresas con «&», apóstrofo, «V» y «t»', r.empresas, [fila('R&X', 700, 3300), fila("DELL'X", 540, 1021.09)]);
    eq('2.8 frentes con numeración, guiones y tildes (se respeta la escritura)', r.frentes,
      [fila('LOMA AZUL 2', 1000, 3321.09), fila('Quinta Él Ñandú', 240, 1000)]);
    eq('2.9 sin avisos', r.avisos, []);
    eq('2.10 la raya decorativa no cuenta como línea sin leer', r.lineasNoLeidas, []);
    eq('2.11 cuadra', cuadra(r), true);
  }

  // ——— 3. «1.000 TNS»: el estilo de miles se deduce del propio reporte ———
  {
    const conComa = leer(['Total Neto: 4,321.09 TNS', 'Viajes Totales: 3', 'Por Empresa:', 'UNO: 3 viajes | 4,321.09 TNS',
      'Por Frente:', 'NORTE: 2 viajes | 1,000 TNS', 'SUR: 1 viaje | 3,321.09 TNS'].join('\n'));
    eq('3.1 reporte con «4,321.09»: «1,000 TNS» son mil', conComa.frentes[0], fila('NORTE', 2, 1000));
    eq('3.2 y cuadra', cuadra(conComa), true);
    const sinPista = leer('Por Frente:\nNORTE: 2 viajes | 1.500 TNS');
    eq('3.3 sin pistas de miles manda leerNumero: «1.500» es uno y medio (y la suma lo delata)', sinPista.frentes[0].toneladas, 1.5);
    const conPunto = leer('Total Neto: 1.500,00 TNS\nPor Frente:\nNORTE: 2 viajes | 1.500 TNS');
    eq('3.4 reporte con «1.500,00»: «1.500 TNS» son mil quinientos', conPunto.frentes[0].toneladas, 1500);
  }

  // ——— 4. Faltan los totales: se toman de las filas, con aviso ———
  {
    const r = leer(['Reporte General CDT', 'Fecha: 07/10/26 7pm', 'Por empresa', 'UNO 1 viaje 10.5 tns',
      'DOS: 2 viajes | 20 TNS', 'Por frente', 'NORTE: 3 viajes | 30.5 TNS'].join('\n'));
    eq('4.1 título sin «TONELAJE -» → sin sitio', [r.titulo, r.sitioTexto], ['Reporte General CDT', null]);
    eq('4.2 fecha d/m/yy', r.fecha, '2026-10-07');
    eq('4.3 «7pm»', r.horaCorte, '19:00');
    eq('4.4 viajes calculados', r.viajesTotal, 3);
    eq('4.5 toneladas calculadas', r.toneladasTotal, 30.5);
    eq('4.6 fila sin separadores', r.empresas[0], fila('UNO', 1, 10.5));
    eq('4.7 avisos de totales calculados', r.avisos, [
      'El reporte no trae los viajes totales; se usó la suma de las empresas: 3.',
      'El reporte no trae el total de toneladas; se usó la suma de las empresas: 30,50.',
    ]);
    eq('4.8 cuadra', cuadra(r), true);
    const soloFrentes = leer('Por Frente:\nNORTE: 3 viajes | 30 TNS');
    ok('4.9 sin empresas, el total sale de los frentes',
      soloFrentes.viajesTotal === 3 && soloFrentes.avisos.includes('El reporte no trae los viajes totales; se usó la suma de los frentes: 3.'));
    ok('4.10 … y avisa que falta la sección de empresas', soloFrentes.avisos.includes('No se encontró la sección «Por Empresa».'));
    eq('4.11 … y no cuadra', cuadra(soloFrentes), false);
  }

  // ——— 5. Nombre repetido en la misma sección: se suma y se avisa ———
  {
    const r = leer(['REPORTE DE VIAJES Y TONELAJE - CDT X', 'Fecha de corte: 08/10/2026 (19:00)', 'Viajes Totales: 10',
      'Total Neto: 100 TNS', 'Por Empresa:', 'Transportista A: 4 viajes | 40.10 TNS', ' transportista   á : 6 viajes | 59.90 TNS',
      'Por Frente:', 'OBRA NORTE: 10 viajes | 100 TNS'].join('\n'));
    eq('5.1 «19:00»', r.horaCorte, '19:00');
    eq('5.2 se agrupa con la primera escritura', r.empresas, [fila('Transportista A', 10, 100)]);
    eq('5.3 aviso del repetido', r.avisos, ['«Transportista A» aparece 2 veces en las empresas; se sumaron sus viajes y toneladas.']);
    eq('5.4 cuadra', cuadra(r), true);
  }

  // ——— 6. Horas y jornada (7 am a 7 am) ———
  const conCorte = (lineaFecha) => leer(['REPORTE DE VIAJES Y TONELAJE - CDT X', lineaFecha, 'Viajes Totales: 1', 'Total Neto: 10 TNS',
    'Por Empresa:', 'UNO: 1 viaje | 10 TNS', 'Por Frente:', 'NORTE: 1 viaje | 10 TNS'].join('\n'));
  const casosHora = [
    ['Fecha de corte: 06/10/2026 (7:00 PM)', '19:00', '2026-10-06'],
    ['Fecha de corte: 06/10/2026 (7 PM)', '19:00', '2026-10-06'],
    ['Fecha de corte: 06/10/2026 (7:00 p. m.)', '19:00', '2026-10-06'],
    ['Fecha de corte: 06/10/2026 19:00', '19:00', '2026-10-06'],
    ['Fecha de corte: 06/10/2026 7pm', '19:00', '2026-10-06'],
    ['Fecha de corte: 06/10/2026 (19:00 PM)', '19:00', '2026-10-06'],
    ['Fecha de corte: 06/10/2026 (12 PM)', '12:00', '2026-10-06'],
    ['Fecha de corte: 06/10/2026 (2:00 AM)', '02:00', '2026-10-05'],
    ['Fecha de corte: 06/10/2026 (12:30 AM)', '00:30', '2026-10-05'],
    ['Fecha de corte: 06/10/2026 06:59', '06:59', '2026-10-05'],
    // R28 (24-oct-2026): el corte de las 07:00 en punto CIERRA la jornada anterior.
    ['Fecha de corte: 06/10/2026 07:00', '07:00', '2026-10-05'],
    ['Fecha de corte: 06/10/2026 (7:00 AM)', '07:00', '2026-10-05'],
    ['Fecha de corte: 06/10/2026 (7 a. m.)', '07:00', '2026-10-05'],
    ['Fecha de corte: 01/01/2027 07:00', '07:00', '2026-12-31'],
    ['Fecha de corte: 06/10/2026 07:01', '07:01', '2026-10-06'],
    ['Fecha de corte: 01/01/2027 (1:30 a. m.)', '01:30', '2026-12-31'],
    ['Fecha de corte: 01/03/2028 (5 am)', '05:00', '2028-02-29'],
  ];
  for (const [linea, hora, jornada] of casosHora) {
    const r = conCorte(linea);
    eq(`6 «${linea}» → hora ${hora}, jornada ${jornada}`, [r.horaCorte, r.jornada, r.avisos], [hora, jornada, []]);
  }
  {
    const r = conCorte('Fecha de corte: 06/10/2026 (2:00 AM)');
    eq('6.a el corte de las 2 am conserva la fecha escrita', r.fecha, '2026-10-06');
  }

  // ——— 7. Fechas en otras formas ———
  const casosFecha = [
    ['Fecha de corte: 5/10/2026 7 PM', '2026-10-05'],
    ['Fecha de corte: 05.10.2026 7 PM', '2026-10-05'],
    ['Fecha de corte: 23 de octubre de 2026, 7:00 PM', '2026-10-23'],
    ['Fecha de corte: 2026-10-05 19:00', '2026-10-05'],
  ];
  for (const [linea, fecha] of casosFecha) eq(`7 «${linea}» → ${fecha}`, conCorte(linea).fecha, fecha);
  {
    const inv = conCorte('Fecha de corte: 31/02/2026 (7:00 PM)');
    eq('7.1 fecha imposible → sin fecha ni jornada', [inv.fecha, inv.jornada], [null, null]);
    ok('7.2 … con aviso que la nombra', inv.avisos.includes('La fecha «31/02/2026» no existe en el calendario; revísala.'), JSON.stringify(inv.avisos));
    const us = conCorte('Fecha de corte: 10/23/2026 (7:00 PM)');
    eq('7.3 mes/día al revés se corrige', us.fecha, '2026-10-23');
    ok('7.4 … y se avisa', us.avisos.includes('La fecha venía como mes/día (10/23/2026); se leyó como 23/10/2026.'), JSON.stringify(us.avisos));
    const sinFecha = conCorte('Generado por el sistema');
    eq('7.5 sin fecha: fecha, hora y jornada nulas', [sinFecha.fecha, sinFecha.horaCorte, sinFecha.jornada], [null, null, null]);
    eq('7.6 … avisos de fecha y hora', sinFecha.avisos, ['No se encontró la fecha de corte.', 'No se encontró la hora de corte.']);
    eq('7.7 … y la línea queda a la vista', sinFecha.lineasNoLeidas, ['Generado por el sistema']);
    const sinHora = conCorte('Fecha de corte: 06/10/2026');
    eq('7.8 sin hora: jornada = fecha, con aviso', [sinHora.jornada, sinHora.avisos],
      ['2026-10-06', ['No se encontró la hora de corte; la jornada se tomó igual a la fecha.']]);
    const horaAparte = leer(['REPORTE X', 'Fecha: 06/10/2026', 'Hora de corte: 2 AM', 'Por Empresa:', 'UNO: 1 viaje | 1 TNS'].join('\n'));
    eq('7.9 la hora en su propia línea', [horaAparte.fecha, horaAparte.horaCorte, horaAparte.jornada], ['2026-10-06', '02:00', '2026-10-05']);
  }

  // ——— 8. Las sumas no cuadran: avisos con los dos números y la diferencia ———
  {
    const r = leer(['REPORTE DE VIAJES Y TONELAJE - CDT X', 'Fecha de corte: 05/10/2026 (7:00 PM)', 'Viajes Totales: 12',
      'Total Neto: 280.50 TNS', 'Por Empresa:', 'UNO: 7 viajes | 160.25 TNS', 'DOS: 4 viajes | 110.25 TNS',
      'Por Frente:', 'NORTE: 6 viajes | 150.00 TNS', 'SUR: 7 viajes | 140.50 TNS'].join('\n'));
    eq('8.1 avisos de diferencias', r.avisos, [
      'Las empresas suman 11 viajes, pero el total dice 12: falta 1 viaje.',
      'Las empresas suman 270,50 toneladas, pero el total dice 280,50: faltan 10,00 toneladas.',
      'Los frentes suman 13 viajes, pero el total dice 12: sobra 1 viaje.',
      'Los frentes suman 290,50 toneladas, pero el total dice 280,50: sobran 10,00 toneladas.',
    ]);
    eq('8.2 no cuadra', cuadra(r), false);
    const grande = leer(['Viajes Totales: 1.240', 'Total Neto: 4.321,09 TNS', 'Por Empresa:', 'UNO: 1.000 viajes | 4.000,00 TNS',
      'Por Frente:', 'NORTE: 1.240 viajes | 4.321,09 TNS'].join('\n'));
    ok('8.3 cifras grandes en el aviso con punto de miles y coma decimal',
      grande.avisos.includes('Las empresas suman 1.000 viajes, pero el total dice 1.240: faltan 240 viajes.')
      && grande.avisos.includes('Las empresas suman 4.000,00 toneladas, pero el total dice 4.321,09: faltan 321,09 toneladas.'),
      JSON.stringify(grande.avisos));
    const tol = (t) => leer(`Viajes Totales: 2\nTotal Neto: 280.50 TNS\nPor Empresa:\nA: 1 viaje | 140.25 TNS\nB: 1 viaje | ${t} TNS\nPor Frente:\nN: 2 viajes | 280.50 TNS`);
    eq('8.4 una centésima de diferencia todavía cuadra (y no hay aviso de sumas)',
      [cuadra(tol('140.26')), tol('140.26').avisos.filter((a) => a.includes('suman'))], [true, []]);
    eq('8.5 dos centésimas ya no', cuadra(tol('140.27')), false);
    ok('8.6 … y lo avisa', tol('140.27').avisos.includes('Las empresas suman 280,52 toneladas, pero el total dice 280,50: sobran 0,02 toneladas.'),
      JSON.stringify(tol('140.27').avisos));
  }

  // ——— 9. Lo que no se entiende queda a la vista ———
  {
    const r = leer(['REPORTE DE VIAJES Y TONELAJE - CDT X', 'Fecha de corte: 05/10/2026 (7:00 PM)', 'Buenas tardes equipo',
      'SUELTA: 3 viajes | 30 TNS', 'Viajes Totales: 3', 'Total Neto: 30 TNS', 'Por Empresa:', 'UNO: 3 viajes | 30 TNS',
      '*Nota:* revisar camión 12', 'Por Material:', 'ARENA: 3 viajes | 30 TNS', 'Por Frente:', 'NORTE: 3 viajes | 30 TNS'].join('\n'));
    eq('9.1 líneas antes de la primera sección y sueltas: a la vista, en su escritura original', r.lineasNoLeidas,
      ['Buenas tardes equipo', 'SUELTA: 3 viajes | 30 TNS', '*Nota:* revisar camión 12', 'Por Material:', 'ARENA: 3 viajes | 30 TNS']);
    eq('9.2 la fila de la sección desconocida no se cuela en empresas', r.empresas, [fila('UNO', 3, 30)]);
    eq('9.3 frentes', r.frentes, [fila('NORTE', 3, 30)]);
    eq('9.4 aviso de la sección desconocida', r.avisos, ['La sección «Por Material» no se reconoce; sus líneas quedan sin leer.']);
    eq('9.5 cuadra', cuadra(r), true);
  }

  // ——— 10. Variantes de encabezado, de fila y de totales ———
  {
    const r = leer(['Fecha de corte: 05/10/2026 7 PM', 'Viajes: 6', 'Toneladas: 60', 'EMPRESAS:', 'R&X 2 - 4 viajes - 40 TN', '23 DE ENERO: 2 viajes / 20 Ton.',
      'TOTAL: 6 viajes | 60 TNS', 'Frentes', 'NORTE: 40.00 TNS | 4 viajes', 'SUR = 2 vjs (20 toneladas)'].join('\n'));
    eq('10.1 «Viajes: 6» y «Toneladas: 60»', [r.viajesTotal, r.toneladasTotal], [6, 60]);
    eq('10.2 nombres con dígitos y «&»; la fila TOTAL no es una empresa', r.empresas, [fila('R&X 2', 4, 40), fila('23 DE ENERO', 2, 20)]);
    eq('10.3 toneladas antes que viajes, «=», paréntesis', r.frentes, [fila('NORTE', 4, 40), fila('SUR', 2, 20)]);
    eq('10.4 sin avisos', r.avisos, []);
    eq('10.5 cuadra', cuadra(r), true);
    const totalAbajo = leer(['Por Empresa:', 'UNO: 2 viajes | 20 TNS', 'TOTAL: 2 viajes | 20 TNS', 'Por Frente:', 'N: 2 viajes | 20 TNS',
      'Total de viajes: 2', 'Total neto: 20,00 tns'].join('\n'));
    eq('10.6 la fila TOTAL y los totales al final sirven de totales', [totalAbajo.viajesTotal, totalAbajo.toneladasTotal], [2, 20]);
    ok('10.7 … sin aviso de «totales calculados»', !totalAbajo.avisos.some((a) => a.includes('no trae')), JSON.stringify(totalAbajo.avisos));
    const dos = leer('Viajes Totales: 12\nViajes Totales: 11\nTotal Neto: 1 TNS\nPor Empresa:\nA: 12 viajes | 1 TNS\nPor Frente:\nB: 12 viajes | 1 TNS');
    eq('10.8 dos totales distintos: gana el primero', dos.viajesTotal, 12);
    ok('10.9 … y se avisa', dos.avisos.includes('El reporte trae dos totales de viajes distintos (12 y 11); se usó el primero.'), JSON.stringify(dos.avisos));
    const vacia = leer('Viajes Totales: 1\nTotal Neto: 1 TNS\nPor Empresa:\nPor Frente:\nB: 1 viaje | 1 TNS');
    ok('10.10 sección presente pero vacía', vacia.avisos.includes('La sección «Por Empresa» no trae ninguna línea.'), JSON.stringify(vacia.avisos));
    const ninguna = leer('REPORTE X\nFecha de corte: 05/10/2026 7 PM\nViajes Totales: 1\nTotal Neto: 1 TNS');
    eq('10.11 sin ninguna sección', ninguna.avisos, ['No se encontraron las secciones «Por Empresa» ni «Por Frente».']);
    eq('10.12 … no cuadra', cuadra(ninguna), false);
    const fraccion = leer('Por Empresa:\nA: 2,5 viajes | 10 TNS');
    eq('10.13 viajes con decimales no se inventan: la línea queda sin leer', [fraccion.empresas, fraccion.lineasNoLeidas], [[], ['A: 2,5 viajes | 10 TNS']]);
  }

  // ——— 10b. Trampas: viñetas, filas que parecen horas, copias de varios mensajes ———
  {
    const r = leer(['REPORTE DE VIAJES Y TONELAJE – CDT GUION LARGO', 'Fecha de corte: 05/10/2026', 'Viajes Totales: 16', 'Total Neto: 60 TNS',
      'Por Empresas Transportistas:', '- UNO: 14 viajes | 40 TNS', '1️⃣ DOS – 2 viajes – 20 TNS',
      'Por Frente:', 'CORTE 2: 13 viajes | 30 TNS', 'OBRA: TORRE 2: 3 viajes | 30 TNS'].join('\n'));
    eq('10b.1 sitio tras un guion largo', r.sitioTexto, 'CDT GUION LARGO');
    eq('10b.2 «Por Empresas Transportistas», viñeta «-» y «1️⃣»', r.empresas, [fila('UNO', 14, 40), fila('DOS', 2, 20)]);
    eq('10b.3 un frente llamado «CORTE 2» no se toma por la hora; el nombre puede llevar «:»', r.frentes,
      [fila('CORTE 2', 13, 30), fila('OBRA: TORRE 2', 3, 30)]);
    eq('10b.4 … y la hora sigue sin aparecer', [r.horaCorte, r.jornada], [null, '2026-10-05']);
    eq('10b.5 cuadra', cuadra(r), true);

    const copia = leer([
      '[06/10/26, 7:05:12 p. m.] Encargado Ejemplo: *REPORTE DE VIAJES Y TONELAJE - CDT COPIA*',
      'Fecha de corte: 05/10/2026 (7:00 PM)', 'Viajes Totales: 1', 'Total Neto: 10 TNS',
      'Por Empresa:', 'UNO: 1 viaje | 10 TNS', 'Por Frente:', 'NORTE: 1 viaje | 10 TNS',
      '06/10/26, 7:06 p. m. - Encargado Ejemplo: Buenas noches',
    ].join('\n'));
    eq('10b.6 copia de varios mensajes: se quita «[fecha, hora] Nombre:» del título', copia.titulo, 'REPORTE DE VIAJES Y TONELAJE - CDT COPIA');
    eq('10b.7 … la fecha y hora son las del corte, no las del mensaje', [copia.fecha, copia.horaCorte, copia.jornada], ['2026-10-05', '19:00', '2026-10-05']);
    eq('10b.8 … y el otro mensaje queda a la vista', copia.lineasNoLeidas, ['06/10/26, 7:06 p. m. - Encargado Ejemplo: Buenas noches']);
    eq('10b.9 … sin avisos', copia.avisos, []);

    const tituloConFecha = leer(['REPORTE DEL DÍA 04/10/2026 6 PM - CDT X', 'Fecha de corte: 05/10/2026', 'Viajes Totales: 1', 'Total Neto: 1 TNS',
      'Por Empresa:', 'A: 1 viaje | 1 TNS', 'Por Frente:', 'B: 1 viaje | 1 TNS'].join('\n'));
    eq('10b.10 el título con fecha sigue siendo el título', tituloConFecha.titulo, 'REPORTE DEL DÍA 04/10/2026 6 PM - CDT X');
    eq('10b.11 la línea «Fecha de corte» manda sobre la fecha del título (y la hora de otro día no se arrastra)',
      [tituloConFecha.fecha, tituloConFecha.horaCorte], ['2026-10-05', null]);
    const soloTitulo = leer('REPORTE CDT X 05/10/2026 7:00 PM\nViajes Totales: 1\nTotal Neto: 1 TNS\nPor Empresa:\nA: 1 viaje | 1 TNS\nPor Frente:\nB: 1 viaje | 1 TNS');
    eq('10b.12 sin línea de fecha, se toma la del título', [soloTitulo.fecha, soloTitulo.horaCorte, soloTitulo.avisos], ['2026-10-05', '19:00', []]);

    const saludo = leer(['REPORTE X', 'Buenos días:', 'Fecha de corte: 05/10/2026 7 PM', 'Viajes Totales: 1', 'Total Neto: 1 TNS',
      'Por Empresa:', 'A: 1 viaje | 1 TNS', 'Por Frente:', 'B: 1 viaje | 1 TNS'].join('\n'));
    eq('10b.13 un saludo con «:» antes de las secciones no es una sección', [saludo.avisos, saludo.lineasNoLeidas], [[], ['Buenos días:']]);
  }

  // ——— 11. Basura, vacío y textos enormes: nunca revienta ———
  {
    const vacio = leer('');
    eq('11.1 vacío', vacio, {
      titulo: null, sitioTexto: null, fecha: null, horaCorte: null, jornada: null, viajesTotal: null, toneladasTotal: null,
      empresas: [], frentes: [], avisos: ['No hay texto para leer: pega el Reporte General completo.'], lineasNoLeidas: [],
    });
    eq('11.2 vacío no cuadra', cuadra(vacio), false);
    eq('11.3 solo espacios y emojis = vacío', leer(' \r\n 🙂 \n\n').avisos, ['No hay texto para leer: pega el Reporte General completo.']);
    let r = null, err = null;
    for (const raro of [null, undefined, 42, {}, []]) {
      try { r = leer(raro); } catch (e) { err = e; }
    }
    ok('11.4 null, undefined, números y objetos no revientan', err === null && r && Array.isArray(r.avisos));
    eq('11.5 reporteCuadra(null) = false', cuadra(null), false);
    const basura = leer('hola, ¿cómo estás?\nesto no es un reporte 123\n:::|||---');
    eq('11.6 basura: nada reconocido', [basura.fecha, basura.viajesTotal, basura.toneladasTotal, basura.empresas, basura.frentes],
      [null, null, null, [], []]);
    eq('11.7 … un solo aviso claro', basura.avisos,
      ['Esto no parece un Reporte General: no se encontró la fecha de corte, ni los totales, ni las secciones «Por Empresa» y «Por Frente».']);
    eq('11.8 … y lo que no se entendió queda a la vista', basura.lineasNoLeidas, ['esto no es un reporte 123']);
    eq('11.9 … no cuadra', cuadra(basura), false);

    const t0 = Date.now();
    const enormes = [
      'x'.repeat(2_000_000),
      '1.'.repeat(200_000),
      ('OBRA: 1 viaje | 1 TNS ' + '9,'.repeat(50)).repeat(5000),
      Array.from({ length: 50_000 }, (_, i) => `linea basura ${i} --- ${'5.'.repeat(20)}`).join('\n'),
      '-'.repeat(100_000) + '1 viajes',
    ];
    let todoBien = true;
    for (const t of enormes) {
      try { const x = leer(t); if (!x || !Array.isArray(x.lineasNoLeidas) || x.lineasNoLeidas.length > 200) todoBien = false; }
      catch { todoBien = false; }
    }
    const ms = Date.now() - t0;
    ok('11.10 textos enormes: devuelve resultado y como mucho 200 líneas sin leer', todoBien);
    ok(`11.11 … y rápido (${ms} ms < 5000)`, ms < 5000);
    const muchas = leer(Array.from({ length: 300 }, (_, i) => `ruido ${i}`).join('\n'));
    eq('11.12 más de 200 líneas sin leer: se muestran 200 …', muchas.lineasNoLeidas.length, 200);
    ok('11.13 … y se avisa cuántas faltan', muchas.avisos.includes('Hay 99 líneas más sin leer que no se muestran.'), JSON.stringify(muchas.avisos));
    const larga = leer('REPORTE\n' + 'z'.repeat(1000));
    ok('11.14 una línea enorme se muestra recortada', larga.lineasNoLeidas.length === 1 && larga.lineasNoLeidas[0].length <= 301
      && larga.lineasNoLeidas[0].endsWith('…'));
    const kilometrico = leer(Array.from({ length: 3000 }, () => 'A: 1 viaje | 1 TNS').join('\n'));
    ok('11.15 más de 2.000 líneas: se leen las primeras y se avisa', kilometrico.avisos.includes(
      'El texto es muy largo: solo se leyeron las primeras 2.000 líneas (quedaron 1.000 sin revisar).'), JSON.stringify(kilometrico.avisos.slice(-3)));
  }
}

console.log(`${fail === 0 ? '✅' : '❌'} test-centro-operaciones-reporte-general · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
console.log('El Reporte General pegado de WhatsApp se lee entero: lo que no se entiende queda a la vista.');
