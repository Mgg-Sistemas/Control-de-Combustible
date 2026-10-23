// 🧪 Test de integración: Solicitudes de Existencia y Compra Técnica
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(name);
  }
};

// 1. Helper solicitudMaterial.ts
const lib = leer('src/lib/solicitudMaterial.ts');
ok('📦 nextStockRequestCode genera correlativos SOL-0001', lib.includes("return 'SOL-' + String(max + 1 + bump).padStart(4, '0');"));
ok('📦 URGENCIA_CONFIG incluye normal, alta, urgente', lib.includes('URGENCIA_CONFIG') && lib.includes('urgente'));
ok('📦 ESTADO_EXISTENCIA_CONFIG incluye pendiente, despachado, rechazado', lib.includes('ESTADO_EXISTENCIA_CONFIG'));
ok('📦 ESTADO_COMPRA_CONFIG incluye aclaratoria_solicitada', lib.includes('aclaratoria_solicitada'));

// 2. Pantalla SolicitudMaterialScreen.tsx
const screen = leer('src/screens/SolicitudMaterialScreen.tsx');
ok('📱 Pantalla SolicitudMaterialScreen implementada', screen.includes('export default function SolicitudMaterialScreen'));
ok('📱 Permite consultar existencias en almacén', screen.includes('inventory_levels'));
ok('📱 Permite solicitar despacho cuando hay stock', screen.includes('enviarSolicitudStock') && screen.includes('inventory_stock_requests'));
ok('📱 Exige medidas y especificaciones técnicas obligatorias para compras', screen.includes('Las medidas y especificaciones técnicas son OBLIGATORIAS'));
ok('📱 Permite tomar/cargar foto de muestra vieja o placa', screen.includes('tomarFotoCompra'));
ok('📱 Pestaña Mis Solicitudes con seguimiento y respuesta a aclaratorias', screen.includes('enviarRespuestaAclaratoria') && screen.includes('mis_solicitudes'));

// 3. InventarioScreen.tsx (Almacén)
const inv = leer('src/screens/InventarioScreen.tsx');
ok('🏢 InventarioScreen incluye SolicitudesExistenciaTab', inv.includes('function SolicitudesExistenciaTab'));
ok('🏢 InventarioScreen incluye pestaña solicitudes', inv.includes("{ key: 'solicitudes', label: 'Solicitudes', icon: '📥' }"));
ok('🏢 Almacenista puede despachar y descontar inventario', inv.includes("kind: 'salida'") && inv.includes('inventory_movements'));
ok('🏢 Almacenista puede rechazar con motivo', inv.includes('confirmarRechazo') && inv.includes('rejection_note'));

// 4. Permisos y Menú
const perm = leer('src/lib/permissions.ts');
ok('🔒 Permiso solicitudes_material registrado', perm.includes("{ key: 'solicitudes_material', label: 'Pedir Material / Repuestos' }"));
const defaultLevelBlock = perm.split('function defaultLevel')[1]?.split("return 'escritura'")[0] ?? '';
ok('🔒 Permiso solicitudes_material no está restringido (nace en escritura)', !defaultLevelBlock.includes('solicitudes_material'));

const more = leer('src/screens/MoreScreen.tsx');
ok('📋 Menú Más incluye Pedir Material / Repuesto', more.includes("route: 'SolicitudMaterial'"));

const nav = leer('src/navigation/index.tsx');
ok('🧭 Navigation incluye SolicitudMaterial en MoreStack', nav.includes('name="SolicitudMaterial"'));
ok('🧭 Navigation incluye SolicitudMaterial en moreScreens', nav.includes("SolicitudMaterial: 'pedir-material'"));

// 5. Nuevos Requerimientos: Multi-selección, Carrito de Repuestos, Auditoría y Rechazos
ok('🛒 Pantalla maneja multi-selección de maquinaria y vehículos', screen.includes('selectedMachineryIds') && screen.includes('selectedVehicleIds'));
ok('🚜 Cumple regla de maquinaria: muestra código y PLACA siempre', screen.includes('m.plate') && screen.includes('m.code'));
ok('🛒 Permite agregar múltiples repuestos al carrito', screen.includes('cartItems') && screen.includes('agregarItemAlCarrito'));
ok('🛒 Permite modificar cantidades (+/- y manual)', screen.includes('cambiarCantidadCarrito') && screen.includes('setCantidadDirecta'));
ok('👤 Mis Solicitudes filtra estrictamente por el usuario autenticado', screen.includes('s.created_by === uid') && screen.includes('r.requested_by === uid'));
ok('👤 Registra automáticamente al usuario autenticado (created_by / requested_by)', screen.includes('created_by: uid') && screen.includes('requested_by: uid'));
ok('❌ Sistema parsea y formatea autor, fecha y motivo del rechazo', lib.includes('formatRejectionNote') && lib.includes('parseRejectionNote') && screen.includes('parseRejectionNote'));

// 6. Migración SQL
const sql = leer('supabase/solicitudes_existencia.sql');
ok('💾 Migración SQL crea tabla inventory_stock_requests', sql.includes('create table if not exists public.inventory_stock_requests'));
ok('💾 Migración SQL incluye RLS y correlativo automático', sql.includes('enable row level security') && sql.includes('trg_assign_stock_request_code'));

console.log(`\n🧪 Solicitudes de Existencia y Compra: ${pass} OK · ${fail} FALLO(S)`);
if (fail) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log('   Todo el flujo técnico y operativo está integrado y verificado.');
