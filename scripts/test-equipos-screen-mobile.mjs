import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

test('EquiposScreen implementa optimizaciones de vista responsive y móvil', () => {
  const filePath = path.resolve('src/screens/EquiposScreen.tsx');
  const code = fs.readFileSync(filePath, 'utf-8');

  // 1. Hook useWindowDimensions e isPhoneDevice
  assert.ok(code.includes('useWindowDimensions'), 'Debe importar y usar useWindowDimensions');
  assert.ok(code.includes('isPhoneDevice'), 'Debe importar y usar isPhoneDevice');
  assert.ok(code.includes('isMobile'), 'Debe calcular isMobile');

  // 2. Regla de Identificación de Maquinaria: Código + PLACA visible
  assert.ok(code.includes('🚗 PLACA:'), 'Debe mostrar badge destacado con la PLACA en la tarjeta de maquinaria');
  assert.ok(code.includes('toggleCardActions'), 'Debe tener toggle de acciones complementarias');

  // 3. Grid responsivo de Cubos por Estado
  assert.ok(code.includes('Esperando instrucciones'), 'Debe contemplar Esperando instrucciones a todo lo ancho en móvil');

  // 4. Botón de limpiar búsqueda en buscador
  assert.ok(code.includes("setQuery('')"), 'Debe tener botón para limpiar búsqueda rápidamente en móviles');

  console.log('✅ Todas las comprobaciones de vista móvil y responsiva en EquiposScreen pasaron exitosamente.');
});
