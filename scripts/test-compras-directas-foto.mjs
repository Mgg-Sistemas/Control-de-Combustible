import assert from 'assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

console.log('🧪 Iniciando pruebas de Foto de Producto en Compras Directas...');

const {
  empaquetarNotaConFotoProducto,
  limpiarNotaFotoProducto,
  extraerFotoProducto,
} = await import('../src/lib/comprasDirectas.ts');

// 1. Probar empaquetado y limpieza
const notaInicial = 'Repuesto comprado de emergencia en ferretería';
const foto = {
  url: 'https://storage.supabase.co/machinery/compras-directas/123/foto_repuesto.jpg',
  name: 'Empacadura y rolinera 6205',
};

const notaConFoto = empaquetarNotaConFotoProducto(notaInicial, foto);
assert.ok(notaConFoto.includes('[FOTO PRODUCTO: Url: https://storage.supabase.co/machinery/compras-directas/123/foto_repuesto.jpg | Nombre: Empacadura y rolinera 6205]'));
console.log('✅ Test 1 pasado: Foto empaquetada en la nota correctamente.');

// 2. Probar limpieza de la nota
const notaLimpia = limpiarNotaFotoProducto(notaConFoto);
assert.strictEqual(notaLimpia, notaInicial);
console.log('✅ Test 2 pasado: La nota se limpia correctamente para la visualización del usuario.');

// 3. Probar extracción desde la nota
const fotoExtraidaNota = extraerFotoProducto({ note: notaConFoto });
assert.ok(fotoExtraidaNota);
assert.strictEqual(fotoExtraidaNota.url, foto.url);
assert.strictEqual(fotoExtraidaNota.name, foto.name);
console.log('✅ Test 3 pasado: Foto extraída correctamente desde las notas.');

// 4. Probar extracción desde items JSONB
const compraConFotoEnItem = {
  items: [
    { description: 'CORREA 8PK', qty: 2, price: 15, unit: 'UND', image_url: 'https://storage.supabase.co/machinery/correa.jpg' },
  ],
};
const fotoExtraidaItem = extraerFotoProducto(compraConFotoEnItem);
assert.ok(fotoExtraidaItem);
assert.strictEqual(fotoExtraidaItem.url, 'https://storage.supabase.co/machinery/correa.jpg');
console.log('✅ Test 4 pasado: Foto extraída correctamente desde items JSONB.');

// 5. Probar extracción cuando no hay foto
const compraSinFoto = { note: 'Solo notas normales sin fotos' };
assert.strictEqual(extraerFotoProducto(compraSinFoto), null);
console.log('✅ Test 5 pasado: Retorna null cuando no hay foto.');

console.log('🎉 TODAS LAS PRUEBAS DE FOTO DE PRODUCTO EN COMPRAS DIRECTAS PASARON AL 100%.');
