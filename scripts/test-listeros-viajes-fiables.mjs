/*
 * LOS VIAJES QUE NO SE REGISTRAN, Y LAS MAQUINAS QUE NO ESTAN (31-ago-2026).
 *
 * Pedido del cliente: «revisa bien lo de los listeros, de viajes por camiones,
 * que este andando bien... porque me estan diciendo que se estan registrando
 * maquinas que no estan, y que tambien faltan viajes o que no se registran».
 *
 * Contra la base de datos quedó probado que los reportes CUADRAN viaje por
 * viaje: los que faltan nunca entraron. Y las noches del 29 y 30 de agosto
 * tienen 1040 y 911 horas de operacion, o sea que se trabajo y no se anoto.
 * Esta suite fija los caminos del codigo por los que un viaje real se perdia
 * antes de llegar a la base, y los sitios donde se mostraban camiones que ya
 * no estan en la obra.
 *
 * Lo que fija, y por que cada uno importa:
 *
 *  1. EL BUSCADOR NO SE VACIA CON CADA VIAJE DE LA FLOTA. Era, casi seguro, la
 *     causa principal. El realtime lo dispara el INSERT de CUALQUIER listero:
 *     en hora pico la lista de camiones se desmontaba cada pocos segundos, el
 *     listero tocaba un camion a mitad del refresco y NO PASABA NADA. Sin
 *     error que reportar y sin viaje.
 *  2. NINGUNA CONSULTA SIN TOPE DE TIEMPO. El cliente de Supabase no trae
 *     timeout: con el wifi del patio (senal sin internet) el fetch se cuelga y
 *     el boton de Registrar se queda gris el resto de la sesion.
 *  3. LO QUE NO ES CULPA DEL VIAJE NO LO MANDA A CUARENTENA. Una sesion
 *     vencida apartaba la cola ENTERA en minuto y medio.
 *  4. UNA COLA ILEGIBLE NO SE MULTIPLICA NI SE BORRA SOLA.
 *  5. LAS RETIRADAS TAMPOCO SALEN EN LOS PANELES DE LA JEFA NI PASAN LISTA.
 *
 *   node scripts/test-listeros-viajes-fiables.mjs
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

const cache = new Map();
const compilar = (p) => {
  if (cache.has(p)) return cache.get(p);
  const js = ts.transpileModule(fs.readFileSync(p, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const m = new Module(p);
  m.filename = p;
  m.paths = Module._nodeModulePaths(path.dirname(p));
  cache.set(p, m.exports);
  m._compile(js, m.filename);
  cache.set(p, m.exports);
  return m.exports;
};
const realLoad = Module._load;
Module._load = function (req, parent) {
  if (req.startsWith('.') && parent && String(parent.filename || '').endsWith('.ts')) {
    const cand = path.resolve(path.dirname(parent.filename), req);
    for (const p of [cand, cand + '.ts', path.join(cand, 'index.ts')]) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return compilar(p);
    }
  }
  return realLoad.apply(this, arguments);
};

const { esErrorTransitorio, esErrorDeRed, decidirAccionCola, MAX_INTENTOS_COLA } =
  compilar(path.join(ROOT, 'src/lib/colaOfflinePolicy.ts'));
const { claveCamion } = compilar(path.join(ROOT, 'src/lib/viajesResumen.ts'));

let pass = 0, fail = 0;
const failures = [];
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const sinComentarios = (txt) =>
  txt.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const pantalla = sinComentarios(fs.readFileSync(path.join(ROOT, 'src/screens/ViajesCamionesScreen.tsx'), 'utf8'));
const asistencia = sinComentarios(fs.readFileSync(path.join(ROOT, 'src/screens/AsistenciaCamionesScreen.tsx'), 'utf8'));
const cola = sinComentarios(fs.readFileSync(path.join(ROOT, 'src/lib/viajesOfflineQueue.ts'), 'utf8'));

// Sin esto, un archivo renombrado dejaria TODAS las guardias de abajo pasando
// por casualidad: buscar en un texto vacio nunca encuentra nada malo.
ok('las tres fuentes se leyeron', pantalla.length > 40000 && asistencia.length > 5000 && cola.length > 8000);

// ── 1) QUE NO ES CULPA DEL VIAJE ────────────────────────────────────────────
// El caso que se comia la cola entera: la app parada en la pantalla de entrar.
ok('la sesion vencida es transitoria (JWT)', esErrorTransitorio('JWT expired'));
ok('* y el rechazo de RLS tambien', esErrorTransitorio('new row violates row-level security policy for table "camion_viajes"'));
ok('* el timeout del servidor', esErrorTransitorio('canceling statement due to statement timeout'));
ok('* el 502 del portal cautivo', esErrorTransitorio('502 Bad Gateway'));
ok('* y el 503', esErrorTransitorio('Service Unavailable'));
ok('* el mensaje de Firefox de Android', esErrorTransitorio('NetworkError when attempting to fetch resource.'));
ok('* y el de WebKit', esErrorTransitorio('The Internet connection appears to be offline.'));
ok('* el fetch abortado', esErrorTransitorio('AbortError: The operation was aborted'));
ok('* los cuatro de siempre siguen contando', ['Failed to fetch', 'Network request failed', 'fetch failed', 'Load failed'].every(esErrorTransitorio));

// Y lo que SI es culpa del dato tiene que seguir apartandose: si todo fuera
// transitorio, un viaje roto se reintentaria para siempre y taparia el problema.
ok('un camion borrado NO es transitorio', !esErrorTransitorio('insert or update on table "camion_viajes" violates foreign key constraint "camion_viajes_machinery_id_fkey"'));
ok('* ni un CHECK incumplido', !esErrorTransitorio('new row for relation "camion_viajes" violates check constraint "cv_fuera_catalogo_coherente"'));
ok('* ni una columna que no existe', !esErrorTransitorio('column "chofer" of relation "camion_viajes" does not exist'));
ok('sin mensaje no es transitorio', !esErrorTransitorio(null) && !esErrorTransitorio(''));

// LA TRAMPA: un codigo de camion con numeros no puede leerse como un error 500.
ok('"CAMION VOLTEO 500" no es un error de servidor', !esErrorTransitorio('duplicate row for CAMION VOLTEO 500'));
ok('* ni "503" suelto en un serial', !esErrorTransitorio('serial 503 ya registrado'));

// `esErrorDeRed` sigue existiendo y es un subconjunto: lo usa `motivoLegible`.
ok('todo error de red es transitorio', ['Failed to fetch', 'NetworkError', 'ECONNRESET'].every((m) => !esErrorDeRed(m) || esErrorTransitorio(m)));
ok('pero no al reves: el JWT no es "de red"', esErrorTransitorio('JWT expired') && !esErrorDeRed('JWT expired'));

// ── 2) LA DECISION DE LA COLA ───────────────────────────────────────────────
eq('sin error, exito', decidirAccionCola({ error: null, intentos: 0 }), 'exito');
eq('duplicado = ya estaba arriba', decidirAccionCola({ error: 'duplicate key value violates unique constraint', intentos: 5 }), 'exito');
eq('* el 23505 igual', decidirAccionCola({ error: 'error 23505', intentos: 99 }), 'exito');
// EL ARREGLO: por muchos intentos que lleve, una sesion vencida NO aparta el viaje.
eq('la sesion vencida NUNCA aparta el viaje', decidirAccionCola({ error: 'JWT expired', intentos: 99 }), 'reintentar');
eq('* ni el rechazo de RLS', decidirAccionCola({ error: 'violates row-level security policy', intentos: 99 }), 'reintentar');
eq('* ni el 502', decidirAccionCola({ error: '502 Bad Gateway', intentos: 99 }), 'reintentar');
eq('* ni quedarse sin senal', decidirAccionCola({ error: 'Failed to fetch', intentos: 99 }), 'reintentar');
// Y lo que si es del dato se sigue apartando, o la cola se atasca para siempre.
eq('un error de datos aguanta y despues se aparta', decidirAccionCola({ error: 'violates foreign key constraint', intentos: MAX_INTENTOS_COLA - 2 }), 'reintentar');
eq('* al llegar al tope, cuarentena', decidirAccionCola({ error: 'violates foreign key constraint', intentos: MAX_INTENTOS_COLA - 1 }), 'cuarentena');

// El vaciado tiene que contar los intentos con la MISMA regla que decide.
ok('el vaciado usa esErrorTransitorio, no esErrorDeRed', /const ajeno = esErrorTransitorio\(error\)/.test(cola));
ok('* y ya no importa esErrorDeRed en la cola', !/esErrorDeRed/.test(cola));

// ── 3) UNA COLA ILEGIBLE NO SE BORRA NI SE MULTIPLICA ───────────────────────
// Lo que parseaba pero no era una lista ("null", "{}", "0") vaciaba la cola en
// silencio: sin copia, sin banner rojo, y el siguiente writeAll pisaba el disco.
ok('lo que no es una lista va por el camino del JSON roto', /if \(!Array\.isArray\(parsed\)\) throw/.test(cola));
ok('* y ya no hay un ": []" que se lo trague', !/Array\.isArray\(parsed\) \? \(parsed as QueuedViaje\[\]\) : \[\]/.test(cola));
// La copia de rescate llevaba Date.now(): una copia NUEVA en cada lectura
// fallida, ~4 por minuto, hasta llenar los 5 MB del navegador.
ok('la copia de rescate tiene clave FIJA', /const CORRUPTO_KEY = '[^']+'/.test(cola));
ok('* ya no lleva la hora en la clave', !/_corrupto_\$\{Date\.now\(\)\}/.test(cola));
ok('* y se guarda UNA sola vez', /const yaGuardado = await AsyncStorage\.getItem\(CORRUPTO_KEY\)/.test(cola));
ok('* sin borrar la cola buena (se cura sola al proximo guardado)', !/removeItem\(STORAGE_KEY\)/.test(cola));

// ── 4) EL BUSCADOR NO SE VACIA ──────────────────────────────────────────────
{
  const i = pantalla.indexOf('const loadTrucks');
  const cuerpo = i >= 0 ? pantalla.slice(i, i + 900) : '';
  ok('loadTrucks existe', cuerpo.length > 100);
  ok('* NO se pone en blanco si ya hay camiones', /setTrucksLoading\(\(prev\) => prev \|\| allTrucks\.length === 0\)/.test(cuerpo));
  ok('* y ya no hay un setTrucksLoading(true) pelado', !/setTrucksLoading\(true\)/.test(cuerpo));
}
// Es la MISMA regla que ya protegia la lista de "mis viajes": si una la tiene y
// la otra no, vuelve a pasar lo mismo en la otra mitad de la pantalla.
ok('mis viajes conserva su misma proteccion', /setMisViajesLoading\(\(prev\) => prev \|\| misViajes\.length === 0\)/.test(pantalla));

// ── 5) NINGUNA CONSULTA SIN TOPE DE TIEMPO ──────────────────────────────────
{
  const i = pantalla.indexOf('const onSelectTruck');
  const cuerpo = i >= 0 ? pantalla.slice(i, pantalla.indexOf('};', i) + 2) : '';
  ok('onSelectTruck existe', cuerpo.length > 100);
  ok('* la consulta del chofer tiene tope', /Promise\.race\(/.test(cuerpo));
  ok('* y ya no va con un await pelado', !/const chofer = await resolveChoferActual/.test(cuerpo));
  // La respuesta vieja no puede pisar al camion de ahora ni soltar el boton.
  ok('* una respuesta que llega tarde se descarta', /pedido !== choferPedidoRef\.current/.test(cuerpo));
}
// El registro ya tenia su tope desde antes: que no se pierda.
ok('registrar tambien conserva su tope de 4 segundos', /resolveChoferActual\(selectedTruck\.id, shift\),\s*new Promise/.test(pantalla));
// Y el "deslizar para refrescar" no puede quedarse girando.
{
  const i = pantalla.indexOf('const onRefresh');
  const cuerpo = i >= 0 ? pantalla.slice(i, i + 500) : '';
  ok('onRefresh existe', cuerpo.length > 50);
  ok('* apaga el giro pase lo que pase', /finally \{/.test(cuerpo) && /setRefreshing\(false\)/.test(cuerpo));
}

// ── 6) VACIAR LA COLA NO NECESITA PERMISO DE ESCRITURA ──────────────────────
{
  const i = pantalla.indexOf('const unsub = subscribeViajesQueue');
  const efecto = i >= 0 ? pantalla.slice(Math.max(0, i - 500), i + 1200) : '';
  ok('el efecto de la cola existe', efecto.includes('flushViajesQueue'));
  ok('* ya no se corta por !canWrite', !/if \(!canWrite\) return;/.test(efecto));
}

// ── 7) LAS MAQUINAS QUE NO ESTAN ────────────────────────────────────────────
// La flota de la jefa: los camiones menos las retiradas.
ok('existe la lista de los que estan en la obra', /const camionesEnObra = useMemo\(\(\) => allTrucks\.filter\(\(t\) => !estaRetirada\(t\)\)/.test(pantalla));
ok('* la meta diaria se pide para esos', /getMetasPorCamion\(camionesEnObra\.map/.test(pantalla));
ok('* el panel de metas lista esos', /\{camionesEnObra\.map\(\(t\) => \(/.test(pantalla));
ok('* y el resumen por camion arranca de esos', /new Set<string>\(\[\.\.\.camionesEnObra\.map/.test(pantalla));
// PERO los viajes viejos de un camion retirado NO pueden desaparecer.
ok('* sumando los que tengan viajes en el rango', /resumenRows\.map\(\(r\) => claveCamion\(r\)\)\]\)/.test(pantalla));
// La lista del listero: la regla que ya estaba, que no se caiga.
ok('el listero sigue sin ver las retiradas', /const base = allTrucks\.filter\(\(t\) => !estaRetirada\(t\)\)/.test(pantalla));
// Y la jefa SI puede cargarle un dia viejo a un camion ya retirado.
ok('la carga manual de la jefa no filtra por estado', /const camiones = allTrucks\.filter\(coincide\)/.test(pantalla));

// Pasar lista: la misma regla, en el modulo hermano.
ok('asistencia pide solo las activas', /\(q: any\) => q\.eq\('active', true\)/.test(asistencia));
ok('* y descarta las retiradas', /m\.operational !== false/.test(asistencia));
ok('* con selectAllRows, que no se corta en 1000 filas', /selectAllRows\(\s*'machinery'/.test(asistencia));
ok('* ya no queda el .select() pelado de machinery', !/from\('machinery'\)\s*\.select/.test(asistencia));
ok('* y si la consulta falla, lo dice en vez de mostrar la lista vacia', /catch \(e: any\) \{[\s\S]{0,300}setNotice\(/.test(asistencia));

// El panel de la jefa tiene que poder nombrar los camiones que el listero
// agrego a su lista: se resolvian contra `allTrucks` y salian sin placa y como
// "Sin empresa" en el resumen, en los filtros y en el PDF.
ok('los camiones se resuelven contra el catalogo completo', /const truckById = useMemo\(\(\) => new Map\(catalogoTrucks\.map/.test(pantalla));

// ── 8) DOS ESPACIOS NO SON DOS CAMIONES ─────────────────────────────────────
const fuera = (code) => ({ machineryId: null, machineCode: code });
eq('mayusculas y minusculas, el mismo', claveCamion(fuera('volteo 88')), claveCamion(fuera('VOLTEO 88')));
eq('* espacios en las puntas, el mismo', claveCamion(fuera('  VOLTEO 88  ')), claveCamion(fuera('VOLTEO 88')));
eq('* espacios de ADENTRO, el mismo', claveCamion(fuera('VOLTEO  88')), claveCamion(fuera('VOLTEO 88')));
eq('* un tabulador tambien', claveCamion(fuera('VOLTEO\t88')), claveCamion(fuera('VOLTEO 88')));
eq('* y las tildes', claveCamion(fuera('CAMIÓN 5')), claveCamion(fuera('CAMION 5')));
// La ñ NO es una tilde: es otra letra y separa dos camiones distintos.
ok('la ñ se respeta', claveCamion(fuera('PEÑA 1')) !== claveCamion(fuera('PENA 1')));
eq('* y no distingue su caja', claveCamion(fuera('peña 1')), claveCamion(fuera('PEÑA 1')));
// Camiones DISTINTOS siguen siendo distintos.
ok('dos codigos distintos no se funden', claveCamion(fuera('VOLTEO 88')) !== claveCamion(fuera('VOLTEO 89')));
// Y el que SI tiene ficha se agrupa por su id, no por el texto.
eq('el del catalogo manda por id', claveCamion({ machineryId: 'abc', machineCode: 'lo que sea' }), 'abc');

// ── 9) LA PUERTA DE ATRAS DE "FUERA DE CATALOGO" ────────────────────────────
// El boton de anotar un camion a mano sale JUSTO debajo del "Sin coincidencias"
// y con el texto que el listero acaba de escribir ya puesto. O sea: busca un
// camion retirado, no sale, y a dos toques lo reinventa a mano — sin ficha, sin
// placa y sin empresa, que es PEOR que verlo en la lista.
{
  const i = pantalla.indexOf('const confirmarFueraCatalogo');
  const cuerpo = i >= 0 ? pantalla.slice(i, i + 2600) : '';
  ok('confirmarFueraCatalogo existe', cuerpo.length > 200);
  ok('* mira el catalogo antes de inventar un camion', /const yaExiste = catalogoTrucks\.filter/.test(cuerpo));
  ok('* compara por codigo, placa y serial', /\[t\.code, t\.plate, t\.serial\]/.test(cuerpo));
  ok('* sin distinguir mayusculas ni acentos', /norm\(String\(f\)\) === norm\(code\)/.test(cuerpo));
  ok('* distingue el que SI esta en la lista del que esta retirado', /trucksSeleccionables\.some/.test(cuerpo));
  // NO se bloquea: la regla del modulo es que si el listero vio el viaje, entra.
  ok('* avisa, no bloquea', /confirmText: 'Anotarlo a mano igual'/.test(cuerpo));
  ok('* y si se arrepiente, vuelve al buscador', /setPickOpen\(true\); return;/.test(cuerpo));
  // El aviso tiene que decir la placa, o no sirve de nada: media flota se llama
  // igual y "ese camion ya existe" sin placa no le dice a nadie cual es.
  ok('* el aviso dice la placa', /\$\{t\.code\} · \$\{placa\}/.test(cuerpo));
}

// ── 10) LA COLA SE VACIA AUNQUE LA PANTALLA ESTE CERRADA ────────────────────
// Vivia dentro de un useEffect de la pantalla de Viajes, con clearInterval al
// desmontar: si esa pantalla no estaba abierta, la cola NO se vaciaba. Ni al
// arrancar la app ni al recuperar la senal.
{
  const ruta = path.join(ROOT, 'src/components/SincronizadorColas.tsx');
  ok('existe el sincronizador de la raiz', fs.existsSync(ruta));
  const sinc = sinComentarios(fs.readFileSync(ruta, 'utf8'));
  ok('* vacia la cola de viajes', /flushViajesQueue\(\)/.test(sinc));
  ok('* al arrancar, al volver la senal y cada tanto', /onConnectivityChange\(/.test(sinc) && /setInterval\(/.test(sinc));
  // Sin sesion el servidor rechaza todo por RLS: no vale la pena gastar bateria.
  ok('* no intenta sin sesion', /if \(!uid\) return;/.test(sinc));
  // Un rechazo sin atrapar en la raiz de la app tumba la app entera.
  ok('* nunca deja un rechazo suelto', /\.catch\(\(\) => \{\}\)/.test(sinc));
  // Y tiene que soltar el temporizador y la suscripcion al desmontarse.
  ok('* limpia lo que dejo montado', /clearInterval\(timer\)/.test(sinc) && /unsub\(\)/.test(sinc));
  ok('* no pinta nada', /return null;/.test(sinc));

  const app = sinComentarios(fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8'));
  ok('esta montado en la raiz', /<SincronizadorColas \/>/.test(app));
  // DENTRO del AuthProvider: si no, no puede leer la sesion y revienta.
  const iAuth = app.indexOf('<AuthProvider>');
  const iSinc = app.indexOf('<SincronizadorColas />');
  const iFin = app.indexOf('</AuthProvider>');
  ok('* dentro del AuthProvider', iAuth >= 0 && iSinc > iAuth && iFin > iSinc);
}
// Y el de la pantalla sigue estando: ademas refresca "mis viajes" al subir algo.
ok('la pantalla conserva su propio vaciado', /const poll = setInterval\(tryFlush, 30000\)/.test(pantalla));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-listeros-viajes-fiables · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
