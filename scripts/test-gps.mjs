// 📡 GPS DE LAS MÁQUINAS — DETEKTOR (12-nov-2026). Fija:
//   · cómo se leen las respuestas de Detektor (detenciones, resumen diario, errores),
//   · la ÚLTIMA ubicación (detenida aquí / en movimiento) y las fechas en hora de Caracas,
//   · ⭐ que el usuario y la clave de Detektor NO están en la app (solo en el puente de Supabase),
//   · que el puente revisa el permiso, solo consulta placas vinculadas, limita fechas y no filtra la clave,
//   · que la ubicación sale en el MISMO mapa de la maquinaria (capa 📡) con UNA consulta por toque.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');
function loadTs(abs) {
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
  const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs)); m._compile(out, abs); return m.exports;
}
let ok = 0; const fallas = [];
const check = (c, m, x) => { if (c) ok++; else fallas.push('  ✗ ' + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const eq = (a, b, m) => check(JSON.stringify(a) === JSON.stringify(b), m, { esperado: b, obtenido: a });
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const G = loadTs(path.join(ROOT, 'src/lib/gps.ts'));

// ── 1) La dirección y las fechas ──
eq(G.DETEKTOR_BASE, 'https://ve.detektorgps.com/gps_ve/framework/servicios', '⭐ la ruta de Venezuela (gps_ve en ve.detektorgps.com; con «gt.» da 404, comprobado el 12-nov)');
eq(G.msDeFechaDetektor('2026-11-12 07:30:05'), Date.parse('2026-11-12T11:30:05Z'), 'las fechas de Detektor son hora de Caracas (UTC−4)');
eq(G.fechaDetektor(Date.parse('2026-11-12T11:30:05Z')), '2026-11-12 07:30:05', 'y se le mandan en hora de Caracas');
eq([G.horasDeDuracion('11:22:08').toFixed(3), G.horasDeDuracion('0:00'), G.horasDeDuracion('x')], ['11.369', 0, null], 'duraciones «hh:mm:ss» → horas');
eq(G.placaYAlias('1234 - [alias-1234]'), { placa: '1234', alias: 'alias-1234' }, 'la placa de las detenciones trae el alias entre corchetes');
check(G.esDelVehiculo({ placa: 'A22-CY0J', alias: 'x' }, 'a22cy0j') && G.esDelVehiculo({ placa: '9', alias: 'Gandola 1' }, 'GANDOLA-1'), 'se reconoce por placa o alias sin importar guiones ni mayúsculas');

// ── 2) Respuestas ──
eq(G.leerRespuestaDetektor({ status: 'fail', info: 'Se requiere Autenticacion para continuar' }), { filas: [], error: 'Detektor: Se requiere Autenticacion para continuar' }, '⭐ el error de Detektor se dice en palabras (la respuesta real sin usuario)');
eq(G.leerRespuestaDetektor([{ a: 1 }]).filas.length, 1, 'una lista es la respuesta buena');

const DET = [
  { fechainicio: '2026-11-12 06:00:00', fechafinal: '2026-11-12 07:00:00', placa: 'A22CY0J - [GANDOLA 1]', latitud: '10.6', longitud: '-66.9', georeferencia: 'A 100 M (LA GUAIRA, LA GUAIRA) - [0336763626]', tiempo: '3600', ignicion: '0' },
  { fechainicio: '2026-11-12 08:00:00', fechafinal: '2026-11-12 09:55:00', placa: 'A22CY0J - [GANDOLA 1]', latitud: '10.61', longitud: '-66.91', georeferencia: 'A 5 M DE KM. 3 (CATIA LA MAR, LA GUAIRA) - [1]', tiempo: '6900', ignicion: '1' },
  { fechainicio: '2026-11-12 05:00:00', fechafinal: '2026-11-12 05:30:00', placa: 'A43AT7M - [VOLQUETA]', latitud: '10.5', longitud: '-66.8', georeferencia: 'X', tiempo: '1800', ignicion: '0' },
  { fechainicio: '2026-11-12 05:00:00', fechafinal: '2026-11-12 05:30:00', placa: 'MALA - [x]', latitud: '0', longitud: '0' },
];
const D = G.leerDetenciones(DET);
eq(D.length, 3, 'las detenciones sin coordenadas no sirven');
eq([D[2].lugar, D[2].motorEncendido, D[2].segundos], ['A 5 M DE KM. 3 (CATIA LA MAR, LA GUAIRA)', true, 6900], 'lugar sin el código del final, motor y duración');
const AHORA = G.msDeFechaDetektor('2026-11-12 10:00:00');
const u1 = G.ultimaUbicacion(D, 'A22CY0J', AHORA);
eq([u1.lat, u1.lng, u1.detenida, u1.motorEncendido], [10.61, -66.91, true, true], '⭐ la última detención es la ubicación; terminó hace 5 min → «sigue detenida ahí»');
check(/Detenida aquí desde las 08:00/.test(G.lineasUbicacion(u1, AHORA)[0]) && G.lineasUbicacion(u1, AHORA).includes('🟢 Motor encendido'), 'la ventanita dice desde cuándo y el motor');
const u2 = G.ultimaUbicacion(D, 'VOLQUETA', AHORA);
eq([u2.detenida, G.ubicacionVieja(u2, AHORA)], [false, false], '⭐ salió de su última parada hace 4 h 30 min → «en movimiento», todavía no gris');
check(/En movimiento: su última parada fue aquí, de 05:00 a 05:30/.test(G.lineasUbicacion(u2, AHORA)[0]), 'dice cuál fue su última parada');
check(G.ubicacionVieja(u2, AHORA + 3 * 3600000), 'más de 6 h sin noticias → gris');
eq(G.ultimaUbicacion(D, 'NOEXISTE', AHORA), null, 'sin detenciones de esa placa: null (no se inventa un punto)');

// ── 3) Resumen diario ──
const RES = [
  { fecha: '2026-11-11', placa: 'A22CY0J', alias: 'GANDOLA 1', motivo: 'Primer encendido del dia', valor: '06:15:32' },
  { fecha: '2026-11-11', placa: 'A22CY0J', alias: 'GANDOLA 1', motivo: 'Ultimo apagado del dia', valor: '18:37:40' },
  { fecha: '2026-11-11', placa: 'A22CY0J', alias: 'GANDOLA 1', motivo: 'Tiempo entre Primer Encendido y Ult. Apagado', valor: '12:22:08' },
  { fecha: '2026-11-11', placa: 'A22CY0J', alias: 'GANDOLA 1', motivo: 'Tiempo Det. motor apagado', valor: '03:00:00' },
  { fecha: '2026-11-11', placa: 'A22CY0J', alias: 'GANDOLA 1', motivo: 'Tiempo Det. motor encendido', valor: '01:30:00' },
  { fecha: '2026-11-11', placa: 'A22CY0J', alias: 'GANDOLA 1', motivo: 'Tiempo Efectivo', valor: '07:52:08' },
  { fecha: '2026-11-11', placa: 'A22CY0J', alias: 'GANDOLA 1', motivo: 'Kilometraje del día', valor: '162.1' },
  { fecha: '2026-11-11', placa: 'A43AT7M', alias: 'VOLQUETA', motivo: 'Kilometraje del día', valor: '40' },
];
const R = G.leerResumenDiario(RES);
eq(R.length, 2, 'una fila por vehículo y día');
const g = R.find((x) => x.placa === 'A22CY0J');
eq([g.primerEncendido, g.ultimoApagado, g.horasEfectivas.toFixed(2), g.horasDetenidoEncendido, g.horasDetenidoApagado, g.km], ['06:15:32', '18:37:40', '7.87', 1.5, 3, 162.1], '⭐ primer encendido, último apagado, efectivas, ralentí, motor apagado y km');
eq(G.vehiculosDeLaCuenta(RES), [{ placa: 'A22CY0J', alias: 'GANDOLA 1' }, { placa: 'A43AT7M', alias: 'VOLQUETA' }], 'los vehículos de la cuenta, sin repetir');
eq(G.vehiculosDeLaCuenta(DET).map((v) => v.placa), ['A22CY0J', 'A43AT7M', 'MALA'], 'también de las detenciones («placa - [alias]»)');

// ── 4) Vincular con el Catálogo ──
const CAT = [{ id: 'm1', code: 'CHUTO CON LOWBOY', plate: 'A22CY0J/LOW123' }, { id: 'm2', code: 'VOLTEO-7', plate: 'XYZ999' }];
eq([G.sugerirEquipo({ placa: 'A22CY0J', alias: '' }, CAT)?.id, G.sugerirEquipo({ placa: '1', alias: 'volteo-7' }, CAT)?.id, G.sugerirEquipo({ placa: 'NADA', alias: '' }, CAT)], ['m1', 'm2', null], '⭐ propone la máquina por placa (o un pedazo de CHUTO/LOWBOY) o por código; si no, nada');

// ── 5) ⭐⭐ Seguridad: la clave de Detektor NO está en la app ──
{
  const todos = [];
  (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f.name)) todos.push(p); } })(path.join(ROOT, 'src'));
  const conDetektorDirecto = todos.filter((p) => /detektorgps\.com/.test(fs.readFileSync(p, 'utf8')) && !p.endsWith(path.join('lib', 'gps.ts')));
  eq(conDetektorDirecto.map((p) => path.relative(ROOT, p)), [], '⭐⭐ ninguna pantalla le habla directo a Detektor (todo por el puente)');
  check(!todos.some((p) => /DETEKTOR_(USUARIO|CLAVE)|usuario:\s*['"][^'"]+['"],\s*pass:/.test(fs.readFileSync(p, 'utf8'))), '⭐⭐ ni usuario ni clave de Detektor en el código de la app');
  check(/supabase\.functions\.invoke\('gps-detektor', \{ body: pedido \}\)/.test(leer('src/lib/gpsDb.ts')), 'la única puerta: el puente gps-detektor');
}
const fn = leer('supabase/functions/gps-detektor/index.ts');
check(/Deno\.env\.get\('DETEKTOR_USUARIO'\)/.test(fn) && /Deno\.env\.get\('DETEKTOR_CLAVE'\)/.test(fn), '⭐ el puente toma usuario y clave de los SECRETOS de Supabase');
check(/caller\.auth\.getUser\(\)/.test(fn) && /caller\.rpc\(necesita\)/.test(fn) && /'gps_puede_editar' : 'gps_puede_ver'/.test(fn), '⭐ el puente pide sesión y el permiso GPS (descubrir vehículos pide escritura)');
check(/soloVinculadas/.test(fn) && /from\('gps_vehiculos'\)\.select\('placa_alias'\)/.test(fn), '⭐ solo consulta placas VINCULADAS (leídas con la sesión de quien pide)');
check(/'Content-Type': 'application\/x-www-form-urlencoded'/.test(fn) && /new URLSearchParams\(\{ usuario, pass, \.\.\.params \}\)/.test(fn), 'manda formulario como dice el manual (multipart da 403)');
check(/https:\/\/ve\.detektorgps\.com\/gps_ve\/framework\/servicios/.test(fn), 'la misma dirección de Venezuela');
check(/diasEntre\(desde, hasta\) > 31/.test(fn) && /diasEntre\(desde, hasta\) > 7/.test(fn) && /\.slice\(0, 60\)/.test(fn), 'limita fechas (31 / 7 días) y cantidad de placas');
check(/const CACHE_MS = 60_000/.test(fn), 'guarda 1 minuto: varias personas = 1 consulta a Detektor');
check(!/console\.(log|error)\([^)]*(pass|usuario)/.test(fn) && /Nunca se devuelve ni se registra el usuario o la clave/.test(fn), 'nunca registra ni devuelve la clave');

// ── 6) En el mapa de la maquinaria ──
const panel = leer('src/components/GpsPanelMapa.tsx');
check(/consultarDetektor\(\{ accion: 'ubicacion', placas: pedidos\.map\(\(v\) => v\.placaAlias\) \}\)/.test(panel), '⭐ «Actualizar»: UNA consulta para todas las marcadas');
check(/ultimaUbicacion\(dets, v\.placaAlias, cuando\)/.test(panel) && /\}\), \[vehiculos, consultas\]\);/.test(panel), 'la capa sale de la última detención y no cambia sola cada minuto');
check(/if \(!abierto \|\| vehiculos\) return;/.test(panel), 'la lista de vehículos se lee una vez y solo si abres el panel');
const ms = leer('src/screens/MapScreen.tsx');
check(/const verGps = moduleLevel\('gps'\) !== 'none'/.test(ms) && /\{verGps \? <GpsPanelMapa/.test(ms) && (ms.match(/gps=\{gpsPins\}/g) || []).length === 2, 'el panel sale en el Mapa con el permiso, y la capa también en pantalla completa');
const vm = leer('src/components/VenezuelaMap.tsx');
check(/var gpsLayer = L\.layerGroup\(\)/.test(vm) && /d\.type === 'map-gps'/.test(vm), 'la capa 📡 del mapa de la maquinaria');
{
  // El script DENTRO del mapa sigue siendo JavaScript válido (si se rompe, se cae el mapa entero).
  const Module2 = require('module'); const orig = Module2._load;
  require.extensions['.ts'] = function (mod, fnm) { mod._compile(ts.transpileModule(fs.readFileSync(fnm, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText, fnm); };
  const falso = new Proxy(function () {}, { get: () => new Proxy(function () {}, { get: () => ({}) }) });
  Module2._load = function (r) { if (r === 'react' || r === 'react-native' || r === './ui' || /theme/.test(r)) return falso; return orig.apply(this, arguments); };
  try {
    const abs = path.join(ROOT, 'src/components/VenezuelaMap.tsx');
    const out = ts.transpileModule(vm + '\nmodule.exports.__buildHtml = buildHtml;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    const m = new Module2(abs); m.filename = abs; m.paths = Module2._nodeModulePaths(path.dirname(abs)); m._compile(out, abs);
    const html = m.exports.__buildHtml([{ id: 'a', name: 'X', lat: 10, lng: -66, active: '1h', operational: true, company: 'C', route: [] }], false, true);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
    let compila = scripts.length > 0;
    for (const sc of scripts) { try { new Function(sc); } catch { compila = false; } }
    check(compila && scripts.some((sc) => sc.includes('drawGps')), '⭐ el script DENTRO del mapa compila (con la capa GPS)');
  } finally { Module2._load = orig; }
}

// ── 7) Permiso y pantalla ──
check(/\{ key: 'gps', label:/.test(leer('src/lib/permissions.ts')) && /moduleKey === 'gps'\) return 'none'/.test(leer('src/lib/permissions.ts')), '⭐ el permiso «GPS» existe y nace CERRADO');
const scr = leer('src/screens/GpsScreen.tsx');
check(/consultarDetektor\(\{ accion: 'vehiculos' \}\)/.test(scr) && /sugerirEquipo\(c, catalogo\)/.test(scr) && /vincularVehiculoGps\(placaAlias, machineryId, uid\)/.test(scr), 'buscar los vehículos de la cuenta y vincularlos con su máquina');
check(/consultarDetektor\(\{ accion: 'resumen'/.test(scr) && /leerResumenDiario\(r\.filas\)/.test(scr) && /📄 PDF/.test(scr), 'la actividad diaria, con PDF');
check(/onConflict: 'placa_alias'/.test(leer('src/lib/gpsDb.ts')) && /La base no dejó guardar/.test(leer('src/lib/gpsDb.ts')), 'una fila por placa; si la base no deja, lo dice');
check(/GPS DE LAS MÁQUINAS/.test(leer('src/screens/ManualScreen.tsx')) && /Detektor/.test(leer('src/screens/ManualScreen.tsx')), 'el manual lo explica (Detektor)');

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-gps: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-gps: ${ok} ok, 0 fallas`);

// ── Lectura del día en palabras (12-nov) y SOAP ultimo_punto (13-nov) ──
{
  const { lecturaDelDia, horaValida, leerResumenDiario, normalizarUrlDetektor, leerUltimoPuntoXml, leerDetenciones, ultimaUbicacion, lineasUbicacion, nombreVehiculo } = G;
  let ok2 = 0; const t = (c, m) => { if (!c) { console.error('FALLA:', m); process.exitCode = 1; } else ok2++; };
  const base = { placa: 'A01', alias: '', horasEncendidoApagado: null, horasDetenidoApagado: 0, horasDetenidoEncendido: 4.63, km: 42 };
  t(horaValida('06:58:06') && !horaValida('--:--:--') && !horaValida(null), 'horaValida');
  const sin = lecturaDelDia({ ...base, fecha: '2026-11-10', primerEncendido: '--:--:--', ultimoApagado: '--:--:--', horasEfectivas: 0 }, '2026-11-12');
  t(sin.estado === 'sin_actividad' && sin.horasMovimiento === 0, 'sin actividad');
  const cer = lecturaDelDia({ ...base, fecha: '2026-11-11', primerEncendido: '10:31:39', ultimoApagado: '17:59:46', horasEfectivas: 3 }, '2026-11-12');
  t(cer.estado === 'cerrado' && cer.texto === 'Trabajó de 10:31 a 17:59' && cer.horasMovimiento === 3, 'cerrado');
  const cur = lecturaDelDia({ ...base, fecha: '2026-11-12', primerEncendido: '06:58:06', ultimoApagado: '--:--:--', horasEfectivas: 19.37 }, '2026-11-12');
  t(cur.estado === 'en_curso' && cur.horasMovimiento === null && /06:58/.test(cur.texto), 'en curso: no se cree el 19:22 de Detektor');
  const vie = lecturaDelDia({ ...base, fecha: '2026-11-09', primerEncendido: '06:58:06', ultimoApagado: '--:--:--', horasEfectivas: 19.37 }, '2026-11-12');
  t(vie.estado === 'sin_apagado' && vie.horasMovimiento === null, 'día pasado sin apagado');
  // con las filas reales del 12-nov
  const real = leerResumenDiario([['Primer encendido del dia','06:58:06'],['Ultimo apagado del dia','--:--:--'],['Tiempo entre Primer Encendido y Ult. Apagado','00:00:0-6'],['Tiempo Det. motor encendido','04:38:00'],['Tiempo Efectivo','19:22:00'],['Kilometraje del día','42']].map(([motivo, valor]) => ({ fecha: '2026-11-12', placa: 'A01FE8M', alias: '', motivo, valor })));
  t(real.length === 1 && real[0].km === 42 && real[0].horasEncendidoApagado === null && lecturaDelDia(real[0], '2026-11-12').estado === 'en_curso', 'filas reales de Detektor');

  // Normalización de URL gt -> ve
  t(normalizarUrlDetektor('https://gt.detektorgps.com/gps_gt/framework/servicios/') === 'https://ve.detektorgps.com/gps_ve/framework/servicios', 'normalizarUrlDetektor gt -> ve');
  t(normalizarUrlDetektor('https://gt.detektorgps.com/gps_gt/ws/servicio_v2.php?wsdl') === 'https://ve.detektorgps.com/gps_ve/ws/servicio_v2.php?wsdl', 'normalizarUrlDetektor wsdl gt -> ve');

  // Parseo SOAP ultimo_punto con punto válido
  const soapOk = `<SOAP-ENV:Envelope><SOAP-ENV:Body><ultimo_puntoResponse xmlns="urn:VehiculosCercanosWSDL"><xml_dat>&lt;?xml version=&apos;1.0&apos;?&gt;&lt;ultimo_punto&gt;&lt;movil placa=&apos;A01FE8M&apos;&gt;&lt;fecha_hora&gt;2026-11-13 13:45:00&lt;/fecha_hora&gt;&lt;latitud&gt;10.6012&lt;/latitud&gt;&lt;longitud&gt;-66.9321&lt;/longitud&gt;&lt;velocidad&gt;35&lt;/velocidad&gt;&lt;ignicion&gt;1&lt;/ignicion&gt;&lt;georeferencia&gt;AV Soublette La Guaira - [123]&lt;/georeferencia&gt;&lt;/movil&gt;&lt;/ultimo_punto&gt;</xml_dat></ultimo_puntoResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  const rSoap = leerUltimoPuntoXml(soapOk);
  t(rSoap.error === null && rSoap.filas.length === 1 && rSoap.filas[0].fuente === 'ultimo_punto', 'SOAP ultimo_punto válido');
  const detsSoap = leerDetenciones(rSoap.filas);
  const uSoap = ultimaUbicacion(detsSoap, 'A01FE8M', G.msDeFechaDetektor('2026-11-13 13:50:00'));
  t(uSoap && uSoap.lat === 10.6012 && uSoap.lng === -66.9321 && uSoap.detenida === false && uSoap.velocidad === 35, 'ultimaUbicacion desde SOAP en movimiento');
  t(/35 km\/h/.test(lineasUbicacion(uSoap, G.msDeFechaDetektor('2026-11-13 13:50:00'))[0]), 'lineasUbicacion muestra km/h en SOAP');

  // Parseo SOAP ultimo_punto con error de permisos
  const soapErr = `<SOAP-ENV:Envelope><SOAP-ENV:Body><ultimo_puntoResponse><xml_dat>&lt;ultimo_punto&gt;&lt;movil placa=&apos;A01FE8M&apos;&gt;&lt;estado&gt;ERROR Sin Permisos, por favor cambie su password en la plataforma&lt;/estado&gt;&lt;/movil&gt;&lt;/ultimo_punto&gt;</xml_dat></ultimo_puntoResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  const rErr = leerUltimoPuntoXml(soapErr);
  t(rErr.filas.length === 0 && /Sin Permisos/.test(rErr.error || ''), 'SOAP ultimo_punto detecta estado ERROR');

  // nombreVehiculo siempre incluye placa (incluso cuando equipo.plate es null)
  t(nombreVehiculo({ placaAlias: 'A01FE8M', equipo: { code: 'CAMION VOLTEO TORONTO', plate: null } }) === 'CAMION VOLTEO TORONTO · A01FE8M', 'nombreVehiculo usa placaAlias si equipo.plate es null');

  console.log(`lectura del día y SOAP: ${ok2} ok`);
}
