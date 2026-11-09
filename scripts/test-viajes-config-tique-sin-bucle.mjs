// 💸 VIAJES: LA CONFIGURACIÓN DEL TIQUET SIN BUCLE (09-nov-2026). La factura de Supabase subió:
// la pantalla de Viajes releía `tique_config` EN BUCLE (el efecto dependía de `configTique` y él
// mismo lo cambiaba con cada lectura): 127.243 lecturas en 2,7 días. Ahora se lee al abrir, al
// guardar la tarjeta de configuración y cada 5 minutos. Esta prueba falla con el bucle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const s = fs.readFileSync(path.join(ROOT, 'src/screens/ViajesCamionesScreen.tsx'), 'utf8');
let ok = 0; const fallas = [];
const check = (c, m) => { if (c) ok++; else fallas.push('  ✗ ' + m); };

// El efecto que llama a leerConfigTique (hasta su cierre).
const i = s.indexOf('leerConfigTique().then(');
const efecto = s.slice(s.lastIndexOf('useEffect(', i), s.indexOf('});', s.indexOf('return () =>', i)) + 40);
const deps = (efecto.match(/\}, \[([^\]]*)\]\);/) || [])[1];
check(deps !== undefined, 'se encontró el efecto que lee la configuración del tiquet');
check(!/configTique|formatosTique|asignacionesFormatos|foliosFormatos/.test(deps ?? ''), '⭐ el efecto NO depende de lo que él mismo cambia (eso era el bucle)');
check(deps === 'versionTique', 'se relee solo cuando cambia `versionTique`');
check(/setInterval\(\(\) => setVersionTique\(\(v\) => v \+ 1\), 5 \* 60 \* 1000\)/.test(s), 'y cada 5 minutos (toma lo que cambie otro equipo)');
check(/onGuardado=\{\(c\) => \{ setConfigTique\(c\); setVersionTique\(\(v\) => v \+ 1\); \}\}/.test(s), '⭐ al guardar la tarjeta de configuración se relee enseguida (el primer tiquet sale con el formato nuevo)');
check(/setFoliosFormatos\(\(prev\) => \(\{ \.\.\.prev, \.\.\.r\.foliosFormatos \}\)\)/.test(s), 'lo sellado al imprimir y aún no subido no se pisa al releer');
// Ninguna otra lectura de leerConfigTique en esta pantalla.
check((s.match(/leerConfigTique\(\)/g) || []).length === 1, 'una sola lectura en la pantalla');

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-viajes-config-tique-sin-bucle: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-viajes-config-tique-sin-bucle: ${ok} ok, 0 fallas`);
