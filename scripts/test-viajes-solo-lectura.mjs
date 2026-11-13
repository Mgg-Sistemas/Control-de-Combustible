// 🚛 TEST: MODO SOLO LECTURA EN VIAJES DE CAMIONES (13-nov-2026).
// Verifica:
// 1. Niveles de permisos ('none', 'lectura', 'escritura', 'full') con levelMeets.
// 2. Que en 'lectura' se active canRead, esSoloLectura y canVerPanel, pero NO canWrite ni canFull.
// 3. Que ViajesCamionesScreen.tsx tenga los candados exactos:
//    - if (!canRead) para el bloqueo de entrada (no expulsa a lectura).
//    - esSoloLectura muestra el banner informativo.
//    - canWrite condiciona el registro de viajes y "Mis viajes de hoy".
//    - canVerPanel abre el Panel de información y ejecuta loadResumen y loadRangeRows.
//    - canFull protege los bloques de edición/mutación (Cargar a mano, Configuración, Tipos, renderRow con canEdit/canDelete).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let total = 0;
let fallos = 0;

function check(cond, desc) {
  total++;
  if (cond) {
    console.log(`  ✓ ${desc}`);
  } else {
    fallos++;
    console.error(`  ✗ FALLO: ${desc}`);
  }
}

console.log('\n--- 1. Lógica de niveles de permiso ---');
// Simulación fiel de levelMeets de src/lib/permissions.ts
const ORDER = { none: 0, lectura: 1, escritura: 2, full: 3 };
function levelMeets(have, need) {
  return (ORDER[have] ?? 0) >= (ORDER[need] ?? 0);
}

function calcularPermisos(level) {
  const canRead = levelMeets(level, 'lectura');
  const canWrite = levelMeets(level, 'escritura');
  const canFull = levelMeets(level, 'full');
  const esSoloLectura = canRead && !canWrite;
  const canVerPanel = canFull || esSoloLectura;
  return { canRead, canWrite, canFull, esSoloLectura, canVerPanel };
}

const pNone = calcularPermisos('none');
check(!pNone.canRead && !pNone.canWrite && !pNone.canFull && !pNone.esSoloLectura && !pNone.canVerPanel,
  "'none' bloquea lectura, escritura, panel y marcas");

const pLectura = calcularPermisos('lectura');
check(pLectura.canRead === true, "'lectura' tiene canRead = true");
check(pLectura.canWrite === false, "'lectura' tiene canWrite = false (no puede registrar viajes)");
check(pLectura.canFull === false, "'lectura' tiene canFull = false (no puede borrar ni cambiar configuración)");
check(pLectura.esSoloLectura === true, "'lectura' activa esSoloLectura = true");
check(pLectura.canVerPanel === true, "'lectura' activa canVerPanel = true (puede ver resúmenes y reportes)");

const pEscritura = calcularPermisos('escritura');
check(pEscritura.canRead === true && pEscritura.canWrite === true && !pEscritura.canFull,
  "'escritura' puede leer y escribir, pero no es full");
check(!pEscritura.esSoloLectura && !pEscritura.canVerPanel,
  "'escritura' (listero) NO es solo lectura y no abre panel administrativo sin full");

const pFull = calcularPermisos('full');
check(pFull.canRead && pFull.canWrite && pFull.canFull && !pFull.esSoloLectura && pFull.canVerPanel,
  "'full' tiene acceso total");

console.log('\n--- 2. Candados en ViajesCamionesScreen.tsx ---');
const screenCode = fs.readFileSync(path.join(ROOT, 'src/screens/ViajesCamionesScreen.tsx'), 'utf8');

check(screenCode.includes("const canRead = levelMeets(level, 'lectura');"),
  "Define canRead con levelMeets('lectura')");
check(screenCode.includes('const esSoloLectura = canRead && !canWrite;'),
  "Define esSoloLectura");
check(screenCode.includes('const canVerPanel = canFull || esSoloLectura;'),
  "Define canVerPanel = canFull || esSoloLectura");

check(!screenCode.includes('if (!canWrite) {\n    return (\n      <Screen>\n        <SectionTitle>🚛 Viajes de camiones</SectionTitle>\n        <EmptyState title="Solo lectura"'),
  "Ya NO expulsa a los usuarios con nivel lectura con pantalla 'Solo lectura'");

check(/if\s*\(!canRead\)\s*\{\s*return\s*\(\s*<Screen>[\s\S]*?<EmptyState title="Sin acceso"/.test(screenCode),
  "La guarda inicial es if (!canRead) { return <EmptyState title=\"Sin acceso\" ... /> }");

check(screenCode.includes('{esSoloLectura ? (') && screenCode.includes('Modo solo lectura: Puedes consultar la bitácora'),
  "Muestra el banner de aviso de 'Modo solo lectura'");

check(/\{canWrite\s*\?\s*\(\s*<>[\s\S]*?<SectionTitle>Registrar viaje<\/SectionTitle>/.test(screenCode),
  "El bloque de 'Registrar viaje' está condicionado a canWrite");

check(/\{canVerPanel\s*\?\s*\(\s*<>[\s\S]*?<SectionTitle>📊 Panel de información<\/SectionTitle>/.test(screenCode),
  "El Panel de información abre para canVerPanel");

check(screenCode.includes('{canFull ? (') && screenCode.includes('titulo="✍️ Cargar viajes a mano"'),
  "'Cargar viajes a mano' está protegido por canFull");

check(screenCode.includes('{canFull ? (') && screenCode.includes('titulo="⚙️ Configuración"'),
  "'⚙️ Configuración' está protegido por canFull");

check(screenCode.includes('{canFull ? (') && screenCode.includes('titulo="🧾 Tipos de viaje (tarifas con nombre)"'),
  "'🧾 Tipos de viaje' está protegido por canFull");

check(screenCode.includes('{canFull ? <TiqueConfigCard'),
  "'TiqueConfigCard' está protegido por canFull");

check(screenCode.includes('<InformeOperativoCard canVer={canVerPanel} />'),
  "'InformeOperativoCard' recibe canVer={canVerPanel}");

check(screenCode.includes('renderRow(row, { canEdit: canFull, canDelete: canFull, showListero: true })'),
  "renderRow de la lista completa pasa canEdit: canFull y canDelete: canFull");

check(/const loadResumen = async \(\) => \{\s*if \(!canVerPanel\) return;/.test(screenCode),
  "loadResumen carga datos si canVerPanel es true");

check(/const loadRangeRows = async \(\) => \{[\s\S]*?if \(!canVerPanel/.test(screenCode),
  "loadRangeRows carga datos si canVerPanel es true");

console.log('\n--- 3. Verificación de Manuales ---');
const manualCode = fs.readFileSync(path.join(ROOT, 'src/screens/ManualScreen.tsx'), 'utf8');
const docManual = fs.readFileSync(path.join(ROOT, 'docs/MANUAL-USUARIO.md'), 'utf8');

check(manualCode.includes('MODO SOLO LECTURA EN VIAJES DE CAMIONES'),
  "ManualScreen.tsx documenta el Modo Solo Lectura de Viajes");
check(docManual.includes('**Lectura** (13-nov-2026)'),
  "docs/MANUAL-USUARIO.md documenta el nivel Lectura");

console.log(`\n=============================`);
console.log(`RESULTADO: ${total - fallos}/${total} pruebas pasadas (${fallos} fallos).`);
console.log(`=============================\n`);

if (fallos > 0) {
  process.exit(1);
}
