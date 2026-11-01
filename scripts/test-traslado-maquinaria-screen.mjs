import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

test('TrasladoMaquinariaScreen cumple regla de maquinaria: código + PLACA + buscador', () => {
  const file = path.resolve(ROOT, 'src/screens/TrasladoMaquinariaScreen.tsx');
  const code = fs.readFileSync(file, 'utf8');

  // 1. Selector modal tiene buscador
  assert.match(code, /busquedaMaq/, 'Debe tener estado de búsqueda para maquinaria');
  assert.match(code, /TextInput[\s\S]*?busquedaMaq/, 'Debe tener TextInput de búsqueda');

  // 2. Muestra código y placa obligatoria
  assert.match(code, /m\.code/, 'Debe mostrar código de la máquina');
  assert.match(code, /m\.plate/, 'Debe mostrar placa de la máquina');

  // 3. Identificación en el formulario tiene campo de placa destacado
  assert.match(code, /PLACA DE LA MAQUINARIA/, 'Debe tener etiqueta destacada para la placa');
  assert.match(code, /maqPlaca/, 'Debe tener estado de placa');

  // 4. Historial muestra código y placa
  assert.match(code, /m\?\.placa/, 'Historial debe mostrar placa');

  // 5. Soporta modo salida simple y flete
  assert.match(code, /aplicaServicio/, 'Debe soportar si aplica o no flete');
  assert.match(code, /monto_fijo/, 'Debe soportar monto fijo');
  assert.match(code, /por_jornada/, 'Debe soportar flete por jornada');
});

test('Navegación y menús tienen TrasladoMaquinaria registrado', () => {
  const navCode = fs.readFileSync(path.resolve(ROOT, 'src/navigation/index.tsx'), 'utf8');
  assert.match(navCode, /TrasladoMaquinariaScreen/, 'Debe importar TrasladoMaquinariaScreen');
  assert.match(navCode, /name="TrasladoMaquinaria"/, 'Debe registrar Stack.Screen TrasladoMaquinaria');
  assert.match(navCode, /TrasladoMaquinaria:\s*'traslados-maquinaria'/, 'Debe tener linking');

  const moreCode = fs.readFileSync(path.resolve(ROOT, 'src/screens/MoreScreen.tsx'), 'utf8');
  assert.match(moreCode, /route:\s*'TrasladoMaquinaria'/, 'MoreScreen debe tener TrasladoMaquinaria');

  const eqCode = fs.readFileSync(path.resolve(ROOT, 'src/screens/EquiposScreen.tsx'), 'utf8');
  assert.match(eqCode, /navigate\('TrasladoMaquinaria'/, 'EquiposScreen debe tener acceso directo a TrasladoMaquinaria');
});
