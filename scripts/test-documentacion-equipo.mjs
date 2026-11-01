import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

test('EquiposScreen tiene boton y modal de Documentacion por maquinaria', () => {
  const eqFile = path.resolve(ROOT, 'src/screens/EquiposScreen.tsx');
  const code = fs.readFileSync(eqFile, 'utf8');

  // 1. Botón en tarjetas
  assert.match(code, /label="📁 Documentación"/, 'Debe tener el boton de Documentacion');
  assert.match(code, /abrirDocumentacion/, 'Debe llamar a abrirDocumentacion');

  // 2. Estados y lógica de carga
  assert.match(code, /docMachine/, 'Debe tener estado docMachine');
  assert.match(code, /docTab/, 'Debe tener estado docTab');
  assert.match(code, /docActas/, 'Debe tener estado docActas');
  assert.match(code, /docTraslados/, 'Debe tener estado docTraslados');

  // 3. Modal de documentacion
  assert.match(code, /MODAL DE DOCUMENTACIÓN DE LA MAQUINARIA/, 'Debe tener modal de documentacion');
  assert.match(code, /ActaRecepcion/, 'Debe permitir navegar a nueva Acta de Recepcion');
  assert.match(code, /TrasladoMaquinaria/, 'Debe permitir navegar a nuevo Traslado');
  assert.match(code, /fichaTecnica/, 'Debe permitir ver ficha tecnica');
});

test('ActaRecepcionScreen cumple regla de maquinaria (Código + PLACA + Buscador) y checklist dinamico', () => {
  const file = path.resolve(ROOT, 'src/screens/ActaRecepcionScreen.tsx');
  const code = fs.readFileSync(file, 'utf8');

  // 1. Selector con buscador
  assert.match(code, /busquedaMaq/, 'Debe tener buscador de maquinaria');
  assert.match(code, /m\.code/, 'Debe mostrar codigo');
  assert.match(code, /m\.plate/, 'Debe mostrar placa');

  // 2. Campo de placa destacado
  assert.match(code, /PLACA DE LA MAQUINARIA/, 'Debe tener campo de placa destacado');

  // 3. Checklist dinámico
  assert.match(code, /agregarComponenteChecklist/, 'Debe permitir agregar componentes');
  assert.match(code, /eliminarComponenteChecklist/, 'Debe permitir eliminar componentes');

  // 4. Visibilidad configurable (chofer, inspector, etc.)
  assert.match(code, /mostrarChofer/, 'Debe permitir activar/quitar chofer');
  assert.match(code, /mostrarInspector/, 'Debe permitir activar/quitar inspector');

  // 5. Anexo fotográfico
  assert.match(code, /tomarOAdjuntarFoto/, 'Debe permitir adjuntar fotos');
  assert.match(code, /eliminarFoto/, 'Debe permitir eliminar fotos');
});
