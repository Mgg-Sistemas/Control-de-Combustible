/*
 * DIÁLOGOS — la pregunta de confirmar tiene que salir DELANTE, no detrás.
 *
 * Bug real (18-ago-2026): al tocar "🗑 Quitar foto" dentro del visor de fotos, la
 * pregunta "¿Quitar la foto?" salía DETRÁS del visor. Parecía que el botón no
 * hacía nada, y la pantalla quedaba trabada hasta responder algo invisible.
 *
 * POR QUÉ PASABA. En web, react-native-web dibuja cada <Modal> en un div propio
 * que cuelga del <body>, y a TODOS les pone el mismo z-index (9999). Con el mismo
 * z-index manda el ORDEN en que se montaron: el último montado va delante. El
 * ConfirmProvider vive en la raíz de la app (App.tsx), así que su Modal se montaba
 * al arrancar el sistema — el PRIMERO de todos — y cualquier ventana abierta
 * después lo tapaba. No era problema del visor de fotos: le pasaba a CUALQUIER
 * confirmación pedida desde una ventana abierta, en todo el sistema.
 *
 * EL ARREGLO. Montar el Modal solo cuando hay algo que confirmar (`{opts ? ... }`)
 * en vez de tenerlo siempre montado con `visible={!!opts}`. Así entra de último y
 * queda delante. Esta prueba cuida ese detalle, porque es de los que se "corrigen"
 * de vuelta sin querer: `visible={!!opts}` se ve más prolijo y compila igual.
 *
 *   npm run test:dialogos   (o: node scripts/test-dialogos.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) pass++; else { fail++; failures.push(name + (extra ? `  → ${extra}` : '')); }
};

console.log('DIÁLOGOS — la confirmación sale delante');

const confirmProvider = leer('src/components/ConfirmProvider.tsx');

// ── El arreglo en sí ──
ok(
  '⭐ el Modal se monta SOLO cuando hay algo que confirmar',
  /\{opts \?\s*\(?\s*<Modal/.test(confirmProvider),
  'no se encontró el montaje condicional `{opts ? <Modal ...`',
);
ok(
  '⭐ NO vuelve al Modal siempre montado con `visible={!!opts}`',
  !/<Modal[^>]*visible=\{!!opts\}/.test(confirmProvider),
  'volvió `visible={!!opts}`: la pregunta va a salir detrás otra vez',
);
ok(
  'queda escrito el porqué, para que nadie lo "corrija" de vuelta',
  /z-index/i.test(confirmProvider) && /detr[áa]s/i.test(confirmProvider),
);

// ── Lo que el arreglo asume de react-native-web ──
// Si algún día RNW deja de usar un z-index único para todos los modales, el
// comentario del ConfirmProvider queda desactualizado (el arreglo sigue siendo
// válido, pero la explicación ya no). Este aviso no rompe la prueba.
try {
  const rnw = leer('node_modules/react-native-web/dist/exports/Modal/ModalAnimation.js');
  if (!/zIndex:\s*9999/.test(rnw)) {
    console.log('  ⚠️ react-native-web ya no usa zIndex 9999 para los modales: revisa el comentario de ConfirmProvider.tsx');
  }
} catch { /* sin node_modules (CI liviano): no pasa nada */ }

// ── El botón que destapó el bug sigue pidiendo confirmación ──
const equipos = leer('src/screens/EquiposScreen.tsx');
ok(
  'quitar la foto sigue preguntando antes',
  /const quitarPhoto[\s\S]{0,400}await confirm\(/.test(equipos),
);
ok(
  'la pregunta dice de CUÁL máquina es la foto (nombre + placa/serial)',
  /const quitarPhoto[\s\S]{0,400}etiquetaMaquina\(m\)/.test(equipos),
);

if (fail) {
  console.log(`✗ ${fail} FALLO(S):\n` + failures.map((f) => `  · ${f}`).join('\n'));
  process.exit(1);
}
console.log(`${pass} OK · 0 FALLO(S)\nLa pregunta de confirmar se monta de última y queda delante de la ventana abierta.`);
