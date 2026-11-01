// 🧪 Test de Proveedores (Foto/Captura TRX/Tron/QR) y Permisos de Vista de Inicio
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

console.log('🧪 Iniciando pruebas de Captura de Pago de Proveedor y Permisos de Inicio...');

let pass = 0;
let fail = 0;
function assert(name, condition) {
  if (condition) {
    console.log(`✅ ${name}`);
    pass++;
  } else {
    console.error(`❌ FALLÓ: ${name}`);
    fail++;
  }
}

// 1. Probar funciones de proveedorPago.ts
const {
  extraerCapturaPago,
  limpiarNotasUsuario,
  empaquetarNotasConCaptura,
} = await import('../src/lib/proveedorPago.ts');

// Test 1: Empaquetar y extraer captura
const notesUser = 'Pagar únicamente antes de las 12pm';
const trxUrl = 'https://storage.supabase.co/machinery/proveedores/123/trx-tron.jpg';
const trxName = 'Wallet Tron TRX (TRC-20)';

const packed = empaquetarNotasConCaptura(notesUser, trxUrl, trxName);
assert('Notas empaquetadas contienen el tag [CAPTURA_PAGO:]', packed.includes('[CAPTURA_PAGO:'));

const extracted = extraerCapturaPago({ payment_notes: packed });
assert('Captura extraída tiene la URL correcta', extracted?.url === trxUrl);
assert('Captura extraída tiene el nombre de red TRX correcto', extracted?.name === trxName);

const cleaned = limpiarNotasUsuario(packed);
assert('Notas limpiadas devuelven solo el texto del usuario', cleaned === notesUser);

// Test 2: Quitar captura
const packedWithoutPhoto = empaquetarNotasConCaptura(notesUser, null, null);
assert('Empaquetar sin foto elimina el tag', !packedWithoutPhoto?.includes('[CAPTURA_PAGO:'));
assert('Empaquetar sin foto mantiene las notas del usuario', packedWithoutPhoto === notesUser);

// Test 3: Extracción desde columna nativa si estuviera presente
const nativeSupplier = {
  payment_photo_url: 'https://cdn.com/tron.png',
  payment_photo_name: 'QR Billetera TRC-20',
  payment_notes: 'Texto suelto',
};
const extractedNative = extraerCapturaPago(nativeSupplier);
assert('Extracción prioriza columna nativa si existe', extractedNative?.url === 'https://cdn.com/tron.png');

// Test 4: Verificar que MODULES en permissions.ts contiene 'inicio'
const permissionsContent = fs.readFileSync(path.join(ROOT, 'src/lib/permissions.ts'), 'utf8');
assert("permissions.ts contiene módulo 'inicio'", permissionsContent.includes("key: 'inicio'"));

// Test 5: Verificar que navigation/index.tsx usa canSee('inicio')
const navContent = fs.readFileSync(path.join(ROOT, 'src/navigation/index.tsx'), 'utf8');
assert("navigation/index.tsx protege Tab.Screen de Dashboard con canSee('inicio')", navContent.includes("canSee('inicio') ? ("));
assert("navigation/index.tsx ajusta tabsHomeRoute con canSee('inicio')", navContent.includes("puedeInicio"));

// Test 6: Verificar que DashboardScreen.tsx contiene el guardrail de acceso
const dashContent = fs.readFileSync(path.join(ROOT, 'src/screens/DashboardScreen.tsx'), 'utf8');
assert("DashboardScreen.tsx tiene guardia defensiva con canSee('inicio')", dashContent.includes("!canSee('inicio')"));

console.log(`\n🎉 Pruebas concluidas: ${pass} pasaron, ${fail} fallaron.`);
if (fail > 0) process.exit(1);
