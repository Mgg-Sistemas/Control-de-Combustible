/*
 * Test del INTERRUPTOR DE LA AUTOMATIZACIÓN DEL INSPECTOR SOS (21-sep-2026).
 *
 * Pedido del cliente: «un check al inspector sos el cual solo veremos los
 * administradores para poder activar o desactivar la automatización». Eligió apagar
 * SOLO los procesos automáticos; la regla «siempre trabajando» no se toca.
 *
 * La lógica vive en la base (los crons leen una fila) y se probó allá, suplantando a un
 * admin y a un analista. Acá se fija lo que la APP tiene que cumplir, y por qué duele:
 *   · solo un admin ve la tarjeta (dos barreras: el rol en la app y la fila en la base)
 *   · un «no eres admin» de la base NO se pinta como «✅ apagada» (RLS rechaza con 0
 *     filas y sin error)
 *   · apagar pide dos toques: son las horas que se le pagan a las empresas
 *   · un fallo de red no se pinta como «encendida»
 *   · la regla «siempre trabajando» sigue intacta (opción (a) del cliente)
 *
 *   node scripts/test-sos-automatizacion.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass++; else { fail++; failures.push(`✗ ${name}`); } };

const lib = sinComentarios(leer('src/lib/sosAutomatizacion.ts'));
const card = sinComentarios(leer('src/components/SosAutomatizacionCard.tsx'));
const pantalla = sinComentarios(leer('src/screens/SupervisorScreen.tsx'));
const regla = sinComentarios(leer('src/lib/machineInspectors.ts'));

// ── 1) SOLO ADMINISTRADORES ──────────────────────────────────────────────────
ok('⭐ la tarjeta pregunta el rol', /const esAdmin = role === 'admin'/.test(card));
ok('⭐ quien no es admin no ve NADA (ni la tarjeta vacía)', /if \(!esAdmin \|\| \(!estado && !error\)\) return null;/.test(card));
ok('⭐ quien no es admin ni siquiera consulta la base', /if \(!esAdmin\) return;/.test(card));
ok('sin fila visible (no admin, o falta el SQL) la lectura devuelve null', /if \(!f\) return null;/.test(lib) && /if \(faltaLaTabla\(error\)\) return null;/.test(lib));
ok('la tarjeta está montada en Inspecciones', /<SosAutomatizacionCard \/>/.test(pantalla));

// ── 2) LA BASE MANDA: 0 FILAS NO ES «LISTO» ──────────────────────────────────
ok('⭐ el cambio pide las filas de vuelta', /\.update\(\{ activa,[\s\S]*?\}\)\s*\.eq\('id', true\)\s*\.select\('activa'\)/.test(lib));
ok('⭐ 0 filas = no se cambió, y se dice', /if \(!data\?\.length\) return \{ error: 'No se cambió: solo un administrador/.test(lib));
ok('⭐ con error no se anuncia el cambio', /if \(r\.error\) \{ setAviso\(`❌ \$\{r\.error\}`\); return; \}/.test(card));
ok('queda quién lo cambió', /updated_by_nombre:/.test(lib) && /Último cambio:/.test(card));

// ── 3) NO SE PINTA LO QUE NO SE SABE ─────────────────────────────────────────
ok('⭐ un fallo de red LANZA: no se pinta «encendida» a ciegas', /throw new Error\(error\.message\)/.test(lib));
ok('...y la tarjeta lo muestra como error, no como estado', /No se pudo leer el interruptor/.test(card));

// ── 4) APAGAR PIDE DOS TOQUES ────────────────────────────────────────────────
ok('⭐ apagar no pasa de un roce', /if \(!activa && !confirmarApagar\) \{\s*setConfirmarApagar\(true\);/.test(card));
ok('...y el aviso dice qué va a pasar con las horas', /dejan de iniciar jornada y de sumar horas por su cuenta/.test(card));
ok('encender es de un toque', !/confirmarEncender/.test(card));
ok('tocar el aviso cancela la confirmación', /setAviso\(null\); setConfirmarApagar\(false\);/.test(card));

// ── 5) LA OPCIÓN (a): LA REGLA DE PANTALLA NO SE TOCA ────────────────────────
ok('⭐ «siempre trabajando» sigue igual: no mira el interruptor', /INSPECTORES_SIEMPRE_ACTIVOS = \['inspector sos la guaira'\]/.test(regla) && !/sosAutomatizacion|sos_automatizacion/.test(regla));
ok('la tarjeta le dice al admin qué NO cambia', /No cambia que salgan como «trabajando»/.test(card));

// ── 6) MANUALES ──────────────────────────────────────────────────────────────
ok('manual (md) lo explica', /Automatización del Inspector SOS: encender y apagar \(21\/09\/2026\)/.test(leer('docs/MANUAL-USUARIO.md')));
ok('manual (app) también', /AUTOMATIZACIÓN DEL INSPECTOR SOS: ENCENDER Y APAGAR \(21\/09\/2026\)/.test(leer('src/screens/ManualScreen.tsx')));

console.log(`\n${fail === 0 ? '✅' : '❌'} test-sos-automatizacion · ${pass} ok · ${fail} fallando`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
