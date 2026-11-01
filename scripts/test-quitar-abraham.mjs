import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('🧪 Iniciando pruebas de verificación: Eliminación del nombre Abraham...');

const files = [
  'src/screens/RequerimientoTab.tsx',
  'src/screens/SolicitudesCompraTab.tsx',
  'src/lib/requerimientoExpediente.ts',
  'src/screens/SolicitudMaterialScreen.tsx',
  'src/types/database.ts',
];

for (const f of files) {
  const content = fs.readFileSync(path.resolve(f), 'utf8');
  assert(!/abraham/i.test(content), `El archivo ${f} no debe contener ninguna referencia a Abraham`);
}

// Verificar que los botones y títulos quedaron limpios
const reqContent = fs.readFileSync(path.resolve('src/screens/RequerimientoTab.tsx'), 'utf8');
assert(reqContent.includes('Factura Fiscal / Comercial'), 'Debe contener Factura Fiscal / Comercial');
assert(!reqContent.includes('Factura Fiscal / Comercial (Abraham)'), 'No debe contener (Abraham)');
assert(reqContent.includes('Subir Factura'), 'Debe contener Subir Factura');
assert(!reqContent.includes('Subir Factura (Abraham)'), 'No debe contener Subir Factura (Abraham)');
assert(reqContent.includes('Sin factura cargada todavía.'), 'Debe contener Sin factura cargada todavía.');

console.log('✅ Verificación completada: 0 referencias a Abraham encontradas.');
