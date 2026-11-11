// 📡 GPS DE LOS VEHÍCULOS (iTrackSafeX, 10-nov-2026). Fija:
//   · cómo se leen los enlaces que copia la app (uno o varios pegados juntos),
//   · cómo se entiende la respuesta de iTrackSafeX (vigente, vencido, sin posición),
//   · que varios se piden de 5 en 5 y NUNCA pasan por Supabase,
//   · que el permiso nace cerrado y la tabla no tiene auditoría ni tiempo real.
// Con GPS_AUTHCODE=<código> además consulta UN enlace real (no se guarda en el repo: es público).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
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

// ── 1) Leer los enlaces tal como los copia la app ──
const A1 = 'feedc0de0000111122223333deadbeef'; // inventado (el repositorio es público)
const A2 = '0123456789abcdef0123456789abcdef';
const pegado = `Click to view Fordterritory track,share duration 1D： http://itracksafe.com/#/tracking?authcode=${A1}&language=es&serverid=0
Click to view Gandola Trakker Iveco track,share duration 1Y： http://itracksafe.com/#/tracking?authcode=${A2.toUpperCase()}&language=es&serverid=0
otra vez el primero: http://itracksafe.com/#/tracking?authcode=${A1}&language=es&serverid=0
y algo que no es enlace de GPS: https://www.google.com/maps?q=1,2`;
const L = G.leerEnlaces(pegado);
eq(L.map((x) => x.authcode), [A1, A2], '⭐ lee VARIOS enlaces pegados juntos (repetidos una vez, lo que no es GPS se ignora, código en minúscula)');
eq(L.map((x) => x.nombre), ['Fordterritory', 'Gandola Trakker Iveco'], '⭐ saca el nombre del vehículo del texto de la app');
eq(L[0].serverid, '0', 'guarda el serverid');
check(L[0].url.startsWith('http://itracksafe.com/#/tracking?authcode='), 'guarda el enlace para abrirlo en iTrackSafeX');
eq(G.leerEnlaces('hola, nada por aquí'), [], 'sin enlaces: lista vacía');
// 🔒 Seguridad: lo pegado no se guarda tal cual, y solo se abren enlaces de itracksafe.com
eq(G.leerEnlaces(`https://evil.example/x?authcode=${A1}`), [], '🔒 un enlace de OTRA página con authcode se ignora');
eq(G.leerEnlaces(`http://itracksafe.com.evil.example/#/tracking?authcode=${A1}`), [], '🔒 tampoco uno que solo se PARECE (itracksafe.com.otro)');
eq(G.leerEnlaces(`http://itracksafe.com/#/tracking?authcode=${A1}&serverid=0"><script>x</script>`)[0].url, `http://itracksafe.com/#/tracking?authcode=${A1}&language=es&serverid=0`, '🔒 el enlace se REARMA con código y servidor (lo pegado no se guarda)');
eq([G.urlSegura('javascript:alert(1)'), G.urlSegura('https://evil.example/'), G.urlSegura('https://web.itracksafe.com/x')], [null, null, 'https://web.itracksafe.com/x'], '🔒 urlSegura: solo http(s) de itracksafe.com');
eq(G.urlParaAbrir({ url: 'javascript:alert(1)', authcode: A1, serverid: '0' }), `http://itracksafe.com/#/tracking?authcode=${A1}&language=es&serverid=0`, '🔒 si lo guardado no es seguro, se abre el rearmado');
eq(G.leerEnlaces(`http://itracksafe.com/#/tracking?authcode=${A1}`)[0].nombre, null, 'un enlace solo (sin texto) también sirve');

// ── 2) Entender la respuesta ──
const AHORA = Date.UTC(2026, 10, 10, 22, 30);
const resp = (extra = {}, rec = {}) => ({
  status: 0, cause: 'OK', deviceid: '6000000001', isvalid: 1, expire: AHORA + 86400000, devicename: 'Fordterritory',
  records: [{ deviceid: '6000000001', callat: 10.5, callon: -66.9, speed: 0, course: 113, moving: 0,
    devicetime: AHORA - 4 * 60000, arrivedtime: AHORA - 4 * 60000, validpoistiontime: AHORA - 4 * 60000,
    strstatusen: 'ACC Off 1D1H35M/Voltage 12.97V', ...rec }],
  ...extra,
});
const r1 = G.leerRespuesta(resp());
check(r1.ok && r1.lat === 10.5 && r1.lng === -66.9 && r1.deviceId === '6000000001' && r1.nombre === 'Fordterritory', '⭐ lee la posición, el equipo y el nombre');
eq(r1.estadoTexto, 'Motor apagado hace 1d 1h 35m · Batería 12,97 V', '⭐ traduce el estado («ACC Off…/Voltage…»)');
eq(G.traducirEstado('ACC On 25M/Voltage 26.13V'), 'Motor encendido hace 25m · Batería 26,13 V', 'motor encendido');
check(r1.ok && !r1.enMarcha && r1.vence === AHORA + 86400000, 'detenido, y trae hasta cuándo vale el enlace');
const r2 = G.leerRespuesta(resp({}, { moving: 1, speed: 47.6 }));
check(r2.ok && r2.enMarcha && r2.velocidad === 47.6, 'en marcha con su velocidad');
const vencido = G.leerRespuesta(resp({ isvalid: 0, records: null }));
check(!vencido.ok && vencido.motivo === 'vencido', '⭐ enlace vencido o cancelado: lo dice (no muestra un punto viejo como si fuera de ahora)');
const sinPos = G.leerRespuesta(resp({}, { callat: 0, callon: 0 }));
check(!sinPos.ok && sinPos.motivo === 'sin_posicion' && sinPos.deviceId === '6000000001', 'sin posición todavía: lo dice, y el equipo se puede guardar igual');
check(!G.leerRespuesta(null).ok && !G.leerRespuesta({ status: 1, cause: 'x' }).ok, 'respuestas raras: nunca revienta');

// ── 3) Frescura, «hace cuánto» y vencimiento ──
eq([G.frescura(AHORA - 5 * 60000, AHORA), G.frescura(AHORA - 45 * 60000, AHORA), G.frescura(AHORA - 3 * 3600000, AHORA), G.frescura(null, AHORA)], ['en_linea', 'reciente', 'viejo', 'viejo'], '⭐ en línea < 30 min, gris > 1 h');
eq([G.haceCuanto(AHORA - 20000, AHORA), G.haceCuanto(AHORA - 7 * 60000, AHORA), G.haceCuanto(AHORA - 130 * 60000, AHORA), G.haceCuanto(AHORA - 27 * 3600000, AHORA)], ['hace menos de 1 min', 'hace 7 min', 'hace 2 h 10 min', 'hace 1 d 3 h'], '«hace cuánto»');
eq([G.diasParaVencer(AHORA + 10.5 * 86400000, AHORA), G.diasParaVencer(new Date(AHORA - 86400000).toISOString(), AHORA), G.diasParaVencer(null, AHORA)], [10, -1, null], 'días para vencer (negativo = vencido)');

// ── 4) De 5 en 5 ──
{
  let enVuelo = 0; let maximo = 0;
  const res = await G.enTandas(Array.from({ length: 30 }, (_, i) => i), 5, async (x) => {
    enVuelo++; maximo = Math.max(maximo, enVuelo);
    await new Promise((r) => setTimeout(r, 5));
    enVuelo--; return x * 2;
  });
  check(maximo === 5, '⭐ 30 vehículos: nunca más de 5 consultas a la vez', { maximo });
  eq(res.slice(0, 4).concat(res.slice(-1)), [0, 2, 4, 6, 58], 'y cada resultado en su lugar');
}

// ── 5) La consulta: a iTrackSafeX directo, con el authcode, y los fallos con mensaje ──
{
  let pedido = null;
  const fake = async (url, init) => { pedido = { url, init }; return { ok: true, status: 200, json: async () => resp() }; };
  const r = await G.consultarPosicion(A1, fake);
  check(r.ok && pedido.url === 'https://web.itracksafe.com/webapi?action=sharetracklastposition' && pedido.init.method === 'POST', '⭐ pregunta DIRECTO a iTrackSafeX (https), no a Supabase');
  eq(JSON.parse(pedido.init.body), { authcode: A1, lastquerypositiontime: 0 }, 'manda solo el código del enlace');
  const caida = await G.consultarPosicion(A1, async () => { throw new TypeError('Failed to fetch'); });
  check(!caida.ok && caida.motivo === 'red' && /conectar/.test(caida.mensaje), 'sin internet: mensaje claro');
  const mal = await G.consultarPosicion(A1, async () => ({ ok: false, status: 502, json: async () => ({}) }));
  check(!mal.ok && /502/.test(mal.mensaje), 'servidor caído: lo dice');
}

// ── 6) Sugerir el vehículo del catálogo ──
{
  const CAT = [
    { id: 'm1', code: 'ET8', plate: 'A12BC3D', marca: 'ENCAVA', modelo: 'ET-8' },
    { id: 'm2', code: 'GANDOLA-01', plate: 'P99XX1', marca: 'IVECO', modelo: 'TRAKKER' },
    { id: 'm3', code: 'EP1000', plate: 'B77AA0', marca: 'ENCAVA', modelo: 'EP-1000' },
    { id: 'm4', code: 'FT01', plate: 'AB123CD', marca: 'FORD', modelo: 'TERRITORY' },
  ];
  eq(G.sugerirEquipo('Gandola Trakker Iveco', CAT)?.id, 'm2', '⭐ «Gandola Trakker Iveco» → la gandola IVECO TRAKKER');
  eq(G.sugerirEquipo('EP-1000 Encava Blanca', CAT)?.id, 'm3', '«EP-1000 Encava Blanca» → la EP1000');
  eq(G.sugerirEquipo('Camion AB123CD', CAT)?.id, 'm4', 'la placa escrita en el nombre manda');
  eq(G.sugerirEquipo('Corolla', CAT), null, 'si no se parece a nada, no inventa');
  eq(G.nombreVehiculo({ nombre: 'Fordterritory', equipo: { code: 'FT01', plate: 'AB123CD' } }), 'FT01 · AB123CD', 'vinculado: sale con el código del catálogo');
  eq(G.nombreVehiculo({ nombre: 'Fordterritory', equipo: null }), 'Fordterritory', 'sin vincular: con el nombre del GPS');
}

// ── 7) Cableado: permiso cerrado, una fila por equipo, nada en segundo plano ──
{
  const perm = leer('src/lib/permissions.ts');
  check(/\{ key: 'gps', label:/.test(perm) && /moduleKey === 'gps'\) return 'none'/.test(perm), '⭐ el permiso «GPS» existe y nace CERRADO');
  const db = leer('src/lib/gpsDb.ts');
  check(/upsert\(rows, \{ onConflict: 'device_id' \}\)/.test(db), '⭐ una fila por equipo GPS: renovar reemplaza el código, no duplica ni borra');
  check(/\.length !== rows\.length/.test(db) && /no dejó/.test(db), 'si la base no dejó guardar, lo dice (la RLS rechaza sin error)');
  const scr = leer('src/screens/GpsScreen.tsx');
  check(!/supabase\./.test(scr) && !/from\('gps_enlaces'\)/.test(scr), 'la pantalla no habla con Supabase directo (todo por gpsDb)');
  check(/consultarPosicion\(e\.authcode\)/.test(scr) && /enTandas\(lista, GPS_TANDA/.test(scr), '⭐ «Actualizar»: directo a iTrackSafeX, de 5 en 5');
  const intervalos = scr.match(/setInterval\([^;]+;/g) || [];
  check(intervalos.length === 1 && /setAhora\(Date\.now\(\)\)/.test(intervalos[0]) && !/consultar/.test(intervalos[0]), '⭐ NADA se actualiza solo: el único temporizador reescribe «hace X min»');
  check(!/useRealtime|channel\(/.test(scr + db), 'sin tiempo real');
  check(/moduleLevel\('gps'\)/.test(scr) && /levelMeets\(nivel, 'escritura'\)/.test(scr), 'ver con el permiso; cargar/quitar con escritura');
  const nav = leer('src/navigation/index.tsx');
  const more = leer('src/screens/MoreScreen.tsx');
  check(/name="Gps" component=\{GpsScreen\}/.test(nav) && /Gps: 'gps'/.test(nav) && /route: 'Gps'.*module: 'gps'/.test(more), 'en «Más» → «GPS de los vehículos»');
  const mapa = leer('src/components/GpsMap.tsx');
  check(/integrity="sha256-/.test(mapa), 'el mapa carga Leaflet con su huella (integrity)');
  check(/sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox'/.test(mapa) && !/allow-same-origin/.test(mapa) && /urlSegura\(p\.url\)/.test(mapa), '🔒 el mapa va aislado de la app y solo enlaza a itracksafe.com');
  check(/Linking\.openURL\(urlParaAbrir\(e\)\)/.test(scr) && !/e\.url \|\|/.test(scr), '🔒 «Abrir en iTrackSafeX» solo abre enlaces seguros');
  const man = leer('src/screens/ManualScreen.tsx');
  check(/GPS DE LOS VEHÍCULOS/.test(man), 'el manual lo explica');
}

// ── 8) (Opcional) un enlace REAL ──
if (process.env.GPS_AUTHCODE) {
  const r = await G.consultarPosicion(process.env.GPS_AUTHCODE.trim().toLowerCase());
  check(r.ok || r.motivo === 'vencido', '🌐 enlace real: iTrackSafeX respondió', r.ok ? undefined : r);
  if (r.ok) console.log(`   🌐 ${r.nombre} · equipo ${r.deviceId} · ${G.haceCuanto(r.reporte, Date.now())} · ${r.enMarcha ? 'en marcha' : 'detenido'} · ${r.estadoTexto ?? ''} · vence ${new Date(r.vence).toLocaleString('es-VE')}`);
  else console.log(`   🌐 ${r.mensaje}`);
}

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-gps: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-gps: ${ok} ok, 0 fallas`);
