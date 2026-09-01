/*
 * EN VIAJES DE CAMIONES, EL ESTADO DEL CAMION NO BLOQUEA (31-ago-2026).
 *
 * Pedido del cliente, textual: «para y solo para el modulo de viajes de
 * camiones, no importa el estado del camion si esta averiado o algo por el
 * estilo, si colocan que se hizo un viaje, lo registre».
 *
 * Por que esto necesita una prueba y no basta con el comentario en el codigo:
 * el 18-ago-2026 el cliente habia pedido lo CONTRARIO (que no le salieran a los
 * listeros las retiradas ni las que estan en espera). Un cambio asi se revierte
 * solo, sin mala intencion, en cuanto alguien lea el comentario viejo en otro
 * archivo y "arregle" la lista. Esto lo agarra.
 *
 * La regla de fondo: un viaje es un HECHO OBSERVADO (el listero vio entrar el
 * camion); el estado es una ANOTACION de otro modulo, que puede estar vieja o
 * mal puesta. Cuando se contradicen, gana lo que se vio.
 *
 * Y lo que NO puede pasar: que registrar un viaje contra un camion averiado le
 * cambie el estado a la maquina. Este modulo solo escribe en `camion_viajes`.
 *
 *   node scripts/test-viajes-estado-no-bloquea.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) pass++; else { fail++; failures.push(`✗ ${name}`); }
};
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; failures.push(`✗ ${name}\n    esperado: ${w}\n    obtenido: ${g}`); }
};

const PANTALLA = path.join(ROOT, 'src/screens/ViajesCamionesScreen.tsx');
const src = fs.readFileSync(PANTALLA, 'utf8');
// Sin comentarios: el archivo EXPLICA la regla en prosa, asi que buscar el
// texto pelado daria positivo por el comentario y no por el codigo.
const codigo = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// -- 1) AVERIADA / PARADA / EN ESPERA SI SALEN. RETIRADA NO. -----------------
// El filtro viejo era `allTrucks.filter((t) => t.operational && !t.enEspera)`:
// sacaba las retiradas Y las que esperan instrucciones. Se quito entero el
// 31-ago-2026 y, el mismo dia, hubo que devolver LA MITAD: la lista del listero
// paso de 61 a 89 camiones y los 28 nuevos eran RETIRADOS -- con motivos como
// "Fin de contrato" o "reemplazo por A74AB3P". El cliente lo reporto como "se
// estan registrando maquinas que no estan", y tenia razon literalmente.
//
// LA REGLA QUE QUEDO, y es la que fija esta prueba:
//   · AVERIADA / PARADA / EN ESPERA -> SI se pueden escoger. Son anotaciones de
//     otro modulo que pueden estar viejas o mal puestas, y contra un viaje que
//     el listero VIO, gana lo que se vio.
//   · RETIRADA -> NO. No es una anotacion dudosa: es un hecho administrativo,
//     el camion se fue de la obra. No hay viaje observado que lo contradiga.
//     Si de verdad hubo uno, lo carga la jefa desde "Cargar viajes a mano".
ok('* las EN ESPERA ya no se filtran', !/allTrucks\.filter\([^)]*enEspera/.test(codigo));
ok('* la lista saca las RETIRADAS', /allTrucks\.filter\(\(t\) => !estaRetirada\(t\)\)/.test(codigo));
ok('* y retirada se define por operational, no por active',
  /const estaRetirada = \(t: TruckRow\) => !t\.operational;/.test(codigo));
ok('* las agregadas a mano usan el MISMO criterio (o quedaria un fantasma por un lado)',
  /extraTruckIds\.has\(t\.id\)[^;]*!estaRetirada\(t\)/.test(codigo));
// El segundo grupo del buscador ("si esta en el catalogo pero no en tu lista")
// tiene que filtrar igual, o una retirada entra por la puerta de atras.
{
  const extras = codigo.slice(codigo.indexOf('const pickExtras'), codigo.indexOf('const [selectedTruck'));
  ok('* y el segundo grupo del buscador tambien', extras.includes('!estaRetirada(t)'));
}

// -- 2) REGISTRAR NO PREGUNTA POR EL ESTADO ----------------------------------
// Habia un `if (ESTADO_ADVERSO.includes(estadoConteo)) { ... confirm ... }`
// justo antes de armar el viaje.
ok('* registrar un viaje ya no pide confirmacion por el estado',
  !/ESTADO_ADVERSO\.includes\(estadoConteo\)/.test(codigo));
{
  // Guardia por CONTEO, no por texto: que no quede NINGUN confirm dentro del
  // camino de registro que mencione el estado del camion.
  const menciones = (codigo.match(/figura \$\{meta\.label/g) || []).length;
  eq('* no queda ningun aviso de "este camion figura AVERIADA"', menciones, 0);
}

// -- 2-bis) EL CHOFER NO PUEDE FRENAR NI VACIAR EL REGISTRO ------------------
// Dos caminos distintos, los dos confirmados el 31-ago-2026:
//   (a) `resolveChoferActual` iba con await pelado ANTES del chequeo de senal:
//       con wifi sin internet se colgaba y, si el listero cerraba la app, el
//       viaje NO se habia encolado todavia -- se perdia entero;
//   (b) el boton de registrar no miraba `choferLoading`, asi que un toque
//       rapido guardaba el viaje con el chofer VACIO y la pantalla despues
//       pintaba el nombre como si hubiera salido bien.
ok('* la consulta del chofer tiene tope de tiempo', /Promise\.race\(\[[\s\S]{0,200}resolveChoferActual/.test(codigo));
ok('* y al vencerse se sigue con el chofer que ya se tenia',
  /setTimeout\(\(\) => r\(selectedChofer\)/.test(codigo));
ok('* no se puede registrar mientras carga el chofer',
  codigo.includes('disabled={registering || choferLoading}'));

// -- 3) PERO EL ESTADO SE SIGUE VIENDO Y SE SIGUE GUARDANDO ------------------
// Quitar el bloqueo NO es esconder el dato: la jefa tiene que poder revisar
// despues cuales viajes se registraron contra un camion averiado.
ok('el estado se sigue calculando para cada camion', codigo.includes('truckEstadoConteo('));
ok('* y se sigue congelando en el viaje', codigo.includes('estadoMaquina: estadoConteo'));
ok('* el chip de estado sigue en el buscador', codigo.includes('ESTADO_CONTEO_META[truckEstadoConteo(t)]'));

// -- 4) LA ALERTA DE "CAMION SIN VIAJES" SI SIGUE EXCLUYENDOLOS --------------
// Es otro uso, y es el correcto: reclamarle a la jefa que una maquina RETIRADA
// no viajo es ruido. Si alguien borra ESTADO_ADVERSO entero, esto lo agarra.
ok('* la alerta sigue sin reclamar por camiones averiados/retirados',
  /!ESTADO_ADVERSO\.includes\(truckEstadoConteo\(t\)\)/.test(codigo));

// -- 5) ESTE MODULO NO LE TOCA EL ESTADO A NINGUNA MAQUINA -------------------
// Lo mas importante de todo. Registrar un viaje contra un camion averiado NO lo
// puede poner operativo: hay 29 archivos que leen ese estado, y hay dinero
// colgando de el (las jornadas de 12h que reparte el cron de la noche).
{
  const escrituras = codigo.match(/from\('machinery'\)\s*\.update\(([^)]*)\)/g) || [];
  // La UNICA escritura permitida sobre `machinery` en esta pantalla es la meta
  // de viajes diarios, que es un dato de este modulo y de nadie mas.
  const prohibidas = escrituras.filter((e) => !e.includes('meta_viajes_diarios'));
  eq('* la pantalla no escribe nada en machinery salvo la meta de viajes', prohibidas, []);
  ok('* y no toca operational', !/update\([^)]*operational/.test(codigo));
  ok('* ni en_espera', !/update\([^)]*en_espera/.test(codigo));
}
{
  const lib = fs.readFileSync(path.join(ROOT, 'src/lib/camionViajes.ts'), 'utf8');
  const libCodigo = lib.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const escrituras = libCodigo.match(/from\('machinery'\)\s*\.update\(([^)]*)\)/g) || [];
  const prohibidas = escrituras.filter((e) => !e.includes('meta_viajes_diarios'));
  eq('* la capa de datos tampoco toca la maquina', prohibidas, []);
  ok('* y no escribe en maintenance_requests (las averias son de otro modulo)',
    !/from\('maintenance_requests'\)[\s\S]{0,80}\.(update|insert|delete)\(/.test(libCodigo));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} test-viajes-estado-no-bloquea · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
