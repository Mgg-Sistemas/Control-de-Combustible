/*
 * LAS CONTRASEÑAS VAN EN MAYÚSCULA — pedido del cliente del 27-ago-2026:
 *
 *   «haz que la contraseña se coloque obligatoriamente en mayúscula, porque
 *    cuando se crea un usuario, la contraseña y el usuario es en mayúscula.
 *    Si se coloca en minúscula que se vuelva mayúscula.»
 *
 * Esto sustituye al parche de la mañana. Aquel hacía que la clave se VIERA tal
 * cual era; este hace que SEA mayúscula. Es mejor: ya no hay dos verdades que
 * mantener sincronizadas, hay una sola.
 *
 * ⚠️⚠️ LO QUE ESTA PRUEBA VIGILA DE VERDAD — Y POR QUÉ:
 *
 *    Las contraseñas se guardan CIFRADAS. Las que ya existen NO se pueden
 *    convertir a mayúscula hacia atrás: nadie puede leerlas para reescribirlas.
 *    Así que el día que entra esta regla conviven dos mundos, y si el login
 *    mandara solo la versión en mayúscula, TODA la gente con una clave vieja que
 *    tenga minúsculas dejaría de poder entrar de golpe, sin haber hecho nada.
 *
 *    Sería el mismo desastre que veníamos arreglando, pero al revés y para
 *    mucha más gente. Por eso el login prueba la mayúscula y, si falla, reintenta
 *    tal cual se tecleó. La sección 3 ejecuta esa lógica de verdad, mundo por
 *    mundo.
 *
 * ⚠️ Y EL REINTENTO NO PUEDE GASTAR UN INTENTO DEL BLOQUEO POR 3 FALLOS. Si lo
 *    gastara, la gente con clave vieja se bloquearía al primer error de tecleo
 *    en vez de al tercero. Hay una guarda para eso (sección 4).
 *
 *   node scripts/test-clave-mayusculas.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0; const malas = [];
const ok = (n, c, extra = '') => { if (c) pass++; else { fail++; malas.push(n + (extra ? `  → ${extra}` : '')); } };

const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// La regla se CARGA y se EJECUTA de verdad: es un .ts puro, sin React ni Supabase.
const fuente = leer('src/lib/password.ts');
const js = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('exports', 'module', js)(mod.exports, mod);
const { claveNormalizada, tieneMinusculas, clavesAProbar } = mod.exports;

const auth = sinComentarios(leer('src/context/AuthContext.tsx'));
const login = sinComentarios(leer('src/screens/redesign/LoginPilot.tsx'));
const users = sinComentarios(leer('src/screens/UsersScreen.tsx'));
const cambiar = sinComentarios(leer('src/components/ChangePasswordButton.tsx'));

console.log('CONTRASEÑAS EN MAYÚSCULA\n');

// ══════════════════════════════════════════════════════════════════════════
// 1) LA REGLA, EJECUTADA
// ══════════════════════════════════════════════════════════════════════════
ok('una clave con minúsculas se vuelve MAYÚSCULA',
  claveNormalizada('Sos2026') === 'SOS2026');
ok('una que ya está en mayúscula no cambia',
  claveNormalizada('SOS2026') === 'SOS2026');
ok('los números y símbolos no se tocan',
  claveNormalizada('sos-2026_#') === 'SOS-2026_#');
ok('los acentos también suben',
  claveNormalizada('camión') === 'CAMIÓN');
ok('normalizar dos veces da lo mismo que una (es idempotente)',
  claveNormalizada(claveNormalizada('Sos2026')) === claveNormalizada('Sos2026'),
  'si no lo fuera, el login y el guardado podrían discrepar');
ok('aguanta vacío y nulo sin reventar',
  claveNormalizada('') === '' && claveNormalizada(undefined) === '');

ok('detecta minúsculas', tieneMinusculas('Sos2026') === true);
ok('y detecta que NO las hay', tieneMinusculas('SOS2026') === false);
ok('un número suelto no cuenta como minúscula', tieneMinusculas('2026') === false);

// ══════════════════════════════════════════════════════════════════════════
// 2) LAS OPCIONES DEL LOGIN
// ══════════════════════════════════════════════════════════════════════════
ok('⭐ si se tecleó con minúsculas, se prueban DOS: mayúscula primero, luego tal cual',
  JSON.stringify(clavesAProbar('Sos2026')) === JSON.stringify(['SOS2026', 'Sos2026']),
  'la mayúscula va primero: es el mundo nuevo y el único de aquí en adelante');

ok('⭐ si ya venía en mayúscula, se prueba UNA sola (no se gasta un viaje de más)',
  JSON.stringify(clavesAProbar('SOS2026')) === JSON.stringify(['SOS2026']));

ok('nunca se devuelven opciones repetidas',
  new Set(clavesAProbar('Sos2026')).size === clavesAProbar('Sos2026').length);

// ══════════════════════════════════════════════════════════════════════════
// 3) ⭐⭐ NADIE SE QUEDA FUERA — los dos mundos, simulados
// ══════════════════════════════════════════════════════════════════════════
// Se simula la base: guarda la clave tal como se le dio, y compara EXACTO (como
// hace un hash de verdad). Después se pregunta quién logra entrar.
const baseDeDatos = {
  // Mundo NUEVO: creadas desde hoy, ya normalizadas al guardar.
  nuevo:  claveNormalizada('Sos2026'),   // → 'SOS2026'
  // Mundo VIEJO: creadas antes, guardadas tal cual se tecleó.
  viejo:  'Sos2026',
  viejoTodoMayus: 'SOS2026',
  viejoTodoMinus: 'sos2026',
};
const entra = (guardada, tecleada) => clavesAProbar(tecleada).some((c) => c === guardada);

const CASOS = [
  // [descripción, clave guardada, lo que teclea la persona, ¿debe entrar?]
  ['NUEVO   · teclea igual (mayúscula)',        baseDeDatos.nuevo, 'SOS2026', true],
  ['NUEVO   · teclea en minúscula',             baseDeDatos.nuevo, 'sos2026', true],
  ['NUEVO   · teclea mezclado',                 baseDeDatos.nuevo, 'Sos2026', true],
  ['⭐ VIEJO · teclea EXACTO como la creó',      baseDeDatos.viejo, 'Sos2026', true],
  ['VIEJO   · guardada toda en mayúscula',      baseDeDatos.viejoTodoMayus, 'sos2026', true],
  ['⭐ VIEJO · guardada toda en minúscula',      baseDeDatos.viejoTodoMinus, 'sos2026', true],
  ['NUEVO   · clave equivocada, NO entra',      baseDeDatos.nuevo, 'otra123', false],
  ['VIEJO   · clave equivocada, NO entra',      baseDeDatos.viejo, 'otra123', false],
];
for (const [nombre, guardada, tecleada, esperado] of CASOS) {
  ok(nombre, entra(guardada, tecleada) === esperado,
    `guardada «${guardada}», tecleada «${tecleada}» → ${entra(guardada, tecleada)}`);
}

// ⚠️ El único caso que NO se puede salvar, y hay que saberlo: una clave vieja
//    guardada en minúscula que la persona teclee en MAYÚSCULA. Tampoco entraba
//    antes de este cambio, así que no se rompe nada nuevo — pero que quede dicho.
ok('caso conocido que sigue sin funcionar (igual que antes): vieja en minúscula tecleada en mayúscula',
  entra(baseDeDatos.viejoTodoMinus, 'SOS2026') === false,
  'si algún día esto cambia, es que alguien tocó la lógica sin querer');

// ══════════════════════════════════════════════════════════════════════════
// 4) ⭐ EL REINTENTO NO GASTA UN INTENTO DEL BLOQUEO
// ══════════════════════════════════════════════════════════════════════════
{
  // ⚠️ LA GUARDA VA POR CONTEO, NO POR PATRÓN. Los dos caminos de login (por
  //    usuario y por cédula) tienen la MISMA línea, así que buscar el patrón
  //    encontraba el del otro y no notaba que uno se había revertido. Con el
  //    conteo no hay escapatoria: `signInWithPassword` solo puede aparecer UNA
  //    vez en todo el archivo, dentro de `intentarEntrar`.
  // Solo LLAMADAS (`signInWithPassword({`), no la anotación de tipo que hay en
  // la propia `intentarEntrar`.
  const directas = (auth.match(/supabase\.auth\.signInWithPassword\(\{/g) ?? []).length;
  ok('⭐ signInWithPassword se llama en UN solo sitio (dentro de intentarEntrar)',
    directas === 1,
    `aparece ${directas} veces; si es más, algún login se salta el puente de las claves viejas`);

  // Los TRES caminos de entrada: por usuario, por cédula y el viejo por nombre.
  // Los tres tienen que pasar por el puente, aunque hoy solo se use el primero:
  // un camino que se lo salte es una trampa esperando a que alguien lo reviva.
  const puentes = (auth.match(/await intentarEntrar\(/g) ?? []).length;
  ok('⭐ los TRES caminos de login pasan por el puente',
    puentes === 3,
    `${puentes} de 3 — por usuario, por cédula y el viejo por nombre`);
}

{
  // El contador de fallos vive FUERA del bucle de reintentos. Si estuviera
  // dentro, cada opción probada contaría como un fallo y la gente con clave
  // vieja se bloquearía al primer error de tecleo.
  const i = auth.indexOf('const intentarEntrar');
  const j = auth.indexOf('const signInWithCedula');
  const cuerpo = auth.slice(i, j > i ? j : i + 1400);
  ok('⭐ dentro del reintento NO se registra ningún fallo',
    !/register_failed_login/.test(cuerpo),
    'contar cada opción bloquearía a la gente al primer error, no al tercero');
  ok('el reintento corta si el error NO es de credenciales',
    /includes\('invalid'\)\) return r;/.test(cuerpo),
    'ante un fallo de red no tiene sentido probar otra clave');
  ok('el reintento recorre las opciones de clavesAProbar',
    /clavesAProbar\(password\)/.test(cuerpo));
}

ok('el bloqueo por 3 fallos sigue existiendo',
  /register_failed_login_username/.test(auth) && /reset_failed_login_username/.test(auth));

// ══════════════════════════════════════════════════════════════════════════
// 5) ⭐ TODOS LOS CAMINOS NORMALIZAN — si uno se olvida, ese usuario no entra
// ══════════════════════════════════════════════════════════════════════════
ok('⭐ LOGIN: el campo pone la clave en mayúscula al teclear',
  /onChangeText=\{\(t\) => setPassword\(claveNormalizada\(t\)\)\}/.test(login));

ok('⭐ CREAR usuario: se envía normalizada',
  /password: claveNormalizada\(password\)/.test(users));

ok('⭐ EDITAR usuario: se envía normalizada, y vacío sigue siendo "no cambiar"',
  /password: password \? claveNormalizada\(password\) : undefined/.test(users),
  'si se normalizara el vacío, editar un nombre borraría la clave');

ok('⭐ CAMBIAR mi contraseña: se normaliza al guardar',
  /claveNormalizada\(p1\.trim\(\)\)/.test(cambiar) && /claveNormalizada\(p2\.trim\(\)\)/.test(cambiar));

for (const [nombre, txt] of [['UsersScreen', users], ['ChangePasswordButton', cambiar], ['LoginPilot', login]]) {
  ok(`${nombre} importa la regla de src/lib/password`,
    /from '\.\.?\/?\.*\/?lib\/password'/.test(txt) || /lib\/password/.test(txt));
}

// La conversión NO puede estar copiada a mano en las pantallas: si estuviera, el
// día que cambie la regla habría que acordarse de cinco sitios.
for (const [nombre, txt] of [['LoginPilot', login], ['UsersScreen', users], ['ChangePasswordButton', cambiar]]) {
  ok(`${nombre} no reimplementa la conversión por su cuenta`,
    !/password\.toUpperCase\(\)|p1\.toUpperCase\(\)/.test(txt),
    'la regla vive en src/lib/password.ts y en ningún otro sitio');
}

// ══════════════════════════════════════════════════════════════════════════
// RESULTADO
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅' : '❌'} test-clave-mayusculas · ${pass} ok · ${fail} fallando`);
if (fail) { console.log(malas.map((m) => '  · ' + m).join('\n')); process.exit(1); }
console.log('Las claves nuevas van en mayúscula, y las viejas siguen entrando.');
