/*
 * Test de ESCANEAR EL QR DEL CAMION en Viajes de camiones (13-sep-2026).
 *
 * Pedido del cliente: que el listero pueda escribir la placa O escanear el QR,
 * «sin que dañe ni rompa nada»: el QR solo elige el camion mas rapido.
 *
 * Lo que fija, y por que duele si se rompe:
 *   · el QR es un ATAJO al mismo toque de la lista, no una via aparte — si tuviera
 *     su propio camino, cada arreglo del buscador habria que hacerlo dos veces
 *   · una RETIRADA no se selecciona por QR, igual que no sale en el buscador
 *   · el SELLO del serial se respeta — un QR viejo pegado en el camion equivocado
 *     registraria viajes al camion que no es, y esos viajes se cobran
 *   · un camion del catalogo fuera de la lista del listero SI se selecciona, como
 *     ya pasa al buscarlo por escrito
 *
 * Sin framework (el repo no tiene): transpila el .ts en memoria con `typescript`.
 *
 *   node scripts/test-viajes-qr.mjs
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

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const cacheTs = new Map();
function cargar(rel) {
  const p = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (cacheTs.has(p)) return cacheTs.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cacheTs.set(p, m.exports);
  m.require = (spec) => {
    if (spec.startsWith('.')) {
      const base = path.resolve(path.dirname(p), spec);
      for (const cand of [base + '.ts', base + '.tsx']) if (fs.existsSync(cand)) return cargar(cand);
    }
    return require(spec);
  };
  m._compile(js, p);
  cacheTs.set(p, m.exports);
  return m.exports;
}

let pass = 0, fail = 0;
const failures = [];
const ok = (nombre, cond) => { if (cond) { pass++; return; } fail++; failures.push(`✗ ${nombre}`); };
const eq = (nombre, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) { pass++; return; }
  fail++; failures.push(`✗ ${nombre}\n    obtenido: ${JSON.stringify(a)}\n    esperado: ${JSON.stringify(b)}`);
};

const { idDeQrDeMaquina, serialDeQrDeMaquina, resolverCamionDeQr, MENSAJE_QR } = cargar('src/lib/viajesQr.ts');

// Ids inventados con forma de uuid. Ninguno existe en la base.
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const R = 'cccccccc-0000-4000-8000-000000000003';
const url = (id, s) => `https://www.soslaguaira.com/?maquina=${id}${s ? `&s=${encodeURIComponent(s)}` : ''}`;

// ── 1) QUE TRAE EL QR ───────────────────────────────────────────────────────
eq('lee el id de la URL impresa', idDeQrDeMaquina(url(A, 'X0000X0000')), A);
eq('lee el id aunque venga sin sello', idDeQrDeMaquina(url(A)), A);
eq('lee un id suelto', idDeQrDeMaquina(`  ${A}  `), A);
eq('lee el id de un texto que no es URL pero trae maquina=', idDeQrDeMaquina(`maquina=${A}`), A);
eq('un QR de empleado no es una maquina', idDeQrDeMaquina('https://www.soslaguaira.com/?empleado=' + A), null);
eq('un texto cualquiera no es una maquina', idDeQrDeMaquina('hola'), null);
eq('vacio no es nada', idDeQrDeMaquina(''), null);
eq('null no revienta', idDeQrDeMaquina(null), null);

eq('lee el serial sellado', serialDeQrDeMaquina(url(A, 'X0000X0000')), 'X0000X0000');
eq('el serial sellado vuelve decodificado', serialDeQrDeMaquina(url(A, 'X 0/1')), 'X 0/1');
eq('sin sello devuelve null', serialDeQrDeMaquina(url(A)), null);
eq('un id suelto no tiene sello', serialDeQrDeMaquina(A), null);

// ── 2) QUE CAMION ES ────────────────────────────────────────────────────────
const enLista = { id: A, serial: 'X0000X0000', operational: true, code: 'VOLTEO 1' };
const fueraLista = { id: B, serial: 'X1111X1111', operational: true, code: 'EXCAVADORA' };
const retirada = { id: R, serial: null, operational: false, code: 'VOLTEO RETIRADO' };
const catalogo = [enLista, fueraLista, retirada];
const lista = [enLista];

eq('un volteo de la lista se selecciona', resolverCamionDeQr(url(A, 'X0000X0000'), catalogo, lista),
  { ok: true, ficha: enLista, fueraDeLista: false });
// ⭐ Igual que al buscarlo por escrito: el catalogo completo esta disponible.
eq('un camion del catalogo fuera de la lista tambien, y lo avisa',
  resolverCamionDeQr(url(B, 'X1111X1111'), catalogo, lista),
  { ok: true, ficha: fueraLista, fueraDeLista: true });
ok('...y acepta la lista como Set de ids',
  resolverCamionDeQr(url(A, 'X0000X0000'), catalogo, new Set([A])).fueraDeLista === false);

// ⚠️ La RETIRADA no se ofrece: es el mismo criterio del buscador (`!operational`).
eq('una retirada no se selecciona', resolverCamionDeQr(url(R), catalogo, lista), { ok: false, motivo: 'retirada' });
eq('una que no esta en el catalogo tampoco',
  resolverCamionDeQr(url('dddddddd-0000-4000-8000-000000000004'), catalogo, lista), { ok: false, motivo: 'no_en_catalogo' });
eq('un QR que no es de maquina lo dice', resolverCamionDeQr('hola', catalogo, lista), { ok: false, motivo: 'no_es_maquina' });

// ⭐ EL SELLO. Un QR viejo pegado en el camion equivocado registraria viajes al
//    camion que no es, y esos viajes se cobran.
eq('un QR con serial distinto al de la maquina esta VENCIDO',
  resolverCamionDeQr(url(A, 'OTRO123'), catalogo, lista), { ok: false, motivo: 'vencido' });
ok('el serial se compara sin mayusculas ni espacios',
  resolverCamionDeQr(url(A, '  x0000x0000 '), catalogo, lista).ok === true);
ok('un QR viejo SIN sello se acepta, por compatibilidad',
  resolverCamionDeQr(url(A), catalogo, lista).ok === true);
ok('si la maquina hoy no tiene serial, no hay contra que comparar y se acepta',
  resolverCamionDeQr(url(R.replace('cccccccc', 'eeeeeeee'), 'LOQUESEA'),
    [{ id: R.replace('cccccccc', 'eeeeeeee'), serial: null, operational: true }], []).ok === true);
// El orden importa: primero se sabe QUE camion es, despues si esta vencido.
eq('una retirada con sello viejo se reporta como retirada, no como vencida',
  resolverCamionDeQr(url(R, 'VIEJO'), catalogo, lista).motivo, 'retirada');

// Cada motivo tiene su mensaje, y ninguno esta vacio.
for (const k of ['no_es_maquina', 'no_en_catalogo', 'retirada', 'vencido']) {
  ok(`hay mensaje para ${k}`, typeof MENSAJE_QR[k] === 'string' && MENSAJE_QR[k].length > 20);
}
ok('el mensaje de vencido manda a buscar por escrito', /por escrito/.test(MENSAJE_QR.vencido));

// ── 3) GUARDAS SOBRE EL CODIGO ──────────────────────────────────────────────
const lib = leer('src/lib/viajesQr.ts');
ok('la libreria es pura: no importa nada', !/^\s*import\s/m.test(sinComentarios(lib)));

const scr = leer('src/screens/ViajesCamionesScreen.tsx');
const scrSC = sinComentarios(scr);
ok('la pantalla monta el lector de QR que ya usan las otras 15 pantallas',
  /import QrScanner from '\.\.\/components\/QrScanner'/.test(scrSC) && /<QrScanner onDetected=\{onQrDetectado\}/.test(scrSC));
ok('y resuelve el QR con la libreria, no con codigo propio',
  /resolverCamionDeQr\(texto, catalogoTrucks, trucksSeleccionables\)/.test(scrSC));

// ⭐ EL GUARDA MAS IMPORTANTE: el QR termina en el MISMO toque que la lista.
// Se recorta hasta el cierre del handler y no un largo fijo: con 900 caracteres la
// guarda se metia en onSelectTruck, que si usa setSelectedTruck, y fallaba sola.
const iniQr = scrSC.indexOf('const onQrDetectado =');
const cuerpo = iniQr < 0 ? '' : scrSC.slice(iniQr, scrSC.indexOf('\n  };', iniQr) + 5);
ok('el bloque del QR existe', cuerpo.length > 300);
ok('el QR selecciona por el mismo camino que tocar la lista', /onSelectTruck\(r\.ficha\)/.test(cuerpo));
ok('...y no tiene un setSelectedTruck propio', !/setSelectedTruck\(/.test(cuerpo));
ok('un camion fuera de la lista se suma a la lista, como hace el buscador',
  /if \(r\.fueraDeLista\) setExtraTruckIds\(\(prev\) => new Set\(prev\)\.add\(r\.ficha\.id\)\);/.test(cuerpo));
ok('cuando no se puede, se dice por que', /toast\.error\(MENSAJE_QR\[r\.motivo\]\)/.test(cuerpo));
ok('la camara se cierra antes de resolver', cuerpo.indexOf('setScanOpen(false)') < cuerpo.indexOf('resolverCamionDeQr('));

// El boton esta donde el listero lo necesita: al lado de «Buscar camion» y dentro
// del buscador. Y abrir la camara cierra el buscador: dos ventanas encimadas en
// web se pelean por quien queda arriba (ver modales-web-orden-de-montaje).
ok('hay boton de escanear al lado de Buscar camion', /Escanear QR/.test(scr));
ok('...y otro dentro del buscador', /Escanear el QR del cami/.test(scr));
ok('abrir la camara cierra el buscador', /const abrirEscaner = \(\) => \{ setPickOpen\(false\); setScanOpen\(true\); \};/.test(scrSC));
ok('la camara va en su propia ventana', /<Modal visible=\{scanOpen\}/.test(scrSC));

// El buscador por escrito NO cambia.
ok('el buscador por escrito sigue igual', /onPress=\{openPicker\}/.test(scrSC) && /placeholder="Buscar por código, categoría, marca, modelo, placa o serial…"/.test(scr));

// ── 4) EL MANUAL CUENTA LO MISMO ────────────────────────────────────────────
const md = leer('docs/MANUAL-USUARIO.md');
const ms = leer('src/screens/ManualScreen.tsx');
const guia = leer('src/lib/guides/listeroViajesGuide.ts');
ok('el manual .md explica el QR', /Escanear el QR del camión \(13\/09\/2026\)/.test(md));
ok('...y dice que escribir sigue valiendo', /Escribir la placa sigue funcionando igual/.test(md));
ok('...y avisa del QR vencido', /QR está vencido/.test(md));
ok('el manual en pantalla tambien', /ESCANEAR EL QR DEL CAMIÓN \(13\/09\/2026\)/.test(ms));
ok('la guia del listero dice que puede escanear', /escanea el QR/i.test(guia));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-qr · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
