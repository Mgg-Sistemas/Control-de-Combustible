import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('🧪 Iniciando pruebas de verificación: Minúsculas en Métodos de Pago y Billetera Digital...');

const fontsPath = path.resolve('src/lib/fonts.ts');
const comprasPath = path.resolve('src/screens/ComprasScreen.tsx');
const reqPath = path.resolve('src/screens/RequerimientoTab.tsx');

const fonts = fs.readFileSync(fontsPath, 'utf8');
const compras = fs.readFileSync(comprasPath, 'utf8');
const req = fs.readFileSync(reqPath, 'utf8');

// 1. Verificar exportación de rawCaseField en fonts.ts
assert(fonts.includes('export const rawCaseField: any = Platform.OS === \'web\' ? { dataSet: { rawcase: \'1\' } } : {};'),
  'fonts.ts debe exportar rawCaseField para react-native-web');

// 2. Verificar regla CSS de excepción para no forzar mayúsculas
assert(fonts.includes('[data-rawcase]'), 'fonts.ts debe incluir selector [data-rawcase]');
assert(fonts.includes('.r-textTransform-none'), 'fonts.ts debe incluir selector .r-textTransform-none');
assert(fonts.includes('input[type="email"]'), 'fonts.ts debe incluir selector input[type="email"]');
assert(fonts.includes('text-transform: none !important;'), 'fonts.ts debe aplicar text-transform: none !important');

// 3. Verificar ComprasScreen.tsx
assert(compras.includes("import { rawCaseField } from '../lib/fonts';"), 'ComprasScreen debe importar rawCaseField');
assert(compras.includes('value={binanceId} onChangeText={setBinanceId}'), 'ComprasScreen debe tener input binanceId');
assert(compras.includes('{...rawCaseField} autoCapitalize="none"'), 'ComprasScreen binanceId debe tener rawCaseField y autoCapitalize none');
assert(compras.includes('value={paymentNotes} onChangeText={setPaymentNotes}'), 'ComprasScreen debe tener input paymentNotes');
assert(compras.includes('value={email} onChangeText={setEmail}'), 'ComprasScreen debe tener input email');

// 4. Verificar RequerimientoTab.tsx
assert(req.includes("import { rawCaseField } from '../lib/fonts';"), 'RequerimientoTab debe importar rawCaseField');
assert(req.includes('value={provBinanceId} onChangeText={setProvBinanceId}'), 'RequerimientoTab debe tener input provBinanceId');
assert(req.includes('value={provNotasPago} onChangeText={setProvNotasPago}'), 'RequerimientoTab debe tener input provNotasPago');

console.log('✅ Todas las pruebas de soporte de minúsculas pasaron exitosamente.');
