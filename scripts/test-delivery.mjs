// 🛵 DELIVERY · Fase 1 (09-nov-2026), adaptado de MGG / Golden Touch. Reglas puras + cableado.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ts = require('typescript');
const Module = require('module');
function loadTs(abs) {
  const out = ts.transpileModule(fs.readFileSync(abs, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
  const m = new Module(abs); m.filename = abs; m.paths = Module._nodeModulePaths(path.dirname(abs)); m._compile(out, abs); return m.exports;
}
let ok = 0; const fallas = [];
const check = (c, m, x) => { if (c) ok++; else fallas.push('  ✗ ' + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };
const eq = (a, b, m) => check(JSON.stringify(a) === JSON.stringify(b), m, { esperado: b, obtenido: a });

const D = loadTs(path.join(ROOT, 'src/lib/delivery.ts'));
const base = (o) => ({ requerimiento_id: 'r', codigo: 'REQ-0200', titulo: 'Paños', prioridad: null, items: [{ name: 'paños de microfibra', qty: 12, unit: 'UND' }], estado: 'por_tomar', ...o });

// Normalizar lo que manda la base
const L = D.normalizarListado({ activo: true, ver_monto: false, supervisa: false, motorizado: true, pedidos: [
  base({ requerimiento_id: 'a', monto: null }),
  base({ requerimiento_id: 'b', prioridad: 'urgente', monto: '125.5' }),
  base({ requerimiento_id: 'c', estado: 'aceptado', es_mio: true, fotos_recibo: ['https://x/1.jpg', null, 7] }),
  base({ requerimiento_id: 'd', estado: 'entregado', entregado_en: '2026-11-09T15:00:00Z' }),
  base({ requerimiento_id: 'e', estado: 'raro' }),
] });
eq(L.pedidos.map((p) => p.estado), ['por_tomar', 'por_tomar', 'aceptado', 'entregado', 'por_tomar'], 'un estado desconocido cae en «Por buscar» (nunca rompe)');
eq([L.pedidos[0].monto, L.pedidos[1].monto], [null, 125.5], '⭐ el monto oculto llega null (no se muestra); el visible se lee aunque venga en texto');
eq(L.pedidos[2].fotos_recibo, ['https://x/1.jpg'], 'fotos: solo los enlaces válidos');
const S = D.separar(L.pedidos);
eq([S.porBuscar.length, S.enCurso.length, S.cerrados.length], [3, 1, 1], 'las tres listas: por buscar / en curso / hechos');
eq(S.porBuscar[0].requerimiento_id, 'b', '⭐ los URGENTES primero');

// Mensajes
const t = D.mensajeTomado(L.pedidos[1], 'Daniel Machado', '2026-11-09T15:00:00Z');
check(t.includes('PEDIDO TOMADO') && t.includes('URGENTE') && t.includes('Daniel Machado') && t.includes('paños de microfibra — 12 UND') && t.includes('SOS LA GUAIRA'), '⭐ mensaje de WhatsApp al tomar (prioridad, delivery, productos, firma SOS)');
check(!/️/.test(t), 'sin el selector U+FE0F (los emojis salen bien en WhatsApp)');
check(!t.includes('125'), '⭐ el mensaje NUNCA lleva el monto');
const ent = D.mensajeEntregado({ ...L.pedidos[2], aceptado_en: '2026-11-09T14:00:00Z' }, 'Daniel', 'Almacén principal', 'lo recibió Pedro', 2, '2026-11-09T14:45:00Z');
check(ent.includes('Almacén principal') && ent.includes('45 min') && ent.includes('📷 *Fotos de la entrega:* 2'), 'mensaje de entrega con almacén, fotos y tiempo');
check(D.mensajeCancelado(L.pedidos[0], 'Daniel', 'Avería del vehículo').includes('queda disponible para otro'), 'al cancelar avisa que queda libre');

// Validaciones
eq(D.revisarEntrega('  '), 'Escribe en qué almacén lo entregaste.', 'entregar exige el almacén');
eq(D.revisarCancelacion('', ''), 'Elige el motivo de la cancelación.', 'cancelar exige motivo');
eq(D.revisarCancelacion('Otro motivo', ''), 'Escribe cuál es el otro motivo.', '«Otro motivo» exige escribirlo');
eq(D.revisarCancelacion('Avería del vehículo', ''), null, 'un motivo de la lista basta');

// Enlaces
eq(D.enlaceLlamar('0414-123.45.67'), 'tel:04141234567', 'llamar: solo dígitos');
eq(D.enlaceLlamar('12'), null, 'teléfono muy corto: sin botón');
eq(D.enlaceWhatsApp('0414-1234567'), 'https://wa.me/584141234567', '⭐ WhatsApp: 0414… → 58414…');
check(D.enlaceWhatsApp(null, 'hola').startsWith('https://wa.me/?text=hola'), 'WhatsApp sin número = elegir el chat');
check(D.enlaceMapa('Av. Soublette, La Guaira', 'Ferretería X').includes('maps/search') && D.enlaceMapa('', 'X') === null, 'mapa con la dirección; sin dirección no hay botón');

// Resumen por delivery
const R = D.resumenPorDelivery([
  { ...base({ estado: 'entregado' }), repartidor_nombre: 'Daniel', aceptado_en: '2026-11-09T10:00:00Z', entregado_en: '2026-11-09T10:40:00Z' },
  { ...base({ estado: 'entregado' }), repartidor_nombre: 'Daniel', aceptado_en: '2026-11-09T11:00:00Z', entregado_en: '2026-11-09T11:20:00Z' },
  { ...base({ estado: 'cancelado' }), repartidor_nombre: null, ultimo_cancelado: { por: 'Gregory' } },
  { ...base({ estado: 'aceptado' }), repartidor_nombre: 'Gregory' },
]);
eq(R, [{ repartidor: 'Daniel', entregados: 2, cancelados: 0, enCurso: 0, minutosPromedio: 30 }, { repartidor: 'Gregory', entregados: 0, cancelados: 1, enCurso: 1, minutosPromedio: null }], '⭐ por delivery: entregados, cancelados, en curso y tiempo promedio');

// Cableado
const perm = fs.readFileSync(path.join(ROOT, 'src/lib/permissions.ts'), 'utf8');
check(/\{ key: 'delivery', label: 'Delivery \(motorizados\)' \}/.test(perm) && /moduleKey === 'delivery'\) return 'none';/.test(perm), '⭐ el permiso «Delivery» existe y NACE CERRADO (igual que en la base)');
const nav = fs.readFileSync(path.join(ROOT, 'src/navigation/index.tsx'), 'utf8');
check(/<Stack\.Screen name="Delivery" component=\{DeliveryScreen\}/.test(nav) && /esRolDelivery\(appRole\)\) return \{ key: 'delivery', node: <DeliveryStack \/> \}/.test(nav), 'ruta en «Más» y entrada DIRECTA para un rol solo-Delivery');
const mas = fs.readFileSync(path.join(ROOT, 'src/screens/MoreScreen.tsx'), 'utf8');
check(/route: 'Delivery'.*module: 'delivery'/.test(mas), 'tarjeta en «Más» con el permiso delivery');
const scr = fs.readFileSync(path.join(ROOT, 'src/screens/DeliveryScreen.tsx'), 'utf8');
check(/captureAndUploadPhoto/.test(scr) && /pickPhotoFromGalleryAndUpload/.test(scr), '⭐ fotos con cámara Y galería (regla de la casa)');
check(/enVuelo\.current/.test(scr) && /toast\.error\(e\?\.message/.test(scr), 'doble toque protegido y los errores se dicen');
check(!/from\('delivery_pedidos'\)\.(insert|update|delete)/.test(scr + fs.readFileSync(path.join(ROOT, 'src/lib/deliveryDb.ts'), 'utf8')), '⭐ nada escribe la tabla directo: todo pasa por las funciones de la base');
const req = fs.readFileSync(path.join(ROOT, 'src/screens/RequerimientoTab.tsx'), 'utf8');
check(/🛵 Delivery: \{et\.emoji\} \{et\.label\}/.test(req), 'Compras ve en qué paso va el delivery de cada requerimiento aprobado');
const aud = fs.readFileSync(path.join(ROOT, 'src/lib/auditModulos.ts'), 'utf8');
check(/delivery_pedidos: 'delivery'/.test(aud), 'la auditoría lo pone en «Delivery de compras»');

if (fallas.length) { console.error(fallas.join('\n')); console.error(`\n❌ test-delivery: ${fallas.length} falla(s), ${ok} ok`); process.exit(1); }
console.log(`✅ test-delivery: ${ok} ok, 0 fallas`);
