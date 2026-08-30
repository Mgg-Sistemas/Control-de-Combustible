/*
 * EL BOTÓN «📄 Mi reporte de jornada» NO SE VE EN EL TELÉFONO DEL INSPECTOR
 * — pedido del cliente del 27-ago-2026:
 *
 *   «quitale a los inspectores en la vista de telefono, el boton de imprimir
 *    reporte de jornada, sin tocar nada, sin dañar nada, sin cambiar nada,
 *    solo quitales ese boton»
 *
 * Las dos mitades del pedido pesan igual, y por eso esta prueba vigila LAS DOS:
 *
 *   1. QUE SE QUITE  — el inspector, en su celular, no lo ve.
 *   2. QUE NO SE DAÑE NADA — sigue estando para el MISMO inspector desde una PC,
 *      para el coordinador de inspectores, y para quien entra por el QR de una
 *      máquina. Y el bloque JSX no se borró: solo se apagó su condición, así que
 *      devolverlo es quitar media línea.
 *
 * ⚠️ LA TRAMPA DE ESTA PANTALLA: `Platform.OS === 'web'` NO significa «PC». Un
 *    inspector que entra a soslaguaira.com desde el navegador de su celular es
 *    'web' Y es teléfono. El único mecanismo válido del proyecto es
 *    `isPhoneDevice()` (src/lib/device.ts), que lee el user-agent. Si alguien
 *    "simplifica" esto a Platform.OS, el botón reaparece en el celular y
 *    desaparece de las PCs — exactamente al revés de lo pedido. Hay una guarda
 *    para eso.
 *
 * ⚠️ FUERA LOS COMENTARIOS ANTES DE MIRAR EL FUENTE. Sin esto, comentar una
 *    línea la deja igual de presente para una expresión regular y el mutante
 *    sobrevive: la guarda no valdría nada. Ya pasó tres veces en este proyecto
 *    el 26-ago-2026.
 *
 *   node scripts/test-boton-jornada-telefono.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0; const malas = [];
const ok = (n, c, extra = '') => { if (c) pass++; else { fail++; malas.push(n + (extra ? `  → ${extra}` : '')); } };

const crudo = fs.readFileSync(path.join(ROOT, 'src/screens/SupervisorScreen.tsx'), 'utf8');
// El `[^:]` evita comerse el `//` de las URLs (https://...).
const src = crudo.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const device = fs.readFileSync(path.join(ROOT, 'src/lib/device.ts'), 'utf8');
const informe = fs.readFileSync(path.join(ROOT, 'src/lib/inspectorReport.ts'), 'utf8');

console.log('BOTÓN DE REPORTE DE JORNADA · FUERA DEL TELÉFONO DEL INSPECTOR\n');

// ══════════════════════════════════════════════════════════════════════════
// 1) SE QUITA — y se quita con el mecanismo correcto
// ══════════════════════════════════════════════════════════════════════════
ok('la pantalla importa isPhoneDevice desde lib/device',
  /import \{[^}]*isPhoneDevice[^}]*\} from '\.\.\/lib\/device'/.test(src),
  'sin el import no hay forma de saber si es teléfono');

ok('calcula `esTelefono` con isPhoneDevice()',
  /const esTelefono\s*=\s*useMemo\(\(\)\s*=>\s*isPhoneDevice\(\)/.test(src));

ok('⭐ el reporte se apaga en el TELÉFONO del INSPECTOR',
  /const puedeDescargarCierre\s*=\s*!!fixedShift\s*&&\s*!\(esTelefono\s*&&\s*role === 'supervisor'\)/.test(src),
  'la condición del bloque cambió: revisa que siga excluyendo teléfono + supervisor');

// El rol interno es 'supervisor' aunque al usuario se le muestre "inspector"
// (ver ROLE_LABEL en src/lib/permissions.ts). Comparar contra 'inspector' no
// coincidiría con NADIE y el botón seguiría saliendo en el celular.
ok('usa el rol INTERNO (supervisor), no la etiqueta visible (inspector)',
  /role === 'supervisor'/.test(src) && !/role === 'inspector'/.test(src),
  "en la BD el rol se llama 'supervisor'");

// ══════════════════════════════════════════════════════════════════════════
// 2) ⭐ LA TRAMPA: Platform.OS no puede hacer de detector de teléfono
// ══════════════════════════════════════════════════════════════════════════
{
  const linea = (src.match(/const puedeDescargarCierre[^\n]*/) ?? [''])[0];
  ok('⭐ la condición NO usa Platform.OS como si fuera "teléfono"',
    !/Platform\.OS/.test(linea),
    'un celular entrando por el navegador es Platform.OS === "web" Y es teléfono');
}
ok('isPhoneDevice sí mira el user-agent además de Platform',
  /userAgent/.test(device) && /Platform\.OS === 'web'/.test(device),
  'si dejara de leer el user-agent, la web del celular contaría como PC');

// ══════════════════════════════════════════════════════════════════════════
// 3) ⭐ «SIN DAÑAR NADA»: no se borró el bloque, solo se apagó
// ══════════════════════════════════════════════════════════════════════════
ok('⭐ el bloque «📄 Mi reporte de jornada» SIGUE en el código',
  /📄 Mi reporte de jornada/.test(src),
  'se pidió quitarlo de una vista, no borrarlo del proyecto');

ok('⭐ el bloque entero sigue colgando de `puedeDescargarCierre`',
  /\{puedeDescargarCierre \? \(/.test(src),
  'si se desacopla, los selectores de día/turno quedan huérfanos en pantalla');

ok('el botón de descarga sigue existiendo',
  /Descargar reporte \(PDF\)/.test(src));

ok('sigue el handler que genera el PDF',
  /descargarCierreJornada/.test(src) && /generateMyShiftReceipt/.test(src));

for (const pieza of [
  ['selector de día (◀ ▶)', /shiftReceiptDay\(-1\)/],
  ['selector de turno (☀️/🌙)', /setReceiptShift\(s\)/],
  ['aviso de máquinas en curso', /Todavía tienes máquinas en curso/],
]) {
  ok(`sigue intacto: ${pieza[0]}`, pieza[1].test(src),
    'no se pidió tocar el contenido del bloque');
}

// La función del PDF la usan otras dos suites y el reporte del jefe. Borrarla
// habría roto cosas que nadie mencionó.
ok('⭐ generateMyShiftReceipt sigue exportada en lib/inspectorReport',
  /export (async )?function generateMyShiftReceipt/.test(informe),
  'la usan test-recibo-jornada y test-reportes-paridad');

// ══════════════════════════════════════════════════════════════════════════
// 4) ⭐ LA REGLA, EJECUTADA DE VERDAD (las 8 combinaciones)
// ══════════════════════════════════════════════════════════════════════════
// Se reproduce la condición tal como quedó y se comprueba caso por caso. Esto
// es lo que de verdad describe el pedido: quién lo ve y quién no.
const ve = (fixedShift, esTelefono, role) =>
  !!fixedShift && !(esTelefono && role === 'supervisor');

const casos = [
  ['inspector · TELÉFONO       → NO lo ve', 'day', true, 'supervisor', false],
  ['inspector · PC             → sí lo ve', 'day', false, 'supervisor', true],
  ['coordinador · TELÉFONO     → sí lo ve', 'day', true, 'coordinador_inspectores', true],
  ['coordinador · PC           → sí lo ve', 'day', false, 'coordinador_inspectores', true],
  ['admin por QR · TELÉFONO    → sí lo ve', 'night', true, 'admin', true],
  ['admin por QR · PC          → sí lo ve', 'night', false, 'admin', true],
  ['sin turno fijo · PC        → NO lo ve', null, false, 'supervisor', false],
  ['sin turno fijo · TELÉFONO  → NO lo ve', null, true, 'coordinador_inspectores', false],
];
for (const [nombre, turno, tel, rol, esperado] of casos) {
  ok(nombre, ve(turno, tel, rol) === esperado,
    `dio ${ve(turno, tel, rol)}, se esperaba ${esperado}`);
}

// ══════════════════════════════════════════════════════════════════════════
// RESULTADO
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅' : '❌'} test-boton-jornada-telefono · ${pass} ok · ${fail} fallando`);
if (fail) { console.log(malas.map((m) => '  · ' + m).join('\n')); process.exit(1); }
console.log('El inspector no lo ve en su celular; todos los demás lo conservan.');
