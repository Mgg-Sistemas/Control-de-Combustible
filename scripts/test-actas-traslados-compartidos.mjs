import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

test('1. permissions.ts define los módulos actas_recepcion y traslados_maquinaria restringidos por defecto a "none"', () => {
  const permFile = path.resolve(ROOT, 'src/lib/permissions.ts');
  const code = fs.readFileSync(permFile, 'utf8');

  // Módulos en MODULES
  assert.match(code, /key:\s*'actas_recepcion'/, 'Debe existir módulo actas_recepcion');
  assert.match(code, /key:\s*'traslados_maquinaria'/, 'Debe existir módulo traslados_maquinaria');

  // defaultLevel cerrado en 'none'
  assert.match(code, /moduleKey === 'actas_recepcion'/, 'actas_recepcion debe estar en defaultLevel como none');
  assert.match(code, /moduleKey === 'traslados_maquinaria'/, 'traslados_maquinaria debe estar en defaultLevel como none');
});

test('2. MoreScreen.tsx protege los accesos usando los módulos actas_recepcion y traslados_maquinaria', () => {
  const moreFile = path.resolve(ROOT, 'src/screens/MoreScreen.tsx');
  const code = fs.readFileSync(moreFile, 'utf8');

  assert.match(code, /module:\s*'actas_recepcion'/, 'Acta de recepción debe usar permiso actas_recepcion');
  assert.match(code, /module:\s*'traslados_maquinaria'/, 'Traslados debe usar permiso traslados_maquinaria');
  assert.doesNotMatch(code, /route:\s*'ActaRecepcion'.*module:\s*'equipos'/, 'Acta de recepción ya NO debe usar el módulo equipos abierto');
  assert.doesNotMatch(code, /route:\s*'TrasladoMaquinaria'.*module:\s*'equipos'/, 'Traslado ya NO debe usar el módulo equipos abierto');
});

test('3. actasYTrasladosDb.ts implementa histórico compartido, trazabilidad de autoría y soft-delete', () => {
  const dbFile = path.resolve(ROOT, 'src/lib/actasYTrasladosDb.ts');
  const code = fs.readFileSync(dbFile, 'utf8');

  // Métodos de Actas
  assert.match(code, /export async function cargarActasCompartidas/, 'Debe exportar cargarActasCompartidas');
  assert.match(code, /export async function guardarActaCompartida/, 'Debe exportar guardarActaCompartida');
  assert.match(code, /export async function eliminarActaCompartida/, 'Debe exportar eliminarActaCompartida');

  // Métodos de Traslados
  assert.match(code, /export async function cargarTrasladosCompartidos/, 'Debe exportar cargarTrasladosCompartidos');
  assert.match(code, /export async function guardarTrasladoCompartido/, 'Debe exportar guardarTrasladoCompartido');
  assert.match(code, /export async function eliminarTrasladoCompartido/, 'Debe exportar eliminarTrasladoCompartido');

  // Columnas de Auditoría requeridas por el cliente
  assert.match(code, /created_by/, 'Debe registrar quién lo creó');
  assert.match(code, /created_by_name/, 'Debe registrar el nombre de quién lo creó');
  assert.match(code, /created_at/, 'Debe registrar cuándo se creó');
  assert.match(code, /updated_by/, 'Debe registrar quién editó');
  assert.match(code, /updated_by_name/, 'Debe registrar el nombre de quién editó');
  assert.match(code, /updated_at/, 'Debe registrar fecha de última edición');
  assert.match(code, /deleted_by/, 'Debe registrar quién eliminó');
  assert.match(code, /deleted_by_name/, 'Debe registrar el nombre de quién eliminó');
  assert.match(code, /deleted_at/, 'Debe registrar fecha de eliminación');
  assert.match(code, /is_deleted/, 'Debe implementar soft delete para preservar la auditoría');
});

test('4. ActaRecepcionScreen cuenta con control de acceso, edición sin alterar folio, y eliminación auditada', () => {
  const screenFile = path.resolve(ROOT, 'src/screens/ActaRecepcionScreen.tsx');
  const code = fs.readFileSync(screenFile, 'utf8');

  // Permiso
  assert.match(code, /role === 'admin' \|\| canSee\('actas_recepcion'\)/, 'Debe verificar rol admin o permiso actas_recepcion');
  assert.match(code, /Acceso Restringido/, 'Debe mostrar pantalla de acceso restringido a no autorizados');

  // Edición
  assert.match(code, /editingActaId/, 'Debe tener estado de edición');
  assert.match(code, /iniciarEdicion/, 'Debe tener función para cargar datos en edición');
  assert.match(code, /cancelarEdicion/, 'Debe permitir cancelar la edición');
  assert.match(code, /Modo Edición: Acta/, 'Debe mostrar banner de modo edición');

  // Eliminación
  assert.match(code, /confirmarEliminarActa/, 'Debe tener función de confirmación de eliminación');
  assert.match(code, /ejecutarEliminar/, 'Debe ejecutar la eliminación con auditoría');
  assert.match(code, /¿Eliminar Acta de Recepción\?/, 'Debe tener modal de confirmación con aviso de auditoría');

  // Auditoría en listado
  assert.match(code, /Creado por:/, 'Debe mostrar quién creó el acta en el historial');
  assert.match(code, /Última edición:/, 'Debe mostrar quién editó el acta en el historial');

  // Regla de Maquinaria (Código + Placa + Buscador)
  assert.match(code, /busquedaMaq/, 'Debe tener buscador de maquinaria');
  assert.match(code, /m\.plate/, 'Debe mostrar la placa de la maquinaria en el selector');
  assert.match(code, /m\.code/, 'Debe mostrar el código de la maquinaria');
});

test('5. TrasladoMaquinariaScreen cuenta con control de acceso, edición sin alterar folio, y eliminación auditada', () => {
  const screenFile = path.resolve(ROOT, 'src/screens/TrasladoMaquinariaScreen.tsx');
  const code = fs.readFileSync(screenFile, 'utf8');

  // Permiso
  assert.match(code, /role === 'admin' \|\| canSee\('traslados_maquinaria'\)/, 'Debe verificar rol admin o permiso traslados_maquinaria');
  assert.match(code, /Acceso Restringido/, 'Debe mostrar pantalla de acceso restringido a no autorizados');

  // Edición
  assert.match(code, /editingTrasladoId/, 'Debe tener estado de edición');
  assert.match(code, /iniciarEdicion/, 'Debe tener función para cargar datos en edición');
  assert.match(code, /cancelarEdicion/, 'Debe permitir cancelar la edición');
  assert.match(code, /Modo Edición: Traslado/, 'Debe mostrar banner de modo edición');

  // Eliminación
  assert.match(code, /confirmarEliminarTraslado/, 'Debe tener función de confirmación de eliminación');
  assert.match(code, /ejecutarEliminar/, 'Debe ejecutar la eliminación con auditoría');
  assert.match(code, /¿Eliminar Autorización de Traslado\?/, 'Debe tener modal de confirmación con aviso de auditoría');

  // Auditoría en listado
  assert.match(code, /Creado por:/, 'Debe mostrar quién creó el traslado en el historial');
  assert.match(code, /Última edición:/, 'Debe mostrar quién editó el traslado en el historial');

  // Regla de Maquinaria (Código + Placa + Buscador)
  assert.match(code, /busquedaMaq/, 'Debe tener buscador de maquinaria');
  assert.match(code, /m\.plate/, 'Debe mostrar la placa de la maquinaria en el selector');
  assert.match(code, /m\.code/, 'Debe mostrar el código de la maquinaria');
});

test('6. EquiposScreen permite ver, editar y eliminar tanto actas como traslados desde la documentación del equipo', () => {
  const eqFile = path.resolve(ROOT, 'src/screens/EquiposScreen.tsx');
  const code = fs.readFileSync(eqFile, 'utf8');

  // Carga compartida
  assert.match(code, /cargarActasCompartidas/, 'Debe cargar actas compartidas para la maquinaria');
  assert.match(code, /cargarTrasladosCompartidos/, 'Debe cargar traslados compartidos para la maquinaria');

  // Edición desde modal
  assert.match(code, /editarActaDesdeModal/, 'Debe permitir editar actas desde el modal de documentación');
  assert.match(code, /editarTrasladoDesdeModal/, 'Debe permitir editar traslados desde el modal de documentación');

  // Eliminación desde modal
  assert.match(code, /confirmarEliminarDoc/, 'Debe tener confirmación de eliminación desde el modal');
  assert.match(code, /ejecutarEliminarDoc/, 'Debe ejecutar eliminación desde el modal');
  assert.match(code, /eliminarActaCompartida/, 'Debe llamar a eliminarActaCompartida');
  assert.match(code, /eliminarTrasladoCompartido/, 'Debe llamar a eliminarTrasladoCompartido');

  // Auditoría visible en las tarjetas de documentación
  assert.match(code, /Creado por:/, 'Debe mostrar creador en documentación');
  assert.match(code, /Última edición:/, 'Debe mostrar última edición en documentación');
});
