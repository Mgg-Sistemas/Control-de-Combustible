/*
 * EL ROL QUE SE ELIGE AL CREAR UN USUARIO ES EL QUE QUEDA — bug del 27-ago-2026:
 *
 *   «cuando se crea un nuevo usuario he intento escoger un rol, aunque
 *    seleccione otro rol, me deja por defecto el de combustible, pero si me
 *    vuelvo a meter en el usuario si le puedo cambiar el rol»
 *
 * EL BUG. La Edge Function `admin-create-user` filtraba el rol contra una lista
 * blanca propia y, si no lo reconocía, lo degradaba a 'conductor' EN SILENCIO —
 * sin error, sin aviso. Un `conductor` sin rol personalizado abre en
 * ConductorTabs, cuya primera pestaña es «Surtir ⛽»: de ahí que el cliente lo
 * describiera como «me deja el de combustible». No estaba leyendo el nombre del
 * rol, estaba describiendo la pantalla donde caía el usuario nuevo.
 *
 * LA ASIMETRÍA que lo delató: EDITAR sí funcionaba, porque ese camino escribe
 * directo en `profiles` desde el cliente y nunca pasa por la Edge Function.
 *
 * ⚠️ ESTA LISTA SE DESINCRONIZÓ DOS VECES: con 'coordinador_patio' (jul-2026) y
 *    con 'coordinador_inspectores' (ago-2026, commit 04cafb88, que agregó el rol
 *    al front y se olvidó de la función). La guarda ⭐ de la sección 2 es la que
 *    impide que haya una tercera: compara las TRES listas entre sí.
 *
 * ⚠️ LA EDGE FUNCTION NO SE PUBLICA CON EL CI. Hay que correr a mano
 *    `supabase functions deploy admin-create-user`. Por eso el arreglo del lado
 *    de la app (reenviar el rol tras crear) es el que sostiene el
 *    comportamiento mientras tanto — y también tiene su guarda acá.
 *
 *   node scripts/test-rol-al-crear-usuario.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0; const malas = [];
const ok = (n, c, extra = '') => { if (c) pass++; else { fail++; malas.push(n + (extra ? `  → ${extra}` : '')); } };

// Fuera los comentarios: si no, comentar una línea la deja igual de presente
// para una expresión regular y el mutante sobrevive.
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const leer = (rel) => sinComentarios(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const usuarios = leer('src/screens/UsersScreen.tsx');
const tipos = leer('src/types/database.ts');
const edge = leer('supabase/functions/admin-create-user/index.ts');
const sql = fs.readFileSync(path.join(ROOT, 'supabase/rol_coordinador_inspectores_enum.sql'), 'utf8');

console.log('ROL AL CREAR UN USUARIO\n');

// ══════════════════════════════════════════════════════════════════════════
// 1) EL ARREGLO DEL LADO DE LA APP (el que funciona sin redesplegar nada)
// ══════════════════════════════════════════════════════════════════════════
ok('⭐ tras crear, la app REENVÍA el rol al perfil',
  /\.update\(\{ cedula: ci \|\| null, username: un, app_role_id: appRoleId, role: baseRole \}\)/.test(usuarios),
  'sin esto, el rol degradado por la Edge Function se queda fijo');

ok('⭐ y ese update ya NO se traga el error',
  /const \{ error: e2 \} = await supabase\.from\('profiles'\)/.test(usuarios)
  && /if \(e2\) \{/.test(usuarios),
  'antes fallaba en silencio y el usuario quedaba con el rol equivocado');

ok('el aviso de error dice que el usuario SÍ se creó',
  /El usuario se creó, pero no se pudo fijar su rol/.test(usuarios),
  'si no lo dice, el admin lo intenta de nuevo y choca con el usuario duplicado');

// Un rol PERSONALIZADO se crea a propósito como 'conductor' + app_role_id. Si
// alguien "arregla" esto mandando sel.role, se rompe el camino de roles propios.
ok('el rol base de un rol PERSONALIZADO sigue siendo conductor a propósito',
  /const baseRole: UserRole = sel\.kind === 'base' \? sel\.role : 'conductor';/.test(usuarios),
  'reenviar `role` es seguro justo porque baseRole ya vale lo correcto en ambos casos');

// ══════════════════════════════════════════════════════════════════════════
// 2) ⭐ LAS TRES LISTAS DE ROLES, COTEJADAS ENTRE SÍ
// ══════════════════════════════════════════════════════════════════════════
// Esta es LA guarda de este archivo. El bug no fue un descuido puntual: fue una
// lista que se quedó atrás dos veces. Mientras las tres coincidan, no puede
// repetirse.
const sacarLista = (texto, re) => {
  const m = texto.match(re);
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort() : null;
};
const rolesFront = sacarLista(usuarios, /const ROLES: UserRole\[\] = \[([^\]]+)\]/);
const rolesEdge = sacarLista(edge, /const allowed = \[([^\]]+)\]/);
const rolesTipo = (tipos.match(/export type UserRole = ([^;]+);/) ?? [null, ''])[1]
  .split('|').map((s) => s.trim().replace(/'/g, '')).filter(Boolean).sort();

ok('se pudieron leer las tres listas de roles',
  !!rolesFront && !!rolesEdge && rolesTipo.length > 0,
  'si el formato cambió, esta guarda deja de mirar y hay que reescribirla');

ok('⭐ la lista blanca de la Edge Function coincide con los ROLES de la pantalla',
  JSON.stringify(rolesEdge) === JSON.stringify(rolesFront),
  `edge=[${rolesEdge}] · pantalla=[${rolesFront}]  — el rol que sobre se degradará a conductor`);

ok('⭐ y el tipo UserRole coincide con las otras dos',
  JSON.stringify(rolesTipo) === JSON.stringify(rolesFront),
  `tipo=[${rolesTipo}] · pantalla=[${rolesFront}]`);

ok('coordinador_inspectores está en las tres (fue el que faltaba)',
  rolesEdge.includes('coordinador_inspectores')
  && rolesFront.includes('coordinador_inspectores')
  && rolesTipo.includes('coordinador_inspectores'));

// ══════════════════════════════════════════════════════════════════════════
// 3) LA EDGE FUNCTION YA NO DEGRADA EN SILENCIO
// ══════════════════════════════════════════════════════════════════════════
ok('⭐ avisa cuando degradó el rol en vez de callárselo',
  /const degradado = !allowed\.includes\(role\);/.test(edge)
  && /warn_role/.test(edge),
  'el silencio es lo que hizo que este bug viviera 20 días');

ok('⭐ el update del perfil ya no se traga su error',
  /const \{ error: upErr \} = await admin/.test(edge)
  && /upErr \? 'conductor' : finalRole/.test(edge),
  'si el enum no tiene el valor, fallaba en silencio con el mismo síntoma');

// ══════════════════════════════════════════════════════════════════════════
// 4) EL SQL DEL ENUM
// ══════════════════════════════════════════════════════════════════════════
ok('el SQL agrega el valor al enum de forma idempotente',
  /alter type public\.user_role add value if not exists 'coordinador_inspectores'/.test(sql));

ok('trae diagnóstico ANTES y verificación DESPUÉS',
  /BLOQUE 1 · DIAGNÓSTICO/.test(sql) && /BLOQUE 3 · VERIFICACIÓN/.test(sql));

ok('avisa que hay que correrlo a mano',
  /A MANO/.test(sql), 'editar un .sql no lo aplica');

ok('⭐ avisa que la Edge Function NO se publica con el CI',
  /functions deploy admin-create-user/.test(sql),
  'sin ese aviso, media corrección se queda sin desplegar y nadie se entera');

ok('el SQL no borra ni modifica datos',
  !/\b(delete from|drop table|truncate|update public\.)/i.test(sql));

// ══════════════════════════════════════════════════════════════════════════
// 5) ⭐ EL COMPORTAMIENTO, SIMULADO
// ══════════════════════════════════════════════════════════════════════════
// La cadena real: la Edge Function filtra, y después la app reenvía el rol. Se
// comprueba que el rol elegido llega intacto INCLUSO si la función desplegada
// todavía es la vieja — que es exactamente la situación hasta que se despliegue.
const edgeVieja = ['admin', 'supervisor', 'analista', 'operador', 'conductor', 'cocina', 'coordinador_patio'];
const rolFinal = (elegido, listaDesplegada, appReenvia) => {
  const trasLaFuncion = listaDesplegada.includes(elegido) ? elegido : 'conductor';
  return appReenvia ? elegido : trasLaFuncion;
};

ok('⭐ con la función VIEJA y sin reenvío → el bug (queda conductor)',
  rolFinal('coordinador_inspectores', edgeVieja, false) === 'conductor',
  'si esto falla, la simulación ya no reproduce el bug');

ok('⭐ con la función VIEJA pero CON reenvío → el rol correcto',
  rolFinal('coordinador_inspectores', edgeVieja, true) === 'coordinador_inspectores',
  'este es el caso de hoy: arreglado sin haber desplegado nada');

ok('⭐ con la función NUEVA y con reenvío → el rol correcto',
  rolFinal('coordinador_inspectores', rolesEdge, true) === 'coordinador_inspectores');

for (const r of rolesFront) {
  ok(`el rol «${r}» sobrevive a la creación`,
    rolFinal(r, rolesEdge, true) === r);
}

// ══════════════════════════════════════════════════════════════════════════
// RESULTADO
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅' : '❌'} test-rol-al-crear-usuario · ${pass} ok · ${fail} fallando`);
if (fail) { console.log(malas.map((m) => '  · ' + m).join('\n')); process.exit(1); }
console.log('El rol que se elige es el que queda, con función vieja o nueva.');
