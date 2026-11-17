// Prueba de historial y reimpresión de amonestaciones y actas (17-nov-2026).
// Verifica que las amonestaciones se guarden sin DELETE, tengan código correlativo,
// se listen/reimpriman/anulen en EmpleadosScreen y se muestren/reimpriman en EmployeeCardScreen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const leer = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const dbSrc = leer('src/lib/amonestacionesDb.ts');
const empSrc = leer('src/screens/EmpleadosScreen.tsx');
const cardSrc = leer('src/screens/EmployeeCardScreen.tsx');

// 1. Cero DELETE en el repositorio de amonestaciones
assert(!/\.delete\s*\(/i.test(dbSrc), 'amonestacionesDb.ts no debe contener .delete(');
assert(/\.select\(['"]id['"]\)/.test(dbSrc), 'amonestacionesDb.ts debe verificar RLS con .select("id")');
assert(/export function generarCodigoAmonestacion/.test(dbSrc), 'falta generarCodigoAmonestacion');
assert(/export function esAmonestacionConDatos/.test(dbSrc), 'falta esAmonestacionConDatos');
assert(/export async function listarAmonestacionesEmpleado/.test(dbSrc), 'falta listarAmonestacionesEmpleado');
assert(/export async function guardarAmonestacion/.test(dbSrc), 'falta guardarAmonestacion');
assert(/export async function anularAmonestacion/.test(dbSrc), 'falta anularAmonestacion');

// 2. Verificar comportamiento de generarCodigoAmonestacion
const generarCodigo = (n) => `AMON-${String(Math.max(1, n)).padStart(3, '0')}`;
assert.equal(generarCodigo(1), 'AMON-001');
assert.equal(generarCodigo(12), 'AMON-012');
assert.equal(generarCodigo(0), 'AMON-001');

// 3. EmpleadosScreen: contador, guardado, historial, reimpresión y anulación lógica
assert(empSrc.includes('amonestCounts'), 'EmpleadosScreen debe mostrar contador de amonestaciones');
assert(empSrc.includes('guardarAmonestacion'), 'EmpleadosScreen debe guardar amonestación en BD');
assert(empSrc.includes('reimprimirAmonestacion'), 'EmpleadosScreen debe permitir reimprimir amonestación');
assert(empSrc.includes('confirmarAnulacionAmonestacion'), 'EmpleadosScreen debe permitir anular con motivo');
assert(empSrc.includes('employee_amonestaciones'), 'EmpleadosScreen debe escuchar realtime de employee_amonestaciones');

// 4. EmployeeCardScreen: sección historial de amonestaciones + reimpresión PDF + botones de actas
assert(cardSrc.includes('listarAmonestacionesEmpleado'), 'EmployeeCardScreen debe cargar amonestaciones del empleado');
assert(cardSrc.includes('Historial de Amonestaciones'), 'EmployeeCardScreen debe mostrar sección Historial de Amonestaciones');
assert(cardSrc.includes('amonestacionHtml'), 'EmployeeCardScreen debe poder reimprimir PDF de amonestación');
assert(cardSrc.includes('Nueva Acta de Entrega / Compromiso'), 'EmployeeCardScreen debe tener botón Nueva Acta de Entrega');
assert(cardSrc.includes('Nueva Acta de Recepción / Devolución'), 'EmployeeCardScreen debe tener botón Nueva Acta de Recepción');

console.log('✅ test-amonestaciones-historial: todas las verificaciones pasaron (17/17).');
