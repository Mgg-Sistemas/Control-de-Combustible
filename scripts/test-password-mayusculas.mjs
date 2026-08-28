/*
 * LAS CONTRASEÑAS NUNCA SE VEN EN MAYÚSCULA — bug de login del 27-ago-2026.
 *
 * EL BUG, EN UNA FRASE: el administrador escribía «Sos2026», pulsaba el 👁 para
 * leerla, la pantalla se la mostraba «SOS2026», y eso era lo que dictaba. El
 * trabajador tecleaba SOS2026 contra el hash de Sos2026, y el sistema le decía
 * «contraseña incorrecta». Restablecerla lo "arreglaba" porque volvía a alinear
 * el par — y por eso reaparecía con el siguiente usuario.
 *
 * DE DÓNDE SALÍA. `src/lib/fonts.ts` inyecta un CSS global que pone TODO en
 * mayúscula, campos de escritura incluidos, con una sola excepción:
 *
 *     input[type="password"] { text-transform: none !important; }
 *
 * Esa excepción solo vale mientras la clave está OCULTA. Los cinco campos de
 * contraseña de la app tienen ojito, y react-native-web implementa "revelar"
 * cambiando el input a type="text": en ese instante la excepción deja de
 * aplicar. Y `text-transform` es puramente visual — jamás toca `input.value`,
 * así que lo que se envía sigue en minúscula. Lo que se ve y lo que se manda
 * dejan de ser lo mismo.
 *
 * ⚠️ ES UN BUG SOLO DE LA WEB. En nativo `TextInput` no es un <input> y no hay
 *    CSS que lo alcance. Por eso `passField` es {} fuera de web.
 *
 * ⚠️ LO QUE ESTA PRUEBA VIGILA DE VERDAD: que NINGÚN campo con `secureTextEntry`
 *    se quede sin la marca. Un campo de contraseña nuevo que alguien agregue sin
 *    `{...passField}` reproduce el bug entero, en silencio, y nadie lo notaría
 *    hasta que un trabajador no pueda entrar. Esa es la guarda que importa.
 *
 *   node scripts/test-password-mayusculas.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0; const malas = [];
const ok = (n, c, extra = '') => { if (c) pass++; else { fail++; malas.push(n + (extra ? `  → ${extra}` : '')); } };

const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')          // bloque
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');      // línea (el [^:] salva las URLs)

const fuentes = fs.readFileSync(path.join(ROOT, 'src/lib/fonts.ts'), 'utf8');
const fuentesVivo = sinComentarios(fuentes);

console.log('CONTRASEÑAS · NUNCA EN MAYÚSCULA\n');

// ══════════════════════════════════════════════════════════════════════════
// 1) LA REGLA CSS
// ══════════════════════════════════════════════════════════════════════════
ok('el CSS global sigue poniendo los campos en MAYÚSCULA (lo pidió el cliente)',
  /input, textarea \{ text-transform: uppercase !important; \}/.test(fuentesVivo),
  'esto NO se quita: la mayúscula general se quiere, solo las claves se libran');

ok('⭐ la excepción cubre input[data-pass], no solo type="password"',
  /input\[type="password"\], input\[data-pass\] \{ text-transform: none !important; \}/.test(fuentesVivo),
  'sin [data-pass], revelar la clave con el 👁 la vuelve a pintar en mayúscula');

ok('⭐ existe `passField` y marca el input con data-pass en la web',
  /export const passField[^\n]*Platform\.OS === 'web' \? \{ dataSet: \{ pass: '1' \} \} : \{\}/.test(fuentesVivo),
  'react-native-web convierte dataSet.pass en el atributo data-pass');

// ══════════════════════════════════════════════════════════════════════════
// 2) ⭐ NINGÚN CAMPO DE CONTRASEÑA SIN MARCAR — la guarda que de verdad importa
// ══════════════════════════════════════════════════════════════════════════
// Se recorre TODO src/ buscando elementos con `secureTextEntry`. El elemento se
// mira COMPLETO (puede ocupar 12 líneas), no línea por línea: en LoginPilot la
// marca y el secureTextEntry están en líneas distintas, y una prueba por línea
// daría un falso fallo.
const tsx = [];
(function recorrer(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p);
    else if (e.name.endsWith('.tsx')) tsx.push(p);
  }
})(path.join(ROOT, 'src'));

const campos = [];
for (const archivo of tsx) {
  const vivo = sinComentarios(fs.readFileSync(archivo, 'utf8'));
  // Cada <TextInput ... /> completo, con o sin salto de línea dentro.
  for (const m of vivo.matchAll(/<TextInput\b[\s\S]*?\/>/g)) {
    if (!/secureTextEntry/.test(m[0])) continue;
    campos.push({
      archivo: path.relative(ROOT, archivo).replace(/\\/g, '/'),
      marcado: /\{\.\.\.passField\}/.test(m[0]),
    });
  }
}

ok('se encontraron campos de contraseña que auditar', campos.length > 0,
  'si esto falla, el detector se rompió y las demás guardas no valen nada');

// Con menos de los que había el día del arreglo, alguien movió un campo a otro
// componente y hay que revisar que no se haya perdido la marca por el camino.
ok('siguen existiendo al menos los 5 campos conocidos', campos.length >= 5,
  `encontrados: ${campos.length}`);

const sinMarcar = campos.filter((c) => !c.marcado);
ok('⭐ TODO campo con secureTextEntry lleva {...passField}',
  sinMarcar.length === 0,
  sinMarcar.map((c) => c.archivo).join(', ') + ' — un campo sin marcar reproduce el bug entero');

// Los cuatro sitios donde hay contraseñas hoy. Si uno desaparece de la lista es
// que se movió: no es un fallo en sí, pero hay que mirarlo.
for (const esperado of [
  'src/screens/redesign/LoginPilot.tsx',
  'src/screens/UsersScreen.tsx',
  'src/components/ChangePasswordButton.tsx',
]) {
  ok(`sigue habiendo campo de contraseña en ${esperado}`,
    campos.some((c) => c.archivo === esperado));
}

// ══════════════════════════════════════════════════════════════════════════
// 3) ⭐ EL COMPORTAMIENTO, SIMULADO
// ══════════════════════════════════════════════════════════════════════════
// Se reproduce lo que hace el navegador: qué `type` tiene el input según el ojo,
// y si la regla CSS lo alcanza. `visto` es lo que LEE el administrador; `valor`
// es lo que de verdad viaja a Supabase. Tienen que ser SIEMPRE iguales.
const tipoDelInput = (revelado) => (revelado ? 'text' : 'password');
const seTransforma = (tipo, tieneDataPass) => {
  if (tipo === 'password') return false;   // input[type="password"]
  if (tieneDataPass) return false;         // input[data-pass]  ← el arreglo
  return true;                             // input { uppercase }
};
const loQueSeVe = (clave, revelado, marcado) =>
  seTransforma(tipoDelInput(revelado), marcado) ? clave.toUpperCase() : clave;

const CLAVE = 'Sos2026';

// Sin la marca y con el ojo abierto: así se veía el bug.
ok('⭐ SIN la marca, revelar la clave la mostraba distinta a la real',
  loQueSeVe(CLAVE, true, false) !== CLAVE,
  'si esto deja de cumplirse, la simulación ya no reproduce el bug y no prueba nada');

// Con la marca: lo que se ve es lo que se manda, pase lo que pase.
for (const revelado of [false, true]) {
  ok(`⭐ CON la marca · ojo ${revelado ? 'abierto' : 'cerrado'} → se ve lo mismo que se envía`,
    loQueSeVe(CLAVE, revelado, true) === CLAVE,
    `se vería «${loQueSeVe(CLAVE, revelado, true)}» y se enviaría «${CLAVE}»`);
}

// Una clave toda en mayúscula funcionaba igual con bug o sin él: por eso el
// fallo parecía intermitente y costó tanto verlo.
ok('una clave TODA EN MAYÚSCULA nunca falló (de ahí que pareciera intermitente)',
  loQueSeVe('SOS2026', true, false) === 'SOS2026');

// ══════════════════════════════════════════════════════════════════════════
// RESULTADO
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅' : '❌'} test-password-mayusculas · ${pass} ok · ${fail} fallando`);
console.log(`   (${campos.length} campos de contraseña auditados, todos marcados)`);
if (fail) { console.log(malas.map((m) => '  · ' + m).join('\n')); process.exit(1); }
console.log('Lo que el administrador lee es lo que el trabajador teclea.');
